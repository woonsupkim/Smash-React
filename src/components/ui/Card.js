import React from 'react';
import './Card.css';

/**
 * Shared surface card: one token-driven definition of the app's panel look
 * (surface, border, radius, shadow) so pages stop redefining it per file.
 * `accent` adds the tournament/brand accent top border used on the stat panels.
 */
export default function Card({ as: Tag = 'div', accent = false, className = '', children, ...rest }) {
  return (
    <Tag className={`ui-card${accent ? ' ui-card--accent' : ''} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
