"""Aggregate `coveo_events` into `coveo_sessions`.

Reads `coveo_events` in pages, groups events by `session_id`, builds a
canonical funnel sequence, infers derived booleans (converted, abandoned,
contains_search), computes timestamps/duration/recency, and upserts into
`coveo_sessions` in batches.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from typing import Any

from dotenv import load_dotenv
import time

from supabase import create_client

load_dotenv()

PAGE_READ = 1000
DEFAULT_BATCH_SIZE = 500
EVENT_TABLE = "coveo_events"
SESSION_TABLE = "coveo_sessions"

# Funnel order used to compute depth and human-friendly sequence
FUNNEL_ORDER = [
    "page_view",
    "search_performed",
    "add_to_cart",
    "checkout",
    "purchase",
]


def _print_ddl() -> None:
    print(
        """
CREATE TABLE public.coveo_sessions (
  session_id text not null,
  funnel_sequence text null,
  max_funnel_depth integer null,
  converted boolean null,
  cart_abandoned boolean null,
  checkout_abandoned boolean null,
  session_event_count integer null,
  unique_event_count integer null,
  first_event_ts bigint null,
  last_event_ts bigint null,
  session_duration_ms bigint null,
  recency_days double precision null,
  contains_search boolean null,
  contains_remove boolean null,
  inferred_persona text null,
  inferred_sentiment text null,
  inferred_confidence double precision null,
  inferred_intent text null,
  inferred_churn_risk text null,
  created_at timestamp with time zone null default now(),
  constraint coveo_sessions_pkey primary key (session_id)
);

create index if not exists coveo_sessions_persona_idx on public.coveo_sessions using btree (inferred_persona, inferred_sentiment);
create index if not exists coveo_sessions_converted_idx on public.coveo_sessions using btree (converted);
create index if not exists coveo_sessions_churn_idx on public.coveo_sessions using btree (inferred_churn_risk);
"""
    )


def _create_supabase_client():
    import os

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in env")
    return create_client(url, key)


def _fetch_page(client, start: int, page_size: int = PAGE_READ, limit: int | None = None):
    end = start + page_size - 1
    q = client.table(EVENT_TABLE).select("session_id,event_name,event_timestamp,raw_payload,product_action").range(start, end)
    res = q.execute()
    rows = res.data or []
    if limit is not None:
        rows = rows[: max(0, limit - start)]
    return rows


def _upsert_batch(client, rows: list[dict[str, Any]]):
    try:
        client.table(SESSION_TABLE).upsert(rows).execute()
        return True
    except Exception as upsert_error:
        try:
            client.table(SESSION_TABLE).insert(rows).execute()
            return True
        except Exception as insert_error:
            print(f"Upsert failed: {upsert_error}")
            print(f"Insert fallback failed: {insert_error}")
            if rows:
                print(f"First row keys: {sorted(rows[0].keys())}")
                print(f"First row preview: {rows[0]}")
            return False


def aggregate_sessions(client, batch_size: int = DEFAULT_BATCH_SIZE, limit: int | None = None):
    offset = 0
    total_rows = 0
    session_events: dict[str, list[dict[str, Any]]] = defaultdict(list)

    print("Scanning events and grouping by session...")
    while True:
        rows = _fetch_page(client, offset, PAGE_READ, limit)
        if not rows:
            break
        for r in rows:
            sid = r.get("session_id")
            if not sid:
                continue
            session_events[sid].append(r)
        offset += len(rows)
        total_rows += len(rows)
        if limit is not None and total_rows >= limit:
            break
        if total_rows % 100000 == 0:
            print(f"Read {total_rows:,} events so far, sessions: {len(session_events):,}")

    print(f"Finished scanning. Events read: {total_rows:,}. Sessions gathered: {len(session_events):,}")

    # compute global reference timestamp (max first_event_ts) for recency
    first_event_ts_list = []
    for sid, evs in session_events.items():
        timestamps = [e.get("event_timestamp") for e in evs if e.get("event_timestamp") is not None]
        if timestamps:
            first_event_ts_list.append(min(timestamps))
    if first_event_ts_list:
        reference_ts = max(first_event_ts_list)
    else:
        reference_ts = int(time.time() * 1000)

    # aggregate and upsert in batches
    session_items = list(session_events.items())
    total_sessions = len(session_items)
    print(f"Aggregating {total_sessions:,} sessions and upserting in batches of {batch_size}")

    upserted = 0
    batch: list[dict[str, Any]] = []
    for index, (sid, events) in enumerate(session_items, start=1):
        # sort by timestamp
        events_sorted = sorted([e for e in events if e.get("event_timestamp") is not None], key=lambda x: x["event_timestamp"])
        if not events_sorted:
            continue

        # dedupe consecutive identical event_name
        dedup: list[str] = []
        for e in events_sorted:
            name = e.get("event_name")
            if not dedup or dedup[-1] != name:
                dedup.append(name)

        event_names = [e.get("event_name") for e in events_sorted if e.get("event_name")]
        session_event_count = len(events_sorted)
        unique_event_count = len(set(event_names))

        # derived booleans
        converted = "purchase" in dedup
        contains_search = "search_performed" in dedup
        contains_remove = "remove_from_cart" in dedup
        cart_present = "add_to_cart" in dedup
        checkout_present = "checkout" in dedup
        cart_abandoned = cart_present and not converted
        checkout_abandoned = checkout_present and not converted

        # append inferred abort events to funnel if needed
        funnel_sequence = dedup.copy()
        if cart_abandoned:
            funnel_sequence.append("cart_abandoned")
        if checkout_abandoned:
            funnel_sequence.append("checkout_abandoned")

        # compute max funnel depth
        max_depth = 0
        for ev in funnel_sequence:
            if ev in FUNNEL_ORDER:
                max_depth = max(max_depth, FUNNEL_ORDER.index(ev) + 1)

        first_ts = min(e["event_timestamp"] for e in events_sorted)
        last_ts = max(e["event_timestamp"] for e in events_sorted)
        duration_ms = int(last_ts - first_ts)
        recency_days = float((reference_ts - first_ts) / (1000 * 60 * 60 * 24))

        # Heuristics aligned to downstream pipeline labels
        if converted:
            inferred_persona = "High Intent"
            inferred_sentiment = "Positive"
            inferred_confidence = 0.87
            inferred_intent = "purchase"
            inferred_churn_risk = "low"
        elif cart_abandoned or checkout_abandoned:
            inferred_persona = "Hesitant"
            inferred_sentiment = "Negative"
            inferred_confidence = 0.78
            inferred_intent = "return_request"
            inferred_churn_risk = "high"
        elif cart_present or contains_search:
            inferred_persona = "Warm"
            inferred_sentiment = "Neutral"
            inferred_confidence = 0.66
            inferred_intent = "product_information"
            inferred_churn_risk = "medium"
        else:
            inferred_persona = "Cold"
            inferred_sentiment = "Neutral"
            inferred_confidence = 0.60
            inferred_intent = "product_information"
            inferred_churn_risk = "medium"

        session_record = {
            "session_id": sid,
            "first_event_ts": int(first_ts),
            "last_event_ts": int(last_ts),
            "session_duration_ms": duration_ms,
            "funnel_sequence": ">".join(funnel_sequence),
            "max_funnel_depth": max_depth,
            "converted": converted,
            "cart_abandoned": cart_abandoned,
            "checkout_abandoned": checkout_abandoned,
            "session_event_count": session_event_count,
            "unique_event_count": unique_event_count,
            "contains_search": contains_search,
            "contains_remove": contains_remove,
            "recency_days": recency_days,
            "inferred_persona": inferred_persona,
            "inferred_sentiment": inferred_sentiment,
            "inferred_confidence": inferred_confidence,
            "inferred_intent": inferred_intent,
            "inferred_churn_risk": inferred_churn_risk,
        }

        batch.append(session_record)
        if len(batch) >= batch_size:
            ok = _upsert_batch(client, batch)
            if not ok:
                print(f"Warning: failed upsert batch of {len(batch)} sessions")
            else:
                upserted += len(batch)
            batch = []
            if upserted % 1000 == 0:
                print(f"Upserted {upserted:,} sessions")

        if index % 1000 == 0:
            print(f"Processed {index:,}/{total_sessions:,} sessions")

    if batch:
        ok = _upsert_batch(client, batch)
        if not ok:
            print(f"Warning: failed final upsert batch of {len(batch)} sessions")
        else:
            upserted += len(batch)

    print(f"Completed. Sessions upserted: {upserted:,}")


def build_coveo_sessions(limit: int | None = None, batch_size: int = DEFAULT_BATCH_SIZE) -> None:
    client = _create_supabase_client()
    _print_ddl()
    aggregate_sessions(client, batch_size=batch_size, limit=limit)


def main():
    parser = argparse.ArgumentParser(description="Build coveo_sessions from coveo_events")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="Upsert batch size")
    parser.add_argument("--limit", type=int, default=None, help="Optional row read limit for coveo_events")
    args = parser.parse_args()

    build_coveo_sessions(limit=args.limit, batch_size=args.batch_size)


if __name__ == "__main__":
    main()
