// Conteudo do artigo: guia-whatsapp-cloud-api
// Estrutura: { pt, en, es }, cada idioma com { intro, sections, faq, conclusion, related, repo }

const pt = {
  intro:
    'Um guia de produção para integrar a WhatsApp Cloud API: quando usá-la em vez de soluções não oficiais, a arquitetura recomendada (webhook, fila, worker, CRM/IA, observabilidade), webhook seguro com verificação HMAC e idempotência, governança de templates e um checklist de deploy.',
  sections: [
    {
      title: 'Cloud API vs solução não oficial: quando escolher cada uma',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A WhatsApp Cloud API é a API oficial hospedada pela Meta. Você fala com endpoints em graph.facebook.com, recebe eventos por webhook e opera dentro das políticas da plataforma. Soluções não oficiais (libs que automatizam o WhatsApp Web) prometem custo zero de conversa, mas operam fora dos termos e quebram a cada atualização do cliente.',
        },
        {
          type: 'paragraph',
          value:
            'A regra prática: se o número representa uma empresa, processa volume relevante ou precisa de previsibilidade, use a Cloud API. O risco de banimento de uma solução não oficial não é teórico, é uma questão de quando, e o prejuízo de perder o número principal supera de longe a economia de mensagem.',
        },
        {
          type: 'table',
          columns: ['Critério', 'Cloud API (oficial)', 'Não oficial'],
          rows: [
            ['Estabilidade', 'Alta, contrato de API versionado', 'Quebra a cada update do WhatsApp Web'],
            ['Risco de ban', 'Baixo dentro das políticas', 'Alto, viola os termos de uso'],
            ['Escala', 'Throughput negociável (tiers)', 'Limitado por sessão única'],
            ['Templates e botões', 'Suporte nativo', 'Parcial ou frágil'],
            ['Custo', 'Por conversa iniciada', 'Aparentemente zero, risco oculto'],
            ['SLA e suporte', 'BSP e Meta', 'Comunidade, sem garantia'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Use não oficial apenas em provas de conceito descartáveis ou números secundários que você pode perder sem impacto. Para qualquer fluxo que sustente receita ou atendimento, Cloud API.',
        },
      ],
    },
    {
      title: 'Arquitetura recomendada de produção',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro mais comum é processar o webhook de forma síncrona: receber o POST, chamar a IA, gravar no CRM e só então responder 200 à Meta. Isso acopla a latência do seu pipeline ao timeout do webhook. A Meta espera resposta rápida e reentrega o evento se você demorar, gerando duplicatas. A solução é desacoplar: o endpoint só valida, persiste e enfileira; o trabalho pesado roda em workers.',
        },
        {
          type: 'diagram',
          value: `  WhatsApp / Meta
        |
        v  POST (x-hub-signature-256)
  +-----------------+
  | Webhook (HTTP)  |  valida HMAC + idempotencia
  +-----------------+
        | enfileira (event_id)
        v
  +-----------------+
  |  Fila (Redis /  |
  |  SQS / Rabbit)  |
  +-----------------+
        | consome
        v
  +-----------------+      +-------------+
  |     Worker      |----->|  IA / RAG   |
  | (lógica, retry) |<-----|  (intent)   |
  +-----------------+      +-------------+
        |        \\
        v         v
  +---------+   +-------------------+
  |  CRM /  |   | Observabilidade   |
  |  ERP    |   | (logs, métricas,  |
  +---------+   | traces, alertas)  |
                +-------------------+`,
        },
        {
          type: 'list',
          items: [
            'Webhook: superfície fina, sem regra de negócio. Valida assinatura, deduplica por message id e responde 200 em milissegundos.',
            'Fila: absorve picos de campanha e isola falhas do worker do recebimento. Reentrega controlada com backoff, não pela Meta.',
            'Worker: idempotente, com retry e dead-letter queue. Aqui vive a orquestração com IA, CRM e regras.',
            'CRM/IA: integrações externas tratadas como instáveis. Timeout curto, circuit breaker e fallback para handoff humano.',
            'Observabilidade: correlação por message id em todo o caminho, métricas de latência por etapa e alertas sobre taxa de erro e profundidade da fila.',
          ],
        },
      ],
    },
    {
      title: 'Webhook seguro: assinatura HMAC e idempotência',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo POST da Meta traz o header x-hub-signature-256, um HMAC SHA-256 do corpo bruto usando o App Secret. Você precisa validar isso sobre o body cru (não o JSON já parseado), com comparação em tempo constante. Sem essa verificação, qualquer um que descubra a URL pode injetar eventos falsos.',
        },
        {
          type: 'paragraph',
          value:
            'O segundo pilar é idempotência. A Meta pode reentregar o mesmo evento (timeout, retry interno). Cada mensagem traz um id único; registre-o em um store com TTL antes de enfileirar e descarte duplicatas. Assim o mesmo evento nunca dispara duas respostas ou duas escritas no CRM.',
        },
        {
          type: 'code',
          value: `// server.js - webhook WhatsApp Cloud API (Node.js / Express)
const express = require('express');
const crypto = require('crypto');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL);
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

const app = express();

// IMPORTANTE: capturar o corpo BRUTO para validar o HMAC.
// O JSON re-serializado nao bate byte a byte com o assinado pela Meta.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Comparacao em tempo constante para evitar timing attacks.
function isValidSignature(req) {
  const header = req.get('x-hub-signature-256');
  if (!header || !req.rawBody) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Idempotencia: registra o message id com TTL; retorna false se ja visto.
async function markIfNew(messageId) {
  // SET key value NX EX 86400 -> grava so se nao existir, expira em 24h.
  const result = await redis.set(\`wa:msg:\${messageId}\`, '1', 'EX', 86400, 'NX');
  return result === 'OK';
}

// Handshake de verificacao (GET) exigido pela Meta ao configurar a URL.
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recebimento de eventos (POST).
app.post('/webhook', async (req, res) => {
  if (!isValidSignature(req)) {
    return res.sendStatus(401);
  }

  // Responde rapido: a Meta reentrega se houver demora. Processamento e assincrono.
  res.sendStatus(200);

  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const messages = change.value?.messages || [];
        for (const message of messages) {
          const isNew = await markIfNew(message.id);
          if (!isNew) continue; // duplicata: ignora

          // Enfileira para o worker. O endpoint nao executa regra de negocio.
          await redis.lpush(
            'wa:incoming',
            JSON.stringify({
              messageId: message.id,
              from: message.from,
              type: message.type,
              text: message.text?.body,
              timestamp: message.timestamp,
            })
          );
        }
      }
    }
  } catch (err) {
    // Ja respondemos 200; logamos e deixamos o reprocessamento a cargo do worker/DLQ.
    console.error('webhook processing error', err);
  }
});

app.listen(process.env.PORT || 3000);`,
        },
      ],
    },
    {
      title: 'Templates, opt-in e qualidade do número',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Fora da janela de 24 horas de atendimento, você só pode iniciar conversa com Message Templates aprovados pela Meta. Categorize corretamente (marketing, utility, authentication): a categoria afeta custo e nível de escrutínio. Templates de marketing enviados sem opt-in claro derrubam o quality rating do número e podem disparar limitação de envio.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Boa prática', 'Risco se ignorar'],
          rows: [
            ['Opt-in', 'Consentimento explícito e registrado por usuário', 'Bloqueios em massa, queda de qualidade'],
            ['Categoria', 'Classificar utility vs marketing corretamente', 'Rejeição do template ou cobrança errada'],
            ['Janela 24h', 'Texto livre só dentro da sessão aberta', 'Mensagem não entregue fora da janela'],
            ['Quality rating', 'Monitorar verde/amarelo/vermelho via API', 'Rebaixamento de tier e limite de envio'],
            ['Variáveis', 'Validar placeholders {{1}} antes de enviar', 'Falha de render ou reprovação na revisão'],
            ['Frequência', 'Respeitar cadência e botão de descadastro', 'Marcação como spam pelos usuários'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Trate o quality rating como um SLO. Consulte-o periodicamente, registre quedas e correlacione com campanhas recentes. Um número rebaixado para tier inferior limita quantos usuários novos você alcança por dia, o que pode travar uma operação inteira em pleno horário de pico.',
        },
      ],
    },
    {
      title: 'Worker idempotente e tratamento de falhas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O worker consome a fila e executa a orquestração: classificar intenção (com IA ou regras), buscar contexto no CRM, gerar resposta e enviar via API de mensagens. Cada passo pode falhar de forma independente, então o worker precisa ser idempotente e ter política de retry com backoff, além de uma dead-letter queue para eventos que esgotam tentativas.',
        },
        {
          type: 'ordered',
          items: [
            'Despacha a mensagem da fila e revalida idempotência pela chave de processamento (não só de recebimento).',
            'Classifica intenção e decide o caminho: resposta automática, busca em base de conhecimento ou handoff humano.',
            'Chama integrações externas com timeout curto e circuit breaker; falha ali não pode travar a fila inteira.',
            'Envia a resposta via Graph API e persiste o resultado no CRM dentro de uma operação idempotente.',
            'Em erro recuperável, reenfileira com backoff exponencial; após N tentativas, move para a DLQ e alerta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O envio de mensagem em si também pode falhar (rate limit, número inválido, janela fechada). Trate o retorno da API: distinga erros transitórios (retry) de permanentes (descarta e registra). Nunca faça retry cego de um erro permanente, isso só queima quota e polui a fila.',
        },
      ],
    },
    {
      title: 'Checklist de deploy',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de apontar a URL de webhook para produção, percorra esta sequência. A ordem importa: segredos e validação primeiro, depois conectividade, por último o tráfego real.',
        },
        {
          type: 'ordered',
          items: [
            'App Secret, Verify Token e Access Token armazenados em secret manager, nunca em código ou repositório.',
            'HTTPS válido na URL de webhook (a Meta exige TLS) e handshake GET respondendo com o hub.challenge.',
            'Validação de x-hub-signature-256 ativa e testada com um payload assinado real, rejeitando assinatura inválida.',
            'Idempotência funcionando: reenviar o mesmo evento não gera resposta nem escrita duplicada.',
            'Fila e workers provisionados com escala mínima dimensionada para pico de campanha, não para a média.',
            'Dead-letter queue configurada e com alerta quando recebe eventos.',
            'Observabilidade: logs correlacionados por message id, métricas de latência por etapa e profundidade da fila.',
            'Templates aprovados, categorizados e com opt-in registrado para os fluxos que iniciam conversa.',
            'Alertas sobre queda do quality rating e sobre erros de envio acima do limiar.',
            'Plano de rollback e runbook de incidente: como pausar envios e drenar a fila com segurança.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Preciso de um BSP (Business Solution Provider) para usar a Cloud API?',
      answer:
        'Não obrigatoriamente. A Cloud API pode ser usada direto via Meta, com onboarding pelo Meta Business e WhatsApp Manager. Um BSP agrega faturamento consolidado, suporte e ferramentas, mas você consegue rodar em produção sem ele, especialmente em operações de menor porte.',
    },
    {
      question: 'Por que validar o HMAC sobre o corpo bruto e não sobre o JSON parseado?',
      answer:
        'Porque a assinatura é calculada sobre os bytes exatos enviados pela Meta. Ao parsear e re-serializar o JSON, a ordem das chaves e a formatação podem mudar, e o HMAC recalculado não bate. Por isso capturamos o rawBody no momento do parse e validamos sobre ele.',
    },
    {
      question: 'O que acontece se eu demorar para responder 200 ao webhook?',
      answer:
        'A Meta considera o evento não entregue e o reenvia, gerando duplicatas. Por isso o endpoint deve responder 200 imediatamente após validar e enfileirar, deixando o processamento pesado para o worker. A idempotência protege contra as reentregas que ainda assim ocorrerem.',
    },
  ],
  conclusion: {
    title: 'Quer essa arquitetura rodando no seu número?',
    description:
      'Implemento integrações WhatsApp Cloud API de ponta a ponta: webhook seguro, filas, workers idempotentes, orquestração com IA e observabilidade. Se você precisa migrar de uma solução não oficial ou estruturar do zero, vamos conversar.',
    cta: 'Falar sobre meu projeto',
  },
  related: [
    { label: 'Webhook do WhatsApp: idempotência e filas', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Serviço: WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'Segurança em integrações Meta e WhatsApp', to: '/blog/seguranca-integracoes-meta-whatsapp' },
  ],
  repo: {
    name: 'whatsapp-cloud-api-starter',
    description: 'Starter de produção em Node.js com webhook seguro (HMAC + idempotência), fila e worker.',
    url: 'https://github.com/joaosouz4dev/whatsapp-cloud-api-starter',
  },
};

const en = {
  intro:
    'A production guide to integrating the WhatsApp Cloud API: when to use it instead of unofficial solutions, the recommended architecture (webhook, queue, worker, CRM/AI, observability), a secure webhook with HMAC verification and idempotency, template governance and a deployment checklist.',
  sections: [
    {
      title: 'Cloud API vs unofficial solution: when to choose each',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The WhatsApp Cloud API is the official API hosted by Meta. You talk to endpoints on graph.facebook.com, receive events through a webhook and operate inside the platform policies. Unofficial solutions (libraries that automate WhatsApp Web) promise zero conversation cost, but operate outside the terms and break with every client update.',
        },
        {
          type: 'paragraph',
          value:
            'The practical rule: if the number represents a business, processes meaningful volume or needs predictability, use the Cloud API. The ban risk of an unofficial solution is not theoretical, it is a matter of when, and losing your main number costs far more than the message savings.',
        },
        {
          type: 'table',
          columns: ['Criterion', 'Cloud API (official)', 'Unofficial'],
          rows: [
            ['Stability', 'High, versioned API contract', 'Breaks with every WhatsApp Web update'],
            ['Ban risk', 'Low within the policies', 'High, violates the terms of use'],
            ['Scale', 'Negotiable throughput (tiers)', 'Limited by a single session'],
            ['Templates and buttons', 'Native support', 'Partial or fragile'],
            ['Cost', 'Per initiated conversation', 'Seemingly zero, hidden risk'],
            ['SLA and support', 'BSP and Meta', 'Community, no guarantee'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Use unofficial only for disposable proofs of concept or secondary numbers you can afford to lose. For any flow that sustains revenue or support, Cloud API.',
        },
      ],
    },
    {
      title: 'Recommended production architecture',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common mistake is processing the webhook synchronously: receive the POST, call the AI, write to the CRM and only then return 200 to Meta. That couples your pipeline latency to the webhook timeout. Meta expects a fast reply and redelivers the event if you take too long, producing duplicates. The fix is to decouple: the endpoint only validates, persists and enqueues; the heavy work runs in workers.',
        },
        {
          type: 'diagram',
          value: `  WhatsApp / Meta
        |
        v  POST (x-hub-signature-256)
  +-----------------+
  | Webhook (HTTP)  |  validate HMAC + idempotency
  +-----------------+
        | enqueue (event_id)
        v
  +-----------------+
  |  Queue (Redis / |
  |  SQS / Rabbit)  |
  +-----------------+
        | consume
        v
  +-----------------+      +-------------+
  |     Worker      |----->|  AI / RAG   |
  | (logic, retry)  |<-----|  (intent)   |
  +-----------------+      +-------------+
        |        \\
        v         v
  +---------+   +-------------------+
  |  CRM /  |   | Observability     |
  |  ERP    |   | (logs, metrics,   |
  +---------+   | traces, alerts)   |
                +-------------------+`,
        },
        {
          type: 'list',
          items: [
            'Webhook: thin surface, no business rules. It validates the signature, deduplicates by message id and returns 200 in milliseconds.',
            'Queue: absorbs campaign spikes and isolates worker failures from receiving. Controlled redelivery with backoff, not from Meta.',
            'Worker: idempotent, with retry and a dead-letter queue. This is where orchestration with AI, CRM and rules lives.',
            'CRM/AI: external integrations treated as unstable. Short timeout, circuit breaker and fallback to human handoff.',
            'Observability: correlation by message id along the whole path, per-stage latency metrics and alerts on error rate and queue depth.',
          ],
        },
      ],
    },
    {
      title: 'Secure webhook: HMAC signature and idempotency',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Every POST from Meta carries the x-hub-signature-256 header, an HMAC SHA-256 of the body using the App Secret. You must validate it over the raw body (not the already parsed JSON), with a constant-time comparison. Without this check, anyone who discovers the URL can inject fake events.',
        },
        {
          type: 'paragraph',
          value:
            'The second pillar is idempotency. Meta may redeliver the same event (timeout, internal retry). Each message carries a unique id; record it in a store with TTL before enqueuing and discard duplicates. That way the same event never triggers two replies or two CRM writes.',
        },
        {
          type: 'code',
          value: `// server.js - WhatsApp Cloud API webhook (Node.js / Express)
const express = require('express');
const crypto = require('crypto');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL);
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

const app = express();

// IMPORTANT: capture the RAW body to validate the HMAC.
// The re-serialized JSON will not match byte for byte what Meta signed.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Constant-time comparison to avoid timing attacks.
function isValidSignature(req) {
  const header = req.get('x-hub-signature-256');
  if (!header || !req.rawBody) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Idempotency: records the message id with TTL; returns false if already seen.
async function markIfNew(messageId) {
  // SET key value NX EX 86400 -> write only if absent, expires in 24h.
  const result = await redis.set(\`wa:msg:\${messageId}\`, '1', 'EX', 86400, 'NX');
  return result === 'OK';
}

// Verification handshake (GET) required by Meta when configuring the URL.
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Event reception (POST).
app.post('/webhook', async (req, res) => {
  if (!isValidSignature(req)) {
    return res.sendStatus(401);
  }

  // Reply fast: Meta redelivers if you are slow. Processing is asynchronous.
  res.sendStatus(200);

  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const messages = change.value?.messages || [];
        for (const message of messages) {
          const isNew = await markIfNew(message.id);
          if (!isNew) continue; // duplicate: skip

          // Enqueue for the worker. The endpoint runs no business rule.
          await redis.lpush(
            'wa:incoming',
            JSON.stringify({
              messageId: message.id,
              from: message.from,
              type: message.type,
              text: message.text?.body,
              timestamp: message.timestamp,
            })
          );
        }
      }
    }
  } catch (err) {
    // We already returned 200; we log and leave reprocessing to the worker/DLQ.
    console.error('webhook processing error', err);
  }
});

app.listen(process.env.PORT || 3000);`,
        },
      ],
    },
    {
      title: 'Templates, opt-in and number quality',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Outside the 24-hour service window, you can only start a conversation with Message Templates approved by Meta. Categorize them correctly (marketing, utility, authentication): the category affects cost and scrutiny level. Marketing templates sent without clear opt-in drag down the number quality rating and can trigger sending limits.',
        },
        {
          type: 'table',
          columns: ['Aspect', 'Best practice', 'Risk if ignored'],
          rows: [
            ['Opt-in', 'Explicit consent recorded per user', 'Mass blocks, quality drop'],
            ['Category', 'Classify utility vs marketing correctly', 'Template rejection or wrong billing'],
            ['24h window', 'Free text only within the open session', 'Message not delivered outside the window'],
            ['Quality rating', 'Monitor green/yellow/red via API', 'Tier downgrade and sending limit'],
            ['Variables', 'Validate {{1}} placeholders before sending', 'Render failure or review rejection'],
            ['Frequency', 'Respect cadence and an opt-out button', 'Users marking it as spam'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Treat the quality rating as an SLO. Check it periodically, log drops and correlate them with recent campaigns. A number downgraded to a lower tier limits how many new users you can reach per day, which can stall an entire operation right at peak hours.',
        },
      ],
    },
    {
      title: 'Idempotent worker and failure handling',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The worker consumes the queue and runs the orchestration: classify intent (with AI or rules), fetch context from the CRM, generate a reply and send it through the messaging API. Each step can fail independently, so the worker must be idempotent and have a retry policy with backoff, plus a dead-letter queue for events that exhaust attempts.',
        },
        {
          type: 'ordered',
          items: [
            'Dispatches the message from the queue and re-validates idempotency by the processing key (not just the receiving one).',
            'Classifies intent and decides the path: automatic reply, knowledge base lookup or human handoff.',
            'Calls external integrations with a short timeout and circuit breaker; a failure there must not stall the whole queue.',
            'Sends the reply through the Graph API and persists the result in the CRM within an idempotent operation.',
            'On a recoverable error, requeues with exponential backoff; after N attempts, moves to the DLQ and alerts.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Sending the message itself can also fail (rate limit, invalid number, closed window). Handle the API response: distinguish transient errors (retry) from permanent ones (discard and log). Never blindly retry a permanent error, that only burns quota and pollutes the queue.',
        },
      ],
    },
    {
      title: 'Deployment checklist',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before pointing the webhook URL at production, walk through this sequence. Order matters: secrets and validation first, then connectivity, real traffic last.',
        },
        {
          type: 'ordered',
          items: [
            'App Secret, Verify Token and Access Token stored in a secret manager, never in code or the repository.',
            'Valid HTTPS on the webhook URL (Meta requires TLS) and the GET handshake answering with the hub.challenge.',
            'x-hub-signature-256 validation enabled and tested with a real signed payload, rejecting an invalid signature.',
            'Idempotency working: resending the same event produces no duplicate reply or write.',
            'Queue and workers provisioned with minimum scale sized for the campaign peak, not the average.',
            'Dead-letter queue configured and alerting when it receives events.',
            'Observability: logs correlated by message id, per-stage latency metrics and queue depth.',
            'Templates approved, categorized and with opt-in recorded for the flows that start conversations.',
            'Alerts on quality rating drops and on send errors above the threshold.',
            'Rollback plan and incident runbook: how to pause sends and drain the queue safely.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Do I need a BSP (Business Solution Provider) to use the Cloud API?',
      answer:
        'Not necessarily. The Cloud API can be used directly through Meta, with onboarding via Meta Business and WhatsApp Manager. A BSP adds consolidated billing, support and tooling, but you can run in production without one, especially for smaller operations.',
    },
    {
      question: 'Why validate the HMAC over the raw body and not the parsed JSON?',
      answer:
        'Because the signature is computed over the exact bytes Meta sent. When you parse and re-serialize the JSON, key order and formatting may change, and the recomputed HMAC will not match. That is why we capture the rawBody at parse time and validate over it.',
    },
    {
      question: 'What happens if I am slow to return 200 to the webhook?',
      answer:
        'Meta treats the event as undelivered and resends it, producing duplicates. That is why the endpoint must return 200 immediately after validating and enqueuing, leaving the heavy processing to the worker. Idempotency protects against the redeliveries that still occur.',
    },
  ],
  conclusion: {
    title: 'Want this architecture running on your number?',
    description:
      'I build end-to-end WhatsApp Cloud API integrations: secure webhook, queues, idempotent workers, AI orchestration and observability. If you need to migrate from an unofficial solution or build from scratch, let us talk.',
    cta: 'Talk about my project',
  },
  related: [
    { label: 'WhatsApp webhook: idempotency and queues', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Service: WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'Security in Meta and WhatsApp integrations', to: '/blog/seguranca-integracoes-meta-whatsapp' },
  ],
  repo: {
    name: 'whatsapp-cloud-api-starter',
    description: 'Production starter in Node.js with a secure webhook (HMAC + idempotency), queue and worker.',
    url: 'https://github.com/joaosouz4dev/whatsapp-cloud-api-starter',
  },
};

const es = {
  intro:
    'Una guía de producción para integrar la WhatsApp Cloud API: cuándo usarla en lugar de soluciones no oficiales, la arquitectura recomendada (webhook, cola, worker, CRM/IA, observabilidad), un webhook seguro con verificación HMAC e idempotencia, gobernanza de plantillas y un checklist de despliegue.',
  sections: [
    {
      title: 'Cloud API vs solución no oficial: cuándo elegir cada una',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La WhatsApp Cloud API es la API oficial alojada por Meta. Hablas con endpoints en graph.facebook.com, recibes eventos por webhook y operas dentro de las políticas de la plataforma. Las soluciones no oficiales (librerías que automatizan WhatsApp Web) prometen costo cero de conversación, pero operan fuera de los términos y se rompen con cada actualización del cliente.',
        },
        {
          type: 'paragraph',
          value:
            'La regla práctica: si el número representa a una empresa, procesa volumen relevante o necesita previsibilidad, usa la Cloud API. El riesgo de baneo de una solución no oficial no es teórico, es cuestión de cuándo, y perder el número principal cuesta mucho más que el ahorro por mensaje.',
        },
        {
          type: 'table',
          columns: ['Criterio', 'Cloud API (oficial)', 'No oficial'],
          rows: [
            ['Estabilidad', 'Alta, contrato de API versionado', 'Se rompe con cada update de WhatsApp Web'],
            ['Riesgo de baneo', 'Bajo dentro de las políticas', 'Alto, viola los términos de uso'],
            ['Escala', 'Throughput negociable (tiers)', 'Limitado por sesión única'],
            ['Plantillas y botones', 'Soporte nativo', 'Parcial o frágil'],
            ['Costo', 'Por conversación iniciada', 'Aparentemente cero, riesgo oculto'],
            ['SLA y soporte', 'BSP y Meta', 'Comunidad, sin garantía'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Usa no oficial solo en pruebas de concepto desechables o números secundarios que puedas perder sin impacto. Para cualquier flujo que sostenga ingresos o atención, Cloud API.',
        },
      ],
    },
    {
      title: 'Arquitectura recomendada de producción',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error más común es procesar el webhook de forma síncrona: recibir el POST, llamar a la IA, escribir en el CRM y solo entonces responder 200 a Meta. Eso acopla la latencia de tu pipeline al timeout del webhook. Meta espera una respuesta rápida y reentrega el evento si tardas, generando duplicados. La solución es desacoplar: el endpoint solo valida, persiste y encola; el trabajo pesado corre en workers.',
        },
        {
          type: 'diagram',
          value: `  WhatsApp / Meta
        |
        v  POST (x-hub-signature-256)
  +-----------------+
  | Webhook (HTTP)  |  valida HMAC + idempotencia
  +-----------------+
        | encola (event_id)
        v
  +-----------------+
  |  Cola (Redis /  |
  |  SQS / Rabbit)  |
  +-----------------+
        | consume
        v
  +-----------------+      +-------------+
  |     Worker      |----->|  IA / RAG   |
  | (lógica, retry) |<-----|  (intent)   |
  +-----------------+      +-------------+
        |        \\
        v         v
  +---------+   +-------------------+
  |  CRM /  |   | Observabilidad    |
  |  ERP    |   | (logs, métricas,  |
  +---------+   | traces, alertas)  |
                +-------------------+`,
        },
        {
          type: 'list',
          items: [
            'Webhook: superficie fina, sin regla de negocio. Valida la firma, deduplica por message id y responde 200 en milisegundos.',
            'Cola: absorbe picos de campaña y aísla las fallas del worker de la recepción. Reentrega controlada con backoff, no por Meta.',
            'Worker: idempotente, con retry y dead-letter queue. Aquí vive la orquestación con IA, CRM y reglas.',
            'CRM/IA: integraciones externas tratadas como inestables. Timeout corto, circuit breaker y fallback a handoff humano.',
            'Observabilidad: correlación por message id en todo el camino, métricas de latencia por etapa y alertas sobre tasa de error y profundidad de la cola.',
          ],
        },
      ],
    },
    {
      title: 'Webhook seguro: firma HMAC e idempotencia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cada POST de Meta trae el header x-hub-signature-256, un HMAC SHA-256 del cuerpo usando el App Secret. Debes validarlo sobre el cuerpo crudo (no el JSON ya parseado), con una comparación en tiempo constante. Sin esa verificación, cualquiera que descubra la URL puede inyectar eventos falsos.',
        },
        {
          type: 'paragraph',
          value:
            'El segundo pilar es la idempotencia. Meta puede reentregar el mismo evento (timeout, retry interno). Cada mensaje trae un id único; regístralo en un store con TTL antes de encolar y descarta los duplicados. Así el mismo evento nunca dispara dos respuestas ni dos escrituras en el CRM.',
        },
        {
          type: 'code',
          value: `// server.js - webhook WhatsApp Cloud API (Node.js / Express)
const express = require('express');
const crypto = require('crypto');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL);
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

const app = express();

// IMPORTANTE: capturar el cuerpo CRUDO para validar el HMAC.
// El JSON re-serializado no coincide byte a byte con lo que firmo Meta.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Comparacion en tiempo constante para evitar timing attacks.
function isValidSignature(req) {
  const header = req.get('x-hub-signature-256');
  if (!header || !req.rawBody) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Idempotencia: registra el message id con TTL; devuelve false si ya se vio.
async function markIfNew(messageId) {
  // SET key value NX EX 86400 -> graba solo si no existe, expira en 24h.
  const result = await redis.set(\`wa:msg:\${messageId}\`, '1', 'EX', 86400, 'NX');
  return result === 'OK';
}

// Handshake de verificacion (GET) exigido por Meta al configurar la URL.
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recepcion de eventos (POST).
app.post('/webhook', async (req, res) => {
  if (!isValidSignature(req)) {
    return res.sendStatus(401);
  }

  // Responde rapido: Meta reentrega si hay demora. El procesamiento es asincrono.
  res.sendStatus(200);

  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const messages = change.value?.messages || [];
        for (const message of messages) {
          const isNew = await markIfNew(message.id);
          if (!isNew) continue; // duplicado: ignora

          // Encola para el worker. El endpoint no ejecuta regla de negocio.
          await redis.lpush(
            'wa:incoming',
            JSON.stringify({
              messageId: message.id,
              from: message.from,
              type: message.type,
              text: message.text?.body,
              timestamp: message.timestamp,
            })
          );
        }
      }
    }
  } catch (err) {
    // Ya respondimos 200; logueamos y dejamos el reprocesamiento al worker/DLQ.
    console.error('webhook processing error', err);
  }
});

app.listen(process.env.PORT || 3000);`,
        },
      ],
    },
    {
      title: 'Plantillas, opt-in y calidad del número',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Fuera de la ventana de 24 horas de atención, solo puedes iniciar conversación con Message Templates aprobadas por Meta. Categorízalas correctamente (marketing, utility, authentication): la categoría afecta el costo y el nivel de escrutinio. Las plantillas de marketing enviadas sin opt-in claro derriban el quality rating del número y pueden activar límites de envío.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Buena práctica', 'Riesgo si se ignora'],
          rows: [
            ['Opt-in', 'Consentimiento explícito y registrado por usuario', 'Bloqueos masivos, caída de calidad'],
            ['Categoría', 'Clasificar utility vs marketing correctamente', 'Rechazo de la plantilla o cobro erróneo'],
            ['Ventana 24h', 'Texto libre solo dentro de la sesión abierta', 'Mensaje no entregado fuera de la ventana'],
            ['Quality rating', 'Monitorear verde/amarillo/rojo vía API', 'Degradación de tier y límite de envío'],
            ['Variables', 'Validar placeholders {{1}} antes de enviar', 'Fallo de render o rechazo en la revisión'],
            ['Frecuencia', 'Respetar la cadencia y un botón de baja', 'Marcación como spam por los usuarios'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Trata el quality rating como un SLO. Consúltalo periódicamente, registra las caídas y correlaciónalas con campañas recientes. Un número degradado a un tier inferior limita cuántos usuarios nuevos alcanzas por día, lo que puede trabar una operación entera en plena hora pico.',
        },
      ],
    },
    {
      title: 'Worker idempotente y manejo de fallas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El worker consume la cola y ejecuta la orquestación: clasificar la intención (con IA o reglas), buscar contexto en el CRM, generar la respuesta y enviarla vía la API de mensajes. Cada paso puede fallar de forma independiente, así que el worker debe ser idempotente y tener una política de retry con backoff, además de una dead-letter queue para los eventos que agotan los intentos.',
        },
        {
          type: 'ordered',
          items: [
            'Despacha el mensaje de la cola y revalida la idempotencia por la clave de procesamiento (no solo de recepción).',
            'Clasifica la intención y decide el camino: respuesta automática, búsqueda en base de conocimiento o handoff humano.',
            'Llama a integraciones externas con timeout corto y circuit breaker; una falla ahí no puede trabar toda la cola.',
            'Envía la respuesta vía la Graph API y persiste el resultado en el CRM dentro de una operación idempotente.',
            'En error recuperable, reencola con backoff exponencial; tras N intentos, mueve a la DLQ y alerta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El envío del mensaje en sí también puede fallar (rate limit, número inválido, ventana cerrada). Trata la respuesta de la API: distingue errores transitorios (retry) de permanentes (descarta y registra). Nunca hagas retry ciego de un error permanente, eso solo quema cuota y ensucia la cola.',
        },
      ],
    },
    {
      title: 'Checklist de despliegue',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de apuntar la URL del webhook a producción, recorre esta secuencia. El orden importa: secretos y validación primero, después conectividad, por último el tráfico real.',
        },
        {
          type: 'ordered',
          items: [
            'App Secret, Verify Token y Access Token guardados en un secret manager, nunca en código ni en el repositorio.',
            'HTTPS válido en la URL del webhook (Meta exige TLS) y el handshake GET respondiendo con el hub.challenge.',
            'Validación de x-hub-signature-256 activa y probada con un payload firmado real, rechazando firmas inválidas.',
            'Idempotencia funcionando: reenviar el mismo evento no genera respuesta ni escritura duplicada.',
            'Cola y workers aprovisionados con escala mínima dimensionada para el pico de campaña, no para el promedio.',
            'Dead-letter queue configurada y con alerta cuando recibe eventos.',
            'Observabilidad: logs correlacionados por message id, métricas de latencia por etapa y profundidad de la cola.',
            'Plantillas aprobadas, categorizadas y con opt-in registrado para los flujos que inician conversación.',
            'Alertas sobre caídas del quality rating y sobre errores de envío por encima del umbral.',
            'Plan de rollback y runbook de incidente: cómo pausar envíos y drenar la cola con seguridad.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Necesito un BSP (Business Solution Provider) para usar la Cloud API?',
      answer:
        'No necesariamente. La Cloud API se puede usar directo vía Meta, con onboarding por Meta Business y WhatsApp Manager. Un BSP agrega facturación consolidada, soporte y herramientas, pero puedes correr en producción sin él, especialmente en operaciones de menor tamaño.',
    },
    {
      question: '¿Por qué validar el HMAC sobre el cuerpo crudo y no sobre el JSON parseado?',
      answer:
        'Porque la firma se calcula sobre los bytes exactos que envió Meta. Al parsear y re-serializar el JSON, el orden de las claves y el formato pueden cambiar, y el HMAC recalculado no coincide. Por eso capturamos el rawBody en el momento del parse y validamos sobre él.',
    },
    {
      question: '¿Qué pasa si tardo en responder 200 al webhook?',
      answer:
        'Meta considera el evento como no entregado y lo reenvía, generando duplicados. Por eso el endpoint debe responder 200 de inmediato tras validar y encolar, dejando el procesamiento pesado para el worker. La idempotencia protege contra las reentregas que aun así ocurren.',
    },
  ],
  conclusion: {
    title: '¿Quieres esta arquitectura corriendo en tu número?',
    description:
      'Implemento integraciones WhatsApp Cloud API de punta a punta: webhook seguro, colas, workers idempotentes, orquestación con IA y observabilidad. Si necesitas migrar de una solución no oficial o estructurar desde cero, hablemos.',
    cta: 'Hablar sobre mi proyecto',
  },
  related: [
    { label: 'Webhook de WhatsApp: idempotencia y colas', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Servicio: WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'Seguridad en integraciones Meta y WhatsApp', to: '/blog/seguranca-integracoes-meta-whatsapp' },
  ],
  repo: {
    name: 'whatsapp-cloud-api-starter',
    description: 'Starter de producción en Node.js con webhook seguro (HMAC + idempotencia), cola y worker.',
    url: 'https://github.com/joaosouz4dev/whatsapp-cloud-api-starter',
  },
};

export default { pt, en, es };
