import { radiusToBbox } from "./overpass.js";

// ── KML GeoZone parser (DFS / OpenAIP / UAS-Geozonen KML) ─────────────────
// Browser-only: uses window.DOMParser. Extracts each Placemark into a GeoJSON
// Feature and classifies it into a semantic zoneType so downstream filters
// can keep only what actually restricts Open-Category FPV flight.

const FT_TO_M = 0.3048;

// ── Altitude parsing ───────────────────────────────────────────────────────
// Accepts the shapes that appear in German UAS-KML: "GND", "SFC", "FL100",
// "1000 FT GND", "500 M AGL", plain numbers. Reference datum (AGL/MSL) is
// dropped — the filter is coarse enough that terrain elevation doesn't flip
// decisions in practice.
function parseAltitude(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  if (s === "" || s === "GND" || s === "SFC" || s === "0") return 0;
  const fl = s.match(/^FL\s*0*(\d+)/);
  if (fl) return parseInt(fl[1], 10) * 100 * FT_TO_M;
  const num = s.match(/(-?\d+(?:[.,]\d+)?)\s*(FT|F|M|METER|METERS)?/);
  if (!num) return null;
  const val = parseFloat(num[1].replace(",", "."));
  if (!Number.isFinite(val)) return null;
  const unit = (num[2] || "FT").toUpperCase();
  return unit.startsWith("M") ? val : val * FT_TO_M;
}

// ── ExtendedData extraction ────────────────────────────────────────────────
// Covers both <Data name="X"><value>...</value></Data> and
// <SchemaData><SimpleData name="X">...</SimpleData></SchemaData>.
function extractExtendedData(placemark) {
  const out = {};
  const dataNodes = placemark.getElementsByTagName("Data");
  for (let i = 0; i < dataNodes.length; i++) {
    const node = dataNodes[i];
    const key = node.getAttribute("name");
    if (!key) continue;
    const valueEl = node.getElementsByTagName("value")[0];
    out[key] = valueEl ? (valueEl.textContent || "").trim() : "";
  }
  const simpleNodes = placemark.getElementsByTagName("SimpleData");
  for (let i = 0; i < simpleNodes.length; i++) {
    const node = simpleNodes[i];
    const key = node.getAttribute("name");
    if (!key) continue;
    out[key] = (node.textContent || "").trim();
  }
  return out;
}

function parseCoordinateString(text) {
  return (text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const [lng, lat] = tok.split(",").map(parseFloat);
      return [lng, lat];
    })
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
}

// Returns an array of GeoJSON Polygon ring-sets. Each entry is
// [outerRing, ...holes]. Handles <Polygon> and <MultiGeometry><Polygon>.
function extractPolygons(placemark) {
  const polygons = [];
  const polyEls = placemark.getElementsByTagName("Polygon");
  for (let p = 0; p < polyEls.length; p++) {
    const rings = [];
    const outer = polyEls[p].getElementsByTagName("outerBoundaryIs")[0];
    const outerCoords = outer?.getElementsByTagName("coordinates")[0];
    if (outerCoords) {
      const ring = parseCoordinateString(outerCoords.textContent);
      if (ring.length >= 3) rings.push(ring);
    }
    const inners = polyEls[p].getElementsByTagName("innerBoundaryIs");
    for (let i = 0; i < inners.length; i++) {
      const coordsEl = inners[i].getElementsByTagName("coordinates")[0];
      if (!coordsEl) continue;
      const ring = parseCoordinateString(coordsEl.textContent);
      if (ring.length >= 3) rings.push(ring);
    }
    if (rings.length > 0) polygons.push(rings);
  }
  return polygons;
}

// ── Zone classification ────────────────────────────────────────────────────
// Maps the free-form name / type / restriction fields onto a small set of
// semantic labels that the filter can reason about. Order matters: the
// first matching rule wins.
function classifyZone(name, description, ext) {
  const n = (name || "").toUpperCase();
  const d = (description || "").toUpperCase();
  const t = String(ext.Type || ext.type || ext.Classification || ext.classification || "").toUpperCase();
  const r = String(ext.Restriction || ext.restriction || "").toUpperCase();

  if (/\bFIR\b/.test(n) || t === "FIR") return "FIR";
  if (/\bUIR\b/.test(n) || t === "UIR") return "UIR";

  if (/NSG|NATURSCHUTZ|NATURPARK|NATIONALPARK|NATURE.?RESERVE/.test(n) ||
      /NATURSCHUTZ|NATURE.?RESERVE/.test(d)) return "nature";

  if (r.includes("PROHIBIT") || /FLUGVERBOT|NO.?FLY|PROHIBITED/.test(n)) return "prohibited";
  if (r.includes("DANGER") || /\bED-?D\b|GEFAHREN|DANGER/.test(n)) return "danger";
  if (r.includes("RESTRICT") || /\bED-?R\b|FLUGBESCHR|RESTRICTED/.test(n)) return "restricted";

  if (/\bCTR\b/.test(n) || t === "CTR") return "restricted";
  if (/\bATZ\b/.test(n) || t === "ATZ") return "restricted";

  if (/\bREA\b|RECREATION/.test(n) || /\bREA\b/.test(t)) return "REA";
  if (/HOSPITAL|KRANKENHAUS/.test(n)) return "prohibited";
  if (/MODELL?FLUG|MODEL.?FLIGHT/.test(n)) return "info";

  const cls = t.match(/^([A-G])$/) || n.match(/LUFTRAUM\s*([A-G])\b/) || n.match(/CLASS\s*([A-G])\b/);
  if (cls) return "airspace_" + cls[1];

  return "info";
}

// ── Main entry ─────────────────────────────────────────────────────────────
export function parseGeoZoneKML(kmlString) {
  if (typeof DOMParser === "undefined") {
    throw new Error("parseGeoZoneKML requires a browser DOMParser");
  }
  const doc = new DOMParser().parseFromString(kmlString, "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error(`KML parse error: ${err.textContent}`);

  const features = [];
  const placemarks = doc.getElementsByTagName("Placemark");

  for (let i = 0; i < placemarks.length; i++) {
    const pm = placemarks[i];
    const polygons = extractPolygons(pm);
    if (polygons.length === 0) continue;

    const name = pm.getElementsByTagName("name")[0]?.textContent?.trim() || "";
    const description = pm.getElementsByTagName("description")[0]?.textContent?.trim() || "";
    const ext = extractExtendedData(pm);

    const lowerRaw = ext.LowerLimit ?? ext.lowerLimit ?? ext.Lower ?? ext.lower ?? "";
    const upperRaw = ext.UpperLimit ?? ext.upperLimit ?? ext.Upper ?? ext.upper ?? "";
    const restrictionType = ext.Restriction ?? ext.restriction ?? ext.Type ?? ext.type ?? "";
    const timeWindow = ext.TimeWindow ?? ext.timeWindow ?? ext.HoursOfOperation ?? ext.Schedule ?? "";
    const zoneType = classifyZone(name, description, ext);

    const geometry = polygons.length === 1
      ? { type: "Polygon", coordinates: polygons[0] }
      : { type: "MultiPolygon", coordinates: polygons };

    features.push({
      type: "Feature",
      geometry,
      properties: {
        name,
        description,
        restrictionType,
        lowerLimitM: parseAltitude(lowerRaw),
        upperLimitM: parseAltitude(upperRaw),
        zoneType,
        timeWindow,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

// ── Filter: keep only zones that restrict Open-Category FPV flight ─────────
// Drops pure information layers (FIR/UIR, Class E/F/G above 120m, generic
// info zones) and zones whose lower limit already sits above the pilot's
// altitude ceiling. A null lower limit is treated as "from ground" — safer
// default than silently allowing an unknown-floor zone to be shown.
const DEFAULT_RELEVANT_TYPES = ["prohibited", "restricted", "danger", "REA", "nature"];

export function filterRelevantZones(features, options = {}) {
  const maxAlt = options.maxAltitudeAGL ?? 120;
  const allowed = new Set(options.zoneTypes ?? DEFAULT_RELEVANT_TYPES);

  return (features ?? []).filter((f) => {
    const p = f?.properties;
    if (!p) return false;
    if (!allowed.has(p.zoneType)) return false;
    if (p.lowerLimitM != null && p.lowerLimitM > maxAlt) return false;
    return true;
  });
}

// ── WFS fetch (speculative — DFS publishes no documented open endpoint) ───
// `utm.dfs.de/mapdata` shows up in some DFS metadata, but there is no public
// WFS capabilities document. This call is therefore best-effort: expect it
// to fail on CORS or 404 in most browsers. Callers must catch the rejection
// and fall back to loadGeoZonesFromFile().
const WFS_URL = "https://utm.dfs.de/mapdata/wfs";
const WFS_TIMEOUT_MS = 8000;

export async function fetchGeoZonesFromWFS(bbox) {
  const { s, w, n, e } = bbox;
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: "geozone",
    // WFS 2.0 + EPSG:4326 convention: lat,lng axis order
    bbox: `${s},${w},${n},${e},EPSG:4326`,
    outputFormat: "application/json",
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WFS_TIMEOUT_MS);
  try {
    const res = await fetch(`${WFS_URL}?${params.toString()}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`WFS HTTP ${res.status}`);
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("json")) {
      const data = await res.json();
      if (data?.type === "FeatureCollection") return data;
      throw new Error("WFS JSON ist keine FeatureCollection");
    }
    if (ct.includes("xml") || ct.includes("kml")) {
      return parseGeoZoneKML(await res.text());
    }
    throw new Error(`WFS: unerwartetes Format (${ct || "unbekannt"})`);
  } finally {
    clearTimeout(timer);
  }
}

// ── File-upload fallback ───────────────────────────────────────────────────
// Takes a File handle from <input type="file">. Handles .kml only — dipul.de
// "Export als KML" gibt plain XML aus; .kmz (ZIP) ist nicht unterstützt.
export async function loadGeoZonesFromFile(file) {
  if (!file) throw new Error("Keine Datei ausgewählt");
  const text = await file.text();
  return parseGeoZoneKML(text);
}

// ── High-level entry: try WFS, escalate to file upload on failure ─────────
// On failure throws an Error with `requiresFileUpload = true` so the UI can
// distinguish "endpoint unavailable, ask the user to upload" from other
// errors (e.g. a malformed WFS response that is worth surfacing as-is).
export async function fetchGeoZones(center, radiusKm) {
  const [lng, lat] = center;
  const bbox = radiusToBbox(lat, lng, radiusKm);
  try {
    return await fetchGeoZonesFromWFS(bbox);
  } catch (cause) {
    const err = new Error("GeoZonen nicht per WFS abrufbar — bitte KML von dipul.de hochladen");
    err.cause = cause;
    err.requiresFileUpload = true;
    throw err;
  }
}
