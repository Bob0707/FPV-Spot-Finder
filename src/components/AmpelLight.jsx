import React from "react";

const COLORS = { red: "#ef4444", yellow: "#f59e0b", green: "#22c55e" };

export function AmpelLight({ color, active }) {
  const c = COLORS[color];
  return (
    <div
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: active ? c : "transparent",
        border: `2px solid ${active ? c : c + "44"}`,
        boxShadow: active ? `0 0 10px ${c}88,0 0 20px ${c}44` : "none",
        transition: "all .3s",
      }}
    />
  );
}
