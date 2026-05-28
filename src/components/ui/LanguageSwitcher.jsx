import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Languages, Check } from 'lucide-react';
import { cn } from '../../lib/cn';

const LANGS = [
  { code: 'pt', label: 'Português', short: 'PT' },
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'es', label: 'Español', short: 'ES' },
];

export function LanguageSwitcher({ className, align = 'right' }) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = LANGS.find((l) => i18n.resolvedLanguage?.startsWith(l.code)) ?? LANGS[0];

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Selecionar idioma"
        className="inline-flex h-10 items-center gap-2 rounded-full border border-border/60 bg-surface/60 px-3 text-xs font-mono uppercase tracking-[0.16em] text-foreground/80 backdrop-blur-xl transition-colors hover:text-foreground hover:border-foreground/30"
      >
        <Languages size={14} />
        <span>{current.short}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={cn(
              'absolute top-full mt-2 min-w-[160px] overflow-hidden rounded-2xl border border-border/60 bg-elevated/95 p-1 backdrop-blur-2xl shadow-elevated z-50',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            {LANGS.map((lang) => {
              const active = current.code === lang.code;
              return (
                <li key={lang.code}>
                  <button
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      i18n.changeLanguage(lang.code);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
                      active ? 'bg-foreground/5 text-foreground' : 'text-foreground/70 hover:bg-foreground/5 hover:text-foreground',
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-eyebrow text-muted-foreground">{lang.short}</span>
                      <span>{lang.label}</span>
                    </span>
                    {active && <Check size={14} className="text-primary-400" />}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export default LanguageSwitcher;
