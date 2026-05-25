from fastapi import FastAPI
from api.schemas import MessageRequest
from api.inference import predict_message
from api.supabase_client import supabase

app = FastAPI(
    title="Conversational NLP Intelligence API",
    description="Intent detection, sentiment analysis, churn risk scoring and Supabase logging",
    version="1.0.0"
)


@app.get("/")
def root():
    return {
        "status": "running",
        "service": "Conv NLP Pipeline API"
    }


@app.post("/conversation/analyze")
def analyze_message(request: MessageRequest):
    output = predict_message(request.message)

    intent = output["intent"]
    sentiment = output["sentiment"]
    churn = output["churn_risk"]

    row = {
        "source": "api",
        "record_id": output["record_id"],
        "session_id": request.session_id,
        "user_id": request.user_id,

        "message": request.message,
        "clean_instruction": output["clean_instruction"],

        "predicted_intent": intent["predicted"],
        "intent_confidence": intent["confidence"],
        "intent_top_k": intent["top_k"],
        "intent_model": intent["primary_model"],
        "intent_method": intent["method"],

        "sentiment_label": sentiment["label"],
        "sentiment_score": sentiment["score"],
        "sentiment_method": sentiment["method"],

        "churn_level": churn["level"],
        "churn_method": churn["method"],

        "raw_output": output
    }

    supabase.table("nlp_conversation_outputs").insert(row).execute()

    return {
        "saved": True,
        "output": output,
        "insight": {
            "priority": "urgent" if churn["level"] == "high" else "normal",
            "routing_team": get_routing_team(intent["predicted"]),
            "recommended_action": get_recommended_action(
                intent["predicted"],
                sentiment["label"],
                churn["level"]
            )
        }
    }


def get_routing_team(intent: str) -> str:
    mapping = {
        "product_information": "Product Support",
        "payment_issue": "Billing Team",
        "damaged_delivery": "Logistics Support",
        "missing_item": "Logistics Support",
        "technical_issue": "Technical Support",
        "contact_human_agent": "Human Support",
        "request_refund": "Refund Team",
        "cancel_order": "Order Management"
    }

    return mapping.get(intent, "General Support")


def get_recommended_action(intent: str, sentiment: str, churn: str) -> str:
    if churn == "high":
        return "Escalate immediately to a human agent"

    if sentiment == "negative":
        return "Respond with apology and offer direct assistance"

    if intent == "product_information":
        return "Send product details or FAQ answer"

    return "Handle with standard support workflow"