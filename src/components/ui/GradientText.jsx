import React from 'react';
import { cn } from '../../lib/cn';

export function GradientText({ as: Tag = 'span', className, children, animate = false, ...props }) {
  return (
    <Tag
      className={cn(
        'bg-gradient-accent bg-clip-text text-transparent',
        animate && 'bg-[length:200%_200%] animate-gradient-shift',
        className,
      )}
      style={animate ? { backgroundSize: '200% 200%' } : undefined}
      {...props}
    >
      {children}
    </Tag>
  );
}

export default GradientText;
