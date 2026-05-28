import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Calendar, Clock, Tag, ArrowUpRight, Sparkle } from 'lucide-react';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';
import Card from '../../components/ui/Card';
import { RevealGroup, RevealItem } from '../../components/ui/RevealOnScroll';
import { getPublishedPosts, getUpcomingPosts } from './data';

const Blog = () => {
  const { t, i18n } = useTranslation();
  const published = getPublishedPosts(i18n.resolvedLanguage);
  const upcoming = getUpcomingPosts(i18n.resolvedLanguage);

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

      <PageHero
        eyebrow={t('menu.blog')}
        title={t('blogPage.heroTitle')}
        description={t('blogPage.heroDescription')}
      />

      <Section bordered>
        <div className="grid grid-cols-1 gap-12 md:grid-cols-12">
          <div className="md:col-span-8">
            <RevealGroup className="space-y-5" stagger={0.06}>
              {published.map((post) => (
                <RevealItem key={post.slug}>
                  <Link to={`/blog/${post.slug}`} className="block group">
                    <Card spotlight className="p-8 transition-transform group-hover:-translate-y-1">
                      <div className="flex flex-wrap items-center gap-4 text-xs font-mono uppercase tracking-[0.16em] text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Calendar size={12} /> {post.date}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Tag size={12} /> {post.category}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Clock size={12} /> {post.readTime}
                        </span>
                      </div>
                      <h2 className="mt-5 font-display text-2xl md:text-3xl font-medium tracking-tight text-balance">
                        {post.title}
                      </h2>
                      <p className="mt-3 text-muted-foreground text-balance">{post.excerpt}</p>
                      <span className="mt-6 inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.16em] text-foreground/90">
                        {t('blogPage.readArticle')} <ArrowUpRight size={12} />
                      </span>
                    </Card>
                  </Link>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>

          <aside className="md:col-span-4">
            <div className="md:sticky md:top-32">
              <Card className="p-6">
                <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-accent text-white">
                  <Sparkle size={16} />
                </div>
                <h3 className="font-display text-base font-medium tracking-tight">
                  {t('blogPage.upcomingTitle')}
                </h3>
                <ul className="mt-5 space-y-3">
                  {upcoming.map((p, i) => (
                    <li key={i} className="flex gap-3 text-sm text-muted-foreground">
                      <span className="font-mono text-eyebrow text-foreground/30 mt-0.5">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </aside>
        </div>
      </Section>
    </SiteLayout>
  );
};

export default Blog;
