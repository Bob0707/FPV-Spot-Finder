import React, { useRef } from "react";

export function DualRangeSlider({ min, max, valueMin, valueMax, onChange }) {
  const trackRef = useRef(null);
  const dragging = useRef(null);

  const pct = (v) => ((v - min) / (max - min)) * 100;

  const vFromPct = (x) => {
    const r = trackRef.current.getBoundingClientRect();
    return Math.round(min + Math.max(0, Math.min(1, (x - r.left) / r.width)) * (max - min));
  };

  const onPD = (which, e) => {
    e.preventDefault();
    dragging.current = which;
    trackRef.current.setPointerCapture(e.pointerId);
  };

  const onPM = (e) => {
    if (!dragging.current) return;
    const v = vFromPct(e.clientX);
    if (dragging.current === "min") {
      onChange(Math.min(v, valueMax - 1), valueMax);
    } else {
      onChange(valueMin, Math.max(v, valueMin + 1));
    }
  };

  const onPU = () => {
    dragging.current = null;
  };

  const onTC = (e) => {
    if (e.target.classList.contains("drs-thumb")) return;
    const v = vFromPct(e.clientX);
    if (Math.abs(v - valueMin) <= Math.abs(v - valueMax)) {
      onChange(Math.min(v, valueMax - 1), valueMax);
    } else {
      onChange(valueMin, Math.max(v, valueMin + 1));
    }
  };

  const pMin = pct(valueMin);
  const pMax = pct(valueMax);

  return (
    <div
      className="drs-track"
      ref={trackRef}
      onPointerMove={onPM}
      onPointerUp={onPU}
      onPointerLeave={onPU}
      onClick={onTC}
    >
      <div className="drs-rail" />
      <div className="drs-fill" style={{ left: `${pMin}%`, width: `${pMax - pMin}%` }} />
      <div
        className="drs-thumb drs-thumb-min"
        style={{ left: `${pMin}%` }}
        onPointerDown={(e) => onPD("min", e)}
        role="slider"
        aria-valuenow={valueMin}
        aria-valuemin={min}
        aria-valuemax={valueMax - 1}
        aria-label="Minimaler Radius"
      />
      <div
        className="drs-thumb drs-thumb-max"
        style={{ left: `${pMax}%` }}
        onPointerDown={(e) => onPD("max", e)}
        role="slider"
        aria-valuenow={valueMax}
        aria-valuemin={valueMin + 1}
        aria-valuemax={max}
        aria-label="Maximaler Radius"
      />
    </div>
  );
}
