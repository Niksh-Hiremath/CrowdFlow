/**
 * Shared, transport-safe domain contracts.
 *
 * Units are intentionally encoded in property names. The simulation must never
 * have to guess whether a capacity is a storage capacity (people) or a flow
 * capacity (people/minute).
 */

export type NodeId = string;
export type EdgeId = string;
export type ScheduleBlockId = string;

export type VenueCategory =
  | "ipl_stadium"
  | "concert"
  | "railway_station"
  | "airport"
  | "large_festival"
  | "test_corridor"
  | "test_parallel_routes";

export type VenueNodeType =
  | "entry_gate"
  | "walkway_junction"
  | "concession"
  | "seating"
  | "attraction"
  | "restroom"
  | "exit"
  | "emergency_exit"
  | "security"
  | "platform";

export interface VenueNode {
  readonly id: NodeId;
  readonly label: string;
  readonly type: VenueNodeType;
  /** Normalized image-space coordinate in [0, 1]. */
  readonly x: number;
  /** Normalized image-space coordinate in [0, 1]. */
  readonly y: number;
  /** Maximum number of people that can physically occupy the zone. */
  readonly capacityPeople: number;
  /** Maximum aggregate inflow/outflow through the node per minute. */
  readonly maxThroughputPerMinute: number;
  /** Optional level for multi-floor venues such as airports and stations. */
  readonly floor?: number;
}

/**
 * A directed, capacitated connection. A two-way walkway is represented by two
 * edges so each direction can congest or close independently.
 */
export interface VenueEdge {
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly lengthMeters: number;
  readonly widthMeters: number;
  /** Spillback/storage limit for people currently traversing the edge. */
  readonly capacityPeople: number;
  /** Saturation flow in people per minute. */
  readonly maxFlowPerMinute: number;
  readonly freeSpeedMps: number;
}

export interface VenueGraph {
  readonly nodes: readonly VenueNode[];
  readonly edges: readonly VenueEdge[];
}

export type SchedulePhase =
  | "arrival"
  | "event"
  | "intermission"
  | "transfer"
  | "egress"
  | "disruption";

export type NodeWeights = Readonly<Record<NodeId, number>>;

export interface ScheduleBlock {
  readonly id: ScheduleBlockId;
  readonly label: string;
  /** Minutes from the scenario start; inclusive. */
  readonly startMinute: number;
  /** Minutes from the scenario start; exclusive. */
  readonly endMinute: number;
  readonly phase: SchedulePhase;
  /** New demand generated outside the venue each minute. */
  readonly arrivalRatePerMinute: number;
  /** Distribution of newly generated demand across entry gates. */
  readonly entryWeights: NodeWeights;
  /** Desired destinations for people already in, and entering, the venue. */
  readonly targetWeights: NodeWeights;
  /** Fraction in [0, 1] expected to follow a dynamic reroute. */
  readonly rerouteCompliance: number;
}

export type InitialOccupancy = Readonly<Record<NodeId, number>>;

export interface VenuePreset {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly category: VenueCategory;
  /** UI background asset; simulation correctness does not depend on it. */
  readonly imagePath: string;
  /** Total demand cap, including people present at t=0. */
  readonly crowdSize: number;
  readonly durationMinutes: number;
  readonly graph: VenueGraph;
  readonly schedule: readonly ScheduleBlock[];
  readonly initialOccupancy: InitialOccupancy;
}

export function isExitNode(node: VenueNode): boolean {
  return node.type === "exit" || node.type === "emergency_exit";
}

export function isEntryNode(node: VenueNode): boolean {
  return node.type === "entry_gate";
}
