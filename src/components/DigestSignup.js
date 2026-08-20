// src/components/DigestSignup.js
//
// Weekly digest signup. One input, one insert into digest_subscribers (anon
// insert-only; the list is readable only by the CI sender's service key).
// Hidden entirely when Supabase isn't configured.
//
// Rendered in MORE THAN ONE PLACE - the footer on every page, and as a full
// CTA band on the home page - which is why the field id comes from useId
// rather than being hardcoded. Two instances sharing one id would break label
// association and put a duplicate-id violation on every page.
//
// variant: 'footer' (compact, in the footer column) | 'band' (a real CTA with
// its own heading). Same form, same handler, different frame.
import React, { useId, useState } from 'react';
import { supabase, cloudEnabled } from '../lib/supabase';
import './DigestSignup.css';

export default function DigestSignup({ variant = 'footer' }) {
  const uid = useId();
  const inputId = `digest-email-${uid}`;
  const noteId = `digest-note-${uid}`;
  const errId = `digest-err-${uid}`;
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle'); // idle | busy | done | error

  if (!cloudEnabled) return null;

  const submit = async (e) => {
    e.preventDefault();
    const addr = email.trim();
    if (!/.+@.+\..+/.test(addr) || state === 'busy') return;
    setState('busy');
    const { error } = await supabase.from('digest_subscribers').insert({ email: addr });
    // Unique violation = already subscribed; that's a success for the user.
    if (!error || error.code === '23505') { setState('done'); setEmail(''); } else setState('error');
  };

  const band = variant === 'band';

  // Confirmation and failure are both announced: a sighted user sees the form
  // swap, a screen-reader user gets nothing at all without a live region.
  if (state === 'done') {
    return (
      <p className={`digest-signup-done${band ? ' band' : ''}`} role="status" aria-live="polite">
        You&apos;re on the list - one email a week, every number graded.
      </p>
    );
  }

  const form = (
    <form className={`digest-signup${band ? ' band' : ''}`} onSubmit={submit}>
      <label htmlFor={inputId} className="digest-signup-label">
        {band ? 'Get the weekly digest' : 'The weekly digest, in your inbox'}
      </label>
      <div className="digest-signup-row">
        <input
          id={inputId}
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          aria-invalid={state === 'error' || undefined}
          aria-describedby={state === 'error' ? `${errId} ${noteId}` : noteId}
          onChange={(e) => { setEmail(e.target.value); if (state === 'error') setState('idle'); }}
        />
        <button type="submit" disabled={state === 'busy'}>
          {state === 'busy' ? '...' : 'Subscribe'}
        </button>
      </div>
      {state === 'error' && (
        <p className="digest-signup-err" id={errId} role="alert">
          That didn&apos;t save - try again in a moment.
        </p>
      )}
      <p className="digest-signup-note" id={noteId}>
        One email a week. Unsubscribe by replying &quot;stop&quot;.
      </p>
    </form>
  );

  if (!band) return form;

  return (
    <section className="digest-band" aria-labelledby={`digest-band-h-${uid}`}>
      <div className="digest-band-copy">
        <h2 className="digest-band-title" id={`digest-band-h-${uid}`}>
          Every call, graded, once a week
        </h2>
        <p className="digest-band-sub">
          The week&apos;s locked picks and how they actually landed - including the ones we got
          wrong. No tips, no hype, just the record.
        </p>
      </div>
      {form}
    </section>
  );
}
