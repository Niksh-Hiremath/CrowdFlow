import { describe, expect, it } from "vitest";
import { PersistentBottleneckDetector, type BottleneckSample } from "../../src/server/simulation/bottlenecks";
import { DEFAULT_SIMULATION_CONFIG } from "../../src/server/simulation";

const overloaded: BottleneckSample = {
  locationType: "node",
  locationId: "test_node",
  label: "Test Node",
  occupancyRatio: 0.85,
  inflowPeoplePerMinute: 100,
  outflowPeoplePerMinute: 20,
};

describe("persistent bottleneck detection", () => {
  it("suppresses transient spikes and clears only after a sustained recovery", () => {
    const detector = new PersistentBottleneckDetector({
      ...DEFAULT_SIMULATION_CONFIG,
      persistenceTicks: 3,
      clearanceTicks: 2,
    });

    expect(detector.update([overloaded], 1)).toEqual([]);
    expect(detector.update([overloaded], 2)).toEqual([]);
    expect(detector.update([overloaded], 3)).toHaveLength(1);

    const recovered = { ...overloaded, occupancyRatio: 0.2, inflowPeoplePerMinute: 10, outflowPeoplePerMinute: 80 };
    expect(detector.update([recovered], 4)).toHaveLength(1);
    expect(detector.update([recovered], 5)).toEqual([]);
  });

  it("classifies a critical persistent condition", () => {
    const detector = new PersistentBottleneckDetector({
      ...DEFAULT_SIMULATION_CONFIG,
      persistenceTicks: 1,
    });
    const [finding] = detector.update([{ ...overloaded, occupancyRatio: 0.95 }], 1);
    expect(finding?.severity).toBe("critical");
    expect(finding?.locationId).toBe("test_node");
  });
});

