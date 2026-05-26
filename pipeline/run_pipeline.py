from __future__ import annotations

import argparse
import importlib
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Optional

import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

ROOT_DIR = Path(__file__).resolve().parent.parent
ASSEMBLY_DIR = ROOT_DIR / "pipeline" / "assembly"
AGENT3_DIR = ROOT_DIR / "pipeline" / "agent3"
for extra_path in [ASSEMBLY_DIR, AGENT3_DIR]:
    if extra_path.exists() and str(extra_path) not in sys.path:
        sys.path.insert(0, str(extra_path))

load_dotenv()

logger = logging.getLogger(__name__)
AGENT2_TABLE_CANDIDATES = ("nlp_conversation_output", "nlp_conversation_outputs")


def _get_supabase_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in environment")
    return create_client(url, key)


def _load_get_recommendations_for_users():
    module = importlib.import_module("orchestrator_integration")
    return getattr(module, "get_recommendations_for_users")


def _load_user_features(limit: int | None = None) -> pd.DataFrame:
    client = _get_supabase_client()
    try:
        query = client.table("user_features").select("*").order("updated_at", desc=True)
        if limit is not None:
            query = query.limit(limit)
        response = query.execute()
    except Exception as exc:
        raise RuntimeError(f"Failed to fetch user_features from Supabase: {exc}") from exc

    rows = response.data or []
    return pd.DataFrame(rows)


def _parse_json_like(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return value
    return value


def _collect_fallback_stats(client, rec_df: pd.DataFrame) -> int:
    if rec_df.empty or "log_id" not in rec_df.columns:
        return 0
    log_ids = [int(value) for value in rec_df["log_id"].dropna().tolist()]
    if not log_ids:
        return 0
    try:
        response = client.table("recommendation_log").select("id,action_detail").in_("id", log_ids).execute()
        rows = response.data or []
    except Exception as exc:
        logger.warning("Failed to inspect recommendation_log for fallback flags: %s", exc)
        return 0

    fallback_count = 0
    for row in rows:
        action_detail = _parse_json_like(row.get("action_detail"))
        if isinstance(action_detail, dict) and action_detail.get("_fallback"):
            fallback_count += 1
    return fallback_count


def _load_agent2_lookup_for_stats(user_features: pd.DataFrame) -> dict[str, dict]:
    try:
        from pipeline.assembly.agent2_join import fetch_agent2_latest, get_agent2_coverage_stats

        client = _get_supabase_client()
        agent2_lookup = fetch_agent2_latest(client)
        stats = get_agent2_coverage_stats(agent2_lookup, user_features)
        logger.info(
            f"Agent2 coverage: {stats['users_with_agent2']}/{stats['total_users']}"
            f" ({stats['coverage_pct']:.1f}%) | inferred: {stats['inferred_pct']:.1f}%"
        )
        return agent2_lookup
    except Exception as exc:
        logger.warning("Agent2 fetch failed, using full behavioral inference: %s", exc)
        return {}


def _print_summary(
    users_fetched: int,
    agent2_lookup: dict[str, dict],
    user_features: pd.DataFrame,
    rec_df: pd.DataFrame,
    errors: int,
    fallback_count: int,
) -> None:
    total_users = max(users_fetched, 1)
    agent2_real = sum(1 for user_id in user_features.get("client_id", pd.Series(dtype=str)).astype(str).tolist() if user_id in agent2_lookup)
    agent2_inferred = users_fetched - agent2_real
    eligible = int((user_features["final_score"] >= 20.0).sum()) if "final_score" in user_features.columns and not user_features.empty else 0
    recommendations = int(len(rec_df))
    fallback_rate = (fallback_count / recommendations * 100.0) if recommendations else 0.0
    actions_breakdown = rec_df["action_type"].value_counts().to_dict() if not rec_df.empty and "action_type" in rec_df.columns else {}

    print("\n╔══════════════════════════════════════════╗")
    print("║         PIPELINE RUN SUMMARY            ║")
    print("╠══════════════════════════════════════════╣")
    print(f"║ Users fetched          : {users_fetched:<14} ║")
    print(f"║ Agent2 real signal     : {agent2_real:<4} ({(agent2_real / total_users) * 100.0:.1f}%)       ║")
    print(f"║ Agent2 inferred        : {agent2_inferred:<4} ({(agent2_inferred / total_users) * 100.0:.1f}%)       ║")
    print(f"║ Eligible for Agent3    : {eligible:<14} ║")
    print(f"║ Recommendations made   : {recommendations:<14} ║")
    print(f"║ Fallback rate          : {fallback_rate:.1f}%           ║")
    print("║ Actions breakdown      :                ║")
    if actions_breakdown:
        for action_type, count in actions_breakdown.items():
            print(f"║   {action_type:<22}: {count:<4} ║")
    else:
        print("║   (none)                               ║")
    print(f"║ Errors                 : {errors:<14} ║")
    print("╚══════════════════════════════════════════╝")


def verify_linkage(user_id: str) -> None:
    client = _get_supabase_client()

    user_resp = (
        client.table("user_features")
        .select("*")
        .eq("client_id", user_id)
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    user_row = (user_resp.data or [None])[0]

    agent2_row = None
    for table_name in AGENT2_TABLE_CANDIDATES:
        try:
            agent2_resp = (
                client.table(table_name)
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            agent2_row = (agent2_resp.data or [None])[0]
            if agent2_row:
                break
        except Exception:
            continue

    log_resp = (
        client.table("recommendation_log")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    log_row = (log_resp.data or [None])[0]

    if not user_row:
        print(f"No user_features row found for {user_id}")
        return

    sentiment_source = "behavioral_inferred"
    if agent2_row:
        sentiment_source = "agent2_real"
        sentiment = str(agent2_row.get("sentiment_label", "Neutral")).capitalize()
        confidence = float(agent2_row.get("sentiment_score", 0.60) or 0.60)
        intent = str(agent2_row.get("intent_predicted", "product_information"))
        churn_risk = str(agent2_row.get("churn_risk_level", "low"))
    else:
        from pipeline.assembly.agent2_join import enrich_with_agent2

        inferred = pd.Series(user_row)
        lookup = {}
        sentiment, confidence, intent, churn_risk = enrich_with_agent2(inferred, lookup)

    from pipeline.agent3.rag_context import from_user_meta
    from pipeline.agent3.vector_store import search_similar_cases

    user_meta = {
        "max_funnel_depth": user_row.get("max_funnel_depth"),
        "cart_abandonment_rate": user_row.get("cart_abandonment_rate"),
        "avg_scroll_depth": user_row.get("avg_scroll_depth"),
        "avg_clicks": user_row.get("avg_clicks"),
        "bounce_rate": user_row.get("bounce_rate"),
        "purchase_rate": user_row.get("purchase_rate"),
        "checkout_rate": user_row.get("checkout_rate"),
        "frequency": user_row.get("frequency"),
        "monetary": user_row.get("monetary"),
        "recency_days": user_row.get("recency_days"),
        "device_mode": user_row.get("device_mode"),
        "preferred_source": user_row.get("preferred_source", "search"),
        "intent": intent,
        "churn_risk": churn_risk,
        "r_score": user_row.get("r_score"),
        "f_score": user_row.get("f_score"),
        "m_score": user_row.get("m_score"),
        "rfm_score": user_row.get("rfm_score"),
        "behaviour_score": user_row.get("behaviour_score"),
        "intent_score": user_row.get("intent_score"),
        "context_score": user_row.get("context_score"),
        "final_score": user_row.get("final_score"),
    }
    ctx = from_user_meta(
        user_meta=user_meta,
        persona=str(user_row.get("persona", "Unknown")),
        sentiment=sentiment,
        confidence=confidence,
        intent=intent,
        churn_risk=churn_risk,
    )
    cases = search_similar_cases(
        persona=str(user_row.get("persona", "Unknown")),
        sentiment=sentiment,
        behavioral_context=ctx,
        top_k=3,
        only_converted=False,
        filter_persona=True,
    )

    action_detail = _parse_json_like(log_row.get("action_detail")) if log_row else {}
    subject_line = ""
    fallback_flag = False
    if isinstance(action_detail, dict):
        subject_line = str(action_detail.get("subject_line", ""))
        fallback_flag = bool(action_detail.get("_fallback", False))

    print(f"\n╔══════════════════════════════════════════════╗")
    print(f"║     LINKAGE VERIFICATION: {user_id:<27}║")
    print(f"╠══════════════════════════════════════════════╣")
    print("")
    print("[AGENT 1 — user_features]")
    print(f"persona       : {user_row.get('persona', 'N/A')}")
    print(f"final_score   : {user_row.get('final_score', 'N/A')}")
    print(f"funnel_depth  : {user_row.get('max_funnel_depth', 'N/A')}")
    print(f"monetary      : {user_row.get('monetary', 'N/A')} TND")
    print(f"r/f/m scores  : {user_row.get('r_score', 'N/A')} / {user_row.get('f_score', 'N/A')} / {user_row.get('m_score', 'N/A')}")
    print("")
    print("[AGENT 2 — chatbot signal]")
    print(f"source        : {sentiment_source}")
    print(f"sentiment     : {sentiment} (conf={confidence:.2f})")
    print(f"intent        : {intent}")
    print(f"churn_risk    : {churn_risk}")
    print("")
    print("[AGENT 3 — recommendation]")
    if log_row:
        print(f"action        : {log_row.get('action_type', 'N/A')}")
    else:
        print("action        : N/A")
    print(f"channel       : {action_detail.get('channel', 'N/A') if isinstance(action_detail, dict) else 'N/A'}")
    print(f"urgency       : {action_detail.get('urgency', 'N/A') if isinstance(action_detail, dict) else 'N/A'}")
    if subject_line:
        print(f"subject       : {subject_line[:60]}")
    else:
        print("subject       : N/A")
    print(f"log_id        : {log_row.get('id', 'N/A') if log_row else 'N/A'}")
    print(f"fallback      : {fallback_flag}")
    print("")
    print("[RAG MEMORY — top retrieved cases]")
    if cases:
        for idx, case in enumerate(cases, 1):
            converted = "✓ converted" if case.get("converted") else "✗ no conv"
            print(
                f"Case {idx} | sim={float(case.get('similarity', 0.0) or 0.0):.2f} {converted} | "
                f"{case.get('persona', 'N/A')} × {case.get('sentiment', 'N/A')} → {case.get('action_type', 'N/A')}"
            )
    else:
        print("No similar cases found.")
    print("")
    print("╚══════════════════════════════════════════════╝")


def run_pipeline(
    mode: str = "http",
    url: str | None = None,
    limit: int | None = None,
    dry_run: bool = False,
    seed_coveo: bool = False,
    verify_user_id: str | None = None,
) -> dict[str, Any]:
    if url:
        os.environ["AGENT3_URL"] = url

    user_features = _load_user_features(limit=limit)
    users_fetched = int(len(user_features))

    agent2_lookup = _load_agent2_lookup_for_stats(user_features)
    get_recommendations_for_users = _load_get_recommendations_for_users()

    if dry_run:
        logger.info("Dry-run requested; recommendations will still be computed but no seeding is performed.")

    rec_df = pd.DataFrame()
    errors = 0
    fallback_count = 0

    try:
        rec_df = get_recommendations_for_users(user_features, mode=mode, max_users=limit)
        client = _get_supabase_client()
        fallback_count = _collect_fallback_stats(client, rec_df)
    except Exception as exc:
        errors += 1
        logger.error("Agent 3 pipeline failed: %s", exc)

    if seed_coveo:
        try:
            from pipeline.agent3.seed_from_coveo_interventions import seed_coveo_interventions

            seed_coveo_interventions(limit=limit, dry_run=dry_run)
        except Exception as exc:
            errors += 1
            logger.warning("Coveo seeding failed: %s", exc)

    if verify_user_id:
        try:
            verify_linkage(verify_user_id)
        except Exception as exc:
            errors += 1
            logger.warning("Linkage verification failed: %s", exc)

    _print_summary(
        users_fetched=users_fetched,
        agent2_lookup=agent2_lookup,
        user_features=user_features,
        rec_df=rec_df,
        errors=errors,
        fallback_count=fallback_count,
    )

    return {
        "user_features": user_features,
        "recommendations": rec_df,
        "agent2_lookup": agent2_lookup,
        "errors": errors,
        "fallback_count": fallback_count,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Unified Agent 1 + Agent 2 + Agent 3 pipeline runner")
    parser.add_argument("--mode", choices=["http", "direct"], default=os.getenv("AGENT3_MODE", "http"))
    parser.add_argument("--url", default=os.getenv("AGENT3_URL"), help="Agent 3 HTTP URL used in http mode")
    parser.add_argument("--limit", type=int, default=None, help="Limit rows processed from user_features")
    parser.add_argument("--dry-run", action="store_true", help="Run without seeding Coveo interventions")
    parser.add_argument("--seed-coveo", action="store_true", help="Seed intervention_cases from Coveo sessions")
    parser.add_argument("--verify", dest="verify_user_id", default=None, help="Verify linkage for a specific user_id")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
    run_pipeline(
        mode=args.mode,
        url=args.url,
        limit=args.limit,
        dry_run=args.dry_run,
        seed_coveo=args.seed_coveo,
        verify_user_id=args.verify_user_id,
    )


if __name__ == "__main__":
    main()
