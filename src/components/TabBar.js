// src/components/TabBar.js
//
// Bottom tab bar on mobile widths: the four core destinations, one thumb
// away. Hidden on desktop (CSS); tour-aware so women's-side visitors stay
// on their mirror.
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Swords, TrendingUp, BarChart2 } from 'lucide-react';
import './TabBar.css';

// Four slots, so each one has to earn it. The old "Play" tab pointed at the
// daily game; with the games retired, the slot goes to The Edge - the one
// surface that is always populated (the market head-to-head runs year
// round) and the sharpest thing this app has to say. Brackets are seasonal
// and stay one tap away in the nav and footer.
const TABS = [
  { key: 'home', label: 'Home', icon: Home, path: '/', match: (p) => p === '/' || p === '/women', tourAware: true },
  { key: 'h2h', label: 'H2H', icon: Swords, path: '/h2h', match: (p) => p.endsWith('/h2h'), tourAware: true },
  { key: 'edge', label: 'Edge', icon: TrendingUp, path: '/edge', match: (p) => p.endsWith('/edge') },
  { key: 'record', label: 'Record', icon: BarChart2, path: '/track-record', match: (p) => p.endsWith('/track-record'), tourAware: true },
];

export default function TabBar() {
  const location = useLocation();
  const isWomen = location.pathname.startsWith('/women');
  const prefix = (path) => (isWomen ? (path === '/' ? '/women' : `/women${path}`) : path);

  return (
    <nav className="tabbar" aria-label="Primary">
      {TABS.map(({ key, label, icon: Icon, path, match, tourAware }) => {
        const active = match(location.pathname);
        return (
          <Link key={key} to={tourAware ? prefix(path) : path} className={`tabbar-item${active ? ' active' : ''}`}>
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
