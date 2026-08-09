import { describe, expect, it } from "vitest";
import { parseFindingBundle } from "../../src/server/ai/schemas";
import {
  createSimulationEngine,
  toFindingBundle,
  type RuntimeSnapshot,
} from "../../src/server/simulation";
import type { VenuePreset } from "../../src/shared/types";

const makeTraversalPreset = (crowdSize: number, arrivalRatePerMinute: number): VenuePreset => ({
  id: `speed-test-${crowdSize}`,
  name: "Occupancy-dependent traversal test",
  shortName: "Speed test",
  description: "A controlled edge used to verify that density changes cohort travel time.",
  category: "test_corridor",
  imagePath: "/test-layouts/grand-central-terminal.png",
  crowdSize,
  durationMinutes: 4,
  graph: {
    nodes: [
      {
        id: "speed_gate",
        label: "Speed Gate",
        type: "entry_gate",
        x: 0.1,
        y: 0.5,
        capacityPeople: 200,
        maxThroughputPerMinute: 1_000,
      },
      {
        id: "speed_hall",
        label: "Speed Hall",
        type: "attraction",
        x: 0.7,
        y: 0.5,
        capacityPeople: 200,
        maxThroughputPerMinute: 1_000,
      },
      {
        id: "speed_exit",
        label: "Speed Exit",
        type: "exit",
        x: 0.95,
        y: 0.5,
        capacityPeople: 200,
        maxThroughputPerMinute: 1_000,
      },
    ],
    edges: [
      {
        id: "speed_gate_hall",
        source: "speed_gate",
        target: "speed_hall",
        lengthMeters: 60,
        widthMeters: 4,
        capacityPeople: 100,
        maxFlowPerMinute: 1_000,
        freeSpeedMps: 1,
      },
      {
        id: "speed_hall_exit",
        source: "speed_hall",
        target: "speed_exit",
        lengthMeters: 10,
        widthMeters: 4,
        capacityPeople: 200,
        maxFlowPerMinute: 1_000,
        freeSpeedMps: 1,
      },
    ],
  },
  initialOccupancy: {},
  schedule: [
    {
      id: "speed_arrival",
      label: "Controlled arrival",
      startMinute: 0,
      endMinute: 1,
      phase: "arrival",
      arrivalRatePerMinute,
      entryWeights: { speed_gate: 1 },
      targetWeights: { speed_hall: 1 },
      rerouteCompliance: 1,
    },
    {
      id: "speed_hold",
      label: "Hall hold",
      startMinute: 1,
      endMinute: 2,
      phase: "event",
      arrivalRatePerMinute: 0,
      entryWeights: {},
      targetWeights: { speed_hall: 1 },
      rerouteCompliance: 1,
    },
    {
      id: "speed_egress",
      label: "Controlled egress",
      startMinute: 2,
      endMinute: 4,
      phase: "egress",
      arrivalRatePerMinute: 0,
      entryWeights: {},
      targetWeights: { speed_exit: 1 },
      rerouteCompliance: 1,
    },
  ],
});

const outsideQueuePreset: VenuePreset = {
  id: "outside-queue-test",
  name: "Outside queue pressure test",
  shortName: "Queue test",
  description: "A slow admission gate feeding an uncongested interior.",
  category: "test_corridor",
  imagePath: "/test-layouts/grand-central-terminal.png",
  crowdSize: 200,
  durationMinutes: 5,
  graph: {
    nodes: [
      {
        id: "queue_gate",
        label: "Queue Gate",
        type: "entry_gate",
        x: 0.1,
        y: 0.5,
        capacityPeople: 100,
        maxThroughputPerMinute: 10,
      },
      {
        id: "queue_hall",
        label: "Queue Hall",
        type: "attraction",
        x: 0.7,
        y: 0.5,
        capacityPeople: 500,
        maxThroughputPerMinute: 200,
      },
      {
        id: "queue_exit",
        label: "Queue Exit",
        type: "exit",
        x: 0.95,
        y: 0.5,
        capacityPeople: 200,
        maxThroughputPerMinute: 200,
      },
    ],
    edges: [
      {
        id: "queue_gate_hall",
        source: "queue_gate",
        target: "queue_hall",
        lengthMeters: 10,
        widthMeters: 8,
        capacityPeople: 500,
        maxFlowPerMinute: 200,
        freeSpeedMps: 1,
      },
      {
        id: "queue_hall_exit",
        source: "queue_hall",
        target: "queue_exit",
        lengthMeters: 10,
        widthMeters: 8,
        capacityPeople: 500,
        maxFlowPerMinute: 200,
        freeSpeedMps: 1,
      },
    ],
  },
  initialOccupancy: {},
  schedule: [
    {
      id: "queue_arrival",
      label: "Arrival surge",
      startMinute: 0,
      endMinute: 2,
      phase: "arrival",
      arrivalRatePerMinute: 100,
      entryWeights: { queue_gate: 1 },
      targetWeights: { queue_hall: 1 },
      rerouteCompliance: 1,
    },
    {
      id: "queue_hold",
      label: "Hall hold",
      startMinute: 2,
      endMinute: 3,
      phase: "event",
      arrivalRatePerMinute: 0,
      entryWeights: {},
      targetWeights: { queue_hall: 1 },
      rerouteCompliance: 1,
    },
    {
      id: "queue_egress",
      label: "Queue egress",
      startMinute: 3,
      endMinute: 5,
      phase: "egress",
      arrivalRatePerMinute: 0,
      entryWeights: {},
      targetWeights: { queue_exit: 1 },
      rerouteCompliance: 1,
    },
  ],
};

describe("simulation correctness regressions", () => {
  it("uses occupancy-dependent speed to delay cohorts while conserving mass", () => {
    const lowDensity = createSimulationEngine(makeTraversalPreset(1, 6));
    const highDensity = createSimulationEngine(makeTraversalPreset(100, 600));

    const lowFirst = lowDensity.step();
    const highFirst = highDensity.step();
    expect(lowFirst.edges.speed_gate_hall?.speedFactor).toBeGreaterThan(
      highFirst.edges.speed_gate_hall?.speedFactor ?? 1,
    );

    for (let tick = 1; tick < 8; tick += 1) {
      const low = lowDensity.step();
      const high = highDensity.step();
      expect(low.invariants.valid).toBe(true);
      expect(high.invariants.valid).toBe(true);
      expect(low.invariants.massBalanceErrorPeople).toBeLessThan(1e-5);
      expect(high.invariants.massBalanceErrorPeople).toBeLessThan(1e-5);
    }

    const lowFinal = lowDensity.getSnapshot();
    const highFinal = highDensity.getSnapshot();
    expect(lowFinal.nodes.speed_hall?.occupancyPeople).toBeGreaterThan(0);
    expect(highFinal.nodes.speed_hall?.occupancyPeople).toBe(0);
    expect(highFinal.edges.speed_gate_hall?.occupancyPeople).toBeCloseTo(100, 8);
  });

  it("reports outside queues as pressure rather than physical node occupancy", () => {
    const engine = createSimulationEngine(outsideQueuePreset);
    const snapshot = engine.runUntil(1.5);
    const gate = snapshot.bottlenecks.find((item) => item.locationId === "queue_gate");

    expect(gate).toBeDefined();
    expect(gate?.reason).toBe("gate_imbalance");
    expect(gate?.occupancyRatio).toBeCloseTo(0, 8);
    expect(gate?.pressureRatio).toBeGreaterThanOrEqual(0.9);
    expect(gate?.outsideQueuePeople).toBeGreaterThan(100);
    expect(snapshot.invariants.valid).toBe(true);

    const bundle = parseFindingBundle(toFindingBundle(outsideQueuePreset, snapshot));
    const queueEvidence = bundle.evidence.find((item) => item.kind === "queue");
    const densityEvidence = bundle.evidence.find((item) => item.kind === "density");
    expect(queueEvidence?.summary).toContain("waiting outside");
    expect(queueEvidence?.unit).toBe("people");
    expect(queueEvidence?.value).toBeGreaterThan(100);
    expect(densityEvidence?.summary).toContain("physical occupancy is 0.0%");
    expect(densityEvidence?.value).toBeCloseTo(0, 8);
  });

  it("binds reroute evidence to a congested primary and same-OD alternative", async () => {
    const { requireVenuePreset } = await import("../../src/shared/presets");
    const preset = requireVenuePreset("test-parallel-routes");
    const base = createSimulationEngine(preset).getSnapshot();
    const snapshot: RuntimeSnapshot = {
      ...base,
      bottlenecks: [
        {
          id: "bottleneck:edge:parallel_fork_north_ab",
          locationType: "edge",
          locationId: "parallel_fork_north_ab",
          label: "Short narrow branch",
          reason: "high_density",
          severity: "warning",
          occupancyRatio: 0.8,
          pressureRatio: 0.8,
          outsideQueuePeople: 0,
          inflowPeoplePerMinute: 20,
          outflowPeoplePerMinute: 10,
          firstObservedMinute: 0,
          detectedAtMinute: 0,
          durationMinutes: 1,
          trendPerMinute: 0,
        },
      ],
      routes: [
        {
          id: "unrelated_route",
          originNodeId: "parallel_gate",
          targetNodeId: "parallel_fork",
          primary: {
            nodeIds: ["parallel_gate", "parallel_fork"],
            edgeIds: ["parallel_gate_fork_ab"],
            costMinutes: 0.4,
            freeFlowMinutes: 0.4,
          },
          alternatives: [
            {
              nodeIds: ["parallel_gate", "parallel_fork"],
              edgeIds: ["parallel_gate_fork_ab"],
              costMinutes: 0.4,
              freeFlowMinutes: 0.4,
            },
          ],
          affectedPeopleEstimate: 0,
          validAtMinute: 0,
        },
        {
          id: "related_route",
          originNodeId: "parallel_fork",
          targetNodeId: "parallel_hall",
          primary: {
            nodeIds: ["parallel_fork", "parallel_north", "parallel_hall"],
            edgeIds: ["parallel_fork_north_ab", "parallel_north_hall_ab"],
            costMinutes: 1,
            freeFlowMinutes: 1,
          },
          alternatives: [
            {
              nodeIds: ["parallel_fork", "parallel_south", "parallel_hall"],
              edgeIds: ["parallel_fork_south_ab", "parallel_south_hall_ab"],
              costMinutes: 1.5,
              freeFlowMinutes: 1.5,
            },
          ],
          affectedPeopleEstimate: 0,
          validAtMinute: 0,
        },
      ],
    };

    const bundle = parseFindingBundle(toFindingBundle(preset, snapshot));
    const routeEvidence = bundle.evidence.find((item) => item.kind === "connectivity");
    expect(routeEvidence?.summary).toContain("parallel_fork to parallel_hall");
    expect(routeEvidence?.edgeIds).toContain("parallel_fork_north_ab");
    expect(routeEvidence?.edgeIds).toContain("parallel_fork_south_ab");
    expect(routeEvidence?.edgeIds).not.toContain("parallel_gate_fork_ab");
  });
});
