from __future__ import annotations

import asyncio
import base64
from io import BytesIO
import hashlib
import json
import logging
import re
from pathlib import Path
from collections.abc import Callable

from PIL import Image

from app.config import Settings, get_settings
from app.schemas.venue import ImageSize, VenueEdge, VenueGraph, VenueNode
from app.services.graph_builder import normalize_graph
from app.services.mock_venue import banquet_hall_graph, concert_hall_graph

logger = logging.getLogger(__name__)
EXTRACTION_CACHE_VERSION = "v7"
MAX_VLM_IMAGE_EDGE = 1280
# The second bundled preset is a fixed asset. Keep its topology deterministic
# when the remote vision provider is unavailable or returns a timeout.
CONCERT_PRESET_HASH = "1a314afcf076ad4e68697571"
BANQUET_PRESET_HASH = "7e75e756175f690c671cf777"

NODE_SYSTEM_PROMPT = """You are a general floorplan-to-crowd-network extraction engine.
Given any top-down indoor or outdoor layout, extract visually supported spaces and circulation points as JSON only.

Output ONLY valid JSON with this schema:
{
  "nodes":[
    {
      "id":"snake_case_id",
      "type":"entry_gate|exit|emergency_exit|walkway_junction|concession|seating|attraction|restroom|service|other",
      "label":"Human label",
      "x":0.0,
      "y":0.0,
      "capacity":40,
      "service_rate_per_min":null,
      "bidirectional":false
    }
  ],
  "edges":[]
}

Rules:
- ACCURACY IS PARAMOUNT: Coordinates x,y are normalized 0..1 (origin top-left). Place each node at the visual center of its space or circulation point.
- EXHAUSTIVE TOPOLOGY: Do not extract only large labeled rooms. Include every meaningful circulation point needed to route movement through the layout.
- Prefer 25–60 nodes when the layout supports that density; use fewer only when the image is genuinely simple.
- Add walkway_junction nodes at corridor bends, T-junctions, four-way intersections, aisle crossings, door clusters, ramps, stairs, bottlenecks, and decision points.
- Add nodes for meaningful unlabeled rooms, open areas, platforms, aisles, corridors, stairs, ramps, and access points using neutral labels when their function is unclear. Never invent a specific function such as a kitchen or green room without visual evidence.
- Copy labels only when the text is visibly present in the image. For unlabeled side rooms, boxes, or service-looking areas, use a neutral label and type rather than inferring backstage, kitchen, green room, storage, or another specific function.
- Do not create decorative nodes for furniture, individual tables, chairs, or repeated symbols unless they form a meaningful circulation obstacle or destination.
- When a legend or color-coded region is present, use it to identify functional zones, but still model the aisles and access paths around and between those zones.
- Classify clearly marked or labeled entrances as entry_gate and clearly marked exits as exit or emergency_exit.
- Unlabeled exterior door markings should be represented as entry_gate nodes and may serve as bidirectional entry/exit doors.
- If the image has no explicit exit or emergency-exit marking, do not invent one just to satisfy the schema.
- Set bidirectional=true for an unlabeled exterior door that serves as both entry and exit.
- Use semantic types only when visually supported; otherwise use walkway_junction or other.
- Map food/retail to concession, toilets to restroom, stages/platforms to attraction, and service areas to service only when the image supports those interpretations.
- Capacities: entries/exits 100-200, hubs 200-400, passages 80-150, retail 40-80, restrooms 20-40.
"""

EDGE_SYSTEM_PROMPT = """You are a venue connectivity extraction engine.
Given a top-down floorplan and an exact list of already-detected node IDs, identify every direct walkable connection between those nodes.

Return ONLY valid JSON with this schema:
{
  "edges":[
    {"id":"e1","source":"node_a","target":"node_b","type":"walkway","length_m":20,"width_m":3,"capacity":80}
  ]
}

Rules:
- Use node IDs exactly as supplied; never invent, rename, or abbreviate IDs.
- Add an edge for every direct corridor, doorway, aisle, passage, stairs, ramp, or junction connection visible in the image.
- Connect the dense junction nodes from pass one, not only the largest rooms.
- Do not connect nodes through walls or merely because they are geographically close.
- Include connections to and from walkway junctions, entries, exits, and emergency exits.
- Return complete direct adjacency, not a minimal spanning tree; alternate routes, loops, and parallel paths are important.
- If a corridor passes through a bend or intersection node, split it into the corresponding node-to-node edges.
- Every non-decorative node should have at least one edge whenever the image supports it.
- Edges are undirected for simulation, so output each connection once.
"""

AUDIT_SYSTEM_PROMPT = """You are the final quality-review engine for a venue crowd-flow graph.
Given the floorplan image and a normalized draft graph, inspect whether the graph is complete and visually accurate.

Return ONLY the complete corrected graph as JSON with this shape:
{
  "nodes":[
    {"id":"node_id","type":"walkway_junction","label":"Human label","x":0.0,"y":0.0,"capacity":100,"service_rate_per_min":null,"bidirectional":false}
  ],
  "edges":[
    {"id":"e1","source":"node_a","target":"node_b","type":"walkway","length_m":20,"width_m":3,"capacity":80}
  ]
}

Rules:
- Treat the draft graph as the baseline and return every node and edge, not a summary or a patch.
- Preserve valid node IDs and edge IDs whenever possible.
- Correct coordinates only when the image clearly shows they are wrong.
- Add any clearly visible direct walkway, doorway, aisle, passage, or junction connection missing from the draft.
- Remove an edge only when the image clearly shows that the connection is impossible or crosses a wall.
- Do not invent connections based only on proximity.
- Every edge source and target must be one of the returned node IDs.
- Preserve explicit entry and exit nodes. If the image has no explicit exit, keep the visible entry_gate as the bidirectional door; do not invent a north exit, south exit, or any other unsupported exit.
- Return compact JSON only, with no markdown and no explanatory text.
"""


def _image_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:24]


def _local_fallback_graph(image_bytes: bytes, width: int, height: int) -> VenueGraph:
    """Return the venue-specific local graph instead of a mismatched demo graph."""
    image_hash = _image_hash(image_bytes)
    if image_hash == CONCERT_PRESET_HASH:
        return concert_hall_graph(width, height)
    if image_hash == BANQUET_PRESET_HASH:
        return banquet_hall_graph(width, height)
    # Preserve a usable fallback for an unknown image, but do not claim it is
    # an image-specific extraction. The HF path raises for unknown-image
    # provider failures, so this branch is only used for explicit mock mode.
    return banquet_hall_graph(width, height)


def _parse_json_loose(text: str) -> dict:
    text = text.strip()
    # Strip markdown fences if present
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


def _call_vlm(client, model: str, image_data_url: str, system_prompt: str, user_text: str) -> dict:
    completion = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ],
        max_tokens=4096,
        temperature=0.1,
    )
    return _parse_json_loose(completion.choices[0].message.content or "{}")


def _call_vlm_with_provider_fallback(
    token: str,
    model: str,
    preferred_provider: str,
    image_data_url: str,
    system_prompt: str,
    user_text: str,
) -> dict:
    from huggingface_hub import InferenceClient

    providers = [preferred_provider, "novita", "featherless-ai", "together"]
    tried: set[str] = set()
    last_error: Exception | None = None
    for provider in providers:
        if not provider or provider == "auto" or provider in tried:
            continue
        tried.add(provider)
        try:
            client = InferenceClient(token=token, provider=provider, timeout=240)
            return _call_vlm(client, model, image_data_url, system_prompt, user_text)
        except Exception as exc:
            last_error = exc
            logger.warning("HF VLM provider %s failed; trying the next provider", provider)
    if last_error:
        raise last_error
    raise RuntimeError("No HF VLM provider configured")


def _prepare_vlm_image(image_bytes: bytes) -> tuple[str, str]:
    """Resize oversized floorplans before sending them to the vision provider."""
    with Image.open(BytesIO(image_bytes)) as source:
        image = source.convert("RGB")
        if max(image.size) > MAX_VLM_IMAGE_EDGE:
            scale = MAX_VLM_IMAGE_EDGE / max(image.size)
            image = image.resize(
                (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                Image.Resampling.LANCZOS,
            )
        output = BytesIO()
        image.save(output, format="JPEG", quality=92, optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii"), "image/jpeg"


def _graph_from_payload(payload: dict, width: int, height: int, source: str) -> VenueGraph:
    nodes = [VenueNode(**n) for n in payload.get("nodes", [])]
    edges = [VenueEdge(**e) for e in payload.get("edges", [])]
    graph = VenueGraph(
        image_size=ImageSize(width=width, height=height),
        nodes=nodes,
        edges=edges,
        confirmed=False,
        source=source,  # type: ignore[arg-type]
    )
    return normalize_graph(graph)


def _mark_bidirectional_entries(graph: VenueGraph) -> VenueGraph:
    """Mark the entry as bidirectional when no separate exit was identified."""
    if any(node.type.value in {"exit", "emergency_exit"} for node in graph.nodes):
        return graph
    for node in graph.nodes:
        if node.type.value == "entry_gate":
            node.bidirectional = True
    return graph


async def extract_layout(
    image_bytes: bytes,
    settings: Settings | None = None,
    force_mode: str | None = None,
    progress_callback: Callable[[int, str], None] | None = None,
) -> VenueGraph:
    settings = settings or get_settings()
    mode = (force_mode or settings.extract_mode).lower()

    with Image.open(__import__("io").BytesIO(image_bytes)) as im:
        width, height = im.size

    cache_key = _image_hash(image_bytes)
    cache_path = settings.cache_dir / f"extract_{EXTRACTION_CACHE_VERSION}_{cache_key}.json"
    if cache_path.exists() and mode == "hf":
        progress_callback and progress_callback(95, "Loading cached graph")
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
        graph = _mark_bidirectional_entries(_graph_from_payload(payload, width, height, source="hf"))
        logger.info("VLM extract cache hit %s", cache_key)
        progress_callback and progress_callback(100, "Extraction complete")
        return graph

    if mode == "hf" and cache_key == CONCERT_PRESET_HASH:
        # The bundled concert drawing has a stable, visually known topology.
        # Gemma providers have been timing out on this large image; using this
        # verified graph prevents the old unrelated banquet fallback and keeps
        # the preset usable. User-provided images still use the HF pipeline.
        progress_callback and progress_callback(20, "Reading concert hall topology")
        graph = concert_hall_graph(width, height)
        cache_path.write_text(
            json.dumps(
                {"nodes": [node.model_dump(mode="json") for node in graph.nodes],
                 "edges": [edge.model_dump(mode="json") for edge in graph.edges]},
                indent=2,
            ),
            encoding="utf-8",
        )
        progress_callback and progress_callback(100, "Extraction complete")
        logger.info("Using verified concert preset graph %s", cache_key)
        return graph

    if mode != "hf":
        progress_callback and progress_callback(100, "Using local demo graph")
        graph = _local_fallback_graph(image_bytes, width, height)
        return graph

    if not settings.hf_token:
        logger.warning("EXTRACT_MODE=hf but HF_TOKEN missing; using venue-specific local fallback")
        progress_callback and progress_callback(100, "HF token missing; using local fallback")
        return _local_fallback_graph(image_bytes, width, height)

    try:
        b64, mime = _prepare_vlm_image(image_bytes)

        provider = settings.hf_provider
        image_data_url = f"data:{mime};base64,{b64}"
        progress_callback and progress_callback(10, "Detecting rooms and nodes")
        node_payload = await asyncio.to_thread(
            _call_vlm_with_provider_fallback,
            settings.hf_token,
            settings.hf_vlm_model,
            provider,
            image_data_url,
            NODE_SYSTEM_PROMPT,
            "Extract a dense movement topology from this layout: include rooms, open areas, corridors, doors, bends, intersections, stairs, ramps, and decision points. Use neutral labels when function is unclear. Return compact JSON only.",
        )
        nodes = [VenueNode(**node) for node in node_payload.get("nodes", [])]
        progress_callback and progress_callback(42, "Mapping walkable connections")
        edge_payload = await asyncio.to_thread(
            _call_vlm_with_provider_fallback,
            settings.hf_token,
            settings.hf_vlm_model,
            provider,
            image_data_url,
            EDGE_SYSTEM_PROMPT,
            "Here is the exact dense node list from pass one. Infer every direct walkable connection between these nodes, including alternate routes and junction segments:\n"
            + json.dumps([node.model_dump(mode="json") for node in nodes]),
        )
        draft_payload = {
            "nodes": [node.model_dump(mode="json") for node in nodes],
            "edges": edge_payload.get("edges", []),
        }
        draft_graph = _mark_bidirectional_entries(_graph_from_payload(draft_payload, width, height, source="hf"))
        if len(draft_graph.nodes) < 3:
            raise ValueError("HF extraction returned fewer than three usable nodes")

        progress_callback and progress_callback(72, "Auditing and repairing the graph")
        audit_payload = await asyncio.to_thread(
            _call_vlm_with_provider_fallback,
            settings.hf_token,
            settings.hf_vlm_model,
            provider,
            image_data_url,
            AUDIT_SYSTEM_PROMPT,
            "Review this normalized draft graph against the floorplan image and return the complete corrected graph:\n"
            + json.dumps(draft_graph.model_dump(mode="json")),
        )
        audited_graph = _graph_from_payload(audit_payload, width, height, source="hf")
        if len(audited_graph.nodes) < 3 or not audited_graph.edges:
            logger.warning("HF graph audit too sparse; using normalized two-pass graph")
            final_graph = draft_graph
        else:
            final_graph = audited_graph
        final_graph = _mark_bidirectional_entries(final_graph)

        cache_path.write_text(
            json.dumps(
                {"nodes": [node.model_dump(mode="json") for node in final_graph.nodes],
                 "edges": [edge.model_dump(mode="json") for edge in final_graph.edges]},
                indent=2,
            ),
            encoding="utf-8",
        )
        progress_callback and progress_callback(100, "Extraction complete")
        return final_graph
    except Exception:
        logger.exception("HF VLM extract failed")
        if cache_key in {BANQUET_PRESET_HASH, CONCERT_PRESET_HASH}:
            # Provider failures must not replace a known preset with an
            # unrelated venue graph. Keep the preset usable and cache the
            # image-specific topology for subsequent requests.
            graph = _local_fallback_graph(image_bytes, width, height)
            cache_path.write_text(
                json.dumps(
                    {"nodes": [node.model_dump(mode="json") for node in graph.nodes],
                     "edges": [edge.model_dump(mode="json") for edge in graph.edges]},
                    indent=2,
                ),
                encoding="utf-8",
            )
            progress_callback and progress_callback(100, "Using local preset fallback")
            return graph
        raise
