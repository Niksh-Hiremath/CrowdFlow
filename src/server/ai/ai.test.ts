import { describe, expect, it } from "vitest";
import { makeFallbackAdvice, makeFallbackVenueGraph } from "./fallbacks.js";
import {
  FindingBundleSchema,
  ValidatedVenueGraphSchema,
  parseFindingBundle,
  validateStructuredAdvice,
} from "./schemas.js";

const validBundle = {
  schemaVersion: "1" as const,
  scenarioId: "scenario_a",
  simulationTimeSeconds: 120,
  nodeIds: ["gate_a", "junction_a"],
  edgeIds: ["edge_a"],
  evidence: [
    {
      id: "evidence_a",
      kind: "density" as const,
      summary: "Gate density crossed the critical threshold.",
      nodeIds: ["gate_a"],
      edgeIds: [],
      value: 0.92,
      unit: "ratio",
    },
  ],
  findings: [
    {
      id: "finding_a",
      kind: "high_density" as const,
      severity: "critical" as const,
      summary: "Gate A is critically dense.",
      nodeIds: ["gate_a"],
      edgeIds: [],
      evidenceIds: ["evidence_a"],
      predictedInSeconds: 0,
    },
  ],
};

describe("AI boundary validation", () => {
  it("produces a referentially valid deterministic graph", () => {
    expect(ValidatedVenueGraphSchema.safeParse(makeFallbackVenueGraph()).success).toBe(true);
  });

  it("rejects dangling graph node and evidence references", () => {
    const graph = makeFallbackVenueGraph();
    graph.edges[0] = {
      ...graph.edges[0],
      sourceNodeId: "missing_node",
      evidenceIds: ["missing_evidence"],
    };

    expect(ValidatedVenueGraphSchema.safeParse(graph).success).toBe(false);
  });

  it("rejects duplicate and dangling FindingBundle IDs", () => {
    const invalid = {
      ...validBundle,
      nodeIds: ["gate_a", "gate_a"],
      findings: [
        {
          ...validBundle.findings[0],
          evidenceIds: ["missing_evidence"],
        },
      ],
    };

    expect(FindingBundleSchema.safeParse(invalid).success).toBe(false);
  });

  it("creates deterministic advice grounded in supplied IDs", () => {
    const bundle = parseFindingBundle(validBundle);
    const advice = makeFallbackAdvice(bundle);

    expect(validateStructuredAdvice(advice, bundle)).toEqual(advice);
    expect(advice.actions[0]?.nodeIds).toEqual(["gate_a"]);
    expect(advice.actions[0]?.evidenceIds).toEqual(["evidence_a"]);
  });

  it("rejects advice that invents an ID", () => {
    const bundle = parseFindingBundle(validBundle);
    const advice = makeFallbackAdvice(bundle);
    advice.actions[0] = { ...advice.actions[0], nodeIds: ["invented_node"] };

    expect(() => validateStructuredAdvice(advice, bundle)).toThrow(/unsupported node reference/);
  });
});
