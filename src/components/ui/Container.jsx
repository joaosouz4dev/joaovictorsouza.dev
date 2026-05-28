import React from 'react';
import { cn } from '../../lib/cn';

export const Container = React.forwardRef(function Container(
  { as: Tag = 'div', className, children, size = 'default', ...props },
  ref,
) {
  const sizes = {
    sm: 'max-w-3xl',
    default: 'max-w-6xl',
    lg: 'max-w-7xl',
    full: 'max-w-[1440px]',
  };
  return (
    <Tag ref={ref} className={cn('mx-auto w-full container-px', sizes[size], className)} {...props}>
      {children}
    </Tag>
  );
});

export default Container;
