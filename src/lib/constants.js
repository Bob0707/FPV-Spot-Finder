// ── Top-level constants ────────────────────────────────────────────────────

export const DACH_CENTER = [10.5, 47.5];
export const DACH_ZOOM = 5.5;
export const NOMINATIM = "https://nominatim.openstreetmap.org/search";
export const OVERPASS_ENDPOINTS = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export const BASE_LAYERS = [
  {
    id: "osm",
    name: "OpenStreetMap",
    description: "Standard-Karte",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    color: "#22d3a7",
  },
  {
    id: "satellite",
    name: "Satellit",
    description: "Esri World Imagery",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: "Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
    color: "#60a5fa",
  },
  {
    id: "topo",
    name: "Topografie",
    description: "OpenTopoMap Höhenlinien",
    tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
    attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxZoom: 17,
    color: "#f59e0b",
  },
];

// Phase 7: airspace removed from OVERLAY_LAYERS (now in dedicated Luftraum section)
export const OVERLAY_LAYERS = [
  {
    id: "nightlight",
    name: "Nachtlicht (VIIRS)",
    description: "NASA Black Marble 2012",
    tiles: [
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg",
    ],
    attribution: "NASA GIBS / VIIRS City Lights",
    maxZoom: 8,
    opacity: 0.85,
    color: "#f59e0b",
    badge: "NASA",
  },
  {
    id: "corine",
    name: "Landnutzung CORINE",
    description: "Copernicus CLC 2018",
    tiles: [
      "https://image.discomap.eea.europa.eu/arcgis/services/Corine/CLC2018_WM/MapServer/WmsServer?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&BBOX={bbox-epsg-3857}&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&LAYERS=12&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE",
    ],
    attribution: "© EEA Copernicus Land Service",
    maxZoom: 18,
    opacity: 0.6,
    color: "#10b981",
    badge: "EU",
  },
  {
    id: "fpvscore",
    name: "FPV Score Heatmap",
    description: "Gewichtetes Potenzial pro Spot",
    tiles: null,
    opacity: 0.75,
    color: "#a78bfa",
    badge: "FPV",
  },
];

// ── Phase 7: Airspace Types ────────────────────────────────────────────────
export const AIRSPACE_TYPES = [
  { type: 0,  shortCode: "OTHER", name: "Sonstiges",       color: "#94a3b8" },
  { type: 1,  shortCode: "R",     name: "Restricted",      color: "#ef4444" },
  { type: 2,  shortCode: "D",     name: "Danger",          color: "#f59e0b" },
  { type: 3,  shortCode: "P",     name: "Prohibited",      color: "#dc2626" },
  { type: 4,  shortCode: "CTR",   name: "CTR",             color: "#3b82f6" },
  { type: 5,  shortCode: "TMZ",   name: "TMZ",             color: "#8b5cf6" },
  { type: 6,  shortCode: "RMZ",   name: "RMZ",             color: "#06b6d4" },
  { type: 7,  shortCode: "TMA",   name: "TMA",             color: "#f97316" },
  { type: 8,  shortCode: "TIZ",   name: "TIZ",             color: "#84cc16" },
  { type: 10, shortCode: "GLDR",  name: "Segelfluggebiet", color: "#10b981" },
  { type: 11, shortCode: "W",     name: "Warning Area",    color: "#fbbf24" },
  { type: 12, shortCode: "ATZ",   name: "ATZ",             color: "#60a5fa" },
];

export const AIRSPACE_LEGEND_TYPES = ["CTR", "TMA", "R", "P", "D", "TMZ", "RMZ", "ATZ", "W"];

export const ICAO_CLASS_NAMES = { 0: "A", 1: "B", 2: "C", 3: "D", 4: "E", 5: "F", 6: "G" };

export const NATURSCHUTZ_COLOR = "#22c55e";

// ── Spot Types ─────────────────────────────────────────────────────────────
export const SPOT_TYPES = [
  { id: "bando",      name: "Bandos",          color: "#ef4444", icon: "🏚", shortDesc: "Verlassene Gebäude" },
  { id: "quarry",     name: "Steinbrüche",      color: "#f59e0b", icon: "⛏", shortDesc: "Abbaustätten" },
  { id: "brownfield", name: "Industriebrachen", color: "#8b5cf6", icon: "🏭", shortDesc: "Ehemalige Industriegebiete" },
  { id: "bridge",     name: "Brücken",          color: "#3b82f6", icon: "🌉", shortDesc: "Straßen- und Eisenbahnbrücken" },
  { id: "openspace",  name: "Offene Flächen",   color: "#22d3a7", icon: "🌿", shortDesc: "Parks, Wiesen, Freiflächen" },
  { id: "clearing",   name: "Waldlichtungen",   color: "#10b981", icon: "🌲", shortDesc: "Heiden, Grasland" },
  { id: "water",      name: "Gewässer",          color: "#06b6d4", icon: "💧", shortDesc: "Seen, Flüsse, Kanäle" },
];

export const ALL_SPOT_TYPE_IDS = SPOT_TYPES.map((st) => st.id);

// ── Phase 9: FPV Potential Score ───────────────────────────────────────────
export const FPV_TYPE_APPEAL = {
  bando: 92,
  quarry: 88,
  bridge: 85,
  brownfield: 74,
  water: 76,
  clearing: 70,
  openspace: 58,
};

// ── Phase 8: Fly-or-No-Fly Rules ───────────────────────────────────────────
export const ZONE_RULES = {
  P:    { level: "red",    label: "Prohibited Area",           msg: "Überflug verboten — keine Ausnahme ohne behördliche Genehmigung (§21h Abs.1)" },
  R:    { level: "red",    label: "Restricted Area",           msg: "Eingeschränkter Luftraum — Genehmigung der zuständigen Behörde erforderlich" },
  CTR:  { level: "red",    label: "Kontrollzone (CTR)",        msg: "Kontrollierter Luftraum — ATC-Freigabe zwingend nötig (Tower kontaktieren)" },
  D:    { level: "yellow", label: "Danger Area",               msg: "Gefährdungszone — militärische oder gefährliche Aktivitäten möglich" },
  TMA:  { level: "yellow", label: "TMA (Terminalbereich)",     msg: "Kontrollierter Luftraum — Höhenlimits und etwaige Genehmigungen prüfen" },
  TMZ:  { level: "yellow", label: "Transponder-Pflichtzone",   msg: "Luftfahrzeuge ohne Transponder dürfen diese Zone nicht durchfliegen" },
  RMZ:  { level: "yellow", label: "Funk-Pflichtzone (RMZ)",    msg: "Funkkontakt mit zuständiger ATC-Stelle erforderlich" },
  ATZ:  { level: "yellow", label: "Flugplatznähe (ATZ)",       msg: "Flugplatzbetreiber kontaktieren — Sicherheitsabstand 1,5 km zu Flugplätzen" },
  W:    { level: "yellow", label: "Warning Area",              msg: "Warngebiet — Besondere Vorsicht geboten (u.a. militärische Übungen)" },
  TIZ:  { level: "yellow", label: "Traffic Info Zone (TIZ)",   msg: "Verkehrsinformationszone — erhöhtes Verkehrsaufkommen" },
  GLDR: { level: "yellow", label: "Segelfluggebiet",           msg: "Segelflug-/Thermiaktivität möglich — Kollisionsgefahr beachten" },
  NATURSCHUTZ: {
    level: "yellow",
    label: "Naturschutzgebiet",
    msg: "Drohnenflug meist verboten oder genehmigungspflichtig (§21h Abs.1 Nr.6)",
  },
};

export const GENERAL_RULES = [
  { icon: "📏", title: "Max. 120m AGL",        detail: "Ohne Sondergenehmigung gilt eine Höhenbeschränkung von 120m über Grund (§21h LuftVO)" },
  { icon: "👁",  title: "Sichtflug (VLOS)",    detail: "Drohne muss jederzeit in direkter Sichtweite des Piloten bleiben" },
  { icon: "📋", title: "Registrierungspflicht", detail: "Drohnen >250g oder mit Kamera müssen registriert sein (DrohnenFV / EU-Verordnung)" },
  { icon: "🛡",  title: "Haftpflicht",          detail: "Haftpflichtversicherung für alle unbemannten Luftfahrzeuge gesetzlich vorgeschrieben" },
  { icon: "👥", title: "Menschenansammlungen",  detail: "Überflug von Menschenansammlungen verboten (§21h Abs.1 Nr.7 LuftVO)" },
  { icon: "🏥", title: "Sicherheitsabstände",   detail: "Keine Überflüge von Einsatzorten, Krankenhäusern, Kraftwerken, Gefängnissen" },
  { icon: "🌙", title: "Nacht-/Sichtflug",     detail: "Nachtflug und Flug in Wolken ohne Ausnahmegenehmigung nicht erlaubt" },
];

export const VERDICT_CONFIG = {
  green:  { bg: "#22c55e", dim: "rgba(34,197,94,.12)",   border: "rgba(34,197,94,.35)",   label: "Kein Hindernis gefunden",       sub: "Keine bekannten Einschränkungen im Spot-Bereich. Allgemeine Regeln beachten.", emoji: "✅" },
  yellow: { bg: "#f59e0b", dim: "rgba(245,158,11,.12)",  border: "rgba(245,158,11,.35)",  label: "Einschränkungen vorhanden",     sub: "Genehmigungen einholen oder besondere Vorsicht walten lassen.",               emoji: "⚠️" },
  red:    { bg: "#ef4444", dim: "rgba(239,68,68,.12)",   border: "rgba(239,68,68,.35)",   label: "Flug nicht gestattet",          sub: "Mindestens eine harte Restriktion. Ohne Ausnahmegenehmigung kein Flug.",       emoji: "🚫" },
};

// ── Phase 10: Weather Ampel ────────────────────────────────────────────────
export const WX_AMPEL = {
  green:  { label: "Gut zum Fliegen",  sub: "Wind, Regen und Bewölkung im grünen Bereich",  emoji: "✅", color: "#22c55e" },
  yellow: { label: "Eingeschränkt",    sub: "Vorsicht: Wind, Regen oder starke Bewölkung",   emoji: "⚠️", color: "#f59e0b" },
  red:    { label: "Nicht empfohlen",  sub: "Zu windig, Niederschlag oder Unwetter",          emoji: "🚫", color: "#ef4444" },
};
