import React from 'react';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';

const Contato = () => {
  const { t } = useTranslation();

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'ContactPage',
    name: 'Contato - Joao Victor Souza',
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

      <section className="seo-hero">
        <span className="seo-kicker">{t('menu.contact')}</span>
        <h1>{t('contactPage.heroTitle')}</h1>
        <p>{t('contactPage.heroDescription')}</p>
      </section>

      <section className="seo-grid">
        <article className="seo-card">
          <h2>Email</h2>
          <p>
            <a href="mailto:web@joaovictorsouza.dev">web@joaovictorsouza.dev</a>
          </p>
        </article>
        <article className="seo-card">
          <h2>{t('contactPage.linkedinTitle')}</h2>
          <p>
            <a
              href="https://www.linkedin.com/in/joaosouz4dev/"
              target="_blank"
              rel="noreferrer noopener"
              aria-label={t('contactPage.linkedinAria')}
            >
              linkedin.com/in/joaosouz4dev
            </a>
          </p>
        </article>
        <article className="seo-card">
          <h2>WhatsApp</h2>
          <p>
            <a
              href="/whatsapp"
              target="_blank"
              rel="noreferrer noopener"
              aria-label={t('contactPage.whatsappAria')}
            >
              {t('contactPage.whatsappCta')}
            </a>
          </p>
        </article>
      </section>
    </SiteLayout>
  );
};

export default Contato;
