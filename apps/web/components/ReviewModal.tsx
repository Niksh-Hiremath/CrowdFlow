"use client";

import { useMemo, useState, type FormEvent } from "react";
import VenueCanvas from "@/components/VenueCanvas";
import NodeDetailsModal from "@/components/NodeDetailsModal";
import { layoutImageUrl, putGraph, reviseGraph } from "@/lib/api";
import type { RevisionProgress, VenueEdge, VenueGraph, VenueNode } from "@/lib/types";

interface ChatLine {
  role: "user" | "system";
  text: string;
}

function graphSignature(graph: VenueGraph): string {
  return JSON.stringify({
    nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...graph.edges].sort((a, b) => a.id.localeCompare(b.id)),
  });
}

interface Props {
  sessionId: string;
  graph: VenueGraph;
  onGraphChange: (graph: VenueGraph) => void;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  confirming: boolean;
  error?: string | null;
}

export default function ReviewModal({
  sessionId,
  graph,
  onGraphChange,
  onConfirm,
  onClose,
  confirming,
  error,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [addEdgeStartId, setAddEdgeStartId] = useState<string | null>(null);
  const [addingEdge, setAddingEdge] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [revisionProgress, setRevisionProgress] = useState<RevisionProgress | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const selected = useMemo(
    () => graph.nodes.find((n) => n.id === selectedId) || null,
    [graph.nodes, selectedId],
  );

  const imageUrl = layoutImageUrl(sessionId);

  const selectedEdge = useMemo(
    () => graph.edges.find((edge) => edge.id === selectedEdgeId) || null,
    [graph.edges, selectedEdgeId],
  );

  function toggleAddEdge() {
    setAddingEdge((active) => !active);
    setAddEdgeStartId(null);
    setSelectedId(null);
    setSelectedEdgeId(null);
  }

  function selectNodeForEdge(nodeId: string) {
    if (!addingEdge) {
      setSelectedId(nodeId);
      return;
    }
    if (!addEdgeStartId) {
      setAddEdgeStartId(nodeId);
      return;
    }
    if (addEdgeStartId === nodeId) return;

    const source = graph.nodes.find((node) => node.id === addEdgeStartId);
    const target = graph.nodes.find((node) => node.id === nodeId);
    if (!source || !target) return;

    const alreadyExists = graph.edges.some(
      (edge) =>
        (edge.source === source.id && edge.target === target.id) ||
        (edge.source === target.id && edge.target === source.id),
    );
    if (alreadyExists) {
      setLocalError("Those nodes are already connected.");
      setAddEdgeStartId(null);
      return;
    }

    const edgeIdBase = `edge_${graph.edges.length + 1}`;
    let edgeId = edgeIdBase;
    let suffix = 2;
    while (graph.edges.some((edge) => edge.id === edgeId)) {
      edgeId = `${edgeIdBase}_${suffix++}`;
    }
    const edge: VenueEdge = {
      id: edgeId,
      source: source.id,
      target: target.id,
      type: "walkway",
      length_m: Math.max(2, Math.hypot(source.x - target.x, source.y - target.y) * 40),
      width_m: 3,
      capacity: 80,
    };
    const next: VenueGraph = { ...graph, edges: [...graph.edges, edge], confirmed: false };
    setAddEdgeStartId(null);
    setLocalError(null);
    onGraphChange(next);
    void persist(next).catch((error) => {
      setLocalError(error instanceof Error ? error.message : "Failed to add edge");
    });
  }

  async function persist(next: VenueGraph) {
    const saved = await putGraph(sessionId, next);
    onGraphChange(saved);
  }

  async function onMoveNode(nodeId: string, x: number, y: number) {
    const next: VenueGraph = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)),
      confirmed: false,
    };
    onGraphChange(next);
  }

  async function commitMove() {
    try {
      await persist(graph);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Failed to save graph");
    }
  }

  async function updateSelected(patch: Partial<VenueNode>) {
    if (!selected) return;
    const next: VenueGraph = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === selected.id ? { ...n, ...patch } : n)),
      confirmed: false,
    };
    onGraphChange(next);
    try {
      await persist(next);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Failed to update node");
    }
  }

  async function deleteSelected() {
    if (!selected) return;
    const id = selected.id;
    const next: VenueGraph = {
      ...graph,
      nodes: graph.nodes.filter((n) => n.id !== id),
      edges: graph.edges.filter((e) => e.source !== id && e.target !== id),
      confirmed: false,
    };
    setSelectedId(null);
    try {
      await persist(next);
      setChat((c) => [...c, { role: "system", text: `Deleted node ${id}.` }]);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Failed to delete node");
    }
  }

  async function deleteSelectedEdge() {
    if (!selectedEdge) return;
    const next: VenueGraph = {
      ...graph,
      edges: graph.edges.filter((edge) => edge.id !== selectedEdge.id),
      confirmed: false,
    };
    setSelectedEdgeId(null);
    onGraphChange(next);
    try {
      await persist(next);
      setChat((c) => [...c, { role: "system", text: `Deleted edge ${selectedEdge.id}.` }]);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Failed to delete edge");
    }
  }

  async function onChat(e: FormEvent) {
    e.preventDefault();
    const text = instruction.trim();
    if (!text || busy) return;
    setBusy(true);
    setLocalError(null);
    setRevisionProgress({
      session_id: sessionId,
      status: "queued",
      progress: 0,
      stage: "Submitting graph correction",
      error: null,
      graph: null,
    });
    setChat((c) => [...c, { role: "user", text }]);
    setInstruction("");
    const previousGraph = graph;
    try {
      const revised = await reviseGraph(sessionId, text, setRevisionProgress);
      onGraphChange(revised);
      const changed = graphSignature(previousGraph) !== graphSignature(revised);
      setChat((c) => [
        ...c,
        {
          role: "system",
          text: changed ? "Graph updated from your instruction." : "No graph changes were made.",
        },
      ]);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Revise failed");
    } finally {
      setBusy(false);
      setRevisionProgress(null);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-header">
          <div>
            <h2>Review extracted graph</h2>
            <p>
              Compare the layout with detected nodes. Chat to revise, or drag / rename / delete
              nodes, then confirm.
            </p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={confirming}>
            Close
          </button>
        </div>

        {(error || localError) && (
          <div className="banner banner-error" style={{ marginBottom: 12 }}>
            {error || localError}
          </div>
        )}

        <div className="review-grid">
          <div>
            <div className="canvas-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="Original layout" />
            </div>
            <p className="canvas-caption">Original layout</p>
          </div>
          <div>
            <VenueCanvas
              imageUrl={imageUrl}
              graph={graph}
              mode="review"
              selectedNodeId={addingEdge ? addEdgeStartId : selectedId}
              selectedEdgeId={selectedEdgeId}
              onSelectNode={(nodeId) => {
                if (!addingEdge) setSelectedId(nodeId);
              }}
              onNodeClick={selectNodeForEdge}
              onSelectEdge={setSelectedEdgeId}
              onMoveNode={onMoveNode}
              onMoveEnd={() => void commitMove()}
            />
            <div className="actions-row" style={{ justifyContent: "space-between", marginTop: 8 }}>
              <p className="canvas-caption" style={{ margin: 0 }}>
                {addingEdge
                  ? addEdgeStartId
                    ? "Select the second node to create the edge."
                    : "Select the first node to create an edge."
                  : "Extracted graph overlay — drag nodes to reposition"}
              </p>
              <button type="button" className="btn btn-secondary" onClick={toggleAddEdge}>
                {addingEdge ? "Cancel" : "Add edge"}
              </button>
            </div>
            {selectedEdge && (
              <div className="actions-row" style={{ justifyContent: "space-between", marginTop: 10 }}>
                <span className="canvas-caption">Selected edge: {selectedEdge.id}</span>
                <button type="button" className="btn btn-danger" onClick={() => void deleteSelectedEdge()}>
                  Delete edge
                </button>
              </div>
            )}
          </div>
        </div>


        <div className="chat-box">
          <label className="label">Ask the model to correct the graph</label>
          <div className="chat-log">
            {chat.length === 0 && (
              <div className="system">
                Example: “delete green_room” or “rename buffet to Catering”
              </div>
            )}
            {chat.map((line, i) => (
              <div key={i} className={line.role}>
                <strong>{line.role === "user" ? "You" : "System"}:</strong> {line.text}
              </div>
            ))}
          </div>
          <form onSubmit={onChat} style={{ display: "flex", gap: 8 }}>
            <input
              className="field"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Describe the correction…"
              disabled={busy || confirming}
            />
            <button className="btn btn-secondary" type="submit" disabled={busy || confirming}>
              {busy ? "Updating…" : "Send"}
            </button>
          </form>
          {busy && revisionProgress && (
            <div className="revision-progress" aria-live="polite">
              <div className="extraction-progress-header">
                <strong>Updating graph</strong>
                <span>{revisionProgress.progress}%</span>
              </div>
              <div
                className="progress extraction-progress-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={revisionProgress.progress}
              >
                <span style={{ width: `${revisionProgress.progress}%` }} />
              </div>
              <p className="hint extraction-progress-stage">{revisionProgress.stage}</p>
            </div>
          )}
        </div>

        <div className="actions-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={confirming || busy}
            onClick={() => void onConfirm()}
          >
            {confirming ? "Starting…" : "Confirm & continue"}
          </button>
        </div>
      </div>
      
      {selected && (
        <NodeDetailsModal
          node={selected}
          imageUrl={imageUrl}
          onClose={() => setSelectedId(null)}
          onUpdate={updateSelected}
          onDelete={deleteSelected}
        />
      )}
    </div>
  );
}
