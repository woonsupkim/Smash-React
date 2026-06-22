// src/pages/Home.js

import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from 'react-bootstrap';
import './Home.css';

const SURFACES = [
  { to: '/french-open', label: 'Clay', tournament: 'French Open', className: 'surface-clay' },
  { to: '/wimbledon',   label: 'Grass', tournament: 'Wimbledon', className: 'surface-grass' },
  { to: '/us-open',     label: 'Hard',  tournament: 'US Open', className: 'surface-hard' },
];

export default function Home() {
  return (
    <div className="page-background home-bg">
      <div className="overlay text-center">
        <div className="eyebrow">MONTE CARLO TENNIS SIMULATOR</div>
        <h1 className="main-title mb-3">Simulate Any Matchup. Any Surface.</h1>
        <p className="sub-title mb-4">
          Pick two players, run thousands of point-by-point simulations, and see who really wins.
        </p>

        <div className="d-flex justify-content-center flex-wrap gap-3 mb-2">
          <Button as={Link} to="/us-open" variant="warning" size="lg" className="cta-primary">
            Quick H2H
          </Button>
          <Button as={Link} to="/dream-brackets" variant="outline-light" size="lg" className="cta-secondary">
            Build a Bracket
          </Button>
        </div>

        <p className="trust-signal mb-5">Powered by real ATP match data — not made-up numbers.</p>

        <div className="surface-strip d-flex justify-content-center flex-wrap">
          {SURFACES.map(({ to, label, tournament, className }) => (
            <Link key={to} to={to} className={`surface-tile ${className}`}>
              <div className="surface-tile-label">{label}</div>
              <div className="surface-tile-tournament">{tournament}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
