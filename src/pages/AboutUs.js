// src/pages/AboutUs.js

import React from "react";

const team = [
  {
    name: "Lanru Fu",
    img: "mem1.png",
    email: "lf2752@columbia.edu",
    linkedin: "lanru-fu-a55376162",
    bio: "Lanru is a current M.S. Applied Analytics candidate at Columbia University..."
  },
  {
    name: "Wendi Hu",
    img: "mem2.png",
    email: "wh2521@columbia.edu",
    linkedin: "wendihu-wendy",
    bio: "Wendi is currently pursuing her MSc in Applied Analytics at Columbia University..."
  },
  {
    name: "Woon Sup Kim",
    img: "mem3.png",
    email: "wk2371@columbia.edu",
    linkedin: "woonsup-kim",
    bio: "Woon Sup is a data scientist with a Master’s degree from Columbia University..."
  },
  {
    name: "Emily Pham",
    img: "mem4.png",
    email: "tp2701@columbia.edu",
    linkedin: "emily-tpham",
    bio: "Emily Pham is currently a research assistant at Columbia GSAPP..."
  },
  {
    name: "Vivian Yin",
    img: "mem5.png",
    email: "vivian.yin@columbia.edu",
    linkedin: "vivianryin",
    bio: "Vivian is a passionate data scientist and Columbia grad student..."
  },
  {
    name: "Day Yi",
    img: "mem6.png",
    email: "dy2365@columbia.edu",
    linkedin: "dayhyi",
    bio: "Day is a lecturer at Columbia University in the Applied Analytics department..."
  }
];

export default function AboutUs() {
  return (
    <div style={{ padding: "2rem" }}>
      <h1 style={{ textAlign: "center", color: "lime" }}>The Development Team</h1>
      <p style={{ textAlign: "center" }}>
        Click on a team member to view more details.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "1.5rem" }}>
        {team.map((member, idx) => (
          <div
            key={idx}
            style={{ width: "200px", textAlign: "center", color: "white" }}>
            <img
              src={`/assets/${member.img}`}
              alt={member.name}
              style={{ width: "100%", borderRadius: "50%", border: "4px solid white" }}
            />
            <h3>{member.name}</h3>
            <p style={{ fontSize: "0.85rem" }}>{member.bio}</p>
            <p><a href={`mailto:${member.email}`} style={{ color: "orange" }}>{member.email}</a></p>
            <a href={`https://linkedin.com/in/${member.linkedin}`} target="_blank" rel="noreferrer">
              <img src="/assets/linkedin.png" alt="LinkedIn" width="24" />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}