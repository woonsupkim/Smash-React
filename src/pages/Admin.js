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
  const [busy, setBusy] = useState(null); // 'refresh' | 'retune' | null
  const [shareKit, setShareKit] = useState(null);

  useEffect(() => {
    const load = (dir, key) =>
      fetch(process.env.PUBLIC_URL + dir + '/refresh-meta.json')
        .then((r) => r.json())
        .then((d) => setMeta((m) => ({ ...m, [key]: d })))
        .catch(() => {});
    load('/data', 'atp');
    load('/data/women', 'wta');
    fetch(process.env.PUBLIC_URL + '/data/share/manifest.json')
      .then((r) => { if (!r.ok) throw new Error('none'); return r.json(); })
      .then(setShareKit)
      .catch(() => setShareKit(null));
  }, []);

  // Both buttons dispatch a whitelisted GitHub Action through the same
  // serverless endpoint (api/trigger-refresh.js).
  const trigger = async (workflow, title) => {
    if (!password || busy) return;
    setBusy(workflow);
    try {
      const res = await fetch('/api/trigger-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, workflow }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Trigger failed');
      toast({ type: 'success', title, message: data.message });
    } catch (err) {
      toast({ type: 'error', title: `Could not trigger ${workflow}`, message: err.message });
    } finally {
      setBusy(null);
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
        <div className="admin-panel-label">Authorization</div>
        <Form.Control
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin password"
          aria-label="Admin password"
          className="admin-input"
        />
      </div>

      <div className="admin-panel">
        <div className="admin-panel-label">Manual data refresh</div>
        <p className="admin-note">
          Dispatches the full pipeline (stats, Elo, track record, title odds,
          predictions, daily scorecard) as a GitHub Action. Runs automatically
          every day during grand slam windows and every Monday in the
          off-season; use this for an off-schedule refresh. Takes a while and
          redeploys the site when it lands.
        </p>
        <Button className="cta-primary admin-trigger" disabled={!password || !!busy} onClick={() => trigger('refresh', 'Refresh triggered')}>
          {busy === 'refresh' ? 'Triggering…' : 'Trigger refresh'}
        </Button>
      </div>

      <div className="admin-panel">
        <div className="admin-panel-label">Retune blend weights</div>
        <p className="admin-note">
          Re-fits the Smart Blend weights on the season-to-date track record.
          Runs automatically just before each grand slam; use this for an
          off-schedule retune. Never changes the model directly: if the weights
          move, a pull request opens on GitHub for your review, and merging it
          re-simulates the full track record on the next refresh.
        </p>
        <Button className="cta-primary admin-trigger" disabled={!password || !!busy} onClick={() => trigger('retune', 'Retune triggered')}>
          {busy === 'retune' ? 'Triggering…' : 'Trigger retune'}
        </Button>
      </div>

      <div className="admin-panel">
        <div className="admin-panel-label">Today's share kit</div>
        {shareKit?.assets?.length ? (
          <>
            <p className="admin-note">
              Regenerated with every data refresh (last: {formatDate(shareKit.generatedAt)}).
              Right-click any card to save it; the caption below each one is ready to paste.
            </p>
            {shareKit.thread?.length > 0 && (
              <div className="admin-thread">
                <div className="admin-kit-group">Ready-to-paste thread</div>
                {shareKit.thread.map((post, i) => (
                  <div className="admin-thread-post" key={i}>
                    <span className="admin-thread-n">{i + 1}</span>
                    <span className="admin-thread-text">{post}</span>
                    <Button
                      size="sm"
                      className="admin-thread-copy"
                      onClick={() => {
                        navigator.clipboard?.writeText(post)
                          .then(() => toast({ type: 'success', title: 'Copied', message: `Post ${i + 1} on the clipboard.` }))
                          .catch(() => {});
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {[
              ['daily', "Today's posts"],
              ['draw', 'Draw & brackets'],
              ['wrap', 'Tournament wrap'],
              ['weekly', 'Weekly recap'],
              ['moments', 'Moments'],
              ['promo', 'Evergreen promos'],
            ].map(([cat, label]) => {
              const group = shareKit.assets.filter((a) => (a.category || 'daily') === cat);
              if (!group.length) return null;
              return (
                <div key={cat}>
                  <div className="admin-kit-group">{label}</div>
                  <div className="admin-kit-grid">
                    {group.map((a) => {
                      const src = `${process.env.PUBLIC_URL}/data/share/${a.file}?v=${encodeURIComponent(shareKit.generatedAt)}`;
                      return (
                        <figure className="admin-kit-item" key={a.file}>
                          <a href={src} target="_blank" rel="noopener noreferrer">
                            {a.file.endsWith('.mp4')
                              ? <video src={src} muted loop autoPlay playsInline />
                              : <img src={src} alt={a.caption} />}
                          </a>
                          <figcaption>
                            <span className={`admin-kit-type t-${a.type}`}>{a.type}</span>
                            {a.caption}
                          </figcaption>
                        </figure>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <p className="admin-note">
            No kit generated yet. Assets appear here after the next data refresh
            (or run <code>npm run build-share-assets</code> locally).
          </p>
        )}
      </div>
    </div>
  );
}
