import { ZONE_RULES } from "./constants.js";
import { fetchFeatureInfo } from "./dipulWms.js";

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

// Klassifiziert einen einzelnen dipul GetFeatureInfo-Treffer.
// Gibt null zurück für reine Informations-Layer (FIR, UIR, Info).
function classifyDipulHit(hit) {
  const layer = (hit.layerName || "").toLowerCase();
  const props = hit.properties || {};

  if (layer.includes("information") || layer.includes(":fir") || layer.includes(":uir")) {
    return null;
  }

  // Beim ersten Treffer Felder loggen — wichtig um den echten WMS-Aufbau zu kennen
  if (Object.keys(props).length > 0) {
    console.log("[flycheck] dipul props:", layer, props);
  }

  const name =
    props.name || props.NAME ||
    props.bezeichnung || props.BEZEICHNUNG ||
    "Unbekannte Zone";

  const typeRaw = (
    props.type || props.TYPE ||
    props.restriction || props.RESTRICTION ||
    props.category || props.CATEGORY || ""
  ).toLowerCase();

  if (typeRaw.includes("prohibit") || typeRaw.includes("verbot") || layer.includes("verbot")) {
    return {
      level: "red",
      code: "UAS-P",
      label: "UAS-Flugverbotszone",
      name,
      msg: "Drohnenflug in dieser Zone laut dipul.de nicht gestattet",
    };
  }

  if (
    layer.includes("kontroll") ||
    layer.includes("beschraenkung") ||
    layer.includes("beschränkung") ||
    typeRaw.includes("restrict") ||
    typeRaw.includes("beschränk") ||
    typeRaw.includes("beschraenk")
  ) {
    return {
      level: "yellow",
      code: "UAS-R",
      label: "UAS-Beschränkung",
      name,
      msg: "Drohnenflug nur mit Genehmigung — Bedingungen auf dipul.de prüfen",
    };
  }

  if (layer.includes("naturschutz")) {
    return {
      level: "yellow",
      code: "NSG-D",
      label: "Naturschutz (DFS)",
      name,
      msg: "Naturschutz-Einschränkung für UAS — Flug meist genehmigungspflichtig",
    };
  }

  if (layer.includes("landesrecht")) {
    return {
      level: "yellow",
      code: "LR",
      label: "Landesrechtliche Zone",
      name,
      msg: "Landesrechtliche Einschränkung — lokale Regelungen prüfen",
    };
  }

  // Unbekannter relevanter Layer → sicherheitshalber gelb
  return {
    level: "yellow",
    code: "UAS",
    label: "UAS-Zone",
    name,
    msg: `Einschränkung prüfen (${hit.layerName})`,
  };
}

export async function computeFlyCheck(spot, airspaceFeatures, naturschutzFeatures, dipulConfig) {
  const [lng, lat] = spot.geometry.coordinates;
  const pt = [lng, lat];
  const hits = [];
  let dipulChecked = false;
  let geoZoneHits = [];

  // ── 1. Offizielle Geozonen via dipul WMS (höchste Priorität) ──────────────
  if (dipulConfig?.available && dipulConfig?.activeLayers?.length > 0) {
    try {
      const rawHits = await fetchFeatureInfo({ lat, lng, layers: dipulConfig.activeLayers });

      for (const hit of rawHits) {
        const classified = classifyDipulHit(hit);
        if (classified) hits.push(classified);
      }

      geoZoneHits = rawHits;
      dipulChecked = true;
    } catch (err) {
      console.warn("[flycheck] dipul GetFeatureInfo fehlgeschlagen:", err.message);
      dipulChecked = false;
    }
  }

  // ── 2. OpenAIP Luftraum ───────────────────────────────────────────────────
  for (const f of airspaceFeatures || []) {
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

  // ── 3. Naturschutzgebiete ─────────────────────────────────────────────────
  for (const f of naturschutzFeatures || []) {
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

  return {
    verdict,
    hits,
    geoZoneHits,
    dipulChecked,
    sources: {
      dipul: dipulChecked
        ? "✓ Geprüft"
        : dipulConfig?.available
        ? "✗ Fehler"
        : "✗ Nicht verfügbar",
      openAip: (airspaceFeatures || []).length > 0 ? "✓ Geprüft" : "✗ Nicht geladen",
      nature: (naturschutzFeatures || []).length > 0 ? "✓ Geprüft" : "✗ Nicht geladen",
    },
  };
}
