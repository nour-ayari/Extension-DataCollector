from typing import Dict, List
import pandas as pd

CANONICAL_COLUMNS: List[str] = [
    "user_id",
    "session_id",
    "event_name",
    "event_timestamp",
    "country",
    "region",
    "city",
    "device",
    "source",
    "duration",
    "click_count",
    "scroll_pct",
    "page_type",
    "funnel_stage",
    "product_id",
    "product_name",
    "price",
    "quantity",
    "revenue",
    "orders",
    "cart_abandoned",
    "logged_in",
    "age",
    "gender",
    "nb_visits",
    "sequence",
    "page_views",
    "raw_source",
]

BQ_TO_CANONICAL: Dict[str, str] = {
    "client_id": "user_id",
    "session_id": "session_id",
    "event_type": "event_name",
    "timestamp": "event_timestamp",
    "country": "country",
    "region": "region",
    "device": "device",
    "ed_action_source": "source",
    "duration": "duration",
    "ed_click_count": "click_count",
    "ed_max_scroll_pct": "scroll_pct",
    "ed_page_type": "page_type",
    "ed_funnel_stage": "funnel_stage",
    "ed_product_id": "product_id",
    "ed_product_name": "product_name",
    "ed_price": "price",
    "ed_quantity": "quantity",
    "revenue": "revenue",
    "orders": "orders",
    "cart_abandoned": "cart_abandoned",
    "logged_in": "logged_in",
    "age": "age",
    "gender": "gender",
    "nb_visits": "nb_visits",
    "sequence": "sequence",
    "pps_page_views": "page_views",
}
SB_TO_CANONICAL: Dict[str, str] = {
    "client_id": "user_id",
    "session_id": "session_id",
    "event_type": "event_name",
    "timestamp": "event_timestamp",
    "region": "region",
    "device": "device",
    "ed_action_source": "source",
    "duration": "duration",
    "ed_click_count": "click_count",
    "ed_max_scroll_pct": "scroll_pct",
    "ed_page_type": "page_type",
    "ed_funnel_stage": "funnel_stage",
    "ed_product_id": "product_id",
    "ed_product_name": "product_name",
    "ed_price": "price",
    "ed_quantity": "quantity",
    "revenue": "revenue",
    "orders": "orders",
    "cart_abandoned": "cart_abandoned",
    "logged_in": "logged_in",
    "age": "age",
    "gender": "gender",
    "nb_visits": "nb_visits",
    "sequence": "sequence",
    "pps_page_views": "page_views",
}
TRACKED_GA4_TO_CANONICAL: Dict[str, str] = {
    "client_id":       "user_id",
    "session_id":      "session_id",
    "event_type":      "event_name",
    "timestamp":       "event_timestamp",
    "duration":        "duration",
    "logged_in":       "logged_in",
    "device":          "device",
    "gender":          "gender",
    "age":             "age",
    "nb_visits":       "nb_visits",
    "sequence":        "sequence",
    "orders":          "orders",
    "cart_abandonned": "cart_abandoned",
    "pages_per_session": "page_views",
    "ed_page_type":    "page_type",
    "ed_action_source": "source",
    "ed_funnel_stage": "funnel_stage",
    "region":          "region",
}


def _preprocess_tracked_ga4(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    if "event_description" in df.columns:
        ed = pd.json_normalize(
            df["event_description"].apply(lambda x: x if isinstance(x, dict) else {})
        )
        for src, dst in {
            "page_type":     "ed_page_type",
            "action_source": "ed_action_source",
            "funnel_stage":  "ed_funnel_stage",
        }.items():
            if src in ed.columns:
                df[dst] = ed[src].values
        df = df.drop(columns=["event_description"])
    if "order_description" in df.columns:
        od = pd.json_normalize(
            df["order_description"].apply(lambda x: x if isinstance(x, dict) else {})
        )
        if "total" in od.columns:
            df["revenue"] = pd.to_numeric(od["total"], errors="coerce")
        df = df.drop(columns=["order_description"])
    if "address" in df.columns and "region" not in df.columns:
        df["region"] = df["address"].apply(
            lambda x: x.split(",")[0].strip() if isinstance(x, str) and x else None
        )
    return df


def map_df_to_canonical(df: pd.DataFrame, source: str) -> pd.DataFrame:
    df = df.copy()

    if source == "bigquery_ga4":
        if "event_description" in df.columns:
            df = _preprocess_tracked_ga4(df)
            mapping = TRACKED_GA4_TO_CANONICAL
        else:
            mapping = BQ_TO_CANONICAL
    else:
        mapping = SB_TO_CANONICAL
    intersect = {k: v for k, v in mapping.items() if k in df.columns}
    df = df.rename(columns=intersect)
    for col in CANONICAL_COLUMNS:
        if col not in df.columns:
            df[col] = None
    if "raw_source" not in df.columns:
        df["raw_source"] = source
    else:
        df["raw_source"] = df["raw_source"].fillna(source)
    return df[CANONICAL_COLUMNS]
