import { toBaseLanguage } from '../../utils/i18n.js';

const projectDefinitions = [
  {
    slug: 'wppconnect',
    stack: ['TypeScript', 'Node.js', 'Puppeteer', 'WhatsApp Web'],
    repository: 'https://github.com/wppconnect-team/wppconnect',
    content: {
      pt: {
        title: 'WPPConnect',
        summary:
          'Biblioteca open-source que mantenho no time WPPConnect para automatizar o WhatsApp Web em Node.js. Mais de 3 mil estrelas no GitHub e base de bots, atendimentos e integrações em produção no Brasil inteiro.',
      },
      en: {
        title: 'WPPConnect',
        summary:
          'Open-source library I maintain with the WPPConnect team to automate WhatsApp Web from Node.js. Over 3k GitHub stars and the foundation for bots, support flows and integrations running in production.',
      },
      es: {
        title: 'WPPConnect',
        summary:
          'Librería open-source que mantengo en el equipo WPPConnect para automatizar WhatsApp Web en Node.js. Más de 3 mil estrellas en GitHub y base de bots, atenciones e integraciones en producción.',
      },
    },
  },
  {
    slug: 'wppconnect-server',
    stack: ['TypeScript', 'Node.js', 'REST API', 'Swagger'],
    repository: 'https://github.com/wppconnect-team/wppconnect-server',
    content: {
      pt: {
        title: 'WPPConnect Server',
        summary:
          'API pronta para uso construída sobre o WPPConnect: sobe, configura o token e já expõe endpoints de mensageria, sessões e webhooks. Passa de mil estrelas e é o caminho mais rápido para colocar WhatsApp em qualquer stack.',
      },
      en: {
        title: 'WPPConnect Server',
        summary:
          'Ready-to-use API built on top of WPPConnect: install, set the token and you already have messaging, session and webhook endpoints. Over 1k stars and the fastest way to plug WhatsApp into any stack.',
      },
      es: {
        title: 'WPPConnect Server',
        summary:
          'API lista para usar construida sobre WPPConnect: se instala, se configura el token y ya expone endpoints de mensajería, sesiones y webhooks. Más de mil estrellas y el camino más rápido para llevar WhatsApp a cualquier stack.',
      },
    },
  },
  {
    slug: 'wppconnect-server-go',
    stack: ['Go', 'REST API', 'WhatsApp', 'Performance'],
    repository: 'https://github.com/wppconnect-team/wppconnect-server-go',
    content: {
      pt: {
        title: 'WPPConnect Server Go',
        summary:
          'Reescrita do WPPConnect Server em Go, com foco em consumo de memória e densidade de sessões por máquina. Mesma proposta de API pronta para uso, com binário único e footprint muito menor.',
      },
      en: {
        title: 'WPPConnect Server Go',
        summary:
          'A Go rewrite of WPPConnect Server focused on memory usage and how many sessions fit per machine. Same ready-to-use API idea, now as a single binary with a much smaller footprint.',
      },
      es: {
        title: 'WPPConnect Server Go',
        summary:
          'Reescritura de WPPConnect Server en Go, enfocada en consumo de memoria y densidad de sesiones por máquina. La misma API lista para usar, con binario único y footprint mucho menor.',
      },
    },
  },
  {
    slug: 'cam-fx',
    stack: ['Python', 'MediaPipe', 'DirectML', 'OpenCV'],
    repository: 'https://github.com/joaosouz4dev/cam-fx',
    content: {
      pt: {
        title: 'CamFX',
        summary:
          'Câmera virtual para Windows 11 com blur de fundo e auto-framing em tempo real, acelerada por GPU via DirectML. Alternativa leve e open-source ao NVIDIA Broadcast que mexe só na webcam, nunca no áudio.',
      },
      en: {
        title: 'CamFX',
        summary:
          'Virtual camera for Windows 11 with real-time background blur and auto-framing, GPU accelerated through DirectML. A lightweight open-source alternative to NVIDIA Broadcast that touches only the webcam, never the audio.',
      },
      es: {
        title: 'CamFX',
        summary:
          'Cámara virtual para Windows 11 con desenfoque de fondo y auto-framing en tiempo real, acelerada por GPU vía DirectML. Alternativa liviana y open-source a NVIDIA Broadcast que solo toca la webcam, nunca el audio.',
      },
    },
  },
  {
    slug: 'lifelog',
    stack: ['Python', 'Whisper', 'Speech to Text', 'Desktop'],
    repository: 'https://github.com/joaosouz4dev/lifelog',
    content: {
      pt: {
        title: 'Lifelog',
        summary:
          'Diário de áudio que grava microfone e áudio do sistema, transcreve localmente com Whisper e gera relatórios do dia. Nada sai do computador: privacidade por arquitetura, não por promessa.',
      },
      en: {
        title: 'Lifelog',
        summary:
          'Audio journal that records microphone and system audio, transcribes locally with Whisper and generates daily reports. Nothing leaves the machine: privacy by architecture, not by promise.',
      },
      es: {
        title: 'Lifelog',
        summary:
          'Diario de audio que graba micrófono y audio del sistema, transcribe localmente con Whisper y genera informes del día. Nada sale de la computadora: privacidad por arquitectura, no por promesa.',
      },
    },
  },
  {
    slug: 'mornio-extension',
    stack: ['JavaScript', 'Chrome Extension', 'Manifest V3', 'UI'],
    repository: 'https://github.com/joaosouz4dev/mornio-extension',
    content: {
      pt: {
        title: 'Mornio',
        summary:
          'Extensão de nova guia para Chrome com relógio, fusos horários, clima, tarefas, notas e foto de fundo que muda todo dia. Um começo calmo a cada aba aberta, sem ruído nem propaganda.',
      },
      en: {
        title: 'Mornio',
        summary:
          'New tab extension for Chrome with a clock, world timezones, weather, tasks, notes and a background photo that changes daily. A calm start on every tab, with no noise and no ads.',
      },
      es: {
        title: 'Mornio',
        summary:
          'Extensión de nueva pestaña para Chrome con reloj, husos horarios, clima, tareas, notas y foto de fondo que cambia cada día. Un comienzo tranquilo en cada pestaña, sin ruido ni publicidad.',
      },
    },
  },
  {
    slug: 'zap-bot',
    stack: ['JavaScript', 'Node.js', 'Bot', 'WPPConnect'],
    repository: 'https://github.com/joaosouz4dev/zap-bot',
    content: {
      pt: {
        title: 'Zap Bot',
        summary:
          'Bot de WhatsApp em Node.js construído com a biblioteca WPPConnect, pensado como ponto de partida enxuto para quem quer automatizar conversas e roteamento de mensagens.',
      },
      en: {
        title: 'Zap Bot',
        summary:
          'WhatsApp bot in Node.js built with the WPPConnect library, designed as a lean starting point for automating conversations and message routing.',
      },
      es: {
        title: 'Zap Bot',
        summary:
          'Bot de WhatsApp en Node.js construido con la librería WPPConnect, pensado como punto de partida sencillo para automatizar conversaciones y ruteo de mensajes.',
      },
    },
  },
  {
    slug: 'zap-bot-ai',
    stack: ['JavaScript', 'Node.js', 'LLM', 'WhatsApp'],
    repository: 'https://github.com/joaosouz4dev/zap-bot-AI',
    content: {
      pt: {
        title: 'Zap Bot AI',
        summary:
          'Evolução do Zap Bot conectando o WhatsApp a modelos de linguagem, para responder em linguagem natural em vez de depender só de menus e palavras-chave.',
      },
      en: {
        title: 'Zap Bot AI',
        summary:
          'An evolution of Zap Bot connecting WhatsApp to language models, so replies come in natural language instead of relying only on menus and keywords.',
      },
      es: {
        title: 'Zap Bot AI',
        summary:
          'Evolución de Zap Bot que conecta WhatsApp con modelos de lenguaje, para responder en lenguaje natural en lugar de depender solo de menús y palabras clave.',
      },
    },
  },
  {
    slug: 'rs-voip-api',
    stack: ['JavaScript', 'VoIP', 'WhatsApp', 'Node.js'],
    repository: 'https://github.com/joaosouz4dev/rs-voip-api',
    content: {
      pt: {
        title: 'RS VoIP API',
        summary:
          'Biblioteca para controlar chamadas de voz do WhatsApp de forma programática, cobrindo um recurso que a maioria das integrações de mensageria simplesmente ignora.',
      },
      en: {
        title: 'RS VoIP API',
        summary:
          'Library to control WhatsApp voice calls programmatically, covering a capability most messaging integrations simply ignore.',
      },
      es: {
        title: 'RS VoIP API',
        summary:
          'Librería para controlar llamadas de voz de WhatsApp de forma programática, cubriendo un recurso que la mayoría de las integraciones de mensajería ignora.',
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
          'API que coleta preços dos principais e-commerces brasileiros via web scraping, normaliza os dados e expõe tudo em um formato único para consumo externo.',
      },
      en: {
        title: 'API Prices Webscraping',
        summary:
          'API that collects prices from the main Brazilian e-commerce sites via web scraping, normalizes the data and exposes it in a single format for external consumption.',
      },
      es: {
        title: 'API Prices Webscraping',
        summary:
          'API que recolecta precios de los principales e-commerce brasileños vía web scraping, normaliza los datos y los expone en un formato único para consumo externo.',
      },
    },
  },
  {
    slug: 'financial-control',
    stack: ['Next.js 16', 'TypeScript', 'Postgres', 'Drizzle ORM'],
    repository: 'https://github.com/joaosouz4dev/financial-control',
    content: {
      pt: {
        title: 'Controle Financeiro',
        summary:
          'Substituto das planilhas de controle financeiro, com histórico plurianual, recorrência automática e metas confrontadas com o realizado. A regra do projeto: a LLM nunca produz um número que vai para o banco, só referências que o código valida.',
      },
      en: {
        title: 'Financial Control',
        summary:
          'A replacement for spreadsheet-based budgeting, with multi-year history, automatic recurrence and goals checked against actuals. The project rule: the LLM never produces a number that reaches the database, only references the code validates.',
      },
      es: {
        title: 'Control Financiero',
        summary:
          'Sustituto de las planillas de control financiero, con historial plurianual, recurrencia automática y metas confrontadas con lo realizado. La regla del proyecto: la LLM nunca produce un número que va a la base, solo referencias que el código valida.',
      },
    },
  },
  {
    slug: 'mico-leao-dublado-api',
    stack: ['Next.js 14', 'TypeScript', 'MongoDB', 'Stremio Addon'],
    repository: 'https://github.com/joaosouz4dev/MicoLeaoDubladoAPIV2',
    content: {
      pt: {
        title: 'Mico Leão Dublado API V2',
        summary:
          'Sucessor independente de uma API de catálogo dublado para Stremio, reescrita em Next.js com suporte a Debrid, scrape de tracker e deploy serverless. Resolve uma issue do projeto original aberta desde 2022.',
      },
      en: {
        title: 'Mico Leão Dublado API V2',
        summary:
          'An independent successor to a dubbed-catalog API for Stremio, rewritten in Next.js with Debrid support, native tracker scraping and serverless deployment. It closes an upstream issue open since 2022.',
      },
      es: {
        title: 'Mico Leão Dublado API V2',
        summary:
          'Sucesor independiente de una API de catálogo doblado para Stremio, reescrita en Next.js con soporte Debrid, scrape de tracker y deploy serverless. Resuelve una issue del proyecto original abierta desde 2022.',
      },
    },
  },
  {
    slug: 'agent-orchestrator-mini',
    stack: ['JavaScript', 'AI Agents', 'Tracing', 'Durable State'],
    repository: 'https://github.com/joaosouz4dev/agent-orchestrator-mini',
    content: {
      pt: {
        title: 'Agent Orchestrator Mini',
        summary:
          'Orquestrador de agentes de IA sem framework pesado: supervisor que roteia a tarefa, estado durável que retoma após falha, tool runner com timeout e retry, e teto de passos e tokens por tarefa.',
      },
      en: {
        title: 'Agent Orchestrator Mini',
        summary:
          'AI agent orchestrator with no heavy framework: a supervisor that routes the task, durable state that resumes after failure, a tool runner with timeout and retry, and hard step and token ceilings per task.',
      },
      es: {
        title: 'Agent Orchestrator Mini',
        summary:
          'Orquestador de agentes de IA sin framework pesado: supervisor que rutea la tarea, estado durable que retoma tras una falla, tool runner con timeout y retry, y techo de pasos y tokens por tarea.',
      },
    },
  },
  {
    slug: 'embedding-migration-kit',
    stack: ['JavaScript', 'Embeddings', 'RAG', 'Migration'],
    repository: 'https://github.com/joaosouz4dev/embedding-migration-kit',
    content: {
      pt: {
        title: 'Embedding Migration Kit',
        summary:
          'Migração de modelo de embedding sem reindexar o acervo inteiro: versão no vetor, backfill retomável, escrita dupla na ingestão e harness de paridade que decide a virada por medição, não por sensação.',
      },
      en: {
        title: 'Embedding Migration Kit',
        summary:
          'Migrating between embedding models without reindexing the whole corpus: versioned vectors, resumable backfill, dual writes on ingestion and a parity harness that gates the cutover on measurement, not intuition.',
      },
      es: {
        title: 'Embedding Migration Kit',
        summary:
          'Migración de modelo de embedding sin reindexar todo el acervo: versión en el vector, backfill retomable, escritura doble en la ingesta y harness de paridad que decide el cambio por medición, no por sensación.',
      },
    },
  },
  {
    slug: 'llm-observability-mini',
    stack: ['JavaScript', 'Observability', 'LLM', 'FinOps'],
    repository: 'https://github.com/joaosouz4dev/llm-observability-mini',
    content: {
      pt: {
        title: 'LLM Observability Mini',
        summary:
          'Middleware que envelopa cada chamada de LLM e mede as três dimensões juntas: latência com span separando modelo de tools, custo em dólar descontando prompt cache e sinais de qualidade que não precisam de gabarito.',
      },
      en: {
        title: 'LLM Observability Mini',
        summary:
          'Middleware that wraps every LLM call and measures the three dimensions together: latency with spans separating model from tools, dollar cost net of prompt cache, and quality signals that need no ground truth.',
      },
      es: {
        title: 'LLM Observability Mini',
        summary:
          'Middleware que envuelve cada llamada de LLM y mide las tres dimensiones juntas: latencia con span que separa modelo de tools, costo en dólares descontando prompt cache y señales de calidad sin necesidad de gabarito.',
      },
    },
  },
  {
    slug: 'bot-eval-harness',
    stack: ['JavaScript', 'Eval', 'LLM as judge', 'CI'],
    repository: 'https://github.com/joaosouz4dev/bot-eval-harness',
    content: {
      pt: {
        title: 'Bot Eval Harness',
        summary:
          'Avaliação contínua de bots de atendimento sem infra pesada: dataset versionado de casos, métricas por tipo, LLM como juiz para respostas abertas e gate de regressão rodando no CI.',
      },
      en: {
        title: 'Bot Eval Harness',
        summary:
          'Continuous evaluation for support bots without heavy infrastructure: a versioned case dataset, per-type metrics, an LLM judge for open-ended answers and a regression gate running in CI.',
      },
      es: {
        title: 'Bot Eval Harness',
        summary:
          'Evaluación continua de bots de atención sin infra pesada: dataset versionado de casos, métricas por tipo, LLM como juez para respuestas abiertas y gate de regresión corriendo en CI.',
      },
    },
  },
  {
    slug: 'ai-decision-audit-trail',
    stack: ['JavaScript', 'Audit Log', 'Hash Chain', 'Compliance'],
    repository: 'https://github.com/joaosouz4dev/ai-decision-audit-trail',
    content: {
      pt: {
        title: 'AI Decision Audit Trail',
        summary:
          'Trilha de auditoria append-only para agentes de IA: cada decisão vira um evento encadeado ao anterior por hash, com redação de dado pessoal antes da gravação e verificador que aponta onde a cadeia foi rompida.',
      },
      en: {
        title: 'AI Decision Audit Trail',
        summary:
          'Append-only audit trail for AI agents: each decision becomes an event hash-chained to the previous one, with PII redaction before writing and a verifier that pinpoints where the chain broke.',
      },
      es: {
        title: 'AI Decision Audit Trail',
        summary:
          'Trilla de auditoría append-only para agentes de IA: cada decisión es un evento encadenado al anterior por hash, con redacción de dato personal antes de la grabación y verificador que señala dónde se rompió la cadena.',
      },
    },
  },
  {
    slug: 'degraded-mode-machine',
    stack: ['JavaScript', 'Resilience', 'Circuit Breaker', 'Fallback'],
    repository: 'https://github.com/joaosouz4dev/degraded-mode-machine',
    content: {
      pt: {
        title: 'Degraded Mode Machine',
        summary:
          'Quando o provedor de LLM cai, a pergunta não é técnica, é de produto: o que o cliente vê. Esta máquina de níveis decide com antecedência o que cai primeiro e o que ainda é entregue.',
      },
      en: {
        title: 'Degraded Mode Machine',
        summary:
          'When the LLM provider goes down, the question is not technical but a product one: what the customer sees. This tiered state machine decides in advance what degrades first and what still gets delivered.',
      },
      es: {
        title: 'Degraded Mode Machine',
        summary:
          'Cuando el proveedor de LLM cae, la pregunta no es técnica sino de producto: qué ve el cliente. Esta máquina de niveles decide con anticipación qué cae primero y qué se sigue entregando.',
      },
    },
  },
  {
    slug: 'llm-output-guardrails-mini',
    stack: ['JavaScript', 'Guardrails', 'JSON Schema', 'LLM'],
    repository: 'https://github.com/joaosouz4dev/llm-output-guardrails-mini',
    content: {
      pt: {
        title: 'LLM Output Guardrails',
        summary:
          'Camada de guardrails na saída do modelo: valida o schema com retry dirigido, bloqueia conteúdo fora de política e devolve uma recusa segura em vez de deixar resposta malformada chegar ao cliente.',
      },
      en: {
        title: 'LLM Output Guardrails',
        summary:
          'A guardrail layer on model output: schema validation with targeted retry, out-of-policy content blocking and a safe refusal instead of letting a malformed answer reach the customer.',
      },
      es: {
        title: 'LLM Output Guardrails',
        summary:
          'Capa de guardrails en la salida del modelo: valida el schema con retry dirigido, bloquea contenido fuera de política y devuelve un rechazo seguro en vez de dejar que una respuesta malformada llegue al cliente.',
      },
    },
  },
  {
    slug: 'whatsapp-cloud-api-starter',
    stack: ['JavaScript', 'WhatsApp Cloud API', 'Webhook', 'Queue'],
    repository: 'https://github.com/joaosouz4dev/whatsapp-cloud-api-starter',
    content: {
      pt: {
        title: 'WhatsApp Cloud API Starter',
        summary:
          'Starter de produção para a Cloud API da Meta: webhook com verificação de assinatura HMAC, resposta 200 imediata e fila que tira o processamento pesado do caminho crítico da requisição.',
      },
      en: {
        title: 'WhatsApp Cloud API Starter',
        summary:
          'Production starter for the Meta Cloud API: a webhook with HMAC signature verification, an immediate 200 response and a queue that moves heavy processing off the critical path of the request.',
      },
      es: {
        title: 'WhatsApp Cloud API Starter',
        summary:
          'Starter de producción para la Cloud API de Meta: webhook con verificación de firma HMAC, respuesta 200 inmediata y cola que saca el procesamiento pesado del camino crítico de la petición.',
      },
    },
  },
  {
    slug: 'digispark-scripts',
    stack: ['C++', 'Arduino', 'Digispark', 'HID'],
    repository: 'https://github.com/joaosouz4dev/digispark-scripts',
    content: {
      pt: {
        title: 'Digispark Scripts',
        summary:
          'Scripts para o Arduino Digispark, que emula um teclado para automatizar qualquer ação de digitação. Inclui um mapeamento de layout pt-BR que desenvolvi porque as soluções existentes só cobriam outros layouts.',
      },
      en: {
        title: 'Digispark Scripts',
        summary:
          'Scripts for the Arduino Digispark, which emulates a keyboard to automate any typing action. Includes a pt-BR keyboard layout mapping I built because existing solutions only covered other layouts.',
      },
      es: {
        title: 'Digispark Scripts',
        summary:
          'Scripts para el Arduino Digispark, que emula un teclado para automatizar cualquier acción de tecleo. Incluye un mapeo de layout pt-BR que desarrollé porque las soluciones existentes solo cubrían otros layouts.',
      },
    },
  },
  {
    slug: 'joaovictorsouza-dev',
    stack: ['React', 'Vite', 'Tailwind CSS', 'SEO'],
    repository: 'https://github.com/joaosouz4dev/joaovictorsouza.dev',
    content: {
      pt: {
        title: 'joaovictorsouza.dev',
        summary:
          'O código deste site: SPA em React com prerender pós-build que gera HTML estático e sitemap de cada post em três idiomas, para que o conteúdo seja indexável sem abrir mão da navegação client-side.',
      },
      en: {
        title: 'joaovictorsouza.dev',
        summary:
          'The code behind this site: a React SPA with a post-build prerender that generates static HTML and a sitemap for every post in three languages, keeping content indexable without giving up client-side navigation.',
      },
      es: {
        title: 'joaovictorsouza.dev',
        summary:
          'El código de este sitio: SPA en React con prerender post-build que genera HTML estático y sitemap de cada post en tres idiomas, para que el contenido sea indexable sin renunciar a la navegación client-side.',
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
