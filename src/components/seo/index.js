import { useEffect } from 'react';

const SITE_URL = 'https://joaovictorsouza.dev';
const DEFAULT_IMAGE = `${SITE_URL}/assets/images/new/hero-2-300x300.webp`;
const LANGUAGE_CONFIG = {
  pt: { html: 'pt-BR', og: 'pt_BR', hreflang: 'pt-BR' },
  en: { html: 'en-US', og: 'en_US', hreflang: 'en' },
  es: { html: 'es-ES', og: 'es_ES', hreflang: 'es' },
};
const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_CONFIG);

const normalizePathname = (path) => {
  if (!path || path === '/') return '/';
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  return withLeadingSlash.replace(/\/+$/, '');
};

const ensureCanonicalUrl = (value) => {
  if (!value) return `${SITE_URL}/`;

  const raw = String(value).trim();
  const withoutHash = raw.split('#')[0];
  const withoutQuery = withoutHash.split('?')[0];

  if (withoutQuery.startsWith('http://') || withoutQuery.startsWith('https://')) {
    try {
      const parsed = new URL(withoutQuery);
      return `${parsed.origin}${normalizePathname(parsed.pathname)}`;
    } catch {
      return `${SITE_URL}/`;
    }
  }

  return `${SITE_URL}${normalizePathname(withoutQuery)}`;
};

const ensureAbsoluteUrl = (value) => {
  if (!value) return SITE_URL;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return `${SITE_URL}${value.startsWith('/') ? '' : '/'}${value}`;
};

const toBaseLanguage = (language) => {
  const normalized = String(language || '').toLowerCase();
  if (normalized.startsWith('pt')) return 'pt';
  if (normalized.startsWith('en')) return 'en';
  if (normalized.startsWith('es')) return 'es';
  return 'pt';
};

const getCurrentLanguage = () => {
  if (typeof window === 'undefined') return 'pt';

  const queryLanguage = new URLSearchParams(window.location.search).get('lng');
  const storedLanguage = window.localStorage.getItem('i18nextLng');
  const browserLanguage = window.navigator.language;

  return toBaseLanguage(queryLanguage || storedLanguage || browserLanguage);
};

const upsertMeta = (selector, attributes) => {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement('meta');
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
};

const upsertLink = (selector, attributes) => {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement('link');
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
};

const upsertSchema = (schema) => {
  const existing = document.getElementById('seo-schema');
  if (existing) existing.remove();

  if (!schema) return;

  const script = document.createElement('script');
  script.id = 'seo-schema';
  script.type = 'application/ld+json';
  script.text = JSON.stringify(schema);
  document.head.appendChild(script);
};

const upsertAlternateLanguageLinks = (absoluteUrl) => {
  document.head
    .querySelectorAll('link[data-seo-hreflang="true"]')
    .forEach((element) => element.remove());

  const url = new URL(absoluteUrl);
  const path = url.pathname || '/';

  SUPPORTED_LANGUAGES.forEach((language) => {
    const href = `${SITE_URL}${path}?lng=${language}`;
    const link = document.createElement('link');
    link.setAttribute('rel', 'alternate');
    link.setAttribute('hreflang', LANGUAGE_CONFIG[language].hreflang);
    link.setAttribute('href', href);
    link.setAttribute('data-seo-hreflang', 'true');
    document.head.appendChild(link);
  });

  const xDefault = document.createElement('link');
  xDefault.setAttribute('rel', 'alternate');
  xDefault.setAttribute('hreflang', 'x-default');
  xDefault.setAttribute('href', absoluteUrl);
  xDefault.setAttribute('data-seo-hreflang', 'true');
  document.head.appendChild(xDefault);
};

const upsertOpenGraphLocaleAlternates = (currentLanguage) => {
  document.head
    .querySelectorAll('meta[data-seo-og-locale-alt="true"]')
    .forEach((element) => element.remove());

  SUPPORTED_LANGUAGES.filter((language) => language !== currentLanguage).forEach(
    (language) => {
      const meta = document.createElement('meta');
      meta.setAttribute('property', 'og:locale:alternate');
      meta.setAttribute('content', LANGUAGE_CONFIG[language].og);
      meta.setAttribute('data-seo-og-locale-alt', 'true');
      document.head.appendChild(meta);
    },
  );
};

const Seo = ({
  title,
  description,
  canonical,
  image = DEFAULT_IMAGE,
  type = 'website',
  robots = 'index,follow,max-image-preview:large',
  schema = null,
}) => {
  useEffect(() => {
    const language = getCurrentLanguage();
    const locale = LANGUAGE_CONFIG[language] || LANGUAGE_CONFIG.pt;
    const canonicalPath =
      canonical ||
      (typeof window !== 'undefined' ? window.location.pathname : '/');
    const absoluteUrl = ensureCanonicalUrl(canonicalPath);
    const absoluteImage = ensureAbsoluteUrl(image);
    const robotsContent = robots.includes('max-image-preview')
      ? robots
      : `${robots},max-image-preview:large`;
    const schemaPayload = schema || {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title || 'Joao Victor Souza',
      description: description || 'Desenvolvedor de Software',
      url: absoluteUrl,
      inLanguage: locale.html,
    };

    if (title) document.title = title;
    document.documentElement.lang = locale.html;

    if (description) {
      upsertMeta('meta[name="description"]', {
        name: 'description',
        content: description,
      });
    }

    upsertMeta('meta[name="robots"]', {
      name: 'robots',
      content: robotsContent,
    });

    upsertMeta('meta[property="og:type"]', {
      property: 'og:type',
      content: type,
    });
    upsertMeta('meta[property="og:site_name"]', {
      property: 'og:site_name',
      content: 'Joao Victor Souza',
    });
    upsertMeta('meta[property="og:title"]', {
      property: 'og:title',
      content: title || 'Joao Victor Souza',
    });
    upsertMeta('meta[property="og:description"]', {
      property: 'og:description',
      content: description || 'Desenvolvedor de Software',
    });
    upsertMeta('meta[property="og:url"]', {
      property: 'og:url',
      content: absoluteUrl,
    });
    upsertMeta('meta[property="og:image"]', {
      property: 'og:image',
      content: absoluteImage,
    });
    upsertMeta('meta[property="og:locale"]', {
      property: 'og:locale',
      content: locale.og,
    });

    upsertMeta('meta[name="twitter:card"]', {
      name: 'twitter:card',
      content: 'summary_large_image',
    });
    upsertMeta('meta[name="twitter:title"]', {
      name: 'twitter:title',
      content: title || 'Joao Victor Souza',
    });
    upsertMeta('meta[name="twitter:description"]', {
      name: 'twitter:description',
      content: description || 'Desenvolvedor de Software',
    });
    upsertMeta('meta[name="twitter:image"]', {
      name: 'twitter:image',
      content: absoluteImage,
    });

    upsertLink('link[rel="canonical"]', {
      rel: 'canonical',
      href: absoluteUrl,
    });

    upsertAlternateLanguageLinks(absoluteUrl);
    upsertOpenGraphLocaleAlternates(language);
    upsertSchema(schemaPayload);
  }, [canonical, description, image, robots, schema, title, type]);

  return null;
};

export default Seo;
