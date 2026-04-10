import React, { useEffect } from "react";
import { IconX } from "./Icons.jsx";

export function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className={`toast toast-${type}`}>
      <span>{message}</span>
      <button onClick={onClose} className="toast-close">
        <IconX />
      </button>
    </div>
  );
}
