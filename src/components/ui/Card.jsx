import React, { useRef } from 'react';
import { motion, useMotionTemplate, useMotionValue } from 'framer-motion';
import { cn } from '../../lib/cn';

export function Card({
  as: Tag = 'div',
  className,
  children,
  spotlight = false,
  interactive = false,
  ...props
}) {
  const ref = useRef(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const handleMouseMove = (e) => {
    if (!ref.current) return;
    const { left, top } = ref.current.getBoundingClientRect();
    mouseX.set(e.clientX - left);
    mouseY.set(e.clientY - top);
  };

  const background = useMotionTemplate`radial-gradient(420px circle at ${mouseX}px ${mouseY}px, rgba(168,85,247,0.18), transparent 60%)`;

  const MotionTag = motion[Tag] || motion.div;

  return (
    <MotionTag
      ref={ref}
      onMouseMove={spotlight ? handleMouseMove : undefined}
      className={cn(
        'group relative overflow-hidden rounded-3xl border border-border/60 bg-surface/40 backdrop-blur-xl',
        'transition-colors duration-300 hover:border-foreground/20',
        interactive && 'transition-transform duration-300 hover:-translate-y-1',
        className,
      )}
      {...props}
    >
      {spotlight && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -inset-px rounded-3xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{ background }}
        />
      )}
      {children}
    </MotionTag>
  );
}

export default Card;
