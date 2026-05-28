import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Github, ArrowUpRight, Code2 } from 'lucide-react';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';
import Card from '../../components/ui/Card';
import { RevealGroup, RevealItem } from '../../components/ui/RevealOnScroll';
import { getProjects } from './data';

const Projetos = () => {
  const { t, i18n } = useTranslation();
  const projects = getProjects(i18n.resolvedLanguage);

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: t('projectsPage.schemaName'),
    url: 'https://joaovictorsouza.dev/projetos',
  };

  return (
    <SiteLayout>
      <Seo
        title={t('projectsPage.seoTitle')}
        description={t('projectsPage.seoDescription')}
        canonical="/projetos"
        schema={schema}
      />

      <PageHero
        eyebrow={t('menu.projects')}
        title={t('projectsPage.heroTitle')}
        description={t('projectsPage.heroDescription')}
      />

      <Section bordered>
        <RevealGroup className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3" stagger={0.06}>
          {projects.map((p) => (
            <RevealItem key={p.slug}>
              <Link to={`/projetos/${p.slug}`} className="block h-full">
                <Card spotlight className="group h-full p-7 transition-transform hover:-translate-y-1">
                  <div className="flex items-start justify-between gap-4">
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-border/80 bg-surface/60 text-foreground">
                      <Code2 size={18} />
                    </div>
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-surface/40 text-foreground/80 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5">
                      <ArrowUpRight size={14} />
                    </span>
                  </div>
                  <h2 className="mt-5 font-display text-xl font-medium tracking-tight">
                    {p.title}
                  </h2>
                  <p className="mt-3 text-muted-foreground text-sm">{p.summary}</p>
                  {p.stack && (
                    <div className="mt-5 flex flex-wrap gap-1.5">
                      {p.stack.slice(0, 4).map((s) => (
                        <span key={s} className="rounded-full border border-border/60 bg-surface/40 px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </Card>
              </Link>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>
    </SiteLayout>
  );
};

export default Projetos;
