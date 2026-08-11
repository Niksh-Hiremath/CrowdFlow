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
import type { AdvisorResponse, SimTick, VenueGraph } from "@/lib/types";

const MAX_TICKS = 90;

export default function SimPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [graph, setGraph] = useState<VenueGraph | null>(null);
  const [tick, setTick] = useState<SimTick | null>(null);
  const [waiting, setWaiting] = useState(true);
  const [advice, setAdvice] = useState<AdvisorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tickCount, setTickCount] = useState(0);

  const imageUrl = useMemo(() => layoutImageUrl(sessionId), [sessionId]);
  const progress = Math.min(100, (tickCount / MAX_TICKS) * 100);

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
        if (session.last_tick) setTick(session.last_tick);
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
        setTickCount((c) => c + 1);
      },
      onDone: (finalTick) => {
        if (done) return;
        done = true;
        if (finalTick) setTick(finalTick);
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

  return (
    <main className="sim-shell">
      <section className="panel sim-left">
        <div className="sim-meta">
          <div>
            <h1>Live simulation</h1>
            <p className="muted" style={{ margin: 0 }}>
              {tick
                ? `Clock ${tick.sim_time} · remaining to spawn ${Math.round(tick.remaining_to_spawn)}`
                : "Warming up…"}
            </p>
          </div>
          <Link className="btn btn-secondary" href="/">
            New run
          </Link>
        </div>
        {graph ? (
          <VenueCanvas imageUrl={imageUrl} graph={graph} mode="sim" tick={tick} />
        ) : (
          <div className="banner banner-info">Loading venue graph…</div>
        )}
        <p className="canvas-caption">
          Red intensity on nodes reflects live density / hotspot severity.
        </p>
      </section>

      <SimReport
        waiting={waiting}
        progress={progress}
        tick={tick}
        advice={advice}
        error={error}
      />
    </main>
  );
}
