// ── Phase 10: Open-Meteo Weather ──────────────────────────────────────────

export async function fetchWeather(lat, lng) {
  const url = [
    "https://api.open-meteo.com/v1/forecast",
    `?latitude=${lat.toFixed(4)}`,
    `&longitude=${lng.toFixed(4)}`,
    "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,weather_code",
    "&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation_probability,weather_code",
    "&forecast_days=1",
    "&timezone=auto",
    "&wind_speed_unit=kmh",
  ].join("");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
  return res.json();
}

export const WMO_CODES = {
  0:  { label: "Klar",               icon: "☀️",  severity: 0 },
  1:  { label: "Überwiegend klar",   icon: "🌤️", severity: 0 },
  2:  { label: "Teilbewölkt",        icon: "⛅",  severity: 0 },
  3:  { label: "Bedeckt",            icon: "☁️",  severity: 1 },
  45: { label: "Neblig",             icon: "🌫️", severity: 2 },
  48: { label: "Eisnebel",           icon: "🌫️", severity: 2 },
  51: { label: "Leichter Niesel",    icon: "🌦️", severity: 1 },
  53: { label: "Niesel",             icon: "🌦️", severity: 2 },
  55: { label: "Starker Niesel",     icon: "🌧️", severity: 2 },
  61: { label: "Leichter Regen",     icon: "🌧️", severity: 2 },
  63: { label: "Regen",              icon: "🌧️", severity: 2 },
  65: { label: "Starker Regen",      icon: "🌧️", severity: 3 },
  71: { label: "Leichter Schnee",    icon: "❄️",  severity: 2 },
  73: { label: "Schneefall",         icon: "❄️",  severity: 2 },
  75: { label: "Starker Schnee",     icon: "❄️",  severity: 3 },
  77: { label: "Schneekörner",       icon: "🌨️", severity: 2 },
  80: { label: "Regenschauer",       icon: "🌦️", severity: 2 },
  81: { label: "Starke Schauer",     icon: "🌧️", severity: 2 },
  82: { label: "Heftige Schauer",    icon: "⛈️",  severity: 3 },
  85: { label: "Schneeböen",         icon: "🌨️", severity: 2 },
  86: { label: "Starke Schneeböen",  icon: "🌨️", severity: 3 },
  95: { label: "Gewitter",           icon: "⛈️",  severity: 3 },
  96: { label: "Gewitter + Hagel",   icon: "⛈️",  severity: 3 },
  99: { label: "Gewitter + Hagel",   icon: "⛈️",  severity: 3 },
};

export function getWmo(code) {
  return WMO_CODES[code] || { label: `Code ${code}`, icon: "🌡️", severity: 0 };
}

export function windDirLabel(deg) {
  const d = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return d[Math.round(deg / 22.5) % 16];
}

export function computeWeatherAmpel(c) {
  const wind = c.wind_speed_10m ?? 0;
  const rain = c.precipitation ?? 0;
  const cloud = c.cloud_cover ?? 0;
  const wmo = getWmo(c.weather_code ?? 0);
  if (wind > 35 || rain > 2 || wmo.severity >= 3) return "red";
  if (wind > 20 || rain > 0.2 || cloud > 80 || wmo.severity >= 2) return "yellow";
  return "green";
}
