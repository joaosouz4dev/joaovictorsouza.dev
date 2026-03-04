import { toBaseLanguage } from '../../utils/i18n';

const publishedPostDefinitions = [
  {
    slug: 'guia-whatsapp-cloud-api',
    date: '2026-03-03',
    readTime: '14 min',
    keywords: {
      pt: 'whatsapp cloud api, webhook whatsapp, templates whatsapp, integracao whatsapp crm',
      en: 'whatsapp cloud api, whatsapp webhook, whatsapp templates, whatsapp crm integration',
      es: 'whatsapp cloud api, webhook whatsapp, plantillas whatsapp, integracion whatsapp crm',
    },
    content: {
      pt: {
        title: 'Guia WhatsApp Cloud API: arquitetura, webhooks, templates e deploy',
        excerpt:
          'Arquitetura de producao para integrar WhatsApp Cloud API com webhook seguro, templates, filas e observabilidade.',
        category: 'WhatsApp Cloud API',
      },
      en: {
        title: 'WhatsApp Cloud API Guide: architecture, webhooks, templates and deployment',
        excerpt:
          'Production architecture to integrate WhatsApp Cloud API with secure webhook, templates, queues and observability.',
        category: 'WhatsApp Cloud API',
      },
      es: {
        title: 'Guia de WhatsApp Cloud API: arquitectura, webhooks, plantillas y despliegue',
        excerpt:
          'Arquitectura de produccion para integrar WhatsApp Cloud API con webhook seguro, plantillas, colas y observabilidad.',
        category: 'WhatsApp Cloud API',
      },
    },
  },
  {
    slug: 'meta-pixel-vs-capi-arquitetura',
    date: '2026-03-01',
    readTime: '11 min',
    keywords: {
      pt: 'meta pixel, capi, deduplicacao, events manager',
      en: 'meta pixel, capi, deduplication, events manager',
      es: 'meta pixel, capi, deduplicacion, events manager',
    },
    content: {
      pt: {
        title: 'Meta Pixel vs CAPI: arquitetura ideal para dados confiaveis',
        excerpt:
          'Como combinar Pixel e Conversions API com deduplicacao para reduzir perda de eventos e melhorar atribuicao.',
        category: 'Meta Ads',
      },
      en: {
        title: 'Meta Pixel vs CAPI: ideal architecture for reliable data',
        excerpt:
          'How to combine Pixel and Conversions API with deduplication to reduce event loss and improve attribution.',
        category: 'Meta Ads',
      },
      es: {
        title: 'Meta Pixel vs CAPI: arquitectura ideal para datos confiables',
        excerpt:
          'Como combinar Pixel y Conversions API con deduplicacion para reducir perdida de eventos y mejorar atribucion.',
        category: 'Meta Ads',
      },
    },
  },
  {
    slug: 'webhook-whatsapp-idempotencia-filas',
    date: '2026-02-27',
    readTime: '10 min',
    keywords: {
      pt: 'webhook whatsapp, idempotencia, filas, retry',
      en: 'whatsapp webhook, idempotency, queues, retry',
      es: 'webhook whatsapp, idempotencia, colas, retry',
    },
    content: {
      pt: {
        title: 'Webhook WhatsApp em producao: idempotencia, filas e retry',
        excerpt:
          'Padroes tecnicos para evitar mensagens duplicadas e manter estabilidade em alto volume de atendimento.',
        category: 'Arquitetura Backend',
      },
      en: {
        title: 'Production WhatsApp webhook: idempotency, queues and retry',
        excerpt:
          'Technical patterns to avoid duplicate messages and keep stability under high support volume.',
        category: 'Backend Architecture',
      },
      es: {
        title: 'Webhook de WhatsApp en produccion: idempotencia, colas y retry',
        excerpt:
          'Patrones tecnicos para evitar mensajes duplicados y mantener estabilidad con alto volumen de atencion.',
        category: 'Arquitectura Backend',
      },
    },
  },
  {
    slug: 'handoff-humano-whatsapp-ia',
    date: '2026-02-23',
    readTime: '9 min',
    keywords: {
      pt: 'handoff humano, whatsapp, chatbot ia, atendimento',
      en: 'human handoff, whatsapp, ai chatbot, support',
      es: 'handoff humano, whatsapp, chatbot ia, atencion',
    },
    content: {
      pt: {
        title: 'Handoff humano no WhatsApp: quando e como transferir sem perder contexto',
        excerpt:
          'Modelo operacional para chatbot com IA transferir para atendente humano no momento certo.',
        category: 'Chatbots e IA',
      },
      en: {
        title: 'Human handoff on WhatsApp: when and how to transfer without losing context',
        excerpt:
          'Operational model for AI chatbot flows to transfer to human agents at the right time.',
        category: 'Chatbots and AI',
      },
      es: {
        title: 'Handoff humano en WhatsApp: cuando y como transferir sin perder contexto',
        excerpt:
          'Modelo operativo para que el chatbot con IA transfiera al agente humano en el momento correcto.',
        category: 'Chatbots e IA',
      },
    },
  },
  {
    slug: 'rag-atendimento-whatsapp-producao',
    date: '2026-02-18',
    readTime: '13 min',
    keywords: {
      pt: 'rag, chatbot ia, base de conhecimento, whatsapp',
      en: 'rag, ai chatbot, knowledge base, whatsapp',
      es: 'rag, chatbot ia, base de conocimiento, whatsapp',
    },
    content: {
      pt: {
        title: 'RAG para atendimento no WhatsApp: desenho de producao sem alucinacao',
        excerpt:
          'Como estruturar base de conhecimento, guardrails e avaliacao continua para bots mais precisos.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'RAG for WhatsApp support: production design with fewer hallucinations',
        excerpt:
          'How to structure knowledge base, guardrails and continuous evaluation for more accurate bots.',
        category: 'Applied AI',
      },
      es: {
        title: 'RAG para atencion en WhatsApp: diseno de produccion con menos alucinaciones',
        excerpt:
          'Como estructurar base de conocimiento, guardrails y evaluacion continua para bots mas precisos.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'monitoramento-alertas-integracoes',
    date: '2026-02-13',
    readTime: '8 min',
    keywords: {
      pt: 'observabilidade, alertas, integracoes, slas',
      en: 'observability, alerts, integrations, slas',
      es: 'observabilidad, alertas, integraciones, slas',
    },
    content: {
      pt: {
        title: 'Monitoramento e alertas em integracoes: o minimo para nao apagar incendio',
        excerpt:
          'Painel e alertas essenciais para webhook, fila, worker e APIs externas com foco em tempo de resposta.',
        category: 'Observabilidade',
      },
      en: {
        title: 'Monitoring and alerts for integrations: the minimum to avoid firefighting',
        excerpt:
          'Essential dashboard and alerts for webhook, queue, worker and external APIs focused on response time.',
        category: 'Observability',
      },
      es: {
        title: 'Monitoreo y alertas en integraciones: el minimo para no apagar incendios',
        excerpt:
          'Dashboard y alertas esenciales para webhook, cola, worker y APIs externas con foco en tiempo de respuesta.',
        category: 'Observabilidad',
      },
    },
  },
  {
    slug: 'crm-whatsapp-playbook-vendas',
    date: '2026-02-08',
    readTime: '12 min',
    keywords: {
      pt: 'crm whatsapp, funil comercial, automacao vendas',
      en: 'crm whatsapp, sales funnel, sales automation',
      es: 'crm whatsapp, embudo comercial, automatizacion ventas',
    },
    content: {
      pt: {
        title: 'Playbook CRM + WhatsApp para acelerar vendas sem perder qualidade',
        excerpt:
          'Eventos, etapas e automacoes recomendadas para ligar atendimento, qualificacao e fechamento comercial.',
        category: 'Automacao Comercial',
      },
      en: {
        title: 'CRM + WhatsApp playbook to accelerate sales without losing quality',
        excerpt:
          'Recommended events, stages and automations to connect support, qualification and sales closing.',
        category: 'Revenue Automation',
      },
      es: {
        title: 'Playbook CRM + WhatsApp para acelerar ventas sin perder calidad',
        excerpt:
          'Eventos, etapas y automatizaciones recomendadas para conectar atencion, calificacion y cierre comercial.',
        category: 'Automatizacion Comercial',
      },
    },
  },
  {
    slug: 'seguranca-integracoes-meta-whatsapp',
    date: '2026-02-04',
    readTime: '10 min',
    keywords: {
      pt: 'seguranca api, whatsapp, meta, webhook signature',
      en: 'api security, whatsapp, meta, webhook signature',
      es: 'seguridad api, whatsapp, meta, firma webhook',
    },
    content: {
      pt: {
        title: 'Checklist de seguranca para integracoes Meta e WhatsApp',
        excerpt:
          'Boas praticas de assinatura, segregacao de credenciais, rate limit e trilha de auditoria.',
        category: 'Seguranca',
      },
      en: {
        title: 'Security checklist for Meta and WhatsApp integrations',
        excerpt:
          'Best practices for signatures, credential segregation, rate limiting and audit trail.',
        category: 'Security',
      },
      es: {
        title: 'Checklist de seguridad para integraciones de Meta y WhatsApp',
        excerpt:
          'Buenas practicas de firma, segregacion de credenciales, rate limit y trazabilidad de auditoria.',
        category: 'Seguridad',
      },
    },
  },
  {
    slug: 'custos-whatsapp-cloud-api-otimizacao',
    date: '2026-01-30',
    readTime: '7 min',
    keywords: {
      pt: 'custos whatsapp api, templates, operacao',
      en: 'whatsapp api costs, templates, operations',
      es: 'costos whatsapp api, plantillas, operacion',
    },
    content: {
      pt: {
        title: 'Custos na WhatsApp Cloud API: como otimizar sem degradar experiencia',
        excerpt:
          'Regras praticas para reduzir desperdicio de conversas e melhorar taxa de resolucao por jornada.',
        category: 'Operacao',
      },
      en: {
        title: 'WhatsApp Cloud API costs: how to optimize without degrading experience',
        excerpt:
          'Practical rules to reduce conversation waste and improve resolution rate by journey.',
        category: 'Operations',
      },
      es: {
        title: 'Costos en WhatsApp Cloud API: como optimizar sin degradar la experiencia',
        excerpt:
          'Reglas practicas para reducir desperdicio de conversaciones y mejorar tasa de resolucion por jornada.',
        category: 'Operacion',
      },
    },
  },
  {
    slug: 'testes-contrato-webhooks-apis',
    date: '2026-01-24',
    readTime: '9 min',
    keywords: {
      pt: 'teste de contrato, webhook, api integration',
      en: 'contract testing, webhook, api integration',
      es: 'pruebas de contrato, webhook, integracion api',
    },
    content: {
      pt: {
        title: 'Testes de contrato para webhooks e APIs: reduzindo regressao em integracoes',
        excerpt:
          'Estrategia de testes para evitar quebra silenciosa quando parceiros mudam payload ou versao.',
        category: 'Qualidade',
      },
      en: {
        title: 'Contract testing for webhooks and APIs: reducing integration regressions',
        excerpt:
          'Testing strategy to avoid silent breakages when partners change payloads or versions.',
        category: 'Quality Engineering',
      },
      es: {
        title: 'Pruebas de contrato para webhooks y APIs: reduciendo regresiones en integraciones',
        excerpt:
          'Estrategia de pruebas para evitar quiebres silenciosos cuando partners cambian payload o version.',
        category: 'Calidad',
      },
    },
  },
  {
    slug: 'arquitetura-multi-tenant-whatsapp-saas',
    date: '2026-01-19',
    readTime: '12 min',
    keywords: {
      pt: 'multi tenant, saas whatsapp, arquitetura backend',
      en: 'multi tenant, whatsapp saas, backend architecture',
      es: 'multi tenant, saas whatsapp, arquitectura backend',
    },
    content: {
      pt: {
        title: 'Arquitetura multi-tenant para SaaS com WhatsApp',
        excerpt:
          'Padroes para isolamento de clientes, limites por tenant e governanca de configuracoes.',
        category: 'SaaS Architecture',
      },
      en: {
        title: 'Multi-tenant architecture for WhatsApp SaaS',
        excerpt:
          'Patterns for tenant isolation, per-tenant limits and configuration governance.',
        category: 'SaaS Architecture',
      },
      es: {
        title: 'Arquitectura multi-tenant para SaaS con WhatsApp',
        excerpt:
          'Patrones para aislamiento de clientes, limites por tenant y gobernanza de configuraciones.',
        category: 'Arquitectura SaaS',
      },
    },
  },
  {
    slug: 'roadmap-automacao-suporte-ia-90-dias',
    date: '2026-01-12',
    readTime: '8 min',
    keywords: {
      pt: 'roadmap automacao, suporte ia, implementacao 90 dias',
      en: 'automation roadmap, ai support, 90-day implementation',
      es: 'roadmap automatizacion, soporte ia, implementacion 90 dias',
    },
    content: {
      pt: {
        title: 'Roadmap de 90 dias para automacao de atendimento com IA',
        excerpt:
          'Plano em fases para sair do piloto e chegar em operacao com metrica, governanca e escala.',
        category: 'Estrategia Tecnica',
      },
      en: {
        title: '90-day roadmap for AI support automation',
        excerpt:
          'Phased plan to move from pilot to production with metrics, governance and scale.',
        category: 'Technical Strategy',
      },
      es: {
        title: 'Roadmap de 90 dias para automatizacion de atencion con IA',
        excerpt:
          'Plan por fases para pasar de piloto a produccion con metricas, gobernanza y escala.',
        category: 'Estrategia Tecnica',
      },
    },
  },
];

const upcomingPostsByLanguage = {
  pt: [
    'Arquitetura de fila para picos de campanha no WhatsApp',
    'Como desenhar SLAs de atendimento com bot + humano',
    'Governanca de templates em times grandes',
    'Integracao ERP + CRM sem retrabalho operacional',
    'Como calcular ROI real de automacao com IA',
  ],
  en: [
    'Queue architecture for WhatsApp campaign peaks',
    'How to design support SLAs with bot + human team',
    'Template governance in large teams',
    'ERP + CRM integration without operational rework',
    'How to calculate real ROI from AI automation',
  ],
  es: [
    'Arquitectura de colas para picos de campana en WhatsApp',
    'Como disenar SLAs de atencion con bot + equipo humano',
    'Gobernanza de plantillas en equipos grandes',
    'Integracion ERP + CRM sin retrabajo operativo',
    'Como calcular el ROI real de automatizacion con IA',
  ],
};

const buildPublishedPosts = (language) =>
  publishedPostDefinitions.map((post) => ({
    slug: post.slug,
    date: post.date,
    readTime: post.readTime,
    title: post.content[language]?.title || post.content.pt.title,
    excerpt: post.content[language]?.excerpt || post.content.pt.excerpt,
    category: post.content[language]?.category || post.content.pt.category,
    keywords: post.keywords[language] || post.keywords.pt,
  }));

const blogByLanguage = {
  pt: {
    publishedPosts: buildPublishedPosts('pt'),
    upcomingPosts: upcomingPostsByLanguage.pt,
  },
  en: {
    publishedPosts: buildPublishedPosts('en'),
    upcomingPosts: upcomingPostsByLanguage.en,
  },
  es: {
    publishedPosts: buildPublishedPosts('es'),
    upcomingPosts: upcomingPostsByLanguage.es,
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
