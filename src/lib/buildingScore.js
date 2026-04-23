import { haversineDistance } from "./clustering.js";

// ── Piecewise-linear interpolation ────────────────────────────────────────
// Breakpoints: [distanceMeters, score]
const BREAKPOINTS = [
  [0,    0],
  [100,  20],
  [300,  50],
  [500,  70],
  [1000, 90],
  [Infinity, 100],
];

function interpolateScore(distMeters) {
  for (let i = 0; i < BREAKPOINTS.length - 1; i++) {
    const [d0, s0] = BREAKPOINTS[i];
    const [d1, s1] = BREAKPOINTS[i + 1];
    if (distMeters <= d1) {
      const t = (distMeters - d0) / (d1 - d0);
      return s0 + t * (s1 - s0);
    }
  }
  return 100;
}

// Distance from a point to the nearest edge of a cluster
// (centroid distance minus cluster radius, floored at 0)
function distToClusterEdge(point, cluster) {
  const toCentroid = haversineDistance(point, cluster.centroid);
  return Math.max(0, toCentroid - cluster.radiusMeters);
}

// ── Single-spot score ──────────────────────────────────────────────────────
export function computeBuildingDistanceScore(spotCoords, clusters) {
  if (clusters.length === 0) return 100;

  let minDist = Infinity;
  for (const cluster of clusters) {
    const d = distToClusterEdge(spotCoords, cluster);
    if (d < minDist) minDist = d;
    if (minDist === 0) break; // can't get closer
  }

  return interpolateScore(minDist);
}

// ── Batch score ────────────────────────────────────────────────────────────
// Pre-sorts clusters by a bounding-box approximation so the inner loop can
// break early once the remaining clusters are definitely farther than minDist.
export function computeBuildingDistanceScoreBatch(spots, clusters) {
  if (spots.length === 0) return [];
  if (clusters.length === 0) return spots.map(() => ({ score: 100, distM: null }));

  // Build a flat sorted array of cluster centroids for early-exit sweeping.
  // Sort by latitude — for each spot we sweep outward in lat and stop when the
  // lat gap alone exceeds the current best distance.
  const sorted = [...clusters].sort((a, b) => a.centroid.lat - b.centroid.lat);
  const centroidLats = sorted.map((c) => c.centroid.lat);

  const scores = new Array(spots.length);

  for (let si = 0; si < spots.length; si++) {
    const spot = spots[si];
    let minDist = Infinity;

    // Binary search for the insertion point of spot.lat in centroidLats
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (centroidLats[mid] < spot.lat) lo = mid + 1;
      else hi = mid;
    }
    const start = lo;

    // Expand outward from start in both directions simultaneously
    const mPerLat = 111320;
    let fwd = start;
    let bwd = start - 1;

    while (fwd < sorted.length || bwd >= 0) {
      // Check forward candidate
      if (fwd < sorted.length) {
        const latGapM = (centroidLats[fwd] - spot.lat) * mPerLat;
        if (latGapM - sorted[fwd].radiusMeters > minDist) {
          fwd = sorted.length; // all remaining fwd clusters are farther
        } else {
          const d = distToClusterEdge(spot, sorted[fwd]);
          if (d < minDist) minDist = d;
          fwd++;
        }
      }

      // Check backward candidate
      if (bwd >= 0) {
        const latGapM = (spot.lat - centroidLats[bwd]) * mPerLat;
        if (latGapM - sorted[bwd].radiusMeters > minDist) {
          bwd = -1; // all remaining bwd clusters are farther
        } else {
          const d = distToClusterEdge(spot, sorted[bwd]);
          if (d < minDist) minDist = d;
          bwd--;
        }
      }

      if (minDist === 0) break;
    }

    scores[si] = {
      score: Math.round(interpolateScore(minDist)),
      distM: minDist < Infinity ? Math.round(minDist) : null,
    };
  }

  return scores;
}
