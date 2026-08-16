import React from 'react';
import { useTranslation } from 'react-i18next';
import WhatsAppForm from '../../components/WhatsAppForm';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';

const WhatsAppPage = () => {
  const { t } = useTranslation();
  return (
    <SiteLayout>
      <Seo
        title={t('seo.whatsappToolTitle')}
        description={t('seo.whatsappToolDescription')}
        canonical="/wpp"
        robots="noindex,follow"
      />

      <PageHero
        eyebrow={t('whatsapp.pageEyebrow')}
        title={t('whatsapp.pageTitle')}
        description={t('whatsapp.pageDescription')}
      />

      <Section bordered>
        <WhatsAppForm />
      </Section>
    </SiteLayout>
  );
};

export default WhatsAppPage;
