import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Cesium from "cesium";
import {
  Activity,
  Braces,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Eye,
  Gauge,
  Home,
  Layers,
  Loader2,
  LocateFixed,
  MapPin,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  TerminalSquare,
  Waves
} from "lucide-react";

import {
  classifyGeoBBox,
  getGibsLayers,
  getHealth,
  getModelStatus,
  getRainfall,
  refreshBackend,
  searchOpenMeteoLocation
} from "./api/client";

import {
  DEFAULT_GIBS_LAYERS,
  DEFAULT_RAINFALL_POINTS,
  addGibsLayer,
  createViewer,
  destroyViewer,
  drawBBox,
  flyHome,
  flyToLocation,
  getLayerId,
  normalizeGeoBBox,
  removeLayer,
  screenToGeo,
  zoomCamera
} from "./cesium/mapUtils";

const TODAY = new Date().toISOString().slice(0, 10);

const MENU = [
  { id: "layers", label: "layers", icon: Layers, desc: "NASA GIBS cloud imagery" },
  { id: "bbox", label: "bbox ai", icon: Crosshair, desc: "two-point cloud classification area" },
  { id: "rainfall", label: "rainfall", icon: Waves, desc: "local rainfall forecast" },
  { id: "system", label: "system", icon: Server, desc: "backend, model, and log" }
];

function formatNumber(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(digits);
}

function getRainfallRows(rainfallData) {
  if (!rainfallData) return [];
  if (Array.isArray(rainfallData.items)) return rainfallData.items;
  if (Array.isArray(rainfallData.points)) return rainfallData.points;
  if (Array.isArray(rainfallData.results)) return rainfallData.results;
  return [];
}

function getRainValue(row) {
  return (
    row?.next_24h_precipitation_mm ??
    row?.precipitation_next_24h_mm ??
    row?.rain_next_24h_mm ??
    row?.total_precipitation_mm ??
    row?.precipitation_mm ??
    row?.rain_mm ??
    0
  );
}

function getRainProb(row) {
  return (
    row?.max_precipitation_probability ??
    row?.precipitation_probability ??
    row?.probability ??
    row?.rain_probability ??
    null
  );
}

function getTomorrowRain(row) {
  return (
    row?.tomorrow_precipitation_mm ??
    row?.precipitation_tomorrow_mm ??
    row?.tomorrow_rain_mm ??
    null
  );
}

function rainLabel(mm) {
  const value = Number(mm || 0);
  if (value >= 30) return "heavy rain";
  if (value >= 10) return "rainy";
  if (value >= 2) return "light rain";
  return "cloud watch";
}

function LoadingOverlay({ active, message, detail }) {
  if (!active) return null;

  return (
    <div className="loading-overlay">
      <div className="loading-card">
        <div className="loading-logos official-logos">
          <div className="official-logo-frame unila-frame" data-fallback="UNILA">
            <img src="/brand/unila-official.png" alt="Logo Universitas Lampung" />
          </div>
          <div className="official-logo-frame kemdikti-frame" data-fallback="KEMENDIKTI SAINTEK">
            <img src="/brand/kemdiktisaintek-official.png" alt="Logo Kemendikti Saintek" />
          </div>
        </div>

        <div className="loader-ring">
          <Loader2 size={46} className="spin" />
        </div>

        <h2>UNILA Kampus Berdampak</h2>
        <p>Kemendikti Saintek · 2026</p>
        <div className="loading-message">{message || "processing satellite console..."}</div>
        <small>{detail || "NASA GIBS · CesiumJS · Cloud AI Model"}</small>
      </div>
    </div>
  );
}

function TopConsole({
  activeMenu,
  setActiveMenu,
  date,
  setDate,
  searchQuery,
  setSearchQuery,
  onSearch,
  topHidden,
  setTopHidden,
  apiStatus,
  modelStatus
}) {
  return (
    <header className={`top-console ${topHidden ? "is-collapsed" : ""}`}>
      <div className="console-strip">
        <div className="brand">
          <span className="brand-user">cloudsat_lite</span>
          <span className="slash">/</span>
          <span className="brand-title">earth weather console</span>
        </div>

        <div className="soundline" aria-hidden="true">
          <span></span><span></span><span></span><span></span><span></span>
        </div>

        <div className="statusline">
          <span className={apiStatus?.status === "ok" ? "dot ok" : "dot bad"}></span>
          <span>api:{apiStatus?.status || "unknown"}</span>
          <span className={modelStatus?.loaded ? "dot ok" : "dot warn"}></span>
          <span>model:{modelStatus?.loaded ? "loaded" : "idle"}</span>
        </div>

        <button className="hide-button" onClick={() => setTopHidden((v) => !v)}>
          {topHidden ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>

      {!topHidden && (
        <div className="top-row">
          <nav className="retro-tabs">
            {MENU.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={activeMenu === item.id ? "active" : ""}
                  onClick={() => setActiveMenu(item.id)}
                  title={item.desc}
                >
                  <Icon size={15} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="date-box">
            <span>date</span>
            <input value={date} onChange={(event) => setDate(event.target.value)} type="date" />
          </div>

          <form className="search-box" onSubmit={onSearch}>
            <Search size={15} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="search city / region..."
            />
            <button type="submit">scan</button>
          </form>
        </div>
      )}
    </header>
  );
}

function MapControls({
  bboxMode,
  onToggleBBox,
  onResetBBox,
  onClassify,
  canClassify,
  onZoomIn,
  onZoomOut,
  onHome,
  onRefresh,
  loading,
  toolbarHidden,
  setToolbarHidden
}) {
  return (
    <>
    <button
      className="mobile-toolbar-toggle"
      onClick={() => setToolbarHidden((value) => !value)}
      title={toolbarHidden ? "Show toolbar" : "Hide toolbar"}
    >
      {toolbarHidden ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}
    </button>
    <div className={`map-controls ${toolbarHidden ? "is-hidden-mobile" : ""}`}>
      <button onClick={onZoomIn} title="Zoom in">
        <Plus size={17} />
      </button>
      <button onClick={onZoomOut} title="Zoom out">
        <Minus size={17} />
      </button>
      <button onClick={onHome} title="Reset view">
        <Home size={17} />
      </button>
      <span className="control-separator"></span>
      <button className={bboxMode ? "active" : ""} onClick={onToggleBBox} title="BBox mode">
        <Crosshair size={17} />
      </button>
      <button onClick={onResetBBox} title="Reset BBox">
        <RotateCcw size={17} />
      </button>
      <button disabled={!canClassify || loading} onClick={onClassify} title="Classify selected BBox">
        <Braces size={17} />
      </button>
      <span className="control-separator"></span>
      <button onClick={onRefresh} disabled={loading} title="Refresh time-dependent data">
        <RefreshCw size={17} className={loading ? "spin" : ""} />
      </button>
    </div>
    </>
  );
}

function MiniReadout({ coordinates, bbox }) {
  return (
    <div className="mini-readout">
      <div>
        <span>lat</span>
        <b>{formatNumber(coordinates.lat, 4)}</b>
      </div>
      <div>
        <span>lon</span>
        <b>{formatNumber(coordinates.lon, 4)}</b>
      </div>
      <div>
        <span>bbox</span>
        <b>{bbox ? "locked" : "none"}</b>
      </div>
    </div>
  );
}

function SearchResults({ items, onFly, onClose }) {
  if (!items.length) return null;

  return (
    <div className="search-results-panel">
      <div className="search-results-head">
        <Search size={14} />
        <span>search results</span>
        <button onClick={onClose}>clear</button>
      </div>
      {items.map((item) => (
        <button
          key={`${item.id || item.name}-${item.latitude}-${item.longitude}`}
          onClick={() => onFly(item)}
        >
          <LocateFixed size={14} />
          <span>{item.name}</span>
          <small>{item.admin1 || item.country || ""}</small>
        </button>
      ))}
    </div>
  );
}

function BottomDock({
  bottomHidden,
  setBottomHidden,
  activeMenu,
  selectedLayer,
  setSelectedLayer,
  gibsInfo,
  onLoadLayer,
  onClearLayer,
  bbox,
  bboxMode,
  onToggleBBox,
  onResetBBox,
  onClassify,
  classifyResult,
  rainfallData,
  onLoadRainfall,
  apiStatus,
  modelStatus,
  logs,
  loading
}) {
  const activeMeta = MENU.find((m) => m.id === activeMenu);
  const layers = gibsInfo?.layers?.length ? gibsInfo.layers : DEFAULT_GIBS_LAYERS;

  return (
    <aside className={`bottom-dock ${bottomHidden ? "is-collapsed" : ""}`}>
      <div className="dock-handle">
        <div className="dock-title">
          <TerminalSquare size={15} />
          <span>{activeMeta?.label || "console"}</span>
          <small>{activeMeta?.desc}</small>
        </div>

        <button className="hide-button dock-hide" onClick={() => setBottomHidden((v) => !v)}>
          {bottomHidden ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {!bottomHidden && (
        <div className="dock-content">
          {activeMenu === "layers" && (
            <div className="dock-grid three">
              <section className="panel">
                <h3><Layers size={15} /> nasa gibs</h3>
                <label className="retro-label">cloud imagery layer</label>
                <select
                  value={getLayerId(selectedLayer)}
                  onChange={(event) => {
                    const next = layers.find((layer) => getLayerId(layer) === event.target.value) || event.target.value;
                    setSelectedLayer(next);
                  }}
                >
                  {layers.map((layer) => (
                    <option key={getLayerId(layer)} value={getLayerId(layer)}>
                      {layer.label || layer.title || getLayerId(layer)}
                    </option>
                  ))}
                </select>
                <div className="button-row">
                  <button onClick={onLoadLayer} disabled={loading}>reload cloud layer</button>
                  <button onClick={onClearLayer}>clear</button>
                </div>
              </section>

              <section className="panel">
                <h3><Activity size={15} /> layer info</h3>
                <p>Layer awan/bumi dimuat otomatis saat Cesium siap.</p>
                <p><b>date:</b> {gibsInfo?.date || "-"}</p>
                <p><b>active:</b> {getLayerId(selectedLayer)}</p>
              </section>

              <section className="panel">
                <h3><Gauge size={15} /> usage</h3>
                <p>Gunakan <b>reload cloud layer</b> kalau citra awan tidak terlihat setelah tanggal diganti.</p>
                <p className="hint">Satu layer aktif lebih ringan untuk browser.</p>
              </section>
            </div>
          )}

          {activeMenu === "bbox" && (
            <div className="dock-grid three">
              <section className="panel">
                <h3><Crosshair size={15} /> bbox ai</h3>
                <div className="button-row">
                  <button className={bboxMode ? "active" : ""} onClick={onToggleBBox}>
                    {bboxMode ? "bbox mode on" : "start bbox"}
                  </button>
                  <button onClick={onResetBBox}>reset bbox</button>
                  <button onClick={onClassify} disabled={!bbox || loading}>classify bbox</button>
                </div>
                <p className="hint">Klik dua titik di bumi untuk membentuk area klasifikasi.</p>
              </section>

              <section className="panel">
                <h3><Braces size={15} /> bbox coordinate</h3>
                {bbox ? (
                  <div className="codebox">
                    <span>west: {formatNumber(bbox.west, 4)}</span>
                    <span>south: {formatNumber(bbox.south, 4)}</span>
                    <span>east: {formatNumber(bbox.east, 4)}</span>
                    <span>north: {formatNumber(bbox.north, 4)}</span>
                  </div>
                ) : (
                  <p>Belum ada BBox.</p>
                )}
              </section>

              <section className="panel">
                <h3><Eye size={15} /> ai result</h3>
                {classifyResult ? (
                  <>
                    <p><b>best:</b> {classifyResult.best_label || "-"}</p>
                    <p><b>confidence:</b> {formatNumber(classifyResult.best_confidence, 3)}</p>
                    <p><b>status:</b> {classifyResult.message || "-"}</p>
                    <div className="chips">
                      {(classifyResult.detected_labels || []).map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>
                  </>
                ) : (
                  <p>Belum ada hasil klasifikasi.</p>
                )}
              </section>
            </div>
          )}

          {activeMenu === "rainfall" && (
            <div className="dock-grid rainfall-layout">
              <section className="panel rainfall-panel">
                <h3><Waves size={15} /> local rainfall forecast</h3>
                <button onClick={onLoadRainfall} disabled={loading}>load rainfall</button>
                <div className="forecast-table">
                  <div className="forecast-head">
                    <span>location</span>
                    <span>next 24h</span>
                    <span>tomorrow</span>
                    <span>prob</span>
                    <span>status</span>
                  </div>
                  {getRainfallRows(rainfallData).length > 0 ? (
                    getRainfallRows(rainfallData).map((row, index) => {
                      const rain = getRainValue(row);
                      const tomorrow = getTomorrowRain(row);
                      const prob = getRainProb(row);
                      return (
                        <div className="forecast-row" key={`${row.name || row.location || index}`}>
                          <span>{row.name || row.location || `point ${index + 1}`}</span>
                          <b>{formatNumber(rain, 1)} mm</b>
                          <b>{tomorrow === null ? "-" : `${formatNumber(tomorrow, 1)} mm`}</b>
                          <b>{prob === null ? "-" : `${formatNumber(prob, 0)}%`}</b>
                          <em>{rainLabel(rain)}</em>
                        </div>
                      );
                    })
                  ) : (
                    <div className="empty-row">Belum ada data. Tekan load rainfall.</div>
                  )}
                </div>
              </section>

              <section className="panel">
                <h3><MapPin size={15} /> points</h3>
                {DEFAULT_RAINFALL_POINTS.map((point) => (
                  <p key={point.name}>
                    <b>{point.name}</b> · {formatNumber(point.latitude, 2)}, {formatNumber(point.longitude, 2)}
                  </p>
                ))}
              </section>
            </div>
          )}

          {activeMenu === "system" && (
            <div className="dock-grid three">
              <section className="panel">
                <h3><Server size={15} /> backend</h3>
                <p><b>api:</b> {apiStatus?.status || "unknown"}</p>
                <p><b>app:</b> {apiStatus?.app || "-"}</p>
                <p><b>model loaded:</b> {String(apiStatus?.model_loaded ?? "-")}</p>
              </section>

              <section className="panel">
                <h3><Activity size={15} /> model</h3>
                <p><b>loaded:</b> {String(modelStatus?.loaded ?? false)}</p>
                <p><b>backend:</b> {modelStatus?.backend_name || "-"}</p>
                <p className="error-text">{modelStatus?.error || ""}</p>
              </section>

              <section className="panel log-panel">
                <h3><TerminalSquare size={15} /> console log</h3>
                <div className="logbox">
                  {logs.slice(-7).map((log, index) => (
                    <span key={`${log}-${index}`}>{log}</span>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

export default function App() {
  const viewerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const bboxEntityRef = useRef(null);
  const bboxFirstPointRef = useRef(null);
  const clickHandlerRef = useRef(null);
  const bootLayerLoadedRef = useRef(false);

  const [activeMenu, setActiveMenu] = useState("layers");
  const [topHidden, setTopHidden] = useState(false);
  const [bottomHidden, setBottomHidden] = useState(false);
  const [toolbarHidden, setToolbarHidden] = useState(false);

  const [date, setDate] = useState(TODAY);
  const [selectedLayer, setSelectedLayer] = useState(DEFAULT_GIBS_LAYERS[0]);
  const [gibsInfo, setGibsInfo] = useState(null);

  const [apiStatus, setApiStatus] = useState(null);
  const [modelStatus, setModelStatus] = useState(null);
  const [rainfallData, setRainfallData] = useState(null);
  const [classifyResult, setClassifyResult] = useState(null);

  const [bboxMode, setBBoxMode] = useState(false);
  const [bbox, setBBox] = useState(null);
  const [coordinates, setCoordinates] = useState({ lat: null, lon: null });

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [fatalError, setFatalError] = useState(null);
  const [logs, setLogs] = useState([
    "[boot] retro console ready",
    "[map] waiting cesium viewer"
  ]);

  const log = useCallback((message) => {
    setLogs((prev) => [...prev.slice(-20), `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  const runWithLoading = useCallback(async (message, task) => {
    setLoading(true);
    setLoadingMessage(message);
    try {
      return await task();
    } finally {
      setLoading(false);
      setLoadingMessage("");
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const [health, model] = await Promise.all([getHealth(), getModelStatus()]);
      setApiStatus(health);
      setModelStatus(model);
      log("status refreshed");
    } catch (error) {
      log(`status error: ${error.message}`);
    }
  }, [log]);

  const loadCloudLayer = useCallback((manual = false) => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (layerRef.current) {
      removeLayer(viewer, layerRef.current);
      layerRef.current = null;
    }

    layerRef.current = addGibsLayer(viewer, selectedLayer, date);
    log(`${manual ? "manual" : "auto"} layer loaded: ${getLayerId(selectedLayer)}`);
  }, [date, log, selectedLayer]);

  useEffect(() => {
    if (!mapRef.current || viewerRef.current) return;

    let viewer = null;
    let moveHandler = null;

    try {
      viewer = createViewer(mapRef.current);
      viewerRef.current = viewer;
      log("cesium viewer online");

      moveHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      moveHandler.setInputAction((movement) => {
        const geo = screenToGeo(viewer, movement.endPosition);
        if (geo) setCoordinates({ lat: geo.lat, lon: geo.lon });
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

      clickHandlerRef.current = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      refreshStatus();
    } catch (error) {
      console.error(error);
      setFatalError(error?.message || String(error));
      log(`cesium error: ${error?.message || error}`);
    }

    return () => {
      if (moveHandler) moveHandler.destroy();
      if (clickHandlerRef.current) {
        clickHandlerRef.current.destroy();
        clickHandlerRef.current = null;
      }
      destroyViewer(viewerRef.current);
      viewerRef.current = null;
    };
  }, [log, refreshStatus]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || bootLayerLoadedRef.current) return;
    bootLayerLoadedRef.current = true;

    const timer = setTimeout(() => {
      loadCloudLayer(false);
    }, 350);

    return () => clearTimeout(timer);
  }, [loadCloudLayer]);

  useEffect(() => {
    const handler = clickHandlerRef.current;
    const viewer = viewerRef.current;
    if (!handler || !viewer) return;

    handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);

    if (!bboxMode) return;

    handler.setInputAction((click) => {
      const geo = screenToGeo(viewer, click.position);
      if (!geo) return;

      if (!bboxFirstPointRef.current) {
        bboxFirstPointRef.current = geo;
        log(`bbox first point: ${formatNumber(geo.lat, 3)}, ${formatNumber(geo.lon, 3)}`);
        return;
      }

      const nextBBox = normalizeGeoBBox(bboxFirstPointRef.current, geo);
      bboxFirstPointRef.current = null;

      const entity = drawBBox(viewer, nextBBox, bboxEntityRef.current);
      bboxEntityRef.current = entity;
      setBBox(nextBBox);
      setActiveMenu("bbox");
      setBottomHidden(false);
      log("bbox locked");
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }, [bboxMode, log]);

  useEffect(() => {
    runWithLoading("loading NASA GIBS metadata...", async () => {
      try {
        const data = await getGibsLayers(date);
        setGibsInfo(data);

        if (Array.isArray(data.layers) && data.layers.length > 0) {
          const currentId = getLayerId(selectedLayer);
          const stillExists = data.layers.some((layer) => getLayerId(layer) === currentId);
          if (!stillExists) setSelectedLayer(DEFAULT_GIBS_LAYERS[0]);
        }

        log("gibs metadata loaded");
      } catch (error) {
        log(`gibs metadata error: ${error.message}`);
      }
    });
    // metadata saja, layer actual bisa reload manual/autoload
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoadLayer = useCallback(() => {
    runWithLoading("loading NASA GIBS cloud layer...", async () => {
      loadCloudLayer(true);
    });
  }, [loadCloudLayer, runWithLoading]);

  const handleClearLayer = useCallback(() => {
    const viewer = viewerRef.current;
    if (viewer && layerRef.current) {
      removeLayer(viewer, layerRef.current);
      layerRef.current = null;
      log("layer cleared");
    }
  }, [log]);

  const handleResetBBox = useCallback(() => {
    const viewer = viewerRef.current;
    if (viewer && bboxEntityRef.current) {
      viewer.entities.remove(bboxEntityRef.current);
      bboxEntityRef.current = null;
      viewer.scene.requestRender();
    }
    bboxFirstPointRef.current = null;
    setBBox(null);
    setClassifyResult(null);
    log("bbox reset");
  }, [log]);

  const handleClassifyBBox = useCallback(() => {
    if (!bbox) return;

    runWithLoading("calling cloud AI model for selected bbox...", async () => {
      const result = await classifyGeoBBox({
        geo_bbox: bbox,
        date,
        layer: getLayerId(selectedLayer),
        width: 768,
        height: 768,
        threshold: 0.5,
        include_preview: false
      });

      setClassifyResult(result);
      setActiveMenu("bbox");
      setBottomHidden(false);
      log(`classification done: ${result.best_label || "no label"}`);
      await refreshStatus();
    }).catch((error) => {
      setClassifyResult({ message: error.message, predictions: [], detected_labels: [] });
      log(`classification error: ${error.message}`);
    });
  }, [bbox, date, log, refreshStatus, runWithLoading, selectedLayer]);

  const handleLoadRainfall = useCallback(() => {
    runWithLoading("loading local rainfall forecast...", async () => {
      const data = await getRainfall(DEFAULT_RAINFALL_POINTS);
      setRainfallData(data);
      setActiveMenu("rainfall");
      setBottomHidden(false);
      log("rainfall data loaded");
    }).catch((error) => {
      log(`rainfall error: ${error.message}`);
    });
  }, [log, runWithLoading]);

  const handleRefresh = useCallback(() => {
    runWithLoading("refreshing time-dependent data...", async () => {
      const data = await refreshBackend();
      log(data.message || "backend refreshed");
      await refreshStatus();
      loadCloudLayer(true);
    }).catch((error) => {
      log(`refresh error: ${error.message}`);
    });
  }, [loadCloudLayer, log, refreshStatus, runWithLoading]);

  const handleSearch = useCallback((event) => {
    event.preventDefault();

    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      log("search empty");
      return;
    }

    runWithLoading("scanning location index...", async () => {
      const results = await searchOpenMeteoLocation(query);
      setSearchResults(results);
      log(`search result: ${results.length} item`);

      if (results.length > 0) {
        const first = results[0];
        flyToLocation(viewerRef.current, first.latitude, first.longitude);
        setCoordinates({ lat: first.latitude, lon: first.longitude });
        log(`auto fly to: ${first.name}`);
      }
    }).catch((error) => {
      setSearchResults([]);
      log(`search error: ${error.message}`);
    });
  }, [log, runWithLoading, searchQuery]);

  const handleFlySearchResult = useCallback((item) => {
    flyToLocation(viewerRef.current, item.latitude, item.longitude);
    setCoordinates({ lat: item.latitude, lon: item.longitude });
    setSearchResults([]);
    log(`camera fly to: ${item.name}`);
  }, [log]);

  const mapClass = useMemo(() => {
    const flags = [];
    if (topHidden) flags.push("top-hidden");
    if (bottomHidden) flags.push("bottom-hidden");
    return flags.join(" ");
  }, [topHidden, bottomHidden]);

  return (
    <div className="app-shell">
      <div className="crt-noise" aria-hidden="true"></div>

      <TopConsole
        activeMenu={activeMenu}
        setActiveMenu={setActiveMenu}
        date={date}
        setDate={setDate}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onSearch={handleSearch}
        topHidden={topHidden}
        setTopHidden={setTopHidden}
        apiStatus={apiStatus}
        modelStatus={modelStatus}
      />

      <main className={`earth-stage ${mapClass}`}>
        <div ref={mapRef} className="cesium-map"></div>
        {fatalError && (
          <div className="fatal-panel">
            <h2>frontend runtime error</h2>
            <p>{fatalError}</p>
            <small>Cek npm install, public/cesium, dan browser console.</small>
          </div>
        )}
        <div className="grid-overlay" aria-hidden="true"></div>
        <div className="scanline-overlay" aria-hidden="true"></div>

        <MapControls
          bboxMode={bboxMode}
          onToggleBBox={() => setBBoxMode((value) => !value)}
          onResetBBox={handleResetBBox}
          onClassify={handleClassifyBBox}
          canClassify={Boolean(bbox)}
          onZoomIn={() => zoomCamera(viewerRef.current, "in")}
          onZoomOut={() => zoomCamera(viewerRef.current, "out")}
          onHome={() => flyHome(viewerRef.current)}
          onRefresh={handleRefresh}
          loading={loading}
          toolbarHidden={toolbarHidden}
          setToolbarHidden={setToolbarHidden}
        />

        <MiniReadout coordinates={coordinates} bbox={bbox} />

        <div className="mode-badge">
          {bboxMode ? (
            <>
              <Crosshair size={15} />
              <span>bbox mode: click two points</span>
            </>
          ) : (
            <>
              <Eye size={15} />
              <span>navigation mode</span>
            </>
          )}
        </div>

        <SearchResults
          items={searchResults}
          onFly={handleFlySearchResult}
          onClose={() => setSearchResults([])}
        />
      </main>

      <BottomDock
        bottomHidden={bottomHidden}
        setBottomHidden={setBottomHidden}
        activeMenu={activeMenu}
        selectedLayer={selectedLayer}
        setSelectedLayer={setSelectedLayer}
        gibsInfo={gibsInfo}
        onLoadLayer={handleLoadLayer}
        onClearLayer={handleClearLayer}
        bbox={bbox}
        bboxMode={bboxMode}
        onToggleBBox={() => setBBoxMode((value) => !value)}
        onResetBBox={handleResetBBox}
        onClassify={handleClassifyBBox}
        classifyResult={classifyResult}
        rainfallData={rainfallData}
        onLoadRainfall={handleLoadRainfall}
        apiStatus={apiStatus}
        modelStatus={modelStatus}
        logs={logs}
        loading={loading}
      />

      <LoadingOverlay active={loading} message={loadingMessage} />
    </div>
  );
}
