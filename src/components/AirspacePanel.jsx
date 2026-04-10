import React, { useState, useMemo, useEffect } from "react";
import { AIRSPACE_TYPES, NATURSCHUTZ_COLOR } from "../lib/constants.js";
import { IconKey, IconEye, IconEyeOff, IconCheck, IconWarning, IconSpinner, IconRefresh, IconInfo } from "./Icons.jsx";

export function AirspacePanel({
  apiKey,
  onSaveKey,
  showAirspace,
  onShowAirspaceToggle,
  showNaturschutz,
  onShowNaturschutzToggle,
  airspaceFeatures,
  naturschutzFeatures,
  loadingAirspace,
  loadingNaturschutz,
  airspaceError,
  naturschutzError,
  hasSearch,
  onFetchAirspace,
  onFetchNaturschutz,
}) {
  const [keyInput, setKeyInput] = useState(apiKey || "");
  const [keyVisible, setKeyVisible] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  useEffect(() => setKeyInput(apiKey || ""), [apiKey]);

  const handleSaveKey = () => {
    onSaveKey(keyInput.trim());
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2500);
  };

  const zoneCounts = useMemo(() => {
    const c = {};
    airspaceFeatures.forEach((f) => {
      const t = f.properties?.zoneType || "OTHER";
      c[t] = (c[t] || 0) + 1;
    });
    return c;
  }, [airspaceFeatures]);

  const SHOW_CODES = ["CTR", "TMA", "R", "P", "D", "TMZ", "RMZ", "ATZ", "W", "GLDR", "TIZ"];

  return (
    <div className="airspace-panel">
      {/* API Key */}
      <div className="airspace-key-block">
        <div className="airspace-key-title">
          <IconKey /> OpenAIP API-Key
          <a href="https://www.openaip.net" target="_blank" rel="noreferrer" className="airspace-key-link">
            Kostenlos registrieren →
          </a>
        </div>
        <div className="airspace-key-input-row">
          <input
            className="airspace-key-input"
            type={keyVisible ? "text" : "password"}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSaveKey()}
            placeholder="API-Key eingeben…"
            spellCheck={false}
          />
          <button className="airspace-key-eye" onClick={() => setKeyVisible(!keyVisible)}>
            {keyVisible ? <IconEyeOff /> : <IconEye />}
          </button>
          <button className="airspace-key-btn" onClick={handleSaveKey}>
            {keySaved ? <><IconCheck /> OK</> : "Speichern"}
          </button>
        </div>
        {apiKey && !keySaved && (
          <div className="airspace-key-status"><IconCheck /> Key gespeichert — bereit</div>
        )}
        {!apiKey && (
          <div className="airspace-key-note">
            Kostenloser Account auf openaip.net. Key wird lokal gespeichert.
          </div>
        )}
      </div>

      {/* Luftraumzonen Toggle */}
      <div className="airspace-toggle-row">
        <div className="airspace-toggle-left">
          <span className="airspace-toggle-icon">✈️</span>
          <div className="airspace-toggle-info">
            <span className="airspace-toggle-name">Luftraumzonen</span>
            <span className="airspace-toggle-desc">CTR · TMA · R · P · D (OpenAIP)</span>
          </div>
          {airspaceFeatures.length > 0 && !loadingAirspace && (
            <span className="az-count-badge" style={{ background: "#ef444418", color: "#ef4444", borderColor: "#ef444440" }}>
              {airspaceFeatures.length}
            </span>
          )}
        </div>
        <button
          className={`overlay-toggle ${showAirspace ? "active" : ""}`}
          style={{ "--toggle-color": "#ef4444" }}
          onClick={onShowAirspaceToggle}
        />
      </div>

      {showAirspace && (
        <div className="airspace-status-block">
          {!hasSearch && <div className="az-hint">🔍 Starte zuerst eine Ortssuche</div>}
          {hasSearch && !apiKey && <div className="az-hint az-hint-key">🔑 API-Key oben eingeben</div>}
          {hasSearch && apiKey && loadingAirspace && (
            <div className="az-loading"><IconSpinner /> Luftraumzonen werden geladen…</div>
          )}
          {hasSearch && apiKey && airspaceError && (
            <div className="az-error"><IconWarning /> {airspaceError}</div>
          )}
          {hasSearch && apiKey && !loadingAirspace && !airspaceError && airspaceFeatures.length > 0 && (
            <div className="az-stats-row">
              {SHOW_CODES.map((code) => {
                const count = zoneCounts[code] || 0;
                if (!count) return null;
                const ti = AIRSPACE_TYPES.find((t) => t.shortCode === code);
                return (
                  <div
                    key={code}
                    className="az-stat-chip"
                    style={{
                      color: ti?.color || "#888",
                      borderColor: (ti?.color || "#888") + "55",
                      background: (ti?.color || "#888") + "18",
                    }}
                  >
                    <span>{code}</span>
                    <span>{count}</span>
                  </div>
                );
              })}
              <button className="az-reload-btn" onClick={onFetchAirspace}><IconRefresh /></button>
            </div>
          )}
          {hasSearch && apiKey && !loadingAirspace && !airspaceError && airspaceFeatures.length === 0 && (
            <div className="az-hint">Keine Zonen im Suchbereich</div>
          )}
        </div>
      )}

      {/* Naturschutz Toggle */}
      <div className="airspace-toggle-row">
        <div className="airspace-toggle-left">
          <span className="airspace-toggle-icon">🌿</span>
          <div className="airspace-toggle-info">
            <span className="airspace-toggle-name">Naturschutzgebiete</span>
            <span className="airspace-toggle-desc">OSM protected_area (kein Key nötig)</span>
          </div>
          {naturschutzFeatures.length > 0 && !loadingNaturschutz && (
            <span
              className="az-count-badge"
              style={{
                background: NATURSCHUTZ_COLOR + "18",
                color: NATURSCHUTZ_COLOR,
                borderColor: NATURSCHUTZ_COLOR + "40",
              }}
            >
              {naturschutzFeatures.length}
            </span>
          )}
        </div>
        <button
          className={`overlay-toggle ${showNaturschutz ? "active" : ""}`}
          style={{ "--toggle-color": NATURSCHUTZ_COLOR }}
          onClick={onShowNaturschutzToggle}
        />
      </div>

      {showNaturschutz && (
        <div className="airspace-status-block">
          {!hasSearch && <div className="az-hint">🔍 Starte zuerst eine Ortssuche</div>}
          {hasSearch && loadingNaturschutz && (
            <div className="az-loading"><IconSpinner /> Naturschutzgebiete werden geladen…</div>
          )}
          {hasSearch && naturschutzError && (
            <div className="az-error"><IconWarning /> {naturschutzError}</div>
          )}
          {hasSearch && !loadingNaturschutz && naturschutzFeatures.length > 0 && (
            <div className="az-nsg-note">
              ⚠ Drohnenflug im Naturschutzgebiet häufig verboten oder genehmigungspflichtig.
              <button className="az-reload-btn" onClick={onFetchNaturschutz} style={{ marginLeft: "auto" }}>
                <IconRefresh />
              </button>
            </div>
          )}
          {hasSearch && !loadingNaturschutz && !naturschutzError && naturschutzFeatures.length === 0 && (
            <div className="az-hint">Keine Schutzgebiete im Suchbereich</div>
          )}
        </div>
      )}

      {/* Legend */}
      {(showAirspace || showNaturschutz) && (
        <div className="airspace-legend">
          <div className="airspace-legend-title">Legende</div>
          <div className="airspace-legend-grid">
            {showAirspace &&
              AIRSPACE_TYPES.filter((t) =>
                ["CTR", "TMA", "R", "P", "D", "TMZ", "RMZ", "ATZ", "W"].includes(t.shortCode)
              ).map((t) => (
                <div key={t.shortCode} className="airspace-legend-item">
                  <div className="airspace-legend-dot" style={{ background: t.color }} />
                  <span><b>{t.shortCode}</b> — {t.name}</span>
                </div>
              ))}
            {showNaturschutz && (
              <div className="airspace-legend-item">
                <div className="airspace-legend-dot" style={{ background: NATURSCHUTZ_COLOR }} />
                <span><b>NSG</b> — Naturschutzgebiet</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="airspace-legal-note">
        <IconInfo /> Daten zur Orientierung. Vor jedem Flug aktuelle Luftraumstruktur prüfen (DFS, AustroControl, BAZL).
      </div>
    </div>
  );
}
