import json
from pathlib import Path
from supabase_client import supabase

RAG_PATH = Path("D:/conv_nlp_pipeline/reports/rag_export/mapped_rag_output.json")

def flatten_output(item: dict) -> dict:
    intent = item.get("intent", {})
    sentiment = item.get("sentiment", {})
    churn = item.get("churn_risk", {})
    gt = item.get("ground_truth", {})

    return {
        "source": "rag_export",
        "record_id": item.get("record_id"),
        "session_id": item.get("session_id"),
"user_id": item.get("client_id"),

        "message": item.get("clean_instruction"),
        "clean_instruction": item.get("clean_instruction"),

        "predicted_intent": intent.get("predicted"),
        "intent_confidence": intent.get("confidence"),
        "intent_top_k": intent.get("top_k"),
        "intent_model": intent.get("primary_model"),
        "intent_method": intent.get("method"),

        "sentiment_label": sentiment.get("label"),
        "sentiment_score": sentiment.get("score"),
        "sentiment_method": sentiment.get("method"),

        "churn_level": churn.get("level"),
        "churn_method": churn.get("method"),

        "ground_truth_label": gt.get("label_name"),
        "ground_truth_id": gt.get("label_id"),

        "raw_output": item
    }


def main():
    with open(RAG_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    rows = [flatten_output(item) for item in data]

    batch_size = 500

    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        supabase.table("nlp_conversation_outputs").insert(batch).execute()
        print(f"Inserted {i + len(batch)} / {len(rows)}")

    print("Import finished.")


if __name__ == "__main__":
    main()