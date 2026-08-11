"use client";

import { useMemo, useRef, useState } from "react";
import type { SimTick, VenueGraph, VenueNode } from "@/lib/types";

type Mode = "review" | "sim";

interface Props {
  imageUrl: string;
  graph: VenueGraph;
  mode?: Mode;
  tick?: SimTick | null;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  onMoveNode?: (nodeId: string, x: number, y: number) => void;
}

function nodeFill(node: VenueNode, tick: SimTick | null | undefined, mode: Mode): string {
  if (mode !== "sim" || !tick) {
    if (node.type === "entry_gate") return "#2563eb";
    if (node.type === "exit" || node.type === "emergency_exit") return "#059669";
    if (node.type === "concession") return "#d97706";
    return "#334155";
  }
  const density = tick.nodes[node.id]?.density ?? 0;
  const severity = tick.bottlenecks.find((b) => b.node_id === node.id)?.severity;
  const heat = severity === "critical" ? Math.max(density, 0.95) : density;
  const alpha = Math.min(0.95, 0.15 + heat * 0.85);
  return `rgba(185, 28, 28, ${alpha.toFixed(3)})`;
}

function nodeRadius(node: VenueNode, tick: SimTick | null | undefined, mode: Mode): number {
  if (mode !== "sim" || !tick) return 7;
  const density = tick.nodes[node.id]?.density ?? 0;
  return 6 + Math.min(10, density * 10);
}

export default function VenueCanvas({
  imageUrl,
  graph,
  mode = "review",
  tick = null,
  selectedNodeId = null,
  onSelectNode,
  onMoveNode,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const nodeMap = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  function clientToNorm(clientX: number, clientY: number): { x: number; y: number } | null {
    const el = wrapRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }

  return (
    <div
      className="canvas-frame"
      ref={wrapRef}
      onPointerMove={(e) => {
        if (!dragging || mode !== "review" || !onMoveNode) return;
        const p = clientToNorm(e.clientX, e.clientY);
        if (!p) return;
        onMoveNode(dragging, p.x, p.y);
      }}
      onPointerUp={() => setDragging(null)}
      onPointerLeave={() => setDragging(null)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="Venue layout" draggable={false} />
      <svg viewBox="0 0 1 1" preserveAspectRatio="none">
        {graph.edges.map((edge) => {
          const s = nodeMap.get(edge.source);
          const t = nodeMap.get(edge.target);
          if (!s || !t) return null;
          const congested = Boolean(tick?.edges[edge.id]?.congested);
          return (
            <line
              key={edge.id}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke={congested ? "rgba(185,28,28,0.75)" : "rgba(248,250,252,0.75)"}
              strokeWidth={congested ? 0.012 : 0.006}
            />
          );
        })}
        {graph.nodes.map((node) => {
          const selected = selectedNodeId === node.id;
          return (
            <g key={node.id}>
              <circle
                cx={node.x}
                cy={node.y}
                r={(nodeRadius(node, tick, mode) / 180) * (selected ? 1.25 : 1)}
                fill={nodeFill(node, tick, mode)}
                stroke={selected ? "#f8fafc" : "rgba(15,23,42,0.55)"}
                strokeWidth={selected ? 0.01 : 0.004}
                style={{ cursor: mode === "review" ? "grab" : "default" }}
                onPointerDown={(e) => {
                  if (mode !== "review") return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragging(node.id);
                  onSelectNode?.(node.id);
                }}
                onClick={() => onSelectNode?.(node.id)}
              />
              <text
                x={node.x}
                y={Math.max(0.03, node.y - 0.03)}
                fill="#f8fafc"
                fontSize="0.028"
                textAnchor="middle"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
