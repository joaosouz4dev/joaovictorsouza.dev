import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import translatePt from '../src/config/translate/pt.js';
import translateEn from '../src/config/translate/en.js';
import translateEs from '../src/config/translate/es.js';
import {
  SUPPORTED_LANGUAGES,
  alternatePathsFor,
  localizedPath,
} from '../src/config/routes.js';
import {
  getPublishedPosts,
  getUpcomingPosts,
} from '../src/pages/blog/data.js';
import { getPostContent } from '../src/pages/blog/content.js';
import { getCases } from '../src/pages/cases/data.js';
import { getProjects } from '../src/pages/projetos/data.js';
import { getServices } from '../src/pages/servicos/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const buildDir = path.join(rootDir, 'build');
const publicDir = path.join(rootDir, 'public');
const siteUrl = 'https://joaovictorsouza.dev';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeXml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const normalizePath = (routePath) => (routePath === '/' ? '/' : routePath.replace(/\/+$/, ''));

const translations = { pt: translatePt, en: translateEn, es: translateEs };
const htmlLangOf = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };
const faqHeadingOf = {
  pt: 'Perguntas frequentes',
  en: 'Frequently asked questions',
  es: 'Preguntas frecuentes',
};

const hreflangOf = { pt: 'pt-BR', en: 'en', es: 'es' };

const renderAlternateTags = (alternates) =>
  [
    ...alternates.map(
      ({ language, path: routePath }) =>
        `    <link rel="alternate" hreflang="${hreflangOf[language]}" href="${escapeHtml(`${siteUrl}${routePath}`)}" />`,
    ),
    `    <link rel="alternate" hreflang="x-default" href="${escapeHtml(`${siteUrl}${alternates[0].path}`)}" />`,
  ].join('\n');

const updateHead = (html, page) => {
  const absoluteUrl = `${siteUrl}${normalizePath(page.path)}`;
  const ogType = page.ogType || 'website';
  const language = page.language || 'pt';
  const schemaTag = page.schema
    ? `    <script type="application/ld+json" id="seo-schema">${JSON.stringify(page.schema)}</script>\n`
    : '';
  const canonicalTag = `    <link rel="canonical" href="${escapeHtml(absoluteUrl)}" />\n`;
  const alternateTags = page.alternates ? `${renderAlternateTags(page.alternates)}\n` : '';

  return html
    .replace(/<html([^>]*)\slang="[^"]*"([^>]*)>/, `<html$1 lang="${htmlLangOf[language]}"$2>`)
    .replace(/<html([^>]*)>/, `<html$1 data-prerendered-route="${escapeHtml(page.path)}">`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(page.title)}</title>`)
    .replace(
      /<meta name="description" content="[^"]*" \/>/,
      `<meta name="description" content="${escapeHtml(page.description)}" />`,
    )
    .replace(
      /<meta property="og:type" content="[^"]*" \/>/,
      `<meta property="og:type" content="${escapeHtml(ogType)}" />`,
    )
    .replace(
      /<meta property="og:title" content="[^"]*" \/>/,
      `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    )
    .replace(
      /<meta property="og:description" content="[^"]*" \/>/,
      `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    )
    .replace(
      /<meta name="twitter:title" content="[^"]*" \/>/,
      `<meta name="twitter:title" content="${escapeHtml(page.title)}" />`,
    )
    .replace(
      /<meta name="twitter:description" content="[^"]*" \/>/,
      `<meta name="twitter:description" content="${escapeHtml(page.description)}" />`,
    )
    .replace('</head>', `${canonicalTag}${alternateTags}${schemaTag}  </head>`);
};

const renderShell = ({ eyebrow, title, description, content }) => `
      <div class="relative isolate min-h-screen">
        <main class="relative">
          <section class="relative overflow-hidden pt-36 pb-16 md:pt-44 md:pb-24">
            <div class="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
              <p class="font-mono text-eyebrow uppercase text-muted-foreground">${escapeHtml(eyebrow)}</p>
              <h1 class="mt-4 max-w-4xl font-display text-4xl font-medium tracking-tight text-balance md:text-6xl">
                ${escapeHtml(title)}
              </h1>
              <p class="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                ${escapeHtml(description)}
              </p>
            </div>
          </section>
          ${content}
        </main>
      </div>
`;

const renderCard = ({ href, meta = [], title, description, cta }) => `
              <article class="rounded-[2rem] border border-border/70 bg-card/80 p-6 shadow-card md:p-8">
                ${
                  meta.length
                    ? `<p class="mb-4 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">${meta
                        .map(escapeHtml)
                        .join(' / ')}</p>`
                    : ''
                }
                <h2 class="font-display text-2xl font-medium tracking-tight">${escapeHtml(title)}</h2>
                <p class="mt-3 text-muted-foreground">${escapeHtml(description)}</p>
                <a class="mt-6 inline-flex font-mono text-xs uppercase tracking-[0.16em] text-foreground" href="${escapeHtml(href)}">
                  ${escapeHtml(cta)}
                </a>
              </article>
`;

const renderFaqBlock = (items) =>
  `<div class="space-y-4">${items
    .map(
      (item) =>
        `<div class="rounded-2xl border border-border/60 bg-surface/40 p-5"><h3 class="font-display text-base font-medium tracking-tight">${escapeHtml(item.question)}</h3><p class="mt-2 text-muted-foreground">${escapeHtml(item.answer)}</p></div>`,
    )
    .join('')}</div>`;

const renderBlock = (block) => {
  switch (block.type) {
    case 'paragraph':
      return `<p class="text-foreground/90 leading-relaxed">${escapeHtml(block.value)}</p>`;
    case 'list':
      return `<ul class="space-y-2">${block.items
        .map(
          (item) =>
            `<li class="flex gap-3"><span class="mt-2.5 inline-block h-1 w-1 rounded-full bg-primary-400 shrink-0"></span><span class="text-foreground/90 leading-relaxed">${escapeHtml(item)}</span></li>`,
        )
        .join('')}</ul>`;
    case 'ordered':
      return `<ol class="space-y-2 list-decimal pl-5">${block.items
        .map((item) => `<li class="text-foreground/90 leading-relaxed">${escapeHtml(item)}</li>`)
        .join('')}</ol>`;
    case 'code':
      return `<pre class="overflow-x-auto rounded-2xl border border-border/60 bg-elevated/70 p-4 font-mono text-xs text-foreground/80 leading-relaxed"><code>${escapeHtml(block.value)}</code></pre>`;
    case 'diagram':
      return `<pre class="overflow-x-auto rounded-2xl border border-border/60 bg-elevated/70 p-4 font-mono text-xs text-foreground/80">${escapeHtml(block.value)}</pre>`;
    case 'table':
      return `<div class="overflow-hidden rounded-2xl border border-border/60"><table class="w-full text-sm"><thead class="bg-surface/60"><tr>${block.columns
        .map(
          (col) =>
            `<th class="text-left p-4 font-mono text-eyebrow uppercase text-muted-foreground">${escapeHtml(col)}</th>`,
        )
        .join('')}</tr></thead><tbody>${block.rows
        .map(
          (row) =>
            `<tr class="border-t border-border/40">${row
              .map(
                (cell, j) =>
                  `<td class="${j === 0 ? 'p-4 font-medium text-foreground align-top' : 'p-4 text-muted-foreground align-top'}">${escapeHtml(cell)}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('')}</tbody></table></div>`;
    case 'faq':
      return renderFaqBlock(block.items);
    default:
      return '';
  }
};

const renderBlogPost = (post, language) => {
  const t = translations[language];
  const content = getPostContent(post.slug, language) || {};
  const intro = content.intro || post.excerpt;
  const sections = content.sections || [];
  const faq = content.faq || [];
  const conclusion = content.conclusion;

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: post.excerpt,
      author: { '@type': 'Person', name: 'João Victor Souza' },
      datePublished: post.date,
      dateModified: post.date,
      inLanguage: htmlLangOf[language],
      mainEntityOfPage: `${siteUrl}${localizedPath('post', language, post.slug)}`,
    },
  ];
  if (faq.length) {
    schema.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    });
  }

  const sectionsHtml = sections
    .map(
      (section, i) => `
              <article class="mt-5 rounded-[2rem] border border-border/70 bg-card/80 p-6 shadow-card md:p-8">
                <p class="mb-3 font-mono text-eyebrow uppercase text-muted-foreground">${String(i + 1).padStart(2, '0')}</p>
                <h2 class="font-display text-2xl font-medium tracking-tight">${escapeHtml(section.title)}</h2>
                <div class="mt-5 space-y-4">${section.blocks.map(renderBlock).join('')}</div>
              </article>`,
    )
    .join('');

  const faqHtml = faq.length
    ? `
              <article class="mt-5 rounded-[2rem] border border-border/70 bg-card/80 p-6 shadow-card md:p-8">
                <p class="mb-3 font-mono text-eyebrow uppercase text-muted-foreground">FAQ</p>
                <h2 class="font-display text-2xl font-medium tracking-tight">${escapeHtml(faqHeadingOf[language])}</h2>
                <div class="mt-5">${renderFaqBlock(faq)}</div>
              </article>`
    : '';

  const conclusionHtml = conclusion
    ? `
              <article class="mt-5 rounded-[2rem] border border-border/70 bg-card/80 p-6 shadow-card md:p-8">
                <h2 class="font-display text-2xl font-medium tracking-tight">${escapeHtml(conclusion.title)}</h2>
                <p class="mt-5 text-foreground/90 leading-relaxed">${escapeHtml(conclusion.description)}</p>
              </article>`
    : '';

  return {
    path: localizedPath('post', language, post.slug),
    language,
    alternates: alternatePathsFor('post', post.slug),
    title: `${post.title} | João Victor Souza`,
    description: post.excerpt,
    ogType: 'article',
    schema,
    body: renderShell({
      eyebrow: t.menu.blog,
      title: post.title,
      description: intro,
      content: `
          <section class="border-y border-border/60 py-14 md:py-20">
            <div class="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8">
              <p class="mb-6 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">${escapeHtml(post.date)} / ${escapeHtml(post.category)} / ${escapeHtml(post.readTime)}</p>
              ${sectionsHtml}
              ${faqHtml}
              ${conclusionHtml}
            </div>
          </section>
      `,
    }),
  };
};

const renderBlogPage = (language) => {
  const t = translations[language];
  const page = t.blogPage;
  const posts = getPublishedPosts(language);
  const upcoming = getUpcomingPosts(language);

  return {
    path: localizedPath('blog', language),
    language,
    alternates: alternatePathsFor('blog'),
    title: page.seoTitle,
    description: page.seoDescription,
    body: renderShell({
      eyebrow: t.menu.blog,
      title: page.heroTitle,
      description: page.heroDescription,
      content: `
          <section class="border-y border-border/60 py-14 md:py-20">
            <div class="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-4 sm:px-6 md:grid-cols-12 lg:px-8">
              <div class="space-y-5 md:col-span-8">
                ${posts
                  .map((post) =>
                    renderCard({
                      href: localizedPath('post', language, post.slug),
                      meta: [post.date, post.category, post.readTime],
                      title: post.title,
                      description: post.excerpt,
                      cta: page.readArticle,
                    }),
                  )
                  .join('')}
              </div>
              <aside class="md:col-span-4">
                <div class="rounded-[2rem] border border-border/70 bg-card/80 p-6">
                  <h2 class="font-display text-lg font-medium">${escapeHtml(page.upcomingTitle)}</h2>
                  <ul class="mt-5 space-y-3 text-sm text-muted-foreground">
                    ${upcoming.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
                  </ul>
                </div>
              </aside>
            </div>
          </section>
      `,
    }),
  };
};

const renderServicesPage = (language) => {
  const t = translations[language];
  const page = t.servicesPage;
  const services = getServices(language);

  return {
    path: localizedPath('services', language),
    language,
    alternates: alternatePathsFor('services'),
    title: page.seoTitle,
    description: page.seoDescription,
    body: renderShell({
      eyebrow: t.menu.services,
      title: page.heroTitle,
      description: page.heroDescription,
      content: `
          <section class="border-y border-border/60 py-14 md:py-20">
            <div class="mx-auto grid w-full max-w-6xl grid-cols-1 gap-5 px-4 sm:px-6 md:grid-cols-2 lg:px-8">
              ${services
                .map((service) =>
                  renderCard({
                    href: localizedPath('service', language, service.slug),
                    title: service.title,
                    description: service.summary,
                    cta: page.viewDetails,
                  }),
                )
                .join('')}
            </div>
          </section>
      `,
    }),
  };
};

const renderCasesPage = (language) => {
  const t = translations[language];
  const page = t.casesPage;
  const cases = getCases(language);

  return {
    path: localizedPath('cases', language),
    language,
    alternates: alternatePathsFor('cases'),
    title: page.seoTitle,
    description: page.seoDescription,
    body: renderShell({
      eyebrow: t.menu.cases,
      title: page.heroTitle,
      description: page.heroDescription,
      content: `
          <section class="border-y border-border/60 py-14 md:py-20">
            <div class="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
              <p class="mb-6 font-mono text-eyebrow uppercase text-muted-foreground">${escapeHtml(page.filterTitle)}</p>
              <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
                ${cases
                  .map((caseItem) =>
                    renderCard({
                      href: localizedPath('case', language, caseItem.slug),
                      meta: [caseItem.category],
                      title: caseItem.title,
                      description: caseItem.summary,
                      cta: page.viewFullCase,
                    }),
                  )
                  .join('')}
              </div>
            </div>
          </section>
      `,
    }),
  };
};

const writePage = async (baseHtml, page) => {
  const html = updateHead(baseHtml, page).replace(
    '<div id="root"></div>',
    `<div id="root">${page.body}</div>`,
  );
  const routeName = page.path.replace(/^\//, '');
  const routeDir = path.join(buildDir, routeName);

  await mkdir(routeDir, { recursive: true });
  await writeFile(path.join(routeDir, 'index.html'), html, 'utf8');
  await writeFile(path.join(buildDir, `${routeName}.html`), html, 'utf8');
};

// Rotas estaticas publicas do site (fora das listagens dinamicas), por chave
// logica: cada uma entra no sitemap nas tres variantes de idioma.
// Fora daqui de proposito: /zap (redirect para /whatsapp), a rota coringa de
// 404 e a politica de privacidade, que nao tem listagem de itens.
const staticSitemapEntries = [
  { routeKey: 'home', changefreq: 'weekly', priority: '1.0' },
  { routeKey: 'about', changefreq: 'monthly', priority: '0.8' },
  { routeKey: 'services', changefreq: 'weekly', priority: '0.9' },
  { routeKey: 'cases', changefreq: 'weekly', priority: '0.8' },
  { routeKey: 'blog', changefreq: 'weekly', priority: '0.8' },
  { routeKey: 'projects', changefreq: 'monthly', priority: '0.7' },
  { routeKey: 'contact', changefreq: 'monthly', priority: '0.8' },
  { routeKey: 'whatsapp', changefreq: 'monthly', priority: '0.7' },
  { routeKey: 'wpp', changefreq: 'monthly', priority: '0.7' },
  { routeKey: 'matrix', changefreq: 'yearly', priority: '0.3' },
];

// Uma entrada de sitemap por idioma, cada uma declarando as outras como
// alternates. Rotas com o mesmo caminho nos tres idiomas (/blog, /matrix)
// aparecem uma vez so, ainda com os alternates apontando para si mesmas.
const localizedSitemapEntries = ({ routeKey, slug, changefreq, priority, lastmod }) => {
  const alternates = alternatePathsFor(routeKey, slug);
  const seen = new Set();

  return alternates.reduce((entries, { path: routePath }) => {
    if (seen.has(routePath)) return entries;
    seen.add(routePath);

    return [
      ...entries,
      {
        loc: `${siteUrl}${routePath}`,
        lastmod,
        changefreq,
        priority,
        alternates,
      },
    ];
  }, []);
};

const buildSitemap = (posts) => {
  const today = new Date().toISOString().slice(0, 10);

  const staticUrls = staticSitemapEntries.flatMap((entry) =>
    localizedSitemapEntries({ ...entry, lastmod: today }),
  );

  const serviceUrls = getServices('pt').flatMap((service) =>
    localizedSitemapEntries({
      routeKey: 'service',
      slug: service.slug,
      lastmod: today,
      changefreq: 'weekly',
      priority: '0.9',
    }),
  );

  const caseUrls = getCases('pt').flatMap((caseItem) =>
    localizedSitemapEntries({
      routeKey: 'case',
      slug: caseItem.slug,
      lastmod: today,
      changefreq: 'monthly',
      priority: '0.8',
    }),
  );

  const projectUrls = getProjects('pt').flatMap((project) =>
    localizedSitemapEntries({
      routeKey: 'project',
      slug: project.slug,
      lastmod: today,
      changefreq: 'monthly',
      priority: '0.6',
    }),
  );

  const postUrls = posts.flatMap((post) =>
    localizedSitemapEntries({
      routeKey: 'post',
      slug: post.slug,
      lastmod: post.date || today,
      changefreq: 'monthly',
      priority: '0.8',
    }),
  );

  const urls = [...staticUrls, ...serviceUrls, ...caseUrls, ...projectUrls, ...postUrls];

  const renderAlternates = (alternates) =>
    [
      ...alternates.map(
        ({ language, path: routePath }) =>
          `    <xhtml:link rel="alternate" hreflang="${hreflangOf[language]}" href="${escapeXml(`${siteUrl}${routePath}`)}" />`,
      ),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(`${siteUrl}${alternates[0].path}`)}" />`,
    ].join('\n');

  const body = urls
    .map(
      (url) =>
        `  <url>\n    <loc>${escapeXml(url.loc)}</loc>\n${renderAlternates(url.alternates)}\n    <lastmod>${url.lastmod}</lastmod>\n    <changefreq>${url.changefreq}</changefreq>\n    <priority>${url.priority}</priority>\n  </url>`,
    )
    .join('\n');

  return {
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`,
    routeCount: urls.length,
  };
};

const baseHtml = await readFile(path.join(buildDir, 'index.html'), 'utf8');
const posts = getPublishedPosts('pt');

// Uma versao prerenderizada por idioma, cada uma no seu proprio caminho
// (/servicos, /services, /servicios). Caminhos identicos entre idiomas
// (/blog) ficam com a versao do primeiro idioma que os gera.
const seenPaths = new Set();
const pages = SUPPORTED_LANGUAGES.flatMap((language) => [
  renderBlogPage(language),
  renderServicesPage(language),
  renderCasesPage(language),
  ...getPublishedPosts(language).map((post) => renderBlogPost(post, language)),
]).filter((page) => {
  if (seenPaths.has(page.path)) return false;
  seenPaths.add(page.path);
  return true;
});

await Promise.all(pages.map((page) => writePage(baseHtml, page)));

const sitemap = buildSitemap(posts);
await writeFile(path.join(buildDir, 'sitemap.xml'), sitemap.xml, 'utf8');
await writeFile(path.join(publicDir, 'sitemap.xml'), sitemap.xml, 'utf8');

console.log(
  `Prerendered ${pages.length} pages across ${SUPPORTED_LANGUAGES.length} languages (${posts.length} blog posts) and generated sitemap with ${sitemap.routeCount} routes.`,
);
