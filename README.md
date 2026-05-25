
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
