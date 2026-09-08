// src/pages/Digests.js
//
// Every edition we have mailed, kept and linked.
//
// The digest used to exist only in subscribers' inboxes and in whatever file
// the last build happened to overwrite. That made a daily claim unverifiable
// after a day: a reader could not check what we said on Tuesday, and neither
// could we. This is the same record the Ledger is for our calls - the mailed
// copy, dated, archived on every build.
//
// Two lists, because the editions answer different questions. The daily is
// yesterday graded plus today's card; the weekly is the week's record and
// what following it returned.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useDocMeta from '../utils/useDocMeta';
import './Digests.css';

const INDEX = '/data/digest-archive/index.json';

// The venue day the edition was built for, spelled out. Parsed at noon UTC so
// no timezone can shift the printed day off the one in the filename.
function longDate(day) {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function EditionList({ rows, empty }) {
  if (!rows.length) return <p className="digests-empty">{empty}</p>;
  return (
    <ul className="digests-list">
      {rows.map((e) => (
        <li key={`${e.mode}-${e.date}`}>
          {/* Opens the archived HTML itself rather than a re-render of it, so
              what you read here is byte-for-byte what went out. */}
          <a href={`/data/digest-archive/${e.file}`} target="_blank" rel="noopener noreferrer">
            <span className="digests-date">{longDate(e.date)}</span>
            {e.summary ? <span className="digests-summary">{e.summary}</span> : null}
            {e.subject ? <span className="digests-subject">{e.subject}</span> : null}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function Digests() {
  useDocMeta(
    'The Digests · Every Edition We Have Sent | Smash',
    'Archive of the Smash daily and weekly digests. Every edition we mailed, dated and kept, so any claim we made can be checked after the fact.'
  );

  const [state, setState] = useState({ status: 'loading', editions: [] });

  useEffect(() => {
    let live = true;
    fetch(INDEX)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => live && setState({ status: 'ok', editions: d.editions || [] }))
      .catch(() => live && setState({ status: 'error', editions: [] }));
    return () => { live = false; };
  }, []);

  const daily = state.editions.filter((e) => e.mode === 'daily');
  const weekly = state.editions.filter((e) => e.mode === 'weekly');

  return (
    <div className="page-background">
      <div className="page-content">
        <div className="overlay">
          <div className="digests-page">
            <div className="digests-cap">The Receipts</div>
            <h1 className="digests-title">Every edition we have sent</h1>
            <p className="digests-sub">
              The mail itself, dated and kept. A claim we made on a Tuesday should still be
              readable on a Friday, by you and by us. Same principle as{' '}
              <Link to="/track-record">the Ledger</Link>: publish it, then leave it where it can
              be checked.
            </p>

            {state.status === 'loading' && <p className="digests-empty">Loading the archive…</p>}
            {state.status === 'error' && (
              <p className="digests-empty">
                The archive index could not be loaded. It is written on every refresh, so this
                usually means no edition has been built yet.
              </p>
            )}

            {state.status === 'ok' && (
              <>
                <section className="digests-section">
                  <h2>Daily</h2>
                  <p className="digests-note">
                    Yesterday graded, today&apos;s card locked before play, and what the
                    recommended plan would have returned. Sent every morning during a slam.
                  </p>
                  <EditionList rows={daily} empty="No daily editions archived yet." />
                </section>

                <section className="digests-section">
                  <h2>Weekly</h2>
                  <p className="digests-note">
                    The week&apos;s record day by day, the misses, the moments, and how we did
                    against the bookmakers. Sent on Mondays.
                  </p>
                  <EditionList rows={weekly} empty="No weekly editions archived yet." />
                </section>
              </>
            )}

            <div className="digests-footer">
              <Link to="/track-record">The Ledger</Link>
              <Link to="/edge">The Edge</Link>
              <Link to="/">Home</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
