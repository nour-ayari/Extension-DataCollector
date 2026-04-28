import os
from typing import Any, Dict
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()


def create_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in environment")
    return create_client(url, key)


def fetch_supabase_events(table: str = "events") -> pd.DataFrame:
    supabase = create_supabase_client()
    resp = supabase.table(table).select("*").execute()

    data = None
    if hasattr(resp, "data"):
        data = resp.data
    elif isinstance(resp, dict) and "data" in resp:
        data = resp["data"]
    elif isinstance(resp, list):
        data = resp
    else:
        try:
            data = list(resp)
        except Exception:
            data = None

    if data is None:
        raise RuntimeError("Unexpected Supabase response format when fetching events")

    if not data:
        return pd.DataFrame()

    return pd.DataFrame(data)


def flatten_supabase(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    def safe_flatten(df_local: pd.DataFrame, col: str, prefix: str) -> pd.DataFrame:
        if col not in df_local.columns:
            return df_local
        expanded = df_local[col].apply(lambda x: x if isinstance(x, dict) else {})
        flat = pd.json_normalize(expanded)
        if flat.empty:
            df_local = df_local.drop(columns=[col])
            return df_local
        flat.columns = [f"{prefix}_{c}" for c in flat.columns]
        return pd.concat([df_local.drop(columns=[col]), flat], axis=1)

    df = safe_flatten(df, "event_description", "ed")
    df = safe_flatten(df, "pages_per_session", "pps")

    # compute revenue from nested fields if present
    price = df.get("ed_price", pd.Series(0, index=df.index))
    qty = df.get("ed_quantity", pd.Series(0, index=df.index))
    price = pd.to_numeric(price, errors="coerce").fillna(0)
    qty = pd.to_numeric(qty, errors="coerce").fillna(0)
    df["revenue"] = price * qty

    # standard source tag
    df["source"] = "rudderstack"

    return df


if __name__ == "__main__":
    try:
        df = fetch_supabase_events()
        print(f"Fetched {len(df)} rows from Supabase events")
        df2 = flatten_supabase(df)
        print(f"Flattened shape: {df2.shape}")
    except Exception as e:
        print(f"Error fetching from Supabase: {e}")
