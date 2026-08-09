import type { ScheduleBlock, VenueGraph } from "../shared/types";

export interface RuntimeNodeSnapshot {
  occupancyPeople: number;
  occupancyRatio: number;
  inflowPeoplePerMinute: number;
  outflowPeoplePerMinute: number;
}

export interface RuntimeEdgeSnapshot extends RuntimeNodeSnapshot {
  speedFactor: number;
}

export interface RuntimeBottleneck {
  id: string;
  locationType: "node" | "edge";
  locationId: string;
  label: string;
  reason: string;
  severity: "watch" | "warning" | "critical";
  occupancyRatio: number;
  durationMinutes: number;
}

export interface RuntimeRoute {
  id: string;
  primary: { edgeIds: readonly string[]; costMinutes: number; freeFlowMinutes: number } | null;
  alternatives: readonly { edgeIds: readonly string[]; costMinutes: number; freeFlowMinutes: number }[];
}

export interface RuntimeForecast {
  id: string;
  locationType: "node" | "edge";
  locationId: string;
  label: string;
  predictedOnsetMinute: number;
  leadTimeMinutes: number;
  predictedDurationMinutes: number;
  predictedPeakOccupancyRatio: number;
  severity: "watch" | "warning" | "critical";
  confidence: number;
}

export interface RuntimeSnapshot {
  scenarioId: string;
  tick: number;
  simulationTimeMinute: number;
  simMinute?: number;
  activeScheduleBlockId: string | null;
  nodes: Readonly<Record<string, RuntimeNodeSnapshot>>;
  edges: Readonly<Record<string, RuntimeEdgeSnapshot>>;
  outsideQueues: Readonly<Record<string, number>>;
  bottlenecks: readonly RuntimeBottleneck[];
  routes: readonly RuntimeRoute[];
  activeReroutePolicyIds: readonly string[];
  forecasts?: readonly RuntimeForecast[];
  metrics: {
    generatedPeople: number;
    admittedPeople: number;
    exitedPeople: number;
    inSystemPeople: number;
    outsideWaitingPeople: number;
    peakOccupancyRatio: number;
    congestionExposurePersonMinutes: number;
    completedThroughputPeoplePerMinute: number;
  };
  invariants: { valid: boolean; massBalanceErrorPeople: number };
}

export interface SessionResponse {
  sessionId: string;
  graph?: VenueGraph;
  schedule?: readonly ScheduleBlock[];
  crowdSize?: number;
  extraction?: {
    provider: "openai" | "deterministic-fallback" | "preset";
    model: string | null;
    warning?: string;
    assumptions?: readonly string[];
  };
}

export interface ConfirmationResponse {
  confirmed: boolean;
  graph?: VenueGraph;
  schedule?: readonly ScheduleBlock[];
  crowdSize?: number;
  validation?: { valid: boolean; messages: string[] };
}

export interface AdviceResponse {
  summary: string;
  operatorMessage?: string;
  confidence?: number;
  provider?: string;
  actions?: readonly {
    id: string;
    type: string;
    priority: number;
    summary: string;
    rationale: string;
    findingIds: readonly string[];
    evidenceIds: readonly string[];
  }[];
  findingBundle?: {
    findings: readonly {
      id: string;
      summary: string;
      nodeIds: readonly string[];
      edgeIds: readonly string[];
    }[];
  };
  reroutes?: readonly {
    policy: ReroutePolicyView;
    metrics: {
      recommended: boolean;
      peakOccupancyRatioDelta: number;
      congestionExposureDeltaPersonMinutes: number;
      exitedPeopleDelta: number;
    };
  }[];
}

export interface ReroutePolicyView {
  id: string;
  label: string;
  avoidEdgeIds: readonly string[];
  preferEdgeIds?: readonly string[];
  penaltyMultiplier?: number;
  compliance?: number;
}

export class ApiRequestError extends Error {
  public readonly status: number;
  public readonly code?: string;

  public constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const formDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(formDataBody ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    throw new ApiRequestError(payload?.error ?? `Request failed (${response.status})`, response.status, payload?.code);
  }

  return (await response.json()) as T;
}

export const api = {
  createSession(payload: {
    presetId: string;
    crowdSize: number;
    schedule: readonly ScheduleBlock[];
    layoutFile?: File | null;
  }) {
    if (payload.layoutFile) {
      const body = new FormData();
      body.set("presetId", payload.presetId);
      body.set("crowdSize", String(payload.crowdSize));
      body.set("schedule", JSON.stringify(payload.schedule));
      body.set("image", payload.layoutFile);
      return request<SessionResponse>("/api/sessions", { method: "POST", body });
    }
    return request<SessionResponse>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  saveGraph(sessionId: string, graph: VenueGraph) {
    return request<{ graph: VenueGraph }>(`/api/sessions/${sessionId}/graph`, {
      method: "PUT",
      body: JSON.stringify({ graph }),
    });
  },

  confirmSession(
    sessionId: string,
    payload: {
      graph: VenueGraph;
      crowdSize: number;
      schedule: readonly ScheduleBlock[];
    },
  ) {
    return request<ConfirmationResponse>(`/api/sessions/${sessionId}/confirm`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  startSimulation(sessionId: string) {
    return request<{ started: boolean; snapshot: RuntimeSnapshot }>(`/api/sessions/${sessionId}/sim/start`, {
      method: "POST",
      body: "{}",
    });
  },

  getSnapshot(sessionId: string) {
    return request<{ snapshot: RuntimeSnapshot }>(`/api/sessions/${sessionId}/snapshot`);
  },

  controlSimulation(sessionId: string, payload: { playing?: boolean; speed?: 1 | 2 | 4 }) {
    return request<{ playing: boolean; speed: 1 | 2 | 4 }>(`/api/sessions/${sessionId}/sim/control`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getAdvice(sessionId: string, bottleneckId?: string) {
    return request<AdviceResponse>(`/api/sessions/${sessionId}/advice`, {
      method: "POST",
      body: JSON.stringify({ bottleneckId }),
    });
  },

  applyReroute(sessionId: string, policyId?: string) {
    return request<{
      applied: boolean;
      evaluation: { policy: ReroutePolicyView };
      snapshot: RuntimeSnapshot;
    }>(`/api/sessions/${sessionId}/reroute`, {
      method: "POST",
      body: JSON.stringify({ policyId }),
    });
  },
};
