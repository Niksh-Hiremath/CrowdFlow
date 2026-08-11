import type { ScheduleBlock, ScheduleBlockType } from "./types";

export type TryLayoutId = "banquet" | "concert";

export interface TryLayout {
  id: TryLayoutId;
  title: string;
  description: string;
  imageSrc: string;
  expectedCrowd: number;
  blocks: ScheduleBlock[];
}

function block(
  id: string,
  label: string,
  type: ScheduleBlockType,
  start: string,
  end: string,
  attractors: string[],
  arrival_rate_per_min: number,
): ScheduleBlock {
  return { id, label, type, start, end, attractors, arrival_rate_per_min };
}

export const TRY_LAYOUTS: TryLayout[] = [
  {
    id: "banquet",
    title: "Banquet hall",
    description: "Wedding / gala floorplan with aisles, buffet, and dance floor.",
    imageSrc: "/layouts/banquet.png",
    expectedCrowd: 400,
    blocks: [
      block("arrival", "Guest arrival", "arrival", "17:00", "18:00", ["seating_center", "bar"], 55),
      block("ceremony", "Main event", "attraction", "18:00", "19:30", ["head_table", "seating_center"], 5),
      block("break", "Intermission / dinner", "break", "19:30", "20:30", ["buffet", "bar", "restrooms"], 2),
      block("dance", "Dance", "attraction", "20:30", "22:00", ["dance_floor", "bar"], 0),
      block("egress", "Exit rush", "egress", "22:00", "22:45", ["entry_main", "exit_secondary"], 0),
    ],
  },
  {
    id: "concert",
    title: "Concert theatre",
    description: "Multi-tier seating with aisle junctions and pit access.",
    imageSrc: "/layouts/concert.png",
    expectedCrowd: 800,
    blocks: [
      block("doors", "Doors open", "arrival", "18:00", "19:00", ["orchestra_seating", "walkway_junction_1"], 80),
      block("show", "Performance", "attraction", "19:00", "21:00", ["orchestra_seating", "parterre"], 3),
      block("interval", "Interval", "break", "21:00", "21:20", ["concession", "restroom"], 0),
      block("encore", "Second half", "attraction", "21:20", "22:10", ["orchestra_seating", "pit"], 0),
      block("egress", "Egress", "egress", "22:10", "22:50", ["entry_gate", "exit_main"], 0),
    ],
  },
];
