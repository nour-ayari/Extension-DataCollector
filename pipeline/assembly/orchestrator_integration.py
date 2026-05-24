"""
orchestrator_integration.py — Wires Agent 3 into the existing ML pipeline

This file extends your existing orchestrator (orchestrator.py) to call
Agent 3's /recommend endpoint after the 4-agent ensemble scoring.

TWO integration modes:
  A. HTTP mode  — Agent 3 runs as a separate FastAPI service (recommended for production)
  B. Direct mode — Agent 3 imported as a Python module (simpler, same process)

Plug-in point in your existing pipeline:
    existing: supabase_sync.py → upsert user_features
    new:      + call get_recommendations_for_users(user_features_df)
"""

from __future__ import annotations

import os
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

import pandas as pd
import requests
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

AGENT3_URL     = os.getenv("AGENT3_URL", "http://localhost:8000")
AGENT3_TIMEOUT = int(os.getenv("AGENT3_TIMEOUT", 30))
AGENT3_WORKERS = int(os.getenv("AGENT3_WORKERS", 4))   # parallel calls

# Only call Agent 3 for users above this final_score threshold
# No point generating recommendations for very cold/low-score users
MIN_SCORE_THRESHOLD = float(os.getenv("AGENT3_MIN_SCORE", 20.0))

# Only call Agent 3 when sentiment confidence is high enough
MIN_SENTIMENT_CONF  = float(os.getenv("AGENT3_MIN_CONF", 0.60))


# ---------------------------------------------------------------------------
# Helper: map persona label + score to sentiment (if Agent 2 not available)
# ---------------------------------------------------------------------------
# In your current pipeline Agent 2 (chatbot sentiment) may not always fire
# (users who didn't use the chatbot have no sentiment signal).
# This fallback infers a neutral/positive sentiment from behavioral signals.

def _infer_sentiment(row: pd.Series) -> tuple[str, float]:
    """
    Fallback sentiment inference from behavioral data when Agent 2 output
    is not available (user never chatted with the bot).

    Returns (sentiment, confidence).
    """
    abandon = row.get("cart_abandonment_rate", 0.5)
    bounce  = row.get("bounce_rate", 0.5)
    purchase= row.get("purchase_rate", 0.0)

    if purchase > 0.3 and abandon < 0.2:
        return "Positive", 0.70
    elif abandon > 0.6 or bounce > 0.5:
        return "Negative", 0.65
    else:
        return "Neutral",  0.60


# ---------------------------------------------------------------------------
# Helper: build user_meta dict from a user_features row
# ---------------------------------------------------------------------------

META_COLUMNS = [
    "age", "gender", "region",
    "nb_visits", "avg_session_duration",
    "max_funnel_depth", "cart_abandonment_rate", "avg_scroll_depth",
    "avg_clicks", "bounce_rate", "purchase_rate", "checkout_rate",
    "frequency", "monetary", "recency_days",
    "device_mode", "preferred_source",
    "r_score", "f_score", "m_score", "rfm_score",
    "behaviour_score", "intent_score", "context_score", "final_score",
]

def _build_user_meta(row: pd.Series) -> dict:
    meta = {}
    for col in META_COLUMNS:
        val = row.get(col)
        if val is not None and not (isinstance(val, float) and pd.isna(val)):
            meta[col] = val
    return meta


# ---------------------------------------------------------------------------
# Single-user recommendation call (HTTP mode)
# ---------------------------------------------------------------------------

def _call_agent3_http(row: pd.Series) -> Optional[dict]:
    """Call the Agent 3 FastAPI endpoint for a single user row."""
    user_id   = str(row.get("client_id", row.name))
    persona   = str(row.get("persona", "Cold"))
    score     = float(row.get("final_score", 0))

    if score < MIN_SCORE_THRESHOLD:
        logger.debug(f"Skipping {user_id} — score {score:.1f} below threshold")
        return None

    # Get sentiment from Agent 2 output columns (if they exist in user_features)
    # Your pipeline should add these columns after Agent 2 runs.
    # Falls back to behavioral inference if not present.
    if "sentiment" in row.index and "sentiment_confidence" in row.index:
        sentiment  = str(row["sentiment"])
        confidence = float(row["sentiment_confidence"])
    else:
        sentiment, confidence = _infer_sentiment(row)

    if confidence < MIN_SENTIMENT_CONF:
        sentiment, confidence = "Neutral", 0.60   # safe default

    payload = {
        "user_id":    user_id,
        "persona":    persona,
        "sentiment":  sentiment,
        "confidence": confidence,
        "user_meta":  _build_user_meta(row),
    }

    try:
        r = requests.post(
            f"{AGENT3_URL}/recommend",
            json    = payload,
            timeout = AGENT3_TIMEOUT,
        )
        r.raise_for_status()
        result = r.json()
        logger.info(
            f"Agent3 → {user_id}: {result['action_type']} via {result['channel']} "
            f"({result['urgency']}) log_id={result['log_id']}"
        )
        return result
    except requests.exceptions.Timeout:
        logger.warning(f"Agent3 timeout for {user_id}")
    except requests.exceptions.HTTPError as e:
        logger.error(f"Agent3 HTTP error for {user_id}: {e} — {r.text}")
    except Exception as e:
        logger.error(f"Agent3 error for {user_id}: {e}")
    return None


# ---------------------------------------------------------------------------
# Single-user recommendation call (Direct / in-process mode)
# ---------------------------------------------------------------------------

def _call_agent3_direct(row: pd.Series) -> Optional[dict]:
    """Call Agent 3 run() directly (same Python process, no HTTP)."""
    from recommendation_agent import run, AgentInput

    user_id = str(row.get("client_id", row.name))
    persona = str(row.get("persona", "Cold"))
    score   = float(row.get("final_score", 0))

    if score < MIN_SCORE_THRESHOLD:
        return None

    if "sentiment" in row.index and "sentiment_confidence" in row.index:
        sentiment  = str(row["sentiment"])
        confidence = float(row["sentiment_confidence"])
    else:
        sentiment, confidence = _infer_sentiment(row)

    if confidence < MIN_SENTIMENT_CONF:
        sentiment, confidence = "Neutral", 0.60

    try:
        result = run(AgentInput(
            user_id    = user_id,
            persona    = persona,
            sentiment  = sentiment,
            confidence = confidence,
            user_meta  = _build_user_meta(row),
        ))
        return result.__dict__
    except Exception as e:
        logger.error(f"Agent3 direct error for {user_id}: {e}")
        return None


# ---------------------------------------------------------------------------
# Batch entry point — called after your existing orchestrator
# ---------------------------------------------------------------------------

def get_recommendations_for_users(
    user_features: pd.DataFrame,
    mode: str = "http",         # "http" | "direct"
    max_users: Optional[int] = None,
) -> pd.DataFrame:
    """
    Main integration function.
    Call this right after orchestrator.run_orchestrator() in your pipeline.

    Args:
        user_features: the DataFrame output of aggregation + scoring
                       (must have columns: client_id, persona, final_score)
        mode:          "http"   → calls FastAPI endpoint (Agent 3 as separate service)
                       "direct" → imports run() directly (same process)
        max_users:     cap for testing (None = all users)

    Returns:
        DataFrame with recommendation results joined back to user_ids
    """
    call_fn = _call_agent3_http if mode == "http" else _call_agent3_direct

    # Filter to users worth scoring
    eligible = user_features[
        user_features["final_score"] >= MIN_SCORE_THRESHOLD
    ].copy()

    if max_users:
        eligible = eligible.head(max_users)

    total = len(eligible)
    logger.info(f"Agent3 integration: {total} eligible users (score ≥ {MIN_SCORE_THRESHOLD})")

    results = []
    with ThreadPoolExecutor(max_workers=AGENT3_WORKERS) as executor:
        futures = {
            executor.submit(call_fn, row): idx
            for idx, row in eligible.iterrows()
        }
        done = 0
        for future in as_completed(futures):
            done += 1
            result = future.result()
            if result:
                results.append(result)
            if done % 10 == 0 or done == total:
                logger.info(f"  Agent3 progress: {done}/{total}")

    if not results:
        logger.warning("Agent3: no recommendations generated")
        return pd.DataFrame()

    rec_df = pd.DataFrame(results)
    logger.info(
        f"Agent3 done: {len(rec_df)} recommendations generated\n"
        f"  Breakdown: {rec_df['action_type'].value_counts().to_dict()}"
    )
    return rec_df


# ---------------------------------------------------------------------------
# Drop-in patch for your existing run_orchestrator() function
# Add these 3 lines at the END of your orchestrator.py:
#
#   from orchestrator_integration import get_recommendations_for_users
#   rec_df = get_recommendations_for_users(user_features, mode="http")
#   # rec_df is available for downstream use (dashboard, logging, etc.)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Standalone test — simulates what the full pipeline would produce
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")

    # Simulate a small user_features DataFrame (as your pipeline produces it)
    mock_users = pd.DataFrame([
        {
            "client_id": "user-A", "persona": "High Intent", "final_score": 72.5,
            "sentiment": "Negative", "sentiment_confidence": 0.87,
            "max_funnel_depth": 6, "cart_abandonment_rate": 0.20,
            "avg_scroll_depth": 78.0, "bounce_rate": 0.08,
            "frequency": 4, "monetary": 320.0, "recency_days": 1,
            "device_mode": "mobile", "nb_visits": 5,
        },
        {
            "client_id": "user-B", "persona": "VIP", "final_score": 91.0,
            "sentiment": "Negative", "sentiment_confidence": 0.93,
            "max_funnel_depth": 7, "cart_abandonment_rate": 0.05,
            "avg_scroll_depth": 90.0, "bounce_rate": 0.02,
            "frequency": 14, "monetary": 2100.0, "recency_days": 0,
            "device_mode": "desktop", "nb_visits": 20,
        },
        {
            "client_id": "user-C", "persona": "Cold", "final_score": 12.0,  # below threshold
            "max_funnel_depth": 1, "bounce_rate": 0.80,
            "frequency": 1, "monetary": 0.0, "recency_days": 10,
        },
        {
            "client_id": "user-D", "persona": "Warm", "final_score": 44.0,
            "max_funnel_depth": 3, "cart_abandonment_rate": 0.35,
            "avg_scroll_depth": 62.0, "bounce_rate": 0.22,
            "frequency": 3, "monetary": 90.0, "recency_days": 2,
            "device_mode": "mobile", "nb_visits": 4,
        },
    ])

    print("Testing orchestrator integration (direct mode — no server needed)\n")
    rec_df = get_recommendations_for_users(mock_users, mode="direct")

    if not rec_df.empty:
        print("\n── Recommendations summary ──")
        cols = ["user_id", "persona", "sentiment", "action_type", "channel", "urgency", "log_id"]
        print(rec_df[[c for c in cols if c in rec_df.columns]].to_string(index=False))