"""
decision_matrix.py — Rule-based prior for Agent 3
Maps (persona, sentiment) → action template

This is the symbolic layer of the hybrid intelligence system:
    statistical ML (clustering, LSTM) →  pu, σu
    symbolic rule (this file)         →  a*
    generative AI (LLM + RAG)         →  r̂u
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

# ---------------------------------------------------------------------------
# Type aliases (matches Agent 1 & 2 outputs exactly)
# ---------------------------------------------------------------------------

Persona   = Literal["Cold", "Warm", "High Intent", "VIP", "Hesitant"]
Sentiment = Literal["Positive", "Neutral", "Negative"]

ActionType = Literal[
    "review_ask",
    "welcome_offer",
    "chatbot_fix",
    "price_nudge",
    "nurture_email",
    "apology_offer",
    "upsell",
    "scarcity_push",
    "exit_overlay",
    "referral",
    "early_access",
    "human_call",
    "chatbot_guide",
    "trust_signals",
    "survey",
]


# ---------------------------------------------------------------------------
# Action template dataclass
# ---------------------------------------------------------------------------

@dataclass
class ActionTemplate:
    action_type:   ActionType
    channel:       str          # email / overlay / chatbot / alert / sms
    urgency:       str          # low / medium / high / critical
    description:   str          # human-readable intent
    trigger_cond:  str          # when to fire this action


# ---------------------------------------------------------------------------
# Decision matrix  M ∈ Persona × Sentiment → ActionTemplate
# Exactly mirrors the table in the PDF specification
# ---------------------------------------------------------------------------

MATRIX: dict[Persona, dict[Sentiment, ActionTemplate]] = {

    "Cold": {
        "Positive":  ActionTemplate(
            action_type  = "review_ask",
            channel      = "email",
            urgency      = "low",
            description  = "User browsed positively but hasn't bought — ask for a review or opinion",
            trigger_cond = "session_end AND no purchase AND positive_sentiment",
        ),
        "Neutral":   ActionTemplate(
            action_type  = "welcome_offer",
            channel      = "email",
            urgency      = "low",
            description  = "First-time or cold visitor — send welcome discount to warm up",
            trigger_cond = "2nd_visit OR nb_visits <= 2",
        ),
        "Negative":  ActionTemplate(
            action_type  = "chatbot_fix",
            channel      = "chatbot",
            urgency      = "medium",
            description  = "Cold user is frustrated — proactively open chatbot with fix offer",
            trigger_cond = "negative_message AND no_purchase",
        ),
    },

    "Warm": {
        "Positive":  ActionTemplate(
            action_type  = "price_nudge",
            channel      = "overlay",
            urgency      = "medium",
            description  = "Engaged warm user — small price nudge or bundle to push to purchase",
            trigger_cond = "viewed_3+_products AND cart_empty",
        ),
        "Neutral":   ActionTemplate(
            action_type  = "nurture_email",
            channel      = "email",
            urgency      = "low",
            description  = "Warm but undecided — nurture sequence with social proof & product highlights",
            trigger_cond = "24h_since_last_visit",
        ),
        "Negative":  ActionTemplate(
            action_type  = "apology_offer",
            channel      = "email",
            urgency      = "high",
            description  = "Warm user with bad experience — apologise and offer exclusive discount",
            trigger_cond = "complaint_detected AND previous_purchase",
        ),
    },

    "High Intent": {
        "Positive":  ActionTemplate(
            action_type  = "upsell",
            channel      = "overlay",
            urgency      = "high",
            description  = "High-intent user in good mood — upsell to premium version or add-on",
            trigger_cond = "checkout_started AND positive_sentiment",
        ),
        "Neutral":   ActionTemplate(
            action_type  = "scarcity_push",
            channel      = "overlay",
            urgency      = "high",
            description  = "High-intent but hesitating — create urgency with stock/time scarcity",
            trigger_cond = "checkout_started AND session_duration > 5min",
        ),
        "Negative":  ActionTemplate(
            action_type  = "exit_overlay",
            channel      = "overlay",
            urgency      = "critical",
            description  = "High-intent frustrated user about to leave — exit-intent with strong discount",
            trigger_cond = "cursor_leave_viewport AND checkout_abandon_risk",
        ),
    },

    "VIP": {
        "Positive":  ActionTemplate(
            action_type  = "referral",
            channel      = "email",
            urgency      = "low",
            description  = "Happy VIP — invite to referral program for mutual benefit",
            trigger_cond = "post_purchase AND high_ltv",
        ),
        "Neutral":   ActionTemplate(
            action_type  = "early_access",
            channel      = "email",
            urgency      = "medium",
            description  = "VIP with neutral sentiment — reward with exclusive early access",
            trigger_cond = "new_product_launch OR seasonal_campaign",
        ),
        "Negative":  ActionTemplate(
            action_type  = "human_call",
            channel      = "alert",   # admin dashboard alert → human follows up
            urgency      = "critical",
            description  = "VIP is upset — escalate immediately to human support agent",
            trigger_cond = "negative_confidence > 0.80 AND ltv > threshold",
        ),
    },

    "Hesitant": {
        "Positive":  ActionTemplate(
            action_type  = "chatbot_guide",
            channel      = "chatbot",
            urgency      = "medium",
            description  = "Hesitant but open — guide through product comparison via chatbot",
            trigger_cond = "3+_product_views AND no_add_to_cart",
        ),
        "Neutral":   ActionTemplate(
            action_type  = "trust_signals",
            channel      = "overlay",
            urgency      = "medium",
            description  = "Hesitant & neutral — surface reviews, guarantees, and security badges",
            trigger_cond = "viewed_cart AND session_duration > 3min",
        ),
        "Negative":  ActionTemplate(
            action_type  = "survey",
            channel      = "email",
            urgency      = "low",
            description  = "Hesitant & frustrated — send short survey to understand blocker",
            trigger_cond = "abandoned_session AND negative_message",
        ),
    },
}


def lookup(persona: str, sentiment: str) -> ActionTemplate:
    """
    M[persona][sentiment] → ActionTemplate
    Raises KeyError with a clear message if inputs are invalid.
    """
    # Case-insensitive: handles "VIP", "vip", "high intent", "High Intent"
    persona_map   = {k.lower(): k for k in MATRIX}
    sentiment_map = {s.lower(): s for s in next(iter(MATRIX.values()))}

    persona_key   = persona_map.get(persona.strip().lower())
    sentiment_key = sentiment_map.get(sentiment.strip().lower())

    if persona_key is None:
        raise KeyError(f"Unknown persona '{persona}'. Valid: {list(MATRIX.keys())}")

    row = MATRIX[persona_key]
    if sentiment_key is None or sentiment_key not in row:
        raise KeyError(f"Unknown sentiment '{sentiment}'. Valid: {list(row.keys())}")

    return row[sentiment_key]


# ---------------------------------------------------------------------------
# Quick CLI test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    tests = [
        ("High Intent", "Negative"),
        ("VIP",         "Positive"),
        ("Cold",        "Neutral"),
        ("Hesitant",    "Positive"),
    ]
    for p, s in tests:
        t = lookup(p, s)
        print(f"{p:15s} × {s:10s} → [{t.action_type:18s}] via {t.channel} ({t.urgency})")