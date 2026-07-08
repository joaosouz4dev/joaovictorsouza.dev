import { toBaseLanguage } from '../../utils/i18n.js';
import { getPostContentBySlug } from './posts/index.js';

const publishedPostDefinitions = [
  {
    slug: 'observabilidade-llm-tracing-custo-qualidade',
    date: '2026-07-08',
    readTime: '13 min',
    keywords: {
      pt: 'observabilidade de llm, tracing de llm, custo de tokens, qualidade de llm, llm como juiz, span, latencia, redacao de dados, alertas, anthropic',
      en: 'llm observability, llm tracing, token cost, llm quality, llm as judge, span, latency, data redaction, alerts, anthropic',
      es: 'observabilidad de llm, tracing de llm, costo de tokens, calidad de llm, llm como juez, span, latencia, redaccion de datos, alertas, anthropic',
    },
    content: {
      pt: {
        title: 'Observabilidade de LLM: tracing, custo e qualidade',
        excerpt:
          'Por que os tres pilares tradicionais nao bastam para LLM: latencia, custo e qualidade precisam ser observados juntos. Tracing por fase, custo por chamada, sinais de qualidade sem gabarito, log com redacao e alertas com contexto.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'LLM observability: tracing, cost and quality',
        excerpt:
          'Why the three classic pillars are not enough for LLMs: latency, cost and quality must be observed together. Per-phase tracing, per-call cost, quality signals without ground truth, redacted logging and alerts with context.',
        category: 'Applied AI',
      },
      es: {
        title: 'Observabilidad de LLM: tracing, costo y calidad',
        excerpt:
          'Por que los tres pilares clasicos no bastan para LLM: latencia, costo y calidad hay que observarlos juntos. Tracing por fase, costo por llamada, senales de calidad sin gabarito, log con redaccion y alertas con contexto.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'function-calling-vs-rag-dados-tempo-real',
    date: '2026-07-07',
    readTime: '12 min',
    keywords: {
      pt: 'function calling, tool use, rag, dados em tempo real, dado vivo, consulta ao vivo, roteamento por intencao, chatbot ia, anthropic',
      en: 'function calling, tool use, rag, real-time data, live data, live query, intent routing, ai chatbot, anthropic',
      es: 'function calling, tool use, rag, datos en tiempo real, dato vivo, consulta en vivo, ruteo por intencion, chatbot ia, anthropic',
    },
    content: {
      pt: {
        title: 'Function calling vs RAG para dados em tempo real',
        excerpt:
          'Por que RAG alucina status de pedido e saldo: retrieval e para dado estatico, function calling e para dado vivo. Comparacao por natureza do dado, exemplo real de tool use e roteamento por intencao.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Function calling vs RAG for real-time data',
        excerpt:
          'Why RAG hallucinates order status and balance: retrieval is for static data, function calling is for live data. Comparison by nature of the data, a real tool use example and intent routing.',
        category: 'Applied AI',
      },
      es: {
        title: 'Function calling vs RAG para datos en tiempo real',
        excerpt:
          'Por que RAG alucina estado de pedido y saldo: retrieval es para dato estatico, function calling es para dato vivo. Comparacion por naturaleza del dato, ejemplo real de tool use y ruteo por intencion.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'orquestracao-agentes-ia-producao',
    date: '2026-07-06',
    readTime: '13 min',
    keywords: {
      pt: 'orquestracao de agentes de ia, multi-agente, supervisor, estado duravel, tool runner, retry, guardrails, tracing de llm, producao',
      en: 'ai agent orchestration, multi-agent, supervisor, durable state, tool runner, retry, guardrails, llm tracing, production',
      es: 'orquestacion de agentes de ia, multi-agente, supervisor, estado durable, tool runner, retry, guardrails, tracing de llm, produccion',
    },
    content: {
      pt: {
        title: 'Orquestração de agentes de IA em produção',
        excerpt:
          'Como sair do agente único para uma orquestração confiável: padrões de coordenação, estado durável para retomar, tools blindadas com retry, guardrails de custo e tracing por passo.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Orchestrating AI agents in production',
        excerpt:
          'How to move from a single agent to a reliable orchestration: coordination patterns, durable state to resume, armored tools with retry, cost guardrails and per-step tracing.',
        category: 'Applied AI',
      },
      es: {
        title: 'Orquestacion de agentes de IA en produccion',
        excerpt:
          'Como pasar del agente unico a una orquestacion confiable: patrones de coordinacion, estado durable para retomar, tools blindadas con retry, guardrails de costo y tracing por paso.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'feature-store-personalizacao-atendimento',
    date: '2026-07-04',
    readTime: '12 min',
    keywords: {
      pt: 'feature store, personalizacao de atendimento, training-serving skew, point-in-time correctness, feature online, mlops, redis',
      en: 'feature store, support personalization, training-serving skew, point-in-time correctness, online feature, mlops, redis',
      es: 'feature store, personalizacion de atencion, training-serving skew, point-in-time correctness, feature online, mlops, redis',
    },
    content: {
      pt: {
        title: 'Feature store para personalização de atendimento',
        excerpt:
          'Como eliminar o training-serving skew na personalização de atendimento: registro único de features, serving online de baixa latência, point-in-time correctness no treino e a mesma transformação em treino e inferência.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Feature store for support personalization',
        excerpt:
          'How to eliminate training-serving skew in support personalization: a single feature registry, low-latency online serving, point-in-time correctness in training and the same transformation in training and inference.',
        category: 'Applied AI',
      },
      es: {
        title: 'Feature store para personalizacion de atencion',
        excerpt:
          'Como eliminar el training-serving skew en la personalizacion de atencion: registro unico de features, serving online de baja latencia, point-in-time correctness en el entrenamiento y la misma transformacion en entrenamiento e inferencia.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'avaliacao-continua-bots-eval-automatico',
    date: '2026-07-03',
    readTime: '13 min',
    keywords: {
      pt: 'avaliacao continua de bots, eval de llm, llm como juiz, gate de regressao, dataset de eval, ci, testes de bot ia',
      en: 'continuous bot evaluation, llm eval, llm as judge, regression gate, eval dataset, ci, ai bot testing',
      es: 'evaluacion continua de bots, eval de llm, llm como juez, gate de regresion, dataset de eval, ci, pruebas de bot ia',
    },
    content: {
      pt: {
        title: 'Avaliação contínua de bots: do eval manual ao automático',
        excerpt:
          'Como sair do eval manual e subjetivo para um harness automático: dataset versionado, métricas por tipo de caso, LLM como juiz calibrado e gate de regressão no CI.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Continuous bot evaluation: from manual to automated eval',
        excerpt:
          'How to move from manual, subjective eval to an automated harness: versioned dataset, metrics per case type, calibrated LLM judge and a regression gate in CI.',
        category: 'Applied AI',
      },
      es: {
        title: 'Evaluacion continua de bots: del eval manual al automatico',
        excerpt:
          'Como pasar del eval manual y subjetivo a un harness automatico: dataset versionado, metricas por tipo de caso, LLM como juez calibrado y gate de regresion en el CI.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'camera-virtual-blur-auto-framing-mediapipe',
    date: '2026-06-22',
    readTime: '12 min',
    keywords: {
      pt: 'camera virtual, blur de fundo, auto-framing, mediapipe, nvidia broadcast alternativa, pyvirtualcam, opencv, python',
      en: 'virtual camera, background blur, auto-framing, mediapipe, nvidia broadcast alternative, pyvirtualcam, opencv, python',
      es: 'camara virtual, blur de fondo, auto-framing, mediapipe, alternativa nvidia broadcast, pyvirtualcam, opencv, python',
    },
    content: {
      pt: {
        title: 'Minha câmera virtual com blur e auto-framing: um NVIDIA Broadcast só para a câmera',
        excerpt:
          'Como construí em Python um app de webcam com blur de fundo e auto-framing via MediaPipe, exposto como câmera virtual, sem mexer no áudio e iniciando minimizado.',
        category: 'Visão Computacional',
      },
      en: {
        title: 'My virtual camera with blur and auto-framing: an NVIDIA Broadcast just for the camera',
        excerpt:
          'How I built a Python webcam app with background blur and auto-framing via MediaPipe, exposed as a virtual camera, without touching audio and starting minimized.',
        category: 'Computer Vision',
      },
      es: {
        title: 'Mi camara virtual con blur y auto-framing: un NVIDIA Broadcast solo para la camara',
        excerpt:
          'Como construi en Python una app de webcam con blur de fondo y auto-framing via MediaPipe, expuesta como camara virtual, sin tocar el audio e iniciando minimizada.',
        category: 'Vision Computacional',
      },
    },
  },
  {
    slug: 'cag-vs-rag-cache-contexto',
    date: '2026-06-16',
    readTime: '11 min',
    keywords: {
      pt: 'cag, rag, cache de contexto, prompt cache, retrieval, kv cache',
      en: 'cag, rag, context cache, prompt cache, retrieval, kv cache',
      es: 'cag, rag, cache de contexto, prompt cache, retrieval, kv cache',
    },
    content: {
      pt: {
        title: 'CAG x RAG: quando cache de contexto vence retrieval',
        excerpt:
          'Comparação prática entre Cache-Augmented Generation e RAG: latência, custo, frescor do dado e quando usar cada um.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'CAG vs RAG: when context cache beats retrieval',
        excerpt:
          'Practical comparison between Cache-Augmented Generation and RAG: latency, cost, data freshness and when to use each.',
        category: 'Applied AI',
      },
      es: {
        title: 'CAG vs RAG: cuando el cache de contexto le gana al retrieval',
        excerpt:
          'Comparacion practica entre Cache-Augmented Generation y RAG: latencia, costo, frescura del dato y cuando usar cada uno.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'chamadas-voz-whatsapp-baileys-caller',
    date: '2026-06-16',
    readTime: '10 min',
    keywords: {
      pt: 'baileys, baileys-caller, chamada de voz whatsapp, whatsapp web, nao oficial',
      en: 'baileys, baileys-caller, whatsapp voice call, whatsapp web, unofficial',
      es: 'baileys, baileys-caller, llamada de voz whatsapp, whatsapp web, no oficial',
    },
    content: {
      pt: {
        title: 'Chamadas de voz no WhatsApp com baileys-caller',
        excerpt:
          'Como originar chamadas de voz no WhatsApp via Baileys, os trade-offs frente à Cloud API oficial e como mitigar o risco.',
        category: 'WhatsApp Avançado',
      },
      en: {
        title: 'WhatsApp voice calls with baileys-caller',
        excerpt:
          'How to originate WhatsApp voice calls via Baileys, the trade-offs versus the official Cloud API and how to mitigate risk.',
        category: 'Advanced WhatsApp',
      },
      es: {
        title: 'Llamadas de voz en WhatsApp con baileys-caller',
        excerpt:
          'Como originar llamadas de voz en WhatsApp via Baileys, los trade-offs frente a la Cloud API oficial y como mitigar el riesgo.',
        category: 'WhatsApp Avanzado',
      },
    },
  },
  {
    slug: 'fila-picos-campanha-whatsapp',
    date: '2026-06-16',
    readTime: '12 min',
    keywords: {
      pt: 'fila whatsapp, picos de campanha, rate limit, backpressure, redis',
      en: 'whatsapp queue, campaign peaks, rate limit, backpressure, redis',
      es: 'cola whatsapp, picos de campana, rate limit, backpressure, redis',
    },
    content: {
      pt: {
        title: 'Arquitetura de fila para picos de campanha no WhatsApp',
        excerpt:
          'Como dimensionar fila, rate limit e backpressure para suportar disparos em massa sem bloqueio nem perda de mensagem.',
        category: 'Arquitetura Backend',
      },
      en: {
        title: 'Queue architecture for WhatsApp campaign peaks',
        excerpt:
          'How to size queue, rate limit and backpressure to handle mass sends without blocks or lost messages.',
        category: 'Backend Architecture',
      },
      es: {
        title: 'Arquitectura de colas para picos de campana en WhatsApp',
        excerpt:
          'Como dimensionar cola, rate limit y backpressure para soportar envios masivos sin bloqueos ni perdida de mensajes.',
        category: 'Arquitectura Backend',
      },
    },
  },
  {
    slug: 'slas-atendimento-bot-humano',
    date: '2026-06-16',
    readTime: '10 min',
    keywords: {
      pt: 'sla atendimento, bot humano, fila de atendimento, first response time',
      en: 'support sla, bot human, support queue, first response time',
      es: 'sla atencion, bot humano, cola de atencion, first response time',
    },
    content: {
      pt: {
        title: 'Como desenhar SLAs de atendimento com bot + humano',
        excerpt:
          'Modelo de SLA por estágio, priorização de fila e métricas para medir bot e humano sem cobrar o time pelo que não controla.',
        category: 'Operação',
      },
      en: {
        title: 'How to design support SLAs with bot + human team',
        excerpt:
          'SLA model by stage, queue prioritization and metrics to measure bot and human without blaming the team for what they do not control.',
        category: 'Operations',
      },
      es: {
        title: 'Como disenar SLAs de atencion con bot + equipo humano',
        excerpt:
          'Modelo de SLA por etapa, priorizacion de cola y metricas para medir bot y humano sin culpar al equipo por lo que no controla.',
        category: 'Operacion',
      },
    },
  },
  {
    slug: 'governanca-templates-times-grandes',
    date: '2026-06-16',
    readTime: '11 min',
    keywords: {
      pt: 'governanca templates whatsapp, versionamento, aprovacao meta, namespace',
      en: 'whatsapp template governance, versioning, meta approval, namespace',
      es: 'gobernanza plantillas whatsapp, versionado, aprobacion meta, namespace',
    },
    content: {
      pt: {
        title: 'Governança de templates em times grandes',
        excerpt:
          'Como versionar, aprovar e medir templates de WhatsApp quando vários times disputam o mesmo namespace.',
        category: 'Operação',
      },
      en: {
        title: 'Template governance in large teams',
        excerpt:
          'How to version, approve and measure WhatsApp templates when several teams compete for the same namespace.',
        category: 'Operations',
      },
      es: {
        title: 'Gobernanza de plantillas en equipos grandes',
        excerpt:
          'Como versionar, aprobar y medir plantillas de WhatsApp cuando varios equipos compiten por el mismo namespace.',
        category: 'Operacion',
      },
    },
  },
  {
    slug: 'integracao-erp-crm-sem-retrabalho',
    date: '2026-06-16',
    readTime: '12 min',
    keywords: {
      pt: 'integracao erp crm, sincronizacao, idempotencia, fonte da verdade',
      en: 'erp crm integration, synchronization, idempotency, source of truth',
      es: 'integracion erp crm, sincronizacion, idempotencia, fuente de verdad',
    },
    content: {
      pt: {
        title: 'Integração ERP + CRM sem retrabalho operacional',
        excerpt:
          'Padrões de sincronização, fonte da verdade e idempotência para ligar ERP e CRM sem duplicar dado nem cadastro manual.',
        category: 'Integrações',
      },
      en: {
        title: 'ERP + CRM integration without operational rework',
        excerpt:
          'Synchronization patterns, source of truth and idempotency to connect ERP and CRM without duplicate data or manual entry.',
        category: 'Integrations',
      },
      es: {
        title: 'Integracion ERP + CRM sin retrabajo operativo',
        excerpt:
          'Patrones de sincronizacion, fuente de verdad e idempotencia para conectar ERP y CRM sin duplicar datos ni carga manual.',
        category: 'Integraciones',
      },
    },
  },
  {
    slug: 'roi-real-automacao-ia',
    date: '2026-06-16',
    readTime: '9 min',
    keywords: {
      pt: 'roi automacao ia, calculo de retorno, custo operacional, payback',
      en: 'ai automation roi, return calculation, operational cost, payback',
      es: 'roi automatizacion ia, calculo de retorno, costo operativo, payback',
    },
    content: {
      pt: {
        title: 'Como calcular ROI real de automação com IA',
        excerpt:
          'Modelo prático para medir retorno de automação com IA: custo total, ganho por jornada, payback e armadilhas comuns.',
        category: 'Estratégia Técnica',
      },
      en: {
        title: 'How to calculate real ROI from AI automation',
        excerpt:
          'Practical model to measure AI automation return: total cost, gain per journey, payback and common pitfalls.',
        category: 'Technical Strategy',
      },
      es: {
        title: 'Como calcular el ROI real de automatizacion con IA',
        excerpt:
          'Modelo practico para medir retorno de automatizacion con IA: costo total, ganancia por jornada, payback y trampas comunes.',
        category: 'Estrategia Tecnica',
      },
    },
  },

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
          'Arquitetura de produção para integrar WhatsApp Cloud API com webhook seguro, templates, filas e observabilidade.',
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
        title: 'Meta Pixel vs CAPI: arquitetura ideal para dados confiáveis',
        excerpt:
          'Como combinar Pixel e Conversions API com deduplicação para reduzir perda de eventos e melhorar atribuição.',
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
        title: 'Webhook WhatsApp em produção: idempotência, filas e retry',
        excerpt:
          'Padrões técnicos para evitar mensagens duplicadas e manter estabilidade em alto volume de atendimento.',
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
        title: 'RAG para atendimento no WhatsApp: desenho de produção sem alucinação',
        excerpt:
          'Como estruturar base de conhecimento, guardrails e avaliação contínua para bots mais precisos.',
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
        title: 'Monitoramento e alertas em integrações: o mínimo para não apagar incêndio',
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
          'Eventos, etapas e automações recomendadas para ligar atendimento, qualificação e fechamento comercial.',
        category: 'Automação Comercial',
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
        title: 'Checklist de segurança para integrações Meta e WhatsApp',
        excerpt:
          'Boas práticas de assinatura, segregação de credenciais, rate limit e trilha de auditoria.',
        category: 'Segurança',
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
        title: 'Custos na WhatsApp Cloud API: como otimizar sem degradar experiência',
        excerpt:
          'Regras práticas para reduzir desperdício de conversas e melhorar taxa de resolução por jornada.',
        category: 'Operação',
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
        title: 'Testes de contrato para webhooks e APIs: reduzindo regressão em integrações',
        excerpt:
          'Estratégia de testes para evitar quebra silenciosa quando parceiros mudam payload ou versão.',
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
          'Padrões para isolamento de clientes, limites por tenant e governança de configurações.',
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
        title: 'Roadmap de 90 dias para automação de atendimento com IA',
        excerpt:
          'Plano em fases para sair do piloto e chegar em operação com métrica, governança e escala.',
        category: 'Estratégia Técnica',
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
    'Guardrails de saída em LLM: validação e recusa segura',
    'Cache semântico para reduzir custo de LLM',
    'Memória de longo prazo para agentes de atendimento',
  ],
  en: [
    'LLM output guardrails: validation and safe refusal',
    'Semantic cache to cut LLM cost',
    'Long-term memory for support agents',
  ],
  es: [
    'Guardrails de salida en LLM: validacion y rechazo seguro',
    'Cache semantico para reducir el costo de LLM',
    'Memoria de largo plazo para agentes de atencion',
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

export const getPostContent = (slug, language = 'pt') =>
  getPostContentBySlug(slug, toBaseLanguage(language));
