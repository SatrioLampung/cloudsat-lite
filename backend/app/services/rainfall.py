from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

import httpx
from cachetools import TTLCache

from app.core.config import get_settings
from app.schemas import RainfallPoint, RainfallRequest, RainfallResponse, RainfallSeries


_RAIN_CACHE: TTLCache = TTLCache(maxsize=256, ttl=15 * 60)


def clear_rainfall_cache() -> None:
    _RAIN_CACHE.clear()


def _cache_key(point: RainfallPoint, past_days: int, forecast_days: int) -> Tuple:
    return (round(point.lat, 5), round(point.lon, 5), past_days, forecast_days)


async def fetch_rainfall_point(
    client: httpx.AsyncClient,
    point: RainfallPoint,
    past_days: int,
    forecast_days: int,
) -> RainfallSeries:
    settings = get_settings()
    key = _cache_key(point, past_days, forecast_days)

    cached = _RAIN_CACHE.get(key)
    if cached:
        return cached

    params: Dict[str, Any] = {
        "latitude": point.lat,
        "longitude": point.lon,
        "hourly": "precipitation,rain,showers,precipitation_probability,weather_code",
        "past_days": past_days,
        "forecast_days": forecast_days,
        "timezone": "auto",
    }

    response = await client.get(settings.OPEN_METEO_BASE_URL, params=params, timeout=30)
    response.raise_for_status()
    payload = response.json()

    series = RainfallSeries(
        point=point,
        source="Open-Meteo Forecast API",
        hourly=payload.get("hourly", {}),
    )
    _RAIN_CACHE[key] = series
    return series


async def fetch_rainfall_points(request: RainfallRequest) -> RainfallResponse:
    async with httpx.AsyncClient() as client:
        items: List[RainfallSeries] = []
        for point in request.points:
            item = await fetch_rainfall_point(
                client=client,
                point=point,
                past_days=request.past_days,
                forecast_days=request.forecast_days,
            )
            items.append(item)

    return RainfallResponse(
        updated=datetime.now(timezone.utc).isoformat(),
        items=items,
    )
