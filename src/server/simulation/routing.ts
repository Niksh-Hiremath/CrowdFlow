import type { EdgeId, VenueEdge, VenueGraph } from "../../shared/types";
import type { ReroutePolicy, RoutePath } from "./model";

export interface RoutingContext {
  readonly edgeOccupancyRatios?: Readonly<Record<EdgeId, number>>;
  readonly congestionPenaltyAlpha?: number;
  readonly policies?: readonly ReroutePolicy[];
  readonly policyCompliance?: number;
  readonly excludedEdgeIds?: ReadonlySet<EdgeId>;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export function freeFlowMinutes(edge: VenueEdge): number {
  return edge.lengthMeters / edge.freeSpeedMps / 60;
}

export function edgeCostMinutes(edge: VenueEdge, context: RoutingContext = {}): number {
  if (context.excludedEdgeIds?.has(edge.id)) return Number.POSITIVE_INFINITY;
  const occupancyRatio = Math.max(0, context.edgeOccupancyRatios?.[edge.id] ?? 0);
  const alpha = context.congestionPenaltyAlpha ?? 0;
  let multiplier = 1 + alpha * occupancyRatio * occupancyRatio;
  const compliance = clamp(context.policyCompliance ?? 1, 0, 1);

  for (const policy of context.policies ?? []) {
    if (policy.avoidEdgeIds.includes(edge.id)) {
      const penalty = Math.max(1, policy.penaltyMultiplier ?? 25);
      multiplier *= 1 + compliance * (penalty - 1);
    }
    if (policy.preferEdgeIds?.includes(edge.id)) {
      multiplier *= 1 - 0.25 * compliance;
    }
  }

  return freeFlowMinutes(edge) * multiplier;
}

interface SearchRecord {
  readonly nodeId: string;
  readonly cost: number;
}

export function computeShortestPath(
  graph: VenueGraph,
  originNodeId: string,
  targetNodeId: string,
  context: RoutingContext = {},
): RoutePath | null {
  const nodeIds = new Set(graph.nodes.map((venueNode) => venueNode.id));
  if (!nodeIds.has(originNodeId) || !nodeIds.has(targetNodeId)) return null;
  if (originNodeId === targetNodeId) {
    return { nodeIds: [originNodeId], edgeIds: [], costMinutes: 0, freeFlowMinutes: 0 };
  }

  const outgoing = new Map<string, VenueEdge[]>();
  for (const edge of graph.edges) {
    const values = outgoing.get(edge.source) ?? [];
    values.push(edge);
    outgoing.set(edge.source, values);
  }
  for (const values of outgoing.values()) values.sort((a, b) => a.id.localeCompare(b.id));

  const distances = new Map<string, number>([[originNodeId, 0]]);
  const previous = new Map<string, { nodeId: string; edge: VenueEdge }>();
  const frontier: SearchRecord[] = [{ nodeId: originNodeId, cost: 0 }];

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost || a.nodeId.localeCompare(b.nodeId));
    const current = frontier.shift()!;
    if (current.cost > (distances.get(current.nodeId) ?? Number.POSITIVE_INFINITY)) continue;
    if (current.nodeId === targetNodeId) break;

    for (const edge of outgoing.get(current.nodeId) ?? []) {
      const edgeCost = edgeCostMinutes(edge, context);
      if (!Number.isFinite(edgeCost)) continue;
      const nextCost = current.cost + edgeCost;
      const knownCost = distances.get(edge.target) ?? Number.POSITIVE_INFINITY;
      const currentPreviousEdge = previous.get(edge.target)?.edge.id;
      const isTieWithBetterId = Math.abs(nextCost - knownCost) <= 1e-12 &&
        (currentPreviousEdge === undefined || edge.id.localeCompare(currentPreviousEdge) < 0);
      if (nextCost < knownCost - 1e-12 || isTieWithBetterId) {
        distances.set(edge.target, nextCost);
        previous.set(edge.target, { nodeId: current.nodeId, edge });
        frontier.push({ nodeId: edge.target, cost: nextCost });
      }
    }
  }

  if (!previous.has(targetNodeId)) return null;
  const reversedEdges: VenueEdge[] = [];
  const reversedNodes = [targetNodeId];
  let cursor = targetNodeId;
  while (cursor !== originNodeId) {
    const link = previous.get(cursor);
    if (!link) return null;
    reversedEdges.push(link.edge);
    cursor = link.nodeId;
    reversedNodes.push(cursor);
  }
  const edges = reversedEdges.reverse();
  const nodes = reversedNodes.reverse();
  return {
    nodeIds: nodes,
    edgeIds: edges.map((edge) => edge.id),
    costMinutes: edges.reduce((sum, edge) => sum + edgeCostMinutes(edge, context), 0),
    freeFlowMinutes: edges.reduce((sum, edge) => sum + freeFlowMinutes(edge), 0),
  };
}

/**
 * Deterministic small-K alternatives. Each accepted path is perturbed by
 * excluding each of its edges in turn; candidates are deduplicated and ranked.
 */
export function computeAlternativePaths(
  graph: VenueGraph,
  originNodeId: string,
  targetNodeId: string,
  maximumPaths: number,
  context: RoutingContext = {},
): readonly RoutePath[] {
  if (maximumPaths < 1) return [];
  const first = computeShortestPath(graph, originNodeId, targetNodeId, context);
  if (!first) return [];

  const accepted: RoutePath[] = [];
  const candidates = new Map<string, RoutePath>([[first.edgeIds.join("|"), first]]);
  while (accepted.length < maximumPaths && candidates.size > 0) {
    const next = [...candidates.values()].sort(
      (a, b) => a.costMinutes - b.costMinutes || a.edgeIds.join("|").localeCompare(b.edgeIds.join("|")),
    )[0]!;
    candidates.delete(next.edgeIds.join("|"));
    accepted.push(next);

    for (const edgeId of next.edgeIds) {
      const excluded = new Set(context.excludedEdgeIds ?? []);
      excluded.add(edgeId);
      const alternative = computeShortestPath(graph, originNodeId, targetNodeId, {
        ...context,
        excludedEdgeIds: excluded,
      });
      if (!alternative) continue;
      const signature = alternative.edgeIds.join("|");
      if (!accepted.some((path) => path.edgeIds.join("|") === signature)) {
        candidates.set(signature, alternative);
      }
    }
  }
  return accepted;
}

