"""Deterministic banquet-hall graph matching fixtures/test-floorplan.png."""

from __future__ import annotations

from app.schemas.venue import ImageSize, VenueEdge, VenueGraph, VenueNode, NodeType


def banquet_hall_graph(image_width: int = 1600, image_height: int = 900) -> VenueGraph:
    """Nodes roughly aligned to the attached top-down banquet floorplan."""
    nodes = [
        VenueNode(
            id="entry_main",
            type=NodeType.entry_gate,
            label="Main Entrance",
            x=0.96,
            y=0.48,
            capacity=100,
        ),
        VenueNode(
            id="exit_secondary",
            type=NodeType.emergency_exit,
            label="Secondary Exit",
            x=0.92,
            y=0.88,
            capacity=60,
        ),
        VenueNode(
            id="junction_aisle",
            type=NodeType.walkway_junction,
            label="Main Aisle",
            x=0.42,
            y=0.50,
            capacity=150,
        ),
        VenueNode(
            id="junction_east",
            type=NodeType.walkway_junction,
            label="East Circulation",
            x=0.78,
            y=0.48,
            capacity=120,
        ),
        VenueNode(
            id="seating_center",
            type=NodeType.seating,
            label="Guest Tables",
            x=0.62,
            y=0.45,
            capacity=180,
        ),
        VenueNode(
            id="head_table",
            type=NodeType.attraction,
            label="Head Table",
            x=0.55,
            y=0.12,
            capacity=40,
        ),
        VenueNode(
            id="dance_floor",
            type=NodeType.attraction,
            label="Dance Floor",
            x=0.70,
            y=0.78,
            capacity=120,
        ),
        VenueNode(
            id="bar",
            type=NodeType.concession,
            label="Bar",
            x=0.28,
            y=0.28,
            capacity=35,
            service_rate_per_min=18,
        ),
        VenueNode(
            id="buffet",
            type=NodeType.concession,
            label="Service / Buffet",
            x=0.36,
            y=0.42,
            capacity=45,
            service_rate_per_min=20,
        ),
        VenueNode(
            id="kitchen",
            type=NodeType.service,
            label="Kitchen + Prep",
            x=0.18,
            y=0.78,
            capacity=25,
            service_rate_per_min=10,
        ),
        VenueNode(
            id="restrooms",
            type=NodeType.restroom,
            label="Mens / Ladies",
            x=0.22,
            y=0.38,
            capacity=30,
            service_rate_per_min=12,
        ),
        VenueNode(
            id="green_room",
            type=NodeType.other,
            label="Green Room",
            x=0.12,
            y=0.12,
            capacity=20,
        ),
    ]

    edges = [
        VenueEdge(id="e1", source="entry_main", target="junction_east", length_m=18, width_m=3.5, capacity=110),
        VenueEdge(id="e2", source="junction_east", target="junction_aisle", length_m=28, width_m=4.0, capacity=140),
        VenueEdge(id="e3", source="junction_east", target="seating_center", length_m=16, width_m=3.0, capacity=100),
        VenueEdge(id="e4", source="junction_aisle", target="seating_center", length_m=14, width_m=3.5, capacity=120),
        VenueEdge(id="e5", source="seating_center", target="head_table", length_m=22, width_m=2.5, capacity=80),
        VenueEdge(id="e6", source="seating_center", target="dance_floor", length_m=20, width_m=3.5, capacity=110),
        VenueEdge(id="e7", source="junction_aisle", target="buffet", length_m=10, width_m=2.5, capacity=70),
        VenueEdge(id="e8", source="buffet", target="bar", length_m=12, width_m=2.0, capacity=50),
        VenueEdge(id="e9", source="junction_aisle", target="restrooms", length_m=12, width_m=2.0, capacity=45),
        VenueEdge(id="e10", source="junction_aisle", target="kitchen", length_m=24, width_m=2.5, capacity=40),
        VenueEdge(id="e11", source="dance_floor", target="exit_secondary", length_m=16, width_m=2.5, capacity=70),
        VenueEdge(id="e12", source="junction_east", target="exit_secondary", length_m=30, width_m=2.5, capacity=80),
        VenueEdge(id="e13", source="bar", target="green_room", length_m=18, width_m=1.8, capacity=30),
        VenueEdge(id="e14", source="dance_floor", target="junction_aisle", length_m=26, width_m=3.0, capacity=100),
    ]

    return VenueGraph(
        image_size=ImageSize(width=image_width, height=image_height),
        nodes=nodes,
        edges=edges,
        confirmed=False,
        source="mock",
    )


def default_wedding_schedule() -> list[dict]:
    return [
        {
            "id": "arrival",
            "label": "Guest arrival",
            "type": "arrival",
            "start": "17:00",
            "end": "18:00",
            "attractors": ["seating_center", "bar"],
            "arrival_rate_per_min": 55,
        },
        {
            "id": "ceremony",
            "label": "Main event",
            "type": "attraction",
            "start": "18:00",
            "end": "19:30",
            "attractors": ["head_table", "seating_center"],
            "arrival_rate_per_min": 5,
        },
        {
            "id": "break",
            "label": "Intermission / dinner",
            "type": "break",
            "start": "19:30",
            "end": "20:30",
            "attractors": ["buffet", "bar", "restrooms"],
            "arrival_rate_per_min": 2,
        },
        {
            "id": "dance",
            "label": "Dance",
            "type": "attraction",
            "start": "20:30",
            "end": "22:00",
            "attractors": ["dance_floor", "bar"],
            "arrival_rate_per_min": 0,
        },
        {
            "id": "egress",
            "label": "Exit rush",
            "type": "egress",
            "start": "22:00",
            "end": "22:45",
            "attractors": ["entry_main", "exit_secondary"],
            "arrival_rate_per_min": 0,
        },
    ]
