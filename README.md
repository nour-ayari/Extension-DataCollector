
# Extension-DataCollector

## Project Structure

```

Extension-DataCollector/
│
├── data-processing/
│   ├── supabase_fetch.py
│   ├── bigquery_fetch.py
│   ├── normalize_ga4.py
│   ├── synthetic_gen.py
│   ├── canonical_schema.py
│   └── merge.py
│
├── pipeline/
│   ├── feature_eng.py
│   ├── aggregation.py
│   ├── orchestrator.py
│   ├── supabase_sync.py
│   └── agents/
│       ├── rfm_agent.py
│       ├── behavior_agent.py
│       ├── intent_agent.py
│       └── context_agent.py
│
├── data/
│   └── events_cleaned.csv
│
├── dashboard/          ← React dashboard (Vite + Tailwind)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── OverviewPage.jsx
│   │   │   ├── FeedbackPage.jsx
│   │   │   └── SettingsPage.jsx
│   │   ├── components/
│   │   └── hooks/
│   └── package.json
│
├── dashboard.html      ← Standalone HTML dashboard (no build step)
│
└── README.md

```

---

## Dashboard

The project includes two dashboard variants that visualise Agent 3 recommendation output, audience segmentation, and feedback workflows.

### Variants

| Variant | File / Folder | Description |
|---|---|---|
| Standalone | `dashboard.html` | Single HTML file, open directly in a browser — no install required |
| React app | `dashboard/` | Full Vite + React + Tailwind build with routing, charts, and dark mode |

---

### Running the React dashboard

```bash
cd dashboard
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

The dashboard has three pages accessible from the sidebar:

- **Overview** — metric cards (total recommendations, conversion rate, critical urgency, avg confidence), activity trend chart, persona split pie chart, recent recommendations table with All / Critical / Converted filters, action distribution bars, and a live activity feed.
- **Feedback** — review pending recommendations and mark each one as *Converted* or *Dismissed* to close the feedback loop.
- **Settings** — API connection status, theme toggle (light / dark), environment info, and architecture checklist.

---

### Running the standalone dashboard

Open `dashboard.html` directly in any modern browser — no build step or server needed.

It connects to the Agent 3 API at `http://localhost:8000` and auto-refreshes every 30 seconds. If the API is unreachable the dashboard shows a connection error banner but remains fully usable with the last loaded data.

---

> **Note — Mock data**
>
> Both dashboard variants currently run on **mock / generated data** for development and UI testing purposes.
> The live connection to the final Agent 3 backend (FastAPI + RAG pipeline) **will be wired in a later integration phase**.
> All API hooks, fetch calls, and data shapes are already in place — only the base URL and real endpoint responses need to be substituted once the backend is deployed.

---
