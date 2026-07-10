import React from 'react';
import { useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/cn';

export function GlitchText({
  text,
  as: Tag = 'span',
  className,
  layerClassName,
  pixel = false,
  trigger = 'always',
}) {
  const reduce = useReducedMotion();
  const fontClass = pixel ? 'font-pixel' : 'font-display';
  const onHover = trigger === 'hover';

  // No modo hover as camadas ficam paradas e invisiveis em repouso e so
  // ganham a animacao de glitch quando o usuario passa o mouse, preservando
  // a legibilidade do texto principal (util para titulos importantes).
  const layer1 = onHover
    ? 'opacity-0 [animation-play-state:paused] group-hover:opacity-100 group-hover:[animation-play-state:running]'
    : '';
  const layer2 = layer1;

  return (
    <Tag
      data-text={text}
      className={cn(
        'relative inline-block',
        onHover && 'group',
        fontClass,
        className,
      )}
      style={{ textShadow: reduce ? 'none' : '0 0 30px rgba(168,85,247,0.35)' }}
    >
      <span className="relative z-10">{text}</span>
      {!reduce && (
        <>
          <span
            aria-hidden
            className={cn(
              'absolute inset-0 text-fuchsia-400/80 mix-blend-screen animate-glitch-1 will-change-transform',
              fontClass,
              layer1,
              layerClassName,
            )}
            style={{ textShadow: '2px 0 0 rgba(217,70,239,0.7)' }}
          >
            {text}
          </span>
          <span
            aria-hidden
            className={cn(
              'absolute inset-0 text-cyan-400/80 mix-blend-screen animate-glitch-2 will-change-transform',
              fontClass,
              layer2,
              layerClassName,
            )}
            style={{ textShadow: '-2px 0 0 rgba(34,211,238,0.7)' }}
          >
            {text}
          </span>
        </>
      )}
    </Tag>
  );
}

export default GlitchText;
