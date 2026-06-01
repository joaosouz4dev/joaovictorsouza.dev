import React from 'react';

export function RevealOnScroll({
  children,
  className,
  as: Tag = 'div',
  ...props
}) {
  return <Tag className={className} {...props}>{children}</Tag>;
}

export function RevealGroup({
  children,
  className,
  as: Tag = 'div',
  ...props
}) {
  return <Tag className={className} {...props}>{children}</Tag>;
}

export const RevealItem = React.forwardRef(function RevealItem(
  { children, className, as: Tag = 'div', ...props },
  ref,
) {
  return (
    <Tag ref={ref} className={className} {...props}>
      {children}
    </Tag>
  );
});

export default RevealOnScroll;
