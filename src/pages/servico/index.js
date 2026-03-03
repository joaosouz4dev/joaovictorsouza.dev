import React from 'react';
import { Link, useParams } from 'react-router-dom';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { getServiceBySlug } from '../servicos/data';

const Servico = () => {
  const { slug } = useParams();
  const service = getServiceBySlug(slug);

  if (!service) {
    return (
      <SiteLayout>
        <Seo
          title="Servico nao encontrado | Joao Victor Souza"
          description="A página de serviço solicitada não foi encontrada."
          canonical="/servicos"
          robots="noindex,follow"
        />
        <h1>Serviço não encontrado</h1>
        <p>
          Este serviço não existe. Volte para a página de{' '}
          <Link to="/servicos">serviços</Link>.
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
          name: 'Inicio',
          item: 'https://joaovictorsouza.dev/',
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Servicos',
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
        keywords={service.keywords}
        schema={schema}
      />

      <section className="seo-hero">
        <span className="seo-kicker">Servico</span>
        <h1>{service.heroTitle}</h1>
        <p>{service.heroDescription}</p>
      </section>

      <section className="seo-grid">
        <article className="seo-card">
          <h2>Como funciona</h2>
          <ol className="seo-list">
            {service.steps.map((step, index) => (
              <li key={`${service.slug}-step-${index}`}>{step}</li>
            ))}
          </ol>
        </article>

        <article className="seo-card">
          <h2>O que eu entrego</h2>
          <ul className="seo-list">
            {service.deliverables.map((item, index) => (
              <li key={`${service.slug}-deliverable-${index}`}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section style={{ marginTop: '24px' }}>
        <h2>FAQ</h2>
        {service.faq.map((item, index) => (
          <article className="seo-faq-item" key={`${service.slug}-faq-${index}`}>
            <h3>{item.question}</h3>
            <p>{item.answer}</p>
          </article>
        ))}
      </section>

      <section className="seo-card" style={{ marginTop: '20px' }}>
        <h2>Pronto para implementar?</h2>
        <p>
          Se você quer evoluir sua operação com arquitetura robusta, entre em
          contato para um diagnóstico técnico.
        </p>
        <a className="seo-cta" href="/contato">
          Solicitar diagnóstico
        </a>
      </section>
    </SiteLayout>
  );
};

export default Servico;
