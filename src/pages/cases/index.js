import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { cases } from './data';

const Cases = () => {
  const [activeCategory, setActiveCategory] = useState('Todos');

  const categories = useMemo(
    () => ['Todos', ...new Set(cases.map((item) => item.category))],
    [],
  );

  const visibleCases = useMemo(
    () =>
      activeCategory === 'Todos'
        ? cases
        : cases.filter((item) => item.category === activeCategory),
    [activeCategory],
  );

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
        <h1>Cases técnicos com foco em resultado operacional</h1>
        <p>
          Cada case descreve contexto, solução técnica e aprendizados prontos
          para reutilizar em novos projetos.
        </p>
      </section>

      <section className="seo-card" style={{ marginBottom: '16px' }}>
        <h2>Filtrar por categoria</h2>
        <div className="jv-portfolio-react-nav" style={{ justifyContent: 'flex-start' }}>
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              className={`jv-portfolio-react-filter ${
                activeCategory === category ? 'active' : ''
              }`}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>
      </section>

      <section className="seo-grid">
        {visibleCases.map((caseItem) => (
          <article key={caseItem.slug} className="seo-card">
            {caseItem.coverImage && (
              <img
                src={caseItem.coverImage}
                alt={`Capa do ${caseItem.title}`}
                width="1200"
                height="630"
                loading="lazy"
                decoding="async"
                style={{
                  width: '100%',
                  height: '190px',
                  objectFit: 'cover',
                  borderRadius: '10px',
                  marginBottom: '10px',
                }}
              />
            )}
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
