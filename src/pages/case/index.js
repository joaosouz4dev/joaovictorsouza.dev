import React from 'react';
import { Link, useParams } from 'react-router-dom';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { getCaseBySlug } from '../cases/data';

const Case = () => {
  const { slug } = useParams();
  const caseItem = getCaseBySlug(slug);

  if (!caseItem) {
    return (
      <SiteLayout>
        <Seo
          title="Case nao encontrado | Joao Victor Souza"
          description="A pagina de case solicitada nao foi encontrada."
          canonical="/cases"
          robots="noindex,follow"
        />
        <h1>Case nao encontrado</h1>
        <p>
          Volte para <Link to="/cases">/cases</Link> para ver outros projetos.
        </p>
      </SiteLayout>
    );
  }

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: caseItem.title,
      description: caseItem.summary,
      author: {
        '@type': 'Person',
        name: 'Joao Victor Souza',
      },
      datePublished: '2026-03-03',
      dateModified: '2026-03-03',
      mainEntityOfPage: `https://joaovictorsouza.dev/cases/${caseItem.slug}`,
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
          name: 'Cases',
          item: 'https://joaovictorsouza.dev/cases',
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: caseItem.title,
          item: `https://joaovictorsouza.dev/cases/${caseItem.slug}`,
        },
      ],
    },
  ];

  return (
    <SiteLayout>
      <Seo
        title={`${caseItem.title} | Joao Victor Souza`}
        description={caseItem.summary}
        canonical={`/cases/${caseItem.slug}`}
        schema={schema}
      />

      <section className="seo-hero">
        <span className="seo-kicker">Case</span>
        <h1>{caseItem.title}</h1>
        <p>{caseItem.summary}</p>
      </section>

      <section className="seo-card">
        <h2>Cenario</h2>
        <p>{caseItem.challenge}</p>
      </section>

      <section className="seo-card" style={{ marginTop: '14px' }}>
        <h2>Solucao implementada</h2>
        <ul className="seo-list">
          {caseItem.solution.map((item, index) => (
            <li key={`${caseItem.slug}-solution-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="seo-card" style={{ marginTop: '14px' }}>
        <h2>Resultados observados</h2>
        <ul className="seo-list">
          {caseItem.results.map((item, index) => (
            <li key={`${caseItem.slug}-result-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="seo-card" style={{ marginTop: '14px' }}>
        <h2>Stack tecnica</h2>
        <p>{caseItem.stack.join(' | ')}</p>
        {caseItem.demoUrl && (
          <p>
            <strong>Demo:</strong>{' '}
            <a href={caseItem.demoUrl} target="_blank" rel="noreferrer noopener">
              {caseItem.demoUrl}
            </a>
          </p>
        )}
        {caseItem.repoUrl && (
          <p>
            <strong>Repositorio:</strong>{' '}
            <a href={caseItem.repoUrl} target="_blank" rel="noreferrer noopener">
              {caseItem.repoUrl}
            </a>
          </p>
        )}
        <a className="seo-cta" href="/contato">
          Quero um projeto parecido
        </a>
      </section>
    </SiteLayout>
  );
};

export default Case;
