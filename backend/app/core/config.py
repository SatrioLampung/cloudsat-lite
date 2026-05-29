from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "CloudSat Lite API"
    APP_ENV: str = "development"
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    MODEL_WEIGHTS_PATH: str = "backend/models/cloud_attention_classifier_final.weights.h5"
    MODEL_THRESHOLD: float = 0.5

    OPEN_METEO_BASE_URL: str = "https://api.open-meteo.com/v1/forecast"
    GIBS_WMS_EPSG4326: str = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> List[str]:
        return [item.strip() for item in self.CORS_ORIGINS.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
