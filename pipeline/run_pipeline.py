import os
import pandas as pd
from dotenv import load_dotenv

from pipeline.feature_eng   import add_event_features
from pipeline.aggregation   import aggregate_user_features
from pipeline.orchestrator  import run_orchestrator
from pipeline.supabase_sync import sync_to_supabase

load_dotenv()


def run_full_pipeline(events_df: pd.DataFrame, sync_results: bool = True) -> pd.DataFrame:
    os.makedirs("data",   exist_ok=True)
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

    results = run_full_pipeline(df, sync_results=True)

    print("\n" + "="*50)
    print("Pipeline complete ✓")
    print("="*50)
    print(results[[
        "client_id", "rfm_score", "behaviour_score",
        "intent_score", "final_score", "persona", "conversion_label"
    ]].head(10).to_string())

if __name__ == "__main__":
    main()
