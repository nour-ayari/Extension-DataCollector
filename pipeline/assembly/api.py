# api.py — FastAPI layer for Agent 3
# Receives (persona, sentiment) from Agents 1 & 2 via REST
# No product catalogue — behavioral signals only

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional, Dict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from dotenv import load_dotenv
from supabase import create_client

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from recommendation_agent import run, AgentInput
from vector_store import update_outcome

load_dotenv()


def _get_supabase_client():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set")
    return create_client(url, key)


def _fetch_user_features(client_id: str) -> Optional[Dict]:
    """Load a user_features row from Supabase by client_id."""
    client = _get_supabase_client()
    resp = client.table("user_features").select("*").eq("client_id", client_id).limit(1).execute()
    rows = resp.data or []
    return rows[0] if rows else None


def _build_user_meta_from_features(row: Dict) -> Dict:
    """Reduce a user_features row to the fields Agent 3 needs."""
    meta_keys = [
        "age", "gender", "region", "nb_visits", "avg_session_duration",
        "max_funnel_depth", "cart_abandonment_rate", "avg_scroll_depth",
        "avg_clicks", "bounce_rate", "purchase_rate", "checkout_rate",
        "frequency", "monetary", "recency_days", "device_mode", "preferred_source",
    ]
    meta: Dict = {}
    for key in meta_keys:
        value = row.get(key)
        if value is not None:
            meta[key] = value
    return meta

app = FastAPI(
    title="Agent 3 — Recommendation API",
    description="RAG-based recommendation engine. Inputs: persona (Agent 1) + sentiment (Agent 2).",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class RecommendationRequest(BaseModel):
    user_id:    str
    persona:    str   = Field(..., example="High Intent",
                             description="Output of Agent 1: Cold|Warm|High Intent|VIP|Hesitant")
    sentiment:  str   = Field(..., example="Negative",
                             description="Output of Agent 2: Positive|Neutral|Negative")
    confidence: float = Field(..., ge=0.0, le=1.0,
                             description="Agent 2 sentiment confidence score")

    # Optional override. If omitted, the API will look up the user_features row by user_id.
    user_meta: Optional[Dict] = Field(None, example={
        "age": 28, "gender": "F", "region": "Tunis",
        "nb_visits": 5, "max_funnel_depth": 6,
        "cart_abandonment_rate": 0.25, "avg_scroll_depth": 72.4,
        "avg_clicks": 8.3, "bounce_rate": 0.10,
        "purchase_rate": 0.15, "checkout_rate": 0.40,
        "frequency": 4, "monetary": 520.0, "recency_days": 2,
        "device_mode": "mobile", "preferred_source": "social",
    })


class RecommendationResponse(BaseModel):
    user_id:         str
    action_type:     str
    channel:         str
    subject_line:    str
    body_copy:       str
    cta:             str
    trigger_cond:    str
    urgency:         str
    personalization: dict
    rationale:       str
    persona:         str
    sentiment:       str
    confidence:      float
    log_id:          int
    retrieved_k:     int


class FeedbackRequest(BaseModel):
    log_id:    int   = Field(..., description="ID returned by /recommend — links to recommendation_log")
    converted: bool  = Field(..., description="True if user converted after this recommendation")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def root():
    return {"message": "Agent 3 — RAG Recommendation API is running ✓"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/recommend", response_model=RecommendationResponse)
def recommend(req: RecommendationRequest):
    """
    Main endpoint.
    Called by the orchestrator with Agent 1 + Agent 2 outputs.

    Example curl:
        curl -X POST http://localhost:8000/recommend \\
          -H "Content-Type: application/json" \\
          -d '{
            "user_id": "user-abc",
            "persona": "High Intent",
            "sentiment": "Negative",
            "confidence": 0.87,
            "user_meta": {"max_funnel_depth": 6, "bounce_rate": 0.08, "monetary": 320}
          }'
    """
    try:
        user_meta = req.user_meta
        if not user_meta:
            features_row = _fetch_user_features(req.user_id)
            if features_row:
                user_meta = _build_user_meta_from_features(features_row)

        agent_input = AgentInput(
            user_id    = req.user_id,
            persona    = req.persona,
            sentiment  = req.sentiment,
            confidence = req.confidence,
            user_meta  = user_meta,
        )
        result = run(agent_input)
        return result.__dict__

    except KeyError as e:
        # Invalid persona or sentiment value
        raise HTTPException(status_code=422, detail=f"Invalid input: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/user-features/{client_id}")
def user_features(client_id: str):
    """Fetch one user_features row for the dashboard or manual testing."""
    try:
        row = _fetch_user_features(client_id)
        if not row:
            raise HTTPException(status_code=404, detail=f"No user_features row found for {client_id}")
        return row
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/feedback")
def feedback(req: FeedbackRequest):
    """
    Feedback loop endpoint.
    Called by analytics pipeline when conversion outcome is known.
    Updates both recommendation_log and intervention_cases tables.

    Example curl:
        curl -X POST http://localhost:8000/feedback \\
          -H "Content-Type: application/json" \\
          -d '{"log_id": 42, "converted": true}'
    """
    try:
        update_outcome(req.log_id, req.converted)
        return {"status": "updated", "log_id": req.log_id, "converted": req.converted}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/logs")
def logs(limit: int = 50, pending: bool = False):
    """Return recent recommendations for the dashboard."""
    try:
        client = _get_supabase_client()
        query = client.table("recommendation_log").select("*").order("id", desc=True).limit(limit)
        resp = query.execute()
        rows = resp.data or []

        # The current schema stores conversion feedback separately.
        # Keep the dashboard working by exposing a best-effort pending view.
        for row in rows:
            row.setdefault("converted", None)

        if pending:
            rows = [row for row in rows if row.get("converted") is None]

        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))