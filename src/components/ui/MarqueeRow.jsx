import React from 'react';
import { cn } from '../../lib/cn';

export function MarqueeRow({ items, className, speed = 30, reverse = false }) {
  return (
    <div className={cn('relative overflow-hidden mask-fade-x', className)}>
      <div
        className="flex w-max gap-12 will-change-transform"
        style={{
          animation: `marquee ${speed}s linear infinite`,
          animationDirection: reverse ? 'reverse' : 'normal',
        }}
      >
        {[...items, ...items].map((item, i) => (
          <div
            key={i}
            className="flex shrink-0 items-center gap-3 font-mono text-eyebrow uppercase text-muted-foreground"
          >
            {item.icon && <span className="text-foreground/80">{item.icon}</span>}
            <span>{item.label}</span>
            <span className="text-foreground/20">•</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MarqueeRow;
