import React from 'react';
import { cn } from '../../lib/cn';

const variants = {
  default: 'border border-border/80 bg-surface/60 text-foreground/90',
  gradient:
    'border border-transparent bg-gradient-accent-soft text-foreground/90 backdrop-blur',
  dot: 'border border-border/60 bg-surface/40 text-muted-foreground',
  solid: 'bg-foreground text-background border border-transparent',
};

export function Badge({ variant = 'default', className, children, withDot = false, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-mono uppercase tracking-[0.16em]',
        variants[variant],
        className,
      )}
      {...props}
    >
      {withDot && (
        <span className="relative inline-flex h-1.5 w-1.5">
          <span className="absolute inset-0 rounded-full bg-primary-400 animate-ping opacity-60" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-primary-400" />
        </span>
      )}
      {children}
    </span>
  );
}

export default Badge;
