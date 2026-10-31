"""Evaluation endpoints (blueprint §07). Reports are measurements only in live mode (I10)."""
from __future__ import annotations

import asyncio
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict

from errors import AppError
from evaluation.metrics import to_csv
from evaluation.runner import EvalDepsFactory, get_eval_deps_factory, run_eval
from evaluation.schema import load_scenarios

router = APIRouter(tags=["evaluation"])
_lock = asyncio.Lock()


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["mock", "live"]


@router.post("/eval/run")
async def run(body: RunRequest, request: Request, factory: EvalDepsFactory = Depends(get_eval_deps_factory)) -> dict[str, Any]:
    if _lock.locked():
        raise AppError(409, "invalid_state", "An evaluation run is already in progress")
    async with _lock:
        settings = request.app.state.settings
        deps = factory.build(body.mode, settings)  # live without keys -> 503
        scenarios = load_scenarios(settings.scenarios_path)
        report = await run_eval(settings, scenarios, deps, body.mode)
    request.app.state.eval_report = report
    summary = {k: report[k] for k in ("status", "mode", "generated_at", "n_cases", "n_skipped")}
    if "disclaimer" in report:
        summary["disclaimer"] = report["disclaimer"]
    return summary


@router.get("/eval/report")
async def report(request: Request) -> dict[str, Any]:
    rep = getattr(request.app.state, "eval_report", None)
    return rep if rep is not None else {"status": "no_runs"}


@router.get("/eval/report.csv")
async def report_csv(request: Request) -> Response:
    rep = getattr(request.app.state, "eval_report", None)
    if rep is None:
        raise AppError(404, "not_found", "No evaluation run yet")
    return Response(to_csv(rep["cases"]), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="eval_report.csv"'})
