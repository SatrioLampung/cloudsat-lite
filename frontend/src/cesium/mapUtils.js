import * as Cesium from "cesium";

export const DEFAULT_CENTER = {
  lon: 105.262,
  lat: -5.361,
  height: 3000000
};

export const GIBS_WMS_URL = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

export const DEFAULT_GIBS_LAYERS = [
  {
    id: "VIIRS_SNPP_CorrectedReflectance_TrueColor",
    layer: "VIIRS_SNPP_CorrectedReflectance_TrueColor",
    label: "VIIRS True Color",
    description: "Citra warna alami NASA GIBS. Cloud visible by default."
  },
  {
    id: "MODIS_Terra_CorrectedReflectance_TrueColor",
    layer: "MODIS_Terra_CorrectedReflectance_TrueColor",
    label: "MODIS Terra True Color",
    description: "Citra warna alami MODIS Terra."
  },
  {
    id: "MODIS_Aqua_CorrectedReflectance_TrueColor",
    layer: "MODIS_Aqua_CorrectedReflectance_TrueColor",
    label: "MODIS Aqua True Color",
    description: "Citra warna alami MODIS Aqua."
  }
];

export const DEFAULT_RAINFALL_POINTS = [
  { name: "Bandar Lampung", latitude: -5.3971, longitude: 105.2668 },
  { name: "Metro", latitude: -5.1131, longitude: 105.3067 },
  { name: "Terbanggi Besar", latitude: -4.8667, longitude: 105.2167 },
  { name: "Kotabumi", latitude: -4.8386, longitude: 104.9 },
  { name: "Kalianda", latitude: -5.7381, longitude: 105.5922 }
];

export function getLayerId(layerLike) {
  if (!layerLike) return DEFAULT_GIBS_LAYERS[0].layer;
  if (typeof layerLike === "string") return layerLike;
  return layerLike.layer || layerLike.id || DEFAULT_GIBS_LAYERS[0].layer;
}

export function createViewer(container) {
  if (!container) throw new Error("Container Cesium tidak ditemukan.");

  const token = import.meta.env.VITE_CESIUM_ION_TOKEN;
  if (token) Cesium.Ion.defaultAccessToken = token;

  const viewer = new Cesium.Viewer(container, {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    shouldAnimate: false,
    requestRenderMode: false,
    baseLayer: false
  });

  viewer.scene.globe.baseColor = Cesium.Color.BLACK;
  viewer.scene.globe.enableLighting = false;
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 80000;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 12000000;

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      DEFAULT_CENTER.lon,
      DEFAULT_CENTER.lat,
      DEFAULT_CENTER.height
    ),
    duration: 0
  });

  return viewer;
}

export function flyHome(viewer) {
  if (!viewer) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      DEFAULT_CENTER.lon,
      DEFAULT_CENTER.lat,
      DEFAULT_CENTER.height
    ),
    duration: 0.9
  });
}

export function zoomCamera(viewer, direction) {
  if (!viewer) return;
  const amount = direction === "in" ? 0.55 : 1.85;
  const position = viewer.camera.positionCartographic;
  const targetHeight = Math.max(60000, Math.min(14000000, position.height * amount));

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromRadians(
      position.longitude,
      position.latitude,
      targetHeight
    ),
    duration: 0.35
  });
}

export function flyToLocation(viewer, lat, lon, height = 900000) {
  if (!viewer) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
    duration: 0.9
  });
}

export function addGibsLayer(viewer, layerLike, date) {
  if (!viewer) return null;

  const layerId = getLayerId(layerLike);
  const provider = new Cesium.WebMapServiceImageryProvider({
    url: GIBS_WMS_URL,
    layers: layerId,
    parameters: {
      service: "WMS",
      version: "1.1.1",
      request: "GetMap",
      transparent: false,
      format: "image/png",
      time: date || new Date().toISOString().slice(0, 10)
    },
    enablePickFeatures: false
  });

  const layer = viewer.imageryLayers.addImageryProvider(provider);
  layer.alpha = 1;
  viewer.scene.requestRender();
  return layer;
}

export function removeLayer(viewer, layerRef) {
  if (!viewer || !layerRef) return;
  viewer.imageryLayers.remove(layerRef, true);
  viewer.scene.requestRender();
}

export function screenToGeo(viewer, position) {
  if (!viewer || !position) return null;

  const cartesian = viewer.camera.pickEllipsoid(position, viewer.scene.globe.ellipsoid);
  if (!cartesian) return null;

  const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
  return {
    lat: Cesium.Math.toDegrees(cartographic.latitude),
    lon: Cesium.Math.toDegrees(cartographic.longitude)
  };
}

export function normalizeGeoBBox(first, second) {
  return {
    west: Math.min(first.lon, second.lon),
    south: Math.min(first.lat, second.lat),
    east: Math.max(first.lon, second.lon),
    north: Math.max(first.lat, second.lat)
  };
}

export function drawBBox(viewer, geoBBox, previousEntity) {
  if (!viewer || !geoBBox) return null;

  if (previousEntity) viewer.entities.remove(previousEntity);

  const entity = viewer.entities.add({
    rectangle: {
      coordinates: Cesium.Rectangle.fromDegrees(
        geoBBox.west,
        geoBBox.south,
        geoBBox.east,
        geoBBox.north
      ),
      material: Cesium.Color.CYAN.withAlpha(0.14),
      outline: true,
      outlineColor: Cesium.Color.CYAN,
      outlineWidth: 2
    }
  });

  viewer.scene.requestRender();
  return entity;
}

export function destroyViewer(viewer) {
  if (viewer && !viewer.isDestroyed()) viewer.destroy();
}
