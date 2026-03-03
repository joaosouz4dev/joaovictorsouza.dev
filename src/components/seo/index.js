import { useEffect } from 'react';

const SITE_URL = 'https://joaovictorsouza.dev';
const DEFAULT_IMAGE = `${SITE_URL}/assets/images/new/hero-2-300x300.webp`;

const ensureAbsoluteUrl = (value) => {
  if (!value) return SITE_URL;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return `${SITE_URL}${value.startsWith('/') ? '' : '/'}${value}`;
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

const Seo = ({
  title,
  description,
  canonical = '/',
  image = DEFAULT_IMAGE,
  type = 'website',
  robots = 'index,follow',
  keywords = '',
  schema = null,
}) => {
  useEffect(() => {
    const absoluteUrl = ensureAbsoluteUrl(canonical);
    const absoluteImage = ensureAbsoluteUrl(image);

    if (title) document.title = title;
    document.documentElement.lang = 'pt-BR';

    if (description) {
      upsertMeta('meta[name="description"]', {
        name: 'description',
        content: description,
      });
    }

    if (keywords) {
      upsertMeta('meta[name="keywords"]', {
        name: 'keywords',
        content: keywords,
      });
    }

    upsertMeta('meta[name="robots"]', {
      name: 'robots',
      content: robots,
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
      content: 'pt_BR',
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

    upsertSchema(schema);
  }, [canonical, description, image, keywords, robots, schema, title, type]);

  return null;
};

export default Seo;
