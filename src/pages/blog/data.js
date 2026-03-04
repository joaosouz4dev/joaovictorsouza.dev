import { toBaseLanguage } from '../../utils/i18n';

const blogByLanguage = {
  pt: {
    publishedPosts: [
      {
        slug: 'guia-whatsapp-cloud-api',
        title: 'Guia WhatsApp Cloud API: arquitetura, webhooks, templates e deploy',
        excerpt:
          'Arquitetura de producao para integrar WhatsApp Cloud API com webhook seguro, templates, filas e observabilidade.',
        category: 'WhatsApp Cloud API',
        date: '2026-03-03',
        readTime: '14 min',
        keywords:
          'whatsapp cloud api, webhook whatsapp, templates whatsapp, integracao whatsapp crm',
      },
    ],
    upcomingPosts: [
      'Meta Pixel vs Conversions API: arquitetura ideal para dados confiaveis',
      'Handoff humano no WhatsApp sem perder contexto',
      'RAG do zero para atendimento com IA',
      'Checklist de seguranca para integracoes Meta, WhatsApp e IA',
    ],
  },
  en: {
    publishedPosts: [
      {
        slug: 'guia-whatsapp-cloud-api',
        title: 'WhatsApp Cloud API Guide: architecture, webhooks, templates and deployment',
        excerpt:
          'Production architecture to integrate WhatsApp Cloud API with secure webhook, templates, queues and observability.',
        category: 'WhatsApp Cloud API',
        date: '2026-03-03',
        readTime: '14 min',
        keywords:
          'whatsapp cloud api, whatsapp webhook, whatsapp templates, whatsapp crm integration',
      },
    ],
    upcomingPosts: [
      'Meta Pixel vs Conversions API: ideal architecture for reliable data',
      'Human handoff on WhatsApp without losing context',
      'RAG from scratch for AI-powered support',
      'Security checklist for Meta, WhatsApp and AI integrations',
    ],
  },
  es: {
    publishedPosts: [
      {
        slug: 'guia-whatsapp-cloud-api',
        title: 'Guía WhatsApp Cloud API: arquitectura, webhooks, plantillas y despliegue',
        excerpt:
          'Arquitectura de producción para integrar WhatsApp Cloud API con webhook seguro, plantillas, colas y observabilidad.',
        category: 'WhatsApp Cloud API',
        date: '2026-03-03',
        readTime: '14 min',
        keywords:
          'whatsapp cloud api, webhook whatsapp, plantillas whatsapp, integracion whatsapp crm',
      },
    ],
    upcomingPosts: [
      'Meta Pixel vs Conversions API: arquitectura ideal para datos confiables',
      'Handoff humano en WhatsApp sin perder contexto',
      'RAG desde cero para atención con IA',
      'Checklist de seguridad para integraciones Meta, WhatsApp e IA',
    ],
  },
};

const getBlogLanguageContent = (language = 'pt') => {
  const locale = toBaseLanguage(language);
  return blogByLanguage[locale] || blogByLanguage.pt;
};

export const getPublishedPosts = (language = 'pt') =>
  getBlogLanguageContent(language).publishedPosts;

export const getUpcomingPosts = (language = 'pt') =>
  getBlogLanguageContent(language).upcomingPosts;

export const getPostBySlug = (slug, language = 'pt') =>
  getPublishedPosts(language).find((post) => post.slug === slug);

