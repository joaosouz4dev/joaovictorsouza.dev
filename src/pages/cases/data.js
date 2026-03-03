export const cases = [
  {
    slug: 'whatsapp-ia-atendimento',
    title: 'Case: WhatsApp + IA para atendimento com handoff inteligente',
    summary:
      'Implementacao de fluxo automatizado com classificacao de intencao, respostas assistidas e transferencia para time humano.',
    challenge:
      'Operacao com alto volume de mensagens e gargalo no primeiro atendimento.',
    solution: [
      'Webhook com fila para desacoplamento de picos.',
      'Camada de IA para triagem e roteamento.',
      'Handoff com contexto completo para atendente.',
      'Painel de metricas operacionais e conversao.',
    ],
    results: [
      'Maior previsibilidade no atendimento.',
      'Reducao de retrabalho em perguntas repetitivas.',
      'Mais velocidade no encaminhamento de casos complexos.',
    ],
    stack: ['Node.js', 'WhatsApp Cloud API', 'Queue', 'CRM', 'Observabilidade'],
    category: 'Chatbots e IA',
  },
  {
    slug: 'meta-capi-mensuracao',
    title: 'Case: Meta CAPI para qualidade de dados e atribuicao',
    summary:
      'Projeto de arquitetura de mensuracao com Pixel + CAPI e deduplicacao de eventos.',
    challenge:
      'Inconsistencia em eventos de conversao e baixa confianca nos dados de campanha.',
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
    stack: ['Meta Pixel', 'Conversions API', 'GTM', 'Backend API'],
    category: 'Meta Integracoes',
  },
  {
    slug: 'automacao-crm-whatsapp',
    title: 'Case: Integracao WhatsApp + CRM para funil comercial',
    summary:
      'Automacao de fluxos de lead, qualificacao e atualizacao de pipeline comercial.',
    challenge:
      'Perda de contexto entre atendimento no WhatsApp e acompanhamento comercial no CRM.',
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
    stack: ['WhatsApp Cloud API', 'CRM API', 'Node.js', 'MySQL'],
    category: 'Automacao',
    demoUrl: '/wpp',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'wpp-new-gerador-link-whatsapp',
    title: 'Case: WPP New - Gerador de link para WhatsApp',
    summary:
      'Ferramenta para montar links de conversa no WhatsApp com numero e mensagem personalizada.',
    challenge:
      'Criar um fluxo simples para usuarios iniciarem atendimento sem precisar salvar contato.',
    solution: [
      'Formulario React com tratamento de numero e codificacao de mensagem.',
      'Deteccao de dispositivo para abertura em protocolo mobile ou web.',
      'Experiencia direta com CTA unico para reduzir friccao.',
    ],
    results: [
      'Fluxo rapido para gerar contato comercial no WhatsApp.',
      'Recurso reutilizavel para campanhas e paginas de servico.',
      'Base para futuras automacoes de atendimento.',
    ],
    stack: ['React', 'JavaScript', 'WhatsApp URL Scheme'],
    category: 'Utilitario',
    demoUrl: '/wpp',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'wpp-redirect-zap-whatsapp',
    title: 'Case: WPP Redirect - Redirecionamento inteligente para WhatsApp',
    summary:
      'Rota utilitaria para redirecionar leads rapidamente para conversa com parametros de telefone e mensagem.',
    challenge:
      'Padronizar URLs de entrada de campanha com redirecionamento rapido e simples.',
    solution: [
      'Captura de query params para phone e message.',
      'Fallback para numero padrao em ausencia de parametro.',
      'Tela de transicao curta para experiencia de redirecionamento.',
    ],
    results: [
      'Padronizacao de links para divulgacao e campanhas.',
      'Facilidade de uso para a equipe comercial.',
      'Base para rastreamento de origem de lead.',
    ],
    stack: ['React Router', 'URLSearchParams', 'wa.me'],
    category: 'Automacao',
    demoUrl: '/zap?phone=5531998587817&message=Ola',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'matrix-canvas-experience',
    title: 'Case: Matrix Canvas Experience',
    summary:
      'Experimento visual com canvas e configuracao de FPS/cor para demonstrar controle de renderizacao em tempo real.',
    challenge:
      'Criar uma pagina de demonstracao visual interativa com performance fluida.',
    solution: [
      'Renderizacao continua com setInterval e ajuste dinamico de FPS.',
      'Canvas responsivo em fullscreen com resize handler.',
      'Customizacao de tema por variavel de estado e GUI.',
    ],
    results: [
      'Pagina interativa para showcase tecnico e criatividade.',
      'Exemplo pratico de animacao imperativa com canvas.',
      'Aumento de tempo de permanencia em sessoes exploratorias.',
    ],
    stack: ['React', 'Canvas API', 'dat.gui'],
    category: 'Frontend Experience',
    demoUrl: '/matrix',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'seo-rebuild-portfolio-vite',
    title: 'Case: Rebuild SEO do portfolio com Vite e paginas estrategicas',
    summary:
      'Evolucao da arquitetura do site para incluir paginas de servico, cases, blog e metadados por rota.',
    challenge:
      'Transformar um portfolio em estrutura orientada a SEO e intencao de negocio.',
    solution: [
      'Criacao de rotas dedicadas para servicos, cases, blog e contato.',
      'Componente SEO com title, description, canonical, OG/Twitter e schema.',
      'Sitemap, robots e linkagem interna entre conteudo e paginas comerciais.',
    ],
    results: [
      'Base pronta para crescimento organico por clusters de conteudo.',
      'Melhor alinhamento com consultas de servico e fundo de funil.',
      'Maior controle de indexacao e compartilhamento social.',
    ],
    stack: ['React', 'Vite', 'React Router', 'Schema.org'],
    category: 'SEO Tecnico',
    demoUrl: '/servicos',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
  {
    slug: 'i18n-portfolio-multilingue',
    title: 'Case: Portfolio multilingue com i18next',
    summary:
      'Implementacao de internacionalizacao para conteudo em pt, en e es com seletor de idioma.',
    challenge:
      'Entregar experiencia consistente para visitantes de diferentes idiomas.',
    solution: [
      'Configuracao do i18next com detector de idioma do navegador.',
      'Arquivos de traducao por lingua e namespace centralizado.',
      'Componente de selecao de idioma integrado ao layout.',
    ],
    results: [
      'Alcance internacional maior para portfolio e contato profissional.',
      'Base pronta para expansao de conteudo traduzido no blog.',
      'Melhor experiencia para recrutadores e clientes externos.',
    ],
    stack: ['React', 'i18next', 'react-i18next'],
    category: 'Produto',
    demoUrl: '/',
    repoUrl: 'https://github.com/joaosouz4dev',
  },
];

export const getCaseBySlug = (slug) => cases.find((item) => item.slug === slug);
