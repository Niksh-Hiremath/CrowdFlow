"use client";

import { TRY_LAYOUTS, type TryLayoutId } from "@/lib/presets";

interface Props {
  selectedId: TryLayoutId | null;
  onSelect: (id: TryLayoutId) => void;
}

export default function TryThisLayouts({ selectedId, onSelect }: Props) {
  return (
    <div className="try-grid">
      {TRY_LAYOUTS.map((layout) => (
        <button
          key={layout.id}
          type="button"
          className={`try-card ${selectedId === layout.id ? "selected" : ""}`}
          onClick={() => onSelect(layout.id)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={layout.imageSrc} alt={layout.title} />
          <div className="body">
            <h3>{layout.title}</h3>
            <p>{layout.description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
