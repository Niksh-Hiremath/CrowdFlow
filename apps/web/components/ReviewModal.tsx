"use client";

import { useMemo, useState, type FormEvent } from "react";
import VenueCanvas from "@/components/VenueCanvas";
import NodeDetailsModal from "@/components/NodeDetailsModal";
import { layoutImageUrl, putGraph, reviseGraph } from "@/lib/api";
import type { VenueGraph, VenueNode } from "@/lib/types";

interface ChatLine {
  role: "user" | "system";
  text: string;
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
  const [instruction, setInstruction] = useState("");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const selected = useMemo(
    () => graph.nodes.find((n) => n.id === selectedId) || null,
    [graph.nodes, selectedId],
  );

  const imageUrl = layoutImageUrl(sessionId);

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

  async function onChat(e: FormEvent) {
    e.preventDefault();
    const text = instruction.trim();
    if (!text || busy) return;
    setBusy(true);
    setLocalError(null);
    setChat((c) => [...c, { role: "user", text }]);
    setInstruction("");
    try {
      const revised = await reviseGraph(sessionId, text);
      onGraphChange(revised);
      setChat((c) => [...c, { role: "system", text: "Graph updated from your instruction." }]);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Revise failed");
    } finally {
      setBusy(false);
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
          <div onPointerUp={() => void commitMove()}>
            <VenueCanvas
              imageUrl={imageUrl}
              graph={graph}
              mode="review"
              selectedNodeId={selectedId}
              onSelectNode={setSelectedId}
              onMoveNode={onMoveNode}
            />
            <p className="canvas-caption">Extracted graph overlay — drag nodes to reposition</p>
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
