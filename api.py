import argparse
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

from canonical_schema import canonicalize_payload
from pipeline.run_pipeline import run_full_pipeline


def predict(payload: Any) -> dict:
    raw_events = canonicalize_payload(payload)
    results = run_full_pipeline(raw_events, sync_results=False)
    return {
        "count": len(results),
        "results": results.to_dict(orient="records"),
    }


class TinyAPIHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send_json(200, {"status": "ok"})
            return
        self._send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path != "/predict":
            self._send_json(404, {"error": "not_found"})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length or 0)

        try:
            payload = json.loads(raw_body.decode("utf-8") or "{}")
            result = predict(payload)
        except Exception as exc:
            self._send_json(400, {"error": str(exc)})
            return

        self._send_json(200, result)


def serve(host: str = "127.0.0.1", port: int = 8000) -> None:
    server = HTTPServer((host, port), TinyAPIHandler)
    print(f"Tiny API running on http://{host}:{port}")
    print("GET /health")
    print("POST /predict")
    server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description="Tiny HTTP API for Agent_classifier")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    args = parser.parse_args()
    serve(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
