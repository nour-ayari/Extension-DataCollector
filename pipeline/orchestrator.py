import pandas as pd
from concurrent.futures import ThreadPoolExecutor
from pipeline.agents.rfm_agent       import RFMAgent
from pipeline.agents.behaviour_agent import BehaviourAgent
from pipeline.agents.intent_agent    import IntentAgent
from pipeline.agents.context_agent   import ContextAgent

WEIGHTS = {
    "rfm_score":       0.25,
    "behaviour_score": 0.30,
    "intent_score":    0.35,
    "context_score":   0.10,
}

def run_orchestrator(user_features: pd.DataFrame) -> pd.DataFrame:
    print("\n" + "="*50)
    print("Orchestrator — parallel agent run")
    print("="*50)

    rfm_agent = RFMAgent()
    beh_agent = BehaviourAgent()
    int_agent = IntentAgent()
    ctx_agent = ContextAgent(n_clusters=5)

    with ThreadPoolExecutor(max_workers=4) as ex:
        f_ctx = ex.submit(ctx_agent.run, user_features)
        f_rfm = ex.submit(rfm_agent.run, user_features)
        f_beh = ex.submit(beh_agent.run, user_features)
        f_int = ex.submit(int_agent.run, user_features)

        ctx_scores = f_ctx.result()
        rfm_scores = f_rfm.result()
        beh_scores = f_beh.result()
        int_scores = f_int.result()

    result = user_features.copy()
    result["rfm_score"]       = rfm_scores.values
    result["behaviour_score"] = beh_scores.values
    result["intent_score"]    = int_scores.values
    result["context_score"]   = ctx_scores.values

    if ctx_agent._labeled_df is not None:
        result["persona"]    = ctx_agent._labeled_df["persona"].values
        result["cluster_id"] = ctx_agent._labeled_df["cluster_id"].values

    if hasattr(rfm_agent, "_scored_df"):
        for col in ["r_score", "f_score", "m_score"]:
            if col in rfm_agent._scored_df.columns:
                result[col] = rfm_agent._scored_df[col].values

    result["final_score"] = (
        result["rfm_score"]       * WEIGHTS["rfm_score"]
        + result["behaviour_score"] * WEIGHTS["behaviour_score"]
        + result["intent_score"]    * WEIGHTS["intent_score"]
        + result["context_score"]   * WEIGHTS["context_score"]
    ).clip(0, 100).round(2)

    result["conversion_label"] = pd.cut(
        result["final_score"],
        bins=[0, 30, 55, 75, 100],
        labels=["Cold", "Warm", "High Intent", "VIP"],
    ).astype(str)

    print("\n=== Final score summary ===")
    print(result["final_score"].describe().round(2))
    print("\n=== Persona distribution ===")
    print(result["persona"].value_counts())
    print("\n=== Conversion label distribution ===")
    print(result["conversion_label"].value_counts())

    return result
