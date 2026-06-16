// Conteudo do artigo: arquitetura-multi-tenant-whatsapp-saas
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections, faq, conclusion, related, repo }

const pt = {
  intro:
    'Construir um SaaS sobre a WhatsApp Cloud API significa servir muitos clientes a partir da mesma base de codigo e da mesma infraestrutura. O desafio nao e enviar mensagens: e garantir que o tenant A nunca veja, toque ou afete os dados do tenant B, que um cliente barulhento nao degrade a experiencia dos demais e que cada configuracao (templates, credenciais, feature flags) seja isolada e governavel. Este guia trata dos padroes de arquitetura multi-tenant que sustentam isso: modelos de isolamento, roteamento de webhook por phone_number_id, limites e quotas por tenant e governanca de configuracao.',
  sections: [
    {
      title: 'Modelos de isolamento: silo, pool e bridge',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira decisao de um SaaS multi-tenant e o grau de isolamento entre clientes. Tres modelos dominam o debate. No modelo silo, cada tenant recebe sua propria stack (banco, filas, as vezes ate compute) dedicada. No modelo pool, todos os tenants compartilham a mesma infraestrutura e o isolamento e logico, garantido por uma coluna tenant_id em cada tabela. O modelo bridge e o meio termo: compartilha compute e aplicacao, mas isola o dado sensivel (um banco ou schema por tenant) onde o custo de vazamento e mais alto.',
        },
        {
          type: 'paragraph',
          value:
            'No nivel do banco, isso se materializa em tres estrategias: banco por tenant (isolamento fisico maximo, custo operacional alto), schema por tenant (isolamento logico forte dentro do mesmo cluster) e row-level com tenant_id (uma unica tabela com a coluna discriminadora). A escolha define seu custo, seu blast radius e a complexidade de onboarding de cada novo cliente.',
        },
        {
          type: 'table',
          columns: ['Modelo', 'Isolamento', 'Custo / tenant', 'Onboarding', 'Blast radius', 'Quando usar'],
          rows: [
            [
              'Banco por tenant (silo)',
              'Fisico, maximo',
              'Alto',
              'Lento (provisiona stack)',
              'Minimo: falha fica contida',
              'Enterprise, compliance rigido, dado regulado',
            ],
            [
              'Schema por tenant (bridge)',
              'Logico forte',
              'Medio',
              'Medio (cria schema + migra)',
              'Medio: cluster compartilhado',
              'Mix de clientes medios e grandes',
            ],
            [
              'Row-level tenant_id (pool)',
              'Logico via aplicacao',
              'Baixo',
              'Rapido (insere linha)',
              'Alto: erro de filtro vaza tudo',
              'SMB em escala, alto volume de tenants',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Na pratica, SaaS maduros raramente escolhem um unico modelo. Adotam um pool para a maioria (SMB) e oferecem silo como plano premium para clientes enterprise que exigem isolamento fisico. Esse hibrido e o bridge na sua forma mais comercial: a mesma aplicacao roteia para o storage certo conforme o plano do tenant.',
        },
      ],
    },
    {
      title: 'Resolvendo o tenant a partir do webhook',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No WhatsApp SaaS, cada tenant tem um ou mais numeros, e cada numero tem um phone_number_id estavel atribuido pela Meta. Quando uma mensagem chega, o webhook e o mesmo para todos os clientes: o que muda e o phone_number_id dentro do payload. Esse identificador e a chave de roteamento. Antes de qualquer processamento, voce resolve o tenant a partir dele e injeta o contexto do tenant em todo o fluxo subsequente.',
        },
        {
          type: 'paragraph',
          value:
            'O payload entrega o phone_number_id em entry[].changes[].value.metadata.phone_number_id. A partir dele, uma busca (idealmente cacheada) devolve o tenant correspondente. Se nao houver tenant mapeado, o evento e rejeitado: nunca processe um webhook sem tenant resolvido, pois isso e justamente o vetor de vazamento entre clientes.',
        },
        {
          type: 'code',
          value: `const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

// Cache de phone_number_id -> tenant para evitar hit no banco a cada evento.
const TENANT_CACHE_TTL = 60 * 10; // 10 min

async function resolveTenant(phoneNumberId) {
  const cacheKey = \`wa:pnid:\${phoneNumberId}\`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // tenant_numbers mapeia cada phone_number_id ao seu tenant.
  const tenant = await db.query(
    'SELECT tenant_id, status FROM tenant_numbers WHERE phone_number_id = $1',
    [phoneNumberId],
  ).then((r) => r.rows[0]);

  if (!tenant) return null; // numero nao registrado: rejeite o evento.
  await redis.set(cacheKey, JSON.stringify(tenant), 'EX', TENANT_CACHE_TTL);
  return tenant;
}

async function handleWebhook(req, res) {
  // Responda 200 rapido; o roteamento e o trabalho pesado ficam fora do request.
  res.sendStatus(200);

  const change = req.body?.entry?.[0]?.changes?.[0]?.value;
  const phoneNumberId = change?.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const tenant = await resolveTenant(phoneNumberId);
  if (!tenant || tenant.status !== 'active') {
    console.warn('Webhook sem tenant valido', { phoneNumberId });
    return; // nunca processe sem tenant resolvido.
  }

  // Enfileira na fila ISOLADA do tenant, carregando o contexto adiante.
  await enqueueForTenant(tenant.tenant_id, change);
}`,
        },
        {
          type: 'diagram',
          value: `Meta (WhatsApp)
      |
      |  POST /webhook  (payload com phone_number_id)
      v
+----------------------------+
|     Webhook endpoint       |
|  1. responde 200           |
|  2. extrai phone_number_id |
|  3. resolveTenant()        |  --> cache Redis / tabela tenant_numbers
|  4. valida tenant ativo    |
+----------------------------+
      |
      |  contexto { tenant_id }
      v
+----------------------------+      +----------------------------+
|  Fila do tenant A          |      |  Fila do tenant B          |
|  (queue:wa:tenantA)        |      |  (queue:wa:tenantB)        |
+----------------------------+      +----------------------------+
      |                                    |
      v                                    v
  Workers (sempre filtram por tenant_id no banco)`,
        },
        {
          type: 'paragraph',
          value:
            'O contexto do tenant resolvido aqui deve viajar com o evento por todo o pipeline. Workers, queries e chamadas de envio sempre recebem o tenant_id explicitamente. Resolver o tenant cedo e propaga-lo e o que impede que logica posterior precise adivinhar a quem o evento pertence.',
        },
      ],
    },
    {
      title: 'Limites e quotas por tenant',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Em infraestrutura compartilhada, o maior risco operacional e o noisy neighbor: um tenant que dispara uma campanha massiva ou entra em loop e consome toda a capacidade, degradando os demais. A defesa e impor limites por tenant em varias camadas, de modo que nenhum cliente possa monopolizar recursos compartilhados.',
        },
        {
          type: 'list',
          items: [
            'Rate limit por tenant: limite de requisicoes por segundo isolado por tenant_id, com token bucket no Redis, para que o pico de um nao consuma a cota global da Meta.',
            'Cota de mensagens: teto diario ou mensal por plano, contabilizado por tenant, com bloqueio ou degradacao graciosa ao atingir o limite.',
            'Fila isolada por tenant: filas separadas (ou prioridade ponderada) para que o backlog de um tenant nao atrase o processamento dos outros.',
            'Limite de concorrencia de workers: numero maximo de jobs simultaneos por tenant, evitando que um cliente domine o pool de workers.',
            'Quota de armazenamento e midia: teto de uploads e retencao por tenant para conter custo e abuso.',
            'Circuit breaker por tenant: ao detectar erros repetidos (ex.: template invalido em massa), pausar o tenant especifico sem afetar os demais.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A chave conceitual e que toda quota carrega o tenant_id como dimensao. Um rate limit global protege a Meta de bloquear sua conta, mas nao protege os tenants entre si. So um limite por tenant garante isolamento de desempenho, que e tao importante quanto o isolamento de dados em um SaaS.',
        },
      ],
    },
    {
      title: 'Governanca de configuracao por tenant',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cada tenant traz sua propria configuracao: numeros, templates aprovados, credenciais da Meta, integracoes e comportamento de produto. Governar isso significa armazenar, versionar e resolver essas configuracoes por tenant de forma segura, sem hardcode e sem que a config de um cliente vaze para outro.',
        },
        {
          type: 'list',
          items: [
            'Templates por tenant: cada cliente tem seu catalogo de templates aprovados, com nome, idioma e status, isolados por tenant_id; nunca presuma que um template existe para todos.',
            'Credenciais isoladas: o access token e o WABA de cada tenant ficam cifrados em um cofre (KMS / Secrets Manager), referenciados por tenant, nunca em variaveis de ambiente compartilhadas.',
            'Feature flags por tenant: habilite recursos (IA, novo fluxo, beta) por cliente ou plano, permitindo rollout gradual e planos diferenciados sem branches de codigo.',
            'Webhooks de saida e integracoes: cada tenant configura seus proprios destinos e segredos de assinatura, resolvidos a partir do contexto do tenant.',
            'Branding e copy: saudacoes, menus e textos especificos por tenant, carregados pela mesma camada de resolucao de config.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Trate a configuracao como dado de primeira classe, com a mesma disciplina de isolamento do resto. Uma camada de resolucao de configuracao recebe o tenant_id e devolve apenas a config daquele tenant, com cache invalidavel. Credenciais nunca trafegam em claro nem aparecem em logs.',
        },
      ],
    },
    {
      title: 'Seguranca e prevencao de vazamento entre tenants',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No modelo pool, o vazamento entre tenants e a falha mais grave possivel: um filtro tenant_id esquecido em uma query e o suficiente para um cliente ler dados de outro. A defesa nao pode depender da disciplina manual de cada desenvolvedor; precisa ser estrutural, com camadas que tornem o vazamento dificil de introduzir e facil de detectar.',
        },
        {
          type: 'ordered',
          items: [
            'Sempre filtrar por tenant_id: toda query de leitura e escrita inclui tenant_id na clausula WHERE; nunca confie em filtro implicito.',
            'Centralizar o acesso a dados: um repositorio ou data layer que injeta tenant_id automaticamente a partir do contexto, removendo a chance de esquecer o filtro na mao.',
            'Aplicar Row-Level Security (RLS) no banco: politicas no Postgres que forcam o tenant_id no nivel do SGBD, como ultima barreira mesmo se a aplicacao falhar.',
            'Propagar o contexto do tenant: o tenant_id resolvido no webhook viaja por toda a request, fila e worker; nenhuma camada deduz o tenant por conta propria.',
            'Cifrar e isolar credenciais: tokens por tenant em cofre, nunca compartilhados; o vazamento de um segredo nao deve dar acesso a outro tenant.',
            'Testes automatizados de isolamento: suites que, com dois tenants populados, tentam ler dados cruzados e falham o build se qualquer vazamento ocorrer.',
            'Auditoria e logs com tenant_id: toda operacao registra o tenant, permitindo rastrear e detectar acessos anomalos entre clientes.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O teste de isolamento merece destaque: criar dois tenants, popular dados em ambos e afirmar que nenhuma operacao de um enxerga o outro deve ser parte do pipeline de CI. Esse teste e o que transforma isolamento de uma promessa em uma garantia verificada a cada commit.',
        },
      ],
    },
    {
      title: 'Onboarding e ciclo de vida do tenant',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um SaaS multi-tenant precisa de um processo claro para criar, suspender e remover tenants. Onboarding e offboarding malfeitos sao fontes silenciosas de vazamento e de custo: dados orfaos, numeros mal mapeados e credenciais que sobrevivem ao fim do contrato.',
        },
        {
          type: 'ordered',
          items: [
            'Provisionar o tenant: criar o registro, o storage conforme o plano (row-level, schema ou banco) e o namespace de filas.',
            'Registrar numeros: mapear cada phone_number_id ao tenant na tabela de roteamento e invalidar o cache.',
            'Configurar credenciais e templates: armazenar tokens cifrados e sincronizar o catalogo de templates aprovados da Meta.',
            'Aplicar limites do plano: definir rate limit, cotas e flags conforme o tier contratado.',
            'Suspender com seguranca: ao inadimplir ou pausar, marcar o tenant como inativo para que o webhook rejeite eventos sem apagar dados.',
            'Offboarding: exportar dados, revogar credenciais e remover storage de forma auditavel ao encerrar o contrato.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Tratar o ciclo de vida como um fluxo explicito e versionado evita o acumulo de tenants zumbis. Cada estado (ativo, suspenso, encerrado) tem comportamento definido no roteamento e nos limites, e a transicao entre eles e auditavel.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Devo comecar com banco por tenant ou row-level com tenant_id?',
      answer:
        'Para a maioria dos SaaS em estagio inicial, comece com row-level usando tenant_id: o custo por tenant e baixo e o onboarding e instantaneo, o que importa quando voce ainda esta validando o produto. Reserve banco ou schema por tenant para clientes enterprise com exigencias de compliance ou isolamento fisico, oferecendo isso como plano premium. O importante e desenhar a aplicacao para tolerar ambos os modelos desde o inicio, com o tenant_id propagado em todo o codigo, para que migrar um cliente especifico para um silo nao exija reescrita.',
    },
    {
      question: 'Como o webhook sabe a qual tenant pertence cada mensagem?',
      answer:
        'Pelo phone_number_id presente no payload, em entry[].changes[].value.metadata.phone_number_id. Esse identificador e estavel e unico por numero. Voce mantem uma tabela que mapeia cada phone_number_id ao seu tenant e resolve o tenant logo no inicio do processamento, idealmente com cache no Redis para evitar um hit no banco a cada evento. Se o phone_number_id nao estiver mapeado a nenhum tenant ativo, o evento deve ser rejeitado: nunca processe um webhook sem tenant resolvido.',
    },
    {
      question: 'Como evito que um tenant degrade o desempenho dos outros?',
      answer:
        'Aplicando limites por tenant em varias camadas: rate limit por tenant_id com token bucket, cota de mensagens por plano, filas isoladas (ou com prioridade ponderada) e limite de concorrencia de workers por tenant. A ideia central e que toda quota carregue o tenant_id como dimensao. Um limite global protege sua conta na Meta, mas nao protege os clientes entre si; somente limites por tenant garantem isolamento de desempenho e evitam o problema do noisy neighbor.',
    },
  ],
  conclusion: {
    title: 'Multi-tenant e isolamento desenhado, nao improvisado',
    description:
      'Escolher o modelo de isolamento certo, rotear webhooks por phone_number_id, impor limites por tenant e testar isolamento a cada commit formam a espinha dorsal de um SaaS de WhatsApp confiavel e escalavel. Se voce esta projetando ou escalando uma plataforma multi-tenant, posso ajudar a desenhar essa arquitetura.',
    cta: 'Falar sobre minha plataforma',
  },
  related: [
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'Seguranca em integracoes Meta WhatsApp', to: '/blog/seguranca-integracoes-meta-whatsapp' },
    { label: 'Governanca de templates em times grandes', to: '/blog/governanca-templates-times-grandes' },
  ],
  repo: {
    name: 'whatsapp-multitenant-router',
    description:
      'Exemplo de roteamento multi-tenant para WhatsApp: resolucao de tenant por phone_number_id, filas isoladas e limites por tenant.',
    url: 'https://github.com/joaosouz4dev/whatsapp-multitenant-router',
  },
};

const en = {
  intro:
    'Building a SaaS on top of the WhatsApp Cloud API means serving many customers from the same codebase and the same infrastructure. The challenge is not sending messages: it is guaranteeing that tenant A never sees, touches or affects tenant B data, that a noisy customer does not degrade everyone else and that each configuration (templates, credentials, feature flags) is isolated and governable. This guide covers the multi-tenant architecture patterns that make this possible: isolation models, webhook routing by phone_number_id, per-tenant limits and quotas, and configuration governance.',
  sections: [
    {
      title: 'Isolation models: silo, pool and bridge',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first decision of a multi-tenant SaaS is the degree of isolation between customers. Three models dominate the discussion. In the silo model, each tenant gets its own dedicated stack (database, queues, sometimes even compute). In the pool model, all tenants share the same infrastructure and isolation is logical, enforced by a tenant_id column on every table. The bridge model is the middle ground: it shares compute and application but isolates sensitive data (a database or schema per tenant) where the cost of a leak is highest.',
        },
        {
          type: 'paragraph',
          value:
            'At the database level, this materializes in three strategies: database per tenant (maximum physical isolation, high operational cost), schema per tenant (strong logical isolation within the same cluster) and row-level with tenant_id (a single table with a discriminator column). The choice defines your cost, your blast radius and the complexity of onboarding each new customer.',
        },
        {
          type: 'table',
          columns: ['Model', 'Isolation', 'Cost / tenant', 'Onboarding', 'Blast radius', 'When to use'],
          rows: [
            [
              'Database per tenant (silo)',
              'Physical, maximum',
              'High',
              'Slow (provisions a stack)',
              'Minimal: failure is contained',
              'Enterprise, strict compliance, regulated data',
            ],
            [
              'Schema per tenant (bridge)',
              'Strong logical',
              'Medium',
              'Medium (create schema + migrate)',
              'Medium: shared cluster',
              'Mix of mid-size and large customers',
            ],
            [
              'Row-level tenant_id (pool)',
              'Logical via application',
              'Low',
              'Fast (insert a row)',
              'High: a filter slip leaks everything',
              'SMB at scale, high tenant count',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'In practice, mature SaaS rarely pick a single model. They run a pool for the majority (SMB) and offer silo as a premium plan for enterprise customers that demand physical isolation. That hybrid is the bridge in its most commercial form: the same application routes to the right storage based on the tenant plan.',
        },
      ],
    },
    {
      title: 'Resolving the tenant from the webhook',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In a WhatsApp SaaS, each tenant has one or more numbers, and each number has a stable phone_number_id assigned by Meta. When a message arrives, the webhook is the same for every customer: what changes is the phone_number_id inside the payload. That identifier is the routing key. Before any processing, you resolve the tenant from it and inject the tenant context into the entire downstream flow.',
        },
        {
          type: 'paragraph',
          value:
            'The payload delivers the phone_number_id in entry[].changes[].value.metadata.phone_number_id. From it, a lookup (ideally cached) returns the matching tenant. If there is no mapped tenant, the event is rejected: never process a webhook without a resolved tenant, since that is exactly the cross-tenant leak vector.',
        },
        {
          type: 'code',
          value: `const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

// Cache phone_number_id -> tenant to avoid a DB hit on every event.
const TENANT_CACHE_TTL = 60 * 10; // 10 min

async function resolveTenant(phoneNumberId) {
  const cacheKey = \`wa:pnid:\${phoneNumberId}\`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // tenant_numbers maps each phone_number_id to its tenant.
  const tenant = await db.query(
    'SELECT tenant_id, status FROM tenant_numbers WHERE phone_number_id = $1',
    [phoneNumberId],
  ).then((r) => r.rows[0]);

  if (!tenant) return null; // unregistered number: reject the event.
  await redis.set(cacheKey, JSON.stringify(tenant), 'EX', TENANT_CACHE_TTL);
  return tenant;
}

async function handleWebhook(req, res) {
  // Respond 200 fast; routing and heavy work happen outside the request.
  res.sendStatus(200);

  const change = req.body?.entry?.[0]?.changes?.[0]?.value;
  const phoneNumberId = change?.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const tenant = await resolveTenant(phoneNumberId);
  if (!tenant || tenant.status !== 'active') {
    console.warn('Webhook without a valid tenant', { phoneNumberId });
    return; // never process without a resolved tenant.
  }

  // Enqueue on the tenant ISOLATED queue, carrying the context forward.
  await enqueueForTenant(tenant.tenant_id, change);
}`,
        },
        {
          type: 'diagram',
          value: `Meta (WhatsApp)
      |
      |  POST /webhook  (payload with phone_number_id)
      v
+----------------------------+
|     Webhook endpoint       |
|  1. respond 200            |
|  2. extract phone_number_id|
|  3. resolveTenant()        |  --> Redis cache / tenant_numbers table
|  4. validate active tenant |
+----------------------------+
      |
      |  context { tenant_id }
      v
+----------------------------+      +----------------------------+
|  Tenant A queue            |      |  Tenant B queue            |
|  (queue:wa:tenantA)        |      |  (queue:wa:tenantB)        |
+----------------------------+      +----------------------------+
      |                                    |
      v                                    v
  Workers (always filter by tenant_id in the database)`,
        },
        {
          type: 'paragraph',
          value:
            'The tenant context resolved here must travel with the event through the whole pipeline. Workers, queries and send calls always receive the tenant_id explicitly. Resolving the tenant early and propagating it is what prevents later logic from having to guess who the event belongs to.',
        },
      ],
    },
    {
      title: 'Per-tenant limits and quotas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In shared infrastructure, the biggest operational risk is the noisy neighbor: a tenant that fires a massive campaign or enters a loop and consumes all the capacity, degrading everyone else. The defense is enforcing per-tenant limits across several layers, so no customer can monopolize shared resources.',
        },
        {
          type: 'list',
          items: [
            'Per-tenant rate limit: a requests-per-second cap isolated by tenant_id, with a Redis token bucket, so one tenant spike does not consume the global Meta quota.',
            'Message quota: a daily or monthly ceiling per plan, counted per tenant, with blocking or graceful degradation when the limit is hit.',
            'Per-tenant isolated queue: separate queues (or weighted priority) so one tenant backlog does not delay the others processing.',
            'Worker concurrency cap: a maximum number of simultaneous jobs per tenant, preventing one customer from dominating the worker pool.',
            'Storage and media quota: a ceiling on uploads and retention per tenant to contain cost and abuse.',
            'Per-tenant circuit breaker: on detecting repeated errors (e.g. mass invalid template), pause that specific tenant without affecting the rest.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The key concept is that every quota carries tenant_id as a dimension. A global rate limit protects Meta from blocking your account, but it does not protect tenants from each other. Only a per-tenant limit guarantees performance isolation, which is as important as data isolation in a SaaS.',
        },
      ],
    },
    {
      title: 'Per-tenant configuration governance',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Each tenant brings its own configuration: numbers, approved templates, Meta credentials, integrations and product behavior. Governing this means storing, versioning and resolving these configurations per tenant securely, with no hardcoding and without one customer config leaking into another.',
        },
        {
          type: 'list',
          items: [
            'Per-tenant templates: each customer has its own approved template catalog, with name, language and status, isolated by tenant_id; never assume a template exists for everyone.',
            'Isolated credentials: each tenant access token and WABA are encrypted in a vault (KMS / Secrets Manager), referenced by tenant, never in shared environment variables.',
            'Per-tenant feature flags: enable features (AI, a new flow, beta) per customer or plan, allowing gradual rollout and differentiated plans without code branches.',
            'Outbound webhooks and integrations: each tenant configures its own destinations and signing secrets, resolved from the tenant context.',
            'Branding and copy: greetings, menus and tenant-specific text, loaded by the same config resolution layer.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Treat configuration as a first-class data with the same isolation discipline as everything else. A configuration resolution layer takes the tenant_id and returns only that tenant config, with an invalidatable cache. Credentials never travel in clear text nor appear in logs.',
        },
      ],
    },
    {
      title: 'Security and cross-tenant leak prevention',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In the pool model, the cross-tenant leak is the most severe failure possible: a forgotten tenant_id filter in one query is enough for a customer to read another customer data. The defense cannot depend on the manual discipline of each developer; it must be structural, with layers that make leaks hard to introduce and easy to detect.',
        },
        {
          type: 'ordered',
          items: [
            'Always filter by tenant_id: every read and write query includes tenant_id in the WHERE clause; never rely on an implicit filter.',
            'Centralize data access: a repository or data layer that injects tenant_id automatically from the context, removing the chance of forgetting the filter by hand.',
            'Apply Row-Level Security (RLS) in the database: Postgres policies that enforce tenant_id at the engine level, as a last barrier even if the application fails.',
            'Propagate the tenant context: the tenant_id resolved at the webhook travels through every request, queue and worker; no layer deduces the tenant on its own.',
            'Encrypt and isolate credentials: per-tenant tokens in a vault, never shared; one secret leak must not grant access to another tenant.',
            'Automated isolation tests: suites that, with two populated tenants, attempt cross reads and fail the build if any leak occurs.',
            'Auditing and logs with tenant_id: every operation records the tenant, enabling tracing and detection of anomalous cross-tenant access.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The isolation test deserves emphasis: creating two tenants, populating data in both and asserting that no operation of one sees the other should be part of the CI pipeline. That test is what turns isolation from a promise into a guarantee verified on every commit.',
        },
      ],
    },
    {
      title: 'Tenant onboarding and lifecycle',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A multi-tenant SaaS needs a clear process to create, suspend and remove tenants. Badly handled onboarding and offboarding are silent sources of leaks and cost: orphaned data, mis-mapped numbers and credentials that outlive the contract.',
        },
        {
          type: 'ordered',
          items: [
            'Provision the tenant: create the record, the storage per plan (row-level, schema or database) and the queue namespace.',
            'Register numbers: map each phone_number_id to the tenant in the routing table and invalidate the cache.',
            'Configure credentials and templates: store encrypted tokens and sync the approved Meta template catalog.',
            'Apply plan limits: set rate limit, quotas and flags according to the contracted tier.',
            'Suspend safely: when a tenant defaults or pauses, mark it inactive so the webhook rejects events without deleting data.',
            'Offboarding: export data, revoke credentials and remove storage in an auditable way when the contract ends.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Treating the lifecycle as an explicit, versioned flow avoids the buildup of zombie tenants. Each state (active, suspended, terminated) has defined behavior in routing and limits, and the transition between them is auditable.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Should I start with database per tenant or row-level with tenant_id?',
      answer:
        'For most early-stage SaaS, start with row-level using tenant_id: the cost per tenant is low and onboarding is instant, which matters while you are still validating the product. Reserve database or schema per tenant for enterprise customers with compliance or physical isolation requirements, offering it as a premium plan. The key is to design the application to tolerate both models from the start, with tenant_id propagated through all the code, so migrating a specific customer to a silo does not require a rewrite.',
    },
    {
      question: 'How does the webhook know which tenant each message belongs to?',
      answer:
        'By the phone_number_id present in the payload, at entry[].changes[].value.metadata.phone_number_id. That identifier is stable and unique per number. You keep a table mapping each phone_number_id to its tenant and resolve the tenant at the very start of processing, ideally cached in Redis to avoid a DB hit on every event. If the phone_number_id is not mapped to any active tenant, the event must be rejected: never process a webhook without a resolved tenant.',
    },
    {
      question: 'How do I prevent one tenant from degrading the others performance?',
      answer:
        'By applying per-tenant limits across several layers: a per-tenant_id rate limit with a token bucket, a message quota per plan, isolated queues (or weighted priority) and a per-tenant worker concurrency cap. The core idea is that every quota carries tenant_id as a dimension. A global limit protects your Meta account, but it does not protect customers from each other; only per-tenant limits guarantee performance isolation and avoid the noisy neighbor problem.',
    },
  ],
  conclusion: {
    title: 'Multi-tenant is designed isolation, not improvised',
    description:
      'Choosing the right isolation model, routing webhooks by phone_number_id, enforcing per-tenant limits and testing isolation on every commit form the backbone of a reliable, scalable WhatsApp SaaS. If you are designing or scaling a multi-tenant platform, I can help design this architecture.',
    cta: 'Talk about my platform',
  },
  related: [
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'Security for Meta WhatsApp integrations', to: '/blog/seguranca-integracoes-meta-whatsapp' },
    { label: 'Template governance for large teams', to: '/blog/governanca-templates-times-grandes' },
  ],
  repo: {
    name: 'whatsapp-multitenant-router',
    description:
      'Example multi-tenant routing for WhatsApp: tenant resolution by phone_number_id, isolated queues and per-tenant limits.',
    url: 'https://github.com/joaosouz4dev/whatsapp-multitenant-router',
  },
};

const es = {
  intro:
    'Construir un SaaS sobre la WhatsApp Cloud API significa servir a muchos clientes desde la misma base de codigo y la misma infraestructura. El reto no es enviar mensajes: es garantizar que el tenant A nunca vea, toque ni afecte los datos del tenant B, que un cliente ruidoso no degrade la experiencia de los demas y que cada configuracion (plantillas, credenciales, feature flags) este aislada y sea gobernable. Esta guia trata los patrones de arquitectura multi-tenant que lo sostienen: modelos de aislamiento, enrutamiento de webhook por phone_number_id, limites y cuotas por tenant y gobernanza de configuracion.',
  sections: [
    {
      title: 'Modelos de aislamiento: silo, pool y bridge',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La primera decision de un SaaS multi-tenant es el grado de aislamiento entre clientes. Tres modelos dominan el debate. En el modelo silo, cada tenant recibe su propia stack (base de datos, colas, a veces incluso compute) dedicada. En el modelo pool, todos los tenants comparten la misma infraestructura y el aislamiento es logico, garantizado por una columna tenant_id en cada tabla. El modelo bridge es el termino medio: comparte compute y aplicacion, pero aisla el dato sensible (una base o schema por tenant) donde el costo de una fuga es mas alto.',
        },
        {
          type: 'paragraph',
          value:
            'A nivel de base de datos, esto se materializa en tres estrategias: base por tenant (aislamiento fisico maximo, costo operativo alto), schema por tenant (aislamiento logico fuerte dentro del mismo cluster) y row-level con tenant_id (una unica tabla con la columna discriminadora). La eleccion define tu costo, tu blast radius y la complejidad de onboarding de cada nuevo cliente.',
        },
        {
          type: 'table',
          columns: ['Modelo', 'Aislamiento', 'Costo / tenant', 'Onboarding', 'Blast radius', 'Cuando usar'],
          rows: [
            [
              'Base por tenant (silo)',
              'Fisico, maximo',
              'Alto',
              'Lento (aprovisiona stack)',
              'Minimo: el fallo queda contenido',
              'Enterprise, compliance estricto, dato regulado',
            ],
            [
              'Schema por tenant (bridge)',
              'Logico fuerte',
              'Medio',
              'Medio (crea schema + migra)',
              'Medio: cluster compartido',
              'Mezcla de clientes medianos y grandes',
            ],
            [
              'Row-level tenant_id (pool)',
              'Logico via aplicacion',
              'Bajo',
              'Rapido (inserta fila)',
              'Alto: un filtro olvidado lo filtra todo',
              'SMB a escala, alto volumen de tenants',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'En la practica, los SaaS maduros rara vez eligen un unico modelo. Adoptan un pool para la mayoria (SMB) y ofrecen silo como plan premium para clientes enterprise que exigen aislamiento fisico. Ese hibrido es el bridge en su forma mas comercial: la misma aplicacion enruta al storage correcto segun el plan del tenant.',
        },
      ],
    },
    {
      title: 'Resolver el tenant a partir del webhook',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En un SaaS de WhatsApp, cada tenant tiene uno o mas numeros, y cada numero tiene un phone_number_id estable asignado por Meta. Cuando llega un mensaje, el webhook es el mismo para todos los clientes: lo que cambia es el phone_number_id dentro del payload. Ese identificador es la clave de enrutamiento. Antes de cualquier procesamiento, resuelves el tenant a partir de el e inyectas el contexto del tenant en todo el flujo posterior.',
        },
        {
          type: 'paragraph',
          value:
            'El payload entrega el phone_number_id en entry[].changes[].value.metadata.phone_number_id. A partir de el, una busqueda (idealmente cacheada) devuelve el tenant correspondiente. Si no hay tenant mapeado, el evento se rechaza: nunca proceses un webhook sin tenant resuelto, pues ese es justamente el vector de fuga entre clientes.',
        },
        {
          type: 'code',
          value: `const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

// Cache de phone_number_id -> tenant para evitar un hit a la BD en cada evento.
const TENANT_CACHE_TTL = 60 * 10; // 10 min

async function resolveTenant(phoneNumberId) {
  const cacheKey = \`wa:pnid:\${phoneNumberId}\`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // tenant_numbers mapea cada phone_number_id a su tenant.
  const tenant = await db.query(
    'SELECT tenant_id, status FROM tenant_numbers WHERE phone_number_id = $1',
    [phoneNumberId],
  ).then((r) => r.rows[0]);

  if (!tenant) return null; // numero no registrado: rechaza el evento.
  await redis.set(cacheKey, JSON.stringify(tenant), 'EX', TENANT_CACHE_TTL);
  return tenant;
}

async function handleWebhook(req, res) {
  // Responde 200 rapido; el enrutamiento y el trabajo pesado van fuera del request.
  res.sendStatus(200);

  const change = req.body?.entry?.[0]?.changes?.[0]?.value;
  const phoneNumberId = change?.metadata?.phone_number_id;
  if (!phoneNumberId) return;

  const tenant = await resolveTenant(phoneNumberId);
  if (!tenant || tenant.status !== 'active') {
    console.warn('Webhook sin tenant valido', { phoneNumberId });
    return; // nunca proceses sin tenant resuelto.
  }

  // Encola en la cola AISLADA del tenant, llevando el contexto adelante.
  await enqueueForTenant(tenant.tenant_id, change);
}`,
        },
        {
          type: 'diagram',
          value: `Meta (WhatsApp)
      |
      |  POST /webhook  (payload con phone_number_id)
      v
+----------------------------+
|     Endpoint webhook       |
|  1. responde 200           |
|  2. extrae phone_number_id |
|  3. resolveTenant()        |  --> cache Redis / tabla tenant_numbers
|  4. valida tenant activo   |
+----------------------------+
      |
      |  contexto { tenant_id }
      v
+----------------------------+      +----------------------------+
|  Cola del tenant A         |      |  Cola del tenant B         |
|  (queue:wa:tenantA)        |      |  (queue:wa:tenantB)        |
+----------------------------+      +----------------------------+
      |                                    |
      v                                    v
  Workers (siempre filtran por tenant_id en la base de datos)`,
        },
        {
          type: 'paragraph',
          value:
            'El contexto del tenant resuelto aqui debe viajar con el evento por todo el pipeline. Workers, queries y llamadas de envio siempre reciben el tenant_id de forma explicita. Resolver el tenant temprano y propagarlo es lo que impide que la logica posterior tenga que adivinar a quien pertenece el evento.',
        },
      ],
    },
    {
      title: 'Limites y cuotas por tenant',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En infraestructura compartida, el mayor riesgo operativo es el noisy neighbor: un tenant que dispara una campana masiva o entra en bucle y consume toda la capacidad, degradando a los demas. La defensa es imponer limites por tenant en varias capas, de modo que ningun cliente pueda monopolizar los recursos compartidos.',
        },
        {
          type: 'list',
          items: [
            'Rate limit por tenant: limite de peticiones por segundo aislado por tenant_id, con token bucket en Redis, para que el pico de uno no consuma la cuota global de Meta.',
            'Cuota de mensajes: techo diario o mensual por plan, contabilizado por tenant, con bloqueo o degradacion graciosa al alcanzar el limite.',
            'Cola aislada por tenant: colas separadas (o prioridad ponderada) para que el backlog de un tenant no retrase el procesamiento de los demas.',
            'Limite de concurrencia de workers: numero maximo de jobs simultaneos por tenant, evitando que un cliente domine el pool de workers.',
            'Cuota de almacenamiento y media: techo de uploads y retencion por tenant para contener costo y abuso.',
            'Circuit breaker por tenant: al detectar errores repetidos (ej.: plantilla invalida en masa), pausar el tenant especifico sin afectar a los demas.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La clave conceptual es que toda cuota lleva el tenant_id como dimension. Un rate limit global protege tu cuenta de Meta de ser bloqueada, pero no protege a los tenants entre si. Solo un limite por tenant garantiza aislamiento de rendimiento, que es tan importante como el aislamiento de datos en un SaaS.',
        },
      ],
    },
    {
      title: 'Gobernanza de configuracion por tenant',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cada tenant trae su propia configuracion: numeros, plantillas aprobadas, credenciales de Meta, integraciones y comportamiento de producto. Gobernar esto significa almacenar, versionar y resolver esas configuraciones por tenant de forma segura, sin hardcode y sin que la config de un cliente se filtre a otro.',
        },
        {
          type: 'list',
          items: [
            'Plantillas por tenant: cada cliente tiene su catalogo de plantillas aprobadas, con nombre, idioma y estado, aisladas por tenant_id; nunca asumas que una plantilla existe para todos.',
            'Credenciales aisladas: el access token y la WABA de cada tenant quedan cifrados en un vault (KMS / Secrets Manager), referenciados por tenant, nunca en variables de entorno compartidas.',
            'Feature flags por tenant: habilita recursos (IA, nuevo flujo, beta) por cliente o plan, permitiendo rollout gradual y planes diferenciados sin ramas de codigo.',
            'Webhooks de salida e integraciones: cada tenant configura sus propios destinos y secretos de firma, resueltos a partir del contexto del tenant.',
            'Branding y copy: saludos, menus y textos especificos por tenant, cargados por la misma capa de resolucion de config.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Trata la configuracion como dato de primera clase, con la misma disciplina de aislamiento que el resto. Una capa de resolucion de configuracion recibe el tenant_id y devuelve solo la config de ese tenant, con cache invalidable. Las credenciales nunca viajan en claro ni aparecen en logs.',
        },
      ],
    },
    {
      title: 'Seguridad y prevencion de fugas entre tenants',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En el modelo pool, la fuga entre tenants es el fallo mas grave posible: un filtro tenant_id olvidado en una query basta para que un cliente lea datos de otro. La defensa no puede depender de la disciplina manual de cada desarrollador; debe ser estructural, con capas que hagan la fuga dificil de introducir y facil de detectar.',
        },
        {
          type: 'ordered',
          items: [
            'Siempre filtrar por tenant_id: toda query de lectura y escritura incluye tenant_id en la clausula WHERE; nunca confies en un filtro implicito.',
            'Centralizar el acceso a datos: un repositorio o data layer que inyecta tenant_id automaticamente desde el contexto, eliminando la posibilidad de olvidar el filtro a mano.',
            'Aplicar Row-Level Security (RLS) en la base: politicas en Postgres que fuerzan el tenant_id a nivel del motor, como ultima barrera incluso si la aplicacion falla.',
            'Propagar el contexto del tenant: el tenant_id resuelto en el webhook viaja por todo el request, cola y worker; ninguna capa deduce el tenant por su cuenta.',
            'Cifrar y aislar credenciales: tokens por tenant en vault, nunca compartidos; la fuga de un secreto no debe dar acceso a otro tenant.',
            'Tests automatizados de aislamiento: suites que, con dos tenants poblados, intentan leer datos cruzados y fallan el build si ocurre cualquier fuga.',
            'Auditoria y logs con tenant_id: toda operacion registra el tenant, permitiendo rastrear y detectar accesos anomalos entre clientes.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El test de aislamiento merece destacarse: crear dos tenants, poblar datos en ambos y afirmar que ninguna operacion de uno ve al otro debe ser parte del pipeline de CI. Ese test es lo que convierte el aislamiento de una promesa en una garantia verificada en cada commit.',
        },
      ],
    },
    {
      title: 'Onboarding y ciclo de vida del tenant',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un SaaS multi-tenant necesita un proceso claro para crear, suspender y eliminar tenants. Un onboarding y offboarding mal hechos son fuentes silenciosas de fuga y de costo: datos huerfanos, numeros mal mapeados y credenciales que sobreviven al fin del contrato.',
        },
        {
          type: 'ordered',
          items: [
            'Aprovisionar el tenant: crear el registro, el storage segun el plan (row-level, schema o base) y el namespace de colas.',
            'Registrar numeros: mapear cada phone_number_id al tenant en la tabla de enrutamiento e invalidar el cache.',
            'Configurar credenciales y plantillas: almacenar tokens cifrados y sincronizar el catalogo de plantillas aprobadas de Meta.',
            'Aplicar limites del plan: definir rate limit, cuotas y flags segun el tier contratado.',
            'Suspender con seguridad: al impagar o pausar, marcar el tenant como inactivo para que el webhook rechace eventos sin borrar datos.',
            'Offboarding: exportar datos, revocar credenciales y eliminar storage de forma auditable al cerrar el contrato.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Tratar el ciclo de vida como un flujo explicito y versionado evita la acumulacion de tenants zombis. Cada estado (activo, suspendido, cerrado) tiene comportamiento definido en el enrutamiento y en los limites, y la transicion entre ellos es auditable.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Debo empezar con base por tenant o row-level con tenant_id?',
      answer:
        'Para la mayoria de los SaaS en etapa inicial, empieza con row-level usando tenant_id: el costo por tenant es bajo y el onboarding es instantaneo, lo que importa cuando aun estas validando el producto. Reserva base o schema por tenant para clientes enterprise con exigencias de compliance o aislamiento fisico, ofreciendolo como plan premium. Lo importante es disenar la aplicacion para tolerar ambos modelos desde el inicio, con el tenant_id propagado en todo el codigo, para que migrar un cliente especifico a un silo no exija reescritura.',
    },
    {
      question: 'Como sabe el webhook a que tenant pertenece cada mensaje?',
      answer:
        'Por el phone_number_id presente en el payload, en entry[].changes[].value.metadata.phone_number_id. Ese identificador es estable y unico por numero. Mantienes una tabla que mapea cada phone_number_id a su tenant y resuelves el tenant al inicio del procesamiento, idealmente con cache en Redis para evitar un hit a la base en cada evento. Si el phone_number_id no esta mapeado a ningun tenant activo, el evento debe rechazarse: nunca proceses un webhook sin tenant resuelto.',
    },
    {
      question: 'Como evito que un tenant degrade el rendimiento de los demas?',
      answer:
        'Aplicando limites por tenant en varias capas: rate limit por tenant_id con token bucket, cuota de mensajes por plan, colas aisladas (o con prioridad ponderada) y limite de concurrencia de workers por tenant. La idea central es que toda cuota lleve el tenant_id como dimension. Un limite global protege tu cuenta en Meta, pero no protege a los clientes entre si; solo los limites por tenant garantizan aislamiento de rendimiento y evitan el problema del noisy neighbor.',
    },
  ],
  conclusion: {
    title: 'Multi-tenant es aislamiento disenado, no improvisado',
    description:
      'Elegir el modelo de aislamiento correcto, enrutar webhooks por phone_number_id, imponer limites por tenant y probar el aislamiento en cada commit forman la columna vertebral de un SaaS de WhatsApp confiable y escalable. Si estas disenando o escalando una plataforma multi-tenant, puedo ayudar a disenar esta arquitectura.',
    cta: 'Hablar sobre mi plataforma',
  },
  related: [
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'Seguridad en integraciones Meta WhatsApp', to: '/blog/seguranca-integracoes-meta-whatsapp' },
    { label: 'Gobernanza de plantillas en equipos grandes', to: '/blog/governanca-templates-times-grandes' },
  ],
  repo: {
    name: 'whatsapp-multitenant-router',
    description:
      'Ejemplo de enrutamiento multi-tenant para WhatsApp: resolucion de tenant por phone_number_id, colas aisladas y limites por tenant.',
    url: 'https://github.com/joaosouz4dev/whatsapp-multitenant-router',
  },
};

export default { pt, en, es };
