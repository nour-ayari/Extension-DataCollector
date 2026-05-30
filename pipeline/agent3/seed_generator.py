"""Synthetic intervention seed generator for Agent 3.

Populates intervention_cases with action-aware, outcome-aware cases that cover
all persona × sentiment combinations with friction, churn, and intent variety.
"""

from __future__ import annotations

import os
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.agent3.decision_matrix import MATRIX
from pipeline.agent3.rag_context import UserContext
from pipeline.agent3.vector_store import upsert_case


random.seed(42)

FRICTION_PRESETS = [
    {
        "name": "payment_friction",
        "max_funnel_depth": 6,
        "cart_abandonment_rate": 0.55,
        "avg_scroll_depth": 78,
        "avg_clicks": 8,
        "bounce_rate": 0.18,
        "avg_session_duration": 360,
        "intent": "complaint",
        "churn_risk": "high",
    },
    {
        "name": "cart_review_friction",
        "max_funnel_depth": 5,
        "cart_abandonment_rate": 0.65,
        "avg_scroll_depth": 62,
        "avg_clicks": 6,
        "bounce_rate": 0.22,
        "avg_session_duration": 240,
        "intent": "shipping_inquiry",
        "churn_risk": "medium",
    },
    {
        "name": "ux_load_friction",
        "max_funnel_depth": 1,
        "cart_abandonment_rate": 0.0,
        "avg_scroll_depth": 24,
        "avg_clicks": 2,
        "bounce_rate": 0.72,
        "avg_session_duration": 35,
        "intent": "other",
        "churn_risk": "high",
    },
    {
        "name": "navigation_friction",
        "max_funnel_depth": 3,
        "cart_abandonment_rate": 0.15,
        "avg_scroll_depth": 32,
        "avg_clicks": 13,
        "bounce_rate": 0.28,
        "avg_session_duration": 150,
        "intent": "product_information",
        "churn_risk": "medium",
    },
    {
        "name": "lapsing",
        "max_funnel_depth": 3,
        "cart_abandonment_rate": 0.10,
        "avg_scroll_depth": 45,
        "avg_clicks": 4,
        "bounce_rate": 0.30,
        "avg_session_duration": 210,
        "intent": "praise",
        "churn_risk": "low",
    },
    {
        "name": "dissatisfaction",
        "max_funnel_depth": 4,
        "cart_abandonment_rate": 0.45,
        "avg_scroll_depth": 58,
        "avg_clicks": 7,
        "bounce_rate": 0.40,
        "avg_session_duration": 180,
        "intent": "return_request",
        "churn_risk": "high",
    },
]

ACTION_DETAILS = {
    "review_ask": "Quick review request: tell us what you think in 30 seconds.",
    "welcome_offer": "Welcome offer: enjoy free shipping on your first order.",
    "chatbot_fix": "We noticed an issue. Open chat for help right now.",
    "price_nudge": "Small nudge: bundle savings available if you complete checkout.",
    "nurture_email": "Helpful follow-up with social proof and product highlights.",
    "apology_offer": "Sorry about the experience. Here is a recovery offer.",
    "upsell": "Premium upgrade suggestion with value-based framing.",
    "scarcity_push": "Inventory is limited. Complete your order now.",
    "exit_overlay": "Exit offer: your cart is saved and a discount is waiting.",
    "referral": "Referral invite for a loyal customer.",
    "early_access": "Exclusive early access to the next drop.",
    "human_call": "Priority follow-up from a senior support agent.",
    "chatbot_guide": "Guided comparison help through the chatbot.",
    "trust_signals": "Trust reinforcement: reviews, guarantees, and security badges.",
    "survey": "One-minute feedback survey to identify the blocker.",
}


def _band_scores(preset_index: int) -> tuple[float, float, float, float]:
    tier = preset_index % 3
    if tier == 0:
        return 5.0, 5.0, 5.0, 88.0
    if tier == 1:
        return 3.0, 3.0, 3.0, 55.0
    return 1.0, 1.0, 1.0, 24.0


def _build_context(persona: str, sentiment: str, confidence: float, preset: dict, variant: int, rfm_scores: tuple[float, float, float, float]) -> UserContext:
    r_score, f_score, m_score, rfm_score = rfm_scores
    return UserContext(
        max_funnel_depth=preset["max_funnel_depth"],
        cart_abandonment_rate=preset["cart_abandonment_rate"],
        avg_scroll_depth=preset["avg_scroll_depth"],
        avg_clicks=preset["avg_clicks"],
        bounce_rate=preset["bounce_rate"],
        avg_session_duration=preset["avg_session_duration"],
        recency_days=1 + variant * 3,
        frequency=2 + variant,
        monetary=60 + variant * 120,
        preferred_hour=18 + (variant % 3),
        preferred_source=random.choice(["organic", "paid", "email", "social"]),
        device_mode=random.choice(["mobile", "desktop"]),
        is_weekend=variant % 2 == 0,
        sentiment=sentiment,
        confidence=confidence,
        intent=preset["intent"],
        churn_risk=preset["churn_risk"],
        nb_visits=3 + variant,
        persona=persona,
        r_score=r_score,
        f_score=f_score,
        m_score=m_score,
        rfm_score=rfm_score,
    )


def _converted_bias(persona: str, sentiment: str, action_type: str, preset: dict, confidence: float) -> bool:
    if action_type == "exit_overlay" and persona == "High Intent" and sentiment == "Negative" and preset["name"] == "payment_friction":
        return True if confidence >= 0.8 else random.random() < 0.85
    if action_type == "human_call" and persona == "VIP" and sentiment == "Negative" and preset["churn_risk"] == "high":
        return True if confidence >= 0.8 else random.random() < 0.9
    if action_type == "welcome_offer" and persona == "Cold" and sentiment == "Neutral":
        return random.random() < 0.65
    if action_type == "apology_offer" and persona == "Warm" and sentiment == "Negative":
        return True if random.random() < 0.8 else False
    if action_type == "survey" and persona == "Hesitant" and sentiment == "Negative" and preset["intent"] == "complaint":
        return False
    if action_type == "nurture_email" and persona == "Warm" and sentiment == "Neutral":
        return random.random() < 0.6
    return random.random() < {"high": 0.8, "medium": 0.5, "low": 0.25}[preset["churn_risk"]]


def _action_detail(action_type: str, persona: str, sentiment: str, preset: dict, variant: int) -> str:
    base = ACTION_DETAILS.get(action_type, "Behavior-based intervention suggestion.")
    return f"{base} ({persona} / {sentiment} / {preset['name']} / variant {variant + 1})"


def _cases_for_combo(persona: str, sentiment: str) -> list[tuple[str, dict]]:
    action_type = MATRIX[persona][sentiment].action_type
    return [(action_type, FRICTION_PRESETS[i % len(FRICTION_PRESETS)]) for i in range(5)]


def main() -> None:
    total = 0
    for persona, sentiment_map in MATRIX.items():
        for sentiment in sentiment_map.keys():
            combos = _cases_for_combo(persona, sentiment)
            for variant, (action_type, preset) in enumerate(combos):
                confidence = round(0.62 + 0.06 * variant + (0.10 if preset["churn_risk"] == "high" else 0.0), 2)
                rfm_scores = _band_scores(variant)
                ctx = _build_context(persona, sentiment, confidence, preset, variant, rfm_scores)
                converted = _converted_bias(persona, sentiment, action_type, preset, confidence)
                detail = _action_detail(action_type, persona, sentiment, preset, variant)
                upsert_case(
                    persona=persona,
                    sentiment=sentiment,
                    confidence=confidence,
                    action_type=action_type,
                    action_detail=detail,
                    behavioral_context=ctx,
                    converted=converted,
                    source_type="synthetic_generated",
                    parent_session_id=None,
                    source_session_id=None,
                )
                total += 1
                print(f"[{total:03d}] {persona:15s} x {sentiment:10s} -> {action_type:15s} | {preset['name']:18s} | converted={converted}")

    print(f"\nSeeded {total} intervention cases.")


if __name__ == "__main__":
    main()