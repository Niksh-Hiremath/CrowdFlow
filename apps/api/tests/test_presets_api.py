from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def test_presets_and_load():
    client = TestClient(app)
    presets = client.get("/api/presets").json()
    assert len(presets) >= 4
    ids = {p["id"] for p in presets}
    assert {"banquet", "stadium", "station", "festival"} <= ids

    sid = client.post("/api/sessions").json()["session_id"]
    loaded = client.post(
        f"/api/sessions/{sid}/presets/load",
        json={"preset_id": "stadium", "expected_crowd": 800},
    )
    assert loaded.status_code == 200
    body = loaded.json()
    assert body["graph"]["source"] == "mock"
    assert body["scenario"]["expected_crowd"] == 800
    assert any(n["type"] == "entry_gate" for n in body["graph"]["nodes"])

    confirm = client.post(f"/api/sessions/{sid}/graph/confirm")
    assert confirm.json()["ok"] is True

    tick = client.post(f"/api/sessions/{sid}/sim/start")
    assert tick.status_code == 200
    assert "routes" in tick.json()


def test_health_hf_branding():
    client = TestClient(app)
    health = client.get("/api/health").json()
    assert "Hugging Face" in health["powered_by_extract"]
    assert "Hugging Face" in health["powered_by_advisor"]
    assert "layout_extract" in health["credit_burn_stages"][0]
