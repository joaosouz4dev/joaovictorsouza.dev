import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { projects } from './data';

const Projetos = () => {
  const { t } = useTranslation();

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: t('projectsPage.schemaName'),
    url: 'https://joaovictorsouza.dev/projetos',
  };

  return (
    <SiteLayout>
      <Seo
        title={t('projectsPage.seoTitle')}
        description={t('projectsPage.seoDescription')}
        canonical="/projetos"
        schema={schema}
      />

      <section className="seo-hero">
        <span className="seo-kicker">{t('menu.projects')}</span>
        <h1>{t('projectsPage.heroTitle')}</h1>
        <p>{t('projectsPage.heroDescription')}</p>
      </section>

      <section className="seo-grid">
        {projects.map((project) => (
          <article key={project.slug} className="seo-card">
            <h2>{project.title}</h2>
            <p>{project.summary}</p>
            <Link className="seo-cta" to={`/projetos/${project.slug}`}>
              {t('projectsPage.viewProject')}
            </Link>
          </article>
        ))}
      </section>
    </SiteLayout>
  );
};

export default Projetos;
