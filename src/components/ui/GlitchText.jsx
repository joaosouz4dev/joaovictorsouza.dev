import React from 'react';
import { useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/cn';

export function GlitchText({
  text,
  as: Tag = 'span',
  className,
  layerClassName,
  pixel = false,
}) {
  const reduce = useReducedMotion();
  const fontClass = pixel ? 'font-pixel' : 'font-display';

  return (
    <Tag
      data-text={text}
      className={cn(
        'relative inline-block',
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
