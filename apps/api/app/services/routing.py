from __future__ import annotations

import networkx as nx

from app.config import Settings
from app.schemas.venue import (
    NodeState,
    NodeType,
    RouteSuggestion,
    VenueGraph,
)
from app.services.graph_builder import EXIT_TYPES, to_networkx


def edge_cost(
    length_m: float,
    density: float,
    alpha: float,
    avoid: set[str],
    prefer: set[str],
    u: str,
    v: str,
) -> float:
    dens = max(0.0, min(1.2, density))
    cost = length_m * (1.0 + alpha * dens * dens)
    if u in avoid or v in avoid:
        cost *= 8.0
    if u in prefer or v in prefer:
        cost *= 0.55
    return max(0.1, cost)


def suggest_routes(
    graph: VenueGraph,
    node_states: dict[str, NodeState],
    settings: Settings,
    attractor_ids: list[str] | None = None,
    avoid: list[str] | None = None,
    prefer: list[str] | None = None,
) -> list[RouteSuggestion]:
    g = to_networkx(graph)
    avoid_set = set(avoid or [])
    prefer_set = set(prefer or [])

    density_by_node = {nid: st.density for nid, st in node_states.items()}

    def cost_fn(u: str, v: str, data: dict) -> float:
        dens = max(density_by_node.get(u, 0.0), density_by_node.get(v, 0.0))
        return edge_cost(
            length_m=float(data.get("length_m", 10.0)),
            density=dens,
            alpha=settings.density_alpha,
            avoid=avoid_set,
            prefer=prefer_set,
            u=u,
            v=v,
        )

    node_ids = set(g.nodes)
    entries = [n.id for n in graph.nodes if n.type == NodeType.entry_gate and n.id in node_ids]
    exits = [n.id for n in graph.nodes if n.type in EXIT_TYPES and n.id in node_ids]
    attractors = [
        a
        for a in (
            attractor_ids
            or [
                n.id
                for n in graph.nodes
                if n.type in {NodeType.attraction, NodeType.concession, NodeType.seating}
            ]
        )
        if a in node_ids
    ]

    routes: list[RouteSuggestion] = []
    idx = 0

    # Primary: entry -> busiest attractor alternatives
    targets = attractors[:3] if attractors else exits[:1]
    for entry in entries[:2]:
        for target in targets:
            if entry == target or entry not in node_ids or target not in node_ids:
                continue
            if not nx.has_path(g, entry, target):
                continue
            try:
                path = nx.shortest_path(g, entry, target, weight=cost_fn)
                # Reconstruct cost
                total = 0.0
                for a, b in zip(path, path[1:]):
                    total += cost_fn(a, b, g.edges[a, b])
                idx += 1
                routes.append(
                    RouteSuggestion(
                        id=f"r{idx}",
                        purpose=f"{entry}_to_{target}",
                        path_node_ids=path,
                        cost=round(total, 3),
                    )
                )
            except nx.NetworkXNoPath:
                continue

    # Egress alternatives when exits exist
    if exits and entries:
        hub = entries[0]
        for exit_id in exits:
            if not nx.has_path(g, hub, exit_id):
                continue
            path = nx.shortest_path(g, hub, exit_id, weight=cost_fn)
            total = 0.0
            for a, b in zip(path, path[1:]):
                total += cost_fn(a, b, g.edges[a, b])
            idx += 1
            routes.append(
                RouteSuggestion(
                    id=f"r{idx}",
                    purpose=f"egress_via_{exit_id}",
                    path_node_ids=path,
                    cost=round(total, 3),
                )
            )

    # Deduplicate by path signature
    uniq: dict[tuple[str, ...], RouteSuggestion] = {}
    for route in routes:
        key = tuple(route.path_node_ids)
        if key not in uniq or route.cost < uniq[key].cost:
            uniq[key] = route
    return sorted(uniq.values(), key=lambda r: r.cost)[:6]
