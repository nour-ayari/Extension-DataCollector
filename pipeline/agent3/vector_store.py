"""
vector_store.py — pgvector interface via Supabase
Handles: embedding generation, case upsert, similarity search
"""

from __future__ import annotations

import json
import os
from typing import Optional

import numpy as np
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from supabase import Client, create_client

from pipeline.agent3.rag_context import UserContext

load_dotenv()

# ---------------------------------------------------------------------------
# Singleton embedding model (loaded once, reused across requests)
# ---------------------------------------------------------------------------

_model: Optional[SentenceTransformer] = None


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        model_name = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
        _model = SentenceTransformer(model_name)
    return _model


def embed(text: str) -> list[float]:
    """Encode a text string → 384-dim float list."""
    model = _get_model()
    vec = model.encode(text, normalize_embeddings=True)
    return vec.tolist()


# ---------------------------------------------------------------------------
# Supabase client
# ---------------------------------------------------------------------------

def _get_client() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_KEY"]
    return create_client(url, key)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_case_text(
    persona: str,
    sentiment: str,
    action_type: str = "",
    context: str | UserContext = "",
    converted: Optional[bool] = None,
) -> str:
    """
    Canonical text representation of an intervention case.
    This is what gets embedded — consistent across insert and query.
    No product catalogue: context can be a behavioral summary string or a structured UserContext.
    """
    if isinstance(context, UserContext):
        context = context.render_with_action(action_type, converted) if action_type else context.render_narrative()
    return f"persona:{persona} sentiment:{sentiment} action:{action_type} context:{context}"


def upsert_case(
    persona: str,
    sentiment: str,
    confidence: float,
    action_type: str,
    action_detail: str,
    behavioral_context: str | UserContext = "",   # replaces products
    converted: bool = False,
) -> dict:
    """
    Insert a new intervention case into the vector store.
    Call this after every recommendation to build the knowledge base.
    behavioral_context is a compact string of key user metrics (no product catalogue needed).
    """
    client = _get_client()
    text = build_case_text(persona, sentiment, action_type, behavioral_context, converted=converted)
    context_text = behavioral_context.render_compact() if isinstance(behavioral_context, UserContext) else behavioral_context
    embedding = embed(text)

    row = {
        "persona":      persona,
        "sentiment":    sentiment,
        "confidence":   confidence,
        "action_type":  action_type,
        "action_detail": action_detail,
        "context":      context_text,
        "converted":    converted,
        "embedding":    embedding,
    }

    result = client.table("intervention_cases").insert(row).execute()
    return result.data[0] if result.data else {}


def update_outcome(log_id: int, converted: bool) -> None:
    """
    Feedback loop: mark a recommendation as converted (or not).
    Updates BOTH tables:
      - recommendation_log  (by log_id, primary key)
      - intervention_cases  (by matching log_id stored in action_detail->>'log_id')
    Called by the /feedback endpoint after analytics observes user behavior.
    """
    client = _get_client()

    # 1. Update the recommendation log
    client.table("recommendation_log") \
        .update({"converted": converted}) \
        .eq("id", log_id) \
        .execute()

    # 2. Fetch action_detail to find the matching intervention_cases row
    log_row = client.table("recommendation_log") \
        .select("persona, sentiment, action_type") \
        .eq("id", log_id) \
        .maybe_single() \
        .execute()

    if log_row.data:
        d = log_row.data
        # Update intervention_cases rows that match this recommendation's signature
        # (We match on persona+sentiment+action_type since we don't store a FK directly)
        client.table("intervention_cases") \
            .update({"converted": converted}) \
            .eq("persona",      d["persona"]) \
            .eq("sentiment",    d["sentiment"]) \
            .eq("action_type",  d["action_type"]) \
            .eq("converted",    False) \
            .limit(1) \
            .execute()


def search_similar_cases(
    persona: str,
    sentiment: str,
    behavioral_context: str | UserContext = "",
    top_k: int = 5,
    only_converted: bool = False,
    filter_persona: bool = True,
) -> list[dict]:
    """
    Retrieve the top-k most similar past intervention cases using cosine similarity.
    Uses the SQL function `match_interventions` defined in supabase_setup.sql.
    """
    client = _get_client()

    # Build query text — same format as insert (action unknown at query time)
    query_text = build_case_text(persona, sentiment, context=behavioral_context)
    query_embedding = embed(query_text)

    params = {
        "query_embedding": query_embedding,
        "match_count": top_k,
        "filter_persona": persona if filter_persona else None,
        "only_converted": only_converted,
    }

    result = client.rpc("match_interventions", params).execute()
    return result.data or []


def log_recommendation(
    user_id: str,
    persona: str,
    sentiment: str,
    confidence: float,
    action_type: str,
    action_detail: dict,
    trigger_cond: str,
) -> int:
    """
    Persist every generated recommendation for audit + feedback loop.
    Returns the log row ID (used later to update conversion outcome).
    """
    client = _get_client()
    row = {
        "user_id": user_id,
        "persona": persona,
        "sentiment": sentiment,
        "confidence": confidence,
        "action_type": action_type,
        "action_detail": action_detail,
        "trigger_cond": trigger_cond,
    }
    result = client.table("recommendation_log").insert(row).execute()
    return result.data[0]["id"] if result.data else -1