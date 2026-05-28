import React from 'react';
import { motion, useScroll, useSpring } from 'framer-motion';

export function ScrollProgress({ className }) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 220, damping: 30, restDelta: 0.001 });
  return (
    <motion.div
      aria-hidden
      style={{ scaleX, transformOrigin: '0% 50%' }}
      className={'fixed left-0 right-0 top-0 z-[60] h-0.5 bg-gradient-accent ' + (className || '')}
    />
  );
}

export default ScrollProgress;
