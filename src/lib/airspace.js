import { AIRSPACE_TYPES, NATURSCHUTZ_COLOR } from "./constants.js";
import { haversineKm } from "./scoring.js";
import { radiusToBbox, raceEndpoints } from "./overpass.js";

// ── Airspace type helpers ──────────────────────────────────────────────────
export function getAirspaceTypeInfo(code) {
  if (typeof code === "number") {
    return AIRSPACE_TYPES.find((t) => t.type === code) || AIRSPACE_TYPES[0];
  }
  return AIRSPACE_TYPES.find((t) => t.shortCode === code) || AIRSPACE_TYPES[0];
}

export function formatAltLimit(limit) {
  if (!limit) return "?";
  let { value, unit, referenceDatum } = limit;
  if (typeof unit === "number") unit = (["FT", "FL", "M"])[unit] ?? "FT";
  if (typeof referenceDatum === "number") referenceDatum = (["GND", "MSL", "STD"])[referenceDatum] ?? "GND";
  if (unit === "FL") return `FL${String(Math.round(value)).padStart(3, "0")}`;
  return `${value} ${unit === "FT" ? "ft" : unit === "M" ? "m" : unit} ${referenceDatum}`;
}

// MapLibre match expression for zone colors
export function zoneColorExpr() {
  const pairs = AIRSPACE_TYPES.flatMap((t) => [t.shortCode, t.color]);
  return ["match", ["get", "zoneType"], ...pairs, "#94a3b8"];
}

// ── Phase 7: OpenAIP fetch (via Vite-Proxy /api/openaip) ──────────────────
export async function fetchOpenAIPData(center, radiusKm, apiKey) {
  const [lng, lat] = center;
  const { s, w, n, e } = radiusToBbox(lat, lng, radiusKm);
  const bbox = `${w},${s},${e},${n}`;

  const fetchPage = async (page) => {
    const res = await fetch(
      `/api/openaip/airspaces?bbox=${bbox}&page=${page}&limit=100`,
      { headers: { "x-openaip-api-key": apiKey, Accept: "application/json" } }
    );
    if (res.status === 401 || res.status === 403) {
      throw new Error("Ungültiger API-Key — bitte OpenAIP-Key prüfen");
    }
    if (res.status === 429) throw new Error("Rate-Limit erreicht — bitte kurz warten");
    if (!res.ok) throw new Error(`OpenAIP Fehler: HTTP ${res.status}`);
    return res.json();
  };

  const first = await fetchPage(1);
  const items = [...(first.items || [])];
  if ((first.total || 0) > 100) {
    try {
      const s2 = await fetchPage(2);
      items.push(...(s2.items || []));
    } catch {
      // ignore second-page errors
    }
  }

  return items
    .filter((item) => item.geometry)
    .map((item) => {
      const ti = getAirspaceTypeInfo(item.type);
      return {
        type: "Feature",
        geometry: item.geometry,
        properties: {
          id: item._id || String(item.id || Math.random()),
          name: item.name || "(kein Name)",
          zoneType: ti.shortCode,
          zoneTypeName: ti.name,
          zoneColor: ti.color,
          type: item.type,
          icaoClass: item.icaoClass,
          lowerLimit: item.lowerLimit || null,
          upperLimit: item.upperLimit || null,
          activity: item.activity,
          onRequest: item.onRequest || false,
          byNotam: item.byNotam || false,
          country: item.country || "",
        },
      };
    });
}

// ── Polygon centroid (average of ring coordinates) ─────────────────────────
export function polygonCentroid(coords) {
  const ring = coords[0];
  const n = ring.length;
  let sLng = 0;
  let sLat = 0;
  for (const [x, y] of ring) {
    sLng += x;
    sLat += y;
  }
  return [sLng / n, sLat / n];
}

// ── Phase 7: Naturschutz fetch via Overpass ────────────────────────────────
export async function fetchNaturschutzData(center, radiusKm, signal) {
  const [lng, lat] = center;
  // Tighter bbox (90% of radius) to reduce hits outside the circle
  const nsgBboxKm = radiusKm * 0.9;
  const { s, w, n, e } = radiusToBbox(lat, lng, nsgBboxKm);
  const bbox = `${s},${w},${n},${e}`;
  const query = [
    `[out:json][timeout:30][bbox:${bbox}];`,
    "(",
    '  way["boundary"="protected_area"]["name"];',
    '  way["leisure"="nature_reserve"]["name"];',
    '  way["boundary"="national_park"]["name"];',
    '  relation["boundary"="protected_area"]["name"];',
    '  relation["leisure"="nature_reserve"]["name"];',
    '  relation["boundary"="national_park"]["name"];',
    ");",
    "out geom tags;",
  ].join("\n");

  const data = await raceEndpoints(query, signal);
  const features = [];

  for (const el of data.elements || []) {
    const props = {
      id: String(el.id),
      name: el.tags?.name || "(kein Name)",
      zoneType: "NATURSCHUTZ",
      zoneColor: NATURSCHUTZ_COLOR,
      protectClass: el.tags?.protect_class || "",
      protect_title: el.tags?.protect_title || "",
      boundary: el.tags?.boundary || el.tags?.leisure || "",
      access: el.tags?.access || "",
      website: el.tags?.website || "",
    };

    if (el.type === "way" && el.geometry?.length >= 3) {
      const coords = el.geometry.map((p) => [p.lon, p.lat]);
      const f = coords[0];
      const l = coords[coords.length - 1];
      if (f[0] !== l[0] || f[1] !== l[1]) coords.push([f[0], f[1]]);
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [coords] },
        properties: props,
      });
    } else if (el.type === "relation" && el.members) {
      const outerRings = [];
      for (const m of el.members) {
        if (m.role === "outer" && m.geometry?.length >= 3) {
          const coords = m.geometry.map((p) => [p.lon, p.lat]);
          const f = coords[0];
          const l = coords[coords.length - 1];
          if (f[0] !== l[0] || f[1] !== l[1]) coords.push([f[0], f[1]]);
          outerRings.push(coords);
        }
      }
      if (outerRings.length === 1) {
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [outerRings[0]] },
          properties: props,
        });
      } else if (outerRings.length > 1) {
        features.push({
          type: "Feature",
          geometry: { type: "MultiPolygon", coordinates: outerRings.map((r) => [r]) },
          properties: props,
        });
      }
    }
  }

  // Haversine filter: only areas whose centroid lies within the search circle
  return features.filter((f) => {
    const g = f.geometry;
    let cLng, cLat;
    if (g.type === "Polygon") {
      [cLng, cLat] = polygonCentroid(g.coordinates);
    } else if (g.type === "MultiPolygon") {
      [cLng, cLat] = polygonCentroid(g.coordinates[0]);
    } else {
      return false;
    }
    return haversineKm(lat, lng, cLat, cLng) <= radiusKm * 0.9;
  });
}
