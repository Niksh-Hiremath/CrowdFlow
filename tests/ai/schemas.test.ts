import { describe, expect, it } from "vitest";
import { makeFallbackAdvice, makeFallbackVenueGraph } from "../../src/server/ai/fallbacks";
import {
  FindingBundleSchema,
  ValidatedVenueGraphSchema,
  validateStructuredAdvice,
  type FindingBundle,
} from "../../src/server/ai/schemas";

const bundle: FindingBundle = {
  schemaVersion: "1",
  scenarioId: "stadium_demo",
  simulationTimeSeconds: 7_200,
  nodeIds: ["gate_north", "junction_a"],
  edgeIds: ["edge_gate_a"],
  evidence: [
    {
      id: "evidence_density_a",
      kind: "density",
      summary: "Junction A is at 92% of its configured occupancy capacity.",
      nodeIds: ["junction_a"],
      edgeIds: ["edge_gate_a"],
      value: 0.92,
      unit: "ratio",
    },
  ],
  findings: [
    {
      id: "finding_density_a",
      kind: "high_density",
      severity: "critical",
      summary: "Sustained critical density at Junction A.",
      nodeIds: ["junction_a"],
      edgeIds: ["edge_gate_a"],
      evidenceIds: ["evidence_density_a"],
      predictedInSeconds: 0,
    },
  ],
};

describe("AI boundary schemas", () => {
  it("accepts the deterministic fallback graph as an unconfirmed draft", () => {
    const graph = makeFallbackVenueGraph();
    expect(ValidatedVenueGraphSchema.parse(graph).nodes.every((node) => !node.confirmed)).toBe(true);
  });

  it("builds fallback advice using only supplied evidence IDs", () => {
    const parsedBundle = FindingBundleSchema.parse(bundle);
    const advice = makeFallbackAdvice(parsedBundle);
    expect(advice.actions).toHaveLength(1);
    expect(advice.actions[0]?.findingIds).toEqual(["finding_density_a"]);
    expect(advice.actions[0]?.evidenceIds).toEqual(["evidence_density_a"]);
  });

  it("rejects model advice that invents a graph node", () => {
    const advice = makeFallbackAdvice(bundle);
    const invented = {
      ...advice,
      actions: advice.actions.map((action) => ({ ...action, nodeIds: ["invented_exit"] })),
    };
    expect(() => validateStructuredAdvice(invented, bundle)).toThrow(/unsupported node reference/i);
  });

  it("rejects findings with unknown evidence", () => {
    const invalid = {
      ...bundle,
      findings: [{ ...bundle.findings[0], evidenceIds: ["missing_evidence"] }],
    };
    expect(() => FindingBundleSchema.parse(invalid)).toThrow(/unknown evidence/i);
  });
});
