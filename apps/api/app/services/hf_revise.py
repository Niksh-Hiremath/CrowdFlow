"""Text-LLM graph revision from natural-language instructions."""

from __future__ import annotations

import json
import logging
import re

from app.config import Settings, get_settings
from app.schemas.venue import VenueEdge, VenueGraph, VenueNode
from app.services.graph_builder import normalize_graph
from app.services.hf_advisor import _parse_json_loose

logger = logging.getLogger(__name__)

REVISE_SYSTEM = """You are a precise graph editor. Modify an existing crowd-flow graph according to one explicit user instruction.
Return ONLY valid JSON for the full updated graph with this shape:
{
  "image_size": {"width": number, "height": number},
  "nodes":[{"id","type","label","x","y","capacity","service_rate_per_min","confirmed","bidirectional"}],
  "edges":[{"id","source","target","type","length_m","width_m","capacity"}],
  "confirmed": false,
  "source": "manual"
}
Rules:
- Apply only the requested operation. Do not reinterpret the entire layout or make unrelated improvements.
- Preserve every node and edge that the instruction does not mention, including IDs, coordinates, labels, and metadata.
- For delete/remove, delete only the named item and any edges attached to a deleted node.
- For rename, change only the requested label.
- For add edge, connect only the requested existing nodes and use a unique edge ID.
- For move, change only the requested node coordinates and keep them in [0,1].
- If the instruction is ambiguous or cannot be matched to an existing item, return the graph unchanged.
- Do not invent rooms, exits, junctions, edges, or semantic labels.
- Use only node types: entry_gate, exit, emergency_exit, walkway_junction, concession, seating, attraction, restroom, service, other.
- Edge type: walkway | corridor | queue.
- Node ids must be unique; edge source/target must reference existing node ids.
"""


def mock_revise(graph: VenueGraph, instruction: str) -> VenueGraph:
    """Deterministic mock edits for demos without HF credits."""
    text = instruction.lower()
    nodes = list(graph.nodes)
    edges = list(graph.edges)

    # Delete node by id or label mention
    delete_ids: set[str] = set()
    for n in nodes:
        if n.id.lower() in text and ("delete" in text or "remove" in text):
            delete_ids.add(n.id)
        elif n.label.lower() in text and ("delete" in text or "remove" in text):
            delete_ids.add(n.id)

    if delete_ids:
        nodes = [n for n in nodes if n.id not in delete_ids]
        edges = [e for e in edges if e.source not in delete_ids and e.target not in delete_ids]

    # Rename: "rename X to Y" or "call X Y"
    m = re.search(r"rename\s+(\S+)\s+to\s+(.+)$", instruction, re.I)
    if m:
        target, new_label = m.group(1), m.group(2).strip().strip("\"'")
        nodes = [
            n.model_copy(update={"label": new_label}) if n.id == target or n.label.lower() == target.lower() else n
            for n in nodes
        ]

    # Nudge: "move X left/right/up/down"
    m = re.search(r"move\s+(\S+)\s+(left|right|up|down)", instruction, re.I)
    if m:
        target, direction = m.group(1), m.group(2).lower()
        delta = {"left": (-0.05, 0), "right": (0.05, 0), "up": (0, -0.05), "down": (0, 0.05)}[direction]

        def nudge(n: VenueNode) -> VenueNode:
            if n.id != target and n.label.lower() != target.lower():
                return n
            return n.model_copy(
                update={
                    "x": min(1.0, max(0.0, n.x + delta[0])),
                    "y": min(1.0, max(0.0, n.y + delta[1])),
                }
            )

        nodes = [nudge(n) for n in nodes]

    updated = VenueGraph(
        image_size=graph.image_size,
        nodes=nodes,
        edges=edges,
        confirmed=False,
        source="manual",
    )
    return normalize_graph(updated)


async def revise_graph(
    graph: VenueGraph,
    instruction: str,
    settings: Settings | None = None,
    force_mode: str | None = None,
) -> VenueGraph:
    settings = settings or get_settings()
    mode = (force_mode or settings.advisor_mode).lower()
    instruction = instruction.strip()
    if not instruction:
        return graph

    if mode != "hf" or not settings.hf_token:
        if mode == "hf" and not settings.hf_token:
            logger.warning("ADVISOR_MODE=hf but HF_TOKEN missing; using mock revise")
        return mock_revise(graph, instruction)

    payload = {
        "instruction": instruction,
        "graph": graph.model_dump(mode="json"),
    }
    try:
        from huggingface_hub import InferenceClient

        provider = None if settings.hf_provider in {"", "auto"} else settings.hf_provider
        client = InferenceClient(token=settings.hf_token, provider=provider, timeout=120)
        completion = client.chat.completions.create(
            model=settings.hf_llm_model,
            messages=[
                {"role": "system", "content": REVISE_SYSTEM},
                {"role": "user", "content": json.dumps(payload)[:12000]},
            ],
            max_tokens=2500,
            temperature=0.1,
        )
        content = completion.choices[0].message.content or "{}"
        data = _parse_json_loose(content)
        nodes = [VenueNode(**n) for n in data.get("nodes", [])]
        edges = [VenueEdge(**e) for e in data.get("edges", [])]
        image_size = graph.image_size
        if isinstance(data.get("image_size"), dict):
            image_size = graph.image_size.model_validate(data["image_size"])
        updated = VenueGraph(
            image_size=image_size,
            nodes=nodes,
            edges=edges,
            confirmed=False,
            source="manual",
        )
        return normalize_graph(updated)
    except Exception:
        logger.exception("HF graph revise failed; using mock")
        return mock_revise(graph, instruction)
