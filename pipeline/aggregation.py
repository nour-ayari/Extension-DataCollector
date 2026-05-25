import pandas as pd

NOW = pd.Timestamp.now(tz="UTC")


_DEFAULT_COLUMNS = {
    "session_id": "",
    "event_type": "unknown",
    "revenue": 0,
    "duration": 0,
    "ed_max_scroll_pct": 0,
    "ed_click_count": 0,
    "pps_page_views": 0,
    "is_bounce": 0,
    "logged_in": 0,
    "deep_scroll": 0,
    "high_engagement": 0,
    "funnel_depth": 0,
    "cart_abandonned": 0,
    "is_purchaser": 0,
    "reached_checkout": 0,
    "orders": 0,
    "last_step": "unknown",
    "device": "unknown",
    "ed_action_source": "unknown",
    "address": "unknown",
    "nb_visits": 1,
    "is_weekend": 0,
    "hour_of_day": 12,
    "age": 0,
    "gender": "unknown",
}


def _ensure_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for column, default_value in _DEFAULT_COLUMNS.items():
        if column not in df.columns:
            df[column] = default_value
    return df

def aggregate_user_features(df: pd.DataFrame) -> pd.DataFrame:
    print("[aggregation] building user_features...")
    df = _ensure_columns(df)
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce", utc=True)

    user_features = df.groupby("client_id").agg(
        recency_days          = ("timestamp",       lambda x: (NOW - x.dropna().max()).days if x.notna().any() else 999),
        frequency             = ("session_id",      "nunique"),
        monetary              = ("revenue",         "sum"),
        total_events          = ("event_type",      "count"),
        avg_session_duration  = ("duration",        "mean"),
        avg_scroll_depth      = ("ed_max_scroll_pct", "mean"),
        avg_clicks            = ("ed_click_count",  "mean"),
        avg_page_views        = ("pps_page_views",  "mean"),
        bounce_rate           = ("is_bounce",       "mean"),
        login_rate            = ("logged_in",       "mean"),
        deep_scroll_rate      = ("deep_scroll",     "mean"),
        high_engagement_rate  = ("high_engagement", "mean"),
        max_funnel_depth      = ("funnel_depth",    "max"),
        avg_funnel_depth      = ("funnel_depth",    "mean"),
        cart_abandonment_rate = ("cart_abandonned", "mean"),
        purchase_rate         = ("is_purchaser",    "mean"),
        checkout_rate         = ("reached_checkout","mean"),
        total_orders          = ("orders",          "sum"),
        last_step             = ("last_step",       lambda x: x.dropna().iloc[-1] if x.notna().any() else "unknown"),
        device_mode           = ("device",          lambda x: x.mode().iloc[0] if not x.mode().empty else "unknown"),
        preferred_source      = ("ed_action_source",lambda x: x.mode().iloc[0] if not x.mode().empty else "unknown"),
        region                = ("address",         lambda x: x.mode().iloc[0] if not x.mode().empty else "unknown"),
        nb_visits             = ("nb_visits",       "max"),
        is_weekend_user       = ("is_weekend",      "mean"),
        preferred_hour        = ("hour_of_day",     lambda x: x.mode().iloc[0] if not x.mode().empty else 12),
        age                   = ("age",             "first"),
        gender                = ("gender",          "first"),
    ).reset_index()

    purchase_sessions = (
        df[df["is_purchaser"] == 1]
        .groupby("client_id")["session_id"]
        .nunique()
    )
    user_features["purchase_rate"] = (
        user_features["client_id"].map(purchase_sessions).fillna(0)
        / user_features["frequency"].replace(0, 1)
    )

    num_cols = user_features.select_dtypes(include="number").columns
    user_features[num_cols] = user_features[num_cols].fillna(0)

    print(f"[aggregation] done. {len(user_features)} unique users")
    return user_features
