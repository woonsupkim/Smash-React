// src/pages/Changelog.js
//
// Public release notes for the model and product. Enterprise signal: the
// engine is versioned and accuracy claims are traceable to the revision that
// produced them.
//
// Entries carry no date on the page. They are still dated in the data, and
// the order is still chronological - what a reader needs from release notes
// is what changed and in which version, and a date beside every line mostly
// invited "is this still maintained?" arithmetic instead.
import React from 'react';
import { Link } from 'react-router-dom';
import { CHANGELOG, MODEL_VERSION } from '../data/changelog';
import useDocMeta from '../utils/useDocMeta';
import './Changelog.css';

const TYPE_LABELS = { model: 'Model', product: 'Product', ops: 'Operations' };

export default function Changelog() {
  useDocMeta(
    'Changelog: Model & Product Releases | Smash',
    'Every change to the prediction engine and the product, versioned and in order.'
  );
  return (
    <div className="changelog-page">
      <div className="eyebrow">RELEASE NOTES</div>
      <h1 className="changelog-title">Changelog</h1>
      <p className="changelog-sub">
        Every change to the prediction engine and the product, versioned and in order.
        The current engine is <strong>model v{MODEL_VERSION}</strong>; its live accuracy is
        graded on <Link to="/track-record">the Ledger</Link>.
      </p>

      <div className="changelog-list">
        {CHANGELOG.map((rel) => (
          <article className="changelog-entry" key={rel.version}>
            <div className="changelog-meta">
              <span className="changelog-version">v{rel.version}</span>
              <span className={`changelog-type t-${rel.type}`}>{TYPE_LABELS[rel.type]}</span>
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
