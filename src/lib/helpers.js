// ── URL and geometry helpers ───────────────────────────────────────────────

export const clampRadius = (v, fb) => {
  const n = parseInt(v, 10);
  return !isNaN(n) ? Math.min(50, Math.max(1, n)) : fb;
};

export function readUrlParams() {
  const p = new URLSearchParams(window.location.search);
  const lat = parseFloat(p.get("lat"));
  const lng = parseFloat(p.get("lng"));
  const zoom = parseFloat(p.get("zoom"));
  return {
    center: !isNaN(lat) && !isNaN(lng) ? [lng, lat] : null,
    zoom: !isNaN(zoom) ? zoom : null,
    radiusMin: clampRadius(p.get("rMin"), 1),
    radiusMax: clampRadius(p.get("rMax"), 15),
    query: p.get("q") || "",
  };
}

export function writeUrlParams({ center, zoom, radiusMin, radiusMax, query }) {
  const p = new URLSearchParams();
  if (center) {
    p.set("lat", center[1].toFixed(5));
    p.set("lng", center[0].toFixed(5));
  }
  if (zoom) p.set("zoom", zoom.toFixed(2));
  if (radiusMin != null) p.set("rMin", radiusMin);
  if (radiusMax != null) p.set("rMax", radiusMax);
  if (query) p.set("q", query);
  window.history.replaceState(null, "", `${window.location.pathname}?${p.toString()}`);
}

// ── GeoJSON helpers ────────────────────────────────────────────────────────
export function circleCoords(center, radiusKm, steps = 64) {
  const [lng, lat] = center;
  const coords = [];
  const ad = radiusKm / 6371;
  const latR = lat * Math.PI / 180;
  const lngR = lng * Math.PI / 180;
  for (let i = 0; i <= steps; i++) {
    const b = (2 * Math.PI * i) / steps;
    const pLat = Math.asin(
      Math.sin(latR) * Math.cos(ad) + Math.cos(latR) * Math.sin(ad) * Math.cos(b)
    );
    const pLng =
      lngR + Math.atan2(Math.sin(b) * Math.sin(ad) * Math.cos(latR), Math.cos(ad) - Math.sin(latR) * Math.sin(pLat));
    coords.push([(pLng * 180) / Math.PI, (pLat * 180) / Math.PI]);
  }
  return coords;
}

export function makeDonutGeoJSON(c, min, max) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [circleCoords(c, max), circleCoords(c, min).reverse()],
        },
        properties: {},
      },
    ],
  };
}

export function makeCircleGeoJSON(c, r) {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [circleCoords(c, r)] },
        properties: {},
      },
    ],
  };
}

export function zoomForRadius(km) {
  return km <= 2 ? 13 : km <= 5 ? 12 : km <= 10 ? 11 : km <= 20 ? 10 : km <= 35 ? 9 : 8;
}
