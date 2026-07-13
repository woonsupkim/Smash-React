// src/pages/Admin.js
//
// Operations console. Deliberately unlinked from the public navigation -
// reachable only at /admin. The password is validated server-side by
// api/trigger-refresh.js; nothing here grants access to anything, it just
// keeps operational controls off the public surface.
import React, { useEffect, useState } from 'react';
import { Form, Button } from 'react-bootstrap';
import { toast } from '../components/ui/Toast';
import './Admin.css';

function formatDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Admin() {
  const [meta, setMeta] = useState({ atp: null, wta: null });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = (dir, key) =>
      fetch(process.env.PUBLIC_URL + dir + '/refresh-meta.json')
        .then((r) => r.json())
        .then((d) => setMeta((m) => ({ ...m, [key]: d })))
        .catch(() => {});
    load('/data', 'atp');
    load('/data/women', 'wta');
  }, []);

  const triggerRefresh = async () => {
    if (!password || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/trigger-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refresh failed');
      toast({ type: 'success', title: 'Refresh triggered', message: data.message });
      setPassword('');
    } catch (err) {
      toast({ type: 'error', title: 'Could not trigger refresh', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="eyebrow">OPERATIONS</div>
      <h1 className="admin-title">Admin Console</h1>

      <div className="admin-panel">
        <div className="admin-panel-label">Data freshness</div>
        <div className="admin-meta-grid">
          {[['atp', 'ATP'], ['wta', 'WTA']].map(([key, label]) => (
            <div className="admin-meta-cell" key={key}>
              <div className="admin-meta-tour">{label}</div>
              <div className="admin-meta-row">Last refresh: <strong>{formatDate(meta[key]?.refreshedAt)}</strong></div>
              <div className="admin-meta-row">Most recent match: <strong>{formatDate(meta[key]?.mostRecentMatchDate)}</strong></div>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-panel">
        <div className="admin-panel-label">Manual data refresh</div>
        <p className="admin-note">
          Dispatches the full pipeline (stats, Elo, track record, predictions) as a
          GitHub Action. Runs automatically every day during grand slam windows;
          use this for an off-schedule refresh. Takes several minutes and
          redeploys the site when it lands.
        </p>
        <div className="admin-form-row">
          <Form.Control
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') triggerRefresh(); }}
            placeholder="Admin password"
            aria-label="Admin password"
            className="admin-input"
          />
          <Button className="cta-primary admin-trigger" disabled={!password || busy} onClick={triggerRefresh}>
            {busy ? 'Triggering…' : 'Trigger refresh'}
          </Button>
        </div>
      </div>
    </div>
  );
}
