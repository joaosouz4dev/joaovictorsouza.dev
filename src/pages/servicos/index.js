import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';
import Card from '../../components/ui/Card';
import { RevealGroup, RevealItem } from '../../components/ui/RevealOnScroll';
import { getServices } from './data';

const Servicos = () => {
  const { t, i18n } = useTranslation();
  const services = getServices(i18n.resolvedLanguage);

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: t('menu.home'), item: 'https://joaovictorsouza.dev/' },
      { '@type': 'ListItem', position: 2, name: t('menu.services'), item: 'https://joaovictorsouza.dev/servicos' },
    ],
  };

  return (
    <SiteLayout>
      <Seo
        title={t('servicesPage.seoTitle')}
        description={t('servicesPage.seoDescription')}
        canonical="/servicos"
        schema={schema}
      />

      <PageHero
        eyebrow={t('menu.services')}
        title={t('servicesPage.heroTitle')}
        description={t('servicesPage.heroDescription')}
      />

      <Section bordered>
        <RevealGroup className="grid grid-cols-1 gap-5 md:grid-cols-2" stagger={0.08}>
          {services.map((service) => (
            <RevealItem key={service.slug}>
              <Link to={`/servicos/${service.slug}`} className="block h-full">
                <Card spotlight className="h-full p-8 transition-transform hover:-translate-y-1">
                  <div className="flex items-start justify-between gap-4">
                    <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-border/80 bg-surface/60 text-foreground">
                      <Sparkles size={18} />
                    </div>
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-surface/40 text-foreground/80 transition-transform group-hover:-translate-y-0.5">
                      <ArrowUpRight size={14} />
                    </span>
                  </div>
                  <h2 className="mt-6 font-display text-xl md:text-2xl font-medium tracking-tight">
                    {service.title}
                  </h2>
                  <p className="mt-3 text-muted-foreground">{service.summary}</p>
                  <span className="mt-6 inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.16em] text-foreground/80">
                    {t('servicesPage.viewDetails')}
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

export default Servicos;
