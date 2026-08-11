#!/usr/bin/env python3
"""End-to-end backend walkthrough against fixtures/test-floorplan.png."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.main import app  # noqa: E402

FIXTURE = ROOT / "fixtures" / "test-floorplan.png"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--extract-mode", default="mock", choices=["mock", "hf"])
    parser.add_argument("--advisor-mode", default="mock", choices=["mock", "hf"])
    parser.add_argument("--steps", type=int, default=48)
    args = parser.parse_args()

    if not FIXTURE.exists():
        print(f"Missing fixture: {FIXTURE}")
        return 1

    client = TestClient(app)
    health = client.get("/api/health").json()
    print("HEALTH:", json.dumps(health, indent=2))

    sid = client.post("/api/sessions").json()["session_id"]
    print("SESSION:", sid)

    with FIXTURE.open("rb") as f:
        graph = client.post(
            f"/api/sessions/{sid}/layout/extract",
            params={"mode": args.extract_mode},
            files={"file": ("test-floorplan.png", f, "image/png")},
        ).json()
    print(f"EXTRACT source={graph.get('source')} nodes={len(graph['nodes'])} edges={len(graph['edges'])}")
    for n in graph["nodes"]:
        print(f"  - {n['id']:16} {n['type']:18} ({n['x']:.2f},{n['y']:.2f}) cap={n['capacity']}")

    confirm = client.post(f"/api/sessions/{sid}/graph/confirm").json()
    print("CONFIRM:", confirm["ok"], confirm.get("errors"))
    if not confirm["ok"]:
        return 2

    tick = client.post(f"/api/sessions/{sid}/sim/start").json()
    tick = client.get(f"/api/sessions/{sid}/sim/tick", params={"steps": args.steps}).json()
    print(f"TICK t={tick['t']} sim_time={tick['sim_time']} blocks={tick['active_block_ids']}")
    print("BOTTLENECKS:")
    for b in tick["bottlenecks"][:5]:
        print(f"  - {b['severity']:8} {b['node_id']:16} {b['reason']}")
    print("ROUTES:")
    for r in tick["routes"][:4]:
        print(f"  - {r['purpose']}: {' -> '.join(r['path_node_ids'])} (cost={r['cost']})")

    advice = client.post(
        f"/api/sessions/{sid}/advise",
        params={"mode": args.advisor_mode},
    ).json()
    print("ADVISOR source=", advice.get("source"))
    print("SUMMARY:", advice.get("summary"))
    print("ACTIONS:", json.dumps(advice.get("actions"), indent=2))

    if advice.get("actions"):
        after = client.post(
            f"/api/sessions/{sid}/actions/apply",
            json={"actions": advice["actions"]},
        ).json()
        print(
            "AFTER APPLY bottlenecks=",
            [(b["node_id"], b["severity"]) for b in after["bottlenecks"][:5]],
        )

    print("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
