// ── dipul WMS client ───────────────────────────────────────────────────────
// Offizielle Quelle: https://uas-betrieb.de/geoservices/dipul/wms
// Ersetzt langfristig die KML-Logik in geozones.js; letztere bleibt als
// Fallback bestehen solange CORS-Probleme auftreten können.

const WMS_BASE = "https://uas-betrieb.de/geoservices/dipul/wms";
const WMS_TIMEOUT_MS = 10_000;

// ── Modul-scoped cache ─────────────────────────────────────────────────────
let capabilitiesCache = null;
export let corsBlocked = false;

// ── DIPUL_LAYERS ───────────────────────────────────────────────────────────
// Initiale Zuordnung — nach GetCapabilities-Aufruf werden alle Layer in der
// Konsole geloggt. Passe die Namen danach hier an.
export const DIPUL_LAYERS = {
  relevant: [
    "dipul:kontrollzonen",
    "dipul:flugbeschraenkungsgebiete",
    "dipul:naturschutzgebiete",
    "dipul:landesrechtliche_gebiete",
  ],
  irrelevant: [
    "dipul:informationsgebiete",
    "dipul:fir",
    "dipul:uir",
  ],
};

// ── Hilfsfunktion: fetch mit Timeout und CORS-Erkennung ───────────────────
async function wmsGet(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WMS_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`WMS HTTP ${res.status}: ${res.statusText}`);
    return res;
  } catch (err) {
    if (
      err.name === "TypeError" ||          // Network error / CORS block
      err.message?.toLowerCase().includes("network") ||
      err.message?.toLowerCase().includes("failed to fetch")
    ) {
      corsBlocked = true;
      throw new Error(
        "WMS-Zugriff blockiert (CORS). Ggf. Proxy nötig oder KML-Import als Fallback."
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── 1. GetCapabilities ─────────────────────────────────────────────────────
export async function fetchWmsCapabilities() {
  if (capabilitiesCache) return capabilitiesCache;

  const url =
    `${WMS_BASE}?service=WMS&version=1.3.0&request=GetCapabilities`;

  const res = await wmsGet(url);
  const xml = await res.text();
  const doc = new DOMParser().parseFromString(xml, "application/xml");

  const parseErr = doc.querySelector("parsererror");
  if (parseErr) {
    throw new Error(`GetCapabilities XML-Fehler: ${parseErr.textContent}`);
  }

  const layers = [];
  const layerEls = doc.querySelectorAll("Layer > Layer");

  for (const el of layerEls) {
    const name = el.querySelector(":scope > Name")?.textContent?.trim() ?? "";
    const title = el.querySelector(":scope > Title")?.textContent?.trim() ?? "";
    const queryableAttr = el.getAttribute("queryable");
    const queryable = queryableAttr === "1" || queryableAttr === "true";
    if (name) layers.push({ name, title, queryable });
  }

  // Alle verfügbaren Layer loggen — wichtig für die initiale DIPUL_LAYERS-Konfiguration
  console.group("[dipulWms] Verfügbare WMS-Layer");
  layers.forEach((l) =>
    console.log(`  ${l.name}  →  "${l.title}"  (queryable: ${l.queryable})`)
  );
  console.groupEnd();

  capabilitiesCache = layers;
  return layers;
}

// ── 2. GetMap URL ──────────────────────────────────────────────────────────
export function buildGetMapUrl({
  bbox,
  width,
  height,
  layers,
  srs = "EPSG:4326",
  format = "image/png",
  transparent = true,
}) {
  // bbox kann ein Array [minLng,minLat,maxLng,maxLat] oder ein roher String sein
  // (z.B. der MapLibre-Platzhalter "{bbox-epsg-3857}").
  let bboxParam;
  if (typeof bbox === "string") {
    bboxParam = bbox;
  } else {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    // WMS 1.3.0 + EPSG:4326: Achsenreihenfolge ist lat,lng (nicht lng,lat)
    bboxParam =
      srs === "EPSG:4326"
        ? `${minLat},${minLng},${maxLat},${maxLng}`
        : `${minLng},${minLat},${maxLng},${maxLat}`;
  }

  const params = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetMap",
    layers,
    styles: "",
    crs: srs,
    width: String(width),
    height: String(height),
    format,
    transparent: transparent ? "TRUE" : "FALSE",
  });

  // bbox must NOT go through URLSearchParams — it would encode "{bbox-epsg-3857}"
  // to "%7Bbbox-epsg-3857%7D", which MapLibre can no longer find and replace.
  return `${WMS_BASE}?${params.toString()}&bbox=${bboxParam}`;
}

// ── 3. GetFeatureInfo ──────────────────────────────────────────────────────
export async function fetchFeatureInfo({
  lat,
  lng,
  layers,
  infoFormat = "application/json",
}) {
  const buf = 0.01; // ~1 km Puffer
  const minLng = lng - buf;
  const maxLng = lng + buf;
  const minLat = lat - buf;
  const maxLat = lat + buf;

  const W = 101;
  const H = 101;
  const I = 50;
  const J = 50;

  // EPSG:4326 → bbox als lat,lng
  const bboxParam = `${minLat},${minLng},${maxLat},${maxLng}`;

  const layerStr = Array.isArray(layers) ? layers.join(",") : layers;

  const params = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetFeatureInfo",
    layers: layerStr,
    query_layers: layerStr,
    styles: "",
    crs: "EPSG:4326",
    bbox: bboxParam,
    width: String(W),
    height: String(H),
    format: "image/png",
    info_format: infoFormat,
    i: String(I),
    j: String(J),
  });

  let res;
  try {
    res = await wmsGet(`${WMS_BASE}?${params.toString()}`);
  } catch (err) {
    // JSON-Format evtl. nicht unterstützt → Fallback auf text/html
    if (infoFormat !== "text/html") {
      return fetchFeatureInfo({ lat, lng, layers, infoFormat: "text/html" });
    }
    throw err;
  }

  const ct = (res.headers.get("content-type") || "").toLowerCase();

  if (ct.includes("json")) {
    const data = await res.json();
    return _parseJsonFeatureInfo(data);
  }

  // HTML / Text-Fallback
  const text = await res.text();
  return _parseHtmlFeatureInfo(text, layerStr);
}

function _parseJsonFeatureInfo(data) {
  if (!data?.features?.length) return [];
  return data.features.map((f) => ({
    layerName: f.id?.split(".")[0] ?? "",
    properties: f.properties ?? {},
  }));
}

function _parseHtmlFeatureInfo(html, layerStr) {
  if (!html?.trim()) return [];

  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = doc.querySelectorAll("tr");
  const props = {};

  for (const row of rows) {
    const cells = row.querySelectorAll("td, th");
    if (cells.length >= 2) {
      const key = cells[0].textContent.trim();
      const val = cells[1].textContent.trim();
      if (key) props[key] = val;
    }
  }

  if (!Object.keys(props).length) {
    // Kein strukturierter Inhalt — Rohtext zurückgeben
    const bodyText = doc.body?.textContent?.trim() ?? "";
    if (bodyText) props["_raw"] = bodyText;
  }

  if (!Object.keys(props).length) return [];

  return [{ layerName: layerStr, properties: props }];
}
