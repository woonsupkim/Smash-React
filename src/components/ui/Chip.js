import React from 'react';
import './Chip.css';

/**
 * Shared status/label chip. Replaces the ad-hoc, per-page "flag"/"tag" divs so
 * every small labelled pill in the app shares one shape, type scale, and tone
 * palette instead of being styled inline.
 *
 * tone: 'neutral' | 'positive' | 'warn' | 'info' | 'accent'
 * block: render on its own line (fit-content) instead of inline.
 */
export default function Chip({ tone = 'neutral', block = false, icon = null, children, className = '', ...rest }) {
  return (
    <span className={`ui-chip ui-chip--${tone}${block ? ' ui-chip--block' : ''} ${className}`} {...rest}>
      {icon && <span className="ui-chip-icon">{icon}</span>}
      {children}
    </span>
  );
}
