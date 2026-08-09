import type { VenueGraph as ExtractedVenueGraph } from "./ai/index.js";
import type {
  ScheduleBlock,
  VenueEdge,
  VenueGraph,
  VenueNode,
} from "../shared/types.js";

const evenlyWeighted = (ids: readonly string[]): Readonly<Record<string, number>> =>
  Object.fromEntries(ids.map((id) => [id, 1 / ids.length]));

/**
 * Makes crowdSize the exact scenario demand without counting people present at
 * t=0 twice. Existing positive arrival rates keep their relative shape and are
 * scaled to the remaining demand. A schedule with no arrival curve receives a
 * deterministic flat arrival rate in its first arrival/non-egress block.
 */
export function calibrateScheduleDemand(
  schedule: readonly ScheduleBlock[],
  expectedCrowdSize: number,
  initialOccupancyPeople: number,
  entryNodeIds: readonly string[],
): readonly ScheduleBlock[] {
  const demandToGenerate = Math.max(0, expectedCrowdSize - initialOccupancyPeople);
  const scheduledDemand = schedule.reduce(
    (total, scheduleBlock) =>
      total + scheduleBlock.arrivalRatePerMinute *
        Math.max(0, scheduleBlock.endMinute - scheduleBlock.startMinute),
    0,
  );

  if (scheduledDemand > 0) {
    const scale = demandToGenerate / scheduledDemand;
    return schedule.map((scheduleBlock) => ({
      ...scheduleBlock,
      arrivalRatePerMinute: scheduleBlock.arrivalRatePerMinute * scale,
    }));
  }
  if (demandToGenerate === 0 || schedule.length === 0) {
    return schedule.map((scheduleBlock) => ({ ...scheduleBlock, arrivalRatePerMinute: 0 }));
  }

  let injectionIndex = schedule.findIndex(
    (scheduleBlock) =>
      scheduleBlock.phase === "arrival" && scheduleBlock.endMinute > scheduleBlock.startMinute,
  );
  if (injectionIndex < 0) {
    injectionIndex = schedule.findIndex(
      (scheduleBlock) =>
        scheduleBlock.phase !== "egress" && scheduleBlock.endMinute > scheduleBlock.startMinute,
    );
  }
  if (injectionIndex < 0) {
    injectionIndex = schedule.findIndex(
      (scheduleBlock) => scheduleBlock.endMinute > scheduleBlock.startMinute,
    );
  }
  if (injectionIndex < 0) {
    return schedule.map((scheduleBlock) => ({ ...scheduleBlock, arrivalRatePerMinute: 0 }));
  }
  const injectionBlock = schedule[injectionIndex]!;
  const duration = injectionBlock.endMinute - injectionBlock.startMinute;
  const fallbackEntryWeights = evenlyWeighted(entryNodeIds);

  return schedule.map((scheduleBlock, index) => index === injectionIndex
    ? {
        ...scheduleBlock,
        arrivalRatePerMinute: demandToGenerate / duration,
        entryWeights:
          Object.values(scheduleBlock.entryWeights).some((weight) => weight > 0)
            ? scheduleBlock.entryWeights
            : fallbackEntryWeights,
      }
    : { ...scheduleBlock, arrivalRatePerMinute: 0 });
}

/**
 * Converts the evidence-rich extraction contract into the transport-safe
 * simulator graph. Capacities remain conservative estimates and are displayed
 * to the operator for mandatory confirmation before the engine can start.
 */
export function extractedGraphToVenueGraph(extracted: ExtractedVenueGraph): VenueGraph {
  const nodes: VenueNode[] = extracted.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    type: node.type,
    x: node.x,
    y: node.y,
    capacityPeople: node.capacityPersons,
    maxThroughputPerMinute: Math.max(1, Math.round(node.capacityPersons / 3)),
  }));

  const edges: VenueEdge[] = [];
  for (const edge of extracted.edges) {
    const storageCapacity = Math.max(
      1,
      Math.round(edge.lengthMeters * edge.widthMeters * 1.5),
    );
    const common = {
      lengthMeters: edge.lengthMeters,
      widthMeters: edge.widthMeters,
      capacityPeople: storageCapacity,
      maxFlowPerMinute: edge.capacityPersonsPerMinute,
      freeSpeedMps: edge.type === "stairs" ? 0.75 : edge.type === "escalator" ? 0.9 : 1.2,
    };
    edges.push({
      id: edge.id,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      ...common,
    });
    if (edge.bidirectional) {
      edges.push({
        id: `${edge.id}_reverse`,
        source: edge.targetNodeId,
        target: edge.sourceNodeId,
        ...common,
      });
    }
  }

  return { nodes, edges };
}

/** Remaps a preset timeline onto newly extracted node IDs without inventing phases. */
export function adaptScheduleToGraph(
  schedule: readonly ScheduleBlock[],
  graph: VenueGraph,
): readonly ScheduleBlock[] {
  const entryIds = graph.nodes.filter((node) => node.type === "entry_gate").map((node) => node.id);
  const exitIds = graph.nodes
    .filter((node) => node.type === "exit" || node.type === "emergency_exit")
    .map((node) => node.id);
  const attractionIds = graph.nodes
    .filter((node) => node.type === "attraction" || node.type === "seating" || node.type === "platform")
    .map((node) => node.id);
  const breakIds = graph.nodes
    .filter((node) => node.type === "concession" || node.type === "restroom")
    .map((node) => node.id);
  const neutralIds = graph.nodes
    .filter((node) => node.type !== "entry_gate" && node.type !== "exit" && node.type !== "emergency_exit")
    .map((node) => node.id);

  const eventTargets = attractionIds.length > 0 ? attractionIds : neutralIds;
  const intermissionTargets = breakIds.length > 0 ? breakIds : eventTargets;

  return schedule.map((block) => {
    const targetIds = block.phase === "egress"
      ? exitIds
      : block.phase === "intermission"
        ? intermissionTargets
        : eventTargets;
    return {
      ...block,
      entryWeights: block.arrivalRatePerMinute > 0 ? evenlyWeighted(entryIds) : {},
      targetWeights: evenlyWeighted(targetIds),
    };
  });
}
