import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCrowdFlowApp, type AppDependencies } from "./app.js";

const extractedGraph = {
  schemaVersion: "1" as const,
  nodes: [
    { id: "entry", type: "entry_gate" as const, label: "Entry", x: 0.1, y: 0.5, capacityPersons: 300, confidence: 0.9, evidenceIds: ["visible"], confirmed: false },
    { id: "junction", type: "walkway_junction" as const, label: "Junction", x: 0.45, y: 0.5, capacityPersons: 500, confidence: 0.8, evidenceIds: ["visible"], confirmed: false },
    { id: "stage", type: "attraction" as const, label: "Stage", x: 0.7, y: 0.35, capacityPersons: 1_000, confidence: 0.85, evidenceIds: ["visible"], confirmed: false },
    { id: "exit", type: "exit" as const, label: "Exit", x: 0.9, y: 0.5, capacityPersons: 300, confidence: 0.9, evidenceIds: ["visible"], confirmed: false },
  ],
  edges: [
    { id: "entry_junction", sourceNodeId: "entry", targetNodeId: "junction", type: "walkway" as const, bidirectional: true, lengthMeters: 30, widthMeters: 5, capacityPersonsPerMinute: 160, confidence: 0.8, evidenceIds: ["visible"] },
    { id: "junction_stage", sourceNodeId: "junction", targetNodeId: "stage", type: "walkway" as const, bidirectional: true, lengthMeters: 25, widthMeters: 5, capacityPersonsPerMinute: 160, confidence: 0.8, evidenceIds: ["visible"] },
    { id: "junction_exit", sourceNodeId: "junction", targetNodeId: "exit", type: "walkway" as const, bidirectional: true, lengthMeters: 30, widthMeters: 5, capacityPersonsPerMinute: 160, confidence: 0.8, evidenceIds: ["visible"] },
  ],
  evidence: [{ id: "visible", kind: "visual_geometry" as const, description: "Visible test geometry", confidence: 0.9, region: null }],
  assumptions: ["Capacities require operator confirmation."],
};

const dependencies: Partial<AppDependencies> = {
  extract: async () => ({
    data: extractedGraph,
    provider: "openai" as const,
    model: "gpt-5.6-terra" as const,
  }),
  advise: async () => ({
    data: {
      schemaVersion: "1" as const,
      overview: "No unsupported intervention is proposed.",
      actions: [],
      operatorMessage: "Continue monitoring.",
      confidence: 1,
      noActionReason: "No active findings.",
    },
    provider: "deterministic-fallback" as const,
    model: "gpt-5.6-terra" as const,
  }),
};

const instances: ReturnType<typeof createCrowdFlowApp>[] = [];

function createTestApp() {
  const instance = createCrowdFlowApp(dependencies);
  instances.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of instances.splice(0)) instance.sessions.stopAll();
});

describe("CrowdFlow API", () => {
  it("reports readiness without exposing a credential", async () => {
    const { app } = createTestApp();
    const response = await request(app).get("/api/health").expect(200);

    expect(response.body).toMatchObject({ status: "ok", model: "gpt-5.6-terra" });
    expect(typeof response.body.aiConfigured).toBe("boolean");
    expect(response.body).not.toHaveProperty("token");
    expect(response.body).not.toHaveProperty("apiKey");
  });

  it("hard-blocks simulation until the current draft is confirmed", async () => {
    const { app } = createTestApp();
    const created = await request(app)
      .post("/api/sessions")
      .send({ presetId: "ipl-stadium", crowdSize: 55_000 })
      .expect(201);

    await request(app)
      .post(`/api/sessions/${created.body.sessionId}/sim/start`)
      .send({})
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe("CONFIRMATION_REQUIRED"));

    const confirmed = await request(app)
      .post(`/api/sessions/${created.body.sessionId}/confirm`)
      .send({
        graph: created.body.graph,
        crowdSize: created.body.crowdSize,
        schedule: created.body.schedule,
      })
      .expect(200);

    expect(confirmed.body.confirmed).toBe(true);
    const started = await request(app)
      .post(`/api/sessions/${created.body.sessionId}/sim/start`)
      .send({})
      .expect(200);
    expect(started.body.snapshot.invariants.valid).toBe(true);
  });

  it("invalidates confirmation after a graph edit", async () => {
    const { app } = createTestApp();
    const created = await request(app).post("/api/sessions").send({ presetId: "railway-station" }).expect(201);
    const sessionPath = `/api/sessions/${created.body.sessionId}`;

    await request(app).post(`${sessionPath}/confirm`).send({
      graph: created.body.graph,
      crowdSize: created.body.crowdSize,
      schedule: created.body.schedule,
    }).expect(200);

    const editedGraph = {
      ...created.body.graph,
      nodes: created.body.graph.nodes.map((node: { id: string; label: string }) =>
        node.id === created.body.graph.nodes[0].id ? { ...node, label: `${node.label} reviewed` } : node),
    };
    await request(app).put(`${sessionPath}/graph`).send({ graph: editedGraph }).expect(200);
    await request(app).post(`${sessionPath}/sim/start`).send({}).expect(409);
  });

  it("extracts an uploaded raster into an unconfirmed editable graph", async () => {
    const { app } = createTestApp();
    const response = await request(app)
      .post("/api/sessions")
      .field("presetId", "concert-arena")
      .field("crowdSize", "12000")
      .attach("image", Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        filename: "venue.png",
        contentType: "image/png",
      })
      .expect(201);

    expect(response.body.confirmed).toBe(false);
    expect(response.body.extraction.provider).toBe("openai");
    expect(response.body.graph.nodes.map((node: { id: string }) => node.id)).toContain("entry");
    expect(response.body.graph.edges.some((edge: { id: string }) => edge.id.endsWith("_reverse"))).toBe(true);
    const scheduledDemand = response.body.schedule.reduce(
      (total: number, scheduleBlock: { arrivalRatePerMinute: number; startMinute: number; endMinute: number }) =>
        total + scheduleBlock.arrivalRatePerMinute * (scheduleBlock.endMinute - scheduleBlock.startMinute),
      0,
    );
    expect(scheduledDemand).toBeCloseTo(12_000, 6);
  });

  it("scales retained initial occupancy when crowdSize is below the preset occupancy", async () => {
    const { app, sessions } = createTestApp();
    const created = await request(app)
      .post("/api/sessions")
      .send({ presetId: "ipl-stadium", crowdSize: 10_000 })
      .expect(201);
    await request(app)
      .post(`/api/sessions/${created.body.sessionId}/confirm`)
      .send({
        graph: created.body.graph,
        crowdSize: created.body.crowdSize,
        schedule: created.body.schedule,
      })
      .expect(200);

    const session = sessions.get(created.body.sessionId)!;
    const initialTotal = Object.values(session.preset.initialOccupancy)
      .reduce((total, occupancy) => total + occupancy, 0);
    const scheduledDemand = session.preset.schedule.reduce(
      (total, scheduleBlock) =>
        total + scheduleBlock.arrivalRatePerMinute * (scheduleBlock.endMinute - scheduleBlock.startMinute),
      0,
    );
    expect(initialTotal).toBeCloseTo(10_000, 6);
    expect(scheduledDemand).toBeCloseTo(0, 6);
    expect(initialTotal + scheduledDemand).toBeCloseTo(session.preset.crowdSize, 6);
  });

  it("streams deterministic snapshots through step and advice endpoints", async () => {
    const { app } = createTestApp();
    const created = await request(app).post("/api/sessions").send({ presetId: "test-narrow-corridor" }).expect(201);
    const sessionPath = `/api/sessions/${created.body.sessionId}`;
    await request(app).post(`${sessionPath}/confirm`).send({
      graph: created.body.graph,
      crowdSize: created.body.crowdSize,
      schedule: created.body.schedule,
    }).expect(200);
    const started = await request(app).post(`${sessionPath}/sim/start`).send({}).expect(200);
    expect(started.body.snapshot.forecasts.length).toBeGreaterThan(0);

    const stepped = await request(app).post(`${sessionPath}/sim/step`).send({ steps: 24 }).expect(200);
    expect(stepped.body.snapshot.tick).toBeGreaterThanOrEqual(24);
    expect(stepped.body.snapshot.invariants.valid).toBe(true);

    const advice = await request(app).post(`${sessionPath}/advice`).send({}).expect(200);
    expect(advice.body.provider).toBe("deterministic-fallback");
    expect(advice.body.findingBundle.scenarioId).toBe("test-narrow-corridor");
  });

  it("refuses a reroute that its counterfactual does not recommend", async () => {
    const { app } = createTestApp();
    const created = await request(app).post("/api/sessions").send({ presetId: "test-narrow-corridor" }).expect(201);
    const sessionPath = `/api/sessions/${created.body.sessionId}`;
    await request(app).post(`${sessionPath}/confirm`).send({
      graph: created.body.graph,
      crowdSize: created.body.crowdSize,
      schedule: created.body.schedule,
    }).expect(200);
    await request(app).post(`${sessionPath}/sim/start`).send({}).expect(200);
    await request(app).post(`${sessionPath}/sim/step`).send({ steps: 30 }).expect(200);

    const advice = await request(app).post(`${sessionPath}/advice`).send({}).expect(200);
    const rejected = advice.body.reroutes.find(
      (evaluation: { metrics: { recommended: boolean } }) => !evaluation.metrics.recommended,
    );
    expect(rejected).toBeDefined();
    await request(app)
      .post(`${sessionPath}/reroute`)
      .send({ policyId: rejected.policy.id })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe("NO_REROUTE"));
  });
});
