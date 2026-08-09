import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DEFAULT_PRESET_ID,
  VENUE_PRESETS,
  requireVenuePreset,
} from "../shared/presets";
import {
  isEntryNode,
  isExitNode,
  type ScheduleBlock,
  type VenueGraph,
  type VenueNode,
  type VenueNodeType,
  type VenuePreset,
} from "../shared/types";
import { api, type AdviceResponse, type RuntimeSnapshot } from "./api";

type Screen = "setup" | "review" | "live";
type LayerKey = "network" | "crowd" | "risk" | "routes" | "labels";

interface LayerState {
  network: boolean;
  crowd: boolean;
  risk: boolean;
  routes: boolean;
  labels: boolean;
}

interface RiskItem {
  node: VenueNode;
  score: number;
  level: "WATCH" | "WARNING" | "CRITICAL";
  timing: string;
  timingLabel: "TO ONSET" | "ACTIVE" | "DENSITY";
}

const DEFAULT_LAYERS: LayerState = {
  network: true,
  crowd: true,
  risk: true,
  routes: true,
  labels: true,
};

const OPERATOR_PRESET_CATEGORIES = new Set<VenuePreset["category"]>([
  "ipl_stadium",
  "concert",
  "railway_station",
  "airport",
  "large_festival",
  "test_corridor",
  "test_parallel_routes",
]);

const NODE_SYMBOL: Record<VenueNodeType, string> = {
  entry_gate: "IN",
  walkway_junction: "+",
  concession: "FC",
  seating: "ST",
  attraction: "★",
  restroom: "WC",
  exit: "EX",
  emergency_exit: "EM",
  security: "SC",
  platform: "PF",
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const cloneGraph = (graph: VenueGraph): VenueGraph => ({
  nodes: graph.nodes.map((node) => ({ ...node })),
  edges: graph.edges.map((edge) => ({ ...edge })),
});

const cloneSchedule = (schedule: readonly ScheduleBlock[]): ScheduleBlock[] =>
  schedule.map((block) => ({
    ...block,
    entryWeights: { ...block.entryWeights },
    targetWeights: { ...block.targetWeights },
  }));

const formatMinute = (minute: number) => {
  const total = Math.max(0, Math.round(minute));
  return `${Math.floor(total / 60)
    .toString()
    .padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
};

const parseMinute = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const riskForNode = (node: VenueNode, index: number, minute: number) => {
  const hotspot = ["concession", "security", "platform", "walkway_junction"].includes(
    node.type,
  )
    ? 0.2
    : 0;
  const wave = (Math.sin(minute / 7 + index * 1.73) + 1) / 2;
  return clamp(0.29 + hotspot + wave * 0.43, 0, 0.98);
};

const riskLevel = (score: number): RiskItem["level"] =>
  score >= 0.82 ? "CRITICAL" : score >= 0.65 ? "WARNING" : "WATCH";

const compactNumber = new Intl.NumberFormat("en-IN", { notation: "compact" });

function validateGraph(graph: VenueGraph) {
  const entries = graph.nodes.filter(isEntryNode);
  const exits = graph.nodes.filter(isExitNode);
  const exitIds = new Set(exits.map((node) => node.id));
  const adjacency = new Map<string, string[]>();

  graph.edges.forEach((edge) => {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  });

  const entryHasExit = (entry: VenueNode) => {
    const seen = new Set([entry.id]);
    const queue = [entry.id];
    while (queue.length) {
      const current = queue.shift();
      if (!current) break;
      if (exitIds.has(current)) return true;
      for (const next of adjacency.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };

  return [
    { label: "At least one entry gate", pass: entries.length > 0 },
    { label: "At least one marked exit", pass: exits.length > 0 },
    { label: "Every entry reaches an exit", pass: entries.length > 0 && entries.every(entryHasExit) },
    { label: "All capacities are positive", pass: graph.nodes.every((node) => node.capacityPeople > 0) },
  ];
}

export function App() {
  const initialPreset = requireVenuePreset(DEFAULT_PRESET_ID);
  const [screen, setScreen] = useState<Screen>("setup");
  const [presetId, setPresetId] = useState(initialPreset.id);
  const [graph, setGraph] = useState<VenueGraph>(() => cloneGraph(initialPreset.graph));
  const [schedule, setSchedule] = useState<ScheduleBlock[]>(() => cloneSchedule(initialPreset.schedule));
  const [crowdSize, setCrowdSize] = useState(initialPreset.crowdSize);
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Choose a venue and scenario to begin.");

  const selectedPreset = requireVenuePreset(presetId);

  useEffect(() => () => {
    if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
  }, [uploadPreviewUrl]);

  const selectPreset = (preset: VenuePreset) => {
    setPresetId(preset.id);
    setGraph(cloneGraph(preset.graph));
    setSchedule(cloneSchedule(preset.schedule));
    setCrowdSize(preset.crowdSize);
    setUploadName("");
    setUploadFile(null);
    setUploadPreviewUrl("");
    setInitialSnapshot(null);
    setSessionId(null);
    setConfirmed(false);
    setStatus(`${preset.shortName} scenario loaded.`);
  };

  const beginReview = async () => {
    setBusy(true);
    setStatus("Extracting a draft navigation graph…");
    let completed = false;
    try {
      const response = await api.createSession({
        presetId,
        crowdSize,
        schedule,
        layoutFile: uploadFile,
      });
      setSessionId(response.sessionId);
      if (response.graph) setGraph(cloneGraph(response.graph));
      if (response.schedule) setSchedule(cloneSchedule(response.schedule));
      if (response.crowdSize) setCrowdSize(response.crowdSize);
      const source = response.extraction?.provider === "openai"
        ? "OpenAI extracted"
        : response.extraction?.provider === "deterministic-fallback"
          ? "Fallback extracted"
          : "Curated preset";
      setStatus(`${source} draft ready. Review every route before confirming.`);
      completed = true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Graph extraction failed. Check the layout and try again.");
      return;
    } finally {
      setBusy(false);
      if (completed) setScreen("review");
    }
  };

  const updateGraph = useCallback((nextGraph: VenueGraph) => {
    setGraph(nextGraph);
    setConfirmed(false);
    setStatus("Graph changed. Confirmation is required again.");
  }, []);

  const changeScreen = (next: Screen) => {
    if (next === "review" && screen === "setup") return;
    if (next === "live" && !confirmed) return;
    setScreen(next);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="topbar">
        <div className="brand-block" aria-label="CrowdFlow Operations">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <div><strong>CROWDFLOW</strong><span>LIVE OPERATIONS</span></div>
        </div>
        <nav className="stepper" aria-label="Workflow">
          {(["setup", "review", "live"] as const).map((step, index) => (
            <button
              key={step}
              type="button"
              className={screen === step ? "step active" : "step"}
              onClick={() => changeScreen(step)}
              disabled={(step === "review" && screen === "setup") || (step === "live" && !confirmed)}
              aria-current={screen === step ? "step" : undefined}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>{step}
            </button>
          ))}
        </nav>
        <div className="system-state"><span className="status-dot" />SYSTEM READY</div>
      </header>

      <p className="sr-only" aria-live="polite">{status}</p>

      <main id="main-content" className={screen === "live" ? "main live-main" : "main"}>
        {screen === "setup" && (
          <SetupScreen
            presets={VENUE_PRESETS.filter((preset) => OPERATOR_PRESET_CATEGORIES.has(preset.category))}
            selectedPreset={selectedPreset}
            crowdSize={crowdSize}
            schedule={schedule}
            uploadName={uploadName}
            busy={busy}
            onPreset={selectPreset}
            onCrowdSize={setCrowdSize}
            onSchedule={setSchedule}
            onUpload={(file) => {
              setUploadName(file?.name ?? "");
              setUploadFile(file);
              setUploadPreviewUrl(file ? URL.createObjectURL(file) : "");
              setConfirmed(false);
            }}
            onContinue={beginReview}
          />
        )}

        {screen === "review" && (
          <ReviewScreen
            graph={graph}
            crowdSize={crowdSize}
            schedule={schedule}
            preset={selectedPreset}
            backgroundPath={uploadPreviewUrl || selectedPreset.imagePath}
            confirmed={confirmed}
            sessionId={sessionId}
            onGraph={updateGraph}
            onConfirmed={(message) => {
              setConfirmed(true);
              setStatus(message);
            }}
            onStart={async () => {
              if (!confirmed || !sessionId) return;
              try {
                const response = await api.startSimulation(sessionId);
                setInitialSnapshot(response.snapshot);
              } catch (error) {
                setStatus(error instanceof Error ? error.message : "Simulation could not start.");
                return;
              }
              setScreen("live");
              setStatus("Live simulation running.");
            }}
            onBack={() => setScreen("setup")}
          />
        )}

        {screen === "live" && (
          <LiveScreen
            graph={graph}
            crowdSize={crowdSize}
            schedule={schedule}
            preset={selectedPreset}
            backgroundPath={uploadPreviewUrl || selectedPreset.imagePath}
            sessionId={sessionId}
            initialSnapshot={initialSnapshot}
            onEdit={() => setScreen("review")}
          />
        )}
      </main>
    </div>
  );
}

interface SetupProps {
  presets: readonly VenuePreset[];
  selectedPreset: VenuePreset;
  crowdSize: number;
  schedule: ScheduleBlock[];
  uploadName: string;
  busy: boolean;
  onPreset: (preset: VenuePreset) => void;
  onCrowdSize: (value: number) => void;
  onSchedule: (schedule: ScheduleBlock[]) => void;
  onUpload: (file: File | null) => void;
  onContinue: () => void;
}

function SetupScreen(props: SetupProps) {
  const updateBlock = (index: number, patch: Partial<ScheduleBlock>) => {
    props.onSchedule(props.schedule.map((block, current) => current === index ? { ...block, ...patch } : block));
  };

  const addBlock = () => {
    const base = props.schedule.at(-1) ?? props.selectedPreset.schedule[0];
    if (!base) return;
    const startMinute = props.schedule.at(-1)?.endMinute ?? 0;
    props.onSchedule([
      ...props.schedule,
      { ...base, id: `phase-${Date.now()}`, label: "New phase", startMinute, endMinute: startMinute + 30 },
    ]);
  };

  return (
    <div className="setup-layout">
      <section className="hero-panel">
        <div>
          <p className="eyebrow"><span>MISSION 03</span> REAL-TIME CROWD SAFETY</p>
          <h1>See the surge.<br /><em>Change the flow.</em></h1>
          <p className="lede">Turn venue layouts into a live, explainable crowd simulation. Spot pressure early and test safer routes before conditions become critical.</p>
        </div>
        <div className="hero-readout" aria-label="System capabilities">
          <div><strong>10 SEC</strong><span>MODEL STEP</span></div>
          <div><strong>LIVE</strong><span>RISK MAP</span></div>
          <div><strong>15 MIN</strong><span>FORECAST</span></div>
        </div>
      </section>

      <section className="panel venue-panel" aria-labelledby="venue-heading">
        <div className="section-heading">
          <div><span className="section-index">01</span><div><p>LAYOUT INPUT</p><h2 id="venue-heading">Choose a venue</h2></div></div>
          <span className="helper-copy">Real raster layouts with an editable extracted graph overlay.</span>
        </div>
        <div className="preset-grid">
          {props.presets.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className={preset.id === props.selectedPreset.id && !props.uploadName ? "preset-card selected" : "preset-card"}
              onClick={() => props.onPreset(preset)}
              aria-pressed={preset.id === props.selectedPreset.id && !props.uploadName}
            >
              <div className="preset-preview">
                <img src={preset.imagePath} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />
                <MiniGraph graph={preset.graph} />
              </div>
              <span className="preset-meta"><strong>{preset.shortName}</strong><small>{preset.category.replaceAll("_", " ")}</small></span>
              <span className="preset-crowd">{compactNumber.format(preset.crowdSize)}</span>
            </button>
          ))}
          <label className={props.uploadName ? "preset-card upload-card selected" : "preset-card upload-card"}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => props.onUpload(event.target.files?.[0] ?? null)}
            />
            <span className="upload-icon" aria-hidden="true">↑</span>
            <strong>{props.uploadName || "Upload layout"}</strong>
            <small>PNG, JPG or WEBP</small>
          </label>
        </div>
      </section>

      <div className="scenario-grid">
        <section className="panel crowd-panel" aria-labelledby="crowd-heading">
          <div className="section-heading compact"><div><span className="section-index">02</span><div><p>DEMAND</p><h2 id="crowd-heading">Expected crowd</h2></div></div></div>
          <div className="crowd-input-wrap">
            <input
              id="crowd-size"
              type="number"
              min="100"
              max="1000000"
              step="100"
              value={props.crowdSize}
              onChange={(event) => props.onCrowdSize(clamp(Number(event.target.value), 100, 1_000_000))}
              aria-label="Expected crowd size"
            />
            <span>PEOPLE</span>
          </div>
          <input
            className="pixel-range"
            type="range"
            min="1000"
            max="150000"
            step="1000"
            value={clamp(props.crowdSize, 1000, 150000)}
            onChange={(event) => props.onCrowdSize(Number(event.target.value))}
            aria-label="Expected crowd size slider"
          />
          <div className="range-labels"><span>1K</span><span>75K</span><span>150K</span></div>
        </section>

        <section className="panel schedule-panel" aria-labelledby="schedule-heading">
          <div className="section-heading compact">
            <div><span className="section-index">03</span><div><p>EVENT CLOCK</p><h2 id="schedule-heading">Schedule phases</h2></div></div>
            <button type="button" className="text-button" onClick={addBlock}>+ ADD PHASE</button>
          </div>
          <div className="schedule-list">
            {props.schedule.map((block, index) => (
              <div className="schedule-row" key={block.id}>
                <span className={`phase-chip phase-${block.phase}`}>{String(index + 1).padStart(2, "0")}</span>
                <label><span>Phase name</span><input value={block.label} onChange={(event) => updateBlock(index, { label: event.target.value })} /></label>
                <label><span>Start</span><input type="time" value={formatMinute(block.startMinute)} onChange={(event) => updateBlock(index, { startMinute: parseMinute(event.target.value) })} /></label>
                <span className="time-arrow" aria-hidden="true">→</span>
                <label><span>End</span><input type="time" value={formatMinute(block.endMinute)} onChange={(event) => updateBlock(index, { endMinute: parseMinute(event.target.value) })} /></label>
                <label><span>Arrivals/min</span><input type="number" min="0" value={block.arrivalRatePerMinute} onChange={(event) => updateBlock(index, { arrivalRatePerMinute: Math.max(0, Number(event.target.value)) })} /></label>
                <button type="button" className="icon-button" aria-label={`Remove ${block.label}`} disabled={props.schedule.length === 1} onClick={() => props.onSchedule(props.schedule.filter((_, current) => current !== index))}>×</button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="setup-footer">
        <p><span className="status-dot" /> Graph extraction can be manually corrected before any simulation starts.</p>
        <button type="button" className="primary-button" disabled={props.busy || props.schedule.length === 0} onClick={props.onContinue}>
          {props.busy ? "EXTRACTING…" : "EXTRACT & REVIEW"}<span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}

function MiniGraph({ graph }: { graph: VenueGraph }) {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  return (
    <svg className="mini-graph" viewBox="0 0 100 62" aria-hidden="true">
      <path d="M0 0h100v62H0z" className="mini-grid" />
      {graph.edges.slice(0, 22).map((edge) => {
        const source = nodesById.get(edge.source);
        const target = nodesById.get(edge.target);
        if (!source || !target) return null;
        return <line key={edge.id} x1={source.x * 100} y1={source.y * 62} x2={target.x * 100} y2={target.y * 62} />;
      })}
      {graph.nodes.slice(0, 18).map((node) => <rect key={node.id} x={node.x * 100 - 1.7} y={node.y * 62 - 1.7} width="3.4" height="3.4" />)}
    </svg>
  );
}

interface ReviewProps {
  graph: VenueGraph;
  crowdSize: number;
  schedule: ScheduleBlock[];
  preset: VenuePreset;
  backgroundPath: string;
  confirmed: boolean;
  sessionId: string | null;
  onGraph: (graph: VenueGraph) => void;
  onConfirmed: (message: string) => void;
  onStart: () => void;
  onBack: () => void;
}

function ReviewScreen(props: ReviewProps) {
  const [selectedNodeId, setSelectedNodeId] = useState(props.graph.nodes[0]?.id ?? "");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const checks = useMemo(() => validateGraph(props.graph), [props.graph]);
  const valid = checks.every((check) => check.pass) && Boolean(props.sessionId);
  const selectedNode = props.graph.nodes.find((node) => node.id === selectedNodeId);

  const confirm = async () => {
    if (!valid) return;
    setConfirming(true);
    setConfirmError("");
    try {
      await api.saveGraph(props.sessionId!, props.graph);
      const response = await api.confirmSession(props.sessionId!, { graph: props.graph, crowdSize: props.crowdSize, schedule: props.schedule });
      if (!response.confirmed) {
        setConfirmError(response.validation?.messages.join(" ") || "The server rejected this graph.");
        setConfirming(false);
        return;
      }
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : "Confirmation failed.");
      setConfirming(false);
      return;
    }
    props.onConfirmed("Graph confirmed. Simulation controls are now unlocked.");
    setConfirming(false);
  };

  const updateNode = (nodeId: string, patch: Partial<VenueNode>) => {
    props.onGraph({
      ...props.graph,
      nodes: props.graph.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node),
    });
  };

  const removeNode = () => {
    if (!selectedNode) return;
    props.onGraph({
      nodes: props.graph.nodes.filter((node) => node.id !== selectedNode.id),
      edges: props.graph.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id),
    });
    setSelectedNodeId("");
  };

  return (
    <div className="review-layout">
      <header className="screen-heading">
        <div><p className="eyebrow"><span>GRAPH TRUST GATE</span> OPERATOR REVIEW</p><h1>Review the extracted network</h1><p>Drag markers to correct their position, inspect capacities, then explicitly confirm the graph.</p></div>
        <div className="review-summary"><span>{props.graph.nodes.length}<small>NODES</small></span><span>{props.graph.edges.length}<small>LINKS</small></span><span>{compactNumber.format(props.crowdSize)}<small>PEOPLE</small></span></div>
      </header>

      <div className="review-workspace">
        <section className="map-card" aria-label="Editable venue graph">
          <div className="map-toolbar"><span className="mode-pill"><i /> EDIT MODE</span><span>Drag or use arrow keys to move a selected marker</span><div><kbd>+</kbd><kbd>−</kbd><kbd>⌖</kbd></div></div>
          <VenueViewport graph={props.graph} backgroundPath={props.backgroundPath} editable selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} onGraph={props.onGraph} layers={DEFAULT_LAYERS} minute={0} />
          <div className="map-legend"><span><i className="legend-entry" />Entry</span><span><i className="legend-poi" />POI</span><span><i className="legend-exit" />Exit</span><span><i className="legend-link" />Directed path</span></div>
        </section>

        <aside className="review-sidebar">
          <section className="panel inspector-panel">
            <div className="panel-title"><p>NODE INSPECTOR</p><span>{selectedNode ? NODE_SYMBOL[selectedNode.type] : "--"}</span></div>
            {selectedNode ? (
              <div className="inspector-form">
                <label><span>Label</span><input value={selectedNode.label} onChange={(event) => updateNode(selectedNode.id, { label: event.target.value })} /></label>
                <label><span>Type</span><select value={selectedNode.type} onChange={(event) => updateNode(selectedNode.id, { type: event.target.value as VenueNodeType })}>{Object.keys(NODE_SYMBOL).map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
                <div className="two-field"><label><span>Capacity</span><input type="number" min="1" value={selectedNode.capacityPeople} onChange={(event) => updateNode(selectedNode.id, { capacityPeople: Math.max(1, Number(event.target.value)) })} /></label><label><span>Flow / min</span><input type="number" min="1" value={selectedNode.maxThroughputPerMinute} onChange={(event) => updateNode(selectedNode.id, { maxThroughputPerMinute: Math.max(1, Number(event.target.value)) })} /></label></div>
                <div className="coordinate-readout"><span>X {selectedNode.x.toFixed(3)}</span><span>Y {selectedNode.y.toFixed(3)}</span></div>
                <button type="button" className="danger-button" onClick={removeNode}>REMOVE NODE</button>
              </div>
            ) : <p className="empty-copy">Select a map marker to inspect it.</p>}
          </section>

          <section className="panel validation-panel">
            <div className="panel-title"><p>START CHECKLIST</p><span>{checks.filter((check) => check.pass).length}/{checks.length}</span></div>
            <ul>{checks.map((check) => <li key={check.label} className={check.pass ? "pass" : "fail"}><span aria-hidden="true">{check.pass ? "✓" : "!"}</span>{check.label}</li>)}</ul>
            <p className="safety-note"><strong>Why confirm?</strong> Model extraction is a draft. A human must verify the safety graph before simulation.</p>
            {confirmError && <p className="validation-error" role="alert">{confirmError}</p>}
            <button type="button" className={props.confirmed ? "confirm-button confirmed" : "confirm-button"} disabled={!valid || confirming} onClick={confirm}>{props.confirmed ? "✓ GRAPH CONFIRMED" : confirming ? "CONFIRMING…" : "CONFIRM THIS GRAPH"}</button>
          </section>
        </aside>
      </div>

      <footer className="review-footer"><button type="button" className="secondary-button" onClick={props.onBack}>← BACK TO SETUP</button><div><span className={props.confirmed ? "gate-state unlocked" : "gate-state"}>{props.confirmed ? "SIMULATION UNLOCKED" : "SIMULATION LOCKED"}</span><button type="button" className="primary-button" disabled={!props.confirmed} onClick={props.onStart}>START LIVE SIMULATION <span aria-hidden="true">▶</span></button></div></footer>
    </div>
  );
}

interface ViewportProps {
  graph: VenueGraph;
  backgroundPath?: string;
  editable?: boolean;
  selectedNodeId?: string;
  onSelectNode?: (id: string) => void;
  onGraph?: (graph: VenueGraph) => void;
  layers: LayerState;
  minute: number;
  nodeRisk?: Readonly<Record<string, number>>;
  routeEdgeIds?: readonly string[];
}

function VenueViewport(props: ViewportProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const nodesById = useMemo(() => new Map(props.graph.nodes.map((node) => [node.id, node])), [props.graph.nodes]);
  const routeEdgeIds = useMemo(() => new Set(props.routeEdgeIds ?? []), [props.routeEdgeIds]);
  const scoreForNode = useCallback(
    (node: VenueNode, index: number) => props.nodeRisk?.[node.id] ?? riskForNode(node, index, props.minute),
    [props.minute, props.nodeRisk],
  );

  const moveNode = useCallback((nodeId: string, x: number, y: number) => {
    if (!props.onGraph) return;
    props.onGraph({
      ...props.graph,
      nodes: props.graph.nodes.map((node) => node.id === nodeId ? { ...node, x: clamp(x, 0.025, 0.975), y: clamp(y, 0.04, 0.96) } : node),
    });
  }, [props]);

  const positionFromPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
  };

  const keyboardMove = (event: KeyboardEvent<SVGGElement>, node: VenueNode) => {
    if (!props.editable || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.025 : 0.008;
    moveNode(node.id, node.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), node.y + (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0));
  };

  return (
    <figure className="venue-viewport">
      <div className="neutral-map" aria-hidden="true"><span className="zone zone-a" /><span className="zone zone-b" /><span className="zone zone-c" /><span className="zone zone-d" /><span className="map-compass">N</span></div>
      {props.backgroundPath && <img className="venue-background" src={props.backgroundPath} alt="" aria-hidden="true" onError={(event) => { event.currentTarget.hidden = true; }} />}
      <svg
        ref={svgRef}
        viewBox="0 0 1000 620"
        role="img"
        aria-label={props.editable ? "Editable venue navigation graph" : "Live crowd flow map"}
        onPointerMove={(event) => { if (dragId) { const position = positionFromPointer(event); moveNode(dragId, position.x, position.y); } }}
        onPointerUp={() => setDragId(null)}
        onPointerCancel={() => setDragId(null)}
      >
        <defs><radialGradient id="risk-critical"><stop offset="0" stopColor="#ff5c62" stopOpacity=".72"/><stop offset="1" stopColor="#ff5c62" stopOpacity="0"/></radialGradient><radialGradient id="risk-warning"><stop offset="0" stopColor="#ffc857" stopOpacity=".58"/><stop offset="1" stopColor="#ffc857" stopOpacity="0"/></radialGradient></defs>
        {props.layers.risk && !props.editable && <g className="risk-layer">{props.graph.nodes.map((node, index) => { const score = scoreForNode(node, index); return score > 0.58 ? <circle key={node.id} cx={node.x * 1000} cy={node.y * 620} r={score * 96} fill={score > 0.8 ? "url(#risk-critical)" : "url(#risk-warning)"} /> : null; })}</g>}
        {props.layers.network && <g className="edge-layer">{props.graph.edges.map((edge) => { const source = nodesById.get(edge.source); const target = nodesById.get(edge.target); if (!source || !target) return null; return <line key={edge.id} x1={source.x * 1000} y1={source.y * 620} x2={target.x * 1000} y2={target.y * 620} />; })}</g>}
        {props.layers.routes && !props.editable && <g className="route-layer">{props.graph.edges.filter((edge, index) => routeEdgeIds.size > 0 ? routeEdgeIds.has(edge.id) : index < 6).map((edge) => { const source = nodesById.get(edge.source); const target = nodesById.get(edge.target); if (!source || !target) return null; return <line key={edge.id} x1={source.x * 1000} y1={source.y * 620} x2={target.x * 1000} y2={target.y * 620} />; })}</g>}
        {props.layers.crowd && !props.editable && <g className="crowd-layer">{props.graph.nodes.flatMap((node, nodeIndex) => { const count = Math.max(1, Math.min(9, Math.round(scoreForNode(node, nodeIndex) * 9))); return Array.from({ length: count }, (_, index) => { const angle = nodeIndex * 1.8 + index * 1.25; const radius = 12 + index * 5; return <rect key={`${node.id}-${index}`} x={node.x * 1000 + Math.cos(angle) * radius - 3} y={node.y * 620 + Math.sin(angle) * radius - 3} width="6" height="6" />; }); })}</g>}
        <g className="node-layer">{props.graph.nodes.map((node, index) => { const score = scoreForNode(node, index); const selected = node.id === props.selectedNodeId; return (
          <g
            key={node.id}
            className={`map-node node-${node.type} ${selected ? "selected" : ""} ${!props.editable && score > 0.8 ? "critical" : ""}`}
            transform={`translate(${node.x * 1000} ${node.y * 620})`}
            role={props.editable ? "button" : undefined}
            tabIndex={props.editable ? 0 : undefined}
            aria-label={props.editable ? `${node.label}, ${node.type.replaceAll("_", " ")}. Use arrow keys to move.` : undefined}
            onKeyDown={(event) => keyboardMove(event, node)}
            onPointerDown={(event) => { if (!props.editable) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDragId(node.id); props.onSelectNode?.(node.id); }}
            onClick={() => props.onSelectNode?.(node.id)}
          >
            <rect x="-17" y="-17" width="34" height="34" rx="3" /><text textAnchor="middle" dominantBaseline="central">{NODE_SYMBOL[node.type]}</text>
            {props.layers.labels && <g className="node-label"><rect x="-54" y="24" width="108" height="22" /><text x="0" y="39" textAnchor="middle">{node.label.slice(0, 18)}</text></g>}
            {!props.editable && score > 0.8 && <g className="risk-badge"><rect x="14" y="-27" width="22" height="18"/><text x="25" y="-14" textAnchor="middle">!</text></g>}
          </g>
        ); })}</g>
      </svg>
      <figcaption className="sr-only">Nodes show venue facilities and gates; lines show directed walkways. Risk zones also have warning badges and text in the alert panel.</figcaption>
    </figure>
  );
}

interface LiveProps {
  graph: VenueGraph;
  crowdSize: number;
  schedule: readonly ScheduleBlock[];
  preset: VenuePreset;
  backgroundPath: string;
  sessionId: string | null;
  initialSnapshot: RuntimeSnapshot | null;
  onEdit: () => void;
}

function LiveScreen(props: LiveProps) {
  const startMinute = props.schedule[0]?.startMinute ?? 0;
  const endMinute = props.schedule.at(-1)?.endMinute ?? props.preset.durationMinutes;
  const [minute, setMinute] = useState(startMinute);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [adviceApplied, setAdviceApplied] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(props.initialSnapshot);
  const [advice, setAdvice] = useState<AdviceResponse | null>(null);
  const [liveMessage, setLiveMessage] = useState("Simulation connected. Monitoring venue flow.");

  useEffect(() => {
    if (!playing || snapshot) return;
    const timer = window.setInterval(() => setMinute((current) => current >= endMinute ? startMinute : current + speed), 850);
    return () => window.clearInterval(timer);
  }, [endMinute, playing, snapshot, speed, startMinute]);

  useEffect(() => {
    if (!props.sessionId) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/sessions/${props.sessionId}/stream`);
    socket.onmessage = (event) => {
      try {
        const tick = JSON.parse(String(event.data)) as RuntimeSnapshot & { minute?: number };
        const serverMinute = tick.simMinute ?? tick.simulationTimeMinute ?? tick.minute;
        if (typeof serverMinute === "number") setMinute(serverMinute);
        if (tick.nodes && tick.metrics && tick.routes) setSnapshot(tick);
      } catch { /* malformed telemetry is ignored without interrupting the operator */ }
    };
    socket.onopen = () => setLiveMessage("Live telemetry connected.");
    socket.onerror = () => setLiveMessage("Using local telemetry preview while the live stream reconnects.");
    return () => socket.close();
  }, [props.sessionId]);

  const activeBlock = props.schedule.find((block) => minute >= block.startMinute && minute < block.endMinute) ?? props.schedule.at(-1);
  const nodeRisk = useMemo(() => Object.fromEntries(props.graph.nodes.map((node, index) => [
    node.id,
    snapshot?.nodes[node.id]?.occupancyRatio ?? riskForNode(node, index, minute),
  ])), [minute, props.graph.nodes, snapshot]);
  const risks = useMemo<RiskItem[]>(() => props.graph.nodes.map((node) => {
    const score = nodeRisk[node.id] ?? 0;
    const bottleneck = snapshot?.bottlenecks.find((item) => item.locationType === "node" && item.locationId === node.id);
    const forecast = snapshot?.forecasts?.filter((item) =>
      item.locationType === "node" && item.locationId === node.id,
    ).sort((left, right) => left.leadTimeMinutes - right.leadTimeMinutes)[0];
    const level = bottleneck?.severity === "critical" ? "CRITICAL" : bottleneck?.severity === "warning" ? "WARNING" : riskLevel(score);
    const timing = forecast
      ? forecast.leadTimeMinutes <= 0.25 ? "NOW" : `${Math.ceil(forecast.leadTimeMinutes)}m`
      : bottleneck
        ? `${Math.max(0, Math.round(bottleneck.durationMinutes))}m`
        : `${Math.round(score * 100)}%`;
    const timingLabel: RiskItem["timingLabel"] = forecast
      ? "TO ONSET"
      : bottleneck
        ? "ACTIVE"
        : "DENSITY";
    return {
      node,
      score,
      level,
      timing,
      timingLabel,
    };
  }).sort((a, b) => b.score - a.score).slice(0, 3), [nodeRisk, props.graph.nodes, snapshot]);
  const topRisk = risks[0];
  const recommendedReroute = advice?.reroutes?.find((reroute) => reroute.metrics.recommended);
  const previewReroute = recommendedReroute ?? advice?.reroutes?.[0];
  const citedFinding = advice?.findingBundle?.findings.find(
    (finding) => advice.actions?.[0]?.findingIds.includes(finding.id),
  );
  const citedFindingLabel = citedFinding?.summary.split(":", 1)[0];
  const routeEdgeIds = useMemo(() => {
    const avoided = previewing && previewReroute
      ? new Set(previewReroute.policy.avoidEdgeIds)
      : null;
    return snapshot?.routes.flatMap((route) => {
      const primary = route.primary?.edgeIds ?? [];
      if (!avoided || !primary.some((edgeId) => avoided.has(edgeId))) return primary;
      return route.alternatives.find((candidate) =>
        candidate.edgeIds.every((edgeId) => !avoided.has(edgeId)),
      )?.edgeIds ?? primary;
    }).slice(0, 18) ?? [];
  }, [previewReroute, previewing, snapshot]);

  const applyAdvice = async () => {
    if (props.sessionId) {
      try {
        const currentAdvice = advice ?? await api.getAdvice(props.sessionId, topRisk?.node.id);
        setAdvice(currentAdvice);
        const selected = currentAdvice.reroutes?.find((reroute) => reroute.metrics.recommended);
        if (!selected) {
          setLiveMessage("No counterfactually beneficial reroute is available for the current state.");
          return;
        }
        const result = await api.applyReroute(props.sessionId, selected.policy.id);
        setSnapshot(result.snapshot);
      } catch (error) {
        setLiveMessage(error instanceof Error ? error.message : "The reroute could not be applied.");
        return;
      }
    }
    setAdviceApplied(true);
    setPreviewing(false);
    setLiveMessage("Reroute applied to this simulation. Predicted pressure is recalculating.");
  };

  const togglePreview = async () => {
    if (previewing) {
      setPreviewing(false);
      return;
    }
    if (props.sessionId) {
      try {
        const result = await api.getAdvice(props.sessionId, topRisk?.node.id);
        setAdvice(result);
        setLiveMessage(`${result.provider === "openai" ? "GPT-5.6 Terra" : "Deterministic"} advice is ready for operator review.`);
      } catch (error) {
        setLiveMessage(error instanceof Error ? error.message : "Advice is temporarily unavailable.");
        return;
      }
    }
    setPreviewing(true);
  };

  const toggleLayer = (layer: LayerKey) => setLayers((current) => ({ ...current, [layer]: !current[layer] }));
  const togglePlaying = async () => {
    const next = !playing;
    setPlaying(next);
    if (props.sessionId) {
      try {
        await api.controlSimulation(props.sessionId, { playing: next });
      } catch {
        setPlaying(!next);
        setLiveMessage("Simulation control did not reach the server.");
      }
    }
  };
  const changeSpeed = async (value: 1 | 2 | 4) => {
    const previous = speed;
    setSpeed(value);
    if (props.sessionId) {
      try {
        await api.controlSimulation(props.sessionId, { speed: value });
      } catch {
        setSpeed(previous);
        setLiveMessage("Speed control did not reach the server.");
      }
    }
  };

  return (
    <div className="live-layout">
      <div className="live-statusbar">
        <div><span className="live-pulse" />LIVE SIMULATION <strong>{props.preset.shortName}</strong></div>
        <p aria-live="polite">{liveMessage}</p>
        <button type="button" className="text-button" onClick={props.onEdit}>EDIT GRAPH</button>
      </div>

      <div className="live-grid">
        <section className="live-map-card" aria-label="Live venue simulation">
          <div className="live-hud">
            <div><span>SIM TIME</span><strong>{formatMinute(minute)}</strong></div>
            <div><span>ACTIVE PHASE</span><strong>{activeBlock?.label ?? "Scenario"}</strong></div>
            <div><span>PEOPLE IN SYSTEM</span><strong>{Math.round(snapshot?.metrics.inSystemPeople ?? props.crowdSize * (0.58 + Math.sin(minute / 11) * 0.08)).toLocaleString("en-IN")}</strong></div>
            <div className={`risk-state risk-${topRisk?.level.toLowerCase()}`}><span>HIGHEST RISK</span><strong>{topRisk?.level ?? "WATCH"}</strong></div>
          </div>
          <VenueViewport graph={props.graph} backgroundPath={props.backgroundPath} layers={layers} minute={minute} nodeRisk={nodeRisk} routeEdgeIds={routeEdgeIds} />
          <div className="layer-controls" aria-label="Map layers">{(Object.keys(layers) as LayerKey[]).map((layer) => <label key={layer}><input type="checkbox" checked={layers[layer]} onChange={() => toggleLayer(layer)} /><span>{layer}</span></label>)}</div>
        </section>

        <aside className="operations-rail">
          <section className="ops-panel alerts-panel">
            <div className="ops-title"><div><p>BOTTLENECK WATCH</p><h2>Active alerts</h2></div><span>{risks.filter((risk) => risk.level !== "WATCH").length}</span></div>
            <ol>{risks.map((risk, index) => <li key={risk.node.id} className={`alert alert-${risk.level.toLowerCase()}`}><button type="button"><span className="alert-rank">{String(index + 1).padStart(2, "0")}</span><span><strong>{risk.node.label}</strong><small>{risk.level} · {Math.round(risk.score * 100)}% density</small></span><span className="eta">{risk.timing}<small>{risk.timingLabel}</small></span></button></li>)}</ol>
          </section>

          <section className="ops-panel advice-panel">
            <div className="advisor-tag"><span>AI</span> REROUTE ADVISOR</div>
            <h2>{adviceApplied ? "Intervention active" : advice?.actions?.[0]?.summary ?? "Divert arrivals from the pressure zone"}</h2>
            <p>{adviceApplied ? "The alternate route is applied to the simulation. Compare density changes before operational use." : advice?.actions?.[0]?.rationale ?? `${topRisk?.node.label ?? "The lead hotspot"} is trending above its safe operating band. Preview a lower-cost path and reduce inflow.`}</p>
            <div className="advice-route"><span>FINDING<strong>{citedFindingLabel ?? snapshot?.bottlenecks[0]?.label ?? "Lead hotspot"}</strong></span><i>→</i><span>ACTION<strong>{advice?.actions?.[0]?.type.replaceAll("_", " ") ?? "Reroute"}</strong></span><i>→</i><span>STATUS<strong>{advice && !recommendedReroute ? "No benefit" : advice?.provider === "openai" ? "GPT grounded" : "Awaiting preview"}</strong></span></div>
            <div className="impact-row"><span><small>PEAK Δ</small><strong>{previewReroute ? `${previewReroute.metrics.peakOccupancyRatioDelta >= 0 ? "+" : ""}${(previewReroute.metrics.peakOccupancyRatioDelta * 100).toFixed(1)}pt` : "--"}</strong></span><span><small>EXPOSURE Δ</small><strong>{previewReroute ? `${previewReroute.metrics.congestionExposureDeltaPersonMinutes >= 0 ? "+" : ""}${Math.round(previewReroute.metrics.congestionExposureDeltaPersonMinutes)}pm` : "--"}</strong></span><span><small>EXITS Δ</small><strong>{previewReroute ? `${previewReroute.metrics.exitedPeopleDelta >= 0 ? "+" : ""}${Math.round(previewReroute.metrics.exitedPeopleDelta)}` : "--"}</strong></span><span><small>CONFIDENCE</small><strong>{advice?.confidence ? `${Math.round(advice.confidence * 100)}%` : "--"}</strong></span></div>
            <div className="advice-actions"><button type="button" className="secondary-button" onClick={togglePreview}>{previewing ? "HIDE PREVIEW" : "PREVIEW ON MAP"}</button><button type="button" className="primary-button small" disabled={adviceApplied || !previewing || !recommendedReroute} onClick={applyAdvice}>{adviceApplied ? "APPLIED ✓" : advice && !recommendedReroute ? "NO SAFE BENEFIT" : "APPLY TO SIM"}</button></div>
            <p className="disclaimer">Decision support only. A venue operator must authorize any real-world intervention.</p>
          </section>
        </aside>
      </div>

      <section className="timeline-console" aria-label="Simulation timeline">
        <button type="button" className="play-button" onClick={togglePlaying} aria-label={playing ? "Pause simulation" : "Play simulation"}>{playing ? "Ⅱ" : "▶"}</button>
        <div className="timeline-wrap">
          <div className="timeline-labels"><span>{formatMinute(startMinute)}</span><strong>{activeBlock?.label ?? "Scenario"}</strong><span>{formatMinute(endMinute)}</span></div>
          <div className="timeline-track">{props.schedule.map((block) => <span key={block.id} className={`timeline-block phase-${block.phase}`} style={{ left: `${((block.startMinute - startMinute) / Math.max(1, endMinute - startMinute)) * 100}%`, width: `${((block.endMinute - block.startMinute) / Math.max(1, endMinute - startMinute)) * 100}%` }} />)}<input type="range" min={startMinute} max={endMinute} value={minute} onChange={(event) => setMinute(Number(event.target.value))} aria-label="Simulation time" /></div>
        </div>
        <div className="speed-control" aria-label="Simulation speed">{([1, 2, 4] as const).map((value) => <button type="button" key={value} className={speed === value ? "active" : ""} onClick={() => changeSpeed(value)}>{value}×</button>)}</div>
      </section>
    </div>
  );
}
