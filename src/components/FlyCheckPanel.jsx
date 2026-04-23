import React, { useState } from "react";
import { SPOT_TYPES, GENERAL_RULES, VERDICT_CONFIG } from "../lib/constants.js";
import { getScoreColor } from "../lib/scoring.js";
import { formatAltLimit } from "../lib/airspace.js";
import { IconWarning, IconInfo } from "./Icons.jsx";
import { AmpelLight } from "./AmpelLight.jsx";

// ── FlyCheckPanel ──────────────────────────────────────────────────────────
export default function FlyCheckPanel({
  selectedSpot,
  flyCheckResult,
  airspaceLoaded,
  naturschutzLoaded,
  geoZonesLoaded,
}) {
  const [showRules, setShowRules] = useState(false);
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

      {/* Data coverage warning */}
      {!dataLoaded && (
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

          {result.hits.length === 0 && result.verdict === "green" && (
            <div className="flychk-clear">
              <span>✓</span>
              <span>
                Keine Einschränkungen durch geladene Luftraumzonen oder Naturschutzgebiete gefunden.
              </span>
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
