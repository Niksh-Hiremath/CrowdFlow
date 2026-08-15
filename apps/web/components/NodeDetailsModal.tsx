import type { VenueNode } from "@/lib/types";

interface Props {
  node: VenueNode;
  imageUrl: string;
  onClose: () => void;
  onUpdate: (patch: Partial<VenueNode>) => void;
  onDelete: () => void;
}

export default function NodeDetailsModal({ node, imageUrl, onClose, onUpdate, onDelete }: Props) {
  // Ensure x and y are clamped for background positioning
  const bgPosX = Math.min(100, Math.max(0, node.x * 100));
  const bgPosY = Math.min(100, Math.max(0, node.y * 100));

  return (
    <div 
      className="modal-backdrop" 
      style={{ 
        zIndex: 60, 
        background: "transparent", 
        backdropFilter: "none",
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        padding: "40px",
        animation: "none"
      }} 
      role="dialog" 
      aria-modal="true"
    >
      <div 
        className="modal" 
        style={{ 
          maxWidth: 480, 
          width: "100%",
          margin: 0, 
          pointerEvents: "auto",
          boxShadow: "0 30px 60px rgba(0,0,0,0.9), 0 0 0 1px var(--line)",
          animation: "none",
          borderTop: "3px solid var(--accent)",
          display: "flex",
          flexDirection: "column",
          gap: 16
        }}
      >
        <div className="modal-header" style={{ borderBottom: "none", paddingBottom: 0 }}>
          <div>
            <h2 style={{ fontSize: "1.5rem", marginBottom: 4 }}>
              {node.label || "Unnamed Room"}{node.bidirectional ? " · Bidirectional" : ""}
            </h2>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>Node ID: {node.id}</p>
          </div>
        </div>

        <div
          className="canvas-frame"
          style={{
            position: "relative",
            width: "100%",
            overflow: "hidden",
            borderRadius: "12px",
            border: "1px solid var(--line)",
            boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)"
          }}
        >
          <div style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            transformOrigin: "0 0",
            transform: `translate(calc(50% - ${node.x * 400}%), calc(50% - ${node.y * 400}%)) scale(4)`
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img 
              src={imageUrl} 
              alt="Zoomed layout"
              style={{ 
                width: "100%",
                height: "100%",
                objectFit: "contain",
                filter: "none",
                pointerEvents: "none"
              }}
            />
          </div>
          
          <div style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "var(--accent)",
            border: "2px solid #fff",
            boxShadow: "0 0 10px rgba(0,0,0,0.8)",
            zIndex: 10
          }} />
        </div>

        <div className="inspector" style={{ background: "var(--surface)", border: "1px solid var(--line)", padding: 16, borderRadius: 10 }}>
          <div style={{ flex: 1 }}>
            <label className="label" style={{ marginBottom: 6 }}>Rename Room</label>
            <input
              className="field"
              value={node.label}
              onChange={(e) => onUpdate({ label: e.target.value })}
              style={{ background: "#050505", border: "1px solid var(--line)" }}
            />
          </div>
        </div>

        <div className="actions-row" style={{ justifyContent: "space-between", marginTop: 8 }}>
          <button type="button" className="btn btn-danger" onClick={onDelete}>
            Delete node
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
