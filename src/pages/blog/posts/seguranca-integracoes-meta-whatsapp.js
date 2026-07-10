const pt = {
  intro:
    'Integrar com a Meta e o WhatsApp Cloud API significa expor endpoints públicos, manipular tokens de longa duração e processar dados de pessoas reais. Cada um desses pontos é uma superfície de ataque. Este checklist reúne as práticas de AppSec que evitam que um webhook vire porta de entrada: verificação de assinatura, segregação e rotação de credenciais, rate limiting e trilha de auditoria. O foco é prático, com código que você pode colar e adaptar hoje.',
  sections: [
    {
      title: 'Por que a segurança de webhooks da Meta exige atenção especial',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um webhook é um endpoint HTTP público. Qualquer pessoa na internet pode enviá-lo um POST forjado. Sem verificação de assinatura, seu sistema processaria mensagens falsas, eventos duplicados e payloads maliciosos como se fossem legítimos. A Meta resolve isso assinando cada requisição com HMAC SHA-256 usando o App Secret, e cabe a você validar essa assinatura antes de confiar em qualquer byte do corpo.',
        },
        {
          type: 'paragraph',
          value:
            'Além da assinatura, há três outras camadas que separam uma integração amadora de uma integração de produção: credenciais segregadas e rotacionáveis, limites de taxa para conter abuso e uma trilha de auditoria que permite reconstruir o que aconteceu sem vazar dados pessoais.',
        },
        {
          type: 'diagram',
          value: `Internet  -->  [Edge / WAF]  -->  [Verificação HMAC]  -->  [Rate limit]  -->  [Handler]
                                |                    |                 |
                            bloqueia            rejeita 401       rejeita 429
                            payload bruto       assinatura        excedeu cota
                                                inválida`,
        },
      ],
    },
    {
      title: 'Verificação de assinatura do webhook (x-hub-signature-256)',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A Meta envia o cabeçalho x-hub-signature-256 no formato sha256=<hex>. O valor é o HMAC SHA-256 do corpo bruto da requisição usando o App Secret como chave. Duas regras inegociáveis: use o body cru (raw), não o JSON já parseado e re-serializado, porque qualquer diferença de bytes muda o hash; e compare com timingSafeEqual para evitar ataques de timing.',
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
            'Note o padrão: responda 200 imediatamente após validar e empurre o processamento para uma fila. A Meta reentrega eventos não confirmados, então processamento síncrono e lento gera duplicatas e timeouts.',
        },
      ],
    },
    {
      title: 'Segregação e rotação de credenciais',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Tratar App Secret e tokens como segredos de verdade é o que evita o pior cenário: um vazamento de credencial com permissões amplas e sem expiração. Cada credencial deve ter escopo mínimo, origem clara e um plano de rotação.',
        },
        {
          type: 'list',
          items: [
            'App Secret: usado apenas para verificar assinaturas. Nunca o exponha em frontend, logs ou repositório. Trate-o como chave criptográfica.',
            'System User token: prefira tokens de System User (longa duração e renováveis) a tokens de usuário pessoal, que quebram quando a pessoa sai da empresa.',
            'Escopo mínimo: conceda apenas as permissões que a integração realmente usa (por exemplo whatsapp_business_messaging), nada de pedir tudo por conveniência.',
            'Cofre de segredos: armazene em um secrets manager (AWS Secrets Manager, Vault, GCP Secret Manager). Nunca em .env versionado ou em variáveis de imagem Docker.',
            'Rotação programada: defina um ciclo (por exemplo a cada 90 dias) e tenha um runbook para girar o App Secret e revogar tokens antigos sem downtime.',
            'Segregação por ambiente: credenciais de produção, staging e dev devem ser distintas. Um vazamento em dev nunca pode comprometer produção.',
          ],
        },
      ],
    },
    {
      title: 'Rate limiting e proteção contra abuso',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo com assinatura válida, você precisa limitar a taxa por origem para conter picos, loops de reentrega e tentativas de exaustão de recursos. Aplique limites por IP na borda e por tenant na aplicação, usando um algoritmo de token bucket que tolera rajadas curtas mas corta abuso sustentado.',
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
            'Em escala, troque o Map em memória por Redis para que o limite seja consistente entre instâncias. Responda 429 com Retry-After quando a cota estourar.',
        },
      ],
    },
    {
      title: 'Trilha de auditoria sem PII em claro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma boa trilha de auditoria responde quem fez o que, quando e a partir de onde, sem transformar o log em um depósito de dados pessoais. Registre identificadores e metadados, nunca o conteúdo da mensagem ou números de telefone em texto puro. Para correlacionar sem expor, use hash ou pseudonimização.',
        },
        {
          type: 'table',
          columns: ['Campo', 'O que registrar', 'PII?'],
          rows: [
            ['quem', 'ID do tenant, ID do app, sub do token', 'Não (use IDs internos)'],
            ['o que', 'Tipo do evento (ex: message.received), ação tomada', 'Não'],
            ['quando', 'Timestamp UTC e ID de correlação do evento', 'Não'],
            ['de onde', 'IP de origem (mascarado), user-agent', 'Parcial (mascare IP)'],
            ['contato', 'Hash do telefone (SHA-256 + salt), nunca o número', 'Não se hasheado'],
            ['resultado', 'Status (ok, rejeitado, 401, 429) e motivo', 'Não'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Defina retenção explícita para os logs e garanta que eles sejam imutáveis (append-only). Sob LGPD e GDPR, log não é desculpa para reter dados pessoais indefinidamente.',
        },
      ],
    },
    {
      title: 'LGPD e GDPR: consentimento e minimização',
      blocks: [
        {
          type: 'paragraph',
          value:
            'WhatsApp envolve dados pessoais por definição. Dois princípios guiam a conformidade no contexto de integrações: base legal e consentimento para iniciar conversas (especialmente mensagens de marketing), e minimização de dados, ou seja, colete e armazene apenas o estritamente necessário para a finalidade declarada.',
        },
        {
          type: 'list',
          items: [
            'Consentimento: tenha registro de opt-in antes de enviar mensagens proativas e respeite o opt-out imediatamente.',
            'Minimização: não persista o corpo das mensagens se a finalidade não exige; prefira processar e descartar.',
            'Direitos do titular: tenha um caminho para exclusão e portabilidade dos dados quando solicitado.',
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
            'Responder 200 rápido e processar em fila, com idempotência por ID de evento.',
            'Mover App Secret e tokens para um secrets manager, fora de qualquer arquivo versionado.',
            'Usar System User token com escopo mínimo e separar credenciais por ambiente.',
            'Definir e testar um ciclo de rotação de credenciais com runbook sem downtime.',
            'Aplicar rate limiting por IP na borda e por tenant na aplicação (token bucket + Redis).',
            'Registrar trilha de auditoria append-only com IDs e hashes, sem PII em claro, com retenção definida.',
            'Documentar base legal, opt-in/opt-out e política de minimização para LGPD e GDPR.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Posso usar JSON.stringify do corpo para calcular o HMAC?',
      answer:
        'Não. A assinatura é calculada sobre os bytes exatos enviados pela Meta. Re-serializar o JSON muda espaços, ordem e escaping, gerando um hash diferente. Capture o raw body com um verify do parser e use esse Buffer.',
    },
    {
      question: 'Por que comparar a assinatura com timingSafeEqual em vez de ===?',
      answer:
        'Comparações de string normais retornam mais rápido quando os primeiros caracteres divergem, o que vaza informação por timing e permite reconstruir a assinatura tentativa a tentativa. timingSafeEqual compara em tempo constante, fechando esse canal lateral.',
    },
    {
      question: 'Onde devo guardar o App Secret em produção?',
      answer:
        'Em um secrets manager dedicado (AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager) com acesso por IAM e rotação programada. Nunca em .env commitado, em variáveis de build da imagem Docker ou em qualquer lugar acessível pelo frontend.',
    },
  ],
  conclusion: {
    title: 'Segurança de integração não é opcional',
    description:
      'Assinatura verificada, credenciais segregadas, limites de taxa e auditoria limpa formam a base de uma integração Meta e WhatsApp que aguenta produção e auditoria. Comece pelo checklist final e feche cada lacuna antes de ir ao ar.',
    cta: 'Precisa de uma revisão de segurança da sua integração WhatsApp? Fale comigo.',
  },
  related: [
    { label: 'Webhook do WhatsApp: idempotência e filas', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Monitoramento e alertas para integrações', to: '/blog/monitoramento-alertas-integracoes' },
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
  ],
  repo: {
    name: 'meta-webhook-security',
    description: 'Exemplo de verificação de assinatura, rate limiting e auditoria para webhooks da Meta.',
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
    'Integrar con Meta y la WhatsApp Cloud API significa exponer endpoints públicos, manejar tokens de larga duración y procesar datos de personas reales. Cada uno de esos puntos es una superficie de ataque. Este checklist reúne las prácticas de AppSec que evitan que un webhook se convierta en puerta de entrada: verificación de firma, segregación y rotación de credenciales, rate limiting y trazas de auditoría. El enfoque es práctico, con código que puedes pegar y adaptar hoy.',
  sections: [
    {
      title: '¿Por qué la seguridad de webhooks de Meta exige atención especial?',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un webhook es un endpoint HTTP público. Cualquier persona en internet puede enviarle un POST falsificado. Sin verificación de firma, tu sistema procesaría mensajes falsos, eventos duplicados y payloads maliciosos como si fueran legítimos. Meta resuelve esto firmando cada solicitud con HMAC SHA-256 usando el App Secret, y te toca a ti validar esa firma antes de confiar en un solo byte del cuerpo.',
        },
        {
          type: 'paragraph',
          value:
            'Además de la firma, hay tres capas más que separan una integración amateur de una de producción: credenciales segregadas y rotables, límites de tasa para contener el abuso y trazas de auditoría que permiten reconstruir lo que pasó sin filtrar datos personales.',
        },
        {
          type: 'diagram',
          value: `Internet  -->  [Edge / WAF]  -->  [Verificación HMAC]  -->  [Rate limit]  -->  [Handler]
                                |                    |                 |
                            bloquea             rechaza 401       rechaza 429
                            payload bruto       firma inválida    cuota excedida`,
        },
      ],
    },
    {
      title: 'Verificación de firma del webhook (x-hub-signature-256)',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Meta envía el encabezado x-hub-signature-256 con el formato sha256=<hex>. El valor es el HMAC SHA-256 del cuerpo bruto de la solicitud usando el App Secret como clave. Dos reglas innegociables: usa el body crudo (raw), no el JSON ya parseado y re-serializado, porque cualquier diferencia de bytes cambia el hash; y compara con timingSafeEqual para evitar ataques de timing.',
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
            'Observa el patrón: responde 200 de inmediato tras validar y envía el procesamiento a una cola. Meta reenvía los eventos no confirmados, así que el procesamiento síncrono y lento genera duplicados y timeouts.',
        },
      ],
    },
    {
      title: 'Segregación y rotación de credenciales',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Tratar el App Secret y los tokens como secretos de verdad es lo que evita el peor escenario: una filtración de credencial con permisos amplios y sin expiración. Cada credencial debe tener alcance mínimo, origen claro y un plan de rotación.',
        },
        {
          type: 'list',
          items: [
            'App Secret: usado solo para verificar firmas. Nunca lo expongas en el frontend, logs o repositorio. Trátalo como una clave criptográfica.',
            'System User token: prefiere tokens de System User (larga duración y renovables) a tokens de usuario personal, que se rompen cuando la persona deja la empresa.',
            'Alcance mínimo: concede solo los permisos que la integración realmente usa (por ejemplo whatsapp_business_messaging), no pidas todo por comodidad.',
            'Bóveda de secretos: almacénalos en un secrets manager (AWS Secrets Manager, Vault, GCP Secret Manager). Nunca en un .env versionado ni en variables de imagen Docker.',
            'Rotación programada: define un ciclo (por ejemplo cada 90 días) y ten un runbook para rotar el App Secret y revocar tokens antiguos sin downtime.',
            'Segregación por entorno: las credenciales de producción, staging y dev deben ser distintas. Una filtración en dev nunca debe comprometer producción.',
          ],
        },
      ],
    },
    {
      title: 'Rate limiting y protección contra abuso',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Incluso con una firma válida, necesitas limitar la tasa por origen para contener picos, bucles de reenvío e intentos de agotamiento de recursos. Aplica límites por IP en el borde y por tenant en la aplicación, usando un algoritmo de token bucket que tolera ráfagas cortas pero corta el abuso sostenido.',
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
            'A escala, cambia el Map en memoria por Redis para que el límite sea consistente entre instancias. Responde 429 con Retry-After cuando se exceda la cuota.',
        },
      ],
    },
    {
      title: 'Trazas de auditoría sin PII en claro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una buena traza de auditoría responde quién hizo qué, cuándo y desde dónde, sin convertir el log en un depósito de datos personales. Registra identificadores y metadatos, nunca el contenido del mensaje ni los números de teléfono en texto plano. Para correlacionar sin exponer, usa hash o seudonimización.',
        },
        {
          type: 'table',
          columns: ['Campo', 'Qué registrar', 'PII?'],
          rows: [
            ['quién', 'ID del tenant, ID de la app, sub del token', 'No (usa IDs internos)'],
            ['qué', 'Tipo de evento (ej: message.received), acción tomada', 'No'],
            ['cuándo', 'Timestamp UTC e ID de correlación del evento', 'No'],
            ['desde dónde', 'IP de origen (enmascarada), user-agent', 'Parcial (enmascara la IP)'],
            ['contacto', 'Hash del teléfono (SHA-256 + salt), nunca el número', 'No si está hasheado'],
            ['resultado', 'Estado (ok, rechazado, 401, 429) y motivo', 'No'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Define una retención explícita para los logs y asegura que sean inmutables (append-only). Bajo LGPD y GDPR, un log no es excusa para retener datos personales indefinidamente.',
        },
      ],
    },
    {
      title: 'LGPD y GDPR: consentimiento y minimización',
      blocks: [
        {
          type: 'paragraph',
          value:
            'WhatsApp involucra datos personales por definición. Dos principios guían el cumplimiento en el contexto de integraciones: una base legal y consentimiento para iniciar conversaciones (especialmente mensajes de marketing), y minimización de datos, es decir, recolectar y almacenar solo lo estrictamente necesario para la finalidad declarada.',
        },
        {
          type: 'list',
          items: [
            'Consentimiento: mantén un registro de opt-in antes de enviar mensajes proactivos y respeta el opt-out de inmediato.',
            'Minimización: no persistas el cuerpo de los mensajes si la finalidad no lo exige; prefiere procesar y descartar.',
            'Derechos del titular: ten un camino para la eliminación y portabilidad de los datos cuando se solicite.',
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
            'Responder 200 rápido y procesar en cola, con idempotencia por ID de evento.',
            'Mover el App Secret y los tokens a un secrets manager, fuera de cualquier archivo versionado.',
            'Usar un System User token con alcance mínimo y separar credenciales por entorno.',
            'Definir y probar un ciclo de rotación de credenciales con un runbook sin downtime.',
            'Aplicar rate limiting por IP en el borde y por tenant en la aplicación (token bucket + Redis).',
            'Registrar trazas de auditoría append-only con IDs y hashes, sin PII en claro, con retención definida.',
            'Documentar la base legal, opt-in/opt-out y la política de minimización para LGPD y GDPR.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Puedo usar JSON.stringify del cuerpo para calcular el HMAC?',
      answer:
        'No. La firma se calcula sobre los bytes exactos que envió Meta. Re-serializar el JSON cambia espacios, orden y escaping, generando un hash diferente. Captura el body crudo con un verify del parser y usa ese Buffer.',
    },
    {
      question: '¿Por qué comparar la firma con timingSafeEqual en lugar de ===?',
      answer:
        'Las comparaciones de string normales retornan más rápido cuando los primeros caracteres difieren, lo que filtra información por timing y permite reconstruir la firma intento a intento. timingSafeEqual compara en tiempo constante, cerrando ese canal lateral.',
    },
    {
      question: '¿Dónde debo guardar el App Secret en producción?',
      answer:
        'En un secrets manager dedicado (AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager) con acceso por IAM y rotación programada. Nunca en un .env commiteado, en variables de build de la imagen Docker ni en cualquier lugar accesible por el frontend.',
    },
  ],
  conclusion: {
    title: 'La seguridad de la integración no es opcional',
    description:
      'Firma verificada, credenciales segregadas, límites de tasa y una auditoría limpia forman la base de una integración Meta y WhatsApp que aguanta producción y auditoría. Empieza por el checklist final y cierra cada brecha antes de salir a producción.',
    cta: '¿Necesitas una revisión de seguridad de tu integración WhatsApp? Hablemos.',
  },
  related: [
    { label: 'Webhook de WhatsApp: idempotencia y colas', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Monitoreo y alertas para integraciones', to: '/blog/monitoramento-alertas-integracoes' },
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
  ],
  repo: {
    name: 'meta-webhook-security',
    description: 'Ejemplo de verificación de firma, rate limiting y auditoría para webhooks de Meta.',
    url: 'https://github.com/joaosouz4dev/meta-webhook-security',
  },
};

export default { pt, en, es };
