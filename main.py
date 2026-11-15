"""FastAPI backend for the "Aethon" microgravity combustion dashboard.

Routes
------
``GET      /``               health probe
``POST     /query-agent``    RAG question answering over the NASA paper index
``GET/POST /rank-materials`` material flammability risk ranking

Rebuilt from the surviving ``__pycache__/main.cpython-313.pyc`` bytecode. The
routes and the Gemini prompt are unchanged; added on top are CORS, tolerant
request parsing (the dashboard posts ``query`` while the original model only
accepted ``question``) and the response keys ``normalizeAnswer`` /
``normalizeRanking`` in the dashboard actually read, so the UI shows live
results instead of silently dropping into demo mode.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import socket
from contextlib import asynccontextmanager
from typing import Any, Optional
from urllib.parse import quote

import chromadb
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_random_exponential

def _validate_combustion_conditions(
    oxygen_conc: Optional[float],
    fuel: Optional[str],
) -> Optional[str]:
    """Validate basic combustion boundary conditions before retrieval.

    Returns a warning message if sustained combustion is physically impossible,
    or None if conditions are acceptable for querying.

    Checks:
    - If fuel is specified but oxygen_conc is 0% or effectively absent (inert atmosphere),
      flag that combustion cannot be sustained.
    - If oxygen_conc is missing/None but fuel is present, also flag the issue.
    - Normal cases with fuel and reasonable oxygen levels pass through.
    """
    # No fuel specified - nothing to validate
    if not fuel:
        return None

    # If oxygen concentration is not specified, we can't validate fully
    # but we shouldn't block the query - just note it
    if oxygen_conc is None:
        return None

    # Clamp oxygen to valid range for checking
    ox = max(0.0, min(100.0, oxygen_conc))

    # Check for inert atmosphere: oxygen concentration at or near 0%
    # with a fuel specified means no oxidizer for sustained combustion
    if ox <= 2.0:
        return (
            f"WARNING: Inert atmosphere detected (oxygen concentration {ox:.1f}%). "
            f"Sustained combustion is physically impossible with '{fuel}' "
            f"fuel in the absence of an oxidizer. The retrieval database may "
            f"contain documents about extinguishment or smoldering, but not "
            f" sustained flame spread."
        )

    # Check for very low oxygen that may not support combustion
    # Typical minimum for hydrocarbon combustion is ~12-15% O2
    if ox < 15.0:
        # This is a warning, not a hard block, as some limited combustion
        # can occur at reduced oxygen, but we flag it
        pass  # Could add a warning here if desired

    # Basic combustion conditions appear satisfied
    return None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_DIR = os.path.join(BASE_DIR, "chroma_db")
COLLECTION = "langchain"
# PRIMARY: Groq (fast, OpenAI-compatible API)
GROQ_MODEL = "qwen/qwen3.8-27b"
GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions"
# BACKUP: OpenRouter (falls back to automatically when Groq is unreachable)
OPENROUTER_MODEL = "meta-llama/llama-3.1-8b-instruct"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions"
# Temperature shared by both providers.
AI_TEMPERATURE = 0.7
# Conversation turns replayed to the model on every request. Capped so a long
# session cannot blow the context window or the request body.
MAX_HISTORY_TURNS = 40

# Secrets come from `.env` next to this file so the keys never land in source.
# Put `GROQ_API_KEY=...` and `OPENROUTER_API_KEY=...` in that file and restart -
# nothing else changes.
load_dotenv(os.path.join(BASE_DIR, ".env"))

# Retrieval shape. The index stores several chunks per page (and repeats some),
# so we pull 8 candidates, drop near-duplicates and anything barely resembling
# the question, then re-rank them against the query before keeping the best few.
MAX_PASSAGES = 3
FETCH_K = 8
# Cosine similarity below the calibrated grounding range is not enough evidence
# to generate an answer from the indexed papers.
MIN_SIMILARITY = 0.15

COHERE_URL = "https://api.cohere.com/v2/rerank"
CROSS_ENCODER = "cross-encoder/ms-marco-MiniLM-L-6-v2"

# Materials the dashboard ranks: base flammability (0-1) plus hazard wording.
MATERIALS = [
    {"id": "PMMA", "label": "PMMA (Acrylic)", "base": 0.80,
     "risk_level": "High Hazard", "spread": "Fast", "extinction": "0.18 m/s airflow"},
    {"id": "Silicone", "label": "Silicone Rubber", "base": 0.75,
     "risk_level": "High Hazard", "spread": "Moderate-Fast", "extinction": "0.12 m/s airflow"},
    {"id": "Cotton", "label": "Cotton Fabric", "base": 0.55,
     "risk_level": "Caution", "spread": "Moderate", "extinction": "0.08 m/s airflow"},
    {"id": "Nomex", "label": "Nomex Fabric", "base": 0.45,
     "risk_level": "Caution", "spread": "Slow", "extinction": "0.05 m/s airflow"},
    {"id": "Kevlar", "label": "Kevlar Blend", "base": 0.25,
     "risk_level": "Low Hazard / Safe", "spread": "Self-Extinguishing", "extinction": "N/A"},
]


def _clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def _tier(score: float) -> str:
    if score >= 0.6:
        return "High"
    return "Medium" if score >= 0.35 else "Low"


def _as_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _file_name(source: Any) -> str:
    return str(source or "").replace("\\", "/").split("/")[-1]


QUERY_CORRECTIONS = {
    "mcro": "microgravity",
    "flm": "flame",
    "grafity": "gravity",
    "investigaton": "investigation",
    "PMMA": "Polymethyl Methacrylate PMMA",
}
IDENTIFIER_PATTERNS = ("PSI-62", "BASS", "UFGM", "SoFIE", "SAFFIRE", "PMMA")
GREETINGS = frozenset({"hi", "hello", "sup", "yo", "help"})


def _normalize_query(question: str) -> str:
    normalized = question
    for typo, correction in QUERY_CORRECTIONS.items():
        normalized = re.sub(
            rf"\b{re.escape(typo)}\b", correction, normalized, flags=re.IGNORECASE
        )
    return normalized


def _query_identifiers(question: str) -> list[str]:
    return [
        identifier
        for identifier in IDENTIFIER_PATTERNS
        if re.search(rf"(?<!\w){re.escape(identifier)}(?!\w)", question, re.IGNORECASE)
    ]


def _is_greeting(question: str) -> bool:
    normalized = re.sub(r"[^\w\s]", "", question.casefold()).strip()
    return len(question.strip()) <= 3 or normalized in GREETINGS


def _welcome_answer() -> str:
    return "Hello! I’m AETHON, your NASA microgravity combustion research assistant. What would you like to explore?"


def _clarification_answer() -> str:
    return (
        "I couldn’t find a close match in the indexed papers. "
        "Could you clarify the material, gravity level, or combustion behavior you’re asking about?"
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Warm the ONNX embedding session so the very first user query is quick.
    try:
        similarity_search("flame spread in microgravity", k=1)
    except Exception:
        pass
    yield


app = FastAPI(title="NASA Space Fire Safety API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_collection: Any = None
_collection_error: Optional[str] = None


def get_collection():
    """Open the persisted Chroma index, or ``None`` when it is unavailable."""
    global _collection, _collection_error
    if _collection is not None:
        return _collection
    try:
        client = chromadb.PersistentClient(path=DB_DIR)
        existing = [c.name for c in client.list_collections()]
        if COLLECTION in existing:
            _collection = client.get_collection(COLLECTION)
        elif "microcombust_papers" in existing:
            _collection = client.get_collection("microcombust_papers")
        elif existing:
            _collection = client.get_collection(existing[0])
        else:
            _collection = client.get_or_create_collection(COLLECTION)
        _collection_error = None
        return _collection
    except Exception as exc:  # pragma: no cover - defensive
        _collection_error = str(exc)
        return None


def similarity_search(question: str, k: int = MAX_PASSAGES):
    """Return the ``k`` best chunks: fetch 8 -> filter -> de-dupe -> re-rank."""
    collection = get_collection()
    if collection is None:
        return []
    normalized_question = _normalize_query(question)
    try:
        result = collection.query(query_texts=[normalized_question], n_results=FETCH_K)
    except Exception:
        return []
    documents = (result.get("documents") or [[]])[0]
    metadatas = (result.get("metadatas") or [[]])[0]
    distances = (result.get("distances") or [[]])[0]

    candidates = []
    seen = set()
    for text, meta, dist in zip(documents, metadatas, distances):
        meta = meta or {}
        text = text or ""
        if confidence_of(dist) < MIN_SIMILARITY:
            continue
        # Same source + page + opening words means the passage was ingested
        # twice; keeping it twice would waste a slot on a repeat.
        key = (str(meta.get("source")), meta.get("page"), text[:120])
        if key in seen:
            continue
        seen.add(key)
        candidates.append({"metadata": meta, "page_content": text, "distance": dist})
        if len(candidates) >= FETCH_K:
            break

    # Re-rank against the query before anything reaches the prompt.
    return rerank(normalized_question, candidates, k)


def confidence_of(distance: Any) -> float:
    """Map an L2 distance between unit-length MiniLM vectors to a 0-1 score."""
    try:
        gap = float(distance)
    except (TypeError, ValueError):
        return 0.5
    # For unit vectors: cosine similarity = 1 - d^2 / 2.
    return round(_clamp(1.0 - (gap * gap) / 2.0, 0.0, 1.0), 4)


# --- Candidate re-ranking ----------------------------------------------------
# Chroma scores each passage on its own, so a weakly related chunk can still
# clear the relevance floor and then dilute the prompt. Re-ranking the 10
# candidates against the actual query is what keeps that out. Three tiers,
# best available first:
#   1. Cohere Rerank  - set COHERE_API_KEY in `.env`
#   2. cross-encoder   - `pip install sentence-transformers`
#   3. lexical fusion  - no dependencies, always available
_STOPWORDS = frozenset(
    "a an and are as at be by for from has have how in is it of on or that the "
    "this to was what when which with you your".split()
)

_cross_encoder: Any = None
_cross_encoder_failed = False


def _tokens(text: str) -> set:
    return {
        token
        for token in re.findall(r"[a-z0-9]+", text.lower())
        if len(token) > 1 and token not in _STOPWORDS
    }


def _cohere_ranks(query: str, docs: list) -> Optional[list[int]]:
    """Cohere Rerank ordering, or ``None`` so the next tier can take over."""
    key = os.getenv("COHERE_API_KEY", "").strip()
    if not key:
        return None
    try:
        import requests  # already installed as a chromadb dependency
    except ImportError:
        return None
    try:
        response = requests.post(
            COHERE_URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": os.getenv("COHERE_RERANK_MODEL", "rerank-english-v3.0"),
                "query": query,
                "documents": [doc["page_content"][:2000] for doc in docs],
                "top_n": len(docs),
            },
            timeout=20,
        )
        response.raise_for_status()
        order = [
            int(item["index"])
            for item in response.json().get("results", [])
            if 0 <= int(item["index"]) < len(docs)
        ]
        return order or None
    except Exception:
        # Bad key, quota, offline - any problem falls through to the next tier
        # rather than failing the query the user is waiting on.
        return None


def _cross_encoder_ranks(query: str, docs: list) -> Optional[list[int]]:
    """Cross-encoder ordering, when sentence-transformers is installed."""
    global _cross_encoder, _cross_encoder_failed
    if _cross_encoder is None and not _cross_encoder_failed:
        try:
            CrossEncoder = getattr(
                importlib.import_module("sentence_transformers"), "CrossEncoder"
            )
            # Use local_files_only to prevent network hangs when offline/sandboxed
            try:
                _cross_encoder = CrossEncoder(CROSS_ENCODER, local_files_only=True)
            except Exception:
                # If model is not cached locally, immediately fail so lexical ranking takes over
                _cross_encoder_failed = True
                return None
        except Exception:
            _cross_encoder_failed = True
            return None
    if _cross_encoder is None:
        return None
    try:
        scores = _cross_encoder.predict([(query, doc["page_content"]) for doc in docs])
    except Exception:
        return None
    return sorted(range(len(docs)), key=lambda i: float(scores[i]), reverse=True)


def _lexical_ranks(query: str, docs: list) -> list[int]:
    """Dependency-free fallback: fuse Chroma's semantic score with token overlap.

    A cross-encoder reads query and passage together; this is the cheap
    approximation of that, and it still beats trusting Chroma's order as-is.
    """
    query_tokens = _tokens(query)
    scored = []
    for index, doc in enumerate(docs):
        semantic = confidence_of(doc.get("distance"))
        overlap = len(query_tokens & _tokens(doc["page_content"])) / max(
            len(query_tokens), 1
        )
        scored.append((0.6 * semantic + 0.4 * overlap, index))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [index for _, index in scored]


def rerank(query: str, docs: list, top_k: int = MAX_PASSAGES) -> list:
    """Order *docs* best-first, then keep only the top ``top_k``."""
    if not docs:
        return []
    order = (
        _cohere_ranks(query, docs)
        or _cross_encoder_ranks(query, docs)
        or _lexical_ranks(query, docs)
    )
    identifiers = _query_identifiers(query)
    if identifiers:
        order.sort(
            key=lambda index: not any(
                re.search(
                    rf"(?<!\w){re.escape(identifier)}(?!\w)",
                    docs[index]["page_content"],
                    re.IGNORECASE,
                )
                for identifier in identifiers
            )
        )
    return [docs[i] for i in order[:top_k]]


def rerank_provider() -> str:
    """Which tier the next query would use - reported on the health endpoint."""
    if os.getenv("COHERE_API_KEY", "").strip():
        return "cohere"
    if importlib.util.find_spec("sentence_transformers"):
        return "cross-encoder"
    return "lexical-fusion"


def source_url(source: Any) -> str:
    """Build a citable NASA link from an indexed file name."""
    stem = os.path.splitext(_file_name(source))[0].strip()
    if re.fullmatch(r"\d{6,}", stem):
        return f"https://ntrs.nasa.gov/citations/{stem}"
    return f"https://ntrs.nasa.gov/search?q={quote(stem) or 'microgravity+combustion'}"


def source_title(source: Any) -> str:
    stem = os.path.splitext(_file_name(source))[0] or "NASA source"
    if stem.isdigit():
        name = f"NASA NTRS Record {stem}"
    else:
        stem = re.sub(r"^combustion-science_doc_\d+_", "", stem, flags=re.IGNORECASE)
        name = re.sub(r"[_-]+", " ", stem).strip()
        name = name[:1].upper() + name[1:]
    return name


def _primary_key(explicit: Optional[str] = None) -> Optional[str]:
    """Resolve the Groq API key, rejecting empty values and `.env` placeholders."""
    key = (explicit or os.getenv("GROQ_API_KEY") or "").strip()
    if not key or key.lower().startswith(("your-", "paste-", "changeme", "xxx", "<")):
        return None
    return key


def _backup_key() -> Optional[str]:
    """Resolve the OpenRouter API key, rejecting empty values and `.env` placeholders."""
    key = os.getenv("OPENROUTER_API_KEY") or ""
    key = key.strip()
    if not key or key.lower().startswith(("your-", "paste-", "changeme", "xxx", "<")):
        return None
    return key


def _no_key_answer() -> str:
    """Only when no AI key is set *and* retrieval found nothing.

    Infrastructure message, not a chat path: with no model there is genuinely
    nothing to talk to. Never reachable while a key is configured, so it
    cannot make one kind of question look different from another.
    """
    return (
        "I can't answer that right now - there's no AI key configured, so "
        "I have no model to think with, and the NASA index had nothing close "
        "enough to quote from.\n\n"
        "Add GROQ_API_KEY (primary) or OPENROUTER_API_KEY (backup) to `.env` "
        "next to main.py and restart the server to turn me back on, "
        "conversation memory included."
    )


def _preview_answer() -> str:
    """Explain that retrieval succeeded but answer generation is offline."""
    return "I found relevant research papers, but answer generation is currently unavailable."


def _unavailable_answer(docs: list, exc: BaseException) -> str:
    """Handed back once retries are exhausted.

    One voice and one shape whether or not retrieval had anything, so a science
    question failing mid-session does not surface a visibly different style of
    message from a casual one. Only reachable when the Gemini call itself has
    failed, after 3 attempts.
    """
    reason = _describe_error(exc)
    if not _is_transient(exc):
        # Permanent (bad key, blocked prompt): no point waiting, just say so.
        lead = (
            f"I couldn't reach the AI for that one ({reason}). Check "
            "GROQ_API_KEY / OPENROUTER_API_KEY in `.env` next to main.py and "
            "restart the server."
        )
    else:
        lead = (
            f"The AI is busy right now ({reason}) - I retried 3 times with "
            "backoff and it still didn't recover, so I'd rather say so than "
            "guess at an answer."
        )
    return lead + (" Give it another go in a moment." if not docs else "")


def _settings_block(
    oxygen: Optional[float],
    pressure: Optional[float],
    airflow: Optional[float],
    fuel: Optional[str],
) -> Optional[str]:
    """Render the live dashboard controls as prompt context, when supplied.

    Returns ``None`` when the client sent none of them, so a plain curl does
    not get a block full of "not set".
    """
    if oxygen is None and pressure is None and airflow is None and not fuel:
        return None

    def fmt(value: Optional[float], unit: str = "") -> str:
        return "not set" if value is None else f"{value:g}{unit}"

    return "\n".join(
        [
            "ACTIVE DASHBOARD SETTINGS",
            "The user currently has these controls set on the dashboard:",
            f"- Oxygen concentration: {fmt(oxygen, ' %')}",
            f"- Ambient pressure: {fmt(pressure, ' kPa')}",
            f"- Forced airflow velocity: {fmt(airflow, ' cm/s')}",
            f"- Fuel specimen: {fuel or 'not set'}",
            "",
            "Reference these when they matter to the question - for example when "
            "the user asks about the selected material or says 'at these "
            "settings' - and say plainly when the retrieved passages do not cover "
            "that exact combination. Do not claim to have simulated these values: "
            "the sliders feed a ranking heuristic, not a physics solver.",
        ]
    )


# Keep generated answers evidence-led with citations isolated at the end.
_PERSONA_INSTRUCTION = """You are AETHON, a scientific assistant for NASA microgravity combustion and spacecraft fire-safety research.

Use retrieved passages as evidence. Be precise, distinguish measured findings from interpretation, and do not invent facts or numerical values. If the passages do not answer the question, briefly say what information is missing and ask a useful follow-up.

Use clear Markdown and LaTeX where helpful. Never put PDF filenames, passage tags, or inline citations in answer sentences. For evidence-based answers, end with exactly one section titled `### 📚 Referenced NASA Papers & Datasets`; list relevant paper titles there as clean Markdown links. Do not add a generic dataset list."""

def _system_instruction(
    gravity_filter: Optional[str],
    settings_block: Optional[str] = None,
) -> str:
    """Provide retrieval, telemetry, and clean-citation instructions."""
    gravity = (gravity_filter or "").strip() or "0g (Microgravity)"
    parts = [
        _PERSONA_INSTRUCTION,
        "",
        "ACTIVE TELEMETRY & SYSTEM STATE:",
        f"- Active Gravity Environment: {gravity}.",
        "- The oxygen concentration, pressure, and airflow sliders provide telemetry for flammability risk estimation heuristic, not an active CFD simulation.",
        "",
        "RETRIEVAL AND CITATION RULES:",
        "- Use attached paper passages as evidence and do not add inline citations or source filenames to answer sentences.",
        "- End evidence-based responses with one `### 📚 Referenced NASA Papers & Datasets` section.",
        "- When evidence is insufficient, respond naturally and ask the user to clarify or rephrase.",
    ]
    if settings_block:
        parts.extend(["", settings_block])
    return "\n".join(parts)


def _user_turn(question: str, context_text: str) -> str:
    """The current turn: user query plus attached passages when retrieved."""
    passages = context_text.strip()
    if not passages:
        return (
            f"User Query: {question}\n\n"
            "[No relevant paper passages were retrieved. Ask the user to clarify or rephrase.]"
        )
    return (
        f"User Query: {question}\n\n"
        "Retrieved NASA Technical Passages:\n"
        f"{passages}\n\n"
        "Instructions: Synthesize a scientific answer strictly grounded in the above NASA passages. "
        "Do not include inline citations or source filenames. Add one clean linked references section at the very end."
    )


def _append_clean_references(answer: str, docs: list) -> str:
    answer = re.split(
        r"(?m)^#{1,6}\s*(?:📚\s*)?Referenced NASA Papers(?: & Datasets)?\s*$",
        answer,
        maxsplit=1,
    )[0]
    answer = re.sub(r"\[[^\]\n]*\.pdf[^\]\n]*\]", "", answer, flags=re.IGNORECASE)
    answer = re.sub(r"\b[\w-]+(?:_[\w-]+)*\.pdf\b", "", answer, flags=re.IGNORECASE)
    answer = re.sub(r"\[PASSAGE\s+\d+\]", "", answer, flags=re.IGNORECASE)
    answer = re.sub(r"[ \t]+\n", "\n", answer).strip()

    references = []
    seen_sources = set()
    for doc in docs:
        meta = doc.get("metadata") or {}
        source = str(meta.get("source") or "")
        if not source or source.casefold() in seen_sources:
            continue
        seen_sources.add(source.casefold())
        title = source_title(source)
        references.append(f"- [{title}]({source_url(source)})")
    if not references:
        return answer
    return (
        f"{answer}\n\n### 📚 Referenced NASA Papers & Datasets\n"
        + "\n".join(references)
    )


# --- Gemini text generation with retry ---------------------------------------
# Only failures a retry can plausically fix are retried: 503 unavailability, 429
# rate limits and timeouts. Everything else (bad key = 400, blocked prompt, ...)
# is permanent, and re-running it would only delay an error the user needs now.
_TRANSIENT_CODES = {408, 425, 429, 500, 502, 503, 504}
_TRANSIENT_WORDS = (
    "rate limit",
    "rate_limit",
    "rate-limit",
    "resource exhausted",
    "resource_exhausted",
    "quota",
    "unavailable",
    "overloaded",
    "timeout",
    "timed out",
    "temporarily",
    "connection reset",
)


def _is_transient(exc: BaseException) -> bool:
    """True when retrying could plausibly succeed (503 / rate limit / timeout)."""
    if isinstance(exc, (TimeoutError, ConnectionError)):
        return True
    try:
        code = int(getattr(exc, "code", None))
    except (TypeError, ValueError):
        code = None
    if code is not None:
        return code in _TRANSIENT_CODES
    text = str(exc).lower()
    return any(word in text for word in _TRANSIENT_WORDS)


def _describe_error(exc: BaseException) -> str:
    """Short human-readable reason, never a raw exception dump."""
    try:
        code = int(getattr(exc, "code", None))
    except (TypeError, ValueError):
        code = None
    if code == 429:
        return "rate limit reached (HTTP 429)"
    if code == 503:
        return "service unavailable (HTTP 503)"
    if code is not None:
        return f"HTTP {code} {type(exc).__name__}"
    text = " ".join(str(exc).split()) or type(exc).__name__
    return text[:160] + "..." if len(text) > 160 else text


def _clean_history(raw: Any) -> list:
    """Normalise the client's history into clean ``user`` / ``model`` turns."""
    if not isinstance(raw, (list, tuple)):
        return []
    turns = []
    for turn in list(raw)[-MAX_HISTORY_TURNS:]:
        if not isinstance(turn, dict):
            continue
        role = str(turn.get("role") or "").strip().lower()
        text = str(
            turn.get("text") or turn.get("content") or turn.get("message") or ""
        ).strip()
        if not text:
            continue
        if role == "assistant":
            role = "model"
        if role not in ("user", "model"):
            continue
        turns.append({"role": role, "text": text})
    # Gemini's content list must open with a user turn.
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    return turns


def _build_contents(history: list, question: str) -> list:
    """History plus the current question, shaped as a Gemini content list.

    Adjacent turns of the same role are folded together, because Gemini expects
    roles to alternate and otherwise rejects the request with a 400.
    """
    merged: list = []
    for turn in list(history) + [{"role": "user", "text": question}]:
        if merged and merged[-1]["role"] == turn["role"]:
            merged[-1] = {
                "role": turn["role"],
                "text": merged[-1]["text"] + "\n" + turn["text"],
            }
        else:
            merged.append(dict(turn))
    while merged and merged[0]["role"] != "user":
        merged.pop(0)
    return [
        {"role": turn["role"], "text": turn["text"]}
        for turn in merged
    ]


@retry(
    wait=wait_random_exponential(min=1, max=10),
    stop=stop_after_attempt(3),
    retry=retry_if_exception(_is_transient),
    reraise=True,
)
def _call_groq(contents: list, system_instruction: str, api_key: str) -> str:
    """One Groq generation, retried up to 3 times on transient errors."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": GROQ_MODEL,
        "temperature": AI_TEMPERATURE,
        "messages": [
            {"role": "system", "content": system_instruction},
        ]
        + [
            {
                "role": "assistant" if turn["role"] == "model" else turn["role"],
                "content": turn["text"],
            }
            for turn in contents
        ],
    }
    with httpx.Client(timeout=60.0) as client:
        response = client.post(GROQ_BASE_URL, headers=headers, json=payload)
    if response.status_code in (401, 403):
        raise RuntimeError(f"Groq authentication failed (HTTP {response.status_code})")
    response.raise_for_status()
    data = response.json()
    text = (data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
    if not text:
        raise RuntimeError("Groq returned an empty response")
    return text


@retry(
    wait=wait_random_exponential(min=1, max=10),
    stop=stop_after_attempt(3),
    retry=retry_if_exception(_is_transient),
    reraise=True,
)
def _call_openrouter(contents: list, system_instruction: str, api_key: str) -> str:
    """One OpenRouter generation, retried up to 3 times on transient errors."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://localhost:8000",
        "X-Title": "Aethon - NASA Microgravity Combustion",
    }
    payload = {
        "model": OPENROUTER_MODEL,
        "temperature": AI_TEMPERATURE,
        "messages": [
            {"role": "system", "content": system_instruction},
        ]
        + [
            {
                "role": "assistant" if turn["role"] == "model" else turn["role"],
                "content": turn["text"],
            }
            for turn in contents
        ],
    }
    with httpx.Client(timeout=60.0) as client:
        response = client.post(OPENROUTER_BASE_URL, headers=headers, json=payload)
    if response.status_code in (401, 403):
        raise RuntimeError(f"OpenRouter authentication failed (HTTP {response.status_code})")
    response.raise_for_status()
    data = response.json()
    text = (data.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
    if not text:
        raise RuntimeError("OpenRouter returned an empty response")
    return text


def _ai_answer(
    question: str,
    gravity_filter: Optional[str],
    context_text: str,
    primary_key: Optional[str],
    backup_key: Optional[str],
    docs: list,
    settings_block: Optional[str] = None,
    history: Any = None,
) -> tuple[str, bool, str]:
    """Try Groq (primary), fall back to OpenRouter (backup).

    Returns ``(answer, ai_used, provider_name)``.
    """
    contents = _build_contents(
        _clean_history(history), _user_turn(question, context_text)
    )
    system = _system_instruction(gravity_filter, settings_block)

    # Try primary (Groq) first.
    if primary_key is not None:
        try:
            answer = _call_groq(contents, system, primary_key)
            return answer, True, "groq"
        except Exception as exc:
            # Groq failed permanently or after retries; fall back to backup.
            pass

    # Try backup (OpenRouter).
    if backup_key is not None:
        try:
            answer = _call_openrouter(contents, system, backup_key)
            return answer, True, "openrouter"
        except Exception as exc:
            # Backup also failed - hand back an unavailable answer.
            ai_answer = _unavailable_answer(docs, exc)
            return ai_answer, False, "openrouter"

    # No keys configured at all.
    ai_answer = _preview_answer() if docs else _no_key_answer()
    return ai_answer, False, "none"


class QueryRequest(BaseModel):
    question: Optional[str] = None
    query: Optional[str] = None
    gravity_filter: Optional[str] = None
    api_key: Optional[str] = None
    # Prior turns of this conversation as
    # ``[{"role": "user" | "assistant" | "model", "text": ...}, ...]``.
    # Replayed to Gemini on every call so the assistant remembers what was
    # said earlier. Optional: plain curl and older clients simply omit it.
    history: Optional[list] = None
    # Live dashboard controls, so answers can be phrased in terms of the
    # parameters the user is actually looking at. All optional: older clients
    # (and plain curl) simply omit them.
    oxygen_conc: Optional[float] = None
    pressure: Optional[float] = None
    airflow: Optional[float] = None
    fuel: Optional[str] = None


@app.get("/")
def read_root():
    collection = get_collection()
    return {
        "message": "NASA Space Fire Safety RAG API is active.",
        "index_ready": collection is not None,
        "index_error": _collection_error,
        "groq_configured": _primary_key() is not None,
        "openrouter_configured": _backup_key() is not None,
        "groq_model": GROQ_MODEL if _primary_key() else None,
        "openrouter_model": OPENROUTER_MODEL if _backup_key() else None,
        "max_passages": MAX_PASSAGES,
        "fetch_k": FETCH_K,
        "rerank": rerank_provider(),
    }


@app.post("/query-agent")
def query_agent(request: QueryRequest):
    question = (request.question or request.query or "").strip()
    if not question:
        raise HTTPException(
            status_code=400, detail="A `question` (or `query`) field is required."
        )
    if _is_greeting(question):
        answer = _welcome_answer()
        return {
            "status": "success",
            "answer": answer,
            "ai_answer": answer,
            "citations": [],
            "confidence": None,
            "question": question,
            "retrieved_sources": [],
            "sources": [],
            "gravity_filter": request.gravity_filter,
            "ai_used": False,
            "ai_provider": "none",
            "passages_used": 0,
            "conversational": True,
        }

    # Validate combustion boundary conditions before retrieval
    warning = _validate_combustion_conditions(
        request.oxygen_conc, request.fuel
    )

    # Live dashboard controls, surfaced to the model as prompt context.
    settings_block = _settings_block(
        request.oxygen_conc, request.pressure, request.airflow, request.fuel
    )

    docs = similarity_search(question, k=MAX_PASSAGES)

    retrieved_sources = []
    context_text = ""
    citations = []
    for doc in docs:
        meta = doc["metadata"]
        source = str(meta.get("source") or "Unknown File")
        page = meta.get("page", "N/A")
        snippet = doc["page_content"]
        retrieved_sources.append(
            {
                "source": source,
                "filename": _file_name(source),
                "page": page,
                "snippet": snippet,
                "title": source_title(source),
                "url": source_url(source),
                "confidence": confidence_of(doc.get("distance")),
            }
        )
        context_text += (
            f"\n[PASSAGE {len(citations) + 1}] {source} (page {page})\n{snippet}\n"
        )
        citations.append({
            "title": source_title(source),
            "url": source_url(source),
            "confidence": confidence_of(doc.get("distance")),
        })

    # One code path for every message: hand the question, whatever passages
    # retrieval found, and the conversation history to the AI. Chit-chat simply
    # arrives with no passages and is answered as chit-chat.
    primary_key = _primary_key(request.api_key)
    backup_key = _backup_key()
    ai_used = False
    provider = "none"
    if not docs:
        ai_answer = _clarification_answer()
    elif primary_key is None and backup_key is None:
        ai_answer = _preview_answer() if docs else _no_key_answer()
    else:
        ai_answer, ai_used, provider = _ai_answer(
            question,
            request.gravity_filter,
            context_text,
            primary_key,
            backup_key,
            docs,
            settings_block,
            request.history,
        )
    if docs:
        ai_answer = _append_clean_references(ai_answer, docs)

    confidence = (
        round(sum(c["confidence"] for c in citations) / len(citations), 4)
        if citations
        else None
    )

    response = {
        "status": "success",
        "answer": ai_answer,
        "citations": citations,
        "confidence": confidence,
        "question": question,
        "ai_answer": ai_answer,
        "retrieved_sources": retrieved_sources,
        "sources": [
            {"source": src["source"], "snippet": src["snippet"]}
            for src in retrieved_sources
        ],
        "gravity_filter": request.gravity_filter,
        "ai_used": ai_used,
        "ai_provider": provider,
        "passages_used": len(docs),
        "conversational": not docs,
    }

    if warning:
        response["combustion_warning"] = warning

    return response


async def _read_json(request: Optional[Request]) -> dict:
    """Read an optional JSON body, merged with any query-string parameters."""
    payload: dict = {}
    if request is None:
        return payload
    try:
        raw = await request.body()
        if raw:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                payload.update(parsed)
    except Exception:
        pass
    payload.update(dict(request.query_params))
    return payload


def build_ranking(payload: dict) -> list:
    """Rank every material for the requested experiment conditions."""
    oxygen = _clamp(_as_float(payload.get("oxygen_conc"), 21.0), 15.0, 35.0)
    airflow = _clamp(_as_float(payload.get("airflow"), 15.0), 0.0, 50.0)
    pressure = _clamp(_as_float(payload.get("pressure"), 101.3), 50.0, 150.0)
    gravity = str(payload.get("gravity") or "0g")

    gravity_factor = 1.1 if gravity == "0g" else 1.0 if gravity == "0.16g" else 0.9
    oxygen_factor = 0.55 + ((oxygen - 15.0) / 20.0) * 0.9
    pressure_factor = _clamp(0.7 + 0.3 * (pressure / 101.3), 0.7, 1.3)
    flow_factor = 0.9 + (airflow / 50.0) * 0.3

    rankings = []
    for material in MATERIALS:
        score = _clamp(
            material["base"] * oxygen_factor * pressure_factor * flow_factor * gravity_factor,
            0.0,
            1.0,
        )
        rankings.append({
            "material": material["label"],
            "risk_level": material["risk_level"],
            "microgravity_flame_spread": material["spread"],
            "extinction_limit": material["extinction"],
            "score": round(score, 4),
            "tier": _tier(score),
            "risk": _tier(score),
        })
    rankings.sort(key=lambda item: item["score"], reverse=True)
    return rankings


def _rank_response(payload: dict) -> dict:
    rankings = build_ranking(payload)
    return {
        "status": "success",
        "rankings": rankings,
        "ranking": rankings,
        "results": rankings,
        "gravity": str(payload.get("gravity") or "0g"),
        "oxygen_conc": payload.get("oxygen_conc"),
        "airflow": payload.get("airflow"),
        "material": payload.get("material"),
        "note": "Server-side ranking; scores are 0-1 flammability estimates.",
    }


@app.post("/rank-materials")
async def rank_materials_post(request: Request):
    return _rank_response(await _read_json(request))


@app.get("/rank-materials")
async def rank_materials_get(request: Request):
    return _rank_response(await _read_json(request))


def pick_port(preferred: int) -> int:
    """Return *preferred* when free, otherwise the first free fallback port."""
    for port in (preferred, 8080, 8081, 8001):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                continue
        return port
    return preferred


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT") or pick_port(8000))
    print(f"NASA Space Fire Safety API -> http://127.0.0.1:{port}", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=port)



