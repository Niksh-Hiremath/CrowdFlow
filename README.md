---
title: CrowdFlow
emoji: "🚦"
colorFrom: teal
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# CrowdFlow

CrowdFlow is a schedule-aware crowd simulation and operator decision-support
prototype for stadiums, concerts, railway stations, airport terminals, and
other high-footfall public venues.

The workflow is deliberately gated:

1. Select a real local venue plan or upload a PNG/JPEG/WEBP layout.
2. Enter the expected crowd and edit the complete event schedule.
3. Extract or load a draft graph of entries, exits, junctions, destinations,
   widths, lengths, storage limits, and flow limits.
4. Review and correct the graph over the original plan.
5. Explicitly confirm the current graph, crowd, and schedule.
6. Run the deterministic simulation, forecast bottlenecks, compare reroutes,
   and request evidence-linked `gpt-5.6-terra` advice.

Editing the graph invalidates its server-side confirmation. The simulation API
returns `409 CONFIRMATION_REQUIRED` until the new revision is confirmed.

## Built-in scenarios

| Scenario | Crowd | Schedule used by the simulation |
|---|---:|---|
| IPL stadium | 55,000 | arrivals 00:00-00:30 at 800/min; first innings 00:30-01:45; break 01:45-02:05; second innings 02:05-03:00; egress 03:00-03:30 |
| Concert arena | 35,000 | doors 00:00-00:20 at 1,000/min; headline set 00:20-02:00; egress 02:00-02:30 |
| Railway station | 12,000 | arrivals 00:00-00:40 at 250/min; platform change 00:40-00:50; train departure 00:50-01:15 |
| Airport terminal | 8,000 | check-in 00:00-00:50 at 120/min; boarding 00:50-01:20; inbound transfer 01:20-01:40; egress 01:40-02:00 |
| City festival | 120,000 | arrivals 00:00-00:40 at 2,500/min; headliner 00:40-01:05; sector transfer 01:05-01:25; dispersal 01:25-02:00 |
| Narrow-corridor test | 600 | arrivals 00:00-00:10 at 60/min; hold 00:10-00:20; egress 00:20-00:35 |
| Parallel-route test | 1,000 | arrivals 00:00-00:10 at 100/min; hold 00:10-00:20; egress 00:20-00:35 |

All seven scenarios use locally stored raster layouts; the final two are
deliberately small deterministic stress fixtures for quick verification. See
[asset attribution](public/ASSET_ATTRIBUTION.md).

## What the engine actually does

- Fixed-step conservation of people across nodes, edges, outside queues, and
  exits.
- Directed, storage- and flow-capacity-limited links with travel time and
  spillback.
- Schedule-driven arrival rates, destinations, intermissions, transfers, and
  egress.
- Persistent node/edge bottleneck detection with warning and critical bands.
- Congestion-weighted route alternatives.
- Forecasting by cloning and advancing the deterministic state.
- Counterfactual reroute evaluation using peak occupancy, congestion exposure,
  and completed exit throughput.
- Runtime invariants for mass balance, non-negative occupancy, storage limits,
  and flow limits.

The LLM does not run the simulation. It receives a validated `FindingBundle`
containing only simulator-owned evidence: the active schedule phase, measured
bottlenecks, forecast onset, graph-valid route IDs, and counterfactual deltas.
Structured advice must cite those IDs, and unknown references are rejected.

## Run locally

Requirements: Node.js 22+ and npm.

```bash
npm ci
npm run dev
```

The Vite client runs on `http://127.0.0.1:5173` and proxies API/WebSocket
traffic to the development server on port `7860`. For a production-equivalent
local run:

```bash
npm run build
npm start
```

Open `http://127.0.0.1:7860`.

The server reads the existing `OPENAI_TOKEN` from `.env` through the official
OpenAI SDK. Never place the value in source, logs, screenshots, Docker build
arguments, or public hosting variables. If the token/model call is unavailable,
the app returns an explicit deterministic fallback rather than fabricating a
provider result.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
docker build -t crowdflow .
```

## Safety and production boundary

This is not certified crowd-safety software. The algorithms are materially more
than a distance-only search, but the included capacities, speed relationships,
arrival profiles, and compliance values are demonstration parameters.
Production use requires venue surveys, calibrated sensor data, validation
against observed movements and drills, uncertainty analysis, redundant inputs,
local regulatory review, and qualified crowd-safety sign-off. No model output
directly controls gates, barriers, signs, or emergency operations.

See [ARCHITECTURE.md](ARCHITECTURE.md) for contracts and design details and
[deployment notes](docs/DEPLOYMENT.md) for the public Hugging Face Docker Space.
