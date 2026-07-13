// src/auth/AuthContext.js
//
// App-wide auth state plus the sign-in modal itself, so any component can
// call openSignIn() without owning modal state. Magic-link email sign-in:
// no passwords to store, phish, or forget. When Supabase isn't configured
// (cloudEnabled false) the provider renders children untouched and user
// stays null forever.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Form } from 'react-bootstrap';
import AppModal from '../components/ui/AppModal';
import { toast } from '../components/ui/Toast';
import { supabase, cloudEnabled } from '../lib/supabase';

const AuthContext = createContext({
  user: null,
  cloudEnabled: false,
  openSignIn: () => {},
  signOut: () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState(null);

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const openSignIn = () => {
    setEmail('');
    setSentTo(null);
    setModalOpen(true);
  };

  const sendLink = async () => {
    const addr = email.trim();
    if (!addr || sending || !supabase) return;
    setSending(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: addr,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setSentTo(addr);
    } catch (err) {
      toast({ type: 'error', title: 'Could not send link', message: err.message });
    } finally {
      setSending(false);
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    toast({ type: 'info', title: 'Signed out' });
  };

  return (
    <AuthContext.Provider value={{ user, cloudEnabled, openSignIn, signOut }}>
      {children}
      {cloudEnabled && (
        <AppModal
          show={modalOpen}
          onHide={() => setModalOpen(false)}
          title="Sign in"
          confirmText={sentTo ? 'Done' : (sending ? 'Sending…' : 'Email me a link')}
          onConfirm={sentTo ? () => setModalOpen(false) : sendLink}
          confirmDisabled={!sentTo && (!email.trim() || sending)}
        >
          {sentTo ? (
            <p className="auth-sent">
              Check <strong>{sentTo}</strong> for a sign-in link. Opening it on this
              device signs you in here; no password needed.
            </p>
          ) : (
            <>
              <p className="auth-note">
                One email, no password: we send a magic link and you're in.
                Signing in lets your pools and brackets follow you across devices.
              </p>
              <Form.Group>
                <Form.Label>Email</Form.Label>
                <Form.Control
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendLink(); }}
                  placeholder="you@example.com"
                  autoFocus
                  autoComplete="email"
                />
              </Form.Group>
            </>
          )}
        </AppModal>
      )}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
