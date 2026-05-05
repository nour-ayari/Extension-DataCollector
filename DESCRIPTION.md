# Project Technical Description
## E-Commerce User Intelligence Platform — End-to-End Architecture

---

## 1. Project Summary

This project is a complete, production-grade pipeline for collecting, processing, and scoring e-commerce user behavior. It ingests events from three distinct sources — a real Chrome browser extension, a persona-driven simulation bot, and a Google Analytics 4 public dataset — then fuses them through a canonical ETL layer, computes rich behavioral features, and runs four parallel ML scoring agents to produce a 0–100 conversion score and a persona label for every user. Results are synced to a Supabase PostgreSQL database for downstream use.

---

## 2. Full Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         DATA COLLECTION LAYER                            │
│                                                                          │
│  ┌─────────────────────┐   ┌──────────────────────┐   ┌──────────────┐  │
│  │  Chrome Extension   │   │  Simulation Bot       │   │  BigQuery    │  │
│  │  (content.js)       │   │  (direct-track.js)    │   │  GA4 Dataset │  │
│  │  Real user tracking │   │  6 personas × 300+    │   │  Public      │  │
│  │  on e-shop domains  │   │  synthetic sessions   │   │  sample      │  │
│  └──────────┬──────────┘   └──────────┬────────────┘   └──────┬───────┘  │
│             │  RudderStack /v1/track  │  RudderStack /v1/track│          │
│             └──────────────┬──────────┘                       │          │
│                            ▼                                  │          │
│                  ┌──────────────────┐                         │          │
│                  │  Supabase        │◄────────────────────────┘          │
│                  │  events table    │         (fetch via Python)          │
│                  └──────────────────┘                                    │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        DATA PROCESSING LAYER                             │
│                         (data-processing/)                               │
│                                                                          │
│   supabase_fetch.py          bigquery_fetch.py       synthetic_gen.py   │
│   ─────────────────          ─────────────────       ────────────────   │
│   Fetch events table    →    Query GA4 public   →    Generate N=2000    │
│   Flatten event_description  normalize_ga4.py        synthetic users    │
│   Flatten pages_per_session  Flatten Arrow structs                       │
│   Compute revenue            Session features                            │
│                                                                          │
│                   ┌──────────────────────────────┐                      │
│                   │      canonical_schema.py      │                      │
│                   │  28 canonical columns         │                      │
│                   │  BQ_TO_CANONICAL              │                      │
│                   │  SB_TO_CANONICAL              │                      │
│                   │  TRACKED_GA4_TO_CANONICAL     │                      │
│                   │  map_df_to_canonical(df, src) │                      │
│                   └──────────────┬───────────────┘                      │
│                                  │                                       │
│                   ┌──────────────▼───────────────┐                      │
│                   │          merge.py             │                      │
│                   │  canonical → unified schema   │                      │
│                   │  Concat 3 sources             │                      │
│                   │  Deduplicate (client+session) │                      │
│                   │  Push → unified_events table  │                      │
│                   └──────────────────────────────┘                      │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼  (events_cleaned.csv)
┌──────────────────────────────────────────────────────────────────────────┐
│                          ML SCORING PIPELINE                             │
│                              (pipeline/)                                 │
│                                                                          │
│   feature_eng.py                   aggregation.py                        │
│   ──────────────                   ──────────────                        │
│   FUNNEL_MAP (0–7 depth)           groupby client_id                     │
│   parse_sequence()                 RFM: recency / frequency / monetary   │
│   Flags: is_purchaser,             Behaviour: scroll / clicks / bounce   │
│          reached_checkout,         Intent: funnel / purchase / checkout  │
│          deep_scroll,              Context: device / region / hour       │
│          high_engagement           Demographics: age / gender            │
│   Time: hour / day / weekend                                             │
│   Revenue computation                                                    │
│                                                                          │
│              ┌─────────────────────────────────────────┐                 │
│              │       orchestrator.py                   │                 │
│              │       ThreadPoolExecutor (4 workers)     │                 │
│              │                                         │                 │
│   ┌──────────┴─┐  ┌────────────┐  ┌──────────┐  ┌────┴──────────┐      │
│   │ RFMAgent   │  │Behaviour   │  │ Intent   │  │ Context       │      │
│   │ weight=25% │  │ Agent      │  │ Agent    │  │ Agent         │      │
│   │            │  │ weight=30% │  │ weight=  │  │ weight=10%    │      │
│   │ Recency ×  │  │            │  │   35%    │  │               │      │
│   │ 0.30       │  │ scroll×0.25│  │ funnel×  │  │ KMeans(k=5)   │      │
│   │ Freq × 0.30│  │ clicks×0.20│  │  0.35    │  │ 6 features    │      │
│   │ Monet× 0.40│  │ (1-bounce) │  │ purchase×│  │ composite     │      │
│   │ /5 × 100   │  │   × 0.25   │  │  0.35    │  │ rank → persona│      │
│   │            │  │ engage×0.30│  │ checkout×│  │               │      │
│   │ quintiles  │  │            │  │  0.15    │  │ Cold=10       │      │
│   │ q1–q5      │  │ MinMax     │  │ (1-aban) │  │ Hesitant=35   │      │
│   │            │  │ scaled     │  │  × 0.15  │  │ Warm=60       │      │
│   │            │  │            │  │          │  │ HighIntent=80 │      │
│   │            │  │            │  │ MinMax   │  │ VIP=100       │      │
│   └──────────┬─┘  └────────┬───┘  └────┬─────┘  └────┬──────────┘      │
│              │              │           │              │                 │
│              └──────────────┴───────────┴──────────────┘                │
│                                    │                                     │
│              final_score = rfm×0.25 + beh×0.30 + int×0.35 + ctx×0.10   │
│              conversion_label = cut([0,30,55,75,100])                   │
│                   → Cold | Warm | High Intent | VIP                      │
│                                                                          │
│              supabase_sync.py → user_features table                      │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Phase 1 — Data Collection

### 3.1 Chrome Extension (`extension/`)

A Manifest V3 Chrome extension injected on major e-commerce domains (Amazon, Jumia, Zalando, AliExpress, Mytek, etc.).

**Core files:**
- `manifest.json` — V3 manifest, host permissions, content script at `document_idle`
- `content.js` (358 lines) — Client-side tracking script
- `background.js` — Service worker forwarding events to RudderStack
- `consent.js / consent.html` — GDPR-style consent gate before any tracking

**What is tracked:**

| Event | Trigger | Key properties |
|---|---|---|
| `page_view` | On page load | page_type, domain, device, traffic_source |
| `scroll_depth` | At 25/50/75/100% thresholds | depth_pct, max_scroll_pct |
| `search_performed` | Form submit with search input | query |
| `add_to_cart` | Button click | product_id, product_name, price, category |
| `remove_from_cart` | Button click | product info |
| `checkout` | Checkout button | cart contents |
| `purchase` | Confirmation page | order_id, total, items |
| `cart_abandon` | Exit intent with items in cart | reason |
| `checkout_abandon` | Exit during checkout | step reached |
| `page_engagement` | `beforeunload` | duration, max_scroll_pct, click_count, is_bounce |

**Identity system:**
- Generates/stores `anonId` (UUID) and `sessionId` (30-minute rolling timeout) in `localStorage`
- Tracks `nbVisits`, infers device from viewport, infers `traffic_source` from `document.referrer`
- Scrapes product metadata from DOM (h1, price selectors, product ID patterns)

**Event flow:**  
`content.js` → `chrome.runtime.sendMessage(TRACK_EVENT)` → `background.js` → RudderStack `/v1/track` → Supabase `events` table via RudderStack destination

---

### 3.2 Simulation Bot (`Simulation/direct-track.js`)

A Node.js headless bot generating realistic synthetic e-commerce sessions at scale. Sends events directly to RudderStack without a real browser.

**Persona system (6 archetypes):**

| Persona | Age | Device | Bounce | Add-to-Cart | Checkout→Purchase | Think Scale |
|---|---|---|---|---|---|---|
| Impulsive Buyer | 18–30 | 75% mobile | 3–20% | 40–80% | 70–95% | 0.6× |
| Careful Researcher | 30–55 | 70% desktop | 2–10% | 20–50% | 70–95% | 1.5× |
| Bargain Hunter | 20–50 | 50% mobile | 10–40% | 20–50% | 40–70% | 1.0× |
| Loyal Customer | 25–60 | 45/45 split | 1–8% | 50–85% | 80–99% | 0.9× |
| Window Shopper | 16–45 | 65% mobile | 20–55% | 5–20% | 10–30% | 0.8× |
| Senior Shopper | 55–72 | 70% desktop | 3–15% | 40–70% | 65–90% | 2.0× |

**User pool:** 120 pre-built recurring users (70% of sessions) + on-the-fly new visitors (30%)

**Session flow per user:**
1. `identify` (traits: age, gender, address, persona, device)
2. `page_view` (home) + `scroll_depth`
3. Optional bounce → `page_engagement` (is_bounce=true)
4. Optional `promo_viewed`
5. Optional `search_performed`
6. N products: `product_view` → `scroll_depth` → optional `add_to_cart` → optional `remove_from_cart`
7. `cart_view` → `checkout_started` → `purchase_completed` OR `checkout_abandon` OR `cart_abandon`
8. `page_engagement` (session summary)

**Order payload** (`buildOrderPayload`): full commercial document including subtotal, TVA (19%), shipping, discount, carrier, fulfillment center, estimated delivery, installments, promo code, and customer snapshot.

**Realistic distributions:**
- Hour-of-day weights peaking at noon and 8pm
- Traffic source weights (organic 35%, direct 30%, social 20%, email 10%, referral 5%)
- Tunisian addresses: 30 cities with real postal codes

**Configurable via env:** `TOTAL` (number of sessions), `LOOKBACK_DAYS` (spread timestamps into the past)

---

## 4. Phase 2 — Data Processing (`data-processing/`)

This layer ingests from three sources, normalizes everything to a canonical schema, merges and deduplicates, then pushes to Supabase.

### 4.1 Source Fetchers

#### `supabase_fetch.py`
- Fetches all rows from Supabase `events` table via `supabase-py`
- `flatten_supabase(df)`:
  - Flattens `event_description` JSON → `ed_*` columns (page_type, action_source, funnel_stage, price, quantity, etc.)
  - Flattens `pages_per_session` JSON → `pps_page_views` count
  - Computes `revenue = ed_price × ed_quantity`
  - Tags `source = "rudderstack"`

#### `bigquery_fetch.py`
- Queries `bigquery-public-data.ga4_obfuscated_sample_ecommerce.events_*`
- Configurable date range (`GA4_START`, `GA4_END`) and limit (`GA4_LIMIT`, default 1M)
- SQL: extracts `client_id`, `event_name`, `event_timestamp`, `event_params`, `geo`, `device`, `traffic_source`, `purchase_revenue`, `items`
- Passes raw Arrow DataFrame to `normalize_ga4.py`

#### `normalize_ga4.py` (368 lines)
Critical module handling PyArrow struct ambiguity from BigQuery:

- `flatten_event_params(event_params)`: Safely iterates GA4 key-value param array (Arrow list-of-structs), extracts `string_value / int_value / float_value / double_value` for each key. Never raises.
- `flatten_items(items)`: Converts GA4 items array to list of plain dicts.
- `_us_to_iso(ts)`: Converts microsecond-epoch integers to ISO-8601 UTC strings.
- `_normalize_row(row, params, items)`: Maps one GA4 row + flattened params to the tracked event shape (event_description, order_description, address, session placeholders).
- `_compute_session_features(df)`: Post-hoc session-level derivation:
  - `pages_per_session` — count of `page_view` events per `session_id`
  - `is_bounce` — no engaged event in session
  - `cart_abandonned` — `add_to_cart` present without `purchase`
  - `sequence` — chronologically ordered list of `event_type` values

#### `synthetic_gen.py`
- Python-based lightweight synthetic generator (separate from the JS bot)
- `make_user(i)`: Randomizes age (normal dist μ=35, σ=10), nb_visits (1–30), revenue (0–500), picks from 4 predefined session sequences
- `generate_synthetic(n=5000)` → DataFrame ready for the canonical pipeline
- Regions: Tunis, Sfax, Sousse, Béja, Nabeul
- Used as a third data source when GA4 or Supabase are unavailable, and to augment volume

---

### 4.2 Canonical Schema (`canonical_schema.py`)

Central schema alignment layer. Defines **28 canonical columns** shared across all sources:

```
user_id, session_id, event_name, event_timestamp,
country, region, city, device, source,
duration, click_count, scroll_pct, page_type, funnel_stage,
product_id, product_name, price, quantity, revenue, orders,
cart_abandoned, logged_in, age, gender, nb_visits,
sequence, page_views, raw_source
```

**Three source mappers:**
- `BQ_TO_CANONICAL` — BigQuery GA4 (flattened ed_* columns)
- `SB_TO_CANONICAL` — Supabase events (flattened ed_* columns)
- `TRACKED_GA4_TO_CANONICAL` — GA4 data with `event_description` JSON intact

`map_df_to_canonical(df, source)` — selects the right mapper, renames columns, fills missing canonical columns with `None`, tags `raw_source`.

`_preprocess_tracked_ga4(df)` — expands `event_description` and `order_description` JSON blobs before mapping, extracts region from `address` string.

---

### 4.3 ETL Orchestration (`merge.py`)

Main entry point for the data processing phase.

`run_merge(synth_n=2000, push=True, target="unified")`:

1. **Fetch** Supabase events (with graceful fallback to empty DataFrame on failure)
2. **Fetch** GA4 from BigQuery (with graceful fallback)
3. **Generate** N synthetic records via `synthetic_gen.py`
4. **Canonicalize** each source via `map_df_to_canonical()`
5. **Convert** to target schema:
   - `"unified"` mode: canonical → `UNIFIED_COLS` via `canonical_to_unified()`
   - `"tracked"` mode: canonical → `TRACKED_COLS` via `canonical_to_tracked()`
6. **Merge**: `pd.concat` → sort by timestamp → `drop_duplicates(subset=["client_id","session_id"], keep="last")`
7. **Sanitize**: `_sanitize_value()` converts numpy generics, pandas Timestamps, and non-finite floats to JSON-safe Python types
8. **Push** to Supabase `unified_events` or `events` table in 500-row batches via upsert

`canonical_to_tracked(df)` also reconstructs the `event_description` JSON blob and `pages_per_session` nested structure expected by the Supabase schema.

---

## 5. Phase 3 — Preprocessing

A preprocessing step (Jupyter notebook) ingests the merged/unified events and produces `data/events_cleaned.csv` — the cleaned, denormalized flat file consumed by the ML pipeline.

`data/send.py` pushes this file back to Supabase `preprocessed_events` table:
- Casts `client_id` and `session_id` to strings (they arrive as float64 from CSV)
- Formats timestamps to ISO-8601 UTC strings
- Converts `hour_of_day` and `day_of_week` float columns to nullable integers
- Converts all numpy/pandas scalars via `_clean_value()` to JSON-safe types
- Upserts in 500-row batches with per-batch error recovery

---

## 6. Phase 4 — ML Scoring Pipeline (`pipeline/`)

### 6.1 Feature Engineering (`feature_eng.py`)

Operates on event-level data from `events_cleaned.csv`.

**FUNNEL_MAP** — maps 35+ event names to a 0–7 depth integer:

| Depth | Stage | Events |
|---|---|---|
| 0 | Session entry | session_start, first_visit |
| 1 | Engagement | page_view, scroll, click, page_engagement |
| 2 | Discovery | search_performed, view_item_list, promo_viewed |
| 3 | Consideration | product_view, select_item, remove_from_cart |
| 4 | Cart | add_to_cart, cart_abandon |
| 5 | Cart review | view_cart |
| 6 | Checkout | begin_checkout, add_shipping_info, checkout_abandon |
| 7 | Purchase | purchase, purchase_completed |

**`parse_sequence(seq)`** — robust parser handling list, numpy array, arrow-encoded string (`→` or `->` or `,` delimited), or null inputs.

**`add_event_features(df)`** computes per-row:
- `funnel_depth` — max FUNNEL_MAP depth in session sequence
- `is_purchaser` — orders > 0
- `reached_checkout` — funnel_depth ≥ 6
- `deep_scroll` — ed_max_scroll_pct ≥ 70
- `high_engagement` — clicks ≥ 5 AND scroll ≥ 50%
- `recency_days_event` — days since event timestamp
- `hour_of_day`, `day_of_week`, `is_weekend`
- `revenue` — ed_price × ed_quantity (with fallback if revenue column exists)
- Forward-fills timestamps within session then across user to handle nulls

---

### 6.2 User Aggregation (`aggregation.py`)

Rolls event-level rows up to one row per `client_id` via a single `groupby().agg()`.

**Output columns (30+):**

| Group | Columns |
|---|---|
| RFM | recency_days, frequency (unique sessions), monetary (revenue sum), total_events |
| Behaviour | avg_session_duration, avg_scroll_depth, avg_clicks, avg_page_views, bounce_rate, login_rate, deep_scroll_rate, high_engagement_rate |
| Intent | max_funnel_depth, avg_funnel_depth, cart_abandonment_rate, purchase_rate, checkout_rate, total_orders, last_step |
| Context | device_mode, preferred_source, region, nb_visits, is_weekend_user, preferred_hour |
| Demographics | age, gender |

`purchase_rate` is **recomputed** post-agg using the correct denominator: unique purchase sessions / total sessions (not the naive mean of `is_purchaser` per row which over-counts multi-event sessions).

---

### 6.3 Scoring Agents (`agents/`)

All agents extend `BaseAgent` (abstract base class with `score(user)` and `run(df)` interface). `run()` calls `score()` row-by-row, clips to [0,100], and prints mean/min/max.

#### `RFMAgent` (weight 25%)

Computes quintiles (q1–q5) for recency (reversed), frequency, and monetary independently using `pd.qcut` with rank-based tie breaking. Falls back to quintile 3 when all values are identical.

```
score = (r_score × 0.30 + f_score × 0.30 + m_score × 0.40) / 5 × 100
```

Stores `_scored_df` so the orchestrator can attach `r_score`, `f_score`, `m_score` to the final output.

#### `BehaviourAgent` (weight 30%)

MinMax-scales `avg_scroll_depth`, `avg_clicks`, `high_engagement_rate` across the user population before scoring.

```
score = (scroll × 0.25 + clicks × 0.20 + (1−bounce) × 0.25 + engagement × 0.30) × 100
```

#### `IntentAgent` (weight 35%)

MinMax-scales `max_funnel_depth` (only feature needing population-relative scaling).

```
score = (funnel × 0.35 + purchase_rate × 0.35 + checkout_rate × 0.15 + (1−abandon) × 0.15) × 100
```

#### `ContextAgent` (weight 10%)

Fits KMeans (k=5, random_state=42, n_init=10) on 6 features: `recency_days`, `frequency`, `monetary`, `cart_abandonment_rate`, `avg_clicks`, `avg_funnel_depth` (MinMax scaled).

Cluster-to-persona mapping:
1. Computes composite value per cluster center: `−recency + frequency×2 + monetary×3 − cart_abandon + funnel_depth`
2. Ranks clusters by composite score descending
3. Maps rank position (normalized to 0–1) to `_PERSONAS = [Cold, Hesitant, Warm, High Intent, VIP]`
4. Works for any `n_clusters` value, not hardcoded to 5

Persona → score mapping: Cold=10, Hesitant=35, Warm=60, High Intent=80, VIP=100

Saves `models/kmeans.pkl` and `models/scaler.pkl` via joblib.

---

### 6.4 Orchestration (`orchestrator.py`)

Runs all 4 agents concurrently using `ThreadPoolExecutor(max_workers=4)`. Each agent receives a read-only view of `user_features` (no shared mutable state).

**Score fusion:**
```
final_score = rfm×0.25 + behaviour×0.30 + intent×0.35 + context×0.10
```
Clipped to [0, 100], rounded to 2 decimal places.

**Conversion label** via `pd.cut`:
- [0–30] → Cold
- [30–55] → Warm
- [55–75] → High Intent
- [75–100] → VIP

Attaches `persona`, `cluster_id` from ContextAgent and `r_score`, `f_score`, `m_score` from RFMAgent to the output DataFrame.

---

### 6.5 Pipeline Entry Point (`run_pipeline.py`)

Five-step orchestration:

| Step | Action | Output |
|---|---|---|
| 1 | Load `data/events_cleaned.csv` | raw DataFrame |
| 2 | `add_event_features()` | `data/events_features.parquet` |
| 3 | `aggregate_user_features()` | `data/user_features.parquet` |
| 4 | `run_orchestrator()` | `data/user_scores_final.{parquet,csv}` |
| 5 | `sync_to_supabase()` | → Supabase `user_features` table |

---

### 6.6 Supabase Sync (`supabase_sync.py`)

Upserts 24 selected columns from the scored DataFrame to the Supabase `user_features` table in 500-row batches. Columns include all agent scores, persona, cluster_id, conversion_label, and key behavioral metrics.

---

## 7. Data Flow Summary

```
Chrome Extension  ──┐
Simulation Bot    ──┼──► RudderStack ──► Supabase events table
                    │
BigQuery GA4      ──┘

Supabase events ──┐
BigQuery GA4    ──┼──► normalize ──► canonical_schema ──► merge/dedupe ──► unified_events
Synthetic       ──┘

unified_events ──► [Preprocessing notebook] ──► events_cleaned.csv

events_cleaned.csv
  ──► feature_eng    ──► events_features.parquet
  ──► aggregation    ──► user_features.parquet
  ──► orchestrator
        ├── RFMAgent      (25%)
        ├── BehaviourAgent(30%)
        ├── IntentAgent   (35%)
        └── ContextAgent  (10%)
              │
              ▼
        final_score + persona + conversion_label
              │
              ▼
        user_scores_final.csv / .parquet
              │
              ▼
        Supabase user_features table
```

---

## 9. Key Design Decisions

**Canonical schema layer** — A dedicated 28-column canonical schema decouples source-specific field names from pipeline logic. Adding a new data source only requires writing a new mapper dict, not changing any pipeline code.

**Three-tier scoring** — Separating feature engineering (event-level), aggregation (user-level), and scoring (agent-level) keeps each stage independently testable and replaceable.

**Weighted agent fusion** — Intent is weighted highest (35%) because funnel depth and purchase rate are the strongest conversion predictors. Behaviour is second (30%) for engagement signal. RFM is third (25%) for historical loyalty. Context (10%) provides a soft persona anchor without overfitting to cluster assignments.

**KMeans persona ordering** — Clusters are ranked by a composite score (`−recency + freq×2 + monetary×3 − abandon + funnel`) rather than arbitrary label assignment, ensuring the Cold→VIP mapping is always data-driven regardless of cluster initialization.

**Graceful fallbacks in data processing** — Every source fetch in `merge.py` is wrapped in try/except so the pipeline degrades to available sources rather than failing completely when BigQuery or Supabase is unreachable.

**Type sanitization** — Two independent sanitizers (`_clean_value` in `send.py`, `_sanitize_value` in `merge.py`) handle the numpy/pandas → JSON conversion boundary, because supabase-py rejects numpy scalars, NaN, and infinity silently or with cryptic errors.
