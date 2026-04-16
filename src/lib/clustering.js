// ── Building clusters via grid rasterization ───────────────────────────────
// Why this approach (not DBSCAN + alpha shape):
//   The old pipeline chained buildings with DBSCAN, then wrapped each cluster
//   in an alpha-shape concave hull. On dense urban point clouds that produced
//   long, thin, obtuse-triangle ribbons that Chaikin-smoothed into overlapping
//   spaghetti blobs, one DBSCAN cluster often decomposing into many disjoint
//   alpha rings that rendered as separate MultiPolygon fills.
//
//   This implementation rasterizes each building as a dilated disk onto a
//   binary grid. Urban area is the union of these disks. Connected components
//   of the binary grid give clean, naturally-merged blobs. Each component's
//   rectilinear boundary is traced (unambiguous on 4-connected rasters) and
//   Chaikin-smoothed to soften the stair-step edges.

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

// ── Tunables ───────────────────────────────────────────────────────────────
const CELL_M = 80;              // raster cell size in meters
const DILATE_M = 180;           // each building activates cells within this radius
const MIN_POINTS = 10;          // drop clusters with fewer buildings (rural noise)
const SMOOTH_ITER = 2;          // Chaikin passes — softens rectilinear stairsteps
const MAX_GRID_CELLS = 4_000_000; // safety cap; auto-coarsen CELL_M if exceeded

const M_PER_LAT = 111320;

// ── Local XY projection anchored on the point-cloud centroid ───────────────
function makeProjection(points) {
  const cLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const cLng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  const mLng = M_PER_LAT * Math.cos(cLat * Math.PI / 180);
  return {
    toXY: (p) => ({ x: (p.lng - cLng) * mLng, y: (p.lat - cLat) * M_PER_LAT }),
    fromXY: (p) => ({ lat: cLat + p.y / M_PER_LAT, lng: cLng + p.x / mLng }),
  };
}

// ── Rasterize buildings onto a binary urban grid ──────────────────────────
// Each building marks every cell whose centre lies within DILATE_M. Returns
// grid metadata plus the effective cellSize (auto-coarsened if the naive grid
// would exceed MAX_GRID_CELLS for very large search radii).
function rasterize(xy) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of xy) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = DILATE_M + CELL_M;
  minX -= pad; maxX += pad;
  minY -= pad; maxY += pad;

  let cellSize = CELL_M;
  let cols = Math.ceil((maxX - minX) / cellSize);
  let rows = Math.ceil((maxY - minY) / cellSize);
  while (cols * rows > MAX_GRID_CELLS) {
    cellSize *= 1.5;
    cols = Math.ceil((maxX - minX) / cellSize);
    rows = Math.ceil((maxY - minY) / cellSize);
  }

  const urban = new Uint8Array(cols * rows);
  const kRadius = Math.ceil(DILATE_M / cellSize);
  const r2 = DILATE_M * DILATE_M;

  for (const p of xy) {
    const bi = Math.floor((p.x - minX) / cellSize);
    const bj = Math.floor((p.y - minY) / cellSize);
    for (let dj = -kRadius; dj <= kRadius; dj++) {
      const nj = bj + dj;
      if (nj < 0 || nj >= rows) continue;
      const rowBase = nj * cols;
      const cy = minY + (nj + 0.5) * cellSize;
      const dyC = cy - p.y;
      for (let di = -kRadius; di <= kRadius; di++) {
        const ni = bi + di;
        if (ni < 0 || ni >= cols) continue;
        if (urban[rowBase + ni]) continue;
        const cx = minX + (ni + 0.5) * cellSize;
        const dxC = cx - p.x;
        if (dxC * dxC + dyC * dyC <= r2) urban[rowBase + ni] = 1;
      }
    }
  }

  return { urban, cols, rows, minX, minY, cellSize };
}

// ── Flood-fill 4-connected components of the urban mask ───────────────────
// 4-connectivity keeps each component simply-connected: the rectilinear
// boundary walk later in traceBoundary has no checkerboard pinch-points to
// disambiguate, so every corner has exactly one outgoing boundary edge.
function findComponents(urban, cols, rows) {
  const labels = new Int32Array(cols * rows);
  const components = [];
  let label = 0;

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      if (urban[idx] === 0 || labels[idx] !== 0) continue;

      label++;
      const cells = [];
      const stack = [idx];
      labels[idx] = label;

      while (stack.length > 0) {
        const cur = stack.pop();
        const ci = cur % cols;
        const cj = (cur - ci) / cols;
        cells.push(cur);

        const neighbors = [cur + 1, cur - 1, cur + cols, cur - cols];
        const boundsOk = [ci + 1 < cols, ci - 1 >= 0, cj + 1 < rows, cj - 1 >= 0];
        for (let k = 0; k < 4; k++) {
          if (!boundsOk[k]) continue;
          const nidx = neighbors[k];
          if (urban[nidx] === 0 || labels[nidx] !== 0) continue;
          labels[nidx] = label;
          stack.push(nidx);
        }
      }

      components.push({ label, cells });
    }
  }

  return { components, labels };
}

// ── Trace the outer rectilinear boundary of a 4-connected component ───────
// Returns the single CCW outer ring as an array of [cornerI, cornerJ] pairs
// in grid-corner coordinates. CW inner loops (holes) are discarded so the
// component renders as one filled region; rare in urban-scale dilations.
function traceBoundary(cells, cols, rows) {
  const cellSet = new Set(cells);
  const has = (i, j) =>
    i >= 0 && i < cols && j >= 0 && j < rows && cellSet.has(j * cols + i);

  // Directed boundary edges with the urban cell on the LEFT of each edge —
  // guarantees outer loops come out CCW and holes come out CW.
  const edges = [];
  for (const idx of cells) {
    const i = idx % cols;
    const j = (idx - i) / cols;
    if (!has(i + 1, j)) edges.push([i + 1, j,     i + 1, j + 1]); // right  S→N
    if (!has(i, j + 1)) edges.push([i + 1, j + 1, i,     j + 1]); // top    E→W
    if (!has(i - 1, j)) edges.push([i,     j + 1, i,     j    ]); // left   N→S
    if (!has(i, j - 1)) edges.push([i,     j,     i + 1, j    ]); // bottom W→E
  }

  // In a 4-connected component every corner has at most one outgoing edge,
  // so chaining by corner-key is deterministic.
  const outMap = new Map();
  for (const e of edges) outMap.set(e[0] * 100003 + e[1], e);

  const rings = [];
  const used = new Set();
  for (const start of edges) {
    if (used.has(start)) continue;
    const ring = [];
    let cur = start;
    while (cur && !used.has(cur)) {
      used.add(cur);
      ring.push([cur[0], cur[1]]);
      cur = outMap.get(cur[2] * 100003 + cur[3]);
    }
    if (ring.length < 3) continue;

    let area2 = 0;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      area2 += a[0] * b[1] - b[0] * a[1];
    }
    if (area2 > 0) rings.push(ring); // CCW outer boundary only
  }

  return rings;
}

// ── Chaikin corner-cutting smoothing on [x, y] tuples ─────────────────────
function chaikinSmooth(pts, iterations) {
  let p = pts;
  for (let k = 0; k < iterations; k++) {
    const n = p.length;
    const out = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      out[i * 2]     = [0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]];
      out[i * 2 + 1] = [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]];
    }
    p = out;
  }
  return p;
}

// ── Main entry ─────────────────────────────────────────────────────────────
// Signature preserves the old default-argument shape but eps/minPoints no
// longer apply — kept for call-site compatibility. Ignored args documented
// here so future callers don't expect them to do anything.
export function clusterBuildings(points) {
  if (points.length === 0) return [];

  const proj = makeProjection(points);
  const xy = points.map((p) => proj.toXY(p));

  const { urban, cols, rows, minX, minY, cellSize } = rasterize(xy);
  const { components, labels } = findComponents(urban, cols, rows);

  // Group building points by the label of the cell they fall into.
  const pointsByLabel = new Map();
  for (let k = 0; k < xy.length; k++) {
    const i = Math.floor((xy[k].x - minX) / cellSize);
    const j = Math.floor((xy[k].y - minY) / cellSize);
    if (i < 0 || i >= cols || j < 0 || j >= rows) continue;
    const lab = labels[j * cols + i];
    if (lab === 0) continue;
    let bucket = pointsByLabel.get(lab);
    if (!bucket) { bucket = []; pointsByLabel.set(lab, bucket); }
    bucket.push(points[k]);
  }

  const clusters = [];
  for (const { label, cells } of components) {
    const pts = pointsByLabel.get(label);
    if (!pts || pts.length < MIN_POINTS) continue;

    const rings = traceBoundary(cells, cols, rows);
    if (rings.length === 0) continue;

    const hull = rings.map((ring) => {
      const xyRing = ring.map(([ci, cj]) => [minX + ci * cellSize, minY + cj * cellSize]);
      const smoothed = chaikinSmooth(xyRing, SMOOTH_ITER);
      return smoothed.map(([x, y]) => proj.fromXY({ x, y }));
    });

    const n = pts.length;
    const centroid = {
      lat: pts.reduce((s, p) => s + p.lat, 0) / n,
      lng: pts.reduce((s, p) => s + p.lng, 0) / n,
    };
    const radiusMeters = pts.reduce(
      (max, p) => Math.max(max, haversineDistance(centroid, p)),
      0
    );

    clusters.push({ centroid, pointCount: n, radiusMeters, hull });
  }

  console.log(
    `[clustering] ${points.length} pts → ${components.length} raw → ` +
    `${clusters.length} clusters (cell=${cellSize.toFixed(0)}m, dilate=${DILATE_M}m)`
  );

  return clusters;
}
