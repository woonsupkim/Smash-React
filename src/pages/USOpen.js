// src/pages/USOpen.js
// export default function USOpen() {
//   return <h1>US Open Content</h1>;
// }

import React, { useEffect, useState } from "react";
import Papa from "papaparse";

function PlayerData() {
  const [players, setPlayers] = useState([]);

  useEffect(() => {
    Papa.parse("/data/smash_us.csv", {
      download: true,
      header: true,
      complete: (results) => {
        const round2 = results.data.filter(p => p.us_rd === "2");
        setPlayers(round2);
      }
    });
  }, []);

  return (
    <div>
      <h2>Round 2 Players</h2>
      <ul>
        {players.map((p, i) => (
          <li key={i}>{p.name}</li>
        ))}
      </ul>
    </div>
  );
}

export default function USOpen() {
  return (
    <div>
      <h1>US Open</h1>
      <PlayerData />
    </div>
  );
}
