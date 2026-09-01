// src/components/FollowCta.js
//
// The Instagram follow, in one place.
//
// The handle lives here and nowhere else - it appears in the site footer, on
// Today's Calls and beside the digest signup, and a handle copy-pasted into
// three files is three things to miss when it changes.
//
// Deliberately NOT on every page as a banner. The footer carries it site-wide
// for anyone who goes looking; the other two placements are the moments where
// someone has just been given something worth coming back for. An app that
// asks for a follow between a reader and the thing they came to read is an app
// people stop reading.
import React from 'react';
import './FollowCta.css';

export const INSTAGRAM_HANDLE = 'smash.tennis.simulator';
export const INSTAGRAM_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}/`;

// The glyph, drawn rather than fetched: an <img> would be one more request and
// one more thing to 404, and a font icon would drag in a whole icon set for a
// single mark.
export function InstagramGlyph({ size = 16 }) {
  return (
    <svg className="follow-glyph" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.6" cy="6.4" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * variant:
 *   'inline' - a quiet text link, for footers and link rows
 *   'band'   - a real call to action, for the places that have just delivered
 *              something (the digest band, the end of today's card)
 */
export default function FollowCta({ variant = 'inline', label = null, sub = null }) {
  const band = variant === 'band';
  return (
    <a
      className={`follow-cta${band ? ' band' : ''}`}
      href={INSTAGRAM_URL}
      target="_blank"
      // noopener is the security half (the opened tab cannot touch
      // window.opener); noreferrer stops the referrer header going out.
      rel="noopener noreferrer"
    >
      <InstagramGlyph size={band ? 20 : 15} />
      <span className="follow-cta-text">
        <span className="follow-cta-main">{label || (band ? 'Follow the calls on Instagram' : 'Instagram')}</span>
        {band && (
          <span className="follow-cta-sub">
            {sub || `Every day's card and how it landed, @${INSTAGRAM_HANDLE}`}
          </span>
        )}
      </span>
      {band && <span className="follow-cta-go" aria-hidden="true">&rarr;</span>}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
