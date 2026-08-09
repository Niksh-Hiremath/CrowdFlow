import {
  StructuredAdviceOutputSchema,
  ValidatedVenueGraphSchema,
  type FindingBundle,
  type StructuredAdvice,
  type VenueGraph,
} from "./schemas.js";

const FALLBACK_GRAPH: VenueGraph = {
  schemaVersion: "1",
  nodes: [
    {
      id: "entry_main",
      type: "entry_gate",
      label: "Main Entry",
      x: 0.12,
      y: 0.5,
      capacityPersons: 160,
      confidence: 0,
      evidenceIds: ["evidence_manual_template"],
      confirmed: false,
    },
    {
      id: "junction_center",
      type: "walkway_junction",
      label: "Central Junction",
      x: 0.5,
      y: 0.5,
      capacityPersons: 240,
      confidence: 0,
      evidenceIds: ["evidence_manual_template"],
      confirmed: false,
    },
    {
      id: "attraction_main",
      type: "attraction",
      label: "Main Attraction",
      x: 0.5,
      y: 0.2,
      capacityPersons: 500,
      confidence: 0,
      evidenceIds: ["evidence_manual_template"],
      confirmed: false,
    },
    {
      id: "exit_main",
      type: "exit",
      label: "Main Exit",
      x: 0.88,
      y: 0.5,
      capacityPersons: 160,
      confidence: 0,
      evidenceIds: ["evidence_manual_template"],
      confirmed: false,
    },
  ],
  edges: [
    {
      id: "edge_entry_center",
      sourceNodeId: "entry_main",
      targetNodeId: "junction_center",
      type: "walkway",
      bidirectional: true,
      lengthMeters: 40,
      widthMeters: 4,
      capacityPersonsPerMinute: 120,
      confidence: 0,
      evidenceIds: ["evidence_manual_template"],
    },
    {
      id: "edge_center_attraction",
      sourceNodeId: "junction_center",
      targetNodeId: "attraction_main",
      type: "walkway",
      bidirectional: true,
      lengthMeters: 30,
      widthMeters: 4,
      capacityPersonsPerMinute: 120,
      confidence: 0,
      evidenceIds: ["evidence_manual_template"],
    },
    {
      id: "edge_center_exit",
      sourceNodeId: "junction_center",
      targetNodeId: "exit_main",
      type: "walkway",
      bidirectional: true,
      lengthMeters: 40,
      widthMeters: 4,
      capacityPersonsPerMinute: 120,
      confidence: 0,
      evidenceIds: ["evidence_manual_template"],
    },
  ],
  evidence: [
    {
      id: "evidence_manual_template",
      kind: "estimated",
      description: "Deterministic editable template; no image claim is made.",
      confidence: 0,
      region: null,
    },
  ],
  assumptions: ["Every fallback node and edge requires visual confirmation before simulation."],
};

export function makeFallbackVenueGraph(): VenueGraph {
  return ValidatedVenueGraphSchema.parse(FALLBACK_GRAPH);
}

const ACTION_TYPE_BY_FINDING: Record<
  FindingBundle["findings"][number]["kind"],
  StructuredAdvice["actions"][number]["type"]
> = {
  high_density: "reroute",
  stagnation: "reroute",
  queue_growth: "dispatch_staff",
  gate_imbalance: "meter_entry",
  schedule_spike: "stage_release",
  capacity_drop: "open_capacity",
  disconnected_route: "monitor",
};

export function makeFallbackAdvice(bundle: FindingBundle): StructuredAdvice {
  const selectedFindings = bundle.findings.slice(0, 3);
  const actions = selectedFindings.map((finding, index) => ({
    id: `fallback_action_${index + 1}`,
    type: ACTION_TYPE_BY_FINDING[finding.kind],
    priority: index + 1,
    summary: `Respond to ${finding.kind.replaceAll("_", " ")}`,
    rationale: `${finding.summary} This action is grounded only in finding ${finding.id}.`,
    findingIds: [finding.id],
    nodeIds: [...finding.nodeIds],
    edgeIds: [...finding.edgeIds],
    evidenceIds: [...finding.evidenceIds],
  }));

  return StructuredAdviceOutputSchema.parse({
    schemaVersion: "1",
    overview:
      actions.length > 0
        ? `Deterministic response prepared for ${actions.length} active finding${actions.length === 1 ? "" : "s"}.`
        : "No active deterministic findings require an intervention.",
    actions,
    operatorMessage:
      actions.length > 0
        ? "Review the ranked, evidence-linked actions before applying them to the simulation."
        : "Continue monitoring the current simulation state.",
    confidence: actions.length > 0 ? 0.65 : 1,
    noActionReason: actions.length > 0 ? null : "The FindingBundle contains no active findings.",
  });
}
