from contextlib import asynccontextmanager
from typing import Annotated, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.schemas import (
    CloudBBoxClassifyRequest,
    CloudBBoxClassifyResponse,
    CloudClassifyResponse,
    GeoBBox,
    HealthResponse,
    PixelBBox,
    RainfallRequest,
    RainfallResponse,
)
from app.services.cloud_model import load_model, parse_bbox_json, predict_image
from app.services.gibs import get_gibs_layers
from app.services.gibs_crop import fetch_gibs_bbox_image, image_to_data_url
from app.services.rainfall import clear_rainfall_cache, fetch_rainfall_points


settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model saat backend startup.

    Catatan:
    - Ini menggantikan @app.on_event("startup") agar tidak terkena warning deprecated.
    - Kalau model gagal load, API tetap hidup. Error model bisa dicek lewat /api/model/status.
    """
    load_model(force_reload=False)
    yield


app = FastAPI(
    title=settings.APP_NAME,
    lifespan=lifespan,
)


# CORS untuk lokal dan deploy.
# Untuk testing publik, allow_origin_regex dibuat menerima domain vercel.app.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://cloudsat-lite.vercel.app",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", include_in_schema=False)
async def root():
    return {
        "message": "CloudSat Lite API is running",
        "health": "/api/health",
        "model_status": "/api/model/status",
        "docs": "/docs",
    }


@app.head("/", include_in_schema=False)
async def root_head():
    """Endpoint HEAD agar health check Render tidak 405."""
    return None


@app.get("/health", response_model=HealthResponse)
@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    model_state = load_model(force_reload=False)
    return HealthResponse(
        status="ok",
        app=settings.APP_NAME,
        model_loaded=model_state.loaded,
    )


@app.get("/api/model/status")
async def model_status():
    state = load_model(force_reload=False)
    return {
        "loaded": state.loaded,
        "backend_name": state.backend_name,
        "error": state.error,
        "weights_path": settings.MODEL_WEIGHTS_PATH,
    }


@app.post("/api/model/reload")
async def reload_model():
    state = load_model(force_reload=True)
    return {
        "loaded": state.loaded,
        "backend_name": state.backend_name,
        "error": state.error,
    }


@app.get("/api/debug/deploy")
async def debug_deploy():
    """Debug ringan untuk memastikan Render menjalankan file backend/app/main.py ini."""
    import os

    return {
        "message": "This is backend/app/main.py",
        "cwd": os.getcwd(),
        "file": __file__,
        "app": settings.APP_NAME,
        "model_weights_path": settings.MODEL_WEIGHTS_PATH,
    }


@app.get("/api/gibs/layers")
async def gibs_layers(date: Optional[str] = Query(default=None)):
    try:
        return get_gibs_layers(date)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/rainfall/points", response_model=RainfallResponse)
async def rainfall_points(request: RainfallRequest) -> RainfallResponse:
    try:
        return await fetch_rainfall_points(request)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Gagal mengambil data curah hujan: {exc}",
        ) from exc


@app.post("/api/refresh")
async def refresh_data():
    clear_rainfall_cache()
    layers = get_gibs_layers(None)
    model_state = load_model(force_reload=False)
    return {
        "message": "Cache time-dependent dibersihkan. Layer GIBS disiapkan ulang.",
        "gibs_date": layers.date,
        "model_loaded": model_state.loaded,
    }


@app.post("/api/cloud/classify", response_model=CloudClassifyResponse)
async def classify_cloud(
    file: Annotated[UploadFile, File()],
    bbox: Annotated[Optional[str], Form()] = None,
    geo_bbox: Annotated[Optional[str], Form()] = None,
    threshold: Annotated[Optional[float], Form()] = None,
):
    try:
        file_bytes = await file.read()
        pixel_bbox: Optional[PixelBBox] = parse_bbox_json(bbox)

        parsed_geo_bbox = None
        if geo_bbox:
            import json

            parsed_geo_bbox = GeoBBox(**json.loads(geo_bbox))

        (
            predictions,
            detected_labels,
            best_label,
            best_confidence,
            bbox_used,
            message,
        ) = predict_image(
            file_bytes=file_bytes,
            bbox=pixel_bbox,
            threshold=threshold,
        )

        return CloudClassifyResponse(
            model_loaded=bool(predictions),
            threshold=threshold if threshold is not None else settings.MODEL_THRESHOLD,
            bbox_used=bbox_used,
            geo_bbox=parsed_geo_bbox,
            predictions=predictions,
            detected_labels=detected_labels,
            best_label=best_label,
            best_confidence=best_confidence,
            message=message,
        )

    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Klasifikasi gagal: {exc}") from exc


@app.post("/api/cloud/classify-bbox", response_model=CloudBBoxClassifyResponse)
async def classify_cloud_bbox(request: CloudBBoxClassifyRequest):
    """Klasifikasi awan langsung dari geo_bbox peta.

    Alur:
    1. Frontend mengirim geo_bbox hasil dua klik di Cesium.
    2. Backend mengambil citra area tersebut dari NASA GIBS WMS GetMap.
    3. Citra GIBS dikirim ke fungsi predict_image tanpa upload manual.
    """
    try:
        gibs_image = await fetch_gibs_bbox_image(request)

        (
            predictions,
            detected_labels,
            best_label,
            best_confidence,
            bbox_used,
            message,
        ) = predict_image(
            file_bytes=gibs_image.image_bytes,
            bbox=None,
            threshold=request.threshold,
        )

        preview_data_url = None
        if request.include_preview:
            preview_data_url = image_to_data_url(
                gibs_image.image_bytes,
                gibs_image.content_type,
            )

        return CloudBBoxClassifyResponse(
            model_loaded=bool(predictions),
            threshold=request.threshold if request.threshold is not None else settings.MODEL_THRESHOLD,
            bbox_used=bbox_used,
            geo_bbox=request.geo_bbox,
            predictions=predictions,
            detected_labels=detected_labels,
            best_label=best_label,
            best_confidence=best_confidence,
            message=message,
            source_layer=gibs_image.source_layer,
            source_date=gibs_image.source_date,
            source_image_url=gibs_image.source_url,
            image_size={"width": gibs_image.width, "height": gibs_image.height},
            preview_data_url=preview_data_url,
        )

    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Klasifikasi BBox gagal: {exc}") from exc
