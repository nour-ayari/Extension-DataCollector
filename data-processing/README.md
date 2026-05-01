## Extension-DataCollector — Data processing

This folder contains the ETL scripts that normalize and merge event data from
two sources (Supabase Rudderstack events and BigQuery GA4 export), plus a
synthetic generator used for testing.

**Goal:** produce a canonical, analytics-ready `unified_events` table and a
per-user `user_features` table for modelling.

**Main scripts**
- **data-processing/merge.py**: orchestrates fetching, canonical mapping, dedup, and upsert to Supabase `unified_events`.
- **data-processing/bigquery_fetch.py**: extracts GA4 sample from BigQuery and maps GA4 event_params to `ed_*` fields.
- **data-processing/supabase_fetch.py**: fetches the `events` table from Supabase and flattens `event_description` and `pages_per_session`.
- **data-processing/synthetic_gen.py**: generates synthetic sessions for testing.
- **data-processing/preprocess.py**: runs null handling, feature engineering, encoding, scaling and upserts `user_features`.
- **data-processing/canonical_schema.py**: defines the canonical event schema and mapping helpers.

**Requirements**
- Python 3.10+ (virtualenv recommended)
- Install dependencies:

```bash
python -m venv env
source env/bin/activate 

pip install --upgrade pip
pip install -r requirements.txt
```

If you don't have a `requirements.txt`, install the main packages:

```bash
pip install pandas supabase-py google-cloud-bigquery python-dotenv scikit-learn numpy
```

**Environment variables**
- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_KEY` — service role key to write into the DB
- `GCP_PROJECT_ID` — Google Cloud project id for BigQuery
- `GOOGLE_APPLICATION_CREDENTIALS` — path to service account JSON (recommended)

Set them temporarily in PowerShell:

```powershell
$env:SUPABASE_URL = "https://xyz.supabase.co"
$env:SUPABASE_KEY = "your-supabase-key"
$env:GCP_PROJECT_ID = "your-gcp-project-id"
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
```

**Canonical schema**
The canonical, flattened event model is implemented in `data-processing/canonical_schema.py`.
It contains fields such as:

- user_id, session_id, event_name, event_timestamp
- country, region, city, device, source
- duration, click_count, scroll_pct, page_type, funnel_stage
- product_id, product_name, price, quantity, revenue, orders, cart_abandoned
- logged_in, age, gender, nb_visits, sequence, page_views, raw_source

Both BigQuery rows and Supabase rows are mapped into this canonical shape before
concatenation to avoid messy joins and ensure consistent downstream features.

**Run the pipeline**

1) Merge (fetch, canonicalize, dedupe, upsert unified events):

```bash
python data-processing/merge.py
```

This produces a local CSV snapshot `merged_events.csv` and upserts records into
the Supabase table `unified_events` (if credentials provided).

2) Preprocess (build per-user features and push `user_features`):

```bash
python data-processing/preprocess.py
```

**SQL — create target tables in Supabase**

Run these in the Supabase SQL editor if the tables do not exist:

```sql
CREATE TABLE IF NOT EXISTS public.unified_events (
  user_id TEXT,
  session_id TEXT,
  event_name TEXT,
  event_timestamp TIMESTAMPTZ,
  country TEXT,
  region TEXT,
  city TEXT,
  device TEXT,
  source TEXT,
  duration INTEGER,
  click_count INTEGER,
  scroll_pct INTEGER,
  page_type TEXT,
  funnel_stage TEXT,
  product_id TEXT,
  product_name TEXT,
  price NUMERIC,
  quantity INTEGER,
  revenue NUMERIC,
  orders INTEGER,
  cart_abandoned BOOLEAN,
  logged_in BOOLEAN,
  age INTEGER,
  gender TEXT,
  nb_visits INTEGER,
  sequence TEXT,
  page_views INTEGER,
  raw_source TEXT,
  PRIMARY KEY (user_id, session_id)
);

CREATE TABLE IF NOT EXISTS public.user_features (
  client_id TEXT PRIMARY KEY
  -- the preprocess script upserts a wide set of engineered features; adapt as needed
);
```

**Notes & troubleshooting**
- If BigQuery fetch fails: check `GCP_PROJECT_ID` and `GOOGLE_APPLICATION_CREDENTIALS`.
- If Supabase upserts fail: ensure `SUPABASE_KEY` has proper privileges and target tables exist.
- The scripts sanitize timestamps and numpy types before upsert; inspect `merged_events.csv`
  for a local snapshot.
