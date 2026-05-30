"""Seed coveo_sessions from raw_coveo_events, then seed intervention_cases.

Stage 1 aggregates raw events into session-level features.
Stage 2 reads coveo_sessions and seeds action-aware intervention cases.
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Tuple

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

SOURCE_TABLE = os.getenv("COVEO_SOURCE_TABLE", "raw_coveo_events")
BATCH_READ = 1000
UPSERT_CHUNK = 500
VALID_EVENTS = {"pageview", "detail", "add", "purchase"}
FUNNEL_MAP = {"pageview": 1, "detail": 3, "add": 4, "purchase": 7}

ACTION_DETAILS = {
    "exit_overlay": "Don't leave - complete your order with 10% off.",
    "welcome_offer": "Welcome! Here's 10% off your first order.",
    "chatbot_fix": "Hi! Looks like you ran into an issue. We're here.",
    "price_nudge": "Still thinking? Add one more item and save 15%.",
    "nurture_email": "We picked these for you based on your browsing.",
    "apology_offer": "We're sorry. Here's 20% off as our apology.",
    "upsell": "Customers who bought this also loved the bundle.",
    "scarcity_push": "Only 3 left in stock - order now.",
    "referral": "Share and earn 200 TND store credit.",
    "early_access": "VIP early access to our new collection.",
    "human_call": "PRIORITY: VIP flagged - assign to senior support.",
    "chatbot_guide": "Not sure? Our assistant can compare in seconds.",
    "trust_signals": "Free returns - Secure payment - 4.8 star reviews.",
    "survey": "What stopped you? Answer and get 5% off.",
    "review_ask": "Enjoying your browse? Tell us - 30 seconds.",
}


def _create_supabase_client() -> Any:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in environment")
    return create_client(url, key)


def _print_ddl() -> None:
    ddl = """
CREATE TABLE IF NOT EXISTS coveo_sessions (
  session_id            text PRIMARY KEY,
  max_funnel_depth      integer,
  funnel_sequence       text,
  converted             boolean,
  cart_abandoned        boolean,
  session_event_count   integer,
  recency_days          float,
  avg_scroll_depth      float,
  avg_clicks            float,
  bounce_rate           float,
  purchase_rate         float,
  checkout_rate         float,
  cart_abandonment_rate float,
  monetary              float,
  r_score               float,
  f_score               float,
  m_score               float,
  rfm_score             float,
  inferred_persona      text,
  inferred_sentiment    text,
  inferred_confidence   float,
  inferred_intent       text,
  inferred_churn_risk   text,
  created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coveo_sessions_persona_idx
  ON coveo_sessions(inferred_persona, inferred_sentiment);
""".strip()
    print("If `coveo_sessions` does not exist, create it in the Supabase SQL editor with:")
    print(ddl)


def _fetch_rows(supabase, table: str, columns: str, batch_size: int = BATCH_READ) -> List[Dict[str, Any]]:
    offset = 0
    rows: List[Dict[str, Any]] = []
    while True:
        try:
            response = supabase.table(table).select(columns).range(offset, offset + batch_size - 1).execute()
        except Exception as exc:
            raise RuntimeError(f"Failed to read from Supabase table '{table}': {exc}") from exc
        batch = getattr(response, "data", None) or []
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < batch_size:
            break
        offset += batch_size
    return rows


def _safe_quintile(series: pd.Series, reverse: bool = False) -> pd.Series:
    labels = [5, 4, 3, 2, 1] if reverse else [1, 2, 3, 4, 5]
    try:
        return pd.qcut(series.rank(method="first"), q=5, labels=labels, duplicates="drop").astype(float)
    except ValueError:
        return pd.Series(3.0, index=series.index)


def _normalize_event_name(*values: Any) -> str | None:
    text = " ".join(str(value).strip().lower() for value in values if value is not None and str(value).strip())
    if not text:
        return None
    if "purchase" in text or "buy" in text or "order" in text:
        return "purchase"
    if "add" in text or "cart" in text:
        return "add"
    if "detail" in text or "product" in text:
        return "detail"
    if "page" in text or "view" in text:
        return "pageview"
    return None


def _aggregate_sessions(df: pd.DataFrame) -> pd.DataFrame:
    reference_ts = int(df["event_timestamp"].max())
    rows: List[Dict[str, Any]] = []

    for session_id, group in df.groupby("session_id", sort=False):
        group = group.sort_values("event_timestamp", ascending=True)
        events = group["event_name"].tolist()
        event_ts = group["event_timestamp"].tolist()
        session_event_count = len(events)
        max_funnel_depth = max(FUNNEL_MAP.get(e, 0) for e in events)

        dedup_sequence: List[str] = []
        for event_name in events:
            if not dedup_sequence or dedup_sequence[-1] != event_name:
                dedup_sequence.append(event_name)

        converted = "purchase" in events
        cart_abandoned = ("add" in events) and not converted
        session_min_ts = min(event_ts)
        recency_days = (reference_ts - session_min_ts) / 1000.0 / 86400.0
        pageview_count = sum(event == "pageview" for event in events)
        detail_count = sum(event == "detail" for event in events)

        bounce_rate = 1.0 if session_event_count <= 2 and not converted else 0.0
        purchase_rate = 1.0 if converted else 0.0
        checkout_rate = 1.0 if max_funnel_depth >= 4 else 0.0
        cart_abandonment_rate = 1.0 if cart_abandoned else 0.0
        monetary = 1.0 if converted else 0.0
        avg_scroll_depth = (detail_count / max(session_event_count, 1)) * 100.0
        avg_clicks = float(session_event_count)

        rows.append(
            {
                "session_id": session_id,
                "max_funnel_depth": int(max_funnel_depth),
                "funnel_sequence": "->".join(dedup_sequence),
                "converted": bool(converted),
                "cart_abandoned": bool(cart_abandoned),
                "session_event_count": int(session_event_count),
                "recency_days": float(recency_days),
                "avg_scroll_depth": float(avg_scroll_depth),
                "avg_clicks": float(avg_clicks),
                "bounce_rate": float(bounce_rate),
                "purchase_rate": float(purchase_rate),
                "checkout_rate": float(checkout_rate),
                "cart_abandonment_rate": float(cart_abandonment_rate),
                "monetary": float(monetary),
                "pageview_count": int(pageview_count),
                "detail_count": int(detail_count),
            }
        )

    sessions = pd.DataFrame(rows)
    sessions["r_score"] = _safe_quintile(sessions["recency_days"], reverse=True)
    sessions["f_score"] = _safe_quintile(sessions["session_event_count"])
    sessions["m_score"] = _safe_quintile(sessions["monetary"])
    sessions["rfm_score"] = (
        (sessions["r_score"] * 0.30 + sessions["f_score"] * 0.30 + sessions["m_score"] * 0.40) / 5.0 * 100.0
    )

    inferred = []
    for _, row in sessions.iterrows():
        persona = "Cold"
        if row["converted"] and row["session_event_count"] >= 10:
            persona = "VIP"
        elif row["converted"] and row["max_funnel_depth"] == 7:
            persona = "High Intent"
        elif row["converted"]:
            persona = "Warm"
        elif row["cart_abandoned"] and row["max_funnel_depth"] >= 4:
            persona = "High Intent"
        elif row["max_funnel_depth"] == 3:
            persona = "Hesitant"
        elif row["max_funnel_depth"] >= 2:
            persona = "Cold"

        sentiment = "Neutral"
        confidence = 0.60
        if row["converted"]:
            sentiment, confidence = "Positive", 0.75
        elif row["cart_abandoned"] and row["session_event_count"] >= 5:
            sentiment, confidence = "Negative", 0.70
        elif row["cart_abandoned"]:
            sentiment, confidence = "Neutral", 0.62
        elif row["bounce_rate"] == 1.0:
            sentiment, confidence = "Negative", 0.65

        intent = "product_information"
        if row["converted"]:
            intent = "praise"
        elif row["cart_abandoned"]:
            intent = "track_refund"
        elif row["max_funnel_depth"] == 3:
            intent = "product_information"
        elif row["bounce_rate"] == 1.0:
            intent = "return_request"

        churn_risk = "low"
        if sentiment == "Negative" and row["cart_abandoned"]:
            churn_risk = "high"
        elif sentiment == "Negative":
            churn_risk = "medium"
        elif row["recency_days"] > 30 and not row["converted"]:
            churn_risk = "medium"

        inferred.append(
            {
                "inferred_persona": persona,
                "inferred_sentiment": sentiment,
                "inferred_confidence": float(confidence),
                "inferred_intent": intent,
                "inferred_churn_risk": churn_risk,
            }
        )

    return pd.concat([sessions, pd.DataFrame(inferred)], axis=1)


def _load_stage1_events(supabase, limit_sessions: int | None) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []
    seen_sessions = set()
    offset = 0

    while True:
        try:
            response = (
                supabase.table(SOURCE_TABLE)
                .select("session_id, event_name, product_action, raw_payload, event_timestamp")
                .range(offset, offset + BATCH_READ - 1)
                .execute()
            )
        except Exception as exc:
            print(f"Error fetching raw_coveo_events: {exc}")
            break

        batch = getattr(response, "data", None) or []
        if not batch:
            break

        for row in batch:
            session_id = row.get("session_id")
            raw_payload = row.get("raw_payload")
            payload_text = ""
            if isinstance(raw_payload, dict):
                payload_text = " ".join(str(raw_payload.get(key, "")) for key in ["event_name", "event_type", "product_action", "product_sku", "action"])
            event_name = _normalize_event_name(row.get("event_name"), row.get("product_action"), payload_text)
            event_timestamp = row.get("event_timestamp")
            if session_id is None or event_name is None:
                continue
            rows.append(
                {
                    "session_id": session_id,
                    "event_name": event_name,
                    "event_timestamp": int(event_timestamp),
                }
            )
            seen_sessions.add(session_id)

        offset += BATCH_READ
        if limit_sessions and len(seen_sessions) >= limit_sessions:
            break

    df = pd.DataFrame(rows)
    print(f"Fetched {len(df)} raw events across {df['session_id'].nunique() if not df.empty else 0} unique sessions")
    return df


def _upsert_sessions(supabase, sessions: pd.DataFrame, dry_run: bool) -> int:
    if sessions.empty:
        print("Stored 0 sessions in coveo_sessions")
        return 0

    total = 0
    records = sessions.to_dict(orient="records")
    for start in range(0, len(records), UPSERT_CHUNK):
        chunk = records[start : start + UPSERT_CHUNK]
        total += len(chunk)
        if dry_run:
            continue
        try:
            supabase.table("coveo_sessions").upsert(chunk, on_conflict="session_id").execute()
        except Exception as exc:
            print(f"Error upserting coveo_sessions chunk: {exc}")
        if total % 2000 == 0:
            print(f"Progress: stored {total} sessions")

    print(f"Stored {total} sessions in coveo_sessions")
    return total


def _fetch_coveo_sessions_page(supabase, offset: int) -> List[Dict[str, Any]]:
    try:
        response = (
            supabase.table("coveo_sessions")
            .select("*")
            .order("created_at", desc=True)
            .range(offset, offset + BATCH_READ - 1)
            .execute()
        )
    except Exception as exc:
        raise RuntimeError(f"coveo_sessions table not available: {exc}") from exc
    return getattr(response, "data", None) or []


def _bucket_summary_line(bucket: Tuple[str, str, str], count: int) -> str:
    return f"  {bucket[0]} x {bucket[1]} -> {bucket[2]} : {count}"


def _seed_interventions(supabase, limit_interventions: int | None, max_per_bucket: int, dry_run: bool) -> None:
    bucket_counts: Dict[Tuple[str, str, str], int] = defaultdict(int)
    converted_in_bucket: Dict[Tuple[str, str, str], int] = defaultdict(int)
    seen_dedup_keys: set[int] = set()
    bucket_breakdown: Dict[Tuple[str, str, str], int] = defaultdict(int)

    total_sessions = 0
    cases_seeded = 0
    skipped_dedup = 0
    errors = 0
    converted_count = 0

    offset = 0
    while True:
        try:
            page = _fetch_coveo_sessions_page(supabase, offset)
        except RuntimeError as exc:
            print("coveo_sessions table not found. Please run Stage 1 first (no --skip-load). Exiting.")
            raise SystemExit(1) from exc

        if not page:
            break

        for row in page:
            total_sessions += 1
            if row.get("session_event_count", 0) < 3:
                continue
            if limit_interventions is not None and cases_seeded >= limit_interventions:
                break

            try:
                persona = row.get("inferred_persona")
                sentiment = row.get("inferred_sentiment")
                confidence = float(row.get("inferred_confidence") or 0.70)
                intent = row.get("inferred_intent")
                churn_risk = row.get("inferred_churn_risk")
                converted = bool(row.get("converted"))

                template = lookup(persona, sentiment)
                user_meta = {
                    "max_funnel_depth": row.get("max_funnel_depth"),
                    "cart_abandonment_rate": row.get("cart_abandonment_rate"),
                    "avg_scroll_depth": row.get("avg_scroll_depth"),
                    "avg_clicks": row.get("avg_clicks"),
                    "bounce_rate": row.get("bounce_rate"),
                    "purchase_rate": row.get("purchase_rate"),
                    "checkout_rate": row.get("checkout_rate"),
                    "frequency": float(row.get("session_event_count", 0)),
                    "monetary": row.get("monetary"),
                    "recency_days": row.get("recency_days"),
                    "r_score": row.get("r_score"),
                    "f_score": row.get("f_score"),
                    "m_score": row.get("m_score"),
                    "rfm_score": row.get("rfm_score"),
                    "funnel_sequence": row.get("funnel_sequence"),
                }
                ctx = from_user_meta(user_meta, persona, sentiment, confidence, intent, churn_risk)
                behavioral_context = ctx.render_with_action(action_type=template.action_type, converted=converted)

                bucket = (persona, sentiment, template.action_type)
                dedup_key = hash(
                    str(persona)
                    + str(sentiment)
                    + str(row.get("funnel_sequence") or "")
                    + str(int(row.get("max_funnel_depth") or 0))
                )
                if dedup_key in seen_dedup_keys:
                    skipped_dedup += 1
                    continue
                seen_dedup_keys.add(dedup_key)

                allow = bucket_counts[bucket] < max_per_bucket or converted_in_bucket[bucket] < 3
                if not allow:
                    skipped_dedup += 1
                    continue

                action_detail = ACTION_DETAILS.get(template.action_type, "")
                bucket_counts[bucket] += 1
                bucket_breakdown[bucket] += 1
                if converted:
                    converted_in_bucket[bucket] += 1
                    converted_count += 1

                if dry_run:
                    cases_seeded += 1
                    continue

                upsert_case(
                    persona=persona,
                    sentiment=sentiment,
                    confidence=confidence,
                    action_type=template.action_type,
                    action_detail=action_detail,
                    behavioral_context=behavioral_context,
                    converted=converted,
                )
                cases_seeded += 1
            except Exception as exc:
                errors += 1
                print(f"Error processing coveo session {row.get('session_id')}: {exc}")

        if limit_interventions is not None and cases_seeded >= limit_interventions:
            break
        offset += BATCH_READ

    pct = (converted_count / cases_seeded * 100.0) if cases_seeded else 0.0
    print("╔══════════════════════════════════════════════╗")
    print("║     COVEO INTERVENTION SEEDING SUMMARY      ║")
    print("╠══════════════════════════════════════════════╣")
    print(f"║ Sessions fetched      : {total_sessions:<5}                   ║")
    print(f"║ Cases seeded          : {cases_seeded:<5}                   ║")
    print(f"║ Converted=True        : {converted_count:<5} ({pct:.1f}%)            ║")
    print(f"║ Skipped (dedup)       : {skipped_dedup:<5}                   ║")
    print(f"║ Errors                : {errors:<5}                   ║")
    print("╠══════════════════════════════════════════════╣")
    print("║ Bucket breakdown:                           ║")
    for bucket, count in bucket_breakdown.items():
        print(_bucket_summary_line(bucket, count))
    print("╚══════════════════════════════════════════════╝")


def stage1(supabase, limit_sessions: int | None, dry_run: bool) -> None:
    _print_ddl()
    df = _load_stage1_events(supabase, limit_sessions)
    if df.empty:
        print("No raw events found")
        return
    sessions = _aggregate_sessions(df)
    _upsert_sessions(supabase, sessions, dry_run=dry_run)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Coveo sessions and intervention cases")
    parser.add_argument("--skip-load", action="store_true", help="Skip Stage 1 and use existing coveo_sessions")
    parser.add_argument("--skip-interventions", action="store_true", help="Skip Stage 2 seeding")
    parser.add_argument("--dry-run", action="store_true", help="Do not write to Supabase or intervention_cases")
    parser.add_argument("--limit-sessions", type=int, default=None, help="Cap rows processed from raw_coveo_events")
    parser.add_argument("--limit-interventions", type=int, default=None, help="Cap rows fetched from coveo_sessions")
    parser.add_argument("--max-per-bucket", type=int, default=8, help="Bucket cap for Stage 2")
    args = parser.parse_args()

    supabase = _create_supabase_client()

    if not args.skip_load:
        try:
            stage1(supabase, args.limit_sessions, args.dry_run)
        except Exception as exc:
            print(f"Stage 1 failed: {exc}")
            if not args.skip_interventions:
                print("Stage 2 will not run because Stage 1 did not complete cleanly.")
            return

    if args.skip_interventions:
        print("--skip-interventions provided, skipping Stage 2")
        return

    _seed_interventions(
        supabase,
        limit_interventions=args.limit_interventions,
        max_per_bucket=args.max_per_bucket,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
