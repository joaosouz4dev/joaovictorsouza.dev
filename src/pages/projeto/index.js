import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { getProjectBySlug } from '../projetos/data';

const Projeto = () => {
  const { t, i18n } = useTranslation();
  const { slug } = useParams();
  const project = getProjectBySlug(slug, i18n.resolvedLanguage);

  if (!project) {
    return (
      <SiteLayout>
        <Seo
          title={t('projectPage.notFoundSeoTitle')}
          description={t('projectPage.notFoundSeoDescription')}
          canonical="/projetos"
          robots="noindex,follow"
        />
        <h1>{t('projectPage.notFoundTitle')}</h1>
        <p>
          {t('projectPage.notFoundDescription')} <Link to="/projetos">/projetos</Link>.
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
          name: t('menu.home'),
          item: 'https://joaovictorsouza.dev/',
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: t('menu.projects'),
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
        <span className="seo-kicker">{t('projectPage.kicker')}</span>
        <h1>{project.title}</h1>
        <p>{project.summary}</p>
      </section>

      <section className="seo-card">
        <h2>{t('projectPage.stackTitle')}</h2>
        <p>{project.stack.join(' | ')}</p>
      </section>

      <section className="seo-card" style={{ marginTop: '14px' }}>
        <h2>{t('projectPage.repositoryTitle')}</h2>
        <p>
          <a href={project.repository} target="_blank" rel="noreferrer noopener">
            {project.repository}
          </a>
        </p>
        <a className="seo-cta" href="/contato">
          {t('projectPage.cta')}
        </a>
      </section>
    </SiteLayout>
  );
};

export default Projeto;
