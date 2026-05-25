from __future__ import annotations

from typing import Any

import pandas as pd


PIPELINE_COLUMNS = [
    "client_id",
    "session_id",
    "timestamp",
    "event_type",
    "sequence",
    "duration",
    "ed_max_scroll_pct",
    "ed_click_count",
    "pps_page_views",
    "is_bounce",
    "logged_in",
    "deep_scroll",
    "high_engagement",
    "orders",
    "device",
    "ed_action_source",
    "address",
    "nb_visits",
    "age",
    "gender",
    "revenue",
    "ed_quantity",
    "ed_price",
]


def _first_non_null(*values: Any, default: Any = None) -> Any:
    for value in values:
        if value is not None:
            return value
    return default


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return default


def _as_sequence(value: Any, fallback: str | None = None) -> list[str]:
    if isinstance(value, list):
        sequence = [str(item).strip() for item in value if str(item).strip()]
        if sequence:
            return sequence
    elif isinstance(value, tuple):
        sequence = [str(item).strip() for item in value if str(item).strip()]
        if sequence:
            return sequence
    if fallback:
        return [fallback]
    return []


def _normalize_extension_event(item: dict[str, Any]) -> dict[str, Any]:
    properties = item.get("properties") if isinstance(item.get("properties"), dict) else {}
    context = item.get("context") if isinstance(item.get("context"), dict) else {}
    device = context.get("device") if isinstance(context.get("device"), dict) else {}
    page = context.get("page") if isinstance(context.get("page"), dict) else {}

    event_type = _first_non_null(
        item.get("event"),
        item.get("event_type"),
        properties.get("event_name"),
        properties.get("event_type"),
        default="unknown",
    )

    sequence = _as_sequence(
        _first_non_null(
            properties.get("sequence"),
            item.get("sequence"),
            default=None,
        ),
        fallback=str(event_type),
    )

    ed_max_scroll_pct = _first_non_null(
        properties.get("max_scroll_pct"),
        properties.get("depth_pct"),
        properties.get("scroll_pct"),
        default=0,
    )
    ed_click_count = _first_non_null(
        properties.get("click_count"),
        properties.get("clickCount"),
        default=0,
    )

    result = {
        "client_id": _first_non_null(
            item.get("client_id"),
            item.get("anonymousId"),
            properties.get("client_id"),
            default="unknown",
        ),
        "session_id": _first_non_null(
            item.get("session_id"),
            properties.get("session_id"),
            context.get("sessionId"),
            default="unknown",
        ),
        "timestamp": _first_non_null(
            item.get("sentAt"),
            item.get("timestamp"),
            properties.get("timestamp"),
            default=pd.Timestamp.utcnow().isoformat(),
        ),
        "event_type": str(event_type),
        "sequence": sequence,
        "duration": _first_non_null(properties.get("duration"), default=0),
        "ed_max_scroll_pct": ed_max_scroll_pct,
        "ed_click_count": ed_click_count,
        "pps_page_views": _first_non_null(
            properties.get("pages_per_session"),
            properties.get("page_views"),
            default=0,
        ),
        "is_bounce": _as_bool(properties.get("is_bounce"), default=False),
        "logged_in": _as_bool(properties.get("logged_in"), default=False),
        "deep_scroll": _as_bool(
            properties.get("deep_scroll"),
            default=float(ed_max_scroll_pct or 0) >= 70,
        ),
        "high_engagement": _as_bool(
            properties.get("high_engagement"),
            default=float(ed_click_count or 0) >= 5 and float(ed_max_scroll_pct or 0) >= 50,
        ),
        "orders": _first_non_null(
            properties.get("orders"),
            properties.get("quantity") if str(event_type) == "purchase_completed" else None,
            default=1 if str(event_type) in {"purchase_completed", "purchase"} else 0,
        ),
        "device": _first_non_null(
            properties.get("device_mode"),
            properties.get("device"),
            device.get("category"),
            default="unknown",
        ),
        "ed_action_source": _first_non_null(
            properties.get("traffic_source"),
            properties.get("source"),
            default="direct",
        ),
        "address": _first_non_null(
            properties.get("address"),
            properties.get("region"),
            properties.get("domain"),
            page.get("url"),
            default="unknown",
        ),
        "nb_visits": _first_non_null(properties.get("nb_visits"), default=1),
        "age": _first_non_null(properties.get("age"), default=0),
        "gender": _first_non_null(properties.get("gender"), default="unknown"),
        "revenue": _first_non_null(properties.get("revenue"), default=0),
        "ed_quantity": _first_non_null(properties.get("ed_quantity"), properties.get("quantity"), default=1),
        "ed_price": _first_non_null(properties.get("ed_price"), properties.get("price"), default=0),
    }

    return result


def canonicalize_payload(payload: Any) -> pd.DataFrame:
    if isinstance(payload, dict) and "events" in payload and isinstance(payload["events"], list):
        items = payload["events"]
    elif isinstance(payload, list):
        items = payload
    else:
        items = [payload]

    canonical_rows: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("Each event must be a JSON object")

        if "properties" in item or "event" in item or "sentAt" in item:
            canonical_rows.append(_normalize_extension_event(item))
        else:
            row = {column: item.get(column) for column in PIPELINE_COLUMNS}
            row["sequence"] = _as_sequence(row.get("sequence"), fallback=str(row.get("event_type") or "unknown"))
            row["event_type"] = str(row.get("event_type") or "unknown")
            row["timestamp"] = row.get("timestamp") or pd.Timestamp.utcnow().isoformat()
            row["client_id"] = row.get("client_id") or "unknown"
            row["session_id"] = row.get("session_id") or "unknown"
            row["device"] = row.get("device") or "unknown"
            row["ed_action_source"] = row.get("ed_action_source") or "direct"
            row["address"] = row.get("address") or "unknown"
            canonical_rows.append(row)

    return pd.DataFrame(canonical_rows, columns=PIPELINE_COLUMNS)