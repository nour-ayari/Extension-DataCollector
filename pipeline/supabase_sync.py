import os
import pandas as pd
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

PUSH_COLS = [
    "client_id", "recency_days", "frequency", "monetary",
    "r_score", "f_score", "m_score",
    "rfm_score", "behaviour_score", "intent_score",
    "context_score", "final_score",
    "persona", "cluster_id", "conversion_label",
    "avg_scroll_depth", "avg_clicks", "bounce_rate",
    "cart_abandonment_rate", "purchase_rate", "checkout_rate",
    "max_funnel_depth", "device_mode", "region",
]

def sync_to_supabase(df: pd.DataFrame, table: str = "user_features"):
    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_KEY"],
    )

    cols    = [c for c in PUSH_COLS if c in df.columns]
    payload = df[cols].where(pd.notnull(df[cols]), None)
    records = payload.to_dict(orient="records")

    print(f"\n[supabase_sync] pushing {len(records)} rows to '{table}'...")
    BATCH = 500
    for i in range(0, len(records), BATCH):
        supabase.table(table).upsert(records[i:i+BATCH]).execute()
        print(f"  upserted {min(i+BATCH, len(records))}/{len(records)}")

    print("[supabase_sync] done ✓")
