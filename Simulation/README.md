Mock backend for SDK integration

Run locally:

```powershell
cd Simulation
npm install
npm start
```

Endpoints:
- `POST /v1/events` — receives SDK event batches
- `POST /v1/intent` — receives chat conversation payloads
- `POST /v1/trigger_session` — triggers the pipeline; server responds with a mocked recommendation and emits an SSE action to `/v1/stream/:session_id`
- `GET /v1/stream/:session_id` — SSE stream for inbound actions
