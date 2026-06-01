import React from 'react';
import Container from './Container';
import { AnimatedText } from './AnimatedText';
import { RevealOnScroll } from './RevealOnScroll';
import { GradientText } from './GradientText';
import { Spotlight } from './Spotlight';
import { GlowEffect } from './GlowEffect';
import { cn } from '../../lib/cn';

export function PageHero({ eyebrow, title, gradient, description, children, className }) {
  return (
    <header
      className={cn(
        'relative isolate overflow-hidden pt-28 pb-12 md:pt-40 md:pb-24',
        className,
      )}
    >
      <Spotlight />
      <GlowEffect intensity="xl" color="primary" className="left-1/2 top-0 -translate-x-1/2 opacity-50" />
      <Container size="lg">
        <div className="max-w-3xl">
          {eyebrow && (
            <RevealOnScroll>
              <p className="font-mono text-eyebrow uppercase text-muted-foreground mb-4 md:mb-6">
                {eyebrow}
              </p>
            </RevealOnScroll>
          )}
          <AnimatedText
            as="h1"
            text={title}
            split="words"
            className="font-display font-medium tracking-tight md:text-balance text-2xl sm:text-3xl md:text-5xl lg:text-6xl leading-[1.15] md:leading-[1.05] [overflow-wrap:break-word]"
          />
          {gradient && (
            <RevealOnScroll delay={0.2}>
              <GradientText
                as="span"
                className="block font-display font-medium tracking-tight text-2xl sm:text-3xl md:text-5xl lg:text-6xl leading-[1.15] md:leading-[1.05] [overflow-wrap:break-word]"
              >
                {gradient}
              </GradientText>
            </RevealOnScroll>
          )}
          {description && (
            <RevealOnScroll delay={0.3}>
              <p className="mt-6 md:mt-8 max-w-2xl text-base md:text-xl text-muted-foreground md:text-balance">
                {description}
              </p>
            </RevealOnScroll>
          )}
          {children && (
            <RevealOnScroll delay={0.4}>
              <div className="mt-8 md:mt-10 flex flex-wrap items-center gap-3">{children}</div>
            </RevealOnScroll>
          )}
        </div>
      </Container>
    </header>
  );
}

export default PageHero;
