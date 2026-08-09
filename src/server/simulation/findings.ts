import type { VenuePreset } from "../../shared/types";
import type { FindingBundle } from "../ai/schemas";
import type { BottleneckForecast, RerouteEvaluation, RuntimeSnapshot } from "./model";

export interface FindingContext {
  readonly forecast?: readonly BottleneckForecast[];
  readonly reroutes?: readonly RerouteEvaluation[];
}

/**
 * Lossless deterministic adapter for the AI advisory boundary. The simulator
 * owns all measurements and finding severity; the model receives no authority
 * to manufacture crowd telemetry.
 */
export function toFindingBundle(
  preset: VenuePreset,
  snapshot: RuntimeSnapshot,
  context: FindingContext = {},
): FindingBundle {
  if (snapshot.scenarioId !== preset.id) {
    throw new Error(`Snapshot scenario ${snapshot.scenarioId} does not match preset ${preset.id}.`);
  }

  const activeSchedule = preset.schedule.find((block) => block.id === snapshot.activeScheduleBlockId);
  const nodeCapacityById = new Map(
    preset.graph.nodes.map((venueNode) => [venueNode.id, venueNode.capacityPeople]),
  );
  const outsideQueuePressure = (
    locationType: "node" | "edge",
    locationId: string,
    outsideQueuePeople: number,
  ): number => {
    if (locationType !== "node") return 0;
    const capacityPeople = nodeCapacityById.get(locationId);
    return capacityPeople ? Math.min(1, outsideQueuePeople / capacityPeople) : 0;
  };
  const incomingByNode = new Map<string, string[]>();
  for (const edge of preset.graph.edges) {
    incomingByNode.set(edge.target, [...(incomingByNode.get(edge.target) ?? []), edge.id]);
  }

  const evidence: FindingBundle["evidence"] = [];
  const findings: FindingBundle["findings"] = snapshot.bottlenecks.map((bottleneck, index) => {
    const sequence = String(index + 1).padStart(3, "0");
    const nodeIds = bottleneck.locationType === "node" ? [bottleneck.locationId] : [];
    const edgeIds = bottleneck.locationType === "edge" ? [bottleneck.locationId] : [];
    const evidenceIds: string[] = [];

    const densityEvidenceId = `evidence_density_${sequence}`;
    evidence.push({
      id: densityEvidenceId,
      kind: "density",
      summary: `${bottleneck.label} physical occupancy is ${(bottleneck.occupancyRatio * 100).toFixed(1)}% of modeled safe storage, with ${bottleneck.inflowPeoplePerMinute.toFixed(1)} in/min and ${bottleneck.outflowPeoplePerMinute.toFixed(1)} out/min.`,
      nodeIds: [...nodeIds],
      edgeIds: [...edgeIds],
      value: bottleneck.occupancyRatio,
      unit: "occupancy_ratio",
    });
    evidenceIds.push(densityEvidenceId);

    if (bottleneck.outsideQueuePeople > 0) {
      const queueEvidenceId = `evidence_queue_${sequence}`;
      const queuePressureRatio = outsideQueuePressure(
        bottleneck.locationType,
        bottleneck.locationId,
        bottleneck.outsideQueuePeople,
      );
      evidence.push({
        id: queueEvidenceId,
        kind: "queue",
        summary: `${bottleneck.outsideQueuePeople.toFixed(1)} people are waiting outside ${bottleneck.label}: ${(queuePressureRatio * 100).toFixed(1)}% normalized outside-queue pressure and ${(bottleneck.pressureRatio * 100).toFixed(1)}% detector pressure, without counting them as physical occupancy.`,
        nodeIds: [...nodeIds],
        edgeIds: [...edgeIds],
        value: bottleneck.outsideQueuePeople,
        unit: "people",
      });
      evidenceIds.push(queueEvidenceId);
    }

    if (activeSchedule) {
      const scheduleEvidenceId = `evidence_schedule_${sequence}`;
      const scheduleNodeIds = Object.keys(activeSchedule.targetWeights).filter((id) =>
        preset.graph.nodes.some((node) => node.id === id));
      evidence.push({
        id: scheduleEvidenceId,
        kind: "schedule",
        summary: `Active phase "${activeSchedule.label}" runs from minute ${activeSchedule.startMinute} to ${activeSchedule.endMinute} with ${activeSchedule.arrivalRatePerMinute} arrivals/min.`,
        nodeIds: scheduleNodeIds,
        edgeIds: [],
        value: activeSchedule.arrivalRatePerMinute,
        unit: "people_per_minute",
      });
      evidenceIds.push(scheduleEvidenceId);
      nodeIds.push(...scheduleNodeIds);
    }

    const matchingForecast = context.forecast?.find((forecast) =>
      forecast.locationType === bottleneck.locationType && forecast.locationId === bottleneck.locationId);
    if (matchingForecast) {
      const forecastEvidenceId = `evidence_forecast_${sequence}`;
      const isQueueForecast =
        matchingForecast.reason === "gate_imbalance" ||
        matchingForecast.predictedPeakOutsideQueuePeople > 0;
      const queuePressureRatio = outsideQueuePressure(
        matchingForecast.locationType,
        matchingForecast.locationId,
        matchingForecast.predictedPeakOutsideQueuePeople,
      );
      evidence.push({
        id: forecastEvidenceId,
        kind: isQueueForecast ? "queue" : "density",
        summary: isQueueForecast
          ? `Forecast: ${(matchingForecast.predictedPeakOccupancyRatio * 100).toFixed(1)}% peak physical occupancy, up to ${matchingForecast.predictedPeakOutsideQueuePeople.toFixed(1)} waiting outside (${(queuePressureRatio * 100).toFixed(1)}% queue pressure), and ${(matchingForecast.predictedPeakPressureRatio * 100).toFixed(1)}% detector pressure at minute ${matchingForecast.predictedOnsetMinute.toFixed(1)}.`
          : `Deterministic forecast predicts ${(matchingForecast.predictedPeakOccupancyRatio * 100).toFixed(1)}% peak physical occupancy at minute ${matchingForecast.predictedOnsetMinute.toFixed(1)} (confidence ${(matchingForecast.confidence * 100).toFixed(0)}%).`,
        nodeIds: [...(matchingForecast.locationType === "node" ? [matchingForecast.locationId] : [])],
        edgeIds: [...(matchingForecast.locationType === "edge" ? [matchingForecast.locationId] : [])],
        value: isQueueForecast
          ? matchingForecast.predictedPeakOutsideQueuePeople
          : matchingForecast.predictedPeakOccupancyRatio,
        unit: isQueueForecast ? "people" : "occupancy_ratio",
      });
      evidenceIds.push(forecastEvidenceId);
    }

    const relatedRecommendation = snapshot.routes.find((route) => {
      if (!route.primary) return false;
      const primaryTraversesBottleneck = bottleneck.locationType === "edge"
        ? route.primary.edgeIds.includes(bottleneck.locationId)
        : route.primary.nodeIds.includes(bottleneck.locationId);
      return primaryTraversesBottleneck && route.alternatives.some((path) =>
        bottleneck.locationType === "edge"
          ? !path.edgeIds.includes(bottleneck.locationId)
          : !path.nodeIds.includes(bottleneck.locationId));
    });
    const relatedPrimary = relatedRecommendation?.primary;
    const relatedRoute = relatedRecommendation?.alternatives.find((path) =>
      bottleneck.locationType === "edge"
        ? !path.edgeIds.includes(bottleneck.locationId)
        : !path.nodeIds.includes(bottleneck.locationId));
    if (relatedRecommendation && relatedPrimary && relatedRoute) {
      const routeEvidenceId = `evidence_route_${sequence}`;
      const routeNodes = [...new Set([
        relatedRecommendation.originNodeId,
        relatedRecommendation.targetNodeId,
        ...relatedPrimary.nodeIds.slice(0, 8),
        ...relatedRoute.nodeIds.slice(0, 16),
      ])].slice(0, 32);
      const routeEdges = [...new Set([
        ...(bottleneck.locationType === "edge" ? [bottleneck.locationId] : []),
        ...relatedPrimary.edgeIds.slice(0, 8),
        ...relatedRoute.edgeIds.slice(0, 16),
      ])].slice(0, 32);
      evidence.push({
        id: routeEvidenceId,
        kind: "connectivity",
        summary: `OD ${relatedRecommendation.originNodeId} to ${relatedRecommendation.targetNodeId}: the primary crosses this finding; a same-OD alternative avoids it (${relatedRoute.costMinutes.toFixed(2)} vs ${relatedPrimary.costMinutes.toFixed(2)} min).`,
        nodeIds: routeNodes,
        edgeIds: routeEdges,
        value: relatedRoute.costMinutes,
        unit: "minutes",
      });
      evidenceIds.push(routeEvidenceId);
      nodeIds.push(...relatedRoute.nodeIds.slice(0, 16));
      edgeIds.push(...routeEdges);
    }

    const relatedReroute = context.reroutes?.find((evaluation) => {
      const relevantEdges = bottleneck.locationType === "edge"
        ? [bottleneck.locationId]
        : incomingByNode.get(bottleneck.locationId) ?? [];
      return evaluation.policy.avoidEdgeIds.some((id) => relevantEdges.includes(id));
    });
    if (relatedReroute) {
      const counterfactualEvidenceId = `evidence_counterfactual_${sequence}`;
      evidence.push({
        id: counterfactualEvidenceId,
        kind: "flow",
        summary: `Counterfactual ${relatedReroute.policy.label}: peak ratio delta ${(relatedReroute.metrics.peakOccupancyRatioDelta * 100).toFixed(1)} points, congestion exposure delta ${relatedReroute.metrics.congestionExposureDeltaPersonMinutes.toFixed(1)} person-minutes, exited crowd delta ${relatedReroute.metrics.exitedPeopleDelta.toFixed(1)}.`,
        nodeIds: [],
        edgeIds: [...relatedReroute.policy.avoidEdgeIds],
        value: relatedReroute.metrics.congestionExposureDeltaPersonMinutes,
        unit: "person_minutes_delta",
      });
      evidenceIds.push(counterfactualEvidenceId);
      edgeIds.push(...relatedReroute.policy.avoidEdgeIds);
    }

    return {
      id: `finding_${sequence}`,
      kind: bottleneck.reason,
      severity: bottleneck.severity,
      summary: `${bottleneck.label}: ${bottleneck.reason.replaceAll("_", " ")} persisted for ${bottleneck.durationMinutes.toFixed(1)} min.`,
      nodeIds: [...new Set(nodeIds)].sort(),
      edgeIds: [...new Set(edgeIds)].sort(),
      evidenceIds,
      predictedInSeconds: matchingForecast ? matchingForecast.leadTimeMinutes * 60 : null,
    };
  });

  const activeLocationKeys = new Set(
    snapshot.bottlenecks.map((bottleneck) => `${bottleneck.locationType}:${bottleneck.locationId}`),
  );
  const forecastOnly = [...(context.forecast ?? [])]
    .filter((forecast) => !activeLocationKeys.has(`${forecast.locationType}:${forecast.locationId}`))
    .sort(
      (left, right) =>
        left.predictedOnsetMinute - right.predictedOnsetMinute ||
        left.locationId.localeCompare(right.locationId),
    );

  for (const forecast of forecastOnly) {
    const sequence = String(findings.length + 1).padStart(3, "0");
    const nodeIds = forecast.locationType === "node" ? [forecast.locationId] : [];
    const edgeIds = forecast.locationType === "edge" ? [forecast.locationId] : [];
    const evidenceIds: string[] = [];
    const isQueueForecast =
      forecast.reason === "gate_imbalance" || forecast.predictedPeakOutsideQueuePeople > 0;
    const queuePressureRatio = outsideQueuePressure(
      forecast.locationType,
      forecast.locationId,
      forecast.predictedPeakOutsideQueuePeople,
    );
    const forecastEvidenceId = isQueueForecast
      ? `evidence_predicted_queue_${sequence}`
      : `evidence_predicted_density_${sequence}`;
    evidence.push({
      id: forecastEvidenceId,
      kind: isQueueForecast ? "queue" : "density",
      summary: isQueueForecast
        ? `${forecast.label}: forecast ${(forecast.predictedPeakOccupancyRatio * 100).toFixed(1)}% peak physical occupancy, up to ${forecast.predictedPeakOutsideQueuePeople.toFixed(1)} waiting outside (${(queuePressureRatio * 100).toFixed(1)}% queue pressure), and ${(forecast.predictedPeakPressureRatio * 100).toFixed(1)}% detector pressure at minute ${forecast.predictedOnsetMinute.toFixed(1)}.`
        : `${forecast.label} is forecast to reach ${(forecast.predictedPeakOccupancyRatio * 100).toFixed(1)}% of modeled safe storage at minute ${forecast.predictedOnsetMinute.toFixed(1)}.`,
      nodeIds: [...nodeIds],
      edgeIds: [...edgeIds],
      value: isQueueForecast
        ? forecast.predictedPeakOutsideQueuePeople
        : forecast.predictedPeakOccupancyRatio,
      unit: isQueueForecast ? "people" : "occupancy_ratio",
    });
    evidenceIds.push(forecastEvidenceId);

    const predictedSchedule = preset.schedule.find(
      (scheduleBlock) =>
        forecast.predictedOnsetMinute >= scheduleBlock.startMinute &&
        forecast.predictedOnsetMinute < scheduleBlock.endMinute,
    );
    if (predictedSchedule) {
      const scheduleEvidenceId = `evidence_predicted_schedule_${sequence}`;
      evidence.push({
        id: scheduleEvidenceId,
        kind: "schedule",
        summary: `Predicted onset falls in phase "${predictedSchedule.label}" (${predictedSchedule.startMinute}-${predictedSchedule.endMinute} min) with ${predictedSchedule.arrivalRatePerMinute.toFixed(1)} arrivals/min.`,
        nodeIds: Object.keys(predictedSchedule.targetWeights)
          .filter((nodeId) => preset.graph.nodes.some((venueNode) => venueNode.id === nodeId))
          .sort(),
        edgeIds: [],
        value: forecast.leadTimeMinutes,
        unit: "minutes_to_onset",
      });
      evidenceIds.push(scheduleEvidenceId);
    }

    findings.push({
      id: `finding_forecast_${sequence}`,
      kind: "schedule_spike",
      severity: forecast.severity,
      summary: `${forecast.label}: predicted ${forecast.severity} crowding in ${forecast.leadTimeMinutes.toFixed(1)} min, lasting about ${forecast.predictedDurationMinutes.toFixed(1)} min.`,
      nodeIds,
      edgeIds,
      evidenceIds,
      predictedInSeconds: forecast.leadTimeMinutes * 60,
    });
  }

  return {
    schemaVersion: "1",
    scenarioId: preset.id,
    simulationTimeSeconds: snapshot.simulationTimeMinute * 60,
    nodeIds: preset.graph.nodes.map((venueNode) => venueNode.id).sort(),
    edgeIds: preset.graph.edges.map((edge) => edge.id).sort(),
    evidence,
    findings,
  };
}
