from datetime import date, datetime, timedelta
from typing import List

from app.core.config import get_settings
from app.schemas import GibsLayer, GibsLayersResponse


def normalize_gibs_date(date_text: str | None = None) -> str:
    # NASA GIBS harian sering aman dipakai H-1 karena beberapa layer near-real-time
    # dapat terlambat beberapa jam.
    if not date_text:
        return (date.today() - timedelta(days=1)).isoformat()

    try:
        return datetime.strptime(date_text, "%Y-%m-%d").date().isoformat()
    except ValueError as exc:
        raise ValueError("Format date harus YYYY-MM-DD") from exc


def get_default_gibs_layers() -> List[GibsLayer]:
    # Daftar layer dibuat eksplisit agar arsitektur tidak liar.
    # Ubah hanya isi list ini bila ingin mengganti produk NASA GIBS.
    return [
        GibsLayer(
            id="viirs_true_color",
            title="VIIRS SNPP True Color",
            layer="VIIRS_SNPP_CorrectedReflectance_TrueColor",
            format="image/jpeg",
            alpha=1.0,
            visible=True,
            category="base",
        ),
        GibsLayer(
            id="cloud_top_height_day",
            title="MODIS Terra Cloud Top Height Day",
            layer="MODIS_Terra_Cloud_Top_Height_Day",
            format="image/png",
            alpha=0.55,
            visible=False,
            category="cloud",
        ),
        GibsLayer(
            id="cloud_top_temperature_day",
            title="MODIS Terra Cloud Top Temperature Day",
            layer="MODIS_Terra_Cloud_Top_Temperature_Day",
            format="image/png",
            alpha=0.55,
            visible=False,
            category="cloud",
        ),
        GibsLayer(
            id="cloud_optical_thickness",
            title="MODIS Terra Cloud Optical Thickness",
            layer="MODIS_Terra_Cloud_Optical_Thickness",
            format="image/png",
            alpha=0.45,
            visible=False,
            category="cloud",
        ),
    ]


def get_gibs_layers(date_text: str | None = None) -> GibsLayersResponse:
    settings = get_settings()
    gibs_date = normalize_gibs_date(date_text)
    return GibsLayersResponse(
        date=gibs_date,
        wms_url=settings.GIBS_WMS_EPSG4326,
        layers=get_default_gibs_layers(),
    )
