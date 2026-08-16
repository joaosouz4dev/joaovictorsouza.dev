import { toBaseLanguage } from '../../utils/i18n.js';
import { translatePath } from '../../config/routes.js';

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
          'Implementação de fluxo automatizado com classificação de intenção, respostas assistidas e transferência para time humano.',
        challenge: 'Operação com alto volume de mensagens e gargalo no primeiro atendimento.',
        solution: [
          'Webhook com fila para desacoplamento de picos.',
          'Camada de IA para triagem e roteamento de conversas.',
          'Handoff com contexto completo para o atendente.',
          'Painel de métricas operacionais e de conversão.',
        ],
        results: [
          'Maior previsibilidade no atendimento.',
          'Redução de retrabalho em perguntas repetitivas.',
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
        title: 'Caso: WhatsApp + IA para atención con handoff inteligente',
        summary:
          'Flujo automatizado con clasificación de intención, respuestas asistidas y transferencia al equipo humano.',
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
        title: 'Case: Meta CAPI para qualidade de dados e atribuição',
        summary: 'Projeto de arquitetura de mensuração com Pixel + CAPI e deduplicação de eventos.',
        challenge: 'Inconsistência em eventos de conversão e baixa confiança nos dados de campanha.',
        solution: [
          'Mapeamento de eventos prioritários no funil.',
          'Implementação de CAPI com event_id para deduplicação.',
          'Validação de qualidade no Events Manager.',
          'Documentação técnica para operação de marketing.',
        ],
        results: [
          'Melhora na confiança dos dados de conversão.',
          'Maior clareza para ajuste de estratégia de mídia.',
          'Padronização de eventos para escala.',
        ],
        category: 'Meta Integrações',
      },
      en: {
        title: 'Case: Meta CAPI for data quality and attribution',
        summary: 'Measurement architecture project using Pixel + CAPI with event deduplication.',
        category: 'Meta Integrations',
      },
      es: {
        title: 'Caso: Meta CAPI para calidad de datos y atribución',
        summary: 'Proyecto de arquitectura de medición con Pixel + CAPI y deduplicación de eventos.',
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
        title: 'Case: Integração WhatsApp + CRM para funil comercial',
        summary: 'Automação de fluxos de lead, qualificação e atualização de pipeline comercial.',
        challenge: 'Perda de contexto entre atendimento no WhatsApp e acompanhamento comercial no CRM.',
        solution: [
          'Sincronização de eventos entre WhatsApp e CRM.',
          'Modelagem de estágios de funil por eventos.',
          'Regras de notificação para equipe comercial.',
          'Monitoramento de falhas e retries.',
        ],
        results: [
          'Maior controle sobre jornada dos leads.',
          'Mais velocidade no follow-up comercial.',
          'Redução de inconsistências operacionais.',
        ],
        category: 'Automação',
      },
      en: {
        title: 'Case: WhatsApp + CRM integration for sales funnel',
        summary: 'Lead automation, qualification and pipeline update flows connected end to end.',
        category: 'Automation',
      },
      es: {
        title: 'Caso: Integración WhatsApp + CRM para embudo comercial',
        summary: 'Automatización de flujos de leads, calificación y actualización del pipeline comercial.',
        category: 'Automatización',
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
        summary: 'Ferramenta para montar links de conversa com número e mensagem personalizada.',
        challenge: 'Criar um fluxo simples para iniciar atendimento sem salvar contato.',
        solution: [
          'Formulário React com tratamento de número e codificação da mensagem.',
          'Detecção de dispositivo para abertura mobile ou web.',
          'CTA único para reduzir fricção.',
        ],
        results: [
          'Fluxo rápido para gerar contato comercial no WhatsApp.',
          'Recurso reutilizável para campanhas e páginas de serviço.',
          'Base para futuras automações de atendimento.',
        ],
        category: 'Utilitário',
      },
      en: {
        title: 'Case: WPP New - WhatsApp link generator',
        summary: 'Tool to generate WhatsApp chat links with custom phone number and message.',
        category: 'Utility',
      },
      es: {
        title: 'Caso: WPP New - Generador de enlace para WhatsApp',
        summary: 'Herramienta para crear enlaces de conversación con número y mensaje personalizados.',
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
        summary: 'Rota utilitária para redirecionar leads com parâmetros de telefone e mensagem.',
        challenge: 'Padronizar URLs de entrada de campanha com redirecionamento rápido e simples.',
        solution: [
          'Captura de query params para phone e message.',
          'Fallback para número padrão sem parâmetro.',
          'Tela de transição curta para o redirecionamento.',
        ],
        results: [
          'Padronização de links para divulgação e campanhas.',
          'Facilidade de uso para equipe comercial.',
          'Base para rastreamento de origem de lead.',
        ],
        category: 'Automação',
      },
      en: {
        title: 'Case: WPP Redirect - smart WhatsApp redirection',
        summary: 'Utility route to redirect leads quickly using phone and message parameters.',
        category: 'Automation',
      },
      es: {
        title: 'Caso: WPP Redirect - redirección inteligente a WhatsApp',
        summary: 'Ruta utilitaria para redirigir leads con parámetros de teléfono y mensaje.',
        category: 'Automatización',
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
        challenge: 'Criar página visual interativa com performance fluida.',
        solution: [
          'Renderização contínua com ajuste dinâmico de FPS.',
          'Canvas responsivo em fullscreen com resize handler.',
          'Customização de tema por estado e GUI.',
        ],
        results: [
          'Página interativa para showcase técnico.',
          'Exemplo prático de animação imperativa com canvas.',
          'Aumento de tempo de permanência em sessões exploratórias.',
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
        title: 'Case: Rebuild SEO do portfólio com Vite e páginas estratégicas',
        summary: 'Evolução da arquitetura para incluir serviços, cases, blog e metadados por rota.',
        challenge: 'Transformar portfólio em estrutura orientada a SEO e intenção de negócio.',
        solution: [
          'Rotas dedicadas para serviços, cases, blog e contato.',
          'Componente SEO com title, description, canonical e schema.',
          'Sitemap, robots e linkagem interna estratégica.',
        ],
        results: [
          'Base pronta para crescimento orgânico por clusters.',
          'Melhor alinhamento com consultas de serviço.',
          'Maior controle de indexação e compartilhamento social.',
        ],
        category: 'SEO Tecnico',
      },
      en: {
        title: 'Case: SEO rebuild of the portfolio with Vite and strategic pages',
        summary: 'Architecture upgrade with services, case studies, blog and route-level metadata.',
        category: 'Technical SEO',
      },
      es: {
        title: 'Caso: Rebuild SEO del portfolio con Vite y páginas estratégicas',
        summary: 'Evolución de arquitectura con servicios, casos, blog y metadatos por ruta.',
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
        title: 'Case: Portfólio multilíngue com i18next',
        summary: 'Implementação de internacionalização para conteúdo em pt, en e es.',
        challenge: 'Entregar experiência consistente para visitantes de diferentes idiomas.',
        solution: [
          'Configuração do i18next com detector de idioma.',
          'Arquivos de tradução por língua e namespace.',
          'Seletor de idioma integrado ao layout.',
        ],
        results: [
          'Maior alcance internacional do portfólio.',
          'Base pronta para expansão de conteúdo traduzido.',
          'Melhor experiência para recrutadores e clientes externos.',
        ],
        category: 'Produto',
      },
      en: {
        title: 'Case: Multilingual portfolio with i18next',
        summary: 'Internationalization implementation for Portuguese, English and Spanish content.',
        category: 'Product',
      },
      es: {
        title: 'Caso: Portfolio multilingüe con i18next',
        summary: 'Implementación de internacionalización para contenido en pt, en y es.',
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
        title: 'Case: Refatoração do portfólio para React puro',
        summary: 'Reescrita de filtros, cards e modal sem dependências de jQuery.',
        challenge: 'Eliminar conflitos visuais e de estado causados por plugins legados.',
        solution: [
          'Filtro por categoria controlado por estado React.',
          'Modal com acessibilidade de teclado.',
          'Layout responsivo com carregamento otimizado.',
        ],
        results: [
          'Navegação estável entre rotas sem regressão visual.',
          'Interação mais previsível para o usuário.',
          'Redução de dependências legadas no front-end.',
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
        title: 'Case: Correção de vazamento de recursos na página Matrix',
        summary: 'Ajuste de lifecycle para limpar intervalos, listeners e instâncias de GUI.',
        challenge: 'A página Matrix degradava a navegação após entrar e sair múltiplas vezes.',
        solution: [
          'Cleanup explícito de intervals e event listeners.',
          'Destroy da instância dat.GUI no unmount.',
          'Proteções para contextos de canvas indisponíveis.',
        ],
        results: [
          'Rotas estáveis ao navegar e voltar.',
          'Redução de consumo de CPU em sessões longas.',
          'Comportamento previsível da SPA.',
        ],
        category: 'Performance',
      },
      en: {
        title: 'Case: Resource leak fix on Matrix page',
        summary: 'Lifecycle fixes to clean intervals, listeners and GUI instances on route changes.',
        category: 'Performance',
      },
      es: {
        title: 'Caso: Corrección de fuga de recursos en página Matrix',
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
        summary: 'Lazy loading nas rotas secundárias para reduzir custo do carregamento inicial.',
        challenge: 'Bundle inicial concentrava código de páginas não críticas, afetando FCP/LCP.',
        solution: [
          'Migração para React.lazy + Suspense.',
          'Separação de chunks por página.',
          'Manutenção de experiência sem regressão de navegação.',
        ],
        results: [
          'Melhor distribuição de JavaScript inicial.',
          'Carregamento mais rápido da Home.',
          'Base pronta para evolução de Core Web Vitals.',
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
        title: 'Case: Otimização do head para SEO e performance',
        summary: 'Limpeza de scripts bloqueantes e melhorias de metadados para indexação.',
        challenge: 'Head da aplicação carregava scripts legados que atrasavam renderização.',
        solution: [
          'Remoção de scripts não essenciais do HTML base.',
          'Ajuste de metatags e canonical.',
          'Carregamento mais enxuto na entrada.',
        ],
        results: [
          'Menos bloqueio de renderização inicial.',
          'Base técnica mais limpa para evolução de SEO.',
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
        title: 'Caso: Optimización del head para SEO y performance',
        summary: 'Limpieza de scripts bloqueantes y mejoras de metadatos para carga e indexación.',
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
        title: 'Case: Gestão de sitemap e robots para indexação',
        summary: 'Estruturação de sitemap.xml e robots.txt com rotas estratégicas.',
        challenge: 'Faltava direcionamento explícito para crawlers sobre páginas prioritárias.',
        solution: [
          'Criação de sitemap com serviços, blog, cases e projetos.',
          'Configuração de robots com bloqueio de rotas utilitárias.',
          'Padronização de prioridade e frequência de atualização.',
        ],
        results: [
          'Rastreamento mais organizado para buscadores.',
          'Maior clareza de arquitetura para SEO técnico.',
          'Redução de ruído de indexação em páginas auxiliares.',
        ],
        category: 'SEO Tecnico',
      },
      en: {
        title: 'Case: Sitemap and robots management for indexing',
        summary: 'Structured sitemap.xml and robots.txt with strategic routes and crawl control.',
        category: 'Technical SEO',
      },
      es: {
        title: 'Caso: Gestión de sitemap y robots para indexación',
        summary: 'Estructuración de sitemap.xml y robots.txt con rutas estratégicas.',
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
        title: 'Case: Design system visual para páginas internas',
        summary: 'Layout compartilhado para páginas internas com identidade consistente e CTA.',
        challenge: 'Páginas secundárias tinham experiência visual desconectada da Home.',
        solution: [
          'Layout centralizado com header, breadcrumb e footer estruturado.',
          'Cards e hero com linguagem visual consistente.',
          'Blocos de conteúdo e CTA padronizados.',
        ],
        results: [
          'Experiência mais fluida entre Home e páginas internas.',
          'Melhor legibilidade e percepção de profissionalismo.',
          'Base visual reaproveitável para novas páginas.',
        ],
        category: 'Produto',
      },
      en: {
        title: 'Case: Visual design system for internal pages',
        summary: 'Shared layout for internal pages with consistent identity and conversion-focused CTA.',
        category: 'Product',
      },
      es: {
        title: 'Caso: Design system visual para páginas internas',
        summary: 'Layout compartido para páginas internas con identidad consistente y CTA.',
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
    // Demos internas seguem o idioma do visitante (/servicos -> /services).
    demoUrl: caseItem.demoUrl?.startsWith('/')
      ? translatePath(caseItem.demoUrl, locale)
      : caseItem.demoUrl,
    repoUrl: caseItem.repoUrl,
  };
};

export const getCases = (language = 'pt') =>
  caseDefinitions.map((caseItem) => localizeCase(caseItem, language));

export const getCaseBySlug = (slug, language = 'pt') =>
  getCases(language).find((item) => item.slug === slug);

export const cases = getCases('pt');
