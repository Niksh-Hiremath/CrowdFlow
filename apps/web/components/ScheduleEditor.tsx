"use client";

import type { ScheduleBlock, ScheduleBlockType } from "@/lib/types";

const TYPES: ScheduleBlockType[] = ["arrival", "attraction", "break", "egress", "other"];

interface Props {
  blocks: ScheduleBlock[];
  onChange: (blocks: ScheduleBlock[]) => void;
}

export default function ScheduleEditor({ blocks, onChange }: Props) {
  function update(index: number, patch: Partial<ScheduleBlock>) {
    onChange(blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  function remove(index: number) {
    onChange(blocks.filter((_, i) => i !== index));
  }

  function add() {
    const n = blocks.length + 1;
    onChange([
      ...blocks,
      {
        id: `block_${n}`,
        label: `Phase ${n}`,
        type: "other",
        start: "17:00",
        end: "18:00",
        attractors: [],
        arrival_rate_per_min: 0,
      },
    ]);
  }

  return (
    <div className="schedule-list">
      {blocks.map((block, index) => (
        <div className="schedule-row" key={`${block.id}-${index}`}>
          <div>
            <label className="label">Label</label>
            <input
              className="field"
              value={block.label}
              onChange={(e) => update(index, { label: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Type</label>
            <select
              className="field"
              value={block.type}
              onChange={(e) => update(index, { type: e.target.value as ScheduleBlockType })}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Start</label>
            <input
              className="field"
              value={block.start}
              onChange={(e) => update(index, { start: e.target.value })}
              placeholder="HH:MM"
            />
          </div>
          <div>
            <label className="label">End</label>
            <input
              className="field"
              value={block.end}
              onChange={(e) => update(index, { end: e.target.value })}
              placeholder="HH:MM"
            />
          </div>
          <div>
            <label className="label">Arrival / min</label>
            <input
              className="field"
              type="number"
              min={0}
              value={block.arrival_rate_per_min}
              onChange={(e) =>
                update(index, { arrival_rate_per_min: Number(e.target.value) || 0 })
              }
            />
          </div>
          <button type="button" className="btn btn-danger" onClick={() => remove(index)}>
            Remove
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="btn btn-secondary" onClick={add}>
          Add schedule block
        </button>
      </div>
    </div>
  );
}
