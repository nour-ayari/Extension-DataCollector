"""Retrieval utilities for Agent 3.

Applies similarity filtering, outcome-aware reranking, churn amplification,
and a light diversity pass to avoid action-type collapse in prompts.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional


MIN_SIMILARITY = float(os.getenv("RAG_MIN_SIMILARITY", 0.65))


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
        item = dict(case)
        item["outcome_weight"] = outcome_weight
        item["recency_weight"] = recency_weight
        item["rerank_score"] = similarity * outcome_weight * recency_weight
        scored.append(item)

    scored.sort(key=lambda row: row.get("rerank_score", 0.0), reverse=True)
    top = scored[: max(top_k, 0)]

    if len(top) > 1:
        action_types = {row.get("action_type") for row in top}
        if len(action_types) == 1:
            replacement_pool = [row for row in scored[top_k:] if row.get("action_type") not in action_types]
            if replacement_pool:
                replacement = replacement_pool[0]
                replacement["diversity_injected"] = True
                top[-1] = replacement
                top.sort(key=lambda row: row.get("rerank_score", 0.0), reverse=True)

    return top


def format_for_prompt(cases: list[dict]) -> str:
    if not cases:
        return "No similar past cases — generate a fresh recommendation."

    blocks = []
    for idx, case in enumerate(cases, 1):
        outcome = "converted" if case.get("converted") else "no_conversion"
        diversity = " | diversity_injected" if case.get("diversity_injected") else ""
        blocks.append(
            f"Case {idx} (score={case.get('rerank_score', 0.0):.2f}, sim={case.get('similarity', 0.0):.2f}, {outcome}{diversity}): "
            f"persona={case.get('persona')}, sentiment={case.get('sentiment')}, "
            f"action={case.get('action_type')} - \"{case.get('action_detail', '')}\" | ctx: {case.get('context', '')}"
        )
    return "\n".join(blocks)