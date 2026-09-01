// src/components/CardRail.js
//
// The bench: every match on today's card that is NOT in your picks.
//
// The plan table used to list the whole day, which on a slam Tuesday is forty
// rows of which the plan funds four. Everything you were working on sat
// inside a wall of things you were not. The two jobs are different - browsing
// a card, and pricing a slip - so they are two surfaces now: this one is a
// list you scan and add from, and the table beside it holds only what you
// picked.
//
// Adding works two ways on purpose. Drag is the obvious gesture and the one
// people reach for; the checkbox is the one that works with a keyboard, a
// screen reader, and a touchscreen, so it is not a fallback but the primary
// control, and the drag is the affordance layered on top.
import React from 'react';
import { Link } from 'react-router-dom';
import { lastName } from '../utils/names';
import { matchSlug, localStartTime } from '../utils/matchTime';
import './CardRail.css';

const pct = (v) => `${Math.round((v || 0) * 100)}%`;
const defaultOdds = (l) => Number(l.favorite === l.p1 ? l.lockOdd1 : l.lockOdd2) || 0;

export const DRAG_TYPE = 'application/x-smash-match';

export default function CardRail({
  legs = [], noCalls = [], picked = 0, onPick, onPickAll, interactive = true,
  tourView = 'all', tourCounts = null, onTourView = null,
  hidePasses = false, onHidePasses = null,
}) {
  const rows = [
    ...legs.map((l) => ({ l, call: true })),
    ...(hidePasses ? [] : noCalls.map((l) => ({ l, call: false }))),
  ];

  return (
    <aside className="card-rail" aria-label="The rest of today's card">
      <div className="card-rail-head">
        <div className="card-rail-cap">On the bench</div>
        <div className="card-rail-sub">
          {rows.length === 0
            ? 'Everything on the card is in your picks.'
            : interactive
              ? `${rows.length} more ${rows.length === 1 ? 'match' : 'matches'} today. Drag one across, or tick it.`
              : `${rows.length} more ${rows.length === 1 ? 'match' : 'matches'} today. Switch the plan to Custom to add any of them.`}
        </div>
      </div>

      {onTourView && tourCounts && (
        <div className="card-rail-filters" role="group" aria-label="Tour">
          {[['all', 'Both'], ['atp', `ATP ${tourCounts.atp}`], ['wta', `WTA ${tourCounts.wta}`]].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tourView === id}
              className={tourView === id ? 'on' : ''} onClick={() => onTourView(id)}>{label}</button>
          ))}
        </div>
      )}

      {onHidePasses && noCalls.length > 0 && (
        <label className="card-rail-check">
          <input type="checkbox" checked={hidePasses} onChange={() => onHidePasses(!hidePasses)} />
          Hide the matches we do not call
        </label>
      )}

      <ul className="card-rail-list">
        {rows.map(({ l, call }) => {
          const o = defaultOdds(l);
          const start = localStartTime(l.date);
          return (
            <li key={l.id}
              className={`card-rail-item${call ? '' : ' pass'}${interactive ? '' : ' locked'}`}
              draggable={interactive}
              onDragStart={(e) => {
                if (!interactive) { e.preventDefault(); return; }
                e.dataTransfer.setData(DRAG_TYPE, l.id);
                // Some browsers refuse a drag with no text/plain payload.
                e.dataTransfer.setData('text/plain', l.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}>
              {/* A tick that ADDS rather than one that reports a state: it
                  never shows checked, because the row leaves the bench the
                  moment you use it. Styled as a plus for that reason - a
                  checkbox that can never be checked is a small lie, and the
                  stock control's white square was the loudest thing on a dark
                  page besides. */}
              <label className="card-rail-tick">
                <input type="checkbox" checked={false} disabled={!interactive}
                  onChange={() => interactive && onPick(l)}
                  aria-label={`Add ${lastName(l.favName)} over ${lastName(l.favorite === l.p1 ? l.name2 : l.name1)} to your picks`} />
                <span className="card-rail-plus" aria-hidden="true" />
              </label>
              <span className="card-rail-body">
                <span className="card-rail-name">
                  <Link to={`/match/${matchSlug(l)}`}>{lastName(l.favName)}</Link>
                  {!call && <span className="card-rail-tag">no call</span>}
                </span>
                <span className="card-rail-meta">
                  over {lastName(l.favorite === l.p1 ? l.name2 : l.name1)} · {pct(l.favProb)}
                  {o > 1 ? ` · ${o.toFixed(2)}` : ' · no price'}
                  {/* Always says something about when. The plan table beside
                      this one prints "time TBD" for a match whose order of
                      play is unpublished; this dropped the field entirely, so
                      the two surfaces disagreed about the same match and only
                      on the days a placeholder stamp turned up. */}
                  {` · ${start || 'time TBD'}`}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      {rows.length > 0 && onPickAll && interactive && (
        <button type="button" className="card-rail-all" onClick={onPickAll}>
          Add all {rows.length} to picks
        </button>
      )}
      {picked === 0 && rows.length > 0 && (
        <p className="card-rail-note">
          Your picks are empty, so there is nothing to price yet.
        </p>
      )}
    </aside>
  );
}
