"""
test_endpoint.py — End-to-end tests for Agent 3 /recommend and /feedback
Run AFTER seeding and AFTER starting the API server:
    uvicorn api:app --reload --port 8000

Usage:
    python test_endpoint.py                  # runs all tests
    python test_endpoint.py --case 3         # runs only test case 3
    python test_endpoint.py --direct         # calls run() directly (no HTTP, no server needed)
"""

import argparse
import json
import sys
import os

# ── Direct mode (no server needed) ──────────────────────────────────────────
def run_direct(cases):
    sys.path.insert(0, os.path.dirname(__file__))
    from recommendation_agent import run, AgentInput

    print("=" * 60)
    print("DIRECT MODE — calling run() without HTTP server")
    print("=" * 60)
    for i, case in enumerate(cases, 1):
        print(f"\n── Test {i}: {case['label']} ──")
        inp = AgentInput(
            user_id    = case["payload"]["user_id"],
            persona    = case["payload"]["persona"],
            sentiment  = case["payload"]["sentiment"],
            confidence = case["payload"]["confidence"],
            user_meta  = case["payload"].get("user_meta"),
        )
        try:
            result = run(inp)
            print(f"  action_type  : {result.action_type}")
            print(f"  channel      : {result.channel}")
            print(f"  urgency      : {result.urgency}")
            print(f"  subject_line : {result.subject_line}")
            print(f"  cta          : {result.cta}")
            print(f"  retrieved_k  : {result.retrieved_k}")
            print(f"  log_id       : {result.log_id}")
            print(f"  rationale    : {result.rationale}")
        except Exception as e:
            print(f"  ERROR: {e}")


# ── HTTP mode (server must be running) ──────────────────────────────────────
def run_http(cases, base_url="http://localhost:8000"):
    try:
        import requests
    except ImportError:
        print("pip install requests")
        sys.exit(1)

    print("=" * 60)
    print(f"HTTP MODE — hitting {base_url}")
    print("=" * 60)

    # Health check first
    try:
        r = requests.get(f"{base_url}/health", timeout=3)
        print(f"\n  /health → {r.status_code} {r.json()}\n")
    except Exception as e:
        print(f"\n  Server not reachable: {e}")
        print("  Start it with: uvicorn api:app --reload --port 8000")
        sys.exit(1)

    log_ids = []

    for i, case in enumerate(cases, 1):
        print(f"── Test {i}: {case['label']} ──")
        try:
            r = requests.post(
                f"{base_url}/recommend",
                json    = case["payload"],
                timeout = 30,
            )
            if r.status_code == 200:
                data = r.json()
                log_ids.append(data["log_id"])
                print(f"  ✓ {r.status_code}")
                print(f"  action_type  : {data['action_type']}")
                print(f"  channel      : {data['channel']}")
                print(f"  urgency      : {data['urgency']}")
                print(f"  subject_line : {data['subject_line']}")
                print(f"  body_copy    : {data['body_copy'][:80]}...")
                print(f"  cta          : {data['cta']}")
                print(f"  trigger_cond : {data['trigger_cond']}")
                print(f"  retrieved_k  : {data['retrieved_k']}")
                print(f"  log_id       : {data['log_id']}")
                print(f"  rationale    : {data['rationale']}")
            else:
                print(f"  ✗ {r.status_code}: {r.text}")
        except Exception as e:
            print(f"  ERROR: {e}")
        print()

    # Test feedback loop with the first successful log_id
    if log_ids:
        print("── Feedback loop test ──")
        log_id = log_ids[0]
        try:
            r = requests.post(
                f"{base_url}/feedback",
                json    = {"log_id": log_id, "converted": True},
                timeout = 10,
            )
            print(f"  /feedback log_id={log_id} converted=True → {r.status_code} {r.json()}")
        except Exception as e:
            print(f"  ERROR: {e}")


# ---------------------------------------------------------------------------
# Test cases — cover critical persona×sentiment combos
# ---------------------------------------------------------------------------

TEST_CASES = [
    {
        "label": "High Intent × Negative (exit overlay — highest stakes)",
        "payload": {
            "user_id":    "test-user-001",
            "persona":    "High Intent",
            "sentiment":  "Negative",
            "confidence": 0.87,
            "user_meta": {
                "age": 26, "gender": "F", "region": "Tunis",
                "nb_visits": 5, "max_funnel_depth": 6,
                "cart_abandonment_rate": 0.20, "avg_scroll_depth": 78.5,
                "avg_clicks": 9.2, "bounce_rate": 0.08,
                "purchase_rate": 0.30, "checkout_rate": 0.60,
                "frequency": 4, "monetary": 320.0, "recency_days": 1,
                "device_mode": "mobile", "preferred_source": "social",
            },
        },
    },
    {
        "label": "VIP × Negative (human escalation — critical urgency)",
        "payload": {
            "user_id":    "test-user-002",
            "persona":    "VIP",
            "sentiment":  "Negative",
            "confidence": 0.93,
            "user_meta": {
                "age": 42, "gender": "M", "region": "Sfax",
                "nb_visits": 18, "max_funnel_depth": 7,
                "cart_abandonment_rate": 0.10, "avg_scroll_depth": 85.0,
                "avg_clicks": 14.0, "bounce_rate": 0.03,
                "purchase_rate": 0.80, "checkout_rate": 0.90,
                "frequency": 12, "monetary": 1850.0, "recency_days": 0,
                "device_mode": "desktop", "preferred_source": "direct",
            },
        },
    },
    {
        "label": "Cold × Neutral (welcome offer — acquisition)",
        "payload": {
            "user_id":    "test-user-003",
            "persona":    "Cold",
            "sentiment":  "Neutral",
            "confidence": 0.65,
            "user_meta": {
                "age": 22, "gender": "F", "region": "Sousse",
                "nb_visits": 1, "max_funnel_depth": 1,
                "cart_abandonment_rate": 0.0, "avg_scroll_depth": 32.0,
                "avg_clicks": 2.0, "bounce_rate": 0.55,
                "purchase_rate": 0.0, "checkout_rate": 0.0,
                "frequency": 1, "monetary": 0.0, "recency_days": 0,
                "device_mode": "mobile", "preferred_source": "social",
            },
        },
    },
    {
        "label": "Hesitant × Neutral (trust signals — mid-funnel blocker)",
        "payload": {
            "user_id":    "test-user-004",
            "persona":    "Hesitant",
            "sentiment":  "Neutral",
            "confidence": 0.62,
            "user_meta": {
                "age": 35, "gender": "M", "region": "Tunis",
                "nb_visits": 4, "max_funnel_depth": 4,
                "cart_abandonment_rate": 0.65, "avg_scroll_depth": 60.0,
                "avg_clicks": 5.5, "bounce_rate": 0.38,
                "purchase_rate": 0.05, "checkout_rate": 0.20,
                "frequency": 3, "monetary": 50.0, "recency_days": 3,
                "device_mode": "desktop", "preferred_source": "organic",
            },
        },
    },
    {
        "label": "Warm × Positive (price nudge — gentle push to convert)",
        "payload": {
            "user_id":    "test-user-005",
            "persona":    "Warm",
            "sentiment":  "Positive",
            "confidence": 0.74,
            "user_meta": {
                "age": 29, "gender": "F", "region": "Monastir",
                "nb_visits": 5, "max_funnel_depth": 3,
                "cart_abandonment_rate": 0.30, "avg_scroll_depth": 68.0,
                "avg_clicks": 7.0, "bounce_rate": 0.20,
                "purchase_rate": 0.15, "checkout_rate": 0.25,
                "frequency": 3, "monetary": 95.0, "recency_days": 2,
                "device_mode": "mobile", "preferred_source": "email",
            },
        },
    },
    {
        "label": "High Intent × Neutral (scarcity push — urgency creation)",
        "payload": {
            "user_id":    "test-user-006",
            "persona":    "High Intent",
            "sentiment":  "Neutral",
            "confidence": 0.70,
            "user_meta": {
                "age": 31, "gender": "M", "region": "Tunis",
                "nb_visits": 6, "max_funnel_depth": 6,
                "cart_abandonment_rate": 0.28, "avg_scroll_depth": 74.0,
                "avg_clicks": 10.0, "bounce_rate": 0.10,
                "purchase_rate": 0.35, "checkout_rate": 0.65,
                "frequency": 5, "monetary": 420.0, "recency_days": 1,
                "device_mode": "desktop", "preferred_source": "direct",
            },
        },
    },
]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--direct", action="store_true",
                        help="Call run() directly without HTTP server")
    parser.add_argument("--case", type=int, default=None,
                        help="Run only test case N (1-indexed)")
    parser.add_argument("--url", default="http://localhost:8000",
                        help="API base URL (default: http://localhost:8000)")
    args = parser.parse_args()

    cases = TEST_CASES
    if args.case:
        cases = [TEST_CASES[args.case - 1]]

    if args.direct:
        run_direct(cases)
    else:
        run_http(cases, base_url=args.url)