import pandas as pd

df = pd.read_csv("browsing_train.csv", nrows=50_000, low_memory=False)

print("=== COLUMNS ===")
print(df.columns.tolist())

print("\n=== event_type ===")
print(df["event_type"].value_counts(dropna=False).head(30))

print("\n=== product_action ===")
print(df["product_action"].value_counts(dropna=False).head(30))

print("\n=== (event_type, product_action) pairs ===")
pairs = df.groupby(["event_type", "product_action"], dropna=False).size()
print(pairs.sort_values(ascending=False).head(50))