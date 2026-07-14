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

  const refreshed = meta?.refreshedAt
    ? new Date(meta.refreshedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <div className="site-footer-logo">SMASH</div>
          <p className="site-footer-tag">
            Grand slam prediction engine. Every call graded in public.
          </p>
          <p className="site-footer-sla">
            Model v{MODEL_VERSION} · data updated daily during grand slams
            {refreshed && <> · last refresh {refreshed}</>}
          </p>
        </div>

        <nav className="site-footer-col" aria-label="Product">
          <div className="site-footer-head">Product</div>
          <Link to="/today">Today's Calls</Link>
          <Link to={prefix('/h2h')}>Head to Head</Link>
          <Link to={prefix('/dream-brackets')}>Dream Brackets</Link>
          <Link to={prefix('/track-record')}>Track Record</Link>
          <Link to="/methodology">Methodology</Link>
          <Link to="/changelog">Changelog</Link>
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
