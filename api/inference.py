import uuid
import json
from pathlib import Path

import numpy as np
from setfit import SetFitModel
from transformers import pipeline


TOP_K = 3
LOW_CONFIDENCE_THRESHOLD = 0.65

PROJECT_DIR = Path(".")
SETFIT_DIR = PROJECT_DIR / "models" / "setfit_intent" / "best_model"
LABEL_MAP_PATH = PROJECT_DIR / "models" / "setfit_intent" / "label_mappings.json"


def load_label_mappings(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        maps = json.load(f)

    label2id = {str(k): int(v) for k, v in maps["label2id"].items()}

    if "id2label" in maps:
        id2label = {int(k): str(v) for k, v in maps["id2label"].items()}
    else:
        id2label = {v: k for k, v in label2id.items()}

    return label2id, id2label


LABEL2ID, ID2LABEL = load_label_mappings(LABEL_MAP_PATH)
NUM_LABELS = len(ID2LABEL)

setfit_model = SetFitModel.from_pretrained(str(SETFIT_DIR))

sentiment_pipe = pipeline(
    "text-classification",
    model="cardiffnlp/twitter-roberta-base-sentiment-latest",
    top_k=None,
    device=-1
)


CHURN_RISK_MAP = {
    "damaged_delivery": "high",
    "missing_item": "high",
    "wrong_item": "high",
    "cancel_order": "high",
    "contact_human_agent": "high",
    "delete_account": "high",
    "technical_issue": "high",

    "payment_issue": "medium",
    "request_refund": "medium",
    "return_product": "medium",
    "exchange_product": "medium",
    "change_order": "medium",
    "recover_password": "medium",
    "check_refund_policy": "medium",

    "track_order": "low",
    "track_delivery": "low",
    "delivery_time": "low",
    "shipping_costs": "low",
    "product_information": "low",
    "availability": "low",
    "add_product": "low",
    "remove_product": "low",
    "pay": "low",
    "check_payment_methods": "low",
    "create_account": "low",
    "change_account": "low",
    "request_invoice": "low",
    "order_history": "low",
    "sales_period": "low",
    "store_location": "low",
    "store_opening_hours": "low",
    "submit_feedback": "low",
    "submit_product_idea": "low",
    "request_right_to_rectification": "low",
    "track_refund": "low",
    "use_app": "low",
}


def top_k_intents(prob_row: np.ndarray, k: int = TOP_K):
    top_ids = np.argsort(prob_row)[::-1][:k]

    return [
        {
            "intent": ID2LABEL[int(idx)],
            "score": round(float(prob_row[int(idx)]), 4),
        }
        for idx in top_ids
    ]


def compute_churn_risk(intent: str, confidence: float, sentiment_label: str | None = None):
    risk = CHURN_RISK_MAP.get(intent, "low")

    if confidence < LOW_CONFIDENCE_THRESHOLD and risk == "low":
        risk = "medium"

    if sentiment_label == "negative":
        if risk == "low":
            risk = "medium"
        elif risk == "medium":
            risk = "high"

    return risk


def predict_sentiment(text: str):
    output = sentiment_pipe(text[:512])[0]
    top = max(output, key=lambda x: x["score"])

    return {
        "label": top["label"].lower(),
        "score": round(float(top["score"]), 4),
        "method": "roberta-zero-shot",
    }


def predict_intent(text: str):
    probs = np.asarray(setfit_model.predict_proba([text]), dtype=float)

    if probs.shape[1] != NUM_LABELS:
        raise ValueError(
            f"Mismatch: SetFit returned {probs.shape[1]} columns, "
            f"but label mapping contains {NUM_LABELS} labels."
        )

    row = probs[0]
    pred_id = int(np.argmax(row))
    confidence = round(float(np.max(row)), 4)

    return {
        "predicted": ID2LABEL[pred_id],
        "confidence": confidence,
        "top_k": top_k_intents(row),
        "primary_model": "SetFit",
        "method": "setfit_sentence_embeddings",
    }


def predict_message(message: str) -> dict:
    clean_text = message.strip()

    intent_block = predict_intent(clean_text)
    sentiment_block = predict_sentiment(clean_text)

    churn_level = compute_churn_risk(
        intent=intent_block["predicted"],
        confidence=intent_block["confidence"],
        sentiment_label=sentiment_block["label"]
    )

    return {
        "record_id": str(uuid.uuid4()),
        "clean_instruction": clean_text,

        "intent": intent_block,

        "sentiment": sentiment_block,

        "churn_risk": {
            "level": churn_level,
            "method": "intent-confidence-sentiment-heuristic",
        }
    }