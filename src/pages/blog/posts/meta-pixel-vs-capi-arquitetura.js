// Conteudo do artigo: Meta Pixel vs CAPI, arquitetura ideal para dados confiaveis.
// Estrutura por idioma: { intro, sections, faq, conclusion, related, repo }.

const repoPt = {
  name: 'meta-capi-dedup-example',
  description:
    'Exemplo minimo de deduplicacao Pixel + Conversions API: o mesmo event_id no browser e no servidor, com payload hashado em SHA-256 e envio para a Graph API.',
  url: 'https://github.com/joaosouz4dev/meta-capi-dedup-example',
};

const repoEn = {
  name: 'meta-capi-dedup-example',
  description:
    'Minimal Pixel + Conversions API deduplication example: the same event_id on the browser and the server, with SHA-256 hashed payload and a send to the Graph API.',
  url: 'https://github.com/joaosouz4dev/meta-capi-dedup-example',
};

const repoEs = {
  name: 'meta-capi-dedup-example',
  description:
    'Ejemplo minimo de deduplicacion Pixel + Conversions API: el mismo event_id en el navegador y en el servidor, con payload hasheado en SHA-256 y envio a la Graph API.',
  url: 'https://github.com/joaosouz4dev/meta-capi-dedup-example',
};

const dedupCode = `// 1) Browser (Meta Pixel): gera um event_id unico e dispara o evento.
const eventId = crypto.randomUUID(); // ex.: '6f3c0b2a-9d4e-4a11-8c77-1e2b3f4a5d6e'

fbq('track', 'Purchase', {
  value: 199.90,
  currency: 'BRL',
  content_ids: ['SKU-123'],
  content_type: 'product',
}, {
  eventID: eventId, // <-- chave da deduplicacao no lado do browser
});

// 2) Server (Conversions API): MESMO event_id enviado para o servidor.
// O front passa o eventId no corpo da requisicao de checkout.
await fetch('/api/track/purchase', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ eventId, value: 199.90, currency: 'BRL', sku: 'SKU-123' }),
});`;

const capiServerCode = `// Server-side: envio do mesmo Purchase para a Conversions API.
// O event_id identico ao do Pixel permite que a Meta descarte a duplicata.
import crypto from 'node:crypto';

const sha256 = (value) =>
  crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');

async function sendPurchaseToCapi({ eventId, email, phone, value, currency, sku, clientIp, userAgent, fbp, fbc }) {
  const payload = {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,                 // <-- mesmo event_id do Pixel (deduplicacao)
        action_source: 'website',
        event_source_url: 'https://loja.exemplo.com/checkout',
        user_data: {
          em: [sha256(email)],             // email hashado em SHA-256
          ph: [sha256(phone)],             // telefone hashado em SHA-256 (formato E.164, so digitos)
          client_ip_address: clientIp,     // nao hashar IP
          client_user_agent: userAgent,    // nao hashar user agent
          fbp,                             // cookie _fbp (nao hashar)
          fbc,                             // cookie _fbc (nao hashar)
        },
        custom_data: { value, currency, content_ids: [sku], content_type: 'product' },
      },
    ],
    // test_event_code: 'TEST12345', // use no Events Manager durante o desenvolvimento
  };

  const url = \`https://graph.facebook.com/v19.0/\${process.env.PIXEL_ID}/events?access_token=\${process.env.CAPI_TOKEN}\`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json(); // { events_received, messages, fbtrace_id }
}`;

const hybridDiagram = `   Navegador                         Seu servidor                 Meta
 +-------------+                  +----------------+          +-------------+
 |  Meta Pixel | --event_id-->    |  Backend / API | --CAPI-->  |  Graph API  |
 | (fbq track) |                  | (mesmo eventID)|           | (dedup por  |
 +-------------+                  +----------------+           |  event_id)  |
       |   ad blocker / ITP / iOS pode bloquear o Pixel        +-------------+
       |   mas o servidor envia mesmo assim ----------------------^
       v
 [ evento pode se perder ]            [ evento confiavel, server-side ]`;

const dedupCodeEn = dedupCode
  .replace('// 1) Browser (Meta Pixel): gera um event_id unico e dispara o evento.', '// 1) Browser (Meta Pixel): generate a unique event_id and fire the event.')
  .replace('// <-- chave da deduplicacao no lado do browser', '// <-- deduplication key on the browser side')
  .replace('// 2) Server (Conversions API): MESMO event_id enviado para o servidor.', '// 2) Server (Conversions API): the SAME event_id sent to the server.')
  .replace('// O front passa o eventId no corpo da requisicao de checkout.', '// The front passes the eventId in the checkout request body.');

const capiServerCodeEn = capiServerCode
  .replace('// Server-side: envio do mesmo Purchase para a Conversions API.', '// Server-side: send the same Purchase to the Conversions API.')
  .replace('// O event_id identico ao do Pixel permite que a Meta descarte a duplicata.', '// The event_id identical to the Pixel lets Meta drop the duplicate.')
  .replace('// <-- mesmo event_id do Pixel (deduplicacao)', '// <-- same event_id as the Pixel (deduplication)')
  .replace('// email hashado em SHA-256', '// email hashed with SHA-256')
  .replace('// telefone hashado em SHA-256 (formato E.164, so digitos)', '// phone hashed with SHA-256 (E.164 format, digits only)')
  .replace('// nao hashar IP', '// do not hash the IP')
  .replace('// nao hashar user agent', '// do not hash the user agent')
  .replace('// cookie _fbp (nao hashar)', '// _fbp cookie (do not hash)')
  .replace('// cookie _fbc (nao hashar)', '// _fbc cookie (do not hash)')
  .replace('// <-- mesmo event_id do Pixel (deduplicacao)', '// <-- same event_id as the Pixel (deduplication)')
  .replace('// use no Events Manager durante o desenvolvimento', '// use it in the Events Manager during development');

const hybridDiagramEn = `   Browser                            Your server                  Meta
 +-------------+                  +----------------+          +-------------+
 |  Meta Pixel | --event_id-->    | Backend / API  | --CAPI-->  |  Graph API  |
 | (fbq track) |                  | (same eventID) |           | (dedup by   |
 +-------------+                  +----------------+           |  event_id)  |
       |   ad blocker / ITP / iOS may block the Pixel          +-------------+
       |   but the server sends it anyway ------------------------^
       v
 [ event may be lost ]               [ reliable, server-side event ]`;

const dedupCodeEs = dedupCode
  .replace('// 1) Browser (Meta Pixel): gera um event_id unico e dispara o evento.', '// 1) Navegador (Meta Pixel): genera un event_id unico y dispara el evento.')
  .replace('// <-- chave da deduplicacao no lado do browser', '// <-- clave de la deduplicacion en el lado del navegador')
  .replace('// 2) Server (Conversions API): MESMO event_id enviado para o servidor.', '// 2) Servidor (Conversions API): el MISMO event_id enviado al servidor.')
  .replace('// O front passa o eventId no corpo da requisicao de checkout.', '// El front pasa el eventId en el cuerpo de la peticion de checkout.');

const capiServerCodeEs = capiServerCode
  .replace('// Server-side: envio do mesmo Purchase para a Conversions API.', '// Lado servidor: envio del mismo Purchase a la Conversions API.')
  .replace('// O event_id identico ao do Pixel permite que a Meta descarte a duplicata.', '// El event_id identico al del Pixel permite que Meta descarte el duplicado.')
  .replace('// <-- mesmo event_id do Pixel (deduplicacao)', '// <-- mismo event_id del Pixel (deduplicacion)')
  .replace('// email hashado em SHA-256', '// email hasheado en SHA-256')
  .replace('// telefone hashado em SHA-256 (formato E.164, so digitos)', '// telefono hasheado en SHA-256 (formato E.164, solo digitos)')
  .replace('// nao hashar IP', '// no hashear la IP')
  .replace('// nao hashar user agent', '// no hashear el user agent')
  .replace('// cookie _fbp (nao hashar)', '// cookie _fbp (no hashear)')
  .replace('// cookie _fbc (nao hashar)', '// cookie _fbc (no hashear)')
  .replace('// use no Events Manager durante o desenvolvimento', '// usalo en el Events Manager durante el desarrollo');

const hybridDiagramEs = `   Navegador                          Tu servidor                  Meta
 +-------------+                  +----------------+          +-------------+
 |  Meta Pixel | --event_id-->    | Backend / API  | --CAPI-->  |  Graph API  |
 | (fbq track) |                  | (mismo eventID)|           | (dedup por  |
 +-------------+                  +----------------+           |  event_id)  |
       |   ad blocker / ITP / iOS puede bloquear el Pixel      +-------------+
       |   pero el servidor lo envia igual ----------------------^
       v
 [ el evento puede perderse ]        [ evento confiable, lado servidor ]`;

const pt = {
  intro:
    'Confiar so no Meta Pixel no browser significa perder uma fatia grande das conversoes para ad blockers, ITP do Safari e o opt-out do iOS. A arquitetura ideal combina Pixel e Conversions API (CAPI) com deduplicacao por event_id: o mesmo evento sai do navegador e do servidor, a Meta junta os dois e voce recupera cobertura sem contar a conversao duas vezes.',
  sections: [
    {
      title: 'Por que o Pixel sozinho perde eventos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O Pixel roda no navegador do usuario. Tudo que depende do navegador esta sujeito a ser bloqueado, cortado ou nao executado, e isso vem crescendo a cada ano. Quando o Pixel nao dispara, o evento simplesmente nao chega na Meta, a atribuicao quebra e o algoritmo de entrega passa a otimizar com dados incompletos.',
        },
        {
          type: 'list',
          items: [
            'Ad blockers e extensoes de privacidade: bloqueiam o script do Pixel antes mesmo dele carregar, derrubando uma parcela relevante do trafego.',
            'ITP (Intelligent Tracking Prevention) do Safari: limita cookies de origem a 7 dias (ou 24 horas em alguns casos), encurtando a janela de atribuicao client-side.',
            'iOS e App Tracking Transparency: com o opt-out, o sinal do browser fica reduzido e parte das conversoes nunca e atribuida pelo lado do cliente.',
            'Falhas de rede e abandono de pagina: se o usuario fecha a aba antes do beacon sair, o evento se perde sem reenvio.',
            'Single Page Apps: navegacao sem reload pode nao disparar o PageView ou o evento de conversao se a instrumentacao estiver incompleta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O ponto nao e abandonar o Pixel. Ele continua otimo para captar sinais ricos do browser (fbp, fbc, contexto da pagina). O problema e depender exclusivamente dele. A solucao e ter um segundo canal, server-side, que nao depende do navegador do usuario.',
        },
      ],
    },
    {
      title: 'Arquitetura hibrida: Pixel + CAPI',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Na arquitetura hibrida, cada conversao importante e enviada por dois caminhos: o Pixel no navegador e a Conversions API no seu servidor. Os dois carregam o mesmo event_id, e a Meta usa esse id para deduplicar. Se o Pixel for bloqueado, o servidor garante o evento. Se os dois chegarem, a Meta mantem um so.',
        },
        {
          type: 'diagram',
          value: hybridDiagram,
        },
        {
          type: 'paragraph',
          value:
            'O servidor envia direto para o endpoint da Graph API (graph.facebook.com), autenticado por um token de acesso. Como o envio sai da sua infraestrutura, ele nao e afetado por ad blocker nem por ITP. O Pixel continua enriquecendo o sinal com os cookies _fbp e _fbc, que voce repassa para o servidor para melhorar o casamento.',
        },
        {
          type: 'list',
          items: [
            'O Pixel cobre o sinal rico do browser e a experiencia client-side.',
            'A CAPI cobre confiabilidade e resiliencia a bloqueios.',
            'O event_id compartilhado evita contagem dupla.',
            'Cookies _fbp e _fbc viajam do browser para o servidor e elevam a qualidade do match.',
          ],
        },
      ],
    },
    {
      title: 'Deduplicacao por event_id',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Deduplicacao e o coracao do desenho. A regra e simples: gere um event_id unico no momento da conversao e use o MESMO valor no Pixel (campo eventID) e na CAPI (campo event_id). A Meta compara event_name + event_id e, se vir o par duas vezes dentro da janela de deduplicacao, mantem apenas um.',
        },
        {
          type: 'code',
          value: dedupCode,
        },
        {
          type: 'paragraph',
          value:
            'No servidor, o mesmo event_id viaja no payload da CAPI. O exemplo abaixo monta a requisicao Purchase, hasheia os dados pessoais em SHA-256 e faz o POST para graph.facebook.com:',
        },
        {
          type: 'code',
          value: capiServerCode,
        },
        {
          type: 'list',
          items: [
            'Gere o event_id uma vez (no servidor de preferencia) e propague para o browser, ou gere no browser e envie ao servidor: o que importa e ser identico nos dois lados.',
            'Use o mesmo event_name nos dois canais (Purchase com Purchase, Lead com Lead).',
            'Mantenha event_time coerente: a janela de deduplicacao trabalha em torno do horario do evento.',
            'Valide no Events Manager: a aba de eventos mostra a flag de deduplicacao e quantos eventos foram unidos.',
          ],
        },
      ],
    },
    {
      title: 'Pixel vs CAPI lado a lado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'As duas fontes nao competem, se complementam. A tabela resume onde cada uma brilha e por que rodar as duas em paralelo entrega o melhor resultado:',
        },
        {
          type: 'table',
          columns: ['Criterio', 'Meta Pixel (browser)', 'Conversions API (server)'],
          rows: [
            ['Cobertura', 'Cai com ad blocker, ITP e iOS opt-out', 'Independe do navegador, cobertura alta e estavel'],
            ['Confiabilidade', 'Sujeita a falha de rede e abandono de pagina', 'Reenvio controlado pelo seu backend, mais resiliente'],
            ['Latencia', 'Imediata no clique, porem pode nao sair', 'Controlada por voce (sincrona ou via fila)'],
            ['Dado hashado', 'Sinais do browser (fbp, fbc), pouco PII direto', 'Voce hasheia em SHA-256 (em, ph) antes de enviar'],
            ['Sinais exclusivos', 'Contexto do navegador, cookies de primeira parte', 'Dados do seu sistema (CRM, backend, status do pedido)'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Resumo pratico: o Pixel traz o contexto do navegador, a CAPI traz a confiabilidade. Rodando os dois com event_id compartilhado, voce soma cobertura sem dobrar a contagem.',
        },
      ],
    },
    {
      title: 'Event Match Quality e parametros de matching',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Recuperar o evento e metade do trabalho. A outra metade e a Meta conseguir casar esse evento com uma pessoa. O Event Match Quality (EMQ), visivel no Events Manager, mede a forca do casamento com base nos parametros de identificacao que voce envia. Quanto mais campos validos, melhor a atribuicao e a otimizacao de entrega.',
        },
        {
          type: 'ordered',
          items: [
            'Normalize antes de hashear: minusculas, sem espacos nas pontas, telefone em E.164 (so digitos com codigo do pais).',
            'Hasheie PII em SHA-256: email (em) e telefone (ph) nunca saem em texto puro.',
            'Nao hasheie campos tecnicos: client_ip_address, client_user_agent, _fbp e _fbc vao em texto.',
            'Envie o maximo de parametros validos: quanto mais sinais, maior o EMQ.',
            'Monitore o EMQ por evento no Events Manager e suba os campos fracos.',
          ],
        },
        {
          type: 'table',
          columns: ['Parametro', 'Hashado?', 'Como normalizar'],
          rows: [
            ['em (email)', 'Sim, SHA-256', 'minusculas, sem espacos: ana@exemplo.com'],
            ['ph (telefone)', 'Sim, SHA-256', 'E.164 so digitos: 5511999998888'],
            ['client_ip_address', 'Nao', 'IP da requisicao, em texto'],
            ['client_user_agent', 'Nao', 'User agent completo, em texto'],
            ['fbp / fbc', 'Nao', 'cookies _fbp e _fbc repassados do browser'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Cuidado comum: hashear um valor nao normalizado (com maiusculas ou espacos) produz um hash diferente do que a Meta espera e derruba o match. Normalize primeiro, hasheie depois, sempre na mesma ordem nos dois lados.',
        },
      ],
    },
    {
      title: 'Boas praticas e armadilhas',
      blocks: [
        {
          type: 'list',
          items: [
            'Use test_event_code no Events Manager durante o desenvolvimento para ver os eventos chegando em tempo real sem sujar a producao.',
            'Garanta event_id realmente unico por conversao (UUID), nunca reutilize o id do pedido se ele puder repetir entre tentativas.',
            'Nunca exponha o token da CAPI no front: ele vive so no servidor, em variavel de ambiente.',
            'Trate a CAPI como envio que pode falhar: coloque em fila com retry idempotente para nao perder nem duplicar.',
            'Confira a deduplicacao real no Events Manager antes de escalar verba: a flag de dedup confirma que o desenho esta funcionando.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Com Pixel e CAPI rodando juntos, event_id compartilhado e parametros bem hashados, voce recupera eventos perdidos, melhora o EMQ e da ao algoritmo da Meta um sinal muito mais limpo para otimizar campanhas.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Se eu envio o evento pelo Pixel e pela CAPI, nao conto a conversao duas vezes?',
      answer:
        'Nao, desde que os dois usem o mesmo event_id e o mesmo event_name. A Meta deduplica esse par dentro da janela de deduplicacao e mantem apenas um evento. Sem o event_id compartilhado, sim, voce contaria em dobro.',
    },
    {
      question: 'Preciso hashear todos os parametros antes de enviar para a CAPI?',
      answer:
        'So os dados pessoais (PII) como email (em) e telefone (ph), sempre em SHA-256 e normalizados antes. Campos tecnicos como client_ip_address, client_user_agent, _fbp e _fbc vao em texto puro e nao devem ser hashados.',
    },
    {
      question: 'A CAPI substitui o Pixel?',
      answer:
        'Nao, eles se complementam. O Pixel captura sinais ricos do navegador e os cookies _fbp e _fbc, enquanto a CAPI garante confiabilidade contra bloqueios. A arquitetura recomendada pela Meta e rodar os dois com deduplicacao.',
    },
  ],
  conclusion: {
    title: 'Quer dados de conversao confiaveis?',
    description:
      'Posso desenhar e implementar a arquitetura hibrida Pixel + CAPI no seu stack, com deduplicacao por event_id, hashing correto em SHA-256 e validacao de Event Match Quality no Events Manager. Vamos recuperar os eventos que voce esta perdendo hoje.',
    cta: 'Falar sobre meu projeto',
  },
  related: [
    { label: 'Meta Ads e integracoes', to: '/servicos/meta-ads-e-integracoes' },
    { label: 'Seguranca em integracoes Meta e WhatsApp', to: '/blog/seguranca-integracoes-meta-whatsapp' },
    { label: 'Monitoramento e alertas para integracoes', to: '/blog/monitoramento-alertas-integracoes' },
  ],
  repo: repoPt,
};

const en = {
  intro:
    'Relying only on the Meta Pixel in the browser means losing a large slice of conversions to ad blockers, Safari ITP and iOS opt-out. The ideal architecture combines the Pixel with the Conversions API (CAPI) using event_id deduplication: the same event leaves the browser and the server, Meta merges the two and you recover coverage without counting the conversion twice.',
  sections: [
    {
      title: 'Why the Pixel alone loses events',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The Pixel runs in the user browser. Anything that depends on the browser can be blocked, cut short or never executed, and that keeps growing every year. When the Pixel does not fire, the event simply never reaches Meta, attribution breaks and the delivery algorithm starts optimizing on incomplete data.',
        },
        {
          type: 'list',
          items: [
            'Ad blockers and privacy extensions: they block the Pixel script before it even loads, dropping a relevant share of traffic.',
            'Safari ITP (Intelligent Tracking Prevention): it limits first-party cookies to 7 days (or 24 hours in some cases), shortening the client-side attribution window.',
            'iOS and App Tracking Transparency: with opt-out, the browser signal shrinks and part of the conversions is never attributed on the client side.',
            'Network failures and page abandonment: if the user closes the tab before the beacon leaves, the event is lost with no resend.',
            'Single Page Apps: navigation without reload may not fire PageView or the conversion event if the instrumentation is incomplete.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The point is not to drop the Pixel. It is still great for capturing rich browser signals (fbp, fbc, page context). The problem is depending exclusively on it. The fix is a second, server-side channel that does not depend on the user browser.',
        },
      ],
    },
    {
      title: 'Hybrid architecture: Pixel + CAPI',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In the hybrid architecture, every important conversion is sent over two paths: the Pixel in the browser and the Conversions API on your server. Both carry the same event_id, and Meta uses that id to deduplicate. If the Pixel is blocked, the server guarantees the event. If both arrive, Meta keeps just one.',
        },
        {
          type: 'diagram',
          value: hybridDiagramEn,
        },
        {
          type: 'paragraph',
          value:
            'The server sends straight to the Graph API endpoint (graph.facebook.com), authenticated by an access token. Since the send comes from your infrastructure, it is not affected by ad blockers or ITP. The Pixel keeps enriching the signal with the _fbp and _fbc cookies, which you forward to the server to improve matching.',
        },
        {
          type: 'list',
          items: [
            'The Pixel covers the rich browser signal and the client-side experience.',
            'CAPI covers reliability and resilience against blocking.',
            'The shared event_id prevents double counting.',
            'The _fbp and _fbc cookies travel from browser to server and raise match quality.',
          ],
        },
      ],
    },
    {
      title: 'Deduplication by event_id',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Deduplication is the heart of the design. The rule is simple: generate a unique event_id at the moment of conversion and use the SAME value in the Pixel (eventID field) and in CAPI (event_id field). Meta compares event_name + event_id and, if it sees the pair twice within the deduplication window, keeps only one.',
        },
        {
          type: 'code',
          value: dedupCodeEn,
        },
        {
          type: 'paragraph',
          value:
            'On the server, the same event_id travels in the CAPI payload. The example below builds the Purchase request, hashes personal data with SHA-256 and POSTs to graph.facebook.com:',
        },
        {
          type: 'code',
          value: capiServerCodeEn,
        },
        {
          type: 'list',
          items: [
            'Generate the event_id once (ideally on the server) and propagate it to the browser, or generate it in the browser and send it to the server: what matters is being identical on both sides.',
            'Use the same event_name in both channels (Purchase with Purchase, Lead with Lead).',
            'Keep event_time consistent: the deduplication window works around the event time.',
            'Validate in the Events Manager: the events tab shows the deduplication flag and how many events were merged.',
          ],
        },
      ],
    },
    {
      title: 'Pixel vs CAPI side by side',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The two sources do not compete, they complement each other. The table sums up where each one shines and why running both in parallel delivers the best result:',
        },
        {
          type: 'table',
          columns: ['Criteria', 'Meta Pixel (browser)', 'Conversions API (server)'],
          rows: [
            ['Coverage', 'Drops with ad blocker, ITP and iOS opt-out', 'Independent of the browser, high and stable coverage'],
            ['Reliability', 'Subject to network failure and page abandonment', 'Resend controlled by your backend, more resilient'],
            ['Latency', 'Immediate on click, but may not leave', 'Controlled by you (synchronous or via queue)'],
            ['Hashed data', 'Browser signals (fbp, fbc), little direct PII', 'You hash with SHA-256 (em, ph) before sending'],
            ['Exclusive signals', 'Browser context, first-party cookies', 'Data from your system (CRM, backend, order status)'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Practical summary: the Pixel brings browser context, CAPI brings reliability. Running both with a shared event_id, you add coverage without doubling the count.',
        },
      ],
    },
    {
      title: 'Event Match Quality and matching parameters',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Recovering the event is half the work. The other half is Meta being able to match that event to a person. Event Match Quality (EMQ), visible in the Events Manager, measures the strength of the match based on the identification parameters you send. The more valid fields, the better the attribution and delivery optimization.',
        },
        {
          type: 'ordered',
          items: [
            'Normalize before hashing: lowercase, no trailing spaces, phone in E.164 (digits only with country code).',
            'Hash PII with SHA-256: email (em) and phone (ph) never leave in plain text.',
            'Do not hash technical fields: client_ip_address, client_user_agent, _fbp and _fbc go in plain text.',
            'Send as many valid parameters as possible: more signals mean higher EMQ.',
            'Monitor EMQ per event in the Events Manager and raise the weak fields.',
          ],
        },
        {
          type: 'table',
          columns: ['Parameter', 'Hashed?', 'How to normalize'],
          rows: [
            ['em (email)', 'Yes, SHA-256', 'lowercase, no spaces: ana@example.com'],
            ['ph (phone)', 'Yes, SHA-256', 'E.164 digits only: 15551234567'],
            ['client_ip_address', 'No', 'Request IP, plain text'],
            ['client_user_agent', 'No', 'Full user agent, plain text'],
            ['fbp / fbc', 'No', '_fbp and _fbc cookies forwarded from the browser'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Common pitfall: hashing a non-normalized value (with uppercase or spaces) produces a different hash from what Meta expects and breaks the match. Normalize first, hash later, always in the same order on both sides.',
        },
      ],
    },
    {
      title: 'Best practices and pitfalls',
      blocks: [
        {
          type: 'list',
          items: [
            'Use test_event_code in the Events Manager during development to see events arriving in real time without polluting production.',
            'Ensure a truly unique event_id per conversion (UUID), never reuse the order id if it can repeat across attempts.',
            'Never expose the CAPI token on the front end: it lives only on the server, in an environment variable.',
            'Treat CAPI as a send that can fail: queue it with idempotent retry so you neither lose nor duplicate.',
            'Verify real deduplication in the Events Manager before scaling budget: the dedup flag confirms the design works.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'With Pixel and CAPI running together, a shared event_id and well-hashed parameters, you recover lost events, improve EMQ and give the Meta algorithm a much cleaner signal to optimize campaigns.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'If I send the event via the Pixel and via CAPI, do I count the conversion twice?',
      answer:
        'No, as long as both use the same event_id and the same event_name. Meta deduplicates that pair within the deduplication window and keeps only one event. Without the shared event_id, yes, you would double count.',
    },
    {
      question: 'Do I need to hash every parameter before sending to CAPI?',
      answer:
        'Only personal data (PII) like email (em) and phone (ph), always with SHA-256 and normalized first. Technical fields like client_ip_address, client_user_agent, _fbp and _fbc go in plain text and must not be hashed.',
    },
    {
      question: 'Does CAPI replace the Pixel?',
      answer:
        'No, they complement each other. The Pixel captures rich browser signals and the _fbp and _fbc cookies, while CAPI guarantees reliability against blocking. The architecture Meta recommends is running both with deduplication.',
    },
  ],
  conclusion: {
    title: 'Want reliable conversion data?',
    description:
      'I can design and implement the hybrid Pixel + CAPI architecture on your stack, with event_id deduplication, correct SHA-256 hashing and Event Match Quality validation in the Events Manager. Let us recover the events you are losing today.',
    cta: 'Talk about my project',
  },
  related: [
    { label: 'Meta Ads and integrations', to: '/servicos/meta-ads-e-integracoes' },
    { label: 'Security in Meta and WhatsApp integrations', to: '/blog/seguranca-integracoes-meta-whatsapp' },
    { label: 'Monitoring and alerts for integrations', to: '/blog/monitoramento-alertas-integracoes' },
  ],
  repo: repoEn,
};

const es = {
  intro:
    'Confiar solo en el Meta Pixel del navegador significa perder una porcion grande de las conversiones por ad blockers, ITP de Safari y el opt-out de iOS. La arquitectura ideal combina el Pixel con la Conversions API (CAPI) usando deduplicacion por event_id: el mismo evento sale del navegador y del servidor, Meta junta los dos y recuperas cobertura sin contar la conversion dos veces.',
  sections: [
    {
      title: 'Por que el Pixel solo pierde eventos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El Pixel corre en el navegador del usuario. Todo lo que depende del navegador puede ser bloqueado, recortado o no ejecutado, y eso crece cada ano. Cuando el Pixel no se dispara, el evento simplemente no llega a Meta, la atribucion se rompe y el algoritmo de entrega empieza a optimizar con datos incompletos.',
        },
        {
          type: 'list',
          items: [
            'Ad blockers y extensiones de privacidad: bloquean el script del Pixel antes de que cargue, derribando una parte relevante del trafico.',
            'ITP (Intelligent Tracking Prevention) de Safari: limita las cookies de origen a 7 dias (o 24 horas en algunos casos), acortando la ventana de atribucion del lado cliente.',
            'iOS y App Tracking Transparency: con el opt-out, la senal del navegador se reduce y parte de las conversiones nunca se atribuye del lado cliente.',
            'Fallas de red y abandono de pagina: si el usuario cierra la pestana antes de que salga el beacon, el evento se pierde sin reenvio.',
            'Single Page Apps: la navegacion sin recarga puede no disparar el PageView o el evento de conversion si la instrumentacion esta incompleta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El punto no es abandonar el Pixel. Sigue siendo excelente para captar senales ricas del navegador (fbp, fbc, contexto de la pagina). El problema es depender exclusivamente de el. La solucion es un segundo canal, del lado servidor, que no depende del navegador del usuario.',
        },
      ],
    },
    {
      title: 'Arquitectura hibrida: Pixel + CAPI',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En la arquitectura hibrida, cada conversion importante se envia por dos caminos: el Pixel en el navegador y la Conversions API en tu servidor. Ambos llevan el mismo event_id, y Meta usa ese id para deduplicar. Si el Pixel es bloqueado, el servidor garantiza el evento. Si los dos llegan, Meta mantiene solo uno.',
        },
        {
          type: 'diagram',
          value: hybridDiagramEs,
        },
        {
          type: 'paragraph',
          value:
            'El servidor envia directo al endpoint de la Graph API (graph.facebook.com), autenticado por un token de acceso. Como el envio sale de tu infraestructura, no lo afecta el ad blocker ni el ITP. El Pixel sigue enriqueciendo la senal con las cookies _fbp y _fbc, que reenvias al servidor para mejorar el match.',
        },
        {
          type: 'list',
          items: [
            'El Pixel cubre la senal rica del navegador y la experiencia del lado cliente.',
            'La CAPI cubre confiabilidad y resiliencia ante los bloqueos.',
            'El event_id compartido evita el conteo doble.',
            'Las cookies _fbp y _fbc viajan del navegador al servidor y elevan la calidad del match.',
          ],
        },
      ],
    },
    {
      title: 'Deduplicacion por event_id',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La deduplicacion es el corazon del diseno. La regla es simple: genera un event_id unico en el momento de la conversion y usa el MISMO valor en el Pixel (campo eventID) y en la CAPI (campo event_id). Meta compara event_name + event_id y, si ve el par dos veces dentro de la ventana de deduplicacion, mantiene solo uno.',
        },
        {
          type: 'code',
          value: dedupCodeEs,
        },
        {
          type: 'paragraph',
          value:
            'En el servidor, el mismo event_id viaja en el payload de la CAPI. El ejemplo de abajo arma la peticion Purchase, hashea los datos personales en SHA-256 y hace el POST a graph.facebook.com:',
        },
        {
          type: 'code',
          value: capiServerCodeEs,
        },
        {
          type: 'list',
          items: [
            'Genera el event_id una vez (de preferencia en el servidor) y propagalo al navegador, o generalo en el navegador y envialo al servidor: lo que importa es que sea identico en ambos lados.',
            'Usa el mismo event_name en los dos canales (Purchase con Purchase, Lead con Lead).',
            'Manten event_time coherente: la ventana de deduplicacion trabaja alrededor del horario del evento.',
            'Valida en el Events Manager: la pestana de eventos muestra la marca de deduplicacion y cuantos eventos se unieron.',
          ],
        },
      ],
    },
    {
      title: 'Pixel vs CAPI lado a lado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Las dos fuentes no compiten, se complementan. La tabla resume donde brilla cada una y por que correr ambas en paralelo entrega el mejor resultado:',
        },
        {
          type: 'table',
          columns: ['Criterio', 'Meta Pixel (navegador)', 'Conversions API (servidor)'],
          rows: [
            ['Cobertura', 'Cae con ad blocker, ITP y opt-out de iOS', 'Independiente del navegador, cobertura alta y estable'],
            ['Confiabilidad', 'Sujeta a falla de red y abandono de pagina', 'Reenvio controlado por tu backend, mas resiliente'],
            ['Latencia', 'Inmediata en el clic, pero puede no salir', 'Controlada por ti (sincrona o via cola)'],
            ['Dato hasheado', 'Senales del navegador (fbp, fbc), poco PII directo', 'Tu hasheas en SHA-256 (em, ph) antes de enviar'],
            ['Senales exclusivas', 'Contexto del navegador, cookies de origen', 'Datos de tu sistema (CRM, backend, estado del pedido)'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Resumen practico: el Pixel trae el contexto del navegador, la CAPI trae la confiabilidad. Corriendo ambos con event_id compartido, sumas cobertura sin duplicar el conteo.',
        },
      ],
    },
    {
      title: 'Event Match Quality y parametros de matching',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Recuperar el evento es la mitad del trabajo. La otra mitad es que Meta logre casar ese evento con una persona. El Event Match Quality (EMQ), visible en el Events Manager, mide la fuerza del match con base en los parametros de identificacion que envias. Cuantos mas campos validos, mejor la atribucion y la optimizacion de entrega.',
        },
        {
          type: 'ordered',
          items: [
            'Normaliza antes de hashear: minusculas, sin espacios en las puntas, telefono en E.164 (solo digitos con codigo de pais).',
            'Hashea el PII en SHA-256: email (em) y telefono (ph) nunca salen en texto plano.',
            'No hashees campos tecnicos: client_ip_address, client_user_agent, _fbp y _fbc van en texto plano.',
            'Envia la mayor cantidad de parametros validos: mas senales significan mayor EMQ.',
            'Monitorea el EMQ por evento en el Events Manager y sube los campos debiles.',
          ],
        },
        {
          type: 'table',
          columns: ['Parametro', 'Hasheado?', 'Como normalizar'],
          rows: [
            ['em (email)', 'Si, SHA-256', 'minusculas, sin espacios: ana@ejemplo.com'],
            ['ph (telefono)', 'Si, SHA-256', 'E.164 solo digitos: 5215512345678'],
            ['client_ip_address', 'No', 'IP de la peticion, en texto'],
            ['client_user_agent', 'No', 'User agent completo, en texto'],
            ['fbp / fbc', 'No', 'cookies _fbp y _fbc reenviadas del navegador'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Error comun: hashear un valor no normalizado (con mayusculas o espacios) produce un hash distinto al que Meta espera y rompe el match. Normaliza primero, hashea despues, siempre en el mismo orden en ambos lados.',
        },
      ],
    },
    {
      title: 'Buenas practicas y trampas',
      blocks: [
        {
          type: 'list',
          items: [
            'Usa test_event_code en el Events Manager durante el desarrollo para ver los eventos llegando en tiempo real sin ensuciar la produccion.',
            'Garantiza un event_id realmente unico por conversion (UUID), nunca reutilices el id del pedido si puede repetirse entre intentos.',
            'Nunca expongas el token de la CAPI en el front: vive solo en el servidor, en una variable de entorno.',
            'Trata la CAPI como un envio que puede fallar: ponlo en una cola con retry idempotente para no perder ni duplicar.',
            'Verifica la deduplicacion real en el Events Manager antes de escalar presupuesto: la marca de dedup confirma que el diseno funciona.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Con Pixel y CAPI corriendo juntos, event_id compartido y parametros bien hasheados, recuperas eventos perdidos, mejoras el EMQ y le das al algoritmo de Meta una senal mucho mas limpia para optimizar campanas.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Si envio el evento por el Pixel y por la CAPI, no cuento la conversion dos veces?',
      answer:
        'No, siempre que ambos usen el mismo event_id y el mismo event_name. Meta deduplica ese par dentro de la ventana de deduplicacion y mantiene solo un evento. Sin el event_id compartido, si, contarias el doble.',
    },
    {
      question: 'Necesito hashear todos los parametros antes de enviar a la CAPI?',
      answer:
        'Solo los datos personales (PII) como email (em) y telefono (ph), siempre en SHA-256 y normalizados antes. Los campos tecnicos como client_ip_address, client_user_agent, _fbp y _fbc van en texto plano y no deben hashearse.',
    },
    {
      question: 'La CAPI reemplaza al Pixel?',
      answer:
        'No, se complementan. El Pixel captura senales ricas del navegador y las cookies _fbp y _fbc, mientras la CAPI garantiza confiabilidad ante los bloqueos. La arquitectura que recomienda Meta es correr ambos con deduplicacion.',
    },
  ],
  conclusion: {
    title: 'Quieres datos de conversion confiables?',
    description:
      'Puedo disenar e implementar la arquitectura hibrida Pixel + CAPI en tu stack, con deduplicacion por event_id, hashing correcto en SHA-256 y validacion de Event Match Quality en el Events Manager. Vamos a recuperar los eventos que estas perdiendo hoy.',
    cta: 'Hablar de mi proyecto',
  },
  related: [
    { label: 'Meta Ads e integraciones', to: '/servicos/meta-ads-e-integracoes' },
    { label: 'Seguridad en integraciones Meta y WhatsApp', to: '/blog/seguranca-integracoes-meta-whatsapp' },
    { label: 'Monitoreo y alertas para integraciones', to: '/blog/monitoramento-alertas-integracoes' },
  ],
  repo: repoEs,
};

export default { pt, en, es };
