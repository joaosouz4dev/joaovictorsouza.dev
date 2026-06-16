import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Calendar, Tag, Clock, ArrowUpRight, Github } from 'lucide-react';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { RevealOnScroll } from '../../components/ui/RevealOnScroll';
import { getPostBySlug, getPostContent } from '../blog/data';

const Paragraph = ({ value }) => (
  <p className="text-foreground/90 leading-relaxed">{value}</p>
);

const BulletList = ({ items }) => (
  <ul className="space-y-2">
    {items.map((item, i) => (
      <li key={i} className="flex gap-3">
        <span className="mt-2.5 inline-block h-1 w-1 rounded-full bg-primary-400 shrink-0" />
        <span className="text-foreground/90 leading-relaxed">{item}</span>
      </li>
    ))}
  </ul>
);

const OrderedList = ({ items }) => (
  <ol className="space-y-2 list-decimal pl-5">
    {items.map((item, i) => (
      <li key={i} className="text-foreground/90 leading-relaxed">{item}</li>
    ))}
  </ol>
);

const CodeBlock = ({ value }) => (
  <pre className="overflow-x-auto rounded-2xl border border-border/60 bg-elevated/70 p-4 font-mono text-xs text-foreground/80 leading-relaxed">
    <code>{value}</code>
  </pre>
);

const DiagramBlock = ({ value }) => (
  <pre className="overflow-x-auto rounded-2xl border border-border/60 bg-elevated/70 p-4 font-mono text-xs text-foreground/80">
    {value}
  </pre>
);

const TableBlock = ({ columns, rows }) => (
  <div className="overflow-hidden rounded-2xl border border-border/60">
    <table className="w-full text-sm">
      <thead className="bg-surface/60">
        <tr>
          {columns.map((col, i) => (
            <th
              key={i}
              className="text-left p-4 font-mono text-eyebrow uppercase text-muted-foreground"
            >
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-t border-border/40">
            {row.map((cell, j) => (
              <td
                key={j}
                className={
                  j === 0
                    ? 'p-4 font-medium text-foreground align-top'
                    : 'p-4 text-muted-foreground align-top'
                }
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const FaqBlock = ({ items }) => (
  <div className="space-y-4">
    {items.map((item, i) => (
      <div key={i} className="rounded-2xl border border-border/60 bg-surface/40 p-5">
        <h3 className="font-display text-base font-medium tracking-tight">{item.question}</h3>
        <p className="mt-2 text-muted-foreground">{item.answer}</p>
      </div>
    ))}
  </div>
);

const Blocks = ({ blocks }) => (
  <div className="mt-5 space-y-4">
    {blocks.map((block, i) => {
      switch (block.type) {
        case 'paragraph':
          return <Paragraph key={i} value={block.value} />;
        case 'list':
          return <BulletList key={i} items={block.items} />;
        case 'ordered':
          return <OrderedList key={i} items={block.items} />;
        case 'code':
          return <CodeBlock key={i} value={block.value} />;
        case 'diagram':
          return <DiagramBlock key={i} value={block.value} />;
        case 'table':
          return <TableBlock key={i} columns={block.columns} rows={block.rows} />;
        case 'faq':
          return <FaqBlock key={i} items={block.items} />;
        default:
          return null;
      }
    })}
  </div>
);

const RepoCallout = ({ repo, label }) => (
  <RevealOnScroll>
    <Card className="mt-5 p-8">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="max-w-xl">
          <p className="font-mono text-eyebrow uppercase text-muted-foreground mb-3">{label}</p>
          <h3 className="font-display text-base font-medium tracking-tight">{repo.name}</h3>
          <p className="mt-2 text-muted-foreground">{repo.description}</p>
        </div>
        <Button href={repo.url} variant="outline" leftIcon={<Github size={16} />}>
          GitHub
        </Button>
      </div>
    </Card>
  </RevealOnScroll>
);

const BlogPost = () => {
  const { t, i18n } = useTranslation();
  const { slug } = useParams();
  const post = getPostBySlug(slug, i18n.resolvedLanguage);
  const content = getPostContent(slug, i18n.resolvedLanguage);

  if (!post) {
    return (
      <SiteLayout>
        <Seo
          title={t('blogPostPage.notFoundSeoTitle')}
          description={t('blogPostPage.notFoundSeoDescription')}
          canonical="/blog"
          robots="noindex,follow"
        />
        <PageHero
          eyebrow="404"
          title={t('blogPostPage.notFoundTitle')}
          description={`${t('blogPostPage.notFoundDescription')} /blog ${t('blogPostPage.notFoundDescriptionEnd')}`}
        >
          <Button to="/blog" variant="outline">{t('menu.blog')}</Button>
        </PageHero>
      </SiteLayout>
    );
  }

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: post.excerpt,
      author: { '@type': 'Person', name: 'João Victor Souza' },
      datePublished: post.date,
      dateModified: post.date,
      mainEntityOfPage: `https://joaovictorsouza.dev/blog/${post.slug}`,
    },
  ];

  if (content?.faq?.length) {
    schema.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: content.faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    });
  }

  const intro = content?.intro || post.excerpt;
  const sections = content?.sections || [];
  const faq = content?.faq || [];
  const conclusion = content?.conclusion;
  const related = content?.related || [];
  const repo = content?.repo;

  return (
    <SiteLayout>
      <Seo
        title={`${post.title} | João Victor Souza`}
        description={post.excerpt}
        canonical={`/blog/${post.slug}`}
        schema={schema}
      />

      <PageHero
        eyebrow={t('blogPostPage.kicker')}
        title={post.title}
        description={intro}
      >
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
      </PageHero>

      <Section bordered>
        <article className="max-w-3xl mx-auto">
          {sections.map((section, i) => (
            <RevealOnScroll key={i}>
              <Card className="mt-5 p-8">
                <p className="font-mono text-eyebrow uppercase text-muted-foreground mb-3">
                  {String(i + 1).padStart(2, '0')}
                </p>
                <h2 className="font-display text-h2 font-medium tracking-tight">{section.title}</h2>
                <Blocks blocks={section.blocks} />
              </Card>
            </RevealOnScroll>
          ))}

          {faq.length > 0 && (
            <RevealOnScroll>
              <Card className="mt-5 p-8">
                <p className="font-mono text-eyebrow uppercase text-muted-foreground mb-3">FAQ</p>
                <h2 className="font-display text-h2 font-medium tracking-tight">
                  {t('blogPostPage.faqTitle')}
                </h2>
                <div className="mt-5">
                  <FaqBlock items={faq} />
                </div>
              </Card>
            </RevealOnScroll>
          )}

          {repo && <RepoCallout repo={repo} label={t('blogPostPage.repoLabel')} />}

          {conclusion && (
            <RevealOnScroll>
              <Card spotlight className="mt-5 p-8">
                <h2 className="font-display text-h2 font-medium tracking-tight">
                  {conclusion.title}
                </h2>
                <p className="mt-5 text-foreground/90 leading-relaxed">{conclusion.description}</p>
                <Button to="/contato" rightIcon={<ArrowUpRight size={16} />} className="mt-8">
                  {conclusion.cta}
                </Button>
              </Card>
            </RevealOnScroll>
          )}

          {related.length > 0 && (
            <RevealOnScroll>
              <Card className="mt-5 p-8">
                <h3 className="font-mono text-eyebrow uppercase text-muted-foreground mb-4">
                  {t('blogPostPage.relatedLinksTitle')}
                </h3>
                <ul className="space-y-3">
                  {related.map((link, i) => (
                    <li key={i}>
                      <Link
                        to={link.to}
                        className="inline-flex items-center gap-2 text-foreground/90 hover:text-foreground transition-colors"
                      >
                        {link.label} <ArrowUpRight size={14} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </RevealOnScroll>
          )}
        </article>
      </Section>
    </SiteLayout>
  );
};

export default BlogPost;
