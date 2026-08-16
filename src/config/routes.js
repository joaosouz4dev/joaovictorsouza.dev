// Mapa de rotas por idioma.
//
// O idioma nao vive num prefixo (/en/...), e sim no proprio segmento: /sobre e
// portugues, /about e ingles, /acerca-de e espanhol. Assim cada idioma tem URLs
// naturais e as URLs em portugues, que ja estao indexadas, continuam valendo.
//
// Os slugs de conteudo (servicos, cases, projetos, posts) sao identificadores
// unicos definidos nos data.js e nao mudam entre idiomas: so o segmento de rota
// e traduzido, por exemplo /servicos/whatsapp-cloud-api e /services/whatsapp-cloud-api.

export const SUPPORTED_LANGUAGES = ['pt', 'en', 'es'];
export const DEFAULT_LANGUAGE = 'pt';

// Chave logica da rota -> segmento em cada idioma.
// A ordem aqui e a ordem usada no sitemap.
export const ROUTE_SEGMENTS = {
  home: { pt: '', en: '', es: '' },
  about: { pt: 'sobre', en: 'about', es: 'acerca-de' },
  services: { pt: 'servicos', en: 'services', es: 'servicios' },
  cases: { pt: 'cases', en: 'case-studies', es: 'casos' },
  blog: { pt: 'blog', en: 'blog', es: 'blog' },
  projects: { pt: 'projetos', en: 'projects', es: 'proyectos' },
  contact: { pt: 'contato', en: 'contact', es: 'contacto' },
  whatsapp: { pt: 'whatsapp', en: 'whatsapp', es: 'whatsapp' },
  wpp: { pt: 'wpp', en: 'wpp', es: 'wpp' },
  matrix: { pt: 'matrix', en: 'matrix', es: 'matrix' },
  privacy: {
    pt: 'politica-de-privacidade',
    en: 'privacy-policy',
    es: 'politica-de-privacidad',
  },
};

// Rotas de detalhe: reaproveitam o segmento da listagem e recebem o slug do item.
export const DETAIL_ROUTE_PARENTS = {
  service: 'services',
  case: 'cases',
  project: 'projects',
  post: 'blog',
};

// Idioma para fins de URL. Diferente do toBaseLanguage de utils/i18n.js, que
// resolve idioma de conteudo e cai em ingles: aqui o fallback e portugues,
// porque as URLs em portugues sao as que ja estao publicadas e indexadas.
export const toRouteLanguage = (language) => {
  const normalized = String(language || '').toLowerCase();
  if (normalized.startsWith('pt')) return 'pt';
  if (normalized.startsWith('en')) return 'en';
  if (normalized.startsWith('es')) return 'es';
  return DEFAULT_LANGUAGE;
};

const firstSegmentOf = (pathname) =>
  String(pathname || '/')
    .split('?')[0]
    .split('#')[0]
    .split('/')
    .filter(Boolean)[0] || '';

// Indice reverso: segmento -> { key, languages }. Segmentos iguais em mais de um
// idioma (blog, matrix, whatsapp) guardam todos os idiomas que os usam.
const SEGMENT_INDEX = (() => {
  const index = new Map();

  Object.entries(ROUTE_SEGMENTS).forEach(([key, byLanguage]) => {
    Object.entries(byLanguage).forEach(([language, segment]) => {
      if (!segment) return;
      const existing = index.get(segment);
      if (existing) {
        existing.languages.push(language);
        return;
      }
      index.set(segment, { key, languages: [language] });
    });
  });

  return index;
})();

/**
 * Monta o caminho de uma rota no idioma pedido.
 * localizedPath('services', 'en') -> '/services'
 * localizedPath('service', 'es', 'whatsapp-cloud-api') -> '/servicios/whatsapp-cloud-api'
 */
export const localizedPath = (routeKey, language, slug) => {
  const lang = toRouteLanguage(language);
  const parentKey = DETAIL_ROUTE_PARENTS[routeKey] || routeKey;
  const segments = ROUTE_SEGMENTS[parentKey];

  if (!segments) return '/';

  const base = segments[lang] ?? segments[DEFAULT_LANGUAGE];
  const parts = [base, slug].filter(Boolean);

  return parts.length ? `/${parts.join('/')}` : '/';
};

/**
 * Descobre a chave logica da rota a partir do caminho atual.
 * '/case-studies/foo' -> 'cases'
 */
export const routeKeyFromPath = (pathname) => {
  const segment = firstSegmentOf(pathname);
  if (!segment) return 'home';
  return SEGMENT_INDEX.get(segment)?.key || null;
};

/**
 * Descobre o idioma a partir do caminho. Retorna null quando o caminho nao
 * identifica idioma (home, /blog, /matrix e outros segmentos compartilhados),
 * deixando a deteccao normal do i18next decidir.
 */
export const languageFromPath = (pathname) => {
  const segment = firstSegmentOf(pathname);
  if (!segment) return null;

  const entry = SEGMENT_INDEX.get(segment);
  if (!entry || entry.languages.length !== 1) return null;

  return entry.languages[0];
};

/**
 * Traduz um caminho inteiro para outro idioma, preservando o slug do item.
 * translatePath('/servicos/whatsapp-cloud-api', 'en') -> '/services/whatsapp-cloud-api'
 * Caminhos desconhecidos voltam como estao.
 */
export const translatePath = (pathname, language) => {
  const raw = String(pathname || '/');
  const suffixIndex = raw.search(/[?#]/);
  const clean = suffixIndex === -1 ? raw : raw.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? '' : raw.slice(suffixIndex);
  const parts = clean.split('/').filter(Boolean);

  if (!parts.length) return `/${suffix}`;

  const entry = SEGMENT_INDEX.get(parts[0]);
  if (!entry) return raw;

  const rest = parts.slice(1);
  const base = localizedPath(entry.key, language);
  const translated = rest.length
    ? `${base === '/' ? '' : base}/${rest.join('/')}`
    : base;

  return `${translated}${suffix}`;
};

/**
 * Todas as variantes de idioma de uma mesma rota, para hreflang e sitemap.
 * [{ language, path }]
 */
export const alternatePathsFor = (routeKey, slug) =>
  SUPPORTED_LANGUAGES.map((language) => ({
    language,
    path: localizedPath(routeKey, language, slug),
  }));

/**
 * Variantes unicas de uma rota, para registrar no router sem duplicar path
 * (rotas com segmento identico nos tres idiomas viram uma entrada so).
 */
export const uniquePathsFor = (routeKey, slugPattern) => {
  const seen = new Set();

  return SUPPORTED_LANGUAGES.reduce((paths, language) => {
    const path = localizedPath(routeKey, language, slugPattern);
    if (seen.has(path)) return paths;
    seen.add(path);
    return [...paths, path];
  }, []);
};
