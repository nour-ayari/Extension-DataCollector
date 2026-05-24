"""
rag_context.py — Rich structured context for Agent 3 RAG

Replaces the flat behavioral context string with a UserContext dataclass.
The context is rendered as natural language for embeddings and as a compact
audit string for storage.
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

    def render_narrative(self) -> str:
        parts = []

        depth = self.max_funnel_depth
        persona = self.persona or "User"
        stage_lbl = FUNNEL_LABELS.get(depth or 0, "browsing")

        if self.is_purchaser:
            s = f"{persona} completed purchases (funnel depth {depth})."
        elif self.reached_checkout or (depth is not None and depth >= 6):
            abandon = (
                f", abandoned {int((self.cart_abandonment_rate or 0) * 100)}% of sessions"
                if self.cart_abandonment_rate
                else ""
            )
            s = f"{persona} reached checkout (funnel depth {depth}){abandon}."
        elif depth is not None and depth >= 4:
            s = f"{persona} added to cart but did not reach checkout (funnel depth {depth})."
        else:
            s = f"{persona} is {stage_lbl} (funnel depth {depth or 0})."

        if self.funnel_sequence:
            s += f" Journey: {self.funnel_sequence}."
        parts.append(s)

        eng = []
        if self.avg_scroll_depth is not None:
            sc = self.avg_scroll_depth
            eng.append(f"{sc:.0f}% avg scroll ({'deep' if sc >= 70 else 'shallow'} engagement)")
        if self.avg_clicks is not None:
            eng.append(f"{self.avg_clicks:.1f} clicks/session")
        if self.bounce_rate is not None:
            b = self.bounce_rate
            eng.append(f"{'high' if b > 0.4 else 'low'} bounce rate ({b:.0%})")
        if self.avg_session_duration is not None:
            eng.append(f"{self.avg_session_duration / 60:.1f} min avg session")
        if eng:
            parts.append("Engagement: " + ", ".join(eng) + ".")

        rfm_tokens = [_rfm_label(self.recency_days, self.frequency, self.monetary)]
        if self.frequency is not None:
            rfm_tokens.append(f"{int(self.frequency)} sessions")
        if self.monetary is not None and self.monetary > 0:
            rfm_tokens.append(f"{self.monetary:.0f} TND spent")
        if self.recency_days is not None:
            r = int(self.recency_days)
            rfm_tokens.append("active today" if r == 0 else f"last seen {r}d ago")
        parts.append("RFM: " + ", ".join(rfm_tokens) + ".")

        if any(v is not None for v in (self.r_score, self.f_score, self.m_score, self.rfm_score)):
            scores = []
            if self.r_score is not None:
                scores.append(f"r={self.r_score}")
            if self.f_score is not None:
                scores.append(f"f={self.f_score}")
            if self.m_score is not None:
                scores.append(f"m={self.m_score}")
            if self.rfm_score is not None:
                scores.append(f"rfm={self.rfm_score:.1f}")
            parts.append("RFM scores: " + ", ".join(scores) + ".")

        temp = _temporal_label(self.preferred_hour, self.recency_days, self.is_weekend)
        ch = [temp]
        if self.device_mode:
            ch.append(f"on {self.device_mode}")
        if self.preferred_source:
            ch.append(f"via {self.preferred_source}")
        parts.append("Pattern: " + ", ".join(ch) + ".")

        if self.sentiment:
            conf_s = f" (conf={self.confidence:.2f})" if self.confidence else ""
            visits_s = f", {self.nb_visits} lifetime visits" if self.nb_visits else ""
            parts.append(f"Current sentiment: {self.sentiment}{conf_s}{visits_s}.")

        return " ".join(parts)

    def render_compact(self) -> str:
        tokens = []
        if self.max_funnel_depth is not None:
            tokens.append(f"funnel:{self.max_funnel_depth}")
        if self.avg_scroll_depth is not None:
            tokens.append(f"scroll:{self.avg_scroll_depth:.0f}")
        if self.bounce_rate is not None:
            tokens.append(f"bounce:{self.bounce_rate:.2f}")
        if self.cart_abandonment_rate is not None:
            tokens.append(f"abandon:{self.cart_abandonment_rate:.2f}")
        if self.frequency is not None:
            tokens.append(f"freq:{int(self.frequency)}")
        if self.monetary is not None:
            tokens.append(f"monetary:{self.monetary:.0f}")
        if self.recency_days is not None:
            tokens.append(f"recency:{int(self.recency_days)}")
        if self.device_mode:
            tokens.append(f"device:{self.device_mode}")
        if self.preferred_source:
            tokens.append(f"src:{self.preferred_source}")
        if self.sentiment:
            tokens.append(f"sentiment:{self.sentiment}")
        if self.rfm_score is not None:
            tokens.append(f"rfm:{self.rfm_score:.1f}")
        return "|".join(tokens)


def from_user_meta(
    user_meta: Optional[dict],
    persona: Optional[str] = None,
    sentiment: Optional[str] = None,
    confidence: Optional[float] = None,
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