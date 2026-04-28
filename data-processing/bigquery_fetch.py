import os
import uuid
import random
from datetime import datetime, timedelta

import numpy as np
import math
import pandas as pd
from dotenv import load_dotenv
from google.cloud import bigquery
from supabase import create_client

load_dotenv()

PROJECT_ID = os.environ.get("GCP_PROJECT_ID")
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
GA4_START = os.environ.get("GA4_START", "20201101")
GA4_END = os.environ.get("GA4_END", "20211231")
GA4_LIMIT = int(os.environ.get("GA4_LIMIT", "1000000"))

QUERY = f"""
SELECT
  user_pseudo_id AS client_id,
  CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING) AS session_id,
  event_name AS event_type,
  TIMESTAMP_MICROS(event_timestamp) AS timestamp,
  geo.region AS region,
  geo.country AS country,
  device.category AS device,
  ecommerce.purchase_revenue AS revenue,
  traffic_source.source AS ed_action_source,
  -- map common event_params to ed_ prefixed columns so BigQuery rows match Supabase flattened shape
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_type') AS ed_page_type,
  (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'click_count') AS ed_click_count,
  (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'max_scroll_pct') AS ed_max_scroll_pct,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'action_location') AS ed_action_location,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'funnel_stage') AS ed_funnel_stage,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'product_id') AS ed_product_id,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'product_name') AS ed_product_name,
  (SELECT value.double_value FROM UNNEST(event_params) WHERE key = 'price') AS ed_price,
  (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'quantity') AS ed_quantity,
  (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'session_engaged') AS logged_in
FROM
  `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
WHERE
  _TABLE_SUFFIX BETWEEN '{GA4_START}' AND '{GA4_END}'
LIMIT {GA4_LIMIT}
"""


def fetch_ga4() -> pd.DataFrame:
  client = bigquery.Client(project=PROJECT_ID)
  df = client.query(QUERY).to_dataframe()
  df = df.rename(columns={
    'ed_action_source': 'ed_action_source'
  })

  df['source'] = 'bigquery_ga4'
  expected = [
    'client_id','session_id','event_type','timestamp','duration','logged_in','device','region',
    'ed_click_count','ed_max_scroll_pct','ed_action_source','ed_page_type',
    'orders','revenue','cart_abandoned','nb_visits','pps_page_views',
    'sequence','is_bounce','age','gender','source','rfm_score','conversion_score'
  ]
  for col in expected:
    if col not in df.columns:
      df[col] = None
  df['ed_click_count'] = pd.to_numeric(df['ed_click_count'], errors='coerce')
  df['ed_max_scroll_pct'] = pd.to_numeric(df['ed_max_scroll_pct'], errors='coerce')
  df['ed_price'] = pd.to_numeric(df.get('ed_price'), errors='coerce')
  df['ed_quantity'] = pd.to_numeric(df.get('ed_quantity'), errors='coerce')
  df['revenue'] = pd.to_numeric(df.get('revenue'), errors='coerce').fillna(0)

  return df


def create_supabase_client():
  if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in environment")
  return create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_supabase_events(table: str = "events") -> pd.DataFrame:
  supabase = create_supabase_client()
  resp = supabase.table(table).select("*").execute()

  # Handle different return shapes from supabase client versions
  data = None
  try:
    if hasattr(resp, "data"):
      data = resp.data
    elif isinstance(resp, dict) and "data" in resp:
      data = resp["data"]
    elif isinstance(resp, list):
      data = resp
    else:
      data = list(resp)
  except Exception:
    data = None

  if data is None:
    raise RuntimeError("Unexpected Supabase response format when fetching events")

  if not data:
    return pd.DataFrame()

  return pd.DataFrame(data)


def flatten_supabase(df: pd.DataFrame) -> pd.DataFrame:
  df = df.copy()

  def safe_flatten(df_local: pd.DataFrame, col: str, prefix: str) -> pd.DataFrame:
    if col not in df_local.columns:
      return df_local
    # ensure dicts
    expanded = df_local[col].apply(lambda x: x if isinstance(x, dict) else {})
    flat = pd.json_normalize(expanded)
    if flat.empty:
      df_local = df_local.drop(columns=[col])
      return df_local
    flat.columns = [f"{prefix}_{c}" for c in flat.columns]
    return pd.concat([df_local.drop(columns=[col]), flat], axis=1)

  df = safe_flatten(df, "event_description", "ed")
  df = safe_flatten(df, "pages_per_session", "pps")
  df["rfm_score"] = None
  df["conversion_score"] = None
  price = df.get("ed_price", pd.Series(0, index=df.index))
  qty = df.get("ed_quantity", pd.Series(0, index=df.index))
  if not isinstance(price, pd.Series):
    price = pd.Series(price, index=df.index)
  if not isinstance(qty, pd.Series):
    qty = pd.Series(qty, index=df.index)
  price = pd.to_numeric(price, errors="coerce").fillna(0)
  qty = pd.to_numeric(qty, errors="coerce").fillna(0)
  df["revenue"] = price * qty

  return df


REGIONS = ["Tunis", "Sfax", "Sousse", "Béja", "Nabeul"]
DEVICES = ["desktop", "mobile", "tablet"]
SEQUENCES = [
  "home → search → product_view → add_to_cart → checkout → purchase",
  "home → product_view → add_to_cart → cart_view → checkout_abandon",
  "home → search → product_view → bounce",
  "home → search → product_view → product_view → add_to_cart → remove_from_cart → add_to_cart → purchase",
]


def make_user(i):
  uid = f"synth_{uuid.uuid4().hex[:12]}"
  age = int(np.random.normal(35, 10))
  age = max(18, min(70, age))
  nb_visits = random.randint(1, 30)
  revenue = round(random.uniform(0, 500), 2) if random.random() > 0.4 else 0
  seq = random.choice(SEQUENCES)
  purchased = "purchase" in seq
  return {
    "client_id": uid,
    "session_id": f"sess_{uuid.uuid4().hex[:12]}",
    "event_type": "page_engagement",
    "duration": random.randint(10, 300),
    "logged_in": random.random() > 0.4,
    "ed_page_type": random.choice(["product_view", "home", "cart", "checkout"]),
    "ed_click_count": random.randint(1, 20),
    "ed_max_scroll_pct": random.randint(10, 100),
    "ed_action_source": random.choice(["organic", "paid", "email", "direct"]),
    "ed_action_location": f"https://example-shop.com/{random.choice(['tn','fr','dz'])}",
    "orders": int(purchased),
    "revenue": revenue if purchased else 0,
    "cart_abandoned": (not purchased) and (random.random() > 0.5),
    "nb_visits": nb_visits,
    "pps_page_views": random.randint(1, 20),
    "device": random.choice(DEVICES),
    "sequence": seq,
    "is_bounce": "bounce" in seq,
    "age": age,
    "gender": random.choice(["M", "F"]),
    "region": random.choice(REGIONS),
    "timestamp": (datetime.now() - timedelta(days=random.randint(0, 90))).isoformat(),
    "source": "synthetic",
    "rfm_score": None,
    "conversion_score": None,
  }


def generate_synthetic(n: int = 5000) -> pd.DataFrame:
  return pd.DataFrame([make_user(i) for i in range(n)])


UNIFIED_COLS = [
  "client_id", "session_id", "event_type", "timestamp",
  "duration", "logged_in", "device", "region",
  "ed_click_count", "ed_max_scroll_pct", "ed_action_source", "ed_page_type",
  "orders", "revenue", "cart_abandoned", "nb_visits", "pps_page_views",
  "sequence", "is_bounce", "age", "gender",
  "source", "rfm_score", "conversion_score"
]


def align(df: pd.DataFrame) -> pd.DataFrame:
  df = df.copy()
  for col in UNIFIED_COLS:
    if col not in df.columns:
      df[col] = None
  return df[UNIFIED_COLS]


def merge_sources(df_sup: pd.DataFrame, df_bq: pd.DataFrame, df_synth: pd.DataFrame) -> pd.DataFrame:
  return pd.concat([align(df_sup), align(df_bq), align(df_synth)], ignore_index=True).drop_duplicates(subset=["client_id", "session_id"])


def push_unified_to_supabase(df_unified: pd.DataFrame, table: str = "unified_events", batch: int = 500):
  supabase = create_supabase_client()
  records = df_unified.where(pd.notnull(df_unified), None).to_dict(orient="records")
  for i in range(0, len(records), batch):
    batch_records = records[i:i+batch]
    supabase.table(table).upsert(batch_records).execute()
    print(f"Inserted rows {i} to {i+len(batch_records)}")


def score_qcut(s: pd.Series, ascending: bool = True, bins: int = 5) -> pd.Series:
  s = s.fillna(0)
  try:
    labels = list(range(1, bins + 1))
    if not ascending:
      labels = labels[::-1]
    return pd.qcut(s.rank(method='first'), q=bins, labels=labels).astype(int)
  except Exception:
    # fallback to rank-based cut
    ranked = s.rank(method='first')
    return pd.cut(ranked, bins, labels=list(range(1, bins + 1))).astype(int)


def compute_rfm(df_unified: pd.DataFrame, reference_date: datetime = None) -> pd.DataFrame:
  df = df_unified.copy()
  # normalize timestamps to UTC to avoid mixing tz-aware and tz-naive values
  df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce", utc=True)
  if reference_date is None:
    reference_date = df["timestamp"].max() if not df["timestamp"].isna().all() else pd.Timestamp.now(tz="UTC")

  purchases = df[df["revenue"].notnull() & (df["revenue"] > 0)].copy()
  if purchases.empty:
    return pd.DataFrame(columns=["client_id", "recency", "frequency", "monetary", "r_score", "f_score", "m_score", "rfm_score"])

  agg = purchases.groupby("client_id").agg(
    recency_days=("timestamp", lambda x: (reference_date - x.max()).days),
    frequency=("timestamp", "count"),
    monetary=("revenue", "sum")
  ).reset_index()

  agg["r_score"] = score_qcut(agg["recency_days"], ascending=False)
  agg["f_score"] = score_qcut(agg["frequency"], ascending=True)
  agg["m_score"] = score_qcut(agg["monetary"], ascending=True)

  agg["rfm_score"] = agg["r_score"] * 100 + agg["f_score"] * 10 + agg["m_score"]

  return agg


def upsert_rfm_to_supabase(rfm_df: pd.DataFrame, table: str = "rfm_scores", batch: int = 500):
  if rfm_df.empty:
    print("No RFM to upsert.")
    return
  supabase = create_supabase_client()
  records = rfm_df.to_dict(orient="records")

  def _sanitize_value(v, key=None):
    # unwrap numpy scalars
    try:
      if isinstance(v, np.generic):
        v = v.item()
    except Exception:
      pass

    # convert floats and guard NaN/inf
    if isinstance(v, float):
      if not math.isfinite(v):
        return None
      # monetary rounding
      if key == "monetary":
        return round(v, 2)
      return v

    # ints -> python int
    if isinstance(v, (np.integer,)):
      return int(v)

    # leave bool, None, str as is
    return v

  for rec in records:
    for k in list(rec.keys()):
      rec[k] = _sanitize_value(rec[k], key=k)
  for i in range(0, len(records), batch):
    try:
      supabase.table(table).upsert(records[i:i+batch]).execute()
      print(f"Upserted RFM rows {i} to {i+len(records[i:i+batch])}")
    except Exception as e:
      # Likely the table does not exist in Supabase schema
      print(f"Failed to upsert RFM rows: {e}")
      print("")
      print("It looks like the target table does not exist in Supabase. Create it with the SQL below in the Supabase SQL editor:")
      print("")
      create_table_sql = f"""
CREATE TABLE IF NOT EXISTS public.{table} (
  client_id TEXT PRIMARY KEY,
  recency_days INTEGER,
  frequency INTEGER,
  monetary NUMERIC,
  r_score INTEGER,
  f_score INTEGER,
  m_score INTEGER,
  rfm_score INTEGER
);
"""
      print(create_table_sql)
      print("After creating the table, re-run the script to upsert RFM results.")
      return


if __name__ == "__main__":
  try:
    df_bq = fetch_ga4()
    print(f"GA4 shape: {df_bq.shape}")
  except Exception as e:
    print(f"Could not fetch GA4: {e}")
    df_bq = pd.DataFrame(columns=UNIFIED_COLS)
  df_synth = generate_synthetic(2000)
  print(f"Synth shape: {df_synth.shape}")

  try:
    df_sup = fetch_supabase_events()
    df_sup = flatten_supabase(df_sup)
    print(f"Supabase events: {df_sup.shape}")
  except Exception as e:
    print(f"Could not fetch Supabase events: {e}")
    df_sup = pd.DataFrame(columns=UNIFIED_COLS)

  df_unified = merge_sources(df_sup, df_bq, df_synth)
  print(f"Unified shape: {df_unified.shape}")

  rfm = compute_rfm(df_unified)
  print(f"RFM rows: {rfm.shape[0]}")
  print(rfm.head(5))

  if SUPABASE_URL and SUPABASE_KEY and not rfm.empty:
    upsert_rfm_to_supabase(rfm)
