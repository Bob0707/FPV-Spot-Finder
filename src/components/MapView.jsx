import React, { useState, useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { BASE_LAYERS, OVERLAY_LAYERS, SPOT_TYPES, NATURSCHUTZ_COLOR } from "../lib/constants.js";
import { zoneColorExpr } from "../lib/airspace.js";
import { readUrlParams, makeDonutGeoJSON, makeCircleGeoJSON, zoomForRadius } from "../lib/helpers.js";
import { DACH_CENTER, DACH_ZOOM } from "../lib/constants.js";
import { IconDrone } from "./Icons.jsx";

export function MapView({
  mapRef,
  mapContainerRef,
  activeBase,
  activeOverlays,
  overlayOpacity,
  onMapReady,
  searchCircle,
  spots,
  activeSpotTypes,
  onSpotClick,
  showHeatmap,
  airspaceFeatures,
  naturschutzFeatures,
  showAirspace,
  showNaturschutz,
  onZoneClick,
}) {
  const [loaded, setLoaded] = useState(false);
  const initDone = useRef(false);

  // ── Initialize map once ──────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || initDone.current) return;
    initDone.current = true;

    const urlP = readUrlParams();
    const initCenter = urlP.center || DACH_CENTER;
    const initZoom = urlP.zoom || DACH_ZOOM;

    const sources = {};
    const layers = [];

    // Base tile layers
    BASE_LAYERS.forEach((bl) => {
      sources[`base-${bl.id}`] = {
        type: "raster",
        tiles: bl.tiles,
        tileSize: 256,
        attribution: bl.attribution,
        maxzoom: bl.maxZoom,
      };
      layers.push({
        id: `base-${bl.id}`,
        type: "raster",
        source: `base-${bl.id}`,
        layout: { visibility: bl.id === activeBase ? "visible" : "none" },
        paint: { "raster-opacity": 1 },
      });
    });

    // Overlay tile layers
    OVERLAY_LAYERS.forEach((ol) => {
      if (!ol.tiles) return;
      sources[`overlay-${ol.id}`] = {
        type: "raster",
        tiles: ol.tiles,
        tileSize: 256,
        attribution: ol.attribution || "",
        maxzoom: ol.maxZoom || 18,
      };
      layers.push({
        id: `overlay-${ol.id}`,
        type: "raster",
        source: `overlay-${ol.id}`,
        layout: { visibility: "none" },
        paint: { "raster-opacity": ol.opacity ?? 0.7 },
      });
    });

    // FPV Score heatmap overlay
    layers.push({
      id: "overlay-fpvscore",
      type: "heatmap",
      source: "spots",
      layout: { visibility: "none" },
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "fpvScore"], 0, 0, 100, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 8, 2.5, 12, 3.5],
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(0,0,0,0)",
          0.15, "rgba(124,58,237,0.25)",
          0.35, "rgba(167,139,250,0.55)",
          0.55, "rgba(34,211,167,0.72)",
          0.75, "rgba(52,211,153,0.88)",
          1, "rgba(16,185,129,1)",
        ],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 22, 7, 48, 10, 75],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.88, 12, 0.12],
      },
    });

    // Naturschutzgebiete
    sources["naturschutz-data"] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    layers.push({
      id: "naturschutz-fill",
      type: "fill",
      source: "naturschutz-data",
      layout: { visibility: "none" },
      paint: { "fill-color": NATURSCHUTZ_COLOR, "fill-opacity": 0.14 },
    });
    layers.push({
      id: "naturschutz-outline",
      type: "line",
      source: "naturschutz-data",
      layout: { visibility: "none" },
      paint: { "line-color": NATURSCHUTZ_COLOR, "line-width": 1.8, "line-opacity": 0.85 },
    });

    // Luftraumzonen (OpenAIP)
    sources["airspace-data"] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    const colorExpr = zoneColorExpr();
    layers.push({
      id: "airspace-fill",
      type: "fill",
      source: "airspace-data",
      layout: { visibility: "none" },
      paint: { "fill-color": colorExpr, "fill-opacity": 0.13 },
    });
    layers.push({
      id: "airspace-outline",
      type: "line",
      source: "airspace-data",
      layout: { visibility: "none" },
      paint: { "line-color": colorExpr, "line-width": 2.2, "line-opacity": 0.95 },
    });

    // Search radius sources
    ["search-radius-fill", "search-radius-outer", "search-radius-inner", "search-pin"].forEach((id) => {
      sources[id] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    });
    layers.push({
      id: "search-radius-fill-layer",
      type: "fill",
      source: "search-radius-fill",
      paint: { "fill-color": "#22d3a7", "fill-opacity": 0.08 },
    });
    layers.push({
      id: "search-radius-outer-layer",
      type: "line",
      source: "search-radius-outer",
      paint: { "line-color": "#22d3a7", "line-width": 2, "line-dasharray": [4, 3], "line-opacity": 0.9 },
    });
    layers.push({
      id: "search-radius-inner-layer",
      type: "line",
      source: "search-radius-inner",
      paint: { "line-color": "#22d3a7", "line-width": 1.5, "line-dasharray": [3, 4], "line-opacity": 0.5 },
    });

    // Spots source
    sources["spots"] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    layers.push({
      id: "spots-heatmap",
      type: "heatmap",
      source: "spots",
      layout: { visibility: "none" },
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "score"], 0, 0, 100, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 8, 2.5, 12, 3],
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(0,0,0,0)",
          0.1, "rgba(34,211,167,0.15)",
          0.3, "rgba(96,165,250,0.50)",
          0.55, "rgba(139,92,246,0.68)",
          0.75, "rgba(239,138,98,0.80)",
          1, "rgba(239,68,68,0.92)",
        ],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 18, 7, 40, 10, 65],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.85, 12, 0.10],
      },
    });

    layers.push({
      id: "search-pin-layer",
      type: "circle",
      source: "search-pin",
      paint: {
        "circle-radius": 7,
        "circle-color": "#22d3a7",
        "circle-stroke-width": 2.5,
        "circle-stroke-color": "#0a0e17",
        "circle-opacity": 0.95,
      },
    });

    layers.push({
      id: "spots-glow",
      type: "circle",
      source: "spots",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 10, 8, 16, 12, 22, 16, 30],
        "circle-color": [
          "match", ["get", "spotType"],
          "bando", "#ef4444",
          "quarry", "#f59e0b",
          "brownfield", "#8b5cf6",
          "bridge", "#3b82f6",
          "openspace", "#22d3a7",
          "clearing", "#10b981",
          "water", "#06b6d4",
          "#888",
        ],
        "circle-opacity": 0.25,
        "circle-blur": 1,
      },
    });

    SPOT_TYPES.forEach((st) => {
      layers.push({
        id: `spots-${st.id}`,
        type: "circle",
        source: "spots",
        filter: ["==", ["get", "spotType"], st.id],
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 6, 8, 9, 12, 11, 16, 15],
          "circle-color": st.color,
          "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 5, 2, 10, 2.5],
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 1,
        },
      });
    });

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: { version: 8, sources, layers },
      center: initCenter,
      zoom: initZoom,
      maxZoom: 18,
    });

    map.addControl(new maplibregl.NavigationControl(), "bottom-right");
    map.addControl(
      new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }),
      "bottom-right"
    );
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 150 }), "bottom-left");

    map.on("load", () => {
      setLoaded(true);
      onMapReady?.(map);

      SPOT_TYPES.forEach((st) => {
        map.on("click", `spots-${st.id}`, (e) => {
          if (e.features?.length > 0) onSpotClick?.(e.features[0]);
        });
        map.on("mouseenter", `spots-${st.id}`, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", `spots-${st.id}`, () => { map.getCanvas().style.cursor = ""; });
      });

      // Zone click handlers
      ["airspace-fill", "naturschutz-fill"].forEach((id) => {
        map.on("click", id, (e) => { if (e.features?.length > 0) onZoneClick?.(e.features[0]); });
        map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "crosshair"; });
        map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
      });
    });

    mapRef.current = map;
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: init once

  // ── Reactive effects ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    BASE_LAYERS.forEach((bl) => {
      if (map.getLayer(`base-${bl.id}`)) {
        map.setLayoutProperty(`base-${bl.id}`, "visibility", bl.id === activeBase ? "visible" : "none");
      }
    });
  }, [activeBase, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    OVERLAY_LAYERS.forEach((ol) => {
      const id = `overlay-${ol.id}`;
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", activeOverlays.includes(ol.id) ? "visible" : "none");
      }
    });
  }, [activeOverlays, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    OVERLAY_LAYERS.forEach((ol) => {
      if (!ol.tiles) return;
      const id = `overlay-${ol.id}`;
      if (map.getLayer(id)) {
        map.setPaintProperty(id, "raster-opacity", overlayOpacity[ol.id] ?? ol.opacity ?? 0.7);
      }
    });
  }, [overlayOpacity, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const empty = { type: "FeatureCollection", features: [] };
    if (!searchCircle) {
      ["search-radius-fill", "search-radius-outer", "search-radius-inner", "search-pin"].forEach((id) =>
        map.getSource(id)?.setData(empty)
      );
      return;
    }
    const { center, radiusMinKm, radiusMaxKm } = searchCircle;
    map.getSource("search-radius-fill")?.setData(makeDonutGeoJSON(center, radiusMinKm, radiusMaxKm));
    map.getSource("search-radius-outer")?.setData(makeCircleGeoJSON(center, radiusMaxKm));
    map.getSource("search-radius-inner")?.setData(
      radiusMinKm > 0.5 ? makeCircleGeoJSON(center, radiusMinKm) : empty
    );
    map.getSource("search-pin")?.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: center }, properties: {} }],
    });
    map.flyTo({ center, zoom: zoomForRadius(radiusMaxKm), speed: 1.4, curve: 1.4, essential: true });
  }, [searchCircle, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    map.getSource("spots")?.setData({ type: "FeatureCollection", features: spots || [] });
  }, [spots, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    SPOT_TYPES.forEach((st) => {
      const id = `spots-${st.id}`;
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", activeSpotTypes.includes(st.id) ? "visible" : "none");
      }
    });
  }, [activeSpotTypes, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    if (map.getLayer("spots-heatmap")) {
      map.setLayoutProperty("spots-heatmap", "visibility", showHeatmap ? "visible" : "none");
    }
  }, [showHeatmap, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    map.getSource("airspace-data")?.setData({ type: "FeatureCollection", features: airspaceFeatures || [] });
  }, [airspaceFeatures, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    ["airspace-fill", "airspace-outline"].forEach((id) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", showAirspace ? "visible" : "none");
      }
    });
  }, [showAirspace, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    map.getSource("naturschutz-data")?.setData({ type: "FeatureCollection", features: naturschutzFeatures || [] });
  }, [naturschutzFeatures, loaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    ["naturschutz-fill", "naturschutz-outline"].forEach((id) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", showNaturschutz ? "visible" : "none");
      }
    });
  }, [showNaturschutz, loaded]);

  return (
    <div ref={mapContainerRef} style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}>
      {!loaded && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--bg-primary)",
            zIndex: 10,
            gap: 12,
          }}
        >
          <div className="pulse-drone"><IconDrone /></div>
          <span style={{ color: "var(--text-muted)", fontSize: 14, fontFamily: "var(--font-body)" }}>
            Karte wird geladen…
          </span>
        </div>
      )}
    </div>
  );
}
