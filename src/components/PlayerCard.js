// src/components/PlayerCard.js

import React from "react";

export default function PlayerCard({ player, side = "A" }) {
  const color = side === "A" ? "limegreen" : "magenta";
  const styleBox = {
    background: "#222",
    color: "white",
    padding: "1rem",
    border: `2px solid ${color}`,
    borderRadius: "10px",
    width: "250px"
  };

  const statBar = (label, value) => (
    <div style={{ marginBottom: "0.5rem" }}>
      <strong>{label}</strong>
      <div style={{
        background: "#444",
        borderRadius: "5px",
        overflow: "hidden",
        marginTop: "4px"
      }}>
        <div style={{
          width: `${Math.round(value * 100)}%`,
          background: color,
          padding: "4px",
          color: "#000",
          fontWeight: "bold"
        }}>{Math.round(value * 100)}%</div>
      </div>
    </div>
  );

  return (
    <div style={styleBox}>
      <img
        src={`/assets/plyrs/${player.id}.png`}
        alt={player.name}
        style={{ width: "100%", borderRadius: "10px", marginBottom: "1rem" }}
      />
      <h3>{player.name}</h3>
      {statBar("1st Serve In", Number(player.p1))}
      {statBar("2nd Serve In", Number(player.p2))}
      {statBar("1st Return In", Number(player.p3))}
      {statBar("2nd Return In", Number(player.p4))}
      {statBar("Volley Win", Number(player.p5))}
    </div>
  );
}
