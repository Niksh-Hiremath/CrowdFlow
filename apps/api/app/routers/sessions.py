from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from app.config import get_settings
from app.schemas.venue import (
    AdvisorAction,
    AdvisorResponse,
    Scenario,
    SessionResponse,
    SimTick,
    VenueGraph,
)
from app.services.graph_builder import mark_confirmed, normalize_graph, validate_graph
from app.services.hf_advisor import advise
from app.services.hf_vlm import extract_layout
from app.services.mock_venue import default_wedding_schedule
from app.services.presets import load_preset
from app.services.simulator import SimulationEngine, default_scenario_from_blocks
from app.store import store

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


class ConfirmResponse(BaseModel):
    ok: bool
    errors: list[str] = Field(default_factory=list)
    graph: VenueGraph | None = None


class ApplyActionsRequest(BaseModel):
    actions: list[AdvisorAction]


def _session_response(session_id: str) -> SessionResponse:
    session = store.require(session_id)
    return SessionResponse(
        session_id=session.id,
        graph=session.graph,
        scenario=session.scenario,
        confirmed=session.confirmed,
        sim_running=bool(session.engine and session.engine.running),
        last_tick=session.last_tick,
    )


@router.post("")
async def create_session() -> SessionResponse:
    session = store.create()
    # Sensible default scenario for the banquet fixture
    session.scenario = default_scenario_from_blocks(default_wedding_schedule(), crowd=400)
    return _session_response(session.id)


@router.get("/{session_id}")
async def get_session(session_id: str) -> SessionResponse:
    try:
        return _session_response(session_id)
    except KeyError as exc:
        raise HTTPException(404, "Session not found") from exc


class LoadPresetRequest(BaseModel):
    preset_id: str
    expected_crowd: int | None = None


@router.post("/{session_id}/presets/load")
async def load_session_preset(session_id: str, body: LoadPresetRequest) -> SessionResponse:
    """Load a mock venue preset (no HF credits). Useful for demos without an image."""
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "Session not found") from exc
    try:
        graph, scenario = load_preset(body.preset_id)
    except KeyError as exc:
        raise HTTPException(404, f"Unknown preset: {body.preset_id}") from exc
    if body.expected_crowd is not None:
        scenario.expected_crowd = body.expected_crowd
    session.graph = graph
    session.scenario = scenario
    session.confirmed = False
    session.engine = None
    session.last_tick = None
    return _session_response(session.id)


@router.post("/{session_id}/layout/extract")
async def extract_session_layout(
    session_id: str,
    file: UploadFile = File(...),
    mode: str | None = None,
) -> VenueGraph:
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "Session not found") from exc

    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty image upload")

    session.image_bytes = data
    graph = await extract_layout(data, force_mode=mode)
    session.graph = graph
    session.confirmed = False
    return graph


@router.get("/{session_id}/graph")
async def get_graph(session_id: str) -> VenueGraph:
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "Session not found") from exc
    if session.graph is None:
        raise HTTPException(404, "No graph yet")
    return session.graph


@router.put("/{session_id}/graph")
async def put_graph(session_id: str, graph: VenueGraph) -> VenueGraph:
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "Session not found") from exc
    graph = normalize_graph(graph)
    graph.confirmed = False
    session.graph = graph
    session.confirmed = False
    return graph


@router.post("/{session_id}/graph/confirm")
async def confirm_graph(session_id: str) -> ConfirmResponse:
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "Session not found") from exc
    if session.graph is None:
        raise HTTPException(400, "No graph to confirm")
    graph = normalize_graph(session.graph)
    errors = validate_graph(graph)
    if errors:
        session.graph = graph
        return ConfirmResponse(ok=False, errors=errors, graph=graph)
    graph = mark_confirmed(graph)
    session.graph = graph
    session.confirmed = True
    return ConfirmResponse(ok=True, errors=[], graph=graph)


@router.put("/{session_id}/scenario")
async def put_scenario(session_id: str, scenario: Scenario) -> Scenario:
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "Session not found") from exc
    session.scenario = scenario
    if session.engine:
        session.engine.scenario = scenario
    return scenario


@router.post("/{session_id}/sim/start")
async def start_sim(session_id: str) -> SimTick:
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "Session not found") from exc
    if not session.confirmed or session.graph is None:
        raise HTTPException(400, "Confirm graph before starting simulation")
    if session.scenario is None:
        raise HTTPException(400, "Scenario required")

    engine = SimulationEngine(graph=session.graph, scenario=session.scenario)
    engine.running = True
    tick = engine.step()
    session.engine = engine
    session.last_tick = tick
    return tick


@router.post("/{session_id}/sim/pause")
async def pause_sim(session_id: str) -> dict[str, Any]:
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "Session not found") from exc
    if session.engine:
        session.engine.running = False
    return {"ok": True, "running": False}


@router.get("/{session_id}/sim/tick")
async def sim_tick(session_id: str, steps: int = 1) -> SimTick:
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "Session not found") from exc
    if session.engine is None:
        raise HTTPException(400, "Simulation not started")
    steps = max(1, min(steps, 120))
    tick = session.last_tick
    for _ in range(steps):
        tick = session.engine.step()
    session.engine.running = True
    session.last_tick = tick
    assert tick is not None
    return tick


@router.post("/{session_id}/advise")
async def advise_session(session_id: str, mode: str | None = None) -> AdvisorResponse:
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "Session not found") from exc
    if session.graph is None or session.last_tick is None:
        raise HTTPException(400, "Need graph and at least one sim tick")
    return await advise(session.graph, session.last_tick, force_mode=mode)


@router.post("/{session_id}/actions/apply")
async def apply_actions(session_id: str, body: ApplyActionsRequest) -> SimTick:
    try:
        session = store.require(session_id)
    except KeyError as exc:
        raise HTTPException(404, "Session not found") from exc
    if session.engine is None:
        raise HTTPException(400, "Simulation not started")
    session.engine.apply_actions(body.actions)
    tick = session.engine.step()
    session.last_tick = tick
    return tick


@router.websocket("/{session_id}/sim/stream")
async def sim_stream(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    try:
        session = store.require(session_id)
    except KeyError:
        await websocket.close(code=4404)
        return

    settings = get_settings()
    try:
        while True:
            if session.engine is None:
                await websocket.send_json({"error": "Simulation not started"})
                await asyncio.sleep(1)
                continue
            if session.engine.running:
                tick = session.engine.step()
                session.last_tick = tick
                await websocket.send_json(tick.model_dump())
            await asyncio.sleep(settings.sim_dt_seconds / 5)
    except WebSocketDisconnect:
        return
