import { OVERPASS_ENDPOINTS, SPOT_TYPES, ALL_SPOT_TYPE_IDS } from "./constants.js";
import { haversineKm, computeRemoteness, computeFpvScore } from "./scoring.js";
import { fetchBuildingCentroids } from "./buildings.js";
import { clusterBuildings } from "./clustering.js";
import { computeBuildingDistanceScoreBatch } from "./buildingScore.js";

// ── LRU cache: max 50 entries ──────────────────────────────────────────────
const MAX_CACHE = 50;
const spotCache = new Map();

function setCached(key, value) {
  if (spotCache.size >= MAX_CACHE) {
    // Evict the oldest entry (first inserted key)
    spotCache.delete(spotCache.keys().next().value);
  }
  spotCache.set(key, value);
}

// ── Spot classification ────────────────────────────────────────────────────
export function classifySpot(tags) {
  if (!tags) return null;
  if (tags.abandoned === "building") return "bando";
  if (tags.building && tags.abandoned === "yes") return "bando";
  if (tags.building && tags.disused === "yes") return "bando";
  if (tags.building && tags.ruins === "yes") return "bando";
  if (tags.landuse === "quarry") return "quarry";
  if (tags.landuse === "brownfield") return "brownfield";
  if (tags.landuse === "industrial" && (tags.disused === "yes" || tags.abandoned === "yes")) return "brownfield";
  if (tags.bridge === "yes" && tags.highway) return "bridge";
  if (tags.bridge === "yes" && tags.railway) return "bridge";
  if (tags.leisure === "park") return "openspace";
  if (
    tags.landuse === "grass" ||
    tags.landuse === "meadow" ||
    tags.landuse === "recreation_ground"
  ) return "openspace";
  if (tags.leisure === "nature_reserve") return "openspace";
  if (
    tags.natural === "heath" ||
    tags.natural === "grassland" ||
    tags.natural === "scrub"
  ) return "clearing";
  if (tags.natural === "water") return "water";
  if (tags.waterway === "river" || tags.waterway === "canal") return "water";
  if (tags.water === "lake" || tags.water === "reservoir") return "water";
  return null;
}

// ── Bbox from radius ───────────────────────────────────────────────────────
export function radiusToBbox(lat, lng, radiusKm) {
  const dLat = radiusKm / 111.32;
  const dLng = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
  return {
    s: (lat - dLat).toFixed(6),
    w: (lng - dLng).toFixed(6),
    n: (lat + dLat).toFixed(6),
    e: (lng + dLng).toFixed(6),
  };
}

// ── Overpass query definitions ─────────────────────────────────────────────
export const QUERY_LINES = {
  bando:      { group: "A", lines: ['way["building"]["abandoned"="yes"]', 'way["building"]["disused"="yes"]'] },
  quarry:     { group: "A", lines: ['way["landuse"="quarry"]'] },
  brownfield: { group: "A", lines: ['way["landuse"="brownfield"]'] },
  bridge:     { group: "A", lines: ['way["bridge"="yes"]["highway"]', 'way["bridge"="yes"]["railway"]'] },
  openspace:  { group: "B", lines: ['way["leisure"="park"]["name"]', 'way["leisure"="nature_reserve"]["name"]', 'way["landuse"="meadow"]["name"]'] },
  clearing:   { group: "B", lines: ['way["natural"="heath"]', 'way["natural"="grassland"]["name"]'] },
  water:      { group: "B", lines: ['way["natural"="water"]["name"]', 'way["waterway"="river"]["name"]', 'way["waterway"="canal"]["name"]'] },
};

export const PLACE_NODE_LINE =
  'node["place"~"^(city|town|suburb|quarter|neighbourhood|village|hamlet)$"]';

// ── Build Overpass queries ─────────────────────────────────────────────────
export function buildQueries(lat, lng, radiusKm, queryTypes) {
  const { s, w, n, e } = radiusToBbox(lat, lng, radiusKm);
  const bbox = `${s},${w},${n},${e}`;
  const active = queryTypes ?? ALL_SPOT_TYPE_IDS;

  const aLines = active
    .filter((t) => QUERY_LINES[t]?.group === "A")
    .flatMap((t) => QUERY_LINES[t].lines)
    .map((l) => `  ${l};`)
    .join("\n");
  const A = `[out:json][timeout:25][bbox:${bbox}];\n(\n${aLines ? aLines + "\n" : ""}  ${PLACE_NODE_LINE};\n);\nout center tags;`;

  const bLines = active
    .filter((t) => QUERY_LINES[t]?.group === "B")
    .flatMap((t) => QUERY_LINES[t].lines)
    .map((l) => `  ${l};`)
    .join("\n");
  const B = bLines
    ? `[out:json][timeout:25][bbox:${bbox}];\n(\n${bLines}\n);\nout center tags;`
    : null;

  return { A, B, bbox };
}

export function buildTurboUrl(lat, lng, radiusKm, queryTypes) {
  const { A } = buildQueries(lat, lng, radiusKm, queryTypes);
  return `https://overpass-turbo.eu/?Q=${encodeURIComponent(A)}&C=${lat};${lng};10&R`;
}

// ── AbortSignal polyfill (Safari <17, Firefox <124) ───────────────────────
export function combineSignals(signals) {
  const filtered = signals.filter(Boolean);
  if (filtered.length === 0) return new AbortController().signal;
  if (filtered.length === 1) return filtered[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(filtered);
  // Fallback: manual combination
  const ctrl = new AbortController();
  for (const sig of filtered) {
    if (sig.aborted) { ctrl.abort(sig.reason); return ctrl.signal; }
    sig.addEventListener("abort", () => ctrl.abort(sig.reason), { once: true });
  }
  return ctrl.signal;
}

// ── Fetch helpers ──────────────────────────────────────────────────────────
export async function tryFetch(url, query, parentSignal, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const combined = combineSignals([ctrl.signal, parentSignal]);
  try {
    const res = await fetch(url, {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: combined,
    });
    if (res.status === 429) throw new Error("HTTP 429");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const remark = data.remark ?? "";
    if (
      remark.includes("Dispatcher_Client") ||
      remark.includes("timeout") ||
      remark.includes("out of memory")
    ) {
      const e = new Error(`server_busy: ${remark.slice(0, 60)}`);
      e.retryable = true;
      throw e;
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      if (parentSignal?.aborted) throw err;
      const e = new Error(`Timeout (${timeoutMs / 1000}s)`);
      e.retryable = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function raceEndpoints(query, parentSignal, timeoutMs) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (parentSignal?.aborted) throw new DOMException("Aborted", "AbortError");
    const ctrls = OVERPASS_ENDPOINTS.map(() => new AbortController());
    const cancel = (i) => ctrls.forEach((c, j) => { if (j !== i) c.abort(); });
    const attempts = OVERPASS_ENDPOINTS.map((ep, i) => {
      const sig = combineSignals([ctrls[i].signal, parentSignal]);
      return tryFetch(ep, query, sig, timeoutMs)
        .then((data) => { cancel(i); return { data, ep }; })
        .catch((err) => Promise.reject({ err, ep }));
    });
    const results = await Promise.allSettled(attempts);
    const winner = results.find((r) => r.status === "fulfilled");
    if (winner) return winner.value.data;
    const errors = results
      .map((r) => `${r.reason?.ep}:${r.reason?.err?.message}`)
      .join("|");
    if (!results.every((r) => r.reason?.err?.retryable) || attempt === 3) {
      throw new Error(`Alle Server fehlgeschlagen (${attempt}x): ${errors}`);
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
}

// ── Blend OSM fpvScore with building distance and optional CLC ────────────
function blendFpvScore(osmScore, buildingScore, clcScore) {
  if (buildingScore == null) return osmScore;
  if (clcScore != null) {
    return Math.min(100, Math.max(0, Math.round(
      osmScore * 0.4 + buildingScore * 0.4 + clcScore * 0.2,
    )));
  }
  return Math.min(100, Math.max(0, Math.round(osmScore * 0.5 + buildingScore * 0.5)));
}

// ── Main fetch function (spots only — fast path) ───────────────────────────
export async function fetchSpots(center, radiusMinKm, radiusMaxKm, queryTypes, signal) {
  const [lng, lat] = center;
  const typeKey = [...queryTypes].sort().join(",");
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)},${radiusMinKm},${radiusMaxKm},${typeKey}`;

  if (spotCache.has(cacheKey)) return spotCache.get(cacheKey);

  const { A: qA, B: qB } = buildQueries(lat, lng, radiusMaxKm, queryTypes);
  const turboUrl = buildTurboUrl(lat, lng, radiusMaxKm, queryTypes);

  const [resultA, resultB] = await Promise.all([
    raceEndpoints(qA, signal),
    qB ? raceEndpoints(qB, signal) : Promise.resolve({ elements: [] }),
  ]);

  const all = [...(resultA.elements || []), ...(resultB.elements || [])];
  const placeNodes = all.filter((el) => el.type === "node" && el.tags?.place);
  const spotEls = all.filter((el) => !(el.type === "node" && el.tags?.place));
  const rawCount = spotEls.length;

  const features = [];
  const typeCounters = {};
  SPOT_TYPES.forEach((st) => (typeCounters[st.id] = 0));

  for (const el of spotEls) {
    const spotType = classifySpot(el.tags);
    if (!spotType) continue;
    if ((typeCounters[spotType] || 0) >= 150) continue;

    let coordinates;
    if (el.center?.lat != null) coordinates = [el.center.lon, el.center.lat];
    else if (el.lat != null) coordinates = [el.lon, el.lat];
    else continue;

    const distKm = haversineKm(lat, lng, coordinates[1], coordinates[0]);
    if (distKm > radiusMaxKm || distKm < radiusMinKm) continue;

    typeCounters[spotType]++;
    const score = computeRemoteness(el.tags, spotType, placeNodes, coordinates);
    const fpvResult = computeFpvScore({ properties: { score, spotType, tags: el.tags } });

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates },
      properties: {
        id: el.id,
        osmType: el.type,
        spotType,
        score,
        fpvScore: fpvResult.total,
        fpvBreakdown: fpvResult,
        buildingScore: null,
        name: el.tags?.name || el.tags?.["name:de"] || null,
        tags: el.tags,
      },
    });
  }

  const result = { features, rawCount, remark: null, turboUrl };
  setCached(cacheKey, result);
  return result;
}

// ── Building cluster fetch (slow path — call after fetchSpots returns) ─────
const buildingCache = new Map();

export async function fetchBuildingClusters(center, radiusMinKm, radiusMaxKm, signal) {
  const [lng, lat] = center;
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)},${radiusMinKm},${radiusMaxKm}`;
  if (buildingCache.has(cacheKey)) return buildingCache.get(cacheKey);

  const rawPoints = await fetchBuildingCentroids(center, radiusMaxKm, signal);

  // Clip bbox over-fetch to the actual search donut
  const buildingPoints = rawPoints.filter((p) => {
    const d = haversineKm(lat, lng, p.lat, p.lng);
    return d <= radiusMaxKm && d >= radiusMinKm;
  });
  const buildingCount = buildingPoints.length;
  const clusters = buildingCount > 0 ? clusterBuildings(buildingPoints) : [];

  const result = { buildingCount, clusters };
  if (buildingCache.size >= MAX_CACHE) buildingCache.delete(buildingCache.keys().next().value);
  buildingCache.set(cacheKey, result);
  return result;
}

// ── Apply building scores to an existing features array ───────────────────
// Returns a new array — does not mutate the originals.
export function applyBuildingScores(features, clusters) {
  if (!clusters.length) return features;
  const spotCoords = features.map((f) => ({
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
  }));
  const bScores = computeBuildingDistanceScoreBatch(spotCoords, clusters);
  return features.map((f, i) => {
    const p = f.properties;
    const { score: bScore, distM } = bScores[i];
    return {
      ...f,
      properties: {
        ...p,
        buildingScore: bScore,
        nearestClusterDistanceM: distM,
        fpvScore: blendFpvScore(p.fpvBreakdown.total, bScore, p.clcScore ?? null),
      },
    };
  });
}
