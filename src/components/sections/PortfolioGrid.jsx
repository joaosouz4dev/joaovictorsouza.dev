import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { ExternalLink, X } from 'lucide-react';
import Container from '../ui/Container';
import { RevealOnScroll } from '../ui/RevealOnScroll';
import { cn } from '../../lib/cn';

const PROJECTS = (t) => [
  { categories: ['sistema', 'app'], img: '/assets/images/portfolio/sendeasy.webp', title: 'Sendeasy', subTitle: `${t('portfolio.words.system')}, ${t('portfolio.words.app')}`, link: 'https://sendeasy.app/', descricao: 'Plataforma de envio automatizado de mensagens via WhatsApp com integração Cloud API, fluxos, templates e chatbot com IA.', tecnologias: ['React', 'Node.js', 'WhatsApp Cloud API', 'TypeScript'] },
  { categories: ['app', 'sistema'], img: '/assets/images/portfolio/credito-semanal.webp', title: 'Crédito Semanal', subTitle: `${t('portfolio.words.app')}, ${t('portfolio.words.system')}`, link: 'https://app.creditosemanal.com.br/', descricao: 'Aplicativo para solicitação e gestão de crédito semanal com onboarding digital e integração financeira.', tecnologias: ['React Native', 'Node.js', 'TypeScript'] },
  { categories: ['sistema'], img: '/assets/images/portfolio/solardash.webp', title: 'Solardash', subTitle: t('portfolio.words.system'), link: 'https://solardash.com.br/', descricao: t('portfolio.descriptions.desc2'), tecnologias: ['React', 'Node.js', 'PHP', 'JavaScript'] },
  { categories: ['sistema'], img: '/assets/images/portfolio/wppconnect.webp', title: 'WppConnect', subTitle: t('portfolio.words.system'), link: 'https://wppconnect.io/', descricao: t('portfolio.descriptions.desc7'), tecnologias: ['React', 'Node.js', 'JavaScript'] },
  { categories: ['site', 'app'], img: '/assets/images/portfolio/mapp.webp', title: 'Mapp Sistemas', subTitle: `${t('portfolio.words.site')}, ${t('portfolio.words.app')}`, link: 'https://mappsistemas.com.br/', descricao: t('portfolio.descriptions.desc4'), tecnologias: ['React Native', 'WordPress', 'PHP', 'JavaScript'] },
  { categories: ['ecommerce', 'app'], img: '/assets/images/portfolio/dujuca.webp', title: 'Dujuca', subTitle: `${t('portfolio.words.ecommerce')}, ${t('portfolio.words.app')}`, link: 'https://dujuca.com/', descricao: t('portfolio.descriptions.desc6'), tecnologias: ['React', 'React Native', 'WordPress'] },
  { categories: ['sistema'], img: '/assets/images/portfolio/folhetos.webp', title: 'Folhetos.app', subTitle: t('portfolio.words.system'), link: 'https://folhetos.app/', descricao: t('portfolio.descriptions.desc5'), tecnologias: ['PHP', 'JavaScript', 'HTML', 'CSS'] },
  { categories: ['site'], img: '/assets/images/portfolio/lumus.webp', title: 'Lumus Solar', subTitle: t('portfolio.words.site'), link: 'https://www.lumus.eng.br/', descricao: t('portfolio.descriptions.desc3'), tecnologias: ['WordPress', 'PHP', 'HTML', 'CSS'] },
];

export function PortfolioGrid() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const items = useMemo(() => PROJECTS(t), [t]);
  const filters = [
    { key: 'all', label: t('portfolio.words.all') },
    { key: 'site', label: t('portfolio.words.site') },
    { key: 'app', label: t('portfolio.words.app') },
    { key: 'sistema', label: t('portfolio.words.system') },
    { key: 'ecommerce', label: t('portfolio.words.ecommerce') },
  ];
  const filtered = filter === 'all' ? items : items.filter((i) => i.categories.includes(filter));

  React.useEffect(() => {
    const onEsc = (e) => e.key === 'Escape' && setSelected(null);
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, []);

  return (
    <section id="portfolio" className="relative py-20 md:py-28">
      <Container size="lg">
        <RevealOnScroll>
          <div className="mb-8 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
            <div>
              <p className="font-mono text-eyebrow uppercase text-muted-foreground mb-3">
                {t('menu.portfolio')}
              </p>
              <h2 className="font-display text-h1 font-medium tracking-tight text-balance">
                {t('portfolio.title')}
              </h2>
            </div>
            <LayoutGroup id="portfolio-filters">
              <div className="flex flex-wrap gap-2">
                {filters.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      'relative rounded-full border border-border/60 px-4 py-2 text-xs font-mono uppercase tracking-[0.16em] transition-colors',
                      filter === f.key
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {filter === f.key && (
                      <motion.span
                        layoutId="portfolio-filter-active"
                        className="absolute inset-0 -z-10 rounded-full bg-foreground/[0.07] border border-foreground/20"
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                      />
                    )}
                    {f.label}
                  </button>
                ))}
              </div>
            </LayoutGroup>
          </div>
        </RevealOnScroll>

        <LayoutGroup>
          <motion.div layout className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((item, idx) => (
                <motion.button
                  layout
                  key={item.title}
                  onClick={() => setSelected(item)}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.45, delay: idx * 0.05, ease: [0.22, 1, 0.36, 1] }}
                  className="group relative overflow-hidden rounded-3xl border border-border/60 bg-surface/40 text-left backdrop-blur-xl transition-colors hover:border-foreground/30"
                >
                  <div className="relative aspect-[4/3] overflow-hidden">
                    <img
                      src={item.img}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent opacity-80" />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 p-5">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="font-mono text-eyebrow uppercase text-muted-foreground mb-2">
                          {item.subTitle}
                        </p>
                        <h3 className="font-display text-lg font-medium tracking-tight">
                          {item.title}
                        </h3>
                      </div>
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/80 bg-surface/80 text-foreground transition-transform group-hover:-translate-y-1 group-hover:translate-x-1">
                        <ExternalLink size={14} />
                      </span>
                    </div>
                  </div>
                </motion.button>
              ))}
            </AnimatePresence>
          </motion.div>
        </LayoutGroup>
      </Container>

      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => setSelected(null)}
            className="fixed inset-0 z-[90] grid place-items-center bg-background/80 backdrop-blur-xl p-4"
            role="dialog"
            aria-modal="true"
            aria-label={selected.title}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-w-4xl w-full overflow-hidden rounded-3xl border border-border/60 bg-elevated shadow-elevated"
            >
              <button
                onClick={() => setSelected(null)}
                aria-label="Fechar"
                className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/80 bg-surface/80 text-foreground backdrop-blur-xl transition-colors hover:border-foreground/30"
              >
                <X size={16} />
              </button>
              <div className="relative aspect-[16/9] overflow-hidden">
                <img src={selected.img} alt={selected.title} className="h-full w-full object-cover" />
              </div>
              <div className="p-8">
                <p className="font-mono text-eyebrow uppercase text-muted-foreground mb-3">
                  {selected.subTitle}
                </p>
                <h3 className="font-display text-h2 font-medium tracking-tight">{selected.title}</h3>
                <p className="mt-4 text-muted-foreground">{selected.descricao}</p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {selected.tecnologias.map((tech) => (
                    <span
                      key={tech}
                      className="rounded-full border border-border/60 bg-surface/40 px-3 py-1 text-xs text-foreground/70"
                    >
                      {tech}
                    </span>
                  ))}
                </div>
                <a
                  href={selected.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-8 inline-flex items-center gap-2 rounded-full bg-gradient-accent px-6 py-3 text-sm font-medium text-white shadow-glow"
                >
                  {t('portfolio.btn')} <ExternalLink size={14} />
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export default PortfolioGrid;
