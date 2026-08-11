from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "test-floorplan.png"


@pytest.fixture
def client():
    return TestClient(app)


def test_health(client: TestClient):
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"


def test_full_mock_pipeline(client: TestClient):
    assert FIXTURE.exists(), f"Missing fixture {FIXTURE}"

    sid = client.post("/api/sessions").json()["session_id"]

    with FIXTURE.open("rb") as f:
        res = client.post(
            f"/api/sessions/{sid}/layout/extract",
            params={"mode": "mock"},
            files={"file": ("test-floorplan.png", f, "image/png")},
        )
    assert res.status_code == 200
    graph = res.json()
    assert len(graph["nodes"]) >= 5
    assert any(n["type"] == "entry_gate" for n in graph["nodes"])

    confirm = client.post(f"/api/sessions/{sid}/graph/confirm")
    assert confirm.status_code == 200
    assert confirm.json()["ok"] is True

    scenario = client.get(f"/api/sessions/{sid}").json()["scenario"]
    assert scenario["expected_crowd"] >= 1

    tick = client.post(f"/api/sessions/{sid}/sim/start").json()
    assert "bottlenecks" in tick
    assert "routes" in tick

    # Advance into denser phase
    later = client.get(f"/api/sessions/{sid}/sim/tick", params={"steps": 40}).json()
    assert later["t"] > tick["t"]
    assert later["routes"]

    advice = client.post(f"/api/sessions/{sid}/advise", params={"mode": "mock"}).json()
    assert "actions" in advice
    assert advice["summary"]

    if advice["actions"]:
        applied = client.post(
            f"/api/sessions/{sid}/actions/apply",
            json={"actions": advice["actions"]},
        )
        assert applied.status_code == 200
