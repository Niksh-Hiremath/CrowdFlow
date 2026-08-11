from __future__ import annotations

from app.config import Settings
from app.services.graph_builder import normalize_graph, validate_graph
from app.services.presets import list_presets, load_preset
from app.services.routing import suggest_routes
from app.services.simulator import SimulationEngine
from app.schemas.venue import NodeState, NodeType, VenueGraph, VenueNode


def test_validate_requires_entry_and_exit():
    g = VenueGraph(
        nodes=[
            VenueNode(id="a", type=NodeType.seating, label="A", x=0.2, y=0.2, capacity=10),
        ],
        edges=[],
    )
    errors = validate_graph(normalize_graph(g))
    assert any("entry_gate" in e for e in errors)


def test_all_presets_confirmable():
    for item in list_presets():
        graph, scenario = load_preset(item["id"])
        errors = validate_graph(normalize_graph(graph))
        assert errors == [], f"{item['id']}: {errors}"
        assert scenario.expected_crowd >= 1
        assert scenario.schedule.blocks


def test_routing_avoids_dense_nodes():
    graph, _ = load_preset("banquet")
    settings = Settings()
    dense = {
        n.id: NodeState(density=0.95 if n.id == "buffet" else 0.1, count=10, risk=0.5)
        for n in graph.nodes
    }
    routes = suggest_routes(graph, dense, settings, avoid=["buffet"])
    assert routes
    # Prefer paths should route around the avoided concession when alternatives exist.
    non_egress = [r for r in routes if not r.purpose.startswith("egress")]
    assert non_egress
    assert any("buffet" not in r.path_node_ids for r in non_egress)


def test_sim_schedule_phases_change():
    graph, scenario = load_preset("banquet")
    engine = SimulationEngine(graph=graph, scenario=scenario, settings=Settings(sim_clock_minutes_per_step=5))
    engine.running = True
    first = engine.step()
    later = first
    for _ in range(40):
        later = engine.step()
    assert later.t > first.t
    assert later.sim_time != first.sim_time
