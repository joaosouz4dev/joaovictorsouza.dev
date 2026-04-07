import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { getPublishedPosts, getUpcomingPosts } from './data';

const Blog = () => {
  const { t, i18n } = useTranslation();
  const publishedPosts = getPublishedPosts(i18n.resolvedLanguage);
  const upcomingPosts = getUpcomingPosts(i18n.resolvedLanguage);

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: t('blogPage.schemaName'),
    url: 'https://joaovictorsouza.dev/blog',
    description: t('blogPage.schemaDescription'),
  };

  return (
    <SiteLayout>
      <Seo
        title={t('blogPage.seoTitle')}
        description={t('blogPage.seoDescription')}
        canonical="/blog"
        schema={schema}
      />

      <section className="seo-hero">
        <span className="seo-kicker">{t('menu.blog')}</span>
        <h1>{t('blogPage.heroTitle')}</h1>
        <p>{t('blogPage.heroDescription')}</p>
      </section>

      <section className="seo-grid">
        {publishedPosts.map((post) => (
          <article key={post.slug} className="seo-card">
            <h2>{post.title}</h2>
            <p className="seo-article-meta">
              {post.date} | {post.category} | {post.readTime}
            </p>
            <p>{post.excerpt}</p>
            <Link className="seo-cta" to={`/blog/${post.slug}`}>
              {t('blogPage.readArticle')}
            </Link>
          </article>
        ))}
      </section>

      <section className="seo-card" style={{ marginTop: '18px' }}>
        <h2>{t('blogPage.upcomingTitle')}</h2>
        <ul className="seo-list">
          {upcomingPosts.map((post, index) => (
            <li key={`upcoming-${index}`}>{post}</li>
          ))}
        </ul>
      </section>
    </SiteLayout>
  );
};

export default Blog;
