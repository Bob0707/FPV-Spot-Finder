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

// ── Polygon area (signed) for 2D points, CCW positive ────────────────────
function polygonArea2D(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

// ── Alpha shape: extract concave boundary from Delaunay triangulation ─────
// Returns array of XY rings (all CCW outer loops). CW loops are holes —
// discarded here so each cluster renders as a solid filled region. Returns
// empty array if no alpha triangles exist. Uses angular edge pairing at
// each vertex so pinch points decompose into disjoint simple loops instead
// of self-intersecting tangles.
function extractAlphaShape(xy, tris, alphaMeters) {
  const alphaTris = tris.filter(
    t => circumradiusXY(xy[t[0]], xy[t[1]], xy[t[2]]) <= alphaMeters
  );
  if (alphaTris.length === 0) return [];

  // Directed edges present in alpha triangles
  const dirEdges = new Set();
  for (const t of alphaTris) {
    for (let e = 0; e < 3; e++) {
      dirEdges.add(`${t[e]}_${t[(e + 1) % 3]}`);
    }
  }

  // Boundary = directed edge with no reverse twin. Group outgoing edges by
  // vertex and sort by angle — needed for the rotational pairing below.
  const outs = new Map(); // a → array of {to, angle, used}
  let edgeCount = 0;
  for (const t of alphaTris) {
    for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3];
      if (!dirEdges.has(`${b}_${a}`)) {
        const angle = Math.atan2(xy[b].y - xy[a].y, xy[b].x - xy[a].x);
        if (!outs.has(a)) outs.set(a, []);
        outs.get(a).push({ to: b, angle, used: false });
        edgeCount++;
      }
    }
  }
  if (edgeCount === 0) return [];
  for (const list of outs.values()) list.sort((p, q) => p.angle - q.angle);

  // At vertex `a`, given the reverse-of-incoming direction `revAngle`
  // (pointing from `a` back to prev), pick the outgoing edge requiring
  // the smallest clockwise rotation from `revAngle`. This is the standard
  // "next CW edge at vertex" rule and yields a simple loop each walk.
  function pickOut(a, revAngle) {
    const list = outs.get(a);
    if (!list) return null;
    let best = null;
    let bestDelta = Infinity;
    for (const item of list) {
      if (item.used) continue;
      let delta = revAngle - item.angle;
      delta -= Math.floor(delta / (2 * Math.PI)) * 2 * Math.PI;
      if (delta === 0) delta = 2 * Math.PI;
      if (delta < bestDelta) { bestDelta = delta; best = item; }
    }
    return best;
  }

  const rings = [];
  for (const [startA, startList] of outs) {
    for (const startItem of startList) {
      if (startItem.used) continue;
      startItem.used = true;
      const comp = [startA];
      let prev = startA, cur = startItem.to;
      let guard = edgeCount + 2;
      while (cur !== startA && guard-- > 0) {
        comp.push(cur);
        const revAngle = Math.atan2(xy[prev].y - xy[cur].y, xy[prev].x - xy[cur].x);
        const out = pickOut(cur, revAngle);
        if (!out) break;
        out.used = true;
        prev = cur;
        cur = out.to;
      }
      if (comp.length < 3) continue;
      const pts = comp.map(i => xy[i]);
      // CCW loops (positive area) are outer rings; CW loops are holes.
      if (polygonArea2D(pts) > 0) rings.push(pts);
    }
  }

  return rings;
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

// ── Grid-based subsampling: preserves spatial density ─────────────────────
// Angular sorting would space neighbors arbitrarily far apart for wide
// clusters, breaking the alpha shape. A grid keeps cell-sized spacing so
// alpha filtering can always connect neighbors. Cell size coarsens until
// the result fits under maxPts; returned cellM lets the caller scale alpha.
function subsampleGrid(pts, maxPts, initialCellM) {
  const meanLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos(meanLat * Math.PI / 180);

  let cellM = initialCellM;
  let grid;
  for (let iter = 0; iter < 16; iter++) {
    grid = new Map();
    const latStep = cellM / mPerLat;
    const lngStep = cellM / mPerLng;
    for (const p of pts) {
      const cx = Math.floor(p.lng / lngStep);
      const cy = Math.floor(p.lat / latStep);
      const key = `${cx},${cy}`;
      if (!grid.has(key)) grid.set(key, p);
    }
    if (grid.size <= maxPts) break;
    cellM *= 1.4;
  }
  return { points: [...grid.values()], cellM };
}

// ── Build zone hull: alpha shape + Chaikin smooth, fallback to convex hull ─
// Alpha must exceed DBSCAN eps: a DBSCAN cluster chains points via shared
// eps-neighbors, but alpha filters triangles by circumradius — obtuse
// triangles along a chain exceed eps, so alpha < eps would fragment one
// cluster into several thin ribbons rendered as overlapping blobs.
const ALPHA_METERS = 180;
const SMOOTH_ITERATIONS = 2;
const MAX_DELAUNAY_PTS = 1200;
const GRID_CELL_M = ALPHA_METERS / 2;
// Merge clusters whose bounding circles are within this distance, not just
// strictly overlapping — smoothed alpha boundaries commonly leave thin gaps
// between visually-touching clusters that the strict edge test misses.
const MERGE_BUFFER_METERS = 100;

// Returns an array of rings (lat/lng loops). Each ring is a separate outer
// boundary — the alpha shape may decompose into multiple disjoint loops for
// pinched or multi-component clusters. Empty array means no valid boundary.
function buildZoneHull(pts) {
  if (pts.length < 3) return [];

  let sample = pts;
  let adaptiveAlpha = ALPHA_METERS;

  if (pts.length > MAX_DELAUNAY_PTS) {
    const { points, cellM } = subsampleGrid(pts, MAX_DELAUNAY_PTS, GRID_CELL_M);
    sample = points;
    // Grid diagonal ≈ cellM·√2; alpha must exceed it for neighbors to connect.
    adaptiveAlpha = Math.max(ALPHA_METERS, cellM * 1.8);
  }

  const proj = makeProjection(sample);
  const xy = sample.map(p => proj.toXY(p));

  const tris = delaunay2D(xy);
  const alphaRings = extractAlphaShape(xy, tris, adaptiveAlpha);

  const rawRings = alphaRings.length > 0 ? alphaRings : (() => {
    const hull = convexHullXY(xy);
    return hull.length >= 3 ? [hull] : [];
  })();

  if (rawRings.length === 0) return [];

  return rawRings.map(ring => {
    const smoothed = chaikinSmooth(ring, SMOOTH_ITERATIONS);
    return smoothed.map(p => proj.fromXY(p));
  });
}

// ── Point-in-ring (ray casting, single ring of {lat, lng}) ────────────────
function pointInRing(p, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat;
    const xj = ring[j].lng, yj = ring[j].lat;
    if (
      (yi > p.lat) !== (yj > p.lat) &&
      p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

// Point is inside a multi-ring hull if it lies inside any CCW ring.
function pointInHull(p, hull) {
  for (const ring of hull) if (pointInRing(p, ring)) return true;
  return false;
}

// ── Segment intersection (proper crossing, shared endpoints don't count) ──
function segmentsIntersect(a, b, c, d) {
  const d1 = (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
  const d2 = (b.lng - a.lng) * (d.lat - a.lat) - (b.lat - a.lat) * (d.lng - a.lng);
  const d3 = (d.lng - c.lng) * (a.lat - c.lat) - (d.lat - c.lat) * (a.lng - c.lng);
  const d4 = (d.lng - c.lng) * (b.lat - c.lat) - (d.lat - c.lat) * (b.lng - c.lng);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// Bounding box of a lat/lng ring.
function ringBBox(ring) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of ring) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

function bboxesOverlap(a, b) {
  return a.minLat <= b.maxLat && b.minLat <= a.maxLat &&
         a.minLng <= b.maxLng && b.minLng <= a.maxLng;
}

// Any edge of ringA crosses any edge of ringB. O(|A|·|B|) worst-case but
// callers bbox-filter first — Chaikin smoothing quadruples ring size so
// skipping disjoint pairs is essential to keep merge time reasonable.
function ringsIntersect(ringA, ringB) {
  const na = ringA.length, nb = ringB.length;
  for (let i = 0, pi = na - 1; i < na; pi = i++) {
    for (let j = 0, pj = nb - 1; j < nb; pj = j++) {
      if (segmentsIntersect(ringA[pi], ringA[i], ringB[pj], ringB[j])) return true;
    }
  }
  return false;
}

// ── Cluster overlap check ──────────────────────────────────────────────────
// Two hulls overlap if: (a) any edge of one crosses any edge of the other,
// or (b) one hull fully contains a vertex of the other. Vertex-only checks
// alone miss X-shaped crossings where all vertices are outside — which is
// exactly how elongated alpha-shape ribbons fail to merge.
function hullsOverlap(c1, c2) {
  const centroidDist = haversineDistance(c1.centroid, c2.centroid);
  const sumRadii = c1.radiusMeters + c2.radiusMeters;
  if (centroidDist > sumRadii + MERGE_BUFFER_METERS) return false;
  // Close but bounding circles don't actually overlap — treat as mergeable
  // without running the edge test. The buffer spans the gap that smoothed
  // alpha boundaries tend to leave between adjacent clusters.
  if (centroidDist > sumRadii) return true;
  const hullA = c1.hull, hullB = c2.hull;
  const bboxA = c1.hullBBoxes, bboxB = c2.hullBBoxes;
  for (let i = 0; i < hullA.length; i++) {
    for (let j = 0; j < hullB.length; j++) {
      if (!bboxesOverlap(bboxA[i], bboxB[j])) continue;
      if (ringsIntersect(hullA[i], hullB[j])) return true;
    }
  }
  // Containment check: first vertex of each ring against the other hull.
  for (const ring of hullA) if (ring.length > 0 && pointInHull(ring[0], hullB)) return true;
  for (const ring of hullB) if (ring.length > 0 && pointInHull(ring[0], hullA)) return true;
  return false;
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
  const hullBBoxes = hull.map(ringBBox);
  return { centroid, pointCount: n, radiusMeters, hull, hullBBoxes, _pts: pts };
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
