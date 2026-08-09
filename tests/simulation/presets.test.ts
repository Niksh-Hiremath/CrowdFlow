import { describe, expect, it } from "vitest";
import { DEFAULT_PRESET_ID, VENUE_PRESETS, getVenuePreset, requireVenuePreset } from "../../src/shared/presets";
import type { VenuePreset } from "../../src/shared/types";
import { validateVenuePreset } from "../../src/server/simulation";

describe("venue scenario presets", () => {
  it("ships seven deterministic venue scenarios", () => {
    expect(VENUE_PRESETS).toHaveLength(7);
    expect(new Set(VENUE_PRESETS.map((preset) => preset.id)).size).toBe(7);
    expect(VENUE_PRESETS.map((preset) => preset.category)).toEqual(
      expect.arrayContaining([
        "ipl_stadium",
        "concert",
        "railway_station",
        "airport",
        "large_festival",
        "test_corridor",
        "test_parallel_routes",
      ]),
    );
  });

  it("uses the approved primary layout paths", () => {
    expect(requireVenuePreset("ipl-stadium").imagePath).toBe("/presets/stadio-benito-stirpe.png");
    expect(requireVenuePreset("concert-arena").imagePath).toBe("/presets/turk-telekom-arena-concert.png");
    expect(requireVenuePreset("railway-station").imagePath).toBe("/presets/new-delhi-railway-station.png");
    expect(requireVenuePreset("airport-terminal").imagePath).toBe("/presets/istanbul-airport-departures.png");
  });

  it.each(VENUE_PRESETS.map((preset) => [preset.id, preset] as const))(
    "%s has a valid capacitated graph and a complete explicit schedule",
    (_id, preset) => {
      expect(validateVenuePreset(preset)).toEqual([]);
      expect(preset.crowdSize).toBeGreaterThan(0);
      expect(preset.schedule[0]?.startMinute).toBe(0);
      expect(preset.schedule.at(-1)?.endMinute).toBe(preset.durationMinutes);
      const initialPeople = Object.values(preset.initialOccupancy).reduce((total, value) => total + value, 0);
      const scheduledPeople = preset.schedule.reduce(
        (total, block) => total + block.arrivalRatePerMinute * (block.endMinute - block.startMinute),
        0,
      );
      expect(initialPeople + scheduledPeople).toBeCloseTo(preset.crowdSize, 6);
      for (const scheduleBlock of preset.schedule) {
        expect(scheduleBlock.endMinute).toBeGreaterThan(scheduleBlock.startMinute);
        expect(Object.values(scheduleBlock.targetWeights).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
      }
    },
  );

  it("provides safe lookup helpers", () => {
    expect(getVenuePreset(DEFAULT_PRESET_ID)?.id).toBe(DEFAULT_PRESET_ID);
    expect(getVenuePreset("does-not-exist")).toBeUndefined();
    expect(() => requireVenuePreset("does-not-exist")).toThrow(/unknown venue preset/i);
  });

  it("rejects a schedule transition that strands an occupied phase target", () => {
    const strandedPreset: VenuePreset = {
      id: "stranded-egress",
      name: "Stranded egress",
      shortName: "Stranded",
      description: "Validation fixture",
      category: "test_corridor",
      imagePath: "/test-layouts/grand-central-terminal.png",
      crowdSize: 10,
      durationMinutes: 2,
      graph: {
        nodes: [
          { id: "entry", label: "Entry", type: "entry_gate", x: 0, y: 0.5, capacityPeople: 20, maxThroughputPerMinute: 20 },
          { id: "stage", label: "Stage", type: "attraction", x: 0.5, y: 0.5, capacityPeople: 20, maxThroughputPerMinute: 20 },
          { id: "exit", label: "Exit", type: "exit", x: 1, y: 0.5, capacityPeople: 20, maxThroughputPerMinute: 20 },
        ],
        // Entry can reach both targets, but the directed stage cannot reach the
        // exit once the egress phase begins.
        edges: [
          { id: "entry_stage", source: "entry", target: "stage", lengthMeters: 10, widthMeters: 2, capacityPeople: 20, maxFlowPerMinute: 20, freeSpeedMps: 1 },
          { id: "entry_exit", source: "entry", target: "exit", lengthMeters: 10, widthMeters: 2, capacityPeople: 20, maxFlowPerMinute: 20, freeSpeedMps: 1 },
        ],
      },
      initialOccupancy: { stage: 10 },
      schedule: [
        { id: "show", label: "Show", startMinute: 0, endMinute: 1, phase: "event", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { stage: 1 }, rerouteCompliance: 1 },
        { id: "exit_phase", label: "Exit", startMinute: 1, endMinute: 2, phase: "egress", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { exit: 1 }, rerouteCompliance: 1 },
      ],
    };

    expect(validateVenuePreset(strandedPreset)).toContain(
      "Schedule transition show -> exit_phase cannot route stage to exit.",
    );
  });
});
