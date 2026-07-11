import React from 'react';
import './Button.css';

/**
 * Token-based button. One place to define primary/secondary/danger/ghost
 * treatments so pages stop hand-rolling inline background/border colors.
 * `as` lets it render as a router <Link> or an <a> while keeping the styling.
 *
 * variant: 'primary' | 'secondary' | 'danger' | 'ghost'
 * size: 'sm' | 'md'
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  as: Tag = 'button',
  className = '',
  type,
  children,
  ...rest
}) {
  const typeProp = Tag === 'button' ? { type: type || 'button' } : {};
  return (
    <Tag className={`ui-btn ui-btn--${variant} ui-btn--${size} ${className}`} {...typeProp} {...rest}>
      {children}
    </Tag>
  );
}
