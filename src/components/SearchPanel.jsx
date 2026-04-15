import React, { useState, useRef, useCallback, useEffect } from "react";
import { NOMINATIM, SPOT_TYPES, ALL_SPOT_TYPE_IDS } from "../lib/constants.js";
import { readUrlParams, writeUrlParams, zoomForRadius } from "../lib/helpers.js";
import { IconSearch, IconSpinner, IconClose2, IconPin, IconShare } from "./Icons.jsx";
import { DualRangeSlider } from "./DualRangeSlider.jsx";

export function SearchPanel({ onSearch, onClear, hasResult, currentQuery, onToast, queryTypes, onQueryTypesChange }) {
  const [query, setQuery] = useState(currentQuery || "");
  const [suggestions, setSugs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [radiusMin, setRadiusMin] = useState(() => readUrlParams().radiusMin);
  const [radiusMax, setRadiusMax] = useState(() => readUrlParams().radiusMax);
  const [activeIdx, setActiveIdx] = useState(-1);

  const debRef = useRef(null);
  const inputRef = useRef(null);
  const radRef = useRef({ min: radiusMin, max: radiusMax });

  useEffect(() => {
    radRef.current = { min: radiusMin, max: radiusMax };
  }, [radiusMin, radiusMax]);

  const fetchSugs = useCallback(async (q) => {
    if (q.trim().length < 2) { setSugs([]); setOpen(false); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=6&countrycodes=de,at,ch&addressdetails=1&accept-language=de`,
        { headers: { "Accept-Language": "de" } }
      );
      const data = await res.json();
      setSugs(data);
      setOpen(data.length > 0);
      setActiveIdx(-1);
    } catch {
      onToast("Geocoding-Fehler", "warn");
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    clearTimeout(debRef.current);
    if (v.length < 2) { setSugs([]); setOpen(false); return; }
    debRef.current = setTimeout(() => fetchSugs(v), 350);
  };

  const handleSelect = (sug) => {
    const label = sug.display_name.split(",").slice(0, 3).join(", ");
    setQuery(label);
    setSugs([]);
    setOpen(false);
    const center = [parseFloat(sug.lon), parseFloat(sug.lat)];
    const { min, max } = radRef.current;
    onSearch({ center, radiusMinKm: min, radiusMaxKm: max, label });
    writeUrlParams({ center, zoom: zoomForRadius(max), radiusMin: min, radiusMax: max, query: label });
  };

  const handleKD = (e) => {
    if (!open || !suggestions.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, -1)); }
    if (e.key === "Enter" && activeIdx >= 0) handleSelect(suggestions[activeIdx]);
    if (e.key === "Escape") setOpen(false);
  };

  const handleClear = () => {
    setQuery("");
    setSugs([]);
    setOpen(false);
    onClear();
    writeUrlParams({});
    inputRef.current?.focus();
  };

  const handleRangeChange = (newMin, newMax) => {
    setRadiusMin(newMin);
    setRadiusMax(newMax);
    if (hasResult) onSearch((prev) => prev ? { ...prev, radiusMinKm: newMin, radiusMaxKm: newMax } : prev);
  };

  const handleShare = () => {
    navigator.clipboard?.writeText(window.location.href);
    onToast("Link in Zwischenablage kopiert!", "info");
  };

  const sugLabel = (sug) => {
    const p = sug.display_name.split(",");
    const plz = sug.address?.postcode || "";
    const mainText = p.slice(0, 2).join(",").trim();
    return { main: plz ? `${plz} ${mainText}` : mainText, rest: p.slice(2, 4).join(",").trim() };
  };

  const typeIcon = (t) =>
    ({
      city: "🏙️", town: "🏘️", village: "🏡", hamlet: "🏡",
      administrative: "🗺️", suburb: "🏙️", county: "🗺️",
      industrial: "🏭", park: "🌲", natural: "🌿",
      water: "💧", aerodrome: "✈️",
    }[t] || "📍");

  return (
    <div className="search-panel">
      <div className={`search-box ${open ? "focused" : ""}`}>
        <span className="search-icon">{loading ? <IconSpinner /> : <IconSearch />}</span>
        <input
          ref={inputRef}
          className="search-input"
          placeholder="Adresse, Ort oder Region…"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKD}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls="search-suggestions"
          aria-activedescendant={activeIdx >= 0 ? `sug-${activeIdx}` : undefined}
        />
        {query && (
          <button className="search-clear" onClick={handleClear} aria-label="Suche löschen">
            <IconClose2 />
          </button>
        )}

        {open && suggestions.length > 0 && (
          <div className="suggestions-list" id="search-suggestions" role="listbox" aria-label="Ortsvorschläge">
            {suggestions.map((sug, i) => {
              const { main, rest } = sugLabel(sug);
              return (
                <button
                  key={sug.place_id}
                  id={`sug-${i}`}
                  role="option"
                  aria-selected={i === activeIdx}
                  className={`suggestion-item ${i === activeIdx ? "active" : ""}`}
                  onClick={() => handleSelect(sug)}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <span className="sug-icon">{typeIcon(sug.type || sug.class)}</span>
                  <span className="sug-text">
                    <span className="sug-main">{main}</span>
                    {rest && <span className="sug-rest">{rest}</span>}
                  </span>
                  <span className="sug-type">{sug.type || sug.class}</span>
                </button>
              );
            })}
            <div className="suggestions-footer">
              <span>© OpenStreetMap Nominatim · DACH</span>
            </div>
          </div>
        )}
      </div>

      <div className="radius-control">
        <div className="radius-label">
          <span>Suchring</span>
          <span className="radius-value">
            {radiusMin > 0 ? (
              <>
                <span className="rv-dim">{radiusMin} km</span>
                <span className="rv-sep"> – </span>
              </>
            ) : null}
            {radiusMax} km
          </span>
        </div>
        <DualRangeSlider
          min={0}
          max={50}
          valueMin={radiusMin}
          valueMax={radiusMax}
          onChange={handleRangeChange}
        />
        <div className="radius-range-labels">
          <span>0 km</span>
          <span>50 km</span>
        </div>
        <div className="radius-presets">
          {[
            { label: "0–5", min: 0, max: 5 },
            { label: "5–15", min: 5, max: 15 },
            { label: "15–30", min: 15, max: 30 },
            { label: "30–50", min: 30, max: 50 },
          ].map((p) => (
            <button
              key={p.label}
              className={`radius-tick ${radiusMin === p.min && radiusMax === p.max ? "active" : ""}`}
              onClick={() => handleRangeChange(p.min, p.max)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="query-types-block">
        <div className="query-types-header">
          <span className="query-types-title">Kategorien</span>
          <span className="query-types-hint">
            {queryTypes.length === ALL_SPOT_TYPE_IDS.length
              ? "Alle"
              : `${queryTypes.length} / ${ALL_SPOT_TYPE_IDS.length}`}
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
                onClick={() =>
                  onQueryTypesChange((prev) =>
                    prev.includes(st.id) ? prev.filter((x) => x !== st.id) : [...prev, st.id]
                  )
                }
                title={st.shortDesc}
              >
                <span className="qt-icon">{st.icon}</span>
                <span className="qt-label">{st.name}</span>
                {!active && <span className="qt-off">–</span>}
              </button>
            );
          })}
        </div>
      </div>

      {hasResult && (
        <div className="search-result-bar">
          <span className="result-icon"><IconPin /></span>
          <span className="result-label">{query}</span>
          <span className="result-radius-badge">{radiusMin}–{radiusMax} km</span>
          <button className="result-share" onClick={handleShare}><IconShare /></button>
          <button className="result-clear" onClick={handleClear}><IconClose2 /></button>
        </div>
      )}
    </div>
  );
}
