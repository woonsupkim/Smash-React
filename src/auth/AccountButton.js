// src/auth/AccountButton.js
//
// Navbar account control. Renders nothing when Supabase isn't configured,
// so the nav is unchanged until cloud mode exists.
import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import './Auth.css';

export default function AccountButton() {
  const { user, cloudEnabled, openSignIn, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!cloudEnabled) return null;

  if (!user) {
    return (
      <button type="button" className="account-btn" onClick={openSignIn}>
        Sign in
      </button>
    );
  }

  const label = user.email ? user.email.split('@')[0] : 'Account';
  return (
    <div className="account-wrap">
      <button
        type="button"
        className="account-btn signed-in"
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        {label}
      </button>
      {menuOpen && (
        <div className="account-menu" role="menu">
          <div className="account-email">{user.email}</div>
          <button type="button" role="menuitem" className="account-menu-item" onClick={() => { setMenuOpen(false); signOut(); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
