import os
import sys
import json
import requests

URL = os.environ.get("AGENT3_URL", "http://127.0.0.1:8000/recommend")
PAYLOAD = {
    "user_id": os.environ.get("TEST_USER", "synth_cbe657400d4f"),
    "persona": os.environ.get("TEST_PERSONA", "High Intent"),
    "sentiment": os.environ.get("TEST_SENTIMENT", "Negative"),
    "confidence": float(os.environ.get("TEST_CONF", "0.9")),
}

try:
    resp = requests.post(URL, json=PAYLOAD, timeout=120)
    print("STATUS:", resp.status_code)
    try:
        print(json.dumps(resp.json(), indent=2, ensure_ascii=False))
    except Exception:
        print(resp.text)
except Exception as e:
    print("ERROR:", e)
    sys.exit(2)
