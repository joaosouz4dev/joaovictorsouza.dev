import React from 'react';
import { useTranslation } from 'react-i18next';
import { Target, Cpu, ListChecks, Shield, ArrowUpRight } from 'lucide-react';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';
import Container from '../../components/ui/Container';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import TiltCard from '../../components/ui/TiltCard';
import { RevealGroup, RevealItem, RevealOnScroll } from '../../components/ui/RevealOnScroll';
import GradientText from '../../components/ui/GradientText';
import Spotlight from '../../components/ui/Spotlight';

const blocks = (t) => [
  {
    icon: Target,
    title: t('aboutPage.specialtiesTitle'),
    items: [0, 1, 2, 3].map((i) => t(`aboutPage.specialties.${i}`)),
    ordered: false,
  },
  {
    icon: Cpu,
    title: t('aboutPage.stackTitle'),
    items: [0, 1, 2, 3].map((i) => t(`aboutPage.stack.${i}`)),
    ordered: false,
  },
  {
    icon: ListChecks,
    title: t('aboutPage.processTitle'),
    items: [0, 1, 2, 3].map((i) => t(`aboutPage.process.${i}`)),
    ordered: true,
  },
  {
    icon: Shield,
    title: t('aboutPage.principlesTitle'),
    items: [0, 1, 2, 3].map((i) => t(`aboutPage.principles.${i}`)),
    ordered: false,
  },
];

const Sobre = () => {
  const { t } = useTranslation();

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'João Victor Souza',
    url: 'https://joaovictorsouza.dev/sobre',
    sameAs: ['https://github.com/joaosouz4dev', 'https://www.linkedin.com/in/joaosouz4dev/'],
    jobTitle: 'Especialista em WhatsApp Cloud API, Meta CAPI e Chatbots com IA',
    knowsAbout: ['WhatsApp Cloud API', 'Meta Pixel', 'Conversions API', 'Chatbots com IA'],
  };

  return (
    <SiteLayout>
      <Seo
        title={t('aboutPage.seoTitle')}
        description={t('aboutPage.seoDescription')}
        canonical="/sobre"
        schema={schema}
      />

      <PageHero
        eyebrow={t('menu.about')}
        title={t('aboutPage.heroTitle')}
        description={t('aboutPage.heroDescription')}
      />

      <Section bordered>
        <RevealGroup className="grid grid-cols-1 gap-5 md:grid-cols-2" stagger={0.08}>
          {blocks(t).map(({ icon: Icon, title, items, ordered }) => (
            <RevealItem key={title}>
              <TiltCard intensity={5}>
                <Card spotlight className="h-full p-8">
                  <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-border/80 bg-surface/60 text-foreground">
                    <Icon size={20} />
                  </div>
                  <h2 className="font-display text-xl font-medium tracking-tight">{title}</h2>
                  {ordered ? (
                    <ol className="mt-5 space-y-3">
                      {items.map((it, i) => (
                        <li key={i} className="flex gap-3 text-muted-foreground">
                          <span className="font-mono text-eyebrow text-foreground/40 mt-1">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <span>{it}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <ul className="mt-5 space-y-3">
                      {items.map((it, i) => (
                        <li key={i} className="flex gap-3 text-muted-foreground">
                          <span className="mt-2.5 inline-block h-1 w-1 rounded-full bg-primary-400 shrink-0" />
                          <span>{it}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </TiltCard>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      <section className="relative isolate overflow-hidden py-24 md:py-32 border-t border-border/40">
        <Spotlight fill="rgba(34,211,238,0.18)" />
        <Container size="default" className="text-center">
          <RevealOnScroll>
            <h2 className="font-display text-h1 font-medium tracking-tight text-balance">
              {t('aboutPage.ctaTitle').split(' ').slice(0, -2).join(' ')}{' '}
              <GradientText>{t('aboutPage.ctaTitle').split(' ').slice(-2).join(' ')}</GradientText>
            </h2>
          </RevealOnScroll>
          <RevealOnScroll delay={0.1}>
            <p className="mt-6 max-w-2xl mx-auto text-lg text-muted-foreground text-balance">
              {t('aboutPage.ctaDescription')}
            </p>
          </RevealOnScroll>
          <RevealOnScroll delay={0.2}>
            <Button to="/contato" size="lg" rightIcon={<ArrowUpRight size={18} />} className="mt-10">
              {t('aboutPage.ctaButton')}
            </Button>
          </RevealOnScroll>
        </Container>
      </section>
    </SiteLayout>
  );
};

export default Sobre;
