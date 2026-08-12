import type { TryLayout } from "@/lib/presets";

interface Props {
  layout: TryLayout;
  onClose: () => void;
  onSelect: () => void;
}

export default function LayoutPreviewModal({ layout, onClose, onSelect }: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal" style={{ maxWidth: 800 }}>
        <div className="modal-header">
          <div>
            <h2>{layout.title}</h2>
            <p>Layout Preview</p>
          </div>
        </div>

        <div className="canvas-frame" style={{ marginBottom: 16, height: "40vh" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={layout.imageSrc} alt={layout.title} style={{ objectFit: "contain" }} />
        </div>

        <div className="panel" style={{ marginBottom: 24, background: "transparent", border: "none", padding: 0, boxShadow: "none" }}>
          <p style={{ fontSize: "1.05rem", lineHeight: 1.6, margin: "0 0 16px 0", color: "var(--ink)" }}>
            {layout.description}
          </p>
          <div className="label">Expected Crowd: <span style={{ color: "var(--ink)", fontWeight: "bold", textTransform: "none" }}>{layout.expectedCrowd} People</span></div>
        </div>

        <div className="actions-row" style={{ justifyContent: "flex-end", gap: 12 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onSelect}>
            Select this layout
          </button>
        </div>
      </div>
    </div>
  );
}
