from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, Tuple

import pandas as pd

logger = logging.getLogger(__name__)
AGENT2_TABLE_CANDIDATES = ("nlp_conversation_output", "nlp_conversation_outputs")


def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _infer_sentiment(row: pd.Series) -> Tuple[str, float]:
    abandon = row.get("cart_abandonment_rate", 0.5) or 0
    bounce = row.get("bounce_rate", 0.5) or 0
    purchase = row.get("purchase_rate", 0.0) or 0

    if purchase > 0.3 and abandon < 0.2:
        return "Positive", 0.70
    if abandon > 0.6 or bounce > 0.5:
        return "Negative", 0.65
    return "Neutral", 0.60


def _infer_intent(row: pd.Series) -> str:
    purchase_rate = row.get("purchase_rate", 0) or 0
    cart_abandonment_rate = row.get("cart_abandonment_rate", 0) or 0
    checkout_rate = row.get("checkout_rate", 0) or 0
    max_funnel_depth = row.get("max_funnel_depth", 0) or 0

    if purchase_rate > 0:
        return "praise"
    if checkout_rate > 0 and cart_abandonment_rate > 0.5:
        return "track_refund"
    if max_funnel_depth >= 4:
        return "product_information"
    if cart_abandonment_rate > 0.7:
        return "return_request"
    return "product_information"


def _infer_churn_risk(row: pd.Series, sentiment: str) -> str:
    abandon = row.get("cart_abandonment_rate", 0) or 0
    purchase = row.get("purchase_rate", 0) or 0
    recency = row.get("recency_days", 999) or 999

    if sentiment == "Negative" and abandon > 0.5:
        return "high"
    if sentiment == "Negative" and purchase == 0:
        return "medium"
    if recency > 21 and purchase == 0:
        return "medium"
    if purchase > 0.3:
        return "low"
    return "low"


def fetch_agent2_latest(supabase_client) -> Dict[str, dict]:
    response = None
    last_exc: Exception | None = None
    for table_name in AGENT2_TABLE_CANDIDATES:
        try:
            response = (
                supabase_client.table(table_name)
                .select("*")
                .order("user_id")
                .order("created_at", desc=True)
                .execute()
            )
            break
        except Exception as exc:
            last_exc = exc
            response = None

    if response is None:
        logger.warning("Agent2 fetch failed: %s", last_exc)
        return {}

    rows = response.data or []
    if not rows:
        return {}

    latest: Dict[str, dict] = {}
    for row in rows:
        try:
            user_id = str(row["user_id"])
            if not user_id:
                continue
            if user_id in latest:
                continue
            if "sentiment_label" not in row or "sentiment_score" not in row:
                continue
            if "intent_predicted" not in row or "churn_risk_level" not in row:
                continue
            normalized = dict(row)
            normalized["sentiment"] = str(row["sentiment_label"]).capitalize()
            normalized["confidence"] = float(row["sentiment_score"])
            normalized["intent"] = str(row["intent_predicted"])
            normalized["churn_risk"] = str(row["churn_risk_level"])
            latest[user_id] = normalized
        except Exception:
            continue

    return latest


def enrich_with_agent2(row: pd.Series, agent2_lookup: Dict[str, dict]) -> tuple[str, float, str, str]:
    user_id = str(row.get("client_id", ""))
    if user_id in agent2_lookup:
        normalized = agent2_lookup[user_id]
        sentiment = str(normalized.get("sentiment", "Neutral"))
        confidence = float(normalized.get("confidence", 0.60))
        intent = str(normalized.get("intent", "product_information"))
        churn_risk = str(normalized.get("churn_risk", "low"))
        source = "agent2_real"
    else:
        sentiment, confidence = _infer_sentiment(row)
        intent = _infer_intent(row)
        churn_risk = _infer_churn_risk(row, sentiment)
        source = "behavioral_inferred"
    logger.debug("%s: sentiment source=%s", user_id, source)
    return sentiment, confidence, intent, churn_risk


def get_agent2_coverage_stats(agent2_lookup: Dict[str, dict], user_features_df: pd.DataFrame) -> dict:
    total_users = int(len(user_features_df))
    user_ids = set(user_features_df["client_id"].astype(str).tolist()) if total_users and "client_id" in user_features_df.columns else set()
    users_with_agent2 = sum(1 for user_id in user_ids if user_id in agent2_lookup)
    coverage_pct = (users_with_agent2 / total_users * 100.0) if total_users else 0.0

    sentiment_distribution = {"Positive": 0, "Neutral": 0, "Negative": 0}
    churn_distribution = {"low": 0, "medium": 0, "high": 0}
    for row in agent2_lookup.values():
        sentiment = str(row.get("sentiment", "Neutral"))
        churn_risk = str(row.get("churn_risk", "low"))
        if sentiment in sentiment_distribution:
            sentiment_distribution[sentiment] += 1
        if churn_risk in churn_distribution:
            churn_distribution[churn_risk] += 1

    return {
        "total_users": total_users,
        "users_with_agent2": users_with_agent2,
        "coverage_pct": coverage_pct,
        "inferred_pct": 100.0 - coverage_pct,
        "sentiment_distribution": sentiment_distribution,
        "churn_distribution": churn_distribution,
    }
