export const projects = [
  {
    slug: 'wppconnect',
    title: 'WPPConnect',
    summary:
      'Projeto open-source que mantenho no ecossistema WPPConnect para automacao e integracao com WhatsApp Web.',
    stack: ['TypeScript', 'Node.js', 'WhatsApp Web', 'Automation'],
    repository: 'https://github.com/wppconnect-team/wppconnect',
  },
  {
    slug: 'wppconnect-server',
    title: 'WPPConnect Server',
    summary:
      'Camada de API/servidor do WPPConnect que mantenho para expor endpoints de mensageria e operacao em producao.',
    stack: ['TypeScript', 'Node.js', 'REST API', 'WhatsApp'],
    repository: 'https://github.com/wppconnect-team/wppconnect-server',
  },
  {
    slug: 'wppconnect-mobile',
    title: 'WPPConnect Mobile',
    summary:
      'Aplicacao mobile do ecossistema WPPConnect, com suporte operacional e evolucao que mantenho junto ao time.',
    stack: ['React Native', 'Mobile', 'WhatsApp', 'TypeScript'],
    repository: 'https://github.com/wppconnect-team/mobile',
  },
  {
    slug: 'api-prices-webscraping',
    title: 'API Prices Webscraping',
    summary:
      'API que mantenho para coleta de precos via web scraping, normalizacao de dados e disponibilizacao para consumo externo.',
    stack: ['Node.js', 'Web Scraping', 'API', 'Data Processing'],
    repository: 'https://github.com/joaosouz4dev/api-prices-webscraping',
  },
  {
    slug: 'zap-rest-api',
    title: 'Zap REST API',
    summary:
      'Projeto proprio que mantenho para integrar fluxos de WhatsApp via API REST com foco em atendimento e automacao.',
    stack: ['Node.js', 'REST API', 'WhatsApp', 'Automation'],
    repository: 'https://github.com/joaosouz4dev/zap-rest-api',
  },
  {
    slug: 'zap-bot',
    title: 'Zap Bot',
    summary:
      'Bot de WhatsApp que mantenho para automacao de conversas, roteamento de mensagens e aceleracao de operacao.',
    stack: ['Node.js', 'Bot', 'WhatsApp', 'Automation'],
    repository: 'https://github.com/joaosouz4dev/zap-bot',
  },
];

export const getProjectBySlug = (slug) =>
  projects.find((project) => project.slug === slug);
