import pandas as pd
import numpy as np

NOW = pd.Timestamp.now(tz="UTC")

FUNNEL_MAP = {
    "session_start": 0, "first_visit": 0, "unknown": 0, "session_ended": 0,
    "page_view": 1, "scroll": 1, "scroll_depth": 1,
    "user_engagement": 1, "click": 1, "page_engagement": 1,
    "view_item_list": 2, "view_promotion": 2, "promo_viewed": 2,
    "search_performed": 2, "view_search_results": 2,
    "select_promotion": 2, "review_submitted": 2,
    "select_item": 3, "view_item": 3, "product_view": 3,
    "product_viewed": 3, "remove_from_cart": 3,
    "add_to_cart": 4, "cart_abandon": 4, "cart_abandoned": 4, "cart_abandonned": 4,
    "view_cart": 5,
    "begin_checkout": 6, "checkout_started": 6,
    "add_shipping_info": 6, "add_payment_info": 6,
    "checkout_abandon": 6, "checkout_abandoned": 6, "checkout_abandonned": 6,
    "purchase": 7, "purchase_completed": 7,
}

def parse_sequence(seq):
    if isinstance(seq, (list, np.ndarray)):
        return list(seq) if len(seq) > 0 else []
    try:
        if pd.isna(seq) or seq == "" or seq == "['']":
            return []
    except Exception:
        return []
    if isinstance(seq, str):
        seq = seq.strip().strip("[]\"'")
        if "→" in seq:
            return [s.strip() for s in seq.split("→")]
        if "->" in seq:
            return [s.strip() for s in seq.split("->")]
        if "," in seq:
            return [s.strip().strip("'\"") for s in seq.split(",")]
        return [seq]
    return []

def add_event_features(df: pd.DataFrame) -> pd.DataFrame:
    print("[feature_eng] starting...")
    df = df.copy()

    before = len(df)
    df = df[df["event_type"].notna()].reset_index(drop=True)
    dropped = before - len(df)
    if dropped:
        print(f"  dropped {dropped} rows with null event_type")

    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce", utc=True)

    if df["sequence"].dtype == object:
        df["sequence_parsed"] = df["sequence"].apply(parse_sequence)
    else:
        df["sequence_parsed"] = df["sequence"]

    df["sequence_len"] = df["sequence_parsed"].apply(len)
    df["last_step"]    = df["sequence_parsed"].apply(
        lambda x: x[-1].strip() if x else "unknown"
    )
    df["funnel_depth"] = df["sequence_parsed"].apply(
        lambda steps: max((FUNNEL_MAP.get(str(s).strip(), 0) for s in steps), default=0)
    )

    df["is_purchaser"]     = (df["orders"].fillna(0) > 0).astype(int)
    df["reached_checkout"] = df["funnel_depth"].ge(6).astype(int)
    df["deep_scroll"]      = df["ed_max_scroll_pct"].fillna(0).ge(70).astype(int)
    df["high_engagement"]  = (
        (df["ed_click_count"].fillna(0) >= 5) &
        (df["ed_max_scroll_pct"].fillna(0) >= 50)
    ).astype(int)

    df["recency_days_event"] = (NOW - df["timestamp"]).dt.days.fillna(999)

    df["timestamp"]   = df.groupby("session_id")["timestamp"].ffill()
    df["timestamp"]   = df.groupby("client_id")["timestamp"].ffill()
    df["hour_of_day"] = df["timestamp"].dt.hour.fillna(12).astype(int)
    df["day_of_week"] = df["timestamp"].dt.dayofweek.fillna(0).astype(int)
    df["is_weekend"]  = df["day_of_week"].isin([5, 6]).astype(int)

    price_col = df.get("ed_price",    pd.Series(0, index=df.index)).fillna(0)
    qty_col   = df.get("ed_quantity", pd.Series(1, index=df.index)).fillna(1)
    if "revenue" not in df.columns:
        df["revenue"] = price_col * qty_col
    else:
        df["revenue"] = df["revenue"].fillna(price_col * qty_col)

    print(f"[feature_eng] done. shape={df.shape}")
    print(f"  purchasers:       {df['is_purchaser'].sum()}")
    print(f"  reached checkout: {df['reached_checkout'].sum()}")
    print(f"  deep scroll:      {df['deep_scroll'].sum()}")
    print(f"  high engagement:  {df['high_engagement'].sum()}")
    return df
