import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { getServices } from './data';

const Servicos = () => {
  const { t, i18n } = useTranslation();
  const services = getServices(i18n.resolvedLanguage);

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: t('menu.home'),
        item: 'https://joaovictorsouza.dev/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: t('menu.services'),
        item: 'https://joaovictorsouza.dev/servicos',
      },
    ],
  };

  return (
    <SiteLayout>
      <Seo
        title={t('servicesPage.seoTitle')}
        description={t('servicesPage.seoDescription')}
        canonical="/servicos"
        keywords={t('servicesPage.seoKeywords')}
        schema={schema}
      />

      <section className="seo-hero">
        <span className="seo-kicker">{t('menu.services')}</span>
        <h1>{t('servicesPage.heroTitle')}</h1>
        <p>{t('servicesPage.heroDescription')}</p>
      </section>

      <section className="seo-grid">
        {services.map((service) => (
          <article key={service.slug} className="seo-card">
            <h2>{service.title}</h2>
            <p>{service.summary}</p>
            <Link className="seo-cta" to={`/servicos/${service.slug}`}>
              {t('servicesPage.viewDetails')}
            </Link>
          </article>
        ))}
      </section>
    </SiteLayout>
  );
};

export default Servicos;
