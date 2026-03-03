export const services = [
  {
    slug: 'meta-ads-e-integracoes',
    title: 'Meta Ads e Integracoes (Pixel + CAPI)',
    summary:
      'Implementacao de mensuracao server-side para melhorar atribuicao, confiabilidade de eventos e tomada de decisao em campanhas.',
    heroTitle: 'Especialista em Integracoes Meta Pixel e Conversions API',
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
];

export const getServiceBySlug = (slug) =>
  services.find((service) => service.slug === slug);
