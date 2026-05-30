"""# Reads from  : coveo_sessions (Supabase)
# Writes to   : intervention_cases (Supabase pgvector)
# Buckets by  : funnel_pattern — computed in memory from existing columns
# NO persona/sentiment inference — handled by Agent1+Agent2 at runtime
# NO schema changes — uses coveo_sessions columns as-is
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.agent3.rag_context import from_user_meta
from pipeline.agent3.vector_store import upsert_case

load_dotenv()

logger = logging.getLogger(__name__)
PAGE_SIZE = 1000

FUNNEL_ACTION_MAP: dict[str, str] = {
    "clean_purchase": "upsell",
    "purchase_with_friction": "review_ask",
    "friction_abandonment": "exit_overlay",
    "cart_abandonment": "price_nudge",
    "product_browse": "trust_signals",
    "cold_browse": "chatbot_guide",
}

FUNNEL_ACTION_DETAIL: dict[str, str] = {
    "upsell": "Great choice! Customers who bought this also loved the premium bundle.",
    "review_ask": "Enjoying your purchase? Tell us what you think - 30 seconds.",
    "exit_overlay": "Don't leave - your cart is saved and a discount is waiting.",
    "price_nudge": "Still thinking? Complete your order now and save 15%.",
    "trust_signals": "Free returns - Secure payment - 4.8★ from 12,000 reviews.",
    "chatbot_guide": "Not sure which to pick? Our assistant can help in seconds.",
}


def _get_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in environment")
    return create_client(url, key)


def _load_coveo_sessions(limit: int | None = None) -> pd.DataFrame:
    client = _get_supabase_client()
    try:
        rows: list[dict[str, Any]] = []
        offset = 0
        while True:
            page_limit = PAGE_SIZE
            if limit is not None:
                remaining = limit - offset
                if remaining <= 0:
                    break
                page_limit = min(page_limit, remaining)

            response = (
                client.table("coveo_sessions")
                .select("*")
                .gte("session_event_count", 3)
                .order("created_at", desc=True)
                .range(offset, offset + page_limit - 1)
                .execute()
            )
            page_rows = response.data or []
            if not page_rows:
                break
            rows.extend(page_rows)
            offset += len(page_rows)
            if len(page_rows) < page_limit:
                break

        if not rows:
            return pd.DataFrame()
        return pd.DataFrame(rows)
    except Exception as exc:
        logger.warning("Failed to fetch coveo_sessions from Supabase: %s", exc)
        return pd.DataFrame()


def _infer_funnel_pattern(row: pd.Series) -> str:
    converted = bool(row.get("converted", False))
    cart_abandoned = bool(row.get("cart_abandoned", False))
    contains_remove = bool(row.get("contains_remove", False))
    max_funnel_depth = int(row.get("max_funnel_depth") or 0)

    if converted and contains_remove:
        return "purchase_with_friction"
    if converted:
        return "clean_purchase"
    if contains_remove and not converted:
        return "friction_abandonment"
    if cart_abandoned:
        return "cart_abandonment"
    if max_funnel_depth >= 2:
        return "product_browse"
    return "cold_browse"


def _infer_churn_risk(row: pd.Series) -> str:
    converted = bool(row.get("converted", False))
    contains_remove = bool(row.get("contains_remove", False))
    cart_abandoned = bool(row.get("cart_abandoned", False))
    recency_days = float(row.get("recency_days") or 0.0)

    if contains_remove and not converted:
        return "high"
    if cart_abandoned:
        return "medium"
    if recency_days > 30 and not converted:
        return "medium"
    return "low"


# NOTE: coveo_sessions does not have cart_abandonment_rate, bounce_rate,
# frequency, monetary as float columns. These are derived from the boolean
# and count columns that coveo_sessions actually provides.
# RFM scores are intentionally excluded — they require real multi-session
# purchase history which Coveo browsing data cannot provide.
def _build_user_meta(row: pd.Series) -> dict[str, Any]:
    converted = bool(row.get("converted", False))
    cart_abandoned = bool(row.get("cart_abandoned", False))
    checkout_abandoned = bool(row.get("checkout_abandoned", False))
    session_event_count = int(row.get("session_event_count") or 0)
    session_duration_ms = float(row.get("session_duration_ms") or 0.0)

    return {
        "max_funnel_depth": row.get("max_funnel_depth"),
        "funnel_sequence": row.get("funnel_sequence"),
        "cart_abandonment_rate": 1.0 if cart_abandoned else 0.0,
        "bounce_rate": 1.0 if session_event_count <= 2 else 0.0,
        "purchase_rate": 1.0 if converted else 0.0,
        "checkout_rate": 1.0 if checkout_abandoned else 0.0,
        "monetary": 1.0 if converted else 0.0,
        "frequency": float(session_event_count),
        "avg_session_duration": session_duration_ms / 1000.0 if session_duration_ms > 0 else None,
        "recency_days": row.get("recency_days"),
        "avg_scroll_depth": row.get("avg_scroll_depth"),
        "avg_clicks": row.get("avg_clicks"),
        "r_score": None,
        "f_score": None,
        "m_score": None,
        "rfm_score": None,
    }


def _session_key(row: pd.Series) -> str:
    return str(row.get("session_id", ""))


def seed_coveo_interventions(
    limit: int | None = None,
    dry_run: bool = False,
    max_per_bucket: int = 50,
) -> None:
    sessions = _load_coveo_sessions(limit=limit)
    if sessions.empty:
        print("Coveo sessions fetched: 0")
        print("No coveo_sessions rows found or table is empty.")
        return

    sessions = sessions.copy()
    sessions = sessions.sort_values("created_at", ascending=False, na_position="last").reset_index(drop=True)

    total_fetched = int(len(sessions))
    kept = 0
    converted_count = 0
    skipped = 0
    errors = 0
    bucket_counts: dict[str, int] = defaultdict(int)
    bucket_seen_keys: dict[str, set[str]] = defaultdict(set)

    for idx, row in sessions.iterrows():
        try:
            funnel_pattern = _infer_funnel_pattern(row)
            converted = bool(row.get("converted", False))

            if funnel_pattern not in FUNNEL_ACTION_MAP:
                skipped += 1
                continue

            action_type = FUNNEL_ACTION_MAP[funnel_pattern]
            action_detail = FUNNEL_ACTION_DETAIL[action_type]
            session_key = _session_key(row)

            if session_key in bucket_seen_keys[funnel_pattern]:
                skipped += 1
                continue

            if bucket_counts[funnel_pattern] >= max_per_bucket:
                skipped += 1
                continue

            user_meta = _build_user_meta(row)
            ctx = from_user_meta(
                user_meta=user_meta,
                persona=None,
                sentiment=None,
                confidence=0.70,
                intent=funnel_pattern,
                churn_risk=_infer_churn_risk(row),
            )
            behavioral_context = ctx.render_with_action(
                action_type=action_type,
                converted=converted,
            )

            if not dry_run:
                upsert_case(
                    persona=funnel_pattern,
                    sentiment="Neutral",
                    confidence=0.70,
                    action_type=action_type,
                    action_detail=action_detail,
                    behavioral_context=behavioral_context,
                    converted=converted,
                    source_type="coveo_funnel",
                )

            bucket_seen_keys[funnel_pattern].add(session_key)
            bucket_counts[funnel_pattern] += 1
            if converted:
                converted_count += 1
            kept += 1

        except Exception as exc:
            errors += 1
            logger.warning("Error at row %s: %s", idx, exc)

    print("═" * 46)
    print(" COVEO FUNNEL SEEDING COMPLETE")
    print(f" Sessions fetched     : {total_fetched:,}")
    print(f" Sessions kept        : {kept:,}")
    print(f" Skipped              : {skipped:,}")
    print(f" Errors               : {errors:,}")
    print(" Funnel pattern breakdown:")
    for funnel_pattern in [
        "clean_purchase",
        "purchase_with_friction",
        "friction_abandonment",
        "cart_abandonment",
        "product_browse",
        "cold_browse",
    ]:
        action_type = FUNNEL_ACTION_MAP[funnel_pattern]
        print(f"   {funnel_pattern:<24} → {action_type:<14}: {bucket_counts.get(funnel_pattern, 0):,}")
    print("═" * 46)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed intervention_cases from Coveo sessions already stored in Supabase")
    parser.add_argument("--limit", type=int, default=None, help="Limit the number of sessions to process")
    parser.add_argument("--dry-run", action="store_true", help="Print progress without upserting cases")
    parser.add_argument("--max-per-bucket", type=int, default=50, help="Max cases per funnel-pattern bucket")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
    seed_coveo_interventions(limit=args.limit, dry_run=args.dry_run, max_per_bucket=args.max_per_bucket)
