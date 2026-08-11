# Crowd Flow Optimiser — API

Backend pipeline: **top-down image → graph → macroscopic sim → bottlenecks / reroutes**.

| Stage | Engine | Credits |
|---|---|---|
| Layout extract | Hugging Face `Qwen/Qwen3-VL-8B-Instruct` (or mock) | Yes if `EXTRACT_MODE=hf` |
| Graph confirm / validation | NetworkX (local) | No |
| Crowd + schedule simulation | Macroscopic network flow (local) | No |
| Bottlenecks | Density / queue thresholds (local) | No |
| Routes | Congestion-weighted Dijkstra (local) | No |
| Reroute advisor | Hugging Face `Qwen/Qwen3-4B-Instruct-2507` (or mock) | Yes if `ADVISOR_MODE=hf` |

Provider default: `featherless-ai` (HF Inference Providers).

## Architecture (API path)

```text
POST /layout/extract  →  Qwen3-VL (+ cache)  →  VenueGraph
POST /graph/confirm   →  validate entry/exit connectivity
PUT  /scenario        →  crowd size + schedule blocks
POST /sim/start|tick  →  macroscopic flow + bottlenecks + routes
WS   /sim/stream      →  live ticks
POST /advise          →  Qwen3-4B JSON actions
POST /actions/apply   →  mutate gate meters / avoid-prefer → re-sim
```

### Local algorithms

- **Macroscopic flow:** schedule blocks drive arrivals and attractors; mass transfers along edges with capacity and density-dependent speed; service nodes use service rates.
- **Bottlenecks:** `density = count/capacity` with watch / warning / critical tiers + queue watch.
- **Routing:** Dijkstra with `cost = length × (1 + α · density²)` and advisor avoid/prefer weights.

## Setup

```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

For live Hugging Face Inference Providers:

```env
HF_TOKEN=hf_...
EXTRACT_MODE=hf
ADVISOR_MODE=hf
HF_VLM_MODEL=Qwen/Qwen3-VL-8B-Instruct
HF_LLM_MODEL=Qwen/Qwen3-4B-Instruct-2507
HF_PROVIDER=featherless-ai
```

Default modes in `.env.example` are `mock` (no credits). Extracts are cached under `data/cache/`.

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

From repo root:

```bash
docker compose up --build
```

- Docs: http://127.0.0.1:8000/docs  
- Health: http://127.0.0.1:8000/api/health  
- Presets: http://127.0.0.1:8000/api/presets  

## Demo

```bash
# Mock E2E (banquet fixture)
python scripts/demo_backend.py --extract-mode mock --advisor-mode mock --steps 90

# Live HF — burns credits on extract + advise only
python scripts/demo_backend.py --extract-mode hf --advisor-mode hf --steps 90
```

Sample images in repo root / fixtures: `test-floorplan` (banquet), `test-concert` (theatre/concert).

API walkthrough:

1. `POST /api/sessions`
2. `POST /api/sessions/{id}/layout/extract` with image **or** `POST .../presets/load` (`banquet|stadium|station|festival`)
3. `PUT /api/sessions/{id}/scenario` (crowd + schedule) if needed
4. `POST /api/sessions/{id}/graph/confirm`
5. `POST /api/sessions/{id}/sim/start` then `GET .../sim/tick?steps=40` or WS `.../sim/stream`
6. `POST /api/sessions/{id}/advise` then `POST .../actions/apply`

## Tests

```bash
pytest -q
```

## Presets

| id | Venue |
|---|---|
| `banquet` | Banquet / wedding hall |
| `stadium` | Dual-gate stadium |
| `station` | Railway station peak commute |
| `festival` | Outdoor festival / stage |
