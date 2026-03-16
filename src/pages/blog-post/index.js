import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import { getPostBySlug } from '../blog/data';

const WebhookCode = `import express from "express";
import crypto from "crypto";

const app = express();
app.use("/webhook", express.raw({ type: "application/json" }));

function verifySignature(req, appSecret) {
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) return false;

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", appSecret)
      .update(req.body)
      .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

app.post("/webhook", async (req, res) => {
  if (!verifySignature(req, process.env.META_APP_SECRET)) {
    return res.status(401).send("invalid signature");
  }

  const payload = JSON.parse(req.body.toString("utf8"));
  const messageId =
    payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;

  if (!messageId) return res.sendStatus(200);

  if (await wasProcessed(messageId)) return res.sendStatus(200);

  await markProcessed(messageId);
  await enqueueMessage(payload);
  return res.sendStatus(200);
});`;

const BlogPost = () => {
  const { t, i18n } = useTranslation();
  const { slug } = useParams();
  const post = getPostBySlug(slug, i18n.resolvedLanguage);

  if (!post) {
    return (
      <SiteLayout>
        <Seo
          title={t('blogPostPage.notFoundSeoTitle')}
          description={t('blogPostPage.notFoundSeoDescription')}
          canonical="/blog"
          robots="noindex,follow"
        />
        <h1>{t('blogPostPage.notFoundTitle')}</h1>
        <p>
          {t('blogPostPage.notFoundDescription')} <Link to="/blog">/blog</Link>{' '}
          {t('blogPostPage.notFoundDescriptionEnd')}
        </p>
      </SiteLayout>
    );
  }

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: post.excerpt,
      author: {
        '@type': 'Person',
        name: 'Joao Victor Souza',
      },
      datePublished: post.date,
      dateModified: post.date,
      mainEntityOfPage: `https://joaovictorsouza.dev/blog/${post.slug}`,
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
          name: t('menu.blog'),
          item: 'https://joaovictorsouza.dev/blog',
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: post.title,
          item: `https://joaovictorsouza.dev/blog/${post.slug}`,
        },
      ],
    },
  ];

  return (
    <SiteLayout>
      <Seo
        title={`${post.title} | Joao Victor Souza`}
        description={post.excerpt}
        canonical={`/blog/${post.slug}`}
        schema={schema}
      />

      <article>
        <header className="seo-hero">
          <span className="seo-kicker">{t('blogPostPage.kicker')}</span>
          <h1>{post.title}</h1>
          <p className="seo-article-meta">
            {t('blogPostPage.metaPrefix')} {post.date} |{' '}
            {t('blogPostPage.metaCategory')}: {post.category} |{' '}
            {t('blogPostPage.metaReadTime')}: {post.readTime}
          </p>
          <p>{t('blogPostPage.intro')}</p>
        </header>

        <section className="seo-card">
          <h2>{t('blogPostPage.section1.title')}</h2>
          <p>{t('blogPostPage.section1.description')}</p>
          <ul className="seo-list">
            <li>{t('blogPostPage.section1.items.0')}</li>
            <li>{t('blogPostPage.section1.items.1')}</li>
            <li>{t('blogPostPage.section1.items.2')}</li>
            <li>{t('blogPostPage.section1.items.3')}</li>
          </ul>
        </section>

        <section className="seo-card" style={{ marginTop: '14px' }}>
          <h2>{t('blogPostPage.section2.title')}</h2>
          <p>{t('blogPostPage.section2.description')}</p>
          <ol className="seo-list">
            <li>{t('blogPostPage.section2.items.0')}</li>
            <li>{t('blogPostPage.section2.items.1')}</li>
            <li>{t('blogPostPage.section2.items.2')}</li>
            <li>{t('blogPostPage.section2.items.3')}</li>
            <li>{t('blogPostPage.section2.items.4')}</li>
          </ol>
          <div className="seo-code">
            {`WhatsApp Cloud API -> Webhook -> Fila -> Worker -> Envio de resposta
                                   -> CRM -> Observabilidade`}
          </div>
        </section>

        <section className="seo-card" style={{ marginTop: '14px' }}>
          <h2>{t('blogPostPage.section3.title')}</h2>
          <p>{t('blogPostPage.section3.description')}</p>
          <pre className="seo-code">
            <code>{WebhookCode}</code>
          </pre>
        </section>

        <section className="seo-card" style={{ marginTop: '14px' }}>
          <h2>{t('blogPostPage.section4.title')}</h2>
          <table className="seo-table">
            <thead>
              <tr>
                <th>{t('blogPostPage.section4.columns.theme')}</th>
                <th>{t('blogPostPage.section4.columns.bestPractice')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t('blogPostPage.section4.rows.0.theme')}</td>
                <td>{t('blogPostPage.section4.rows.0.value')}</td>
              </tr>
              <tr>
                <td>{t('blogPostPage.section4.rows.1.theme')}</td>
                <td>{t('blogPostPage.section4.rows.1.value')}</td>
              </tr>
              <tr>
                <td>{t('blogPostPage.section4.rows.2.theme')}</td>
                <td>{t('blogPostPage.section4.rows.2.value')}</td>
              </tr>
              <tr>
                <td>{t('blogPostPage.section4.rows.3.theme')}</td>
                <td>{t('blogPostPage.section4.rows.3.value')}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="seo-card" style={{ marginTop: '14px' }}>
          <h2>{t('blogPostPage.section5.title')}</h2>
          <ol className="seo-list">
            <li>{t('blogPostPage.section5.items.0')}</li>
            <li>{t('blogPostPage.section5.items.1')}</li>
            <li>{t('blogPostPage.section5.items.2')}</li>
            <li>{t('blogPostPage.section5.items.3')}</li>
            <li>{t('blogPostPage.section5.items.4')}</li>
          </ol>
        </section>

        <section className="seo-card" style={{ marginTop: '14px' }}>
          <h2>{t('blogPostPage.faq.title')}</h2>
          <article className="seo-faq-item">
            <h3>{t('blogPostPage.faq.items.0.question')}</h3>
            <p>{t('blogPostPage.faq.items.0.answer')}</p>
          </article>
          <article className="seo-faq-item">
            <h3>{t('blogPostPage.faq.items.1.question')}</h3>
            <p>{t('blogPostPage.faq.items.1.answer')}</p>
          </article>
          <article className="seo-faq-item">
            <h3>{t('blogPostPage.faq.items.2.question')}</h3>
            <p>{t('blogPostPage.faq.items.2.answer')}</p>
          </article>
        </section>

        <section className="seo-card" style={{ marginTop: '14px' }}>
          <h2>{t('blogPostPage.conclusion.title')}</h2>
          <p>{t('blogPostPage.conclusion.description')}</p>
          <a className="seo-cta" href="/contato">
            {t('blogPostPage.conclusion.cta')}
          </a>
        </section>

        <section className="seo-card" style={{ marginTop: '14px' }}>
          <h2>{t('blogPostPage.relatedLinksTitle')}</h2>
          <ul className="seo-list">
            <li>
              <Link to="/servicos/whatsapp-cloud-api">
                {t('blogPostPage.relatedLinks.0')}
              </Link>
            </li>
            <li>
              <Link to="/servicos/meta-ads-e-integracoes">
                {t('blogPostPage.relatedLinks.1')}
              </Link>
            </li>
            <li>
              <Link to="/cases/whatsapp-ia-atendimento">
                {t('blogPostPage.relatedLinks.2')}
              </Link>
            </li>
          </ul>
        </section>
      </article>
    </SiteLayout>
  );
};

export default BlogPost;
