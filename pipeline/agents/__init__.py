import pandas as pd
from abc import ABC, abstractmethod

class BaseAgent(ABC):
    def __init__(self, name: str):
        self.name = name

    @abstractmethod
    def score(self, user: pd.Series) -> float:
        pass

    def run(self, df: pd.DataFrame) -> pd.Series:
        print(f"[{self.name}] scoring {len(df)} users...")
        scores = df.apply(self.score, axis=1).clip(0, 100).round(2)
        print(f"[{self.name}] done — mean={scores.mean():.1f}  "
              f"min={scores.min():.1f}  max={scores.max():.1f}")
        return scores
