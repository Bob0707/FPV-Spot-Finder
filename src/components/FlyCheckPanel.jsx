import React, { useState } from "react";
import { SPOT_TYPES, GENERAL_RULES, VERDICT_CONFIG } from "../lib/constants.js";
import { getScoreColor } from "../lib/scoring.js";
import { formatAltLimit } from "../lib/airspace.js";
import { IconWarning, IconInfo, IconSpinner } from "./Icons.jsx";
import { AmpelLight } from "./AmpelLight.jsx";

const SOURCE_LABELS = { dipul: "dipul/DFS", openAip: "OpenAIP", nature: "Naturschutz" };

function getDipulHitDisplay(hit) {
  const props = hit.properties || {};
  const layer = (hit.layerName || "").toLowerCase();
  const name =
    props.name || props.NAME ||
    props.bezeichnung || props.BEZEICHNUNG ||
    props.title || props.TITLE ||
    "Unbekannte Zone";
  const typeLabel = layer.includes("verbot")
    ? "Flugverbotszone"
    : layer.includes("kontroll")
    ? "Kontrollzone"
    : layer.includes("beschr")
    ? "Beschränkungsgebiet"
    : layer.includes("naturschutz")
    ? "Naturschutzgebiet"
    : layer.includes("landesrecht")
    ? "Landesrechtl. Zone"
    : layer.includes("information") || layer.includes("fir") || layer.includes("uir")
    ? "Informationsgebiet"
    : hit.layerName?.split(":")?.[1] || "Geozone";
  const level = layer.includes("verbot")
    ? "red"
    : layer.includes("information") || layer.includes("fir") || layer.includes("uir")
    ? "info"
    : "yellow";
  const hLow = props.lowerAlt ?? props.lower_alt ?? props.minalt ?? props.MINALT ?? null;
  const hHigh = props.upperAlt ?? props.upper_alt ?? props.maxalt ?? props.MAXALT ?? null;
  return { name, typeLabel, level, hLow, hHigh };
}

// ── FlyCheckPanel ──────────────────────────────────────────────────────────
export default function FlyCheckPanel({
  selectedSpot,
  flyCheckResult,
  loading,
  airspaceLoaded,
  naturschutzLoaded,
  geoZonesLoaded,
}) {
  const [showRules, setShowRules] = useState(false);
  const [showDipulDetails, setShowDipulDetails] = useState(false);
  const dataLoaded = airspaceLoaded || naturschutzLoaded || geoZonesLoaded;

  if (!selectedSpot) {
    return (
      <div className="flychk-empty">
        <span className="flychk-empty-icon">🎯</span>
        <span className="flychk-empty-title">Kein Spot ausgewählt</span>
        <span className="flychk-empty-sub">
          Klicke einen Spot auf der Karte an, um den Fly-Check zu starten.
        </span>
      </div>
    );
  }

  const spotName =
    selectedSpot.properties?.name ||
    SPOT_TYPES.find((s) => s.id === selectedSpot.properties?.spotType)?.name ||
    "Unbekannter Spot";

  const result = flyCheckResult;
  const vc = result ? VERDICT_CONFIG[result.verdict] : null;

  return (
    <div className="flychk-panel">
      {/* Spot Badge */}
      <div className="flychk-spot-badge">
        <span style={{ fontSize: 14 }}>
          {SPOT_TYPES.find((s) => s.id === selectedSpot.properties?.spotType)?.icon || "📍"}
        </span>
        <span className="flychk-spot-name">{spotName}</span>
        <span className="flychk-spot-score" style={{ color: getScoreColor(selectedSpot.properties?.score ?? 0) }}>
          Score {selectedSpot.properties?.score ?? "?"}
        </span>
      </div>

      {/* Loading-State */}
      {loading && (
        <div className="az-loading" style={{ padding: "6px 0" }}>
          <IconSpinner /> Prüfe offizielle Geozonen…
        </div>
      )}

      {/* Data coverage warning */}
      {!loading && !dataLoaded && (
        <div className="flychk-warn-banner">
          <IconWarning />
          <span>
            Luftraum- oder Naturschutzdaten noch nicht geladen — Prüfung unvollständig.
            Im Luftraum-Panel laden.
          </span>
        </div>
      )}

      {/* Ampel + Verdict */}
      {result && (
        <>
          <div className="flychk-ampel-row">
            <div className="flychk-ampel-housing">
              <AmpelLight color="red"    active={result.verdict === "red"} />
              <AmpelLight color="yellow" active={result.verdict === "yellow"} />
              <AmpelLight color="green"  active={result.verdict === "green"} />
            </div>
            <div
              className="flychk-verdict-block"
              style={{ "--vc-bg": vc.dim, "--vc-border": vc.border, "--vc-color": vc.bg }}
            >
              <span className="flychk-verdict-emoji">{vc.emoji}</span>
              <div className="flychk-verdict-texts">
                <span className="flychk-verdict-label" style={{ color: vc.bg }}>{vc.label}</span>
                <span className="flychk-verdict-sub">{vc.sub}</span>
              </div>
            </div>
          </div>

          {/* Zone hits */}
          {result.hits.length > 0 && (
            <div className="flychk-hits">
              <div className="flychk-hits-title">Betroffene Zonen ({result.hits.length})</div>
              {result.hits.map((h, i) => {
                const borderColor = h.level === "red" ? "#ef4444" : "#f59e0b";
                const bgColor = h.level === "red" ? "rgba(239,68,68,.08)" : "rgba(245,158,11,.08)";
                return (
                  <div key={i} className="flychk-hit" style={{ borderLeftColor: borderColor, background: bgColor }}>
                    <div className="flychk-hit-top">
                      <span
                        className="flychk-hit-code"
                        style={{ background: borderColor + "22", color: borderColor, borderColor: borderColor + "55" }}
                      >
                        {h.code}
                      </span>
                      <span className="flychk-hit-name">{h.name}</span>
                      <span className={`flychk-hit-level ${h.level}`}>
                        {h.level === "red" ? "🔴" : "🟡"}
                      </span>
                    </div>
                    <div className="flychk-hit-msg">{h.msg}</div>
                    {(h.lowerLimit || h.upperLimit) && (
                      <div className="flychk-hit-alt">
                        {formatAltLimit(h.lowerLimit)} – {formatAltLimit(h.upperLimit)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* dipul GeoZonen Details – aufklappbar */}
          {result.geoZoneHits?.length > 0 && (
            <div className="flychk-rules-block" style={{ marginTop: 4 }}>
              <button
                className="flychk-rules-toggle"
                onClick={() => setShowDipulDetails((v) => !v)}
              >
                <span>dipul/DFS Rohdaten ({result.geoZoneHits.length})</span>
                <span
                  className="flychk-rules-chevron"
                  style={{ transform: showDipulDetails ? "rotate(180deg)" : "none" }}
                >
                  ▾
                </span>
              </button>
              {showDipulDetails && (
                <div className="flychk-rules-list">
                  {result.geoZoneHits.map((hit, i) => {
                    const { name, typeLabel, level, hLow, hHigh } = getDipulHitDisplay(hit);
                    const borderColor =
                      level === "red" ? "#ef4444" : level === "info" ? "#64748b" : "#f59e0b";
                    const bgColor =
                      level === "red"
                        ? "rgba(239,68,68,.08)"
                        : level === "info"
                        ? "rgba(100,116,139,.06)"
                        : "rgba(245,158,11,.08)";
                    return (
                      <div
                        key={i}
                        className="flychk-hit"
                        style={{ borderLeftColor: borderColor, background: bgColor }}
                      >
                        <div className="flychk-hit-top">
                          <span className="flychk-hit-name">{name}</span>
                        </div>
                        <div className="flychk-hit-msg" style={{ color: "var(--text-muted)" }}>
                          {typeLabel}
                        </div>
                        {(hLow != null || hHigh != null) && (
                          <div className="flychk-hit-alt">
                            {hLow != null ? `${hLow} m` : "GND"} –{" "}
                            {hHigh != null ? `${hHigh} m` : "UNL"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {result.hits.length === 0 && result.verdict === "green" && (
            <div className="flychk-clear">
              <span>✓</span>
              <span>
                Keine Einschränkungen durch geladene Luftraumzonen oder Naturschutzgebiete gefunden.
              </span>
            </div>
          )}

          {/* Quellen-Badges */}
          {result.sources && (
            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                padding: "6px 0 2px",
                borderTop: "1px solid var(--border)",
                marginTop: 6,
              }}
            >
              {Object.entries(result.sources).map(([key, val]) => {
                const ok = val.startsWith("✓");
                const label = SOURCE_LABELS[key] || key.toUpperCase();
                return (
                  <span
                    key={key}
                    style={{
                      fontSize: 9,
                      fontFamily: "var(--font-mono)",
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: ok ? "rgba(34,211,167,.1)" : "rgba(148,163,184,.08)",
                      color: ok ? "#22d3a7" : "var(--text-muted)",
                      border: `1px solid ${ok ? "rgba(34,211,167,.25)" : "var(--border)"}`,
                    }}
                  >
                    {ok ? "✓" : "✗"} {label}
                  </span>
                );
              })}
            </div>
          )}

          {/* Fallback-Hinweis wenn dipul nicht geprüft werden konnte */}
          {!result.dipulChecked && (
            <div
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                padding: "4px 0 2px",
                lineHeight: 1.4,
              }}
            >
              ⚠ dipul-Geozonen konnten nicht geprüft werden.{" "}
              <a
                href="https://maptool-dipul.dfs.de"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)", textDecoration: "underline" }}
              >
                Prüfe manuell auf maptool-dipul.dfs.de
              </a>
            </div>
          )}
        </>
      )}

      {/* General §21h rules (collapsible) */}
      <div className="flychk-rules-block">
        <button className="flychk-rules-toggle" onClick={() => setShowRules((v) => !v)}>
          <span>§21h LuftVO — Allgemeine Regeln</span>
          <span className="flychk-rules-chevron" style={{ transform: showRules ? "rotate(180deg)" : "none" }}>▾</span>
        </button>
        {showRules && (
          <div className="flychk-rules-list">
            {GENERAL_RULES.map((r, i) => (
              <div key={i} className="flychk-rule-item">
                <span className="flychk-rule-icon">{r.icon}</span>
                <div className="flychk-rule-texts">
                  <span className="flychk-rule-title">{r.title}</span>
                  <span className="flychk-rule-detail">{r.detail}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="flychk-disclaimer">
        <IconInfo /> Nur zur Orientierung. Vor jedem Flug aktuelle Rechtslage prüfen: DFS AIS, LBA, AustroControl, BAZL.
      </div>
    </div>
  );
}
