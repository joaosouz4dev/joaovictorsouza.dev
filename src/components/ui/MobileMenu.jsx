import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { cn } from '../../lib/cn';

export function MobileMenu({ items, ctaLabel, ctaHref, className }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menu"
        className={cn(
          'inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-surface/60 text-foreground/80 backdrop-blur-xl transition-colors hover:text-foreground',
          className,
        )}
      >
        <Menu size={16} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-[80] bg-background/95 backdrop-blur-2xl"
          >
            <div className="container-px mx-auto max-w-6xl py-6">
              <div className="flex items-center justify-between">
                <span className="font-display text-lg font-medium tracking-tight">JV</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Fechar menu"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-surface/60 text-foreground/80"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <motion.ul
              initial="hidden"
              animate="show"
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
              }}
              className="container-px mx-auto max-w-6xl mt-16 flex flex-col gap-2"
            >
              {items.map((it) => {
                const isActive =
                  it.to === '/' ? location.pathname === '/' : location.pathname.startsWith(it.to);
                return (
                  <motion.li
                    key={it.to}
                    variants={{
                      hidden: { opacity: 0, y: 24, filter: 'blur(8px)' },
                      show: { opacity: 1, y: 0, filter: 'blur(0px)' },
                    }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <Link
                      to={it.to}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'group flex items-center justify-between border-b border-border/30 py-5 font-display text-3xl md:text-5xl font-medium tracking-tight transition-colors',
                        isActive ? 'text-foreground' : 'text-foreground/60 hover:text-foreground',
                      )}
                    >
                      <span>{it.label}</span>
                      <span className="text-muted-foreground transition-transform group-hover:translate-x-1">
                        →
                      </span>
                    </Link>
                  </motion.li>
                );
              })}
            </motion.ul>
            {ctaHref && ctaLabel && (
              <div className="container-px mx-auto max-w-6xl mt-12">
                <a
                  href={ctaHref}
                  target={ctaHref.startsWith('http') ? '_blank' : undefined}
                  rel={ctaHref.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="inline-flex items-center gap-2 rounded-full bg-gradient-accent px-6 py-3 text-sm font-medium text-white shadow-glow"
                >
                  {ctaLabel} →
                </a>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default MobileMenu;
