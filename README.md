# Crowd Flow Optimiser

Hackathon project for **AI Race Month · Problem Statement 3**: simulate crowd movement in a venue, detect bottlenecks, and recommend reroutes — with **Hugging Face** as the mandatory intelligent core.

**Current focus:** backend only (`apps/api`). Next.js frontend is deferred.

## What it does

1. Accept a **top-down venue layout** (image), **expected crowd size**, and an **event schedule**
2. Extract a venue **graph** (gates, aisles, seating, concessions, exits)
3. Run a **schedule-driven simulation** of crowd flow on that graph
4. Detect **bottleneck / congestion** zones over time
5. Propose **rerouting actions** (and apply them back into the live sim)

## Hugging Face models (current)

| Role | Model | Provider |
|---|---|---|
| Layout extract (VLM) | [`Qwen/Qwen3-VL-8B-Instruct`](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct) | Inference Providers (`featherless-ai`) |
| Reroute advisor (LLM) | [`Qwen/Qwen3-4B-Instruct-2507`](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) | Inference Providers (`featherless-ai`) |

Credits are spent **only** on extract + advise. Simulation, bottlenecks, and pathfinding are local (no HF cost).  
Set `EXTRACT_MODE=mock` / `ADVISOR_MODE=mock` for $0 offline demos.

## Architecture

```text
Top-down image + crowd size + event schedule
        │
        ▼
┌─────────────────────────────┐
│ HF VLM (Qwen3-VL)           │  image → nodes/edges JSON
│ + deterministic post-process│  clamp coords, validate connectivity
└──────────────┬──────────────┘
               ▼
        Venue graph (NetworkX)
               │
               ▼  confirm gate (entry + exit + paths)
┌─────────────────────────────┐
│ Macroscopic flow simulator  │  schedule phases drive arrivals
│                             │  & attractors (seating/break/egress)
└──────────────┬──────────────┘
               ▼
┌──────────────┴──────────────┐
│ Bottleneck detector         │  density/capacity + queue thresholds
│ Congestion-weighted Dijkstra│  cost = length × (1 + α·density²)
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ HF LLM advisor (Qwen3-4B)   │  telemetry → structured JSON actions
│ apply actions → sim updates │  reroute / throttle_gate / open_exit
└─────────────────────────────┘
               ▼
     Live ticks (REST / WebSocket)
```

### Algorithms (local core)

| Stage | Method | How it runs |
|---|---|---|
| **Simulation** | Schedule-driven **macroscopic network flow** | Each tick: active schedule block sets arrival rate + attractors; crowd mass moves toward those nodes with capacity-limited edge throughput; density slows movement; concessions use service rates / queues. Not per-person Social Force. |
| **Bottlenecks** | **Threshold occupancy rules** | `density = count/capacity` → watch / warning / critical; also flags queue buildup. |
| **Routing** | **Congestion-weighted Dijkstra** (NetworkX) | Edge cost `length × (1 + α·density²)`; avoid/prefer multipliers from advisor actions. |
| **Advice** | **HF LLM structured planner** | Sim telemetry (time, blocks, bottlenecks, hot nodes) → JSON actions applied back into sim meters/weights. |

Honest positioning: hackathon-grade macroscopic crowd ops, not certified pedestrian-dynamics software (JuPedSim / Social Force deferred).

### Responsibility split

| Layer | Owns |
|---|---|
| Hugging Face | Layout perception + natural-language / structured operator advice |
| FastAPI + Python | Orchestration, graph, sim physics, bottleneck rules, pathfinding |
| Frontend (later) | Upload UI, visual node confirm, live map |

## Repo layout

```text
GrandPrix/
├── apps/api/           # FastAPI backend (primary)
├── docs/ARCHITECTURE.md
├── docker-compose.yml
├── test-concert.png    # sample concert layout
└── test-floorplan.jpg  # sample banquet layout
```

## Quick start

```bash
cd apps/api
python -m venv .venv
# Windows
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Put your Hugging Face token in `.env` (never commit `.env`):

```env
HF_TOKEN=hf_...
EXTRACT_MODE=hf
ADVISOR_MODE=hf
HF_VLM_MODEL=Qwen/Qwen3-VL-8B-Instruct
HF_LLM_MODEL=Qwen/Qwen3-4B-Instruct-2507
HF_PROVIDER=featherless-ai
```

Run:

```bash
uvicorn app.main:app --reload --port 8000
```

- API docs: http://127.0.0.1:8000/docs  
- Health: http://127.0.0.1:8000/api/health  

Or from repo root:

```bash
docker compose up --build
```

## Demo / verify

```bash
cd apps/api
pytest -q
python scripts/demo_backend.py --extract-mode mock --advisor-mode mock
# live HF (uses credits):
python scripts/demo_backend.py --extract-mode hf --advisor-mode hf
```

More API detail: [apps/api/README.md](apps/api/README.md) · full design notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
