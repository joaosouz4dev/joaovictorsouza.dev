import React from 'react';
import { Link } from 'react-router-dom';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { projects } from './data';

const Projetos = () => {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Projetos tecnicos',
    url: 'https://joaovictorsouza.dev/projetos',
  };

  return (
    <SiteLayout>
      <Seo
        title="Projetos de Integracao, WhatsApp e IA | Joao Victor Souza"
        description="Projetos tecnicos com foco em integracao de APIs, WhatsApp Cloud API, Meta CAPI e chatbots com IA."
        canonical="/projetos"
        schema={schema}
      />

      <section className="seo-hero">
        <span className="seo-kicker">Projetos</span>
        <h1>Implementacoes e experimentos tecnicos</h1>
        <p>
          Colecao de projetos voltados para integracao, automacao e arquitetura
          escalavel.
        </p>
      </section>

      <section className="seo-grid">
        {projects.map((project) => (
          <article key={project.slug} className="seo-card">
            <h2>{project.title}</h2>
            <p>{project.summary}</p>
            <Link className="seo-cta" to={`/projetos/${project.slug}`}>
              Ver projeto
            </Link>
          </article>
        ))}
      </section>
    </SiteLayout>
  );
};

export default Projetos;
