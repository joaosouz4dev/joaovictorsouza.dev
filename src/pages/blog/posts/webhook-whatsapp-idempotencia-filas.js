// Conteudo do artigo: webhook-whatsapp-idempotencia-filas
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections, faq, conclusion, related, repo }

const pt = {
  intro:
    'Em producao, o webhook do WhatsApp nao e um endpoint qualquer: a Meta entrega eventos com garantia at-least-once, o que significa que o mesmo evento pode chegar mais de uma vez. Se o seu handler processa tudo inline e nao trata duplicatas, voce envia mensagens repetidas, cobra o cliente duas vezes ou dispara fluxos em duplicidade. Este guia mostra os padroes que sustentam um webhook estavel em alto volume: idempotencia por message id, resposta rapida com enfileiramento e retry exponencial com DLQ.',
  sections: [
    {
      title: 'Por que o WhatsApp reenvia o mesmo webhook',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A infraestrutura de webhooks da Meta opera com entrega at-least-once. Ela garante que o evento sera entregue pelo menos uma vez, mas nao garante exatamente uma vez. Sempre que a Meta nao recebe uma resposta HTTP 200 dentro da janela esperada, ela assume falha e reenvia o mesmo evento. O resultado e duplicacao natural do trafego.',
        },
        {
          type: 'list',
          items: [
            'Timeout: seu servidor demorou para responder 200 e a Meta considerou a entrega falha.',
            'Erro de rede: a resposta 200 se perdeu no caminho mesmo com o processamento ja concluido.',
            'Status 5xx ou conexao recusada: deploy, reinicio ou pico de carga derrubaram o handler.',
            'Replays internos da Meta: retentativas agendadas que repetem eventos antigos.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A consequencia pratica e direta: voce nao pode confiar que cada POST representa um evento novo. O mesmo message id pode aparecer duas, tres ou mais vezes. O desenho do sistema precisa assumir duplicatas como normais, nao como excecao.',
        },
      ],
    },
    {
      title: 'Idempotencia por message id com Redis SET NX',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A defesa central contra duplicatas e a idempotencia. Cada mensagem do WhatsApp carrega um id unico e estavel. A ideia e registrar esse id na primeira vez que ele chega e descartar qualquer reaparicao. O Redis resolve isso com uma operacao atomica: SET com a flag NX (set if not exists) e um TTL, que evita crescimento infinito da memoria.',
        },
        {
          type: 'paragraph',
          value:
            'O SET NX e atomico: se duas entregas do mesmo id chegam ao mesmo tempo, apenas uma vence a corrida e marca o id. A outra recebe null e e ignorada. Nao ha janela de race condition entre um GET e um SET separados.',
        },
        {
          type: 'code',
          value: `const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

// TTL de 24h: cobre a janela de retries da Meta sem reter ids para sempre.
const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24;

/**
 * Retorna true se o evento e novo (deve ser processado).
 * Retorna false se ja foi visto (duplicata, deve ser descartado).
 */
async function claimMessage(messageId) {
  const key = \`wa:idempotency:\${messageId}\`;
  // SET key value NX EX ttl => grava apenas se a chave nao existir.
  const result = await redis.set(key, '1', 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
  return result === 'OK';
}

async function handleWebhookEvent(event) {
  const messages = event?.entry?.[0]?.changes?.[0]?.value?.messages || [];

  for (const message of messages) {
    const isNew = await claimMessage(message.id);
    if (!isNew) {
      // Duplicata: a Meta reenviou. Ignore com seguranca.
      console.log('Evento duplicado ignorado', { messageId: message.id });
      continue;
    }
    // Primeira ocorrencia: enfileire para processamento.
    await enqueueForProcessing(message);
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Escolha um TTL maior do que a janela de retries da Meta (24h e uma margem segura). Se o TTL for curto demais, um retry tardio pode passar como evento novo e gerar duplicacao.',
        },
      ],
    },
    {
      title: 'Responda 200 rapido e enfileire o processamento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro mais comum em producao e processar o evento inline antes de responder a Meta. Chamadas a banco, APIs externas, modelos de IA ou envio de mensagens podem levar segundos. Se a resposta 200 nao sai a tempo, a Meta considera falha e reenvia. Isso cria um ciclo vicioso: quanto mais lento, mais retries, mais carga, mais lento ainda.',
        },
        {
          type: 'paragraph',
          value:
            'A regra de ouro: o webhook valida, registra a idempotencia, coloca o evento numa fila e responde 200 em milissegundos. Todo o trabalho pesado acontece em workers assincronos, fora do ciclo de request.',
        },
        {
          type: 'diagram',
          value: `Meta (WhatsApp)
      |
      |  POST webhook (at-least-once)
      v
+----------------------+
|   Webhook endpoint   |
|  1. valida assinatura|
|  2. SET NX (Redis)   |
|  3. enfileira evento |
|  4. responde 200     |  <-- em milissegundos
+----------------------+
      |
      |  push
      v
+----------------------+      +----------------------+
|        Fila          | ---> |       Workers        |
|   (Redis / SQS /     |      |  processamento real: |
|    RabbitMQ)         |      |  DB, IA, envio msg   |
+----------------------+      +----------------------+
                                       |
                                  falha N vezes
                                       v
                                +-------------+
                                |     DLQ     |
                                +-------------+`,
        },
        {
          type: 'paragraph',
          value:
            'Com esse desenho, picos de trafego nao derrubam o endpoint. A fila absorve a rajada e os workers consomem no ritmo que conseguem, sem provocar timeouts e retries na origem.',
        },
      ],
    },
    {
      title: 'Retry exponencial e Dead Letter Queue',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Enfileirar nao basta: o processamento em si pode falhar (API instavel, timeout de banco, erro transitorio). A estrategia correta e retry com backoff exponencial e, apos esgotar as tentativas, mover o evento para uma Dead Letter Queue (DLQ) para inspecao manual em vez de descartar.',
        },
        {
          type: 'paragraph',
          value:
            'O backoff exponencial espalha as tentativas no tempo (1s, 2s, 4s, 8s...) para nao martelar um servico que ja esta sofrendo. A DLQ garante que nenhum evento se perca silenciosamente.',
        },
        {
          type: 'code',
          value: `const { Queue, Worker } = require('bullmq');
const connection = { url: process.env.REDIS_URL };

const eventsQueue = new Queue('wa-events', { connection });
const deadLetterQueue = new Queue('wa-events-dlq', { connection });

async function enqueueForProcessing(message) {
  await eventsQueue.add('process-message', message, {
    attempts: 5,                       // 1 inicial + 4 retries
    backoff: { type: 'exponential', delay: 1000 }, // 1s, 2s, 4s, 8s...
    removeOnComplete: true,
    removeOnFail: false,
  });
}

const worker = new Worker(
  'wa-events',
  async (job) => {
    // Processamento real do evento. Lance erro para acionar o retry.
    await processMessage(job.data);
  },
  { connection },
);

// Apos esgotar todas as tentativas, envie para a DLQ.
worker.on('failed', async (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
    await deadLetterQueue.add('dead-letter', {
      payload: job.data,
      error: err.message,
      failedAt: new Date().toISOString(),
    });
    console.error('Evento movido para a DLQ', { jobId: job.id, error: err.message });
  }
});`,
        },
        {
          type: 'paragraph',
          value:
            'Monitore o tamanho da DLQ: ela deve ficar vazia em condicoes normais. Crescimento da DLQ e o sinal mais claro de que algo a jusante esta quebrado e precisa de atencao humana.',
        },
      ],
    },
    {
      title: 'Falhas comuns e como mitigar',
      blocks: [
        {
          type: 'table',
          columns: ['Falha', 'Causa', 'Mitigacao'],
          rows: [
            [
              'Mensagens duplicadas para o usuario',
              'Processamento sem idempotencia; a Meta reenviou o evento',
              'SET NX por message id no Redis com TTL antes de qualquer efeito colateral',
            ],
            [
              'Webhook desativado pela Meta',
              'Respostas 200 lentas ou erros 5xx repetidos',
              'Responder 200 em milissegundos; processar fora do request via fila',
            ],
            [
              'Tempestade de retries da Meta',
              'Endpoint lento sob pico de carga gera mais retries',
              'Enfileirar e desacoplar; a fila absorve a rajada, workers consomem no ritmo',
            ],
            [
              'Eventos perdidos silenciosamente',
              'Erro transitorio sem retry; excecao engolida no handler',
              'Retry exponencial com tentativas limitadas e DLQ para inspecao',
            ],
            [
              'Memoria do Redis crescendo sem fim',
              'Chaves de idempotencia sem expiracao',
              'Sempre definir TTL no SET NX (ex.: 24h) cobrindo a janela de retries',
            ],
          ],
        },
      ],
    },
    {
      title: 'Checklist de producao',
      blocks: [
        {
          type: 'ordered',
          items: [
            'Validar a assinatura do webhook (X-Hub-Signature-256) antes de processar.',
            'Aplicar SET NX no Redis por message id com TTL antes de qualquer efeito colateral.',
            'Responder 200 imediatamente, antes de qualquer trabalho pesado.',
            'Enfileirar o evento e processar em workers assincronos.',
            'Configurar retry exponencial com numero limitado de tentativas.',
            'Encaminhar falhas definitivas para a DLQ e alertar sobre o crescimento dela.',
            'Monitorar latencia do endpoint, profundidade da fila e taxa de duplicatas.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que preciso responder 200 em poucos segundos?',
      answer:
        'Porque a entrega da Meta e at-least-once com timeout. Se a resposta 200 nao chega dentro da janela esperada, a Meta considera a entrega falha e reenvia o mesmo evento. Respostas lentas geram retries, que aumentam a carga e deixam o endpoint ainda mais lento. Em casos extremos, a Meta pode desativar o webhook. Por isso, responda 200 em milissegundos e processe o trabalho pesado fora do ciclo de request.',
    },
    {
      question: 'O message id do WhatsApp e confiavel para idempotencia?',
      answer:
        'Sim. Cada mensagem carrega um id unico e estavel que se mantem identico entre os reenvios da Meta. Usar esse id como chave de idempotencia (SET NX no Redis com TTL) e a forma mais direta de descartar duplicatas com seguranca, desde que voce aplique a verificacao antes de qualquer efeito colateral.',
    },
    {
      question: 'Qual TTL usar nas chaves de idempotencia?',
      answer:
        'Use um TTL maior do que a janela de retries da Meta. 24 horas e uma margem segura e pratica. Um TTL curto demais arrisca deixar um retry tardio passar como evento novo, gerando duplicacao. Um TTL muito longo apenas consome mais memoria sem ganho real. O importante e nunca deixar a chave sem expiracao.',
    },
  ],
  conclusion: {
    title: 'Webhook estavel e questao de arquitetura, nao de sorte',
    description:
      'Idempotencia por message id, resposta 200 imediata com enfileiramento e retry exponencial com DLQ formam o trio que mantem seu webhook do WhatsApp confiavel sob alto volume. Se voce esta lidando com duplicatas ou instabilidade em producao, posso ajudar a desenhar essa arquitetura.',
    cta: 'Falar sobre minha integracao',
  },
  related: [
    { label: 'Guia da WhatsApp Cloud API', to: '/blog/guia-whatsapp-cloud-api' },
    { label: 'Filas para picos de campanha no WhatsApp', to: '/blog/fila-picos-campanha-whatsapp' },
    { label: 'Monitoramento e alertas em integracoes', to: '/blog/monitoramento-alertas-integracoes' },
  ],
  repo: {
    name: 'whatsapp-webhook-idempotent',
    description:
      'Exemplo de webhook do WhatsApp com idempotencia por message id no Redis, enfileiramento e retry com DLQ.',
    url: 'https://github.com/joaosouz4dev/whatsapp-webhook-idempotent',
  },
};

const en = {
  intro:
    'In production, the WhatsApp webhook is not just any endpoint: Meta delivers events with an at-least-once guarantee, which means the same event can arrive more than once. If your handler processes everything inline and does not deal with duplicates, you send repeated messages, charge the customer twice or trigger flows in duplicate. This guide shows the patterns that keep a webhook stable under high volume: idempotency by message id, a fast response with enqueueing and exponential retry with a DLQ.',
  sections: [
    {
      title: 'Why WhatsApp resends the same webhook',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Meta webhook infrastructure operates with at-least-once delivery. It guarantees the event will be delivered at least once, but does not guarantee exactly once. Whenever Meta does not receive an HTTP 200 response within the expected window, it assumes failure and resends the same event. The result is natural traffic duplication.',
        },
        {
          type: 'list',
          items: [
            'Timeout: your server took too long to return 200 and Meta treated the delivery as failed.',
            'Network error: the 200 response was lost in transit even though processing already finished.',
            'Status 5xx or refused connection: a deploy, restart or load spike took the handler down.',
            'Internal Meta replays: scheduled retries that repeat older events.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The practical consequence is direct: you cannot trust that each POST represents a new event. The same message id may appear two, three or more times. The system design must assume duplicates as normal, not as an exception.',
        },
      ],
    },
    {
      title: 'Idempotency by message id with Redis SET NX',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The core defense against duplicates is idempotency. Every WhatsApp message carries a unique, stable id. The idea is to record that id the first time it arrives and discard any reappearance. Redis solves this with an atomic operation: SET with the NX flag (set if not exists) and a TTL, which avoids unbounded memory growth.',
        },
        {
          type: 'paragraph',
          value:
            'SET NX is atomic: if two deliveries of the same id arrive at the same time, only one wins the race and claims the id. The other gets null and is ignored. There is no race-condition window between a separate GET and SET.',
        },
        {
          type: 'code',
          value: `const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

// 24h TTL: covers Meta's retry window without keeping ids forever.
const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24;

/**
 * Returns true if the event is new (should be processed).
 * Returns false if already seen (duplicate, should be discarded).
 */
async function claimMessage(messageId) {
  const key = \`wa:idempotency:\${messageId}\`;
  // SET key value NX EX ttl => writes only if the key does not exist.
  const result = await redis.set(key, '1', 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
  return result === 'OK';
}

async function handleWebhookEvent(event) {
  const messages = event?.entry?.[0]?.changes?.[0]?.value?.messages || [];

  for (const message of messages) {
    const isNew = await claimMessage(message.id);
    if (!isNew) {
      // Duplicate: Meta resent it. Safe to ignore.
      console.log('Duplicate event ignored', { messageId: message.id });
      continue;
    }
    // First occurrence: enqueue for processing.
    await enqueueForProcessing(message);
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Pick a TTL longer than Meta retry window (24h is a safe margin). If the TTL is too short, a late retry can pass as a new event and cause duplication.',
        },
      ],
    },
    {
      title: 'Respond 200 fast and enqueue the processing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common production mistake is processing the event inline before responding to Meta. Database calls, external APIs, AI models or message sends can take seconds. If the 200 response does not go out in time, Meta treats it as a failure and resends. This creates a vicious cycle: the slower it is, the more retries, the more load, the slower still.',
        },
        {
          type: 'paragraph',
          value:
            'The golden rule: the webhook validates, records idempotency, places the event on a queue and returns 200 in milliseconds. All the heavy work happens in asynchronous workers, outside the request cycle.',
        },
        {
          type: 'diagram',
          value: `Meta (WhatsApp)
      |
      |  POST webhook (at-least-once)
      v
+----------------------+
|   Webhook endpoint   |
|  1. verify signature |
|  2. SET NX (Redis)   |
|  3. enqueue event    |
|  4. respond 200      |  <-- in milliseconds
+----------------------+
      |
      |  push
      v
+----------------------+      +----------------------+
|        Queue         | ---> |       Workers        |
|   (Redis / SQS /     |      |   real processing:   |
|    RabbitMQ)         |      |  DB, AI, send msg    |
+----------------------+      +----------------------+
                                       |
                                  fails N times
                                       v
                                +-------------+
                                |     DLQ     |
                                +-------------+`,
        },
        {
          type: 'paragraph',
          value:
            'With this design, traffic spikes do not take the endpoint down. The queue absorbs the burst and workers consume at the pace they can handle, without triggering timeouts and retries at the source.',
        },
      ],
    },
    {
      title: 'Exponential retry and Dead Letter Queue',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Enqueueing is not enough: processing itself can fail (unstable API, database timeout, transient error). The right strategy is retry with exponential backoff and, once attempts are exhausted, moving the event to a Dead Letter Queue (DLQ) for manual inspection instead of discarding it.',
        },
        {
          type: 'paragraph',
          value:
            'Exponential backoff spreads retries over time (1s, 2s, 4s, 8s...) so you do not hammer a service that is already struggling. The DLQ guarantees no event is silently lost.',
        },
        {
          type: 'code',
          value: `const { Queue, Worker } = require('bullmq');
const connection = { url: process.env.REDIS_URL };

const eventsQueue = new Queue('wa-events', { connection });
const deadLetterQueue = new Queue('wa-events-dlq', { connection });

async function enqueueForProcessing(message) {
  await eventsQueue.add('process-message', message, {
    attempts: 5,                       // 1 initial + 4 retries
    backoff: { type: 'exponential', delay: 1000 }, // 1s, 2s, 4s, 8s...
    removeOnComplete: true,
    removeOnFail: false,
  });
}

const worker = new Worker(
  'wa-events',
  async (job) => {
    // Real event processing. Throw to trigger the retry.
    await processMessage(job.data);
  },
  { connection },
);

// After exhausting all attempts, send to the DLQ.
worker.on('failed', async (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
    await deadLetterQueue.add('dead-letter', {
      payload: job.data,
      error: err.message,
      failedAt: new Date().toISOString(),
    });
    console.error('Event moved to the DLQ', { jobId: job.id, error: err.message });
  }
});`,
        },
        {
          type: 'paragraph',
          value:
            'Monitor the DLQ size: it should stay empty under normal conditions. DLQ growth is the clearest signal that something downstream is broken and needs human attention.',
        },
      ],
    },
    {
      title: 'Common failures and how to mitigate them',
      blocks: [
        {
          type: 'table',
          columns: ['Failure', 'Cause', 'Mitigation'],
          rows: [
            [
              'Duplicate messages to the user',
              'Processing without idempotency; Meta resent the event',
              'SET NX by message id in Redis with TTL before any side effect',
            ],
            [
              'Webhook disabled by Meta',
              'Slow 200 responses or repeated 5xx errors',
              'Respond 200 in milliseconds; process outside the request via a queue',
            ],
            [
              'Retry storm from Meta',
              'A slow endpoint under load spike generates more retries',
              'Enqueue and decouple; the queue absorbs the burst, workers consume at pace',
            ],
            [
              'Events silently lost',
              'Transient error without retry; exception swallowed in the handler',
              'Exponential retry with limited attempts and a DLQ for inspection',
            ],
            [
              'Redis memory growing endlessly',
              'Idempotency keys without expiration',
              'Always set a TTL on SET NX (e.g. 24h) covering the retry window',
            ],
          ],
        },
      ],
    },
    {
      title: 'Production checklist',
      blocks: [
        {
          type: 'ordered',
          items: [
            'Verify the webhook signature (X-Hub-Signature-256) before processing.',
            'Apply Redis SET NX by message id with a TTL before any side effect.',
            'Respond 200 immediately, before any heavy work.',
            'Enqueue the event and process it in asynchronous workers.',
            'Configure exponential retry with a limited number of attempts.',
            'Route definitive failures to the DLQ and alert on its growth.',
            'Monitor endpoint latency, queue depth and duplicate rate.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why do I need to respond 200 within a few seconds?',
      answer:
        'Because Meta delivery is at-least-once with a timeout. If the 200 response does not arrive within the expected window, Meta treats the delivery as failed and resends the same event. Slow responses generate retries, which raise the load and make the endpoint even slower. In extreme cases, Meta can disable the webhook. That is why you should respond 200 in milliseconds and process the heavy work outside the request cycle.',
    },
    {
      question: 'Is the WhatsApp message id reliable for idempotency?',
      answer:
        'Yes. Each message carries a unique, stable id that stays identical across Meta resends. Using that id as the idempotency key (Redis SET NX with TTL) is the most direct way to discard duplicates safely, as long as you apply the check before any side effect.',
    },
    {
      question: 'What TTL should I use for idempotency keys?',
      answer:
        'Use a TTL longer than Meta retry window. 24 hours is a safe, practical margin. A TTL that is too short risks letting a late retry pass as a new event, causing duplication. A very long TTL only consumes more memory with no real gain. The key point is to never leave the key without expiration.',
    },
  ],
  conclusion: {
    title: 'A stable webhook is a matter of architecture, not luck',
    description:
      'Idempotency by message id, an immediate 200 response with enqueueing and exponential retry with a DLQ form the trio that keeps your WhatsApp webhook reliable under high volume. If you are dealing with duplicates or instability in production, I can help design this architecture.',
    cta: 'Talk about my integration',
  },
  related: [
    { label: 'WhatsApp Cloud API guide', to: '/blog/guia-whatsapp-cloud-api' },
    { label: 'Queues for WhatsApp campaign spikes', to: '/blog/fila-picos-campanha-whatsapp' },
    { label: 'Monitoring and alerts for integrations', to: '/blog/monitoramento-alertas-integracoes' },
  ],
  repo: {
    name: 'whatsapp-webhook-idempotent',
    description:
      'Example WhatsApp webhook with idempotency by message id in Redis, enqueueing and retry with a DLQ.',
    url: 'https://github.com/joaosouz4dev/whatsapp-webhook-idempotent',
  },
};

const es = {
  intro:
    'En produccion, el webhook de WhatsApp no es un endpoint cualquiera: Meta entrega eventos con garantia at-least-once, lo que significa que el mismo evento puede llegar mas de una vez. Si tu handler procesa todo inline y no trata duplicados, envias mensajes repetidos, cobras al cliente dos veces o disparas flujos por duplicado. Esta guia muestra los patrones que sostienen un webhook estable en alto volumen: idempotencia por message id, respuesta rapida con encolado y retry exponencial con DLQ.',
  sections: [
    {
      title: 'Por que WhatsApp reenvia el mismo webhook',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La infraestructura de webhooks de Meta opera con entrega at-least-once. Garantiza que el evento se entregara al menos una vez, pero no garantiza exactamente una vez. Cada vez que Meta no recibe una respuesta HTTP 200 dentro de la ventana esperada, asume fallo y reenvia el mismo evento. El resultado es duplicacion natural del trafico.',
        },
        {
          type: 'list',
          items: [
            'Timeout: tu servidor tardo demasiado en responder 200 y Meta considero la entrega fallida.',
            'Error de red: la respuesta 200 se perdio en el camino aunque el procesamiento ya habia terminado.',
            'Estado 5xx o conexion rechazada: un deploy, reinicio o pico de carga tumbaron el handler.',
            'Replays internos de Meta: reintentos programados que repiten eventos antiguos.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia practica es directa: no puedes confiar en que cada POST represente un evento nuevo. El mismo message id puede aparecer dos, tres o mas veces. El diseno del sistema debe asumir los duplicados como algo normal, no como una excepcion.',
        },
      ],
    },
    {
      title: 'Idempotencia por message id con Redis SET NX',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La defensa central contra los duplicados es la idempotencia. Cada mensaje de WhatsApp lleva un id unico y estable. La idea es registrar ese id la primera vez que llega y descartar cualquier reaparicion. Redis lo resuelve con una operacion atomica: SET con la flag NX (set if not exists) y un TTL, que evita el crecimiento infinito de la memoria.',
        },
        {
          type: 'paragraph',
          value:
            'SET NX es atomico: si dos entregas del mismo id llegan al mismo tiempo, solo una gana la carrera y marca el id. La otra recibe null y se ignora. No hay ventana de race condition entre un GET y un SET separados.',
        },
        {
          type: 'code',
          value: `const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

// TTL de 24h: cubre la ventana de retries de Meta sin retener ids para siempre.
const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24;

/**
 * Devuelve true si el evento es nuevo (debe procesarse).
 * Devuelve false si ya fue visto (duplicado, debe descartarse).
 */
async function claimMessage(messageId) {
  const key = \`wa:idempotency:\${messageId}\`;
  // SET key value NX EX ttl => graba solo si la clave no existe.
  const result = await redis.set(key, '1', 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
  return result === 'OK';
}

async function handleWebhookEvent(event) {
  const messages = event?.entry?.[0]?.changes?.[0]?.value?.messages || [];

  for (const message of messages) {
    const isNew = await claimMessage(message.id);
    if (!isNew) {
      // Duplicado: Meta lo reenvio. Seguro de ignorar.
      console.log('Evento duplicado ignorado', { messageId: message.id });
      continue;
    }
    // Primera ocurrencia: encola para procesamiento.
    await enqueueForProcessing(message);
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Elige un TTL mayor que la ventana de retries de Meta (24h es un margen seguro). Si el TTL es demasiado corto, un retry tardio puede pasar como evento nuevo y generar duplicacion.',
        },
      ],
    },
    {
      title: 'Responde 200 rapido y encola el procesamiento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error mas comun en produccion es procesar el evento inline antes de responder a Meta. Las llamadas a base de datos, APIs externas, modelos de IA o envio de mensajes pueden tardar segundos. Si la respuesta 200 no sale a tiempo, Meta lo considera un fallo y reenvia. Esto crea un circulo vicioso: cuanto mas lento, mas retries, mas carga, mas lento aun.',
        },
        {
          type: 'paragraph',
          value:
            'La regla de oro: el webhook valida, registra la idempotencia, coloca el evento en una cola y responde 200 en milisegundos. Todo el trabajo pesado ocurre en workers asincronos, fuera del ciclo de request.',
        },
        {
          type: 'diagram',
          value: `Meta (WhatsApp)
      |
      |  POST webhook (at-least-once)
      v
+----------------------+
|   Endpoint webhook   |
|  1. valida firma     |
|  2. SET NX (Redis)   |
|  3. encola evento    |
|  4. responde 200     |  <-- en milisegundos
+----------------------+
      |
      |  push
      v
+----------------------+      +----------------------+
|         Cola         | ---> |       Workers        |
|   (Redis / SQS /     |      | procesamiento real:  |
|    RabbitMQ)         |      |  BD, IA, envio msg   |
+----------------------+      +----------------------+
                                       |
                                  falla N veces
                                       v
                                +-------------+
                                |     DLQ     |
                                +-------------+`,
        },
        {
          type: 'paragraph',
          value:
            'Con este diseno, los picos de trafico no tumban el endpoint. La cola absorbe la rafaga y los workers consumen al ritmo que pueden, sin provocar timeouts ni retries en el origen.',
        },
      ],
    },
    {
      title: 'Retry exponencial y Dead Letter Queue',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Encolar no basta: el procesamiento en si puede fallar (API inestable, timeout de base de datos, error transitorio). La estrategia correcta es retry con backoff exponencial y, tras agotar los intentos, mover el evento a una Dead Letter Queue (DLQ) para inspeccion manual en lugar de descartarlo.',
        },
        {
          type: 'paragraph',
          value:
            'El backoff exponencial reparte los reintentos en el tiempo (1s, 2s, 4s, 8s...) para no golpear un servicio que ya esta sufriendo. La DLQ garantiza que ningun evento se pierda en silencio.',
        },
        {
          type: 'code',
          value: `const { Queue, Worker } = require('bullmq');
const connection = { url: process.env.REDIS_URL };

const eventsQueue = new Queue('wa-events', { connection });
const deadLetterQueue = new Queue('wa-events-dlq', { connection });

async function enqueueForProcessing(message) {
  await eventsQueue.add('process-message', message, {
    attempts: 5,                       // 1 inicial + 4 reintentos
    backoff: { type: 'exponential', delay: 1000 }, // 1s, 2s, 4s, 8s...
    removeOnComplete: true,
    removeOnFail: false,
  });
}

const worker = new Worker(
  'wa-events',
  async (job) => {
    // Procesamiento real del evento. Lanza error para activar el retry.
    await processMessage(job.data);
  },
  { connection },
);

// Tras agotar todos los intentos, envia a la DLQ.
worker.on('failed', async (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
    await deadLetterQueue.add('dead-letter', {
      payload: job.data,
      error: err.message,
      failedAt: new Date().toISOString(),
    });
    console.error('Evento movido a la DLQ', { jobId: job.id, error: err.message });
  }
});`,
        },
        {
          type: 'paragraph',
          value:
            'Monitorea el tamano de la DLQ: debe permanecer vacia en condiciones normales. El crecimiento de la DLQ es la senal mas clara de que algo aguas abajo esta roto y necesita atencion humana.',
        },
      ],
    },
    {
      title: 'Fallos comunes y como mitigarlos',
      blocks: [
        {
          type: 'table',
          columns: ['Fallo', 'Causa', 'Mitigacion'],
          rows: [
            [
              'Mensajes duplicados al usuario',
              'Procesamiento sin idempotencia; Meta reenvio el evento',
              'SET NX por message id en Redis con TTL antes de cualquier efecto secundario',
            ],
            [
              'Webhook desactivado por Meta',
              'Respuestas 200 lentas o errores 5xx repetidos',
              'Responder 200 en milisegundos; procesar fuera del request via cola',
            ],
            [
              'Tormenta de retries de Meta',
              'Un endpoint lento bajo pico de carga genera mas retries',
              'Encolar y desacoplar; la cola absorbe la rafaga, los workers consumen al ritmo',
            ],
            [
              'Eventos perdidos en silencio',
              'Error transitorio sin retry; excepcion tragada en el handler',
              'Retry exponencial con intentos limitados y DLQ para inspeccion',
            ],
            [
              'Memoria de Redis creciendo sin fin',
              'Claves de idempotencia sin expiracion',
              'Definir siempre un TTL en SET NX (ej.: 24h) que cubra la ventana de retries',
            ],
          ],
        },
      ],
    },
    {
      title: 'Checklist de produccion',
      blocks: [
        {
          type: 'ordered',
          items: [
            'Validar la firma del webhook (X-Hub-Signature-256) antes de procesar.',
            'Aplicar SET NX en Redis por message id con un TTL antes de cualquier efecto secundario.',
            'Responder 200 de inmediato, antes de cualquier trabajo pesado.',
            'Encolar el evento y procesarlo en workers asincronos.',
            'Configurar retry exponencial con un numero limitado de intentos.',
            'Enviar los fallos definitivos a la DLQ y alertar sobre su crecimiento.',
            'Monitorear la latencia del endpoint, la profundidad de la cola y la tasa de duplicados.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que necesito responder 200 en pocos segundos?',
      answer:
        'Porque la entrega de Meta es at-least-once con timeout. Si la respuesta 200 no llega dentro de la ventana esperada, Meta considera la entrega fallida y reenvia el mismo evento. Las respuestas lentas generan retries, que aumentan la carga y dejan el endpoint aun mas lento. En casos extremos, Meta puede desactivar el webhook. Por eso debes responder 200 en milisegundos y procesar el trabajo pesado fuera del ciclo de request.',
    },
    {
      question: 'El message id de WhatsApp es confiable para idempotencia?',
      answer:
        'Si. Cada mensaje lleva un id unico y estable que se mantiene identico entre los reenvios de Meta. Usar ese id como clave de idempotencia (SET NX en Redis con TTL) es la forma mas directa de descartar duplicados con seguridad, siempre que apliques la verificacion antes de cualquier efecto secundario.',
    },
    {
      question: 'Que TTL usar en las claves de idempotencia?',
      answer:
        'Usa un TTL mayor que la ventana de retries de Meta. 24 horas es un margen seguro y practico. Un TTL demasiado corto arriesga dejar que un retry tardio pase como evento nuevo, generando duplicacion. Un TTL muy largo solo consume mas memoria sin ganancia real. Lo importante es nunca dejar la clave sin expiracion.',
    },
  ],
  conclusion: {
    title: 'Un webhook estable es cuestion de arquitectura, no de suerte',
    description:
      'Idempotencia por message id, respuesta 200 inmediata con encolado y retry exponencial con DLQ forman el trio que mantiene tu webhook de WhatsApp confiable en alto volumen. Si estas lidiando con duplicados o inestabilidad en produccion, puedo ayudar a disenar esta arquitectura.',
    cta: 'Hablar sobre mi integracion',
  },
  related: [
    { label: 'Guia de la WhatsApp Cloud API', to: '/blog/guia-whatsapp-cloud-api' },
    { label: 'Colas para picos de campana en WhatsApp', to: '/blog/fila-picos-campanha-whatsapp' },
    { label: 'Monitoreo y alertas en integraciones', to: '/blog/monitoramento-alertas-integracoes' },
  ],
  repo: {
    name: 'whatsapp-webhook-idempotent',
    description:
      'Ejemplo de webhook de WhatsApp con idempotencia por message id en Redis, encolado y retry con DLQ.',
    url: 'https://github.com/joaosouz4dev/whatsapp-webhook-idempotent',
  },
};

export default { pt, en, es };
