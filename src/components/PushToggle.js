// src/components/PushToggle.js
//
// Upset-alert subscription toggle. Renders nothing unless the whole chain
// is available (browser push support + VAPID public key + Supabase), so on
// unconfigured deployments the page simply doesn't mention alerts. The
// subscription is anonymous - a delivery address, not an account.
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { toast } from './ui/Toast';

const VAPID = process.env.REACT_APP_VAPID_PUBLIC_KEY;

const b64ToUint8 = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export default function PushToggle() {
  const { user } = useAuth();
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID && !!supabase;
  const [sub, setSub] = useState(undefined); // undefined = checking, null = off
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((s) => setSub(s || null))
      .catch(() => setSub(null));
  }, [supported]);

  if (!supported || sub === undefined) return null;

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast({ type: 'error', title: 'Alerts blocked', message: 'Your browser declined notifications.' }); return; }
      const reg = await navigator.serviceWorker.ready;
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(VAPID) });
      const json = s.toJSON();
      // Signed-in subscribers get personal recaps ("you went 3-1"); the
      // user link is optional and anonymous subscriptions work unchanged.
      const { error } = await supabase.from('push_subscriptions').insert({ endpoint: json.endpoint, keys: json.keys, user_id: user?.id ?? null });
      if (error && error.code !== '23505') throw error; // unique violation = already subscribed, fine
      setSub(s);
      toast({ type: 'success', title: 'Upset alerts on', message: 'We only ring the bell for bold calls and graded upsets.' });
    } catch (err) {
      toast({ type: 'error', title: 'Could not subscribe', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      // Best-effort server cleanup: RLS deliberately has no anon delete
      // policy (an anonymous caller can't prove endpoint ownership), so
      // this may be refused - the browser unsubscribe above already stops
      // delivery, and the sender prunes the dead row on its next run.
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).then(() => {}, () => {});
      setSub(null);
      toast({ type: 'success', title: 'Alerts off', message: 'No more pings from us.' });
    } catch (err) {
      toast({ type: 'error', title: 'Could not unsubscribe', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={`push-toggle${sub ? ' on' : ''}`}
      disabled={busy}
      onClick={sub ? disable : enable}
    >
      {sub ? '🔔 Upset alerts on' : '🔕 Get upset alerts'}
    </button>
  );
}
