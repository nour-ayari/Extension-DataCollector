"""
seed_from_supabase.py — Seeds intervention_cases from real user_features data

Pulls existing scored users from Supabase user_features table, builds
UserContext for each, infers the action the decision matrix would have
assigned, labels converted based on actual purchase behavior, then
upserts to intervention_cases with action-aware embeddings.

Why this is better than synthetic seeding:
  - Real behavioral profiles from your actual users
  - Conversion labels derived from real purchase_rate / final_score
  - RFM bands from real r_score / f_score / m_score quintiles
  - Friction inferred from real funnel + abandonment data

Run once after supabase_setup.sql:
    python seed_from_supabase.py

Options:
    python seed_from_supabase.py --limit 200   # cap rows (default: all)
    python seed_from_supabase.py --dry-run     # print cases, no upsert
    python seed_from_supabase.py --clear       # delete existing cases first
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
from supabase import create_client

from pipeline.agent3.decision_matrix import lookup
from pipeline.agent3.rag_context import UserContext, from_user_meta
from pipeline.agent3.vector_store import upsert_case

load_dotenv()

# ---------------------------------------------------------------------------
# Conversion label rules — derived from real user_features columns
# ---------------------------------------------------------------------------

def _is_converted(row: dict) -> bool:
    """
    Infer whether this user 'converted' based on actual behavioral signals.

    Hierarchy (first match wins):
      1. purchase_rate > 0            → definitely converted
      2. final_score >= 75            → high-confidence conversion proxy
      3. checkout_rate >= 0.8         → completed checkout, likely bought
      4. cart_abandonment_rate == 0
         AND max_funnel_depth >= 6    → no abandon + deep funnel
      5. otherwise                   → not converted
    """
    purchase_rate        = row.get("purchase_rate")        or 0
    final_score          = row.get("final_score")          or 0
    checkout_rate        = row.get("checkout_rate")        or 0
    cart_abandonment_rate= row.get("cart_abandonment_rate")or 0
    max_funnel_depth     = row.get("max_funnel_depth")     or 0

    if purchase_rate > 0:                                         return True
    if final_score >= 75:                                         return True
    if checkout_rate >= 0.8:                                      return True
    if cart_abandonment_rate == 0 and max_funnel_depth >= 6:      return True
    return False


def _infer_sentiment(row: dict) -> tuple[str, float]:
    """
    Infer sentiment from behavioral signals when Agent 2 output is absent.
    Returns (label, confidence).
    """
    abandon = row.get("cart_abandonment_rate", 0.5) or 0
    bounce  = row.get("bounce_rate",           0.5) or 0
    purchase= row.get("purchase_rate",         0.0) or 0

    if purchase > 0.3 and abandon < 0.2:  return "Positive", 0.72
    if abandon  > 0.6 or bounce   > 0.5:  return "Negative", 0.68
    return "Neutral", 0.62


def _infer_intent(row: dict) -> str:
    """
    Map behavioral signals to an intent label that Agent 2 would produce.
    """
    purchase_rate        = row.get("purchase_rate",        0) or 0
    cart_abandonment_rate= row.get("cart_abandonment_rate",0) or 0
    checkout_rate        = row.get("checkout_rate",        0) or 0
    max_funnel_depth     = row.get("max_funnel_depth",     0) or 0

    if purchase_rate > 0:                       return "praise"
    if checkout_rate > 0 and cart_abandonment_rate > 0.5: return "track_refund"
    if max_funnel_depth >= 4:                   return "product_information"
    if cart_abandonment_rate > 0.7:             return "return_request"
    return "product_information"


def _infer_churn_risk(row: dict, sentiment: str) -> str:
    abandon  = row.get("cart_abandonment_rate", 0) or 0
    purchase = row.get("purchase_rate",         0) or 0
    recency  = row.get("recency_days",        999) or 999

    if sentiment == "Negative" and abandon > 0.5:          return "high"
    if sentiment == "Negative" and purchase == 0:          return "medium"
    if recency > 21 and purchase == 0:                     return "medium"
    if purchase > 0.3:                                     return "low"
    return "low"


# ---------------------------------------------------------------------------
# Main seeder
# ---------------------------------------------------------------------------

USER_FEATURES_COLUMNS = [
    "client_id", "persona", "conversion_label",
    "recency_days", "frequency", "monetary",
    "r_score", "f_score", "m_score", "rfm_score",
    "final_score", "behaviour_score", "intent_score", "context_score",
    "avg_scroll_depth", "avg_clicks", "bounce_rate",
    "cart_abandonment_rate", "purchase_rate", "checkout_rate",
    "max_funnel_depth", "cluster_id",
    "device_mode", "region",
]


def fetch_user_features(limit: int | None = None) -> list[dict]:
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
    query  = client.table("user_features").select(",".join(USER_FEATURES_COLUMNS))
    if limit:
        query = query.limit(limit)
    result = query.execute()
    return result.data or []


def build_seed_case(row: dict) -> dict | None:
    """
    Build one intervention_cases seed entry from a user_features row.
    Returns None if persona is missing (can't do matrix lookup).
    """
    persona = row.get("persona")
    if not persona:
        return None

    sentiment, confidence = _infer_sentiment(row)
    intent     = _infer_intent(row)
    churn_risk = _infer_churn_risk(row, sentiment)
    converted  = _is_converted(row)

    # Decision matrix lookup → action template
    try:
        template = lookup(persona, sentiment)
    except KeyError:
        return None

    # Build user_meta from row
    user_meta = {k: row.get(k) for k in USER_FEATURES_COLUMNS
                 if k not in ("client_id", "persona", "conversion_label")}
    user_meta["intent"]     = intent
    user_meta["churn_risk"] = churn_risk

    # Build UserContext
    ctx: UserContext = from_user_meta(
        user_meta  = user_meta,
        persona    = persona,
        sentiment  = sentiment,
        confidence = confidence,
        intent     = intent,
        churn_risk = churn_risk,
    )

    # Action-aware embedding text
    behavioral_context = ctx.render_with_action(
        action_type = template.action_type,
        converted   = converted,
    )

    # Realistic action_detail string (what LLM would produce)
    action_detail = _build_action_detail(template, ctx, converted)

    return {
        "persona":            persona,
        "sentiment":          sentiment,
        "confidence":         round(confidence, 2),
        "action_type":        template.action_type,
        "action_detail":      action_detail,
        "behavioral_context": behavioral_context,
        "converted":          converted,
    }


def _upsert_case_with_retry(case: dict, retries: int = 3, base_delay_seconds: float = 1.0) -> None:
    """Retry transient Supabase/network failures before giving up on a row."""
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            upsert_case(
                persona            = case["persona"],
                sentiment          = case["sentiment"],
                confidence         = case["confidence"],
                action_type        = case["action_type"],
                action_detail      = case["action_detail"],
                behavioral_context = case["behavioral_context"],
                converted          = case["converted"],
                source_type        = "real",
                parent_session_id  = case.get("session_id"),
                source_session_id  = case.get("session_id"),
            )
            return
        except Exception as exc:
            last_exc = exc
            if attempt >= retries:
                break
            delay = base_delay_seconds * attempt
            print(f"    retry {attempt}/{retries} after transient error: {exc}")
            time.sleep(delay)

    if last_exc is not None:
        raise last_exc


def _build_action_detail(template, ctx: UserContext, converted: bool) -> str:
    """
    Produce a realistic action_detail string matching what the LLM generates.
    Used as the 'action_detail' column in intervention_cases (subject line / copy snippet).
    """
    persona  = ctx.persona  or "User"
    friction = ctx._infer_friction() if hasattr(ctx, "_infer_friction") else ""

    details = {
        "exit_overlay":   f"Don't leave — {'10% off your order today' if not converted else 'your cart is saved'}.",
        "welcome_offer":  f"Welcome! Here's 10% off your first order.",
        "chatbot_fix":    f"Hi! Looks like you ran into an issue. We're here to help.",
        "price_nudge":    f"Still thinking? Add one more item and get 15% off.",
        "nurture_email":  f"We picked these for you based on what you've been browsing.",
        "apology_offer":  f"We're sorry about your experience. Here's 20% off as our apology.",
        "upsell":         f"Great choice! Customers who bought this also loved the premium bundle.",
        "scarcity_push":  f"Only 3 left in stock — order now before it sells out.",
        "referral":       f"You're one of our best customers — share and earn 200 TND credit.",
        "early_access":   f"As a VIP, you get early access to our new collection.",
        "human_call":     f"PRIORITY: VIP user flagged — assign to senior support immediately.",
        "chatbot_guide":  f"Not sure which to pick? Our assistant can compare in seconds.",
        "trust_signals":  f"Free returns · Secure payment · 4.8★ from 12,000 reviews.",
        "survey":         f"Quick question: what stopped you? Answer and get 5% off.",
        "review_ask":     f"Enjoying your browse? Tell us what you think — 30 seconds.",
    }
    return details.get(template.action_type, template.description)


def seed(limit: int | None = None, dry_run: bool = False, clear: bool = False):
    print(f"Fetching user_features from Supabase{f' (limit={limit})' if limit else ''}...")
    rows = fetch_user_features(limit=limit)
    print(f"  → {len(rows)} users fetched\n")

    if clear and not dry_run:
        client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
        client.table("intervention_cases").delete().neq("id", 0).execute()
        print("  → Cleared existing intervention_cases\n")

    ok = skipped = errors = 0
    converted_count = 0

    for i, row in enumerate(rows, 1):
        case = build_seed_case(row)
        if case is None:
            skipped += 1
            continue

        converted_count += int(case["converted"])
        status = "✓" if case["converted"] else "✗"

        if dry_run:
            print(f"  [{i:03d}] {status} {case['persona']:15s} × {case['sentiment']:10s}"
                  f" → {case['action_type']:20s} | converted={case['converted']}")
            print(f"         context: {case['behavioral_context'][:100]}...")
            ok += 1
            continue

        try:
            _upsert_case_with_retry(case)
            print(f"  [{i:03d}/{len(rows)}] {status} {case['persona']:15s} × {case['sentiment']:10s}"
                  f" → {case['action_type']:20s}")
            ok += 1
        except Exception as e:
            print(f"  [{i:03d}] ERROR: {e}")
            errors += 1

    print(f"\n{'DRY RUN — ' if dry_run else ''}Done.")
    print(f"  Seeded:    {ok}")
    print(f"  Converted: {converted_count} ({converted_count/max(ok,1)*100:.1f}%)")
    print(f"  Skipped:   {skipped} (missing persona)")
    print(f"  Errors:    {errors}")

    if ok > 0 and not dry_run:
        print(f"\n  intervention_cases now has {ok} real-data cases.")
        print(f"  Run 'python test_agent3_workflow.py' to verify retrieval quality.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed intervention_cases from real Supabase user_features")
    parser.add_argument("--limit",   type=int, default=None, help="Max rows to process (default: all)")
    parser.add_argument("--dry-run", action="store_true",    help="Print cases without upserting")
    parser.add_argument("--clear",   action="store_true",    help="Delete all existing cases first")
    args = parser.parse_args()

    seed(limit=args.limit, dry_run=args.dry_run, clear=args.clear)