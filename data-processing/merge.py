"""Orchestrate fetching from sources, align schema, deduplicate and push to Supabase.

Provides a CLI and importable functions for merging `rudderstack`, `bigquery_ga4`,
and `synthetic` sources into `unified_events` table in Supabase.
"""

import os
from typing import List
import pandas as pd
import numpy as np
from dotenv import load_dotenv

load_dotenv()

from bigquery_fetch import fetch_ga4
from supabase_fetch import fetch_supabase_events, flatten_supabase
from synthetic_gen import generate_synthetic
from canonical_schema import map_df_to_canonical, CANONICAL_COLUMNS
from supabase import create_client

UNIFIED_COLS = [
    "client_id", "session_id", "event_type", "timestamp",
    "duration", "logged_in", "device", "region",
    "ed_click_count", "ed_max_scroll_pct", "ed_action_source", "ed_page_type",
    "orders", "revenue", "cart_abandoned", "nb_visits", "pps_page_views",
    "sequence", "is_bounce", "age", "gender",
    "source", "rfm_score", "conversion_score"
]


def create_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in environment")
    return create_client(url, key)


def align(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in UNIFIED_COLS:
        if col not in df.columns:
            df[col] = None
    return df[UNIFIED_COLS]


def merge_sources(df_sup: pd.DataFrame, df_bq: pd.DataFrame, df_synth: pd.DataFrame) -> pd.DataFrame:
    df_all = pd.concat([align(df_sup), align(df_bq), align(df_synth)], ignore_index=True)
    if "timestamp" in df_all.columns:
        df_all["timestamp"] = pd.to_datetime(df_all["timestamp"], utc=True, errors="coerce")
    df_all = df_all.sort_values("timestamp").drop_duplicates(subset=["client_id", "session_id"], keep="last")
    return df_all


def push_unified_to_supabase(df_unified: pd.DataFrame, table: str = "unified_events", batch: int = 500) -> None:
    supabase = create_supabase_client()

    def _sanitize_value(v):
        # treat explicit None/NA
        if v is None:
            return None
        try:
            if pd.isna(v):
                return None
        except Exception:
            pass

        # numpy scalars -> python native
        try:
            if isinstance(v, pd.Timestamp):
                return v.isoformat()
            if isinstance(v, (np.generic,)):
                return v.item()
        except Exception:
            pass

        # floats with NaN/inf
        if isinstance(v, float):
            if not np.isfinite(v):
                return None
            return float(v)

        # ints/bools/str already JSON-friendly
        if isinstance(v, (int, str, bool)):
            return v

        # fallback: leave as None if unknown/unserializable
        return None

    records = df_unified.where(pd.notnull(df_unified), None).to_dict(orient="records")
    # sanitize records
    for rec in records:
        for k in list(rec.keys()):
            rec[k] = _sanitize_value(rec[k])

    for i in range(0, len(records), batch):
        batch_records = records[i:i+batch]
        try:
            supabase.table(table).upsert(batch_records).execute()
        except Exception as e:
            print(f"Failed to upsert batch {i}:{i+len(batch_records)} -> {e}")
        else:
            print(f"Upserted rows {i} to {i+len(batch_records)}")


def run_merge(synth_n: int = 2000, push: bool = True) -> pd.DataFrame:
    print("Fetching Supabase events...")
    try:
        df_sup = fetch_supabase_events()
        df_sup = flatten_supabase(df_sup)
        df_sup["source"] = df_sup.get("source", "rudderstack")
    except Exception as e:
        print(f"Could not fetch Supabase events: {e}")
        df_sup = pd.DataFrame(columns=UNIFIED_COLS)

    print("Fetching GA4 from BigQuery...")
    try:
        df_bq = fetch_ga4()
    except Exception as e:
        print(f"Could not fetch GA4: {e}")
        df_bq = pd.DataFrame(columns=UNIFIED_COLS)

    print("Generating synthetic data...")
    df_synth = generate_synthetic(synth_n)

    # map each source to canonical schema before merging
    try:
        df_sup_can = map_df_to_canonical(df_sup, "rudderstack")
    except Exception:
        df_sup_can = df_sup
    try:
        df_bq_can = map_df_to_canonical(df_bq, "bigquery_ga4")
    except Exception:
        df_bq_can = df_bq
    try:
        df_synth_can = map_df_to_canonical(df_synth, "synthetic")
    except Exception:
        df_synth_can = df_synth

    df_unified = merge_sources(df_sup_can, df_bq_can, df_synth_can)
    print(f"Unified shape: {df_unified.shape}")

    if push:
        print("Pushing unified events to Supabase...")
        push_unified_to_supabase(df_unified)

    return df_unified


if __name__ == "__main__":
    df = run_merge()
    df.to_csv("merged_events.csv", index=False)
    print("Saved merged_events.csv")
