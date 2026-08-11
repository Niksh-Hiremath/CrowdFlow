from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "test-floorplan.png"


def test_layout_image_revise_and_finite_stream():
    client = TestClient(app)
    sid = client.post("/api/sessions").json()["session_id"]

    with FIXTURE.open("rb") as f:
        graph = client.post(
            f"/api/sessions/{sid}/layout/extract",
            params={"mode": "mock"},
            files={"file": ("test-floorplan.png", f, "image/png")},
        ).json()

    img = client.get(f"/api/sessions/{sid}/layout/image")
    assert img.status_code == 200
    assert img.headers["content-type"].startswith("image/")
    assert len(img.content) > 100

    before = len(graph["nodes"])
    revised = client.post(
        f"/api/sessions/{sid}/graph/revise",
        json={"instruction": "delete green_room", "mode": "mock"},
    ).json()
    assert len(revised["nodes"]) <= before
    assert all(n["id"] != "green_room" for n in revised["nodes"])

    assert client.post(f"/api/sessions/{sid}/graph/confirm").json()["ok"] is True
    start = client.post(f"/api/sessions/{sid}/sim/start", params={"max_ticks": 5})
    assert start.status_code == 200

    with client.websocket_connect(f"/api/sessions/{sid}/sim/stream") as ws:
        saw_done = False
        for _ in range(20):
            msg = ws.receive_json()
            if msg.get("type") == "done":
                saw_done = True
                assert msg.get("tick") is not None
                break
        assert saw_done
