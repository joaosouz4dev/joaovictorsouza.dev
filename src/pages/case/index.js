import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { getCaseBySlug } from '../cases/data';

const Case = () => {
  const { t } = useTranslation();
  const { slug } = useParams();
  const caseItem = getCaseBySlug(slug);

  if (!caseItem) {
    return (
      <SiteLayout>
        <Seo
          title={t('casePage.notFoundSeoTitle')}
          description={t('casePage.notFoundSeoDescription')}
          canonical="/cases"
          robots="noindex,follow"
        />
        <h1>{t('casePage.notFoundTitle')}</h1>
        <p>
          {t('casePage.notFoundDescription')} <Link to="/cases">/cases</Link>{' '}
          {t('casePage.notFoundDescriptionEnd')}
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
          name: t('menu.home'),
          item: 'https://joaovictorsouza.dev/',
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: t('menu.cases'),
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
        <span className="seo-kicker">{t('casePage.kicker')}</span>
        <h1>{caseItem.title}</h1>
        <p>{caseItem.summary}</p>
      </section>

      {caseItem.coverImage && (
        <section className="seo-card" style={{ marginBottom: '14px' }}>
          <img
            src={caseItem.coverImage}
            alt={`Imagem de destaque: ${caseItem.title}`}
            width="1200"
            height="630"
            loading="lazy"
            decoding="async"
            style={{
              width: '100%',
              maxHeight: '340px',
              objectFit: 'cover',
              borderRadius: '12px',
            }}
          />
        </section>
      )}

      <section className="seo-card">
        <h2>{t('casePage.scenarioTitle')}</h2>
        <p>{caseItem.challenge}</p>
      </section>

      <section className="seo-card" style={{ marginTop: '14px' }}>
        <h2>{t('casePage.solutionTitle')}</h2>
        <ul className="seo-list">
          {caseItem.solution.map((item, index) => (
            <li key={`${caseItem.slug}-solution-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="seo-card" style={{ marginTop: '14px' }}>
        <h2>{t('casePage.resultsTitle')}</h2>
        <ul className="seo-list">
          {caseItem.results.map((item, index) => (
            <li key={`${caseItem.slug}-result-${index}`}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="seo-card" style={{ marginTop: '14px' }}>
        <h2>{t('casePage.stackTitle')}</h2>
        <p>{caseItem.stack.join(' | ')}</p>
        {caseItem.demoUrl && (
          <p>
            <strong>{t('casePage.demoLabel')}:</strong>{' '}
            <a href={caseItem.demoUrl} target="_blank" rel="noreferrer noopener">
              {caseItem.demoUrl}
            </a>
          </p>
        )}
        {caseItem.repoUrl && (
          <p>
            <strong>{t('casePage.repositoryLabel')}:</strong>{' '}
            <a href={caseItem.repoUrl} target="_blank" rel="noreferrer noopener">
              {caseItem.repoUrl}
            </a>
          </p>
        )}
        <a className="seo-cta" href="/contato">
          {t('casePage.cta')}
        </a>
      </section>
    </SiteLayout>
  );
};

export default Case;
