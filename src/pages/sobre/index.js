import React from 'react';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';

const Sobre = () => {
  const { t } = useTranslation();

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Joao Victor Souza',
    url: 'https://joaovictorsouza.dev/sobre',
    sameAs: [
      'https://github.com/joaosouz4dev',
      'https://www.linkedin.com/in/joaosouz4dev/',
    ],
    jobTitle:
      'Especialista em WhatsApp Cloud API, Meta CAPI e Chatbots com IA',
    knowsAbout: [
      'WhatsApp Cloud API',
      'Meta Pixel',
      'Conversions API',
      'Chatbots com IA',
      'Node.js',
      'Java',
      'AWS',
    ],
  };

  return (
    <SiteLayout>
      <Seo
        title={t('aboutPage.seoTitle')}
        description={t('aboutPage.seoDescription')}
        canonical="/sobre"
        schema={schema}
      />

      <section className="seo-hero">
        <span className="seo-kicker">{t('menu.about')}</span>
        <h1>{t('aboutPage.heroTitle')}</h1>
        <p>{t('aboutPage.heroDescription')}</p>
      </section>

      <section className="seo-grid">
        <article className="seo-card">
          <h2>{t('aboutPage.specialtiesTitle')}</h2>
          <ul className="seo-list">
            <li>{t('aboutPage.specialties.0')}</li>
            <li>{t('aboutPage.specialties.1')}</li>
            <li>{t('aboutPage.specialties.2')}</li>
            <li>{t('aboutPage.specialties.3')}</li>
          </ul>
        </article>

        <article className="seo-card">
          <h2>{t('aboutPage.stackTitle')}</h2>
          <ul className="seo-list">
            <li>{t('aboutPage.stack.0')}</li>
            <li>{t('aboutPage.stack.1')}</li>
            <li>{t('aboutPage.stack.2')}</li>
            <li>{t('aboutPage.stack.3')}</li>
          </ul>
        </article>
      </section>

      <section className="seo-grid" style={{ marginTop: '14px' }}>
        <article className="seo-card">
          <h2>{t('aboutPage.processTitle')}</h2>
          <ol className="seo-list">
            <li>{t('aboutPage.process.0')}</li>
            <li>{t('aboutPage.process.1')}</li>
            <li>{t('aboutPage.process.2')}</li>
            <li>{t('aboutPage.process.3')}</li>
          </ol>
        </article>

        <article className="seo-card">
          <h2>{t('aboutPage.principlesTitle')}</h2>
          <ul className="seo-list">
            <li>{t('aboutPage.principles.0')}</li>
            <li>{t('aboutPage.principles.1')}</li>
            <li>{t('aboutPage.principles.2')}</li>
            <li>{t('aboutPage.principles.3')}</li>
          </ul>
        </article>
      </section>

      <section className="seo-card" style={{ marginTop: '18px' }}>
        <h2>{t('aboutPage.ctaTitle')}</h2>
        <p>{t('aboutPage.ctaDescription')}</p>
        <a className="seo-cta" href="/contato">
          {t('aboutPage.ctaButton')}
        </a>
      </section>
    </SiteLayout>
  );
};

export default Sobre;
