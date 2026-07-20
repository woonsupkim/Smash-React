// src/components/TabBar.js
//
// Bottom tab bar on mobile widths: the four core destinations, one thumb
// away. Hidden on desktop (CSS); tour-aware so women's-side visitors stay
// on their mirror.
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Swords, Gamepad2, BarChart2 } from 'lucide-react';
import './TabBar.css';

// "Play" replaced "Brackets" when the games multiplied (Oddsle, pick'em,
// bracket challenge, the gym): the tab lands on the daily game - the
// strongest habit loop - and every other game is one tap further. Dream
// Brackets keeps its nav/footer entries; play routes light this tab up.
const PLAY_PATHS = ['/oddsle', '/pickem', '/challenge', '/gym', '/dream-brackets'];
const TABS = [
  { key: 'home', label: 'Home', icon: Home, path: '/', match: (p) => p === '/' || p === '/women', tourAware: true },
  { key: 'h2h', label: 'H2H', icon: Swords, path: '/h2h', match: (p) => p.endsWith('/h2h'), tourAware: true },
  { key: 'play', label: 'Play', icon: Gamepad2, path: '/oddsle', match: (p) => PLAY_PATHS.some((x) => p.endsWith(x)) },
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
