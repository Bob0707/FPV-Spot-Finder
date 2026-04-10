import React, { useState, useEffect } from "react";
import { getSunPosition, getSunTimes, formatTime, getSunStatus, sunAzBearing } from "../lib/suncalc.js";
import { IconInfo } from "./Icons.jsx";

// ── SunCompass (local) ─────────────────────────────────────────────────────
function SunCompass({ azBearing, altDeg, size = 100 }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 10;
  const rad = (azBearing - 90) * Math.PI / 180;
  const arrowLen = r * 0.72;
  const ax = cx + Math.cos(rad) * arrowLen;
  const ay = cy + Math.sin(rad) * arrowLen;
  const tr = r * 0.22;
  const tx = cx - Math.cos(rad) * tr;
  const ty = cy - Math.sin(rad) * tr;
  const sc = altDeg < 0 ? "#312e81" : altDeg < 6 ? "#f59e0b" : "#fbbf24";
  const ds = [["N", cx, 10], ["O", size - 4, cy + 4], ["S", cx, size - 2], ["W", 5, cy + 4]];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.03)" stroke="var(--border)" strokeWidth="1" />
      <circle cx={cx} cy={cy} r={r * 0.55} fill="none" stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3,3" />
      {ds.map(([d, x, y]) => (
        <text key={d} x={x} y={y} fill="var(--text-muted)" fontSize="8" textAnchor="middle" fontFamily="var(--font-mono)">
          {d}
        </text>
      ))}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const ar = (a - 90) * Math.PI / 180;
        const r1 = r - 1;
        const r2 = a % 90 === 0 ? r - 5 : r - 3;
        return (
          <line
            key={a}
            x1={cx + Math.cos(ar) * r1} y1={cy + Math.sin(ar) * r1}
            x2={cx + Math.cos(ar) * r2} y2={cy + Math.sin(ar) * r2}
            stroke="var(--border)" strokeWidth={a % 90 === 0 ? 1.5 : 0.8}
          />
        );
      })}
      <line x1={tx} y1={ty} x2={ax} y2={ay} stroke={sc} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={ax} cy={ay} r="4" fill={sc} />
      <circle cx={cx} cy={cy} r="2.5" fill="var(--bg-card)" stroke={sc} strokeWidth="1.5" />
      <text x={cx} y={cy + 1.5} fill={sc} fontSize="5" textAnchor="middle" fontFamily="var(--font-mono)" dominantBaseline="middle">
        ☀
      </text>
    </svg>
  );
}

// ── SunTimeline (local) ────────────────────────────────────────────────────
function SunTimeline({ times, now }) {
  if (!times) return null;

  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayMs = 86400000;

  const pct = (d) =>
    `${Math.max(0, Math.min(100, (d.getTime() - dayStart.getTime()) / dayMs * 100)).toFixed(1)}%`;
  const w = (d) => d && !isNaN(d.getTime());
  const nowPct = pct(now);

  return (
    <div className="sun-timeline">
      <span className="sun-timeline-label">Tageslicht-Übersicht</span>
      <div className="sun-tl-bar">
        {w(times.dawn) && w(times.dusk) && (
          <div
            className="sun-tl-day"
            style={{ left: pct(times.dawn), width: `calc(${pct(times.dusk)} - ${pct(times.dawn)})` }}
          />
        )}
        {w(times.sunrise) && w(times.goldenMorningEnd) && (
          <div
            className="sun-tl-golden"
            style={{ left: pct(times.sunrise), width: `calc(${pct(times.goldenMorningEnd)} - ${pct(times.sunrise)})` }}
          />
        )}
        {w(times.goldenEveningStart) && w(times.sunset) && (
          <div
            className="sun-tl-golden"
            style={{ left: pct(times.goldenEveningStart), width: `calc(${pct(times.sunset)} - ${pct(times.goldenEveningStart)})` }}
          />
        )}
        <div className="sun-tl-now" style={{ left: nowPct }} />
      </div>
      <div className="sun-tl-ticks">
        {["0:00", "6:00", "12:00", "18:00", "24:00"].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}

// ── SunPanel ────────────────────────────────────────────────────────────────
export default function SunPanel({ selectedSpot, searchCircle }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  let lat = null;
  let lng = null;
  if (selectedSpot) {
    [lng, lat] = selectedSpot.geometry.coordinates;
  } else if (searchCircle) {
    [lng, lat] = searchCircle.center;
  }

  if (lat == null) {
    return (
      <div className="sun-empty">
        <span className="sun-empty-icon">🌤️</span>
        <span>Spot auswählen oder Suche starten für Sonnenstandsdaten</span>
      </div>
    );
  }

  let times, pos, status, altDeg = 0, azBearing = 0;
  try {
    times = getSunTimes(now, lat, lng);
    pos = getSunPosition(now, lat, lng);
    status = getSunStatus(times, now);
    altDeg = Math.round(pos.altitude * 180 / Math.PI);
    azBearing = Math.round(sunAzBearing(pos.azimuth));
  } catch (e) {
    return (
      <div className="sun-empty">
        <span className="sun-empty-icon">⚠️</span>
        <span>Fehler bei Sonnenberechnung</span>
      </div>
    );
  }

  const isGoldenNow = status.label === "Goldene Stunde";
  const nextGolden = isGoldenNow
    ? null
    : now < times.sunrise
    ? times.sunrise
    : now < times.goldenEveningStart
    ? times.goldenEveningStart
    : null;

  const compassLabels = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

  return (
    <div className="sun-panel">
      {/* Status & Position */}
      <div className="sun-status-row">
        <div
          className="sun-status-badge"
          style={{ background: `${status.color}18`, border: `1px solid ${status.color}44`, color: status.color }}
        >
          <span>{status.emoji}</span>
          <span>{status.label}</span>
        </div>
        <div className="sun-pos-meta">
          <span className="sun-alt" title="Höhenwinkel der Sonne">
            {altDeg >= 0 ? "↑" : "↓"}{Math.abs(altDeg)}°
          </span>
          {nextGolden && <span className="sun-next">🌅 {formatTime(nextGolden)}</span>}
        </div>
      </div>

      {/* Sun Compass + Times */}
      <div className="sun-compass-card">
        <div className="sun-compass-left">
          <SunCompass azBearing={azBearing} altDeg={altDeg} size={96} />
          <div className="sun-compass-info">
            <span className="sun-az-val">{azBearing}°</span>
            <span className="sun-az-lbl">{compassLabels[Math.round(azBearing / 22.5) % 16]}</span>
          </div>
        </div>
        <div className="sun-compass-right">
          <div className="sun-times-col">
            <div className="sun-time-item">
              <span className="sun-ti-icon">🌄</span>
              <div>
                <span className="sun-ti-label">Aufgang</span>
                <span className="sun-ti-val">{formatTime(times.sunrise)}</span>
              </div>
            </div>
            <div className={`sun-time-item ${isGoldenNow && now < times.goldenMorningEnd ? "golden" : ""}`}>
              <span className="sun-ti-icon">🌅</span>
              <div>
                <span className="sun-ti-label">Gold. morgens</span>
                <span className="sun-ti-val golden-val">
                  {formatTime(times.sunrise)} – {formatTime(times.goldenMorningEnd)}
                </span>
              </div>
            </div>
            <div className="sun-time-item">
              <span className="sun-ti-icon">☀️</span>
              <div>
                <span className="sun-ti-label">Mittag</span>
                <span className="sun-ti-val">{formatTime(times.solarNoon)}</span>
              </div>
            </div>
            <div className={`sun-time-item ${isGoldenNow && now >= times.goldenEveningStart ? "golden" : ""}`}>
              <span className="sun-ti-icon">🌅</span>
              <div>
                <span className="sun-ti-label">Gold. abends</span>
                <span className="sun-ti-val golden-val">
                  {formatTime(times.goldenEveningStart)} – {formatTime(times.sunset)}
                </span>
              </div>
            </div>
            <div className="sun-time-item">
              <span className="sun-ti-icon">🌆</span>
              <div>
                <span className="sun-ti-label">Untergang</span>
                <span className="sun-ti-val">{formatTime(times.sunset)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Altitude Horizon Bar */}
      <div className="sun-alt-card">
        <span className="sun-alt-label">Sonnen-Höhenwinkel</span>
        <div className="sun-alt-track">
          <div className="sun-alt-zero" />
          <div
            className="sun-alt-fill"
            style={{
              left: altDeg >= 0 ? "50%" : `${50 + altDeg / 90 * 50}%`,
              width: `${Math.abs(altDeg) / 90 * 50}%`,
              background: altDeg < 0 ? "#312e81" : altDeg < 6 ? "#f59e0b" : "#fbbf24",
            }}
          />
          <div
            className="sun-alt-needle"
            style={{ left: `${50 + Math.max(-90, Math.min(90, altDeg)) / 90 * 50}%` }}
          />
        </div>
        <div className="sun-alt-labels">
          <span>−90°</span>
          <span>Horizon</span>
          <span>+90°</span>
        </div>
        <div
          className="sun-alt-deg"
          style={{ color: altDeg < 0 ? "#5b21b6" : altDeg < 6 ? "#f59e0b" : "#fbbf24" }}
        >
          {altDeg >= 0 ? "+" : ""}{altDeg}° ·{" "}
          {altDeg < 0 ? "Unter Horizont" : altDeg < 6 ? "Goldene Zone (0–6°)" : altDeg < 20 ? "Niedriger Stand" : "Hoher Stand"}
        </div>
      </div>

      {/* Timeline */}
      <SunTimeline times={times} now={now} />

      <div className="sun-footer">
        <IconInfo /> Sonnenzeiten für {lat.toFixed(3)}°N, {lng.toFixed(3)}°E · SunCalc
      </div>
    </div>
  );
}
