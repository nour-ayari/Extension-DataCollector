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
└── README.md

```

---

## Agent 3 LLM mode

Agent 3 now runs in deterministic fallback mode by default. Optional local Ollama support can be enabled with environment variables:

```env
OLLAMA_ENABLED=false
OLLAMA_MODEL=llama3
OLLAMA_URL=http://localhost:11434
```

If Ollama is not running or the request fails, Agent 3 returns a valid recommendation JSON using its rule-based fallback.