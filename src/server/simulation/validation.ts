import { isEntryNode, isExitNode, type VenueGraph, type VenuePreset } from "../../shared/types";
import type { SimulationConfig } from "./model";

const EPSILON = 1e-9;

function hasDirectedPath(graph: VenueGraph, source: string, target: string): boolean {
  if (source === target) return true;
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const neighbors = adjacency.get(edge.source) ?? [];
    neighbors.push(edge.target);
    adjacency.set(edge.source, neighbors);
  }
  const seen = new Set([source]);
  const queue = [source];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (next === target) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

export function validateVenuePreset(preset: VenuePreset): readonly string[] {
  const errors: string[] = [];
  const nodes = new Map<string, (typeof preset.graph.nodes)[number]>();
  const edgeIds = new Set<string>();

  if (!preset.id.trim()) errors.push("Preset id is required.");
  if (!preset.imagePath.startsWith("/")) errors.push("imagePath must be root-relative.");
  if (!(preset.crowdSize > 0)) errors.push("crowdSize must be positive.");
  if (!(preset.durationMinutes > 0)) errors.push("durationMinutes must be positive.");
  if (preset.graph.nodes.length === 0) errors.push("Graph requires at least one node.");

  for (const venueNode of preset.graph.nodes) {
    if (nodes.has(venueNode.id)) errors.push(`Duplicate node id: ${venueNode.id}`);
    nodes.set(venueNode.id, venueNode);
    if (venueNode.x < 0 || venueNode.x > 1 || venueNode.y < 0 || venueNode.y > 1) {
      errors.push(`Node ${venueNode.id} coordinates must be normalized to [0, 1].`);
    }
    if (!(venueNode.capacityPeople > 0)) errors.push(`Node ${venueNode.id} capacityPeople must be positive.`);
    if (!(venueNode.maxThroughputPerMinute > 0)) {
      errors.push(`Node ${venueNode.id} maxThroughputPerMinute must be positive.`);
    }
  }

  for (const edge of preset.graph.edges) {
    if (edgeIds.has(edge.id)) errors.push(`Duplicate edge id: ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodes.has(edge.source)) errors.push(`Edge ${edge.id} has unknown source ${edge.source}.`);
    if (!nodes.has(edge.target)) errors.push(`Edge ${edge.id} has unknown target ${edge.target}.`);
    if (edge.source === edge.target) errors.push(`Edge ${edge.id} cannot be a self-loop.`);
    if (!(edge.lengthMeters > 0)) errors.push(`Edge ${edge.id} lengthMeters must be positive.`);
    if (!(edge.widthMeters > 0)) errors.push(`Edge ${edge.id} widthMeters must be positive.`);
    if (!(edge.capacityPeople > 0)) errors.push(`Edge ${edge.id} capacityPeople must be positive.`);
    if (!(edge.maxFlowPerMinute > 0)) errors.push(`Edge ${edge.id} maxFlowPerMinute must be positive.`);
    if (!(edge.freeSpeedMps > 0)) errors.push(`Edge ${edge.id} freeSpeedMps must be positive.`);
  }

  const entries = preset.graph.nodes.filter(isEntryNode);
  const exits = preset.graph.nodes.filter(isExitNode);
  if (entries.length === 0) errors.push("Graph requires at least one entry gate.");
  if (exits.length === 0) errors.push("Graph requires at least one exit.");

  let initialTotal = 0;
  for (const [nodeId, occupancy] of Object.entries(preset.initialOccupancy)) {
    const venueNode = nodes.get(nodeId);
    if (!venueNode) {
      errors.push(`Initial occupancy references unknown node ${nodeId}.`);
      continue;
    }
    if (occupancy < 0 || !Number.isFinite(occupancy)) {
      errors.push(`Initial occupancy at ${nodeId} must be finite and non-negative.`);
    }
    if (occupancy > venueNode.capacityPeople + EPSILON) {
      errors.push(`Initial occupancy at ${nodeId} exceeds node storage capacity.`);
    }
    initialTotal += occupancy;
  }
  if (initialTotal > preset.crowdSize + EPSILON) {
    errors.push("Initial occupancy exceeds crowdSize.");
  }

  if (preset.schedule.length === 0) {
    errors.push("Schedule requires at least one block.");
  } else {
    let expectedStart = 0;
    const scheduleIds = new Set<string>();
    for (const scheduleBlock of preset.schedule) {
      if (scheduleIds.has(scheduleBlock.id)) errors.push(`Duplicate schedule block id: ${scheduleBlock.id}`);
      scheduleIds.add(scheduleBlock.id);
      if (Math.abs(scheduleBlock.startMinute - expectedStart) > EPSILON) {
        errors.push(`Schedule must be contiguous; expected block ${scheduleBlock.id} at ${expectedStart}.`);
      }
      if (!(scheduleBlock.endMinute > scheduleBlock.startMinute)) {
        errors.push(`Schedule block ${scheduleBlock.id} must have positive duration.`);
      }
      if (!(scheduleBlock.arrivalRatePerMinute >= 0)) {
        errors.push(`Schedule block ${scheduleBlock.id} arrival rate cannot be negative.`);
      }
      if (scheduleBlock.rerouteCompliance < 0 || scheduleBlock.rerouteCompliance > 1) {
        errors.push(`Schedule block ${scheduleBlock.id} compliance must be in [0, 1].`);
      }

      const targetEntries = Object.entries(scheduleBlock.targetWeights);
      const targetWeightTotal = targetEntries.reduce((sum, [, weight]) => sum + weight, 0);
      if (!(targetWeightTotal > 0)) errors.push(`Schedule block ${scheduleBlock.id} requires positive target weights.`);
      for (const [nodeId, weight] of targetEntries) {
        if (!nodes.has(nodeId)) errors.push(`Schedule block ${scheduleBlock.id} targets unknown node ${nodeId}.`);
        if (!(weight >= 0) || !Number.isFinite(weight)) errors.push(`Schedule block ${scheduleBlock.id} has invalid target weight.`);
      }

      const entryWeights = Object.entries(scheduleBlock.entryWeights);
      const entryWeightTotal = entryWeights.reduce((sum, [, weight]) => sum + weight, 0);
      if (scheduleBlock.arrivalRatePerMinute > 0 && !(entryWeightTotal > 0)) {
        errors.push(`Schedule block ${scheduleBlock.id} has arrivals but no entry weights.`);
      }
      for (const [nodeId, weight] of entryWeights) {
        const entryNode = nodes.get(nodeId);
        if (!entryNode || !isEntryNode(entryNode)) {
          errors.push(`Schedule block ${scheduleBlock.id} entry ${nodeId} is not an entry gate.`);
        }
        if (!(weight >= 0) || !Number.isFinite(weight)) errors.push(`Schedule block ${scheduleBlock.id} has invalid entry weight.`);
      }

      if (scheduleBlock.phase === "egress") {
        for (const [nodeId, weight] of targetEntries) {
          const targetNode = nodes.get(nodeId);
          if (weight > 0 && targetNode && !isExitNode(targetNode)) {
            errors.push(`Egress block ${scheduleBlock.id} target ${nodeId} is not an exit.`);
          }
        }
      }
      expectedStart = scheduleBlock.endMinute;
    }
    if (Math.abs(expectedStart - preset.durationMinutes) > EPSILON) {
      errors.push("Schedule must cover durationMinutes exactly.");
    }
    if (preset.schedule.at(-1)?.phase !== "egress") {
      errors.push("Schedule must end with an egress block.");
    }
  }

  const targetsByPhase = preset.schedule.map((scheduleBlock) =>
    Object.entries(scheduleBlock.targetWeights)
      .filter(([, weight]) => weight > 0)
      .map(([nodeId]) => nodeId),
  );
  const positiveTargets = new Set(targetsByPhase.flat());
  for (const entry of entries) {
    for (const targetId of positiveTargets) {
      if (nodes.has(targetId) && !hasDirectedPath(preset.graph, entry.id, targetId)) {
        errors.push(`No directed route from entry ${entry.id} to schedule target ${targetId}.`);
      }
    }
  }

  const firstTargets = targetsByPhase[0] ?? [];
  for (const [sourceId, occupancy] of Object.entries(preset.initialOccupancy)) {
    if (occupancy <= 0 || firstTargets.includes(sourceId)) continue;
    for (const targetId of firstTargets) {
      if (nodes.has(sourceId) && nodes.has(targetId) && !hasDirectedPath(preset.graph, sourceId, targetId)) {
        errors.push(`Initial crowd at ${sourceId} cannot reach first-phase target ${targetId}.`);
      }
    }
  }

  for (let phaseIndex = 0; phaseIndex + 1 < targetsByPhase.length; phaseIndex += 1) {
    const currentTargets = targetsByPhase[phaseIndex]!;
    const nextTargets = targetsByPhase[phaseIndex + 1]!;
    const currentBlock = preset.schedule[phaseIndex]!;
    const nextBlock = preset.schedule[phaseIndex + 1]!;
    for (const sourceId of currentTargets) {
      // The aggregate engine keeps people in place when their current node is
      // itself an active target in the next phase.
      if (nextTargets.includes(sourceId)) continue;
      for (const targetId of nextTargets) {
        if (nodes.has(sourceId) && nodes.has(targetId) && !hasDirectedPath(preset.graph, sourceId, targetId)) {
          errors.push(
            `Schedule transition ${currentBlock.id} -> ${nextBlock.id} cannot route ${sourceId} to ${targetId}.`,
          );
        }
      }
    }
  }

  return errors;
}

export function assertValidVenuePreset(preset: VenuePreset): void {
  const errors = validateVenuePreset(preset);
  if (errors.length > 0) {
    throw new Error(`Invalid venue preset ${preset.id}:\n- ${errors.join("\n- ")}`);
  }
}

export function assertValidSimulationConfig(config: SimulationConfig): void {
  if (!(config.stepSeconds > 0 && config.stepSeconds <= 60)) throw new Error("stepSeconds must be in (0, 60].");
  if (!(config.warningOccupancyRatio > 0 && config.warningOccupancyRatio < 1)) {
    throw new Error("warningOccupancyRatio must be in (0, 1).");
  }
  if (!(config.criticalOccupancyRatio > config.warningOccupancyRatio && config.criticalOccupancyRatio <= 1)) {
    throw new Error("criticalOccupancyRatio must be above warning and at most 1.");
  }
  if (!Number.isInteger(config.persistenceTicks) || config.persistenceTicks < 1) {
    throw new Error("persistenceTicks must be a positive integer.");
  }
  if (!Number.isInteger(config.clearanceTicks) || config.clearanceTicks < 1) {
    throw new Error("clearanceTicks must be a positive integer.");
  }
  if (config.congestionPenaltyAlpha < 0) throw new Error("congestionPenaltyAlpha cannot be negative.");
  if (config.reroutePenaltyMultiplier < 1) throw new Error("reroutePenaltyMultiplier must be at least 1.");
  if (!(config.forecastHorizonMinutes > 0)) throw new Error("forecastHorizonMinutes must be positive.");
  if (!(config.counterfactualHorizonMinutes > 0)) throw new Error("counterfactualHorizonMinutes must be positive.");
  if (!Number.isInteger(config.maxRouteAlternatives) || config.maxRouteAlternatives < 1) {
    throw new Error("maxRouteAlternatives must be a positive integer.");
  }
}
