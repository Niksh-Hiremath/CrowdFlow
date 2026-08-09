import { z } from "zod";

const ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export const EntityIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(ID_PATTERN, "IDs must start with a lowercase letter and contain only lowercase letters, numbers, _ or -");

const NormalizedCoordinateSchema = z.number().min(0).max(1);

const EvidenceRegionSchema = z
  .object({
    xMin: NormalizedCoordinateSchema,
    yMin: NormalizedCoordinateSchema,
    xMax: NormalizedCoordinateSchema,
    yMax: NormalizedCoordinateSchema,
  })
  .strict();

export const GraphEvidenceSchema = z
  .object({
    id: EntityIdSchema,
    kind: z.enum(["visual_label", "visual_geometry", "context", "estimated"]),
    description: z.string().min(1).max(280),
    confidence: z.number().min(0).max(1),
    region: EvidenceRegionSchema.nullable(),
  })
  .strict();

export const VenueNodeSchema = z
  .object({
    id: EntityIdSchema,
    type: z.enum([
      "entry_gate",
      "walkway_junction",
      "concession",
      "seating",
      "attraction",
      "restroom",
      "emergency_exit",
      "exit",
    ]),
    label: z.string().min(1).max(100),
    x: NormalizedCoordinateSchema,
    y: NormalizedCoordinateSchema,
    capacityPersons: z.number().int().min(1).max(1_000_000),
    confidence: z.number().min(0).max(1),
    evidenceIds: z.array(EntityIdSchema).min(1).max(16),
    confirmed: z.boolean(),
  })
  .strict();

export const VenueEdgeSchema = z
  .object({
    id: EntityIdSchema,
    sourceNodeId: EntityIdSchema,
    targetNodeId: EntityIdSchema,
    type: z.enum(["walkway", "corridor", "stairs", "escalator", "bridge", "gate"]),
    bidirectional: z.boolean(),
    lengthMeters: z.number().min(0.1).max(100_000),
    widthMeters: z.number().min(0.1).max(1_000),
    capacityPersonsPerMinute: z.number().min(0.1).max(1_000_000),
    confidence: z.number().min(0).max(1),
    evidenceIds: z.array(EntityIdSchema).min(1).max(16),
  })
  .strict();

/**
 * Schema passed to OpenAI Structured Outputs. Cross-record constraints are applied
 * separately after parsing because JSON Schema cannot express referential integrity.
 */
export const VenueGraphOutputSchema = z
  .object({
    schemaVersion: z.literal("1"),
    nodes: z.array(VenueNodeSchema).min(2).max(250),
    edges: z.array(VenueEdgeSchema).min(1).max(750),
    evidence: z.array(GraphEvidenceSchema).min(1).max(1_000),
    assumptions: z.array(z.string().min(1).max(240)).max(32),
  })
  .strict();

export type VenueGraph = z.infer<typeof VenueGraphOutputSchema>;

function addDuplicateIssues(
  values: readonly string[],
  label: string,
  ctx: z.RefinementCtx,
  pathPrefix: string,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        message: `Duplicate ${label} ID: ${value}`,
        path: [pathPrefix, index, "id"],
      });
    }
    seen.add(value);
  });
}

function addDuplicateReferenceIssues(
  values: readonly string[],
  label: string,
  ctx: z.RefinementCtx,
  path: (string | number)[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        message: `Duplicate ${label} reference: ${value}`,
        path: [...path, index],
      });
    }
    seen.add(value);
  });
}

export const ValidatedVenueGraphSchema = VenueGraphOutputSchema.superRefine((graph, ctx) => {
  addDuplicateIssues(
    graph.nodes.map((node) => node.id),
    "node",
    ctx,
    "nodes",
  );
  addDuplicateIssues(
    graph.edges.map((edge) => edge.id),
    "edge",
    ctx,
    "edges",
  );
  addDuplicateIssues(
    graph.evidence.map((item) => item.id),
    "evidence",
    ctx,
    "evidence",
  );

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const evidenceIds = new Set(graph.evidence.map((item) => item.id));

  graph.evidence.forEach((item, index) => {
    if (item.region && (item.region.xMin > item.region.xMax || item.region.yMin > item.region.yMax)) {
      ctx.addIssue({
        code: "custom",
        message: `Evidence ${item.id} has an inverted region`,
        path: ["evidence", index, "region"],
      });
    }
  });

  graph.nodes.forEach((node, nodeIndex) => {
    addDuplicateReferenceIssues(node.evidenceIds, "evidence", ctx, ["nodes", nodeIndex, "evidenceIds"]);
    node.evidenceIds.forEach((evidenceId, evidenceIndex) => {
      if (!evidenceIds.has(evidenceId)) {
        ctx.addIssue({
          code: "custom",
          message: `Node ${node.id} references unknown evidence ${evidenceId}`,
          path: ["nodes", nodeIndex, "evidenceIds", evidenceIndex],
        });
      }
    });
  });

  graph.edges.forEach((edge, edgeIndex) => {
    addDuplicateReferenceIssues(edge.evidenceIds, "evidence", ctx, ["edges", edgeIndex, "evidenceIds"]);
    if (!nodeIds.has(edge.sourceNodeId)) {
      ctx.addIssue({
        code: "custom",
        message: `Edge ${edge.id} references unknown source node ${edge.sourceNodeId}`,
        path: ["edges", edgeIndex, "sourceNodeId"],
      });
    }
    if (!nodeIds.has(edge.targetNodeId)) {
      ctx.addIssue({
        code: "custom",
        message: `Edge ${edge.id} references unknown target node ${edge.targetNodeId}`,
        path: ["edges", edgeIndex, "targetNodeId"],
      });
    }
    if (edge.sourceNodeId === edge.targetNodeId) {
      ctx.addIssue({
        code: "custom",
        message: `Edge ${edge.id} cannot be a self-loop`,
        path: ["edges", edgeIndex],
      });
    }
    edge.evidenceIds.forEach((evidenceId, evidenceIndex) => {
      if (!evidenceIds.has(evidenceId)) {
        ctx.addIssue({
          code: "custom",
          message: `Edge ${edge.id} references unknown evidence ${evidenceId}`,
          path: ["edges", edgeIndex, "evidenceIds", evidenceIndex],
        });
      }
    });
  });
});

export const FindingEvidenceSchema = z
  .object({
    id: EntityIdSchema,
    kind: z.enum(["density", "flow", "queue", "speed", "capacity", "schedule", "connectivity"]),
    summary: z.string().min(1).max(280),
    nodeIds: z.array(EntityIdSchema).max(32),
    edgeIds: z.array(EntityIdSchema).max(32),
    value: z.number().finite().nullable(),
    unit: z.string().min(1).max(40).nullable(),
  })
  .strict();

export const FindingSchema = z
  .object({
    id: EntityIdSchema,
    kind: z.enum([
      "high_density",
      "stagnation",
      "queue_growth",
      "gate_imbalance",
      "schedule_spike",
      "capacity_drop",
      "disconnected_route",
    ]),
    severity: z.enum(["watch", "warning", "critical"]),
    summary: z.string().min(1).max(280),
    nodeIds: z.array(EntityIdSchema).max(32),
    edgeIds: z.array(EntityIdSchema).max(32),
    evidenceIds: z.array(EntityIdSchema).min(1).max(32),
    predictedInSeconds: z.number().min(0).max(86_400).nullable(),
  })
  .strict();

const FindingBundleShapeSchema = z
  .object({
    schemaVersion: z.literal("1"),
    scenarioId: EntityIdSchema,
    simulationTimeSeconds: z.number().min(0).max(31_536_000),
    nodeIds: z.array(EntityIdSchema).min(1).max(2_000),
    edgeIds: z.array(EntityIdSchema).max(8_000),
    evidence: z.array(FindingEvidenceSchema).max(4_000),
    findings: z.array(FindingSchema).max(500),
  })
  .strict();

export const FindingBundleSchema = FindingBundleShapeSchema.superRefine((bundle, ctx) => {
  const nodeIds = new Set(bundle.nodeIds);
  const edgeIds = new Set(bundle.edgeIds);
  const evidenceIds = new Set(bundle.evidence.map((item) => item.id));

  const addSimpleDuplicates = (values: readonly string[], label: string, path: string): void => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        ctx.addIssue({ code: "custom", message: `Duplicate ${label} ID: ${value}`, path: [path, index] });
      }
      seen.add(value);
    });
  };

  addSimpleDuplicates(bundle.nodeIds, "node", "nodeIds");
  addSimpleDuplicates(bundle.edgeIds, "edge", "edgeIds");
  addDuplicateIssues(
    bundle.evidence.map((item) => item.id),
    "evidence",
    ctx,
    "evidence",
  );
  addDuplicateIssues(
    bundle.findings.map((item) => item.id),
    "finding",
    ctx,
    "findings",
  );

  bundle.evidence.forEach((item, evidenceIndex) => {
    addDuplicateReferenceIssues(item.nodeIds, "node", ctx, ["evidence", evidenceIndex, "nodeIds"]);
    addDuplicateReferenceIssues(item.edgeIds, "edge", ctx, ["evidence", evidenceIndex, "edgeIds"]);
    item.nodeIds.forEach((nodeId, nodeIndex) => {
      if (!nodeIds.has(nodeId)) {
        ctx.addIssue({
          code: "custom",
          message: `Evidence ${item.id} references unknown node ${nodeId}`,
          path: ["evidence", evidenceIndex, "nodeIds", nodeIndex],
        });
      }
    });
    item.edgeIds.forEach((edgeId, edgeIndex) => {
      if (!edgeIds.has(edgeId)) {
        ctx.addIssue({
          code: "custom",
          message: `Evidence ${item.id} references unknown edge ${edgeId}`,
          path: ["evidence", evidenceIndex, "edgeIds", edgeIndex],
        });
      }
    });
  });

  bundle.findings.forEach((finding, findingIndex) => {
    addDuplicateReferenceIssues(finding.nodeIds, "node", ctx, ["findings", findingIndex, "nodeIds"]);
    addDuplicateReferenceIssues(finding.edgeIds, "edge", ctx, ["findings", findingIndex, "edgeIds"]);
    addDuplicateReferenceIssues(finding.evidenceIds, "evidence", ctx, ["findings", findingIndex, "evidenceIds"]);
    finding.nodeIds.forEach((nodeId, nodeIndex) => {
      if (!nodeIds.has(nodeId)) {
        ctx.addIssue({
          code: "custom",
          message: `Finding ${finding.id} references unknown node ${nodeId}`,
          path: ["findings", findingIndex, "nodeIds", nodeIndex],
        });
      }
    });
    finding.edgeIds.forEach((edgeId, edgeIndex) => {
      if (!edgeIds.has(edgeId)) {
        ctx.addIssue({
          code: "custom",
          message: `Finding ${finding.id} references unknown edge ${edgeId}`,
          path: ["findings", findingIndex, "edgeIds", edgeIndex],
        });
      }
    });
    finding.evidenceIds.forEach((evidenceId, evidenceIndex) => {
      if (!evidenceIds.has(evidenceId)) {
        ctx.addIssue({
          code: "custom",
          message: `Finding ${finding.id} references unknown evidence ${evidenceId}`,
          path: ["findings", findingIndex, "evidenceIds", evidenceIndex],
        });
      }
    });
  });
});

export type FindingBundle = z.infer<typeof FindingBundleShapeSchema>;

export const AdviceActionSchema = z
  .object({
    id: EntityIdSchema,
    type: z.enum(["reroute", "meter_entry", "open_capacity", "dispatch_staff", "stage_release", "monitor"]),
    priority: z.number().int().min(1).max(100),
    summary: z.string().min(1).max(180),
    rationale: z.string().min(1).max(400),
    findingIds: z.array(EntityIdSchema).min(1).max(16),
    nodeIds: z.array(EntityIdSchema).max(32),
    edgeIds: z.array(EntityIdSchema).max(32),
    evidenceIds: z.array(EntityIdSchema).min(1).max(32),
  })
  .strict();

export const StructuredAdviceOutputSchema = z
  .object({
    schemaVersion: z.literal("1"),
    overview: z.string().min(1).max(400),
    actions: z.array(AdviceActionSchema).max(8),
    operatorMessage: z.string().min(1).max(400),
    confidence: z.number().min(0).max(1),
    noActionReason: z.string().min(1).max(280).nullable(),
  })
  .strict();

export type StructuredAdvice = z.infer<typeof StructuredAdviceOutputSchema>;

export function validateStructuredAdvice(advice: unknown, bundle: FindingBundle): StructuredAdvice {
  const parsed = StructuredAdviceOutputSchema.parse(advice);
  const findingById = new Map(bundle.findings.map((finding) => [finding.id, finding]));
  const nodeIds = new Set(bundle.nodeIds);
  const edgeIds = new Set(bundle.edgeIds);
  const evidenceIds = new Set(bundle.evidence.map((item) => item.id));
  const actionIds = new Set<string>();

  parsed.actions.forEach((action) => {
    if (actionIds.has(action.id)) {
      throw new Error(`Duplicate action ID: ${action.id}`);
    }
    actionIds.add(action.id);

    const assertUniqueReferences = (values: readonly string[], label: string): void => {
      if (new Set(values).size !== values.length) {
        throw new Error(`Action ${action.id} contains duplicate ${label} references`);
      }
    };
    assertUniqueReferences(action.findingIds, "finding");
    assertUniqueReferences(action.nodeIds, "node");
    assertUniqueReferences(action.edgeIds, "edge");
    assertUniqueReferences(action.evidenceIds, "evidence");

    const supportedNodeIds = new Set<string>();
    const supportedEdgeIds = new Set<string>();
    const supportedEvidenceIds = new Set<string>();

    action.findingIds.forEach((findingId) => {
      const finding = findingById.get(findingId);
      if (!finding) {
        throw new Error(`Action ${action.id} references unknown finding ${findingId}`);
      }
      finding.nodeIds.forEach((id) => supportedNodeIds.add(id));
      finding.edgeIds.forEach((id) => supportedEdgeIds.add(id));
      finding.evidenceIds.forEach((id) => supportedEvidenceIds.add(id));
    });

    action.nodeIds.forEach((id) => {
      if (!nodeIds.has(id) || !supportedNodeIds.has(id)) {
        throw new Error(`Action ${action.id} has an unsupported node reference ${id}`);
      }
    });
    action.edgeIds.forEach((id) => {
      if (!edgeIds.has(id) || !supportedEdgeIds.has(id)) {
        throw new Error(`Action ${action.id} has an unsupported edge reference ${id}`);
      }
    });
    action.evidenceIds.forEach((id) => {
      if (!evidenceIds.has(id) || !supportedEvidenceIds.has(id)) {
        throw new Error(`Action ${action.id} has an unsupported evidence reference ${id}`);
      }
    });
  });

  if (parsed.actions.length === 0 && parsed.noActionReason === null) {
    throw new Error("Advice with no actions must include noActionReason");
  }
  if (parsed.actions.length > 0 && parsed.noActionReason !== null) {
    throw new Error("Advice with actions must set noActionReason to null");
  }

  return {
    ...parsed,
    actions: [...parsed.actions].sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id)),
  };
}

const SEVERITY_ORDER: Record<z.infer<typeof FindingSchema>["severity"], number> = {
  critical: 0,
  warning: 1,
  watch: 2,
};

/** Canonical ordering makes the exact FindingBundle prompt stable across callers. */
export function parseFindingBundle(input: unknown): FindingBundle {
  const parsed = FindingBundleSchema.parse(input);

  return {
    ...parsed,
    nodeIds: [...parsed.nodeIds].sort(),
    edgeIds: [...parsed.edgeIds].sort(),
    evidence: [...parsed.evidence]
      .map((item) => ({
        ...item,
        nodeIds: [...item.nodeIds].sort(),
        edgeIds: [...item.edgeIds].sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    findings: [...parsed.findings]
      .map((finding) => ({
        ...finding,
        nodeIds: [...finding.nodeIds].sort(),
        edgeIds: [...finding.edgeIds].sort(),
        evidenceIds: [...finding.evidenceIds].sort(),
      }))
      .sort(
        (left, right) =>
          SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] || left.id.localeCompare(right.id),
      ),
  };
}
