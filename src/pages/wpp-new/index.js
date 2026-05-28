import React from 'react';
import WhatsAppForm from '../../components/WhatsAppForm';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';

const WhatsAppPage = () => {
  return (
    <SiteLayout>
      <Seo
        title="Gerador de link WhatsApp | João Victor Souza"
        description="Ferramenta utilitária para iniciar conversa no WhatsApp."
        canonical="/wpp"
        robots="noindex,follow"
      />

      <PageHero
        eyebrow="Ferramenta"
        title="Gerador de link wa.me"
        description="Cole o número com DDI/DDD e escreva uma mensagem inicial. Geramos um link de WhatsApp pronto para abrir."
      />

      <Section bordered>
        <WhatsAppForm />
      </Section>
    </SiteLayout>
  );
};

export default WhatsAppPage;
