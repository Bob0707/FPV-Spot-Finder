import { FPV_TYPE_APPEAL } from "./constants.js";

// ── Haversine distance ─────────────────────────────────────────────────────
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Remoteness scoring helpers ─────────────────────────────────────────────
export function getSinglePlacePenalty(placeNodes, sLat, sLng) {
  let max = 0;
  for (const p of placeNodes) {
    if (p.lat == null || p.lon == null) continue;
    const d = haversineKm(sLat, sLng, p.lat, p.lon);
    const t = p.tags?.place;
    const pop = parseInt(p.tags?.population || "0");
    let pen = 0;
    if (t === "city") {
      if (d < 2) pen = 62;
      else if (d < 5) pen = 48;
      else if (d < 10) pen = 34;
      else if (d < 20) pen = 20;
      else if (d < 30) pen = 10;
    } else if (t === "town") {
      if (d < 0.5) pen = 60;
      else if (d < 2) pen = 45;
      else if (d < 5) pen = 28;
      else if (d < 10) pen = 14;
    } else if (t === "suburb" || t === "quarter") {
      if (d < 0.3) pen = 72;
      else if (d < 1) pen = 62;
      else if (d < 3) pen = 44;
      else if (d < 6) pen = 22;
    } else if (t === "neighbourhood") {
      if (d < 0.15) pen = 68;
      else if (d < 0.5) pen = 55;
      else if (d < 1.5) pen = 36;
      else if (d < 3) pen = 16;
    } else if (t === "village") {
      if (d < 0.3) pen = 24;
      else if (d < 1) pen = 14;
      else if (d < 3) pen = 6;
    } else if (t === "hamlet") {
      if (d < 0.3) pen = 12;
      else if (d < 1) pen = 5;
    }
    if (pop > 500000 && d < 25) pen = Math.min(72, pen + 20);
    else if (pop > 200000 && d < 18) pen = Math.min(72, pen + 14);
    else if (pop > 50000 && d < 12) pen = Math.min(72, pen + 8);
    else if (pop > 10000 && d < 7) pen = Math.min(72, pen + 4);
    if (pen > max) max = pen;
  }
  return max;
}

export function getSuburbDensityPenalty(placeNodes, sLat, sLng) {
  let count = 0;
  for (const p of placeNodes) {
    if (p.lat == null || p.lon == null) continue;
    if (!["suburb", "quarter", "neighbourhood", "city_block"].includes(p.tags?.place)) continue;
    if (haversineKm(sLat, sLng, p.lat, p.lon) <= 5) count++;
  }
  return count >= 25 ? 38
    : count >= 16 ? 32
    : count >= 10 ? 26
    : count >= 6 ? 18
    : count >= 3 ? 10
    : count >= 1 ? 4
    : 0;
}

export function computeRemoteness(tags, spotType, placeNodes, spotCoords) {
  const [sLng, sLat] = spotCoords;
  let score = 100;
  const singlePen = getSinglePlacePenalty(placeNodes, sLat, sLng);
  const suburbPen = getSuburbDensityPenalty(placeNodes, sLat, sLng);
  const hi = Math.max(singlePen, suburbPen);
  const lo = Math.min(singlePen, suburbPen);
  score -= Math.min(85, hi + lo * 0.55);
  const lvl = parseInt(tags?.["building:levels"] || "0");
  if (lvl >= 8) score -= 12;
  else if (lvl >= 4) score -= 7;
  else if (lvl >= 2) score -= 3;
  if (tags?.tourism) score -= 12;
  if (tags?.amenity) score -= 8;
  if (tags?.shop) score -= 12;
  if (tags?.opening_hours) score -= 8;
  if (tags?.fee === "yes") score -= 6;
  if (tags?.website || tags?.["contact:website"]) score -= 5;
  if (tags?.abandoned === "yes" || tags?.disused === "yes") score += 3;
  if (tags?.ruins === "yes") score += 2;
  if (tags?.access === "private" || tags?.access === "no") score += 5;
  if (tags?.access === "yes" || tags?.access === "public") score -= 6;
  const bias = { bando: 2, quarry: 6, brownfield: 2, bridge: -4, openspace: -6, clearing: 4, water: 0 };
  score += bias[spotType] ?? 0;
  return Math.min(100, Math.max(3, Math.round(score)));
}

export function getScoreColor(s) {
  return s >= 80 ? "#ef4444" : s >= 65 ? "#f59e0b" : s >= 45 ? "#22d3a7" : "#60a5fa";
}

export function getScoreLabel(s) {
  return s >= 80 ? "Sehr abgelegen" : s >= 65 ? "Abgelegen" : s >= 45 ? "Mittellage" : "Urban";
}

// ── Phase 9: FPV Potential Score ───────────────────────────────────────────
export function computeFpvScore(feature) {
  const { score, spotType, tags } = feature.properties;

  // 1. Remoteness (40%)
  const remote = score ?? 50;
  const remoteComp = remote * 0.40;

  // 2. Spot Type FPV Appeal (30%)
  const typeAppeal = FPV_TYPE_APPEAL[spotType] ?? 65;
  const typeComp = typeAppeal * 0.30;

  // 3. Visual/Structural Interest (20%)
  let visual = 55;
  const lvl = parseInt(tags?.["building:levels"] ?? "0");
  if (lvl >= 10) visual += 30;
  else if (lvl >= 5) visual += 20;
  else if (lvl >= 2) visual += 10;
  if (tags?.ruins === "yes") visual += 15;
  if (tags?.abandoned === "yes" || tags?.disused === "yes") visual += 8;
  if (tags?.name) visual += 5;
  if (tags?.height) visual += 8;
  if (tags?.tourism) visual -= 15;
  visual = Math.min(100, Math.max(0, visual));
  const visualComp = visual * 0.20;

  // 4. Access Score (10%)
  let access = 65;
  if (tags?.access === "private" || tags?.access === "no") access = 25;
  else if (tags?.access === "yes" || tags?.access === "public") access = 80;
  const accessComp = access * 0.10;

  const total = Math.min(100, Math.max(0, Math.round(remoteComp + typeComp + visualComp + accessComp)));
  return {
    total,
    remote,
    typeAppeal,
    visual: Math.round(visual),
    access: Math.round(access),
  };
}

export function getFpvColor(s) {
  return s >= 75 ? "#a78bfa" : s >= 55 ? "#22d3a7" : s >= 40 ? "#f59e0b" : "#64748b";
}

export function getFpvLabel(s) {
  return s >= 75 ? "Hervorragend" : s >= 55 ? "Gut" : s >= 40 ? "Mittel" : "Gering";
}
