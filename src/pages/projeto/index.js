import React from 'react';
import { Link, useParams } from 'react-router-dom';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { getProjectBySlug } from '../projetos/data';

const Projeto = () => {
  const { slug } = useParams();
  const project = getProjectBySlug(slug);

  if (!project) {
    return (
      <SiteLayout>
        <Seo
          title="Projeto nao encontrado | Joao Victor Souza"
          description="Projeto nao encontrado."
          canonical="/projetos"
          robots="noindex,follow"
        />
        <h1>Projeto nao encontrado</h1>
        <p>
          Volte para <Link to="/projetos">/projetos</Link>.
        </p>
      </SiteLayout>
    );
  }

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareSourceCode',
      name: project.title,
      codeRepository: project.repository,
      description: project.summary,
      programmingLanguage: project.stack,
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
          name: 'Projetos',
          item: 'https://joaovictorsouza.dev/projetos',
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: project.title,
          item: `https://joaovictorsouza.dev/projetos/${project.slug}`,
        },
      ],
    },
  ];

  return (
    <SiteLayout>
      <Seo
        title={`${project.title} | Projeto tecnico`}
        description={project.summary}
        canonical={`/projetos/${project.slug}`}
        schema={schema}
      />

      <section className="seo-hero">
        <span className="seo-kicker">Projeto</span>
        <h1>{project.title}</h1>
        <p>{project.summary}</p>
      </section>

      <section className="seo-card">
        <h2>Stack</h2>
        <p>{project.stack.join(' | ')}</p>
      </section>

      <section className="seo-card" style={{ marginTop: '14px' }}>
        <h2>Repositorio</h2>
        <p>
          <a href={project.repository} target="_blank" rel="noreferrer noopener">
            {project.repository}
          </a>
        </p>
        <a className="seo-cta" href="/contato">
          Conversar sobre implementacao semelhante
        </a>
      </section>
    </SiteLayout>
  );
};

export default Projeto;
