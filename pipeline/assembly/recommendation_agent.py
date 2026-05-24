"""
recommendation_agent.py — Agent 3 core logic
No product catalogue — works purely from user behavioral signals.
"""

from __future__ import annotations
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

CURRENT_DIR = Path(__file__).resolve().parent
ROOT_DIR = CURRENT_DIR.parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from pipeline.agent3.decision_matrix import lookup, ActionTemplate
from pipeline.agent3.rag_engine import generate_recommendation
from pipeline.agent3.rag_context import from_user_meta
from pipeline.agent3.rag_retrieval import rerank
from pipeline.agent3.vector_store import search_similar_cases, log_recommendation, upsert_case

load_dotenv()
TOP_K = int(os.getenv("TOP_K_RETRIEVAL", 5))


@dataclass
class AgentInput:
    """
    Combined output of Agent 1 (persona) and Agent 2 (sentiment).
    All context comes from behavioral signals — no product catalogue.
    """
    user_id:    str
    persona:    str     # Agent 1: Cold | Warm | High Intent | VIP | Hesitant
    sentiment:  str     # Agent 2: Positive | Neutral | Negative
    confidence: float   # Agent 2 confidence in [0, 1]
    user_meta:  Optional[dict] = None
    # Expected keys (all optional):
    #   age, gender, region, nb_visits, avg_session_duration,
    #   max_funnel_depth, cart_abandonment_rate, avg_scroll_depth,
    #   avg_clicks, bounce_rate, purchase_rate, checkout_rate,
    #   frequency, monetary, recency_days, device_mode, preferred_source


@dataclass
class AgentOutput:
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
    context_narrative: str
    context_compact: str


def _build_behavioral_context(user_meta: Optional[dict]) -> str:
    """
    Converts user_meta dict → compact string for embedding.
    Replaces product catalogue as RAG context signal.
    Example: "funnel:6|scroll:78|bounce:0.12|freq:4|monetary:320"
    """
    if not user_meta:
        return ""
    keys = [
        ("max_funnel_depth",      "funnel"),
        ("avg_scroll_depth",      "scroll"),
        ("bounce_rate",           "bounce"),
        ("frequency",             "freq"),
        ("monetary",              "monetary"),
        ("checkout_rate",         "checkout"),
        ("cart_abandonment_rate", "abandon"),
        ("purchase_rate",         "purchase"),
        ("avg_clicks",            "clicks"),
        ("nb_visits",             "visits"),
        ("device_mode",           "device"),
    ]
    parts = []
    for meta_key, label in keys:
        val = user_meta.get(meta_key)
        if val is not None:
            parts.append(f"{label}:{val:.2f}" if isinstance(val, float) else f"{label}:{val}")
    return "|".join(parts)


def run(inp: AgentInput) -> AgentOutput:
    """
    Full Agent 3 pipeline:
        1. Decision matrix lookup  → a*
        2. Build behavioral context string
        3. pgvector retrieval      → Ru
        4. LLM generation          → r̂u
        5. Log + upsert to vector store
    """
    action_template: ActionTemplate = lookup(inp.persona, inp.sentiment)
    user_context = from_user_meta(inp.user_meta, persona=inp.persona, sentiment=inp.sentiment, confidence=inp.confidence)
    context_narrative = user_context.render_narrative()
    context_compact = user_context.render_compact()

    retrieved_candidates = search_similar_cases(
        persona            = inp.persona,
        sentiment          = inp.sentiment,
        behavioral_context = user_context,
        top_k              = TOP_K + 3,
        only_converted     = False,
        filter_persona     = True,
    )

    retrieved_cases = rerank(
        retrieved_candidates,
        top_k=TOP_K,
        churn_risk=user_context.churn_risk,
    )

    raw: dict = generate_recommendation(
        persona            = inp.persona,
        sentiment          = inp.sentiment,
        confidence         = inp.confidence,
        action_template    = action_template,
        retrieved_cases    = retrieved_cases,
        behavioral_context = user_context,
        user_meta          = inp.user_meta,
        user_context       = user_context,
    )

    log_id = log_recommendation(
        user_id      = inp.user_id,
        persona      = inp.persona,
        sentiment    = inp.sentiment,
        confidence   = inp.confidence,
        action_type  = raw.get("action_type", action_template.action_type),
        action_detail= raw,
        trigger_cond = raw.get("trigger_cond", action_template.trigger_cond),
    )

    upsert_case(
        persona            = inp.persona,
        sentiment          = inp.sentiment,
        confidence         = inp.confidence,
        action_type        = raw.get("action_type", action_template.action_type),
        action_detail      = raw.get("subject_line", ""),
        behavioral_context = user_context,
        converted          = False,
    )

    return AgentOutput(
        user_id         = inp.user_id,
        action_type     = raw.get("action_type",    action_template.action_type),
        channel         = raw.get("channel",         action_template.channel),
        subject_line    = raw.get("subject_line",    ""),
        body_copy       = raw.get("body_copy",       ""),
        cta             = raw.get("cta",             ""),
        trigger_cond    = raw.get("trigger_cond",    action_template.trigger_cond),
        urgency         = raw.get("urgency",         action_template.urgency),
        personalization = raw.get("personalization", {}),
        rationale       = raw.get("rationale",       ""),
        persona         = inp.persona,
        sentiment       = inp.sentiment,
        confidence      = inp.confidence,
        log_id          = log_id,
        retrieved_k     = len(retrieved_cases),
        context_narrative = context_narrative,
        context_compact   = context_compact,
    )


if __name__ == "__main__":
    from unittest.mock import patch
    mock_cases = [
        {"persona": "High Intent", "sentiment": "Negative", "action_type": "exit_overlay",
         "action_detail": "Get 10% off", "converted": True, "similarity": 0.92},
    ]
    mock_rec = {
        "action_type": "exit_overlay", "channel": "overlay",
        "subject_line": "Still thinking? Get 10% off — today only.",
        "body_copy": "You almost checked out. Use CODE10 and complete your order now.",
        "cta": "Claim My Discount", "trigger_cond": "cursor_leave_viewport",
        "urgency": "critical", "personalization": {"discount_pct": 10},
        "rationale": "High-intent frustrated user: exit overlay converts best.",
        "persona": "High Intent", "sentiment": "Negative", "confidence": 0.87,
    }
    with patch("recommendation_agent.search_similar_cases", return_value=mock_cases), \
         patch("recommendation_agent.generate_recommendation", return_value=mock_rec), \
         patch("recommendation_agent.log_recommendation", return_value=42), \
         patch("recommendation_agent.upsert_case", return_value={}):
        result = run(AgentInput(
            user_id="user-001", persona="High Intent", sentiment="Negative", confidence=0.87,
            user_meta={"nb_visits": 4, "max_funnel_depth": 6, "cart_abandonment_rate": 0.2,
                       "avg_scroll_depth": 78.5, "bounce_rate": 0.08, "monetary": 320, "frequency": 4},
        ))
    print("\n=== Agent 3 Output ===")
    for k, v in result.__dict__.items():
        print(f"  {k:22s}: {v}")