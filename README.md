
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

## Agent 3 LLM mode

Agent 3 now runs in deterministic fallback mode by default. Optional local Ollama support can be enabled with environment variables:

```env
OLLAMA_ENABLED=false
OLLAMA_MODEL=llama3
OLLAMA_URL=http://localhost:11434
```

If Ollama is not running or the request fails, Agent 3 returns a valid recommendation JSON using its rule-based fallback.

**Agent 3 — Détails techniques**

- **But :** Agent 3 est un moteur de recommandations RAG (Retrieval-Augmented Generation) destiné à produire des actions administratives concrètes pour améliorer la conversion utilisateur (emails, overlays, chatbot prompts, alertes, SMS).

- **Fichiers clés :**
	- [pipeline/agent3/rag_context.py](pipeline/agent3/rag_context.py): définition de la structure `UserContext`, fonctions `render_for_llm_prompt()`, `render_with_action()` et `render_compact()`.
	- [pipeline/agent3/vector_store.py](pipeline/agent3/vector_store.py): encapsule l'embedder (sentence-transformers), la construction du texte de cas, l'`upsert_case()` et la recherche `search_similar_cases()` vers Supabase/pgvector.
	- [pipeline/agent3/rag_retrieval.py](pipeline/agent3/rag_retrieval.py): logique de récupération et réordonnancement (rerank) — pondérations par similarité, outcome (converted), récence et injection de diversité.
	- [pipeline/agent3/decision_matrix.py](pipeline/agent3/decision_matrix.py): matrice de décision statique qui mappe `(persona, sentiment)` → `ActionTemplate` (type, canal, urgence, description, trigger).
	- [pipeline/agent3/rag_engine.py](pipeline/agent3/rag_engine.py): assemble le prompt, appelle l'LLM via l'adaptateur Ollama (`generate_llm_response()`), et fournit le fallback déterministe (`fallback_generate()`).
	- [pipeline/agent3/seed_from_supabase.py](pipeline/agent3/seed_from_supabase.py): seeder réel qui extrait `user_features` depuis Supabase et upserte des cas structurés.
	- [pipeline/agent3/seed_from_coveo.py](pipeline/agent3/seed_from_coveo.py): seeder qui agrège les événements de navigation (raw_coveo_events), synthétise sentiment/convert, équilibre les quotas et génère des cas de RAG diversifiés.
	- [ingest_coveo_to_supabase.py](ingest_coveo_to_supabase.py): ingestion CSV → `raw_coveo_events` (chunked, nettoyage JSON-safe, batch insert, retries).
	- [pipeline/agent3/test_ollama_connection.py](pipeline/agent3/test_ollama_connection.py): petit script de test pour vérifier la connexion HTTP vers Ollama.
	- [pipeline/assembly/test_agent3_workflow.py](pipeline/assembly/test_agent3_workflow.py): test d'intégration qui simule Agent1→Agent2→Agent3 pour valider le flux et le fallback.

- **Flux d'exécution (haute-niveau) :**
	1. Normaliser le profil / événements utilisateur dans `UserContext`.
	2. Construire l'empreinte textuelle du cas via `vector_store.build_case_text()`.
	3. Rechercher les `TOP_K_RETRIEVAL` cas similaires via `vector_store.search_similar_cases()`.
	4. Reranker les candidats par similarité + outcome/récence/diversité (`rag_retrieval.rerank`).
	5. Résoudre la règle prioritaire via `decision_matrix` → `ActionTemplate`.
	6. Appeler l'LLM (si `OLLAMA_ENABLED=true`) avec le `SYSTEM_PROMPT` + prompt assemblé (`rag_engine.assemble_prompt`).
	7. Parser la réponse JSON de l'LLM ; en cas d'échec, utiliser `fallback_generate()` (toujours retourne JSON valide).
	8. Loguer et `upsert_case()` dans le magasin vectoriel pour apprentissage continu.

- **Variables d'environnement importantes :**
	- `OLLAMA_ENABLED` : true|false (active la voie locale Ollama)
	- `OLLAMA_URL` : URL du serveur Ollama (ex. `http://127.0.0.1:11434`)
	- `OLLAMA_MODEL` : nom du modèle Ollama (ex. `qwen2.5:0.5b`)
	- `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_DB_URL` : connexion Supabase/Postgres
	- `EMBEDDING_MODEL` : modèle local d'embeddings (ex. `all-MiniLM-L6-v2`)
	- `TOP_K_RETRIEVAL` : nombre de cas récupérés

- **Comportement de secours (fallback) :**
	- Le fallback est une génération déterministe dans `rag_engine.fallback_generate()` qui construit une action complète (action_type, channel, subject_line, body_copy, cta, trigger_cond, urgency, personalization, rationale) en se basant sur `ActionTemplate`, la persona, sentiment et les cas récupérés.
	- Le fallback garantit que l'API renvoie toujours un JSON exploitable même si l'LLM est indisponible ou renvoie du texte non-JSON.

- **Seeders & ingestion :**
	- Utiliser `ingest_coveo_to_supabase.py` pour alimenter la table `raw_coveo_events` depuis le CSV Coveo.
	- Puis exécuter `pipeline/agent3/seed_from_coveo.py` en mode `--dry-run` pour vérifier la synthèse et l'équilibrage des quotas avant upsert.
	- `seed_from_supabase.py` importe des features utilisateur réelles et les convertit en cas RAG.

- **Tests & vérifications :**
	- Test Ollama :
		```bash
		python -m pipeline.agent3.test_ollama_connection
		```
	- Test d'intégration Agent 3 :
		```bash
		python -m pipeline.assembly.test_agent3_workflow
		```

- **Dépannage rapide Ollama :**
	- Vérifier que le serveur Ollama est en écoute : `ollama serve` ou `ollama run <model>`.
	- Lister les modèles installés : `ollama list`.
	- Si vous utilisez `qwen2.5:0.5b`, définir `OLLAMA_MODEL=qwen2.5:0.5b` dans `.env`.
	- Si l'adapter retourne `No Ollama response (disabled or unreachable)`, vérifier l'URL (`OLLAMA_URL`) et que le port 11434 n'est pas bloqué.

**Remarques finales**
- Le design privilégie la robustesse : même sans modèle externe, les équipes produit et opérations peuvent obtenir recommandations cohérentes via la voie fallback.
- La mémoire d'interventions (table vectorielle Supabase + pgvector) sert à ancrer les suggestions dans des cas passés ayant de vrais outcomes, améliorant la qualité des recommandations au fil du temps.

Si tu veux, je peux:
- ajouter un extrait d'exemple de sortie JSON produite par `fallback_generate()`;
- ajouter une checklist pour exécuter un run complet (ingest → seed → test) dans `README`.
