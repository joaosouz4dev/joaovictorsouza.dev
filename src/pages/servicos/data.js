export const services = [
  {
    slug: 'meta-ads-e-integracoes',
    title: 'Meta Ads e Integrações (Pixel + CAPI)',
    summary:
      'Implementação de mensuração server-side para melhorar atribuição, confiabilidade de eventos e tomada de decisão em campanhas.',
    heroTitle: 'Especialista em integrações Meta Pixel e Conversions API',
    heroDescription:
      'Estruturo tracking confiável para times de marketing e operação com Pixel + CAPI, deduplicação de eventos e monitoramento contínuo.',
    steps: [
      'Diagnóstico de tracking atual (Pixel, GTM, CAPI, qualidade de eventos).',
      'Desenho da arquitetura de coleta client-side e server-side.',
      'Implementação de eventos com deduplicação por event_id.',
      'Validação em Events Manager e ajustes de consistência.',
      'Entrega de documentação técnica e plano de manutenção.',
    ],
    deliverables: [
      'Mapeamento do funil com eventos prioritários.',
      'Implementação de Pixel + CAPI com padrão de dados.',
      'Checklist de qualidade de eventos e testes.',
      'Dashboard de acompanhamento operacional.',
    ],
    faq: [
      {
        question: 'Quando usar Pixel e CAPI juntos?',
        answer:
          'Quando você quer robustez de mensuração e resiliência contra bloqueios do navegador. O padrão recomendado é uso combinado com deduplicação.',
      },
      {
        question: 'A implementação melhora performance de campanha sozinha?',
        answer:
          'Ela melhora a qualidade dos dados para decisão. Resultado em CPA/ROAS depende também de estratégia de mídia e criativos.',
      },
      {
        question: 'Integra com e-commerce e CRM?',
        answer:
          'Sim. A arquitetura pode enviar eventos de navegação, checkout, compra, lead e eventos de CRM.',
      },
    ],
    keywords:
      'meta pixel, conversions api, capi, events manager, integracao meta ads',
  },
  {
    slug: 'whatsapp-cloud-api',
    title: 'WhatsApp Cloud API',
    summary:
      'Integração completa de WhatsApp Business Platform com webhooks, templates, filas e handoff humano.',
    heroTitle: 'Integração WhatsApp Cloud API para vendas e atendimento',
    heroDescription:
      'Projeto fluxos de conversa estáveis e escaláveis, com observabilidade e integração a CRM, ERP e sistemas internos.',
    steps: [
      'Mapeamento de jornadas de atendimento e conversão.',
      'Configuração de webhook, validação de assinatura e segurança.',
      'Implementação de templates e governança de conteúdo.',
      'Criação de orquestração com regras de negócio e fallback.',
      'Integração com CRM e acompanhamento de métricas operacionais.',
    ],
    deliverables: [
      'Webhook robusto com idempotência.',
      'Fluxos de bot com handoff humano.',
      'Fila, retry, DLQ e monitoramento.',
      'Plano de deploy e operacao.',
    ],
    faq: [
      {
        question: 'Voce trabalha com API oficial?',
        answer:
          'Sim, a implementação é focada em WhatsApp Cloud API para operação profissional com menor risco.',
      },
      {
        question: 'Dá para integrar com CRM existente?',
        answer:
          'Sim. Posso integrar com CRM proprietário ou de mercado usando webhooks e APIs.',
      },
      {
        question: 'Existe suporte para alta demanda?',
        answer:
          'Sim, com fila, controle de taxa, retries, observabilidade e processo de operação.',
      },
    ],
    keywords:
      'whatsapp cloud api, integracao whatsapp, webhook whatsapp, templates whatsapp',
  },
  {
    slug: 'chatbots-e-ia',
    title: 'Chatbots e IA',
    summary:
      'Construção de chatbots com IA aplicada a suporte e vendas, com RAG, guardrails e handoff para equipe humana.',
    heroTitle: 'Chatbots com IA para atendimento e qualificação de leads',
    heroDescription:
      'Implemento bots orientados a resultado, com contexto de negócio, segurança e controle de qualidade das respostas.',
    steps: [
      'Definição de objetivos operacionais e comerciais do bot.',
      'Estrutura de base de conhecimento e políticas de resposta.',
      'Implementação de orquestração IA + regras de negócio.',
      'Configuração de fallback, handoff e trilha de auditoria.',
      'Ajustes por métricas reais de uso e conversão.',
    ],
    deliverables: [
      'Fluxo de atendimento automatizado com fallback.',
      'Integração com FAQ, CRM e sistemas internos.',
      'Playbook de operação e monitoramento.',
      'Checklist de segurança e privacidade.',
    ],
    faq: [
      {
        question: 'Bot com IA substitui totalmente o atendimento humano?',
        answer:
          'Não. O melhor modelo é colaborativo: IA resolve o repetitivo e humano trata casos sensíveis ou complexos.',
      },
      {
        question: 'Voce implementa RAG?',
        answer:
          'Sim. RAG é usado para reduzir respostas inventadas e aumentar precisão em consultas de base interna.',
      },
      {
        question: 'Como medir resultado do bot?',
        answer:
          'Uso métricas como containment rate, tempo médio, CSAT e conversão por etapa.',
      },
    ],
    keywords: 'chatbot com ia, rag, bot whatsapp, automacao atendimento',
  },
  {
    slug: 'automacao-e-integracoes',
    title: 'Automação e Integrações',
    summary:
      'Integro APIs, CRM, ERP e plataformas de marketing para eliminar retrabalho e acelerar operações.',
    heroTitle: 'Automação de processos e integração entre sistemas',
    heroDescription:
      'Desenvolvo pipelines de integração com confiabilidade, controle de erros e visibilidade operacional.',
    steps: [
      'Levantamento dos fluxos atuais e gargalos de operação.',
      'Desenho do fluxo alvo entre sistemas e eventos.',
      'Implementação de conectores, validações e observabilidade.',
      'Homologação com equipe e plano de rollout.',
      'Treinamento técnico e acompanhamento inicial.',
    ],
    deliverables: [
      'Arquitetura de integração documentada.',
      'Processos automatizados com monitoramento.',
      'Plano de contingência e suporte operacional.',
      'Melhoria de tempo e qualidade de dados.',
    ],
    faq: [
      {
        question: 'Quais sistemas voce integra?',
        answer:
          'CRMs, ERPs, gateways, plataformas de marketing e APIs proprietárias, conforme o cenário do cliente.',
      },
      {
        question: 'Como você trata falhas de integração?',
        answer:
          'Com retries, fila de erro, alertas e rastreabilidade por evento.',
      },
      {
        question: 'Pode começar pequeno e evoluir?',
        answer:
          'Sim. Costumo iniciar por um fluxo crítico e expandir em ondas.',
      },
    ],
    keywords:
      'automacao de processos, integracao crm erp, integracao api, desenvolvimento integracoes',
  },
];

export const getServiceBySlug = (slug) =>
  services.find((service) => service.slug === slug);
