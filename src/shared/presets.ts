import type {
  ScheduleBlock,
  VenueEdge,
  VenueGraph,
  VenueNode,
  VenueNodeType,
  VenuePreset,
} from "./types";

type LinkSpec = Omit<VenueEdge, "id" | "source" | "target">;

const node = (
  id: string,
  label: string,
  type: VenueNodeType,
  x: number,
  y: number,
  capacityPeople: number,
  maxThroughputPerMinute: number,
  floor?: number,
): VenueNode => ({
  id,
  label,
  type,
  x,
  y,
  capacityPeople,
  maxThroughputPerMinute,
  ...(floor === undefined ? {} : { floor }),
});

const oneWay = (
  id: string,
  source: string,
  target: string,
  spec: LinkSpec,
): VenueEdge => ({ id, source, target, ...spec });

const twoWay = (
  id: string,
  a: string,
  b: string,
  spec: LinkSpec,
): readonly VenueEdge[] => [
  oneWay(`${id}_ab`, a, b, spec),
  oneWay(`${id}_ba`, b, a, spec),
];

const link = (
  lengthMeters: number,
  widthMeters: number,
  capacityPeople: number,
  maxFlowPerMinute: number,
  freeSpeedMps = 1.25,
): LinkSpec => ({
  lengthMeters,
  widthMeters,
  capacityPeople,
  maxFlowPerMinute,
  freeSpeedMps,
});

const block = (value: ScheduleBlock): ScheduleBlock => value;

const stadiumGraph: VenueGraph = {
  nodes: [
    node("stadium_gate_n", "North Gate", "entry_gate", 0.5, 0.04, 2_400, 1_200),
    node("stadium_gate_s", "South Gate", "entry_gate", 0.5, 0.96, 2_400, 1_200),
    node("stadium_west_concourse", "West Concourse", "walkway_junction", 0.18, 0.5, 6_000, 2_200),
    node("stadium_east_concourse", "East Concourse", "walkway_junction", 0.82, 0.5, 6_000, 2_200),
    node("stadium_north_stand", "North Stand", "seating", 0.5, 0.25, 24_000, 2_400),
    node("stadium_south_stand", "South Stand", "seating", 0.5, 0.75, 24_000, 2_400),
    node("stadium_food", "Food Court", "concession", 0.18, 0.7, 3_000, 650),
    node("stadium_restrooms", "Restrooms", "restroom", 0.82, 0.3, 1_800, 420),
    node("stadium_exit_w", "West Exit", "exit", 0.02, 0.5, 1_500, 1_800),
    node("stadium_exit_e", "East Exit", "emergency_exit", 0.98, 0.5, 1_500, 1_800),
  ],
  edges: [
    ...twoWay("stadium_n_to_w", "stadium_gate_n", "stadium_west_concourse", link(115, 12, 3_200, 1_000)),
    ...twoWay("stadium_n_to_e", "stadium_gate_n", "stadium_east_concourse", link(115, 12, 3_200, 1_000)),
    ...twoWay("stadium_s_to_w", "stadium_gate_s", "stadium_west_concourse", link(115, 12, 3_200, 1_000)),
    ...twoWay("stadium_s_to_e", "stadium_gate_s", "stadium_east_concourse", link(115, 12, 3_200, 1_000)),
    ...twoWay("stadium_w_to_nstand", "stadium_west_concourse", "stadium_north_stand", link(75, 9, 2_000, 700)),
    ...twoWay("stadium_e_to_nstand", "stadium_east_concourse", "stadium_north_stand", link(75, 9, 2_000, 700)),
    ...twoWay("stadium_w_to_sstand", "stadium_west_concourse", "stadium_south_stand", link(75, 9, 2_000, 700)),
    ...twoWay("stadium_e_to_sstand", "stadium_east_concourse", "stadium_south_stand", link(75, 9, 2_000, 700)),
    ...twoWay("stadium_w_food", "stadium_west_concourse", "stadium_food", link(35, 5, 900, 360)),
    ...twoWay("stadium_e_restrooms", "stadium_east_concourse", "stadium_restrooms", link(35, 4, 700, 300)),
    oneWay("stadium_w_exit", "stadium_west_concourse", "stadium_exit_w", link(30, 14, 1_800, 1_600)),
    oneWay("stadium_e_exit", "stadium_east_concourse", "stadium_exit_e", link(30, 14, 1_800, 1_600)),
  ],
};

const concertGraph: VenueGraph = {
  nodes: [
    node("concert_gate_a", "Gate A", "entry_gate", 0.12, 0.9, 1_600, 900),
    node("concert_gate_b", "Gate B", "entry_gate", 0.88, 0.9, 1_600, 900),
    node("concert_west", "West Fan-Out", "walkway_junction", 0.3, 0.65, 4_000, 1_400),
    node("concert_east", "East Fan-Out", "walkway_junction", 0.7, 0.65, 4_000, 1_400),
    node("concert_floor", "Main Floor", "attraction", 0.5, 0.35, 30_000, 2_600),
    node("concert_food", "Food Village", "concession", 0.16, 0.42, 2_200, 480),
    node("concert_exit_w", "West Exit", "exit", 0.02, 0.62, 1_300, 1_400),
    node("concert_exit_e", "East Exit", "emergency_exit", 0.98, 0.62, 1_300, 1_400),
  ],
  edges: [
    ...twoWay("concert_a_w", "concert_gate_a", "concert_west", link(65, 9, 1_800, 720)),
    ...twoWay("concert_b_e", "concert_gate_b", "concert_east", link(65, 9, 1_800, 720)),
    ...twoWay("concert_cross", "concert_west", "concert_east", link(90, 6, 1_600, 520)),
    ...twoWay("concert_w_floor", "concert_west", "concert_floor", link(85, 10, 2_500, 900)),
    ...twoWay("concert_e_floor", "concert_east", "concert_floor", link(85, 10, 2_500, 900)),
    ...twoWay("concert_w_food", "concert_west", "concert_food", link(40, 5, 800, 300)),
    oneWay("concert_w_exit", "concert_west", "concert_exit_w", link(25, 12, 1_200, 1_100)),
    oneWay("concert_e_exit", "concert_east", "concert_exit_e", link(25, 12, 1_200, 1_100)),
  ],
};

const railwayGraph: VenueGraph = {
  nodes: [
    node("rail_entry", "Station Entrance", "entry_gate", 0.08, 0.5, 900, 520),
    node("rail_ticket", "Ticket Hall", "walkway_junction", 0.25, 0.5, 1_800, 720),
    node("rail_bridge", "Footbridge", "walkway_junction", 0.5, 0.5, 1_400, 430, 1),
    node("rail_platform_1", "Platform 1", "platform", 0.72, 0.28, 4_800, 620),
    node("rail_platform_2", "Platform 2", "platform", 0.72, 0.72, 4_800, 620),
    node("rail_exit", "Main Exit", "exit", 0.92, 0.5, 900, 700),
    node("rail_emergency", "Emergency Exit", "emergency_exit", 0.92, 0.9, 650, 500),
  ],
  edges: [
    ...twoWay("rail_entry_ticket", "rail_entry", "rail_ticket", link(45, 7, 850, 450)),
    ...twoWay("rail_ticket_bridge", "rail_ticket", "rail_bridge", link(65, 4, 600, 280, 1.0)),
    ...twoWay("rail_bridge_p1", "rail_bridge", "rail_platform_1", link(55, 4, 620, 290, 1.0)),
    ...twoWay("rail_bridge_p2", "rail_bridge", "rail_platform_2", link(55, 4, 620, 290, 1.0)),
    ...twoWay("rail_p1_p2", "rail_platform_1", "rail_platform_2", link(80, 5, 1_000, 360)),
    oneWay("rail_p1_exit", "rail_platform_1", "rail_exit", link(45, 7, 850, 500)),
    oneWay("rail_p2_exit", "rail_platform_2", "rail_exit", link(45, 7, 850, 500)),
    oneWay("rail_p2_emergency", "rail_platform_2", "rail_emergency", link(35, 5, 600, 360)),
  ],
};

const airportGraph: VenueGraph = {
  nodes: [
    node("airport_entry", "Terminal Entrance", "entry_gate", 0.06, 0.5, 1_200, 480),
    node("airport_checkin", "Check-in Hall", "walkway_junction", 0.22, 0.5, 3_500, 540),
    node("airport_security", "Security", "security", 0.4, 0.5, 1_300, 260),
    node("airport_retail", "Airside Retail", "concession", 0.58, 0.5, 2_600, 600),
    node("airport_gate_a", "Gate A", "attraction", 0.78, 0.3, 2_200, 420),
    node("airport_gate_b", "Gate B", "attraction", 0.78, 0.7, 2_200, 420),
    node("airport_arrivals", "Arrivals Hall", "walkway_junction", 0.58, 0.86, 2_800, 700),
    node("airport_exit", "Landside Exit", "exit", 0.92, 0.86, 1_000, 850),
    node("airport_emergency", "Emergency Exit", "emergency_exit", 0.92, 0.5, 700, 550),
  ],
  edges: [
    ...twoWay("airport_entry_checkin", "airport_entry", "airport_checkin", link(70, 10, 1_900, 460)),
    ...twoWay("airport_checkin_security", "airport_checkin", "airport_security", link(55, 6, 850, 240)),
    ...twoWay("airport_security_retail", "airport_security", "airport_retail", link(65, 8, 1_400, 420)),
    ...twoWay("airport_retail_gate_a", "airport_retail", "airport_gate_a", link(110, 7, 1_450, 380)),
    ...twoWay("airport_retail_gate_b", "airport_retail", "airport_gate_b", link(110, 7, 1_450, 380)),
    ...twoWay("airport_gate_a_arrivals", "airport_gate_a", "airport_arrivals", link(145, 6, 1_200, 330)),
    ...twoWay("airport_gate_b_arrivals", "airport_gate_b", "airport_arrivals", link(90, 6, 1_000, 330)),
    oneWay("airport_arrivals_exit", "airport_arrivals", "airport_exit", link(70, 12, 1_600, 720)),
    oneWay("airport_retail_emergency", "airport_retail", "airport_emergency", link(80, 8, 1_000, 500)),
  ],
};

const festivalGraph: VenueGraph = {
  nodes: [
    node("festival_gate_n", "North Festival Gate", "entry_gate", 0.35, 0.03, 8_000, 3_200),
    node("festival_gate_s", "South Festival Gate", "entry_gate", 0.65, 0.97, 8_000, 3_200),
    node("festival_sector_a", "Festival Sector A", "walkway_junction", 0.25, 0.35, 22_000, 5_000),
    node("festival_sector_b", "Festival Sector B", "walkway_junction", 0.5, 0.55, 25_000, 5_000),
    node("festival_sector_c", "Festival Sector C", "walkway_junction", 0.75, 0.35, 22_000, 5_000),
    node("festival_bridge", "Temporary Footbridge", "walkway_junction", 0.62, 0.26, 7_000, 1_800),
    node("festival_main_stage", "Main Stage Field", "attraction", 0.5, 0.12, 42_000, 5_500),
    node("festival_camp", "Festival Camping", "attraction", 0.28, 0.72, 30_000, 4_000),
    node("festival_exit_w", "West Dispersal", "exit", 0.02, 0.5, 6_000, 4_200),
    node("festival_exit_e", "East Dispersal", "emergency_exit", 0.98, 0.5, 6_000, 4_200),
  ],
  edges: [
    ...twoWay("festival_n_a", "festival_gate_n", "festival_sector_a", link(550, 24, 14_000, 2_800)),
    ...twoWay("festival_n_c", "festival_gate_n", "festival_sector_c", link(600, 20, 12_000, 2_400)),
    ...twoWay("festival_s_a", "festival_gate_s", "festival_sector_a", link(750, 24, 16_000, 2_800)),
    ...twoWay("festival_s_b", "festival_gate_s", "festival_sector_b", link(500, 28, 18_000, 3_200)),
    ...twoWay("festival_a_b", "festival_sector_a", "festival_sector_b", link(420, 22, 12_000, 2_500)),
    ...twoWay("festival_b_c", "festival_sector_b", "festival_sector_c", link(420, 22, 12_000, 2_500)),
    ...twoWay("festival_a_stage", "festival_sector_a", "festival_main_stage", link(520, 18, 9_000, 2_100)),
    ...twoWay("festival_c_bridge", "festival_sector_c", "festival_bridge", link(280, 10, 4_000, 1_500)),
    ...twoWay("festival_bridge_stage", "festival_bridge", "festival_main_stage", link(260, 10, 4_000, 1_500)),
    ...twoWay("festival_a_camp", "festival_sector_a", "festival_camp", link(340, 18, 8_000, 1_900)),
    oneWay("festival_a_exit", "festival_sector_a", "festival_exit_w", link(500, 30, 14_000, 3_800)),
    oneWay("festival_c_exit", "festival_sector_c", "festival_exit_e", link(500, 30, 14_000, 3_800)),
    oneWay("festival_b_exit_w", "festival_sector_b", "festival_exit_w", link(800, 22, 12_000, 2_700)),
    oneWay("festival_b_exit_e", "festival_sector_b", "festival_exit_e", link(800, 22, 12_000, 2_700)),
  ],
};

const corridorGraph: VenueGraph = {
  nodes: [
    node("corridor_gate", "Festival Gate", "entry_gate", 0.08, 0.5, 120, 70),
    node("corridor_neck", "Narrow Corridor", "walkway_junction", 0.42, 0.5, 90, 30),
    node("corridor_stage", "Festival Stage", "attraction", 0.72, 0.5, 500, 90),
    node("corridor_exit", "Festival Exit", "exit", 0.94, 0.5, 120, 75),
  ],
  edges: [
    ...twoWay("corridor_gate_neck", "corridor_gate", "corridor_neck", link(45, 2, 55, 28)),
    ...twoWay("corridor_neck_stage", "corridor_neck", "corridor_stage", link(55, 2, 60, 28)),
    oneWay("corridor_stage_exit", "corridor_stage", "corridor_exit", link(35, 4, 90, 65)),
  ],
};

const parallelGraph: VenueGraph = {
  nodes: [
    node("parallel_gate", "Test Gate", "entry_gate", 0.06, 0.5, 180, 120),
    node("parallel_fork", "Route Fork", "walkway_junction", 0.25, 0.5, 180, 120),
    node("parallel_north", "Short Narrow Route", "walkway_junction", 0.5, 0.28, 45, 22),
    node("parallel_south", "Long Wide Route", "walkway_junction", 0.5, 0.72, 180, 90),
    node("parallel_hall", "Test Hall", "attraction", 0.75, 0.5, 750, 150),
    node("parallel_exit", "Test Exit", "exit", 0.95, 0.5, 200, 140),
  ],
  edges: [
    ...twoWay("parallel_gate_fork", "parallel_gate", "parallel_fork", link(25, 5, 100, 90)),
    ...twoWay("parallel_fork_north", "parallel_fork", "parallel_north", link(35, 1.5, 35, 20)),
    ...twoWay("parallel_north_hall", "parallel_north", "parallel_hall", link(35, 1.5, 35, 20)),
    ...twoWay("parallel_fork_south", "parallel_fork", "parallel_south", link(55, 6, 150, 75)),
    ...twoWay("parallel_south_hall", "parallel_south", "parallel_hall", link(55, 6, 150, 75)),
    oneWay("parallel_hall_exit", "parallel_hall", "parallel_exit", link(25, 6, 130, 110)),
  ],
};

export const VENUE_PRESETS = [
  {
    id: "ipl-stadium",
    name: "IPL Match Day Stadium",
    shortName: "IPL Stadium",
    description: "Two-gate arrival, intermission concession surge, and post-match egress.",
    category: "ipl_stadium",
    imagePath: "/presets/stadio-benito-stirpe.png",
    crowdSize: 55_000,
    durationMinutes: 210,
    graph: stadiumGraph,
    initialOccupancy: { stadium_north_stand: 16_000, stadium_south_stand: 15_000 },
    schedule: [
      block({ id: "ipl_arrival", label: "Final arrivals", startMinute: 0, endMinute: 30, phase: "arrival", arrivalRatePerMinute: 800, entryWeights: { stadium_gate_n: 0.52, stadium_gate_s: 0.48 }, targetWeights: { stadium_north_stand: 0.5, stadium_south_stand: 0.5 }, rerouteCompliance: 0.72 }),
      block({ id: "ipl_play_1", label: "First innings", startMinute: 30, endMinute: 105, phase: "event", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { stadium_north_stand: 0.5, stadium_south_stand: 0.5 }, rerouteCompliance: 0.65 }),
      block({ id: "ipl_break", label: "Innings break", startMinute: 105, endMinute: 125, phase: "intermission", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { stadium_food: 0.65, stadium_restrooms: 0.35 }, rerouteCompliance: 0.78 }),
      block({ id: "ipl_play_2", label: "Second innings", startMinute: 125, endMinute: 180, phase: "event", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { stadium_north_stand: 0.5, stadium_south_stand: 0.5 }, rerouteCompliance: 0.65 }),
      block({ id: "ipl_egress", label: "Post-match egress", startMinute: 180, endMinute: 210, phase: "egress", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { stadium_exit_w: 0.5, stadium_exit_e: 0.5 }, rerouteCompliance: 0.82 }),
    ],
  },
  {
    id: "concert-arena",
    name: "Sold-out Concert Arena",
    shortName: "Concert",
    description: "Paired gates feed a standing floor before a synchronized exit rush.",
    category: "concert",
    imagePath: "/presets/turk-telekom-arena-concert.png",
    crowdSize: 35_000,
    durationMinutes: 150,
    graph: concertGraph,
    initialOccupancy: { concert_floor: 15_000 },
    schedule: [
      block({ id: "concert_arrival", label: "Doors open", startMinute: 0, endMinute: 20, phase: "arrival", arrivalRatePerMinute: 1_000, entryWeights: { concert_gate_a: 0.5, concert_gate_b: 0.5 }, targetWeights: { concert_floor: 0.9, concert_food: 0.1 }, rerouteCompliance: 0.7 }),
      block({ id: "concert_show", label: "Headline set", startMinute: 20, endMinute: 120, phase: "event", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { concert_floor: 1 }, rerouteCompliance: 0.55 }),
      block({ id: "concert_egress", label: "Show ends", startMinute: 120, endMinute: 150, phase: "egress", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { concert_exit_w: 0.5, concert_exit_e: 0.5 }, rerouteCompliance: 0.8 }),
    ],
  },
  {
    id: "railway-station",
    name: "Intercity Railway Station",
    shortName: "Railway",
    description: "Burst arrivals, a constrained footbridge, platform change, and train discharge.",
    category: "railway_station",
    imagePath: "/presets/new-delhi-railway-station.png",
    crowdSize: 12_000,
    durationMinutes: 75,
    graph: railwayGraph,
    initialOccupancy: { rail_ticket: 800, rail_platform_1: 1_200 },
    schedule: [
      block({ id: "rail_arrivals", label: "Commuter arrival", startMinute: 0, endMinute: 40, phase: "arrival", arrivalRatePerMinute: 250, entryWeights: { rail_entry: 1 }, targetWeights: { rail_platform_1: 0.65, rail_platform_2: 0.35 }, rerouteCompliance: 0.68 }),
      block({ id: "rail_change", label: "Platform change", startMinute: 40, endMinute: 50, phase: "disruption", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { rail_platform_2: 1 }, rerouteCompliance: 0.75 }),
      block({ id: "rail_departure", label: "Train departure", startMinute: 50, endMinute: 75, phase: "egress", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { rail_exit: 0.75, rail_emergency: 0.25 }, rerouteCompliance: 0.82 }),
    ],
  },
  {
    id: "airport-terminal",
    name: "Airport Terminal Peak Bank",
    shortName: "Airport",
    description: "Check-in and security bottlenecks feeding two departure gates and arrivals egress.",
    category: "airport",
    imagePath: "/presets/istanbul-airport-departures.png",
    crowdSize: 8_000,
    durationMinutes: 120,
    graph: airportGraph,
    initialOccupancy: { airport_checkin: 700, airport_retail: 300, airport_gate_a: 500, airport_gate_b: 500 },
    schedule: [
      block({ id: "airport_checkin_wave", label: "Departure bank check-in", startMinute: 0, endMinute: 50, phase: "arrival", arrivalRatePerMinute: 120, entryWeights: { airport_entry: 1 }, targetWeights: { airport_gate_a: 0.55, airport_gate_b: 0.45 }, rerouteCompliance: 0.73 }),
      block({ id: "airport_boarding", label: "Boarding", startMinute: 50, endMinute: 80, phase: "event", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { airport_gate_a: 0.55, airport_gate_b: 0.45 }, rerouteCompliance: 0.66 }),
      block({ id: "airport_arrival_wave", label: "Inbound flight arrivals", startMinute: 80, endMinute: 100, phase: "transfer", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { airport_arrivals: 1 }, rerouteCompliance: 0.72 }),
      block({ id: "airport_egress", label: "Landside egress", startMinute: 100, endMinute: 120, phase: "egress", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { airport_exit: 0.9, airport_emergency: 0.1 }, rerouteCompliance: 0.8 }),
    ],
  },
  {
    id: "city-festival",
    name: "City Festival Grounds",
    shortName: "City Festival",
    description: "Sector-level outdoor festival flow with a constrained temporary bridge and dispersed exits.",
    category: "large_festival",
    imagePath: "/test-layouts/dinamo-arena.png",
    crowdSize: 120_000,
    durationMinutes: 120,
    graph: festivalGraph,
    initialOccupancy: { festival_sector_a: 7_000, festival_sector_b: 7_000, festival_camp: 6_000 },
    schedule: [
      block({ id: "festival_arrival", label: "Festival arrival wave", startMinute: 0, endMinute: 40, phase: "arrival", arrivalRatePerMinute: 2_500, entryWeights: { festival_gate_n: 0.58, festival_gate_s: 0.42 }, targetWeights: { festival_main_stage: 0.78, festival_camp: 0.22 }, rerouteCompliance: 0.62 }),
      block({ id: "festival_headliner", label: "Peak headline window", startMinute: 40, endMinute: 65, phase: "event", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { festival_main_stage: 1 }, rerouteCompliance: 0.65 }),
      block({ id: "festival_transfer", label: "Return to sectors", startMinute: 65, endMinute: 85, phase: "transfer", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { festival_sector_a: 0.35, festival_sector_b: 0.4, festival_sector_c: 0.25 }, rerouteCompliance: 0.75 }),
      block({ id: "festival_egress", label: "Dispersal", startMinute: 85, endMinute: 120, phase: "egress", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { festival_exit_w: 0.5, festival_exit_e: 0.5 }, rerouteCompliance: 0.78 }),
    ],
  },
  {
    id: "test-narrow-corridor",
    name: "Test: Narrow Festival Corridor",
    shortName: "Corridor Test",
    description: "A deliberately oversubscribed single path for invariant and onset tests.",
    category: "test_corridor",
    imagePath: "/test-layouts/grand-central-terminal.png",
    crowdSize: 600,
    durationMinutes: 35,
    graph: corridorGraph,
    initialOccupancy: {},
    schedule: [
      block({ id: "corridor_arrival", label: "Festival arrival surge", startMinute: 0, endMinute: 10, phase: "arrival", arrivalRatePerMinute: 60, entryWeights: { corridor_gate: 1 }, targetWeights: { corridor_stage: 1 }, rerouteCompliance: 1 }),
      block({ id: "corridor_event", label: "Stage hold", startMinute: 10, endMinute: 20, phase: "event", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { corridor_stage: 1 }, rerouteCompliance: 1 }),
      block({ id: "corridor_egress", label: "Festival egress", startMinute: 20, endMinute: 35, phase: "egress", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { corridor_exit: 1 }, rerouteCompliance: 1 }),
    ],
  },
  {
    id: "test-parallel-routes",
    name: "Test: Parallel Route Choice",
    shortName: "Route Test",
    description: "A short narrow branch competes with a longer high-capacity alternative.",
    category: "test_parallel_routes",
    imagePath: "/test-layouts/manchester-airport.png",
    crowdSize: 1_000,
    durationMinutes: 35,
    graph: parallelGraph,
    initialOccupancy: {},
    schedule: [
      block({ id: "parallel_arrival", label: "Controlled inflow", startMinute: 0, endMinute: 10, phase: "arrival", arrivalRatePerMinute: 100, entryWeights: { parallel_gate: 1 }, targetWeights: { parallel_hall: 1 }, rerouteCompliance: 1 }),
      block({ id: "parallel_hold", label: "Hall hold", startMinute: 10, endMinute: 20, phase: "event", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { parallel_hall: 1 }, rerouteCompliance: 1 }),
      block({ id: "parallel_egress", label: "Grid egress", startMinute: 20, endMinute: 35, phase: "egress", arrivalRatePerMinute: 0, entryWeights: {}, targetWeights: { parallel_exit: 1 }, rerouteCompliance: 1 }),
    ],
  },
] as const satisfies readonly VenuePreset[];

export const DEFAULT_PRESET_ID = "ipl-stadium";

export function getVenuePreset(id: string): VenuePreset | undefined {
  return VENUE_PRESETS.find((preset) => preset.id === id);
}

export function requireVenuePreset(id: string): VenuePreset {
  const preset = getVenuePreset(id);
  if (!preset) {
    throw new Error(`Unknown venue preset: ${id}`);
  }
  return preset;
}
