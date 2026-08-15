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
    description:
      "A sprawling banquet and gala floorplan designed for weddings and large formal events. It features dedicated aisles, a central buffet area, and a spacious dance floor. This layout is ideal for simulating multi-phase events with distinct crowd movements during ceremonies, dinner service, and late-night dancing.",
    imageSrc: "/layouts/banquet.png",
    expectedCrowd: 450,
    blocks: [
      block("arrival", "Guest arrival", "arrival", "17:00", "18:00", ["entry_gate", "seating"], 35),
      block("ceremony", "Ceremony / main event", "attraction", "18:00", "19:30", ["seating", "attraction"], 3),
      block("dinner", "Dinner service", "break", "19:30", "20:45", ["concession", "restroom", "seating"], 1),
      block("dance", "Dance and social", "attraction", "20:45", "22:15", ["attraction", "concession"], 1),
      block("egress", "Guest egress", "egress", "22:15", "23:30", ["exit", "entry_gate"], 1),
    ],
  },
  {
    id: "concert",
    title: "Concert theatre",
    description:
      "A multi-tier concert theatre layout with intricate seating arrangements. The floorplan includes an orchestra section, parterre seating, and multiple aisle junctions leading to a stage pit. This layout is perfect for modeling dense crowd flows during ingress, intermission rushes to restrooms and concessions, and mass egress.",
    imageSrc: "/layouts/concert.png",
    expectedCrowd: 650,
    blocks: [
      block("doors", "Doors open / ingress", "arrival", "18:00", "19:00", ["entry_gate", "seating", "walkway_junction"], 55),
      block("show", "Performance", "attraction", "19:00", "21:00", ["seating", "attraction"], 2),
      block("interval", "Interval circulation", "break", "21:00", "21:25", ["concession", "restroom", "walkway_junction"], 1),
      block("encore", "Second half", "attraction", "21:25", "22:15", ["seating", "attraction"], 1),
      block("egress", "Mass egress", "egress", "22:15", "23:30", ["exit", "entry_gate", "walkway_junction"], 1),
    ],
  },
];
