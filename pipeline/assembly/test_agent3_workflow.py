"""
test_agent3_workflow.py

Run a real Agent 3 workflow using:
- Agent 1 JSON shaped like the upstream classifier output
- Agent 2 row loaded from Supabase recommendation_log
- Agent 3 direct pipeline output

Usage:
    python test_agent3_workflow.py
    python test_agent3_workflow.py --agent2-id 1574
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from supabase import create_client

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from recommendation_agent import AgentInput, run


class Agent1IntentScore(BaseModel):
    predicted: str
    confidence: float
    top_k: list[dict[str, Any]] = Field(default_factory=list)
    primary_model: Optional[str] = None
    method: Optional[str] = None


class Agent1SentimentScore(BaseModel):
    label: str
    score: float
    method: Optional[str] = None


class Agent1ChurnRisk(BaseModel):
    level: str
    method: Optional[str] = None


class Agent1GroundTruth(BaseModel):
    label_id: Optional[int] = None
    label_name: Optional[str] = None


class Agent1WorkflowInput(BaseModel):
    record_id: str
    clean_instruction: str
    intent: Agent1IntentScore
    sentiment: Agent1SentimentScore
    churn_risk: Agent1ChurnRisk
    ground_truth: Optional[Agent1GroundTruth] = None


class Agent2WorkflowInput(BaseModel):
    id: int
    user_id: str
    persona: str
    sentiment: str
    confidence: float
    action_type: str
    trigger_cond: str
    created_at: Optional[str] = None


class UserFeaturesRow(BaseModel):
    client_id: str
    recency_days: Optional[float] = None
    frequency: Optional[float] = None
    monetary: Optional[float] = None
    r_score: Optional[float] = None
    f_score: Optional[float] = None
    m_score: Optional[float] = None
    rfm_score: Optional[float] = None
    behaviour_score: Optional[float] = None
    intent_score: Optional[float] = None
    context_score: Optional[float] = None
    final_score: Optional[float] = None
    persona: Optional[str] = None
    cluster_id: Optional[int] = None
    conversion_label: Optional[str] = None
    avg_scroll_depth: Optional[float] = None
    avg_clicks: Optional[float] = None
    bounce_rate: Optional[float] = None
    cart_abandonment_rate: Optional[float] = None
    purchase_rate: Optional[float] = None
    checkout_rate: Optional[float] = None
    max_funnel_depth: Optional[float] = None
    device_mode: Optional[str] = None
    region: Optional[str] = None


DEFAULT_AGENT1 = {
    "record_id": "590bdbb5-ce99-492c-ab6e-6fdb34915f8f",
    "clean_instruction": (
        "Does this come with everything I need to connect it to an in-dash DVD receiver? "
        "If not, what else do I need to order?"
    ),
    "intent": {
        "predicted": "product_information",
        "confidence": 0.9874,
        "top_k": [
            {"intent": "product_information", "score": 0.9874},
            {"intent": "track_refund", "score": 0.0004},
            {"intent": "submit_product_idea", "score": 0.0004},
        ],
        "primary_model": "SetFit",
        "method": "setfit_sentence_embeddings",
    },
    "sentiment": {
        "label": "neutral",
        "score": 0.9265,
        "method": "roberta-zero-shot",
    },
    "churn_risk": {
        "level": "low",
        "method": "intent-confidence-sentiment-heuristic",
    },
    "ground_truth": {"label_id": 17, "label_name": "product_information"},
}


def _supabase_client():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set")
    return create_client(url, key)


def _load_agent1() -> Agent1WorkflowInput:
    return Agent1WorkflowInput.model_validate(DEFAULT_AGENT1)


def _persona_from_agent1(agent1: Agent1WorkflowInput) -> str:
    intent = agent1.intent.predicted.strip().lower()
    if intent == "product_information":
        return "Warm"
    if intent in {"track_refund", "return_request"}:
        return "Hesitant"
    if intent in {"submit_product_idea", "browse"}:
        return "Cold"
    return "High Intent"


def _fetch_agent2(agent1: Agent1WorkflowInput, agent2_id: Optional[int] = None) -> Agent2WorkflowInput:
    client = _supabase_client()
    target_persona = _persona_from_agent1(agent1)
    target_sentiment = agent1.sentiment.label.strip().title()

    query = client.table("recommendation_log").select(
        "id,user_id,persona,sentiment,confidence,action_type,trigger_cond,created_at"
    )

    if agent2_id is not None:
        response = query.eq("id", agent2_id).limit(1).execute()
        rows = response.data or []
        if rows:
            return Agent2WorkflowInput.model_validate(rows[0])

    response = query.eq("persona", target_persona).eq("sentiment", target_sentiment).order("id", desc=True).limit(1).execute()
    rows = response.data or []
    if rows:
        return Agent2WorkflowInput.model_validate(rows[0])

    response = query.eq("sentiment", target_sentiment).order("id", desc=True).limit(1).execute()
    rows = response.data or []
    if rows:
        return Agent2WorkflowInput.model_validate(rows[0])

    response = query.order("id", desc=True).limit(1).execute()
    rows = response.data or []
    if rows:
        return Agent2WorkflowInput.model_validate(rows[0])

    raise RuntimeError("No recommendation_log rows found in Supabase")


def _fetch_user_features(agent2: Agent2WorkflowInput, agent1: Agent1WorkflowInput) -> Optional[UserFeaturesRow]:
    client = _supabase_client()
    target_persona = agent2.persona or _persona_from_agent1(agent1)

    query = client.table("user_features").select("*")

    response = query.eq("client_id", agent2.user_id).limit(1).execute()
    rows = response.data or []
    if rows:
        return UserFeaturesRow.model_validate(rows[0])

    response = query.eq("persona", target_persona).order("final_score", desc=True).limit(1).execute()
    rows = response.data or []
    if rows:
        return UserFeaturesRow.model_validate(rows[0])

    response = client.table("user_features").select("*").order("final_score", desc=True).limit(1).execute()
    rows = response.data or []
    if rows:
        return UserFeaturesRow.model_validate(rows[0])

    response = client.table("user_features").select("*").limit(1).execute()
    rows = response.data or []
    if rows:
        return UserFeaturesRow.model_validate(rows[0])

    return None


def _build_user_meta(agent1: Agent1WorkflowInput, user_features: Optional[UserFeaturesRow]) -> dict[str, Any]:
    base = {
        "max_funnel_depth": 3,
        "cart_abandonment_rate": 0.15,
        "avg_scroll_depth": 60.0,
        "avg_clicks": 3.5,
        "bounce_rate": 0.22,
        "purchase_rate": 0.0,
        "checkout_rate": 0.0,
        "frequency": 1,
        "monetary": 0.0,
        "recency_days": 2,
        "device_mode": "mobile",
        "preferred_source": "search",
        "intent": agent1.intent.predicted,
        "churn_risk": agent1.churn_risk.level,
    }

    if user_features is not None:
        for key in [
            "max_funnel_depth", "cart_abandonment_rate", "avg_scroll_depth", "avg_clicks",
            "bounce_rate", "purchase_rate", "checkout_rate", "frequency", "monetary",
            "recency_days", "device_mode", "region",
        ]:
            value = getattr(user_features, key, None)
            if value is not None:
                base[key] = value

        for key in ["r_score", "f_score", "m_score", "rfm_score", "behaviour_score", "intent_score", "context_score", "final_score"]:
            value = getattr(user_features, key, None)
            if value is not None:
                base[key] = value

    return base


def run_workflow(agent2_id: Optional[int] = None) -> dict[str, Any]:
    load_dotenv()
    agent1 = _load_agent1()
    agent2 = _fetch_agent2(agent1, agent2_id=agent2_id)
    user_features = _fetch_user_features(agent2, agent1)

    agent3_input = AgentInput(
        user_id=agent1.record_id,
        persona=agent2.persona,
        sentiment=agent2.sentiment,
        confidence=agent2.confidence,
        user_meta=_build_user_meta(agent1, user_features),
    )
    agent3_output = run(agent3_input)

    payload = {
        "agent1": agent1.model_dump(),
        "agent2": agent2.model_dump(),
        "user_features": user_features.model_dump() if user_features else None,
        "agent3_input": {
            "user_id": agent3_input.user_id,
            "persona": agent3_input.persona,
            "sentiment": agent3_input.sentiment,
            "confidence": agent3_input.confidence,
            "user_meta": agent3_input.user_meta,
        },
        "agent3_output": asdict(agent3_output),
    }
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a real Agent 3 workflow test")
    parser.add_argument("--agent2-id", type=int, default=None, help="Optional recommendation_log.id to use as Agent 2")
    args = parser.parse_args()

    result = run_workflow(agent2_id=args.agent2_id)

    print("=== AGENT 1 INPUT ===")
    print(json.dumps(result["agent1"], indent=2, ensure_ascii=False))
    print()

    print("=== AGENT 2 INPUT (FROM SUPABASE) ===")
    print(json.dumps(result["agent2"], indent=2, ensure_ascii=False))
    print()

    print("=== USER FEATURES (FOR RFM) ===")
    print(json.dumps(result["user_features"], indent=2, ensure_ascii=False))
    print()

    print("=== AGENT 3 REQUEST ===")
    print(json.dumps(result["agent3_input"], indent=2, ensure_ascii=False))
    print()

    print("=== AGENT 3 OUTPUT ===")
    print(json.dumps(result["agent3_output"], indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()