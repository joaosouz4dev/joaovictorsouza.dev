import React from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, Linkedin, MessagesSquare, ArrowUpRight, Clock, CheckCircle2 } from 'lucide-react';
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

const Contato = () => {
  const { t } = useTranslation();

  const channels = [
    {
      icon: Mail,
      title: t('contactPage.emailTitle'),
      value: 'web@joaovictorsouza.dev',
      href: 'mailto:web@joaovictorsouza.dev',
    },
    {
      icon: Linkedin,
      title: t('contactPage.linkedinTitle'),
      value: 'linkedin.com/in/joaosouz4dev',
      href: 'https://www.linkedin.com/in/joaosouz4dev/',
    },
    {
      icon: MessagesSquare,
      title: t('contactPage.whatsappTitle'),
      value: t('contactPage.whatsappCta'),
      href: 'https://wa.me/5531998587817',
    },
  ];

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    name: 'Contato - João Victor Souza',
    url: 'https://joaovictorsouza.dev/contato',
  };

  return (
    <SiteLayout>
      <Seo
        title={t('contactPage.seoTitle')}
        description={t('contactPage.seoDescription')}
        canonical="/contato"
        schema={schema}
      />

      <PageHero
        eyebrow={t('menu.contact')}
        title={t('contactPage.heroTitle')}
        description={t('contactPage.heroDescription')}
      />

      <Section bordered>
        <RevealGroup className="grid grid-cols-1 gap-5 md:grid-cols-3" stagger={0.08}>
          {channels.map(({ icon: Icon, title, value, href }) => (
            <RevealItem key={href}>
              <a
                href={href}
                target={href.startsWith('http') ? '_blank' : undefined}
                rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
                className="block h-full"
              >
                <Card spotlight className="group h-full p-8 transition-transform hover:-translate-y-1">
                  <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-accent text-white shadow-glow">
                    <Icon size={20} />
                  </div>
                  <h2 className="font-mono text-eyebrow uppercase text-muted-foreground mb-3">
                    {title}
                  </h2>
                  <p className="font-display text-lg font-medium tracking-tight break-all">{value}</p>
                  <span className="mt-6 inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.16em] text-foreground/80 transition-transform group-hover:translate-x-0.5">
                    Abrir <ArrowUpRight size={12} />
                  </span>
                </Card>
              </a>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      <Section bordered>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <RevealOnScroll>
            <Card className="h-full p-8">
              <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border/80 bg-surface/60 text-foreground">
                <CheckCircle2 size={18} />
              </div>
              <h2 className="font-display text-xl font-medium tracking-tight">
                {t('contactPage.scopeTitle')}
              </h2>
              <ul className="mt-5 space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="flex gap-3 text-foreground/90">
                    <span className="mt-2.5 inline-block h-1 w-1 rounded-full bg-primary-400 shrink-0" />
                    <span>{t(`contactPage.scopeItems.${i}`)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </RevealOnScroll>
          <RevealOnScroll delay={0.1}>
            <Card className="h-full p-8">
              <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border/80 bg-surface/60 text-foreground">
                <Clock size={18} />
              </div>
              <h2 className="font-display text-xl font-medium tracking-tight">
                {t('contactPage.responseTitle')}
              </h2>
              <ul className="mt-5 space-y-3">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="flex gap-3 text-foreground/90">
                    <span className="mt-2.5 inline-block h-1 w-1 rounded-full bg-cyan-400 shrink-0" />
                    <span>{t(`contactPage.responseItems.${i}`)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </RevealOnScroll>
        </div>
      </Section>

      <section className="relative isolate overflow-hidden py-24 border-t border-border/40">
        <Spotlight fill="rgba(34,211,238,0.2)" />
        <Container size="default" className="text-center">
          <RevealOnScroll>
            <h2 className="font-display text-h1 font-medium tracking-tight text-balance">
              <GradientText>{t('contactPage.finalCtaTitle')}</GradientText>
            </h2>
          </RevealOnScroll>
          <RevealOnScroll delay={0.1}>
            <p className="mt-6 max-w-2xl mx-auto text-lg text-muted-foreground text-balance">
              {t('contactPage.finalCtaDescription')}
            </p>
          </RevealOnScroll>
          <RevealOnScroll delay={0.2}>
            <Button
              href="https://wa.me/5531998587817"
              size="lg"
              leftIcon={<MessagesSquare size={18} />}
              rightIcon={<ArrowUpRight size={18} />}
              className="mt-10"
            >
              {t('contactPage.finalCtaButton')}
            </Button>
          </RevealOnScroll>
        </Container>
      </section>
    </SiteLayout>
  );
};

export default Contato;
