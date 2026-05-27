# Extension-DataCollector — Collecte, scoring et recommandations (Agent‑3)

Résumé
------
Ce dépôt contient une preuve de concept complète pour la collecte d'événements en navigateur, la génération de données synthétiques, un pipeline RAG (recommandations), un SDK front‑end minimal compatible extension Chrome, un serveur de simulation local et une interface dashboard légère.

Objectifs
- Collecter et normaliser les événements utilisateurs (extension + SDK + synthétiques).
- Générer des scores utilisateurs (RFM, comportements, intent) et produire des recommandations actionnables via Agent‑3.
- Fournir un SDK navigateur (ES2020, sans dépendances) strictement compatible avec la forme des événements de l'extension.
- Offrir une infra locale simple pour tester le flux bout‑à‑bout (mock server + page de test + dashboard).

Structure du dépôt (raccourci)
----------------------------
- `data-processing/` — scripts d'ingestion, normalisation, génération synthétique (`synthetic_gen.py`), calcul RFM.
- `pipeline/` — logique de scoring, agents, vector store, assembly/orchestrator et endpoints Agent‑3 (FastAPI).
- `extension/` — code source de l'extension Chrome (payload canonical).
- `Simulation/` — mock server, pages de test et scripts Node pour la simulation locale.
- `dashboard/` — dashboard React (Vite) 
- `sdk.js`, `sdk.min.js`, `types.d.ts` — SDK navigateur léger.
- `ingest_coveo_to_supabase.py`, `pipeline_io_example.json` — exemples d'ingestion et de schéma.

Prérequis
---------
- Python 3.10+ (venv recommandé)
- Node.js 18+ et npm (pour le dashboard / Simulation si désiré)
- (Optionnel, production) Supabase/Postgres + pgvector
- (Optionnel) Ollama local pour LLMs si `OLLAMA_ENABLED=true`

Variables d'environnement importantes
-----------------------------------
- `SUPABASE_URL`, `SUPABASE_KEY` — accès Supabase (nécessaire pour upserts réels)
- `OLLAMA_ENABLED` — true|false (active l'adapter Ollama)
- `OLLAMA_URL`, `OLLAMA_MODEL` — configuration Ollama
- `GCP_PROJECT_ID`, `GA4_START`, `GA4_END` — si vous utilisez la récupération BigQuery

Installation (rapide)
---------------------
1. Créez un environnement Python et installez les dépendances :

```bash
python -m venv .venv
source .venv/Scripts/activate   # PowerShell: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. (Optionnel) Installer les dépendances Node pour la simulation/dashboard :

```bash
cd Simulation
npm install
cd ../dashboard
npm install
```

Utilisation locale (quickstart)
------------------------------
1. Lancer le mock server (Simulation) :

```bash
cd Simulation
npm start
# écoute par défaut sur http://localhost:4000
```

2. Charger la page de test dans un navigateur : ouvrir `Simulation/test_page.html` ou lancer le serveur statique local et visiter la page. Le SDK sur la page enverra des events vers le mock server.

3. Vérifier le dashboard standalone : ouvrir `dashboard.html` à la racine (version statique) ou lancer le dashboard React dev :

```bash
cd dashboard
npm run dev
```

Pipeline & Agent‑3 (exécution)
----------------------------
- Les endpoints Agent‑3 sont dans `pipeline/assembly/api.py` (FastAPI). Pour exécuter localement :

```bash
# depuis l'environnement Python
uvicorn pipeline.assembly.api:app --reload --port 8000
```

- Exécution d'un run pipeline (toy / local) :

```bash
python pipeline/run_pipeline.py
# ou pour le flux réel (besoin de SUPABASE_*):
python pipeline/run_real_flow.py
```

Génération synthétique et RFM
----------------------------
- `data-processing/synthetic_gen.py` : génère des utilisateurs synthétiques. Le champ `rfm_score` est contraint à l'intervalle 0–100.
- `data-processing/bigquery_fetch.py` : contient `compute_rfm()` qui calcule et normalise `rfm_score` sur 0–100.

SDK navigateur (usage)
----------------------
- Inclus `sdk.js` (dev) et `sdk.min.js` (minifié). Loader snippet :

```html
<script data-tenant-id="YOUR_TENANT" src="/path/to/sdk.min.js" async></script>
```

- API publique minimale exposée sur `window.YourSDK` : `track`, `identify`, `setConsent`, `reset`.
- Le SDK batch et envoie vers `POST ${endpoint}/v1/events`, forwarde les conversations de chat vers `/v1/intent` et s'abonne aux actions entrantes via SSE `/v1/stream/:session_id`.

Simulation & tests
------------------
- `Simulation/mock_server.js` et `mock_server_native.js` fournissent des endpoints `/v1/events`, `/v1/intent`, `/v1/trigger_session` et SSE `/v1/stream/:session_id` pour tester les flows.
- `Simulation/test_page.html` est une page de test qui charge le SDK et simule des events et conversations.

Dashboard
---------
- `dashboard.html` : version standalone qui lit les logs et permet d'envoyer du feedback.
- `dashboard/` : application React (Vite) avec WebSocket pour recevoir `ws://.../ws/decisions` si Agent‑3 est démarré.

Remarques d'implémentation
--------------------------
- Le pipeline possède un mode fallback déterministe si l'LLM local (Ollama) est indisponible : Agent‑3 renverra toujours un JSON valide.

Dépannage rapide
-----------------
- `node` non reconnu → installez Node.js 18+ et assurez‑vous que `npm` est dans le PATH.
- `Cannot find package '@faker-js/faker'` → exécuter `npm install` dans `Simulation` si vous lancez les scripts qui l'utilisent.
- Problèmes Supabase → vérifier `SUPABASE_URL` et `SUPABASE_KEY` et exécuter la création de tables SQL indiquée dans les logs si nécessaire.

Contribuer
----------
- Respectez les conventions du dépôt : tests unitaires Python sous `tests/unit`, scripts de simulation sous `Simulation/`.
- Avant PR : exécuter `flake8`/`black` (selon configuration) et lancer les tests unitaires.

Prochaines tâches suggérées
--------------------------
- Ajouter un test automatisé de parité SDK ↔ extension (`canonical_schema`) pour garantir que le SDK n'altère pas le schéma.
- Ajouter un setup script `dev.sh` / `dev.ps1` pour démarrer rapidement mock + dashboard + Agent‑3.

Fichiers utiles
---------------
- `pipeline/run_pipeline.py` — runner pipeline local
- `pipeline/assembly/api.py` — API Agent‑3 (FastAPI)
- `data-processing/synthetic_gen.py` — générateur synthétique
- `Simulation/test_page.html` — page de test SDK
- `sdk.js`, `sdk.min.js` — SDK front
