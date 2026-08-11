from __future__ import annotations

from app.config import Settings
from app.schemas.venue import Bottleneck, NodeState, VenueGraph


def detect_bottlenecks(
    graph: VenueGraph,
    node_states: dict[str, NodeState],
    settings: Settings,
) -> list[Bottleneck]:
    bottlenecks: list[Bottleneck] = []
    for node in graph.nodes:
        state = node_states.get(node.id)
        if state is None:
            continue
        density = state.density
        severity: str | None = None
        reason = ""
        eta = 0.0

        if density >= settings.critical_density:
            severity = "critical"
            reason = "density_exceeds_critical"
            eta = 0.0
        elif density >= settings.warning_density:
            severity = "warning"
            reason = "density_exceeds_warning"
            # Rough ETA to critical assuming current growth is unknown → use queue proxy.
            headroom = max(0.01, settings.critical_density - density)
            eta = headroom / max(0.01, density) * 60.0
        elif state.queue > node.capacity * 0.35:
            severity = "watch"
            reason = "queue_building"
            eta = 90.0

        if severity:
            bottlenecks.append(
                Bottleneck(
                    id=f"bn_{node.id}",
                    node_id=node.id,
                    severity=severity,  # type: ignore[arg-type]
                    eta_critical_s=eta,
                    reason=reason,
                )
            )

    order = {"critical": 0, "warning": 1, "watch": 2}
    bottlenecks.sort(key=lambda b: (order[b.severity], -node_states[b.node_id].density))
    return bottlenecks
