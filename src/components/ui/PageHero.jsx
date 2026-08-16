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
        'relative pt-28 pb-12 md:pt-40 md:pb-24',
        className,
      )}
    >
      {/* O breadcrumb do SiteLayout fica acima deste header, entao o bloco decorativo
          se estende para tras dele ate o topo da tela. O wash linear garante cor ja no
          primeiro pixel: a borda do elipse do Spotlight e transparente e sozinha nao
          pinta o topo. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -top-44 md:-top-48 -z-10 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[420px] bg-[linear-gradient(to_bottom,rgba(168,85,247,0.22),rgba(168,85,247,0.10)_45%,transparent)]" />
        <Spotlight className="z-0 top-44 md:top-48" glowClassName="h-[130%]" />
        <GlowEffect
          intensity="xl"
          color="primary"
          className="left-1/2 top-44 md:top-48 -translate-x-1/2 opacity-50"
        />
      </div>
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
