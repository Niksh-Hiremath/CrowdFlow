from __future__ import annotations

from dataclasses import dataclass, field

from app.config import Settings, get_settings
from app.schemas.venue import (
    AdvisorAction,
    EdgeState,
    EventSchedule,
    NodeState,
    NodeType,
    Scenario,
    SimTick,
    VenueGraph,
)
from app.services.bottlenecks import detect_bottlenecks
from app.services.routing import suggest_routes
from app.services.graph_builder import to_networkx
import networkx as nx


def _hhmm_to_min(value: str) -> int:
    hh, mm = value.split(":")
    return int(hh) * 60 + int(mm)


def _min_to_hhmm(total: int) -> str:
    total = total % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"


@dataclass
class SimulationEngine:
    graph: VenueGraph
    scenario: Scenario
    settings: Settings = field(default_factory=get_settings)
    t: float = 0.0
    clock_min: int = 17 * 60
    remaining_to_spawn: float = 0.0
    node_count: dict[str, float] = field(default_factory=dict)
    node_queue: dict[str, float] = field(default_factory=dict)
    edge_flow: dict[str, float] = field(default_factory=dict)
    gate_meters: dict[str, float] = field(default_factory=dict)
    avoid: list[str] = field(default_factory=list)
    prefer: list[str] = field(default_factory=list)
    running: bool = False
    max_ticks: int | None = None
    ticks_done: int = 0
    finished: bool = False

    def __post_init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        schedule = self.scenario.schedule
        if schedule.blocks:
            self.clock_min = _hhmm_to_min(schedule.blocks[0].start)
        else:
            self.clock_min = 17 * 60
        self.t = 0.0
        self.remaining_to_spawn = float(self.scenario.expected_crowd)
        self.node_count = {n.id: 0.0 for n in self.graph.nodes}
        self.node_queue = {n.id: 0.0 for n in self.graph.nodes}
        self.edge_flow = {e.id: 0.0 for e in self.graph.edges}
        self.gate_meters = {}
        self.avoid = []
        self.prefer = []
        self.running = False
        self.ticks_done = 0
        self.finished = False

    def active_blocks(self) -> list:
        out = []
        for block in self.scenario.schedule.blocks:
            start = _hhmm_to_min(block.start)
            end = _hhmm_to_min(block.end)
            if start <= self.clock_min < end:
                out.append(block)
        return out

    def apply_actions(self, actions: list[AdvisorAction]) -> None:
        for action in sorted(actions, key=lambda a: a.priority):
            if action.type == "reroute":
                self.avoid = list(dict.fromkeys(self.avoid + action.avoid))
                self.prefer = list(dict.fromkeys(self.prefer + action.prefer))
            elif action.type == "prefer_node" and action.node_id:
                if action.node_id not in self.prefer:
                    self.prefer.append(action.node_id)
            elif action.type == "throttle_gate" and action.node_id:
                self.gate_meters[action.node_id] = float(action.meter_per_min or 20.0)
            elif action.type == "open_exit" and action.node_id:
                # Boost exit capacity virtually via prefer
                if action.node_id not in self.prefer:
                    self.prefer.append(action.node_id)

    def _spawn(self, dt_min: float, blocks: list) -> None:
        if self.remaining_to_spawn <= 0:
            return
        rate = sum(b.arrival_rate_per_min for b in blocks) if blocks else 10.0
        entries = [n for n in self.graph.nodes if n.type == NodeType.entry_gate]
        if not entries:
            return
        incoming = min(self.remaining_to_spawn, rate * dt_min)
        per_entry = incoming / len(entries)
        for entry in entries:
            cap = self.gate_meters.get(entry.id, rate)
            allowed = min(per_entry, cap * dt_min)
            self.node_count[entry.id] += allowed
            self.remaining_to_spawn -= allowed

    def _resolve_attractors(self, blocks: list) -> list[str]:
        """Map schedule attractor ids onto nodes that exist in the current graph."""
        node_ids = {n.id for n in self.graph.nodes}
        by_type: dict[NodeType, list[str]] = {}
        for n in self.graph.nodes:
            by_type.setdefault(n.type, []).append(n.id)

        resolved: list[str] = []
        for block in blocks:
            for attr in block.attractors:
                if attr in node_ids:
                    resolved.append(attr)
                    continue
                # Fallback by semantic type keywords when VLM used different ids.
                key = attr.lower()
                if "seat" in key or "table" in key:
                    resolved.extend(by_type.get(NodeType.seating, []))
                elif "dance" in key or "stage" in key or "head" in key or "pitch" in key:
                    resolved.extend(by_type.get(NodeType.attraction, []))
                elif "bar" in key or "buffet" in key or "food" in key or "merch" in key:
                    resolved.extend(by_type.get(NodeType.concession, []))
                elif "rest" in key:
                    resolved.extend(by_type.get(NodeType.restroom, []))
                elif "exit" in key or "egress" in key or "gate" in key or "entry" in key:
                    resolved.extend(by_type.get(NodeType.exit, []))
                    resolved.extend(by_type.get(NodeType.emergency_exit, []))
                    resolved.extend(by_type.get(NodeType.entry_gate, []))
        if not resolved:
            for t in (
                NodeType.attraction,
                NodeType.seating,
                NodeType.concession,
                NodeType.exit,
                NodeType.emergency_exit,
            ):
                resolved.extend(by_type.get(t, []))
        # Preserve order, unique
        return list(dict.fromkeys(resolved))

    def _move(self, dt_min: float, blocks: list) -> None:
        attractors = self._resolve_attractors(blocks)

        # Build undirected adjacency with edge meta
        adj: dict[str, list[tuple[str, str, float, int]]] = {n.id: [] for n in self.graph.nodes}
        for edge in self.graph.edges:
            adj[edge.source].append((edge.target, edge.id, edge.length_m, edge.capacity))
            adj[edge.target].append((edge.source, edge.id, edge.length_m, edge.capacity))

        # Desire: move mass toward attractors / away from avoided nodes
        transfers: dict[str, float] = {n.id: 0.0 for n in self.graph.nodes}
        edge_flows: dict[str, float] = {e.id: 0.0 for e in self.graph.edges}

        # Compute global distance map from attractors using NetworkX
        dist_map = {}
        if attractors:
            try:
                nx_graph = to_networkx(self.graph)
                dist_map = nx.multi_source_dijkstra_path_length(nx_graph, attractors, weight="length_m")
            except Exception:
                pass

        for node in self.graph.nodes:
            count = self.node_count[node.id]
            if count <= 0:
                continue
            neighbors = adj[node.id]
            if not neighbors:
                continue

            node_dist = dist_map.get(node.id, 999999.0)

            # Score neighbors
            scored: list[tuple[float, str, str, float, int]] = []
            for nb, eid, length, capacity in neighbors:
                score = 1.0
                if nb in attractors:
                    score += 3.0
                
                # Global routing: boost score heavily if neighbor is strictly closer to attractors
                nb_dist = dist_map.get(nb, 999999.0)
                if nb_dist < node_dist:
                    score += 15.0

                if nb in self.prefer:
                    score += 2.0
                if nb in self.avoid or node.id in self.avoid:
                    score *= 0.05
                dens = self.node_count[nb] / max(1.0, next(n.capacity for n in self.graph.nodes if n.id == nb))
                score *= max(0.05, 1.0 - dens)
                scored.append((score, nb, eid, length, capacity))

            total_score = sum(s for s, *_ in scored) or 1.0
            movable = count * min(0.55, dt_min * 0.8)
            for score, nb, eid, length, capacity in scored:
                share = movable * (score / total_score)
                speed_factor = max(0.15, 1.0 - (self.node_count[node.id] / max(1.0, node.capacity)))
                throughput = capacity * speed_factor * (dt_min / max(0.5, length / 20.0))
                moved = min(share, throughput)
                transfers[node.id] -= moved
                transfers[nb] += moved
                edge_flows[eid] += moved

        for nid, delta in transfers.items():
            self.node_count[nid] = max(0.0, self.node_count[nid] + delta)
        self.edge_flow = edge_flows

        # Service queues at concessions / restrooms
        for node in self.graph.nodes:
            if node.type not in {NodeType.concession, NodeType.restroom, NodeType.service}:
                continue
            rate = node.service_rate_per_min or 10.0
            served = min(self.node_count[node.id], rate * dt_min)
            # Served people linger briefly then redistribute via next ticks; model as queue drain
            overflow = max(0.0, self.node_count[node.id] - node.capacity)
            self.node_queue[node.id] = overflow
            self.node_count[node.id] = max(0.0, self.node_count[node.id] - served * 0.35)

        # Soft capacity clamp
        for node in self.graph.nodes:
            if self.node_count[node.id] > node.capacity * 1.25:
                self.node_queue[node.id] = self.node_count[node.id] - node.capacity
                self.node_count[node.id] = node.capacity * 1.25

    def step(self) -> SimTick:
        dt = self.settings.sim_dt_seconds
        # Physics uses wall dt; schedule clock advances faster for demo pace.
        clock_dt_min = max(dt / 60.0, self.settings.sim_clock_minutes_per_step)
        blocks = self.active_blocks()
        self._spawn(clock_dt_min, blocks)
        self._move(clock_dt_min, blocks)

        self.t += dt
        self.clock_min += int(round(clock_dt_min))

        node_states: dict[str, NodeState] = {}
        for node in self.graph.nodes:
            count = self.node_count[node.id]
            density = min(1.2, count / max(1.0, node.capacity))
            risk = min(1.0, 0.6 * density + 0.4 * (self.node_queue[node.id] / max(1.0, node.capacity)))
            node_states[node.id] = NodeState(
                density=round(density, 3),
                count=round(count, 2),
                risk=round(risk, 3),
                queue=round(self.node_queue[node.id], 2),
            )

        edge_states: dict[str, EdgeState] = {}
        for edge in self.graph.edges:
            flow = self.edge_flow.get(edge.id, 0.0)
            src_d = node_states[edge.source].density
            tgt_d = node_states[edge.target].density
            dens = max(src_d, tgt_d)
            speed_factor = max(0.1, 1.0 - dens)
            edge_states[edge.id] = EdgeState(
                flow=round(flow, 2),
                speed_factor=round(speed_factor, 3),
                congested=dens >= self.settings.warning_density,
            )

        bottlenecks = detect_bottlenecks(self.graph, node_states, self.settings)
        attractors = self._resolve_attractors(blocks)
        # Keep avoid/prefer only if those nodes exist in this graph.
        node_ids = {n.id for n in self.graph.nodes}
        routes = suggest_routes(
            self.graph,
            node_states,
            self.settings,
            attractor_ids=attractors,
            avoid=[a for a in self.avoid if a in node_ids],
            prefer=[p for p in self.prefer if p in node_ids],
        )

        self.ticks_done += 1
        if self.max_ticks is not None and self.ticks_done >= self.max_ticks:
            self.running = False
            self.finished = True

        return SimTick(
            t=round(self.t, 2),
            sim_time=_min_to_hhmm(self.clock_min),
            nodes=node_states,
            edges=edge_states,
            bottlenecks=bottlenecks,
            routes=routes,
            remaining_to_spawn=round(self.remaining_to_spawn, 2),
            active_block_ids=[b.id for b in blocks],
        )


def default_scenario_from_blocks(blocks: list[dict], crowd: int = 400) -> Scenario:
    from app.schemas.venue import EventSchedule, ScheduleBlock

    return Scenario(
        expected_crowd=crowd,
        schedule=EventSchedule(blocks=[ScheduleBlock(**b) for b in blocks]),
    )
