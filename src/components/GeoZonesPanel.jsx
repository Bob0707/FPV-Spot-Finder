import React, { useRef, useState, useMemo } from "react";
import {
  IconInfo,
  IconWarning,
  IconSpinner,
  IconRefresh,
  IconExternal,
  IconCloud,
} from "./Icons.jsx";

// Colour + label per semantic zoneType — matches the classifier in
// lib/geozones.js. Anything not in this table falls back to the muted default.
const ZONE_META = {
  prohibited: { color: "#ef4444", label: "Flugverbot" },
  restricted: { color: "#f59e0b", label: "Beschränkt" },
  danger:     { color: "#f97316", label: "Gefahr" },
  REA:        { color: "#60a5fa", label: "REA" },
  nature:     { color: "#22d3a7", label: "Naturschutz" },
};

function formatAlt(m) {
  if (m == null) return null;
  if (m <= 0) return "GND";
  return `${Math.round(m)} m`;
}

function ZoneBadge({ zoneType }) {
  const meta = ZONE_META[zoneType] || { color: "#94a3b8", label: zoneType || "?" };
  return (
    <span
      className="az-stat-chip"
      style={{
        color: meta.color,
        borderColor: meta.color + "55",
        background: meta.color + "18",
      }}
    >
      {meta.label}
    </span>
  );
}

export function GeoZonesPanel({
  geoZoneFeatures,
  loadingGeoZones,
  geoZoneError,
  showGeoZones,
  onShowGeoZonesToggle,
  onLoadFile,
  filterRelevantOnly,
  onFilterToggle,
}) {
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const features = geoZoneFeatures || [];
  const hasZones = features.length > 0;

  const handleFile = (file) => {
    if (!file) return;
    onLoadFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer?.files?.[0]);
  };

  const typeCounts = useMemo(() => {
    const c = {};
    features.forEach((f) => {
      const t = f.properties?.zoneType || "other";
      c[t] = (c[t] || 0) + 1;
    });
    return c;
  }, [features]);

  return (
    <div className="airspace-panel">
      {/* Map-toggle */}
      <div className="airspace-toggle-row">
        <div className="airspace-toggle-left">
          <span className="airspace-toggle-icon">🚫</span>
          <div className="airspace-toggle-info">
            <span className="airspace-toggle-name">UAS-Geozonen</span>
            <span className="airspace-toggle-desc">dipul.de · Flugverbote · Beschränkungen</span>
          </div>
          {hasZones && !loadingGeoZones && (
            <span
              className="az-count-badge"
              style={{ background: "#ef444418", color: "#ef4444", borderColor: "#ef444440" }}
            >
              {features.length}
            </span>
          )}
        </div>
        <button
          className={`overlay-toggle ${showGeoZones ? "active" : ""}`}
          style={{ "--toggle-color": "#ef4444" }}
          onClick={onShowGeoZonesToggle}
          disabled={!hasZones}
          title={hasZones ? "" : "Zuerst KML hochladen"}
        />
      </div>

      {/* Status */}
      <div className="airspace-status-block">
        {loadingGeoZones && (
          <div className="az-loading"><IconSpinner /> GeoZonen werden geladen…</div>
        )}
        {!loadingGeoZones && geoZoneError && (
          <div className="az-error"><IconWarning /> {geoZoneError}</div>
        )}
        {!loadingGeoZones && !geoZoneError && !hasZones && (
          <div className="az-hint">Keine GeoZonen geladen</div>
        )}
        {!loadingGeoZones && !geoZoneError && hasZones && (
          <div className="az-stats-row" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {Object.entries(typeCounts).map(([t, n]) => {
              const meta = ZONE_META[t] || { color: "#94a3b8", label: t };
              return (
                <div
                  key={t}
                  className="az-stat-chip"
                  style={{
                    color: meta.color,
                    borderColor: meta.color + "55",
                    background: meta.color + "18",
                  }}
                >
                  <span>{meta.label}</span>
                  <span>{n}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Drag&Drop + File-Upload */}
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          padding: "14px 10px",
          background: dragOver ? "var(--accent-dim)" : "var(--bg-card)",
          border: `1px dashed ${dragOver ? "var(--accent)" : "var(--border-light)"}`,
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
          transition: "all .15s",
          textAlign: "center",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".kml,application/vnd.google-earth.kml+xml,application/xml,text/xml"
          style={{ display: "none" }}
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <IconCloud />
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
          KML von dipul.de hochladen
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.4 }}>
          Datei hier ablegen oder klicken zum Auswählen
        </div>
      </label>

      {/* Filter-Checkbox */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
          fontSize: 11,
          color: "var(--text-secondary)",
        }}
      >
        <input
          type="checkbox"
          checked={filterRelevantOnly}
          onChange={(e) => onFilterToggle(e.target.checked)}
          style={{ accentColor: "var(--accent)", cursor: "pointer" }}
        />
        <span style={{ flex: 1 }}>Nur UAS-relevante Zonen (≤ 120 m AGL)</span>
      </label>

      {/* Zone-Liste */}
      {hasZones && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            maxHeight: 260,
            overflowY: "auto",
            padding: 2,
          }}
        >
          {features.map((f, idx) => {
            const p = f.properties || {};
            const lower = formatAlt(p.lowerLimitM);
            const upper = formatAlt(p.upperLimitM);
            const altRange = lower && upper
              ? `${lower} – ${upper}`
              : lower ? `ab ${lower}`
              : upper ? `bis ${upper}`
              : null;
            return (
              <div
                key={p.id ?? idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  minWidth: 0,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={p.name}
                  >
                    {p.name || "(ohne Name)"}
                  </div>
                  {altRange && (
                    <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                      {altRange}
                    </div>
                  )}
                </div>
                <ZoneBadge zoneType={p.zoneType} />
              </div>
            );
          })}
        </div>
      )}

      {/* Hinweis + Download-Link */}
      <div className="airspace-legal-note">
        <IconInfo />
        <span>
          Offizielle GeoZonen herunterladen:{" "}
          <a
            href="https://maptool-dipul.dfs.de"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--info)", textDecoration: "none", whiteSpace: "nowrap" }}
          >
            maptool-dipul.dfs.de <IconExternal />
          </a>
        </span>
      </div>
    </div>
  );
}
