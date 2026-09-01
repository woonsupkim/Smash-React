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
          every day during grand slam and combined-1000 weeks, and every
          Monday otherwise; use this for an off-schedule refresh. Takes a
          while and redeploys the site when it lands.
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
          recomputes the full track record on the next refresh.
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
            {/* One block per SECTION, in the order they are worth posting, each
                with the single caption that belongs to it. This used to be an
                eleven-post thread above a flat grid of everything, which meant
                deciding what went with what by looking at the pictures. */}
            {[
              ['today', "Today's matches", 'Cover, one card per match, closer.'],
              ['story', 'Instagram story', 'Slate, poll, tale of the tape.'],
              ['contender', 'Contenders', 'Title odds and overnight movers, both tours.'],
              ['recap', 'Yesterday recap', 'How the calls landed, and what they returned.'],
              ['draw', 'Draw & brackets', 'The bracket and the road through it.'],
              ['moments', 'Moments', 'Upsets, streaks, milestones, the market splits.'],
              ['weekly', 'Weekly recap', 'The week, graded.'],
              ['hype', 'Next slam', 'Countdown and surface record.'],
              ['wrap', 'Tournament wrap', 'End-of-event report cards.'],
            ].map(([cat, label, blurb]) => {
              const group = shareKit.assets
                .filter((a) => (a.category || 'today') === cat)
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
              if (!group.length) return null;
              const caption = shareKit.captions?.[cat];
              return (
                <div key={cat}>
                  <div className="admin-kit-group">
                    {label}
                    <span className="admin-kit-count">{group.length}</span>
                    <span className="admin-kit-blurb">{blurb}</span>
                  </div>
                  {caption && (
                    <div className="admin-caption">
                      <pre className="admin-caption-text">{caption}</pre>
                      <Button
                        size="sm"
                        variant="outline-light"
                        className="admin-caption-copy"
                        onClick={() => navigator.clipboard?.writeText(caption)}
                      >
                        Copy caption
                      </Button>
                    </div>
                  )}
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
