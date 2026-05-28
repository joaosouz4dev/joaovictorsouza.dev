import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

const presets = {
  up: { hidden: { opacity: 0, y: 28 }, show: { opacity: 1, y: 0 } },
  down: { hidden: { opacity: 0, y: -28 }, show: { opacity: 1, y: 0 } },
  left: { hidden: { opacity: 0, x: 28 }, show: { opacity: 1, x: 0 } },
  right: { hidden: { opacity: 0, x: -28 }, show: { opacity: 1, x: 0 } },
  fade: { hidden: { opacity: 0 }, show: { opacity: 1 } },
  scale: { hidden: { opacity: 0, scale: 0.94 }, show: { opacity: 1, scale: 1 } },
};

export function RevealOnScroll({
  children,
  className,
  preset = 'up',
  delay = 0,
  duration = 0.6,
  once = true,
  amount = 0.2,
  as: Tag = 'div',
}) {
  const reduce = useReducedMotion();
  const MotionTag = motion[Tag] || motion.div;
  if (reduce) {
    return <Tag className={className}>{children}</Tag>;
  }
  return (
    <MotionTag
      className={className}
      variants={presets[preset]}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount }}
      transition={{ duration, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </MotionTag>
  );
}

export function RevealGroup({
  children,
  className,
  stagger = 0.08,
  delay = 0,
  once = true,
  amount = 0.2,
  as: Tag = 'div',
}) {
  const reduce = useReducedMotion();
  const MotionTag = motion[Tag] || motion.div;
  if (reduce) {
    return <Tag className={className}>{children}</Tag>;
  }
  return (
    <MotionTag
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount }}
      variants={{
        hidden: {},
        show: { transition: { delayChildren: delay, staggerChildren: stagger } },
      }}
    >
      {children}
    </MotionTag>
  );
}

export const RevealItem = React.forwardRef(function RevealItem(
  { children, className, preset = 'up', as: Tag = 'div', ...props },
  ref,
) {
  const reduce = useReducedMotion();
  const MotionTag = motion[Tag] || motion.div;
  if (reduce) {
    return (
      <Tag ref={ref} className={className} {...props}>
        {children}
      </Tag>
    );
  }
  return (
    <MotionTag
      ref={ref}
      className={className}
      variants={presets[preset]}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      {...props}
    >
      {children}
    </MotionTag>
  );
});

export default RevealOnScroll;
