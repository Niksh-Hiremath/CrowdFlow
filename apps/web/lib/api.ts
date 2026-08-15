import type {
  AdvisorResponse,
  ConfirmResponse,
  Scenario,
  SessionResponse,
  SimTick,
  VenueGraph,
  ExtractionProgress,
  RevisionProgress,
} from "./types";

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail)) {
      return data.detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join("; ");
    }
    return JSON.stringify(data);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

export async function createSession(): Promise<SessionResponse> {
  const res = await fetch("/api/sessions", { method: "POST" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function getSession(sessionId: string): Promise<SessionResponse> {
  const res = await fetch(`/api/sessions/${sessionId}`);
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function extractLayout(
  sessionId: string,
  file: Blob,
  filename = "layout.png",
  onProgress?: (status: ExtractionProgress) => void,
): Promise<VenueGraph> {
  const form = new FormData();
  form.append("file", file, filename);
  const res = await fetch(`/api/sessions/${sessionId}/layout/extract`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await readError(res));
  const initial = await res.json();
  // Mock-mode callers still receive the graph directly for backwards compatibility.
  if (Array.isArray(initial.nodes) && Array.isArray(initial.edges)) {
    if (initial.nodes.length === 0) throw new Error("Extraction returned an empty graph");
    return initial as VenueGraph;
  }

  let status = initial as ExtractionProgress;
  onProgress?.(status);
  for (;;) {
    if (status.status === "completed" && status.graph) return status.graph;
    if (status.status === "failed") throw new Error(status.error || "Extraction failed");
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    const statusRes = await fetch(`/api/sessions/${sessionId}/layout/extract/status`);
    if (!statusRes.ok) throw new Error(await readError(statusRes));
    status = (await statusRes.json()) as ExtractionProgress;
    onProgress?.(status);
  }
}

export function layoutImageUrl(sessionId: string): string {
  return `/api/sessions/${sessionId}/layout/image`;
}

export async function putGraph(sessionId: string, graph: VenueGraph): Promise<VenueGraph> {
  const res = await fetch(`/api/sessions/${sessionId}/graph`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(graph),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function reviseGraph(
  sessionId: string,
  instruction: string,
  onProgress?: (status: RevisionProgress) => void,
): Promise<VenueGraph> {
  const res = await fetch(`/api/sessions/${sessionId}/graph/revise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const initial = await res.json();
  if (Array.isArray(initial.nodes) && Array.isArray(initial.edges)) {
    if (initial.nodes.length === 0) throw new Error("Graph revision returned an empty graph");
    return initial as VenueGraph;
  }

  let status = initial as RevisionProgress;
  onProgress?.(status);
  for (;;) {
    if (status.status === "completed" && status.graph) return status.graph;
    if (status.status === "failed") throw new Error(status.error || "Graph revision failed");
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    const statusRes = await fetch(`/api/sessions/${sessionId}/graph/revise/status`);
    if (!statusRes.ok) throw new Error(await readError(statusRes));
    status = (await statusRes.json()) as RevisionProgress;
    onProgress?.(status);
  }
}

export async function confirmGraph(sessionId: string): Promise<ConfirmResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/graph/confirm`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function putScenario(sessionId: string, scenario: Scenario): Promise<Scenario> {
  const res = await fetch(`/api/sessions/${sessionId}/scenario`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scenario),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function startSim(sessionId: string, maxTicks = 90): Promise<SimTick> {
  const res = await fetch(`/api/sessions/${sessionId}/sim/start?max_ticks=${maxTicks}`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export async function adviseSession(sessionId: string): Promise<AdvisorResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/advise`, { method: "POST" });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export type StreamHandlers = {
  onTick: (tick: SimTick) => void;
  onDone: (tick: SimTick | null) => void;
  onError: (message: string) => void;
};

export function connectSimStream(sessionId: string, handlers: StreamHandlers, speed = 1): () => void {
  const template =
    process.env.NEXT_PUBLIC_API_WS ||
    "ws://127.0.0.1:8000/api/sessions/{id}/sim/stream";
  const baseUrl = template.includes("{id}")
    ? template.replace("{id}", sessionId)
    : `ws://127.0.0.1:8000/api/sessions/${sessionId}/sim/stream`;
  const url = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}speed=${Math.min(4, Math.max(1, speed))}`;
  const ws = new WebSocket(url);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string);
      if (data?.error) {
        handlers.onError(String(data.error));
        return;
      }
      if (data?.type === "done") {
        handlers.onDone((data.tick as SimTick) || null);
        ws.close();
        return;
      }
      handlers.onTick(data as SimTick);
    } catch {
      handlers.onError("Invalid simulation stream payload");
    }
  };

  ws.onerror = () => handlers.onError("Simulation stream connection failed");

  return () => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };
}
