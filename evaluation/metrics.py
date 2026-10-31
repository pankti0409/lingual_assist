"""Evaluation metrics (blueprint §07). Pure functions; no I/O, no invented numbers (I10).

Normalisation for WER (applied identically to reference and hypothesis):
  Unicode NFC -> lowercase -> every Unicode punctuation character becomes a space -> split on whitespace.
Percentiles use the nearest-rank method: rank = ceil(p/100 * n), value = sorted[rank - 1].
"""
from __future__ import annotations

import csv
import io
import math
import unicodedata
from dataclasses import dataclass
from typing import Any, Iterable, Optional

NORMALIZATION = "Unicode NFC, lowercase, punctuation -> space, whitespace tokenisation"
LOW_SAMPLE_N = 20


# ------------------------------------------------------------------ WER
def normalize_text(s: str) -> str:
    s = unicodedata.normalize("NFC", s).lower()
    s = "".join(" " if unicodedata.category(ch).startswith("P") else ch for ch in s)
    return " ".join(s.split())


def tokenize(s: str) -> list[str]:
    n = normalize_text(s)
    return n.split(" ") if n else []


@dataclass(frozen=True)
class WerResult:
    wer: Optional[float]  # percent; None when undefined
    substitutions: int
    deletions: int
    insertions: int
    ref_words: int
    note: Optional[str] = None


def wer(reference: str, hypothesis: str) -> WerResult:
    """WER = (S + D + I) / reference words x 100 via word-level Levenshtein alignment."""
    ref, hyp = tokenize(reference), tokenize(hypothesis)
    if not ref:
        if not hyp:
            return WerResult(0.0, 0, 0, 0, 0, "empty reference and empty hypothesis")
        return WerResult(None, 0, 0, len(hyp), 0, "empty reference: WER undefined")
    n, m = len(ref), len(hyp)
    # dp[i][j] = edit distance between ref[:i] and hyp[:j]
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            dp[i][j] = min(dp[i - 1][j - 1] + cost, dp[i - 1][j] + 1, dp[i][j - 1] + 1)
    s = d = ins = 0
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + (0 if ref[i - 1] == hyp[j - 1] else 1):
            if ref[i - 1] != hyp[j - 1]:
                s += 1
            i, j = i - 1, j - 1
        elif i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            d += 1
            i -= 1
        else:
            ins += 1
            j -= 1
    return WerResult((s + d + ins) / n * 100, s, d, ins, n)


def aggregate_wer(results: Iterable[WerResult]) -> dict[str, Any]:
    """Corpus-level (micro) WER: total errors / total reference words. Undefined cases are excluded and counted."""
    rs = list(results)
    defined = [r for r in rs if r.wer is not None]
    words = sum(r.ref_words for r in defined)
    errors = sum(r.substitutions + r.deletions + r.insertions for r in defined)
    return {
        "wer": (errors / words * 100) if words else None,
        "substitutions": sum(r.substitutions for r in defined),
        "deletions": sum(r.deletions for r in defined),
        "insertions": sum(r.insertions for r in defined),
        "ref_words": words,
        "n": len(defined),
        "n_undefined": len(rs) - len(defined),
    }


# ------------------------------------------------------------------ intent accuracy
def normalize_intent(s: Optional[str]) -> str:
    return "_".join((s or "").strip().lower().replace("-", " ").split())


def is_correct(group: str, intent: Optional[str], clarification_required: Optional[bool],
               expected_intent: str, aliases: list[str], expected_clarification: bool) -> bool:
    """Negative cases: clarification_required must match expected_clarification.
    Other cases: normalised intent equals the expected intent or one of its aliases."""
    if group == "negative":
        return bool(clarification_required) == expected_clarification
    accepted = {normalize_intent(expected_intent), *(normalize_intent(a) for a in aliases)}
    return normalize_intent(intent) in accepted


def accuracy(flags: list[bool]) -> dict[str, Any]:
    n = len(flags)
    return {"accuracy": (sum(flags) / n * 100) if n else None, "correct": sum(flags), "n": n}


def accuracy_by(records: list[dict[str, Any]], key: str) -> dict[str, dict[str, Any]]:
    out: dict[str, list[bool]] = {}
    for r in records:
        out.setdefault(r[key], []).append(r["correct"])
    return {k: accuracy(v) for k, v in sorted(out.items())}


# ------------------------------------------------------------------ latency
def percentile(values: list[float], p: float) -> Optional[float]:
    """Nearest-rank percentile; None for an empty list."""
    if not values:
        return None
    s = sorted(values)
    rank = max(1, math.ceil(p / 100 * len(s)))
    return s[rank - 1]


def latency_summary(values: list[float]) -> dict[str, Any]:
    n = len(values)
    return {
        "n": n,
        "p50": percentile(values, 50),
        "p95": percentile(values, 95),
        "p95_low_sample": n < LOW_SAMPLE_N,
        "method": "nearest-rank",
    }


def _nonnull(records: list[dict[str, Any]], key: str) -> list[float]:
    return [r[key] for r in records if r.get(key) is not None]


def stage_breakdown(records: list[dict[str, Any]]) -> dict[str, Any]:
    """p50 per stage. `other` = system_latency - fusion - tts (evidence assembly, bookkeeping)."""
    other = [
        r["system_latency_ms"] - r["fusion_ms"] - r["tts_first_audio_ms"]
        for r in records
        if None not in (r.get("system_latency_ms"), r.get("fusion_ms"), r.get("tts_first_audio_ms"))
    ]
    return {
        "scribe_ms": latency_summary(_nonnull(records, "scribe_ms")),
        "fusion_ms": latency_summary(_nonnull(records, "fusion_ms")),
        "tts_first_audio_ms": latency_summary(_nonnull(records, "tts_first_audio_ms")),
        "other_ms": latency_summary(other),
        "note": "scribe precedes 'finish' and is outside system_latency_ms; other = system - fusion - tts",
    }


# ------------------------------------------------------------------ effort
def mean_effort(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Mean patient actions per SUCCESSFULLY communicated message (never-confirmed messages are excluded)."""
    vals = [r["effort_actions"] for r in records if r.get("communicated") and r.get("effort_actions") is not None]
    return {"mean_actions": (sum(vals) / len(vals)) if vals else None, "n": len(vals)}


# ------------------------------------------------------------------ arm / report assembly
ARM_LABELS = {
    "A": "transcript + dialogue context only (no cues)",
    "B": "transcript + dialogue context + MediaPipe cues",
}


def summarize_arm(records: list[dict[str, Any]]) -> dict[str, Any]:
    by_group_effort: dict[str, Any] = {}
    for g in sorted({r["group"] for r in records}):
        by_group_effort[g] = mean_effort([r for r in records if r["group"] == g])
    return {
        "n": len(records),
        "intent_accuracy": {
            "overall": accuracy([r["correct"] for r in records]),
            "by_language": accuracy_by(records, "language"),
            "by_group": accuracy_by(records, "group"),
        },
        "effort": {"overall": mean_effort(records), "by_group": by_group_effort},
        "latency": {
            "system_latency_ms": latency_summary(_nonnull(records, "system_latency_ms")),
            "wall_clock_ms": latency_summary(_nonnull(records, "wall_clock_ms")),
            "stages": stage_breakdown(records),
        },
    }


def _delta(b: Optional[float], a: Optional[float]) -> Optional[float]:
    return None if a is None or b is None else b - a


def build_ablation(arm_a: dict[str, Any], arm_b: dict[str, Any]) -> dict[str, Any]:
    ia, ib = arm_a["intent_accuracy"], arm_b["intent_accuracy"]
    groups = sorted(set(ia["by_group"]) | set(ib["by_group"]))
    return {
        "note": "Same cases, same transcripts; only the visual cues differ. No WER-improvement claim is made.",
        "intent_accuracy_overall": {
            "A": ia["overall"]["accuracy"],
            "B": ib["overall"]["accuracy"],
            "delta_B_minus_A": _delta(ib["overall"]["accuracy"], ia["overall"]["accuracy"]),
        },
        "effort_overall": {
            "A": arm_a["effort"]["overall"]["mean_actions"],
            "B": arm_b["effort"]["overall"]["mean_actions"],
            "delta_B_minus_A": _delta(arm_b["effort"]["overall"]["mean_actions"], arm_a["effort"]["overall"]["mean_actions"]),
        },
        "by_group": {
            g: {
                "intent_accuracy": {
                    "A": ia["by_group"].get(g, {}).get("accuracy"),
                    "B": ib["by_group"].get(g, {}).get("accuracy"),
                },
                "effort": {
                    "A": arm_a["effort"]["by_group"].get(g, {}).get("mean_actions"),
                    "B": arm_b["effort"]["by_group"].get(g, {}).get("mean_actions"),
                },
            }
            for g in groups
        },
    }


CSV_COLUMNS = [
    "case_id", "arm", "group", "language", "simulated", "skipped", "skip_reason", "mode",
    "reference_transcript", "hypothesis", "wer", "wer_substitutions", "wer_deletions", "wer_insertions",
    "expected_intent", "intent", "expected_clarification", "clarification_required", "correct",
    "communicated", "effort_actions", "scribe_ms", "vision_ms", "fusion_ms", "tts_first_audio_ms",
    "system_latency_ms", "wall_clock_ms",
]


def to_csv(records: list[dict[str, Any]]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=CSV_COLUMNS, extrasaction="ignore", lineterminator="\n")
    w.writeheader()
    for r in records:
        w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in CSV_COLUMNS})
    return buf.getvalue()
