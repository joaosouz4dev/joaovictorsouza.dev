import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutGroup, motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';
import Card from '../../components/ui/Card';
import { RevealGroup, RevealItem } from '../../components/ui/RevealOnScroll';
import { cn } from '../../lib/cn';
import { getCases } from './data';

const Cases = () => {
  const { t, i18n } = useTranslation();
  const cases = getCases(i18n.resolvedLanguage);
  const allLabel = t('casesPage.allFilter');
  const [active, setActive] = useState(allLabel);

  const categories = useMemo(
    () => [allLabel, ...new Set(cases.map((c) => c.category))],
    [allLabel, cases],
  );

  useEffect(() => setActive(allLabel), [allLabel]);

  const visible = active === allLabel ? cases : cases.filter((c) => c.category === active);

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Cases de Integrações e IA',
    url: 'https://joaovictorsouza.dev/cases',
  };

  return (
    <SiteLayout>
      <Seo
        title={t('casesPage.seoTitle')}
        description={t('casesPage.seoDescription')}
        canonical="/cases"
        schema={schema}
      />

      <PageHero
        eyebrow={t('menu.cases')}
        title={t('casesPage.heroTitle')}
        description={t('casesPage.heroDescription')}
      />

      <Section bordered>
        <div className="mb-10">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground mb-4">
            {t('casesPage.filterTitle')}
          </p>
          <LayoutGroup id="cases-filters">
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActive(cat)}
                  className={cn(
                    'relative rounded-full border border-border/60 px-4 py-2 text-xs font-mono uppercase tracking-[0.16em] transition-colors',
                    active === cat ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {active === cat && (
                    <motion.span
                      layoutId="cases-filter-active"
                      className="absolute inset-0 -z-10 rounded-full bg-foreground/[0.07] border border-foreground/20"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                  {cat}
                </button>
              ))}
            </div>
          </LayoutGroup>
        </div>

        <RevealGroup className="grid grid-cols-1 gap-5 md:grid-cols-2" stagger={0.06}>
          {visible.map((c) => (
            <RevealItem key={c.slug}>
              <Link to={`/cases/${c.slug}`} className="block h-full">
                <Card spotlight className="h-full p-6 md:p-8 transition-transform hover:-translate-y-1">
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded-full border border-border/80 bg-surface/60 px-3 py-1 text-[10px] md:text-xs font-mono uppercase tracking-[0.16em] text-foreground/80 break-words">
                      {c.category}
                    </span>
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/80 bg-surface/40 text-foreground/80">
                      <ArrowUpRight size={14} />
                    </span>
                  </div>
                  <h2 className="mt-6 font-display text-lg md:text-2xl font-medium tracking-tight break-words">
                    {c.title}
                  </h2>
                  <p className="mt-3 text-muted-foreground">{c.summary}</p>
                  <span className="mt-6 inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.16em] text-foreground/80">
                    {t('casesPage.viewFullCase')}
                  </span>
                </Card>
              </Link>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>
    </SiteLayout>
  );
};

export default Cases;
