"""
rag_context.py — Rich structured context for Agent 3 RAG.

Keeps embedding text semantic and score-free while preserving compact audit
tokens for storage / debugging.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


FUNNEL_LABELS = {
    0: "just started browsing",
    1: "viewing pages",
    2: "exploring products",
    3: "viewing specific items",
    4: "added to cart",
    5: "viewing cart",
    6: "reached checkout",
    7: "completed a purchase",
}

RECENCY_SCORE_LABELS = {
    5: "very recent",
    4: "recent",
    3: "moderate",
    2: "lapsing",
    1: "lapsed",
}

FREQUENCY_SCORE_LABELS = {
    5: "very frequent",
    4: "frequent",
    3: "occasional",
    2: "rare",
    1: "one-time",
}

MONETARY_SCORE_LABELS = {
    5: "top spender",
    4: "high spender",
    3: "mid spender",
    2: "low spender",
    1: "no spend",
}


def _rfm_label(
    recency_days: Optional[float],
    frequency: Optional[float],
    monetary: Optional[float],
) -> str:
    r = recency_days or 999
    f = frequency or 0
    m = monetary or 0
    if r <= 3 and f >= 8 and m >= 500:
        return "high-value loyal buyer"
    if r <= 7 and f >= 4 and m >= 100:
        return "active regular spender"
    if r <= 14 and f >= 2:
        return "recent returning visitor"
    if r > 30:
        return "lapsed user"
    if m == 0:
        return "non-buyer so far"
    return "occasional buyer"


def _rfm_tier(rfm_score: Optional[float]) -> str:
    if rfm_score is None:
        return "unknown RFM tier"
    if rfm_score >= 70:
        return "top RFM tier"
    if rfm_score >= 40:
        return "mid RFM tier"
    return "low RFM tier"


def _score_label(value: Optional[float], labels: dict[int, str], default: str) -> str:
    if value is None:
        return default
    try:
        key = int(round(float(value)))
    except Exception:
        return default
    return labels.get(key, default)


def _funnel_stage(depth: Optional[int]) -> str:
    if depth is None:
        return "browsing"
    if depth >= 7:
        return "completed_purchase"
    if depth >= 6:
        return "reached_checkout"
    if depth >= 5:
        return "viewing_cart"
    if depth >= 4:
        return "cart_addition"
    if depth >= 3:
        return "product_consideration"
    if depth >= 2:
        return "discovery"
    return "early_browse"


def _engagement_band(scroll: Optional[float], clicks: Optional[float], bounce: Optional[float], session_duration: Optional[float]) -> str:
    score = 0
    if scroll is not None and scroll >= 70:
        score += 1
    if clicks is not None and clicks >= 6:
        score += 1
    if bounce is not None and bounce <= 0.35:
        score += 1
    if session_duration is not None and session_duration >= 180:
        score += 1
    if score >= 3:
        return "high"
    if score >= 2:
        return "medium"
    return "low"


def _bounce_band(bounce: Optional[float]) -> str:
    if bounce is None:
        return "unknown"
    return "low" if bounce <= 0.4 else "high"


def _friction_token(phrase: str) -> str:
    mapping = {
        "likely friction at payment or pricing step": "payment_friction",
        "hesitation at cart review stage": "cart_review_friction",
        "immediate disengagement, possible ux or load issue": "ux_load_friction",
        "high click activity but low scroll - possible navigation confusion": "navigation_friction",
        "previously active user now lapsing": "lapsing",
        "active dissatisfaction signal - retention at risk": "dissatisfaction",
        "no dominant friction pattern detected": "none",
    }
    return mapping.get(phrase.lower(), phrase.lower().replace(" ", "_").replace(",", ""))


def _temporal_label(
    preferred_hour: Optional[float],
    recency_days: Optional[float],
    is_weekend: Optional[bool],
) -> str:
    parts = []
    if preferred_hour is not None:
        h = int(preferred_hour)
        if 6 <= h < 12:
            parts.append("morning browser")
        elif 12 <= h < 17:
            parts.append("afternoon browser")
        elif 17 <= h < 22:
            parts.append("evening browser")
        else:
            parts.append("late-night browser")
    if recency_days is not None:
        r = int(recency_days)
        if r == 0:
            parts.append("active today")
        elif r == 1:
            parts.append("visited yesterday")
        elif r <= 7:
            parts.append(f"last seen {r} days ago")
        else:
            parts.append(f"inactive for {r} days")
    if is_weekend:
        parts.append("weekend shopper")
    return ", ".join(parts) if parts else "timing unknown"


@dataclass
class UserContext:
    max_funnel_depth: Optional[int] = None
    funnel_sequence: Optional[str] = None
    reached_checkout: bool = False
    is_purchaser: bool = False
    cart_abandonment_rate: Optional[float] = None

    avg_scroll_depth: Optional[float] = None
    avg_clicks: Optional[float] = None
    bounce_rate: Optional[float] = None
    avg_session_duration: Optional[float] = None

    recency_days: Optional[float] = None
    frequency: Optional[float] = None
    monetary: Optional[float] = None

    preferred_hour: Optional[float] = None
    preferred_source: Optional[str] = None
    device_mode: Optional[str] = None
    is_weekend: Optional[bool] = None

    sentiment: Optional[str] = None
    confidence: Optional[float] = None
    intent: Optional[str] = None
    churn_risk: Optional[str] = None
    nb_visits: Optional[int] = None

    persona: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    region: Optional[str] = None

    # RFM / scoring metadata from the upstream agents
    r_score: Optional[float] = None
    f_score: Optional[float] = None
    m_score: Optional[float] = None
    rfm_score: Optional[float] = None
    behaviour_score: Optional[float] = None
    intent_score: Optional[float] = None
    context_score: Optional[float] = None
    final_score: Optional[float] = None

    def _infer_friction(self) -> str:
        depth = self.max_funnel_depth or 0
        abandon = self.cart_abandonment_rate or 0.0
        bounce = self.bounce_rate or 0.0
        clicks = self.avg_clicks or 0.0
        scroll = self.avg_scroll_depth or 0.0
        recency = self.recency_days if self.recency_days is not None else 999
        frequency = self.frequency if self.frequency is not None else 0
        intent = (self.intent or "").lower()
        churn = (self.churn_risk or "").lower()

        if depth >= 6 and abandon > 0.3 and not self.is_purchaser:
            return "likely friction at payment or pricing step"
        if 4 <= depth < 6 and abandon > 0.5:
            return "hesitation at cart review stage"
        if bounce > 0.5 and (self.avg_session_duration or 0.0) < 60:
            return "immediate disengagement, possible UX or load issue"
        if clicks > 10 and scroll < 40:
            return "high click activity but low scroll — possible navigation confusion"
        if recency > 14 and frequency > 4:
            return "previously active user now lapsing"
        if churn == "high" and intent in {"complaint", "track_refund", "return_request"}:
            return "active dissatisfaction signal - retention at risk"
        return "no dominant friction pattern detected"

    def _sentiment_arc(self) -> str:
        sentiment = self.sentiment or "Unknown"
        intent = self.intent or "unknown"
        churn = (self.churn_risk or "low").lower()
        if self.confidence is None:
            conf = ""
        elif self.confidence >= 0.8:
            conf = " with high confidence"
        elif self.confidence >= 0.6:
            conf = " with moderate confidence"
        else:
            conf = " with tentative confidence"
        friction = self._infer_friction()

        if churn == "high":
            return f"User shows high churn risk - {intent} message, {sentiment} sentiment{conf}. Inferred friction: {friction}."
        if churn == "medium":
            return f"Moderate churn signal - {intent} intent, {sentiment} sentiment{conf}. Inferred friction: {friction}."
        return f"{intent} intent, {sentiment} sentiment{conf}. Inferred friction: {friction}."

    def render_for_llm_prompt(self) -> str:
        depth = self.max_funnel_depth if self.max_funnel_depth is not None else 0
        stage = FUNNEL_LABELS.get(depth, "browsing")
        scroll = self.avg_scroll_depth or 0.0
        clicks = self.avg_clicks or 0.0
        bounce = self.bounce_rate if self.bounce_rate is not None else 0.0
        session_min = (self.avg_session_duration or 0.0) / 60.0
        rfm_label = _rfm_tier(self.rfm_score)
        r_label = _score_label(self.r_score, RECENCY_SCORE_LABELS, "unknown")
        f_label = _score_label(self.f_score, FREQUENCY_SCORE_LABELS, "unknown")
        m_label = _score_label(self.m_score, MONETARY_SCORE_LABELS, "unknown")
        friction = self._infer_friction()
        churn = self.churn_risk or "unknown"
        intent = self.intent or "unknown"
        sentiment = self.sentiment or "unknown"
        confidence = f"{self.confidence:.2f}" if self.confidence is not None else "n/a"
        time_of_day = _temporal_label(self.preferred_hour, self.recency_days, self.is_weekend)
        device = self.device_mode or "unknown"
        source = self.preferred_source or "unknown"
        visits = self.nb_visits if self.nb_visits is not None else 0

        return (
            "=== User profile ===\n"
            f"Persona: {self.persona or 'unknown'} | Sentiment: {sentiment} (conf={confidence}) | Churn risk: {churn}\n"
            f"Intent signal: {intent}\n\n"
            "=== Funnel ===\n"
            f"Depth: {depth}/7 ({stage}) | Abandon rate: {(self.cart_abandonment_rate or 0.0) * 100:.0f}% | Purchaser: {'yes' if self.is_purchaser else 'no'}\n"
            f"Friction: {friction}\n\n"
            "=== Engagement ===\n"
            f"Scroll: {scroll:.0f}% ({'deep' if scroll >= 70 else 'shallow'}) | Clicks: {clicks:.1f}/session | Bounce: {bounce * 100:.0f}% | Session: {session_min:.1f} min\n\n"
            "=== RFM ===\n"
            f"Segment: {rfm_label} | R:{r_label} F:{f_label} M:{m_label} | {(self.monetary or 0.0):.0f} TND | last seen {(self.recency_days or 0):.0f}d ago\n\n"
            "=== Temporal ===\n"
            f"{time_of_day} | {device} | Via {source} | {visits} lifetime visits"
        )

    def render_with_action(self, action_type: str, converted: Optional[bool] = None) -> str:
        base = self.render_narrative()
        outcome = "unknown"
        if converted is True:
            outcome = "converted"
        elif converted is False:
            outcome = "not_converted"
        return f"{base} -> intervention: {action_type} -> outcome: {outcome}"

    def render_narrative(self) -> str:
        persona = self.persona or "User"
        depth = self.max_funnel_depth
        stage_lbl = FUNNEL_LABELS.get(depth or 0, "browsing")
        rfm_tier = _rfm_tier(self.rfm_score)
        recency_band = _score_label(self.r_score, RECENCY_SCORE_LABELS, "unknown recency")
        freq_band = _score_label(self.f_score, FREQUENCY_SCORE_LABELS, "unknown frequency")
        money_band = _score_label(self.m_score, MONETARY_SCORE_LABELS, "unknown monetary")
        engagement = _engagement_band(self.avg_scroll_depth, self.avg_clicks, self.bounce_rate, self.avg_session_duration)
        bounce = _bounce_band(self.bounce_rate)

        if self.is_purchaser:
            funnel_sentence = f"{persona} completed a purchase journey."
        elif self.reached_checkout or (depth is not None and depth >= 6):
            funnel_sentence = f"{persona} reached checkout and did not complete the order."
        elif depth is not None and depth >= 4:
            funnel_sentence = f"{persona} added items to cart but did not finish checkout."
        else:
            funnel_sentence = f"{persona} is still in early browsing and discovery."

        sentences = [
            f"Funnel: {funnel_sentence} Stage: {stage_lbl}.",
            f"Engagement: {engagement} engagement with {bounce} bounce behavior; friction signal is {self._infer_friction()}.",
            f"RFM: {rfm_tier} with {recency_band} recency, {freq_band} frequency, and {money_band} monetary behavior.",
            f"Pattern: {_temporal_label(self.preferred_hour, self.recency_days, self.is_weekend)} on {self.device_mode or 'unknown device'} via {self.preferred_source or 'unknown source'}.",
            f"Emotional arc: {self._sentiment_arc()}",
        ]
        if self.funnel_sequence:
            sentences.insert(1, f"Journey trace: {self.funnel_sequence}.")
        return " ".join(sentences)

    def render_compact(self) -> str:
        tier = _rfm_tier(self.rfm_score)
        tier_token = {
            "top RFM tier": "top_tier",
            "mid RFM tier": "mid_tier",
            "low RFM tier": "low_tier",
        }.get(tier, "unknown_tier")
        tokens = []
        if self.max_funnel_depth is not None:
            tokens.append(f"funnel:{self.max_funnel_depth}")
        tokens.append(f"funnel_stage:{_funnel_stage_from_depth(self.max_funnel_depth)}")
        tokens.append(f"rfm:{tier_token}")
        tokens.append(f"r:{_score_label(self.r_score, RECENCY_SCORE_LABELS, 'unknown').replace(' ', '_')}")
        tokens.append(f"f:{_score_label(self.f_score, FREQUENCY_SCORE_LABELS, 'unknown').replace(' ', '_')}")
        tokens.append(f"m:{_score_label(self.m_score, MONETARY_SCORE_LABELS, 'unknown').replace(' ', '_')}")
        tokens.append(f"engagement:{_engagement_band(self.avg_scroll_depth, self.avg_clicks, self.bounce_rate, self.avg_session_duration)}")
        tokens.append(f"bounce:{_bounce_band(self.bounce_rate)}")
        tokens.append(f"friction:{_friction_token(self._infer_friction())}")
        if self.sentiment:
            tokens.append(f"sentiment:{self.sentiment}")
        if self.churn_risk:
            tokens.append(f"churn:{self.churn_risk}")
        if self.intent:
            tokens.append(f"intent:{self.intent}")
        if self.device_mode:
            tokens.append(f"device:{self.device_mode}")
        if self.preferred_source:
            tokens.append(f"src:{self.preferred_source}")
        return "|".join(tokens)


def _funnel_stage_from_depth(depth: Optional[int]) -> str:
    if depth is None:
        return "browsing"
    if depth >= 7:
        return "completed_purchase"
    if depth >= 6:
        return "reached_checkout"
    if depth >= 5:
        return "viewing_cart"
    if depth >= 4:
        return "cart_addition"
    if depth >= 3:
        return "product_consideration"
    if depth >= 2:
        return "discovery"
    return "early_browse"


def from_user_meta(
    user_meta: Optional[dict],
    persona: Optional[str] = None,
    sentiment: Optional[str] = None,
    confidence: Optional[float] = None,
    intent: Optional[str] = None,
    churn_risk: Optional[str] = None,
) -> UserContext:
    m = user_meta or {}

    depth = m.get("max_funnel_depth")
    reached_checkout = (m.get("checkout_rate", 0) or 0) > 0 or (depth is not None and depth >= 6)
    is_purchaser = (m.get("purchase_rate", 0) or 0) > 0 or (m.get("monetary", 0) or 0) > 0

    return UserContext(
        max_funnel_depth=depth,
        funnel_sequence=m.get("funnel_sequence"),
        reached_checkout=reached_checkout,
        is_purchaser=is_purchaser,
        cart_abandonment_rate=m.get("cart_abandonment_rate"),
        avg_scroll_depth=m.get("avg_scroll_depth"),
        avg_clicks=m.get("avg_clicks"),
        bounce_rate=m.get("bounce_rate"),
        avg_session_duration=m.get("avg_session_duration"),
        recency_days=m.get("recency_days"),
        frequency=m.get("frequency"),
        monetary=m.get("monetary"),
        preferred_hour=m.get("preferred_hour"),
        preferred_source=m.get("preferred_source"),
        device_mode=m.get("device_mode"),
        is_weekend=m.get("is_weekend"),
        sentiment=sentiment,
        confidence=confidence,
        intent=intent or m.get("intent"),
        churn_risk=churn_risk or m.get("churn_risk"),
        nb_visits=m.get("nb_visits"),
        persona=persona,
        age=m.get("age"),
        gender=m.get("gender"),
        region=m.get("region"),
        r_score=m.get("r_score"),
        f_score=m.get("f_score"),
        m_score=m.get("m_score"),
        rfm_score=m.get("rfm_score"),
        behaviour_score=m.get("behaviour_score"),
        intent_score=m.get("intent_score"),
        context_score=m.get("context_score"),
        final_score=m.get("final_score"),
    )