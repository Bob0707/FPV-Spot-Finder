import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/app.css";

// ── Lib ────────────────────────────────────────────────────────────────────
import { ALL_SPOT_TYPE_IDS } from "./lib/constants.js";
import { getScoreColor } from "./lib/scoring.js";
import { fetchSpots } from "./lib/overpass.js";
import { fetchOpenAIPData, fetchNaturschutzData } from "./lib/airspace.js";
import { fetchWeather, computeWeatherAmpel } from "./lib/weather.js";
import { getSunTimes, getSunStatus, formatTime } from "./lib/suncalc.js";
import { readUrlParams, writeUrlParams, zoomForRadius } from "./lib/helpers.js";
import { computeFlyCheck } from "./lib/flycheck.js";

// ── Components ─────────────────────────────────────────────────────────────
import {
  IconMenu, IconX, IconSearch, IconLayers, IconFilter,
  IconDrone, IconCompass, IconShield, IconTarget, IconCloud, IconSun,
} from "./components/Icons.jsx";
import { Toast } from "./components/Toast.jsx";
import { MapView } from "./components/MapView.jsx";
import { SidebarSection } from "./components/SidebarSection.jsx";
import { SearchPanel } from "./components/SearchPanel.jsx";
import LayerPanel from "./components/LayerPanel.jsx";
import SpotFilterPanel from "./components/SpotFilterPanel.jsx";
import { SpotDetailPanel } from "./components/SpotDetailPanel.jsx";
import { AirspacePanel } from "./components/AirspacePanel.jsx";
import { ZoneDetailPanel } from "./components/ZoneDetailPanel.jsx";
import FlyCheckPanel from "./components/FlyCheckPanel.jsx";
import WeatherPanel from "./components/WeatherPanel.jsx";
import SunPanel from "./components/SunPanel.jsx";

// ── Error Boundary ─────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("FPV App Error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            background: "#0a0e17",
            color: "#e2e8f0",
            fontFamily: "system-ui",
            gap: 16,
            padding: 24,
            textAlign: "center",
          }}
        >
          <span style={{ fontSize: 48 }}>🚁</span>
          <h2 style={{ margin: 0, fontSize: 20 }}>Etwas ist schiefgelaufen</h2>
          <p style={{ color: "#94a3b8", fontSize: 14, maxWidth: 400, lineHeight: 1.6 }}>
            {this.state.error?.message || "Ein unerwarteter Fehler ist aufgetreten."}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              background: "#22d3a7",
              color: "#0a0e17",
              border: "none",
              borderRadius: 8,
              padding: "10px 24px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            App neu laden
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Main Component ─────────────────────────────────────────────────────────
function FPVSpotFinder() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [activeBase, setActiveBase] = useState("osm");
  const [activeOverlays, setActiveOverlays] = useState([]);
  const [overlayOpacity, setOverlayOpacity] = useState({});
  const [toast, setToast] = useState(null);
  const [searchCircle, setSearchCircle] = useState(null);
  const [openSection, setOpenSection] = useState("Spot suchen");
  const sec = (title) => ({ open: openSection === title, onToggle: () => setOpenSection((s) => s === title ? null : title) });

  const [coords, setCoords] = useState(null);
  const [spots, setSpots] = useState([]);
  const [activeSpotTypes, setActiveSpotTypes] = useState([...ALL_SPOT_TYPE_IDS]);
  const [loadingSpots, setLoadingSpots] = useState(false);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [debugInfo, setDebugInfo] = useState(null);
  const [scoreMin, setScoreMin] = useState(0);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [queryTypes, setQueryTypes] = useState([...ALL_SPOT_TYPE_IDS]);

  // Phase 7
  const [airspaceKey, setAirspaceKey] = useState(() => localStorage.getItem("fpv-openaip-key") || "");
  const [airspaceFeatures, setAirspaceFeatures] = useState([]);
  const [naturschutzFeatures, setNaturschutzFeatures] = useState([]);
  const [showAirspace, setShowAirspace] = useState(false);
  const [showNaturschutz, setShowNaturschutz] = useState(false);
  const [loadingAirspace, setLoadingAirspace] = useState(false);
  const [loadingNaturschutz, setLoadingNaturschutz] = useState(false);
  const [airspaceError, setAirspaceError] = useState(null);
  const [naturschutzError, setNaturschutzError] = useState(null);
  const [selectedZone, setSelectedZone] = useState(null);

  // Phase 8
  const [flyCheckResult, setFlyCheckResult] = useState(null);

  // Phase 10
  const [weatherData, setWeatherData] = useState(null);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [weatherError, setWeatherError] = useState(null);

  const filteredSpots = useMemo(
    () => spots.filter((f) => (f.properties?.score ?? 0) >= scoreMin),
    [spots, scoreMin]
  );

  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const abortRef = useRef(null);
  const nsgAbortRef = useRef(null);

  // Restore URL params on mount
  useEffect(() => {
    const p = readUrlParams();
    if (p.center) {
      setSearchCircle({ center: p.center, radiusMinKm: p.radiusMin, radiusMaxKm: p.radiusMax });
    }
  }, []);

  // Responsive sidebar
  useEffect(() => {
    const check = () => {
      const m = window.innerWidth < 768;
      // Use functional updater so we can compare against the previous value.
      // Only close the sidebar when *transitioning* from desktop → mobile
      // (e.g. on initial load or screen rotation), NOT on every resize event
      // that happens while already on mobile (e.g. virtual keyboard opening).
      setIsMobile((prev) => {
        if (m && !prev) setSidebarOpen(false);
        return m;
      });
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Resize map after sidebar toggle
  useEffect(() => {
    setTimeout(() => mapRef.current?.resize(), 320);
  }, [sidebarOpen]);

  // Escape key closes open panels
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        if (selectedSpot) setSelectedSpot(null);
        else if (selectedZone) setSelectedZone(null);
        else if (isMobile && sidebarOpen) setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedSpot, selectedZone, isMobile, sidebarOpen]);

  // Load Google Fonts once
  useEffect(() => {
    if (!document.querySelector('link[href*="fonts.googleapis.com/css2"]')) {
      const pre = document.createElement("link");
      pre.rel = "preconnect";
      pre.href = "https://fonts.googleapis.com";
      document.head.appendChild(pre);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";
      document.head.appendChild(link);
    }
  }, []);

  const showToast = useCallback(
    (message, type = "info") => setToast({ message, type, id: Date.now() }),
    []
  );

  // Phase 8: auto-recompute fly check when spot or zone data changes
  useEffect(() => {
    if (!selectedSpot) { setFlyCheckResult(null); return; }
    setFlyCheckResult(computeFlyCheck(selectedSpot, airspaceFeatures, naturschutzFeatures));
  }, [selectedSpot, airspaceFeatures, naturschutzFeatures]);

  // Phase 10: fetch weather when selected spot changes
  const doFetchWeather = useCallback(async (spot) => {
    if (!spot) { setWeatherData(null); setWeatherError(null); return; }
    const [lng, lat] = spot.geometry.coordinates;
    setLoadingWeather(true);
    setWeatherError(null);
    try {
      const data = await fetchWeather(lat, lng);
      setWeatherData(data);
    } catch (err) {
      setWeatherError(err.message);
      setWeatherData(null);
    } finally {
      setLoadingWeather(false);
    }
  }, []);

  useEffect(() => {
    doFetchWeather(selectedSpot);
  }, [selectedSpot, doFetchWeather]);

  // ── Phase 7 fetch functions ──────────────────────────────────────────────
  const doFetchAirspace = useCallback(async () => {
    if (!searchCircle || !airspaceKey) return;
    setLoadingAirspace(true);
    setAirspaceError(null);
    try {
      const features = await fetchOpenAIPData(searchCircle.center, searchCircle.radiusMaxKm, airspaceKey);
      setAirspaceFeatures(features);
      showToast(
        features.length > 0 ? `${features.length} Luftraumzonen geladen` : "Keine Zonen im Suchbereich",
        features.length > 0 ? "success" : "info"
      );
    } catch (err) {
      setAirspaceError(err.message);
      showToast(`Luftraum: ${err.message}`, "warn");
    } finally {
      setLoadingAirspace(false);
    }
  }, [searchCircle, airspaceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const doFetchNaturschutz = useCallback(async () => {
    if (!searchCircle) return;
    nsgAbortRef.current?.abort();
    const ctrl = new AbortController();
    nsgAbortRef.current = ctrl;
    setLoadingNaturschutz(true);
    setNaturschutzError(null);
    try {
      const features = await fetchNaturschutzData(searchCircle.center, searchCircle.radiusMaxKm, ctrl.signal);
      setNaturschutzFeatures(features);
      if (features.length > 0) showToast(`${features.length} Naturschutzgebiete geladen`, "info");
    } catch (err) {
      if (err.name !== "AbortError") {
        setNaturschutzError(err.message);
        showToast(`Naturschutz: ${err.message}`, "warn");
      }
    } finally {
      setLoadingNaturschutz(false);
    }
  }, [searchCircle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch when toggle turns ON
  useEffect(() => {
    if (showAirspace && searchCircle && airspaceKey) doFetchAirspace();
  }, [showAirspace]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (showNaturschutz && searchCircle) doFetchNaturschutz();
  }, [showNaturschutz]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear zone data on new search circle, then re-fetch if toggles active
  useEffect(() => {
    setAirspaceFeatures([]);
    setNaturschutzFeatures([]);
    setAirspaceError(null);
    setNaturschutzError(null);
    setSelectedZone(null);
    if (searchCircle) {
      if (showAirspace && airspaceKey) setTimeout(() => doFetchAirspace(), 100);
      if (showNaturschutz) setTimeout(() => doFetchNaturschutz(), 100);
    }
  }, [searchCircle]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveApiKey = useCallback(
    (key) => {
      setAirspaceKey(key);
      localStorage.setItem("fpv-openaip-key", key);
      if (key) {
        showToast("API-Key gespeichert", "success");
        if (showAirspace && searchCircle) setTimeout(() => doFetchAirspace(), 50);
      }
    },
    [showAirspace, searchCircle, doFetchAirspace] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Spot fetching ──────────────────────────────────────────────────────
  const doFetchSpots = useCallback(
    (circle, types) => {
      if (!circle) return;
      const fetchTypes = types ?? queryTypes;
      if (!fetchTypes.length) { showToast("Mindestens eine Kategorie auswählen.", "warn"); return; }
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoadingSpots(true);
      setSelectedSpot(null);
      setDebugInfo(null);
      fetchSpots(circle.center, circle.radiusMinKm, circle.radiusMaxKm, fetchTypes, ctrl.signal)
        .then(({ features, rawCount, remark, turboUrl }) => {
          setSpots(features);
          setDebugInfo({ rawCount, classified: features.length, remark, turboUrl });
          if (rawCount === 0) {
            showToast("Overpass: 0 Elemente – Turbo-Link im Filter-Panel prüfen.", "warn");
          } else if (features.length === 0) {
            showToast(`${rawCount} OSM-Elemente, 0 klassifiziert – Console prüfen.`, "warn");
          } else {
            const avg = Math.round(
              features.reduce((a, f) => a + (f.properties.score ?? 0), 0) / features.length
            );
            showToast(`${features.length} Spots · Ø Score ${avg}`, "success");
          }
        })
        .catch((err) => {
          if (err.name !== "AbortError") {
            showToast(`Fehler: ${err.message}`, "warn");
            setDebugInfo({ rawCount: 0, classified: 0, remark: err.message, turboUrl: null });
          }
        })
        .finally(() => setLoadingSpots(false));
    },
    [queryTypes] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const lastCenterKey = useRef(null);
  useEffect(() => {
    if (!searchCircle) {
      setSpots([]);
      setSelectedSpot(null);
      setDebugInfo(null);
      lastCenterKey.current = null;
      abortRef.current?.abort();
      return;
    }
    const k = searchCircle.center.map((v) => v.toFixed(4)).join(",");
    if (k === lastCenterKey.current) return;
    lastCenterKey.current = k;
    doFetchSpots(searchCircle);
  }, [searchCircle, doFetchSpots]);

  const toggleSpotType = useCallback(
    (id) => setActiveSpotTypes((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]),
    []
  );

  const handleSpotClick = useCallback((f) => {
    // MapLibre serializes nested properties to JSON strings — parse them back
    const props = { ...f.properties };
    if (typeof props.tags === "string") try { props.tags = JSON.parse(props.tags); } catch {}
    if (typeof props.fpvBreakdown === "string") try { props.fpvBreakdown = JSON.parse(props.fpvBreakdown); } catch {}
    // Explicitly include geometry — spread may not copy it if MapLibre wraps it as non-enumerable
    const parsed = { type: "Feature", geometry: f.geometry, properties: props };
    setSelectedSpot(parsed);
    setSelectedZone(null);
    if (mapRef.current && f.geometry?.coordinates) {
      const z = Math.max(14, mapRef.current.getZoom());
      mapRef.current.flyTo({ center: f.geometry.coordinates, zoom: z, speed: 1.2, essential: true });
    }
  }, []);

  const handleZoneClick = useCallback((f) => setSelectedZone(f), []);

  const handleMapReady = useCallback((map) => {
    map.on("mousemove", (e) => setCoords([e.lngLat.lng, e.lngLat.lat]));
    map.on("mouseleave", () => setCoords(null));
  }, []);

  const handleSearch = useCallback((rOrU) => {
    setSearchCircle((prev) => {
      const next = typeof rOrU === "function" ? rOrU(prev) : rOrU;
      if (next) {
        writeUrlParams({
          center: next.center,
          zoom: zoomForRadius(next.radiusMaxKm),
          radiusMin: next.radiusMinKm,
          radiusMax: next.radiusMaxKm,
          query: next.label || "",
        });
      }
      return next;
    });
  }, []);

  const handleClear = useCallback(() => {
    setSearchCircle(null);
    writeUrlParams({});
    setDebugInfo(null);
    setScoreMin(0);
  }, []);

  // ── Derived badge values ────────────────────────────────────────────────
  const spotBadge = useMemo(() => {
    if (loadingSpots) return "lädt…";
    if (filteredSpots.length > 0) return `${filteredSpots.length} Spots`;
    return undefined;
  }, [filteredSpots.length, loadingSpots]);

  const airspaceBadge = useMemo(() => {
    const tot = airspaceFeatures.length + naturschutzFeatures.length;
    if (loadingAirspace || loadingNaturschutz) return "lädt…";
    if (tot > 0) return `${tot} Zonen`;
    if (showAirspace || showNaturschutz) return "Aktiv";
    return undefined;
  }, [airspaceFeatures.length, naturschutzFeatures.length, loadingAirspace, loadingNaturschutz, showAirspace, showNaturschutz]);

  const weatherBadge = useMemo(() => {
    if (!selectedSpot) return undefined;
    if (loadingWeather) return "lädt…";
    if (weatherData) {
      const a = computeWeatherAmpel(weatherData.current);
      return a === "green" ? "✅ Gut" : a === "yellow" ? "⚠️ Prüfen" : "🚫 Stop";
    }
    return undefined;
  }, [selectedSpot, loadingWeather, weatherData]);

  const sunBadge = useMemo(() => {
    const loc = selectedSpot || searchCircle;
    if (!loc) return undefined;
    try {
      const now = new Date();
      const lat = selectedSpot ? selectedSpot.geometry.coordinates[1] : searchCircle.center[1];
      const lng = selectedSpot ? selectedSpot.geometry.coordinates[0] : searchCircle.center[0];
      const t = getSunTimes(now, lat, lng);
      const s = getSunStatus(t, now);
      if (s.label === "Goldene Stunde") return "🌅 Jetzt!";
      if (s.label === "Tag") {
        const diff = Math.round((t.goldenEveningStart - now) / 60000);
        return diff > 0 ? `☀️ ${diff > 60 ? Math.floor(diff / 60) + "h " : ""}${diff % 60}min` : "☀️ Tag";
      }
      if (now < t.sunrise) return `🌙 Aufg. ${formatTime(t.sunrise)}`;
    } catch {}
    return undefined;
  }, [selectedSpot, searchCircle]);

  const baseLabel = useMemo(() => {
    const BASE_LAYERS = [
      { id: "osm", name: "OpenStreetMap" },
      { id: "satellite", name: "Satellit" },
      { id: "topo", name: "Topografie" },
    ];
    return BASE_LAYERS.find((l) => l.id === activeBase)?.name ?? "—";
  }, [activeBase]);

  const overlayCount = activeOverlays.length;
  const urlParams = useMemo(() => readUrlParams(), []);

  return (
    <>
      <div className="app-root">
        <header className="app-header">
          <button
            className="header-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={sidebarOpen ? "Sidebar schließen" : "Sidebar öffnen"}
          >
            {sidebarOpen ? <IconX /> : <IconMenu />}
          </button>
          <div className="header-brand">
            <span className="brand-icon"><IconDrone /></span>
            <span className="brand-text">FPV Spot Finder</span>
            <span className="brand-tag">Alpha</span>
          </div>
          <div className="header-layer-status">
            <span className="status-dot" />
            <span>{baseLabel}</span>
            {overlayCount > 0 && <span className="status-overlay-count">+{overlayCount}</span>}
            {filteredSpots.length > 0 && (
              <span className="status-overlay-count" style={{ background: "rgba(34,211,167,.15)", color: "var(--accent)" }}>
                📍 {filteredSpots.length}
              </span>
            )}
            {showHeatmap && (
              <span className="status-overlay-count" style={{ background: "rgba(167,139,250,.15)", color: "#a78bfa" }}>
                🔥
              </span>
            )}
            {activeOverlays.includes("fpvscore") && filteredSpots.length > 0 && (
              <span className="status-overlay-count" style={{ background: "rgba(167,139,250,.15)", color: "#a78bfa" }}>
                🚁 FPV
              </span>
            )}
            {(airspaceFeatures.length > 0 || naturschutzFeatures.length > 0) && (
              <span className="status-overlay-count" style={{ background: "rgba(239,68,68,.15)", color: "#ef4444" }}>
                ✈ {airspaceFeatures.length + naturschutzFeatures.length}
              </span>
            )}
          </div>
          <div className="header-coords">
            <IconCompass />
            {coords ? (
              <span className="coords-live">{coords[1].toFixed(4)}°N · {coords[0].toFixed(4)}°E</span>
            ) : (
              <span>DACH · 47.5°N · 10.5°E</span>
            )}
          </div>
        </header>

        <div className="app-body">
          {isMobile && sidebarOpen && (
            <div className="mobile-overlay" onClick={() => setSidebarOpen(false)} />
          )}
          <aside className={`app-sidebar ${sidebarOpen ? "" : "closed"}`}>
            <div className="sidebar-scroll">
              <SidebarSection icon={<IconSearch />} title="Spot suchen" {...sec("Spot suchen")} badge={searchCircle ? "Aktiv" : undefined}>
                <SearchPanel
                  onSearch={handleSearch}
                  onClear={handleClear}
                  hasResult={!!searchCircle}
                  currentQuery={urlParams.query}
                  onToast={showToast}
                  queryTypes={queryTypes}
                  onQueryTypesChange={setQueryTypes}
                />
              </SidebarSection>

              <SidebarSection icon={<IconLayers />} title="Karten-Layer" {...sec("Karten-Layer")} badge={overlayCount > 0 ? `${overlayCount} aktiv` : undefined}>
                <LayerPanel
                  activeBase={activeBase}
                  setActiveBase={setActiveBase}
                  activeOverlays={activeOverlays}
                  setActiveOverlays={setActiveOverlays}
                  overlayOpacity={overlayOpacity}
                  setOverlayOpacity={setOverlayOpacity}
                  onToast={showToast}
                />
              </SidebarSection>

              <SidebarSection icon={<IconFilter />} title="Spot-Filter" {...sec("Spot-Filter")} badge={spotBadge}>
                <SpotFilterPanel
                  spots={spots}
                  activeSpotTypes={activeSpotTypes}
                  onToggle={toggleSpotType}
                  onRefetch={() => doFetchSpots(searchCircle)}
                  loading={loadingSpots}
                  hasSearch={!!searchCircle}
                  debugInfo={debugInfo}
                  scoreMin={scoreMin}
                  onScoreMinChange={setScoreMin}
                  showHeatmap={showHeatmap}
                  onHeatmapToggle={() => setShowHeatmap((v) => !v)}
                />
              </SidebarSection>

              <SidebarSection icon={<IconShield />} title="Luftraum" {...sec("Luftraum")} badge={airspaceBadge}>
                <AirspacePanel
                  apiKey={airspaceKey}
                  onSaveKey={handleSaveApiKey}
                  showAirspace={showAirspace}
                  onShowAirspaceToggle={() => setShowAirspace((v) => !v)}
                  showNaturschutz={showNaturschutz}
                  onShowNaturschutzToggle={() => setShowNaturschutz((v) => !v)}
                  airspaceFeatures={airspaceFeatures}
                  naturschutzFeatures={naturschutzFeatures}
                  loadingAirspace={loadingAirspace}
                  loadingNaturschutz={loadingNaturschutz}
                  airspaceError={airspaceError}
                  naturschutzError={naturschutzError}
                  hasSearch={!!searchCircle}
                  onFetchAirspace={doFetchAirspace}
                  onFetchNaturschutz={doFetchNaturschutz}
                />
              </SidebarSection>

              <SidebarSection
                icon={<IconTarget />}
                title="Fly-or-No-Fly Check"
                {...sec("Fly-or-No-Fly Check")}
                badge={
                  flyCheckResult
                    ? flyCheckResult.verdict === "green"
                      ? "✅ OK"
                      : flyCheckResult.verdict === "yellow"
                      ? "⚠️ Prüfen"
                      : "🚫 Stop"
                    : undefined
                }
              >
                <FlyCheckPanel
                  selectedSpot={selectedSpot}
                  flyCheckResult={flyCheckResult}
                  airspaceLoaded={airspaceFeatures.length > 0}
                  naturschutzLoaded={naturschutzFeatures.length > 0}
                />
              </SidebarSection>

              <SidebarSection icon={<IconCloud />} title="Wetter" {...sec("Wetter")} badge={weatherBadge}>
                <WeatherPanel
                  selectedSpot={selectedSpot}
                  weatherData={weatherData}
                  loading={loadingWeather}
                  error={weatherError}
                  onRefetch={() => doFetchWeather(selectedSpot)}
                />
              </SidebarSection>

              <SidebarSection icon={<IconSun />} title="Sonnenstand" {...sec("Sonnenstand")} badge={sunBadge}>
                <SunPanel selectedSpot={selectedSpot} searchCircle={searchCircle} />
              </SidebarSection>
            </div>
            <div className="sidebar-footer">
              FPV Spot Finder <span>v1.0</span> · Phase 12 · Spot-Detail &amp; Share
            </div>
          </aside>

          <div className="map-area">
            <MapView
              mapRef={mapRef}
              mapContainerRef={mapContainerRef}
              activeBase={activeBase}
              activeOverlays={activeOverlays}
              overlayOpacity={overlayOpacity}
              onMapReady={handleMapReady}
              searchCircle={searchCircle}
              spots={filteredSpots}
              activeSpotTypes={activeSpotTypes}
              onSpotClick={handleSpotClick}
              showHeatmap={showHeatmap}
              airspaceFeatures={airspaceFeatures}
              naturschutzFeatures={naturschutzFeatures}
              showAirspace={showAirspace}
              showNaturschutz={showNaturschutz}
              onZoneClick={handleZoneClick}
            />
            {selectedSpot && (
              <SpotDetailPanel
                spot={selectedSpot}
                onClose={() => setSelectedSpot(null)}
                flyCheckResult={flyCheckResult}
                onToast={showToast}
              />
            )}
            {selectedZone && (
              <ZoneDetailPanel zone={selectedZone} onClose={() => setSelectedZone(null)} />
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className="toast-container">
          <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        </div>
      )}
    </>
  );
}

// ── Wrapped Export with Error Boundary ─────────────────────────────────────
export default function App() {
  return (
    <ErrorBoundary>
      <FPVSpotFinder />
    </ErrorBoundary>
  );
}
