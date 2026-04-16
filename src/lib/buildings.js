import { radiusToBbox, raceEndpoints } from "./overpass.js";

// ── Fetch building centroids via Overpass API ──────────────────────────────
export async function fetchBuildingCentroids(center, radiusKm, signal) {
  const [lng, lat] = center;
  const { s, w, n, e } = radiusToBbox(lat, lng, radiusKm);
  const bbox = `${s},${w},${n},${e}`;

  // Only ways: they carry the actual building footprints.
  // Nodes with building=* are mostly entrances/addresses; relations are rare.
  // `out center qt` (quad-tile sort) is faster to process server-side.
  const query =
    `[out:json][timeout:25][bbox:${bbox}];` +
    `way["building"];` +
    `out center qt;`;

  console.log(`[buildings] Querying buildings in ${radiusKm}km radius around ${lat.toFixed(4)},${lng.toFixed(4)}`);

  // Building queries are heavier — use 60s timeout
  const data = await raceEndpoints(query, signal, 60000);
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
