"""
seed_vector_store.py — Populate intervention_cases with realistic initial data
Run ONCE before going live: python seed_vector_store.py

Covers all 15 persona×sentiment combos with 1-2 cases each (25 total).
converted=True cases are marked based on known high-performing patterns.
"""

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from vector_store import upsert_case

# ---------------------------------------------------------------------------
# Seed data: (persona, sentiment, confidence, action_type, action_detail,
#             behavioral_context, converted)
# behavioral_context mirrors what _build_behavioral_context() produces
# ---------------------------------------------------------------------------

SEED_CASES = [

    # ── COLD ────────────────────────────────────────────────────────────────
    ("Cold", "Positive", 0.78,
     "review_ask",
     "Enjoying your browse? Tell us what you think — takes 30 seconds.",
     "funnel:1|scroll:45.00|bounce:0.60|freq:1|monetary:0.00|visits:1|device:mobile",
     False),

    ("Cold", "Neutral", 0.65,
     "welcome_offer",
     "Welcome! Here's 10% off your first order — use WELCOME10.",
     "funnel:1|scroll:30.00|bounce:0.55|freq:1|monetary:0.00|visits:2|device:mobile",
     True),   # welcome discounts convert cold users reliably

    ("Cold", "Neutral", 0.70,
     "welcome_offer",
     "First time here? Enjoy free shipping on your first purchase.",
     "funnel:2|scroll:40.00|bounce:0.50|freq:1|monetary:0.00|visits:1|device:desktop",
     True),

    ("Cold", "Negative", 0.82,
     "chatbot_fix",
     "Hi! Looks like you ran into an issue. Our team is here to help right now.",
     "funnel:1|scroll:20.00|bounce:0.80|freq:1|monetary:0.00|visits:1|device:mobile",
     False),

    # ── WARM ────────────────────────────────────────────────────────────────
    ("Warm", "Positive", 0.74,
     "price_nudge",
     "Still thinking? Add one more item and get 15% off your order.",
     "funnel:3|scroll:65.00|bounce:0.20|freq:3|monetary:80.00|checkout:0.20|visits:4|device:desktop",
     True),

    ("Warm", "Positive", 0.68,
     "price_nudge",
     "You've been exploring a lot — here's a bundle deal just for you.",
     "funnel:3|scroll:70.00|bounce:0.18|freq:2|monetary:45.00|checkout:0.15|visits:3|device:mobile",
     False),

    ("Warm", "Neutral", 0.60,
     "nurture_email",
     "We picked these for you based on what you've been browsing.",
     "funnel:2|scroll:55.00|bounce:0.30|freq:2|monetary:0.00|checkout:0.10|visits:3|device:desktop",
     True),

    ("Warm", "Negative", 0.85,
     "apology_offer",
     "We're sorry you had a bad experience. Here's 20% off as our apology.",
     "funnel:3|scroll:40.00|bounce:0.35|freq:3|monetary:120.00|abandon:0.60|visits:4|device:mobile",
     True),   # apology + discount is high-converting for warm users

    # ── HIGH INTENT ─────────────────────────────────────────────────────────
    ("High Intent", "Positive", 0.88,
     "upsell",
     "Great choice! Customers who bought this also loved the premium bundle.",
     "funnel:6|scroll:80.00|bounce:0.05|freq:5|monetary:350.00|checkout:0.75|purchase:0.40|visits:7|device:desktop",
     True),

    ("High Intent", "Positive", 0.76,
     "upsell",
     "You're almost there — upgrade to the full kit and save 12%.",
     "funnel:7|scroll:85.00|bounce:0.04|freq:4|monetary:280.00|checkout:0.80|purchase:0.35|visits:6|device:desktop",
     True),

    ("High Intent", "Neutral", 0.70,
     "scarcity_push",
     "Only 3 left in stock — order now before it sells out.",
     "funnel:6|scroll:75.00|bounce:0.08|freq:4|monetary:200.00|checkout:0.65|abandon:0.30|visits:5|device:mobile",
     True),   # scarcity is very effective for high-intent neutral

    ("High Intent", "Neutral", 0.65,
     "scarcity_push",
     "This item is in 47 other carts right now. Secure yours today.",
     "funnel:5|scroll:70.00|bounce:0.10|freq:3|monetary:150.00|checkout:0.55|abandon:0.35|visits:4|device:mobile",
     False),

    ("High Intent", "Negative", 0.87,
     "exit_overlay",
     "Wait — get 10% off right now. Use CODE10 at checkout.",
     "funnel:6|scroll:78.00|bounce:0.08|freq:4|monetary:320.00|checkout:0.60|abandon:0.20|visits:5|device:mobile",
     True),   # exit overlay + discount is top converter for high-intent frustrated

    ("High Intent", "Negative", 0.91,
     "exit_overlay",
     "Don't leave yet! Your cart is saved — complete your order with free shipping.",
     "funnel:7|scroll:82.00|bounce:0.06|freq:5|monetary:410.00|checkout:0.70|abandon:0.15|visits:6|device:desktop",
     True),

    ("High Intent", "Negative", 0.79,
     "exit_overlay",
     "Something went wrong? Chat with us — we'll sort it out instantly.",
     "funnel:6|scroll:60.00|bounce:0.12|freq:3|monetary:180.00|checkout:0.50|abandon:0.40|visits:4|device:mobile",
     False),

    # ── VIP ─────────────────────────────────────────────────────────────────
    ("VIP", "Positive", 0.92,
     "referral",
     "You're one of our best customers — share and get 200 TND store credit.",
     "funnel:7|scroll:88.00|bounce:0.02|freq:12|monetary:1500.00|purchase:0.85|visits:18|device:desktop",
     True),

    ("VIP", "Neutral", 0.71,
     "early_access",
     "As a VIP member, you get early access to our new collection — 24h before everyone else.",
     "funnel:5|scroll:72.00|bounce:0.05|freq:8|monetary:900.00|purchase:0.70|visits:12|device:desktop",
     True),

    ("VIP", "Negative", 0.93,
     "human_call",
     "PRIORITY ALERT: VIP customer flagged — assign to senior support immediately.",
     "funnel:4|scroll:50.00|bounce:0.15|freq:10|monetary:1200.00|abandon:0.25|visits:15|device:mobile",
     True),   # human escalation for VIP negatives almost always recovers the customer

    # ── HESITANT ────────────────────────────────────────────────────────────
    ("Hesitant", "Positive", 0.69,
     "chatbot_guide",
     "Not sure which to pick? Our assistant can compare these for you in seconds.",
     "funnel:3|scroll:60.00|bounce:0.40|freq:2|monetary:0.00|abandon:0.65|visits:3|device:mobile",
     True),

    ("Hesitant", "Positive", 0.72,
     "chatbot_guide",
     "Hi! I noticed you've been browsing a while. Want help finding the right fit?",
     "funnel:3|scroll:55.00|bounce:0.45|freq:2|monetary:0.00|abandon:0.70|visits:2|device:desktop",
     False),

    ("Hesitant", "Neutral", 0.64,
     "trust_signals",
     "Free returns · Secure payment · 4.8★ from 12,000 reviews",
     "funnel:4|scroll:65.00|bounce:0.35|freq:3|monetary:50.00|abandon:0.60|checkout:0.20|visits:4|device:mobile",
     True),

    ("Hesitant", "Neutral", 0.58,
     "trust_signals",
     "100% satisfaction guarantee. If you're not happy, we'll make it right.",
     "funnel:3|scroll:58.00|bounce:0.40|freq:2|monetary:0.00|abandon:0.65|visits:3|device:desktop",
     False),

    ("Hesitant", "Negative", 0.77,
     "survey",
     "Quick question: what stopped you from completing your order? (1 min survey)",
     "funnel:3|scroll:35.00|bounce:0.55|freq:2|monetary:0.00|abandon:0.80|visits:2|device:mobile",
     False),

    ("Hesitant", "Negative", 0.80,
     "survey",
     "We want to do better. What can we improve? Your answer gets you 5% off.",
     "funnel:2|scroll:30.00|bounce:0.60|freq:1|monetary:0.00|abandon:0.85|visits:2|device:mobile",
     True),   # survey + small reward converts hesitant-negative better than nothing

    # ── EXTRA: a second High Intent / Negative case with different profile ──
    ("High Intent", "Negative", 0.84,
     "exit_overlay",
     "Your cart expires in 1 hour — complete your order and get free delivery.",
     "funnel:6|scroll:74.00|bounce:0.09|freq:4|monetary:260.00|checkout:0.58|abandon:0.25|visits:5|device:desktop",
     True),
]


# ---------------------------------------------------------------------------
# Run seeding
# ---------------------------------------------------------------------------

def seed():
    print(f"Seeding {len(SEED_CASES)} intervention cases into Supabase pgvector...\n")
    ok = 0
    for i, (persona, sentiment, confidence, action_type, action_detail, ctx, converted) in enumerate(SEED_CASES, 1):
        try:
            upsert_case(
                persona            = persona,
                sentiment          = sentiment,
                confidence         = confidence,
                action_type        = action_type,
                action_detail      = action_detail,
                behavioral_context = ctx,
                converted          = converted,
            )
            status = "✓ converted" if converted else "  no conv  "
            print(f"  [{i:02d}/{len(SEED_CASES)}] {status} | {persona:15s} × {sentiment:10s} → {action_type}")
            ok += 1
        except Exception as e:
            print(f"  [{i:02d}] ERROR: {e}")

    print(f"\nDone. {ok}/{len(SEED_CASES)} cases seeded successfully.")
    if ok < len(SEED_CASES):
        print("Check your SUPABASE_URL and SUPABASE_KEY in .env")


if __name__ == "__main__":
    seed()