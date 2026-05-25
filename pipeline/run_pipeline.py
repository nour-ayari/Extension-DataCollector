import os
import importlib
import sys
import json
from pathlib import Path
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

from pipeline.feature_eng   import add_event_features
from pipeline.aggregation   import aggregate_user_features
from pipeline.orchestrator  import run_orchestrator
from pipeline.supabase_sync import sync_to_supabase

load_dotenv()

ROOT_DIR = Path(__file__).resolve().parent.parent
ASSEMBLY_DIR = ROOT_DIR / "pipeline" / "assembly"
AGENT3_DIR = ROOT_DIR / "pipeline" / "agent3"
for extra_path in [ASSEMBLY_DIR, AGENT3_DIR]:
    if extra_path.exists() and str(extra_path) not in sys.path:
        sys.path.insert(0, str(extra_path))


def _load_get_recommendations_for_users():
    try:
        module = importlib.import_module("orchestrator_integration")
        return getattr(module, "get_recommendations_for_users", None)
    except Exception:
        return None


REQUIRED_EVENT_COLUMNS = {
    "event_type": None,
    "timestamp": None,
    "client_id": None,
    "session_id": None,
    "sequence": "",
    "orders": 0,
    "duration": 0,
    "ed_max_scroll_pct": 0,
    "ed_click_count": 0,
    "ed_price": 0,
    "ed_quantity": 1,
    "ed_action_source": "unknown",
    "pps_page_views": 0,
    "is_bounce": 0,
    "logged_in": 0,
    "device": "unknown",
    "address": "unknown",
    "nb_visits": 0,
    "age": 0,
    "gender": "unknown",
    "cart_abandonned": 0,
}


def _get_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in environment")
    return create_client(url, key)


def _parse_json_like(value):
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return {}
    return {}


def _flatten_events(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()

    if "event_description" in out.columns:
        ed = out["event_description"].apply(_parse_json_like).apply(lambda x: x if isinstance(x, dict) else {})
        flat = pd.json_normalize(ed)
        if not flat.empty:
            flat.columns = [f"ed_{c}" for c in flat.columns]
            out = pd.concat([out.drop(columns=["event_description"]), flat], axis=1)
        else:
            out = out.drop(columns=["event_description"])

    if "pages_per_session" in out.columns:
        pps = out["pages_per_session"].apply(_parse_json_like)
        out["pps_page_views"] = pps.apply(lambda x: len(x) if isinstance(x, list) else 0)
        out = out.drop(columns=["pages_per_session"])

    if "event_name" in out.columns and "event_type" not in out.columns:
        out = out.rename(columns={"event_name": "event_type"})
    if "event_timestamp" in out.columns and "timestamp" not in out.columns:
        out = out.rename(columns={"event_timestamp": "timestamp"})
    if "user_id" in out.columns and "client_id" not in out.columns:
        out = out.rename(columns={"user_id": "client_id"})

    if "cart_abandoned" in out.columns and "cart_abandonned" not in out.columns:
        out["cart_abandonned"] = out["cart_abandoned"]

    for col, default in REQUIRED_EVENT_COLUMNS.items():
        if col not in out.columns:
            out[col] = default

    return out


def _load_events_input(csv_path: str) -> pd.DataFrame:
    if os.path.exists(csv_path):
        print("\n[1/6] Loading events_cleaned.csv...")
        df = pd.read_csv(csv_path, low_memory=False)
        print(f"  source=csv rows={len(df)} cols={df.shape[1]}")
        return df

    print("\n[1/6] events_cleaned.csv not found; loading from Supabase events table...")
    supabase = _get_supabase_client()
    resp = supabase.table("events").select("*").execute()
    data = resp.data or []
    if not data:
        raise FileNotFoundError(
            "No events found in Supabase table 'events' and local data/events_cleaned.csv is missing"
        )

    df = _flatten_events(pd.DataFrame(data))
    os.makedirs("data", exist_ok=True)
    df.to_csv(csv_path, index=False)
    print(f"  source=supabase rows={len(df)} cols={df.shape[1]} (saved snapshot to {csv_path})")
    return df


def _run_pipeline_steps(events_df: pd.DataFrame, sync_results: bool) -> pd.DataFrame:
    os.makedirs("data", exist_ok=True)
    os.makedirs("models", exist_ok=True)

    print("\n[1/4] Feature engineering...")
    events_features = add_event_features(events_df)
    events_features.to_parquet("data/events_features.parquet", index=False)

    print("\n[2/4] Aggregating to user_features...")
    user_features = aggregate_user_features(events_features)
    user_features.to_parquet("data/user_features.parquet", index=False)

    print("\n[3/4] Running agents in parallel...")
    results = run_orchestrator(user_features)
    results.to_parquet("data/user_scores_final.parquet", index=False)
    results.to_csv("data/user_scores_final.csv", index=False)

    if sync_results:
        print("\n[4/4] Syncing to Supabase...")
        sync_to_supabase(results, table="user_features")

    return results


def run_full_pipeline(events_df: pd.DataFrame, sync_results: bool = True) -> pd.DataFrame:
    return _run_pipeline_steps(events_df, sync_results=sync_results)

def main():
    csv_path = "data/events_cleaned.csv"
    df = _load_events_input(csv_path)

    results = _run_pipeline_steps(df, sync_results=True)

    get_recommendations_for_users = _load_get_recommendations_for_users()

    if get_recommendations_for_users is not None:
        agent3_mode = os.getenv("AGENT3_MODE", "direct")
        max_users_raw = os.getenv("AGENT3_MAX_USERS")
        max_users = int(max_users_raw) if max_users_raw else None

        print("\n[5/5] Generating Agent 3 recommendations from user_features...")
        rec_df = get_recommendations_for_users(results, mode=agent3_mode, max_users=max_users)
        if not rec_df.empty:
            rec_df.to_parquet("data/recommendations_final.parquet", index=False)
            rec_df.to_csv("data/recommendations_final.csv", index=False)
            print(f"  recommendations={len(rec_df)}")
        else:
            print("  no recommendations generated")
    else:
        print("\n[5/5] Agent 3 integration not available; skipping recommendation generation.")

    print("\n" + "="*50)
    print("Pipeline complete ✓")
    print("="*50)
    print(results[[
        "client_id", "rfm_score", "behaviour_score",
        "intent_score", "final_score", "persona", "conversion_label"
    ]].head(10).to_string())

if __name__ == "__main__":
    main()
