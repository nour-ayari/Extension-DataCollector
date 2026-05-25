"""
run_real_flow.py — single-command runner for the production Agent 3 flow

Usage:
    python pipeline/run_real_flow.py

This runs the existing pipeline end to end:
- feature engineering
- aggregation
- multi-agent scoring
- Supabase sync
- Agent 3 recommendation generation
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from pipeline.run_pipeline import main


if __name__ == "__main__":
    main()
