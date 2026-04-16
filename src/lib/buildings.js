import { OVERPASS_ENDPOINTS } from "./constants.js";
import { radiusToBbox, combineSignals } from "./overpass.js";

// ── Fetch building centroids via Overpass API ──────────────────────────────
export async function fetchBuildingCentroids(center, radiusKm, signal) {
  const [lng, lat] = center;
  const { s, w, n, e } = radiusToBbox(lat, lng, radiusKm);
  const bbox = `${s},${w},${n},${e}`;

  const query =
    `[out:json][timeout:60][bbox:${bbox}];` +
    `(node["building"];way["building"];relation["building"];);` +
    `out center;`;

  console.log(`[buildings] Querying buildings in ${radiusKm}km radius around ${lat.toFixed(4)},${lng.toFixed(4)}`);

  const data = await raceEndpoints(query, signal);
  const elements = data.elements ?? [];

  const centroids = [];
  for (const el of elements) {
    if (el.center?.lat != null) {
      centroids.push({ lat: el.center.lat, lng: el.center.lon });
    } else if (el.lat != null) {
      centroids.push({ lat: el.lat, lng: el.lon });
    }
  }

  console.log(`[buildings] Found ${centroids.length} building centroids (${elements.length} raw elements)`);
  return centroids;
}

// ── Endpoint racing (60s timeout per request) ──────────────────────────────
async function tryFetch(url, query, parentSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
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
      const e = new Error("Timeout (60s)");
      e.retryable = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function raceEndpoints(query, parentSignal) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (parentSignal?.aborted) throw new DOMException("Aborted", "AbortError");
    const ctrls = OVERPASS_ENDPOINTS.map(() => new AbortController());
    const cancel = (i) => ctrls.forEach((c, j) => { if (j !== i) c.abort(); });
    const attempts = OVERPASS_ENDPOINTS.map((ep, i) => {
      const sig = combineSignals([ctrls[i].signal, parentSignal]);
      return tryFetch(ep, query, sig)
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
