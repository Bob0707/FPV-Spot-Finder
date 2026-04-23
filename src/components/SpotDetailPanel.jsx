import React, { useState } from "react";
import { SPOT_TYPES } from "../lib/constants.js";
import { getScoreColor, getScoreLabel, getFpvColor, getFpvLabel } from "../lib/scoring.js";
import { IconX, IconMapPin, IconPin, IconShare, IconCheck } from "./Icons.jsx";

export function SpotDetailPanel({ spot, onClose, flyCheckResult, onToast }) {
  const [copied, setCopied] = useState(null);

  if (!spot) return null;

  const { spotType, name, tags, id, osmType, score, fpvScore, fpvBreakdown, buildingScore, nearestClusterDistanceM } = spot.properties;
  const [lng, lat] = spot.geometry.coordinates;
  const type = SPOT_TYPES.find((st) => st.id === spotType);

  const osmUrl = `https://www.openstreetmap.org/${osmType}/${id}`;
  const googleUrl = `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
  const appleUrl = `https://maps.apple.com/?ll=${lat.toFixed(6)},${lng.toFixed(6)}&q=${encodeURIComponent(name || "FPV Spot")}`;

  const scoreColor = getScoreColor(score ?? 50);
  const scoreLabel = getScoreLabel(score ?? 50);
  const fpvColor = getFpvColor(fpvScore ?? 0);
  const fpvLabel = getFpvLabel(fpvScore ?? 0);

  const tagH = [];
  if (tags?.bridge === "yes" && tags?.highway) tagH.push({ label: "Straßentyp", value: tags.highway });
  if (tags?.["maxheight"]) tagH.push({ label: "Maximalhöhe", value: tags.maxheight + " m" });
  if (tags?.access) tagH.push({ label: "Zugang", value: tags.access });
  if (tags?.["operator"]) tagH.push({ label: "Betreiber", value: tags.operator });
  if (tags?.["landuse"]) tagH.push({ label: "Landnutzung", value: tags.landuse });
  if (tags?.["natural"]) tagH.push({ label: "Naturtyp", value: tags.natural });
  if (tags?.["waterway"]) tagH.push({ label: "Gewässertyp", value: tags.waterway });
  if (tags?.["leisure"]) tagH.push({ label: "Freizeitanlage", value: tags.leisure });

  const breakdown = [
    { label: "Abgelegen", value: fpvBreakdown?.remote ?? score ?? 50, icon: "📍" },
    { label: "Spot-Typ",  value: fpvBreakdown?.typeAppeal ?? 65,       icon: type?.icon ?? "🗺" },
    { label: "Interesse", value: fpvBreakdown?.visual ?? 55,           icon: "🏗" },
    { label: "Zugang",    value: fpvBreakdown?.access ?? 65,           icon: "🔓" },
    { label: "Bebauung",  value: buildingScore ?? null,                icon: "🏘", distM: nearestClusterDistanceM ?? null },
  ];

  const handleCopyCoords = () => {
    const text = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied("coords");
      onToast?.({ message: `Koordinaten kopiert: ${text}`, type: "success" });
      setTimeout(() => setCopied(null), 2200);
    });
  };

  const handleCopyUrl = () => {
    const base = window.location.origin + window.location.pathname;
    const url = `${base}?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&zoom=15${name ? `&q=${encodeURIComponent(name)}` : ""}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied("url");
      onToast?.({ message: "Link kopiert!", type: "success" });
      setTimeout(() => setCopied(null), 2200);
    });
  };

  const handleNativeShare = () => {
    const base = window.location.origin + window.location.pathname;
    const url = `${base}?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&zoom=15`;
    navigator.share?.({
      title: "FPV Spot Finder",
      text: `${name || "FPV Spot"} · ${type?.name || ""} · FPV Score: ${fpvScore ?? "—"}`,
      url,
    }).catch(() => {});
  };

  const hasNativeShare = typeof navigator !== "undefined" && !!navigator.share;

  const flyV = flyCheckResult?.verdict;
  const flyBadge =
    flyV === "green" ? { emoji: "✅", label: "OK", color: "#22c55e" } :
    flyV === "yellow" ? { emoji: "⚠️", label: "Prüfen", color: "#f59e0b" } :
    flyV === "red" ? { emoji: "🚫", label: "Stop", color: "#ef4444" } :
    null;

  return (
    <div className="spot-detail-panel" style={{ "--type-color": type?.color || "#888" }}>
      <div className="sdp-header">
        <span className="sdp-type-badge">
          <span className="sdp-type-icon">{type?.icon}</span>
          {type?.name}
        </span>
        <button className="sdp-close" onClick={onClose}><IconX /></button>
      </div>

      <div className="sdp-scroll">
        <div className="sdp-name">{name || "(kein Name)"}</div>
        <div className="sdp-coords">
          <IconMapPin />
          <span>{lat.toFixed(5)}°N · {lng.toFixed(5)}°E</span>
        </div>

        {fpvScore != null && (
          <div className="sdp-fpv-block" style={{ "--fpv-color": fpvColor }}>
            <div className="sdp-fpv-header">
              <span className="sdp-fpv-title">🚁 FPV Potenzial</span>
              <div className="sdp-fpv-score-wrap">
                <span className="sdp-fpv-score" style={{ color: fpvColor }}>{fpvScore}</span>
                <span className="sdp-fpv-label" style={{ color: fpvColor }}>{fpvLabel}</span>
              </div>
            </div>
            <div className="sdp-fpv-bar-track">
              <div className="sdp-fpv-bar-fill" style={{ width: `${fpvScore}%`, background: `linear-gradient(90deg,${fpvColor}88,${fpvColor})` }} />
              <div className="sdp-fpv-tick" style={{ left: "40%" }} />
              <div className="sdp-fpv-tick" style={{ left: "55%" }} />
              <div className="sdp-fpv-tick" style={{ left: "75%" }} />
            </div>
            <div className="sdp-fpv-breakdown">
              {breakdown.map(({ label, value, icon, distM }) => (
                <div key={label}>
                  <div className="sdp-fpv-sub">
                    <span className="sdp-fpv-sub-icon">{icon}</span>
                    <span className="sdp-fpv-sub-label">{label}</span>
                    {value != null ? (
                      <div className="sdp-fpv-sub-track">
                        <div className="sdp-fpv-sub-fill" style={{ width: `${value}%`, background: fpvColor }} />
                      </div>
                    ) : (
                      <div style={{ flex: 1 }} />
                    )}
                    <span className="sdp-fpv-sub-val">{value != null ? value : "—"}</span>
                  </div>
                  {distM != null && (
                    <div style={{ paddingLeft: 86, fontSize: 9, color: "var(--text-muted)", marginTop: 1, lineHeight: 1 }}>
                      ↔ {distM >= 1000 ? `${(distM / 1000).toFixed(1)} km` : `${distM} m`} zum nächsten Wohngebiet
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {score != null && (
          <div className="sdp-score-block" style={{ "--score-color": scoreColor }}>
            <div className="sdp-score-top">
              <span className="sdp-score-label">Remoteness Score</span>
              <span className="sdp-score-num" style={{ color: scoreColor }}>{score}</span>
            </div>
            <div className="sdp-score-track">
              <div className="sdp-score-fill" style={{ width: `${score}%`, background: `linear-gradient(90deg,${scoreColor}88,${scoreColor})` }} />
              <div className="sdp-score-tick" style={{ left: "45%" }} />
              <div className="sdp-score-tick" style={{ left: "65%" }} />
              <div className="sdp-score-tick" style={{ left: "80%" }} />
            </div>
            <span className="sdp-score-sublabel" style={{ color: scoreColor }}>{scoreLabel}</span>
          </div>
        )}

        {tagH.length > 0 && (
          <div className="sdp-tags">
            {tagH.slice(0, 4).map(({ label, value }) => (
              <div key={label} className="sdp-tag-row">
                <span className="sdp-tag-label">{label}</span>
                <span className="sdp-tag-value">{value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Navigation */}
        <div className="sdp-nav-section">
          <div className="sdp-section-label">Navigation</div>
          <div className="sdp-nav-btns">
            <a href={googleUrl} target="_blank" rel="noreferrer" className="sdp-nav-btn">
              <span>🗺</span><span>Google</span>
            </a>
            <a href={appleUrl} target="_blank" rel="noreferrer" className="sdp-nav-btn">
              <span>🍎</span><span>Apple</span>
            </a>
            <a href={osmUrl} target="_blank" rel="noreferrer" className="sdp-nav-btn">
              <span>🌍</span><span>OSM</span>
            </a>
          </div>
        </div>

        {/* Share */}
        <div className="sdp-share-section">
          <div className="sdp-section-label">Teilen</div>
          <div className="sdp-share-btns">
            <button
              className={`sdp-share-btn${copied === "coords" ? " copied" : ""}`}
              onClick={handleCopyCoords}
            >
              {copied === "coords" ? <><IconCheck />Kopiert!</> : <><IconPin />Koordinaten</>}
            </button>
            <button
              className={`sdp-share-btn${copied === "url" ? " copied" : ""}`}
              onClick={handleCopyUrl}
            >
              {copied === "url" ? <><IconCheck />Kopiert!</> : <><IconShare />Link</>}
            </button>
            {hasNativeShare && (
              <button className="sdp-share-btn sdp-share-native" onClick={handleNativeShare}>
                <span style={{ fontSize: 12 }}>↗</span><span>Teilen</span>
              </button>
            )}
          </div>
        </div>

        {/* Fly-Check mini */}
        {flyBadge && (
          <div className="sdp-flycheck-row">
            <span className="sdp-flycheck-label">Fly-Check</span>
            <span
              className="sdp-flycheck-badge"
              style={{ color: flyBadge.color, background: flyBadge.color + "18", borderColor: flyBadge.color + "44" }}
            >
              {flyBadge.emoji} {flyBadge.label}
            </span>
            <span className="sdp-flycheck-hint">↑ Details in Sidebar</span>
          </div>
        )}
      </div>
    </div>
  );
}
