import { describe, expect, it } from "vitest";
import { calibrateScheduleDemand } from "../../src/server/graph-adapter";
import type { ScheduleBlock } from "../../src/shared/types";

const schedule: readonly ScheduleBlock[] = [
  {
    id: "arrival",
    label: "Arrival",
    startMinute: 0,
    endMinute: 10,
    phase: "arrival",
    arrivalRatePerMinute: 10,
    entryWeights: { entry: 1 },
    targetWeights: { stage: 1 },
    rerouteCompliance: 1,
  },
  {
    id: "egress",
    label: "Egress",
    startMinute: 10,
    endMinute: 20,
    phase: "egress",
    arrivalRatePerMinute: 0,
    entryWeights: {},
    targetWeights: { exit: 1 },
    rerouteCompliance: 1,
  },
];

const integratedDemand = (blocks: readonly ScheduleBlock[]): number =>
  blocks.reduce(
    (total, block) => total + block.arrivalRatePerMinute * (block.endMinute - block.startMinute),
    0,
  );

describe("schedule demand calibration", () => {
  it("scales the arrival curve to crowdSize minus initial occupancy", () => {
    const calibrated = calibrateScheduleDemand(schedule, 250, 50, ["entry"]);
    expect(integratedDemand(calibrated)).toBeCloseTo(200, 8);
    expect(calibrated[0]!.arrivalRatePerMinute).toBeCloseTo(20, 8);
  });

  it("does not double-count a crowd already present at t=0", () => {
    const calibrated = calibrateScheduleDemand(schedule, 50, 50, ["entry"]);
    expect(integratedDemand(calibrated)).toBe(0);
  });

  it("creates a deterministic flat arrival curve when none was supplied", () => {
    const noArrivals = schedule.map((block) => ({ ...block, arrivalRatePerMinute: 0 }));
    const calibrated = calibrateScheduleDemand(noArrivals, 120, 20, ["entry"]);
    expect(calibrated[0]!.arrivalRatePerMinute).toBeCloseTo(10, 8);
    expect(calibrated[0]!.entryWeights).toEqual({ entry: 1 });
    expect(integratedDemand(calibrated)).toBeCloseTo(100, 8);
  });
});
