"use client";

import { TRY_LAYOUTS, type TryLayoutId } from "@/lib/presets";

interface Props {
  selectedId: TryLayoutId | null;
  onPreview: (id: TryLayoutId) => void;
}

export default function TryThisLayouts({ selectedId, onPreview }: Props) {
  return (
    <div className="try-grid">
      {TRY_LAYOUTS.map((layout) => (
        <button
          key={layout.id}
          type="button"
          className={`try-card ${selectedId === layout.id ? "selected" : ""}`}
          onClick={() => onPreview(layout.id)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={layout.imageSrc} alt={layout.title} />
        </button>
      ))}
    </div>
  );
}
