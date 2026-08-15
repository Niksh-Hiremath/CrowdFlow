"""Deterministic banquet-hall graph matching fixtures/test-floorplan.png."""

from __future__ import annotations

import math

from app.schemas.venue import ImageSize, VenueEdge, VenueGraph, VenueNode, NodeType


def banquet_hall_graph(image_width: int = 1600, image_height: int = 900) -> VenueGraph:
    """Curated graph aligned to the bundled banquet floorplan."""
    def node(node_id: str, node_type: NodeType, label: str, x: float, y: float, capacity: int, service_rate: float | None = None) -> VenueNode:
        return VenueNode(
            id=node_id,
            type=node_type,
            label=label,
            x=x,
            y=y,
            capacity=capacity,
            service_rate_per_min=service_rate,
            bidirectional=node_type == NodeType.entry_gate,
        )

    nodes = [
        node("entry_east", NodeType.entry_gate, "East Entrance", 0.985, 0.23, 140),
        node("entry_south", NodeType.entry_gate, "South Entrance", 0.55, 0.985, 140),
        node("green_room", NodeType.other, "Green Room", 0.12, 0.12, 20),
        node("storage", NodeType.service, "Storage", 0.12, 0.31, 20),
        node("mens_room", NodeType.restroom, "Mens Room", 0.22, 0.28, 24, 12),
        node("ladies_room", NodeType.restroom, "Ladies Room", 0.32, 0.28, 24, 12),
        node("bar", NodeType.concession, "Bar", 0.32, 0.12, 40, 18),
        node("service_counter", NodeType.service, "Service Counter", 0.40, 0.28, 35, 15),
        node("head_table", NodeType.attraction, "Head Table", 0.62, 0.12, 40),
        node("tables_north", NodeType.seating, "North Guest Tables", 0.67, 0.29, 160),
        node("tables_center", NodeType.seating, "Center Guest Tables", 0.66, 0.46, 220),
        node("tables_south", NodeType.seating, "South Guest Tables", 0.84, 0.58, 120),
        node("dance_floor", NodeType.attraction, "Dance Floor", 0.64, 0.82, 140),
        node("kitchen_prep", NodeType.service, "Kitchen + Prep Area", 0.35, 0.82, 30, 10),
        node("junction_west", NodeType.walkway_junction, "West Corridor", 0.23, 0.54, 160),
        node("junction_center", NodeType.walkway_junction, "Main Hall Junction", 0.47, 0.54, 220),
        node("junction_east", NodeType.walkway_junction, "East Corridor", 0.91, 0.54, 160),
        node("junction_south", NodeType.walkway_junction, "South Hall Junction", 0.47, 0.68, 180),
        node("junction_south_east", NodeType.walkway_junction, "South-East Junction", 0.91, 0.78, 140),
    ]

    connections = [
        ("entry_east", "junction_east"),
        ("entry_south", "junction_south"),
        ("junction_west", "junction_center"),
        ("junction_center", "junction_east"),
        ("junction_west", "junction_south"),
        ("junction_south", "junction_south_east"),
        ("junction_south_east", "junction_east"),
        ("junction_west", "storage"),
        ("storage", "green_room"),
        ("junction_west", "mens_room"),
        ("junction_west", "ladies_room"),
        ("ladies_room", "bar"),
        ("ladies_room", "service_counter"),
        ("service_counter", "junction_center"),
        ("junction_center", "tables_north"),
        ("junction_center", "tables_center"),
        ("junction_east", "tables_north"),
        ("junction_east", "tables_center"),
        ("junction_east", "tables_south"),
        ("junction_south_east", "tables_south"),
        ("tables_north", "head_table"),
        ("tables_north", "tables_center"),
        ("tables_center", "tables_south"),
        ("tables_center", "dance_floor"),
        ("junction_south", "dance_floor"),
        ("junction_south", "kitchen_prep"),
        ("dance_floor", "junction_south_east"),
    ]
    nodes_by_id = {venue_node.id: venue_node for venue_node in nodes}
    edges = [
        VenueEdge(
            id=f"banquet_e{i}",
            source=source,
            target=target,
            length_m=max(4.0, 45 * math.hypot(
                nodes_by_id[source].x - nodes_by_id[target].x,
                nodes_by_id[source].y - nodes_by_id[target].y,
            )),
            width_m=3.0 if "junction" in source or "junction" in target else 2.5,
            capacity=140,
        )
        for i, (source, target) in enumerate(connections, 1)
    ]

    return VenueGraph(
        image_size=ImageSize(width=image_width, height=image_height),
        nodes=nodes,
        edges=edges,
        confirmed=False,
        source="mock",
    )


def concert_hall_graph(image_width: int = 1773, image_height: int = 1531) -> VenueGraph:
    """Curated movement graph for the bundled concert-hall preset image."""
    def node(node_id: str, node_type: NodeType, label: str, x: float, y: float, capacity: int) -> VenueNode:
        return VenueNode(id=node_id, type=node_type, label=label, x=x, y=y, capacity=capacity)

    nodes = [
        node("entry_left", NodeType.entry_gate, "Left Entrance", 0.20, 0.24, 180),
        node("entry_right", NodeType.entry_gate, "Right Entrance", 0.80, 0.24, 180),
        node("stage", NodeType.attraction, "Stage", 0.50, 0.14, 80),
        node("pit", NodeType.attraction, "Pit", 0.50, 0.25, 180),
        node("orchestra_left", NodeType.seating, "Orchestra Left", 0.34, 0.43, 180),
        node("orchestra_center", NodeType.seating, "Orchestra Center", 0.50, 0.43, 220),
        node("orchestra_right", NodeType.seating, "Orchestra Right", 0.66, 0.43, 180),
        node("parterre_left", NodeType.seating, "Parterre Left", 0.32, 0.57, 150),
        node("parterre_center", NodeType.seating, "Parterre Center", 0.50, 0.57, 180),
        node("parterre_right", NodeType.seating, "Parterre Right", 0.68, 0.57, 150),
        node("grand_tier_left", NodeType.seating, "Grand Tier Left", 0.32, 0.69, 150),
        node("grand_tier_center", NodeType.seating, "Grand Tier Center", 0.50, 0.69, 180),
        node("grand_tier_right", NodeType.seating, "Grand Tier Right", 0.68, 0.69, 150),
        node("dress_circle", NodeType.seating, "Dress Circle", 0.50, 0.84, 220),
        node("aisle_left_north", NodeType.walkway_junction, "Left North Aisle", 0.22, 0.37, 180),
        node("aisle_left_center", NodeType.walkway_junction, "Left Center Aisle", 0.22, 0.58, 180),
        node("aisle_left_south", NodeType.walkway_junction, "Left South Aisle", 0.15, 0.78, 180),
        node("aisle_right_north", NodeType.walkway_junction, "Right North Aisle", 0.78, 0.37, 180),
        node("aisle_right_center", NodeType.walkway_junction, "Right Center Aisle", 0.78, 0.58, 180),
        node("aisle_right_south", NodeType.walkway_junction, "Right South Aisle", 0.85, 0.78, 180),
        node("foyer_left", NodeType.walkway_junction, "Left Foyer", 0.11, 0.89, 180),
        node("foyer_right", NodeType.walkway_junction, "Right Foyer", 0.89, 0.89, 180),
        node("foyer_bottom", NodeType.walkway_junction, "Bottom Foyer", 0.50, 0.91, 220),
        node("access_left", NodeType.walkway_junction, "Left Accessible Route", 0.08, 0.78, 100),
        node("access_right", NodeType.walkway_junction, "Right Accessible Route", 0.92, 0.78, 100),
    ]

    connections = [
        ("entry_left", "aisle_left_north"), ("entry_right", "aisle_right_north"),
        ("aisle_left_north", "aisle_left_center"), ("aisle_left_center", "aisle_left_south"),
        ("aisle_right_north", "aisle_right_center"), ("aisle_right_center", "aisle_right_south"),
        ("aisle_left_south", "foyer_left"), ("aisle_right_south", "foyer_right"),
        ("foyer_left", "foyer_bottom"), ("foyer_right", "foyer_bottom"),
        ("foyer_left", "access_left"), ("foyer_right", "access_right"),
        ("access_left", "aisle_left_south"), ("access_right", "aisle_right_south"),
        ("aisle_left_north", "pit"), ("aisle_right_north", "pit"),
        ("pit", "stage"), ("pit", "orchestra_center"),
        ("aisle_left_center", "orchestra_left"), ("aisle_left_center", "parterre_left"),
        ("aisle_left_center", "grand_tier_left"), ("aisle_right_center", "orchestra_right"),
        ("aisle_right_center", "parterre_right"), ("aisle_right_center", "grand_tier_right"),
        ("orchestra_left", "orchestra_center"), ("orchestra_center", "orchestra_right"),
        ("orchestra_left", "parterre_left"), ("orchestra_center", "parterre_center"),
        ("orchestra_right", "parterre_right"), ("parterre_left", "parterre_center"),
        ("parterre_center", "parterre_right"), ("parterre_left", "grand_tier_left"),
        ("parterre_center", "grand_tier_center"), ("parterre_right", "grand_tier_right"),
        ("grand_tier_left", "grand_tier_center"), ("grand_tier_center", "grand_tier_right"),
        ("grand_tier_left", "dress_circle"), ("grand_tier_center", "dress_circle"),
        ("grand_tier_right", "dress_circle"),
    ]
    edges = [
        VenueEdge(id=f"concert_e{i}", source=a, target=b, length_m=max(4.0, 40 * math.hypot(
            next(n for n in nodes if n.id == a).x - next(n for n in nodes if n.id == b).x,
            next(n for n in nodes if n.id == a).y - next(n for n in nodes if n.id == b).y,
        )), width_m=3.0, capacity=120)
        for i, (a, b) in enumerate(connections, 1)
    ]
    return VenueGraph(
        image_size=ImageSize(width=image_width, height=image_height),
        nodes=nodes,
        edges=edges,
        confirmed=False,
        source="manual",
    )


def default_wedding_schedule() -> list[dict]:
    return [
        {
            "id": "arrival",
            "label": "Guest arrival",
            "type": "arrival",
            "start": "17:00",
            "end": "18:00",
            "attractors": ["entry_gate", "seating"],
            "arrival_rate_per_min": 35,
        },
        {
            "id": "ceremony",
            "label": "Ceremony / main event",
            "type": "attraction",
            "start": "18:00",
            "end": "19:30",
            "attractors": ["seating", "attraction"],
            "arrival_rate_per_min": 3,
        },
        {
            "id": "dinner",
            "label": "Dinner service",
            "type": "break",
            "start": "19:30",
            "end": "20:45",
            "attractors": ["concession", "restroom", "seating"],
            "arrival_rate_per_min": 1,
        },
        {
            "id": "dance",
            "label": "Dance and social",
            "type": "attraction",
            "start": "20:45",
            "end": "22:15",
            "attractors": ["attraction", "concession"],
            "arrival_rate_per_min": 1,
        },
        {
            "id": "egress",
            "label": "Guest egress",
            "type": "egress",
            "start": "22:15",
            "end": "23:30",
            "attractors": ["exit", "entry_gate"],
            "arrival_rate_per_min": 1,
        },
    ]
