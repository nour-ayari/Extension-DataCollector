import os
import pandas as pd
import joblib
from sklearn.cluster import KMeans
from sklearn.preprocessing import MinMaxScaler
from pipeline.agents import BaseAgent

PERSONA_SCORE = {
    "VIP": 100, "High Intent": 80,
    "Warm": 60, "Hesitant": 35, "Cold": 10,
}

_PERSONAS = ["Cold", "Hesitant", "Warm", "High Intent", "VIP"]  # ordered least → most valuable

class ContextAgent(BaseAgent):
    def __init__(self, n_clusters=5):
        super().__init__("Context Agent")
        self.n_clusters  = n_clusters
        self.km          = None
        self.scaler      = MinMaxScaler()
        self.persona_map = {}
        self.feature_cols = [
            "recency_days", "frequency", "monetary",
            "cart_abandonment_rate", "avg_clicks", "avg_funnel_depth",
        ]
        self._labeled_df = None

    def fit_predict(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        X  = self.scaler.fit_transform(df[self.feature_cols].fillna(0))

        self.km      = KMeans(n_clusters=self.n_clusters, random_state=42, n_init=10)
        df["cluster_id"] = self.km.fit_predict(X)

        centers = pd.DataFrame(
            self.scaler.inverse_transform(self.km.cluster_centers_),
            columns=self.feature_cols,
        )
        centers["composite"] = (
            -centers["recency_days"]
            + centers["frequency"]           * 2
            + centers["monetary"]            * 3
            - centers["cart_abandonment_rate"]
            + centers["avg_funnel_depth"]
        )
        ranks = centers["composite"].rank(ascending=False, method="first").astype(int)
        n     = len(ranks)
        self.persona_map = {
            cid: _PERSONAS[round((rank - 1) / max(n - 1, 1) * (len(_PERSONAS) - 1))]
            for cid, rank in ranks.items()
        }

        df["persona"]    = df["cluster_id"].map(self.persona_map)
        self._labeled_df = df

        os.makedirs("models", exist_ok=True)
        joblib.dump(self.km,     "models/kmeans.pkl")
        joblib.dump(self.scaler, "models/scaler.pkl")
        print(f"[{self.name}] persona distribution:")
        print(df["persona"].value_counts().to_string())
        return df

    def score(self, user: pd.Series) -> float:
        return float(PERSONA_SCORE.get(user.get("persona", "Warm"), 50))

    def run(self, df: pd.DataFrame) -> pd.Series:
        df = self.fit_predict(df)
        return super().run(df)
