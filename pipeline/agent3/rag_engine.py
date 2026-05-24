"""
rag_engine.py — RAG core for Agent 3
No product catalogue: behavioral_context replaces products as the grounding signal.

Flow: (pu, σu, behavioral_context) → prompt assembly → LLM → r̂u
"""

from __future__ import annotations
import json, os
from typing import Optional
from dotenv import load_dotenv
from openai import OpenAI
from decision_matrix import ActionTemplate

from rag_context import UserContext, from_user_meta

load_dotenv()


def _get_llm() -> OpenAI:
    return OpenAI(
        api_key  = os.environ["OPENAI_API_KEY"],
        base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    )


SYSTEM_PROMPT = """You are an e-commerce conversion optimization advisor embedded in an admin dashboard.
You receive behavioral signals about a user (funnel depth, scroll, bounce rate, purchase history, etc.)
and must generate a CONCRETE, SPECIFIC admin action to maximize conversion.

You have NO product catalogue — personalize based on behavioral patterns only.

Always respond with valid JSON only — no markdown, no preamble.
Schema:
{
  "action_type":    "<string>",
  "channel":        "<email | overlay | chatbot | alert | sms>",
  "subject_line":   "<compelling subject for email, or headline for overlay>",
  "body_copy":      "<main message, 2-4 sentences>",
  "cta":            "<call-to-action button label>",
  "trigger_cond":   "<exact technical trigger condition>",
  "urgency":        "<low | medium | high | critical>",
  "personalization": {
    "behavioral_hook": "<1 specific insight from user behavior, e.g. 'reached checkout 3x without buying'>",
    "discount_pct":    "<int or null>",
    "tone":            "<reassuring | urgent | exclusive | friendly>"
  },
  "rationale": "<1 sentence — why this action for this behavioral profile>"
}"""


def _format_retrieved_cases(cases: list[dict]) -> str:
    if not cases:
        return "No similar past cases — generate a fresh recommendation."
    lines = []
    for i, c in enumerate(cases, 1):
        outcome = "✓ converted" if c.get("converted") else "✗ no conversion"
        sim = c.get("similarity", 0)
        ctx = c.get("context", "")
        lines.append(
            f"Case {i} (sim={sim:.2f}, {outcome}): "
            f"persona={c['persona']}, sentiment={c['sentiment']}, "
            f"action={c['action_type']} — \"{c.get('action_detail','')}\" | ctx: {ctx}"
        )
    return "\n".join(lines)


def _format_user_context(user_context: Optional[UserContext]) -> str:
    if not user_context:
        return "No user metadata available."
    return user_context.render_narrative()


def _fallback_recommendation(
    persona: str,
    sentiment: str,
    confidence: float,
    action_template: ActionTemplate,
    retrieved_cases: list[dict],
    behavioral_context: str,
    user_context: Optional[UserContext] = None,
) -> dict:
    """Deterministic backup used when the LLM cannot be called."""
    behavioral_hook = (user_context.render_compact() if user_context else behavioral_context) or "strong engagement signal"
    if user_context and user_context.max_funnel_depth is not None:
        behavioral_hook = f"reached funnel depth {user_context.max_funnel_depth}"

    if action_template.urgency in {"high", "critical"} or sentiment == "Negative":
        discount_pct = 15 if action_template.urgency == "critical" else 10
    else:
        discount_pct = None

    subject_line = {
        "email": f"A tailored note for your {persona.lower()} journey",
        "overlay": "A timely nudge to continue",
        "chatbot": "Need help deciding?",
        "alert": "Immediate follow-up recommended",
        "sms": "A quick offer for you",
    }.get(action_template.channel, "A tailored recommendation")

    return {
        "action_type": action_template.action_type,
        "channel": action_template.channel,
        "subject_line": subject_line,
        "body_copy": (
            f"This action is based on the user's {persona.lower()} profile and {sentiment.lower()} sentiment. "
            f"Use the rule prior: {action_template.description}. Trigger it when {action_template.trigger_cond}."
        ),
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
        "rationale": (
            f"Fallback recommendation generated locally because the LLM was unavailable. "
            f"It still follows the {persona}/{sentiment} rule prior and {len(retrieved_cases)} retrieved case(s)."
        ),
    }


def assemble_prompt(
    persona:            str,
    sentiment:          str,
    confidence:         float,
    action_template:    ActionTemplate,
    retrieved_cases:    list[dict],
    user_context:       Optional[UserContext] = None,
) -> str:
    narrative = _format_user_context(user_context)
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
    llm   = _get_llm()
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    if user_context is None and user_meta is not None:
        user_context = from_user_meta(user_meta, persona=persona, sentiment=sentiment, confidence=confidence)
    if user_context is None and isinstance(behavioral_context, UserContext):
        user_context = behavioral_context

    user_prompt = assemble_prompt(
        persona, sentiment, confidence,
        action_template, retrieved_cases,
        user_context,
    )

    try:
        response = llm.chat.completions.create(
            model           = model,
            messages        = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": user_prompt},
            ],
            temperature     = 0.4,
            max_tokens      = 600,
            response_format = {"type": "json_object"},
        )

        raw = response.choices[0].message.content
        try:
            result = json.loads(raw)
        except json.JSONDecodeError:
            cleaned = raw.strip().removeprefix("```json").removesuffix("```").strip()
            result  = json.loads(cleaned)
    except Exception:
        result = _fallback_recommendation(
            persona,
            sentiment,
            confidence,
            action_template,
            retrieved_cases,
            behavioral_context if isinstance(behavioral_context, str) else "",
            user_context,
        )

    result["persona"]    = persona
    result["sentiment"]  = sentiment
    result["confidence"] = confidence
    return result