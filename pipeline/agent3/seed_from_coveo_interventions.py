from __future__ import annotations

import argparse
import hashlib
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

from pipeline.agent3.decision_matrix import lookup
from pipeline.agent3.rag_context import from_user_meta
from pipeline.agent3.vector_store import upsert_case

load_dotenv()

logger = logging.getLogger(__name__)


def _get_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in environment")
    return create_client(url, key)


def _build_action_detail(template, converted: bool) -> str:
    details = {
        "exit_overlay": f"Don't leave - {'10% off your order today' if not converted else 'your cart is saved' }.",
        "welcome_offer": "Welcome! Here's 10% off your first order.",
        "chatbot_fix": "Hi! Looks like you ran into an issue. We're here to help.",
        "price_nudge": "Still thinking? Add one more item and get 15% off.",
        "nurture_email": "We picked these for you based on what you've been browsing.",
        "apology_offer": "We're sorry about your experience. Here's 20% off as our apology.",
        "upsell": "Great choice! Customers who bought this also loved the premium bundle.",
        "scarcity_push": "Only 3 left in stock - order now before it sells out.",
        "referral": "You're one of our best customers - share and earn 200 TND credit.",
        "early_access": "As a VIP, you get early access to our new collection.",
        "human_call": "PRIORITY: VIP user flagged - assign to senior support immediately.",
        "chatbot_guide": "Not sure which to pick? Our assistant can compare in seconds.",
        "trust_signals": "Free returns - Secure payment - 4.8★ from 12,000 reviews.",
        "survey": "Quick question: what stopped you? Answer and get 5% off.",
        "review_ask": "Enjoying your browse? Tell us what you think - 30 seconds.",
    }
    return details.get(template.action_type, template.description)


def _load_coveo_sessions(limit: int | None = None) -> pd.DataFrame:
    client = _get_supabase_client()
    try:
        query = (
            client.table("coveo_sessions")
            .select("*")
            .gte("session_event_count", 3)
            .order("created_at", desc=True)
        )
        if limit is not None:
            query = query.limit(limit)
        response = query.execute()
    except Exception as exc:
        logger.warning("Failed to fetch coveo_sessions from Supabase: %s", exc)
        return pd.DataFrame()

    rows = response.data or []
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows)


def _build_user_meta(row: pd.Series) -> dict[str, Any]:
    keys = [
        "max_funnel_depth",
        "cart_abandonment_rate",
        "avg_scroll_depth",
        "avg_clicks",
        "bounce_rate",
        "purchase_rate",
        "checkout_rate",
        "frequency",
        "monetary",
        "recency_days",
        "r_score",
        "f_score",
        "m_score",
        "rfm_score",
        "funnel_sequence",
    ]
    meta: dict[str, Any] = {}
    for key in keys:
        value = row.get(key)
        if value is not None and not (isinstance(value, float) and pd.isna(value)):
            meta[key] = value
    return meta


def _session_key(row: pd.Series) -> str:
    funnel_sequence = str(row.get("funnel_sequence", ""))
    max_funnel_depth = int(row.get("max_funnel_depth", 0) or 0)
    payload = f"{funnel_sequence}|{max_funnel_depth}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def seed_coveo_interventions(
    limit: int | None = None,
    dry_run: bool = False,
    max_per_bucket: int = 8,
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
    bucket_counts: dict[tuple[str, str, str], int] = defaultdict(int)
    bucket_converted: dict[tuple[str, str, str], int] = defaultdict(int)
    bucket_seen_keys: dict[tuple[str, str, str], set[str]] = defaultdict(set)

    for idx, row in sessions.iterrows():
        try:
            persona = str(row.get("inferred_persona", "")).strip()
            sentiment = str(row.get("inferred_sentiment", "")).strip().capitalize()
            intent = str(row.get("inferred_intent", "")).strip()
            churn_risk = str(row.get("inferred_churn_risk", "")).strip()
            converted = bool(row.get("converted", False))

            if not persona or sentiment not in {"Positive", "Neutral", "Negative"}:
                skipped += 1
                continue

            try:
                template = lookup(persona, sentiment)
            except KeyError:
                skipped += 1
                continue

            bucket = (persona, sentiment, template.action_type)
            session_key = _session_key(row)
            if session_key in bucket_seen_keys[bucket]:
                skipped += 1
                continue

            bucket_limit = max_per_bucket + (3 if bucket_converted[bucket] < 3 else 0)
            if bucket_counts[bucket] >= bucket_limit:
                skipped += 1
                continue

            user_meta = _build_user_meta(row)
            ctx = from_user_meta(
                user_meta=user_meta,
                persona=persona,
                sentiment=sentiment,
                confidence=0.70,
                intent=intent,
                churn_risk=churn_risk,
            )
            behavioral_context = ctx.render_with_action(
                action_type=template.action_type,
                converted=converted,
            )
            action_detail = _build_action_detail(template, converted)

            if not dry_run:
                upsert_case(
                    persona=persona,
                    sentiment=sentiment,
                    confidence=0.70,
                    action_type=template.action_type,
                    action_detail=action_detail,
                    behavioral_context=behavioral_context,
                    converted=converted,
                )

            bucket_seen_keys[bucket].add(session_key)
            bucket_counts[bucket] += 1
            if converted:
                bucket_converted[bucket] += 1
                converted_count += 1
            kept += 1

            if (idx + 1) % 500 == 0:
                print(f"Processed {idx + 1}/{total_fetched} | kept={kept} | skipped={skipped} | errors={errors}")
        except Exception as exc:
            errors += 1
            logger.warning("Coveo intervention seeding error at row %s: %s", idx, exc)

    converted_pct = (converted_count / kept * 100.0) if kept else 0.0

    print(f"Coveo sessions fetched: {total_fetched}")
    print(f"Sessions kept: {kept}")
    print(f"Converted=True: {converted_count} ({converted_pct:.1f}%)")
    print(f"Skipped (dedup/quality): {skipped}")
    print(f"Errors: {errors}")
    print("Bucket breakdown (persona × sentiment → action: count):")
    for (persona, sentiment, action_type), count in sorted(bucket_counts.items()):
        print(f"  {persona} × {sentiment} → {action_type}: {count}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed intervention_cases from Coveo sessions already stored in Supabase")
    parser.add_argument("--limit", type=int, default=None, help="Limit the number of sessions to process")
    parser.add_argument("--dry-run", action="store_true", help="Print progress without upserting cases")
    parser.add_argument("--max-per-bucket", type=int, default=8, help="Base max cases per persona/sentiment/action bucket")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
    seed_coveo_interventions(limit=args.limit, dry_run=args.dry_run, max_per_bucket=args.max_per_bucket)
