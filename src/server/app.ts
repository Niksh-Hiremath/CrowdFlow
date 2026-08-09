import { resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import {
  DEFAULT_PRESET_ID,
  VENUE_PRESETS,
  getVenuePreset,
} from "../shared/presets.js";
import type { ScheduleBlock, VenueGraph, VenuePreset } from "../shared/types.js";
import {
  OPENAI_MODEL,
  extractVenueGraph,
  generateStructuredAdvice,
  type ExtractVenueGraphInput,
  type FindingBundle,
} from "./ai/index.js";
import {
  adaptScheduleToGraph,
  calibrateScheduleDemand,
  extractedGraphToVenueGraph,
} from "./graph-adapter.js";
import {
  toFindingBundle,
  validateVenuePreset,
  type RuntimeSnapshot,
} from "./simulation/index.js";
import { SessionStore, type CrowdFlowSession } from "./sessions.js";

const NodeTypeSchema = z.enum([
  "entry_gate",
  "walkway_junction",
  "concession",
  "seating",
  "attraction",
  "restroom",
  "exit",
  "emergency_exit",
  "security",
  "platform",
]);

const NodeWeightsSchema = z.record(z.string().min(1).max(100), z.number().finite().min(0));

const VenueGraphSchema = z.object({
  nodes: z.array(z.object({
    id: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(120),
    type: NodeTypeSchema,
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    capacityPeople: z.number().finite().positive().max(2_000_000),
    maxThroughputPerMinute: z.number().finite().positive().max(2_000_000),
    floor: z.number().int().min(-20).max(200).optional(),
  }).strict()).min(2).max(500),
  edges: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    source: z.string().trim().min(1).max(100),
    target: z.string().trim().min(1).max(100),
    lengthMeters: z.number().finite().positive().max(100_000),
    widthMeters: z.number().finite().positive().max(1_000),
    capacityPeople: z.number().finite().positive().max(2_000_000),
    maxFlowPerMinute: z.number().finite().positive().max(2_000_000),
    freeSpeedMps: z.number().finite().positive().max(20),
  }).strict()).min(1).max(2_000),
}).strict();

const ScheduleBlockSchema = z.object({
  id: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(140),
  startMinute: z.number().finite().min(0).max(10_080),
  endMinute: z.number().finite().positive().max(10_080),
  phase: z.enum(["arrival", "event", "intermission", "transfer", "egress", "disruption"]),
  arrivalRatePerMinute: z.number().finite().min(0).max(1_000_000),
  entryWeights: NodeWeightsSchema,
  targetWeights: NodeWeightsSchema,
  rerouteCompliance: z.number().finite().min(0).max(1),
}).strict();

const DraftSchema = z.object({
  graph: VenueGraphSchema,
  crowdSize: z.number().int().positive().max(2_000_000),
  schedule: z.array(ScheduleBlockSchema).min(1).max(100),
}).strict();

export interface AppDependencies {
  readonly extract: (input: ExtractVenueGraphInput) => ReturnType<typeof extractVenueGraph>;
  readonly advise: (bundle: FindingBundle) => ReturnType<typeof generateStructuredAdvice>;
}

const defaultDependencies: AppDependencies = {
  extract: extractVenueGraph,
  advise: generateStructuredAdvice,
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 20 },
  fileFilter: (_request, file, callback) => {
    const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
    if (allowed.has(file.mimetype)) {
      callback(null, true);
    } else {
      callback(new Error("Only PNG, JPEG, and WEBP layouts are supported"));
    }
  },
});

const safeJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const filteredOccupancy = (
  previous: VenuePreset,
  graph: VenueGraph,
  crowdSize: number,
): Readonly<Record<string, number>> => {
  const capacities = new Map(graph.nodes.map((node) => [node.id, node.capacityPeople]));
  const retained = Object.fromEntries(
    Object.entries(previous.initialOccupancy)
      .filter(([nodeId]) => capacities.has(nodeId))
      .map(([nodeId, occupancy]) => [nodeId, Math.min(occupancy, capacities.get(nodeId)!)]),
  );
  const retainedTotal = Object.values(retained).reduce((total, occupancy) => total + occupancy, 0);
  if (retainedTotal <= crowdSize || retainedTotal === 0) return retained;
  const scale = crowdSize / retainedTotal;
  return Object.fromEntries(
    Object.entries(retained).map(([nodeId, occupancy]) => [nodeId, occupancy * scale]),
  );
};

function makeDraftPreset(
  base: VenuePreset,
  graph: VenueGraph,
  crowdSize: number,
  schedule: readonly ScheduleBlock[],
  keepOccupancy = true,
): VenuePreset {
  const durationMinutes = schedule.at(-1)?.endMinute ?? base.durationMinutes;
  const initialOccupancy = keepOccupancy ? filteredOccupancy(base, graph, crowdSize) : {};
  const initialOccupancyPeople = Object.values(initialOccupancy)
    .reduce((total, occupancy) => total + occupancy, 0);
  const calibratedSchedule = calibrateScheduleDemand(
    schedule,
    crowdSize,
    initialOccupancyPeople,
    graph.nodes.filter((node) => node.type === "entry_gate").map((node) => node.id),
  );
  return {
    ...base,
    graph,
    crowdSize,
    schedule: calibratedSchedule,
    durationMinutes,
    initialOccupancy,
  };
}

const draftChanged = (session: CrowdFlowSession, next: VenuePreset): boolean =>
  JSON.stringify({
    graph: session.preset.graph,
    crowdSize: session.preset.crowdSize,
    schedule: session.preset.schedule,
  }) !== JSON.stringify({ graph: next.graph, crowdSize: next.crowdSize, schedule: next.schedule });

const publicPreset = (preset: VenuePreset) => ({
  id: preset.id,
  name: preset.name,
  shortName: preset.shortName,
  description: preset.description,
  category: preset.category,
  imagePath: preset.imagePath,
  crowdSize: preset.crowdSize,
  durationMinutes: preset.durationMinutes,
  graph: preset.graph,
  schedule: preset.schedule,
});

function sessionOr404(store: SessionStore, request: Request, response: Response): CrowdFlowSession | null {
  const parameter = request.params.id;
  const session = store.get(Array.isArray(parameter) ? parameter[0] ?? "" : parameter ?? "");
  if (!session) response.status(404).json({ error: "Session not found", code: "SESSION_NOT_FOUND" });
  return session ?? null;
}

function sendValidation(response: Response, errors: readonly string[]): void {
  response.status(422).json({
    confirmed: false,
    validation: { valid: false, messages: errors },
    code: "INVALID_DRAFT",
  });
}

export function createCrowdFlowApp(
  dependencies: Partial<AppDependencies> = {},
): { app: express.Express; sessions: SessionStore } {
  const deps = { ...defaultDependencies, ...dependencies };
  const sessions = new SessionStore();
  const app = express();

  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      status: "ok",
      model: OPENAI_MODEL,
      aiConfigured: Boolean(process.env.OPENAI_TOKEN),
      activeSessions: sessions.size,
    });
  });

  app.get("/api/presets", (_request, response) => {
    response.json({ presets: VENUE_PRESETS.map(publicPreset), defaultPresetId: DEFAULT_PRESET_ID });
  });

  app.post("/api/sessions", upload.single("image"), async (request, response, next) => {
    try {
      const presetId = String(request.body.presetId ?? DEFAULT_PRESET_ID);
      const base = getVenuePreset(presetId);
      if (!base) {
        response.status(400).json({ error: "Unknown preset", code: "UNKNOWN_PRESET" });
        return;
      }

      const crowdResult = z.coerce.number().int().positive().max(2_000_000).safeParse(request.body.crowdSize ?? base.crowdSize);
      const scheduleResult = z.array(ScheduleBlockSchema).min(1).max(100).safeParse(
        safeJson(request.body.schedule) ?? base.schedule,
      );
      if (!crowdResult.success || !scheduleResult.success) {
        response.status(400).json({ error: "Invalid crowd size or schedule", code: "INVALID_SESSION_INPUT" });
        return;
      }

      let graph: VenueGraph = base.graph;
      let schedule: readonly ScheduleBlock[] = scheduleResult.data;
      let keepOccupancy = true;
      let extraction: CrowdFlowSession["extraction"] = { provider: "preset", model: null };

      if (request.file) {
        const result = await deps.extract({
          imageBase64: request.file.buffer.toString("base64"),
          mimeType: request.file.mimetype as ExtractVenueGraphInput["mimeType"],
          context: `Venue class: ${base.category}. Expected crowd: ${crowdResult.data}. The image filename is ${request.file.originalname}.`,
        });
        graph = extractedGraphToVenueGraph(result.data);
        schedule = adaptScheduleToGraph(schedule, graph);
        keepOccupancy = false;
        extraction = {
          provider: result.provider,
          model: result.model,
          ...(result.warning ? { warning: result.warning } : {}),
          assumptions: result.data.assumptions,
        };
      }

      const draft = makeDraftPreset(base, graph, crowdResult.data, schedule, keepOccupancy);
      const session = sessions.create(draft, extraction);
      response.status(201).json({
        sessionId: session.id,
        revision: session.revision,
        confirmed: false,
        graph: draft.graph,
        schedule: draft.schedule,
        crowdSize: draft.crowdSize,
        extraction,
      });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/sessions/:id/graph", (request, response) => {
    const session = sessionOr404(sessions, request, response);
    if (!session) return;
    const parsed = VenueGraphSchema.safeParse(request.body.graph);
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid graph payload", code: "INVALID_GRAPH" });
      return;
    }
    const next = makeDraftPreset(
      session.preset,
      parsed.data,
      session.preset.crowdSize,
      session.preset.schedule,
    );
    sessions.updateDraft(session, next);
    response.json({ graph: next.graph, revision: session.revision, confirmed: false });
  });

  app.post("/api/sessions/:id/confirm", (request, response) => {
    const session = sessionOr404(sessions, request, response);
    if (!session) return;
    const parsed = DraftSchema.safeParse(request.body);
    if (!parsed.success) {
      sendValidation(response, parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
      return;
    }
    const next = makeDraftPreset(
      session.preset,
      parsed.data.graph,
      parsed.data.crowdSize,
      parsed.data.schedule,
    );
    const errors = validateVenuePreset(next);
    if (errors.length > 0) {
      sendValidation(response, errors);
      return;
    }
    if (draftChanged(session, next)) sessions.updateDraft(session, next);
    const confirmationHash = sessions.confirm(session);
    response.json({
      confirmed: true,
      graph: session.preset.graph,
      schedule: session.preset.schedule,
      crowdSize: session.preset.crowdSize,
      revision: session.revision,
      confirmationHash,
      validation: { valid: true, messages: [] },
    });
  });

  app.post("/api/sessions/:id/sim/start", (request, response) => {
    const session = sessionOr404(sessions, request, response);
    if (!session) return;
    if (!sessions.isConfirmed(session)) {
      response.status(409).json({
        error: "Confirm the current graph, crowd size, and schedule before starting",
        code: "CONFIRMATION_REQUIRED",
      });
      return;
    }
    sessions.start(session);
    response.json({ started: true, snapshot: sessions.serialize(session) });
  });

  app.post("/api/sessions/:id/sim/step", (request, response) => {
    const session = sessionOr404(sessions, request, response);
    if (!session) return;
    if (!session.engine) {
      response.status(409).json({ error: "Simulation has not started", code: "SIMULATION_NOT_STARTED" });
      return;
    }
    const parsed = z.object({ steps: z.number().int().min(1).max(3_600).default(1) }).safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid step count", code: "INVALID_STEP" });
      return;
    }
    session.snapshot = session.engine.step(parsed.data.steps);
    sessions.broadcast(session, session.snapshot);
    response.json({ snapshot: sessions.serialize(session) });
  });

  app.post("/api/sessions/:id/sim/control", (request, response) => {
    const session = sessionOr404(sessions, request, response);
    if (!session) return;
    if (!session.engine) {
      response.status(409).json({ error: "Simulation has not started", code: "SIMULATION_NOT_STARTED" });
      return;
    }
    const parsed = z.object({
      playing: z.boolean().optional(),
      speed: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional(),
    }).strict().safeParse(request.body ?? {});
    if (!parsed.success) {
      response.status(400).json({ error: "Invalid simulation control", code: "INVALID_CONTROL" });
      return;
    }
    if (parsed.data.playing !== undefined) session.paused = !parsed.data.playing;
    if (parsed.data.speed !== undefined) session.speedMultiplier = parsed.data.speed;
    response.json({ playing: !session.paused, speed: session.speedMultiplier });
  });

  app.get("/api/sessions/:id/snapshot", (request, response) => {
    const session = sessionOr404(sessions, request, response);
    if (!session) return;
    if (!session.snapshot) {
      response.status(409).json({ error: "Simulation has not started", code: "SIMULATION_NOT_STARTED" });
      return;
    }
    response.json({ snapshot: sessions.serialize(session) });
  });

  app.post("/api/sessions/:id/advice", async (request, response, next) => {
    try {
      const session = sessionOr404(sessions, request, response);
      if (!session) return;
      const snapshot = session.snapshot ?? session.engine?.getSnapshot();
      if (!snapshot) {
        response.status(409).json({ error: "Simulation has not started", code: "SIMULATION_NOT_STARTED" });
        return;
      }
      const forecast = session.engine?.forecast() ?? [];
      const reroutes = session.engine?.evaluateReroutes() ?? [];
      const bundle = toFindingBundle(session.preset, snapshot, { forecast, reroutes });
      const result = await deps.advise(bundle);
      response.json({
        ...result.data,
        summary: result.data.overview,
        provider: result.provider,
        model: result.model,
        ...(result.warning ? { warning: result.warning } : {}),
        findingBundle: bundle,
        reroutes,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/sessions/:id/reroute", (request, response) => {
    const session = sessionOr404(sessions, request, response);
    if (!session) return;
    if (!session.engine) {
      response.status(409).json({ error: "Simulation has not started", code: "SIMULATION_NOT_STARTED" });
      return;
    }
    const evaluations = session.engine.evaluateReroutes();
    const requestedId = typeof request.body?.policyId === "string" ? request.body.policyId : null;
    const chosen = requestedId
      ? evaluations.find(
          (evaluation) => evaluation.policy.id === requestedId && evaluation.metrics.recommended,
        )
      : evaluations.find((evaluation) => evaluation.metrics.recommended);
    if (!chosen) {
      response.status(409).json({ error: "No safe reroute candidate is available", code: "NO_REROUTE" });
      return;
    }
    session.snapshot = session.engine.applyReroute(chosen.policy);
    sessions.broadcast(session, session.snapshot, true);
    response.json({ applied: true, evaluation: chosen, snapshot: sessions.serialize(session) });
  });

  const clientPath = resolve(process.cwd(), "dist/client");
  app.use(express.static(clientPath, { index: false, maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) {
      next();
      return;
    }
    response.sendFile(resolve(clientPath, "index.html"), (error) => {
      if (error) next(error);
    });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      response.status(400).json({ error: "Invalid layout upload", code: error.code });
      return;
    }
    if (error instanceof Error && error.message.includes("PNG, JPEG")) {
      response.status(415).json({ error: error.message, code: "UNSUPPORTED_IMAGE" });
      return;
    }
    response.status(500).json({ error: "The request could not be completed", code: "INTERNAL_ERROR" });
  });

  return { app, sessions };
}

export type { RuntimeSnapshot };
