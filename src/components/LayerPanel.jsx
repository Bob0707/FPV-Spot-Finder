import React from "react";
import { BASE_LAYERS, OVERLAY_LAYERS } from "../lib/constants.js";
import { IconOpacity } from "./Icons.jsx";

// ── Local sub-components ───────────────────────────────────────────────────
function LayerThumb({ color }) {
  return (
    <div
      style={{
        width: 32,
        height: 22,
        borderRadius: 4,
        flexShrink: 0,
        background: `linear-gradient(135deg,${color}33,${color}66)`,
        border: `1px solid ${color}55`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `repeating-linear-gradient(45deg,${color}18 0px,${color}18 2px,transparent 2px,transparent 8px)`,
        }}
      />
    </div>
  );
}

function OpacityRow({ layerId, value, onChange }) {
  return (
    <div className="opacity-row">
      <span className="opacity-label">
        <IconOpacity /> Deckkraft
      </span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={value}
        onChange={(e) => onChange(layerId, parseFloat(e.target.value))}
        className="opacity-slider"
      />
      <span className="opacity-value">{Math.round(value * 100)}%</span>
    </div>
  );
}

// ── LayerPanel ─────────────────────────────────────────────────────────────
export default function LayerPanel({
  activeBase,
  setActiveBase,
  activeOverlays,
  setActiveOverlays,
  overlayOpacity,
  setOverlayOpacity,
  onToast,
}) {
  const toggle = (id) => {
    setActiveOverlays((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleOp = (id, val) =>
    setOverlayOpacity((prev) => ({ ...prev, [id]: val }));

  return (
    <div className="layer-panel">
      <div className="layer-group">
        <div className="layer-group-label">
          <span>Basiskarte</span>
          <span className="layer-group-count">{BASE_LAYERS.length} verfügbar</span>
        </div>
        <div className="base-layer-list">
          {BASE_LAYERS.map((bl) => {
            const active = activeBase === bl.id;
            return (
              <button
                key={bl.id}
                className={`base-layer-card ${active ? "active" : ""}`}
                onClick={() => setActiveBase(bl.id)}
                style={{ "--layer-color": bl.color }}
              >
                <LayerThumb color={bl.color} />
                <div className="base-layer-info">
                  <span className="base-layer-name">{bl.name}</span>
                  <span className="base-layer-desc">{bl.description}</span>
                </div>
                <div className={`base-layer-radio ${active ? "active" : ""}`}>
                  {active && <div className="radio-dot" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="layer-group" style={{ marginTop: 14 }}>
        <div className="layer-group-label">
          <span>Overlays</span>
          <span className="layer-group-count">{activeOverlays.length} aktiv</span>
        </div>
        <div className="overlay-list">
          {OVERLAY_LAYERS.map((ol) => {
            const active = activeOverlays.includes(ol.id);
            return (
              <div key={ol.id} className={`overlay-item ${active ? "active" : ""}`}>
                <div className="overlay-header-row">
                  <LayerThumb color={ol.color} />
                  <div className="overlay-info">
                    <span className="overlay-name">{ol.name}</span>
                    <span className="overlay-desc">{ol.description}</span>
                  </div>
                  <div className="overlay-right">
                    <span className="overlay-badge" style={{ "--badge-color": ol.color }}>
                      {ol.badge}
                    </span>
                    <button
                      className={`overlay-toggle ${active ? "active" : ""}`}
                      onClick={() => toggle(ol.id)}
                      style={{ "--toggle-color": ol.color }}
                    />
                  </div>
                </div>
                {active && ol.tiles && (
                  <OpacityRow
                    layerId={ol.id}
                    value={overlayOpacity[ol.id] ?? ol.opacity ?? 0.7}
                    onChange={handleOp}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {activeOverlays.length > 0 && (
        <div className="layer-legend">
          <div className="legend-title">Aktive Overlays</div>
          <div className="legend-items">
            {activeOverlays.map((id) => {
              const ol = OVERLAY_LAYERS.find((o) => o.id === id);
              if (!ol) return null;
              return (
                <div key={id} className="legend-item">
                  <span className="legend-dot" style={{ background: ol.color }} />
                  <span>{ol.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
