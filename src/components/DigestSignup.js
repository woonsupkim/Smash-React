// src/components/DigestSignup.js
//
// Weekly digest signup, rendered in the footer. One input, one insert into
// digest_subscribers (anon insert-only; the list is readable only by the
// CI sender's service key). Hidden entirely when Supabase isn't configured.
import React, { useState } from 'react';
import { supabase, cloudEnabled } from '../lib/supabase';

export default function DigestSignup() {
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

  if (state === 'done') {
    return <p className="digest-signup-done">You're on the list - one email a week, every number graded.</p>;
  }
  return (
    <form className="digest-signup" onSubmit={submit}>
      <label htmlFor="digest-email" className="digest-signup-label">The weekly digest, in your inbox</label>
      <div className="digest-signup-row">
        <input
          id="digest-email"
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (state === 'error') setState('idle'); }}
        />
        <button type="submit" disabled={state === 'busy'}>{state === 'busy' ? '...' : 'Subscribe'}</button>
      </div>
      {state === 'error' && <p className="digest-signup-err">That didn't save - try again in a moment.</p>}
      <p className="digest-signup-note">One email a week. Unsubscribe by replying "stop".</p>
    </form>
  );
}
