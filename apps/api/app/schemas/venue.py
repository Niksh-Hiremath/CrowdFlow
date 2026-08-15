from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class NodeType(str, Enum):
    entry_gate = "entry_gate"
    exit = "exit"
    emergency_exit = "emergency_exit"
    walkway_junction = "walkway_junction"
    concession = "concession"
    seating = "seating"
    attraction = "attraction"
    restroom = "restroom"
    service = "service"
    other = "other"


class VenueNode(BaseModel):
    id: str
    type: NodeType
    label: str
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    capacity: int = Field(default=40, ge=1)
    service_rate_per_min: float | None = None
    confirmed: bool = False
    bidirectional: bool = False


class VenueEdge(BaseModel):
    id: str
    source: str
    target: str
    type: Literal["walkway", "corridor", "queue"] = "walkway"
    length_m: float = Field(default=20.0, gt=0)
    width_m: float = Field(default=3.0, gt=0)
    capacity: int = Field(default=80, ge=1)


class ImageSize(BaseModel):
    width: int = 1600
    height: int = 900


class VenueGraph(BaseModel):
    image_size: ImageSize = Field(default_factory=ImageSize)
    nodes: list[VenueNode] = Field(default_factory=list)
    edges: list[VenueEdge] = Field(default_factory=list)
    confirmed: bool = False
    source: Literal["mock", "hf", "manual"] = "manual"


class ScheduleBlock(BaseModel):
    id: str
    label: str
    type: Literal["attraction", "break", "egress", "arrival", "other"] = "other"
    start: str  # HH:MM
    end: str
    attractors: list[str] = Field(default_factory=list)
    arrival_rate_per_min: float = 0.0


class EventSchedule(BaseModel):
    timezone: str = "Asia/Kolkata"
    blocks: list[ScheduleBlock] = Field(default_factory=list)


class Scenario(BaseModel):
    expected_crowd: int = Field(default=400, ge=1)
    schedule: EventSchedule = Field(default_factory=EventSchedule)


class AdvisorAction(BaseModel):
    type: Literal["reroute", "throttle_gate", "open_exit", "prefer_node"]
    priority: int = 1
    from_node: str | None = None
    avoid: list[str] = Field(default_factory=list)
    prefer: list[str] = Field(default_factory=list)
    node_id: str | None = None
    meter_per_min: float | None = None


class AdvisorResponse(BaseModel):
    actions: list[AdvisorAction] = Field(default_factory=list)
    summary: str = ""
    source: Literal["mock", "hf"] = "mock"


class NodeState(BaseModel):
    density: float = 0.0
    count: float = 0.0
    risk: float = 0.0
    queue: float = 0.0


class EdgeState(BaseModel):
    flow: float = 0.0
    speed_factor: float = 1.0
    congested: bool = False


class Bottleneck(BaseModel):
    id: str
    node_id: str
    severity: Literal["watch", "warning", "critical"]
    eta_critical_s: float = 0.0
    reason: str


class RouteSuggestion(BaseModel):
    id: str
    purpose: str
    path_node_ids: list[str]
    cost: float


class SimTick(BaseModel):
    t: float
    sim_time: str
    nodes: dict[str, NodeState]
    edges: dict[str, EdgeState]
    bottlenecks: list[Bottleneck]
    routes: list[RouteSuggestion]
    remaining_to_spawn: float = 0.0
    active_block_ids: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    extract_mode: str
    advisor_mode: str
    hf_token_configured: bool
    hf_vlm_model: str
    hf_llm_model: str
    powered_by_extract: str = "Powered by Hugging Face · Qwen3-VL"
    powered_by_advisor: str = "Powered by Hugging Face · Qwen3"
    simulation_engine: str = "Local macroscopic graph flow (NetworkX + NumPy)"
    credit_burn_stages: list[str] = Field(
        default_factory=lambda: [
            "layout_extract (EXTRACT_MODE=hf)",
            "reroute_advisor (ADVISOR_MODE=hf)",
        ]
    )


class SessionResponse(BaseModel):
    session_id: str
    graph: VenueGraph | None = None
    scenario: Scenario | None = None
    confirmed: bool = False
    sim_running: bool = False
    last_tick: SimTick | None = None


class ExtractionStatusResponse(BaseModel):
    session_id: str
    status: Literal["idle", "queued", "running", "completed", "failed"]
    progress: int = Field(ge=0, le=100)
    stage: str = ""
    error: str | None = None
    graph: VenueGraph | None = None


class RevisionStatusResponse(BaseModel):
    session_id: str
    status: Literal["idle", "queued", "running", "completed", "failed"]
    progress: int = Field(ge=0, le=100)
    stage: str = ""
    error: str | None = None
    graph: VenueGraph | None = None
