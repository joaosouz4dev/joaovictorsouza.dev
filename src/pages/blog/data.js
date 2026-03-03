export const publishedPosts = [
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
];

export const upcomingPosts = [
  'Meta Pixel vs Conversions API: arquitetura ideal para dados confiaveis',
  'Handoff humano no WhatsApp sem perder contexto',
  'RAG do zero para atendimento com IA',
  'Checklist de seguranca para integracoes Meta, WhatsApp e IA',
];

export const getPostBySlug = (slug) =>
  publishedPosts.find((post) => post.slug === slug);
