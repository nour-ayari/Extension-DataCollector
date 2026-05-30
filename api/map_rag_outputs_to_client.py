import os
import json
import random
from pathlib import Path
from collections import defaultdict, Counter

from dotenv import load_dotenv
from supabase import create_client


# ==========================================================
# 1. CONFIG
# ==========================================================

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_KEY in .env")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

EVENTS_TABLE = "events_cleaned"

RAG_INPUT_PATH = Path("reports/rag_export/rag_output.json")
RAG_OUTPUT_PATH = Path("reports/rag_export/mapped_rag_output.json")
SUMMARY_OUTPUT_PATH = Path("reports/rag_export/client_message_summary.json")

MAX_EVENTS = 10000
TARGET_MESSAGES_PER_CLIENT = 3


# ==========================================================
# 2. INTENT → BEHAVIOR RULES
# ==========================================================

INTENT_TO_BEHAVIOR_RULES = {
    # Cart / checkout
    "add_product": ["product_view", "add_to_cart"],
    "remove_product": ["remove_from_cart", "cart_abandon"],
    "pay": ["checkout_started"],
    "payment_issue": ["checkout_abandon", "checkout_started"],
    "check_payment_methods": ["checkout_started", "checkout_abandon"],
    "shipping_costs": ["cart_abandon", "checkout_abandon"],
    "sales_period": ["promo_viewed", "cart_abandon", "checkout_abandon"],

    # Purchase / delivery
    "track_order": ["purchase_completed"],
    "track_delivery": ["purchase_completed"],
    "delivery_time": ["product_view", "purchase_completed"],
    "request_invoice": ["purchase_completed"],
    "order_history": ["purchase_completed", "page_engagement"],
    "cancel_order": ["purchase_completed", "checkout_started"],
    "change_order": ["purchase_completed", "checkout_started"],
    "return_product": ["purchase_completed"],
    "exchange_product": ["purchase_completed"],
    "request_refund": ["purchase_completed", "checkout_abandon"],
    "track_refund": ["purchase_completed"],

    # Post-purchase problems
    "damaged_delivery": ["purchase_completed"],
    "missing_item": ["purchase_completed"],
    "wrong_item": ["purchase_completed"],
    "product_issue": ["purchase_completed", "product_view"],

    # Product discovery
    "product_information": ["product_view", "search_performed"],
    "availability": ["search_performed", "product_view"],
    "check_refund_policy": ["product_view", "purchase_completed"],

    # Account / user
    "create_account": ["checkout_started", "checkout_abandon"],
    "change_account": ["page_engagement"],
    "recover_password": ["page_engagement"],
    "delete_account": ["page_engagement"],
    "request_right_to_rectification": ["page_engagement"],

    # Support / app
    "contact_human_agent": ["checkout_abandon", "cart_abandon", "page_engagement"],
    "technical_issue": ["checkout_abandon", "page_engagement"],
    "use_app": ["page_engagement"],

    # Store / feedback
    "store_location": ["page_view"],
    "store_opening_hours": ["page_view"],
    "submit_feedback": ["purchase_completed", "page_engagement"],
    "submit_product_idea": ["product_view", "search_performed"],
}


# ==========================================================
# 3. MORE SPECIFIC CONTEXT RULES
# ==========================================================

HIGH_RISK_INTENTS = {
    "contact_human_agent",
    "technical_issue",
    "payment_issue",
    "damaged_delivery",
    "missing_item",
    "wrong_item",
    "delete_account",
}

POST_PURCHASE_INTENTS = {
    "track_order",
    "track_delivery",
    "request_invoice",
    "return_product",
    "exchange_product",
    "request_refund",
    "track_refund",
    "damaged_delivery",
    "missing_item",
    "wrong_item",
    "product_issue",
}

CHECKOUT_INTENTS = {
    "pay",
    "payment_issue",
    "check_payment_methods",
    "shipping_costs",
    "sales_period",
    "contact_human_agent",
    "technical_issue",
}

PRODUCT_DISCOVERY_INTENTS = {
    "product_information",
    "availability",
    "submit_product_idea",
    "delivery_time",
    "check_refund_policy",
}


# ==========================================================
# 4. FETCH EVENTS
# ==========================================================

def fetch_events(limit=MAX_EVENTS):
    res = (
        supabase
        .table(EVENTS_TABLE)
        .select("*")
        .limit(limit)
        .execute()
    )
    return res.data


# ==========================================================
# 5. BUILD SESSION INDEX
# ==========================================================

def safe_json(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        return value
    return {}


def extract_abandon_reason(rows):
    for r in reversed(rows):
        order_desc = r.get("order_description")
        if isinstance(order_desc, dict):
            reason = order_desc.get("abandon_reason")
            if reason:
                return reason
    return None


def extract_tracking_number(rows):
    for r in reversed(rows):
        order_desc = r.get("order_description")
        if isinstance(order_desc, dict):
            tracking = order_desc.get("tracking_number")
            if tracking:
                return tracking
    return None


def extract_persona(rows):
    for r in reversed(rows):
        event_desc = r.get("event_description")
        if isinstance(event_desc, dict) and event_desc.get("persona"):
            return event_desc.get("persona")

        order_desc = r.get("order_description")
        if isinstance(order_desc, dict):
            snap = order_desc.get("customer_snapshot")
            if isinstance(snap, dict) and snap.get("persona"):
                return snap.get("persona")

    return None


def build_session_index(events):
    grouped = defaultdict(list)

    for e in events:
        client_id = e.get("client_id")
        session_id = e.get("session_id")

        if not client_id or not session_id:
            continue

        grouped[(client_id, session_id)].append(e)

    sessions = []

    for (client_id, session_id), rows in grouped.items():
        rows = sorted(rows, key=lambda x: str(x.get("timestamp") or ""))

        event_types = [r.get("event_type") for r in rows if r.get("event_type")]
        event_counter = Counter(event_types)

        nb_visits = max([r.get("nb_visits") or 0 for r in rows])
        cart_abandonned = any(r.get("cart_abandonned") is True for r in rows)

        last = rows[-1]

        orders_present = any(bool(r.get("orders")) for r in rows)
        has_purchase = "purchase_completed" in event_types
        has_checkout_abandon = "checkout_abandon" in event_types
        has_cart_abandon = "cart_abandon" in event_types
        has_search = "search_performed" in event_types
        has_product_views = event_counter.get("product_view", 0) >= 2

        session = {
            "client_id": client_id,
            "session_id": session_id,
            "event_types": event_types,
            "event_counter": dict(event_counter),
            "last_event": event_types[-1] if event_types else None,
            "nb_visits": nb_visits,
            "device": last.get("device"),
            "logged_in": last.get("logged_in"),
            "age": last.get("age"),
            "gender": last.get("gender"),
            "address": last.get("address"),
            "cart_abandonned": cart_abandonned,
            "abandon_reason": extract_abandon_reason(rows),
            "tracking_number": extract_tracking_number(rows),
            "persona": extract_persona(rows),
            "orders_present": orders_present,
            "has_purchase": has_purchase,
            "has_checkout_abandon": has_checkout_abandon,
            "has_cart_abandon": has_cart_abandon,
            "has_search": has_search,
            "has_product_views": has_product_views,
            "raw_events": rows,
        }

        sessions.append(session)

    return sessions


# ==========================================================
# 6. BUILD CLIENT INDEX
# ==========================================================

def build_client_index(sessions):
    client_index = defaultdict(list)

    for session in sessions:
        client_index[session["client_id"]].append(session)

    return client_index


# ==========================================================
# 7. SCORING
# ==========================================================

def score_session_for_intent(session, intent):
    expected_events = INTENT_TO_BEHAVIOR_RULES.get(intent, [])
    event_types = session["event_types"]

    score = 0
    reasons = []

    # Base event matching
    for ev in expected_events:
        if ev in event_types:
            score += 10
            reasons.append(f"matched_event:{ev}")

    # Post-purchase support should prefer buyers
    if intent in POST_PURCHASE_INTENTS and session["has_purchase"]:
        score += 12
        reasons.append("post_purchase_intent_with_purchase")

    # Checkout problems should prefer checkout abandonment
    if intent in CHECKOUT_INTENTS and session["has_checkout_abandon"]:
        score += 10
        reasons.append("checkout_intent_with_checkout_abandon")

    # Product discovery should prefer search/product views
    if intent in PRODUCT_DISCOVERY_INTENTS and session["has_product_views"]:
        score += 8
        reasons.append("product_discovery_with_repeated_views")

    if intent in PRODUCT_DISCOVERY_INTENTS and session["has_search"]:
        score += 8
        reasons.append("product_discovery_with_search")

    # Abandon reasons
    if intent == "payment_issue" and session["abandon_reason"] == "payment_declined":
        score += 20
        reasons.append("specific_abandon_reason:payment_declined")

    if intent == "technical_issue" and session["abandon_reason"] == "complicated_checkout":
        score += 20
        reasons.append("specific_abandon_reason:complicated_checkout")

    if intent == "sales_period" and session["abandon_reason"] in ["price_too_high", "found_better_deal"]:
        score += 20
        reasons.append(f"specific_abandon_reason:{session['abandon_reason']}")

    if intent == "shipping_costs" and session["abandon_reason"] == "shipping_too_expensive":
        score += 20
        reasons.append("specific_abandon_reason:shipping_too_expensive")

    # Tracking number
    if intent == "track_delivery" and session["tracking_number"]:
        score += 15
        reasons.append("tracking_number_available")

    # Logged-in / account rules
    if intent == "create_account" and session["logged_in"] is False:
        score += 8
        reasons.append("not_logged_in")

    if intent in ["change_account", "order_history", "request_invoice"] and session["logged_in"] is True:
        score += 6
        reasons.append("logged_in_user")

    # High-risk behavior
    if intent in HIGH_RISK_INTENTS and session["nb_visits"] >= 5:
        score += 6
        reasons.append("high_visits_high_risk_intent")

    if intent == "contact_human_agent" and (
        session["has_checkout_abandon"] or session["has_cart_abandon"]
    ):
        score += 10
        reasons.append("support_needed_after_abandonment")

    # Mobile/app
    device = str(session.get("device") or "").lower()
    if intent in ["use_app", "technical_issue"] and "mobile" in device:
        score += 6
        reasons.append("mobile_context")

    # General fallback
    if event_types:
        score += 1
        reasons.append("fallback_non_empty_session")

    return score, reasons


# ==========================================================
# 8. CLIENT-AWARE ASSIGNMENT
# ==========================================================

def get_intent_from_rag_item(item):
    intent = item.get("ground_truth", {}).get("label_name")

    if not intent:
        intent = item.get("intent", {}).get("predicted")

    return intent


def choose_best_session_for_client(intent, client_sessions):
    scored = []

    for session in client_sessions:
        score, reasons = score_session_for_intent(session, intent)
        if score > 0:
            scored.append((score, reasons, session))

    if not scored:
        return None, []

    scored.sort(key=lambda x: x[0], reverse=True)

    top_score = scored[0][0]
    best_candidates = [
        (reasons, session)
        for score, reasons, session in scored
        if score == top_score
    ]

    reasons, session = random.choice(best_candidates)
    return session, reasons


def choose_client_for_intent(intent, client_index, client_message_counts):
    candidates = []

    for client_id, client_sessions in client_index.items():
        best_session, reasons = choose_best_session_for_client(intent, client_sessions)

        if not best_session:
            continue

        score, _ = score_session_for_intent(best_session, intent)

        # Encourage multiple messages per same client until target is reached
        current_count = client_message_counts[client_id]

        if current_count < TARGET_MESSAGES_PER_CLIENT:
            score += 15
        elif current_count < TARGET_MESSAGES_PER_CLIENT + 2:
            score += 5
        else:
            score -= current_count

        candidates.append((score, client_id, best_session, reasons))

    if not candidates:
        all_clients = list(client_index.keys())
        fallback_client = random.choice(all_clients)
        fallback_session = random.choice(client_index[fallback_client])
        return fallback_client, fallback_session, ["fallback_random_client"]

    candidates.sort(key=lambda x: x[0], reverse=True)

    top_score = candidates[0][0]
    best_candidates = [c for c in candidates if c[0] == top_score]

    _, client_id, session, reasons = random.choice(best_candidates)
    return client_id, session, reasons


# ==========================================================
# 9. ENRICH RAG ITEM
# ==========================================================

def enrich_rag_item(item, session, match_reasons):
    intent = get_intent_from_rag_item(item)

    enriched = dict(item)

    enriched["client_id"] = session["client_id"]
    enriched["session_id"] = session["session_id"]

    enriched["source_behavior"] = {
        "matched_by_intent": intent,
        "match_reasons": match_reasons,
        "event_types": session["event_types"],
        "event_counter": session["event_counter"],
        "last_event": session["last_event"],
        "nb_visits": session["nb_visits"],
        "device": session["device"],
        "logged_in": session["logged_in"],
        "age": session["age"],
        "gender": session["gender"],
        "address": session["address"],
        "persona": session["persona"],
        "cart_abandonned": session["cart_abandonned"],
        "abandon_reason": session["abandon_reason"],
        "tracking_number": session["tracking_number"],
        "has_purchase": session["has_purchase"],
        "has_checkout_abandon": session["has_checkout_abandon"],
        "has_cart_abandon": session["has_cart_abandon"],
        "has_search": session["has_search"],
        "has_product_views": session["has_product_views"],
    }

    return enriched


# ==========================================================
# 10. SUMMARY
# ==========================================================

def build_summary(mapped):
    summary = defaultdict(lambda: {
        "message_count": 0,
        "sessions": set(),
        "intents": Counter(),
    })

    for item in mapped:
        client_id = item.get("client_id")
        session_id = item.get("session_id")
        intent = get_intent_from_rag_item(item)

        summary[client_id]["message_count"] += 1
        summary[client_id]["sessions"].add(session_id)
        summary[client_id]["intents"][intent] += 1

    serializable = {}

    for client_id, data in summary.items():
        serializable[client_id] = {
            "message_count": data["message_count"],
            "sessions": list(data["sessions"]),
            "intents": dict(data["intents"]),
        }

    return serializable


# ==========================================================
# 11. MAIN
# ==========================================================

def main():
    random.seed(42)

    print("Step 1/6 - Loading Supabase events...")
    events = fetch_events()
    print(f"Events loaded: {len(events)}")

    print("Step 2/6 - Building session index...")
    sessions = build_session_index(events)
    print(f"Sessions indexed: {len(sessions)}")

    if not sessions:
        raise RuntimeError("No sessions found. Check client_id/session_id in events table.")

    print("Step 3/6 - Building client index...")
    client_index = build_client_index(sessions)
    print(f"Clients indexed: {len(client_index)}")

    print("Step 4/6 - Loading rag_output.json...")
    with open(RAG_INPUT_PATH, "r", encoding="utf-8") as f:
        rag_data = json.load(f)
    print(f"RAG items loaded: {len(rag_data)}")

    print("Step 5/6 - Mapping RAG messages to realistic clients/sessions...")
    mapped = []
    client_message_counts = Counter()

    # Shuffle to avoid grouping all same intents first
    random.shuffle(rag_data)

    for item in rag_data:
        intent = get_intent_from_rag_item(item)

        client_id, session, reasons = choose_client_for_intent(
            intent=intent,
            client_index=client_index,
            client_message_counts=client_message_counts
        )

        enriched_item = enrich_rag_item(item, session, reasons)

        mapped.append(enriched_item)
        client_message_counts[client_id] += 1

    print("Step 6/6 - Saving outputs...")
    RAG_OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    with open(RAG_OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(mapped, f, indent=2, ensure_ascii=False)

    summary = build_summary(mapped)

    with open(SUMMARY_OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    print(f"Mapped RAG output saved to: {RAG_OUTPUT_PATH}")
    print(f"Client summary saved to: {SUMMARY_OUTPUT_PATH}")
    print(f"Mapped rows: {len(mapped)}")
    print(f"Clients used: {len(summary)}")

    top_clients = sorted(
        summary.items(),
        key=lambda x: x[1]["message_count"],
        reverse=True
    )[:10]

    print("\nTop clients by mapped messages:")
    for client_id, data in top_clients:
        print(
            f"- {client_id}: "
            f"{data['message_count']} messages, "
            f"{len(data['sessions'])} sessions, "
            f"intents={data['intents']}"
        )


if __name__ == "__main__":
    main()