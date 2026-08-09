import type { EdgeId, NodeId, ScheduleBlockId } from "../../shared/types";

export type BottleneckSeverity = "watch" | "warning" | "critical";
export type BottleneckLocationType = "node" | "edge";
export type BottleneckReason =
  | "high_density"
  | "stagnation"
  | "queue_growth"
  | "gate_imbalance"
  | "capacity_drop";

export interface RuntimeNodeSnapshot {
  readonly occupancyPeople: number;
  readonly occupancyRatio: number;
  readonly inflowPeoplePerMinute: number;
  readonly outflowPeoplePerMinute: number;
}

export interface RuntimeEdgeSnapshot {
  readonly occupancyPeople: number;
  readonly occupancyRatio: number;
  readonly inflowPeoplePerMinute: number;
  readonly outflowPeoplePerMinute: number;
  readonly speedFactor: number;
}

export interface Bottleneck {
  readonly id: string;
  readonly locationType: BottleneckLocationType;
  readonly locationId: NodeId | EdgeId;
  readonly label: string;
  readonly reason: BottleneckReason;
  readonly severity: BottleneckSeverity;
  /** Physical people/storage ratio at the location. */
  readonly occupancyRatio: number;
  /** Detector signal after including explicit queue pressure, if any. */
  readonly pressureRatio: number;
  readonly outsideQueuePeople: number;
  readonly inflowPeoplePerMinute: number;
  readonly outflowPeoplePerMinute: number;
  readonly firstObservedMinute: number;
  readonly detectedAtMinute: number;
  readonly durationMinutes: number;
  readonly trendPerMinute: number;
}

export interface BottleneckForecast {
  readonly id: string;
  readonly locationType: BottleneckLocationType;
  readonly locationId: NodeId | EdgeId;
  readonly label: string;
  readonly predictedOnsetMinute: number;
  readonly leadTimeMinutes: number;
  readonly predictedDurationMinutes: number;
  readonly predictedPeakOccupancyRatio: number;
  readonly predictedPeakPressureRatio: number;
  readonly predictedPeakOutsideQueuePeople: number;
  readonly reason: BottleneckReason;
  readonly severity: BottleneckSeverity;
  /** Deterministic confidence decreases with forecast horizon. */
  readonly confidence: number;
}

export interface RoutePath {
  readonly nodeIds: readonly NodeId[];
  readonly edgeIds: readonly EdgeId[];
  readonly costMinutes: number;
  readonly freeFlowMinutes: number;
}

export interface RouteRecommendation {
  readonly id: string;
  readonly originNodeId: NodeId;
  readonly targetNodeId: NodeId;
  readonly primary: RoutePath | null;
  readonly alternatives: readonly RoutePath[];
  readonly affectedPeopleEstimate: number;
  readonly validAtMinute: number;
}

export interface ReroutePolicy {
  readonly id: string;
  readonly label: string;
  readonly avoidEdgeIds: readonly EdgeId[];
  readonly preferEdgeIds?: readonly EdgeId[];
  /** Multiplier applied to avoided-edge generalized travel cost. */
  readonly penaltyMultiplier?: number;
  /** Overrides the schedule compliance when supplied. */
  readonly compliance?: number;
}

export interface SimulationMetrics {
  readonly generatedPeople: number;
  readonly admittedPeople: number;
  readonly exitedPeople: number;
  readonly inSystemPeople: number;
  readonly outsideWaitingPeople: number;
  readonly peakOccupancyRatio: number;
  readonly congestionExposurePersonMinutes: number;
  readonly completedThroughputPeoplePerMinute: number;
}

export interface SimulationInvariants {
  readonly massBalanceErrorPeople: number;
  readonly nonNegative: boolean;
  readonly withinStorageCapacity: boolean;
  readonly withinFlowCapacity: boolean;
  readonly valid: boolean;
}

export interface RuntimeSnapshot {
  readonly scenarioId: string;
  readonly tick: number;
  readonly simulationTimeMinute: number;
  readonly activeScheduleBlockId: ScheduleBlockId | null;
  readonly nodes: Readonly<Record<NodeId, RuntimeNodeSnapshot>>;
  readonly edges: Readonly<Record<EdgeId, RuntimeEdgeSnapshot>>;
  readonly outsideQueues: Readonly<Record<NodeId, number>>;
  readonly bottlenecks: readonly Bottleneck[];
  readonly routes: readonly RouteRecommendation[];
  readonly activeReroutePolicyIds: readonly string[];
  readonly metrics: SimulationMetrics;
  readonly invariants: SimulationInvariants;
}

export interface CounterfactualMetrics {
  readonly horizonMinutes: number;
  readonly baseline: SimulationMetrics;
  readonly rerouted: SimulationMetrics;
  /** Negative is an improvement. */
  readonly peakOccupancyRatioDelta: number;
  /** Negative is an improvement. */
  readonly congestionExposureDeltaPersonMinutes: number;
  /** Positive is an improvement. */
  readonly exitedPeopleDelta: number;
  readonly recommended: boolean;
}

export interface RerouteEvaluation {
  readonly policy: ReroutePolicy;
  readonly metrics: CounterfactualMetrics;
}

export interface SimulationConfig {
  readonly stepSeconds: number;
  readonly warningOccupancyRatio: number;
  readonly criticalOccupancyRatio: number;
  readonly persistenceTicks: number;
  readonly clearanceTicks: number;
  readonly congestionPenaltyAlpha: number;
  readonly reroutePenaltyMultiplier: number;
  readonly forecastHorizonMinutes: number;
  readonly counterfactualHorizonMinutes: number;
  readonly maxRouteAlternatives: number;
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  stepSeconds: 10,
  warningOccupancyRatio: 0.75,
  criticalOccupancyRatio: 0.9,
  persistenceTicks: 3,
  clearanceTicks: 3,
  congestionPenaltyAlpha: 4,
  reroutePenaltyMultiplier: 25,
  forecastHorizonMinutes: 15,
  counterfactualHorizonMinutes: 10,
  maxRouteAlternatives: 3,
};
