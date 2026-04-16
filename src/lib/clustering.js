// ── Haversine distance between two {lat, lng} points ──────────────────────
export function haversineDistance(p1, p2) {
  const R = 6371000; // Earth radius in meters
  const φ1 = p1.lat * Math.PI / 180;
  const φ2 = p2.lat * Math.PI / 180;
  const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
  const Δλ = (p2.lng - p1.lng) * Math.PI / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Grid-based spatial index ───────────────────────────────────────────────
// Cell size equals epsMeters so only 3×3 neighborhood needs checking.
function buildGrid(points, cellSizeMeters) {
  // Approximate degrees per meter at the dataset's mean latitude
  const meanLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos(meanLat * Math.PI / 180);

  const latStep = cellSizeMeters / mPerLat;
  const lngStep = cellSizeMeters / mPerLng;

  const grid = new Map();
  for (let i = 0; i < points.length; i++) {
    const cx = Math.floor(points[i].lng / lngStep);
    const cy = Math.floor(points[i].lat / latStep);
    const key = `${cx},${cy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }

  function neighbors(idx) {
    const cx = Math.floor(points[idx].lng / lngStep);
    const cy = Math.floor(points[idx].lat / latStep);
    const result = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = grid.get(`${cx + dx},${cy + dy}`);
        if (cell) result.push(...cell);
      }
    }
    return result;
  }

  return neighbors;
}

// ── DBSCAN ─────────────────────────────────────────────────────────────────
const UNVISITED = 0;
const NOISE     = -1;

export function clusterBuildings(points, epsMeters = 100, minPoints = 5) {
  if (points.length === 0) return [];

  const getNeighbors = buildGrid(points, epsMeters);
  const labels = new Int32Array(points.length); // 0 = UNVISITED, -1 = NOISE, >0 = cluster id
  let clusterId = 0;

  for (let i = 0; i < points.length; i++) {
    if (labels[i] !== UNVISITED) continue;

    const candidates = getNeighbors(i).filter(
      (j) => haversineDistance(points[i], points[j]) <= epsMeters
    );

    if (candidates.length < minPoints) {
      labels[i] = NOISE;
      continue;
    }

    clusterId++;
    labels[i] = clusterId;

    // Expand cluster — use a queue to avoid deep recursion on large datasets
    const queue = candidates.filter((j) => j !== i);
    for (let q = 0; q < queue.length; q++) {
      const j = queue[q];
      if (labels[j] === NOISE) {
        labels[j] = clusterId; // border point — add to cluster but don't expand
        continue;
      }
      if (labels[j] !== UNVISITED) continue;
      labels[j] = clusterId;

      const jNeighbors = getNeighbors(j).filter(
        (k) => haversineDistance(points[j], points[k]) <= epsMeters
      );
      if (jNeighbors.length >= minPoints) {
        for (const k of jNeighbors) {
          if (labels[k] === UNVISITED || labels[k] === NOISE) queue.push(k);
        }
      }
    }
  }

  // ── Aggregate clusters into output objects ─────────────────────────────
  const buckets = new Map(); // clusterId → [point indices]
  for (let i = 0; i < points.length; i++) {
    const id = labels[i];
    if (id <= 0) continue; // skip noise
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(i);
  }

  const clusters = [];
  for (const [, indices] of buckets) {
    const n = indices.length;
    const centroid = {
      lat: indices.reduce((s, i) => s + points[i].lat, 0) / n,
      lng: indices.reduce((s, i) => s + points[i].lng, 0) / n,
    };
    const radiusMeters = indices.reduce(
      (max, i) => Math.max(max, haversineDistance(centroid, points[i])),
      0
    );
    clusters.push({ centroid, pointCount: n, radiusMeters });
  }

  console.log(
    `[clustering] ${points.length} points → ${clusters.length} clusters ` +
    `(eps=${epsMeters}m, minPts=${minPoints})`
  );

  return clusters;
}
