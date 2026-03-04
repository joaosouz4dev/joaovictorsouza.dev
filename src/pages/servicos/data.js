import { toBaseLanguage } from '../../utils/i18n';

const serviceDefinitions = [
  {
    slug: 'meta-ads-e-integracoes',
    content: {
      pt: {
        title: 'Meta Ads e Integracoes (Pixel + CAPI)',
        summary: 'Mensuracao server-side com foco em atribuicao e dados confiaveis.',
        heroTitle: 'Implementacao Meta Pixel + Conversions API',
        heroDescription:
          'Arquitetura de tracking com deduplicacao, governanca de eventos e monitoramento.',
        steps: [
          'Diagnostico do tracking atual.',
          'Desenho de arquitetura Pixel + CAPI.',
          'Implementacao, validacao e ajustes.',
        ],
        deliverables: [
          'Mapa de eventos do funil.',
          'Implementacao Pixel + CAPI.',
          'Checklist de qualidade e dashboard.',
        ],
        faq: [
          {
            question: 'Quando usar Pixel e CAPI juntos?',
            answer: 'Quando precisa de resiliencia e menor perda de eventos.',
          },
          {
            question: 'Isso melhora performance sozinho?',
            answer: 'Melhora a qualidade do dado para decisao. Midia e criativo continuam essenciais.',
          },
        ],
        keywords: 'meta pixel, capi, conversions api, mensuracao',
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
        summary: 'Medicion server-side enfocada en atribucion y datos confiables.',
        heroTitle: 'Implementacion Meta Pixel + Conversions API',
        heroDescription:
          'Arquitectura de tracking con deduplicacion, gobernanza de eventos y monitoreo.',
        steps: [
          'Diagnostico del tracking actual.',
          'Diseno de arquitectura Pixel + CAPI.',
          'Implementacion, validacion y ajustes.',
        ],
        deliverables: [
          'Mapa de eventos del embudo.',
          'Implementacion Pixel + CAPI.',
          'Checklist de calidad y dashboard.',
        ],
        faq: [
          {
            question: 'Cuando usar Pixel y CAPI juntos?',
            answer: 'Cuando necesitas mayor resiliencia y menor perdida de eventos.',
          },
          {
            question: 'Esto mejora performance por si solo?',
            answer: 'Mejora la calidad del dato. Medios y creativos siguen siendo clave.',
          },
        ],
        keywords: 'meta pixel, capi, conversions api, medicion',
      },
    },
  },
  {
    slug: 'whatsapp-cloud-api',
    content: {
      pt: {
        title: 'WhatsApp Cloud API',
        summary: 'Integracao oficial com webhook seguro, templates, filas e handoff humano.',
        heroTitle: 'WhatsApp Cloud API para atendimento e vendas',
        heroDescription:
          'Fluxos robustos com idempotencia, observabilidade e integracao a CRM/ERP.',
        steps: [
          'Mapeamento de jornada e casos de uso.',
          'Webhook seguro com idempotencia.',
          'Orquestracao com templates e handoff.',
        ],
        deliverables: [
          'Webhook em producao.',
          'Fluxos de atendimento com fallback.',
          'Integracao com CRM e monitoramento.',
        ],
        faq: [
          {
            question: 'Voce trabalha com API oficial?',
            answer: 'Sim, somente API oficial para operacao profissional.',
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
        summary: 'Integracion oficial con webhook seguro, plantillas, colas y handoff humano.',
        heroTitle: 'WhatsApp Cloud API para atencion y ventas',
        heroDescription: 'Flujos robustos con idempotencia, observabilidad e integracion a CRM/ERP.',
        steps: [
          'Mapeo de jornada y casos de uso.',
          'Webhook seguro con idempotencia.',
          'Orquestacion con plantillas y handoff.',
        ],
        deliverables: [
          'Webhook productivo.',
          'Flujos de atencion con fallback.',
          'Integracion con CRM y monitoreo.',
        ],
        faq: [
          {
            question: 'Trabajas con API oficial?',
            answer: 'Si, solo API oficial para operacion profesional.',
          },
          {
            question: 'Puedes integrar con mi CRM?',
            answer: 'Si, via API o webhooks del CRM.',
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
        heroTitle: 'Automacao com IA sem perder controle de qualidade',
        heroDescription: 'Arquitetura com guardrails, avaliacao e melhoria continua.',
        steps: [
          'Definicao de objetivos do bot.',
          'Base de conhecimento e politicas.',
          'Handoff humano e monitoramento.',
        ],
        deliverables: [
          'Fluxos IA + regras de negocio.',
          'Integracao com CRM/FAQ.',
          'Playbook de operacao.',
        ],
        faq: [
          {
            question: 'Bot substitui time humano?',
            answer: 'Nao. O modelo ideal combina IA e equipe humana.',
          },
          {
            question: 'Voce implementa RAG?',
            answer: 'Sim, para reduzir alucinacoes e melhorar precisao.',
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
        heroTitle: 'Automatizacion con IA y control de calidad',
        heroDescription: 'Arquitectura con guardrails, evaluacion y mejora continua.',
        steps: [
          'Definicion de objetivos del bot.',
          'Base de conocimiento y politicas.',
          'Handoff humano y monitoreo.',
        ],
        deliverables: [
          'Flujos IA + reglas de negocio.',
          'Integracion con CRM/FAQ.',
          'Playbook operativo.',
        ],
        faq: [
          {
            question: 'El bot reemplaza al equipo humano?',
            answer: 'No. El mejor modelo combina IA y humanos.',
          },
          {
            question: 'Implementas RAG?',
            answer: 'Si, para reducir alucinaciones y mejorar precision.',
          },
        ],
        keywords: 'chatbot ia, rag, automatizacion atencion',
      },
    },
  },
  {
    slug: 'automacao-e-integracoes',
    content: {
      pt: {
        title: 'Automacao e Integracoes',
        summary: 'Conexao entre APIs, CRM, ERP e marketing para reduzir retrabalho.',
        heroTitle: 'Automacao de processos entre sistemas',
        heroDescription: 'Pipelines com controle de erro, rastreabilidade e estabilidade.',
        steps: ['Mapeamento de fluxos atuais.', 'Desenho do fluxo alvo.', 'Implementacao com validacoes.'],
        deliverables: ['Arquitetura documentada.', 'Automacoes monitoradas.', 'Plano de contingencia.'],
        faq: [
          {
            question: 'Quais sistemas voce integra?',
            answer: 'CRMs, ERPs, gateways, plataformas de marketing e APIs customizadas.',
          },
          {
            question: 'Como lida com falhas?',
            answer: 'Retries, filas de erro, alertas e rastreabilidade por evento.',
          },
        ],
        keywords: 'automacao, integracao api, crm erp',
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
        title: 'Automatizacion e Integraciones',
        summary: 'Conexion entre APIs, CRM, ERP y marketing para reducir retrabajo.',
        heroTitle: 'Automatizacion de procesos entre sistemas',
        heroDescription: 'Pipelines con control de errores, trazabilidad y estabilidad.',
        steps: ['Mapeo de flujos actuales.', 'Diseno del flujo objetivo.', 'Implementacion con validaciones.'],
        deliverables: ['Arquitectura documentada.', 'Automatizaciones monitoreadas.', 'Plan de contingencia.'],
        faq: [
          {
            question: 'Que sistemas integras?',
            answer: 'CRMs, ERPs, gateways, herramientas de marketing y APIs custom.',
          },
          {
            question: 'Como manejas fallas?',
            answer: 'Retries, colas de error, alertas y trazabilidad por evento.',
          },
        ],
        keywords: 'automatizacion, integracion api, crm erp',
      },
    },
  },
  {
    slug: 'crm-e-revenue-operations',
    content: {
      pt: {
        title: 'CRM e Revenue Operations',
        summary: 'Estrutura de funil, lead scoring e automacoes para escalar conversao.',
        heroTitle: 'Operacao comercial orientada por dados',
        heroDescription: 'Conexao entre marketing, vendas e atendimento com SLA e governanca.',
        steps: ['Mapeamento do funil.', 'Regras de lead routing e SLA.', 'Automacoes e dashboard.'],
        deliverables: ['Blueprint de funil.', 'Playbook de operacao comercial.', 'Matriz de metricas.'],
        faq: [
          {
            question: 'Serve para time pequeno?',
            answer: 'Sim. Comecamos pelo fluxo mais critico e expandimos.',
          },
          {
            question: 'Integra com WhatsApp?',
            answer: 'Sim, conectando entrada, qualificacao e distribuicao de leads.',
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
        summary: 'Estructura de embudo, lead scoring y automatizaciones para escalar conversion.',
        heroTitle: 'Operacion comercial orientada por datos',
        heroDescription: 'Conexion entre marketing, ventas y atencion con SLA y gobernanza.',
        steps: ['Mapeo del embudo.', 'Reglas de lead routing y SLA.', 'Automatizaciones y dashboard.'],
        deliverables: ['Blueprint del embudo.', 'Playbook comercial.', 'Matriz de metricas.'],
        faq: [
          {
            question: 'Sirve para equipos pequenos?',
            answer: 'Si. Iniciamos por el flujo mas critico y luego expandimos.',
          },
          {
            question: 'Integra con WhatsApp?',
            answer: 'Si, conectando entrada, calificacion y distribucion de leads.',
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
        title: 'Integracao ERP e Backoffice',
        summary: 'Sincronizacao entre ERP, financeiro, estoque e atendimento.',
        heroTitle: 'Backoffice integrado com menos retrabalho',
        heroDescription: 'Conectores com conciliacao de dados, logs e operacao assistida.',
        steps: ['Mapear entidades e regras.', 'Modelar contratos de integracao.', 'Implantar conciliacao e alertas.'],
        deliverables: ['Mapa de integracao ERP.', 'Conectores homologados.', 'Fluxo de conciliacao.'],
        faq: [
          {
            question: 'Integra ERP legado?',
            answer: 'Sim, com camada de adaptacao para reduzir risco.',
          },
          {
            question: 'Como evita divergencia de dados?',
            answer: 'Idempotencia, reconciliacao periodica e alarmes em casos criticos.',
          },
        ],
        keywords: 'integracao erp, backoffice, conciliacao dados',
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
        title: 'Integracion ERP y Backoffice',
        summary: 'Sincronizacion entre ERP, financiero, inventario y atencion.',
        heroTitle: 'Backoffice integrado con menos retrabajo',
        heroDescription: 'Conectores con conciliacion de datos, logs y operacion asistida.',
        steps: ['Mapear entidades y reglas.', 'Modelar contratos de integracion.', 'Implantar conciliacion y alertas.'],
        deliverables: ['Mapa de integracion ERP.', 'Conectores homologados.', 'Flujo de conciliacion.'],
        faq: [
          {
            question: 'Integras ERP legado?',
            answer: 'Si, con capa de adaptacion para reducir riesgo.',
          },
          {
            question: 'Como evitas divergencia de datos?',
            answer: 'Idempotencia, conciliacion periodica y alarmas criticas.',
          },
        ],
        keywords: 'integracion erp, backoffice, conciliacion datos',
      },
    },
  },
  {
    slug: 'observabilidade-e-confiabilidade',
    content: {
      pt: {
        title: 'Observabilidade e Confiabilidade',
        summary: 'SLO, logs, metricas e alertas para integracoes criticas.',
        heroTitle: 'Operacao previsivel com observabilidade pratica',
        heroDescription: 'Monitoramento de webhook, filas, workers e APIs com alertas acionaveis.',
        steps: ['Definir SLO e eventos criticos.', 'Padronizar logs e metricas.', 'Implementar alertas e runbooks.'],
        deliverables: ['Dashboard operacional.', 'Alertas com thresholds.', 'Runbooks de resposta.'],
        faq: [
          {
            question: 'Isso vale para produtos menores?',
            answer: 'Sim, o nivel de observabilidade e proporcional ao tamanho da operacao.',
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
        summary: 'SLO, logs, metricas y alertas para integraciones criticas.',
        heroTitle: 'Operacion previsible con observabilidad practica',
        heroDescription: 'Monitoreo de webhook, colas, workers y APIs con alertas accionables.',
        steps: ['Definir SLO y eventos criticos.', 'Estandarizar logs y metricas.', 'Implementar alertas y runbooks.'],
        deliverables: ['Dashboard operativo.', 'Alertas con thresholds.', 'Runbooks de incidente.'],
        faq: [
          {
            question: 'Esto sirve para productos pequenos?',
            answer: 'Si, la profundidad se ajusta al tamano de la operacion.',
          },
          {
            question: 'Se puede mantener stack actual?',
            answer: 'Si, reutilizando herramientas y evolucionando por fases.',
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
        title: 'Arquitetura e Modernizacao Backend',
        summary: 'Evolucao de legado para arquitetura modular e escalavel.',
        heroTitle: 'Modernizacao por fases sem parar a operacao',
        heroDescription: 'Plano tecnico com refatoracao incremental, testes e observabilidade.',
        steps: ['Assessment tecnico.', 'Arquitetura alvo e roadmap.', 'Migracao incremental com controle.'],
        deliverables: ['Diagnostico de riscos.', 'Roadmap de modernizacao.', 'Guia de evolucao continua.'],
        faq: [
          {
            question: 'Precisa reescrever tudo?',
            answer: 'Nao. O foco e migrar por fases com baixo risco.',
          },
          {
            question: 'Como evitar regressao?',
            answer: 'Com testes de contrato, rollout controlado e monitoramento ativo.',
          },
        ],
        keywords: 'arquitetura backend, modernizacao legado, refatoracao',
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
        title: 'Arquitectura y Modernizacion Backend',
        summary: 'Evolucion de legado hacia arquitectura modular y escalable.',
        heroTitle: 'Modernizacion por fases sin detener operacion',
        heroDescription: 'Plan tecnico con refactor incremental, pruebas y observabilidad.',
        steps: ['Assessment tecnico.', 'Arquitectura objetivo y roadmap.', 'Migracion incremental controlada.'],
        deliverables: ['Diagnostico de riesgos.', 'Roadmap de modernizacion.', 'Guia de evolucion continua.'],
        faq: [
          {
            question: 'Hace falta reescribir todo?',
            answer: 'No. El foco es migrar por fases con bajo riesgo.',
          },
          {
            question: 'Como evitar regresiones?',
            answer: 'Con pruebas de contrato, rollout controlado y monitoreo activo.',
          },
        ],
        keywords: 'arquitectura backend, modernizacion legado, refactor',
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
