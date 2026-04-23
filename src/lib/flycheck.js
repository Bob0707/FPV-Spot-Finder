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

// DFS-veröffentlichte UAS-Geozonen aus dipul.de — semantische zoneType-Werte
// aus lib/geozones.js. Unbekannte Typen werden ignoriert (info/FIR/UIR etc.
// sollten vom Filter schon draussen sein, sind hier safety net).
const GEOZONE_RULES = {
  prohibited: { level: "red",    code: "UAS-P", label: "UAS-Flugverbotszone",  msg: "Drohnenflug in dieser Zone laut dipul.de nicht gestattet" },
  restricted: { level: "red",    code: "UAS-R", label: "UAS-Beschränkung",    msg: "Drohnenflug nur mit Genehmigung — Bedingungen auf dipul.de prüfen" },
  danger:     { level: "yellow", code: "UAS-D", label: "UAS-Gefahrengebiet",  msg: "Gefährdungszone — besondere Vorsicht und Rücksprache empfohlen" },
  REA:        { level: "yellow", code: "REA",   label: "Modellflug-Zone",     msg: "Ausnahmezone für Modellflug — Abstimmung mit Betreiber nötig" },
  nature:     { level: "yellow", code: "NSG",   label: "Naturschutz (DFS)",   msg: "Naturschutz-Einschränkung für UAS — Flug meist verboten/genehmigungspflichtig" },
};

export function computeFlyCheck(spot, airspaceFeatures, naturschutzFeatures, geoZoneFeatures) {
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

  for (const f of geoZoneFeatures || []) {
    if (!featureContainsPoint(f, pt)) continue;
    const rule = GEOZONE_RULES[f.properties?.zoneType];
    if (!rule) continue;
    const p = f.properties;
    // formatAltLimit im Panel erwartet {value, unit, referenceDatum} — wir
    // packen die Meter-Werte aus geozones.js in dieses Schema.
    const toLimit = (m) => (m == null ? null : { value: Math.round(m), unit: "M", referenceDatum: "GND" });
    hits.push({
      level: rule.level,
      code: rule.code,
      label: rule.label,
      name: p.name || rule.label,
      msg: rule.msg,
      lowerLimit: toLimit(p.lowerLimitM),
      upperLimit: toLimit(p.upperLimitM),
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
