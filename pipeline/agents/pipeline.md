
# E-Commerce User Intelligence Platform  
## End-to-End Behavioral Analytics & Conversion Scoring System

---


This llayer of the projecr is a **production-grade data engineering and machine learning pipeline** designed to analyze e-commerce user behavior and transform raw interaction data into actionable business intelligence.

It collects behavioral events from multiple heterogeneous sources, standardizes them through a canonical schema, builds ML-ready features, and applies a multi-agent scoring system to generate:

- User conversion score (0–100)
- Behavioral persona (Cold, Warm, High Intent, VIP)
- Engagement & intent segmentation

The final results are stored in **Supabase (PostgreSQL)** for downstream analytics and business use.

---

# pipeline 

```

Chrome Extension (real users)
Simulation Bot (synthetic users)
GA4 BigQuery dataset
↓
Supabase (raw events)
↓
Data Processing Layer
(fetch → normalize → canonicalize → merge)
↓
Unified Canonical Dataset
↓
Preprocessing (events_cleaned.csv)
↓
Feature Engineering Layer
↓
User Aggregation Layer
↓
Multi-Agent Scoring System
├── RFM Agent
├── Behavior Agent
├── Intent Agent
└── Context Agent
↓
Orchestrator (fusion model)
↓
Final Outputs: classification of users

* Conversion score (0–100)
* Persona label
* User segmentation
  ↓
  Supabase Sync

```

---

# Data Processing Pipeline

### Step 1 — Data Ingestion
- Fetch Supabase events
- Query GA4 BigQuery dataset
- Generate synthetic users

### Step 2 — Normalization
- Flatten nested JSON structures
- Standardize GA4 event params
- Extract session-level features

### Step 3 — Canonical Schema Mapping
All sources are mapped into a unified schema of **28 standardized fields** ensuring consistency across datasets.

### Step 4 — Merge & Deduplication
- Concatenate all sources
- Deduplicate by `(client_id, session_id)`
- Sort by timestamp

---

# Machine Learning Pipeline

## 1. Feature Engineering
Extracts behavioral signals:

- Funnel progression
- Click behavior
- Scroll depth
- Session duration
- Revenue signals
- Engagement indicators

---

## 2. User Aggregation
Aggregates event-level data into user-level features:

### RFM Metrics
- Recency
- Frequency
- Monetary value

### Behavioral Metrics
- Engagement score
- Bounce rate
- Click/scroll activity

### Intent Metrics
- Checkout rate
- Cart abandonment
- Funnel depth

---

## 3. Multi-Agent Scoring System

### RFM Agent
Measures customer value:
- Recency
- Frequency
- Monetary contribution

### Behavior Agent
Measures engagement:
- Scroll behavior
- Click intensity
- Session depth

### Intent Agent
Measures purchase probability:
- Funnel progression
- Checkout behavior
- Purchase signals

### Context Agent
Performs clustering:
- KMeans-based segmentation
- Generates user personas

---

## 4. Orchestrator (Fusion Model)

Final score is computed using weighted aggregation:

```

Final Score =
0.25 × RFM +
0.30 × Behavior +
0.35 × Intent +
0.10 × Context

```

---

# Output ; classification

Each user is assigned:

- Conversion score (0–100)
- Persona (Cold, Warm, High Intent, VIP)
- Behavioral segment
- Engagement profile

