import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, useScroll, useTransform } from 'framer-motion';
import { ExternalLink, Github, ArrowUpRight } from 'lucide-react';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';
import Container from '../../components/ui/Container';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { RevealOnScroll } from '../../components/ui/RevealOnScroll';
import { getCaseBySlug } from '../cases/data';

const Case = () => {
  const { t, i18n } = useTranslation();
  const { slug } = useParams();
  const caseItem = getCaseBySlug(slug, i18n.resolvedLanguage);

  const heroRef = React.useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.1]);

  if (!caseItem) {
    return (
      <SiteLayout>
        <Seo
          title={t('casePage.notFoundSeoTitle')}
          description={t('casePage.notFoundSeoDescription')}
          canonical="/cases"
          robots="noindex,follow"
        />
        <PageHero
          eyebrow="404"
          title={t('casePage.notFoundTitle')}
          description={`${t('casePage.notFoundDescription')} /cases ${t('casePage.notFoundDescriptionEnd')}`}
        >
          <Button to="/cases" variant="outline">
            {t('menu.cases')}
          </Button>
        </PageHero>
      </SiteLayout>
    );
  }

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: caseItem.title,
      description: caseItem.summary,
      author: { '@type': 'Person', name: 'João Victor Souza' },
      datePublished: '2026-03-03',
      dateModified: '2026-03-03',
      mainEntityOfPage: `https://joaovictorsouza.dev/cases/${caseItem.slug}`,
    },
  ];

  return (
    <SiteLayout>
      <Seo
        title={`${caseItem.title} | João Victor Souza`}
        description={caseItem.summary}
        canonical={`/cases/${caseItem.slug}`}
        schema={schema}
      />

      <PageHero
        eyebrow={t('casePage.kicker')}
        title={caseItem.title}
        description={caseItem.summary}
      />

      {caseItem.coverImage && (
        <section ref={heroRef} className="relative h-[50vh] md:h-[60vh] overflow-hidden border-y border-border/40">
          <motion.img
            src={caseItem.coverImage}
            alt={caseItem.title}
            loading="lazy"
            decoding="async"
            style={{ y, scale }}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background" />
        </section>
      )}

      <Section bordered>
        <div className="grid grid-cols-1 gap-12 md:grid-cols-12">
          <div className="md:col-span-8">
            <RevealOnScroll>
              <Card className="p-8">
                <h2 className="font-mono text-eyebrow uppercase text-muted-foreground mb-5">
                  {t('casePage.scenarioTitle')}
                </h2>
                <p className="text-foreground/90 leading-relaxed">{caseItem.challenge}</p>
              </Card>
            </RevealOnScroll>

            <RevealOnScroll delay={0.1}>
              <Card className="mt-5 p-8">
                <h2 className="font-mono text-eyebrow uppercase text-muted-foreground mb-5">
                  {t('casePage.solutionTitle')}
                </h2>
                <ul className="space-y-3">
                  {caseItem.solution.map((item, i) => (
                    <li key={i} className="flex gap-3 text-foreground/90">
                      <span className="mt-2.5 inline-block h-1 w-1 rounded-full bg-primary-400 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </RevealOnScroll>

            <RevealOnScroll delay={0.2}>
              <Card className="mt-5 p-8">
                <h2 className="font-mono text-eyebrow uppercase text-muted-foreground mb-5">
                  {t('casePage.resultsTitle')}
                </h2>
                <ul className="space-y-3">
                  {caseItem.results.map((item, i) => (
                    <li key={i} className="flex gap-3 text-foreground/90">
                      <span className="mt-2.5 inline-block h-1 w-1 rounded-full bg-emerald-400 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </RevealOnScroll>
          </div>

          <aside className="md:col-span-4">
            <div className="md:sticky md:top-32 space-y-5">
              <Card className="p-6">
                <h3 className="font-mono text-eyebrow uppercase text-muted-foreground mb-4">
                  {t('casePage.stackTitle')}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {caseItem.stack.map((s) => (
                    <span
                      key={s}
                      className="rounded-full border border-border/60 bg-surface/40 px-3 py-1 text-xs text-foreground/80"
                    >
                      {s}
                    </span>
                  ))}
                </div>
                <div className="mt-6 space-y-3">
                  {caseItem.demoUrl && (
                    <a
                      href={caseItem.demoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between rounded-2xl border border-border/60 bg-surface/40 px-4 py-3 text-sm text-foreground/80 transition-colors hover:text-foreground hover:border-foreground/30"
                    >
                      <span>{t('casePage.demoLabel')}</span>
                      <ExternalLink size={14} />
                    </a>
                  )}
                  {caseItem.repoUrl && (
                    <a
                      href={caseItem.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between rounded-2xl border border-border/60 bg-surface/40 px-4 py-3 text-sm text-foreground/80 transition-colors hover:text-foreground hover:border-foreground/30"
                    >
                      <span>{t('casePage.repositoryLabel')}</span>
                      <Github size={14} />
                    </a>
                  )}
                </div>
                <Button
                  to="/contato"
                  variant="primary"
                  size="md"
                  rightIcon={<ArrowUpRight size={16} />}
                  className="mt-6 w-full"
                >
                  {t('casePage.cta')}
                </Button>
              </Card>
            </div>
          </aside>
        </div>
      </Section>
    </SiteLayout>
  );
};

export default Case;
