"use client";

import type { AdvisorResponse, SimTick } from "@/lib/types";

interface Props {
  waiting: boolean;
  progress: number;
  tick: SimTick | null;
  advice: AdvisorResponse | null;
  error?: string | null;
}

export default function SimReport({ waiting, progress, tick, advice, error }: Props) {
  return (
    <div className="panel sim-right">
      <h2>Findings</h2>
      <p className="hint">
        {waiting
          ? "Waiting for the simulation to finish…"
          : "Consolidated bottlenecks and operator advice from the latest run."}
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
                  <li key={b.id} className={`sev-${b.severity}`}>
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
                  <li key={`${a.type}-${i}`}>
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
