import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Calendar, Tag, Clock, ArrowUpRight } from 'lucide-react';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { RevealOnScroll } from '../../components/ui/RevealOnScroll';
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

const ContentSection = ({ children, title, eyebrow }) => (
  <RevealOnScroll>
    <Card className="mt-5 p-8">
      {eyebrow && (
        <p className="font-mono text-eyebrow uppercase text-muted-foreground mb-3">{eyebrow}</p>
      )}
      <h2 className="font-display text-h2 font-medium tracking-tight">{title}</h2>
      <div className="mt-5 text-foreground/90 leading-relaxed space-y-4">{children}</div>
    </Card>
  </RevealOnScroll>
);

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
        description={t('blogPostPage.intro')}
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
          <ContentSection title={t('blogPostPage.section1.title')} eyebrow="01">
            <p>{t('blogPostPage.section1.description')}</p>
            <ul className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-2.5 inline-block h-1 w-1 rounded-full bg-primary-400 shrink-0" />
                  <span>{t(`blogPostPage.section1.items.${i}`)}</span>
                </li>
              ))}
            </ul>
          </ContentSection>

          <ContentSection title={t('blogPostPage.section2.title')} eyebrow="02">
            <p>{t('blogPostPage.section2.description')}</p>
            <ol className="space-y-2 list-decimal pl-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i}>{t(`blogPostPage.section2.items.${i}`)}</li>
              ))}
            </ol>
            <pre className="mt-4 overflow-x-auto rounded-2xl border border-border/60 bg-elevated/70 p-4 font-mono text-xs text-foreground/80">
{`WhatsApp Cloud API → Webhook → Fila → Worker → Envio
                              → CRM → Observabilidade`}
            </pre>
          </ContentSection>

          <ContentSection title={t('blogPostPage.section3.title')} eyebrow="03">
            <p>{t('blogPostPage.section3.description')}</p>
            <pre className="overflow-x-auto rounded-2xl border border-border/60 bg-elevated/70 p-4 font-mono text-xs text-foreground/80 leading-relaxed">
              <code>{WebhookCode}</code>
            </pre>
          </ContentSection>

          <ContentSection title={t('blogPostPage.section4.title')} eyebrow="04">
            <div className="overflow-hidden rounded-2xl border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-surface/60">
                  <tr>
                    <th className="text-left p-4 font-mono text-eyebrow uppercase text-muted-foreground">
                      {t('blogPostPage.section4.columns.theme')}
                    </th>
                    <th className="text-left p-4 font-mono text-eyebrow uppercase text-muted-foreground">
                      {t('blogPostPage.section4.columns.bestPractice')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2, 3].map((i) => (
                    <tr key={i} className="border-t border-border/40">
                      <td className="p-4 font-medium text-foreground">{t(`blogPostPage.section4.rows.${i}.theme`)}</td>
                      <td className="p-4 text-muted-foreground">{t(`blogPostPage.section4.rows.${i}.value`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ContentSection>

          <ContentSection title={t('blogPostPage.section5.title')} eyebrow="05">
            <ol className="space-y-2 list-decimal pl-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i}>{t(`blogPostPage.section5.items.${i}`)}</li>
              ))}
            </ol>
          </ContentSection>

          <ContentSection title={t('blogPostPage.faq.title')} eyebrow="FAQ">
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-2xl border border-border/60 bg-surface/40 p-5">
                  <h3 className="font-display text-base font-medium tracking-tight">
                    {t(`blogPostPage.faq.items.${i}.question`)}
                  </h3>
                  <p className="mt-2 text-muted-foreground">{t(`blogPostPage.faq.items.${i}.answer`)}</p>
                </div>
              ))}
            </div>
          </ContentSection>

          <RevealOnScroll>
            <Card spotlight className="mt-5 p-8">
              <h2 className="font-display text-h2 font-medium tracking-tight">
                {t('blogPostPage.conclusion.title')}
              </h2>
              <p className="mt-5 text-foreground/90 leading-relaxed">{t('blogPostPage.conclusion.description')}</p>
              <Button to="/contato" rightIcon={<ArrowUpRight size={16} />} className="mt-8">
                {t('blogPostPage.conclusion.cta')}
              </Button>
            </Card>
          </RevealOnScroll>

          <RevealOnScroll>
            <Card className="mt-5 p-8">
              <h3 className="font-mono text-eyebrow uppercase text-muted-foreground mb-4">
                {t('blogPostPage.relatedLinksTitle')}
              </h3>
              <ul className="space-y-3">
                <li>
                  <Link to="/servicos/whatsapp-cloud-api" className="inline-flex items-center gap-2 text-foreground/90 hover:text-foreground transition-colors">
                    {t('blogPostPage.relatedLinks.0')} <ArrowUpRight size={14} />
                  </Link>
                </li>
                <li>
                  <Link to="/servicos/meta-ads-e-integracoes" className="inline-flex items-center gap-2 text-foreground/90 hover:text-foreground transition-colors">
                    {t('blogPostPage.relatedLinks.1')} <ArrowUpRight size={14} />
                  </Link>
                </li>
                <li>
                  <Link to="/cases/whatsapp-ia-atendimento" className="inline-flex items-center gap-2 text-foreground/90 hover:text-foreground transition-colors">
                    {t('blogPostPage.relatedLinks.2')} <ArrowUpRight size={14} />
                  </Link>
                </li>
              </ul>
            </Card>
          </RevealOnScroll>
        </article>
      </Section>
    </SiteLayout>
  );
};

export default BlogPost;
