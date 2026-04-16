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

// ── Convex Hull (Graham Scan) ──────────────────────────────────────────────
// Returns a CCW-ordered array of {lat, lng} forming the convex hull.
function convexHull(pts) {
  if (pts.length <= 2) return [...pts];

  // Pivot: southernmost point (lowest lat), break ties by westernmost lng
  let pi = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].lat < pts[pi].lat || (pts[i].lat === pts[pi].lat && pts[i].lng < pts[pi].lng)) {
      pi = i;
    }
  }
  const pivot = pts[pi];

  // Sort by polar angle from pivot; for collinear points, keep farthest last
  const rest = pts
    .filter((_, i) => i !== pi)
    .sort((a, b) => {
      const cross =
        (a.lng - pivot.lng) * (b.lat - pivot.lat) -
        (a.lat - pivot.lat) * (b.lng - pivot.lng);
      if (Math.abs(cross) > 1e-14) return cross > 0 ? -1 : 1;
      const da = (a.lat - pivot.lat) ** 2 + (a.lng - pivot.lng) ** 2;
      const db = (b.lat - pivot.lat) ** 2 + (b.lng - pivot.lng) ** 2;
      return da - db; // collinear: closer first → farthest survives hull
    });

  const hull = [pivot, rest[0]];
  for (let i = 1; i < rest.length; i++) {
    while (hull.length >= 2) {
      const o = hull[hull.length - 2];
      const a = hull[hull.length - 1];
      const p = rest[i];
      // Negative or zero cross product = right turn or collinear → pop
      const cross =
        (a.lng - o.lng) * (p.lat - o.lat) -
        (a.lat - o.lat) * (p.lng - o.lng);
      if (cross <= 0) hull.pop();
      else break;
    }
    hull.push(rest[i]);
  }

  return hull;
}

// ── Point-in-convex-polygon (ray casting) ─────────────────────────────────
function pointInHull(p, hull) {
  let inside = false;
  const n = hull.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = hull[i].lng, yi = hull[i].lat;
    const xj = hull[j].lng, yj = hull[j].lat;
    if (
      (yi > p.lat) !== (yj > p.lat) &&
      p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Cluster overlap check ──────────────────────────────────────────────────
// Cheap bounding-circle pre-filter, then vertex-in-hull for accuracy.
function hullsOverlap(c1, c2) {
  if (haversineDistance(c1.centroid, c2.centroid) > c1.radiusMeters + c2.radiusMeters) {
    return false;
  }
  return (
    c1.hull.some((p) => pointInHull(p, c2.hull)) ||
    c2.hull.some((p) => pointInHull(p, c1.hull))
  );
}

// ── Build a single cluster object from a set of points ────────────────────
function buildCluster(pts) {
  const n = pts.length;
  const centroid = {
    lat: pts.reduce((s, p) => s + p.lat, 0) / n,
    lng: pts.reduce((s, p) => s + p.lng, 0) / n,
  };
  const radiusMeters = pts.reduce(
    (max, p) => Math.max(max, haversineDistance(centroid, p)),
    0
  );
  const hull = convexHull(pts);
  return { centroid, pointCount: n, radiusMeters, hull, _pts: pts };
}

// ── Merge overlapping clusters until stable ────────────────────────────────
// O(n²) per pass, but n (cluster count) is typically small.
function mergeOverlapping(clusters) {
  let anyMerge = true;
  while (anyMerge) {
    anyMerge = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (hullsOverlap(clusters[i], clusters[j])) {
          clusters[i] = buildCluster([...clusters[i]._pts, ...clusters[j]._pts]);
          clusters.splice(j, 1);
          anyMerge = true;
          break outer;
        }
      }
    }
  }
  return clusters;
}

// ── Grid-based spatial index ───────────────────────────────────────────────
function buildGrid(points, cellSizeMeters) {
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

  return function neighbors(idx) {
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
  };
}

// ── DBSCAN ─────────────────────────────────────────────────────────────────
const UNVISITED = 0;
const NOISE = -1;

export function clusterBuildings(points, epsMeters = 100, minPoints = 5) {
  if (points.length === 0) return [];

  const getNeighbors = buildGrid(points, epsMeters);
  const labels = new Int32Array(points.length);
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

    const queue = candidates.filter((j) => j !== i);
    for (let q = 0; q < queue.length; q++) {
      const j = queue[q];
      if (labels[j] === NOISE) { labels[j] = clusterId; continue; }
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

  // ── Collect cluster member points ────────────────────────────────────
  const buckets = new Map();
  for (let i = 0; i < points.length; i++) {
    const id = labels[i];
    if (id <= 0) continue;
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(points[i]);
  }

  // ── Build cluster objects with convex hulls ───────────────────────────
  let clusters = [];
  for (const [, pts] of buckets) {
    clusters.push(buildCluster(pts));
  }

  // ── Merge overlapping hulls ───────────────────────────────────────────
  const beforeMerge = clusters.length;
  clusters = mergeOverlapping(clusters);

  console.log(
    `[clustering] ${points.length} pts → ${beforeMerge} clusters → ` +
    `${clusters.length} after merge (eps=${epsMeters}m, minPts=${minPoints})`
  );

  // Strip internal _pts before returning
  return clusters.map(({ centroid, pointCount, radiusMeters, hull }) => ({
    centroid,
    pointCount,
    radiusMeters,
    hull,
  }));
}
