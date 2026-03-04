import { toBaseLanguage } from '../../utils/i18n';

const servicesByLanguage = {
  pt: [
    {
      slug: 'meta-ads-e-integracoes',
      title: 'Meta Ads e Integracoes (Pixel + CAPI)',
      summary:
        'Implementacao de mensuracao server-side para melhorar atribuicao, confiabilidade de eventos e tomada de decisao em campanhas.',
      heroTitle: 'Especialista em integracoes Meta Pixel e Conversions API',
      heroDescription:
        'Estruturo tracking confiavel para times de marketing e operacao com Pixel + CAPI, deduplicacao de eventos e monitoramento continuo.',
      steps: [
        'Diagnostico de tracking atual (Pixel, GTM, CAPI, qualidade de eventos).',
        'Desenho da arquitetura de coleta client-side e server-side.',
        'Implementacao de eventos com deduplicacao por event_id.',
        'Validacao em Events Manager e ajustes de consistencia.',
        'Entrega de documentacao tecnica e plano de manutencao.',
      ],
      deliverables: [
        'Mapeamento do funil com eventos prioritarios.',
        'Implementacao de Pixel + CAPI com padrao de dados.',
        'Checklist de qualidade de eventos e testes.',
        'Dashboard de acompanhamento operacional.',
      ],
      faq: [
        {
          question: 'Quando usar Pixel e CAPI juntos?',
          answer:
            'Quando voce quer robustez de mensuracao e resiliencia contra bloqueios do navegador. O padrao recomendado e uso combinado com deduplicacao.',
        },
        {
          question: 'A implementacao melhora performance de campanha sozinha?',
          answer:
            'Ela melhora a qualidade dos dados para decisao. Resultado em CPA/ROAS depende tambem de estrategia de midia e criativos.',
        },
        {
          question: 'Integra com e-commerce e CRM?',
          answer:
            'Sim. A arquitetura pode enviar eventos de navegacao, checkout, compra, lead e eventos de CRM.',
        },
      ],
      keywords:
        'meta pixel, conversions api, capi, events manager, integracao meta ads',
    },
    {
      slug: 'whatsapp-cloud-api',
      title: 'WhatsApp Cloud API',
      summary:
        'Integracao completa de WhatsApp Business Platform com webhooks, templates, filas e handoff humano.',
      heroTitle: 'Integracao WhatsApp Cloud API para vendas e atendimento',
      heroDescription:
        'Projeto fluxos de conversa estaveis e escalaveis, com observabilidade e integracao a CRM, ERP e sistemas internos.',
      steps: [
        'Mapeamento de jornadas de atendimento e conversao.',
        'Configuracao de webhook, validacao de assinatura e seguranca.',
        'Implementacao de templates e governanca de conteudo.',
        'Criacao de orquestracao com regras de negocio e fallback.',
        'Integracao com CRM e acompanhamento de metricas operacionais.',
      ],
      deliverables: [
        'Webhook robusto com idempotencia.',
        'Fluxos de bot com handoff humano.',
        'Fila, retry, DLQ e monitoramento.',
        'Plano de deploy e operacao.',
      ],
      faq: [
        {
          question: 'Voce trabalha com API oficial?',
          answer:
            'Sim, a implementacao e focada em WhatsApp Cloud API para operacao profissional com menor risco.',
        },
        {
          question: 'Da para integrar com CRM existente?',
          answer:
            'Sim. Posso integrar com CRM proprietario ou de mercado usando webhooks e APIs.',
        },
        {
          question: 'Existe suporte para alta demanda?',
          answer:
            'Sim, com fila, controle de taxa, retries, observabilidade e processo de operacao.',
        },
      ],
      keywords:
        'whatsapp cloud api, integracao whatsapp, webhook whatsapp, templates whatsapp',
    },
    {
      slug: 'chatbots-e-ia',
      title: 'Chatbots e IA',
      summary:
        'Construcao de chatbots com IA aplicada a suporte e vendas, com RAG, guardrails e handoff para equipe humana.',
      heroTitle: 'Chatbots com IA para atendimento e qualificacao de leads',
      heroDescription:
        'Implemento bots orientados a resultado, com contexto de negocio, seguranca e controle de qualidade das respostas.',
      steps: [
        'Definicao de objetivos operacionais e comerciais do bot.',
        'Estrutura de base de conhecimento e politicas de resposta.',
        'Implementacao de orquestracao IA + regras de negocio.',
        'Configuracao de fallback, handoff e trilha de auditoria.',
        'Ajustes por metricas reais de uso e conversao.',
      ],
      deliverables: [
        'Fluxo de atendimento automatizado com fallback.',
        'Integracao com FAQ, CRM e sistemas internos.',
        'Playbook de operacao e monitoramento.',
        'Checklist de seguranca e privacidade.',
      ],
      faq: [
        {
          question: 'Bot com IA substitui totalmente o atendimento humano?',
          answer:
            'Nao. O melhor modelo e colaborativo: IA resolve o repetitivo e humano trata casos sensiveis ou complexos.',
        },
        {
          question: 'Voce implementa RAG?',
          answer:
            'Sim. RAG e usado para reduzir respostas inventadas e aumentar precisao em consultas de base interna.',
        },
        {
          question: 'Como medir resultado do bot?',
          answer:
            'Uso metricas como containment rate, tempo medio, CSAT e conversao por etapa.',
        },
      ],
      keywords: 'chatbot com ia, rag, bot whatsapp, automacao atendimento',
    },
    {
      slug: 'automacao-e-integracoes',
      title: 'Automacao e Integracoes',
      summary:
        'Integro APIs, CRM, ERP e plataformas de marketing para eliminar retrabalho e acelerar operacoes.',
      heroTitle: 'Automacao de processos e integracao entre sistemas',
      heroDescription:
        'Desenvolvo pipelines de integracao com confiabilidade, controle de erros e visibilidade operacional.',
      steps: [
        'Levantamento dos fluxos atuais e gargalos de operacao.',
        'Desenho do fluxo alvo entre sistemas e eventos.',
        'Implementacao de conectores, validacoes e observabilidade.',
        'Homologacao com equipe e plano de rollout.',
        'Treinamento tecnico e acompanhamento inicial.',
      ],
      deliverables: [
        'Arquitetura de integracao documentada.',
        'Processos automatizados com monitoramento.',
        'Plano de contingencia e suporte operacional.',
        'Melhoria de tempo e qualidade de dados.',
      ],
      faq: [
        {
          question: 'Quais sistemas voce integra?',
          answer:
            'CRMs, ERPs, gateways, plataformas de marketing e APIs proprietarias, conforme o cenario do cliente.',
        },
        {
          question: 'Como voce trata falhas de integracao?',
          answer:
            'Com retries, fila de erro, alertas e rastreabilidade por evento.',
        },
        {
          question: 'Pode comecar pequeno e evoluir?',
          answer:
            'Sim. Costumo iniciar por um fluxo critico e expandir em ondas.',
        },
      ],
      keywords:
        'automacao de processos, integracao crm erp, integracao api, desenvolvimento integracoes',
    },
  ],
  en: [
    {
      slug: 'meta-ads-e-integracoes',
      title: 'Meta Ads and Integrations (Pixel + CAPI)',
      summary:
        'Server-side measurement implementation to improve attribution, event reliability and decision-making in campaigns.',
      heroTitle: 'Specialist in Meta Pixel and Conversions API integrations',
      heroDescription:
        'I build reliable tracking for marketing and operations teams using Pixel + CAPI, event deduplication and continuous monitoring.',
      steps: [
        'Current tracking diagnosis (Pixel, GTM, CAPI, event quality).',
        'Client-side and server-side collection architecture design.',
        'Event implementation with event_id deduplication.',
        'Validation in Events Manager and consistency adjustments.',
        'Technical documentation delivery and maintenance plan.',
      ],
      deliverables: [
        'Funnel mapping with priority events.',
        'Pixel + CAPI implementation with a data standard.',
        'Event quality checklist and tests.',
        'Operational monitoring dashboard.',
      ],
      faq: [
        {
          question: 'When should I use Pixel and CAPI together?',
          answer:
            'When you need stronger measurement and resilience against browser restrictions. The recommended standard is combined usage with deduplication.',
        },
        {
          question: 'Does implementation alone improve campaign performance?',
          answer:
            'It improves data quality for decision-making. CPA/ROAS outcomes also depend on media strategy and creative quality.',
        },
        {
          question: 'Can it integrate with e-commerce and CRM?',
          answer:
            'Yes. The architecture can send browsing, checkout, purchase, lead and CRM events.',
        },
      ],
      keywords:
        'meta pixel, conversions api, capi, events manager, meta ads integration',
    },
    {
      slug: 'whatsapp-cloud-api',
      title: 'WhatsApp Cloud API',
      summary:
        'Complete WhatsApp Business Platform integration with webhooks, templates, queues and human handoff.',
      heroTitle: 'WhatsApp Cloud API integration for sales and support',
      heroDescription:
        'I design stable and scalable conversation flows with observability and integration to CRM, ERP and internal systems.',
      steps: [
        'Mapping customer support and conversion journeys.',
        'Webhook setup, signature validation and security controls.',
        'Template implementation and content governance.',
        'Orchestration with business rules and fallback.',
        'CRM integration and operational metric tracking.',
      ],
      deliverables: [
        'Robust webhook with idempotency.',
        'Bot flows with human handoff.',
        'Queue, retry, DLQ and monitoring.',
        'Deployment and operations plan.',
      ],
      faq: [
        {
          question: 'Do you work with the official API?',
          answer:
            'Yes. Implementation is focused on WhatsApp Cloud API for professional operations with lower risk.',
        },
        {
          question: 'Can you integrate with an existing CRM?',
          answer:
            'Yes. I can integrate with custom or market CRMs using webhooks and APIs.',
        },
        {
          question: 'Is there support for high demand?',
          answer:
            'Yes, with queues, rate control, retries, observability and operational processes.',
        },
      ],
      keywords:
        'whatsapp cloud api, whatsapp integration, whatsapp webhook, whatsapp templates',
    },
    {
      slug: 'chatbots-e-ia',
      title: 'Chatbots and AI',
      summary:
        'AI chatbot development for support and sales, with RAG, guardrails and handoff to the human team.',
      heroTitle: 'AI chatbots for support and lead qualification',
      heroDescription:
        'I implement result-oriented bots with business context, security and response quality control.',
      steps: [
        'Definition of operational and commercial bot goals.',
        'Knowledge base structure and response policies.',
        'AI orchestration + business rule implementation.',
        'Fallback, handoff and audit trail setup.',
        'Adjustments based on real usage and conversion metrics.',
      ],
      deliverables: [
        'Automated support flow with fallback.',
        'Integration with FAQ, CRM and internal systems.',
        'Operations and monitoring playbook.',
        'Security and privacy checklist.',
      ],
      faq: [
        {
          question: 'Can AI bots fully replace human support?',
          answer:
            'No. The best model is collaborative: AI handles repetitive tasks while humans handle sensitive or complex cases.',
        },
        {
          question: 'Do you implement RAG?',
          answer:
            'Yes. RAG is used to reduce hallucinations and improve precision for internal knowledge queries.',
        },
        {
          question: 'How do you measure bot results?',
          answer:
            'I track metrics such as containment rate, average handling time, CSAT and conversion by stage.',
        },
      ],
      keywords: 'ai chatbot, rag, whatsapp bot, support automation',
    },
    {
      slug: 'automacao-e-integracoes',
      title: 'Automation and Integrations',
      summary:
        'I integrate APIs, CRM, ERP and marketing platforms to eliminate rework and accelerate operations.',
      heroTitle: 'Process automation and system integration',
      heroDescription:
        'I build reliable integration pipelines with error control and operational visibility.',
      steps: [
        'Assessment of current flows and operational bottlenecks.',
        'Design of target flow between systems and events.',
        'Connector, validation and observability implementation.',
        'Team validation and rollout plan.',
        'Technical training and initial follow-up.',
      ],
      deliverables: [
        'Documented integration architecture.',
        'Automated processes with monitoring.',
        'Contingency plan and operational support.',
        'Improved speed and data quality.',
      ],
      faq: [
        {
          question: 'Which systems do you integrate?',
          answer:
            'CRMs, ERPs, gateways, marketing platforms and custom APIs, according to the client scenario.',
        },
        {
          question: 'How do you handle integration failures?',
          answer:
            'With retries, error queues, alerts and per-event traceability.',
        },
        {
          question: 'Can we start small and evolve?',
          answer:
            'Yes. I usually start with a critical flow and expand in waves.',
        },
      ],
      keywords:
        'process automation, crm erp integration, api integration, integration development',
    },
  ],
  es: [
    {
      slug: 'meta-ads-e-integracoes',
      title: 'Meta Ads e Integraciones (Pixel + CAPI)',
      summary:
        'Implementación de medición server-side para mejorar atribución, confiabilidad de eventos y toma de decisiones en campañas.',
      heroTitle: 'Especialista en integraciones de Meta Pixel y Conversions API',
      heroDescription:
        'Estructuro tracking confiable para equipos de marketing y operación con Pixel + CAPI, deduplicación de eventos y monitoreo continuo.',
      steps: [
        'Diagnóstico del tracking actual (Pixel, GTM, CAPI, calidad de eventos).',
        'Diseño de arquitectura de recolección client-side y server-side.',
        'Implementación de eventos con deduplicación por event_id.',
        'Validación en Events Manager y ajustes de consistencia.',
        'Entrega de documentación técnica y plan de mantenimiento.',
      ],
      deliverables: [
        'Mapeo del embudo con eventos prioritarios.',
        'Implementación de Pixel + CAPI con estándar de datos.',
        'Checklist de calidad de eventos y pruebas.',
        'Dashboard de seguimiento operativo.',
      ],
      faq: [
        {
          question: '¿Cuándo usar Pixel y CAPI juntos?',
          answer:
            'Cuando quieres más robustez de medición y resiliencia frente a bloqueos del navegador. El estándar recomendado es uso combinado con deduplicación.',
        },
        {
          question: '¿La implementación mejora por sí sola la performance?',
          answer:
            'Mejora la calidad de datos para decidir. El resultado en CPA/ROAS también depende de estrategia de medios y creatividades.',
        },
        {
          question: '¿Integra con e-commerce y CRM?',
          answer:
            'Sí. La arquitectura puede enviar eventos de navegación, checkout, compra, lead y eventos de CRM.',
        },
      ],
      keywords:
        'meta pixel, conversions api, capi, events manager, integracion meta ads',
    },
    {
      slug: 'whatsapp-cloud-api',
      title: 'WhatsApp Cloud API',
      summary:
        'Integración completa de WhatsApp Business Platform con webhooks, plantillas, colas y handoff humano.',
      heroTitle: 'Integración de WhatsApp Cloud API para ventas y atención',
      heroDescription:
        'Diseño flujos de conversación estables y escalables, con observabilidad e integración a CRM, ERP y sistemas internos.',
      steps: [
        'Mapeo de jornadas de atención y conversión.',
        'Configuración de webhook, validación de firma y seguridad.',
        'Implementación de plantillas y gobernanza de contenido.',
        'Orquestación con reglas de negocio y fallback.',
        'Integración con CRM y seguimiento de métricas operativas.',
      ],
      deliverables: [
        'Webhook robusto con idempotencia.',
        'Flujos de bot con handoff humano.',
        'Cola, retry, DLQ y monitoreo.',
        'Plan de despliegue y operación.',
      ],
      faq: [
        {
          question: '¿Trabajas con API oficial?',
          answer:
            'Sí. La implementación está enfocada en WhatsApp Cloud API para operación profesional con menor riesgo.',
        },
        {
          question: '¿Se puede integrar con CRM existente?',
          answer:
            'Sí. Puedo integrar con CRM propio o de mercado usando webhooks y APIs.',
        },
        {
          question: '¿Hay soporte para alta demanda?',
          answer:
            'Sí, con colas, control de tasa, retries, observabilidad y proceso operativo.',
        },
      ],
      keywords:
        'whatsapp cloud api, integracion whatsapp, webhook whatsapp, templates whatsapp',
    },
    {
      slug: 'chatbots-e-ia',
      title: 'Chatbots e IA',
      summary:
        'Construcción de chatbots con IA aplicada a soporte y ventas, con RAG, guardrails y handoff al equipo humano.',
      heroTitle: 'Chatbots con IA para atención y calificación de leads',
      heroDescription:
        'Implemento bots orientados a resultado, con contexto de negocio, seguridad y control de calidad de respuestas.',
      steps: [
        'Definición de objetivos operativos y comerciales del bot.',
        'Estructura de base de conocimiento y políticas de respuesta.',
        'Implementación de orquestación IA + reglas de negocio.',
        'Configuración de fallback, handoff y trazabilidad de auditoría.',
        'Ajustes según métricas reales de uso y conversión.',
      ],
      deliverables: [
        'Flujo de atención automatizado con fallback.',
        'Integración con FAQ, CRM y sistemas internos.',
        'Playbook de operación y monitoreo.',
        'Checklist de seguridad y privacidad.',
      ],
      faq: [
        {
          question: '¿La IA reemplaza totalmente la atención humana?',
          answer:
            'No. El mejor modelo es colaborativo: la IA resuelve lo repetitivo y el humano atiende casos sensibles o complejos.',
        },
        {
          question: '¿Implementas RAG?',
          answer:
            'Sí. RAG se usa para reducir respuestas inventadas y aumentar precisión en consultas de base interna.',
        },
        {
          question: '¿Cómo mides resultados del bot?',
          answer:
            'Uso métricas como containment rate, tiempo promedio, CSAT y conversión por etapa.',
        },
      ],
      keywords: 'chatbot con ia, rag, bot whatsapp, automatizacion atencion',
    },
    {
      slug: 'automacao-e-integracoes',
      title: 'Automatización e Integraciones',
      summary:
        'Integro APIs, CRM, ERP y plataformas de marketing para eliminar retrabajo y acelerar operaciones.',
      heroTitle: 'Automatización de procesos e integración entre sistemas',
      heroDescription:
        'Desarrollo pipelines de integración con confiabilidad, control de errores y visibilidad operativa.',
      steps: [
        'Levantamiento de flujos actuales y cuellos de botella de operación.',
        'Diseño del flujo objetivo entre sistemas y eventos.',
        'Implementación de conectores, validaciones y observabilidad.',
        'Homologación con el equipo y plan de rollout.',
        'Capacitación técnica y acompañamiento inicial.',
      ],
      deliverables: [
        'Arquitectura de integración documentada.',
        'Procesos automatizados con monitoreo.',
        'Plan de contingencia y soporte operativo.',
        'Mejora de tiempo y calidad de datos.',
      ],
      faq: [
        {
          question: '¿Qué sistemas integras?',
          answer:
            'CRMs, ERPs, gateways, plataformas de marketing y APIs propietarias, según el escenario del cliente.',
        },
        {
          question: '¿Cómo tratas fallas de integración?',
          answer:
            'Con retries, cola de error, alertas y trazabilidad por evento.',
        },
        {
          question: '¿Se puede empezar pequeño y evolucionar?',
          answer:
            'Sí. Suelo iniciar por un flujo crítico y expandir por etapas.',
        },
      ],
      keywords:
        'automatizacion de procesos, integracion crm erp, integracion api, desarrollo integraciones',
    },
  ],
};

const getLanguageServices = (language = 'pt') => {
  const locale = toBaseLanguage(language);
  return servicesByLanguage[locale] || servicesByLanguage.pt;
};

export const getServices = (language = 'pt') => getLanguageServices(language);

export const getServiceBySlug = (slug, language = 'pt') =>
  getLanguageServices(language).find((service) => service.slug === slug);

