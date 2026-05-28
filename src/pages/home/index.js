import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  motion,
  useScroll,
  useTransform,
  useMotionValue,
  useSpring,
  useReducedMotion,
} from 'framer-motion';
import {
  MessageSquare,
  BrainCircuit,
  Network,
  Sparkles,
  ArrowUpRight,
  Mail,
  Linkedin,
  MessagesSquare,
  ChevronDown,
} from 'lucide-react';
import SiteLayout from '../../components/siteLayout';
import Seo from '../../components/seo';
import Container from '../../components/ui/Container';
import Section from '../../components/ui/Section';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import GradientText from '../../components/ui/GradientText';
import Spotlight from '../../components/ui/Spotlight';
import GlowEffect from '../../components/ui/GlowEffect';
import NoiseTexture from '../../components/ui/NoiseTexture';
import AnimatedText from '../../components/ui/AnimatedText';
import { RevealOnScroll, RevealGroup, RevealItem } from '../../components/ui/RevealOnScroll';
import TiltCard from '../../components/ui/TiltCard';
import MarqueeRow from '../../components/ui/MarqueeRow';
import MagneticCursor from '../../components/ui/MagneticCursor';
import GlitchText from '../../components/ui/GlitchText';
import PortfolioGrid from '../../components/sections/PortfolioGrid';

const ANO_INICIAL = 2015;

const homeSchema = [
  {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'João Victor Souza',
    url: 'https://joaovictorsouza.dev/',
    sameAs: ['https://www.linkedin.com/in/joaosouz4dev', 'https://github.com/joaosouz4dev'],
    jobTitle: 'Especialista em WhatsApp Cloud API, Meta CAPI e Chatbots com IA',
    knowsAbout: ['WhatsApp Cloud API', 'Meta Pixel', 'Conversions API', 'Chatbots com IA'],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'João Victor Souza',
    url: 'https://joaovictorsouza.dev/',
  },
];

// ----------------- Hero -----------------
function Hero() {
  const { t } = useTranslation();
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const sx = useSpring(mouseX, { stiffness: 60, damping: 18 });
  const sy = useSpring(mouseY, { stiffness: 60, damping: 18 });

  const handleMove = (e) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    mouseX.set((e.clientX - r.left) / r.width - 0.5);
    mouseY.set((e.clientY - r.top) / r.height - 0.5);
  };

  return (
    <section
      ref={ref}
      onMouseMove={handleMove}
      className="relative isolate flex min-h-[100svh] items-center overflow-hidden pt-32 pb-16"
    >
      <Spotlight />
      <NoiseTexture />
      {!reduce && (
        <>
          <motion.div
            style={{ x: useTransform(sx, [-0.5, 0.5], [-30, 30]), y: useTransform(sy, [-0.5, 0.5], [-30, 30]) }}
            className="pointer-events-none absolute left-[10%] top-[20%] h-72 w-72 rounded-full bg-primary-500/30 blur-[120px]"
          />
          <motion.div
            style={{ x: useTransform(sx, [-0.5, 0.5], [40, -40]), y: useTransform(sy, [-0.5, 0.5], [20, -20]) }}
            className="pointer-events-none absolute right-[5%] top-[10%] h-96 w-96 rounded-full bg-fuchsia-500/25 blur-[140px]"
          />
          <motion.div
            style={{ x: useTransform(sx, [-0.5, 0.5], [-20, 20]), y: useTransform(sy, [-0.5, 0.5], [40, -40]) }}
            className="pointer-events-none absolute bottom-[10%] left-[40%] h-80 w-80 rounded-full bg-cyan-400/20 blur-[120px]"
          />
        </>
      )}

      <Container size="lg" className="relative">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-16 items-center">
          <div className="lg:col-span-7">
            <RevealOnScroll preset="fade">
              <Badge variant="gradient" withDot>
                Builder · WhatsApp API · IA
              </Badge>
            </RevealOnScroll>

            <div className="mt-8">
              <AnimatedText
                as="span"
                text={t('banner.title')}
                split="words"
                className="font-mono text-sm uppercase tracking-[0.2em] text-muted-foreground"
              />
              <h1 className="mt-6 flex flex-col gap-y-4 md:gap-y-5 tracking-tight">
                <GlitchText
                  text="JOÃO"
                  pixel
                  className="block leading-none text-[clamp(2.25rem,6vw,4.5rem)] text-foreground"
                />
                <GlitchText
                  text="VICTOR"
                  pixel
                  className="block leading-none text-[clamp(2.25rem,6vw,4.5rem)] text-foreground"
                />
                <GlitchText
                  text="SOUZA"
                  pixel
                  className="block leading-none text-[clamp(2.25rem,6vw,4.5rem)] text-foreground"
                />
              </h1>
              <RevealOnScroll delay={0.6} className="mt-8 max-w-xl">
                <p className="text-lg text-muted-foreground text-balance">
                  {t('banner.profession')} — engenharia de integrações WhatsApp Cloud API, Meta CAPI e
                  chatbots com IA.{' '}
                  <span className="text-foreground">{t('banner.location')}.</span>
                </p>
              </RevealOnScroll>

              <RevealOnScroll delay={0.75} className="mt-10 flex flex-wrap items-center gap-3">
                <MagneticCursor>
                  <Button to="/contato" size="lg" rightIcon={<ArrowUpRight size={18} />}>
                    {t('quates.title')}
                  </Button>
                </MagneticCursor>
                <Button to="/projetos" variant="outline" size="lg">
                  {t('menu.projects')}
                </Button>
              </RevealOnScroll>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="lg:col-span-5"
          >
            <div className="relative mx-auto max-w-md lg:max-w-none">
              <motion.div
                aria-hidden
                animate={reduce ? undefined : { opacity: [0.4, 0.7, 0.4] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute -inset-6 rounded-[2.5rem] bg-gradient-accent opacity-50 blur-3xl"
              />
              <div className="relative overflow-hidden rounded-[2rem] border border-border/60 bg-surface/60 backdrop-blur-xl">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 z-10 mix-blend-overlay opacity-30"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent 4px)',
                  }}
                />
                <div className="relative aspect-[4/5] overflow-hidden">
                  <img
                    src="/assets/images/new/foto.webp"
                    alt="João Victor Souza"
                    loading="eager"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-background/10 to-transparent" />
                  <div className="absolute inset-0 ring-1 ring-inset ring-foreground/10" />
                </div>
                <div className="absolute inset-x-5 bottom-5 flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/60">
                    JV · {new Date().getFullYear()}
                  </div>
                  <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/60">
                    <span className="relative inline-flex h-1.5 w-1.5">
                      <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
                      <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    </span>
                    Disponível
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {!reduce && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.6, duration: 0.6 }}
            className="absolute bottom-10 left-1/2 -translate-x-1/2"
          >
            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              className="flex flex-col items-center gap-2 text-muted-foreground"
            >
              <span className="font-mono text-eyebrow uppercase">Scroll</span>
              <ChevronDown size={16} />
            </motion.div>
          </motion.div>
        )}
      </Container>
    </section>
  );
}

// ----------------- About resumido -----------------
function AboutSection() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  const anos = year - ANO_INICIAL;
  const stats = [
    { value: `${anos}+`, label: 'anos programando' },
    { value: '9', label: 'projetos entregues' },
    { value: '3', label: 'idiomas' },
  ];
  return (
    <Section id="about" bordered>
      <div className="grid grid-cols-1 gap-12 md:grid-cols-12 md:gap-16">
        <div className="md:col-span-5">
          <RevealOnScroll>
            <TiltCard className="relative overflow-hidden rounded-3xl">
              <GlowEffect intensity="lg" color="primary" className="-top-10 -left-10 opacity-60" />
              <div className="relative aspect-square overflow-hidden rounded-3xl border border-border/60 bg-surface/40">
                <img
                  src="/assets/images/new/foto.webp"
                  alt="João Victor Souza"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background/60 via-transparent to-transparent" />
              </div>
            </TiltCard>
          </RevealOnScroll>
        </div>
        <div className="md:col-span-7 flex flex-col justify-center">
          <RevealOnScroll>
            <p className="font-mono text-eyebrow uppercase text-muted-foreground mb-4">
              {t('about.title')}
            </p>
          </RevealOnScroll>
          <RevealOnScroll delay={0.1}>
            <h2 className="font-display text-h1 font-medium tracking-tight text-balance">
              Engenharia de integrações para{' '}
              <GradientText>operação e crescimento.</GradientText>
            </h2>
          </RevealOnScroll>
          <RevealOnScroll delay={0.2}>
            <p className="mt-6 text-lg text-muted-foreground text-balance">{t('about.description')}</p>
          </RevealOnScroll>
          <RevealGroup className="mt-10 grid grid-cols-3 gap-4" stagger={0.08}>
            {stats.map((s) => (
              <RevealItem key={s.label} className="rounded-2xl border border-border/60 bg-surface/40 p-5 backdrop-blur">
                <div className="font-display text-3xl font-medium tracking-tight">
                  <GradientText>{s.value}</GradientText>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </div>
    </Section>
  );
}

// ----------------- Skills (3 cards) -----------------
function SkillsSection() {
  const { t } = useTranslation();
  const cards = [
    { Icon: MessageSquare, key: 'card1', accent: 'from-violet-500 to-fuchsia-500' },
    { Icon: BrainCircuit, key: 'card2', accent: 'from-fuchsia-500 to-cyan-400' },
    { Icon: Network, key: 'card3', accent: 'from-cyan-400 to-violet-500' },
  ];
  return (
    <Section
      eyebrow={t('skills.title')}
      title={
        <>
          O que eu construo<GradientText>.</GradientText>
        </>
      }
      bordered
    >
      <RevealGroup className="grid grid-cols-1 gap-5 md:grid-cols-3" stagger={0.1}>
        {cards.map(({ Icon, key, accent }) => (
          <RevealItem key={key}>
            <TiltCard>
              <Card spotlight className="h-full p-8">
                <div className={`mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${accent} text-white shadow-glow`}>
                  <Icon size={20} />
                </div>
                <h3 className="font-display text-xl font-medium tracking-tight">
                  {t(`skills.${key}.title`)}
                </h3>
                <p className="mt-3 text-muted-foreground">{t(`skills.${key}.description`)}</p>
              </Card>
            </TiltCard>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

// ----------------- Marquee de stacks -----------------
function StacksMarquee() {
  const stacks = [
    { label: 'TypeScript' },
    { label: 'React' },
    { label: 'Next.js' },
    { label: 'React Native' },
    { label: 'Node.js' },
    { label: 'PHP' },
    { label: 'MongoDB' },
    { label: 'WhatsApp Cloud API' },
    { label: 'Meta CAPI' },
    { label: 'OpenAI' },
    { label: 'AWS' },
    { label: 'Webhooks' },
  ];
  return (
    <section className="py-12 md:py-16 border-t border-border/40">
      <MarqueeRow items={stacks} speed={40} />
    </section>
  );
}

// ----------------- Experience timeline (scroll storytelling) -----------------
function ExperienceSection() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  const anos = year - ANO_INICIAL;
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const opacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0, 1, 1, 0]);
  const y = useTransform(scrollYProgress, [0, 1], [40, -40]);

  const timeline = [
    {
      year: '2015',
      title: 'Início na programação',
      description: 'Primeiros projetos com PHP, WordPress e front-end.',
    },
    {
      year: '2018',
      title: 'Stack JavaScript moderna',
      description: 'React, Node.js, integração de APIs e arquitetura backend.',
    },
    {
      year: '2021',
      title: 'WppConnect e WhatsApp',
      description: 'Contribuição open source que impulsionou expertise em WhatsApp.',
    },
    {
      year: '2024',
      title: 'Cloud API + Meta CAPI + IA',
      description: 'Foco em integrações premium, chatbots com IA e Meta Conversions API.',
    },
  ];

  return (
    <Section bordered id="experience" innerClassName="relative">
      <div ref={ref} className="grid grid-cols-1 gap-12 md:grid-cols-12">
        <div className="md:col-span-5">
          <div className="md:sticky md:top-32">
            <RevealOnScroll>
              <p className="font-mono text-eyebrow uppercase text-muted-foreground mb-4">
                {t('experiences.since')} {ANO_INICIAL}
              </p>
            </RevealOnScroll>
            <RevealOnScroll delay={0.1}>
              <h2 className="font-display text-h1 font-medium tracking-tight text-balance">
                <GradientText>{anos}+ anos</GradientText> {t('experiences.title')}
              </h2>
            </RevealOnScroll>
            <RevealOnScroll delay={0.2}>
              <p className="mt-6 text-muted-foreground text-balance">
                {t('experiences.description')}
              </p>
            </RevealOnScroll>
            <RevealOnScroll delay={0.3}>
              <Button
                href="https://www.linkedin.com/in/joaosouz4dev"
                variant="outline"
                size="md"
                leftIcon={<Linkedin size={16} />}
                className="mt-8"
              >
                LinkedIn
              </Button>
            </RevealOnScroll>
          </div>
        </div>
        <div className="md:col-span-7 space-y-4">
          {timeline.map((it, i) => (
            <RevealOnScroll key={it.year} delay={i * 0.05} preset="up">
              <Card spotlight className="p-6 md:p-8">
                <div className="flex items-start gap-6">
                  <div className="font-mono text-eyebrow uppercase text-muted-foreground">{it.year}</div>
                  <div className="flex-1">
                    <h3 className="font-display text-xl font-medium tracking-tight">{it.title}</h3>
                    <p className="mt-2 text-muted-foreground">{it.description}</p>
                  </div>
                </div>
              </Card>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ----------------- CTA / Quote -----------------
function CtaSection() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  const anos = year - ANO_INICIAL;
  return (
    <section className="relative isolate overflow-hidden py-24 md:py-32 border-t border-border/40">
      <Spotlight fill="rgba(217,70,239,0.25)" />
      <NoiseTexture />
      <Container size="default" className="relative text-center">
        <RevealOnScroll>
          <Badge variant="gradient" withDot>
            Disponível para projetos
          </Badge>
        </RevealOnScroll>
        <RevealOnScroll delay={0.1}>
          <h2 className="mt-6 font-display text-hero font-medium tracking-tight text-balance">
            {t('quates.title').split('?')[0]}
            <GradientText animate>?</GradientText>
          </h2>
        </RevealOnScroll>
        <RevealOnScroll delay={0.2}>
          <p className="mt-6 max-w-2xl mx-auto text-lg text-muted-foreground text-balance">
            {t('quates.description', { anos })}
          </p>
        </RevealOnScroll>
        <RevealOnScroll delay={0.3}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <MagneticCursor>
              <Button
                href="https://wa.me/5531998587817"
                size="lg"
                leftIcon={<MessagesSquare size={18} />}
                rightIcon={<ArrowUpRight size={18} />}
              >
                WhatsApp direto
              </Button>
            </MagneticCursor>
            <Button to="/contato" variant="outline" size="lg">
              Ver todos os canais
            </Button>
          </div>
        </RevealOnScroll>
      </Container>
    </section>
  );
}

// ----------------- Home Seo cards -----------------
function HomeSeoCards() {
  const { t } = useTranslation();
  const cards = [
    { key: 'whatsapp', to: '/servicos/whatsapp-cloud-api', icon: <MessageSquare size={20} /> },
    { key: 'meta', to: '/servicos/meta-ads-e-integracoes', icon: <Sparkles size={20} /> },
    { key: 'blog', to: '/blog', icon: <BrainCircuit size={20} /> },
    { key: 'cases', to: '/cases', icon: <Network size={20} /> },
  ];
  return (
    <Section
      eyebrow={t('homeSeo.title')}
      title={t('homeSeo.description')}
      bordered
    >
      <RevealGroup className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4" stagger={0.08}>
        {cards.map(({ key, to, icon }) => (
          <RevealItem key={key}>
            <Link to={to} className="block h-full">
              <Card spotlight className="h-full p-6 transition-transform hover:-translate-y-1">
                <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/80 bg-surface/60 text-foreground">
                  {icon}
                </div>
                <h3 className="font-display text-lg font-medium tracking-tight">
                  {t(`homeSeo.cards.${key}.title`)}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t(`homeSeo.cards.${key}.description`)}
                </p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.16em] text-foreground/80">
                  {t(`homeSeo.cards.${key}.cta`)}
                  <ArrowUpRight size={12} />
                </span>
              </Card>
            </Link>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

// ----------------- Contato compacto -----------------
function ContactSection() {
  const { t } = useTranslation();
  const items = [
    { icon: Mail, label: 'web@joaovictorsouza.dev', href: 'mailto:web@joaovictorsouza.dev' },
    { icon: Linkedin, label: '@joaosouz4dev', href: 'https://www.linkedin.com/in/joaosouz4dev' },
    { icon: MessagesSquare, label: '+55 31 9 9858-7817', href: 'https://wa.me/5531998587817' },
  ];
  return (
    <Section
      eyebrow={t('menu.contact')}
      title="Vamos conversar."
      align="center"
      bordered
    >
      <RevealGroup className="grid grid-cols-1 gap-5 md:grid-cols-3" stagger={0.08}>
        {items.map(({ icon: Icon, label, href }) => (
          <RevealItem key={href}>
            <a
              href={href}
              target={href.startsWith('http') ? '_blank' : undefined}
              rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
              className="block h-full"
            >
              <Card spotlight className="h-full p-8 text-center transition-transform hover:-translate-y-1">
                <Icon size={24} className="mx-auto text-foreground" />
                <p className="mt-5 font-display text-base font-medium tracking-tight">{label}</p>
                <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.16em] text-muted-foreground">
                  Abrir <ArrowUpRight size={12} />
                </span>
              </Card>
            </a>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

const Home = () => {
  return (
    <SiteLayout>
      <Seo
        title="Especialista em WhatsApp Cloud API, Meta CAPI e IA | João Victor Souza"
        description="Desenvolvedor especialista em integração WhatsApp Cloud API, Meta Pixel/CAPI, chatbots com IA e automações para atendimento e vendas."
        canonical="/"
        schema={homeSchema}
      />
      <Hero />
      <AboutSection />
      <SkillsSection />
      <StacksMarquee />
      <ExperienceSection />
      <PortfolioGrid />
      <CtaSection />
      <HomeSeoCards />
      <ContactSection />
    </SiteLayout>
  );
};

export default Home;
