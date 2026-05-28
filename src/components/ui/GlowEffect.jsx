import React from 'react';
import { cn } from '../../lib/cn';

export function GlowEffect({ className, intensity = 'md', color = 'primary' }) {
  const sizes = { sm: 'h-24 w-24', md: 'h-48 w-48', lg: 'h-72 w-72', xl: 'h-[420px] w-[420px]' };
  const colors = {
    primary: 'bg-primary-500/30',
    fuchsia: 'bg-fuchsia-500/25',
    cyan: 'bg-cyan-400/25',
  };
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute rounded-full blur-3xl',
        sizes[intensity],
        colors[color],
        className,
      )}
    />
  );
}

export default GlowEffect;
