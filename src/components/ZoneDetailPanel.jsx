import React from "react";
import { ICAO_CLASS_NAMES } from "../lib/constants.js";
import { formatAltLimit } from "../lib/airspace.js";
import { IconX, IconWarning } from "./Icons.jsx";

export function ZoneDetailPanel({ zone, onClose }) {
  if (!zone) return null;

  const {
    name,
    zoneType,
    zoneTypeName,
    zoneColor,
    lowerLimit,
    upperLimit,
    icaoClass,
    onRequest,
    byNotam,
    protectClass,
    protect_title,
    access,
  } = zone.properties;

  const color = zoneColor || "#94a3b8";
  const isNSG = zoneType === "NATURSCHUTZ";
  const icaoName = ICAO_CLASS_NAMES[icaoClass];

  return (
    <div className="zone-detail-panel" style={{ "--zone-color": color }}>
      <div className="zdp-header">
        <span className="zdp-type-badge">
          {isNSG ? "🌿" : "✈️"} {zoneType}
        </span>
        <button className="zdp-close" onClick={onClose}><IconX /></button>
      </div>

      <div className="zdp-name">{name}</div>
      {!isNSG && zoneTypeName && <div className="zdp-typename">{zoneTypeName}</div>}

      {!isNSG && (lowerLimit || upperLimit) && (
        <div className="zdp-alt-block">
          <div className="zdp-alt-item">
            <span className="zdp-alt-label">Untergrenze</span>
            <span className="zdp-alt-value">{formatAltLimit(lowerLimit)}</span>
          </div>
          <div className="zdp-alt-divider" />
          <div className="zdp-alt-item">
            <span className="zdp-alt-label">Obergrenze</span>
            <span className="zdp-alt-value">{formatAltLimit(upperLimit)}</span>
          </div>
        </div>
      )}

      <div className="zdp-meta">
        {!isNSG && icaoName && (
          <div className="zdp-meta-row">
            <span className="zdp-meta-label">ICAO-Klasse</span>
            <span className="zdp-meta-badge" style={{ background: color + "22", color }}>
              Klasse {icaoName}
            </span>
          </div>
        )}
        {!isNSG && onRequest && (
          <div className="zdp-meta-row">
            <span className="zdp-meta-label">Freigabe</span>
            <span className="zdp-meta-value">Auf Anfrage</span>
          </div>
        )}
        {!isNSG && byNotam && (
          <div className="zdp-meta-row">
            <span className="zdp-meta-label">Aktivierung</span>
            <span className="zdp-meta-value">Per NOTAM</span>
          </div>
        )}
        {isNSG && protectClass && (
          <div className="zdp-meta-row">
            <span className="zdp-meta-label">Schutzklasse (IUCN)</span>
            <span className="zdp-meta-value">{protectClass}</span>
          </div>
        )}
        {isNSG && protect_title && (
          <div className="zdp-meta-row">
            <span className="zdp-meta-label">Bezeichnung</span>
            <span className="zdp-meta-value">{protect_title}</span>
          </div>
        )}
        {isNSG && access && (
          <div className="zdp-meta-row">
            <span className="zdp-meta-label">Zugang</span>
            <span className="zdp-meta-value">{access}</span>
          </div>
        )}
      </div>

      <div className="zdp-footer-warn">
        <IconWarning />
        <span>
          {isNSG
            ? "Drohnenflug im NSG meist verboten oder genehmigungspflichtig."
            : "Aktuelle NOTAMs und Einschränkungen vor dem Flug prüfen!"}
        </span>
      </div>
    </div>
  );
}
