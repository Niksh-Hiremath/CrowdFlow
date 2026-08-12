from __future__ import annotations

import hashlib
import json
import logging
import re
from pathlib import Path

from PIL import Image

from app.config import Settings, get_settings
from app.schemas.venue import ImageSize, VenueEdge, VenueGraph, VenueNode
from app.services.graph_builder import normalize_graph
from app.services.mock_venue import banquet_hall_graph

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a venue layout extraction engine for crowd-flow simulation.
Given a top-down floorplan or transit-station map, extract key circulation entities as JSON only.

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
      "service_rate_per_min":null
    }
  ],
  "edges":[
    {"id":"e1","source":"node_a","target":"node_b","type":"walkway","length_m":20,"width_m":3,"capacity":80}
  ]
}

Rules:
- ACCURACY IS PARAMOUNT: Coordinates x,y are normalized 0..1 (origin top-left). You MUST place coordinates exactly in the visual center of each labeled room or distinct zone.
- EXHAUSTIVE EXTRACTION: Do not skip any clearly labeled rooms. You MUST map every distinct functional room, corridor, and zone.
- Prefer 15–35 nodes total to ensure comprehensive coverage of the entire floorplan.
- Always include at least one entry_gate and one exit or emergency_exit.
- Include walkway_junction nodes for aisles/passages so the entire graph is fully connected.
- Map retail/food to concession; toilets to restroom; ticket halls to service; stages/platforms to attraction; doors to entry_gate/exit.
- Connect adjacent nodes with walkway edges along plausible circulation paths, ensuring no node is isolated.
- Capacities: entries/exits 100-200, hubs 200-400, passages 80-150, retail 40-80, restrooms 20-40.
"""


def _image_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:24]


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


async def extract_layout(
    image_bytes: bytes,
    settings: Settings | None = None,
    force_mode: str | None = None,
) -> VenueGraph:
    settings = settings or get_settings()
    mode = (force_mode or settings.extract_mode).lower()

    with Image.open(__import__("io").BytesIO(image_bytes)) as im:
        width, height = im.size

    cache_key = _image_hash(image_bytes)
    cache_path = settings.cache_dir / f"extract_{cache_key}.json"
    if cache_path.exists() and mode == "hf":
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
        graph = _graph_from_payload(payload, width, height, source="hf")
        logger.info("VLM extract cache hit %s", cache_key)
        return graph

    if mode != "hf":
        graph = banquet_hall_graph(width, height)
        return graph

    if not settings.hf_token:
        logger.warning("EXTRACT_MODE=hf but HF_TOKEN missing; falling back to mock")
        return banquet_hall_graph(width, height)

    try:
        from huggingface_hub import InferenceClient
        import base64

        b64 = base64.b64encode(image_bytes).decode("ascii")
        mime = "image/png"
        if image_bytes[:2] == b"\xff\xd8":
            mime = "image/jpeg"

        provider = None if settings.hf_provider in {"", "auto"} else settings.hf_provider
        client = InferenceClient(
            token=settings.hf_token,
            provider=provider,
        )
        completion = client.chat.completions.create(
            model=settings.hf_vlm_model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Extract 8–18 major circulation nodes and walkway edges for crowd "
                                "simulation from this top-down map (hall, station, or venue). "
                                "Skip per-track detail. Return compact JSON only — no markdown."
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{b64}"},
                        },
                    ],
                },
            ],
            max_tokens=4096,
            temperature=0.1,
        )
        content = completion.choices[0].message.content or "{}"
        try:
            payload = _parse_json_loose(content)
        except Exception:
            # Persist raw model output for debugging truncated JSON, then re-raise
            debug_path = settings.cache_dir / f"extract_{cache_key}.raw.txt"
            debug_path.write_text(content, encoding="utf-8")
            raise
        cache_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        graph = _graph_from_payload(payload, width, height, source="hf")
        if len(graph.nodes) < 3:
            logger.warning("HF extract too sparse; merging with mock scaffold")
            mock = banquet_hall_graph(width, height)
            return mock
        return graph
    except Exception:
        logger.exception("HF VLM extract failed; using mock graph")
        return banquet_hall_graph(width, height)
