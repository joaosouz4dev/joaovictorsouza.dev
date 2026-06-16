const pt = {
  intro:
    'Integrar com a Meta e o WhatsApp Cloud API significa expor endpoints publicos, manipular tokens de longa duracao e processar dados de pessoas reais. Cada um desses pontos e uma superficie de ataque. Este checklist reune as praticas de AppSec que evitam que um webhook vire porta de entrada: verificacao de assinatura, segregacao e rotacao de credenciais, rate limiting e trilha de auditoria. O foco e pratico, com codigo que voce pode colar e adaptar hoje.',
  sections: [
    {
      title: 'Por que a seguranca de webhooks da Meta exige atencao especial',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um webhook e um endpoint HTTP publico. Qualquer pessoa na internet pode envia-lo um POST forjado. Sem verificacao de assinatura, seu sistema processaria mensagens falsas, eventos duplicados e payloads maliciosos como se fossem legitimos. A Meta resolve isso assinando cada requisicao com HMAC SHA-256 usando o App Secret, e cabe a voce validar essa assinatura antes de confiar em qualquer byte do corpo.',
        },
        {
          type: 'paragraph',
          value:
            'Alem da assinatura, ha tres outras camadas que separam uma integracao amadora de uma integracao de producao: credenciais segregadas e rotacionaveis, limites de taxa para conter abuso e uma trilha de auditoria que permite reconstruir o que aconteceu sem vazar dados pessoais.',
        },
        {
          type: 'diagram',
          value: `Internet  -->  [Edge / WAF]  -->  [Verificacao HMAC]  -->  [Rate limit]  -->  [Handler]
                                |                    |                 |
                            bloqueia            rejeita 401       rejeita 429
                            payload bruto       assinatura        excedeu cota
                                                invalida`,
        },
      ],
    },
    {
      title: 'Verificacao de assinatura do webhook (x-hub-signature-256)',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A Meta envia o cabecalho x-hub-signature-256 no formato sha256=<hex>. O valor e o HMAC SHA-256 do corpo bruto da requisicao usando o App Secret como chave. Duas regras inegociaveis: use o body cru (raw), nao o JSON ja parseado e re-serializado, porque qualquer diferenca de bytes muda o hash; e compare com timingSafeEqual para evitar ataques de timing.',
        },
        {
          type: 'code',
          value: `const crypto = require('crypto');

// Capture o corpo cru antes de qualquer parser JSON.
// No Express: express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } })

function verifyMetaSignature(req) {
  const header = req.get('x-hub-signature-256');
  if (!header || !header.startsWith('sha256=')) return false;

  const expected = header.slice('sha256='.length);
  const hmac = crypto.createHmac('sha256', process.env.META_APP_SECRET);
  hmac.update(req.rawBody); // Buffer cru, nao JSON.stringify(req.body)
  const computed = hmac.digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(expected, 'hex');

  // timingSafeEqual exige buffers do mesmo tamanho.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

app.post('/webhook', (req, res) => {
  if (!verifyMetaSignature(req)) {
    return res.sendStatus(401); // assinatura invalida
  }
  res.sendStatus(200); // confirme rapido, processe em fila
  enqueue(req.body);
});`,
        },
        {
          type: 'paragraph',
          value:
            'Note o padrao: responda 200 imediatamente apos validar e empurre o processamento para uma fila. A Meta reentrega eventos nao confirmados, entao processamento sincrono e lento gera duplicatas e timeouts.',
        },
      ],
    },
    {
      title: 'Segregacao e rotacao de credenciais',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Tratar App Secret e tokens como segredos de verdade e o que evita o pior cenario: um vazamento de credencial com permissoes amplas e sem expiracao. Cada credencial deve ter escopo minimo, origem clara e um plano de rotacao.',
        },
        {
          type: 'list',
          items: [
            'App Secret: usado apenas para verificar assinaturas. Nunca o exponha em frontend, logs ou repositorio. Trate-o como chave criptografica.',
            'System User token: prefira tokens de System User (longa duracao e renovaveis) a tokens de usuario pessoal, que quebram quando a pessoa sai da empresa.',
            'Escopo minimo: conceda apenas as permissoes que a integracao realmente usa (por exemplo whatsapp_business_messaging), nada de pedir tudo por conveniencia.',
            'Cofre de segredos: armazene em um secrets manager (AWS Secrets Manager, Vault, GCP Secret Manager). Nunca em .env versionado ou em variaveis de imagem Docker.',
            'Rotacao programada: defina um ciclo (por exemplo a cada 90 dias) e tenha um runbook para girar o App Secret e revogar tokens antigos sem downtime.',
            'Segregacao por ambiente: credenciais de producao, staging e dev devem ser distintas. Um vazamento em dev nunca pode comprometer producao.',
          ],
        },
      ],
    },
    {
      title: 'Rate limiting e protecao contra abuso',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo com assinatura valida, voce precisa limitar a taxa por origem para conter picos, loops de reentrega e tentativas de exaustao de recursos. Aplique limites por IP na borda e por tenant na aplicacao, usando um algoritmo de token bucket que tolera rajadas curtas mas corta abuso sustentado.',
        },
        {
          type: 'code',
          value: `// Token bucket simples por chave (IP ou tenant).
class TokenBucket {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity;
    this.refill = refillPerSec;
    this.tokens = capacity;
    this.last = Date.now();
  }
  allow(cost = 1) {
    const now = Date.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.last) / 1000) * this.refill
    );
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

const buckets = new Map(); // em producao: Redis com TTL
function rateLimit(key) {
  if (!buckets.has(key)) buckets.set(key, new TokenBucket(60, 1));
  return buckets.get(key).allow();
}`,
        },
        {
          type: 'paragraph',
          value:
            'Em escala, troque o Map em memoria por Redis para que o limite seja consistente entre instancias. Responda 429 com Retry-After quando a cota estourar.',
        },
      ],
    },
    {
      title: 'Trilha de auditoria sem PII em claro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma boa trilha de auditoria responde quem fez o que, quando e a partir de onde, sem transformar o log em um deposito de dados pessoais. Registre identificadores e metadados, nunca o conteudo da mensagem ou numeros de telefone em texto puro. Para correlacionar sem expor, use hash ou pseudonimizacao.',
        },
        {
          type: 'table',
          columns: ['Campo', 'O que registrar', 'PII?'],
          rows: [
            ['quem', 'ID do tenant, ID do app, sub do token', 'Nao (use IDs internos)'],
            ['o que', 'Tipo do evento (ex: message.received), acao tomada', 'Nao'],
            ['quando', 'Timestamp UTC e ID de correlacao do evento', 'Nao'],
            ['de onde', 'IP de origem (mascarado), user-agent', 'Parcial (mascare IP)'],
            ['contato', 'Hash do telefone (SHA-256 + salt), nunca o numero', 'Nao se hasheado'],
            ['resultado', 'Status (ok, rejeitado, 401, 429) e motivo', 'Nao'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Defina retencao explicita para os logs e garanta que eles sejam imutaveis (append-only). Sob LGPD e GDPR, log nao e desculpa para reter dados pessoais indefinidamente.',
        },
      ],
    },
    {
      title: 'LGPD e GDPR: consentimento e minimizacao',
      blocks: [
        {
          type: 'paragraph',
          value:
            'WhatsApp envolve dados pessoais por definicao. Dois principios guiam a conformidade no contexto de integracoes: base legal e consentimento para iniciar conversas (especialmente mensagens de marketing), e minimizacao de dados, ou seja, colete e armazene apenas o estritamente necessario para a finalidade declarada.',
        },
        {
          type: 'list',
          items: [
            'Consentimento: tenha registro de opt-in antes de enviar mensagens proativas e respeite o opt-out imediatamente.',
            'Minimizacao: nao persista o corpo das mensagens se a finalidade nao exige; prefira processar e descartar.',
            'Direitos do titular: tenha um caminho para exclusao e portabilidade dos dados quando solicitado.',
          ],
        },
      ],
    },
    {
      title: 'Checklist final acionavel',
      blocks: [
        {
          type: 'ordered',
          items: [
            'Capturar o corpo cru e validar x-hub-signature-256 com HMAC SHA-256 e timingSafeEqual antes de processar.',
            'Responder 200 rapido e processar em fila, com idempotencia por ID de evento.',
            'Mover App Secret e tokens para um secrets manager, fora de qualquer arquivo versionado.',
            'Usar System User token com escopo minimo e separar credenciais por ambiente.',
            'Definir e testar um ciclo de rotacao de credenciais com runbook sem downtime.',
            'Aplicar rate limiting por IP na borda e por tenant na aplicacao (token bucket + Redis).',
            'Registrar trilha de auditoria append-only com IDs e hashes, sem PII em claro, com retencao definida.',
            'Documentar base legal, opt-in/opt-out e politica de minimizacao para LGPD e GDPR.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Posso usar JSON.stringify do corpo para calcular o HMAC?',
      answer:
        'Nao. A assinatura e calculada sobre os bytes exatos enviados pela Meta. Re-serializar o JSON muda espacos, ordem e escaping, gerando um hash diferente. Capture o raw body com um verify do parser e use esse Buffer.',
    },
    {
      question: 'Por que comparar a assinatura com timingSafeEqual em vez de ===?',
      answer:
        'Comparacoes de string normais retornam mais rapido quando os primeiros caracteres divergem, o que vaza informacao por timing e permite reconstruir a assinatura tentativa a tentativa. timingSafeEqual compara em tempo constante, fechando esse canal lateral.',
    },
    {
      question: 'Onde devo guardar o App Secret em producao?',
      answer:
        'Em um secrets manager dedicado (AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager) com acesso por IAM e rotacao programada. Nunca em .env commitado, em variaveis de build da imagem Docker ou em qualquer lugar acessivel pelo frontend.',
    },
  ],
  conclusion: {
    title: 'Seguranca de integracao nao e opcional',
    description:
      'Assinatura verificada, credenciais segregadas, limites de taxa e auditoria limpa formam a base de uma integracao Meta e WhatsApp que aguenta producao e auditoria. Comece pelo checklist final e feche cada lacuna antes de ir ao ar.',
    cta: 'Precisa de uma revisao de seguranca da sua integracao WhatsApp? Fale comigo.',
  },
  related: [
    { label: 'Webhook do WhatsApp: idempotencia e filas', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Monitoramento e alertas para integracoes', to: '/blog/monitoramento-alertas-integracoes' },
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
  ],
  repo: {
    name: 'meta-webhook-security',
    description: 'Exemplo de verificacao de assinatura, rate limiting e auditoria para webhooks da Meta.',
    url: 'https://github.com/joaosouz4dev/meta-webhook-security',
  },
};

const en = {
  intro:
    'Integrating with Meta and the WhatsApp Cloud API means exposing public endpoints, handling long-lived tokens and processing real people data. Each of these is an attack surface. This checklist gathers the AppSec practices that keep a webhook from becoming an entry point: signature verification, credential segregation and rotation, rate limiting and an audit trail. The focus is practical, with code you can paste and adapt today.',
  sections: [
    {
      title: 'Why Meta webhook security needs special attention',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A webhook is a public HTTP endpoint. Anyone on the internet can send it a forged POST. Without signature verification, your system would process fake messages, duplicate events and malicious payloads as if they were legitimate. Meta solves this by signing every request with HMAC SHA-256 using the App Secret, and it is up to you to validate that signature before trusting a single byte of the body.',
        },
        {
          type: 'paragraph',
          value:
            'Beyond the signature, three other layers separate an amateur integration from a production one: segregated, rotatable credentials, rate limits to contain abuse, and an audit trail that lets you reconstruct what happened without leaking personal data.',
        },
        {
          type: 'diagram',
          value: `Internet  -->  [Edge / WAF]  -->  [HMAC verify]  -->  [Rate limit]  -->  [Handler]
                                |                  |                 |
                            blocks            rejects 401       rejects 429
                            raw payload       invalid sig       quota exceeded`,
        },
      ],
    },
    {
      title: 'Webhook signature verification (x-hub-signature-256)',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Meta sends the x-hub-signature-256 header in the format sha256=<hex>. The value is the HMAC SHA-256 of the raw request body using the App Secret as the key. Two non-negotiable rules: use the raw body, not the parsed and re-serialized JSON, because any byte difference changes the hash; and compare with timingSafeEqual to prevent timing attacks.',
        },
        {
          type: 'code',
          value: `const crypto = require('crypto');

// Capture the raw body before any JSON parser.
// In Express: express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } })

function verifyMetaSignature(req) {
  const header = req.get('x-hub-signature-256');
  if (!header || !header.startsWith('sha256=')) return false;

  const expected = header.slice('sha256='.length);
  const hmac = crypto.createHmac('sha256', process.env.META_APP_SECRET);
  hmac.update(req.rawBody); // raw Buffer, not JSON.stringify(req.body)
  const computed = hmac.digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(expected, 'hex');

  // timingSafeEqual requires equal-length buffers.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

app.post('/webhook', (req, res) => {
  if (!verifyMetaSignature(req)) {
    return res.sendStatus(401); // invalid signature
  }
  res.sendStatus(200); // ack fast, process in a queue
  enqueue(req.body);
});`,
        },
        {
          type: 'paragraph',
          value:
            'Note the pattern: respond 200 immediately after validating and push processing to a queue. Meta retries unacknowledged events, so slow synchronous processing causes duplicates and timeouts.',
        },
      ],
    },
    {
      title: 'Credential segregation and rotation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Treating the App Secret and tokens as real secrets is what prevents the worst case: a credential leak with broad permissions and no expiration. Every credential should have minimal scope, a clear origin and a rotation plan.',
        },
        {
          type: 'list',
          items: [
            'App Secret: used only to verify signatures. Never expose it in the frontend, logs or repository. Treat it as a cryptographic key.',
            'System User token: prefer System User tokens (long-lived and renewable) over personal user tokens, which break when the person leaves the company.',
            'Minimal scope: grant only the permissions the integration actually uses (for example whatsapp_business_messaging), do not request everything for convenience.',
            'Secrets vault: store them in a secrets manager (AWS Secrets Manager, Vault, GCP Secret Manager). Never in a versioned .env or in Docker image variables.',
            'Scheduled rotation: set a cycle (for example every 90 days) and keep a runbook to rotate the App Secret and revoke old tokens without downtime.',
            'Per-environment segregation: production, staging and dev credentials must be distinct. A leak in dev should never compromise production.',
          ],
        },
      ],
    },
    {
      title: 'Rate limiting and abuse protection',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Even with a valid signature, you need to rate-limit by origin to contain spikes, retry loops and resource-exhaustion attempts. Apply per-IP limits at the edge and per-tenant limits in the application, using a token bucket algorithm that tolerates short bursts but cuts sustained abuse.',
        },
        {
          type: 'code',
          value: `// Simple token bucket per key (IP or tenant).
class TokenBucket {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity;
    this.refill = refillPerSec;
    this.tokens = capacity;
    this.last = Date.now();
  }
  allow(cost = 1) {
    const now = Date.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.last) / 1000) * this.refill
    );
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

const buckets = new Map(); // in production: Redis with TTL
function rateLimit(key) {
  if (!buckets.has(key)) buckets.set(key, new TokenBucket(60, 1));
  return buckets.get(key).allow();
}`,
        },
        {
          type: 'paragraph',
          value:
            'At scale, swap the in-memory Map for Redis so the limit is consistent across instances. Respond 429 with Retry-After when the quota is exceeded.',
        },
      ],
    },
    {
      title: 'Audit trail without PII in cleartext',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A good audit trail answers who did what, when and from where, without turning the log into a dump of personal data. Record identifiers and metadata, never the message content or phone numbers in plain text. To correlate without exposing, use hashing or pseudonymization.',
        },
        {
          type: 'table',
          columns: ['Field', 'What to record', 'PII?'],
          rows: [
            ['who', 'Tenant ID, app ID, token sub', 'No (use internal IDs)'],
            ['what', 'Event type (e.g. message.received), action taken', 'No'],
            ['when', 'UTC timestamp and event correlation ID', 'No'],
            ['from where', 'Source IP (masked), user-agent', 'Partial (mask the IP)'],
            ['contact', 'Phone hash (SHA-256 + salt), never the number', 'No if hashed'],
            ['result', 'Status (ok, rejected, 401, 429) and reason', 'No'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Set explicit retention for logs and make sure they are immutable (append-only). Under LGPD and GDPR, a log is no excuse to retain personal data indefinitely.',
        },
      ],
    },
    {
      title: 'LGPD and GDPR: consent and minimization',
      blocks: [
        {
          type: 'paragraph',
          value:
            'WhatsApp involves personal data by definition. Two principles guide compliance in the integration context: a legal basis and consent to start conversations (especially marketing messages), and data minimization, meaning collect and store only what is strictly necessary for the stated purpose.',
        },
        {
          type: 'list',
          items: [
            'Consent: keep an opt-in record before sending proactive messages and honor opt-out immediately.',
            'Minimization: do not persist message bodies if the purpose does not require it; prefer to process and discard.',
            'Data subject rights: have a path for deletion and portability when requested.',
          ],
        },
      ],
    },
    {
      title: 'Final actionable checklist',
      blocks: [
        {
          type: 'ordered',
          items: [
            'Capture the raw body and validate x-hub-signature-256 with HMAC SHA-256 and timingSafeEqual before processing.',
            'Acknowledge 200 fast and process in a queue, with idempotency by event ID.',
            'Move the App Secret and tokens to a secrets manager, out of any versioned file.',
            'Use a System User token with minimal scope and separate credentials per environment.',
            'Define and test a credential rotation cycle with a no-downtime runbook.',
            'Apply rate limiting per IP at the edge and per tenant in the application (token bucket + Redis).',
            'Record an append-only audit trail with IDs and hashes, no PII in cleartext, with defined retention.',
            'Document legal basis, opt-in/opt-out and minimization policy for LGPD and GDPR.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can I use JSON.stringify of the body to compute the HMAC?',
      answer:
        'No. The signature is computed over the exact bytes Meta sent. Re-serializing the JSON changes spacing, order and escaping, producing a different hash. Capture the raw body with a parser verify hook and use that Buffer.',
    },
    {
      question: 'Why compare the signature with timingSafeEqual instead of ===?',
      answer:
        'Normal string comparisons return faster when the first characters differ, which leaks information through timing and lets an attacker reconstruct the signature attempt by attempt. timingSafeEqual compares in constant time, closing that side channel.',
    },
    {
      question: 'Where should I store the App Secret in production?',
      answer:
        'In a dedicated secrets manager (AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager) with IAM-based access and scheduled rotation. Never in a committed .env, in Docker image build variables or anywhere accessible by the frontend.',
    },
  ],
  conclusion: {
    title: 'Integration security is not optional',
    description:
      'Verified signatures, segregated credentials, rate limits and a clean audit trail form the base of a Meta and WhatsApp integration that survives production and an audit. Start with the final checklist and close each gap before going live.',
    cta: 'Need a security review of your WhatsApp integration? Get in touch.',
  },
  related: [
    { label: 'WhatsApp webhook: idempotency and queues', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Monitoring and alerts for integrations', to: '/blog/monitoramento-alertas-integracoes' },
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
  ],
  repo: {
    name: 'meta-webhook-security',
    description: 'Example of signature verification, rate limiting and auditing for Meta webhooks.',
    url: 'https://github.com/joaosouz4dev/meta-webhook-security',
  },
};

const es = {
  intro:
    'Integrar con Meta y la WhatsApp Cloud API significa exponer endpoints publicos, manejar tokens de larga duracion y procesar datos de personas reales. Cada uno de esos puntos es una superficie de ataque. Este checklist reune las practicas de AppSec que evitan que un webhook se convierta en puerta de entrada: verificacion de firma, segregacion y rotacion de credenciales, rate limiting y trazas de auditoria. El enfoque es practico, con codigo que puedes pegar y adaptar hoy.',
  sections: [
    {
      title: 'Por que la seguridad de webhooks de Meta exige atencion especial',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un webhook es un endpoint HTTP publico. Cualquier persona en internet puede enviarle un POST falsificado. Sin verificacion de firma, tu sistema procesaria mensajes falsos, eventos duplicados y payloads maliciosos como si fueran legitimos. Meta resuelve esto firmando cada solicitud con HMAC SHA-256 usando el App Secret, y te toca a ti validar esa firma antes de confiar en un solo byte del cuerpo.',
        },
        {
          type: 'paragraph',
          value:
            'Ademas de la firma, hay tres capas mas que separan una integracion amateur de una de produccion: credenciales segregadas y rotables, limites de tasa para contener el abuso y trazas de auditoria que permiten reconstruir lo que paso sin filtrar datos personales.',
        },
        {
          type: 'diagram',
          value: `Internet  -->  [Edge / WAF]  -->  [Verificacion HMAC]  -->  [Rate limit]  -->  [Handler]
                                |                    |                 |
                            bloquea             rechaza 401       rechaza 429
                            payload bruto       firma invalida    cuota excedida`,
        },
      ],
    },
    {
      title: 'Verificacion de firma del webhook (x-hub-signature-256)',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Meta envia el encabezado x-hub-signature-256 con el formato sha256=<hex>. El valor es el HMAC SHA-256 del cuerpo bruto de la solicitud usando el App Secret como clave. Dos reglas innegociables: usa el body crudo (raw), no el JSON ya parseado y re-serializado, porque cualquier diferencia de bytes cambia el hash; y compara con timingSafeEqual para evitar ataques de timing.',
        },
        {
          type: 'code',
          value: `const crypto = require('crypto');

// Captura el cuerpo crudo antes de cualquier parser JSON.
// En Express: express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } })

function verifyMetaSignature(req) {
  const header = req.get('x-hub-signature-256');
  if (!header || !header.startsWith('sha256=')) return false;

  const expected = header.slice('sha256='.length);
  const hmac = crypto.createHmac('sha256', process.env.META_APP_SECRET);
  hmac.update(req.rawBody); // Buffer crudo, no JSON.stringify(req.body)
  const computed = hmac.digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(expected, 'hex');

  // timingSafeEqual exige buffers del mismo tamano.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

app.post('/webhook', (req, res) => {
  if (!verifyMetaSignature(req)) {
    return res.sendStatus(401); // firma invalida
  }
  res.sendStatus(200); // confirma rapido, procesa en cola
  enqueue(req.body);
});`,
        },
        {
          type: 'paragraph',
          value:
            'Observa el patron: responde 200 de inmediato tras validar y envia el procesamiento a una cola. Meta reenvia los eventos no confirmados, asi que el procesamiento sincrono y lento genera duplicados y timeouts.',
        },
      ],
    },
    {
      title: 'Segregacion y rotacion de credenciales',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Tratar el App Secret y los tokens como secretos de verdad es lo que evita el peor escenario: una filtracion de credencial con permisos amplios y sin expiracion. Cada credencial debe tener alcance minimo, origen claro y un plan de rotacion.',
        },
        {
          type: 'list',
          items: [
            'App Secret: usado solo para verificar firmas. Nunca lo expongas en el frontend, logs o repositorio. Tratalo como una clave criptografica.',
            'System User token: prefiere tokens de System User (larga duracion y renovables) a tokens de usuario personal, que se rompen cuando la persona deja la empresa.',
            'Alcance minimo: concede solo los permisos que la integracion realmente usa (por ejemplo whatsapp_business_messaging), no pidas todo por comodidad.',
            'Boveda de secretos: almacenalos en un secrets manager (AWS Secrets Manager, Vault, GCP Secret Manager). Nunca en un .env versionado ni en variables de imagen Docker.',
            'Rotacion programada: define un ciclo (por ejemplo cada 90 dias) y ten un runbook para rotar el App Secret y revocar tokens antiguos sin downtime.',
            'Segregacion por entorno: las credenciales de produccion, staging y dev deben ser distintas. Una filtracion en dev nunca debe comprometer produccion.',
          ],
        },
      ],
    },
    {
      title: 'Rate limiting y proteccion contra abuso',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Incluso con una firma valida, necesitas limitar la tasa por origen para contener picos, bucles de reenvio e intentos de agotamiento de recursos. Aplica limites por IP en el borde y por tenant en la aplicacion, usando un algoritmo de token bucket que tolera rafagas cortas pero corta el abuso sostenido.',
        },
        {
          type: 'code',
          value: `// Token bucket simple por clave (IP o tenant).
class TokenBucket {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity;
    this.refill = refillPerSec;
    this.tokens = capacity;
    this.last = Date.now();
  }
  allow(cost = 1) {
    const now = Date.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.last) / 1000) * this.refill
    );
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

const buckets = new Map(); // en produccion: Redis con TTL
function rateLimit(key) {
  if (!buckets.has(key)) buckets.set(key, new TokenBucket(60, 1));
  return buckets.get(key).allow();
}`,
        },
        {
          type: 'paragraph',
          value:
            'A escala, cambia el Map en memoria por Redis para que el limite sea consistente entre instancias. Responde 429 con Retry-After cuando se exceda la cuota.',
        },
      ],
    },
    {
      title: 'Trazas de auditoria sin PII en claro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una buena traza de auditoria responde quien hizo que, cuando y desde donde, sin convertir el log en un deposito de datos personales. Registra identificadores y metadatos, nunca el contenido del mensaje ni los numeros de telefono en texto plano. Para correlacionar sin exponer, usa hash o seudonimizacion.',
        },
        {
          type: 'table',
          columns: ['Campo', 'Que registrar', 'PII?'],
          rows: [
            ['quien', 'ID del tenant, ID de la app, sub del token', 'No (usa IDs internos)'],
            ['que', 'Tipo de evento (ej: message.received), accion tomada', 'No'],
            ['cuando', 'Timestamp UTC e ID de correlacion del evento', 'No'],
            ['desde donde', 'IP de origen (enmascarada), user-agent', 'Parcial (enmascara la IP)'],
            ['contacto', 'Hash del telefono (SHA-256 + salt), nunca el numero', 'No si esta hasheado'],
            ['resultado', 'Estado (ok, rechazado, 401, 429) y motivo', 'No'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Define una retencion explicita para los logs y asegura que sean inmutables (append-only). Bajo LGPD y GDPR, un log no es excusa para retener datos personales indefinidamente.',
        },
      ],
    },
    {
      title: 'LGPD y GDPR: consentimiento y minimizacion',
      blocks: [
        {
          type: 'paragraph',
          value:
            'WhatsApp involucra datos personales por definicion. Dos principios guian el cumplimiento en el contexto de integraciones: una base legal y consentimiento para iniciar conversaciones (especialmente mensajes de marketing), y minimizacion de datos, es decir, recolectar y almacenar solo lo estrictamente necesario para la finalidad declarada.',
        },
        {
          type: 'list',
          items: [
            'Consentimiento: manten un registro de opt-in antes de enviar mensajes proactivos y respeta el opt-out de inmediato.',
            'Minimizacion: no persistas el cuerpo de los mensajes si la finalidad no lo exige; prefiere procesar y descartar.',
            'Derechos del titular: ten un camino para la eliminacion y portabilidad de los datos cuando se solicite.',
          ],
        },
      ],
    },
    {
      title: 'Checklist final accionable',
      blocks: [
        {
          type: 'ordered',
          items: [
            'Capturar el cuerpo crudo y validar x-hub-signature-256 con HMAC SHA-256 y timingSafeEqual antes de procesar.',
            'Responder 200 rapido y procesar en cola, con idempotencia por ID de evento.',
            'Mover el App Secret y los tokens a un secrets manager, fuera de cualquier archivo versionado.',
            'Usar un System User token con alcance minimo y separar credenciales por entorno.',
            'Definir y probar un ciclo de rotacion de credenciales con un runbook sin downtime.',
            'Aplicar rate limiting por IP en el borde y por tenant en la aplicacion (token bucket + Redis).',
            'Registrar trazas de auditoria append-only con IDs y hashes, sin PII en claro, con retencion definida.',
            'Documentar la base legal, opt-in/opt-out y la politica de minimizacion para LGPD y GDPR.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Puedo usar JSON.stringify del cuerpo para calcular el HMAC?',
      answer:
        'No. La firma se calcula sobre los bytes exactos que envio Meta. Re-serializar el JSON cambia espacios, orden y escaping, generando un hash diferente. Captura el body crudo con un verify del parser y usa ese Buffer.',
    },
    {
      question: 'Por que comparar la firma con timingSafeEqual en lugar de ===?',
      answer:
        'Las comparaciones de string normales retornan mas rapido cuando los primeros caracteres difieren, lo que filtra informacion por timing y permite reconstruir la firma intento a intento. timingSafeEqual compara en tiempo constante, cerrando ese canal lateral.',
    },
    {
      question: 'Donde debo guardar el App Secret en produccion?',
      answer:
        'En un secrets manager dedicado (AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager) con acceso por IAM y rotacion programada. Nunca en un .env commiteado, en variables de build de la imagen Docker ni en cualquier lugar accesible por el frontend.',
    },
  ],
  conclusion: {
    title: 'La seguridad de la integracion no es opcional',
    description:
      'Firma verificada, credenciales segregadas, limites de tasa y una auditoria limpia forman la base de una integracion Meta y WhatsApp que aguanta produccion y auditoria. Empieza por el checklist final y cierra cada brecha antes de salir a produccion.',
    cta: 'Necesitas una revision de seguridad de tu integracion WhatsApp? Hablemos.',
  },
  related: [
    { label: 'Webhook de WhatsApp: idempotencia y colas', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Monitoreo y alertas para integraciones', to: '/blog/monitoramento-alertas-integracoes' },
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
  ],
  repo: {
    name: 'meta-webhook-security',
    description: 'Ejemplo de verificacion de firma, rate limiting y auditoria para webhooks de Meta.',
    url: 'https://github.com/joaosouz4dev/meta-webhook-security',
  },
};

export default { pt, en, es };
