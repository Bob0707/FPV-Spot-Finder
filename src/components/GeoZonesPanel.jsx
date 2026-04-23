import React, { useState } from "react";
import { IconInfo, IconWarning, IconSpinner, IconCloud, IconExternal } from "./Icons.jsx";
import { DIPUL_LAYERS } from "../lib/dipulWms.js";

function layerDotColor(name) {
  if (name.includes("kontroll")) return "#ef4444";
  if (name.includes("beschraenkung") || name.includes("beschränkung")) return "#f97316";
  if (name.includes("naturschutz")) return "#22d3a7";
  if (name.includes("landesrecht")) return "#8b5cf6";
  return "#94a3b8";
}

const presetButtonStyle = {
  flex: 1,
  fontSize: 10,
  padding: "4px 6px",
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

const externalLinkStyle = {
  color: "var(--info)",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

function LayerGroup({ title, groupColor, layers, active, onToggle }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: ".5px",
          color: groupColor,
          paddingLeft: 2,
        }}
      >
        {title}
      </div>
      {layers.map((l) => {
        const isActive = active.includes(l.name);
        const dot = layerDotColor(l.name);
        return (
          <label
            key={l.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 8px",
              background: "var(--bg-card)",
              border: `1px solid ${isActive ? groupColor + "55" : "var(--border)"}`,
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              fontSize: 11,
              transition: "border-color .15s",
            }}
          >
            <input
              type="checkbox"
              checked={isActive}
              onChange={() => onToggle(l.name)}
              style={{ accentColor: groupColor, cursor: "pointer", flexShrink: 0 }}
            />
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: dot,
                flexShrink: 0,
                opacity: isActive ? 1 : 0.3,
              }}
            />
            <div
              style={{
                fontWeight: isActive ? 600 : 400,
                color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                minWidth: 0,
              }}
              title={l.title || l.name}
            >
              {l.title || l.name}
            </div>
          </label>
        );
      })}
    </div>
  );
}

export function GeoZonesPanel({
  wmsAvailable,
  availableLayers,
  activeLayers,
  onLayersChange,
  showGeoZones,
  onShowGeoZonesToggle,
  opacity,
  onOpacityChange,
  onLoadFile,
  geoZoneFeatures,
  loadingGeoZones,
  geoZoneError,
}) {
  const [dragOver, setDragOver] = useState(false);

  const layers = availableLayers || [];
  const active = activeLayers || [];
  const fallbackCount = (geoZoneFeatures || []).length;
  const corsBlocked = wmsAvailable === false;
  const op = opacity ?? 0.5;

  const toggleLayer = (name) =>
    onLayersChange(
      active.includes(name) ? active.filter((n) => n !== name) : [...active, name]
    );

  const handleFile = (file) => { if (file) onLoadFile(file); };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer?.files?.[0]);
  };

  const restrictionLayers = layers.filter((l) => !DIPUL_LAYERS.irrelevant.includes(l.name));
  const infoLayers = layers.filter((l) => DIPUL_LAYERS.irrelevant.includes(l.name));

  const relevantNames = layers
    .filter((l) => DIPUL_LAYERS.relevant.includes(l.name))
    .map((l) => l.name);

  return (
    <div className="airspace-panel">
      {/* ── Header-Zeile ── */}
      <div className="airspace-toggle-row">
        <div className="airspace-toggle-left">
          <span className="airspace-toggle-icon">🗺</span>
          <div className="airspace-toggle-info">
            <span className="airspace-toggle-name">UAS-Geozonen (dipul)</span>
            <span className="airspace-toggle-desc">Flugverbote · Beschränkungen · WMS</span>
          </div>
          {wmsAvailable === true && (
            <span
              className="az-count-badge"
              style={{ background: "#22d3a718", color: "#22d3a7", borderColor: "#22d3a740" }}
            >
              Live
            </span>
          )}
          {corsBlocked && (
            <span
              className="az-count-badge"
              style={{ background: "#6b728018", color: "#94a3b8", borderColor: "#6b728040" }}
            >
              Offline
            </span>
          )}
        </div>
        <button
          className={`overlay-toggle ${showGeoZones ? "active" : ""}`}
          style={{ "--toggle-color": "#ef4444" }}
          onClick={onShowGeoZonesToggle}
          disabled={wmsAvailable !== true && fallbackCount === 0}
          title={wmsAvailable !== true && fallbackCount === 0 ? "WMS nicht verfügbar" : ""}
        />
      </div>

      {/* ── Lade-Status ── */}
      {wmsAvailable === null && (
        <div className="az-loading"><IconSpinner /> Verbinde mit dipul WMS…</div>
      )}
      {wmsAvailable === true && layers.length === 0 && (
        <div className="az-loading"><IconSpinner /> Lade Layer…</div>
      )}

      {/* ── Layer-Liste ── */}
      {wmsAvailable === true && layers.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 5 }}>
            <button
              onClick={() => onLayersChange(relevantNames)}
              disabled={relevantNames.length === 0}
              style={{ ...presetButtonStyle, opacity: relevantNames.length === 0 ? 0.5 : 1 }}
            >
              Alle relevanten
            </button>
            <button onClick={() => onLayersChange(layers.map((l) => l.name))} style={presetButtonStyle}>
              Alle
            </button>
          </div>

          {restrictionLayers.length > 0 && (
            <LayerGroup
              title="Flugbeschränkungen"
              groupColor="#ef4444"
              layers={restrictionLayers}
              active={active}
              onToggle={toggleLayer}
            />
          )}
          {infoLayers.length > 0 && (
            <LayerGroup
              title="Informationsgebiete"
              groupColor="#6b7280"
              layers={infoLayers}
              active={active}
              onToggle={toggleLayer}
            />
          )}
        </>
      )}

      {/* ── Transparenz-Slider ── */}
      {wmsAvailable === true && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>Transparenz</span>
          {/* 0.2–0.8: Zonen bleiben sichtbar, verdecken Basiskarte aber nie ganz */}
          <input
            type="range"
            min={0.2}
            max={0.8}
            step={0.05}
            value={op}
            onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
            style={{ flex: 1, accentColor: "var(--accent)" }}
          />
          <span style={{ fontSize: 11, color: "var(--text-muted)", width: 32, textAlign: "right" }}>
            {Math.round(op * 100)}%
          </span>
        </div>
      )}

      {/* ── Fallback (nur wenn CORS blockiert) ── */}
      {corsBlocked && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="az-error" style={{ alignItems: "flex-start", lineHeight: 1.5 }}>
            <IconWarning style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Der WMS-Dienst ist nicht direkt erreichbar.{" "}
              <a
                href="https://maptool-dipul.dfs.de"
                target="_blank"
                rel="noopener noreferrer"
                style={externalLinkStyle}
              >
                Zonen auf dipul.de ansehen <IconExternal />
              </a>
            </span>
          </div>

          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
              padding: "12px 10px",
              background: dragOver ? "var(--accent-dim)" : "var(--bg-card)",
              border: `1px dashed ${dragOver ? "var(--accent)" : "var(--border-light)"}`,
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              transition: "all .15s",
              textAlign: "center",
            }}
          >
            <input
              type="file"
              accept=".kml,application/vnd.google-earth.kml+xml,application/xml,text/xml"
              style={{ display: "none" }}
              onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }}
            />
            <IconCloud />
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>
              KML-Datei hochladen
            </div>
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              Von dipul.de herunterladen und hier ablegen
            </div>
          </label>

          {(loadingGeoZones || geoZoneError || fallbackCount > 0) && (
            <div className="airspace-status-block">
              {loadingGeoZones && (
                <div className="az-loading"><IconSpinner /> KML wird geladen…</div>
              )}
              {!loadingGeoZones && geoZoneError && (
                <div className="az-error"><IconWarning /> {geoZoneError}</div>
              )}
              {!loadingGeoZones && !geoZoneError && fallbackCount > 0 && (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {fallbackCount} Zonen aus KML geladen
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Quellenangabe ── */}
      <div className="airspace-legal-note">
        <IconInfo />
        <span>
          Quelle Geodaten: DFS, BKG 2026 ·{" "}
          <a
            href="https://www.dipul.de"
            target="_blank"
            rel="noopener noreferrer"
            style={externalLinkStyle}
          >
            dipul.de <IconExternal />
          </a>
        </span>
      </div>
    </div>
  );
}
