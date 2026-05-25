import pandas as pd
from sklearn.preprocessing import MinMaxScaler
from . import BaseAgent

class BehaviourAgent(BaseAgent):
    def __init__(self):
        super().__init__("Behaviour Agent")
        self._scale_cols = ["avg_scroll_depth", "avg_clicks", "high_engagement_rate"]

    def _scale(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        scaler = MinMaxScaler()
        df[self._scale_cols] = scaler.fit_transform(df[self._scale_cols].fillna(0))
        return df

    def score(self, user: pd.Series) -> float:
        scroll  = user.get("avg_scroll_depth", 0)
        clicks  = user.get("avg_clicks", 0)
        bounce  = user.get("bounce_rate", 0.5)
        engage  = user.get("high_engagement_rate", 0)
        return (
            scroll  * 0.25
            + clicks  * 0.20
            + (1 - bounce) * 0.25
            + engage  * 0.30
        ) * 100

    def run(self, df: pd.DataFrame) -> pd.Series:
        df = self._scale(df)
        return super().run(df)
