from __future__ import annotations

from pathlib import Path
import sys
import os
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.agent3 import seed_from_coveo as s


def main():
    sup = s._create_supabase_client()
    # fetch a moderate batch and pick the first session
    rows = s._fetch_rows(sup, s.SOURCE_TABLE, "session_id, event_name, product_action, raw_payload, event_timestamp", batch_size=1000)
    if not rows:
        print("No raw rows found in SOURCE_TABLE")
        return

    # find a session id with at least one row
    session_ids = [r.get("session_id") for r in rows if r.get("session_id")]
    if not session_ids:
        print("No session_id values found")
        return
    session_id = session_ids[0]

    session_rows = [r for r in rows if r.get("session_id") == session_id]
    print(f"Selected session_id: {session_id} with {len(session_rows)} raw rows\n")

    print("RAW ROWS (truncated):")
    for r in session_rows[:20]:
        rp = r.get("raw_payload")
        print({
            "event_name": r.get("event_name"),
            "product_action": r.get("product_action"),
            "raw_payload": rp if isinstance(rp, dict) else str(rp)[:200],
            "event_timestamp": r.get("event_timestamp"),
        })

    # Build df with same normalization logic used by the seeder
    records = []
    for r in session_rows:
        raw_payload = r.get("raw_payload") or {}
        payload_text = ""
        if isinstance(raw_payload, dict):
            payload_text = " ".join(str(raw_payload.get(key, "")) for key in ["event_name", "event_type", "product_action", "product_sku", "action"]) 
        norm = s._normalize_event_name(r.get("event_name"), r.get("product_action"), payload_text)
        if norm is None:
            continue
        records.append({
            "session_id": r.get("session_id"),
            "event_name": norm,
            "event_timestamp": int(r.get("event_timestamp") or 0),
        })

    if not records:
        print("No normalized events for this session")
        return

    df = pd.DataFrame(records)
    print("\nNORMALIZED EVENTS (in order):")
    print(df.sort_values("event_timestamp")["event_name"].tolist())

    agg = s._aggregate_sessions(df)
    print("\nAGGREGATED SESSION ROW:")
    print(agg.to_dict(orient="records"))


if __name__ == "__main__":
    main()
