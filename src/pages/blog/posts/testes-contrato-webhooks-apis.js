// Conteudo do artigo: Testes de contrato para webhooks e APIs.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections, faq, conclusion, related, repo }.

const pt = {
  intro:
    'A quebra mais perigosa em integração não dá erro: ela acontece em silêncio. ' +
    'Um parceiro muda um campo do payload, sobe uma versão da API e seu código continua ' +
    'rodando, só que processando dado errado ou ignorando o que mudou. Você descobre dias ' +
    'depois, pelo cliente. Teste de contrato existe para transformar essa mudança invisível ' +
    'em um teste vermelho no CI, antes do deploy. Este guia mostra como validar payloads ' +
    'de webhook contra schema, gravar contratos de APIs externas que você consome e detectar ' +
    'drift cedo, com profundidade de QA de integrações.',
  sections: [
    {
      title: 'O problema: a quebra que ninguém vê',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Integração saudável no deploy não garante integração saudável amanhã. O contrato ' +
            'com o parceiro é vivo: ele renomeia um campo, troca um número por string, adiciona ' +
            'um nível de aninhamento ou versiona a API inteira. Nada disso aparece no seu teste ' +
            'unitário, porque seu mock foi escrito uma vez e congelado. O resultado clássico é a ' +
            'quebra silenciosa: o webhook chega, seu parser não acha o campo esperado, grava null ' +
            'e segue em frente sem erro. Em produção, isso vira pedido sem valor, mensagem sem ' +
            'destinatário ou status que nunca atualiza, e você só percebe quando o cliente reclama.',
        },
        {
          type: 'paragraph',
          value:
            'Teste de contrato ataca exatamente essa cegueira. Em vez de confiar que o payload ' +
            'continua igual, você afirma o formato esperado de forma explícita e executável. ' +
            'Quando o parceiro muda, o teste falha de propósito, no CI, com a mudança apontada ' +
            'campo a campo, e não em produção três dias depois.',
        },
      ],
    },
    {
      title: 'Consumer-driven, provider e schema validation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existem três abordagens com nomes parecidos que resolvem problemas diferentes. ' +
            'Escolher errado gera teste que dá trabalho e não pega a regressão certa. A tabela ' +
            'abaixo separa o papel de cada uma no contexto de quem consome um parceiro externo.',
        },
        {
          type: 'table',
          columns: ['Abordagem', 'Quem define o contrato', 'O que pega', 'Quando usar'],
          rows: [
            ['Consumer-driven (ex. Pact)', 'O consumidor expressa o que precisa do provider', 'Provider quebra o que algum consumidor usa', 'Você é o provider e quer evitar quebrar clientes'],
            ['Provider contract', 'O provider publica o contrato (OpenAPI, AsyncAPI)', 'Consumidor desvia do contrato publicado', 'Parceiro tem spec formal e versionada'],
            ['Schema validation', 'Voce afirma o schema do payload que recebe', 'Payload real diverge do schema esperado', 'Parceiro externo sem spec ou que muda sem avisar'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Para quem integra com um parceiro grande (Meta, gateways de pagamento, ERPs), o caso ' +
            'mais comum é o terceiro: você não controla o provider e nem sempre ele publica spec ' +
            'confiável. Então a defesa prática é validar todo payload recebido contra um schema seu ' +
            'e gravar contratos das respostas que você consome para detectar drift.',
        },
      ],
    },
    {
      title: 'Validar o payload do webhook contra um schema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira linha de defesa é nunca processar um webhook sem antes validar a forma. ' +
            'Com zod você declara o contrato esperado e, no momento que o payload diverge, recebe ' +
            'um erro descritivo apontando o campo, em vez de um null silencioso lá na frente. ' +
            'Abaixo, um schema para o payload de mensagem recebida do WhatsApp Cloud API.',
        },
        {
          type: 'code',
          value: `// webhookSchema.js
const { z } = require('zod');

const messageSchema = z.object({
  from: z.string().min(8),
  id: z.string(),
  timestamp: z.string(),
  type: z.enum(['text', 'image', 'audio', 'document', 'interactive']),
  text: z.object({ body: z.string() }).optional(),
});

const valueSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({
    display_phone_number: z.string(),
    phone_number_id: z.string(),
  }),
  messages: z.array(messageSchema).optional(),
  statuses: z.array(z.object({ id: z.string(), status: z.string() })).optional(),
});

const webhookSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(z.object({
    id: z.string(),
    changes: z.array(z.object({
      field: z.literal('messages'),
      value: valueSchema,
    })),
  })).min(1),
});

module.exports = { webhookSchema };`,
        },
        {
          type: 'code',
          value: `// no handler do webhook
const { webhookSchema } = require('./webhookSchema');

app.post('/webhook', (req, res) => {
  const parsed = webhookSchema.safeParse(req.body);

  if (!parsed.success) {
    // contrato violado: registre, alerte, mas devolva 200
    // para o parceiro nao reenviar em loop por erro de forma
    logger.error('payload fora do contrato', {
      issues: parsed.error.issues,
    });
    metrics.increment('webhook.contract_violation');
    return res.sendStatus(200);
  }

  enqueue(parsed.data); // so dado valido entra na fila
  return res.sendStatus(200);
});`,
        },
        {
          type: 'paragraph',
          value:
            'O ponto fino: violação de contrato é diferente de erro de processamento. Devolva 200 ' +
            'para o parceiro não entrar em loop de reenvio, mas dispare métrica e alerta. Um pico ' +
            'em webhook.contract_violation logo após uma mudança do parceiro é o sinal mais cedo ' +
            'possível de que o payload mudou.',
        },
      ],
    },
    {
      title: 'Snapshot e contrato de APIs externas que você consome',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Validar o que entra resolve metade. A outra metade é o que você chama: quando você ' +
            'consome uma API externa, a resposta também tem contrato, e ele também muda. A tática ' +
            'é gravar a resposta esperada uma vez e comparar contra ela para detectar drift.',
        },
        {
          type: 'list',
          items: [
            'Grave um snapshot da resposta real do parceiro em ambiente controlado, mascarando dados sensíveis e timestamps voláteis.',
            'Em cada execução, valide a resposta atual contra o schema derivado do snapshot, não byte a byte, mas estrutura, tipos e campos obrigatórios.',
            'Trate campo novo como drift informativo (loga e segue) e campo removido ou tipo trocado como drift que quebra (falha o teste).',
            'Rode esses testes contra um sandbox ou contrato gravado, nunca contra produção do parceiro, para não depender da disponibilidade dele no CI.',
            'Versione os snapshots no repositório: o diff do snapshot no pull request vira documentação viva de como a API do parceiro evoluiu.',
          ],
        },
        {
          type: 'code',
          value: `// contractDrift.test.js
const { z } = require('zod');
const snapshot = require('./snapshots/order-response.json');

// schema derivado da resposta gravada
const orderSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'paid', 'failed']),
  amount: z.number(),
  currency: z.string().length(3),
});

test('resposta do parceiro continua dentro do contrato', async () => {
  // em CI: usa o snapshot; em job dedicado: bate no sandbox
  const response = process.env.HIT_SANDBOX
    ? await fetchFromSandbox()
    : snapshot;

  const result = orderSchema.safeParse(response);
  expect(result.success).toBe(true);
});`,
        },
      ],
    },
    {
      title: 'Versionamento e estratégia de migração',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Parceiros sérios versionam. A Graph API da Meta, por exemplo, expõe a versão na URL ' +
            '(/v21.0/) e deprecia versões antigas em janela conhecida. Tratar versão como detalhe ' +
            'escondido no código é receita para quebra na data de sunset. A migração tem que ser ' +
            'um processo, não um susto.',
        },
        {
          type: 'ordered',
          items: [
            'Fixe a versão explicitamente em um único lugar (variável de ambiente ou config), nunca espalhada por chamadas soltas no código.',
            'Mantenha um teste de contrato por versão ativa, para que a nova versão seja validada lado a lado com a atual antes de virar a chave.',
            'Quando o parceiro anunciar uma versão nova, suba um job que roda os contratos contra ela e mostra o diff de payload em relação à versão em uso.',
            'Faça a migração em canary: aponte uma fração do tráfego para a versão nova, observe métricas e contrato, e só então promova para 100%.',
            'Acompanhe a data de depreciação da versão antiga como item de backlog com prazo, e deixe o teste de contrato falhar de propósito quando faltar pouco para o sunset.',
          ],
        },
        {
          type: 'diagram',
          value:
            'Parceiro anuncia v(N+1)\n' +
            '        |\n' +
            '        v\n' +
            'Contrato v(N) [atual] ---+\n' +
            '                         |--> diff de payload --> revisão\n' +
            'Contrato v(N+1) [novo] --+\n' +
            '        |\n' +
            '        v\n' +
            'Canary 5% --> metricas ok? --> promove 100% --> deprecia v(N)',
        },
      ],
    },
    {
      title: 'Onde rodar: CI e antes do deploy',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Teste de contrato só reduz regressão se rodar no momento certo. Ele vive em dois ' +
            'lugares: no CI de todo pull request, validando schema de webhook e snapshots gravados ' +
            'sem depender do parceiro, e em um job agendado que bate no sandbox do parceiro para ' +
            'pegar mudanças que ainda não chegaram ao seu código.',
        },
        {
          type: 'list',
          items: [
            'No CI de pull request: valide schemas de webhook e snapshots gravados; rápido, determinístico e sem rede externa.',
            'Antes do deploy: o pipeline deve barrar a promoção se algum contrato estiver vermelho, tratando contrato quebrado como build quebrado.',
            'Em job agendado (nightly): bata no sandbox do parceiro para detectar drift que o snapshot ainda não capturou, e abra alerta quando divergir.',
            'Em produção: a validação do payload recebido continua ligada como última linha, emitindo métrica de violação de contrato em tempo real.',
          ],
        },
        {
          type: 'code',
          value: `# .github/workflows/contract.yml
name: contract-tests
on:
  pull_request:
  schedule:
    - cron: '0 6 * * *' # nightly contra o sandbox

jobs:
  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      # PR: snapshots e schemas, sem rede externa
      - run: npm run test:contract
      # nightly: bate no sandbox do parceiro
      - if: github.event_name == 'schedule'
        run: npm run test:contract:sandbox
        env:
          HIT_SANDBOX: 'true'`,
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Teste de contrato substitui meus testes de integração?',
      answer:
        'Não, eles cobrem coisas diferentes. O teste de integração verifica se o seu fluxo ' +
        'funciona fim a fim com um payload válido. O teste de contrato verifica se o payload do ' +
        'parceiro continua sendo o que você assumiu. Você pode ter integração verde e contrato ' +
        'vermelho ao mesmo tempo: é exatamente esse o caso da quebra silenciosa que o contrato pega.',
    },
    {
      question: 'Devo usar Pact ou só validação de schema com zod?',
      answer:
        'Depende de quem controla o contrato. Pact brilha em arquitetura interna de microserviços, ' +
        'onde você controla consumidor e provider e quer evitar quebrar clientes. Para um parceiro ' +
        'externo que você só consome, como a Cloud API da Meta, validação de schema com zod mais ' +
        'snapshots gravados costuma ser mais simples e direta, porque você não tem como impor um ' +
        'contrato ao provider, apenas afirmar o que espera dele.',
    },
    {
      question: 'Como evito que o teste de contrato fique instável por bater na API real?',
      answer:
        'Separe os dois modos. No CI de pull request, rode só contra snapshots gravados e schemas, ' +
        'sem rede externa, para ter um teste rápido e determinístico que nunca falha por o parceiro ' +
        'estar fora do ar. Deixe a chamada ao sandbox real em um job agendado à parte, cuja falha ' +
        'vira alerta de drift e não bloqueia o deploy de quem não mexeu na integração.',
    },
  ],
  conclusion: {
    title: 'Transforme a quebra silenciosa em teste vermelho',
    description:
      'A diferença entre descobrir uma mudança de payload no CI ou pelo cliente reclamando é ' +
      'ter o contrato escrito e executável. Valide todo webhook recebido contra um schema, grave ' +
      'snapshots das respostas que você consome para detectar drift e trate versão do parceiro ' +
      'como processo de migração com canary. Rode tudo no CI e antes do deploy. Posso ajudar a ' +
      'montar essa camada de QA de contrato na sua integração.',
    cta: 'Falar sobre testes de contrato na minha integração',
  },
  related: [
    { label: 'Webhook, idempotência e filas no WhatsApp', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Monitoramento e alertas em integrações', to: '/blog/monitoramento-alertas-integracoes' },
    { label: 'Fale comigo', to: '/contato' },
  ],
  repo: {
    name: 'webhook-contract-tests',
    description:
      'Exemplo de testes de contrato para webhooks e APIs: validação de payload com zod, ' +
      'snapshots de resposta para detectar drift e workflow de CI com job nightly no sandbox.',
    url: 'https://github.com/joaosouz4dev/webhook-contract-tests',
  },
};

const en = {
  intro:
    'The most dangerous integration break does not raise an error: it happens silently. ' +
    'A partner renames a payload field, ships a new API version, and your code keeps running, ' +
    'except now it processes the wrong data or ignores what changed. You find out days later, ' +
    'from the customer. Contract testing exists to turn that invisible change into a red test ' +
    'in CI, before the deploy. This guide shows how to validate webhook payloads against a ' +
    'schema, record contracts for the external APIs you consume and detect drift early, with ' +
    'integration QA depth.',
  sections: [
    {
      title: 'The problem: the break nobody sees',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A healthy integration at deploy time does not guarantee a healthy integration ' +
            'tomorrow. The contract with the partner is alive: they rename a field, swap a number ' +
            'for a string, add a nesting level or version the whole API. None of that shows up in ' +
            'your unit test, because your mock was written once and frozen. The classic result is ' +
            'the silent break: the webhook arrives, your parser does not find the expected field, ' +
            'writes null and moves on with no error. In production that becomes an order with no ' +
            'value, a message with no recipient or a status that never updates, and you only notice ' +
            'when the customer complains.',
        },
        {
          type: 'paragraph',
          value:
            'Contract testing attacks exactly that blindness. Instead of trusting that the payload ' +
            'stays the same, you assert the expected shape explicitly and executably. When the ' +
            'partner changes, the test fails on purpose, in CI, with the change pointed out field ' +
            'by field, not in production three days later.',
        },
      ],
    },
    {
      title: 'Consumer-driven, provider and schema validation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There are three approaches with similar names that solve different problems. Picking ' +
            'the wrong one gives you a test that is painful to maintain and does not catch the ' +
            'regression you care about. The table below separates each role in the context of ' +
            'consuming an external partner.',
        },
        {
          type: 'table',
          columns: ['Approach', 'Who defines the contract', 'What it catches', 'When to use'],
          rows: [
            ['Consumer-driven (e.g. Pact)', 'The consumer states what it needs from the provider', 'Provider breaks what some consumer uses', 'You are the provider and want to avoid breaking clients'],
            ['Provider contract', 'The provider publishes the contract (OpenAPI, AsyncAPI)', 'Consumer drifts from the published contract', 'Partner has a formal, versioned spec'],
            ['Schema validation', 'You assert the schema of the payload you receive', 'Real payload diverges from the expected schema', 'External partner with no spec or that changes silently'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'For anyone integrating with a large partner (Meta, payment gateways, ERPs), the most ' +
            'common case is the third: you do not control the provider and they do not always ' +
            'publish a reliable spec. So the practical defense is to validate every received ' +
            'payload against your own schema and record contracts of the responses you consume to ' +
            'detect drift.',
        },
      ],
    },
    {
      title: 'Validate the webhook payload against a schema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first line of defense is to never process a webhook without validating its shape ' +
            'first. With zod you declare the expected contract and, the moment the payload diverges, ' +
            'you get a descriptive error pointing at the field, instead of a silent null downstream. ' +
            'Below, a schema for the incoming message payload from the WhatsApp Cloud API.',
        },
        {
          type: 'code',
          value: `// webhookSchema.js
const { z } = require('zod');

const messageSchema = z.object({
  from: z.string().min(8),
  id: z.string(),
  timestamp: z.string(),
  type: z.enum(['text', 'image', 'audio', 'document', 'interactive']),
  text: z.object({ body: z.string() }).optional(),
});

const valueSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({
    display_phone_number: z.string(),
    phone_number_id: z.string(),
  }),
  messages: z.array(messageSchema).optional(),
  statuses: z.array(z.object({ id: z.string(), status: z.string() })).optional(),
});

const webhookSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(z.object({
    id: z.string(),
    changes: z.array(z.object({
      field: z.literal('messages'),
      value: valueSchema,
    })),
  })).min(1),
});

module.exports = { webhookSchema };`,
        },
        {
          type: 'code',
          value: `// inside the webhook handler
const { webhookSchema } = require('./webhookSchema');

app.post('/webhook', (req, res) => {
  const parsed = webhookSchema.safeParse(req.body);

  if (!parsed.success) {
    // contract violated: log, alert, but still return 200
    // so the partner does not retry in a loop over a shape error
    logger.error('payload outside the contract', {
      issues: parsed.error.issues,
    });
    metrics.increment('webhook.contract_violation');
    return res.sendStatus(200);
  }

  enqueue(parsed.data); // only valid data enters the queue
  return res.sendStatus(200);
});`,
        },
        {
          type: 'paragraph',
          value:
            'The subtle point: a contract violation is different from a processing error. Return ' +
            '200 so the partner does not enter a retry loop, but emit a metric and an alert. A spike ' +
            'in webhook.contract_violation right after a partner change is the earliest possible ' +
            'signal that the payload changed.',
        },
      ],
    },
    {
      title: 'Snapshot and contract of external APIs you consume',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Validating what comes in solves half of it. The other half is what you call: when you ' +
            'consume an external API, the response also has a contract, and it changes too. The ' +
            'tactic is to record the expected response once and compare against it to detect drift.',
        },
        {
          type: 'list',
          items: [
            'Record a snapshot of the partner real response in a controlled environment, masking sensitive data and volatile timestamps.',
            'On each run, validate the current response against the schema derived from the snapshot, not byte by byte, but structure, types and required fields.',
            'Treat a new field as informative drift (log and continue) and a removed field or changed type as breaking drift (fail the test).',
            'Run these tests against a sandbox or recorded contract, never against the partner production, so the CI does not depend on their availability.',
            'Version the snapshots in the repository: the snapshot diff in the pull request becomes living documentation of how the partner API evolved.',
          ],
        },
        {
          type: 'code',
          value: `// contractDrift.test.js
const { z } = require('zod');
const snapshot = require('./snapshots/order-response.json');

// schema derived from the recorded response
const orderSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'paid', 'failed']),
  amount: z.number(),
  currency: z.string().length(3),
});

test('partner response stays within the contract', async () => {
  // in CI: use the snapshot; in a dedicated job: hit the sandbox
  const response = process.env.HIT_SANDBOX
    ? await fetchFromSandbox()
    : snapshot;

  const result = orderSchema.safeParse(response);
  expect(result.success).toBe(true);
});`,
        },
      ],
    },
    {
      title: 'Versioning and migration strategy',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Serious partners version. The Meta Graph API, for example, exposes the version in the ' +
            'URL (/v21.0/) and deprecates old versions in a known window. Treating the version as a ' +
            'detail hidden in the code is a recipe for breaking on the sunset date. Migration has to ' +
            'be a process, not a scare.',
        },
        {
          type: 'ordered',
          items: [
            'Pin the version explicitly in a single place (environment variable or config), never scattered across loose calls in the code.',
            'Keep one contract test per active version, so the new version is validated side by side with the current one before flipping the switch.',
            'When the partner announces a new version, spin up a job that runs the contracts against it and shows the payload diff relative to the version in use.',
            'Migrate as a canary: route a fraction of traffic to the new version, watch metrics and contract, and only then promote to 100%.',
            'Track the old version deprecation date as a backlog item with a deadline, and let the contract test fail on purpose when the sunset is near.',
          ],
        },
        {
          type: 'diagram',
          value:
            'Partner announces v(N+1)\n' +
            '        |\n' +
            '        v\n' +
            'Contract v(N) [current] --+\n' +
            '                          |--> payload diff --> review\n' +
            'Contract v(N+1) [new] ----+\n' +
            '        |\n' +
            '        v\n' +
            'Canary 5% --> metrics ok? --> promote 100% --> deprecate v(N)',
        },
      ],
    },
    {
      title: 'Where to run it: CI and before deploy',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A contract test only reduces regressions if it runs at the right moment. It lives in ' +
            'two places: in the CI of every pull request, validating the webhook schema and recorded ' +
            'snapshots without depending on the partner, and in a scheduled job that hits the ' +
            'partner sandbox to catch changes that have not reached your code yet.',
        },
        {
          type: 'list',
          items: [
            'In pull request CI: validate webhook schemas and recorded snapshots; fast, deterministic and with no external network.',
            'Before deploy: the pipeline must block promotion if any contract is red, treating a broken contract as a broken build.',
            'In a scheduled (nightly) job: hit the partner sandbox to detect drift the snapshot has not captured yet, and raise an alert when it diverges.',
            'In production: validation of the received payload stays on as the last line, emitting a contract violation metric in real time.',
          ],
        },
        {
          type: 'code',
          value: `# .github/workflows/contract.yml
name: contract-tests
on:
  pull_request:
  schedule:
    - cron: '0 6 * * *' # nightly against the sandbox

jobs:
  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      # PR: snapshots and schemas, no external network
      - run: npm run test:contract
      # nightly: hit the partner sandbox
      - if: github.event_name == 'schedule'
        run: npm run test:contract:sandbox
        env:
          HIT_SANDBOX: 'true'`,
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does contract testing replace my integration tests?',
      answer:
        'No, they cover different things. The integration test verifies that your flow works end ' +
        'to end with a valid payload. The contract test verifies that the partner payload still is ' +
        'what you assumed. You can have a green integration and a red contract at the same time: ' +
        'that is exactly the silent break the contract catches.',
    },
    {
      question: 'Should I use Pact or just schema validation with zod?',
      answer:
        'It depends on who controls the contract. Pact shines in internal microservice ' +
        'architecture, where you control both consumer and provider and want to avoid breaking ' +
        'clients. For an external partner you only consume, like the Meta Cloud API, schema ' +
        'validation with zod plus recorded snapshots is usually simpler and more direct, because ' +
        'you cannot impose a contract on the provider, only assert what you expect from it.',
    },
    {
      question: 'How do I keep the contract test from being flaky by hitting the real API?',
      answer:
        'Separate the two modes. In pull request CI, run only against recorded snapshots and ' +
        'schemas, with no external network, for a fast and deterministic test that never fails ' +
        'because the partner is down. Keep the real sandbox call in a separate scheduled job, whose ' +
        'failure becomes a drift alert and does not block the deploy of anyone who did not touch the ' +
        'integration.',
    },
  ],
  conclusion: {
    title: 'Turn the silent break into a red test',
    description:
      'The difference between discovering a payload change in CI or from a complaining customer ' +
      'is having the contract written and executable. Validate every received webhook against a ' +
      'schema, record snapshots of the responses you consume to detect drift and treat the partner ' +
      'version as a migration process with canary. Run it all in CI and before deploy. I can help ' +
      'you build this contract QA layer into your integration.',
    cta: 'Talk about contract testing for my integration',
  },
  related: [
    { label: 'Webhook, idempotency and queues on WhatsApp', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Monitoring and alerts for integrations', to: '/blog/monitoramento-alertas-integracoes' },
    { label: 'Get in touch', to: '/contato' },
  ],
  repo: {
    name: 'webhook-contract-tests',
    description:
      'Example contract tests for webhooks and APIs: payload validation with zod, response ' +
      'snapshots to detect drift and a CI workflow with a nightly sandbox job.',
    url: 'https://github.com/joaosouz4dev/webhook-contract-tests',
  },
};

const es = {
  intro:
    'La ruptura más peligrosa en una integración no da error: ocurre en silencio. ' +
    'Un socio cambia un campo del payload, sube una versión de la API y tu código sigue ' +
    'corriendo, solo que ahora procesa el dato equivocado o ignora lo que cambió. Te enteras ' +
    'días después, por el cliente. La prueba de contrato existe para convertir ese cambio ' +
    'invisible en una prueba roja en el CI, antes del deploy. Esta guía muestra cómo validar ' +
    'payloads de webhook contra un schema, grabar contratos de las APIs externas que consumes ' +
    'y detectar drift temprano, con profundidad de QA de integraciones.',
  sections: [
    {
      title: 'El problema: la ruptura que nadie ve',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una integración sana en el deploy no garantiza una integración sana mañana. El ' +
            'contrato con el socio está vivo: renombra un campo, cambia un número por un string, ' +
            'agrega un nivel de anidamiento o versiona toda la API. Nada de eso aparece en tu prueba ' +
            'unitaria, porque tu mock se escribió una vez y quedó congelado. El resultado clásico es ' +
            'la ruptura silenciosa: el webhook llega, tu parser no encuentra el campo esperado, graba ' +
            'null y sigue sin error. En producción eso se vuelve un pedido sin valor, un mensaje sin ' +
            'destinatario o un estado que nunca actualiza, y solo te das cuenta cuando el cliente se queja.',
        },
        {
          type: 'paragraph',
          value:
            'La prueba de contrato ataca justamente esa ceguera. En lugar de confiar en que el ' +
            'payload sigue igual, afirmas la forma esperada de manera explícita y ejecutable. Cuando ' +
            'el socio cambia, la prueba falla a propósito, en el CI, con el cambio señalado campo por ' +
            'campo, y no en producción tres días después.',
        },
      ],
    },
    {
      title: 'Consumer-driven, provider y validación de schema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existen tres enfoques con nombres parecidos que resuelven problemas distintos. Elegir ' +
            'mal genera una prueba que cuesta mantener y no atrapa la regresión correcta. La tabla de ' +
            'abajo separa el papel de cada uno en el contexto de quien consume un socio externo.',
        },
        {
          type: 'table',
          columns: ['Enfoque', 'Quién define el contrato', 'Qué atrapa', 'Cuándo usar'],
          rows: [
            ['Consumer-driven (ej. Pact)', 'El consumidor expresa lo que necesita del provider', 'El provider rompe lo que algún consumidor usa', 'Eres el provider y quieres evitar romper clientes'],
            ['Provider contract', 'El provider publica el contrato (OpenAPI, AsyncAPI)', 'El consumidor se desvía del contrato publicado', 'El socio tiene una spec formal y versionada'],
            ['Validación de schema', 'Afirmas el schema del payload que recibes', 'El payload real difiere del schema esperado', 'Socio externo sin spec o que cambia sin avisar'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Para quien integra con un socio grande (Meta, pasarelas de pago, ERPs), el caso más ' +
            'común es el tercero: no controlas el provider y no siempre publica una spec confiable. ' +
            'Entonces la defensa práctica es validar todo payload recibido contra un schema tuyo y ' +
            'grabar contratos de las respuestas que consumes para detectar drift.',
        },
      ],
    },
    {
      title: 'Validar el payload del webhook contra un schema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La primera línea de defensa es nunca procesar un webhook sin antes validar su forma. ' +
            'Con zod declaras el contrato esperado y, en el momento en que el payload difiere, recibes ' +
            'un error descriptivo que señala el campo, en lugar de un null silencioso más adelante. ' +
            'Abajo, un schema para el payload de mensaje recibido del WhatsApp Cloud API.',
        },
        {
          type: 'code',
          value: `// webhookSchema.js
const { z } = require('zod');

const messageSchema = z.object({
  from: z.string().min(8),
  id: z.string(),
  timestamp: z.string(),
  type: z.enum(['text', 'image', 'audio', 'document', 'interactive']),
  text: z.object({ body: z.string() }).optional(),
});

const valueSchema = z.object({
  messaging_product: z.literal('whatsapp'),
  metadata: z.object({
    display_phone_number: z.string(),
    phone_number_id: z.string(),
  }),
  messages: z.array(messageSchema).optional(),
  statuses: z.array(z.object({ id: z.string(), status: z.string() })).optional(),
});

const webhookSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(z.object({
    id: z.string(),
    changes: z.array(z.object({
      field: z.literal('messages'),
      value: valueSchema,
    })),
  })).min(1),
});

module.exports = { webhookSchema };`,
        },
        {
          type: 'code',
          value: `// dentro del handler del webhook
const { webhookSchema } = require('./webhookSchema');

app.post('/webhook', (req, res) => {
  const parsed = webhookSchema.safeParse(req.body);

  if (!parsed.success) {
    // contrato violado: registra, alerta, pero devuelve 200
    // para que el socio no reintente en bucle por un error de forma
    logger.error('payload fuera del contrato', {
      issues: parsed.error.issues,
    });
    metrics.increment('webhook.contract_violation');
    return res.sendStatus(200);
  }

  enqueue(parsed.data); // solo dato valido entra en la cola
  return res.sendStatus(200);
});`,
        },
        {
          type: 'paragraph',
          value:
            'El punto fino: una violación de contrato es distinta de un error de procesamiento. ' +
            'Devuelve 200 para que el socio no entre en bucle de reintento, pero dispara una métrica ' +
            'y una alerta. Un pico en webhook.contract_violation justo después de un cambio del socio ' +
            'es la señal más temprana posible de que el payload cambió.',
        },
      ],
    },
    {
      title: 'Snapshot y contrato de APIs externas que consumes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Validar lo que entra resuelve la mitad. La otra mitad es lo que llamas: cuando consumes ' +
            'una API externa, la respuesta también tiene contrato, y también cambia. La táctica es ' +
            'grabar la respuesta esperada una vez y compararla para detectar drift.',
        },
        {
          type: 'list',
          items: [
            'Graba un snapshot de la respuesta real del socio en un entorno controlado, enmascarando datos sensibles y timestamps volátiles.',
            'En cada ejecución, valida la respuesta actual contra el schema derivado del snapshot, no byte a byte, sino estructura, tipos y campos obligatorios.',
            'Trata un campo nuevo como drift informativo (registra y sigue) y un campo eliminado o un tipo cambiado como drift que rompe (falla la prueba).',
            'Corre estas pruebas contra un sandbox o un contrato grabado, nunca contra la producción del socio, para que el CI no dependa de su disponibilidad.',
            'Versiona los snapshots en el repositorio: el diff del snapshot en el pull request se vuelve documentación viva de cómo evolucionó la API del socio.',
          ],
        },
        {
          type: 'code',
          value: `// contractDrift.test.js
const { z } = require('zod');
const snapshot = require('./snapshots/order-response.json');

// schema derivado de la respuesta grabada
const orderSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'paid', 'failed']),
  amount: z.number(),
  currency: z.string().length(3),
});

test('la respuesta del socio sigue dentro del contrato', async () => {
  // en CI: usa el snapshot; en un job dedicado: pega al sandbox
  const response = process.env.HIT_SANDBOX
    ? await fetchFromSandbox()
    : snapshot;

  const result = orderSchema.safeParse(response);
  expect(result.success).toBe(true);
});`,
        },
      ],
    },
    {
      title: 'Versionado y estrategia de migración',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Los socios serios versionan. La Graph API de Meta, por ejemplo, expone la versión en la ' +
            'URL (/v21.0/) y deprecia versiones antiguas en una ventana conocida. Tratar la versión ' +
            'como un detalle escondido en el código es receta para romperse en la fecha de sunset. La ' +
            'migración tiene que ser un proceso, no un susto.',
        },
        {
          type: 'ordered',
          items: [
            'Fija la versión de forma explícita en un único lugar (variable de entorno o config), nunca dispersa en llamadas sueltas en el código.',
            'Mantén una prueba de contrato por versión activa, para que la nueva versión se valide en paralelo con la actual antes de cambiar la llave.',
            'Cuando el socio anuncie una versión nueva, levanta un job que corre los contratos contra ella y muestra el diff de payload respecto a la versión en uso.',
            'Haz la migración en canary: dirige una fracción del tráfico a la versión nueva, observa métricas y contrato, y solo entonces promueve al 100%.',
            'Sigue la fecha de depreciación de la versión antigua como un ítem de backlog con plazo, y deja que la prueba de contrato falle a propósito cuando falte poco para el sunset.',
          ],
        },
        {
          type: 'diagram',
          value:
            'El socio anuncia v(N+1)\n' +
            '        |\n' +
            '        v\n' +
            'Contrato v(N) [actual] --+\n' +
            '                         |--> diff de payload --> revisión\n' +
            'Contrato v(N+1) [nuevo] -+\n' +
            '        |\n' +
            '        v\n' +
            'Canary 5% --> metricas ok? --> promueve 100% --> deprecia v(N)',
        },
      ],
    },
    {
      title: 'Dónde correrlo: CI y antes del deploy',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una prueba de contrato solo reduce regresiones si corre en el momento correcto. Vive en ' +
            'dos lugares: en el CI de todo pull request, validando el schema del webhook y los ' +
            'snapshots grabados sin depender del socio, y en un job agendado que pega al sandbox del ' +
            'socio para atrapar cambios que aún no llegaron a tu código.',
        },
        {
          type: 'list',
          items: [
            'En el CI del pull request: valida schemas de webhook y snapshots grabados; rápido, determinístico y sin red externa.',
            'Antes del deploy: el pipeline debe bloquear la promoción si algún contrato está en rojo, tratando un contrato roto como un build roto.',
            'En un job agendado (nightly): pega al sandbox del socio para detectar drift que el snapshot aún no capturó, y abre una alerta cuando difiera.',
            'En producción: la validación del payload recibido sigue activa como última línea, emitiendo una métrica de violación de contrato en tiempo real.',
          ],
        },
        {
          type: 'code',
          value: `# .github/workflows/contract.yml
name: contract-tests
on:
  pull_request:
  schedule:
    - cron: '0 6 * * *' # nightly contra el sandbox

jobs:
  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      # PR: snapshots y schemas, sin red externa
      - run: npm run test:contract
      # nightly: pega al sandbox del socio
      - if: github.event_name == 'schedule'
        run: npm run test:contract:sandbox
        env:
          HIT_SANDBOX: 'true'`,
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿La prueba de contrato reemplaza mis pruebas de integración?',
      answer:
        'No, cubren cosas distintas. La prueba de integración verifica que tu flujo funciona de ' +
        'punta a punta con un payload válido. La prueba de contrato verifica que el payload del ' +
        'socio sigue siendo lo que asumiste. Puedes tener la integración en verde y el contrato en ' +
        'rojo al mismo tiempo: ese es justamente el caso de la ruptura silenciosa que el contrato atrapa.',
    },
    {
      question: '¿Debo usar Pact o solo validación de schema con zod?',
      answer:
        'Depende de quién controla el contrato. Pact brilla en arquitectura interna de ' +
        'microservicios, donde controlas consumidor y provider y quieres evitar romper clientes. ' +
        'Para un socio externo que solo consumes, como la Cloud API de Meta, la validación de schema ' +
        'con zod más snapshots grabados suele ser más simple y directa, porque no puedes imponer un ' +
        'contrato al provider, solo afirmar lo que esperas de él.',
    },
    {
      question: '¿Cómo evito que la prueba de contrato sea inestable por pegar a la API real?',
      answer:
        'Separa los dos modos. En el CI del pull request, corre solo contra snapshots grabados y ' +
        'schemas, sin red externa, para tener una prueba rápida y determinística que nunca falla ' +
        'porque el socio esté caído. Deja la llamada al sandbox real en un job agendado aparte, cuya ' +
        'falla se vuelve una alerta de drift y no bloquea el deploy de quien no tocó la integración.',
    },
  ],
  conclusion: {
    title: 'Convierte la ruptura silenciosa en una prueba roja',
    description:
      'La diferencia entre descubrir un cambio de payload en el CI o por el cliente que se queja es ' +
      'tener el contrato escrito y ejecutable. Valida todo webhook recibido contra un schema, graba ' +
      'snapshots de las respuestas que consumes para detectar drift y trata la versión del socio como ' +
      'un proceso de migración con canary. Corre todo en el CI y antes del deploy. Puedo ayudarte a ' +
      'montar esa capa de QA de contrato en tu integración.',
    cta: 'Hablar sobre pruebas de contrato en mi integración',
  },
  related: [
    { label: 'Webhook, idempotencia y colas en WhatsApp', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Monitoreo y alertas en integraciones', to: '/blog/monitoramento-alertas-integracoes' },
    { label: 'Hablemos', to: '/contato' },
  ],
  repo: {
    name: 'webhook-contract-tests',
    description:
      'Ejemplo de pruebas de contrato para webhooks y APIs: validación de payload con zod, ' +
      'snapshots de respuesta para detectar drift y un workflow de CI con un job nightly en el sandbox.',
    url: 'https://github.com/joaosouz4dev/webhook-contract-tests',
  },
};

export default { pt, en, es };
