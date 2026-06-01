import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import translatePt from '../src/config/translate/pt.js';
import { getPublishedPosts, getUpcomingPosts } from '../src/pages/blog/data.js';
import { getCases } from '../src/pages/cases/data.js';
import { getServices } from '../src/pages/servicos/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const buildDir = path.join(rootDir, 'build');
const siteUrl = 'https://joaovictorsouza.dev';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const normalizePath = (routePath) => (routePath === '/' ? '/' : routePath.replace(/\/+$/, ''));

const updateHead = (html, page) => {
  const absoluteUrl = `${siteUrl}${normalizePath(page.path)}`;

  return html
    .replace(/<html([^>]*)>/, `<html$1 data-prerendered-route="${escapeHtml(page.path)}">`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(page.title)}</title>`)
    .replace(
      /<meta name="description" content="[^"]*" \/>/,
      `<meta name="description" content="${escapeHtml(page.description)}" />`,
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
    .replace(
      '</head>',
      `    <link rel="canonical" href="${escapeHtml(absoluteUrl)}" />\n  </head>`,
    );
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

const renderBlogPage = () => {
  const page = translatePt.blogPage;
  const posts = getPublishedPosts('pt');
  const upcoming = getUpcomingPosts('pt');

  return {
    path: '/blog',
    title: page.seoTitle,
    description: page.seoDescription,
    body: renderShell({
      eyebrow: translatePt.menu.blog,
      title: page.heroTitle,
      description: page.heroDescription,
      content: `
          <section class="border-y border-border/60 py-14 md:py-20">
            <div class="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-4 sm:px-6 md:grid-cols-12 lg:px-8">
              <div class="space-y-5 md:col-span-8">
                ${posts
                  .map((post) =>
                    renderCard({
                      href: `/blog/${post.slug}`,
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

const renderServicesPage = () => {
  const page = translatePt.servicesPage;
  const services = getServices('pt');

  return {
    path: '/servicos',
    title: page.seoTitle,
    description: page.seoDescription,
    body: renderShell({
      eyebrow: translatePt.menu.services,
      title: page.heroTitle,
      description: page.heroDescription,
      content: `
          <section class="border-y border-border/60 py-14 md:py-20">
            <div class="mx-auto grid w-full max-w-6xl grid-cols-1 gap-5 px-4 sm:px-6 md:grid-cols-2 lg:px-8">
              ${services
                .map((service) =>
                  renderCard({
                    href: `/servicos/${service.slug}`,
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

const renderCasesPage = () => {
  const page = translatePt.casesPage;
  const cases = getCases('pt');

  return {
    path: '/cases',
    title: page.seoTitle,
    description: page.seoDescription,
    body: renderShell({
      eyebrow: translatePt.menu.cases,
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
                      href: `/cases/${caseItem.slug}`,
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

const baseHtml = await readFile(path.join(buildDir, 'index.html'), 'utf8');
const pages = [renderBlogPage(), renderServicesPage(), renderCasesPage()];

await Promise.all(pages.map((page) => writePage(baseHtml, page)));
console.log(`Prerendered ${pages.length} internal pages.`);
