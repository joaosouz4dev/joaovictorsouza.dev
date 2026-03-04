import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { cases } from './data';

const Cases = () => {
  const { t } = useTranslation();
  const allLabel = t('casesPage.allFilter');
  const [activeCategory, setActiveCategory] = useState(allLabel);

  const categories = useMemo(
    () => [allLabel, ...new Set(cases.map((item) => item.category))],
    [allLabel],
  );

  useEffect(() => {
    setActiveCategory(allLabel);
  }, [allLabel]);

  const visibleCases = useMemo(
    () =>
      activeCategory === allLabel
        ? cases
        : cases.filter((item) => item.category === activeCategory),
    [activeCategory, allLabel],
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
        title={t('casesPage.seoTitle')}
        description={t('casesPage.seoDescription')}
        canonical="/cases"
        schema={schema}
      />

      <section className="seo-hero">
        <span className="seo-kicker">{t('menu.cases')}</span>
        <h1>{t('casesPage.heroTitle')}</h1>
        <p>{t('casesPage.heroDescription')}</p>
      </section>

      <section className="seo-card" style={{ marginBottom: '16px' }}>
        <h2>{t('casesPage.filterTitle')}</h2>
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
            <h2>{caseItem.title}</h2>
            <p>
              <strong>{t('casesPage.categoryLabel')}:</strong> {caseItem.category}
            </p>
            <p>{caseItem.summary}</p>
            {caseItem.demoUrl && (
              <p>
                <strong>{t('casesPage.demoLabel')}:</strong> {caseItem.demoUrl}
              </p>
            )}
            <Link className="seo-cta" to={`/cases/${caseItem.slug}`}>
              {t('casesPage.viewFullCase')}
            </Link>
          </article>
        ))}
      </section>
    </SiteLayout>
  );
};

export default Cases;
