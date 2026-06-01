import React from 'react';
import { cn } from '../../lib/cn';

export function AnimatedText({
  text,
  as: Tag = 'h2',
  className,
  ...props
}) {
  return (
    <Tag className={cn('block max-w-full', className)} {...props}>
      {text}
    </Tag>
  );
}

export default AnimatedText;
