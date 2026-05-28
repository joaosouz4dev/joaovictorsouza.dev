import React from 'react';
import { cn } from '../../lib/cn';
import Container from './Container';

const Section = React.forwardRef(function Section(
  {
    as: Tag = 'section',
    className,
    innerClassName,
    children,
    eyebrow,
    title,
    description,
    align = 'left',
    size = 'default',
    bordered = false,
    id,
    container = true,
    containerSize = 'default',
    ...props
  },
  ref,
) {
  return (
    <Tag
      ref={ref}
      id={id}
      className={cn(
        'relative py-20 md:py-28',
        bordered && 'border-t border-border/40',
        className,
      )}
      {...props}
    >
      {container ? (
        <Container size={containerSize} className={innerClassName}>
          {(eyebrow || title || description) && (
            <header
              className={cn(
                'mb-12 md:mb-16 max-w-2xl',
                align === 'center' && 'mx-auto text-center',
              )}
            >
              {eyebrow && (
                <p className="font-mono text-eyebrow uppercase text-muted-foreground mb-4">
                  {eyebrow}
                </p>
              )}
              {title && (
                <h2 className="font-display text-h1 font-medium tracking-tight text-balance">
                  {title}
                </h2>
              )}
              {description && (
                <p className="mt-4 text-base md:text-lg text-muted-foreground text-balance">
                  {description}
                </p>
              )}
            </header>
          )}
          {children}
        </Container>
      ) : (
        children
      )}
    </Tag>
  );
});

export default Section;
