import React, { useState, useMemo } from "react";
import { SPOT_TYPES, ALL_SPOT_TYPE_IDS } from "../lib/constants.js";
import { getScoreColor } from "../lib/scoring.js";
import { IconHeatmap, IconRefresh, IconExternal } from "./Icons.jsx";

// ── Local sub-component ────────────────────────────────────────────────────
function ScoreMiniBar({ score, color }) {
  return (
    <div className="score-mini-bar-track">
      <div className="score-mini-bar-fill" style={{ width: `${score}%`, background: color }} />
    </div>
  );
}

// ── SpotFilterPanel ────────────────────────────────────────────────────────
export default function SpotFilterPanel({
  spots,
  activeSpotTypes,
  onToggle,
  onRefetch,
  loading,
  hasSearch,
  debugInfo,
  scoreMin,
  onScoreMinChange,
  showHeatmap,
  onHeatmapToggle,
  queryTypes,
  onQueryTypesChange,
  lastFetchedTypes,
  onRefetchWithTypes,
}) {
  const [showDebug, setShowDebug] = useState(false);

  const queryDirty = useMemo(() => {
    if (!lastFetchedTypes) return false;
    return [...queryTypes].sort().join(",") !== [...lastFetchedTypes].sort().join(",");
  }, [queryTypes, lastFetchedTypes]);

  const toggleQT = (id) =>
    onQueryTypesChange((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const typeStats = useMemo(() => {
    const s = {};
    SPOT_TYPES.forEach((st) => (s[st.id] = { total: 0, filtered: 0, avgScore: 0, scoreSum: 0 }));
    spots.forEach((f) => {
      const t = f.properties?.spotType;
      const sc = f.properties?.score ?? 0;
      if (!t || !s[t]) return;
      s[t].total++;
      s[t].scoreSum += sc;
      if (sc >= scoreMin) s[t].filtered++;
    });
    SPOT_TYPES.forEach((st) => {
      const x = s[st.id];
      x.avgScore = x.total > 0 ? Math.round(x.scoreSum / x.total) : 0;
    });
    return s;
  }, [spots, scoreMin]);

  const total = spots.length;
  const visible = useMemo(
    () => spots.filter((f) => (f.properties?.score ?? 0) >= scoreMin).length,
    [spots, scoreMin]
  );
  const avgScore = useMemo(
    () => (!spots.length ? 0 : Math.round(spots.reduce((a, f) => a + (f.properties?.score ?? 0), 0) / spots.length)),
    [spots]
  );

  const PRESETS = [
    { label: "Alle", min: 0 },
    { label: "45+", min: 45 },
    { label: "65+", min: 65 },
    { label: "80+", min: 80 },
  ];

  if (!hasSearch) {
    return (
      <div className="filter-hint">
        <span className="filter-hint-icon">🔍</span>
        <span>Starte zuerst eine Ortssuche, um FPV-Spots zu laden.</span>
      </div>
    );
  }

  return (
    <div className="spot-filter-panel">
      {/* API query types */}
      <div className="query-types-block">
        <div className="query-types-header">
          <span className="query-types-title">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>{" "}
            API-Abfrage
          </span>
          <span className="query-types-hint">
            {queryTypes.length === ALL_SPOT_TYPE_IDS.length
              ? "Alle Kategorien"
              : `${queryTypes.length} von ${ALL_SPOT_TYPE_IDS.length}`}
          </span>
        </div>
        <div className="query-type-chips">
          {SPOT_TYPES.map((st) => {
            const active = queryTypes.includes(st.id);
            return (
              <button
                key={st.id}
                className={`qt-chip ${active ? "active" : ""}`}
                style={{ "--qt-color": st.color }}
                onClick={() => toggleQT(st.id)}
                disabled={loading}
                title={st.shortDesc}
              >
                <span className="qt-icon">{st.icon}</span>
                <span className="qt-label">{st.name}</span>
                {!active && <span className="qt-off">–</span>}
              </button>
            );
          })}
        </div>
        {queryDirty && !loading && (
          <button className="query-reload-banner" onClick={() => onRefetchWithTypes(queryTypes)}>
            <IconRefresh />
            <span>Kategorien geändert — neu laden</span>
          </button>
        )}
        {!lastFetchedTypes && !loading && hasSearch && (
          <div className="query-types-note">Wird beim nächsten Fetch berücksichtigt</div>
        )}
      </div>

      {/* Summary row */}
      <div className="spots-summary">
        {loading ? (
          <div className="spots-loading-skeleton">
            <div className="skel-row">
              <div className="skel-block skel-num" />
              <div className="skel-block skel-text" />
            </div>
            <div className="skel-row">
              {[1, 2, 3].map((i) => <div key={i} className="skel-block skel-chip" />)}
            </div>
          </div>
        ) : (
          <>
            <div className="spots-count-row">
              <span className="spots-total-num">{visible}</span>
              <span className="spots-total-label">
                {total === 0 ? "Keine Spots gefunden" : `von ${total} Spots`}
              </span>
              {total > 0 && (
                <span className="spots-avg-score" style={{ color: getScoreColor(avgScore) }}>
                  Ø {avgScore}
                </span>
              )}
            </div>
            <button className="spots-refresh-btn" onClick={onRefetch}>
              <IconRefresh />
            </button>
          </>
        )}
      </div>

      {/* Empty state */}
      {!loading && total === 0 && hasSearch && (
        <div className="spots-empty-state">
          <span className="spots-empty-icon">🔎</span>
          <span className="spots-empty-title">Keine Spots im Suchbereich</span>
          <div className="spots-empty-hints">
            <span>
              💡 Suchradius vergrößern (aktuell max.{" "}
              {queryTypes.length < ALL_SPOT_TYPE_IDS.length
                ? "oder mehr Kategorien aktivieren"
                : "alle Kategorien aktiv"}
              )
            </span>
            <span>💡 Anderen Standort suchen</span>
            <span>💡 Ländliche Gebiete haben oft mehr Spots</span>
          </div>
          <button className="spots-empty-retry" onClick={onRefetch}>
            <IconRefresh /> Erneut suchen
          </button>
        </div>
      )}

      {/* Score filter */}
      {!loading && total > 0 && (
        <div className="score-filter-block">
          <div className="score-filter-header">
            <span className="score-filter-title">
              <IconHeatmap /> Min. Remoteness Score
            </span>
            <span className="score-filter-value" style={{ color: getScoreColor(scoreMin || 1) }}>
              {scoreMin === 0 ? "Alle" : `${scoreMin}+`}
            </span>
          </div>
          <div className="score-ramp">
            <div className="score-ramp-bar" />
            <input
              type="range"
              min="0"
              max="90"
              step="5"
              value={scoreMin}
              onChange={(e) => onScoreMinChange(parseInt(e.target.value))}
              className="score-slider"
            />
          </div>
          <div className="score-preset-row">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                className={`score-preset-btn ${scoreMin === p.min ? "active" : ""}`}
                onClick={() => onScoreMinChange(p.min)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="score-legend">
            {[
              { color: "#60a5fa", label: "Urban" },
              { color: "#22d3a7", label: "Mittel" },
              { color: "#f59e0b", label: "Abgelegen" },
              { color: "#ef4444", label: "Sehr abgelegen" },
            ].map(({ color, label }) => (
              <div key={label} className="score-legend-item">
                <span className="score-legend-dot" style={{ background: color }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Heatmap toggle */}
      {!loading && total > 0 && (
        <div className="heatmap-toggle-row">
          <div className="heatmap-toggle-info">
            <span className="heatmap-toggle-icon">🔥</span>
            <span className="heatmap-toggle-label">Heatmap</span>
            <span className="heatmap-toggle-desc">Score-Dichte auf Karte</span>
          </div>
          <button
            className={`overlay-toggle ${showHeatmap ? "active" : ""}`}
            onClick={onHeatmapToggle}
            style={{ "--toggle-color": "#a78bfa" }}
          />
        </div>
      )}

      {/* Filter chips */}
      <div className="filter-grid">
        {SPOT_TYPES.map((st) => {
          const active = activeSpotTypes.includes(st.id);
          const stats = typeStats[st.id];
          const count = stats.filtered;
          const isEmpty = count === 0 && !loading;
          return (
            <button
              key={st.id}
              className={`filter-chip ${active ? "active" : ""} ${isEmpty ? "empty" : ""}`}
              style={{ "--chip-color": st.color }}
              onClick={() => onToggle(st.id)}
              disabled={loading}
            >
              <span className="chip-icon">{st.icon}</span>
              <span className="chip-body">
                <span className="chip-name">{st.name}</span>
                {!loading && stats.total > 0 && (
                  <ScoreMiniBar
                    score={stats.avgScore}
                    color={active ? st.color : "var(--text-muted)"}
                  />
                )}
              </span>
              {!loading && (
                <span className="chip-count-wrap">
                  <span
                    className="chip-count"
                    style={{
                      background: active ? st.color + "33" : undefined,
                      color: active ? st.color : undefined,
                    }}
                  >
                    {count}
                  </span>
                  {stats.total > 0 && (
                    <span className="chip-avg" style={{ color: getScoreColor(stats.avgScore) }}>
                      {stats.avgScore}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* All on/off actions */}
      {!loading && total > 0 && (
        <div className="filter-actions">
          <button
            className="filter-action-btn"
            onClick={() => SPOT_TYPES.forEach((st) => !activeSpotTypes.includes(st.id) && onToggle(st.id))}
          >
            Alle ein
          </button>
          <button
            className="filter-action-btn"
            onClick={() => SPOT_TYPES.forEach((st) => activeSpotTypes.includes(st.id) && onToggle(st.id))}
          >
            Alle aus
          </button>
        </div>
      )}

      {/* Debug panel */}
      {!loading && debugInfo && (
        <div className="debug-panel">
          <button className="debug-toggle-btn" onClick={() => setShowDebug((v) => !v)}>
            <span>🔧 Debug</span>
            <span style={{ fontSize: 10, transform: showDebug ? "rotate(180deg)" : "none", transition: "transform .2s" }}>▾</span>
          </button>
          {showDebug && (
            <>
              <div className="debug-row">
                <span className="debug-label">OSM-Rohwerte</span>
                <span className={`debug-value ${debugInfo.rawCount === 0 ? "debug-zero" : "debug-ok"}`}>
                  {debugInfo.rawCount}
                </span>
              </div>
              <div className="debug-row">
                <span className="debug-label">Klassifiziert</span>
                <span className={`debug-value ${debugInfo.classified === 0 ? "debug-zero" : "debug-ok"}`}>
                  {debugInfo.classified}
                </span>
              </div>
              {debugInfo.remark && <div className="debug-remark">{debugInfo.remark}</div>}
              {debugInfo.turboUrl && (
                <a
                  href={debugInfo.turboUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="debug-turbo-btn"
                >
                  <IconExternal /> In Overpass Turbo testen →
                </a>
              )}
              {debugInfo.rawCount === 0 && (
                <div className="debug-hint">→ Browser-Konsole (F12) öffnen</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
