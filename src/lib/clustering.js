// ── Haversine distance between two {lat, lng} points ──────────────────────
export function haversineDistance(p1, p2) {
  const R = 6371000;
  const φ1 = p1.lat * Math.PI / 180;
  const φ2 = p2.lat * Math.PI / 180;
  const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
  const Δλ = (p2.lng - p1.lng) * Math.PI / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Local coordinate projection (lat/lng ↔ meters) ────────────────────────
function makeProjection(pts) {
  const cx = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const cLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos(cx * Math.PI / 180);
  return {
    toXY(p) { return { x: (p.lng - cLng) * mPerLng, y: (p.lat - cx) * mPerLat }; },
    fromXY(p) { return { lat: cx + p.y / mPerLat, lng: cLng + p.x / mPerLng }; },
  };
}

// ── Circumradius of a 2D triangle (meters) ────────────────────────────────
function circumradiusXY(a, b, c) {
  const D = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(D) < 1e-8) return Infinity;
  const ux =
    ((a.x * a.x + a.y * a.y) * (b.y - c.y) +
     (b.x * b.x + b.y * b.y) * (c.y - a.y) +
     (c.x * c.x + c.y * c.y) * (a.y - b.y)) / D;
  const uy =
    ((a.x * a.x + a.y * a.y) * (c.x - b.x) +
     (b.x * b.x + b.y * b.y) * (a.x - c.x) +
     (c.x * c.x + c.y * c.y) * (b.x - a.x)) / D;
  return Math.sqrt((a.x - ux) ** 2 + (a.y - uy) ** 2);
}

// ── In-circumcircle test for a CCW triangle ───────────────────────────────
// Returns true if d is strictly inside the circumcircle of CCW triangle (a, b, c).
function inCircumcircle(a, b, c, d) {
  const ax = a.x - d.x, ay = a.y - d.y;
  const bx = b.x - d.x, by = b.y - d.y;
  const cx = c.x - d.x, cy = c.y - d.y;
  return (
    (ax * ax + ay * ay) * (bx * cy - cx * by) -
    (bx * bx + by * by) * (ax * cy - cx * ay) +
    (cx * cx + cy * cy) * (ax * by - bx * ay)
  ) > 0;
}

// ── Bowyer-Watson incremental Delaunay triangulation ──────────────────────
// Input: pts array of {x, y}. Returns array of [i,j,k] CCW triangle indices.
function delaunay2D(pts) {
  const n = pts.length;
  if (n < 3) return [];

  let minX = pts[0].x, maxX = pts[0].x, minY = pts[0].y, maxY = pts[0].y;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const span = Math.max(maxX - minX, maxY - minY) * 20 + 1;
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  const S = n;

  // Super-triangle is CCW: top, bottom-left, bottom-right
  const allPts = [
    ...pts,
    { x: mx,        y: my + span * 2 },
    { x: mx - span, y: my - span     },
    { x: mx + span, y: my - span     },
  ];

  let tris = [[S, S + 1, S + 2]];

  for (let pi = 0; pi < n; pi++) {
    const p = allPts[pi];
    const bad = [], good = [];

    for (const t of tris) {
      if (inCircumcircle(allPts[t[0]], allPts[t[1]], allPts[t[2]], p)) {
        bad.push(t);
      } else {
        good.push(t);
      }
    }

    // Boundary edges: directed edges in exactly one bad triangle
    const edgeCnt = new Map();
    for (const t of bad) {
      for (let e = 0; e < 3; e++) {
        const a = t[e], b = t[(e + 1) % 3];
        const key = `${a}_${b}`;
        edgeCnt.set(key, (edgeCnt.get(key) ?? 0) + 1);
      }
    }

    tris = good;
    for (const [key, cnt] of edgeCnt) {
      if (cnt !== 1) continue;
      const us = key.indexOf('_');
      const a = parseInt(key.slice(0, us), 10);
      const b = parseInt(key.slice(us + 1), 10);
      const ptA = allPts[a], ptB = allPts[b];
      // Ensure CCW: if p is to the right of edge a→b, swap to [b, a, pi]
      const cross = (ptB.x - ptA.x) * (p.y - ptA.y) - (ptB.y - ptA.y) * (p.x - ptA.x);
      tris.push(cross >= 0 ? [a, b, pi] : [b, a, pi]);
    }
  }

  return tris.filter(t => t[0] < S && t[1] < S && t[2] < S);
}

// ── Convex hull in XY space (Graham Scan) ─────────────────────────────────
function convexHullXY(pts) {
  if (pts.length <= 2) return [...pts];
  let pi = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].y < pts[pi].y || (pts[i].y === pts[pi].y && pts[i].x < pts[pi].x)) pi = i;
  }
  const pivot = pts[pi];
  const rest = pts.filter((_, i) => i !== pi).sort((a, b) => {
    const cross = (a.x - pivot.x) * (b.y - pivot.y) - (a.y - pivot.y) * (b.x - pivot.x);
    if (Math.abs(cross) > 1e-14) return cross > 0 ? -1 : 1;
    const da = (a.x - pivot.x) ** 2 + (a.y - pivot.y) ** 2;
    const db = (b.x - pivot.x) ** 2 + (b.y - pivot.y) ** 2;
    return da - db;
  });
  const hull = [pivot, rest[0]];
  for (let i = 1; i < rest.length; i++) {
    while (hull.length >= 2) {
      const o = hull[hull.length - 2], a = hull[hull.length - 1], p = rest[i];
      const cross = (a.x - o.x) * (p.y - o.y) - (a.y - o.y) * (p.x - o.x);
      if (cross <= 0) hull.pop();
      else break;
    }
    hull.push(rest[i]);
  }
  return hull;
}

// ── Alpha shape: extract concave boundary from Delaunay triangulation ─────
// Returns array of {x, y} polygon vertices (largest connected component),
// or null if no alpha triangles exist.
function extractAlphaShape(xy, tris, alphaMeters) {
  const alphaTris = tris.filter(
    t => circumradiusXY(xy[t[0]], xy[t[1]], xy[t[2]]) <= alphaMeters
  );
  if (alphaTris.length === 0) return null;

  // Directed edges present in alpha triangles
  const dirEdges = new Set();
  for (const t of alphaTris) {
    for (let e = 0; e < 3; e++) {
      dirEdges.add(`${t[e]}_${t[(e + 1) % 3]}`);
    }
  }

  // Boundary: directed edges whose reverse is absent
  const boundaryFwd = new Map(); // a → b
  for (const t of alphaTris) {
    for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3];
      if (!dirEdges.has(`${b}_${a}`)) {
        boundaryFwd.set(a, b);
      }
    }
  }
  if (boundaryFwd.size === 0) return null;

  // Walk all connected components, keep largest
  const visited = new Set();
  let best = [];

  for (const [start] of boundaryFwd) {
    if (visited.has(start)) continue;
    const comp = [];
    let cur = start;
    while (!visited.has(cur) && boundaryFwd.has(cur)) {
      visited.add(cur);
      comp.push(cur);
      cur = boundaryFwd.get(cur);
    }
    if (comp.length > best.length) best = comp;
  }

  return best.length >= 3 ? best.map(i => xy[i]) : null;
}

// ── Chaikin corner-cutting smoothing ─────────────────────────────────────
function chaikinSmooth(pts, iterations = 2) {
  let p = pts;
  for (let iter = 0; iter < iterations; iter++) {
    const n = p.length;
    const s = [];
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      s.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
      s.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
    }
    p = s;
  }
  return p;
}

// ── Subsample large point sets while preserving angular coverage ──────────
// Sorts by angle from centroid so all directions are represented.
function subsample(pts, maxPts) {
  if (pts.length <= maxPts) return pts;
  const cx = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const cLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  const sorted = [...pts].sort(
    (a, b) =>
      Math.atan2(a.lat - cx, a.lng - cLng) -
      Math.atan2(b.lat - cx, b.lng - cLng)
  );
  const stride = Math.ceil(sorted.length / maxPts);
  return sorted.filter((_, i) => i % stride === 0);
}

// ── Build zone hull: alpha shape + Chaikin smooth, fallback to convex hull ─
const ALPHA_METERS = 100;
const SMOOTH_ITERATIONS = 2;
const MAX_DELAUNAY_PTS = 300;

function buildZoneHull(pts) {
  if (pts.length < 3) return pts;

  const sample = subsample(pts, MAX_DELAUNAY_PTS);
  const proj = makeProjection(sample);
  const xy = sample.map(p => proj.toXY(p));

  const tris = delaunay2D(xy);
  const alphaPts = extractAlphaShape(xy, tris, ALPHA_METERS);
  const baseXY = alphaPts ?? convexHullXY(xy);

  if (baseXY.length < 3) return pts.slice(0, 3);

  const smoothed = chaikinSmooth(baseXY, SMOOTH_ITERATIONS);
  return smoothed.map(p => proj.fromXY(p));
}

// ── Point-in-polygon (ray casting, works for any simple polygon) ──────────
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
function hullsOverlap(c1, c2) {
  if (haversineDistance(c1.centroid, c2.centroid) > c1.radiusMeters + c2.radiusMeters) {
    return false;
  }
  return (
    c1.hull.some((p) => pointInHull(p, c2.hull)) ||
    c2.hull.some((p) => pointInHull(p, c1.hull))
  );
}

// ── Build a single cluster object ─────────────────────────────────────────
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
  const hull = buildZoneHull(pts);
  return { centroid, pointCount: n, radiusMeters, hull, _pts: pts };
}

// ── Merge overlapping clusters until stable ────────────────────────────────
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

  const buckets = new Map();
  for (let i = 0; i < points.length; i++) {
    const id = labels[i];
    if (id <= 0) continue;
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(points[i]);
  }

  let clusters = [];
  for (const [, pts] of buckets) {
    clusters.push(buildCluster(pts));
  }

  const beforeMerge = clusters.length;
  clusters = mergeOverlapping(clusters);

  console.log(
    `[clustering] ${points.length} pts → ${beforeMerge} clusters → ` +
    `${clusters.length} after merge (eps=${epsMeters}m, minPts=${minPoints})`
  );

  return clusters.map(({ centroid, pointCount, radiusMeters, hull }) => ({
    centroid,
    pointCount,
    radiusMeters,
    hull,
  }));
}
