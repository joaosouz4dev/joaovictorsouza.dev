import React, { useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { cn } from '../../lib/cn';

function DockItem({ to, label, icon, mouseX, isActive }) {
  const ref = useRef(null);
  const distance = useTransform(mouseX, (val) => {
    const rect = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - rect.x - rect.width / 2;
  });
  const widthSync = useTransform(distance, [-110, 0, 110], [40, 56, 40]);
  const width = useSpring(widthSync, { mass: 0.1, stiffness: 200, damping: 14 });

  return (
    <Link
      to={to}
      aria-current={isActive ? 'page' : undefined}
      aria-label={label}
      className="relative inline-flex"
    >
      <motion.span
        ref={ref}
        style={{ width, height: 40 }}
        className={cn(
          'inline-flex items-center justify-center rounded-full text-foreground/70 transition-colors',
          'hover:text-foreground',
          isActive && 'text-foreground',
        )}
      >
        {icon}
        {isActive && (
          <motion.span
            layoutId="dock-active"
            className="absolute inset-0 rounded-full bg-foreground/[0.07] -z-10"
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          />
        )}
      </motion.span>
    </Link>
  );
}

export function Dock({ items, className }) {
  const mouseX = useMotionValue(Infinity);
  const location = useLocation();

  return (
    <motion.nav
      role="navigation"
      aria-label="Navegação principal"
      onMouseMove={(e) => mouseX.set(e.clientX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border/60 bg-surface/70 px-2 py-2 backdrop-blur-2xl shadow-elevated',
        className,
      )}
    >
      {items.map((it) => {
        const isActive =
          it.to === '/' ? location.pathname === '/' : location.pathname.startsWith(it.to);
        return (
          <DockItem
            key={it.to}
            to={it.to}
            label={it.label}
            icon={it.icon}
            mouseX={mouseX}
            isActive={isActive}
          />
        );
      })}
    </motion.nav>
  );
}

export default Dock;
