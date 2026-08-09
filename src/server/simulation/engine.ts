import {
  isEntryNode,
  isExitNode,
  type ScheduleBlock,
  type VenueEdge,
  type VenueNode,
  type VenuePreset,
} from "../../shared/types";
import { PersistentBottleneckDetector, type BottleneckSample } from "./bottlenecks";
import {
  DEFAULT_SIMULATION_CONFIG,
  type Bottleneck,
  type BottleneckForecast,
  type CounterfactualMetrics,
  type RerouteEvaluation,
  type ReroutePolicy,
  type RouteRecommendation,
  type RuntimeSnapshot,
  type SimulationConfig,
  type SimulationInvariants,
  type SimulationMetrics,
} from "./model";
import { computeAlternativePaths, computeShortestPath } from "./routing";
import { assertValidSimulationConfig, assertValidVenuePreset } from "./validation";

const EPSILON = 1e-8;

interface MutableNodeState {
  occupancyPeople: number;
  inflowThisTick: number;
  outflowThisTick: number;
}

interface EdgeCohort {
  amountPeople: number;
  remainingSeconds: number;
}

interface MutableEdgeState {
  cohorts: EdgeCohort[];
  inflowThisTick: number;
  outflowThisTick: number;
}

const sum = (values: Iterable<number>): number => {
  let total = 0;
  for (const value of values) total += value;
  return total;
};

const normalizedEntries = (
  weights: Readonly<Record<string, number>>,
): readonly (readonly [string, number])[] => {
  const positive = Object.entries(weights).filter(([, weight]) => weight > 0);
  const total = positive.reduce((accumulator, [, weight]) => accumulator + weight, 0);
  if (total <= 0) return [];
  return positive
    .map(([id, weight]) => [id, weight / total] as const)
    .sort(([left], [right]) => left.localeCompare(right));
};

const severityRank = (severity: "watch" | "warning" | "critical"): number =>
  severity === "critical" ? 2 : severity === "warning" ? 1 : 0;

export class SimulationEngine {
  public readonly preset: VenuePreset;
  public readonly config: SimulationConfig;

  private readonly nodeById: ReadonlyMap<string, VenueNode>;
  private readonly edgeById: ReadonlyMap<string, VenueEdge>;
  private readonly incomingByNode: ReadonlyMap<string, readonly VenueEdge[]>;
  private readonly nodeStates = new Map<string, MutableNodeState>();
  private readonly edgeStates = new Map<string, MutableEdgeState>();
  private readonly outsideQueues = new Map<string, number>();
  private detector: PersistentBottleneckDetector;
  private activePolicies: ReroutePolicy[] = [];
  private activeBottlenecks: readonly Bottleneck[] = [];
  private simulationTimeMinute = 0;
  private tick = 0;
  private generatedPeople = 0;
  private admittedPeople = 0;
  private exitedPeople = 0;
  private peakOccupancyRatio = 0;
  private congestionExposurePersonMinutes = 0;

  public constructor(preset: VenuePreset, config: Partial<SimulationConfig> = {}) {
    this.preset = preset;
    this.config = { ...DEFAULT_SIMULATION_CONFIG, ...config };
    assertValidVenuePreset(preset);
    assertValidSimulationConfig(this.config);

    this.nodeById = new Map(preset.graph.nodes.map((venueNode) => [venueNode.id, venueNode]));
    this.edgeById = new Map(preset.graph.edges.map((edge) => [edge.id, edge]));
    const incoming = new Map<string, VenueEdge[]>();
    for (const edge of preset.graph.edges) {
      const values = incoming.get(edge.target) ?? [];
      values.push(edge);
      incoming.set(edge.target, values);
    }
    for (const values of incoming.values()) values.sort((a, b) => a.id.localeCompare(b.id));
    this.incomingByNode = incoming;

    for (const venueNode of preset.graph.nodes) {
      const occupancy = preset.initialOccupancy[venueNode.id] ?? 0;
      this.nodeStates.set(venueNode.id, {
        occupancyPeople: occupancy,
        inflowThisTick: 0,
        outflowThisTick: 0,
      });
      if (isEntryNode(venueNode)) this.outsideQueues.set(venueNode.id, 0);
      this.generatedPeople += occupancy;
      this.admittedPeople += occupancy;
      this.peakOccupancyRatio = Math.max(this.peakOccupancyRatio, occupancy / venueNode.capacityPeople);
    }
    for (const edge of preset.graph.edges) {
      this.edgeStates.set(edge.id, { cohorts: [], inflowThisTick: 0, outflowThisTick: 0 });
    }
    this.detector = new PersistentBottleneckDetector(this.config);
  }

  public getSnapshot(): RuntimeSnapshot {
    const stepMinutes = this.config.stepSeconds / 60;
    const nodes = Object.fromEntries(
      this.preset.graph.nodes.map((venueNode) => {
        const state = this.nodeStates.get(venueNode.id)!;
        return [
          venueNode.id,
          {
            occupancyPeople: state.occupancyPeople,
            occupancyRatio: state.occupancyPeople / venueNode.capacityPeople,
            inflowPeoplePerMinute: state.inflowThisTick / stepMinutes,
            outflowPeoplePerMinute: state.outflowThisTick / stepMinutes,
          },
        ];
      }),
    );
    const edges = Object.fromEntries(
      this.preset.graph.edges.map((edge) => {
        const state = this.edgeStates.get(edge.id)!;
        const occupancy = this.edgeOccupancy(state);
        const ratio = occupancy / edge.capacityPeople;
        return [
          edge.id,
          {
            occupancyPeople: occupancy,
            occupancyRatio: ratio,
            inflowPeoplePerMinute: state.inflowThisTick / stepMinutes,
            outflowPeoplePerMinute: state.outflowThisTick / stepMinutes,
            speedFactor: this.edgeSpeedFactor(edge, state),
          },
        ];
      }),
    );
    const outsideQueues = Object.fromEntries(
      [...this.outsideQueues.entries()].sort(([left], [right]) => left.localeCompare(right)),
    );
    const metrics = this.computeMetrics();
    return {
      scenarioId: this.preset.id,
      tick: this.tick,
      simulationTimeMinute: this.simulationTimeMinute,
      activeScheduleBlockId: this.activeScheduleBlock()?.id ?? null,
      nodes,
      edges,
      outsideQueues,
      bottlenecks: this.activeBottlenecks,
      routes: this.buildRouteRecommendations(),
      activeReroutePolicyIds: this.activePolicies.map((policy) => policy.id),
      metrics,
      invariants: this.computeInvariants(metrics),
    };
  }

  public step(steps = 1): RuntimeSnapshot {
    if (!Number.isInteger(steps) || steps < 1) throw new Error("steps must be a positive integer.");
    for (let index = 0; index < steps; index += 1) this.advanceOneTick();
    return this.getSnapshot();
  }

  /** Returns the first fixed-step snapshot at or after targetMinute. */
  public runUntil(targetMinute: number): RuntimeSnapshot {
    if (!Number.isFinite(targetMinute) || targetMinute < this.simulationTimeMinute - EPSILON) {
      throw new Error("targetMinute cannot be before the current simulation time.");
    }
    while (this.simulationTimeMinute + EPSILON < targetMinute) this.advanceOneTick();
    return this.getSnapshot();
  }

  public applyReroute(policy: ReroutePolicy): RuntimeSnapshot {
    if (!policy.id.trim()) throw new Error("Reroute policy id is required.");
    if (policy.avoidEdgeIds.length === 0 && (policy.preferEdgeIds?.length ?? 0) === 0) {
      throw new Error("A reroute policy must avoid or prefer at least one edge.");
    }
    for (const edgeId of [...policy.avoidEdgeIds, ...(policy.preferEdgeIds ?? [])]) {
      if (!this.edgeById.has(edgeId)) throw new Error(`Reroute policy references unknown edge ${edgeId}.`);
    }
    if (policy.compliance !== undefined && (policy.compliance < 0 || policy.compliance > 1)) {
      throw new Error("Reroute policy compliance must be in [0, 1].");
    }
    if (policy.penaltyMultiplier !== undefined && policy.penaltyMultiplier < 1) {
      throw new Error("Reroute policy penaltyMultiplier must be at least 1.");
    }
    const normalized: ReroutePolicy = {
      ...policy,
      avoidEdgeIds: [...new Set(policy.avoidEdgeIds)].sort(),
      ...(policy.preferEdgeIds
        ? { preferEdgeIds: [...new Set(policy.preferEdgeIds)].sort() }
        : {}),
    };
    this.activePolicies = [
      ...this.activePolicies.filter((active) => active.id !== normalized.id),
      normalized,
    ].sort((a, b) => a.id.localeCompare(b.id));
    return this.getSnapshot();
  }

  public removeReroute(policyId: string): RuntimeSnapshot {
    this.activePolicies = this.activePolicies.filter((policy) => policy.id !== policyId);
    return this.getSnapshot();
  }

  public forecast(horizonMinutes = this.config.forecastHorizonMinutes): readonly BottleneckForecast[] {
    if (!(horizonMinutes > 0)) throw new Error("Forecast horizon must be positive.");
    const baselineMinute = this.simulationTimeMinute;
    const simulated = this.clone();
    const records = new Map<
      string,
      {
        bottleneck: Bottleneck;
        onset: number;
        duration: number;
        peakOccupancy: number;
        peakPressure: number;
        peakOutsideQueue: number;
        reason: Bottleneck["reason"];
        severity: Bottleneck["severity"];
      }
    >();
    const stepMinutes = this.config.stepSeconds / 60;

    const recordSnapshot = (snapshot: RuntimeSnapshot): void => {
      for (const bottleneck of snapshot.bottlenecks) {
        const existing = records.get(bottleneck.id);
        if (!existing) {
          records.set(bottleneck.id, {
            bottleneck,
            onset: snapshot.simulationTimeMinute,
            duration: stepMinutes,
            peakOccupancy: bottleneck.occupancyRatio,
            peakPressure: bottleneck.pressureRatio,
            peakOutsideQueue: bottleneck.outsideQueuePeople,
            reason: bottleneck.reason,
            severity: bottleneck.severity,
          });
        } else {
          existing.duration += stepMinutes;
          existing.peakOccupancy = Math.max(existing.peakOccupancy, bottleneck.occupancyRatio);
          existing.peakOutsideQueue = Math.max(
            existing.peakOutsideQueue,
            bottleneck.outsideQueuePeople,
          );
          if (bottleneck.pressureRatio > existing.peakPressure + EPSILON) {
            existing.peakPressure = bottleneck.pressureRatio;
            existing.reason = bottleneck.reason;
          }
          if (severityRank(bottleneck.severity) > severityRank(existing.severity)) {
            existing.severity = bottleneck.severity;
            existing.reason = bottleneck.reason;
          }
        }
      }
    };

    recordSnapshot(simulated.getSnapshot());
    const steps = Math.ceil((horizonMinutes * 60) / this.config.stepSeconds);
    for (let index = 0; index < steps; index += 1) recordSnapshot(simulated.step());

    return [...records.values()]
      .map((record): BottleneckForecast => {
        const leadTimeMinutes = Math.max(0, record.onset - baselineMinute);
        return {
          id: `forecast:${record.bottleneck.id}`,
          locationType: record.bottleneck.locationType,
          locationId: record.bottleneck.locationId,
          label: record.bottleneck.label,
          predictedOnsetMinute: record.onset,
          leadTimeMinutes,
          predictedDurationMinutes: record.duration,
          predictedPeakOccupancyRatio: record.peakOccupancy,
          predictedPeakPressureRatio: record.peakPressure,
          predictedPeakOutsideQueuePeople: record.peakOutsideQueue,
          reason: record.reason,
          severity: record.severity,
          confidence: leadTimeMinutes === 0
            ? 0.99
            : Math.max(0.55, 0.95 - 0.4 * (leadTimeMinutes / horizonMinutes)),
        };
      })
      .sort(
        (a, b) =>
          a.predictedOnsetMinute - b.predictedOnsetMinute ||
          severityRank(b.severity) - severityRank(a.severity) ||
          a.id.localeCompare(b.id),
      );
  }

  public evaluateReroute(
    policy: ReroutePolicy,
    horizonMinutes = this.config.counterfactualHorizonMinutes,
  ): RerouteEvaluation {
    if (!(horizonMinutes > 0)) throw new Error("Counterfactual horizon must be positive.");
    const baseline = this.clone();
    const rerouted = this.clone();
    rerouted.applyReroute(policy);
    const steps = Math.ceil((horizonMinutes * 60) / this.config.stepSeconds);
    baseline.step(steps);
    rerouted.step(steps);
    const baselineMetrics = baseline.computeMetrics();
    const reroutedMetrics = rerouted.computeMetrics();
    const metrics: CounterfactualMetrics = {
      horizonMinutes,
      baseline: baselineMetrics,
      rerouted: reroutedMetrics,
      peakOccupancyRatioDelta: reroutedMetrics.peakOccupancyRatio - baselineMetrics.peakOccupancyRatio,
      congestionExposureDeltaPersonMinutes:
        reroutedMetrics.congestionExposurePersonMinutes - baselineMetrics.congestionExposurePersonMinutes,
      exitedPeopleDelta: reroutedMetrics.exitedPeople - baselineMetrics.exitedPeople,
      recommended:
        reroutedMetrics.peakOccupancyRatio <= baselineMetrics.peakOccupancyRatio + 0.02 &&
        (reroutedMetrics.congestionExposurePersonMinutes <
          baselineMetrics.congestionExposurePersonMinutes - EPSILON ||
          reroutedMetrics.exitedPeople > baselineMetrics.exitedPeople + EPSILON),
    };
    return { policy, metrics };
  }

  public evaluateReroutes(
    horizonMinutes = this.config.counterfactualHorizonMinutes,
  ): readonly RerouteEvaluation[] {
    const snapshot = this.getSnapshot();
    const congestedLocations = snapshot.bottlenecks.length > 0
      ? snapshot.bottlenecks
      : this.forecast(Math.min(horizonMinutes, this.config.forecastHorizonMinutes));
    const candidateEdgeIds = new Set<string>();
    for (const location of congestedLocations) {
      if (location.locationType === "edge") {
        candidateEdgeIds.add(location.locationId);
      } else {
        const incoming = this.incomingByNode.get(location.locationId) ?? [];
        const mostOccupied = [...incoming].sort(
          (a, b) =>
            this.edgeOccupancy(this.edgeStates.get(b.id)!) / b.capacityPeople -
              this.edgeOccupancy(this.edgeStates.get(a.id)!) / a.capacityPeople ||
            a.id.localeCompare(b.id),
        )[0];
        if (mostOccupied) candidateEdgeIds.add(mostOccupied.id);
      }
      if (candidateEdgeIds.size >= this.config.maxRouteAlternatives) break;
    }

    return [...candidateEdgeIds]
      .sort()
      .map((edgeId) =>
        this.evaluateReroute(
          {
            id: `avoid:${edgeId}`,
            label: `Divert flow away from ${this.edgeById.get(edgeId)?.id ?? edgeId}`,
            avoidEdgeIds: [edgeId],
            penaltyMultiplier: this.config.reroutePenaltyMultiplier,
          },
          horizonMinutes,
        ),
      )
      .sort(
        (a, b) =>
          Number(b.metrics.recommended) - Number(a.metrics.recommended) ||
          a.metrics.congestionExposureDeltaPersonMinutes - b.metrics.congestionExposureDeltaPersonMinutes ||
          b.metrics.exitedPeopleDelta - a.metrics.exitedPeopleDelta ||
          a.policy.id.localeCompare(b.policy.id),
      );
  }

  private advanceOneTick(): void {
    const stepMinutes = this.config.stepSeconds / 60;
    for (const state of this.nodeStates.values()) {
      state.inflowThisTick = 0;
      state.outflowThisTick = 0;
    }
    for (const state of this.edgeStates.values()) {
      state.inflowThisTick = 0;
      state.outflowThisTick = 0;
    }

    this.dischargeExits(stepMinutes);
    this.advanceEdges(stepMinutes);
    const scheduleBlock = this.activeScheduleBlock();
    if (scheduleBlock) {
      this.generateDemand(scheduleBlock, stepMinutes);
      this.admitOutsideQueues(stepMinutes);
      this.routeNodeOccupancy(scheduleBlock, stepMinutes);
    }

    this.tick += 1;
    this.simulationTimeMinute = this.tick * stepMinutes;
    this.updateIntegratedMetrics(stepMinutes);
    this.activeBottlenecks = this.detector.update(this.buildBottleneckSamples(stepMinutes), this.simulationTimeMinute);
  }

  private dischargeExits(stepMinutes: number): void {
    for (const venueNode of this.preset.graph.nodes) {
      if (!isExitNode(venueNode)) continue;
      const state = this.nodeStates.get(venueNode.id)!;
      const discharged = Math.min(state.occupancyPeople, venueNode.maxThroughputPerMinute * stepMinutes);
      state.occupancyPeople -= discharged;
      state.outflowThisTick += discharged;
      this.exitedPeople += discharged;
    }
  }

  private advanceEdges(stepMinutes: number): void {
    for (const edge of [...this.preset.graph.edges].sort((a, b) => a.id.localeCompare(b.id))) {
      const edgeState = this.edgeStates.get(edge.id)!;
      const speedFactor = this.edgeSpeedFactor(edge, edgeState);
      for (const cohort of edgeState.cohorts) {
        cohort.remainingSeconds -= this.config.stepSeconds * speedFactor;
      }
      const target = this.nodeById.get(edge.target)!;
      const targetState = this.nodeStates.get(edge.target)!;
      let transferLimit = Math.min(
        edge.maxFlowPerMinute * stepMinutes,
        Math.max(0, target.capacityPeople - targetState.occupancyPeople),
        Math.max(0, target.maxThroughputPerMinute * stepMinutes - targetState.inflowThisTick),
      );
      for (const cohort of edgeState.cohorts) {
        if (transferLimit <= EPSILON || cohort.remainingSeconds > EPSILON) continue;
        const transferred = Math.min(cohort.amountPeople, transferLimit);
        cohort.amountPeople -= transferred;
        transferLimit -= transferred;
        edgeState.outflowThisTick += transferred;
        targetState.occupancyPeople += transferred;
        targetState.inflowThisTick += transferred;
      }
      edgeState.cohorts = edgeState.cohorts.filter((cohort) => cohort.amountPeople > EPSILON);
    }
  }

  private generateDemand(scheduleBlock: ScheduleBlock, stepMinutes: number): void {
    const remainingDemand = Math.max(0, this.preset.crowdSize - this.generatedPeople);
    const generated = Math.min(remainingDemand, scheduleBlock.arrivalRatePerMinute * stepMinutes);
    if (generated <= EPSILON) return;
    for (const [entryId, weight] of normalizedEntries(scheduleBlock.entryWeights)) {
      this.outsideQueues.set(entryId, (this.outsideQueues.get(entryId) ?? 0) + generated * weight);
    }
    this.generatedPeople += generated;
  }

  private admitOutsideQueues(stepMinutes: number): void {
    for (const [entryId, queued] of [...this.outsideQueues.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (queued <= EPSILON) continue;
      const entry = this.nodeById.get(entryId)!;
      const state = this.nodeStates.get(entryId)!;
      const admitted = Math.min(
        queued,
        Math.max(0, entry.capacityPeople - state.occupancyPeople),
        Math.max(0, entry.maxThroughputPerMinute * stepMinutes - state.inflowThisTick),
      );
      state.occupancyPeople += admitted;
      state.inflowThisTick += admitted;
      this.outsideQueues.set(entryId, queued - admitted);
      this.admittedPeople += admitted;
    }
  }

  private routeNodeOccupancy(scheduleBlock: ScheduleBlock, stepMinutes: number): void {
    const targets = normalizedEntries(scheduleBlock.targetWeights);
    const edgeRatios = Object.fromEntries(
      this.preset.graph.edges.map((edge) => [
        edge.id,
        this.edgeOccupancy(this.edgeStates.get(edge.id)!) / edge.capacityPeople,
      ]),
    );
    const policyCompliance = this.activePolicies.length === 0
      ? scheduleBlock.rerouteCompliance
      : Math.max(
          scheduleBlock.rerouteCompliance,
          ...this.activePolicies.map((policy) => policy.compliance ?? scheduleBlock.rerouteCompliance),
        );

    for (const venueNode of [...this.preset.graph.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
      if (isExitNode(venueNode) || (scheduleBlock.targetWeights[venueNode.id] ?? 0) > 0) continue;
      const state = this.nodeStates.get(venueNode.id)!;
      const movable = Math.min(state.occupancyPeople, venueNode.maxThroughputPerMinute * stepMinutes);
      if (movable <= EPSILON) continue;

      const requestedByEdge = new Map<string, number>();
      for (const [targetId, targetWeight] of targets) {
        const targetAmount = movable * targetWeight;
        const dynamicPath = computeShortestPath(this.preset.graph, venueNode.id, targetId, {
          edgeOccupancyRatios: edgeRatios,
          congestionPenaltyAlpha: this.config.congestionPenaltyAlpha,
          policies: this.activePolicies,
          policyCompliance: 1,
        });
        const habitualPath = computeShortestPath(this.preset.graph, venueNode.id, targetId);
        const dynamicAmount = targetAmount * policyCompliance;
        const habitualAmount = targetAmount - dynamicAmount;
        const dynamicFirstEdge = dynamicPath?.edgeIds[0];
        const habitualFirstEdge = habitualPath?.edgeIds[0];
        if (dynamicFirstEdge) {
          requestedByEdge.set(dynamicFirstEdge, (requestedByEdge.get(dynamicFirstEdge) ?? 0) + dynamicAmount);
        }
        if (habitualFirstEdge) {
          requestedByEdge.set(habitualFirstEdge, (requestedByEdge.get(habitualFirstEdge) ?? 0) + habitualAmount);
        }
      }

      for (const [edgeId, requested] of [...requestedByEdge.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        if (requested <= EPSILON || state.occupancyPeople <= EPSILON) continue;
        const edge = this.edgeById.get(edgeId)!;
        const edgeState = this.edgeStates.get(edgeId)!;
        const storageAvailable = Math.max(0, edge.capacityPeople - this.edgeOccupancy(edgeState));
        const inflowAvailable = Math.max(0, edge.maxFlowPerMinute * stepMinutes - edgeState.inflowThisTick);
        const transferred = Math.min(requested, state.occupancyPeople, storageAvailable, inflowAvailable);
        if (transferred <= EPSILON) continue;
        state.occupancyPeople -= transferred;
        state.outflowThisTick += transferred;
        edgeState.inflowThisTick += transferred;
        edgeState.cohorts.push({
          amountPeople: transferred,
          remainingSeconds: Math.max(
            this.config.stepSeconds,
            edge.lengthMeters / edge.freeSpeedMps,
          ),
        });
      }
    }
  }

  private buildBottleneckSamples(stepMinutes: number): readonly BottleneckSample[] {
    const samples: BottleneckSample[] = [];
    for (const venueNode of this.preset.graph.nodes) {
      const state = this.nodeStates.get(venueNode.id)!;
      const occupancyRatio = state.occupancyPeople / venueNode.capacityPeople;
      const outsideQueue = this.outsideQueues.get(venueNode.id) ?? 0;
      const pressureRatio = Math.max(
        occupancyRatio,
        Math.min(1, outsideQueue / venueNode.capacityPeople),
      );
      samples.push({
        locationType: "node",
        locationId: venueNode.id,
        label: venueNode.label,
        occupancyRatio,
        pressureRatio,
        outsideQueuePeople: outsideQueue,
        inflowPeoplePerMinute: state.inflowThisTick / stepMinutes,
        outflowPeoplePerMinute: state.outflowThisTick / stepMinutes,
        ...(outsideQueue > EPSILON ? { reasonHint: "gate_imbalance" as const } : {}),
      });
    }
    for (const edge of this.preset.graph.edges) {
      const state = this.edgeStates.get(edge.id)!;
      samples.push({
        locationType: "edge",
        locationId: edge.id,
        label: `${this.nodeById.get(edge.source)!.label} → ${this.nodeById.get(edge.target)!.label}`,
        occupancyRatio: this.edgeOccupancy(state) / edge.capacityPeople,
        inflowPeoplePerMinute: state.inflowThisTick / stepMinutes,
        outflowPeoplePerMinute: state.outflowThisTick / stepMinutes,
      });
    }
    return samples;
  }

  private buildRouteRecommendations(): readonly RouteRecommendation[] {
    const scheduleBlock = this.activeScheduleBlock();
    if (!scheduleBlock) return [];
    const targets = normalizedEntries(scheduleBlock.targetWeights).map(([id]) => id);
    let origins = normalizedEntries(scheduleBlock.entryWeights).map(([id]) => id);
    if (origins.length === 0) {
      origins = this.preset.graph.nodes
        .filter(
          (venueNode) =>
            !isExitNode(venueNode) &&
            (scheduleBlock.targetWeights[venueNode.id] ?? 0) === 0 &&
            this.nodeStates.get(venueNode.id)!.occupancyPeople > EPSILON,
        )
        .sort(
          (a, b) =>
            this.nodeStates.get(b.id)!.occupancyPeople - this.nodeStates.get(a.id)!.occupancyPeople ||
            a.id.localeCompare(b.id),
        )
        .slice(0, 8)
        .map((venueNode) => venueNode.id);
    }
    const edgeRatios = Object.fromEntries(
      this.preset.graph.edges.map((edge) => [
        edge.id,
        this.edgeOccupancy(this.edgeStates.get(edge.id)!) / edge.capacityPeople,
      ]),
    );
    const recommendations: RouteRecommendation[] = [];
    for (const originId of origins) {
      for (const targetId of targets) {
        if (originId === targetId) continue;
        const paths = computeAlternativePaths(
          this.preset.graph,
          originId,
          targetId,
          this.config.maxRouteAlternatives,
          {
            edgeOccupancyRatios: edgeRatios,
            congestionPenaltyAlpha: this.config.congestionPenaltyAlpha,
            policies: this.activePolicies,
            policyCompliance: 1,
          },
        );
        recommendations.push({
          id: `route:${originId}:${targetId}`,
          originNodeId: originId,
          targetNodeId: targetId,
          primary: paths[0] ?? null,
          alternatives: paths.slice(1),
          affectedPeopleEstimate:
            this.nodeStates.get(originId)!.occupancyPeople + (this.outsideQueues.get(originId) ?? 0),
          validAtMinute: this.simulationTimeMinute,
        });
      }
    }
    return recommendations.sort((a, b) => a.id.localeCompare(b.id));
  }

  private activeScheduleBlock(): ScheduleBlock | null {
    return this.preset.schedule.find(
      (scheduleBlock) =>
        this.simulationTimeMinute + EPSILON >= scheduleBlock.startMinute &&
        this.simulationTimeMinute < scheduleBlock.endMinute - EPSILON,
    ) ?? null;
  }

  private edgeOccupancy(state: MutableEdgeState): number {
    return state.cohorts.reduce((total, cohort) => total + cohort.amountPeople, 0);
  }

  private edgeSpeedFactor(edge: VenueEdge, state: MutableEdgeState): number {
    const occupancyRatio = this.edgeOccupancy(state) / edge.capacityPeople;
    return Math.max(0.08, 1 - occupancyRatio * occupancyRatio);
  }

  private updateIntegratedMetrics(stepMinutes: number): void {
    for (const venueNode of this.preset.graph.nodes) {
      const occupancy = this.nodeStates.get(venueNode.id)!.occupancyPeople;
      const ratio = occupancy / venueNode.capacityPeople;
      this.peakOccupancyRatio = Math.max(this.peakOccupancyRatio, ratio);
      if (ratio >= this.config.warningOccupancyRatio) {
        this.congestionExposurePersonMinutes += occupancy * stepMinutes;
      }
    }
    for (const edge of this.preset.graph.edges) {
      const occupancy = this.edgeOccupancy(this.edgeStates.get(edge.id)!);
      const ratio = occupancy / edge.capacityPeople;
      this.peakOccupancyRatio = Math.max(this.peakOccupancyRatio, ratio);
      if (ratio >= this.config.warningOccupancyRatio) {
        this.congestionExposurePersonMinutes += occupancy * stepMinutes;
      }
    }
  }

  private computeMetrics(): SimulationMetrics {
    const inNodes = sum([...this.nodeStates.values()].map((state) => state.occupancyPeople));
    const inEdges = sum([...this.edgeStates.values()].map((state) => this.edgeOccupancy(state)));
    const outside = sum(this.outsideQueues.values());
    return {
      generatedPeople: this.generatedPeople,
      admittedPeople: this.admittedPeople,
      exitedPeople: this.exitedPeople,
      inSystemPeople: inNodes + inEdges,
      outsideWaitingPeople: outside,
      peakOccupancyRatio: this.peakOccupancyRatio,
      congestionExposurePersonMinutes: this.congestionExposurePersonMinutes,
      completedThroughputPeoplePerMinute:
        this.simulationTimeMinute > EPSILON ? this.exitedPeople / this.simulationTimeMinute : 0,
    };
  }

  private computeInvariants(metrics: SimulationMetrics): SimulationInvariants {
    const massBalanceErrorPeople = Math.abs(
      metrics.generatedPeople -
        (metrics.inSystemPeople + metrics.outsideWaitingPeople + metrics.exitedPeople),
    );
    const nonNegative =
      [...this.nodeStates.values()].every((state) => state.occupancyPeople >= -EPSILON) &&
      [...this.edgeStates.values()].every((state) => this.edgeOccupancy(state) >= -EPSILON) &&
      [...this.outsideQueues.values()].every((value) => value >= -EPSILON);
    const withinStorageCapacity =
      this.preset.graph.nodes.every(
        (venueNode) => this.nodeStates.get(venueNode.id)!.occupancyPeople <= venueNode.capacityPeople + EPSILON,
      ) &&
      this.preset.graph.edges.every(
        (edge) => this.edgeOccupancy(this.edgeStates.get(edge.id)!) <= edge.capacityPeople + EPSILON,
      );
    const stepMinutes = this.config.stepSeconds / 60;
    const withinFlowCapacity =
      this.preset.graph.nodes.every((venueNode) => {
        const state = this.nodeStates.get(venueNode.id)!;
        const limit = venueNode.maxThroughputPerMinute * stepMinutes + EPSILON;
        return state.inflowThisTick <= limit && state.outflowThisTick <= limit;
      }) &&
      this.preset.graph.edges.every((edge) => {
        const state = this.edgeStates.get(edge.id)!;
        const limit = edge.maxFlowPerMinute * stepMinutes + EPSILON;
        return state.inflowThisTick <= limit && state.outflowThisTick <= limit;
      });
    const valid = massBalanceErrorPeople <= 1e-5 && nonNegative && withinStorageCapacity && withinFlowCapacity;
    return { massBalanceErrorPeople, nonNegative, withinStorageCapacity, withinFlowCapacity, valid };
  }

  private clone(): SimulationEngine {
    const copy = new SimulationEngine(this.preset, this.config);
    copy.simulationTimeMinute = this.simulationTimeMinute;
    copy.tick = this.tick;
    copy.generatedPeople = this.generatedPeople;
    copy.admittedPeople = this.admittedPeople;
    copy.exitedPeople = this.exitedPeople;
    copy.peakOccupancyRatio = this.peakOccupancyRatio;
    copy.congestionExposurePersonMinutes = this.congestionExposurePersonMinutes;
    copy.activePolicies = this.activePolicies.map((policy) => ({
      ...policy,
      avoidEdgeIds: [...policy.avoidEdgeIds],
      ...(policy.preferEdgeIds ? { preferEdgeIds: [...policy.preferEdgeIds] } : {}),
    }));
    copy.activeBottlenecks = this.activeBottlenecks.map((bottleneck) => ({ ...bottleneck }));
    copy.detector = this.detector.clone();
    copy.nodeStates.clear();
    for (const [id, state] of this.nodeStates) copy.nodeStates.set(id, { ...state });
    copy.edgeStates.clear();
    for (const [id, state] of this.edgeStates) {
      copy.edgeStates.set(id, {
        ...state,
        cohorts: state.cohorts.map((cohort) => ({ ...cohort })),
      });
    }
    copy.outsideQueues.clear();
    for (const [id, queue] of this.outsideQueues) copy.outsideQueues.set(id, queue);
    return copy;
  }
}

export function createSimulationEngine(
  preset: VenuePreset,
  config: Partial<SimulationConfig> = {},
): SimulationEngine {
  return new SimulationEngine(preset, config);
}

export interface SimulateScenarioOptions {
  readonly config?: Partial<SimulationConfig>;
  readonly untilMinute?: number;
  readonly sampleEveryTicks?: number;
}

export function simulateScenario(
  preset: VenuePreset,
  options: SimulateScenarioOptions = {},
): readonly RuntimeSnapshot[] {
  const engine = createSimulationEngine(preset, options.config);
  const untilMinute = options.untilMinute ?? preset.durationMinutes;
  const sampleEveryTicks = options.sampleEveryTicks ?? 1;
  if (!Number.isInteger(sampleEveryTicks) || sampleEveryTicks < 1) {
    throw new Error("sampleEveryTicks must be a positive integer.");
  }
  const snapshots: RuntimeSnapshot[] = [engine.getSnapshot()];
  while (engine.getSnapshot().simulationTimeMinute + EPSILON < untilMinute) {
    const snapshot = engine.step();
    if (snapshot.tick % sampleEveryTicks === 0 || snapshot.simulationTimeMinute + EPSILON >= untilMinute) {
      snapshots.push(snapshot);
    }
  }
  return snapshots;
}
