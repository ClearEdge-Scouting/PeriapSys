import React from "react";

export default function CustomNode({ data }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontSize: 10,
          opacity: 0.7,
          borderBottom: "1px solid rgba(255,255,255,0.3)",
          marginBottom: 4
        }}
      >
        {data.type.toUpperCase()}
      </div>

      <div style={{ fontWeight: "bold" }}>
        {data.label}
      </div>
    </div>
  );
}