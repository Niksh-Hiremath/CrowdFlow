export type NodeType =
  | "entry_gate"
  | "exit"
  | "emergency_exit"
  | "walkway_junction"
  | "concession"
  | "seating"
  | "attraction"
  | "restroom"
  | "service"
  | "other";

export type ScheduleBlockType =
  | "attraction"
  | "break"
  | "egress"
  | "arrival"
  | "other";

export interface VenueNode {
  id: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
  capacity: number;
  service_rate_per_min?: number | null;
  confirmed?: boolean;
}

export interface VenueEdge {
  id: string;
  source: string;
  target: string;
  type?: "walkway" | "corridor" | "queue";
  length_m: number;
  width_m: number;
  capacity: number;
}

export interface VenueGraph {
  image_size: { width: number; height: number };
  nodes: VenueNode[];
  edges: VenueEdge[];
  confirmed: boolean;
  source: "mock" | "hf" | "manual";
}

export interface ScheduleBlock {
  id: string;
  label: string;
  type: ScheduleBlockType;
  start: string;
  end: string;
  attractors: string[];
  arrival_rate_per_min: number;
}

export interface Scenario {
  expected_crowd: number;
  schedule: {
    timezone: string;
    blocks: ScheduleBlock[];
  };
}

export interface SessionResponse {
  session_id: string;
  graph: VenueGraph | null;
  scenario: Scenario | null;
  confirmed: boolean;
  sim_running: boolean;
  last_tick: SimTick | null;
}

export interface NodeState {
  density: number;
  count: number;
  risk: number;
  queue: number;
}

export interface EdgeState {
  flow: number;
  speed_factor: number;
  congested: boolean;
}

export interface Bottleneck {
  id: string;
  node_id: string;
  severity: "watch" | "warning" | "critical";
  eta_critical_s: number;
  reason: string;
}

export interface AdvisorAction {
  type: "reroute" | "throttle_gate" | "open_exit" | "prefer_node";
  priority: number;
  from_node?: string | null;
  avoid?: string[];
  prefer?: string[];
  node_id?: string | null;
  meter_per_min?: number | null;
}

export interface AdvisorResponse {
  actions: AdvisorAction[];
  summary: string;
  source: "mock" | "hf";
}

export interface SimTick {
  t: number;
  sim_time: string;
  nodes: Record<string, NodeState>;
  edges: Record<string, EdgeState>;
  bottlenecks: Bottleneck[];
  routes: Array<{
    id: string;
    purpose: string;
    path_node_ids: string[];
    cost: number;
  }>;
  remaining_to_spawn: number;
  active_block_ids: string[];
}

export interface ConfirmResponse {
  ok: boolean;
  errors: string[];
  graph: VenueGraph | null;
}
