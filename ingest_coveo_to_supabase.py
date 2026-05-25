"""Ingest Coveo SIGIR browsing events into the raw Supabase layer.

This targets only `raw_coveo_events` and does not bypass feature engineering.
"""

from __future__ import annotations

import argparse
import os
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

TARGET_TABLE = "raw_coveo_events"
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

    total_rows = 0
    total_inserted = 0
    total_skipped = 0
    batch_buffer: list[dict[str, Any]] = []

    print(f"Reading {csv_path} in chunks of {chunk_size:,}...")

    for chunk_index, chunk in enumerate(pd.read_csv(csv_path, chunksize=chunk_size, low_memory=False), start=1):
        total_rows += len(chunk)
        normalized = _normalize_chunk(chunk)
        if normalized.empty:
            total_skipped += len(chunk)
            print(f"Chunk {chunk_index}: no valid rows")
            continue

        records = [
            {key: _clean_json_value(value) for key, value in record.items()}
            for record in normalized.to_dict(orient="records")
        ]
        total_skipped += len(chunk) - len(records)

        batch_buffer.extend(records)
        while len(batch_buffer) >= batch_size:
            current_batch = batch_buffer[:batch_size]
            batch_buffer = batch_buffer[batch_size:]
            if _insert_with_retry(client, current_batch):
                total_inserted += len(current_batch)
                print(f"Batch {chunk_index}: inserted {total_inserted:,} rows so far")
            else:
                total_skipped += len(current_batch)
                print(f"Batch {chunk_index}: skipped failed batch of {len(current_batch)} rows")

    if batch_buffer:
        if _insert_with_retry(client, batch_buffer):
            total_inserted += len(batch_buffer)
            print(f"Final batch inserted, total {total_inserted:,} rows")
        else:
            total_skipped += len(batch_buffer)
            print(f"Final batch skipped after retry, {len(batch_buffer)} rows")

    print("\nIngestion summary")
    print(f"Total rows processed: {total_rows}")
    print(f"Total inserted: {total_inserted}")
    print(f"Total skipped: {total_skipped}")


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