// // src/pages/Home.js
// export default function Home() {
//   return <h1>Welcome to SMASH! Home Page</h1>;
// }

import React from "react";
import { matchMatrix } from "../data/matchMatrix";

export default function Home() {
  return (
    <div>
      <h1>Match Highlight</h1>
      <table border="1" cellPadding="8">
        <thead>
          <tr>
            <th>First</th>
            <th>Last</th>
            <th>Score</th>
            <th>Country</th>
          </tr>
        </thead>
        <tbody>
          {matchMatrix.map((p, i) => (
            <tr key={i}>
              <td>{p.firstName}</td>
              <td>{p.lastName}</td>
              <td>{p.score}</td>
              <td>{p.country}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
