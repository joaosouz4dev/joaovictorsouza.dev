import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';

const base =
  'group relative inline-flex items-center justify-center gap-2 font-medium tracking-tight rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:pointer-events-none will-change-transform';

const variants = {
  primary:
    'text-white bg-gradient-accent shadow-glow hover:shadow-[0_0_80px_-10px_rgba(168,85,247,0.6)] hover:-translate-y-0.5',
  secondary:
    'bg-foreground text-background hover:bg-foreground/90 hover:-translate-y-0.5',
  outline:
    'border border-border/80 text-foreground bg-surface/40 backdrop-blur hover:bg-surface hover:border-foreground/30',
  ghost:
    'text-foreground/80 hover:text-foreground hover:bg-foreground/5',
};

const sizes = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-6 text-sm',
  lg: 'h-14 px-8 text-base',
};

export const Button = React.forwardRef(function Button(
  {
    as,
    to,
    href,
    variant = 'primary',
    size = 'md',
    className,
    children,
    leftIcon,
    rightIcon,
    ...props
  },
  ref,
) {
  const classes = cn(base, variants[variant], sizes[size], className);
  const content = (
    <>
      {leftIcon && <span className="-ml-0.5 inline-flex">{leftIcon}</span>}
      <span>{children}</span>
      {rightIcon && (
        <span className="-mr-0.5 inline-flex transition-transform group-hover:translate-x-0.5">
          {rightIcon}
        </span>
      )}
    </>
  );

  if (to) {
    return (
      <Link ref={ref} to={to} className={classes} {...props}>
        {content}
      </Link>
    );
  }
  if (href) {
    return (
      <a
        ref={ref}
        href={href}
        target={props.target ?? (href.startsWith('http') ? '_blank' : undefined)}
        rel={props.rel ?? (href.startsWith('http') ? 'noopener noreferrer' : undefined)}
        className={classes}
        {...props}
      >
        {content}
      </a>
    );
  }
  const Tag = as || 'button';
  return (
    <Tag ref={ref} className={classes} {...props}>
      {content}
    </Tag>
  );
});

export default Button;
