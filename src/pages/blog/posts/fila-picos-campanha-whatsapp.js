// Conteudo do artigo: fila-picos-campanha-whatsapp
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections, faq, conclusion, related, repo }

const pt = {
  intro:
    'Uma campanha de marketing aperta o botao de disparo e, em um instante, 100 mil mensagens entram na fila para sair. O problema e que a WhatsApp Cloud API nao aceita esse volume de uma vez: existe um rate limit de chamadas por segundo e o numero tem um messaging tier que limita quantos usuarios unicos voce pode iniciar conversa em 24h. Disparar tudo de uma vez e a receita certa para erros 429, quedas de qualidade e bloqueio do numero. Este guia mostra como dimensionar fila, rate limiter e backpressure para entregar picos de campanha sem bloqueio e sem perda.',
  sections: [
    {
      title: 'O problema: 100k mensagens contra um rate limit',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando uma campanha dispara, o instinto e iterar a lista de contatos e chamar a API em loop. Funciona com mil contatos. Com cem mil, o sistema colide com tres limites simultaneos. Primeiro, o rate limit da Cloud API: ha um teto de requisicoes por segundo por numero, e estourar esse teto retorna HTTP 429 com Retry-After. Segundo, o messaging tier do numero, que limita quantas conversas iniciadas por negocio (business-initiated) voce pode abrir em uma janela de 24h: 1k, 10k, 100k ou ilimitado, dependendo do tier. Terceiro, a qualidade do numero, que a Meta avalia em tempo real e que, se cair, rebaixa o tier ou bloqueia o envio.',
        },
        {
          type: 'paragraph',
          value:
            'A consequencia de ignorar esses limites nao e so lentidao. Disparos em rajada geram um pico de 429, e o codigo ingenuo costuma reagir com retry imediato, o que aumenta a carga e piora a tempestade. Pior: marcar contatos como bloqueio ou erro permanente quando na verdade era throttling temporario faz voce perder entregas que poderiam ter saido minutos depois. O envio em massa precisa ser tratado como um problema de fluxo controlado, nao de loop.',
        },
      ],
    },
    {
      title: 'Arquitetura: produtor, fila e worker pool com rate limiter',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A arquitetura que sustenta picos separa quem produz trabalho de quem o executa. Um produtor recebe a campanha e enfileira um job por mensagem (ou por lote pequeno). Uma fila duravel guarda esses jobs. Um pool de workers consome a fila, mas nao a velocidade maxima: um rate limiter no estilo token bucket regula a saida para respeitar exatamente o limite de mensagens por segundo da Cloud API. O token bucket e a peca central: ele enche tokens a uma taxa constante (igual ao seu throughput alvo) e cada envio consome um token. Sem token, o worker espera. Isso transforma uma rajada de 100k em um fluxo suave de X msg/s.',
        },
        {
          type: 'diagram',
          value: `Campanha (100k contatos)
        |
        |  enfileira 1 job por mensagem
        v
+--------------------------+
|        Produtor          |
|  valida + segmenta lista |
+--------------------------+
        |
        v
+--------------------------+      tokens a X/s
|          Fila            |   +------------------+
|   (Redis / BullMQ)       |   |   Token Bucket   |
|  duravel, com prioridade |   |  enche X tokens/s|
+--------------------------+   +------------------+
        |                              |
        |  pull                        | consome 1 token/envio
        v                              v
+--------------------------------------------------+
|                 Worker Pool                      |
|   w1   w2   w3   ...   wN  (concorrencia limit.) |
|   cada envio: pega token -> chama Cloud API      |
+--------------------------------------------------+
        |                         |
        | 200 OK                  | 429 / 5xx -> retry backoff
        v                         v
   entregue                  reenfileira
                                  |
                             esgotou retries
                                  v
                             +--------+
                             |  DLQ   |
                             +--------+`,
        },
        {
          type: 'paragraph',
          value:
            'O ponto-chave e que dois controles atuam juntos e por motivos diferentes. A concorrencia do worker pool (quantos envios acontecem em paralelo) protege seus proprios recursos: conexoes, memoria, sockets. O rate limiter (quantos envios por segundo no total) protege o limite externo da Cloud API. Voce pode ter 20 workers concorrentes, mas se o token bucket so libera 80 tokens por segundo, o teto efetivo continua 80 msg/s. Os dois precisam ser dimensionados juntos.',
        },
      ],
    },
    {
      title: 'Backpressure: por que nao disparar tudo de uma vez',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Backpressure e o mecanismo que faz o produtor desacelerar quando o consumidor nao da conta. Numa campanha, a fila ja exerce esse papel: o produtor enfileira rapido, mas os workers consomem na taxa do rate limiter. O que voce nao pode fazer e burlar a fila e empurrar tudo para a API. Os motivos sao concretos:',
        },
        {
          type: 'list',
          items: [
            'Messaging tier: o numero so pode iniciar um numero fixo de conversas business-initiated em 24h (1k, 10k, 100k). Passar do tier retorna erro e nao adianta insistir no mesmo dia.',
            'Qualidade do numero: a Meta mede em tempo real bloqueios, denuncias e marcacoes de spam. Um pico de disparo para uma lista fria derruba a qualidade rapido, e qualidade baixa rebaixa o tier.',
            'Risco de block: qualidade vermelha somada a volume agressivo leva a Meta a restringir ou banir o numero, derrubando inclusive as mensagens transacionais legitimas.',
            'Erros 429 em cascata: estourar o rate limit gera 429 em massa; sem backpressure, o retry ingenuo realimenta a tempestade e degrada a taxa de entrega geral.',
            'Custo e janela: conversas tem custo e janela de 24h. Disparar fora do ritmo desperdicia tier util e pode estourar orcamento sem entregar mais rapido de fato.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A leitura de sistemas distribuidos e simples: a fila e o seu buffer e o rate limiter e a sua valvula. Backpressure nao e uma limitacao a contornar, e a garantia de que o pico se transforma em entrega sustentada em vez de bloqueio.',
        },
      ],
    },
    {
      title: 'Rate limiter + worker consumindo a fila a X msg/s',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Na pratica, BullMQ ja oferece um limiter nativo no Worker, que implementa o controle de taxa sobre o grupo de workers que compartilham a mesma fila e Redis. Voce define quantos jobs podem ser processados por janela de tempo, e a concorrencia controla o paralelismo dentro desse teto. O exemplo abaixo enfileira a campanha e consome respeitando 80 mensagens por segundo, com retry exponencial e DLQ para falhas definitivas.',
        },
        {
          type: 'code',
          value: `const { Queue, Worker, QueueEvents } = require('bullmq');
const connection = { url: process.env.REDIS_URL };

// Throughput alvo: mantenha abaixo do limite real da Cloud API.
const MESSAGES_PER_SECOND = 80;

const campaignQueue = new Queue('wa-campaign', { connection });
const dlq = new Queue('wa-campaign-dlq', { connection });

// Produtor: enfileira 1 job por contato. A fila absorve a rajada.
async function enqueueCampaign(campaignId, contacts, template) {
  const jobs = contacts.map((contact) => ({
    name: 'send',
    data: { campaignId, to: contact.phone, template },
    opts: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 }, // 2s, 4s, 8s, 16s
      removeOnComplete: true,
      removeOnFail: false,
    },
  }));
  await campaignQueue.addBulk(jobs);
}

// Worker pool: o limiter regula a SAIDA a X msg/s no grupo todo.
const worker = new Worker(
  'wa-campaign',
  async (job) => {
    const { to, template } = job.data;
    const res = await sendViaCloudApi(to, template);
    // Respeita o Retry-After da Meta em vez de martelar a API.
    if (res.status === 429) {
      const retryAfter = Number(res.headers['retry-after'] || 1);
      throw new RateLimitError(retryAfter * 1000);
    }
    if (res.status >= 500) throw new Error('Cloud API 5xx');
    return res.body;
  },
  {
    connection,
    concurrency: 20,               // paralelismo: protege recursos locais
    limiter: {
      max: MESSAGES_PER_SECOND,    // teto de envios...
      duration: 1000,              // ...por segundo (token bucket)
    },
  },
);

// Falha definitiva apos esgotar os retries: vai para a DLQ, nao some.
worker.on('failed', async (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
    await dlq.add('dead-letter', {
      payload: job.data,
      error: err.message,
      failedAt: new Date().toISOString(),
    });
  }
});`,
        },
        {
          type: 'paragraph',
          value:
            'Note como o 429 nao e tratado como erro permanente: o worker lanca um erro de rate limit e o job volta para a fila com backoff, respeitando o Retry-After da Meta. So depois de esgotar todas as tentativas o evento vai para a DLQ. Isso e o que diferencia throttling temporario de falha real e evita perder entregas que sairiam minutos depois.',
        },
      ],
    },
    {
      title: 'Priorizacao: transacional na frente de marketing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Durante um pico de campanha, uma mensagem transacional (codigo OTP, confirmacao de pedido, alerta) nao pode ficar atras de 100 mil mensagens de marketing na fila. A solucao e separar por prioridade. Ha duas abordagens, e em alto volume vale combinar as duas:',
        },
        {
          type: 'list',
          items: [
            'Filas separadas por classe: uma fila wa-transactional e outra wa-campaign, com workers e ate budgets de taxa distintos. A transacional tem prioridade de recursos e nao compete por tokens com a campanha.',
            'Prioridade dentro da fila: usar o campo de priority do BullMQ para que jobs urgentes furem a frente sem precisar de uma fila fisica separada quando o volume e menor.',
            'Reserva de capacidade: se a Cloud API permite N msg/s no total, reserve uma fatia (ex.: 20%) para transacional e dimensione o limiter da campanha para o restante, garantindo que o marketing nunca consuma 100% do throughput.',
            'Throttle assimetrico: marketing tolera atraso de minutos; transacional nao. Dimensione retries e backoff mais agressivos na campanha e mais curtos no transacional.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O principio de sistemas distribuidos aqui e isolamento de recursos: voce nao deixa uma carga de baixa prioridade e alto volume degradar a latencia de uma carga critica e de baixo volume. Filas separadas com budgets proprios sao a forma mais limpa de garantir esse isolamento.',
        },
      ],
    },
    {
      title: 'Parametros a dimensionar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Dimensionar a fila e um exercicio de calibrar poucos parametros contra o limite real do seu numero e a urgencia de cada classe de mensagem. A tabela resume os principais e os criterios.',
        },
        {
          type: 'table',
          columns: ['Parametro', 'O que controla', 'Como dimensionar'],
          rows: [
            [
              'Throughput alvo (msg/s)',
              'Taxa de saida do limiter',
              'Abaixo do rate limit real da Cloud API, com margem de seguranca (ex.: 80% do teto)',
            ],
            [
              'Concorrencia do worker',
              'Paralelismo dos envios em voo',
              'Suficiente para saturar o throughput sem esgotar conexoes/memoria; sobe ate o limiter virar o gargalo',
            ],
            [
              'TTL / janela de validade',
              'Quanto tempo um job pode esperar antes de virar irrelevante',
              'Curto para transacional (segundos/minutos); maior para marketing dentro da janela de 24h',
            ],
            [
              'Retries',
              'Tentativas antes de desistir',
              '3 a 5 com backoff exponencial; respeitando Retry-After em 429 sem contar como falha permanente',
            ],
            [
              'DLQ',
              'Destino das falhas definitivas',
              'Sempre ativa; com alerta de crescimento para inspecao humana de erros reais (numero invalido, template rejeitado)',
            ],
            [
              'Reserva transacional',
              'Fatia de throughput protegida',
              'Percentual fixo (ex.: 20%) que a campanha nunca consome, garantindo latencia do critico',
            ],
          ],
        },
      ],
    },
    {
      title: 'O que monitorar durante o pico',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Durante um pico, tres sinais dizem se o sistema esta saudavel ou afundando. Profundidade da fila mostra o backlog: subir e esperado no inicio, mas precisa drenar a uma taxa estavel. Idade da mensagem (quanto tempo o job mais antigo espera) revela se a entrega esta dentro da janela aceitavel; idade crescente no transacional e alarme imediato. Taxa de erro, separada por tipo (429 de rate limit, 4xx de template invalido, 5xx da API), distingue throttling esperado de falha real.',
        },
        {
          type: 'ordered',
          items: [
            'Profundidade da fila por classe: backlog de campanha e de transacional medidos separadamente, com a taxa de drenagem.',
            'Idade da mensagem mais antiga: tempo de espera do job no topo da fila, com alerta diferente por prioridade.',
            'Taxa de erro segmentada: 429 (rate limit, esperado), 4xx (template/numero, acionavel), 5xx (API instavel).',
            'Tamanho e crescimento da DLQ: deve ficar proxima de zero; crescimento aponta erro real a investigar.',
            'Qualidade e tier do numero: acompanhar o phone quality rating e o messaging tier para frear a campanha antes do rebaixamento.',
            'Throughput efetivo vs alvo: comparar msg/s reais com o alvo do limiter para detectar gargalo de worker ou throttle da API.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Como descubro o rate limit certo para configurar o limiter?',
      answer:
        'Comece pelo limite documentado da Cloud API para o seu numero e tier, mas trate-o como teto, nao como alvo. Configure o limiter com margem (por exemplo 80% do teto) e observe a taxa de 429 durante um pico real. Se aparecerem 429 mesmo abaixo do teto, reduza o throughput alvo. O objetivo e operar num ponto onde o 429 e raro e tratado por retry, nao a norma.',
    },
    {
      question: 'Qual a diferenca entre concorrencia do worker e rate limiter?',
      answer:
        'Sao dois controles com proposito distinto. A concorrencia limita quantos envios acontecem em paralelo e protege seus recursos locais (conexoes, memoria, sockets). O rate limiter limita quantos envios por segundo no total e protege o limite externo da Cloud API. Voce pode ter alta concorrencia, mas o rate limiter ainda segura a saida no teto de msg/s. Os dois precisam ser dimensionados em conjunto.',
    },
    {
      question: 'O que fazer quando o messaging tier do numero se esgota no meio da campanha?',
      answer:
        'Quando o tier se esgota, novos disparos business-initiated retornam erro e nao adianta reenviar no mesmo dia. O correto e detectar esse erro especifico, pausar a fila de campanha (sem perder os jobs, que ficam enfileirados) e retomar quando a janela de 24h renova ou quando o tier sobe. As mensagens transacionais em fila separada continuam fluindo. Tratar isso como pausa controlada, e nao como falha, evita marcar contatos validos como erro.',
    },
  ],
  conclusion: {
    title: 'Pico de campanha e problema de fluxo, nao de loop',
    description:
      'Fila duravel, token bucket respeitando o rate limit da Cloud API, backpressure consciente do messaging tier e priorizacao do transacional formam a arquitetura que entrega campanhas em massa sem bloqueio nem perda. Se voce precisa disparar volume alto sem arriscar a qualidade do numero, posso ajudar a desenhar essa fila.',
    cta: 'Falar sobre minha campanha',
  },
  related: [
    { label: 'Idempotencia e filas no webhook do WhatsApp', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Monitoramento e alertas em integracoes', to: '/blog/monitoramento-alertas-integracoes' },
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
  ],
  repo: {
    name: 'whatsapp-campaign-queue',
    description:
      'Exemplo de fila de campanha no WhatsApp com rate limiter token bucket, worker pool, priorizacao e DLQ.',
    url: 'https://github.com/joaosouz4dev/whatsapp-campaign-queue',
  },
};

const en = {
  intro:
    'A marketing campaign hits the send button and, in an instant, 100k messages line up to go out. The problem is that the WhatsApp Cloud API does not accept that volume all at once: there is a rate limit of calls per second and the number has a messaging tier that caps how many unique users you can start a conversation with in 24h. Firing everything at once is the surest recipe for 429 errors, quality drops and number blocking. This guide shows how to size the queue, rate limiter and backpressure to deliver campaign peaks without blocking and without loss.',
  sections: [
    {
      title: 'The problem: 100k messages against a rate limit',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When a campaign fires, the instinct is to iterate the contact list and call the API in a loop. It works with a thousand contacts. With a hundred thousand, the system collides with three limits at once. First, the Cloud API rate limit: there is a ceiling of requests per second per number, and exceeding it returns HTTP 429 with Retry-After. Second, the number messaging tier, which caps how many business-initiated conversations you can open in a 24h window: 1k, 10k, 100k or unlimited, depending on the tier. Third, the number quality, which Meta evaluates in real time and which, if it drops, downgrades the tier or blocks sending.',
        },
        {
          type: 'paragraph',
          value:
            'The consequence of ignoring these limits is not just slowness. Burst sends produce a spike of 429, and naive code tends to react with immediate retries, which raises the load and worsens the storm. Worse: marking contacts as blocked or permanently failed when it was really temporary throttling makes you lose deliveries that could have gone out minutes later. Bulk sending must be treated as a controlled-flow problem, not a loop.',
        },
      ],
    },
    {
      title: 'Architecture: producer, queue and worker pool with a rate limiter',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The architecture that sustains peaks separates who produces work from who runs it. A producer receives the campaign and enqueues one job per message (or per small batch). A durable queue holds those jobs. A worker pool consumes the queue, but not at full speed: a token bucket rate limiter regulates the output to respect exactly the messages-per-second limit of the Cloud API. The token bucket is the central piece: it fills tokens at a constant rate (equal to your target throughput) and each send consumes a token. With no token, the worker waits. This turns a burst of 100k into a smooth flow of X msg/s.',
        },
        {
          type: 'diagram',
          value: `Campaign (100k contacts)
        |
        |  enqueue 1 job per message
        v
+--------------------------+
|        Producer          |
|  validate + segment list |
+--------------------------+
        |
        v
+--------------------------+      tokens at X/s
|          Queue           |   +------------------+
|   (Redis / BullMQ)       |   |   Token Bucket   |
|  durable, with priority  |   |  fills X tokens/s|
+--------------------------+   +------------------+
        |                              |
        |  pull                        | spends 1 token/send
        v                              v
+--------------------------------------------------+
|                 Worker Pool                      |
|   w1   w2   w3   ...   wN  (bounded concurrency) |
|   each send: take token -> call Cloud API        |
+--------------------------------------------------+
        |                         |
        | 200 OK                  | 429 / 5xx -> retry backoff
        v                         v
   delivered                 re-enqueue
                                  |
                             retries exhausted
                                  v
                             +--------+
                             |  DLQ   |
                             +--------+`,
        },
        {
          type: 'paragraph',
          value:
            'The key point is that two controls act together and for different reasons. Worker pool concurrency (how many sends happen in parallel) protects your own resources: connections, memory, sockets. The rate limiter (how many sends per second in total) protects the external Cloud API limit. You may have 20 concurrent workers, but if the token bucket only releases 80 tokens per second, the effective ceiling stays 80 msg/s. The two must be sized together.',
        },
      ],
    },
    {
      title: 'Backpressure: why not fire everything at once',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Backpressure is the mechanism that makes the producer slow down when the consumer cannot keep up. In a campaign, the queue already plays that role: the producer enqueues fast, but the workers consume at the rate limiter pace. What you cannot do is bypass the queue and push everything to the API. The reasons are concrete:',
        },
        {
          type: 'list',
          items: [
            'Messaging tier: the number can only start a fixed number of business-initiated conversations in 24h (1k, 10k, 100k). Going past the tier returns an error and insisting the same day does not help.',
            'Number quality: Meta measures blocks, reports and spam flags in real time. A burst send to a cold list drops quality fast, and low quality downgrades the tier.',
            'Block risk: red quality plus aggressive volume leads Meta to restrict or ban the number, taking down even the legitimate transactional messages.',
            'Cascading 429 errors: blowing past the rate limit produces mass 429; without backpressure, naive retry feeds the storm and degrades the overall delivery rate.',
            'Cost and window: conversations have a cost and a 24h window. Firing off-pace wastes useful tier and may blow the budget without actually delivering faster.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The distributed-systems reading is simple: the queue is your buffer and the rate limiter is your valve. Backpressure is not a limitation to work around, it is the guarantee that the peak turns into sustained delivery instead of a block.',
        },
      ],
    },
    {
      title: 'Rate limiter + worker consuming the queue at X msg/s',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In practice, BullMQ already offers a native limiter on the Worker, which implements rate control across the group of workers that share the same queue and Redis. You define how many jobs can be processed per time window, and concurrency controls the parallelism within that ceiling. The example below enqueues the campaign and consumes it respecting 80 messages per second, with exponential retry and a DLQ for definitive failures.',
        },
        {
          type: 'code',
          value: `const { Queue, Worker, QueueEvents } = require('bullmq');
const connection = { url: process.env.REDIS_URL };

// Target throughput: keep it below the real Cloud API limit.
const MESSAGES_PER_SECOND = 80;

const campaignQueue = new Queue('wa-campaign', { connection });
const dlq = new Queue('wa-campaign-dlq', { connection });

// Producer: enqueue 1 job per contact. The queue absorbs the burst.
async function enqueueCampaign(campaignId, contacts, template) {
  const jobs = contacts.map((contact) => ({
    name: 'send',
    data: { campaignId, to: contact.phone, template },
    opts: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 }, // 2s, 4s, 8s, 16s
      removeOnComplete: true,
      removeOnFail: false,
    },
  }));
  await campaignQueue.addBulk(jobs);
}

// Worker pool: the limiter regulates OUTPUT to X msg/s across the group.
const worker = new Worker(
  'wa-campaign',
  async (job) => {
    const { to, template } = job.data;
    const res = await sendViaCloudApi(to, template);
    // Respect Meta's Retry-After instead of hammering the API.
    if (res.status === 429) {
      const retryAfter = Number(res.headers['retry-after'] || 1);
      throw new RateLimitError(retryAfter * 1000);
    }
    if (res.status >= 500) throw new Error('Cloud API 5xx');
    return res.body;
  },
  {
    connection,
    concurrency: 20,               // parallelism: protects local resources
    limiter: {
      max: MESSAGES_PER_SECOND,    // send ceiling...
      duration: 1000,              // ...per second (token bucket)
    },
  },
);

// Definitive failure after exhausting retries: goes to the DLQ, not lost.
worker.on('failed', async (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
    await dlq.add('dead-letter', {
      payload: job.data,
      error: err.message,
      failedAt: new Date().toISOString(),
    });
  }
});`,
        },
        {
          type: 'paragraph',
          value:
            'Notice how the 429 is not treated as a permanent error: the worker throws a rate-limit error and the job returns to the queue with backoff, respecting Meta Retry-After. Only after exhausting all attempts does the event go to the DLQ. That is what distinguishes temporary throttling from real failure and avoids losing deliveries that would have gone out minutes later.',
        },
      ],
    },
    {
      title: 'Prioritization: transactional ahead of marketing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'During a campaign peak, a transactional message (OTP code, order confirmation, alert) cannot sit behind 100k marketing messages in the queue. The solution is to separate by priority. There are two approaches, and at high volume it pays to combine both:',
        },
        {
          type: 'list',
          items: [
            'Separate queues by class: a wa-transactional queue and a wa-campaign queue, with distinct workers and even distinct rate budgets. Transactional gets resource priority and does not compete for tokens with the campaign.',
            'Priority within the queue: use BullMQ priority field so urgent jobs jump ahead without needing a physically separate queue when volume is lower.',
            'Capacity reservation: if the Cloud API allows N msg/s in total, reserve a slice (e.g. 20%) for transactional and size the campaign limiter for the rest, ensuring marketing never consumes 100% of throughput.',
            'Asymmetric throttle: marketing tolerates a delay of minutes; transactional does not. Size retries and backoff more aggressively on the campaign and shorter on transactional.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The distributed-systems principle here is resource isolation: you do not let a low-priority, high-volume load degrade the latency of a critical, low-volume load. Separate queues with their own budgets are the cleanest way to guarantee that isolation.',
        },
      ],
    },
    {
      title: 'Parameters to size',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Sizing the queue is an exercise in calibrating a few parameters against your number real limit and the urgency of each message class. The table summarizes the main ones and the criteria.',
        },
        {
          type: 'table',
          columns: ['Parameter', 'What it controls', 'How to size it'],
          rows: [
            [
              'Target throughput (msg/s)',
              'Limiter output rate',
              'Below the real Cloud API rate limit, with a safety margin (e.g. 80% of the ceiling)',
            ],
            [
              'Worker concurrency',
              'Parallelism of in-flight sends',
              'Enough to saturate throughput without exhausting connections/memory; raise until the limiter becomes the bottleneck',
            ],
            [
              'TTL / validity window',
              'How long a job can wait before becoming irrelevant',
              'Short for transactional (seconds/minutes); longer for marketing within the 24h window',
            ],
            [
              'Retries',
              'Attempts before giving up',
              '3 to 5 with exponential backoff; respecting Retry-After on 429 without counting as a permanent failure',
            ],
            [
              'DLQ',
              'Destination of definitive failures',
              'Always on; with growth alerting for human inspection of real errors (invalid number, rejected template)',
            ],
            [
              'Transactional reserve',
              'Protected slice of throughput',
              'Fixed percentage (e.g. 20%) the campaign never consumes, guaranteeing critical latency',
            ],
          ],
        },
      ],
    },
    {
      title: 'What to monitor during the peak',
      blocks: [
        {
          type: 'paragraph',
          value:
            'During a peak, three signals tell whether the system is healthy or sinking. Queue depth shows the backlog: rising is expected at the start, but it must drain at a stable rate. Message age (how long the oldest job has waited) reveals whether delivery is within the acceptable window; rising age on transactional is an immediate alarm. Error rate, split by type (429 from rate limit, 4xx from invalid template, 5xx from the API), distinguishes expected throttling from real failure.',
        },
        {
          type: 'ordered',
          items: [
            'Queue depth by class: campaign and transactional backlog measured separately, with the drain rate.',
            'Age of the oldest message: wait time of the job at the top of the queue, with a different alert per priority.',
            'Segmented error rate: 429 (rate limit, expected), 4xx (template/number, actionable), 5xx (unstable API).',
            'DLQ size and growth: should stay near zero; growth points to a real error to investigate.',
            'Number quality and tier: track the phone quality rating and messaging tier to brake the campaign before a downgrade.',
            'Effective throughput vs target: compare real msg/s with the limiter target to detect a worker bottleneck or API throttle.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'How do I find the right rate limit to configure the limiter?',
      answer:
        'Start from the documented Cloud API limit for your number and tier, but treat it as a ceiling, not a target. Configure the limiter with a margin (for example 80% of the ceiling) and watch the 429 rate during a real peak. If 429 appear even below the ceiling, reduce the target throughput. The goal is to operate at a point where 429 is rare and handled by retry, not the norm.',
    },
    {
      question: 'What is the difference between worker concurrency and the rate limiter?',
      answer:
        'They are two controls with distinct purposes. Concurrency limits how many sends happen in parallel and protects your local resources (connections, memory, sockets). The rate limiter limits how many sends per second in total and protects the external Cloud API limit. You can have high concurrency, but the rate limiter still holds the output at the msg/s ceiling. The two must be sized together.',
    },
    {
      question: 'What do I do when the number messaging tier runs out mid-campaign?',
      answer:
        'When the tier runs out, new business-initiated sends return an error and resending the same day does not help. The right move is to detect that specific error, pause the campaign queue (without losing the jobs, which stay enqueued) and resume when the 24h window renews or when the tier rises. Transactional messages on a separate queue keep flowing. Treating this as a controlled pause, not a failure, avoids marking valid contacts as errors.',
    },
  ],
  conclusion: {
    title: 'A campaign peak is a flow problem, not a loop',
    description:
      'A durable queue, a token bucket respecting the Cloud API rate limit, backpressure aware of the messaging tier and prioritization of transactional traffic form the architecture that delivers bulk campaigns without blocking or loss. If you need to fire high volume without risking the number quality, I can help design this queue.',
    cta: 'Talk about my campaign',
  },
  related: [
    { label: 'Idempotency and queues in the WhatsApp webhook', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Monitoring and alerts for integrations', to: '/blog/monitoramento-alertas-integracoes' },
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
  ],
  repo: {
    name: 'whatsapp-campaign-queue',
    description:
      'Example WhatsApp campaign queue with a token bucket rate limiter, worker pool, prioritization and DLQ.',
    url: 'https://github.com/joaosouz4dev/whatsapp-campaign-queue',
  },
};

const es = {
  intro:
    'Una campana de marketing pulsa el boton de disparo y, en un instante, 100 mil mensajes se forman en cola para salir. El problema es que la WhatsApp Cloud API no acepta ese volumen de una vez: existe un rate limit de llamadas por segundo y el numero tiene un messaging tier que limita con cuantos usuarios unicos puedes iniciar conversacion en 24h. Disparar todo de una vez es la receta segura para errores 429, caidas de calidad y bloqueo del numero. Esta guia muestra como dimensionar la cola, el rate limiter y el backpressure para entregar picos de campana sin bloqueo y sin perdida.',
  sections: [
    {
      title: 'El problema: 100k mensajes contra un rate limit',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando una campana dispara, el instinto es iterar la lista de contactos y llamar a la API en bucle. Funciona con mil contactos. Con cien mil, el sistema choca con tres limites a la vez. Primero, el rate limit de la Cloud API: hay un techo de peticiones por segundo por numero, y superarlo devuelve HTTP 429 con Retry-After. Segundo, el messaging tier del numero, que limita cuantas conversaciones iniciadas por el negocio (business-initiated) puedes abrir en una ventana de 24h: 1k, 10k, 100k o ilimitado, segun el tier. Tercero, la calidad del numero, que Meta evalua en tiempo real y que, si cae, rebaja el tier o bloquea el envio.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia de ignorar estos limites no es solo lentitud. Los disparos en rafaga generan un pico de 429, y el codigo ingenuo suele reaccionar con retry inmediato, lo que aumenta la carga y empeora la tormenta. Peor aun: marcar contactos como bloqueo o error permanente cuando en realidad era throttling temporal te hace perder entregas que podrian haber salido minutos despues. El envio masivo debe tratarse como un problema de flujo controlado, no de bucle.',
        },
      ],
    },
    {
      title: 'Arquitectura: productor, cola y worker pool con rate limiter',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La arquitectura que sostiene los picos separa a quien produce el trabajo de quien lo ejecuta. Un productor recibe la campana y encola un job por mensaje (o por lote pequeno). Una cola durable guarda esos jobs. Un pool de workers consume la cola, pero no a velocidad maxima: un rate limiter al estilo token bucket regula la salida para respetar exactamente el limite de mensajes por segundo de la Cloud API. El token bucket es la pieza central: llena tokens a una tasa constante (igual a tu throughput objetivo) y cada envio consume un token. Sin token, el worker espera. Esto convierte una rafaga de 100k en un flujo suave de X msg/s.',
        },
        {
          type: 'diagram',
          value: `Campana (100k contactos)
        |
        |  encola 1 job por mensaje
        v
+--------------------------+
|        Productor         |
|  valida + segmenta lista |
+--------------------------+
        |
        v
+--------------------------+      tokens a X/s
|          Cola            |   +------------------+
|   (Redis / BullMQ)       |   |   Token Bucket   |
|  durable, con prioridad  |   | llena X tokens/s |
+--------------------------+   +------------------+
        |                              |
        |  pull                        | gasta 1 token/envio
        v                              v
+--------------------------------------------------+
|                 Worker Pool                      |
|   w1   w2   w3   ...   wN  (concurrencia limit.) |
|   cada envio: toma token -> llama Cloud API      |
+--------------------------------------------------+
        |                         |
        | 200 OK                  | 429 / 5xx -> retry backoff
        v                         v
   entregado                 reencola
                                  |
                             retries agotados
                                  v
                             +--------+
                             |  DLQ   |
                             +--------+`,
        },
        {
          type: 'paragraph',
          value:
            'El punto clave es que dos controles actuan juntos y por motivos distintos. La concurrencia del worker pool (cuantos envios ocurren en paralelo) protege tus propios recursos: conexiones, memoria, sockets. El rate limiter (cuantos envios por segundo en total) protege el limite externo de la Cloud API. Puedes tener 20 workers concurrentes, pero si el token bucket solo libera 80 tokens por segundo, el techo efectivo sigue siendo 80 msg/s. Ambos deben dimensionarse juntos.',
        },
      ],
    },
    {
      title: 'Backpressure: por que no disparar todo de una vez',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El backpressure es el mecanismo que hace que el productor desacelere cuando el consumidor no da abasto. En una campana, la cola ya cumple ese papel: el productor encola rapido, pero los workers consumen al ritmo del rate limiter. Lo que no puedes hacer es saltarte la cola y empujar todo a la API. Los motivos son concretos:',
        },
        {
          type: 'list',
          items: [
            'Messaging tier: el numero solo puede iniciar un numero fijo de conversaciones business-initiated en 24h (1k, 10k, 100k). Pasar del tier devuelve error y no sirve insistir el mismo dia.',
            'Calidad del numero: Meta mide en tiempo real bloqueos, denuncias y marcas de spam. Un pico de disparo a una lista fria derrumba la calidad rapido, y la calidad baja rebaja el tier.',
            'Riesgo de block: calidad roja sumada a volumen agresivo lleva a Meta a restringir o banear el numero, tumbando incluso los mensajes transaccionales legitimos.',
            'Errores 429 en cascada: superar el rate limit genera 429 en masa; sin backpressure, el retry ingenuo realimenta la tormenta y degrada la tasa de entrega general.',
            'Costo y ventana: las conversaciones tienen costo y ventana de 24h. Disparar fuera de ritmo desperdicia tier util y puede reventar el presupuesto sin entregar mas rapido en realidad.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La lectura de sistemas distribuidos es simple: la cola es tu buffer y el rate limiter es tu valvula. El backpressure no es una limitacion a sortear, es la garantia de que el pico se convierte en entrega sostenida en vez de bloqueo.',
        },
      ],
    },
    {
      title: 'Rate limiter + worker consumiendo la cola a X msg/s',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En la practica, BullMQ ya ofrece un limiter nativo en el Worker, que implementa el control de tasa sobre el grupo de workers que comparten la misma cola y Redis. Defines cuantos jobs pueden procesarse por ventana de tiempo, y la concurrencia controla el paralelismo dentro de ese techo. El ejemplo siguiente encola la campana y la consume respetando 80 mensajes por segundo, con retry exponencial y DLQ para fallos definitivos.',
        },
        {
          type: 'code',
          value: `const { Queue, Worker, QueueEvents } = require('bullmq');
const connection = { url: process.env.REDIS_URL };

// Throughput objetivo: mantenlo por debajo del limite real de la Cloud API.
const MESSAGES_PER_SECOND = 80;

const campaignQueue = new Queue('wa-campaign', { connection });
const dlq = new Queue('wa-campaign-dlq', { connection });

// Productor: encola 1 job por contacto. La cola absorbe la rafaga.
async function enqueueCampaign(campaignId, contacts, template) {
  const jobs = contacts.map((contact) => ({
    name: 'send',
    data: { campaignId, to: contact.phone, template },
    opts: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 }, // 2s, 4s, 8s, 16s
      removeOnComplete: true,
      removeOnFail: false,
    },
  }));
  await campaignQueue.addBulk(jobs);
}

// Worker pool: el limiter regula la SALIDA a X msg/s en todo el grupo.
const worker = new Worker(
  'wa-campaign',
  async (job) => {
    const { to, template } = job.data;
    const res = await sendViaCloudApi(to, template);
    // Respeta el Retry-After de Meta en vez de golpear la API.
    if (res.status === 429) {
      const retryAfter = Number(res.headers['retry-after'] || 1);
      throw new RateLimitError(retryAfter * 1000);
    }
    if (res.status >= 500) throw new Error('Cloud API 5xx');
    return res.body;
  },
  {
    connection,
    concurrency: 20,               // paralelismo: protege recursos locales
    limiter: {
      max: MESSAGES_PER_SECOND,    // techo de envios...
      duration: 1000,              // ...por segundo (token bucket)
    },
  },
);

// Fallo definitivo tras agotar los retries: va a la DLQ, no se pierde.
worker.on('failed', async (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
    await dlq.add('dead-letter', {
      payload: job.data,
      error: err.message,
      failedAt: new Date().toISOString(),
    });
  }
});`,
        },
        {
          type: 'paragraph',
          value:
            'Observa como el 429 no se trata como error permanente: el worker lanza un error de rate limit y el job vuelve a la cola con backoff, respetando el Retry-After de Meta. Solo tras agotar todos los intentos el evento va a la DLQ. Eso es lo que diferencia el throttling temporal de un fallo real y evita perder entregas que saldrian minutos despues.',
        },
      ],
    },
    {
      title: 'Priorizacion: transaccional por delante del marketing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Durante un pico de campana, un mensaje transaccional (codigo OTP, confirmacion de pedido, alerta) no puede quedar detras de 100 mil mensajes de marketing en la cola. La solucion es separar por prioridad. Hay dos enfoques, y en alto volumen conviene combinar ambos:',
        },
        {
          type: 'list',
          items: [
            'Colas separadas por clase: una cola wa-transactional y otra wa-campaign, con workers e incluso budgets de tasa distintos. La transaccional tiene prioridad de recursos y no compite por tokens con la campana.',
            'Prioridad dentro de la cola: usar el campo priority de BullMQ para que los jobs urgentes pasen al frente sin necesitar una cola fisica separada cuando el volumen es menor.',
            'Reserva de capacidad: si la Cloud API permite N msg/s en total, reserva una porcion (ej.: 20%) para transaccional y dimensiona el limiter de la campana para el resto, garantizando que el marketing nunca consuma el 100% del throughput.',
            'Throttle asimetrico: el marketing tolera retraso de minutos; el transaccional no. Dimensiona retries y backoff mas agresivos en la campana y mas cortos en el transaccional.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El principio de sistemas distribuidos aqui es el aislamiento de recursos: no dejas que una carga de baja prioridad y alto volumen degrade la latencia de una carga critica y de bajo volumen. Las colas separadas con budgets propios son la forma mas limpia de garantizar ese aislamiento.',
        },
      ],
    },
    {
      title: 'Parametros a dimensionar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Dimensionar la cola es un ejercicio de calibrar pocos parametros contra el limite real de tu numero y la urgencia de cada clase de mensaje. La tabla resume los principales y los criterios.',
        },
        {
          type: 'table',
          columns: ['Parametro', 'Que controla', 'Como dimensionarlo'],
          rows: [
            [
              'Throughput objetivo (msg/s)',
              'Tasa de salida del limiter',
              'Por debajo del rate limit real de la Cloud API, con margen de seguridad (ej.: 80% del techo)',
            ],
            [
              'Concurrencia del worker',
              'Paralelismo de los envios en vuelo',
              'Suficiente para saturar el throughput sin agotar conexiones/memoria; sube hasta que el limiter sea el cuello de botella',
            ],
            [
              'TTL / ventana de validez',
              'Cuanto puede esperar un job antes de volverse irrelevante',
              'Corto para transaccional (segundos/minutos); mayor para marketing dentro de la ventana de 24h',
            ],
            [
              'Retries',
              'Intentos antes de rendirse',
              '3 a 5 con backoff exponencial; respetando Retry-After en 429 sin contar como fallo permanente',
            ],
            [
              'DLQ',
              'Destino de los fallos definitivos',
              'Siempre activa; con alerta de crecimiento para inspeccion humana de errores reales (numero invalido, template rechazado)',
            ],
            [
              'Reserva transaccional',
              'Porcion de throughput protegida',
              'Porcentaje fijo (ej.: 20%) que la campana nunca consume, garantizando la latencia de lo critico',
            ],
          ],
        },
      ],
    },
    {
      title: 'Que monitorear durante el pico',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Durante un pico, tres senales dicen si el sistema esta sano o hundiendose. La profundidad de la cola muestra el backlog: subir es esperado al inicio, pero debe drenar a una tasa estable. La edad del mensaje (cuanto tiempo lleva esperando el job mas antiguo) revela si la entrega esta dentro de la ventana aceptable; una edad creciente en el transaccional es alarma inmediata. La tasa de error, separada por tipo (429 de rate limit, 4xx de template invalido, 5xx de la API), distingue el throttling esperado del fallo real.',
        },
        {
          type: 'ordered',
          items: [
            'Profundidad de la cola por clase: backlog de campana y de transaccional medidos por separado, con la tasa de drenaje.',
            'Edad del mensaje mas antiguo: tiempo de espera del job en la cima de la cola, con alerta distinta por prioridad.',
            'Tasa de error segmentada: 429 (rate limit, esperado), 4xx (template/numero, accionable), 5xx (API inestable).',
            'Tamano y crecimiento de la DLQ: debe quedar cerca de cero; el crecimiento apunta a un error real a investigar.',
            'Calidad y tier del numero: seguir el phone quality rating y el messaging tier para frenar la campana antes del rebaje.',
            'Throughput efectivo vs objetivo: comparar los msg/s reales con el objetivo del limiter para detectar cuello de botella de worker o throttle de la API.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Como descubro el rate limit correcto para configurar el limiter?',
      answer:
        'Empieza por el limite documentado de la Cloud API para tu numero y tier, pero tratalo como techo, no como objetivo. Configura el limiter con margen (por ejemplo 80% del techo) y observa la tasa de 429 durante un pico real. Si aparecen 429 incluso por debajo del techo, reduce el throughput objetivo. La meta es operar en un punto donde el 429 sea raro y se maneje con retry, no la norma.',
    },
    {
      question: 'Cual es la diferencia entre la concurrencia del worker y el rate limiter?',
      answer:
        'Son dos controles con proposito distinto. La concurrencia limita cuantos envios ocurren en paralelo y protege tus recursos locales (conexiones, memoria, sockets). El rate limiter limita cuantos envios por segundo en total y protege el limite externo de la Cloud API. Puedes tener alta concurrencia, pero el rate limiter sigue sujetando la salida en el techo de msg/s. Ambos deben dimensionarse en conjunto.',
    },
    {
      question: 'Que hago cuando el messaging tier del numero se agota a mitad de la campana?',
      answer:
        'Cuando el tier se agota, los nuevos disparos business-initiated devuelven error y no sirve reenviar el mismo dia. Lo correcto es detectar ese error especifico, pausar la cola de campana (sin perder los jobs, que quedan encolados) y retomar cuando la ventana de 24h se renueva o cuando el tier sube. Los mensajes transaccionales en cola separada siguen fluyendo. Tratar esto como pausa controlada, y no como fallo, evita marcar contactos validos como error.',
    },
  ],
  conclusion: {
    title: 'Un pico de campana es problema de flujo, no de bucle',
    description:
      'Una cola durable, un token bucket que respeta el rate limit de la Cloud API, backpressure consciente del messaging tier y priorizacion del transaccional forman la arquitectura que entrega campanas masivas sin bloqueo ni perdida. Si necesitas disparar volumen alto sin arriesgar la calidad del numero, puedo ayudar a disenar esta cola.',
    cta: 'Hablar sobre mi campana',
  },
  related: [
    { label: 'Idempotencia y colas en el webhook de WhatsApp', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Monitoreo y alertas en integraciones', to: '/blog/monitoramento-alertas-integracoes' },
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
  ],
  repo: {
    name: 'whatsapp-campaign-queue',
    description:
      'Ejemplo de cola de campana en WhatsApp con rate limiter token bucket, worker pool, priorizacion y DLQ.',
    url: 'https://github.com/joaosouz4dev/whatsapp-campaign-queue',
  },
};

export default { pt, en, es };
