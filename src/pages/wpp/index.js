import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import Seo from '../../components/seo';
import Spotlight from '../../components/ui/Spotlight';
import NoiseTexture from '../../components/ui/NoiseTexture';
import GradientText from '../../components/ui/GradientText';

const Wpp = () => {
  const { t } = useTranslation();
  const reduce = useReducedMotion();

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const phone = urlParams.get('phone');
    const message = urlParams.get('message');

    const timer = setTimeout(() => {
      window.location.href = `https://wa.me/${phone || '5531998587817'}${
        message ? `?text=${message}` : ''
      }`;
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      <Seo
        title="Redirecionando para WhatsApp | João Victor Souza"
        description="Página utilitária de redirecionamento para WhatsApp."
        canonical="/whatsapp"
        robots="noindex,follow"
      />
      <section className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-background">
        <Spotlight />
        <NoiseTexture />
        <div className="relative text-center">
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={reduce ? { scale: 1, opacity: 1 } : { scale: [0.9, 1.1, 1], opacity: 1 }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], repeat: Infinity, repeatType: 'reverse' }}
            className="mx-auto mb-8 inline-flex h-20 w-20 items-center justify-center rounded-full bg-gradient-accent text-white shadow-glow"
          >
            <MessageCircle size={36} />
          </motion.div>
          <h1 className="font-display text-h1 font-medium tracking-tight">
            <GradientText animate>{t('whatsapp.redirecting', 'Abrindo WhatsApp...')}</GradientText>
          </h1>
          <p className="mt-4 text-muted-foreground">Você será redirecionado em instantes.</p>
        </div>
      </section>
    </>
  );
};

export default Wpp;
