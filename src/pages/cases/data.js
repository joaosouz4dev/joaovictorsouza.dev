import { toBaseLanguage } from '../../utils/i18n';

const caseDefinitions = [
  {
    slug: 'whatsapp-ia-atendimento',
    stack: ['Node.js', 'WhatsApp Cloud API', 'Queue', 'CRM', 'Observability'],
    coverImage: '/assets/images/new/b-1.webp',
    demoUrl: '/servicos/chatbots-e-ia',
    repoUrl: 'https://github.com/joaosouz4dev',
    content: {
      pt: {
        title: 'Case: WhatsApp + IA para atendimento com handoff inteligente',
        summary:
          'Implementacao de fluxo automatizado com classificacao de intencao, respostas assistidas e transferencia para time humano.',
        challenge: 'Operacao com alto volume de mensagens e gargalo no primeiro atendimento.',
        solution: [
          'Webhook com fila para desacoplamento de picos.',
          'Camada de IA para triagem e roteamento de conversas.',
          'Handoff com contexto completo para o atendente.',
          'Painel de metricas operacionais e de conversao.',
        ],
        results: [
          'Maior previsibilidade no atendimento.',
          'Reducao de retrabalho em perguntas repetitivas.',
          'Mais velocidade no encaminhamento de casos complexos.',
        ],
        category: 'Chatbots e IA',
      },
      en: {
        title: 'Case: WhatsApp + AI support with smart handoff',
        summary:
          'Automated support flow with intent classification, assisted replies and transfer to human agents.',
        category: 'Chatbots and AI',
      },
      es: {
        title: 'Caso: WhatsApp + IA para atencion con handoff inteligente',
        summary:
          'Flujo automatizado con clasificacion de intencion, respuestas asistidas y transferencia al equipo humano.',
        category: 'Chatbots e IA',
      },
    },
  },
  {
    slug: 'meta-capi-mensuracao',
    stack: ['Meta Pixel', 'Conversions API', 'GTM', 'Backend API'],
    coverImage: '/assets/images/new/b-2.webp',
    demoUrl: '/servicos/meta-ads-e-integracoes',
    repoUrl: 'https://github.com/joaosouz4dev',
    content: {
      pt: {
        title: 'Case: Meta CAPI para qualidade de dados e atribuicao',
        summary: 'Projeto de arquitetura de mensuracao com Pixel + CAPI e deduplicacao de eventos.',
        challenge: 'Inconsistencia em eventos de conversao e baixa confianca nos dados de campanha.',
        solution: [
          'Mapeamento de eventos prioritarios no funil.',
          'Implementacao de CAPI com event_id para deduplicacao.',
          'Validacao de qualidade no Events Manager.',
          'Documentacao tecnica para operacao de marketing.',
        ],
        results: [
          'Melhora na confianca dos dados de conversao.',
          'Maior clareza para ajuste de estrategia de midia.',
          'Padronizacao de eventos para escala.',
        ],
        category: 'Meta Integracoes',
      },
      en: {
        title: 'Case: Meta CAPI for data quality and attribution',
        summary: 'Measurement architecture project using Pixel + CAPI with event deduplication.',
        category: 'Meta Integrations',
      },
      es: {
        title: 'Caso: Meta CAPI para calidad de datos y atribucion',
        summary: 'Proyecto de arquitectura de medicion con Pixel + CAPI y deduplicacion de eventos.',
        category: 'Integraciones Meta',
      },
    },
  },
  {
    slug: 'automacao-crm-whatsapp',
    stack: ['WhatsApp Cloud API', 'CRM API', 'Node.js', 'MySQL'],
    coverImage: '/assets/images/new/b-3.webp',
    demoUrl: '/wpp',
    repoUrl: 'https://github.com/joaosouz4dev',
    content: {
      pt: {
        title: 'Case: Integracao WhatsApp + CRM para funil comercial',
        summary: 'Automacao de fluxos de lead, qualificacao e atualizacao de pipeline comercial.',
        challenge: 'Perda de contexto entre atendimento no WhatsApp e acompanhamento comercial no CRM.',
        solution: [
          'Sincronizacao de eventos entre WhatsApp e CRM.',
          'Modelagem de estagios de funil por eventos.',
          'Regras de notificacao para equipe comercial.',
          'Monitoramento de falhas e retries.',
        ],
        results: [
          'Maior controle sobre jornada dos leads.',
          'Mais velocidade no follow-up comercial.',
          'Reducao de inconsistencias operacionais.',
        ],
        category: 'Automacao',
      },
      en: {
        title: 'Case: WhatsApp + CRM integration for sales funnel',
        summary: 'Lead automation, qualification and pipeline update flows connected end to end.',
        category: 'Automation',
      },
      es: {
        title: 'Caso: Integracion WhatsApp + CRM para embudo comercial',
        summary: 'Automatizacion de flujos de leads, calificacion y actualizacion del pipeline comercial.',
        category: 'Automatizacion',
      },
    },
  },
  {
    slug: 'wpp-new-gerador-link-whatsapp',
    stack: ['React', 'JavaScript', 'WhatsApp URL Scheme'],
    coverImage: '/assets/images/new/hero-1.webp',
    demoUrl: '/wpp',
    repoUrl: 'https://github.com/joaosouz4dev',
    content: {
      pt: {
        title: 'Case: WPP New - Gerador de link para WhatsApp',
        summary: 'Ferramenta para montar links de conversa com numero e mensagem personalizada.',
        challenge: 'Criar um fluxo simples para iniciar atendimento sem salvar contato.',
        solution: [
          'Formulario React com tratamento de numero e codificacao da mensagem.',
          'Deteccao de dispositivo para abertura mobile ou web.',
          'CTA unico para reduzir friccao.',
        ],
        results: [
          'Fluxo rapido para gerar contato comercial no WhatsApp.',
          'Recurso reutilizavel para campanhas e paginas de servico.',
          'Base para futuras automacoes de atendimento.',
        ],
        category: 'Utilitario',
      },
      en: {
        title: 'Case: WPP New - WhatsApp link generator',
        summary: 'Tool to generate WhatsApp chat links with custom phone number and message.',
        category: 'Utility',
      },
      es: {
        title: 'Caso: WPP New - Generador de enlace para WhatsApp',
        summary: 'Herramienta para crear enlaces de conversacion con numero y mensaje personalizados.',
        category: 'Utilidad',
      },
    },
  },
  {
    slug: 'wpp-redirect-zap-whatsapp',
    stack: ['React Router', 'URLSearchParams', 'wa.me'],
    coverImage: '/assets/images/new/hero-2.webp',
    demoUrl: '/zap?phone=5531998587817&message=Ola',
    repoUrl: 'https://github.com/joaosouz4dev',
    content: {
      pt: {
        title: 'Case: WPP Redirect - Redirecionamento inteligente para WhatsApp',
        summary: 'Rota utilitaria para redirecionar leads com parametros de telefone e mensagem.',
        challenge: 'Padronizar URLs de entrada de campanha com redirecionamento rapido e simples.',
        solution: [
          'Captura de query params para phone e message.',
          'Fallback para numero padrao sem parametro.',
          'Tela de transicao curta para o redirecionamento.',
        ],
        results: [
          'Padronizacao de links para divulgacao e campanhas.',
          'Facilidade de uso para equipe comercial.',
          'Base para rastreamento de origem de lead.',
        ],
        category: 'Automacao',
      },
      en: {
        title: 'Case: WPP Redirect - smart WhatsApp redirection',
        summary: 'Utility route to redirect leads quickly using phone and message parameters.',
        category: 'Automation',
      },
      es: {
        title: 'Caso: WPP Redirect - redireccion inteligente a WhatsApp',
        summary: 'Ruta utilitaria para redirigir leads con parametros de telefono y mensaje.',
        category: 'Automatizacion',
      },
    },
  },
  {
    slug: 'matrix-canvas-experience',
    stack: ['React', 'Canvas API', 'dat.gui'],
    coverImage: '/assets/images/new/home-bg-img-3.webp',
    demoUrl: '/matrix',
    repoUrl: 'https://github.com/joaosouz4dev',
    content: {
      pt: {
        title: 'Case: Matrix Canvas Experience',
        summary: 'Experimento visual com canvas e controle de FPS/cor em tempo real.',
        challenge: 'Criar pagina visual interativa com performance fluida.',
        solution: [
          'Renderizacao continua com ajuste dinamico de FPS.',
          'Canvas responsivo em fullscreen com resize handler.',
          'Customizacao de tema por estado e GUI.',
        ],
        results: [
          'Pagina interativa para showcase tecnico.',
          'Exemplo pratico de animacao imperativa com canvas.',
          'Aumento de tempo de permanencia em sessoes exploratorias.',
        ],
        category: 'Frontend Experience',
      },
      en: {
        title: 'Case: Matrix Canvas Experience',
        summary: 'Visual experiment with canvas and real-time FPS/theme controls.',
        category: 'Frontend Experience',
      },
      es: {
        title: 'Caso: Matrix Canvas Experience',
        summary: 'Experimento visual con canvas y control de FPS/tema en tiempo real.',
        category: 'Experiencia Frontend',
      },
    },
  },
  {
    slug: 'seo-rebuild-portfolio-vite',
    stack: ['React', 'Vite', 'React Router', 'Schema.org'],
    coverImage: '/assets/images/new/home-bg-img-1.webp',
    demoUrl: '/servicos',
    repoUrl: 'https://github.com/joaosouz4dev',
    content: {
      pt: {
        title: 'Case: Rebuild SEO do portfolio com Vite e paginas estrategicas',
        summary: 'Evolucao da arquitetura para incluir servicos, cases, blog e metadados por rota.',
        challenge: 'Transformar portfolio em estrutura orientada a SEO e intencao de negocio.',
        solution: [
          'Rotas dedicadas para servicos, cases, blog e contato.',
          'Componente SEO com title, description, canonical e schema.',
          'Sitemap, robots e linkagem interna estrategica.',
        ],
        results: [
          'Base pronta para crescimento organico por clusters.',
          'Melhor alinhamento com consultas de servico.',
          'Maior controle de indexacao e compartilhamento social.',
        ],
        category: 'SEO Tecnico',
      },
      en: {
        title: 'Case: SEO rebuild of the portfolio with Vite and strategic pages',
        summary: 'Architecture upgrade with services, case studies, blog and route-level metadata.',
        category: 'Technical SEO',
      },
      es: {
        title: 'Caso: Rebuild SEO del portfolio con Vite y paginas estrategicas',
        summary: 'Evolucion de arquitectura con servicios, casos, blog y metadatos por ruta.',
        category: 'SEO Tecnico',
      },
    },
  },
  {
    slug: 'i18n-portfolio-multilingue',
    stack: ['React', 'i18next', 'react-i18next'],
    coverImage: '/assets/images/new/header-bg-2.webp',
    demoUrl: '/',
    repoUrl: 'https://github.com/joaosouz4dev',
    content: {
      pt: {
        title: 'Case: Portfolio multilingue com i18next',
        summary: 'Implementacao de internacionalizacao para conteudo em pt, en e es.',
        challenge: 'Entregar experiencia consistente para visitantes de diferentes idiomas.',
        solution: [
          'Configuracao do i18next com detector de idioma.',
          'Arquivos de traducao por lingua e namespace.',
          'Seletor de idioma integrado ao layout.',
        ],
        results: [
          'Maior alcance internacional do portfolio.',
          'Base pronta para expansao de conteudo traduzido.',
          'Melhor experiencia para recrutadores e clientes externos.',
        ],
        category: 'Produto',
      },
      en: {
        title: 'Case: Multilingual portfolio with i18next',
        summary: 'Internationalization implementation for Portuguese, English and Spanish content.',
        category: 'Product',
      },
      es: {
        title: 'Caso: Portfolio multilingue con i18next',
        summary: 'Implementacion de internacionalizacion para contenido en pt, en y es.',
        category: 'Producto',
      },
    },
  },
  {
    slug: 'portfolio-react-sem-jquery',
    stack: ['React', 'Hooks', 'CSS'],
    coverImage: '/assets/images/portfolio/g8.webp',
    demoUrl: '/#jv-portfolio',
    repoUrl: 'https://github.com/joaosouz4dev',
    content: {
      pt: {
        title: 'Case: Refatoracao do portfolio para React puro',
        summary: 'Reescrita de filtros, cards e modal sem dependencias de jQuery.',
        challenge: 'Eliminar conflitos visuais e de estado causados por plugins legados.',
        solution: [
          'Filtro por categoria controlado por estado React.',
          'Modal com acessibilidade de teclado.',
          'Layout responsivo com carregamento otimizado.',
        ],
        results: [
          'Navegacao estavel entre rotas sem regressao visual.',
          'Interacao mais previsivel para o usuario.',
          'Reducao de dependencias legadas no front-end.',
        ],
        category: 'Frontend Experience',
      },
      en: {
        title: 'Case: Portfolio refactor to pure React',
        summary: 'Rebuild of filters, cards and modal without jQuery dependencies.',
        category: 'Frontend Experience',
      },
      es: {
        title: 'Caso: Refactor del portfolio a React puro',
        summary: 'Reescritura de filtros, cards y modal sin dependencias de jQuery.',
        category: 'Experiencia Frontend',
      },
    },
  },
  {
    slug: 'matrix-leak-fix',
    stack: ['React', 'Canvas API', 'dat.gui'],
    coverImage: '/assets/images/new/4136918.webp',
    demoUrl: '/matrix',
    repoUrl: 'https://github.com/joaosouz4dev',
    content: {
      pt: {
        title: 'Case: Correcao de vazamento de recursos na pagina Matrix',
        summary: 'Ajuste de lifecycle para limpar intervalos, listeners e instancias de GUI.',
        challenge: 'A pagina Matrix degradava a navegacao apos entrar e sair multiplas vezes.',
        solution: [
          'Cleanup explicito de intervals e event listeners.',
          'Destroy da instancia dat.GUI no unmount.',
          'Protecoes para contextos de canvas indisponiveis.',
        ],
        results: [
          'Rotas estaveis ao navegar e voltar.',
          'Reducao de consumo de CPU em sessoes longas.',
          'Comportamento previsivel da SPA.',
        ],
        category: 'Performance',
      },
      en: {
        title: 'Case: Resource leak fix on Matrix page',
        summary: 'Lifecycle fixes to clean intervals, listeners and GUI instances on route changes.',
        category: 'Performance',
      },
      es: {
        title: 'Caso: Correccion de fuga de recursos en pagina Matrix',
        summary: 'Ajustes de lifecycle para limpiar intervalos, listeners e instancias de GUI.',
        category: 'Performance',
      },
    },
  },
  {
    slug: 'lazy-routes-vite',
    stack: ['React', 'Vite', 'React Router'],
    coverImage: '/assets/images/new/hero.webp',
    demoUrl: '/',
    repoUrl: 'https://github.com/joaosouz4dev',
    content: {
      pt: {
        title: 'Case: Code splitting por rotas com React lazy',
        summary: 'Lazy loading nas rotas secundarias para reduzir custo do carregamento inicial.',
        challenge: 'Bundle inicial concentrava codigo de paginas nao criticas, afetando FCP/LCP.',
        solution: [
          'Migracao para React.lazy + Suspense.',
          'Separacao de chunks por pagina.',
          'Manutencao de experiencia sem regressao de navegacao.',
        ],
        results: [
          'Melhor distribuicao de JavaScript inicial.',
          'Carregamento mais rapido da Home.',
          'Base pronta para evolucao de Core Web Vitals.',
        ],
        category: 'Performance',
      },
      en: {
        title: 'Case: Route-based code splitting with React lazy',
        summary: 'Secondary routes were lazy-loaded to reduce initial loading cost.',
        category: 'Performance',
      },
      es: {
        title: 'Caso: Code splitting por rutas con React lazy',
        summary: 'Carga diferida en rutas secundarias para reducir el costo inicial.',
        category: 'Performance',
      },
    },
  },
  {
    slug: 'seo-head-otimizado',
    stack: ['Vite', 'HTML', 'Technical SEO'],
    coverImage: '/assets/images/new/home-bg-img.webp',
    demoUrl: '/',
    repoUrl: 'https://github.com/joaosouz4dev',
    content: {
      pt: {
        title: 'Case: Otimizacao do head para SEO e performance',
        summary: 'Limpeza de scripts bloqueantes e melhorias de metadados para indexacao.',
        challenge: 'Head da aplicacao carregava scripts legados que atrasavam renderizacao.',
        solution: [
          'Remocao de scripts nao essenciais do HTML base.',
          'Ajuste de metatags e canonical.',
          'Carregamento mais enxuto na entrada.',
        ],
        results: [
          'Menos bloqueio de renderizacao inicial.',
          'Base tecnica mais limpa para evolucao de SEO.',
          'Melhor previsibilidade no deploy cloud.',
        ],
        category: 'SEO Tecnico',
      },
      en: {
        title: 'Case: Head optimization for SEO and performance',
        summary: 'Blocking scripts were removed and metadata improved for faster rendering and indexing.',
        category: 'Technical SEO',
      },
      es: {
        title: 'Caso: Optimizacion del head para SEO y performance',
        summary: 'Limpieza de scripts bloqueantes y mejoras de metadatos para carga e indexacion.',
        category: 'SEO Tecnico',
      },
    },
  },
  {
    slug: 'sitemap-robots-gestao',
    stack: ['SEO', 'Sitemap', 'Robots'],
    coverImage: '/assets/images/new/map-color-overlay.webp',
    demoUrl: '/sitemap.xml',
    repoUrl: 'https://github.com/joaosouz4dev',
    content: {
      pt: {
        title: 'Case: Gestao de sitemap e robots para indexacao',
        summary: 'Estruturacao de sitemap.xml e robots.txt com rotas estrategicas.',
        challenge: 'Faltava direcionamento explicito para crawlers sobre paginas prioritarias.',
        solution: [
          'Criacao de sitemap com servicos, blog, cases e projetos.',
          'Configuracao de robots com bloqueio de rotas utilitarias.',
          'Padronizacao de prioridade e frequencia de atualizacao.',
        ],
        results: [
          'Rastreamento mais organizado para buscadores.',
          'Maior clareza de arquitetura para SEO tecnico.',
          'Reducao de ruido de indexacao em paginas auxiliares.',
        ],
        category: 'SEO Tecnico',
      },
      en: {
        title: 'Case: Sitemap and robots management for indexing',
        summary: 'Structured sitemap.xml and robots.txt with strategic routes and crawl control.',
        category: 'Technical SEO',
      },
      es: {
        title: 'Caso: Gestion de sitemap y robots para indexacion',
        summary: 'Estructuracion de sitemap.xml y robots.txt con rutas estrategicas.',
        category: 'SEO Tecnico',
      },
    },
  },
  {
    slug: 'design-system-internal-pages',
    stack: ['React', 'CSS', 'UX'],
    coverImage: '/assets/images/new/extra-feature-bg.webp',
    demoUrl: '/servicos',
    repoUrl: 'https://github.com/joaosouz4dev',
    content: {
      pt: {
        title: 'Case: Design system visual para paginas internas',
        summary: 'Layout compartilhado para paginas internas com identidade consistente e CTA.',
        challenge: 'Paginas secundarias tinham experiencia visual desconectada da Home.',
        solution: [
          'Layout centralizado com header, breadcrumb e footer estruturado.',
          'Cards e hero com linguagem visual consistente.',
          'Blocos de conteudo e CTA padronizados.',
        ],
        results: [
          'Experiencia mais fluida entre Home e paginas internas.',
          'Melhor legibilidade e percepcao de profissionalismo.',
          'Base visual reaproveitavel para novas paginas.',
        ],
        category: 'Produto',
      },
      en: {
        title: 'Case: Visual design system for internal pages',
        summary: 'Shared layout for internal pages with consistent identity and conversion-focused CTA.',
        category: 'Product',
      },
      es: {
        title: 'Caso: Design system visual para paginas internas',
        summary: 'Layout compartido para paginas internas con identidad consistente y CTA.',
        category: 'Producto',
      },
    },
  },
];

const localizeCase = (caseItem, language = 'pt') => {
  const locale = toBaseLanguage(language);
  const localized = caseItem.content[locale] || caseItem.content.pt;
  const fallback = caseItem.content.pt;

  return {
    slug: caseItem.slug,
    title: localized.title || fallback.title,
    summary: localized.summary || fallback.summary,
    challenge: localized.challenge || fallback.challenge,
    solution: localized.solution || fallback.solution,
    results: localized.results || fallback.results,
    category: localized.category || fallback.category,
    stack: caseItem.stack,
    coverImage: caseItem.coverImage,
    demoUrl: caseItem.demoUrl,
    repoUrl: caseItem.repoUrl,
  };
};

export const getCases = (language = 'pt') =>
  caseDefinitions.map((caseItem) => localizeCase(caseItem, language));

export const getCaseBySlug = (slug, language = 'pt') =>
  getCases(language).find((item) => item.slug === slug);

export const cases = getCases('pt');
