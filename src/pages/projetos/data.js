export const projects = [
  {
    slug: 'integracao-whatsapp-crm-node-aws',
    title: 'Integracao WhatsApp + CRM com Node.js e AWS',
    summary:
      'Estrutura para sincronizar mensagens, status de atendimento e funil de leads com observabilidade.',
    stack: ['Node.js', 'TypeScript', 'AWS', 'Webhook', 'Queue', 'CRM API'],
    repository: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'mensuracao-meta-capi-server-side',
    title: 'Mensuracao Meta CAPI server-side',
    summary:
      'Implementacao de eventos de funil com deduplicacao, rastreabilidade e qualidade de dados.',
    stack: ['Meta Pixel', 'Conversions API', 'Node.js', 'GTM'],
    repository: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'chatbot-rag-whatsapp',
    title: 'Chatbot com RAG para WhatsApp',
    summary:
      'Prototipo de atendimento com base de conhecimento, fallback e transferencia para humano.',
    stack: ['LLM', 'RAG', 'WhatsApp API', 'Node.js'],
    repository: 'https://github.com/joaosouz4dev',
  },
];

export const getProjectBySlug = (slug) =>
  projects.find((project) => project.slug === slug);
