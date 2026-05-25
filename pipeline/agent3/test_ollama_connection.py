"""Quick tester for the Ollama adapter used by Agent 3.

Run from the repo root with your virtualenv active.
Example:
    python -m pipeline.agent3.test_ollama_connection

The script reads .env and prints the LLM response or an error.
"""
from dotenv import load_dotenv
import os
import sys

load_dotenv()

from pipeline.agent3 import rag_engine

PROMPT = "Test: Say hello in one sentence and return JSON {\"ok\": true, \"msg\": \"hello\"}."


def main():
    print("OLLAMA_ENABLED:", os.getenv("OLLAMA_ENABLED"))
    print("OLLAMA_URL:", os.getenv("OLLAMA_URL"))
    print("OLLAMA_MODEL:", os.getenv("OLLAMA_MODEL"))
    resp = rag_engine.generate_llm_response(PROMPT)
    if resp is None:
        print("No Ollama response (disabled or unreachable).\n")
        sys.exit(2)
    print("Raw response:")
    print(resp)


if __name__ == "__main__":
    main()
