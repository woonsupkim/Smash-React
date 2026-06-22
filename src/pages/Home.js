// src/pages/Home.js

import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from 'react-bootstrap';
import Swal from 'sweetalert2';
import './Home.css';

const SURFACES = [
  { to: '/french-open', label: 'Clay',  city: 'Paris',    desc: 'Slow, high bounce. Grinders thrive.', className: 'surface-clay' },
  { to: '/wimbledon',   label: 'Grass', city: 'London',   desc: 'Fast, low skid. Big servers fly.', className: 'surface-grass' },
  { to: '/us-open',     label: 'Hard',  city: 'New York', desc: 'Balanced, true bounce. All-courters.', className: 'surface-hard' },
];

export default function Home() {
  const handleUpdateData = async () => {
    const { value: password } = await Swal.fire({
      title: 'Admin password',
      input: 'password',
      inputPlaceholder: 'Password',
      showCancelButton: true,
      confirmButtonText: 'Trigger refresh',
    });
    if (!password) return;

    try {
      const res = await fetch('/api/trigger-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refresh failed');
      Swal.fire({ icon: 'success', title: 'Refresh triggered', text: data.message });
    } catch (err) {
      Swal.fire({ icon: 'error', title: 'Could not trigger refresh', text: err.message });
    }
  };

  return (
    <div className="home-page">
      <div className="home-hero">
        <div className="eyebrow">GRAND SLAM MATCH ENGINE</div>
        <h1 className="main-title">Simulate the<br/>Slams in Seconds</h1>
        <p className="sub-title">
          Pick any two players, choose a surface, and run the matchup.<br/>
          Build full draws and crown a champion.
        </p>

        <div className="d-flex flex-wrap gap-3 hero-ctas">
          <Button as={Link} to="/us-open" className="cta-primary">
            Quick H2H
          </Button>
          <Button as={Link} to="/dream-brackets" className="cta-secondary">
            Build a Bracket
          </Button>
        </div>
      </div>

      <div className="surface-strip">
        {SURFACES.map(({ to, label, city, desc, className }) => (
          <Link key={to} to={to} className={`surface-tile ${className}`}>
            <div className="surface-tile-label">{label}</div>
            <div className="surface-tile-city">{city}</div>
            <div className="surface-tile-desc">{desc}</div>
            <div className="surface-tile-enter">ENTER →</div>
          </Link>
        ))}
      </div>

      <div className="home-footer">
        <span className="trust-signal">Powered by real ATP match data, not made-up numbers.</span>
        <button type="button" className="update-data-link" onClick={handleUpdateData}>
          Update Data
        </button>
      </div>
    </div>
  );
}
