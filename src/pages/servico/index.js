import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, ArrowUpRight } from 'lucide-react';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';
import Container from '../../components/ui/Container';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import GradientText from '../../components/ui/GradientText';
import Spotlight from '../../components/ui/Spotlight';
import { RevealGroup, RevealItem, RevealOnScroll } from '../../components/ui/RevealOnScroll';
import { getServiceBySlug } from '../servicos/data';
import { cn } from '../../lib/cn';

function FaqItem({ item, index }) {
  const [open, setOpen] = useState(index === 0);
  return (
    <div className="overflow-hidden rounded-3xl border border-border/60 bg-surface/40 backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 p-6 text-left"
        aria-expanded={open}
      >
        <span className="font-display text-base md:text-lg font-medium tracking-tight">
          {item.question}
        </span>
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: 0.2 }}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/80 bg-surface/60 text-foreground"
        >
          <Plus size={16} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-6 text-muted-foreground">{item.answer}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const Servico = () => {
  const { t, i18n } = useTranslation();
  const { slug } = useParams();
  const service = getServiceBySlug(slug, i18n.resolvedLanguage);

  if (!service) {
    return (
      <SiteLayout>
        <Seo
          title={t('servicePage.notFoundSeoTitle')}
          description={t('servicePage.notFoundSeoDescription')}
          canonical="/servicos"
          robots="noindex,follow"
        />
        <PageHero
          eyebrow="404"
          title={t('servicePage.notFoundTitle')}
          description={t('servicePage.notFoundDescription')}
        >
          <Button to="/servicos" variant="outline">
            {t('menu.services')}
          </Button>
        </PageHero>
      </SiteLayout>
    );
  }

  const faqEntities = service.faq.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  }));

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: service.title,
      serviceType: service.title,
      provider: { '@type': 'Person', name: 'João Victor Souza', url: 'https://joaovictorsouza.dev/' },
      areaServed: 'BR',
      url: `https://joaovictorsouza.dev/servicos/${service.slug}`,
      description: service.summary,
    },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqEntities },
  ];

  return (
    <SiteLayout>
      <Seo
        title={`${service.title} | João Victor Souza`}
        description={service.summary}
        canonical={`/servicos/${service.slug}`}
        schema={schema}
      />

      <PageHero
        eyebrow={t('servicePage.kicker')}
        title={service.heroTitle}
        description={service.heroDescription}
      />

      <Section bordered>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <RevealOnScroll>
            <Card spotlight className="h-full p-8">
              <h2 className="font-mono text-eyebrow uppercase text-muted-foreground mb-5">
                {t('servicePage.howItWorks')}
              </h2>
              <ol className="space-y-4">
                {service.steps.map((step, i) => (
                  <li key={i} className="flex gap-4">
                    <span className={cn(
                      'mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs',
                      'bg-gradient-accent text-white',
                    )}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-foreground/90">{step}</span>
                  </li>
                ))}
              </ol>
            </Card>
          </RevealOnScroll>
          <RevealOnScroll delay={0.1}>
            <Card spotlight className="h-full p-8">
              <h2 className="font-mono text-eyebrow uppercase text-muted-foreground mb-5">
                {t('servicePage.deliverables')}
              </h2>
              <ul className="space-y-3">
                {service.deliverables.map((item, i) => (
                  <li key={i} className="flex gap-3 text-foreground/90">
                    <span className="mt-2.5 inline-block h-1 w-1 rounded-full bg-primary-400 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </RevealOnScroll>
        </div>
      </Section>

      <Section bordered eyebrow="FAQ" title={t('servicePage.faq')}>
        <RevealGroup className="space-y-4" stagger={0.05}>
          {service.faq.map((item, i) => (
            <RevealItem key={i}>
              <FaqItem item={item} index={i} />
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      <section className="relative isolate overflow-hidden py-24 border-t border-border/40">
        <Spotlight />
        <Container size="default" className="text-center">
          <RevealOnScroll>
            <h2 className="font-display text-h1 font-medium tracking-tight text-balance">
              {t('servicePage.readyTitle').slice(0, -1)}
              <GradientText>?</GradientText>
            </h2>
          </RevealOnScroll>
          <RevealOnScroll delay={0.1}>
            <p className="mt-6 max-w-2xl mx-auto text-lg text-muted-foreground text-balance">
              {t('servicePage.readyDescription')}
            </p>
          </RevealOnScroll>
          <RevealOnScroll delay={0.2}>
            <Button to="/contato" size="lg" rightIcon={<ArrowUpRight size={18} />} className="mt-10">
              {t('servicePage.requestDiagnosis')}
            </Button>
          </RevealOnScroll>
        </Container>
      </section>
    </SiteLayout>
  );
};

export default Servico;
