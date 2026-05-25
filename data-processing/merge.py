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

TRACKED_COLS = [
    "id",
    "client_id",
    "session_id",
    "event_type",
    "duration",
    "logged_in",
    "event_description",
    "orders",
    "order_description",
    "timestamp",
    "nb_visits",
    "address",
    "gender",
    "age",
    "pages_per_session",
    "cart_abandonned",
    "device",
    "sequence",
    "is_bounce",
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


def align_tracked(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for col in TRACKED_COLS:
        if col not in df.columns:
            df[col] = None
    return df[TRACKED_COLS]


def merge_sources(df_sup: pd.DataFrame, df_bq: pd.DataFrame, df_synth: pd.DataFrame) -> pd.DataFrame:
    df_all = pd.concat([align(df_sup), align(df_bq), align(df_synth)], ignore_index=True)
    if "timestamp" in df_all.columns:
        df_all["timestamp"] = pd.to_datetime(df_all["timestamp"], utc=True, errors="coerce")
    df_all = df_all.sort_values("timestamp").drop_duplicates(subset=["client_id", "session_id"], keep="last")
    return df_all


def merge_sources_tracked(df_sup: pd.DataFrame, df_bq: pd.DataFrame, df_synth: pd.DataFrame) -> pd.DataFrame:
    df_all = pd.concat([align_tracked(df_sup), align_tracked(df_bq), align_tracked(df_synth)], ignore_index=True)
    if "timestamp" in df_all.columns:
        df_all["timestamp"] = pd.to_datetime(df_all["timestamp"], utc=True, errors="coerce")
    df_all = df_all.sort_values("timestamp").drop_duplicates(subset=["client_id", "session_id"], keep="last")
    return df_all


def canonical_to_unified(df: pd.DataFrame) -> pd.DataFrame:
    """Map canonical_schema columns back to the UNIFIED_COLS expected by Supabase.

    This ensures `client_id` is populated (from `user_id`) and that integer
    columns are properly cast to nullable integers.
    """
    df = df.copy()
    rename_map = {
        "user_id": "client_id",
        "event_name": "event_type",
        "event_timestamp": "timestamp",
        "click_count": "ed_click_count",
        "scroll_pct": "ed_max_scroll_pct",
        "page_type": "ed_page_type",
        "source": "ed_action_source",
        "raw_source": "source",
        "page_views": "pps_page_views",
        # passthrough fields with same name
        "duration": "duration",
        "logged_in": "logged_in",
        "device": "device",
        "region": "region",
        "orders": "orders",
        "revenue": "revenue",
        "cart_abandoned": "cart_abandoned",
        "nb_visits": "nb_visits",
        "sequence": "sequence",
        "is_bounce": "is_bounce",
        "age": "age",
        "gender": "gender",
        "session_id": "session_id",
    }

    intersect = {k: v for k, v in rename_map.items() if k in df.columns}
    df = df.rename(columns=intersect)
    if df.columns.duplicated().any():
        cols = []
        seen = set()
        for c in df.columns:
            if c in seen:
                continue
            seen.add(c)
            cols.append(c)
        df = df.loc[:, cols]
    for col in UNIFIED_COLS:
        if col not in df.columns:
            df[col] = None
    int_cols = ["age", "orders", "nb_visits", "pps_page_views", "ed_click_count", "ed_max_scroll_pct"]
    for c in int_cols:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce").astype("Int64")
    if "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce").dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        df.loc[df["timestamp"].isna(), "timestamp"] = None

    return df[UNIFIED_COLS]


def _sequence_to_list(value):
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        if "->" in value:
            parts = [p.strip() for p in value.split("->") if p.strip()]
            return parts or [value]
        if "→" in value:
            parts = [p.strip() for p in value.split("→") if p.strip()]
            return parts or [value]
        return [value]
    return [str(value)]


def canonical_to_tracked(df: pd.DataFrame) -> pd.DataFrame:
    """Map canonical schema to the Supabase tracked events schema."""
    df = df.copy()

    rename_map = {
        "user_id": "client_id",
        "event_name": "event_type",
        "event_timestamp": "timestamp",
        "duration": "duration",
        "logged_in": "logged_in",
        "orders": "orders",
        "nb_visits": "nb_visits",
        "gender": "gender",
        "age": "age",
        "cart_abandoned": "cart_abandonned",
        "device": "device",
        "sequence": "sequence",
        "is_bounce": "is_bounce",
        "session_id": "session_id",
        "region": "region",
    }

    intersect = {k: v for k, v in rename_map.items() if k in df.columns}
    df = df.rename(columns=intersect)
    def build_event_description(row):
        return {
            "query": None,
            "page_type": row.get("page_type"),
            "event_name": row.get("event_type"),
            "action_label": row.get("event_type"),
            "funnel_stage": row.get("funnel_stage"),
            "action_source": row.get("source"),
            "event_category": None,
            "action_location": None,
        }

    if "event_description" not in df.columns:
        df["event_description"] = df.apply(build_event_description, axis=1)
    if "pages_per_session" not in df.columns:
        page_views = pd.to_numeric(df.get("page_views", 0), errors="coerce").fillna(0)
        df["pages_per_session"] = page_views.apply(lambda v: {"page_views": {"page_views": int(v)}})
    if "sequence" in df.columns:
        df["sequence"] = df["sequence"].apply(_sequence_to_list)
    for col in TRACKED_COLS:
        if col not in df.columns:
            df[col] = None

    return df[TRACKED_COLS]


def push_unified_to_supabase(df_unified: pd.DataFrame, table: str = "unified_events", batch: int = 500) -> None:
    supabase = create_supabase_client()

    def _sanitize_value(v):
        # treat explicit None/NA
        if v is None:
            return None
        if isinstance(v, pd.Series):
            return [ _sanitize_value(x) for x in v.tolist() ]
        try:
            if pd.isna(v):
                return None
        except Exception:
            pass

        if isinstance(v, dict):
            return {k: _sanitize_value(val) for k, val in v.items()}

        if isinstance(v, (list, tuple)):
            return [ _sanitize_value(x) for x in v ]

        try:
            if isinstance(v, pd.Timestamp):
                return v.isoformat()
            if isinstance(v, (np.generic,)):
                return v.item()
        except Exception:
            pass
        if isinstance(v, float):
            if not np.isfinite(v):
                return None
            if v == int(v):
                return int(v)
            return float(v)
        if isinstance(v, (int, str, bool)):
            return v
        return None

    records = df_unified.where(pd.notnull(df_unified), None).to_dict(orient="records")
    for rec in records:
        for k in list(rec.keys()):
            rec[k] = _sanitize_value(rec[k])
        if rec.get("id") is None:
            rec.pop("id", None)

    for i in range(0, len(records), batch):
        batch_records = records[i:i+batch]
        try:
            supabase.table(table).upsert(batch_records).execute()
        except Exception as e:
            print(f"Failed to upsert batch {i}:{i+len(batch_records)} -> {e}")
        else:
            print(f"Upserted rows {i} to {i+len(batch_records)}")


def run_merge(synth_n: int = 2000, push: bool = True, target: str = "unified") -> pd.DataFrame:
    print("Fetching Supabase events...")
    try:
        df_sup = fetch_supabase_events()
    except Exception as e:
        print(f"Could not fetch Supabase events: {e}")
        df_sup = pd.DataFrame(columns=TRACKED_COLS if target == "tracked" else UNIFIED_COLS)

    print("Fetching GA4 from BigQuery...")
    try:
        df_bq = fetch_ga4()
    except Exception as e:
        print(f"Could not fetch GA4: {e}")
        df_bq = pd.DataFrame(columns=TRACKED_COLS if target == "tracked" else UNIFIED_COLS)

    print("Generating synthetic data...")
    df_synth = generate_synthetic(synth_n)
    if target == "tracked":
        df_bq_tracked = align_tracked(df_bq)
        df_synth_can = map_df_to_canonical(df_synth, "synthetic")
        df_synth_tracked = canonical_to_tracked(df_synth_can)
        df_tracked = merge_sources_tracked(df_sup, df_bq_tracked, df_synth_tracked)
        print(f"Tracked shape: {df_tracked.shape}")
        if push:
            print("Pushing tracked events to Supabase table 'events'...")
            push_unified_to_supabase(df_tracked, table="events")
        return df_tracked

    df_sup = flatten_supabase(df_sup)
    df_sup["source"] = df_sup.get("source", "rudderstack")

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

    df_sup_can = canonical_to_unified(df_sup_can)
    df_bq_can = canonical_to_unified(df_bq_can)
    df_synth_can = canonical_to_unified(df_synth_can)
    df_unified = merge_sources(df_sup_can, df_bq_can, df_synth_can)
    print(f"Unified shape: {df_unified.shape}")

    if push:
        print("Pushing unified events to Supabase...")
        push_unified_to_supabase(df_unified)
    return df_unified


if __name__ == "__main__":
    target = os.environ.get("MERGE_TARGET", "unified").strip().lower()
    df = run_merge(target=target)
    out_name = "merged_events_tracked.csv" if target == "tracked" else "merged_events.csv"
    df.to_csv(out_name, index=False)
    print(f"Saved {out_name}")
