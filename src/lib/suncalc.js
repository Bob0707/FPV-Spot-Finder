// ── Phase 11: SunCalc (inline, no npm) ────────────────────────────────────
// Internal helpers are prefixed _SC_ and are not exported.

const _SC_RAD = Math.PI / 180;
const _SC_J1970 = 2440588;
const _SC_J2000 = 2451545;
const _SC_E = 23.4397 * _SC_RAD;

function _scToJ(d) {
  return d.valueOf() / 86400000 - 0.5 + _SC_J1970;
}
function _scFromJ(j) {
  return new Date((j + 0.5 - _SC_J1970) * 86400000);
}
function _scToDays(d) {
  return _scToJ(d) - _SC_J2000;
}
function _scSMA(d) {
  return _SC_RAD * (357.5291 + 0.98560028 * d);
}
function _scELng(M) {
  const C = _SC_RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + _SC_RAD * 102.9372 + Math.PI;
}
function _scDec(L) {
  return Math.asin(Math.sin(L) * Math.sin(_SC_E));
}
function _scRA(L) {
  return Math.atan2(Math.sin(L) * Math.cos(_SC_E), Math.cos(L));
}
function _scST(d, lw) {
  return _SC_RAD * (280.16 + 360.9856235 * d) - lw;
}
function _scCoords(d) {
  const M = _scSMA(d);
  const L = _scELng(M);
  return { dec: _scDec(L), ra: _scRA(L), M, L };
}

export function getSunPosition(date, lat, lng) {
  const lw = _SC_RAD * -lng;
  const phi = _SC_RAD * lat;
  const d = _scToDays(date);
  const c = _scCoords(d);
  const H = _scST(d, lw) - c.ra;
  return {
    azimuth: Math.atan2(
      Math.sin(H),
      Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi)
    ),
    altitude: Math.asin(
      Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H)
    ),
  };
}

const _SC_J0 = 0.0009;

function _scJC(d, lw) {
  return Math.round(d - _SC_J0 - lw / (2 * Math.PI));
}
function _scAT(Ht, lw, n) {
  return _SC_J0 + (Ht + lw) / (2 * Math.PI) + n;
}
function _scSTJ(ds, M, L) {
  return _SC_J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
}
function _scHA(h, phi, dec) {
  const x = (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  return Math.abs(x) > 1 ? NaN : Math.acos(x);
}
function _scSetJ(h, lw, phi, dec, n, M, L) {
  const w = _scHA(h, phi, dec);
  if (isNaN(w)) return NaN;
  return _scSTJ(_scAT(w, lw, n), M, L);
}

export function getSunTimes(date, lat, lng) {
  const lw = _SC_RAD * -lng;
  const phi = _SC_RAD * lat;
  const d = _scToDays(date);
  const n = _scJC(d, lw);
  const ds = _scAT(0, lw, n);
  const { M, L, dec } = _scCoords(ds);
  const Jnoon = _scSTJ(ds, M, L);
  const Jset = _scSetJ(-0.8333 * _SC_RAD, lw, phi, dec, n, M, L);
  const Jrise = Jnoon - (Jset - Jnoon);
  const Jdusk = _scSetJ(-6 * _SC_RAD, lw, phi, dec, n, M, L);
  const Jdawn = Jnoon - (Jdusk - Jnoon);
  const JghPM = _scSetJ(6 * _SC_RAD, lw, phi, dec, n, M, L);
  const JghAM = Jnoon - (JghPM - Jnoon);
  return {
    dawn: _scFromJ(Jdawn),
    sunrise: _scFromJ(Jrise),
    goldenMorningEnd: _scFromJ(JghAM),
    solarNoon: _scFromJ(Jnoon),
    goldenEveningStart: _scFromJ(JghPM),
    sunset: _scFromJ(Jset),
    dusk: _scFromJ(Jdusk),
  };
}

export function formatTime(d) {
  if (!d || isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

export function getSunStatus(t, now) {
  if (!t) return { label: "Unbekannt", color: "#64748b", emoji: "❓" };
  const n = now.getTime();
  if (n < t.dawn.getTime()) return { label: "Nacht",              color: "#312e81", emoji: "🌙" };
  if (n < t.sunrise.getTime()) return { label: "Morgendämmerung", color: "#7c3aed", emoji: "🌄" };
  if (n < t.goldenMorningEnd.getTime()) return { label: "Goldene Stunde", color: "#f59e0b", emoji: "🌅" };
  if (n < t.goldenEveningStart.getTime()) return { label: "Tag",    color: "#fbbf24", emoji: "☀️" };
  if (n < t.sunset.getTime()) return { label: "Goldene Stunde",   color: "#f59e0b", emoji: "🌅" };
  if (n < t.dusk.getTime()) return { label: "Abenddämmerung",     color: "#7c3aed", emoji: "🌆" };
  return { label: "Nacht", color: "#312e81", emoji: "🌙" };
}

// Azimuth conversion: SunCalc uses 0=South, π/2=West
// → compass bearing from North: (az * 180/π + 180) % 360
export function sunAzBearing(azRad) {
  return ((azRad * 180 / Math.PI + 180) % 360);
}
