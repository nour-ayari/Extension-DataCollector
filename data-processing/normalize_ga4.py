"""GA4 BigQuery → Supabase tracked events schema normalization.

Handles safe Python-based flattening of GA4 event_params (Arrow structs or
list-of-dicts) and maps raw GA4 rows to the canonical Supabase tracked schema.

Critical design rules:
- NEVER call .get() on a value before confirming it is a dict (_to_py first)
- NEVER use `if not event_params` (numpy ambiguity) — use `len(...) == 0`
- ALWAYS convert pyarrow scalars with _to_py() before dict access
- ALL session-level features (is_bounce, cart_abandonned, sequence,
  pages_per_session) are computed post-hoc in _compute_session_features()
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pandas as pd


TRACKED_COLS = [
    "client_id",
    "session_id",
    "event_type",
    "timestamp",
    "duration",
    "logged_in",
    "event_description",
    "order_description",
    "orders",
    "nb_visits",
    "address",
    "gender",
    "age",
    "device",
    "sequence",
    "is_bounce",
    "cart_abandonned",
    "pages_per_session",
]


def _to_py(val: Any) -> Any:
    """Convert pyarrow scalar / struct to a Python-native type if needed."""
    if hasattr(val, "as_py"):
        return val.as_py()
    return val


def flatten_event_params(event_params: Any) -> dict:
    """
    Safely flatten a GA4 event_params column cell.

    Accepts pyarrow list-of-structs, plain list-of-dicts, None/NA, and
    empty arrays. Never raises; returns {} on any unexpected input.
    """
    result: dict = {}
    if event_params is None:
        return result

    try:
        ep = _to_py(event_params)
    except Exception:
        return result

    if ep is None:
        return result

    try:
        length = len(ep)
    except TypeError:
        return result

    if length == 0:
        return result

    for p in ep:
        try:
            p = _to_py(p)
            if not isinstance(p, dict):
                continue
            key = p.get("key")
            if not key:
                continue
            val_obj = p.get("value")
            if val_obj is None:
                continue
            val_obj = _to_py(val_obj)
            if not isinstance(val_obj, dict):
                continue
            for vtype in ("string_value", "int_value", "float_value", "double_value"):
                v = val_obj.get(vtype)
                if v is not None:
                    result[key] = v
                    break
        except Exception:
            continue

    return result


def flatten_items(items: Any) -> list:
    """
    Safely convert GA4 items column cell (Arrow list-of-structs) to plain dicts.
    Never raises; returns [] on any unexpected input.
    """
    if items is None:
        return []

    try:
        items_py = _to_py(items)
    except Exception:
        return []

    if items_py is None:
        return []

    try:
        if len(items_py) == 0:
            return []
    except TypeError:
        return []

    result = []
    for item in items_py:
        try:
            item = _to_py(item)
            if isinstance(item, dict):
                result.append({k: v for k, v in item.items() if v is not None})
        except Exception:
            continue
    return result


def _us_to_iso(ts: Any) -> str | None:
    """Convert microseconds-since-epoch integer to ISO-8601 UTC string."""
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(int(ts) / 1_000_000, tz=timezone.utc).isoformat()
    except Exception:
        return None


def _normalize_row(row: dict, params: dict, items: list) -> dict:
    """Map a single raw GA4 row + flattened params to the tracked event shape."""
    client_id = row.get("client_id") or row.get("user_pseudo_id")

    session_id_raw = params.get("ga_session_id")
    try:
        session_id = str(int(session_id_raw)) if session_id_raw is not None else None
    except (TypeError, ValueError):
        session_id = str(session_id_raw) if session_id_raw else None

    event_type = row.get("event_name")
    ts_raw = row.get("event_timestamp")
    timestamp = (
        _us_to_iso(ts_raw)
        if isinstance(ts_raw, (int, float))
        else str(ts_raw) if ts_raw else None
    )

    session_engaged = params.get("session_engaged")
    try:
        logged_in = int(session_engaged) == 1
    except (TypeError, ValueError):
        logged_in = False

    device = row.get("device")
    region = row.get("region") or ""
    country = row.get("country") or ""
    address_parts = [p for p in [region, country] if p]
    address = ", ".join(address_parts) if address_parts else None

    event_description = {
        "event_name": event_type,
        "page_type": params.get("page_title") or params.get("page_location"),
        "action_source": row.get("traffic_source"),
        "action_location": params.get("page_location"),
        "funnel_stage": None,
        "query": params.get("search_term"),
    }

    purchase_revenue = row.get("purchase_revenue")
    transaction_id = params.get("transaction_id")
    currency = params.get("currency")
    categories = [item.get("item_category") for item in items if item.get("item_category")]

    order_description: dict | None = None
    if purchase_revenue is not None or items:
        order_description = {
            "total": float(purchase_revenue) if purchase_revenue is not None else None,
            "items_count": len(items),
            "transaction_id": transaction_id,
            "currency": currency,
            "categories": categories or None,
        }

    orders = items if items else None

    duration_raw = params.get("engagement_time_msec")
    try:
        duration = int(duration_raw) if duration_raw is not None else None
    except (TypeError, ValueError):
        duration = None

    nb_visits_raw = params.get("ga_session_number")
    try:
        nb_visits = int(nb_visits_raw) if nb_visits_raw is not None else None
    except (TypeError, ValueError):
        nb_visits = None

    return {
        "client_id": client_id,
        "session_id": session_id,
        "event_type": event_type,
        "timestamp": timestamp,
        "duration": duration,
        "logged_in": logged_in,
        "event_description": event_description,
        "order_description": order_description,
        "orders": orders,
        "nb_visits": nb_visits,
        "address": address,
        "gender": None,   # not available in GA4 public dataset
        "age": None,      # not available in GA4 public dataset
        "device": device,
        # session-level fields — filled by _compute_session_features
        "sequence": None,
        "is_bounce": None,
        "cart_abandonned": None,
        "pages_per_session": None,
    }


def _compute_session_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Derive session-level features and broadcast them to every event row.

    pages_per_session : count of page_view events per session_id
    is_bounce         : True when no event in the session has session_engaged==1
    cart_abandonned   : True when session had add_to_cart but no purchase
    sequence          : ordered list of event_type values (ascending timestamp)
    """
    if df.empty or "session_id" not in df.columns:
        return df

    df = df.copy()
    df["_ts_sort"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")

    # pages_per_session
    pps = (
        df[df["event_type"] == "page_view"]
        .groupby("session_id")
        .size()
        .rename("_pps")
    )
    df = df.join(pps, on="session_id")
    df["pages_per_session"] = df["_pps"].fillna(0).astype(int)
    df = df.drop(columns=["_pps"])

    # is_bounce: no event in the session was engaged
    any_engaged = (
        df.assign(_eng=df["logged_in"].astype(bool))
        .groupby("session_id")["_eng"]
        .any()
        .rename("_any_engaged")
    )
    df = df.join(any_engaged, on="session_id")
    df["is_bounce"] = ~df["_any_engaged"].fillna(False)
    df = df.drop(columns=["_any_engaged"])

    # cart_abandonned: add_to_cart present without a purchase
    had_cart = (
        df[df["event_type"] == "add_to_cart"]
        .groupby("session_id")
        .size()
        .gt(0)
        .rename("_had_cart")
    )
    had_purchase = (
        df[df["event_type"] == "purchase"]
        .groupby("session_id")
        .size()
        .gt(0)
        .rename("_had_purchase")
    )
    df = df.join(had_cart, on="session_id")
    df = df.join(had_purchase, on="session_id")
    df["cart_abandonned"] = (
        df["_had_cart"].fillna(False).infer_objects(copy=False) &
        ~df["_had_purchase"].fillna(False).infer_objects(copy=False)
    )
    df = df.drop(columns=["_had_cart", "_had_purchase"])

    # sequence: chronologically ordered event list per session
    seq = (
        df.sort_values("_ts_sort")
        .groupby("session_id", sort=False)["event_type"]
        .apply(list)
        .rename("_seq")
    )
    df = df.join(seq, on="session_id")
    df["sequence"] = df["_seq"]
    df = df.drop(columns=["_seq", "_ts_sort"])

    return df


def normalize_ga4_df(df: pd.DataFrame) -> pd.DataFrame:
    """
    Transform a raw GA4 DataFrame (from BigQuery) into the Supabase tracked
    events schema.

    event_params and items are flattened entirely in Python; no reliance on
    SQL-side UNNEST for individual event_params keys.
    Each column is converted from Arrow to Python via .tolist() before
    row-level processing to avoid Arrow struct ambiguity.
    """

    def _col(name: str, default: Any = None) -> list:
        if name in df.columns:
            return df[name].tolist()
        return [default] * len(df)

    client_ids   = _col("client_id")
    event_names  = _col("event_name")
    timestamps   = _col("event_timestamp")
    regions      = _col("region")
    countries    = _col("country")
    devices      = _col("device")
    t_sources    = _col("traffic_source")
    revenues     = _col("purchase_revenue")
    ep_list      = _col("event_params")
    items_list   = _col("items")

    total = len(df)
    print(f"[normalize_ga4] Normalizing {total:,} rows ...")
    rows = []
    for i in range(total):
        params = flatten_event_params(ep_list[i])
        items  = flatten_items(items_list[i])
        row_dict = {
            "client_id":        client_ids[i],
            "event_name":       event_names[i],
            "event_timestamp":  timestamps[i],
            "region":           regions[i],
            "country":          countries[i],
            "device":           devices[i],
            "traffic_source":   t_sources[i],
            "purchase_revenue": revenues[i],
        }
        rows.append(_normalize_row(row_dict, params, items))
        if (i + 1) % 1000 == 0 or (i + 1) == total:
            pct = (i + 1) / total * 100
            print(f"  {i + 1:,}/{total:,}  ({pct:.0f}%)", end="\r", flush=True)

    print()  # newline after the progress line
    print("[normalize_ga4] Building DataFrame ...")
    result = pd.DataFrame(rows)
    for col in TRACKED_COLS:
        if col not in result.columns:
            result[col] = None

    print("[normalize_ga4] Computing session features ...")
    result = _compute_session_features(result)
    return result[TRACKED_COLS]
