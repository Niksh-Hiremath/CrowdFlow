from __future__ import annotations

import json
import logging
import re

from app.config import Settings, get_settings
from app.schemas.venue import AdvisorAction, AdvisorResponse, SimTick, VenueGraph

logger = logging.getLogger(__name__)

ADVISOR_SYSTEM = """You are a crowd-flow safety advisor for venue operators.
Given venue graph summary, schedule context, and current bottlenecks, propose reroute actions.
Return ONLY JSON:
{
  "actions":[
    {"type":"reroute","priority":1,"from_node":"entry_main","avoid":["buffet"],"prefer":["bar"]},
    {"type":"throttle_gate","priority":2,"node_id":"entry_main","meter_per_min":25},
    {"type":"open_exit","priority":3,"node_id":"exit_secondary"},
    {"type":"prefer_node","priority":4,"node_id":"dance_floor"}
  ],
  "summary":"one or two sentences"
}
Use only node ids that exist. Prefer 1-3 actions. Be concrete and safety-first.
"""


def _parse_json_loose(text: str) -> dict:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


def mock_advise(graph: VenueGraph, tick: SimTick) -> AdvisorResponse:
    if not tick.bottlenecks:
        return AdvisorResponse(
            actions=[],
            summary="No critical bottlenecks. Continue monitoring density near concessions and the dance floor.",
            source="mock",
        )

    top = tick.bottlenecks[0]
    entries = [n.id for n in graph.nodes if n.type.value == "entry_gate"]
    exits = [n.id for n in graph.nodes if n.type.value in {"exit", "emergency_exit"}]
    hot_internal = [
        b.node_id
        for b in tick.bottlenecks
        if b.node_id not in entries
    ]
    alts = [
        n.id
        for n in graph.nodes
        if n.type.value in {"concession", "attraction", "seating"}
        and n.id != top.node_id
        and n.id not in hot_internal
    ]

    actions: list[AdvisorAction] = []
    avoid_ids = hot_internal[:2] or ([top.node_id] if top.node_id not in entries else [])
    if avoid_ids or alts:
        actions.append(
            AdvisorAction(
                type="reroute",
                priority=1,
                from_node=entries[0] if entries else None,
                avoid=avoid_ids,
                prefer=alts[:2],
            )
        )
    if entries and (top.node_id in entries or top.severity in {"warning", "critical"}):
        actions.append(
            AdvisorAction(
                type="throttle_gate",
                priority=2,
                node_id=entries[0],
                meter_per_min=25,
            )
        )
    if exits:
        actions.append(
            AdvisorAction(
                type="open_exit",
                priority=3,
                node_id=exits[0],
            )
        )

    summary = (
        f"{top.node_id} is {top.severity} ({top.reason}). "
        f"Meter the main entry and steer guests toward less crowded zones."
    )
    return AdvisorResponse(actions=actions, summary=summary, source="mock")


async def advise(
    graph: VenueGraph,
    tick: SimTick,
    settings: Settings | None = None,
    force_mode: str | None = None,
) -> AdvisorResponse:
    settings = settings or get_settings()
    mode = (force_mode or settings.advisor_mode).lower()
    if mode != "hf":
        return mock_advise(graph, tick)
    if not settings.hf_token:
        logger.warning("ADVISOR_MODE=hf but HF_TOKEN missing; using mock advisor")
        return mock_advise(graph, tick)

    node_brief = [
        {"id": n.id, "type": n.type.value, "label": n.label, "capacity": n.capacity}
        for n in graph.nodes
    ]
    payload = {
        "sim_time": tick.sim_time,
        "active_blocks": tick.active_block_ids,
        "bottlenecks": [b.model_dump() for b in tick.bottlenecks],
        "hot_nodes": {
            nid: st.model_dump()
            for nid, st in tick.nodes.items()
            if st.density >= 0.6
        },
        "nodes": node_brief,
    }

    try:
        from huggingface_hub import InferenceClient

        provider = None if settings.hf_provider in {"", "auto"} else settings.hf_provider
        client = InferenceClient(
            token=settings.hf_token,
            provider=provider,
        )
        completion = client.chat.completions.create(
            model=settings.hf_llm_model,
            messages=[
                {"role": "system", "content": ADVISOR_SYSTEM},
                {
                    "role": "user",
                    "content": "Telemetry:\n" + json.dumps(payload)[:6000],
                },
            ],
            max_tokens=700,
            temperature=0.2,
        )
        content = completion.choices[0].message.content or "{}"
        data = _parse_json_loose(content)
        actions = [AdvisorAction(**a) for a in data.get("actions", [])]
        return AdvisorResponse(
            actions=actions,
            summary=str(data.get("summary", "")),
            source="hf",
        )
    except Exception:
        logger.exception("HF advisor failed; using mock")
        return mock_advise(graph, tick)
