"""RAG core for Agent 3."""

from __future__ import annotations
import json
import os
import logging
from typing import Optional
import requests
from dotenv import load_dotenv
from pipeline.agent3.decision_matrix import ActionTemplate

from pipeline.agent3.rag_context import UserContext, from_user_meta
from pipeline.agent3.rag_retrieval import format_for_prompt

load_dotenv()

logger = logging.getLogger(__name__)


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def generate_llm_response(prompt: str) -> Optional[str]:
    """Return an Ollama response string when enabled, otherwise None."""
    if not _env_flag("OLLAMA_ENABLED", False):
        return None

    ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
    model = os.getenv("OLLAMA_MODEL", "llama3")
    timeout_seconds = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "120"))

    try:
        response = requests.post(
            f"{ollama_url}/api/generate",
            json={
                "model": model,
                "prompt": prompt,
                "stream": False,
                "format": "json",
            },
            timeout=timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        text = payload.get("response")
        return text if isinstance(text, str) and text.strip() else None
    except Exception as exc:
        logger.info("Agent 3 Ollama unavailable, using fallback: %s", exc)
        return None


SYSTEM_PROMPT = """You are an e-commerce conversion optimization advisor embedded in an admin dashboard.
You receive behavioral signals about a user and must generate a concrete admin action to maximize conversion.

Rules:
- No product catalogue is available.
- If churn risk is high, lead with empathy and consider a more generous offer.
- If intent is complaint, acknowledge frustration before the offer.
- If intent is product_information, answer the question first, then nudge toward conversion.
- If intent is track_refund, address the concern first, then propose a retention action.

Always respond with valid JSON only — no markdown, no preamble.
Schema:
{
    "action_type": "<string>",
    "channel": "<email | overlay | chatbot | alert | sms>",
    "subject_line": "<compelling subject for email, or headline for overlay>",
    "body_copy": "<main message, 2-4 sentences>",
    "cta": "<call-to-action button label>",
    "trigger_cond": "<exact technical trigger condition>",
    "urgency": "<low | medium | high | critical>",
    "personalization": {
        "behavioral_hook": "<1 specific insight from user behavior>",
        "discount_pct": "<int or null>",
        "tone": "<reassuring | urgent | exclusive | friendly>"
    },
    "rationale": "<1 sentence — why this action for this behavioral profile>"
}"""


def _format_retrieved_cases(cases: list[dict]) -> str:
    return format_for_prompt(cases)


def _format_user_context(user_context: Optional[UserContext]) -> str:
    if not user_context:
        return "No user metadata available."
    return user_context.render_for_llm_prompt()


def _format_user_meta(user_meta: Optional[dict]) -> str:
    if not user_meta:
        return "No user metadata available."
    lines = ["=== User metadata ==="]
    for key in sorted(user_meta.keys()):
        lines.append(f"{key}: {user_meta[key]}")
    return "\n".join(lines)


def fallback_generate(
    action_template: ActionTemplate,
    retrieved_cases: list[dict],
    user_context: Optional[UserContext],
) -> dict:
    """Deterministic backup used when the LLM cannot be called."""
    behavioral_hook = user_context.render_compact() if user_context else ""
    persona = user_context.persona if user_context and user_context.persona else "User"
    sentiment = user_context.sentiment if user_context and user_context.sentiment else "Neutral"

    if action_template.urgency in {"high", "critical"} or sentiment == "Negative":
        discount_pct = 15 if action_template.urgency == "critical" else 10
    else:
        discount_pct = None

    if retrieved_cases:
        converted_count = sum(1 for case in retrieved_cases if case.get("converted") is True)
        case_hint = f"Based on {converted_count} converted similar cases."
    else:
        case_hint = "No similar cases available."

    article = "an" if action_template.channel[:1].lower() in {"a", "e", "i", "o", "u"} else "a"

    subject_line = {
        "email": f"A tailored note for your {persona.lower()} journey",
        "overlay": "A timely nudge to continue",
        "chatbot": "Need help deciding?",
        "alert": "Immediate follow-up recommended",
        "sms": "A quick offer for you",
    }.get(action_template.channel, "A tailored recommendation")

    body_copy = (
        f"{action_template.description} "
        f"{case_hint} "
        f"We recommend {article} {action_template.channel} touchpoint to address this behavior."
    ).strip()

    return {
        "action_type": action_template.action_type,
        "channel": action_template.channel,
        "subject_line": subject_line,
        "body_copy": body_copy,
        "cta": {
            "email": "Open offer",
            "overlay": "Claim now",
            "chatbot": "Continue",
            "alert": "Escalate",
            "sms": "Redeem",
        }.get(action_template.channel, "Take action"),
        "trigger_cond": action_template.trigger_cond,
        "urgency": action_template.urgency,
        "personalization": {
            "behavioral_hook": behavioral_hook,
            "discount_pct": discount_pct,
            "tone": "urgent" if action_template.urgency in {"high", "critical"} else "friendly",
        },
        "rationale": "deterministic fallback (no LLM available)",
        "_fallback": True,
    }


def assemble_prompt(
    persona:            str,
    sentiment:          str,
    confidence:         float,
    action_template:    ActionTemplate,
    retrieved_cases:    list[dict],
    user_context:       Optional[UserContext] = None,
    user_meta:          Optional[dict] = None,
) -> str:
    narrative = _format_user_context(user_context) if user_context else _format_user_meta(user_meta)
    compact = user_context.render_compact() if user_context else "N/A"
    return f"""=== USER SIGNAL ===
Persona:    {persona}
Sentiment:  {sentiment} (confidence={confidence:.2f})

=== BEHAVIORAL PROFILE ===
{narrative}
Compact context: {compact}

=== ACTION TEMPLATE (rule prior) ===
Type:        {action_template.action_type}
Channel:     {action_template.channel}
Urgency:     {action_template.urgency}
Description: {action_template.description}
Trigger:     {action_template.trigger_cond}

=== RETRIEVED PAST CASES (top-k similar interventions) ===
{_format_retrieved_cases(retrieved_cases)}

=== TASK ===
Generate the exact admin action as JSON.
- Personalize using behavioral patterns (funnel depth, abandon rate, scroll, etc.)
- Prefer approaches from ✓ converted cases
- Avoid approaches from ✗ cases
- Do NOT reference specific products (none available)"""


def generate_recommendation(
    persona:            str,
    sentiment:          str,
    confidence:         float,
    action_template:    ActionTemplate,
    retrieved_cases:    list[dict],
    behavioral_context: str | UserContext = "",
    user_meta:          Optional[dict] = None,
    user_context:       Optional[UserContext] = None,
) -> dict:
    if user_context is None and user_meta is not None:
        user_context = from_user_meta(user_meta, persona=persona, sentiment=sentiment, confidence=confidence)
    if user_context is None and isinstance(behavioral_context, UserContext):
        user_context = behavioral_context

    user_prompt = assemble_prompt(
        persona, sentiment, confidence,
        action_template, retrieved_cases,
        user_context,
        user_meta,
    )

    llm_response = generate_llm_response(
        prompt=(
            f"{SYSTEM_PROMPT}\n\n"
            f"{user_prompt}"
        )
    )

    if llm_response is None:
        result = fallback_generate(action_template, retrieved_cases, user_context)
    else:
        try:
            result = json.loads(llm_response)
        except json.JSONDecodeError:
            cleaned = llm_response.strip().removeprefix("```json").removesuffix("```").strip()
            try:
                result = json.loads(cleaned)
            except Exception as exc:
                logger.warning("Agent 3 LLM response parse failed, using fallback: %s", exc)
                result = fallback_generate(action_template, retrieved_cases, user_context)

    result["persona"]    = persona
    result["sentiment"]  = sentiment
    result["confidence"] = confidence
    return result