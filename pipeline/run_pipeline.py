import os
import pandas as pd
from dotenv import load_dotenv

from pipeline.feature_eng   import add_event_features
from pipeline.aggregation   import aggregate_user_features
from pipeline.orchestrator  import run_orchestrator
from pipeline.supabase_sync import sync_to_supabase

load_dotenv()

def main():
    os.makedirs("data",   exist_ok=True)
    os.makedirs("models", exist_ok=True)

    csv_path = "data/events_cleaned.csv"
    if not os.path.exists(csv_path):
        raise FileNotFoundError(
            f"Input file not found: {csv_path}\n"
            "Run the preprocessing notebook first to generate events_cleaned.csv"
        )

    print("\n[1/5] Loading events_cleaned.csv...")
    df = pd.read_csv(csv_path, low_memory=False)
    print(f"  rows={len(df)}  cols={df.shape[1]}")

    print("\n[2/5] Feature engineering...")
    df = add_event_features(df)
    df.to_parquet("data/events_features.parquet", index=False)

    print("\n[3/5] Aggregating to user_features...")
    user_features = aggregate_user_features(df)
    user_features.to_parquet("data/user_features.parquet", index=False)

    print("\n[4/5] Running agents in parallel...")
    results = run_orchestrator(user_features)
    results.to_parquet("data/user_scores_final.parquet", index=False)
    results.to_csv("data/user_scores_final.csv", index=False)

    print("\n[5/5] Syncing to Supabase...")
    sync_to_supabase(results, table="user_features")

    print("\n" + "="*50)
    print("Pipeline complete ✓")
    print("="*50)
    print(results[[
        "client_id", "rfm_score", "behaviour_score",
        "intent_score", "final_score", "persona", "conversion_label"
    ]].head(10).to_string())

if __name__ == "__main__":
    main()
