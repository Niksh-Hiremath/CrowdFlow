"use client";

import { useMemo } from "react";
import type { AdvisorResponse, Scenario, SimTick, AdvisorAction } from "@/lib/types";

interface Props {
  waiting: boolean;
  progress: number;
  tick: SimTick | null;
  advice: AdvisorResponse | null;
  error?: string | null;
  scenario: Scenario | null;
  highlightedNodes: string[];
  onHighlight: (nodeIds: string[]) => void;
  onTimelineClick?: (timeStr: string) => void;
}

export default function SimReport({
  waiting,
  progress,
  tick,
  advice,
  error,
  scenario,
  highlightedNodes,
  onHighlight,
  onTimelineClick,
}: Props) {
  const currentBlockIndex = useMemo(() => {
    if (!scenario || !tick) return -1;
    const timeStr = tick.sim_time;
    return scenario.schedule.blocks.findIndex((b) => timeStr >= b.start && timeStr < b.end);
  }, [scenario, tick]);

  function handleHighlightAction(action: AdvisorAction) {
    const nodes = new Set<string>();
    if (action.node_id) nodes.add(action.node_id);
    if (action.from_node) nodes.add(action.from_node);
    if (action.avoid) action.avoid.forEach((n) => nodes.add(n));
    if (action.prefer) action.prefer.forEach((n) => nodes.add(n));
    onHighlight(Array.from(nodes));
  }

  return (
    <div className="panel sim-right">
      {scenario && (
        <div style={{ marginBottom: 24 }}>
          <h2>Live Timeline</h2>
          <div className="timeline-list">
            {scenario.schedule.blocks.map((b, i) => {
              const active = i === currentBlockIndex;
              const past = i < currentBlockIndex;
              return (
                <div 
                  key={b.id} 
                  className={`timeline-block ${active ? "active" : ""} ${past ? "past" : ""} ${onTimelineClick ? "interactive-timeline" : ""}`}
                  onClick={() => onTimelineClick?.(b.start)}
                >
                  <div className="timeline-marker"></div>
                  <div className="timeline-content">
                    <div className="timeline-time">{b.start}</div>
                    <div className="timeline-label">{b.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <h2>Findings</h2>
      <p className="hint">
        {waiting
          ? "Waiting for the simulation to finish…"
          : "Click on any bottleneck or recommendation below to highlight it on the map."}
      </p>

      {waiting && (
        <>
          <div className="progress" aria-label="Simulation progress">
            <span style={{ width: `${Math.min(100, Math.max(4, progress))}%` }} />
          </div>
          <p className="muted">
            {tick
              ? `Sim clock ${tick.sim_time} · ${tick.bottlenecks.length} hotspot signal(s)`
              : "Connecting to live stream…"}
          </p>
        </>
      )}

      {error && <div className="banner banner-error">{error}</div>}

      {!waiting && advice && (
        <div className="stack">
          <div>
            <label className="label">Summary</label>
            <p style={{ margin: 0 }}>{advice.summary || "No summary returned."}</p>
          </div>

          <div>
            <label className="label">Bottlenecks</label>
            {tick && tick.bottlenecks.length > 0 ? (
              <ul className="report-list">
                {tick.bottlenecks.map((b) => (
                  <li
                    key={b.id}
                    className={`sev-${b.severity} interactive-card ${highlightedNodes.includes(b.node_id) ? "highlighted" : ""}`}
                    onClick={() => onHighlight([b.node_id])}
                    style={{ cursor: "pointer" }}
                  >
                    <strong>{b.node_id}</strong> · {b.severity}
                    <div className="muted">{b.reason}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No bottleneck thresholds crossed in the final tick.</p>
            )}
          </div>

          <div>
            <label className="label">Recommended actions</label>
            {advice.actions.length > 0 ? (
              <ul className="report-list">
                {advice.actions.map((a, i) => (
                  <li
                    key={`${a.type}-${i}`}
                    className="interactive-card"
                    onClick={() => handleHighlightAction(a)}
                    style={{ cursor: "pointer" }}
                  >
                    <strong>{a.type}</strong>
                    <div className="muted">
                      {[
                        a.node_id ? `node ${a.node_id}` : null,
                        a.from_node ? `from ${a.from_node}` : null,
                        a.avoid?.length ? `avoid ${a.avoid.join(", ")}` : null,
                        a.prefer?.length ? `prefer ${a.prefer.join(", ")}` : null,
                        a.meter_per_min != null ? `${a.meter_per_min}/min` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No actions suggested.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
