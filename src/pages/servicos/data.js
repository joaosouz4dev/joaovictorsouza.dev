import { toBaseLanguage } from '../../utils/i18n.js';

const serviceDefinitions = [
  {
    slug: 'meta-ads-e-integracoes',
    content: {
      pt: {
        title: 'Meta Ads e Integrações (Pixel + CAPI)',
        summary: 'Mensuração server-side com foco em atribuição e dados confiáveis.',
        heroTitle: 'Implementação Meta Pixel + Conversions API',
        heroDescription:
          'Arquitetura de tracking com deduplicação, governança de eventos e monitoramento.',
        steps: [
          'Diagnóstico do tracking atual.',
          'Desenho de arquitetura Pixel + CAPI.',
          'Implementação, validação e ajustes.',
        ],
        deliverables: [
          'Mapa de eventos do funil.',
          'Implementação Pixel + CAPI.',
          'Checklist de qualidade e dashboard.',
        ],
        faq: [
          {
            question: 'Quando usar Pixel e CAPI juntos?',
            answer: 'Quando precisa de resiliência e menor perda de eventos.',
          },
          {
            question: 'Isso melhora performance sozinho?',
            answer: 'Melhora a qualidade do dado para decisão. Mídia e criativo continuam essenciais.',
          },
        ],
        keywords: 'meta pixel, capi, conversions api, mensuração',
      },
      en: {
        title: 'Meta Ads and Integrations (Pixel + CAPI)',
        summary: 'Server-side measurement focused on attribution and reliable data.',
        heroTitle: 'Meta Pixel + Conversions API implementation',
        heroDescription:
          'Tracking architecture with deduplication, event governance and monitoring.',
        steps: [
          'Current tracking diagnosis.',
          'Pixel + CAPI architecture design.',
          'Implementation, validation and tuning.',
        ],
        deliverables: [
          'Funnel event map.',
          'Pixel + CAPI implementation.',
          'Quality checklist and dashboard.',
        ],
        faq: [
          {
            question: 'When should Pixel and CAPI be combined?',
            answer: 'When you need stronger resilience and lower event loss.',
          },
          {
            question: 'Does this alone improve campaign performance?',
            answer: 'It improves data quality for decisions. Media and creative remain key.',
          },
        ],
        keywords: 'meta pixel, capi, conversions api, measurement',
      },
      es: {
        title: 'Meta Ads e Integraciones (Pixel + CAPI)',
        summary: 'Medición server-side enfocada en atribución y datos confiables.',
        heroTitle: 'Implementación Meta Pixel + Conversions API',
        heroDescription:
          'Arquitectura de tracking con deduplicación, gobernanza de eventos y monitoreo.',
        steps: [
          'Diagnóstico del tracking actual.',
          'Diseño de arquitectura Pixel + CAPI.',
          'Implementación, validación y ajustes.',
        ],
        deliverables: [
          'Mapa de eventos del embudo.',
          'Implementación Pixel + CAPI.',
          'Checklist de calidad y dashboard.',
        ],
        faq: [
          {
            question: '¿Cuándo usar Pixel y CAPI juntos?',
            answer: 'Cuando necesitas mayor resiliencia y menor pérdida de eventos.',
          },
          {
            question: '¿Esto mejora performance por sí solo?',
            answer: 'Mejora la calidad del dato. Medios y creativos siguen siendo clave.',
          },
        ],
        keywords: 'meta pixel, capi, conversions api, medición',
      },
    },
  },
  {
    slug: 'whatsapp-cloud-api',
    content: {
      pt: {
        title: 'WhatsApp Cloud API',
        summary: 'Integração oficial com webhook seguro, templates, filas e handoff humano.',
        heroTitle: 'WhatsApp Cloud API para atendimento e vendas',
        heroDescription:
          'Fluxos robustos com idempotência, observabilidade e integração a CRM/ERP.',
        steps: [
          'Mapeamento de jornada e casos de uso.',
          'Webhook seguro com idempotência.',
          'Orquestração com templates e handoff.',
        ],
        deliverables: [
          'Webhook em produção.',
          'Fluxos de atendimento com fallback.',
          'Integração com CRM e monitoramento.',
        ],
        faq: [
          {
            question: 'Você trabalha com API oficial?',
            answer: 'Sim, somente API oficial para operação profissional.',
          },
          {
            question: 'Consegue integrar com meu CRM?',
            answer: 'Sim, via API ou webhooks do CRM existente.',
          },
        ],
        keywords: 'whatsapp cloud api, webhook whatsapp, templates',
      },
      en: {
        title: 'WhatsApp Cloud API',
        summary: 'Official integration with secure webhook, templates, queues and human handoff.',
        heroTitle: 'WhatsApp Cloud API for support and sales',
        heroDescription: 'Robust flows with idempotency, observability and CRM/ERP integration.',
        steps: [
          'Journey and use-case mapping.',
          'Secure webhook with idempotency.',
          'Template orchestration and human handoff.',
        ],
        deliverables: [
          'Production-ready webhook.',
          'Support flows with fallback.',
          'CRM integration and monitoring.',
        ],
        faq: [
          {
            question: 'Do you work with the official API?',
            answer: 'Yes, official API only for professional operations.',
          },
          {
            question: 'Can you integrate with my CRM?',
            answer: 'Yes, through API or CRM webhooks.',
          },
        ],
        keywords: 'whatsapp cloud api, whatsapp webhook, templates',
      },
      es: {
        title: 'WhatsApp Cloud API',
        summary: 'Integración oficial con webhook seguro, plantillas, colas y handoff humano.',
        heroTitle: 'WhatsApp Cloud API para atención y ventas',
        heroDescription: 'Flujos robustos con idempotencia, observabilidad e integración a CRM/ERP.',
        steps: [
          'Mapeo de jornada y casos de uso.',
          'Webhook seguro con idempotencia.',
          'Orquestación con plantillas y handoff.',
        ],
        deliverables: [
          'Webhook productivo.',
          'Flujos de atención con fallback.',
          'Integración con CRM y monitoreo.',
        ],
        faq: [
          {
            question: '¿Trabajas con API oficial?',
            answer: 'Sí, solo API oficial para operación profesional.',
          },
          {
            question: '¿Puedes integrar con mi CRM?',
            answer: 'Sí, vía API o webhooks del CRM.',
          },
        ],
        keywords: 'whatsapp cloud api, webhook whatsapp, plantillas',
      },
    },
  },
  {
    slug: 'chatbots-e-ia',
    content: {
      pt: {
        title: 'Chatbots e IA',
        summary: 'Chatbots com IA para suporte e vendas com RAG e handoff humano.',
        heroTitle: 'Automação com IA sem perder controle de qualidade',
        heroDescription: 'Arquitetura com guardrails, avaliação e melhoria contínua.',
        steps: [
          'Definição de objetivos do bot.',
          'Base de conhecimento e políticas.',
          'Handoff humano e monitoramento.',
        ],
        deliverables: [
          'Fluxos IA + regras de negócio.',
          'Integração com CRM/FAQ.',
          'Playbook de operação.',
        ],
        faq: [
          {
            question: 'Bot substitui time humano?',
            answer: 'Não. O modelo ideal combina IA e equipe humana.',
          },
          {
            question: 'Você implementa RAG?',
            answer: 'Sim, para reduzir alucinações e melhorar precisão.',
          },
        ],
        keywords: 'chatbot ia, rag, atendimento automatizado',
      },
      en: {
        title: 'Chatbots and AI',
        summary: 'AI chatbots for support and sales with RAG and human handoff.',
        heroTitle: 'AI automation with quality control',
        heroDescription: 'Architecture with guardrails, evaluation and continuous improvement.',
        steps: [
          'Define bot goals.',
          'Knowledge base and policies.',
          'Human handoff and monitoring.',
        ],
        deliverables: [
          'AI + business rules flows.',
          'CRM/FAQ integration.',
          'Operations playbook.',
        ],
        faq: [
          {
            question: 'Can bots replace human teams?',
            answer: 'No. The best model combines AI and humans.',
          },
          {
            question: 'Do you implement RAG?',
            answer: 'Yes, to reduce hallucinations and improve accuracy.',
          },
        ],
        keywords: 'ai chatbot, rag, support automation',
      },
      es: {
        title: 'Chatbots e IA',
        summary: 'Chatbots con IA para soporte y ventas con RAG y handoff humano.',
        heroTitle: 'Automatización con IA y control de calidad',
        heroDescription: 'Arquitectura con guardrails, evaluación y mejora continua.',
        steps: [
          'Definición de objetivos del bot.',
          'Base de conocimiento y políticas.',
          'Handoff humano y monitoreo.',
        ],
        deliverables: [
          'Flujos IA + reglas de negocio.',
          'Integración con CRM/FAQ.',
          'Playbook operativo.',
        ],
        faq: [
          {
            question: '¿El bot reemplaza al equipo humano?',
            answer: 'No. El mejor modelo combina IA y humanos.',
          },
          {
            question: '¿Implementas RAG?',
            answer: 'Sí, para reducir alucinaciones y mejorar precisión.',
          },
        ],
        keywords: 'chatbot ia, rag, automatización atención',
      },
    },
  },
  {
    slug: 'automacao-e-integracoes',
    content: {
      pt: {
        title: 'Automação e Integrações',
        summary: 'Conexão entre APIs, CRM, ERP e marketing para reduzir retrabalho.',
        heroTitle: 'Automação de processos entre sistemas',
        heroDescription: 'Pipelines com controle de erro, rastreabilidade e estabilidade.',
        steps: ['Mapeamento de fluxos atuais.', 'Desenho do fluxo alvo.', 'Implementação com validações.'],
        deliverables: ['Arquitetura documentada.', 'Automações monitoradas.', 'Plano de contingência.'],
        faq: [
          {
            question: 'Quais sistemas você integra?',
            answer: 'CRMs, ERPs, gateways, plataformas de marketing e APIs customizadas.',
          },
          {
            question: 'Como lida com falhas?',
            answer: 'Retries, filas de erro, alertas e rastreabilidade por evento.',
          },
        ],
        keywords: 'automação, integração api, crm erp',
      },
      en: {
        title: 'Automation and Integrations',
        summary: 'Connections across APIs, CRM, ERP and marketing to reduce rework.',
        heroTitle: 'Process automation across systems',
        heroDescription: 'Pipelines with error control, traceability and stability.',
        steps: ['Map current flows.', 'Design target flow.', 'Implement with validations.'],
        deliverables: ['Documented architecture.', 'Monitored automations.', 'Contingency plan.'],
        faq: [
          {
            question: 'Which systems do you integrate?',
            answer: 'CRMs, ERPs, gateways, marketing tools and custom APIs.',
          },
          {
            question: 'How do you handle failures?',
            answer: 'Retries, error queues, alerts and per-event traceability.',
          },
        ],
        keywords: 'automation, api integration, crm erp',
      },
      es: {
        title: 'Automatización e Integraciones',
        summary: 'Conexión entre APIs, CRM, ERP y marketing para reducir retrabajo.',
        heroTitle: 'Automatización de procesos entre sistemas',
        heroDescription: 'Pipelines con control de errores, trazabilidad y estabilidad.',
        steps: ['Mapeo de flujos actuales.', 'Diseño del flujo objetivo.', 'Implementación con validaciones.'],
        deliverables: ['Arquitectura documentada.', 'Automatizaciones monitoreadas.', 'Plan de contingencia.'],
        faq: [
          {
            question: '¿Qué sistemas integras?',
            answer: 'CRMs, ERPs, gateways, herramientas de marketing y APIs custom.',
          },
          {
            question: '¿Cómo manejas fallas?',
            answer: 'Retries, colas de error, alertas y trazabilidad por evento.',
          },
        ],
        keywords: 'automatización, integración api, crm erp',
      },
    },
  },
  {
    slug: 'crm-e-revenue-operations',
    content: {
      pt: {
        title: 'CRM e Revenue Operations',
        summary: 'Estrutura de funil, lead scoring e automações para escalar conversão.',
        heroTitle: 'Operação comercial orientada por dados',
        heroDescription: 'Conexão entre marketing, vendas e atendimento com SLA e governança.',
        steps: ['Mapeamento do funil.', 'Regras de lead routing e SLA.', 'Automações e dashboard.'],
        deliverables: ['Blueprint de funil.', 'Playbook de operação comercial.', 'Matriz de métricas.'],
        faq: [
          {
            question: 'Serve para time pequeno?',
            answer: 'Sim. Começamos pelo fluxo mais crítico e expandimos.',
          },
          {
            question: 'Integra com WhatsApp?',
            answer: 'Sim, conectando entrada, qualificação e distribuição de leads.',
          },
        ],
        keywords: 'crm, revenue operations, lead scoring, funil vendas',
      },
      en: {
        title: 'CRM and Revenue Operations',
        summary: 'Funnel, lead scoring and automation structure to scale conversion.',
        heroTitle: 'Data-driven revenue operations',
        heroDescription: 'Connection between marketing, sales and support with SLA and governance.',
        steps: ['Map current funnel.', 'Set lead routing and SLA rules.', 'Automations and dashboard.'],
        deliverables: ['Funnel blueprint.', 'Commercial operations playbook.', 'Metrics matrix.'],
        faq: [
          {
            question: 'Does this fit small teams?',
            answer: 'Yes. We start with the most critical flow and expand.',
          },
          {
            question: 'Can this integrate with WhatsApp?',
            answer: 'Yes, connecting inbound, qualification and lead distribution.',
          },
        ],
        keywords: 'crm, revenue operations, lead scoring, sales funnel',
      },
      es: {
        title: 'CRM y Revenue Operations',
        summary: 'Estructura de embudo, lead scoring y automatizaciones para escalar conversión.',
        heroTitle: 'Operación comercial orientada por datos',
        heroDescription: 'Conexión entre marketing, ventas y atención con SLA y gobernanza.',
        steps: ['Mapeo del embudo.', 'Reglas de lead routing y SLA.', 'Automatizaciones y dashboard.'],
        deliverables: ['Blueprint del embudo.', 'Playbook comercial.', 'Matriz de métricas.'],
        faq: [
          {
            question: '¿Sirve para equipos pequeños?',
            answer: 'Sí. Iniciamos por el flujo más crítico y luego expandimos.',
          },
          {
            question: '¿Integra con WhatsApp?',
            answer: 'Sí, conectando entrada, calificación y distribución de leads.',
          },
        ],
        keywords: 'crm, revenue operations, lead scoring, embudo ventas',
      },
    },
  },
  {
    slug: 'integracao-erp-e-backoffice',
    content: {
      pt: {
        title: 'Integração ERP e Backoffice',
        summary: 'Sincronização entre ERP, financeiro, estoque e atendimento.',
        heroTitle: 'Backoffice integrado com menos retrabalho',
        heroDescription: 'Conectores com conciliação de dados, logs e operação assistida.',
        steps: ['Mapear entidades e regras.', 'Modelar contratos de integração.', 'Implantar conciliação e alertas.'],
        deliverables: ['Mapa de integração ERP.', 'Conectores homologados.', 'Fluxo de conciliação.'],
        faq: [
          {
            question: 'Integra ERP legado?',
            answer: 'Sim, com camada de adaptação para reduzir risco.',
          },
          {
            question: 'Como evita divergência de dados?',
            answer: 'Idempotência, reconciliação periódica e alarmes em casos críticos.',
          },
        ],
        keywords: 'integração erp, backoffice, conciliação dados',
      },
      en: {
        title: 'ERP and Backoffice Integration',
        summary: 'Synchronization across ERP, finance, inventory and support.',
        heroTitle: 'Integrated backoffice with less rework',
        heroDescription: 'Connectors with data reconciliation, logs and assisted operations.',
        steps: ['Map entities and rules.', 'Model integration contracts.', 'Deploy reconciliation and alerts.'],
        deliverables: ['ERP integration map.', 'Validated connectors.', 'Reconciliation flow.'],
        faq: [
          {
            question: 'Do you integrate legacy ERP?',
            answer: 'Yes, with an adaptation layer to reduce risk.',
          },
          {
            question: 'How do you avoid data mismatch?',
            answer: 'Idempotency, periodic reconciliation and critical alarms.',
          },
        ],
        keywords: 'erp integration, backoffice, data reconciliation',
      },
      es: {
        title: 'Integración ERP y Backoffice',
        summary: 'Sincronización entre ERP, financiero, inventario y atención.',
        heroTitle: 'Backoffice integrado con menos retrabajo',
        heroDescription: 'Conectores con conciliación de datos, logs y operación asistida.',
        steps: ['Mapear entidades y reglas.', 'Modelar contratos de integración.', 'Implantar conciliación y alertas.'],
        deliverables: ['Mapa de integración ERP.', 'Conectores homologados.', 'Flujo de conciliación.'],
        faq: [
          {
            question: '¿Integras ERP legado?',
            answer: 'Sí, con capa de adaptación para reducir riesgo.',
          },
          {
            question: '¿Cómo evitas divergencia de datos?',
            answer: 'Idempotencia, conciliación periódica y alarmas críticas.',
          },
        ],
        keywords: 'integración erp, backoffice, conciliación datos',
      },
    },
  },
  {
    slug: 'observabilidade-e-confiabilidade',
    content: {
      pt: {
        title: 'Observabilidade e Confiabilidade',
        summary: 'SLO, logs, métricas e alertas para integrações críticas.',
        heroTitle: 'Operação previsível com observabilidade prática',
        heroDescription: 'Monitoramento de webhook, filas, workers e APIs com alertas acionáveis.',
        steps: ['Definir SLO e eventos críticos.', 'Padronizar logs e métricas.', 'Implementar alertas e runbooks.'],
        deliverables: ['Dashboard operacional.', 'Alertas com thresholds.', 'Runbooks de resposta.'],
        faq: [
          {
            question: 'Isso vale para produtos menores?',
            answer: 'Sim, o nível de observabilidade é proporcional ao tamanho da operação.',
          },
          {
            question: 'Pode usar stack atual?',
            answer: 'Sim, aproveitando ferramentas existentes e evoluindo por fases.',
          },
        ],
        keywords: 'observabilidade, monitoramento, confiabilidade, alertas',
      },
      en: {
        title: 'Observability and Reliability',
        summary: 'SLO, logs, metrics and alerts for critical integrations.',
        heroTitle: 'Predictable operations with practical observability',
        heroDescription: 'Monitoring for webhook, queues, workers and APIs with actionable alerts.',
        steps: ['Define SLO and critical events.', 'Standardize logs and metrics.', 'Implement alerts and runbooks.'],
        deliverables: ['Operations dashboard.', 'Threshold-based alerts.', 'Incident runbooks.'],
        faq: [
          {
            question: 'Is this useful for smaller products?',
            answer: 'Yes, observability depth should match operation size.',
          },
          {
            question: 'Can we keep current stack?',
            answer: 'Yes, reusing tools and evolving in phases.',
          },
        ],
        keywords: 'observability, monitoring, reliability, alerts',
      },
      es: {
        title: 'Observabilidad y Confiabilidad',
        summary: 'SLO, logs, métricas y alertas para integraciones críticas.',
        heroTitle: 'Operación previsible con observabilidad práctica',
        heroDescription: 'Monitoreo de webhook, colas, workers y APIs con alertas accionables.',
        steps: ['Definir SLO y eventos críticos.', 'Estandarizar logs y métricas.', 'Implementar alertas y runbooks.'],
        deliverables: ['Dashboard operativo.', 'Alertas con thresholds.', 'Runbooks de incidente.'],
        faq: [
          {
            question: '¿Esto sirve para productos pequeños?',
            answer: 'Sí, la profundidad se ajusta al tamaño de la operación.',
          },
          {
            question: '¿Se puede mantener stack actual?',
            answer: 'Sí, reutilizando herramientas y evolucionando por fases.',
          },
        ],
        keywords: 'observabilidad, monitoreo, confiabilidad, alertas',
      },
    },
  },
  {
    slug: 'arquitetura-e-modernizacao-backend',
    content: {
      pt: {
        title: 'Arquitetura e Modernização Backend',
        summary: 'Evolução de legado para arquitetura modular e escalável.',
        heroTitle: 'Modernização por fases sem parar a operação',
        heroDescription: 'Plano técnico com refatoração incremental, testes e observabilidade.',
        steps: ['Assessment técnico.', 'Arquitetura alvo e roadmap.', 'Migração incremental com controle.'],
        deliverables: ['Diagnóstico de riscos.', 'Roadmap de modernização.', 'Guia de evolução contínua.'],
        faq: [
          {
            question: 'Precisa reescrever tudo?',
            answer: 'Não. O foco é migrar por fases com baixo risco.',
          },
          {
            question: 'Como evitar regressão?',
            answer: 'Com testes de contrato, rollout controlado e monitoramento ativo.',
          },
        ],
        keywords: 'arquitetura backend, modernização legado, refatoração',
      },
      en: {
        title: 'Backend Architecture and Modernization',
        summary: 'Legacy evolution to modular and scalable architecture.',
        heroTitle: 'Phased modernization without stopping operations',
        heroDescription: 'Technical plan with incremental refactor, tests and observability.',
        steps: ['Technical assessment.', 'Target architecture and roadmap.', 'Incremental migration with control.'],
        deliverables: ['Risk diagnosis.', 'Modernization roadmap.', 'Continuous evolution guide.'],
        faq: [
          {
            question: 'Do we need a full rewrite?',
            answer: 'No. The focus is phased migration with low risk.',
          },
          {
            question: 'How do you avoid regressions?',
            answer: 'Contract tests, controlled rollout and active monitoring.',
          },
        ],
        keywords: 'backend architecture, legacy modernization, refactor',
      },
      es: {
        title: 'Arquitectura y Modernización Backend',
        summary: 'Evolución de legado hacia arquitectura modular y escalable.',
        heroTitle: 'Modernización por fases sin detener operación',
        heroDescription: 'Plan técnico con refactor incremental, pruebas y observabilidad.',
        steps: ['Assessment técnico.', 'Arquitectura objetivo y roadmap.', 'Migración incremental controlada.'],
        deliverables: ['Diagnóstico de riesgos.', 'Roadmap de modernización.', 'Guía de evolución continua.'],
        faq: [
          {
            question: '¿Hace falta reescribir todo?',
            answer: 'No. El foco es migrar por fases con bajo riesgo.',
          },
          {
            question: '¿Cómo evitar regresiones?',
            answer: 'Con pruebas de contrato, rollout controlado y monitoreo activo.',
          },
        ],
        keywords: 'arquitectura backend, modernización legado, refactor',
      },
    },
  },
];

const buildServicesForLanguage = (language) =>
  serviceDefinitions.map((service) => {
    const localized = service.content[language] || service.content.pt;
    return {
      slug: service.slug,
      title: localized.title,
      summary: localized.summary,
      heroTitle: localized.heroTitle,
      heroDescription: localized.heroDescription,
      steps: localized.steps,
      deliverables: localized.deliverables,
      faq: localized.faq,
      keywords: localized.keywords,
    };
  });

const servicesByLanguage = {
  pt: buildServicesForLanguage('pt'),
  en: buildServicesForLanguage('en'),
  es: buildServicesForLanguage('es'),
};

const getLanguageServices = (language = 'pt') => {
  const locale = toBaseLanguage(language);
  return servicesByLanguage[locale] || servicesByLanguage.pt;
};

export const getServices = (language = 'pt') => getLanguageServices(language);

export const getServiceBySlug = (slug, language = 'pt') =>
  getLanguageServices(language).find((service) => service.slug === slug);
