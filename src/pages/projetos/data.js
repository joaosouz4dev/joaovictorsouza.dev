import { toBaseLanguage } from '../../utils/i18n';

const projectDefinitions = [
  {
    slug: 'wppconnect',
    stack: ['TypeScript', 'Node.js', 'WhatsApp Web', 'Automation'],
    repository: 'https://github.com/wppconnect-team/wppconnect',
    content: {
      pt: {
        title: 'WPPConnect',
        summary:
          'Projeto open-source que mantenho no ecossistema WPPConnect para automacao e integracao com WhatsApp Web.',
      },
      en: {
        title: 'WPPConnect',
        summary:
          'Open-source project I maintain in the WPPConnect ecosystem for WhatsApp Web automation and integration.',
      },
      es: {
        title: 'WPPConnect',
        summary:
          'Proyecto open-source que mantengo en el ecosistema WPPConnect para automatizacion e integracion con WhatsApp Web.',
      },
    },
  },
  {
    slug: 'wppconnect-server',
    stack: ['TypeScript', 'Node.js', 'REST API', 'WhatsApp'],
    repository: 'https://github.com/wppconnect-team/wppconnect-server',
    content: {
      pt: {
        title: 'WPPConnect Server',
        summary:
          'Camada de API/servidor do WPPConnect que mantenho para expor endpoints de mensageria e operacao em producao.',
      },
      en: {
        title: 'WPPConnect Server',
        summary:
          'WPPConnect API/server layer that I maintain to expose messaging endpoints for production operations.',
      },
      es: {
        title: 'WPPConnect Server',
        summary:
          'Capa de API/servidor de WPPConnect que mantengo para exponer endpoints de mensajeria en produccion.',
      },
    },
  },
  {
    slug: 'wppconnect-mobile',
    stack: ['React Native', 'Mobile', 'WhatsApp', 'TypeScript'],
    repository: 'https://github.com/wppconnect-team/mobile',
    content: {
      pt: {
        title: 'WPPConnect Mobile',
        summary:
          'Aplicacao mobile do ecossistema WPPConnect, com suporte operacional e evolucao que mantenho junto ao time.',
      },
      en: {
        title: 'WPPConnect Mobile',
        summary:
          'Mobile application in the WPPConnect ecosystem that I help maintain and evolve with the team.',
      },
      es: {
        title: 'WPPConnect Mobile',
        summary:
          'Aplicacion mobile del ecosistema WPPConnect que mantengo y evoluciono junto al equipo.',
      },
    },
  },
  {
    slug: 'api-prices-webscraping',
    stack: ['Node.js', 'Web Scraping', 'API', 'Data Processing'],
    repository: 'https://github.com/joaosouz4dev/api-prices-webscraping',
    content: {
      pt: {
        title: 'API Prices Webscraping',
        summary:
          'API que mantenho para coleta de precos via web scraping, normalizacao de dados e disponibilizacao para consumo externo.',
      },
      en: {
        title: 'API Prices Webscraping',
        summary:
          'API I maintain for price collection via web scraping, data normalization and external consumption.',
      },
      es: {
        title: 'API Prices Webscraping',
        summary:
          'API que mantengo para recoleccion de precios por web scraping, normalizacion de datos y consumo externo.',
      },
    },
  },
  {
    slug: 'zap-rest-api',
    stack: ['Node.js', 'REST API', 'WhatsApp', 'Automation'],
    repository: 'https://github.com/joaosouz4dev/zap-rest-api',
    content: {
      pt: {
        title: 'Zap REST API',
        summary:
          'Projeto proprio que mantenho para integrar fluxos de WhatsApp via API REST com foco em atendimento e automacao.',
      },
      en: {
        title: 'Zap REST API',
        summary:
          'Project I maintain to integrate WhatsApp flows through REST API focused on support and automation.',
      },
      es: {
        title: 'Zap REST API',
        summary:
          'Proyecto propio que mantengo para integrar flujos de WhatsApp via API REST con foco en atencion y automatizacion.',
      },
    },
  },
  {
    slug: 'zap-bot',
    stack: ['Node.js', 'Bot', 'WhatsApp', 'Automation'],
    repository: 'https://github.com/joaosouz4dev/zap-bot',
    content: {
      pt: {
        title: 'Zap Bot',
        summary:
          'Bot de WhatsApp que mantenho para automacao de conversas, roteamento de mensagens e aceleracao de operacao.',
      },
      en: {
        title: 'Zap Bot',
        summary:
          'WhatsApp bot that I maintain for conversation automation, message routing and faster operations.',
      },
      es: {
        title: 'Zap Bot',
        summary:
          'Bot de WhatsApp que mantengo para automatizacion de conversaciones y ruteo de mensajes.',
      },
    },
  },
];

const localizeProject = (project, language = 'pt') => {
  const locale = toBaseLanguage(language);
  const localized = project.content[locale] || project.content.pt;
  const fallback = project.content.pt;

  return {
    slug: project.slug,
    title: localized.title || fallback.title,
    summary: localized.summary || fallback.summary,
    stack: project.stack,
    repository: project.repository,
  };
};

export const getProjects = (language = 'pt') =>
  projectDefinitions.map((project) => localizeProject(project, language));

export const getProjectBySlug = (slug, language = 'pt') =>
  getProjects(language).find((project) => project.slug === slug);

export const projects = getProjects('pt');
