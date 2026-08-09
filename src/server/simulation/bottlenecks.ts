import type {
  Bottleneck,
  BottleneckLocationType,
  BottleneckReason,
  SimulationConfig,
} from "./model";

export interface BottleneckSample {
  readonly locationType: BottleneckLocationType;
  readonly locationId: string;
  readonly label: string;
  readonly occupancyRatio: number;
  readonly inflowPeoplePerMinute: number;
  readonly outflowPeoplePerMinute: number;
  readonly reasonHint?: BottleneckReason;
}

interface DetectorState {
  aboveTicks: number;
  clearanceTicks: number;
  firstObservedMinute: number;
  detectedAtMinute: number | null;
  lastMinute: number;
  lastRatio: number;
  trendPerMinute: number;
  peakRatio: number;
  lastSample: BottleneckSample;
}

const locationKey = (sample: Pick<BottleneckSample, "locationType" | "locationId">): string =>
  `${sample.locationType}:${sample.locationId}`;

function inferReason(sample: BottleneckSample, trendPerMinute: number): BottleneckReason {
  if (sample.reasonHint) return sample.reasonHint;
  if (trendPerMinute > 0.08) return "queue_growth";
  if (
    sample.occupancyRatio >= 0.75 &&
    sample.outflowPeoplePerMinute < Math.max(1, sample.inflowPeoplePerMinute * 0.35)
  ) {
    return "stagnation";
  }
  return "high_density";
}

export class PersistentBottleneckDetector {
  private readonly states = new Map<string, DetectorState>();

  public constructor(private readonly config: SimulationConfig) {}

  public update(samples: readonly BottleneckSample[], simulationTimeMinute: number): readonly Bottleneck[] {
    const seen = new Set<string>();
    for (const sample of samples) {
      const key = locationKey(sample);
      seen.add(key);
      const prior = this.states.get(key);
      const elapsed = prior ? Math.max(1e-9, simulationTimeMinute - prior.lastMinute) : this.config.stepSeconds / 60;
      const trend = prior ? (sample.occupancyRatio - prior.lastRatio) / elapsed : 0;
      const above = sample.occupancyRatio >= this.config.warningOccupancyRatio;

      if (!prior) {
        if (above) {
          this.states.set(key, {
            aboveTicks: 1,
            clearanceTicks: 0,
            firstObservedMinute: simulationTimeMinute,
            detectedAtMinute: this.config.persistenceTicks === 1 ? simulationTimeMinute : null,
            lastMinute: simulationTimeMinute,
            lastRatio: sample.occupancyRatio,
            trendPerMinute: trend,
            peakRatio: sample.occupancyRatio,
            lastSample: sample,
          });
        }
        continue;
      }

      prior.lastMinute = simulationTimeMinute;
      prior.lastRatio = sample.occupancyRatio;
      prior.trendPerMinute = trend;
      prior.lastSample = sample;
      prior.peakRatio = Math.max(prior.peakRatio, sample.occupancyRatio);
      if (above) {
        prior.aboveTicks += 1;
        prior.clearanceTicks = 0;
        if (prior.detectedAtMinute === null && prior.aboveTicks >= this.config.persistenceTicks) {
          prior.detectedAtMinute = simulationTimeMinute;
        }
      } else if (prior.detectedAtMinute === null) {
        this.states.delete(key);
      } else {
        prior.clearanceTicks += 1;
        if (prior.clearanceTicks >= this.config.clearanceTicks) this.states.delete(key);
      }
    }

    for (const [key, state] of this.states) {
      if (!seen.has(key)) {
        state.clearanceTicks += 1;
        if (state.clearanceTicks >= this.config.clearanceTicks) this.states.delete(key);
      }
    }

    return this.getActive(simulationTimeMinute);
  }

  public getActive(simulationTimeMinute: number): readonly Bottleneck[] {
    const active: Bottleneck[] = [];
    for (const [key, state] of this.states) {
      if (state.detectedAtMinute === null) continue;
      const sample = state.lastSample;
      active.push({
        id: `bottleneck:${key}`,
        locationType: sample.locationType,
        locationId: sample.locationId,
        label: sample.label,
        reason: inferReason(sample, state.trendPerMinute),
        severity: sample.occupancyRatio >= this.config.criticalOccupancyRatio ? "critical" : "warning",
        occupancyRatio: sample.occupancyRatio,
        inflowPeoplePerMinute: sample.inflowPeoplePerMinute,
        outflowPeoplePerMinute: sample.outflowPeoplePerMinute,
        firstObservedMinute: state.firstObservedMinute,
        detectedAtMinute: state.detectedAtMinute,
        durationMinutes: Math.max(0, simulationTimeMinute - state.detectedAtMinute),
        trendPerMinute: state.trendPerMinute,
      });
    }
    return active.sort(
      (a, b) =>
        (b.severity === "critical" ? 1 : 0) - (a.severity === "critical" ? 1 : 0) ||
        b.occupancyRatio - a.occupancyRatio ||
        a.id.localeCompare(b.id),
    );
  }

  public clone(): PersistentBottleneckDetector {
    const detector = new PersistentBottleneckDetector(this.config);
    for (const [key, state] of this.states) {
      detector.states.set(key, { ...state, lastSample: { ...state.lastSample } });
    }
    return detector;
  }
}

