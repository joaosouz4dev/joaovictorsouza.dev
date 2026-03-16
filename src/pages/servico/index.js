import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { getServiceBySlug } from '../servicos/data';

const Servico = () => {
  const { t, i18n } = useTranslation();
  const { slug } = useParams();
  const service = getServiceBySlug(slug, i18n.resolvedLanguage);

  if (!service) {
    return (
      <SiteLayout>
        <Seo
          title={t('servicePage.notFoundSeoTitle')}
          description={t('servicePage.notFoundSeoDescription')}
          canonical="/servicos"
          robots="noindex,follow"
        />
        <h1>{t('servicePage.notFoundTitle')}</h1>
        <p>
          {t('servicePage.notFoundDescription')}{' '}
          <Link to="/servicos">{t('menu.services')}</Link>.
        </p>
      </SiteLayout>
    );
  }

  const faqEntities = service.faq.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: item.answer,
    },
  }));

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: service.title,
      serviceType: service.title,
      provider: {
        '@type': 'Person',
        name: 'Joao Victor Souza',
        url: 'https://joaovictorsouza.dev/',
      },
      areaServed: 'BR',
      url: `https://joaovictorsouza.dev/servicos/${service.slug}`,
      description: service.summary,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqEntities,
    },
    {
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
        {
          '@type': 'ListItem',
          position: 3,
          name: service.title,
          item: `https://joaovictorsouza.dev/servicos/${service.slug}`,
        },
      ],
    },
  ];

  return (
    <SiteLayout>
      <Seo
        title={`${service.title} | Joao Victor Souza`}
        description={service.summary}
        canonical={`/servicos/${service.slug}`}
        schema={schema}
      />

      <section className="seo-hero">
        <span className="seo-kicker">{t('servicePage.kicker')}</span>
        <h1>{service.heroTitle}</h1>
        <p>{service.heroDescription}</p>
      </section>

      <section className="seo-grid">
        <article className="seo-card">
          <h2>{t('servicePage.howItWorks')}</h2>
          <ol className="seo-list">
            {service.steps.map((step, index) => (
              <li key={`${service.slug}-step-${index}`}>{step}</li>
            ))}
          </ol>
        </article>

        <article className="seo-card">
          <h2>{t('servicePage.deliverables')}</h2>
          <ul className="seo-list">
            {service.deliverables.map((item, index) => (
              <li key={`${service.slug}-deliverable-${index}`}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section style={{ marginTop: '24px' }}>
        <h2>{t('servicePage.faq')}</h2>
        {service.faq.map((item, index) => (
          <article className="seo-faq-item" key={`${service.slug}-faq-${index}`}>
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </article>
        ))}
      </section>

      <section className="seo-card" style={{ marginTop: '20px' }}>
        <h2>{t('servicePage.readyTitle')}</h2>
        <p>{t('servicePage.readyDescription')}</p>
        <a className="seo-cta" href="/contato">
          {t('servicePage.requestDiagnosis')}
        </a>
      </section>
    </SiteLayout>
  );
};

export default Servico;
