"""Ingest Coveo SIGIR browsing events into `coveo_events`.

Reads `browsing_train.csv` in chunks, normalizes events to canonical names,
and inserts clean rows into `coveo_events`. Prints DDL at startup; does
not execute DDL.
"""

from __future__ import annotations

import argparse
import os
import math
from pathlib import Path
from typing import Any
from collections import defaultdict

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

TARGET_TABLE = "coveo_events"
DEFAULT_INPUT = "browsing_train.csv"
DEFAULT_CHUNK_SIZE = 10_000
DEFAULT_BATCH_SIZE = 200

COLUMN_MAP = {
    "session_id_hash": "session_id",
    "event_type": "event_name",
    "product_action": "product_action",
    "product_sku_hash": "product_sku",
    "server_timestamp_epoch_ms": "event_timestamp",
}

# Canonical events and mapping (Coveo raw -> canonical)
CANONICAL_EVENTS = {
    "page_view",
    "search_performed",
    "add_to_cart",
    "remove_from_cart",
    "checkout",
    "purchase",
}

COVEO_TO_CANONICAL: dict[tuple[str, str | None], str] = {
    ("pageview",    None):        "page_view",
    ("pageview",    ""):          "page_view",
    ("listing",     None):        "page_view",
    ("click",       None):        "page_view",
    ("event",       "detail"):    "page_view",
    ("event",       "quickview"): "page_view",
    ("product",     "detail"):    "page_view",
    ("product",     "view"):      "page_view",
    ("search",      None):        "search_performed",
    ("event",       "add"):       "add_to_cart",
    ("cart",        "add"):       "add_to_cart",
    ("event",       "remove"):    "remove_from_cart",
    ("cart",        "remove"):    "remove_from_cart",
    ("event",       "checkout"):  "checkout",
    ("event",       "purchase"):  "purchase",
    ("transaction", "purchase"):  "purchase",
    ("transaction", None):        "purchase",
}


def _create_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in environment")
    return create_client(url, key)


def _resolve_input_path(path_str: str) -> Path:
    path = Path(path_str)
    if path.exists():
        return path
    candidate = Path(__file__).resolve().parent / path_str
    if candidate.exists():
        return candidate
    raise FileNotFoundError(f"Input CSV not found: {path_str}")


def _safe_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.generic,)):
        value = value.item()
    if isinstance(value, pd.Timestamp):
        return int(value.timestamp() * 1000)
    if isinstance(value, float) and not math.isfinite(value):
        return None
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    if isinstance(value, (dict, list, str, int, float, bool)):
        return value
    return str(value)


def _clean_json_value(value: Any) -> Any:
    value = _safe_value(value)
    if value is None:
        return None
    if isinstance(value, dict):
        return {key: _clean_json_value(val) for key, val in value.items()}
    if isinstance(value, list):
        return [_clean_json_value(item) for item in value]
    if isinstance(value, tuple):
        return [_clean_json_value(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _coerce_timestamp(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        if np.isnan(value):
            return None
        return int(value)
    try:
        return int(float(value))
    except Exception:
        return None


def _print_ddl() -> None:
    ddl = """
CREATE TABLE IF NOT EXISTS coveo_events (
    id                bigserial PRIMARY KEY,
    session_id        text        NOT NULL,
    event_name        text        NOT NULL,
    product_action    text,
    product_sku       text,
    event_timestamp   bigint      NOT NULL,
    raw_payload       jsonb,
    created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coveo_events_session_idx
    ON coveo_events(session_id);
CREATE INDEX IF NOT EXISTS coveo_events_event_name_idx
    ON coveo_events(event_name);
CREATE INDEX IF NOT EXISTS coveo_events_timestamp_idx
    ON coveo_events(session_id, event_timestamp);
"""
    print("DDL for coveo_events (create in Supabase SQL editor if needed):")
    print(ddl)


def normalize_event(event_type: Any, product_action: Any) -> str | None:
    et = str(event_type).strip().lower() if event_type is not None else ""
    pa_raw = str(product_action).strip().lower() if product_action is not None else ""
    pa = pa_raw if pa_raw not in ("", "none", "nan") else None

    # direct pair mapping
    result = COVEO_TO_CANONICAL.get((et, pa))
    if result:
        return result

    # fallback to event_type-only mapping
    result = COVEO_TO_CANONICAL.get((et, None))
    if result:
        return result

    combined = f"{et} {pa or ''}".strip()
    if "purchase" in combined or "transaction" in combined:
        return "purchase"
    if "checkout" in combined:
        return "checkout"
    if "add" in combined and ("cart" in combined or et == "event"):
        return "add_to_cart"
    if "remove" in combined:
        return "remove_from_cart"
    if "search" in combined:
        return "search_performed"
    if et in ("pageview", "listing", "page"):
        return "page_view"

    return None


def _normalize_chunk(chunk: pd.DataFrame) -> pd.DataFrame:
    chunk = chunk.copy()
    available = {source: target for source, target in COLUMN_MAP.items() if source in chunk.columns}
    if not available:
        return pd.DataFrame(columns=["session_id", "event_name", "product_action", "product_sku", "event_timestamp", "raw_payload"])

    chunk = chunk.rename(columns=available)

    for column in ["session_id", "event_name", "product_action", "product_sku", "event_timestamp"]:
        if column not in chunk.columns:
            chunk[column] = None

    chunk = chunk.replace([np.inf, -np.inf], np.nan)
    chunk["session_id"] = chunk["session_id"].where(chunk["session_id"].notna(), None)
    chunk["event_timestamp"] = pd.to_numeric(chunk["event_timestamp"], errors="coerce")
    chunk = chunk[chunk["session_id"].notna() & chunk["event_timestamp"].notna()].copy()
    if chunk.empty:
        return pd.DataFrame(columns=["session_id", "event_name", "product_action", "product_sku", "event_timestamp", "raw_payload"])

    chunk["session_id"] = chunk["session_id"].astype(str).str.strip()
    chunk = chunk[chunk["session_id"] != ""]
    if chunk.empty:
        return pd.DataFrame(columns=["session_id", "event_name", "product_action", "product_sku", "event_timestamp", "raw_payload"])

    chunk["event_timestamp"] = chunk["event_timestamp"].astype("int64")
    chunk = chunk.reset_index(drop=True)

    raw_payload_records = [
        _clean_json_value(record)
        for record in chunk.to_dict(orient="records")
    ]

    payload_frame = chunk[["session_id", "event_name", "product_action", "product_sku", "event_timestamp"]].copy()
    payload_frame["session_id"] = payload_frame["session_id"].map(_safe_value)
    payload_frame["event_name"] = payload_frame["event_name"].map(_safe_value)
    payload_frame["product_action"] = payload_frame["product_action"].map(_safe_value)
    payload_frame["product_sku"] = payload_frame["product_sku"].map(_safe_value)
    payload_frame["event_timestamp"] = payload_frame["event_timestamp"].map(_coerce_timestamp)
    payload_frame["raw_payload"] = raw_payload_records

    return payload_frame


def _insert_batch(client, rows: list[dict[str, Any]]) -> None:
    client.table(TARGET_TABLE).insert(rows).execute()


def _insert_with_retry(client, rows: list[dict[str, Any]]) -> bool:
    try:
        _insert_batch(client, rows)
        return True
    except Exception as first_error:
        try:
            _insert_batch(client, rows)
            return True
        except Exception as second_error:
            print(f"Failed batch insert after retry: {second_error}")
            print(f"First error: {first_error}")
            return False


def ingest_coveo_to_supabase(
    input_path: str = DEFAULT_INPUT,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> None:
    client = _create_supabase_client()
    csv_path = _resolve_input_path(input_path)

    _print_ddl()

    total_raw = 0
    total_inserted = 0
    total_dropped = 0
    global_event_counts: dict[str, int] = defaultdict(int)

    print(f"Reading {csv_path} in chunks of {chunk_size:,}...")

    for chunk_index, chunk in enumerate(pd.read_csv(csv_path, chunksize=chunk_size, low_memory=False), start=1):
        raw_count = len(chunk)
        total_raw += raw_count

        # rename columns and ensure presence
        chunk = chunk.rename(columns={k: v for k, v in COLUMN_MAP.items() if k in chunk.columns})

        # apply normalization per row
        records_in_batch: list[dict[str, Any]] = []
        per_chunk_counts: dict[str, int] = defaultdict(int)
        dropped_in_chunk = 0

        for row in chunk.to_dict(orient="records"):
            session_id = _safe_value(row.get("session_id"))
            raw_event = row.get("event_name")
            product_action = row.get("product_action")
            event_ts = _coerce_timestamp(row.get("event_timestamp"))

            canonical = normalize_event(raw_event, product_action)

            if not session_id or canonical is None or event_ts is None:
                dropped_in_chunk += 1
                continue

            per_chunk_counts[canonical] += 1
            global_event_counts[canonical] += 1

            payload = {k: _clean_json_value(v) for k, v in row.items()}

            records_in_batch.append(
                {
                    "session_id": session_id,
                    "event_name": canonical,
                    "product_action": _safe_value(product_action),
                    "product_sku": _safe_value(row.get("product_sku")),
                    "event_timestamp": int(event_ts),
                    "raw_payload": payload,
                }
            )

        # insert in batches
        for start in range(0, len(records_in_batch), batch_size):
            batch = records_in_batch[start : start + batch_size]
            if not batch:
                continue
            if _insert_with_retry(client, batch):
                total_inserted += len(batch)
            else:
                total_dropped += len(batch)

        total_dropped += dropped_in_chunk

        # chunk observability
        print(
            f"Chunk {chunk_index} | raw={raw_count} | valid={len(records_in_batch)} | dropped={dropped_in_chunk} | {dict(per_chunk_counts)}"
        )

    # final summary
    print("\n══════════════════════════════════")
    print(" INGESTION COMPLETE")
    print(f" Total raw rows read   : {total_raw}")
    print(f" Total inserted        : {total_inserted}")
    print(f" Total dropped         : {total_dropped}")
    print(f" Global event dist.    : {dict(global_event_counts)}")
    print("══════════════════════════════════")


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest Coveo browsing_train.csv into Supabase raw_coveo_events")
    parser.add_argument("--input", default=DEFAULT_INPUT, help="Path to browsing_train.csv")
    parser.add_argument("--chunk-size", type=int, default=DEFAULT_CHUNK_SIZE, help="CSV rows per read chunk")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="Supabase insert batch size")
    args = parser.parse_args()

    ingest_coveo_to_supabase(
        input_path=args.input,
        chunk_size=args.chunk_size,
        batch_size=args.batch_size,
    )


if __name__ == "__main__":
    main()