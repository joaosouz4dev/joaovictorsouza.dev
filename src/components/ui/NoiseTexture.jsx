import React from 'react';
import { cn } from '../../lib/cn';

export function NoiseTexture({ className, opacity = 0.04 }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 -z-10 bg-noise bg-repeat mix-blend-overlay',
        className,
      )}
      style={{ opacity }}
    />
  );
}

export default NoiseTexture;
