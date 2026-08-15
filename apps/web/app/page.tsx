"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ReviewModal from "@/components/ReviewModal";
import LayoutPreviewModal from "@/components/LayoutPreviewModal";
import ScheduleEditor from "@/components/ScheduleEditor";
import TryThisLayouts from "@/components/TryThisLayouts";
import {
  confirmGraph,
  createSession,
  extractLayout,
  putScenario,
  startSim,
} from "@/lib/api";
import { TRY_LAYOUTS, type TryLayoutId } from "@/lib/presets";
import type { ExtractionProgress, ScheduleBlock, VenueGraph } from "@/lib/types";

export default function SetupPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLayoutId, setPreviewLayoutId] = useState<TryLayoutId | null>(null);
  const [selectedTry, setSelectedTry] = useState<TryLayoutId | null>(null);
  const [crowd, setCrowd] = useState(400);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(TRY_LAYOUTS[0].blocks);
  const [extracting, setExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [graph, setGraph] = useState<VenueGraph | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const canRun = useMemo(
    () => Boolean(file) && crowd >= 1 && blocks.length >= 1 && !extracting,
    [file, crowd, blocks.length, extracting],
  );

  async function selectTry(id: TryLayoutId) {
    const layout = TRY_LAYOUTS.find((l) => l.id === id);
    if (!layout) return;
    setSelectedTry(id);
    setCrowd(layout.expectedCrowd);
    setBlocks(layout.blocks.map((b) => ({ ...b, attractors: [...b.attractors] })));
    setError(null);
    const res = await fetch(layout.imageSrc);
    const blob = await res.blob();
    const f = new File([blob], `${id}.png`, { type: blob.type || "image/png" });
    setFile(f);
    setPreviewUrl(layout.imageSrc);
  }

  function onFileChange(f: File | null) {
    setSelectedTry(null);
    setFile(f);
    if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  }

  async function onRun() {
    if (!file || !canRun) return;
    setExtracting(true);
    setError(null);
    setExtractionProgress({
      session_id: "",
      status: "queued",
      progress: 0,
      stage: "Uploading layout",
      error: null,
      graph: null,
    });
    try {
      const session = await createSession();
      const sid = session.session_id;
      setSessionId(sid);
      const extracted = await extractLayout(sid, file, file.name, setExtractionProgress);
      setGraph(extracted);
      setReviewOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extract failed");
    } finally {
      setExtracting(false);
      setExtractionProgress(null);
    }
  }

  async function onConfirm() {
    if (!sessionId || !graph) return;
    
    // Calculate total event duration to prevent early stopping
    let totalTicks = 90;
    if (blocks.length > 0) {
      const first = blocks[0].start;
      const last = blocks[blocks.length - 1].end;
      const [h1, m1] = first.split(":").map(Number);
      const [h2, m2] = last.split(":").map(Number);
      let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
      if (diff < 0) diff += 24 * 60; // Handle midnight crossover
      totalTicks = Math.min(500, Math.max(1, diff));
    }
    
    setConfirming(true);
    setError(null);
    try {
      await putScenario(sessionId, {
        expected_crowd: crowd,
        schedule: { timezone: "Asia/Kolkata", blocks },
      });
      const confirmed = await confirmGraph(sessionId);
      if (!confirmed.ok) {
        setError(confirmed.errors.join("; ") || "Graph validation failed");
        if (confirmed.graph) setGraph(confirmed.graph);
        setConfirming(false);
        return;
      }
      await startSim(sessionId, totalTicks);
      router.push(`/sim/${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start simulation");
      setConfirming(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="brand">
        <h1>Crowd Flow Optimiser</h1>
        <p>
          Upload a top-down venue layout, set expected crowd and schedule, review the extracted
          graph, then watch congestion form in simulation.
        </p>
      </header>

      {error && !reviewOpen && <div className="banner banner-error">{error}</div>}

      {extracting && extractionProgress && (
        <section className="panel extraction-progress-panel" aria-live="polite">
          <div className="extraction-progress-header">
            <strong>Extracting graph</strong>
            <span>{extractionProgress.progress}%</span>
          </div>
          <div className="progress extraction-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={extractionProgress.progress}>
            <span style={{ width: `${extractionProgress.progress}%` }} />
          </div>
          <p className="hint extraction-progress-stage">{extractionProgress.stage}</p>
        </section>
      )}

      <div className="stack">
        <section className="panel">
          <h2>Try this layout</h2>
          <p className="hint">Load a sample floorplan with a sensible crowd size and schedule.</p>
          <TryThisLayouts selectedId={selectedTry} onPreview={setPreviewLayoutId} />
        </section>

        <div className="grid-2">
          <section className="panel">
            <h2>Venue layout</h2>
            <p className="hint">Top-down image used for graph extraction.</p>
            <div className={`upload-zone ${file ? "has-file" : ""}`}>
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="Selected layout preview"
                  style={{ width: "100%", maxHeight: 220, objectFit: "contain", borderRadius: 8 }}
                />
              ) : (
                <div>Drop or choose a top-down venue image</div>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onFileChange(e.target.files?.[0] || null)}
              />
            </div>
          </section>

          <section className="panel">
            <h2>Expected crowd</h2>
            <p className="hint">Total guests the simulator will inject over the schedule.</p>
            <label className="label" htmlFor="crowd">
              People
            </label>
            <input
              id="crowd"
              className="field"
              type="number"
              min={1}
              value={crowd}
              onChange={(e) => setCrowd(Math.max(1, Number(e.target.value) || 1))}
            />
          </section>
        </div>

        <section className="panel">
          <h2>Event schedule</h2>
          <p className="hint">Structured phases drive arrivals and attractors during the run.</p>
          <ScheduleEditor blocks={blocks} onChange={setBlocks} />
        </section>

        <div className="actions-row">
          <button type="button" className="btn btn-primary" disabled={!canRun} onClick={() => void onRun()}>
            {extracting ? "Extracting layout…" : "Run simulation"}
          </button>
        </div>
      </div>

      {reviewOpen && sessionId && graph && (
        <ReviewModal
          sessionId={sessionId}
          graph={graph}
          onGraphChange={setGraph}
          onConfirm={onConfirm}
          onClose={() => setReviewOpen(false)}
          confirming={confirming}
          error={error}
        />
      )}

      {previewLayoutId && (() => {
        const layout = TRY_LAYOUTS.find((l) => l.id === previewLayoutId);
        if (!layout) return null;
        return (
          <LayoutPreviewModal
            layout={layout}
            onClose={() => setPreviewLayoutId(null)}
            onSelect={() => {
              void selectTry(previewLayoutId);
              setPreviewLayoutId(null);
            }}
          />
        );
      })()}
    </main>
  );
}
