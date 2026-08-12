"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import SimReport from "@/components/SimReport";
import VenueCanvas from "@/components/VenueCanvas";
import {
  adviseSession,
  connectSimStream,
  getSession,
  layoutImageUrl,
} from "@/lib/api";
import type { AdvisorResponse, Scenario, SimTick, VenueGraph } from "@/lib/types";

export default function SimPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [graph, setGraph] = useState<VenueGraph | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [history, setHistory] = useState<SimTick[]>([]);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [tick, setTick] = useState<SimTick | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [advice, setAdvice] = useState<AdvisorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tickCount, setTickCount] = useState(0);
  const [highlightedNodes, setHighlightedNodes] = useState<string[]>([]);

  const imageUrl = useMemo(() => layoutImageUrl(sessionId), [sessionId]);
  
  const maxTicks = useMemo(() => {
    if (!scenario?.schedule?.blocks?.length) return 90;
    const blocks = scenario.schedule.blocks;
    const first = blocks[0].start;
    const last = blocks[blocks.length - 1].end;
    const [h1, m1] = first.split(":").map(Number);
    const [h2, m2] = last.split(":").map(Number);
    let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (diff < 0) diff += 24 * 60;
    return Math.min(500, Math.max(1, diff));
  }, [scenario]);

  const progress = Math.min(100, (tickCount / maxTicks) * 100);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await getSession(sessionId);
        if (cancelled) return;
        if (!session.graph) {
          setError("Session has no graph. Start again from the setup page.");
          return;
        }
        setGraph(session.graph);
        setScenario(session.scenario);
        if (session.last_tick) {
          setTick(session.last_tick);
          setHistory([session.last_tick]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load session");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!graph) return;
    let done = false;
    const disconnect = connectSimStream(sessionId, {
      onTick: (next) => {
        setTick(next);
        setHistory((prev) => [...prev, next]);
        setTickCount((c) => c + 1);
      },
      onDone: (finalTick) => {
        if (done) return;
        done = true;
        if (finalTick) {
          setTick(finalTick);
          setHistory((prev) => [...prev, finalTick]);
        }
        setWaiting(false);
        void (async () => {
          try {
            const report = await adviseSession(sessionId);
            setAdvice(report);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Advisor failed");
          }
        })();
      },
      onError: (message) => setError(message),
    });
    return () => disconnect();
  }, [sessionId, graph]);

  const displayTick = scrubIndex !== null && history[scrubIndex] ? history[scrubIndex] : tick;

  const scrubPercent = scrubIndex !== null && history.length > 1
    ? (scrubIndex / (history.length - 1)) * 100
    : 100;

  return (
    <main className="sim-shell">
      <section className="panel sim-left">
        <div className="sim-meta">
          <div>
            <h1>Live simulation</h1>
            <p className="muted" style={{ margin: 0 }}>
              {displayTick
                ? `Clock ${displayTick.sim_time} · remaining to spawn ${Math.round(displayTick.remaining_to_spawn)}`
                : "Warming up…"}
            </p>
          </div>
          <Link className="btn btn-secondary" href="/">
            New run
          </Link>
        </div>
        {graph ? (
          <>
            <VenueCanvas 
              imageUrl={imageUrl} 
              graph={graph} 
              mode="sim" 
              tick={displayTick} 
              highlightedNodeIds={highlightedNodes} 
            />
            {history.length > 0 && (
              <div className="scrubber-container">
                {scenario?.schedule?.blocks && scenario.schedule.blocks.length > 0 && (
                  <div className="scrubber-events">
                    {scenario.schedule.blocks.map(b => {
                      const isActive = displayTick && displayTick.sim_time >= b.start && displayTick.sim_time < b.end;
                      return (
                        <button 
                          key={b.id} 
                          className={`btn btn-secondary btn-sm ${isActive ? 'active' : ''}`}
                          onClick={() => {
                            const idx = history.findIndex((t) => t.sim_time >= b.start);
                            if (idx !== -1) {
                              setScrubIndex(idx);
                            } else {
                              setScrubIndex(history.length - 1);
                            }
                          }}
                        >
                          {b.start} - {b.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <input
                  type="range"
                  min={0}
                  max={history.length - 1}
                  value={scrubIndex !== null ? scrubIndex : history.length - 1}
                  onChange={(e) => setScrubIndex(Number(e.target.value))}
                  className="timeline-slider"
                  style={{ backgroundSize: `${scrubPercent}% 100%` }}
                />
                <div className="scrubber-controls">
                  <span className="muted">{history[0]?.sim_time}</span>
                  {scrubIndex !== null && (
                    <button className="btn btn-secondary btn-sm" onClick={() => setScrubIndex(null)}>
                      Snap to Live
                    </button>
                  )}
                  <span className="muted">{history[history.length - 1]?.sim_time}</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="banner banner-info">Loading venue graph…</div>
        )}
        <p className="canvas-caption">
          Green / Blue / Red nodes reflect live density / hotspot severity. Drag the slider to scrub through time.
        </p>
      </section>

      <SimReport
        waiting={waiting}
        progress={progress}
        tick={displayTick}
        advice={advice}
        error={error}
        scenario={scenario}
        highlightedNodes={highlightedNodes}
        onHighlight={setHighlightedNodes}
        onTimelineClick={(timeStr) => {
          const idx = history.findIndex((t) => t.sim_time >= timeStr);
          if (idx !== -1) {
            setScrubIndex(idx);
          } else {
            // If the time hasn't happened yet, just snap to the latest available
            setScrubIndex(history.length > 0 ? history.length - 1 : null);
          }
        }}
      />
    </main>
  );
}
