import { WX_AMPEL } from "../lib/constants.js";
import { getWmo, windDirLabel, computeWeatherAmpel } from "../lib/weather.js";
import { IconWarning, IconSpinner, IconRefresh } from "./Icons.jsx";
import { AmpelLight } from "./AmpelLight.jsx";

// ── WindRose (local) ────────────────────────────────────────────────────────
function WindRose({ direction, speed, size = 100 }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 10;
  const rad = (direction - 90) * Math.PI / 180;
  const arrowLen = r * 0.72;
  const ax = cx + Math.cos(rad) * arrowLen;
  const ay = cy + Math.sin(rad) * arrowLen;
  const tr = r * 0.22;
  const tx = cx - Math.cos(rad) * tr;
  const ty = cy - Math.sin(rad) * tr;
  const sc = speed > 35 ? "#ef4444" : speed > 20 ? "#f59e0b" : "#22d3a7";
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
    </svg>
  );
}

// ── WeatherPanel ────────────────────────────────────────────────────────────
export default function WeatherPanel({ selectedSpot, weatherData, loading, error, onRefetch }) {
  if (!selectedSpot) {
    return (
      <div className="wx-empty">
        <span className="wx-empty-icon">🌤️</span>
        <span>Spot auswählen für Wetterdaten</span>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="wx-loading">
        <IconSpinner />
        <span>Wetterdaten werden geladen…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="wx-error">
        <IconWarning />
        <span>{error}</span>
        <button className="wx-retry-btn" onClick={onRefetch}>
          <IconRefresh /> Erneut versuchen
        </button>
      </div>
    );
  }
  if (!weatherData) return null;

  const c = weatherData.current;
  const wind = Math.round(c.wind_speed_10m ?? 0);
  const dir = Math.round(c.wind_direction_10m ?? 0);
  const rain = +(c.precipitation ?? 0).toFixed(1);
  const cloud = Math.round(c.cloud_cover ?? 0);
  const temp = Math.round(c.temperature_2m ?? 0);
  const humid = Math.round(c.relative_humidity_2m ?? 0);
  const wmo = getWmo(c.weather_code ?? 0);
  const ampel = computeWeatherAmpel(c);
  const ac = WX_AMPEL[ampel];
  const windColor = wind > 35 ? "#ef4444" : wind > 20 ? "#f59e0b" : "#22d3a7";

  const now = new Date();
  const hourlyTimes = weatherData.hourly?.time || [];
  const nextHours = hourlyTimes
    .map((t, i) => ({
      time: t,
      temp: Math.round(weatherData.hourly.temperature_2m?.[i] ?? 0),
      wind: Math.round(weatherData.hourly.wind_speed_10m?.[i] ?? 0),
      precProb: weatherData.hourly.precipitation_probability?.[i] ?? 0,
      code: weatherData.hourly.weather_code?.[i] ?? 0,
    }))
    .filter((h) => {
      const d = new Date(h.time);
      return d >= now && d <= new Date(now.getTime() + 6 * 3600000);
    })
    .slice(0, 6);

  return (
    <div className="wx-panel">
      <div className="wx-ampel-row">
        <div className="flychk-ampel-housing">
          <AmpelLight color="red"    active={ampel === "red"} />
          <AmpelLight color="yellow" active={ampel === "yellow"} />
          <AmpelLight color="green"  active={ampel === "green"} />
        </div>
        <div
          className="flychk-verdict-block"
          style={{ "--vc-bg": `${ac.color}18`, "--vc-border": `${ac.color}44`, "--vc-color": ac.color }}
        >
          <span className="flychk-verdict-emoji">{ac.emoji}</span>
          <div className="flychk-verdict-texts">
            <span className="flychk-verdict-label" style={{ color: ac.color }}>{ac.label}</span>
            <span className="flychk-verdict-sub">{ac.sub}</span>
          </div>
        </div>
      </div>

      <div className="wx-cond-card">
        <div className="wx-cond-left">
          <WindRose direction={dir} speed={wind} size={96} />
          <div className="wx-wind-info">
            <span className="wx-wind-speed" style={{ color: windColor }}>{wind} km/h</span>
            <span className="wx-wind-dir">{windDirLabel(dir)} · {dir}°</span>
          </div>
        </div>
        <div className="wx-cond-stats">
          <div className="wx-stat">
            <span className="wx-stat-icon">{wmo.icon}</span>
            <div>
              <span className="wx-stat-val">{wmo.label}</span>
              <span className="wx-stat-lbl">Wetterlage</span>
            </div>
          </div>
          <div className="wx-stat">
            <span className="wx-stat-icon">🌡️</span>
            <div>
              <span className="wx-stat-val">{temp}°C</span>
              <span className="wx-stat-lbl">Temperatur</span>
            </div>
          </div>
          <div className="wx-stat">
            <span className="wx-stat-icon">🌧️</span>
            <div>
              <span className="wx-stat-val" style={{ color: rain > 0 ? "#60a5fa" : "var(--text-secondary)" }}>
                {rain} mm
              </span>
              <span className="wx-stat-lbl">Niederschlag</span>
            </div>
          </div>
          <div className="wx-stat">
            <span className="wx-stat-icon">☁️</span>
            <div>
              <span className="wx-stat-val" style={{ color: cloud > 80 ? "#f59e0b" : "var(--text-secondary)" }}>
                {cloud}%
              </span>
              <span className="wx-stat-lbl">Bewölkung</span>
            </div>
          </div>
          <div className="wx-stat">
            <span className="wx-stat-icon">💧</span>
            <div>
              <span className="wx-stat-val">{humid}%</span>
              <span className="wx-stat-lbl">Luftfeuchte</span>
            </div>
          </div>
        </div>
      </div>

      {nextHours.length > 0 && (
        <div className="wx-forecast">
          <div className="wx-forecast-title">Stunden-Vorschau</div>
          <div className="wx-forecast-row">
            {nextHours.map((h) => {
              const hw = getWmo(h.code);
              const wc = h.wind > 35 ? "#ef4444" : h.wind > 20 ? "#f59e0b" : "#22d3a7";
              const hr = new Date(h.time).getHours();
              return (
                <div key={h.time} className="wx-fc-cell">
                  <span className="wx-fc-time">{String(hr).padStart(2, "0")}:00</span>
                  <span className="wx-fc-icon">{hw.icon}</span>
                  <span className="wx-fc-temp">{h.temp}°</span>
                  <span className="wx-fc-wind" style={{ color: wc }}>{h.wind}</span>
                  {h.precProb > 20 && <span className="wx-fc-prec">{h.precProb}%</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="wx-footer">
        <button className="wx-refresh-btn" onClick={onRefetch}>
          <IconRefresh /> Aktualisieren
        </button>
        <span>Open-Meteo · {weatherData.timezone_abbreviation || ""}</span>
      </div>
    </div>
  );
}
