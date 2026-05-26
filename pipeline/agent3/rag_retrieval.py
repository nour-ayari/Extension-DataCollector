"""Retrieval utilities for Agent 3.

Applies similarity filtering, outcome-aware reranking, churn amplification,
and a light diversity pass to avoid action-type collapse in prompts.
"""

from __future__ import annotations

import os
from collections import Counter
from datetime import datetime, timezone
from typing import Optional


MIN_SIMILARITY = float(os.getenv("RAG_MIN_SIMILARITY", 0.65))
SOURCE_WEIGHTS = {
    "real": float(os.getenv("RAG_SOURCE_WEIGHT_REAL", 1.0)),
    "synthetic_clone": float(os.getenv("RAG_SOURCE_WEIGHT_SYNTHETIC_CLONE", 0.92)),
    "synthetic_generated": float(os.getenv("RAG_SOURCE_WEIGHT_SYNTHETIC_GENERATED", 0.85)),
}
MAX_SAME_ACTION = int(os.getenv("RAG_MAX_SAME_ACTION", 2))
MAX_SAME_PERSONA = int(os.getenv("RAG_MAX_SAME_PERSONA", 2))
MAX_SAME_SENTIMENT = int(os.getenv("RAG_MAX_SAME_SENTIMENT", 2))
SYNTHETIC_DOMINANCE_THRESHOLD = float(os.getenv("RAG_SYNTHETIC_DOMINANCE_THRESHOLD", 0.8))
SYNTHETIC_DOMINANCE_PENALTY = float(os.getenv("RAG_SYNTHETIC_DOMINANCE_PENALTY", 0.95))


def _parse_created_at(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _recency_weight(created_at) -> float:
    parsed = _parse_created_at(created_at)
    if parsed is None:
        return 1.0
    now = datetime.now(timezone.utc)
    age_days = max(0.0, (now - parsed).total_seconds() / 86400.0)
    decay = min(age_days, 30.0) / 30.0
    return 1.0 - (0.15 * decay)


def _outcome_weight(converted, churn_risk: Optional[str] = None) -> float:
    if converted is True:
        base = 1.3
        if (churn_risk or "").lower() == "high":
            base += 0.1
        return base
    if converted is False:
        return 0.7
    return 1.0


def _source_weight(source_type: Optional[str]) -> float:
    return SOURCE_WEIGHTS.get((source_type or "real").strip().lower(), SOURCE_WEIGHTS["real"])


def _select_diverse_candidates(scored: list[dict], top_k: int) -> list[dict]:
    selected: list[dict] = []
    skipped: list[dict] = []
    action_counts: Counter[str] = Counter()
    persona_counts: Counter[str] = Counter()
    sentiment_counts: Counter[str] = Counter()

    def _can_add(case: dict) -> bool:
        action = case.get("action_type") or ""
        persona = case.get("persona") or ""
        sentiment = case.get("sentiment") or ""
        return (
            action_counts[action] < MAX_SAME_ACTION
            and persona_counts[persona] < MAX_SAME_PERSONA
            and sentiment_counts[sentiment] < MAX_SAME_SENTIMENT
        )

    for case in scored:
        if len(selected) >= top_k:
            break
        if _can_add(case):
            selected.append(case)
            action_counts[case.get("action_type") or ""] += 1
            persona_counts[case.get("persona") or ""] += 1
            sentiment_counts[case.get("sentiment") or ""] += 1
        else:
            skipped.append(case)

    if len(selected) < top_k:
        for case in skipped:
            if len(selected) >= top_k:
                break
            selected.append(case)

    return selected


def rerank(
    cases: list[dict],
    top_k: int,
    churn_risk: Optional[str] = None,
    min_similarity: Optional[float] = None,
) -> list[dict]:
    threshold = MIN_SIMILARITY if min_similarity is None else min_similarity
    eligible = [c for c in cases if float(c.get("similarity", 0.0) or 0.0) >= threshold]

    scored = []
    for case in eligible:
        similarity = float(case.get("similarity", 0.0) or 0.0)
        outcome_weight = _outcome_weight(case.get("converted"), churn_risk=churn_risk)
        recency_weight = _recency_weight(case.get("created_at"))
        source_type = (case.get("source_type") or "real").strip().lower()
        source_weight = _source_weight(source_type)
        item = dict(case)
        item.setdefault("source_type", source_type)
        item.setdefault("parent_session_id", case.get("parent_session_id"))
        item.setdefault("source_session_id", case.get("source_session_id"))
        item["outcome_weight"] = outcome_weight
        item["recency_weight"] = recency_weight
        item["source_weight"] = source_weight
        item["rerank_score"] = similarity * outcome_weight * recency_weight * source_weight
        scored.append(item)

    scored.sort(key=lambda row: row.get("rerank_score", 0.0), reverse=True)
    selected = _select_diverse_candidates(scored, max(top_k, 0))

    if selected:
        synthetic_selected = sum(1 for row in selected if (row.get("source_type") or "real") != "real")
        selected_ratio = synthetic_selected / max(len(selected), 1)
        if selected_ratio > SYNTHETIC_DOMINANCE_THRESHOLD:
            for row in selected:
                if (row.get("source_type") or "real") != "real":
                    row["rerank_score"] *= SYNTHETIC_DOMINANCE_PENALTY
            selected.sort(key=lambda row: row.get("rerank_score", 0.0), reverse=True)

    return selected


def format_for_prompt(cases: list[dict]) -> str:
    if not cases:
        return "No similar past cases — generate a fresh recommendation."

    blocks = []
    for idx, case in enumerate(cases, 1):
        outcome = "converted" if case.get("converted") else "no_conversion"
        diversity = " | diversity_injected" if case.get("diversity_injected") else ""
        blocks.append(
            f"Case {idx} (score={case.get('rerank_score', 0.0):.2f}, sim={case.get('similarity', 0.0):.2f}, {outcome}{diversity}): "
            f"persona={case.get('persona')}, sentiment={case.get('sentiment')}, source={case.get('source_type', 'real')}, "
            f"action={case.get('action_type')} - \"{case.get('action_detail', '')}\" | ctx: {case.get('context', '')}"
        )
    return "\n".join(blocks)