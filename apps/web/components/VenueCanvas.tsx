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
  highlightedNodeIds?: string[];
  onSelectNode?: (nodeId: string | null) => void;
  onMoveNode?: (nodeId: string, x: number, y: number) => void;
}

function nodeFill(node: VenueNode, tick: SimTick | null | undefined, mode: Mode): string {
  if (mode !== "sim" || !tick) {
    return "#ffffff";
  }
  const density = tick.nodes[node.id]?.density ?? 0;
  const severity = tick.bottlenecks.find((b) => b.node_id === node.id)?.severity;
  const heat = severity === "critical" ? Math.max(density, 0.95) : density;
  
  if (heat > 0.7) return "#ef4444"; // Red (High crowd)
  if (heat > 0.25) return "#3b82f6"; // Blue (Medium crowd)
  return "#10b981"; // Green (Low crowd)
}

function nodeRadius(node: VenueNode, tick: SimTick | null | undefined, mode: Mode): number {
  if (mode !== "sim" || !tick) return 3;
  const density = tick.nodes[node.id]?.density ?? 0;
  return 3 + Math.min(3, density * 3);
}

export default function VenueCanvas({
  imageUrl,
  graph,
  mode = "review",
  tick = null,
  selectedNodeId = null,
  highlightedNodeIds = [],
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
          const isHighlightMode = highlightedNodeIds.length > 0;
          const isHighlighted = isHighlightMode && (highlightedNodeIds.includes(edge.source) || highlightedNodeIds.includes(edge.target));
          const opacity = isHighlightMode && !isHighlighted ? 0.15 : 1;
          
          return (
            <line
              key={edge.id}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke={congested ? "#ff9933" : (mode === "sim" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.6)")}
              strokeWidth={congested ? 0.012 : 0.008}
              style={{ 
                filter: congested ? "drop-shadow(0 0 2px #ff9933)" : "none", 
                transition: "all 0.3s ease",
                opacity
              }}
            />
          );
        })}
        {graph.nodes.map((node) => {
          const selected = selectedNodeId === node.id;
          const isHighlightMode = highlightedNodeIds.length > 0;
          const isHighlighted = isHighlightMode && highlightedNodeIds.includes(node.id);
          const opacity = isHighlightMode && !isHighlighted ? 0.15 : 1;
          const r = (nodeRadius(node, tick, mode) / 180) * (selected || isHighlighted ? 1.25 : 1);

          return (
            <g key={node.id} style={{ opacity, transition: "opacity 0.3s ease" }}>
              {isHighlighted && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r * 1.6}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="0.005"
                  className="pulsate"
                />
              )}
              <circle
                cx={node.x}
                cy={node.y}
                r={r}
                fill={nodeFill(node, tick, mode)}
                stroke={mode === "sim" ? "none" : (selected ? "#0172b8" : "#0b2e59")}
                strokeWidth={selected ? 0.01 : 0.006}
                style={{ 
                  cursor: mode === "review" ? "grab" : "default",
                  filter: mode === "sim" ? `drop-shadow(0 0 3px ${nodeFill(node, tick, mode)})` : "none",
                  transition: "all 0.3s ease"
                }}
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
                y={Math.max(0.04, node.y - 0.04)}
                fill="#ffffff"
                fontSize="0.026"
                fontWeight="bold"
                textAnchor="middle"
                style={{ 
                  pointerEvents: "none", 
                  userSelect: "none",
                  filter: "drop-shadow(0px 1px 3px rgba(0,0,0,0.9))",
                  textShadow: "0 0 4px rgba(0,0,0,0.8)"
                }}
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
