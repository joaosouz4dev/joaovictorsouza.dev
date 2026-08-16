import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpRight,
  MessageSquare,
  BarChart3,
  BrainCircuit,
  Workflow,
  LineChart,
  Database,
  Activity,
  Server,
  Sparkles,
  MessagesSquare,
} from 'lucide-react';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';
import Card from '../../components/ui/Card';
import { RevealGroup, RevealItem } from '../../components/ui/RevealOnScroll';
import { getServices } from './data';

const WHATSAPP_URL = 'https://wa.me/5531998587817';

// Icone semantico por servico. Fallback em Sparkles para slugs futuros.
const SERVICE_ICONS = {
  'meta-ads-e-integracoes': BarChart3,
  'whatsapp-cloud-api': MessageSquare,
  'chatbots-e-ia': BrainCircuit,
  'automacao-e-integracoes': Workflow,
  'crm-e-revenue-operations': LineChart,
  'integracao-erp-e-backoffice': Database,
  'observabilidade-e-confiabilidade': Activity,
  'arquitetura-e-modernizacao-backend': Server,
};

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
          {services.map((service) => {
            const Icon = SERVICE_ICONS[service.slug] || Sparkles;
            const detailsHref = `/servicos/${service.slug}`;
            const waHref = `${WHATSAPP_URL}?text=${encodeURIComponent(
              t('servicesPage.whatsappInterest', { service: service.title }),
            )}`;

            return (
              <RevealItem key={service.slug}>
                <Card spotlight interactive className="group relative flex h-full flex-col p-8">
                  <div className="flex items-start justify-between gap-4">
                    <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-border/80 bg-surface/60 text-foreground">
                      <Icon size={20} />
                    </div>
                    <span
                      aria-hidden
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-surface/40 text-foreground/80 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    >
                      <ArrowUpRight size={14} />
                    </span>
                  </div>

                  <h2 className="mt-6 font-display text-xl md:text-2xl font-medium tracking-tight">
                    {/* Link principal com overlay: mantem o card inteiro clicavel
                        sem aninhar links (o CTA de WhatsApp fica acima via z-10). */}
                    <Link
                      to={detailsHref}
                      className="after:absolute after:inset-0 after:rounded-3xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary-400"
                    >
                      {service.title}
                    </Link>
                  </h2>
                  <p className="mt-3 text-muted-foreground">{service.summary}</p>

                  <div className="mt-6 flex flex-wrap items-center gap-4 pt-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.16em] text-foreground/80">
                      {t('servicesPage.viewDetails')}
                      <ArrowUpRight size={12} />
                    </span>
                    <a
                      href={waHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="relative z-10 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:border-emerald-400/50 hover:bg-emerald-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    >
                      <MessagesSquare size={13} />
                      {t('servicesPage.talkOnWhatsapp')}
                    </a>
                  </div>
                </Card>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </Section>
    </SiteLayout>
  );
};

export default Servicos;
