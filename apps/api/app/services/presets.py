"""Sample venue graphs + schedules for offline demos (no HF credits)."""

from __future__ import annotations

from app.schemas.venue import (
    ImageSize,
    NodeType,
    Scenario,
    VenueEdge,
    VenueGraph,
    VenueNode,
)
from app.services.mock_venue import banquet_hall_graph, default_wedding_schedule
from app.services.simulator import default_scenario_from_blocks


def _graph(
    nodes: list[VenueNode],
    edges: list[VenueEdge],
    w: int = 1600,
    h: int = 900,
) -> VenueGraph:
    return VenueGraph(
        image_size=ImageSize(width=w, height=h),
        nodes=nodes,
        edges=edges,
        confirmed=False,
        source="mock",
    )


def stadium_graph() -> VenueGraph:
    nodes = [
        VenueNode(id="gate_a", type=NodeType.entry_gate, label="Gate A", x=0.08, y=0.50, capacity=120),
        VenueNode(id="gate_b", type=NodeType.entry_gate, label="Gate B", x=0.92, y=0.50, capacity=120),
        VenueNode(id="concourse_w", type=NodeType.walkway_junction, label="West Concourse", x=0.25, y=0.50, capacity=200),
        VenueNode(id="concourse_e", type=NodeType.walkway_junction, label="East Concourse", x=0.75, y=0.50, capacity=200),
        VenueNode(id="concourse_n", type=NodeType.walkway_junction, label="North Concourse", x=0.50, y=0.22, capacity=180),
        VenueNode(id="seating_bowl", type=NodeType.seating, label="Seating Bowl", x=0.50, y=0.50, capacity=500),
        VenueNode(id="pitch", type=NodeType.attraction, label="Pitch / Field", x=0.50, y=0.55, capacity=80),
        VenueNode(id="food_w", type=NodeType.concession, label="Food Court West", x=0.28, y=0.28, capacity=60, service_rate_per_min=25),
        VenueNode(id="food_e", type=NodeType.concession, label="Food Court East", x=0.72, y=0.28, capacity=60, service_rate_per_min=25),
        VenueNode(id="restrooms_n", type=NodeType.restroom, label="North Restrooms", x=0.50, y=0.12, capacity=40, service_rate_per_min=15),
        VenueNode(id="exit_s", type=NodeType.exit, label="South Exit", x=0.50, y=0.92, capacity=150),
        VenueNode(id="exit_emergency", type=NodeType.emergency_exit, label="Emergency Exit", x=0.15, y=0.85, capacity=80),
    ]
    edges = [
        VenueEdge(id="s1", source="gate_a", target="concourse_w", length_m=20, width_m=5, capacity=160),
        VenueEdge(id="s2", source="gate_b", target="concourse_e", length_m=20, width_m=5, capacity=160),
        VenueEdge(id="s3", source="concourse_w", target="concourse_n", length_m=30, width_m=4, capacity=140),
        VenueEdge(id="s4", source="concourse_e", target="concourse_n", length_m=30, width_m=4, capacity=140),
        VenueEdge(id="s5", source="concourse_w", target="seating_bowl", length_m=18, width_m=4, capacity=150),
        VenueEdge(id="s6", source="concourse_e", target="seating_bowl", length_m=18, width_m=4, capacity=150),
        VenueEdge(id="s7", source="concourse_n", target="seating_bowl", length_m=16, width_m=4, capacity=140),
        VenueEdge(id="s8", source="seating_bowl", target="pitch", length_m=12, width_m=3, capacity=60),
        VenueEdge(id="s9", source="concourse_w", target="food_w", length_m=14, width_m=3, capacity=90),
        VenueEdge(id="s10", source="concourse_e", target="food_e", length_m=14, width_m=3, capacity=90),
        VenueEdge(id="s11", source="concourse_n", target="restrooms_n", length_m=10, width_m=2.5, capacity=70),
        VenueEdge(id="s12", source="seating_bowl", target="exit_s", length_m=28, width_m=5, capacity=180),
        VenueEdge(id="s13", source="concourse_w", target="exit_emergency", length_m=32, width_m=3, capacity=100),
        VenueEdge(id="s14", source="food_w", target="concourse_n", length_m=22, width_m=3, capacity=80),
        VenueEdge(id="s15", source="food_e", target="concourse_n", length_m=22, width_m=3, capacity=80),
    ]
    return _graph(nodes, edges)


def station_graph() -> VenueGraph:
    nodes = [
        VenueNode(id="entry_street", type=NodeType.entry_gate, label="Street Entry", x=0.50, y=0.08, capacity=140),
        VenueNode(id="ticket_hall", type=NodeType.walkway_junction, label="Ticket Hall", x=0.50, y=0.28, capacity=180),
        VenueNode(id="concourse", type=NodeType.walkway_junction, label="Concourse", x=0.50, y=0.48, capacity=200),
        VenueNode(id="platform_1", type=NodeType.attraction, label="Platform 1", x=0.28, y=0.72, capacity=160),
        VenueNode(id="platform_2", type=NodeType.attraction, label="Platform 2", x=0.72, y=0.72, capacity=160),
        VenueNode(id="kiosk", type=NodeType.concession, label="Kiosk", x=0.68, y=0.38, capacity=35, service_rate_per_min=20),
        VenueNode(id="restrooms", type=NodeType.restroom, label="Restrooms", x=0.30, y=0.38, capacity=30, service_rate_per_min=12),
        VenueNode(id="exit_north", type=NodeType.exit, label="North Exit", x=0.50, y=0.05, capacity=120),
        VenueNode(id="exit_emergency", type=NodeType.emergency_exit, label="Platform Emergency Exit", x=0.92, y=0.72, capacity=70),
    ]
    edges = [
        VenueEdge(id="t1", source="entry_street", target="ticket_hall", length_m=15, width_m=6, capacity=180),
        VenueEdge(id="t2", source="ticket_hall", target="concourse", length_m=18, width_m=5, capacity=170),
        VenueEdge(id="t3", source="concourse", target="platform_1", length_m=22, width_m=4, capacity=140),
        VenueEdge(id="t4", source="concourse", target="platform_2", length_m=22, width_m=4, capacity=140),
        VenueEdge(id="t5", source="ticket_hall", target="kiosk", length_m=12, width_m=2.5, capacity=60),
        VenueEdge(id="t6", source="ticket_hall", target="restrooms", length_m=12, width_m=2.5, capacity=55),
        VenueEdge(id="t7", source="entry_street", target="exit_north", length_m=5, width_m=4, capacity=120),
        VenueEdge(id="t8", source="platform_2", target="exit_emergency", length_m=16, width_m=2.5, capacity=80),
        VenueEdge(id="t9", source="kiosk", target="concourse", length_m=10, width_m=2.5, capacity=70),
        VenueEdge(id="t10", source="restrooms", target="concourse", length_m=10, width_m=2.5, capacity=70),
    ]
    return _graph(nodes, edges)


def festival_graph() -> VenueGraph:
    nodes = [
        VenueNode(id="gate_main", type=NodeType.entry_gate, label="Main Gate", x=0.50, y=0.92, capacity=150),
        VenueNode(id="plaza", type=NodeType.walkway_junction, label="Central Plaza", x=0.50, y=0.55, capacity=220),
        VenueNode(id="stage", type=NodeType.attraction, label="Main Stage", x=0.50, y=0.18, capacity=300),
        VenueNode(id="food_row", type=NodeType.concession, label="Food Row", x=0.22, y=0.55, capacity=70, service_rate_per_min=30),
        VenueNode(id="merch", type=NodeType.concession, label="Merch Booth", x=0.78, y=0.55, capacity=40, service_rate_per_min=15),
        VenueNode(id="restrooms", type=NodeType.restroom, label="Restrooms", x=0.18, y=0.75, capacity=45, service_rate_per_min=18),
        VenueNode(id="exit_side", type=NodeType.exit, label="Side Exit", x=0.90, y=0.80, capacity=100),
        VenueNode(id="exit_emergency", type=NodeType.emergency_exit, label="Stage-Left Emergency", x=0.12, y=0.20, capacity=90),
    ]
    edges = [
        VenueEdge(id="f1", source="gate_main", target="plaza", length_m=25, width_m=6, capacity=180),
        VenueEdge(id="f2", source="plaza", target="stage", length_m=28, width_m=5, capacity=200),
        VenueEdge(id="f3", source="plaza", target="food_row", length_m=16, width_m=3.5, capacity=110),
        VenueEdge(id="f4", source="plaza", target="merch", length_m=16, width_m=3.0, capacity=90),
        VenueEdge(id="f5", source="gate_main", target="restrooms", length_m=18, width_m=2.5, capacity=80),
        VenueEdge(id="f6", source="plaza", target="exit_side", length_m=22, width_m=3.5, capacity=120),
        VenueEdge(id="f7", source="stage", target="exit_emergency", length_m=20, width_m=3.0, capacity=100),
        VenueEdge(id="f8", source="food_row", target="restrooms", length_m=14, width_m=2.5, capacity=70),
        VenueEdge(id="f9", source="merch", target="exit_side", length_m=12, width_m=2.5, capacity=70),
    ]
    return _graph(nodes, edges)


def stadium_schedule() -> list[dict]:
    return [
        {
            "id": "ingress",
            "label": "Gate open / ingress",
            "type": "arrival",
            "start": "16:00",
            "end": "18:00",
            "attractors": ["seating_bowl", "food_w", "food_e"],
            "arrival_rate_per_min": 70,
        },
        {
            "id": "kickoff",
            "label": "Main event",
            "type": "attraction",
            "start": "18:00",
            "end": "20:00",
            "attractors": ["seating_bowl", "pitch"],
            "arrival_rate_per_min": 5,
        },
        {
            "id": "halftime",
            "label": "Halftime",
            "type": "break",
            "start": "20:00",
            "end": "20:20",
            "attractors": ["food_w", "food_e", "restrooms_n"],
            "arrival_rate_per_min": 0,
        },
        {
            "id": "egress",
            "label": "Full-time egress",
            "type": "egress",
            "start": "20:20",
            "end": "21:15",
            "attractors": ["exit_s", "exit_emergency", "gate_a", "gate_b"],
            "arrival_rate_per_min": 0,
        },
    ]


def station_schedule() -> list[dict]:
    return [
        {
            "id": "peak_am",
            "label": "Morning peak",
            "type": "arrival",
            "start": "08:00",
            "end": "09:30",
            "attractors": ["platform_1", "platform_2", "ticket_hall"],
            "arrival_rate_per_min": 80,
        },
        {
            "id": "offpeak",
            "label": "Off-peak",
            "type": "other",
            "start": "09:30",
            "end": "17:00",
            "attractors": ["concourse", "kiosk"],
            "arrival_rate_per_min": 20,
        },
        {
            "id": "peak_pm",
            "label": "Evening peak / egress",
            "type": "egress",
            "start": "17:00",
            "end": "19:00",
            "attractors": ["exit_north", "exit_emergency", "entry_street"],
            "arrival_rate_per_min": 10,
        },
    ]


def festival_schedule() -> list[dict]:
    return [
        {
            "id": "doors",
            "label": "Doors open",
            "type": "arrival",
            "start": "15:00",
            "end": "17:00",
            "attractors": ["plaza", "food_row", "merch"],
            "arrival_rate_per_min": 60,
        },
        {
            "id": "headliner",
            "label": "Headliner",
            "type": "attraction",
            "start": "17:00",
            "end": "19:30",
            "attractors": ["stage"],
            "arrival_rate_per_min": 8,
        },
        {
            "id": "set_break",
            "label": "Set break",
            "type": "break",
            "start": "19:30",
            "end": "20:00",
            "attractors": ["food_row", "restrooms", "merch"],
            "arrival_rate_per_min": 0,
        },
        {
            "id": "egress",
            "label": "Festival egress",
            "type": "egress",
            "start": "20:00",
            "end": "21:00",
            "attractors": ["gate_main", "exit_side", "exit_emergency"],
            "arrival_rate_per_min": 0,
        },
    ]


PRESETS: dict[str, dict] = {
    "banquet": {
        "id": "banquet",
        "label": "Banquet / wedding hall",
        "description": "Matches fixtures/test-floorplan.png mock extraction.",
        "default_crowd": 400,
        "graph_factory": banquet_hall_graph,
        "schedule_factory": default_wedding_schedule,
    },
    "stadium": {
        "id": "stadium",
        "label": "Stadium",
        "description": "Dual-gate stadium with concourses, food courts, seating bowl.",
        "default_crowd": 1200,
        "graph_factory": stadium_graph,
        "schedule_factory": stadium_schedule,
    },
    "station": {
        "id": "station",
        "label": "Railway station",
        "description": "Ticket hall, concourse, dual platforms, peak commute schedule.",
        "default_crowd": 900,
        "graph_factory": station_graph,
        "schedule_factory": station_schedule,
    },
    "festival": {
        "id": "festival",
        "label": "Outdoor festival",
        "description": "Main gate, plaza, stage, food row, merch, egress paths.",
        "default_crowd": 1500,
        "graph_factory": festival_graph,
        "schedule_factory": festival_schedule,
    },
}


def list_presets() -> list[dict]:
    return [
        {
            "id": p["id"],
            "label": p["label"],
            "description": p["description"],
            "default_crowd": p["default_crowd"],
        }
        for p in PRESETS.values()
    ]


def load_preset(preset_id: str) -> tuple[VenueGraph, Scenario]:
    if preset_id not in PRESETS:
        raise KeyError(preset_id)
    p = PRESETS[preset_id]
    graph = p["graph_factory"]()
    scenario = default_scenario_from_blocks(p["schedule_factory"](), crowd=p["default_crowd"])
    return graph, scenario
