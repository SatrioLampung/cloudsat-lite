import base64
import re
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlencode

import httpx

from app.core.config import get_settings
from app.schemas import CloudBBoxClassifyRequest, GeoBBox
from app.services.gibs import get_default_gibs_layers, normalize_gibs_date


_SAFE_LAYER_RE = re.compile(r"^[A-Za-z0-9_.:-]+$")
_ALLOWED_FORMATS = {"image/jpeg", "image/png"}


@dataclass(frozen=True)
class GibsImageResult:
    image_bytes: bytes
    content_type: str
    source_url: str
    source_layer: str
    source_date: str
    width: int
    height: int


def validate_geo_bbox(geo_bbox: GeoBBox) -> None:
    if geo_bbox.west >= geo_bbox.east:
        raise ValueError("geo_bbox tidak valid: nilai west harus lebih kecil dari east.")
    if geo_bbox.south >= geo_bbox.north:
        raise ValueError("geo_bbox tidak valid: nilai south harus lebih kecil dari north.")

    lon_span = geo_bbox.east - geo_bbox.west
    lat_span = geo_bbox.north - geo_bbox.south

    if lon_span < 0.01 or lat_span < 0.01:
        raise ValueError("geo_bbox terlalu kecil. Perbesar area agar citra GIBS bisa dianalisis.")
    if lon_span > 40 or lat_span > 40:
        raise ValueError("geo_bbox terlalu besar. Batasi area agar klasifikasi tetap ringan dan relevan.")


def resolve_gibs_layer(layer_id_or_name: Optional[str]) -> tuple[str, str]:
    requested = layer_id_or_name or "VIIRS_SNPP_CorrectedReflectance_TrueColor"
    layers = get_default_gibs_layers()

    for layer in layers:
        if requested in {layer.id, layer.layer, layer.title, layer.name}:
            return layer.layer, layer.format

    if not _SAFE_LAYER_RE.match(requested):
        raise ValueError("Nama layer GIBS mengandung karakter tidak aman.")

    return requested, "image/jpeg"


def normalize_image_format(image_format: Optional[str], fallback: str) -> str:
    selected = image_format or fallback or "image/jpeg"
    selected = selected.lower().strip()
    if selected not in _ALLOWED_FORMATS:
        raise ValueError("image_format hanya boleh image/jpeg atau image/png.")
    return selected


def build_gibs_getmap_url(request: CloudBBoxClassifyRequest) -> tuple[str, str, str, str]:
    settings = get_settings()
    validate_geo_bbox(request.geo_bbox)

    source_date = normalize_gibs_date(request.date)
    source_layer, layer_default_format = resolve_gibs_layer(request.layer)
    image_format = normalize_image_format(request.image_format, layer_default_format)

    bbox = request.geo_bbox
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.1.1",
        "REQUEST": "GetMap",
        "LAYERS": source_layer,
        "STYLES": "",
        "SRS": "EPSG:4326",
        "BBOX": f"{bbox.west},{bbox.south},{bbox.east},{bbox.north}",
        "WIDTH": str(request.width),
        "HEIGHT": str(request.height),
        "FORMAT": image_format,
        "TRANSPARENT": "FALSE" if image_format == "image/jpeg" else "TRUE",
        "TIME": source_date,
    }

    separator = "&" if "?" in settings.GIBS_WMS_EPSG4326 else "?"
    source_url = f"{settings.GIBS_WMS_EPSG4326}{separator}{urlencode(params)}"
    return source_url, source_layer, source_date, image_format


async def fetch_gibs_bbox_image(request: CloudBBoxClassifyRequest) -> GibsImageResult:
    source_url, source_layer, source_date, image_format = build_gibs_getmap_url(request)

    async with httpx.AsyncClient(follow_redirects=True, timeout=45) as client:
        response = await client.get(source_url)

    content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
    body = response.content

    if response.status_code >= 400:
        preview = body[:300].decode("utf-8", errors="ignore")
        raise ValueError(f"GIBS GetMap gagal HTTP {response.status_code}: {preview}")

    if not content_type.startswith("image/"):
        preview = body[:500].decode("utf-8", errors="ignore")
        raise ValueError(f"GIBS tidak mengembalikan gambar. Content-Type={content_type}. Isi awal: {preview}")

    if not body:
        raise ValueError("GIBS mengembalikan gambar kosong.")

    return GibsImageResult(
        image_bytes=body,
        content_type=content_type or image_format,
        source_url=str(response.url),
        source_layer=source_layer,
        source_date=source_date,
        width=request.width,
        height=request.height,
    )


def image_to_data_url(image_bytes: bytes, content_type: str) -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{content_type};base64,{encoded}"
