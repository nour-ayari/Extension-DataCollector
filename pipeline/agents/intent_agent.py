import pandas as pd
from sklearn.preprocessing import MinMaxScaler
from . import BaseAgent

class IntentAgent(BaseAgent):
    def __init__(self):
        super().__init__("Intent Agent")

    def _scale(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        scaler = MinMaxScaler()
        df["max_funnel_depth_scaled"] = scaler.fit_transform(
            df[["max_funnel_depth"]].fillna(0)
        )
        return df

    def score(self, user: pd.Series) -> float:
        funnel   = user.get("max_funnel_depth_scaled", 0)
        purchase = user.get("purchase_rate", 0)
        checkout = user.get("checkout_rate", 0)
        abandon  = user.get("cart_abandonment_rate", 0.5)
        return (
            funnel   * 0.35
            + purchase * 0.35
            + checkout * 0.15
            + (1 - abandon) * 0.15
        ) * 100

    def run(self, df: pd.DataFrame) -> pd.Series:
        df = self._scale(df)
        return super().run(df)
