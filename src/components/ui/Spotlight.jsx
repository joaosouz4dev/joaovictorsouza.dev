import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/cn';

export function Spotlight({ className, fill = 'rgba(168,85,247,0.25)' }) {
  const reduce = useReducedMotion();
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 -z-10 overflow-hidden',
        className,
      )}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={reduce ? { opacity: 0.6 } : { opacity: [0.4, 0.7, 0.5], scale: [1, 1.05, 1] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute left-1/2 top-0 h-[80%] w-[120%] -translate-x-1/2 -translate-y-1/3 rounded-full blur-3xl"
        style={{
          background: `radial-gradient(ellipse at center, ${fill}, transparent 65%)`,
        }}
      />
    </div>
  );
}

export default Spotlight;
