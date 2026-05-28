import React from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Home, ArrowLeft } from 'lucide-react';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import Container from '../../components/ui/Container';
import Button from '../../components/ui/Button';
import GradientText from '../../components/ui/GradientText';
import Spotlight from '../../components/ui/Spotlight';
import NoiseTexture from '../../components/ui/NoiseTexture';

function GlitchDigit({ char, delay }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      initial={{ opacity: 0, y: 40, filter: 'blur(12px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      className="relative inline-block"
    >
      {!reduce && (
        <>
          <motion.span
            aria-hidden
            animate={{ x: [-2, 2, 0, -1, 0], opacity: [0.6, 0.4, 0.7, 0.5, 0.6] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute inset-0 text-fuchsia-500/70 mix-blend-screen"
          >
            {char}
          </motion.span>
          <motion.span
            aria-hidden
            animate={{ x: [2, -2, 0, 1, 0], opacity: [0.6, 0.4, 0.7, 0.5, 0.6] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 0.1 }}
            className="absolute inset-0 text-cyan-400/70 mix-blend-screen"
          >
            {char}
          </motion.span>
        </>
      )}
      <span className="relative">{char}</span>
    </motion.span>
  );
}

export default function NotFound() {
  return (
    <SiteLayout>
      <Seo
        title="404 | Página não encontrada"
        description="Página não encontrada."
        canonical="/404"
        robots="noindex,follow"
      />
      <section className="relative isolate flex min-h-[80vh] items-center justify-center overflow-hidden py-32">
        <Spotlight fill="rgba(217,70,239,0.3)" />
        <NoiseTexture />
        <Container size="default" className="relative text-center">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground mb-6">
            Erro 404
          </p>
          <h1 className="font-display font-medium leading-[0.9] tracking-tight text-[clamp(7rem,22vw,18rem)]">
            <GradientText animate>
              {Array.from('404').map((c, i) => (
                <GlitchDigit key={i} char={c} delay={i * 0.12} />
              ))}
            </GradientText>
          </h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="mt-6 text-lg md:text-xl text-muted-foreground text-balance max-w-xl mx-auto"
          >
            Esta página não existe. Talvez tenha sido movida, ou o link esteja desatualizado.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.6 }}
            className="mt-10 flex flex-wrap items-center justify-center gap-3"
          >
            <Button to="/" size="lg" leftIcon={<Home size={18} />}>
              Voltar para a Home
            </Button>
            <Button to="/contato" variant="outline" size="lg" leftIcon={<ArrowLeft size={18} />}>
              Falar comigo
            </Button>
          </motion.div>
        </Container>
      </section>
    </SiteLayout>
  );
}
