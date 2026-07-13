// src/pages/NotFound.js
import React from 'react';
import { Link } from 'react-router-dom';
import './NotFound.css';

export default function NotFound() {
  return (
    <div className="notfound-page">
      <div className="notfound-code">404</div>
      <h1 className="notfound-title">Out of bounds</h1>
      <p className="notfound-sub">That page doesn't exist. The rest of the court is still open:</p>
      <div className="notfound-links">
        <Link to="/">Home</Link>
        <Link to="/h2h?surface=hard">Head to Head</Link>
        <Link to="/track-record">Track Record</Link>
        <Link to="/methodology">Methodology</Link>
      </div>
    </div>
  );
}
