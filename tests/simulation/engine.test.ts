import { describe, expect, it } from "vitest";
import { makeFallbackAdvice } from "../../src/server/ai/fallbacks";
import { parseFindingBundle, validateStructuredAdvice } from "../../src/server/ai/schemas";
import { requireVenuePreset } from "../../src/shared/presets";
import {
  createSimulationEngine,
  toFindingBundle,
  type ReroutePolicy,
} from "../../src/server/simulation";

describe("conservation-based crowd simulation", () => {
  it("conserves people and respects every storage and flow capacity", () => {
    const engine = createSimulationEngine(requireVenuePreset("test-narrow-corridor"));
    for (let tick = 0; tick < 210; tick += 1) {
      const snapshot = engine.step();
      expect(snapshot.invariants.valid).toBe(true);
      expect(snapshot.invariants.massBalanceErrorPeople).toBeLessThan(1e-5);
      expect(snapshot.invariants.nonNegative).toBe(true);
      expect(snapshot.invariants.withinStorageCapacity).toBe(true);
      expect(snapshot.invariants.withinFlowCapacity).toBe(true);
    }
    const final = engine.getSnapshot();
    expect(final.metrics.generatedPeople).toBeCloseTo(600, 6);
    expect(final.metrics.exitedPeople).toBeGreaterThan(0);
  });

  it("switches targets at the explicit egress schedule boundary", () => {
    const engine = createSimulationEngine(requireVenuePreset("test-narrow-corridor"));
    const beforeEgress = engine.runUntil(19.5);
    expect(beforeEgress.activeScheduleBlockId).toBe("corridor_event");
    expect(beforeEgress.metrics.exitedPeople).toBeCloseTo(0, 8);

    const afterEgress = engine.runUntil(25);
    expect(afterEgress.activeScheduleBlockId).toBe("corridor_egress");
    expect(afterEgress.metrics.exitedPeople).toBeGreaterThan(0);
  });

  it("is deterministic for identical scenario and configuration", () => {
    const left = createSimulationEngine(requireVenuePreset("test-parallel-routes"));
    const right = createSimulationEngine(requireVenuePreset("test-parallel-routes"));
    expect(left.step(90)).toEqual(right.step(90));
  });

  it("forecasts both the location and onset time of a capacity failure", () => {
    const engine = createSimulationEngine(requireVenuePreset("test-narrow-corridor"));
    const forecast = engine.forecast(10);
    expect(forecast.length).toBeGreaterThan(0);
    expect(forecast.some((item) => item.locationId === "corridor_gate")).toBe(true);
    expect(forecast.every((item) => item.predictedOnsetMinute >= 0 && item.leadTimeMinutes <= 10)).toBe(true);
    expect(forecast.every((item) => item.predictedPeakOccupancyRatio >= 0.75)).toBe(true);
  });

  it("grounds forecast-only risks and their fallback actions before a bottleneck is active", () => {
    const preset = requireVenuePreset("test-narrow-corridor");
    const engine = createSimulationEngine(preset);
    const snapshot = engine.getSnapshot();
    expect(snapshot.bottlenecks).toEqual([]);

    const forecast = engine.forecast(10);
    const bundle = toFindingBundle(preset, snapshot, { forecast });
    const parsed = parseFindingBundle(bundle);
    const predicted = parsed.findings.find((finding) => finding.kind === "schedule_spike");
    expect(predicted).toBeDefined();
    expect(predicted?.predictedInSeconds).toBeGreaterThan(0);
    expect(predicted?.nodeIds).toContain("corridor_gate");
    expect(predicted?.evidenceIds.length).toBeGreaterThan(0);

    const fallback = makeFallbackAdvice(parsed);
    expect(() => validateStructuredAdvice(fallback, parsed)).not.toThrow();
    expect(fallback.actions.some((action) => action.findingIds.includes(predicted!.id))).toBe(true);
  });

  it("applies route controls and produces before/after counterfactual metrics", () => {
    const engine = createSimulationEngine(requireVenuePreset("test-parallel-routes"));
    const before = engine.getSnapshot().routes.find(
      (route) => route.originNodeId === "parallel_gate" && route.targetNodeId === "parallel_hall",
    );
    expect(before?.primary?.edgeIds).toContain("parallel_fork_north_ab");

    const policy: ReroutePolicy = {
      id: "wide_branch",
      label: "Use the wide branch",
      avoidEdgeIds: ["parallel_fork_north_ab"],
      penaltyMultiplier: 100,
      compliance: 1,
    };
    const evaluation = engine.evaluateReroute(policy, 8);
    expect(evaluation.metrics.horizonMinutes).toBe(8);
    expect(Number.isFinite(evaluation.metrics.peakOccupancyRatioDelta)).toBe(true);
    expect(Number.isFinite(evaluation.metrics.congestionExposureDeltaPersonMinutes)).toBe(true);
    expect(Number.isFinite(evaluation.metrics.exitedPeopleDelta)).toBe(true);

    const after = engine.applyReroute(policy).routes.find(
      (route) => route.originNodeId === "parallel_gate" && route.targetNodeId === "parallel_hall",
    );
    expect(after?.primary?.edgeIds).toContain("parallel_fork_south_ab");
    expect(after?.primary?.edgeIds).not.toContain("parallel_fork_north_ab");
  });

  it("adapts persisted simulator findings to the validated AI boundary", () => {
    const preset = requireVenuePreset("test-narrow-corridor");
    const engine = createSimulationEngine(preset);
    const snapshot = engine.runUntil(5);
    expect(snapshot.bottlenecks.length).toBeGreaterThan(0);
    const bundle = toFindingBundle(preset, snapshot);
    expect(() => parseFindingBundle(bundle)).not.toThrow();
    expect(bundle.findings).toHaveLength(snapshot.bottlenecks.length);
    expect(bundle.evidence.length).toBeGreaterThanOrEqual(snapshot.bottlenecks.length);
    expect(bundle.evidence.some((item) => item.kind === "schedule")).toBe(true);
  });
});
