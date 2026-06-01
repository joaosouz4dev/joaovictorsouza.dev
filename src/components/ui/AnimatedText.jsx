import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '../../lib/cn';

export function AnimatedText({
  text,
  as: Tag = 'h2',
  className,
  split = 'words',
  delay = 0,
  stagger = 0.06,
  once = true,
  ...props
}) {
  const reduce = useReducedMotion();
  const items = split === 'chars' ? Array.from(text) : text.split(' ');

  if (reduce) {
    return (
      <Tag className={className} {...props}>
        {text}
      </Tag>
    );
  }

  const container = {
    hidden: {},
    show: {
      transition: { delayChildren: delay, staggerChildren: stagger },
    },
  };
  const child = {
    hidden: { opacity: 0, y: '0.6em', filter: 'blur(8px)' },
    show: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
    },
  };

  const MotionTag = motion[Tag] || motion.h2;

  return (
    <MotionTag
      variants={container}
      initial="hidden"
      whileInView="show"
      viewport={{ once, margin: '-10%' }}
      className={cn('block max-w-full', className)}
      {...props}
    >
      {items.map((item, i) => (
        <span key={i} className="inline-block overflow-hidden align-bottom max-w-full">
          <motion.span variants={child} className="inline-block whitespace-pre max-w-full">
            {item}
            {split === 'words' && i < items.length - 1 ? ' ' : ''}
          </motion.span>
        </span>
      ))}
    </MotionTag>
  );
}

export default AnimatedText;
