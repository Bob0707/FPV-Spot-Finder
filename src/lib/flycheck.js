import { ZONE_RULES } from "./constants.js";

// ── Phase 8: Fly-or-No-Fly Utilities ──────────────────────────────────────

export function pointInPolygon([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function featureContainsPoint(feature, [px, py]) {
  const g = feature.geometry;
  if (!g) return false;
  if (g.type === "Polygon") return pointInPolygon([px, py], g.coordinates[0]);
  if (g.type === "MultiPolygon") {
    return g.coordinates.some((poly) => pointInPolygon([px, py], poly[0]));
  }
  return false;
}

export function computeFlyCheck(spot, airspaceFeatures, naturschutzFeatures) {
  const pt = spot.geometry.coordinates;
  const hits = [];

  for (const f of airspaceFeatures) {
    if (!featureContainsPoint(f, pt)) continue;
    const code = f.properties.zoneType;
    const rule = ZONE_RULES[code];
    if (!rule) continue;
    hits.push({
      level: rule.level,
      code,
      label: rule.label,
      name: f.properties.name,
      msg: rule.msg,
      lowerLimit: f.properties.lowerLimit,
      upperLimit: f.properties.upperLimit,
    });
  }

  for (const f of naturschutzFeatures) {
    if (!featureContainsPoint(f, pt)) continue;
    const rule = ZONE_RULES.NATURSCHUTZ;
    hits.push({
      level: rule.level,
      code: "NSG",
      label: rule.label,
      name: f.properties.name,
      msg: rule.msg,
    });
  }

  hits.sort((a, b) => (a.level === "red" ? -1 : b.level === "red" ? 1 : 0));
  const verdict = hits.some((h) => h.level === "red")
    ? "red"
    : hits.some((h) => h.level === "yellow")
    ? "yellow"
    : "green";

  return { verdict, hits };
}
