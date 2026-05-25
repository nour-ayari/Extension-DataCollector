import uuid
import random
from datetime import datetime, timedelta
import numpy as np
import pandas as pd

REGIONS = ["Tunis", "Sfax", "Sousse", "Béja", "Nabeul"]
DEVICES = ["desktop", "mobile", "tablet"]
SEQUENCES = [
    "home → search → product_view → add_to_cart → checkout → purchase",
    "home → product_view → add_to_cart → cart_view → checkout_abandon",
    "home → search → product_view → bounce",
    "home → search → product_view → product_view → add_to_cart → remove_from_cart → add_to_cart → purchase",
]


def make_user(i: int) -> dict:
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
        "timestamp": (datetime.utcnow() - timedelta(days=random.randint(0, 90))).isoformat(),
        "source": "synthetic",
        "rfm_score": None,
        "conversion_score": None,
    }


def generate_synthetic(n: int = 5000) -> pd.DataFrame:
    return pd.DataFrame([make_user(i) for i in range(n)])


if __name__ == "__main__":
    df = generate_synthetic(1000)
    print(df.head())
