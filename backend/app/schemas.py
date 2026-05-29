from typing import Dict, List, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    status: str
    app: str
    model_loaded: bool


class GibsLayer(BaseModel):
    id: str
    title: Optional[str] = None
    name: Optional[str] = None
    layer: str
    format: str = "image/png"
    alpha: float = 1.0
    visible: bool = True
    category: str = "base"
    description: Optional[str] = None


class GibsLayersResponse(BaseModel):
    date: str
    wms_url: str
    layers: List[GibsLayer]


class RainfallPoint(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str = "point"
    lat: float = Field(
        ...,
        ge=-90,
        le=90,
        validation_alias=AliasChoices("lat", "latitude"),
    )
    lon: float = Field(
        ...,
        ge=-180,
        le=180,
        validation_alias=AliasChoices("lon", "longitude", "lng"),
    )


class RainfallRequest(BaseModel):
    points: List[RainfallPoint]
    past_days: int = Field(1, ge=0, le=7)
    forecast_days: int = Field(2, ge=1, le=16)
    hours: Optional[int] = Field(default=None, ge=1, le=168)


class RainfallSeries(BaseModel):
    point: RainfallPoint
    source: str
    hourly: Dict[str, List]


class RainfallResponse(BaseModel):
    updated: str
    items: List[RainfallSeries]


class PixelBBox(BaseModel):
    x: int = Field(..., ge=0)
    y: int = Field(..., ge=0)
    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)


class GeoBBox(BaseModel):
    west: float = Field(..., ge=-180, le=180)
    south: float = Field(..., ge=-90, le=90)
    east: float = Field(..., ge=-180, le=180)
    north: float = Field(..., ge=-90, le=90)


class CloudPrediction(BaseModel):
    class_name: str
    confidence: float
    detected: bool


class CloudClassifyResponse(BaseModel):
    model_loaded: bool
    threshold: float
    bbox_used: Optional[PixelBBox] = None
    geo_bbox: Optional[GeoBBox] = None
    predictions: List[CloudPrediction]
    detected_labels: List[str]
    best_label: Optional[str] = None
    best_confidence: Optional[float] = None
    message: str


class CloudBBoxClassifyRequest(BaseModel):
    geo_bbox: GeoBBox
    date: Optional[str] = None
    layer: str = "VIIRS_SNPP_CorrectedReflectance_TrueColor"
    image_format: str = "image/jpeg"
    width: int = Field(default=768, ge=128, le=1536)
    height: int = Field(default=768, ge=128, le=1536)
    threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    include_preview: bool = True


class CloudBBoxClassifyResponse(CloudClassifyResponse):
    source: str = "NASA GIBS WMS GetMap"
    source_layer: str
    source_date: str
    source_image_url: str
    image_size: Dict[str, int]
    preview_data_url: Optional[str] = None
