// src/components/TabBar.js
//
// Bottom tab bar on mobile widths: the four core destinations, one thumb
// away. Hidden on desktop (CSS); tour-aware so women's-side visitors stay
// on their mirror.
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Swords, Trophy, BarChart2 } from 'lucide-react';
import './TabBar.css';

const TABS = [
  { key: 'home', label: 'Home', icon: Home, path: '/', match: (p) => p === '/' || p === '/women' },
  { key: 'h2h', label: 'H2H', icon: Swords, path: '/h2h', match: (p) => p.endsWith('/h2h') },
  { key: 'brackets', label: 'Brackets', icon: Trophy, path: '/dream-brackets', match: (p) => p.endsWith('/dream-brackets') },
  { key: 'record', label: 'Record', icon: BarChart2, path: '/track-record', match: (p) => p.endsWith('/track-record') },
];

export default function TabBar() {
  const location = useLocation();
  const isWomen = location.pathname.startsWith('/women');
  const prefix = (path) => (isWomen ? (path === '/' ? '/women' : `/women${path}`) : path);

  return (
    <nav className="tabbar" aria-label="Primary">
      {TABS.map(({ key, label, icon: Icon, path, match }) => {
        const active = match(location.pathname);
        return (
          <Link key={key} to={prefix(path)} className={`tabbar-item${active ? ' active' : ''}`}>
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
