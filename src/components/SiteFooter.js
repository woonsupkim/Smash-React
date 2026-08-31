// src/components/SiteFooter.js
//
// One footer for every page: product links, legal links, the data-freshness
// SLA, and the responsible-use line. Rendered once in App.js so no page has
// to remember its own trust furniture.
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MODEL_VERSION } from '../data/changelog';
import DigestSignup from './DigestSignup';
import './SiteFooter.css';

export default function SiteFooter() {
  const location = useLocation();
  const isWomen = location.pathname.startsWith('/women');
  const prefix = (p) => (isWomen ? `/women${p}` : p);

  const [meta, setMeta] = useState(null);
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/data/refresh-meta.json')
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);

  // Site-wide freshness: relative when recent, dated and amber when stale.
  // Enterprise feel is legibility of operations - this line IS the ops page.
  const freshness = (() => {
    if (!meta?.refreshedAt) return null;
    const t = new Date(meta.refreshedAt).getTime();
    const h = (Date.now() - t) / 36e5;
    if (h < 1) return { label: 'data refreshed just now', stale: false };
    if (h < 24) return { label: `data refreshed ${Math.round(h)}h ago`, stale: false };
    const days = Math.round(h / 24);
    return {
      label: `last refresh ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (${days}d ago)`,
      stale: days > 3,
    };
  })();

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <div className="site-footer-logo">SMASH</div>
          <p className="site-footer-tag">
            Tennis calls locked before play, graded in public, and measured against the bookmakers.
          </p>
          <p className="site-footer-sla">
            Model v{MODEL_VERSION}
            {freshness && (
              <>
                {' · '}
                <span className={`site-footer-status${freshness.stale ? ' stale' : ''}`}>
                  <span className="site-footer-dot" aria-hidden="true" />
                  {freshness.stale ? 'data may be stale · ' : ''}{freshness.label}
                </span>
              </>
            )}
          </p>
          <DigestSignup />
        </div>

        {/* Columns mirror the top nav's pillars exactly, in the same order.
            They used to be grouped differently (Simulate / Proof), so the same
            page sat under two different headings depending on where you
            looked. Legal moved to the bottom bar to keep this to four. */}
        <div className="site-footer-colgroup">
          <nav className="site-footer-col" aria-label="Today">
            <div className="site-footer-head">Today</div>
            <Link to="/today">Today's Calls</Link>
            <Link to="/risk">Risk Lab</Link>
            <Link to="/draw">The Draw · Title Odds</Link>
            <Link to="/form">The Form Chart</Link>
          </nav>

          <nav className="site-footer-col" aria-label="H2H">
            <div className="site-footer-head">H2H</div>
            <Link to={prefix('/h2h')}>H2H Studio</Link>
            <Link to="/compare">Compare Players</Link>
            <Link to="/rivalries">Rivalries</Link>
          </nav>
        </div>

        <div className="site-footer-colgroup">
          <nav className="site-footer-col" aria-label="Brackets">
            <div className="site-footer-head">Brackets</div>
            <Link to={prefix('/dream-brackets')}>Dream Brackets</Link>
            <Link to="/challenge">Bracket Challenge</Link>
          </nav>

          <nav className="site-footer-col" aria-label="The Receipts">
            <div className="site-footer-head">The Receipts</div>
            <Link to={prefix('/track-record')}>The Ledger · Every Call Graded</Link>
            <Link to="/edge">The Edge · Vs the Market</Link>
            <Link to="/model">The Engine Room · Model</Link>
            <Link to="/season">The Rewind · Season</Link>
            <Link to="/methodology">How It Works</Link>
            <Link to="/changelog">Changelog</Link>
          </nav>
        </div>
      </div>

      <div className="site-footer-legal">
        <span className="site-footer-legal-links">
          <Link to="/terms">Terms of Use</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/disclaimer">Responsible Use</Link>
        </span>
        © {new Date().getFullYear()} Smash. For research and entertainment only -
        probabilities, not betting advice. Not affiliated with the ATP or WTA tours.
      </div>
    </footer>
  );
}
