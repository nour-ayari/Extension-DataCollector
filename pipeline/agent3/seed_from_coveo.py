"""Seed intervention_cases from the Coveo SIGIR 2021 browsing dataset.

This seeds Agent 3 with real purchase outcomes from session-level browsing
events, avoiding the circular labels used by the Supabase-based seeder.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
from supabase import create_client

from pipeline.agent3.decision_matrix import lookup
from pipeline.agent3.rag_context import from_user_meta
from pipeline.agent3.vector_store import search_similar_cases, upsert_case

load_dotenv()

SOURCE_TABLE = os.getenv("COVEO_SOURCE_TABLE", "raw_coveo_events")
VALID_EVENT_TYPES = {"pageview", "detail", "add", "purchase"}
EVENT_DEPTH = {"pageview": 1, "detail": 3, "add": 4, "purchase": 7}


def _create_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in environment")
    return create_client(url, key)


def _load_coveo_dataframe() -> pd.DataFrame:
    client = _create_supabase_client()
    batch_size = 5000
    start = 0
    frames: list[pd.DataFrame] = []

    while True:
        end = start + batch_size - 1
        try:
            response = (
                client.table(SOURCE_TABLE)
                .select("session_id,event_name,product_action,product_sku,event_timestamp,raw_payload")
                .order("event_timestamp")
                .range(start, end)
                .execute()
            )
        except Exception as exc:
            raise RuntimeError(f"Failed to read from Supabase table '{SOURCE_TABLE}': {exc}") from exc

        rows = getattr(response, "data", None) or []
        if not rows:
            break

        frame = pd.DataFrame(rows)
        frames.append(frame)
        if len(rows) < batch_size:
            break
        start += batch_size

    if not frames:
        raise RuntimeError(f"No rows found in Supabase table '{SOURCE_TABLE}'")

    df = pd.concat(frames, ignore_index=True)
    rename_map = {
        "event_name": "event_type",
        "event_timestamp": "event_ts",
    }
    df = df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns})

    if "event_ts" not in df.columns and "server_timestamp_epoch_ms" in df.columns:
        df["event_ts"] = pd.to_numeric(df["server_timestamp_epoch_ms"], errors="coerce")
    else:
        df["event_ts"] = pd.to_numeric(df.get("event_ts"), errors="coerce")

    if "event_type" not in df.columns:
        df["event_type"] = None

    df = df.replace([float("inf"), float("-inf")], pd.NA)
    df = df.dropna(subset=["session_id", "event_type", "event_ts"])
    df = df[df["event_type"].isin(VALID_EVENT_TYPES)].copy()
    df["event_ts"] = df["event_ts"].astype("int64")

    return df[[col for col in ["session_id", "event_type", "event_ts"] if col in df.columns]].copy()


def _dedupe_sequence(events: list[str]) -> str:
    out: list[str] = []
    for event in events:
        if not out or out[-1] != event:
            out.append(event)
    return "->".join(out)


def _qcut_scores(series: pd.Series, reverse: bool = False) -> pd.Series:
    if series.nunique(dropna=True) <= 1:
        return pd.Series([3.0] * len(series), index=series.index)

    ranked = series.rank(method="first")
    try:
        bins = pd.qcut(ranked, 5, labels=False, duplicates="drop")
    except ValueError:
        return pd.Series([3.0] * len(series), index=series.index)

    scores = bins.astype(float) + 1.0
    if reverse:
        max_score = float(scores.max())
        scores = max_score - scores + 1.0
    return scores.astype(float)


def _infer_persona(converted: bool, session_event_count: int, max_funnel_depth: int, cart_abandoned: bool) -> str:
    if converted and session_event_count >= 10:
        return "VIP"
    if converted and max_funnel_depth == 7:
        return "High Intent"
    if converted:
        return "Warm"
    if cart_abandoned and max_funnel_depth >= 4:
        return "High Intent"
    if max_funnel_depth == 3:
        return "Hesitant"
    if max_funnel_depth >= 2:
        return "Cold"
    return "Cold"


def _infer_sentiment(converted: bool, cart_abandoned: bool, session_event_count: int, bounce_rate: float) -> tuple[str, float]:
    if converted:
        return "Positive", 0.75
    if cart_abandoned and session_event_count >= 5:
        return "Negative", 0.70
    if cart_abandoned:
        return "Neutral", 0.62
    if bounce_rate == 1.0:
        return "Negative", 0.65
    return "Neutral", 0.60


def _infer_intent(converted: bool, cart_abandoned: bool, max_funnel_depth: int, bounce_rate: float) -> str:
    if converted:
        return "praise"
    if cart_abandoned:
        return "track_refund"
    if max_funnel_depth == 3:
        return "product_information"
    if bounce_rate == 1.0:
        return "return_request"
    return "product_information"


def _infer_churn_risk(sentiment: str, cart_abandoned: bool, recency_days: float, converted: bool) -> str:
    if sentiment == "Negative" and cart_abandoned:
        return "high"
    if sentiment == "Negative":
        return "medium"
    if recency_days > 30 and not converted:
        return "medium"
    if converted:
        return "low"
    return "low"


def _build_action_detail(template, converted: bool) -> str:
    details = {
        "exit_overlay": f"Don't leave - {'10% off your order today' if not converted else 'your cart is saved'}.",
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


def _session_hash(persona: str, sentiment: str, funnel_sequence: str, max_funnel_depth: int) -> str:
    payload = f"{persona}|{sentiment}|{funnel_sequence}|{int(max_funnel_depth)}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def _aggregate_sessions(df: pd.DataFrame) -> pd.DataFrame:
    reference_ts = int(df["event_ts"].max())
    grouped = df.sort_values(["session_id", "event_ts"]).groupby("session_id", sort=False)

    rows = []
    for session_id, group in grouped:
        events = group["event_type"].tolist()
        timestamps = group["event_ts"].tolist()
        session_event_count = len(events)
        pageview_count = sum(event == "pageview" for event in events)
        detail_count = sum(event == "detail" for event in events)
        converted = "purchase" in events
        cart_abandoned = ("add" in events) and not converted
        max_funnel_depth = max(EVENT_DEPTH.get(event, 0) for event in events)
        funnel_sequence = _dedupe_sequence(events)
        session_min_ts = min(timestamps)
        session_max_ts = max(timestamps)
        session_duration_ms = int((session_max_ts - session_min_ts) / 1000)
        recency_days = (reference_ts - session_min_ts) / 86400000.0

        rows.append({
            "session_id": session_id,
            "session_event_count": session_event_count,
            "pageview_count": pageview_count,
            "detail_count": detail_count,
            "converted": converted,
            "cart_abandoned": cart_abandoned,
            "max_funnel_depth": max_funnel_depth,
            "funnel_sequence": funnel_sequence,
            "session_duration_ms": session_duration_ms,
            "recency_days": float(recency_days),
        })

    sessions = pd.DataFrame(rows)
    sessions["bounce_rate"] = sessions.apply(
        lambda row: 1.0 if row["session_event_count"] <= 2 and not row["converted"] else 0.0,
        axis=1,
    )
    sessions["purchase_rate"] = sessions["converted"].astype(float)
    sessions["checkout_rate"] = sessions["max_funnel_depth"].apply(lambda value: 1.0 if value >= 4 else 0.0)
    sessions["cart_abandonment_rate"] = sessions["cart_abandoned"].astype(float)
    sessions["monetary"] = sessions["converted"].astype(float)
    sessions["frequency"] = sessions["session_event_count"].astype(float)
    sessions["avg_scroll_depth"] = (sessions["detail_count"] / sessions["session_event_count"].clip(lower=1)) * 100.0
    sessions["avg_clicks"] = sessions["session_event_count"].astype(float)

    sessions["r_score"] = _qcut_scores(sessions["recency_days"], reverse=True)
    sessions["f_score"] = _qcut_scores(sessions["session_event_count"])
    sessions["m_score"] = _qcut_scores(sessions["monetary"])
    sessions["rfm_score"] = ((sessions["r_score"] * 0.30) + (sessions["f_score"] * 0.30) + (sessions["m_score"] * 0.40)) / 5.0 * 100.0

    return sessions.sort_values(["converted", "recency_days"], ascending=[False, True]).reset_index(drop=True)


def _build_user_meta(row: pd.Series) -> dict:
    return {
        "max_funnel_depth": int(row["max_funnel_depth"]),
        "cart_abandonment_rate": float(row["cart_abandonment_rate"]),
        "avg_scroll_depth": float(row["avg_scroll_depth"]),
        "avg_clicks": float(row["avg_clicks"]),
        "bounce_rate": float(row["bounce_rate"]),
        "purchase_rate": float(row["purchase_rate"]),
        "checkout_rate": float(row["checkout_rate"]),
        "frequency": float(row["frequency"]),
        "monetary": float(row["monetary"]),
        "recency_days": float(row["recency_days"]),
        "r_score": float(row["r_score"]),
        "f_score": float(row["f_score"]),
        "m_score": float(row["m_score"]),
        "rfm_score": float(row["rfm_score"]),
        "funnel_sequence": row["funnel_sequence"],
    }


def seed_coveo(
    limit: int | None = None,
    dry_run: bool = False,
    clear_existing: bool = False,
    max_per_bucket: int = 8,
) -> None:
    if clear_existing:
        print("clear_existing requested, but no source column exists in intervention_cases. Skipping deletion.")

    print(f"Loading Coveo events from Supabase table '{SOURCE_TABLE}'...")
    df = _load_coveo_dataframe()
    print(f"Loaded {len(df):,} filtered events.")

    sessions = _aggregate_sessions(df)
    if limit is not None:
        sessions = sessions.head(limit).copy()

    bucket_counts: dict[tuple[str, str, str], int] = defaultdict(int)
    bucket_converted_counts: dict[tuple[str, str, str], int] = defaultdict(int)
    seen_keys: set[str] = set()
    seeded_cases: list[dict] = []

    processed = 0
    kept = 0
    skipped = 0
    errors = 0

    for _, row in sessions.iterrows():
        processed += 1
        if processed % 1000 == 0:
            print(f"Processed {processed:,} sessions...")

        if int(row["session_event_count"]) < 3:
            skipped += 1
            continue

        converted = bool(row["converted"])
        cart_abandoned = bool(row["cart_abandoned"])
        persona = _infer_persona(converted, int(row["session_event_count"]), int(row["max_funnel_depth"]), cart_abandoned)
        sentiment, confidence = _infer_sentiment(converted, cart_abandoned, int(row["session_event_count"]), float(row["bounce_rate"]))
        intent = _infer_intent(converted, cart_abandoned, int(row["max_funnel_depth"]), float(row["bounce_rate"]))
        churn_risk = _infer_churn_risk(sentiment, cart_abandoned, float(row["recency_days"]), converted)

        try:
            template = lookup(persona, sentiment)
        except KeyError:
            skipped += 1
            continue

        bucket = (persona, sentiment, template.action_type)
        current_count = bucket_counts[bucket]
        current_converted = bucket_converted_counts[bucket]

        allow = current_count < max_per_bucket
        if not allow and converted and current_converted < 3 and current_count < max_per_bucket + 3:
            allow = True
        if not allow:
            skipped += 1
            continue

        dedupe_key = _session_hash(persona, sentiment, row["funnel_sequence"], int(row["max_funnel_depth"]))
        if dedupe_key in seen_keys:
            skipped += 1
            continue
        seen_keys.add(dedupe_key)

        user_meta = _build_user_meta(row)
        ctx = from_user_meta(
            user_meta=user_meta,
            persona=persona,
            sentiment=sentiment,
            confidence=confidence,
            intent=intent,
            churn_risk=churn_risk,
        )
        behavioral_context = ctx.render_with_action(action_type=template.action_type, converted=converted)
        action_detail = _build_action_detail(template, converted)

        case = {
            "persona": persona,
            "sentiment": sentiment,
            "confidence": round(confidence, 2),
            "action_type": template.action_type,
            "action_detail": action_detail,
            "behavioral_context": behavioral_context,
            "converted": converted,
            "bucket": bucket,
        }

        if dry_run:
            kept += 1
            bucket_counts[bucket] += 1
            bucket_converted_counts[bucket] += int(converted)
            seeded_cases.append(case)
            continue

        try:
            upsert_case(
                persona=persona,
                sentiment=sentiment,
                confidence=round(confidence, 2),
                action_type=template.action_type,
                action_detail=action_detail,
                behavioral_context=behavioral_context,
                converted=converted,
            )
            bucket_counts[bucket] += 1
            bucket_converted_counts[bucket] += int(converted)
            kept += 1
            seeded_cases.append(case)
            print(f"[{kept:04d}] {persona:12s} x {sentiment:8s} -> {template.action_type:14s} converted={converted}")
        except Exception as exc:
            errors += 1
            print(f"ERROR on session {row['session_id']}: {exc}")

    converted_kept = sum(1 for case in seeded_cases if case["converted"])
    converted_pct = (converted_kept / max(kept, 1)) * 100.0

    print("\nSeed summary")
    print(f"Total sessions processed: {processed}")
    print(f"Sessions kept: {kept}")
    print(f"Skipped: {skipped}")
    print(f"Converted=True: {converted_kept} ({converted_pct:.1f}%)")
    print(f"Errors: {errors}")
    print("\nBucket summary")
    for persona in ["Cold", "Hesitant", "Warm", "High Intent", "VIP"]:
        for sentiment in ["Positive", "Neutral", "Negative"]:
            entries = [
                (action_type, bucket_counts[(persona, sentiment, action_type)], bucket_converted_counts[(persona, sentiment, action_type)])
                for action_type in sorted({bucket[2] for bucket in bucket_counts if bucket[0] == persona and bucket[1] == sentiment})
            ]
            for action_type, count, converted_count in entries:
                print(f"  {persona:12s} x {sentiment:8s} -> {action_type:14s}: {count} cases ({converted_count} converted)")

    validation_case = next(
        (case for case in seeded_cases if case["persona"] == "High Intent" and case["sentiment"] == "Negative"),
        None,
    )
    if validation_case is None:
        print("\nValidation skipped: no High Intent x Negative case was seeded.")
        return

    print("\nRetrieval validation")
    try:
        results = search_similar_cases(
            persona=validation_case["persona"],
            sentiment=validation_case["sentiment"],
            behavioral_context=validation_case["behavioral_context"],
            top_k=3,
            only_converted=False,
            filter_persona=True,
        )
        for idx, result in enumerate(results[:3], 1):
            similarity = result.get("similarity", result.get("score", result.get("match_score", "n/a")))
            print(
                f"  {idx}. similarity={similarity} converted={result.get('converted')} "
                f"persona={result.get('persona')} sentiment={result.get('sentiment')} action={result.get('action_type')}"
            )
    except Exception as exc:
        print(f"Validation failed: {exc}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed intervention_cases from Coveo SIGIR 2021 browsing sessions")
    parser.add_argument("--limit", type=int, default=50000, help="Cap total sessions processed (default: 50000)")
    parser.add_argument("--dry-run", action="store_true", help="Print cases, do not upsert")
    parser.add_argument("--clear", action="store_true", help="Warn and skip deletion unless a source column exists")
    parser.add_argument("--max-per-bucket", type=int, default=8, help="Maximum cases per persona/sentiment/action bucket")
    args = parser.parse_args()

    seed_coveo(
        limit=args.limit,
        dry_run=args.dry_run,
        clear_existing=args.clear,
        max_per_bucket=args.max_per_bucket,
    )