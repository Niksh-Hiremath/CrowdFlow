import { createHash, randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { ScheduleBlock, VenueGraph, VenuePreset } from "../shared/types.js";
import {
  createSimulationEngine,
  type BottleneckForecast,
  type RuntimeSnapshot,
  type SimulationEngine,
} from "./simulation/index.js";

export interface ExtractionMetadata {
  readonly provider: "openai" | "deterministic-fallback" | "preset";
  readonly model: string | null;
  readonly warning?: string;
  readonly assumptions?: readonly string[];
}

export interface CrowdFlowSession {
  readonly id: string;
  readonly createdAt: number;
  revision: number;
  confirmedRevision: number | null;
  confirmationHash: string | null;
  preset: VenuePreset;
  extraction: ExtractionMetadata;
  engine: SimulationEngine | null;
  snapshot: RuntimeSnapshot | null;
  forecasts: readonly BottleneckForecast[];
  forecastTick: number;
  timer: ReturnType<typeof setInterval> | null;
  paused: boolean;
  speedMultiplier: 1 | 2 | 4;
  readonly sockets: Set<WebSocket>;
}

const canonicalHash = (preset: VenuePreset): string =>
  createHash("sha256")
    .update(JSON.stringify({ graph: preset.graph, crowdSize: preset.crowdSize, schedule: preset.schedule }))
    .digest("hex");

export class SessionStore {
  private readonly sessions = new Map<string, CrowdFlowSession>();

  public create(preset: VenuePreset, extraction: ExtractionMetadata): CrowdFlowSession {
    if (this.sessions.size >= 100) {
      const oldest = [...this.sessions.values()].sort((left, right) => left.createdAt - right.createdAt)[0];
      if (oldest) this.delete(oldest.id);
    }
    const session: CrowdFlowSession = {
      id: randomUUID(),
      createdAt: Date.now(),
      revision: 1,
      confirmedRevision: null,
      confirmationHash: null,
      preset,
      extraction,
      engine: null,
      snapshot: null,
      forecasts: [],
      forecastTick: -1,
      timer: null,
      paused: false,
      speedMultiplier: 1,
      sockets: new Set(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  public get(id: string): CrowdFlowSession | undefined {
    return this.sessions.get(id);
  }

  public get size(): number {
    return this.sessions.size;
  }

  public updateDraft(session: CrowdFlowSession, preset: VenuePreset): void {
    this.stop(session);
    session.preset = preset;
    session.revision += 1;
    session.confirmedRevision = null;
    session.confirmationHash = null;
    session.engine = null;
    session.snapshot = null;
    session.forecasts = [];
    session.forecastTick = -1;
  }

  public confirm(session: CrowdFlowSession): string {
    const hash = canonicalHash(session.preset);
    session.confirmedRevision = session.revision;
    session.confirmationHash = hash;
    return hash;
  }

  public isConfirmed(session: CrowdFlowSession): boolean {
    return session.confirmedRevision === session.revision &&
      session.confirmationHash === canonicalHash(session.preset);
  }

  public start(session: CrowdFlowSession): RuntimeSnapshot {
    if (!this.isConfirmed(session)) throw new Error("CONFIRMATION_REQUIRED");
    this.stop(session);
    session.engine = createSimulationEngine(session.preset);
    session.snapshot = session.engine.getSnapshot();
    session.paused = false;
    session.speedMultiplier = 1;
    this.broadcast(session, session.snapshot, true);
    session.timer = setInterval(() => {
      if (!session.engine) return;
      if (session.paused) return;
      if (session.engine.getSnapshot().simulationTimeMinute >= session.preset.durationMinutes) {
        this.stop(session);
        return;
      }
      session.snapshot = session.engine.step(session.speedMultiplier);
      this.broadcast(session, session.snapshot);
    }, 250);
    session.timer.unref?.();
    return session.snapshot;
  }

  public stop(session: CrowdFlowSession): void {
    if (session.timer) clearInterval(session.timer);
    session.timer = null;
  }

  public delete(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.stop(session);
    for (const socket of session.sockets) socket.close(1001, "Session removed");
    this.sessions.delete(id);
  }

  public stopAll(): void {
    for (const session of this.sessions.values()) this.stop(session);
  }

  public addSocket(session: CrowdFlowSession, socket: WebSocket): void {
    session.sockets.add(socket);
    socket.on("close", () => session.sockets.delete(socket));
    if (session.snapshot) socket.send(JSON.stringify(this.serialize(session, true)));
  }

  public serialize(
    session: CrowdFlowSession,
    forceForecast = false,
  ): ReturnType<typeof serializeSnapshot> {
    if (!session.snapshot) throw new Error("SIMULATION_NOT_STARTED");
    const refreshDue = session.engine && (
      forceForecast ||
      session.forecastTick < 0 ||
      session.snapshot.tick - session.forecastTick >= 12
    );
    if (refreshDue && session.engine) {
      session.forecasts = session.engine.forecast();
      session.forecastTick = session.snapshot.tick;
    }
    return serializeSnapshot(session.snapshot, session.forecasts);
  }

  public broadcast(
    session: CrowdFlowSession,
    snapshot: RuntimeSnapshot,
    forceForecast = false,
  ): void {
    session.snapshot = snapshot;
    const message = JSON.stringify(this.serialize(session, forceForecast));
    for (const socket of session.sockets) {
      if (socket.readyState === socket.OPEN) socket.send(message);
    }
  }
}

export function serializeSnapshot(
  snapshot: RuntimeSnapshot,
  forecasts: readonly BottleneckForecast[] = [],
): RuntimeSnapshot & { simMinute: number; forecasts: readonly BottleneckForecast[] } {
  return { ...snapshot, simMinute: snapshot.simulationTimeMinute, forecasts };
}
