// src/components/SiteFooter.js
//
// One footer for every page: product links, legal links, the data-freshness
// SLA, and the responsible-use line. Rendered once in App.js so no page has
// to remember its own trust furniture.
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MODEL_VERSION } from '../data/changelog';
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
            Grand slam prediction engine. Every call graded in public.
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
        </div>

        <nav className="site-footer-col" aria-label="Predict">
          <div className="site-footer-head">Predict</div>
          <Link to="/today">Today's Calls</Link>
          <Link to={prefix('/h2h')}>H2H Studio</Link>
          <Link to="/draw">The Draw</Link>
          <Link to="/rivalries">Rivalries</Link>
        </nav>

        <nav className="site-footer-col" aria-label="Prove">
          <div className="site-footer-head">Prove</div>
          <Link to={prefix('/track-record')}>The Ledger · Track Record</Link>
          <Link to="/model">The Engine Room · Model</Link>
          <Link to="/methodology">Methodology</Link>
          <Link to="/changelog">Changelog</Link>
        </nav>

        <nav className="site-footer-col" aria-label="Play">
          <div className="site-footer-head">Play</div>
          <Link to="/pickem">Pick'em</Link>
          <Link to={prefix('/dream-brackets')}>Dream Brackets</Link>
        </nav>

        <nav className="site-footer-col" aria-label="Legal">
          <div className="site-footer-head">Legal</div>
          <Link to="/terms">Terms of Use</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/disclaimer">Responsible Use</Link>
        </nav>
      </div>

      <div className="site-footer-legal">
        © {new Date().getFullYear()} Smash. For research and entertainment only -
        probabilities, not betting advice. Not affiliated with the ATP or WTA tours.
      </div>
    </footer>
  );
}
