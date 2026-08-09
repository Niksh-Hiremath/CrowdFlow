import { describe, expect, it } from "vitest";
import { requireVenuePreset } from "../../src/shared/presets";
import { computeAlternativePaths, computeShortestPath } from "../../src/server/simulation";

const preset = requireVenuePreset("test-parallel-routes");

describe("congestion-aware routing", () => {
  it("uses the short branch at free flow and the wide branch when the short branch congests", () => {
    const freeFlow = computeShortestPath(preset.graph, "parallel_gate", "parallel_hall");
    expect(freeFlow?.edgeIds).toContain("parallel_fork_north_ab");

    const congested = computeShortestPath(preset.graph, "parallel_gate", "parallel_hall", {
      congestionPenaltyAlpha: 20,
      edgeOccupancyRatios: {
        parallel_fork_north_ab: 1,
        parallel_north_hall_ab: 1,
      },
    });
    expect(congested?.edgeIds).toContain("parallel_fork_south_ab");
    expect(congested?.edgeIds).not.toContain("parallel_fork_north_ab");
  });

  it("returns distinct, deterministic path alternatives", () => {
    const paths = computeAlternativePaths(
      preset.graph,
      "parallel_gate",
      "parallel_hall",
      3,
    );
    expect(paths).toHaveLength(2);
    expect(new Set(paths.map((path) => path.edgeIds.join("|"))).size).toBe(paths.length);
    expect(paths[0]!.costMinutes).toBeLessThanOrEqual(paths[1]!.costMinutes);
  });

  it("honors a deterministic avoid policy", () => {
    const path = computeShortestPath(preset.graph, "parallel_gate", "parallel_hall", {
      policies: [
        {
          id: "avoid_north",
          label: "Use wide route",
          avoidEdgeIds: ["parallel_fork_north_ab"],
          penaltyMultiplier: 100,
        },
      ],
    });
    expect(path?.edgeIds).toContain("parallel_fork_south_ab");
  });
});

