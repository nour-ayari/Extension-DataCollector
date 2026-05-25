import pandas as pd
from . import BaseAgent

class RFMAgent(BaseAgent):
    def __init__(self):
        super().__init__("RFM Agent")

    def _add_quintiles(self, df: pd.DataFrame) -> pd.DataFrame:
        def quintile(series, reverse=False):
            labels = [5, 4, 3, 2, 1] if reverse else [1, 2, 3, 4, 5]
            try:
                return pd.qcut(series.rank(method="first"), q=5, labels=labels).astype(float)
            except ValueError:
                return pd.Series(3.0, index=series.index)  # all values identical → middle quintile

        df = df.copy()
        df["r_score"] = quintile(df["recency_days"], reverse=True)
        df["f_score"] = quintile(df["frequency"])
        df["m_score"] = quintile(df["monetary"])
        return df

    def score(self, user: pd.Series) -> float:
        r = user.get("r_score", 3)
        f = user.get("f_score", 3)
        m = user.get("m_score", 3)
        return (r * 0.30 + f * 0.30 + m * 0.40) / 5 * 100

    def run(self, df: pd.DataFrame) -> pd.Series:
        df = self._add_quintiles(df)
        self._scored_df = df  # orchestrator reads r/f/m_score from here
        return super().run(df)
