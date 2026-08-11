from __future__ import annotations

import math
from collections import defaultdict, deque

import networkx as nx

from app.schemas.venue import NodeType, VenueGraph, VenueNode


ENTRY_TYPES = {NodeType.entry_gate}
EXIT_TYPES = {NodeType.exit, NodeType.emergency_exit}


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def normalize_graph(graph: VenueGraph) -> VenueGraph:
    seen: dict[str, VenueNode] = {}
    for node in graph.nodes:
        node.x = clamp01(node.x)
        node.y = clamp01(node.y)
        # Deduplicate IDs by appending suffix when colliding.
        nid = node.id
        if nid in seen:
            k = 2
            while f"{node.id}_{k}" in seen:
                k += 1
            node.id = f"{node.id}_{k}"
        seen[node.id] = node
    nodes = list(seen.values())
    node_ids = {n.id for n in nodes}

    edges = []
    edge_keys: set[tuple[str, str, str]] = set()
    for edge in graph.edges:
        if edge.source not in node_ids or edge.target not in node_ids:
            continue
        key = (edge.source, edge.target, edge.id)
        if key in edge_keys:
            continue
        edge_keys.add(key)
        if edge.length_m <= 0:
            a = seen[edge.source]
            b = seen[edge.target]
            # Approximate meters from normalized coords assuming ~40m hall width.
            edge.length_m = max(2.0, math.hypot(a.x - b.x, a.y - b.y) * 40.0)
        edges.append(edge)

    # Drop non-critical isolated nodes (common with VLM extracts).
    connected = {e.source for e in edges} | {e.target for e in edges}
    kept_nodes = []
    for n in nodes:
        if n.id in connected or n.type in {NodeType.entry_gate, *EXIT_TYPES}:
            kept_nodes.append(n)
    # If an entry/exit somehow has no edges, keep it so validation can report clearly.
    graph.nodes = kept_nodes or nodes
    graph.edges = edges
    return graph


def to_networkx(graph: VenueGraph) -> nx.Graph:
    g = nx.Graph()
    for node in graph.nodes:
        g.add_node(node.id, **node.model_dump())
    for edge in graph.edges:
        g.add_edge(
            edge.source,
            edge.target,
            id=edge.id,
            length_m=edge.length_m,
            width_m=edge.width_m,
            capacity=edge.capacity,
            type=edge.type,
        )
    return g


def validate_graph(graph: VenueGraph) -> list[str]:
    errors: list[str] = []
    if not graph.nodes:
        errors.append("Graph has no nodes")
        return errors

    entries = [n for n in graph.nodes if n.type in ENTRY_TYPES]
    exits = [n for n in graph.nodes if n.type in EXIT_TYPES]
    if not entries:
        errors.append("Need at least one entry_gate")
    if not exits:
        errors.append("Need at least one exit or emergency_exit")

    g = to_networkx(graph)
    if g.number_of_nodes() == 0:
        errors.append("Empty graph after normalization")
        return errors

    for entry in entries:
        reachable_exit = False
        for exit_node in exits:
            if nx.has_path(g, entry.id, exit_node.id):
                reachable_exit = True
                break
        if not reachable_exit:
            errors.append(f"Entry '{entry.id}' cannot reach any exit")

    # Isolated decorative/service rooms should not block simulation.
    # Only fail if an entry/exit/junction is disconnected from the walkable graph.
    isolates = set(nx.isolates(g))
    critical_isolates = [
        n.id
        for n in graph.nodes
        if n.id in isolates and n.type in {NodeType.entry_gate, *EXIT_TYPES, NodeType.walkway_junction}
    ]
    if critical_isolates:
        errors.append(f"Critical isolated nodes: {', '.join(critical_isolates)}")

    return errors


def mark_confirmed(graph: VenueGraph) -> VenueGraph:
    for node in graph.nodes:
        node.confirmed = True
    graph.confirmed = True
    return graph


def adjacency(graph: VenueGraph) -> dict[str, list[str]]:
    adj: dict[str, list[str]] = defaultdict(list)
    for edge in graph.edges:
        adj[edge.source].append(edge.target)
        adj[edge.target].append(edge.source)
    return adj


def bfs_components(graph: VenueGraph) -> list[set[str]]:
    adj = adjacency(graph)
    seen: set[str] = set()
    comps: list[set[str]] = []
    for node in graph.nodes:
        if node.id in seen:
            continue
        q = deque([node.id])
        comp: set[str] = set()
        while q:
            cur = q.popleft()
            if cur in seen:
                continue
            seen.add(cur)
            comp.add(cur)
            q.extend(adj[cur])
        comps.append(comp)
    return comps
