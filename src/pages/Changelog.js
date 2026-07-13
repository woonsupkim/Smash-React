// src/pages/Changelog.js
//
// Public release notes for the model and product. Enterprise signal: the
// engine is versioned, changes are dated, and accuracy claims are traceable
// to the revision that produced them.
import React from 'react';
import { Link } from 'react-router-dom';
import { CHANGELOG, MODEL_VERSION } from '../data/changelog';
import './Changelog.css';

const TYPE_LABELS = { model: 'Model', product: 'Product', ops: 'Operations' };

export default function Changelog() {
  return (
    <div className="changelog-page">
      <div className="eyebrow">RELEASE NOTES</div>
      <h1 className="changelog-title">Changelog</h1>
      <p className="changelog-sub">
        Every change to the prediction engine and the product, dated and versioned.
        The current engine is <strong>model v{MODEL_VERSION}</strong>; its live accuracy is
        graded on the <Link to="/track-record">track record</Link>.
      </p>

      <div className="changelog-list">
        {CHANGELOG.map((rel) => (
          <article className="changelog-entry" key={rel.version}>
            <div className="changelog-meta">
              <span className="changelog-version">v{rel.version}</span>
              <span className={`changelog-type t-${rel.type}`}>{TYPE_LABELS[rel.type]}</span>
              <span className="changelog-date">
                {new Date(rel.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
            <h2 className="changelog-entry-title">{rel.title}</h2>
            <ul className="changelog-notes">
              {rel.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
