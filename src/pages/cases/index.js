import React from 'react';
import { Link } from 'react-router-dom';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { cases } from './data';

const Cases = () => {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Cases de Integracoes e IA',
    url: 'https://joaovictorsouza.dev/cases',
  };

  return (
    <SiteLayout>
      <Seo
        title="Cases de WhatsApp, Meta CAPI e IA | Joao Victor Souza"
        description="Estudos de caso com arquitetura, stack e aprendizados em projetos de integracoes, mensuracao e chatbots com IA."
        canonical="/cases"
        schema={schema}
      />

      <section className="seo-hero">
        <span className="seo-kicker">Cases</span>
        <h1>Cases tecnicos com foco em resultado operacional</h1>
        <p>
          Cada case descreve contexto, solucao tecnica e aprendizados prontos
          para reutilizar em novos projetos.
        </p>
      </section>

      <section className="seo-grid">
        {cases.map((caseItem) => (
          <article key={caseItem.slug} className="seo-card">
            <h2>{caseItem.title}</h2>
            <p>
              <strong>Categoria:</strong> {caseItem.category}
            </p>
            <p>{caseItem.summary}</p>
            {caseItem.demoUrl && (
              <p>
                <strong>Demo:</strong> {caseItem.demoUrl}
              </p>
            )}
            <Link className="seo-cta" to={`/cases/${caseItem.slug}`}>
              Ver case completo
            </Link>
          </article>
        ))}
      </section>
    </SiteLayout>
  );
};

export default Cases;
