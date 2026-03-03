export const cases = [
  {
    slug: 'whatsapp-ia-atendimento',
    title: 'Case: WhatsApp + IA para atendimento com handoff inteligente',
    summary:
      'Implementação de fluxo automatizado com classificação de intenção, respostas assistidas e transferência para time humano.',
    challenge:
      'Operação com alto volume de mensagens e gargalo no primeiro atendimento.',
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
    stack: ['Node.js', 'WhatsApp Cloud API', 'Queue', 'CRM', 'Observabilidade'],
    category: 'Chatbots e IA',
    coverImage: '/assets/images/new/b-1.webp',
    demoUrl: '/servicos/chatbots-e-ia',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'meta-capi-mensuracao',
    title: 'Case: Meta CAPI para qualidade de dados e atribuição',
    summary:
      'Projeto de arquitetura de mensuração com Pixel + CAPI e deduplicação de eventos.',
    challenge:
      'Inconsistência em eventos de conversão e baixa confiança nos dados de campanha.',
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
    stack: ['Meta Pixel', 'Conversions API', 'GTM', 'Backend API'],
    category: 'Meta Integracoes',
    coverImage: '/assets/images/new/b-2.webp',
    demoUrl: '/servicos/meta-ads-e-integracoes',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'automacao-crm-whatsapp',
    title: 'Case: Integração WhatsApp + CRM para funil comercial',
    summary:
      'Automação de fluxos de lead, qualificação e atualização de pipeline comercial.',
    challenge:
      'Perda de contexto entre atendimento no WhatsApp e acompanhamento comercial no CRM.',
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
    stack: ['WhatsApp Cloud API', 'CRM API', 'Node.js', 'MySQL'],
    category: 'Automacao',
    coverImage: '/assets/images/new/b-3.webp',
    demoUrl: '/wpp',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'wpp-new-gerador-link-whatsapp',
    title: 'Case: WPP New - Gerador de link para WhatsApp',
    summary:
      'Ferramenta para montar links de conversa no WhatsApp com número e mensagem personalizada.',
    challenge:
      'Criar um fluxo simples para usuários iniciarem atendimento sem precisar salvar contato.',
    solution: [
      'Formulário React com tratamento de número e codificação da mensagem.',
      'Detecção de dispositivo para abertura em protocolo mobile ou web.',
      'Experiência direta com CTA único para reduzir fricção.',
    ],
    results: [
      'Fluxo rápido para gerar contato comercial no WhatsApp.',
      'Recurso reutilizável para campanhas e páginas de serviço.',
      'Base para futuras automações de atendimento.',
    ],
    stack: ['React', 'JavaScript', 'WhatsApp URL Scheme'],
    category: 'Utilitario',
    coverImage: '/assets/images/new/h1.webp',
    demoUrl: '/wpp',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'wpp-redirect-zap-whatsapp',
    title: 'Case: WPP Redirect - Redirecionamento inteligente para WhatsApp',
    summary:
      'Rota utilitária para redirecionar leads rapidamente para conversa com parâmetros de telefone e mensagem.',
    challenge:
      'Padronizar URLs de entrada de campanha com redirecionamento rápido e simples.',
    solution: [
      'Captura de query params para phone e message.',
      'Fallback para número padrão em ausência de parâmetro.',
      'Tela de transição curta para experiência de redirecionamento.',
    ],
    results: [
      'Padronização de links para divulgação e campanhas.',
      'Facilidade de uso para a equipe comercial.',
      'Base para rastreamento de origem de lead.',
    ],
    stack: ['React Router', 'URLSearchParams', 'wa.me'],
    category: 'Automacao',
    coverImage: '/assets/images/new/h2.webp',
    demoUrl: '/zap?phone=5531998587817&message=Ola',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'matrix-canvas-experience',
    title: 'Case: Matrix Canvas Experience',
    summary:
      'Experimento visual com canvas e configuração de FPS/cor para demonstrar controle de renderização em tempo real.',
    challenge:
      'Criar uma página de demonstração visual interativa com performance fluida.',
    solution: [
      'Renderização contínua com setInterval e ajuste dinâmico de FPS.',
      'Canvas responsivo em fullscreen com resize handler.',
      'Customização de tema por variável de estado e GUI.',
    ],
    results: [
      'Página interativa para showcase técnico e criatividade.',
      'Exemplo prático de animação imperativa com canvas.',
      'Aumento de tempo de permanência em sessões exploratórias.',
    ],
    stack: ['React', 'Canvas API', 'dat.gui'],
    category: 'Frontend Experience',
    coverImage: '/assets/images/new/h3.webp',
    demoUrl: '/matrix',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'seo-rebuild-portfolio-vite',
    title: 'Case: Rebuild SEO do portfólio com Vite e páginas estratégicas',
    summary:
      'Evolução da arquitetura do site para incluir páginas de serviço, cases, blog e metadados por rota.',
    challenge:
      'Transformar um portfólio em estrutura orientada a SEO e intenção de negócio.',
    solution: [
      'Criação de rotas dedicadas para serviços, cases, blog e contato.',
      'Componente SEO com title, description, canonical, OG/Twitter e schema.',
      'Sitemap, robots e linkagem interna entre conteúdo e páginas comerciais.',
    ],
    results: [
      'Base pronta para crescimento orgânico por clusters de conteúdo.',
      'Melhor alinhamento com consultas de serviço e fundo de funil.',
      'Maior controle de indexação e compartilhamento social.',
    ],
    stack: ['React', 'Vite', 'React Router', 'Schema.org'],
    category: 'SEO Tecnico',
    coverImage: '/assets/images/new/home-bg-img-1.webp',
    demoUrl: '/servicos',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'i18n-portfolio-multilingue',
    title: 'Case: Portfólio multilíngue com i18next',
    summary:
      'Implementação de internacionalização para conteúdo em pt, en e es com seletor de idioma.',
    challenge:
      'Entregar experiência consistente para visitantes de diferentes idiomas.',
    solution: [
      'Configuração do i18next com detector de idioma do navegador.',
      'Arquivos de tradução por língua e namespace centralizado.',
      'Componente de seleção de idioma integrado ao layout.',
    ],
    results: [
      'Alcance internacional maior para portfólio e contato profissional.',
      'Base pronta para expansão de conteúdo traduzido no blog.',
      'Melhor experiência para recrutadores e clientes externos.',
    ],
    stack: ['React', 'i18next', 'react-i18next'],
    category: 'Produto',
    coverImage: '/assets/images/new/header-bg-2.webp',
    demoUrl: '/',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'portfolio-react-sem-jquery',
    title: 'Case: Refatoração do portfólio para React puro',
    summary:
      'Reescrita da seção de portfólio recente para filtros, cards e modal sem dependências de jQuery.',
    challenge:
      'Eliminar conflitos visuais e de estado causados por plugins legados em SPA.',
    solution: [
      'Filtro por categoria controlado por estado React.',
      'Modal de projeto com acessibilidade de teclado.',
      'Layout responsivo de cards com carregamento otimizado de imagens.',
    ],
    results: [
      'Navegação estável entre rotas sem regressões visuais.',
      'Experiência de interação mais previsível.',
      'Redução de dependências legadas no front-end.',
    ],
    stack: ['React', 'Hooks', 'CSS'],
    category: 'Frontend Experience',
    coverImage: '/assets/images/portfolio/g8.webp',
    demoUrl: '/#jv-portfolio',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'matrix-leak-fix',
    title: 'Case: Correção de vazamento de recursos na página Matrix',
    summary:
      'Ajuste de lifecycle para limpar intervalos, listeners e instâncias de GUI ao trocar de rota.',
    challenge:
      'A página Matrix degradava a navegação após entrar e sair múltiplas vezes.',
    solution: [
      'Cleanup explícito de setInterval e removeEventListener.',
      'Destroy da instância dat.GUI no unmount.',
      'Proteções para contextos de canvas indisponíveis.',
    ],
    results: [
      'Rotas ficaram estáveis ao navegar e voltar.',
      'Redução de consumo de CPU em sessões longas.',
      'Comportamento previsível da SPA.',
    ],
    stack: ['React', 'Canvas API', 'dat.gui'],
    category: 'Performance',
    coverImage: '/assets/images/new/4136918.webp',
    demoUrl: '/matrix',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'lazy-routes-vite',
    title: 'Case: Code splitting por rotas com React lazy',
    summary:
      'Implementação de lazy loading nas rotas secundárias para reduzir custo do carregamento inicial.',
    challenge:
      'Bundle inicial concentrava código de páginas não críticas, afetando FCP/LCP.',
    solution: [
      'Migração das rotas para React.lazy + Suspense.',
      'Separação de chunks por página e por domínio de dados.',
      'Manutenção de experiência sem regressão de navegação.',
    ],
    results: [
      'Melhor distribuição de JavaScript na entrega inicial.',
      'Carregamento mais rápido da Home.',
      'Base pronta para otimizações contínuas de Core Web Vitals.',
    ],
    stack: ['React', 'Vite', 'React Router'],
    category: 'Performance',
    coverImage: '/assets/images/new/hero.webp',
    demoUrl: '/',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'seo-head-otimizado',
    title: 'Case: Otimização do head para SEO e performance',
    summary:
      'Limpeza de scripts bloqueantes e melhorias de metadados para carregamento inicial e indexação.',
    challenge:
      'Head da aplicação carregava scripts legados que atrasavam renderização.',
    solution: [
      'Remoção de scripts de jQuery e plugins não essenciais do HTML base.',
      'Ajuste de metatags e canonical para maior consistência.',
      'Pré-conexões e carregamento mais enxuto na entrada.',
    ],
    results: [
      'Menos bloqueio de renderização no carregamento inicial.',
      'Base técnica mais limpa para evolução de SEO.',
      'Melhor previsibilidade no deploy em ambientes cloud.',
    ],
    stack: ['Vite', 'HTML', 'SEO Técnico'],
    category: 'SEO Tecnico',
    coverImage: '/assets/images/new/home-bg-img.webp',
    demoUrl: '/',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'sitemap-robots-gestao',
    title: 'Case: Gestão de sitemap e robots para indexação',
    summary:
      'Estruturação de sitemap.xml e robots.txt com rotas estratégicas e controle de indexação.',
    challenge:
      'Faltava direcionamento explícito para crawlers sobre páginas prioritárias e utilitárias.',
    solution: [
      'Criação de sitemap com páginas de serviço, blog, cases e projetos.',
      'Configuração de robots com bloqueio de rotas utilitárias.',
      'Padronização de prioridade e frequência de atualização.',
    ],
    results: [
      'Rastreamento mais organizado para mecanismos de busca.',
      'Maior clareza de arquitetura para SEO técnico.',
      'Redução de ruído de indexação em páginas auxiliares.',
    ],
    stack: ['SEO', 'Sitemap', 'Robots'],
    category: 'SEO Tecnico',
    coverImage: '/assets/images/new/map-color-overlay.webp',
    demoUrl: '/sitemap.xml',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'design-system-internal-pages',
    title: 'Case: Design system visual para páginas internas',
    summary:
      'Criação de layout compartilhado para páginas internas com identidade consistente e CTA de conversão.',
    challenge:
      'Páginas secundárias tinham experiência visual desconectada da Home.',
    solution: [
      'Layout centralizado com header, breadcrumb e footer estruturado.',
      'Cards e hero com linguagem visual consistente.',
      'Blocos de conteúdo e CTA padronizados para serviço e cases.',
    ],
    results: [
      'Experiência mais fluida entre Home e páginas internas.',
      'Melhor legibilidade e percepção de profissionalismo.',
      'Base visual reaproveitável para novas páginas.',
    ],
    stack: ['React', 'CSS', 'UX'],
    category: 'Produto',
    coverImage: '/assets/images/new/extra-feature-bg.webp',
    demoUrl: '/servicos',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
];

export const getCaseBySlug = (slug) => cases.find((item) => item.slug === slug);
