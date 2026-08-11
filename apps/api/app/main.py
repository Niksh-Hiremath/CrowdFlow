from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers.sessions import router as sessions_router
from app.schemas.venue import HealthResponse
from app.services.presets import list_presets

app = FastAPI(
    title="Crowd Flow Optimiser API",
    description=(
        "Backend: layout extract → graph → macroscopic sim → bottlenecks/reroutes. "
        "Layout extraction and reroute advice use Hugging Face models when enabled; "
        "crowd physics is local (not an HF model)."
    ),
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions_router)


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(
        status="ok",
        extract_mode=settings.extract_mode,
        advisor_mode=settings.advisor_mode,
        hf_token_configured=bool(settings.hf_token),
        hf_vlm_model=settings.hf_vlm_model,
        hf_llm_model=settings.hf_llm_model,
    )


@app.get("/api/presets")
async def presets() -> list[dict]:
    return list_presets()


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "crowd-flow-optimiser-api",
        "docs": "/docs",
        "health": "/api/health",
        "presets": "/api/presets",
        "powered_by_extract": "Powered by Hugging Face · Qwen3-VL",
        "powered_by_advisor": "Powered by Hugging Face · Qwen3",
    }
