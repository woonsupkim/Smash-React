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
//
// On the frequency wording: buildDigest sends a WEEKLY edition on Mondays and
// a DAILY one whenever the refresh workflow runs, which it does every day
// inside the slam and combined-1000 windows - to the same subscriber list. So
// "one email a week", which this said for a long time, is not true during a
// tournament. And every real subscriber gets a one-click unsubscribe link
// (their own token); "reply stop" is only the fallback for addresses with no
// token, so it should not be the promise on the form.
import React, { useId, useState } from 'react';
import { supabase, cloudEnabled } from '../lib/supabase';
import FollowCta from './FollowCta';
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
        Weekly on Mondays, and daily while a slam or a big combined event is on. One-click
        unsubscribe in every email.
      </p>
    </form>
  );

  if (!band) return form;

  return (
    <section className="digest-band" aria-labelledby={`digest-band-h-${uid}`}>
      <div className="digest-band-copy">
        <h2 className="digest-band-title" id={`digest-band-h-${uid}`}>
          Get the week&apos;s calls, and the receipts
        </h2>
        <p className="digest-band-sub">
          Every pick we locked before play, how it actually landed, and where we were wrong. The
          same record this whole site is graded on. Mondays, and every day once a slam starts.
        </p>
      </div>
      <div className="digest-band-asks">
        {form}
        {/* Two ways to come back, in one highlight rather than two competing
            blocks. The email is the ask that actually delivers the plan, so
            it keeps the primary position; the follow is the lighter one for
            somebody who will not hand over an address, and it sits under a
            rule rather than beside the form so it cannot be mistaken for a
            second field. */}
        <div className="digest-band-or">
          <span>or</span>
        </div>
        <FollowCta variant="band"
          label="Follow on Instagram"
          sub="The card every morning, and how it landed" />
      </div>
    </section>
  );
}
