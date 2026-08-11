from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(API_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    hf_token: str = ""
    extract_mode: str = "mock"  # mock | hf
    advisor_mode: str = "mock"  # mock | hf
    hf_vlm_model: str = "Qwen/Qwen3-VL-8B-Instruct"
    hf_llm_model: str = "Qwen/Qwen3-4B-Instruct-2507"
    # featherless-ai currently hosts Qwen3-VL on Inference Providers for this account.
    hf_provider: str = "featherless-ai"
    cache_dir: Path = API_ROOT / "data" / "cache"
    fixtures_dir: Path = API_ROOT / "fixtures"
    free_speed_m_per_s: float = 1.2
    density_alpha: float = 4.0
    warning_density: float = 0.75
    critical_density: float = 0.9
    sim_dt_seconds: float = 5.0
    # How many schedule minutes to advance each physics step (keeps demos short).
    sim_clock_minutes_per_step: float = 1.0


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    return settings
