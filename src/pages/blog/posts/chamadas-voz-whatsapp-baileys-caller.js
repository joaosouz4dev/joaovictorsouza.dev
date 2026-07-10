const pt = {
  intro:
    'A Cloud API oficial do WhatsApp é excelente para mensagens, templates e webhooks, mas tem um limite claro: ela não permite originar chamadas de voz arbitrárias a partir do seu sistema. Quando o caso de uso exige isso (um callback de atendimento, uma confirmação por voz, um alerta urgente), o caminho passa por bibliotecas não oficiais baseadas em Baileys, como o baileys-caller. Este artigo mostra como iniciar chamadas de voz programaticamente, como o Baileys funciona por baixo dos panos e, principalmente, quando esse trade-off (solução não oficial versus Cloud API oficial) realmente vale a pena.',
  sections: [
    {
      title: 'O gap: a Cloud API oficial não origina chamadas de voz',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A Cloud API oficial cobre o envio e o recebimento de mensagens, templates aprovados, mídias e webhooks de status. Ela não expõe um endpoint para o seu backend discar uma chamada de voz para um número. Para alguns casos de uso (confirmar uma entrega por voz, fazer um callback automático de atendimento, disparar um alerta que precisa tocar como uma ligação), essa lacuna é um bloqueio real, e é aí que entram bibliotecas baseadas no protocolo do WhatsApp Web.',
        },
        {
          type: 'paragraph',
          value:
            'Baileys é uma biblioteca Node.js que fala o protocolo do WhatsApp Web via WebSocket. Ela não é a Cloud API oficial: roda em cima de uma sessão pareada (como se fosse o seu WhatsApp Web), o que abre portas que a API oficial fecha, mas também traz riscos que a API oficial não tem. O baileys-caller (https://github.com/SheIITear/baileys-caller) é um projeto focado em iniciar e gerenciar chamadas de voz e vídeo em cima dessa sessão Baileys.',
        },
        {
          type: 'table',
          columns: ['Critério', 'Cloud API oficial', 'Baileys / baileys-caller'],
          rows: [
            ['Oficial', 'Sim, suportada pela Meta', 'Não, biblioteca da comunidade'],
            ['Chamadas de voz', 'Não origina chamadas', 'Inicia chamadas de voz e vídeo'],
            ['Estabilidade', 'Alta, contrato versionado', 'Frágil, quebra quando o protocolo muda'],
            ['Risco de ban', 'Baixo, dentro do ToS', 'Alto, fora do ToS oficial'],
            ['Custo', 'Por conversa, previsível', 'Infra própria, sem taxa por chamada'],
            ['Suporte', 'Documentação e suporte Meta', 'Comunidade, sem garantia'],
          ],
        },
      ],
    },
    {
      title: 'Como o Baileys funciona em alto nível',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O Baileys não usa HTTP REST como a Cloud API. Ele abre um WebSocket contra a infraestrutura do WhatsApp Web e mantém uma sessão autenticada, exatamente como o aplicativo WhatsApp Web faz no navegador. O pareamento acontece via QR code ou via pairing code (um código numérico digitado no celular). A partir daí, mensagens e eventos chegam por um fluxo de eventos assíncrono.',
        },
        {
          type: 'diagram',
          value: `Seu backend (Node.js)
        |
   [Baileys socket]  <== WebSocket ==>  WhatsApp Web infra
        |                                       |
   credenciais da sessão                   celular pareado
   (auth state salvo)                       (QR / pairing code)
        |
   eventos: connection.update, messages.upsert, call`,
        },
        {
          type: 'paragraph',
          value:
            'A sessão precisa ser persistida (o chamado auth state) para não exigir um novo pareamento a cada reinício. Os eventos mais relevantes são connection.update (estado da conexão), messages.upsert (mensagens) e os eventos de chamada, que são justamente o que o baileys-caller estende para permitir originar a ligação, e não apenas observá-la.',
        },
      ],
    },
    {
      title: 'Setup ilustrativo: conectar, parear e iniciar uma chamada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O código abaixo é ilustrativo. Ele mostra o padrão geral de conexão com Baileys, autenticação via pairing code e a ideia de iniciar uma chamada com o baileys-caller. Os nomes exatos de funções podem diferir da versão real do projeto, consulte sempre o repositório (https://github.com/SheIITear/baileys-caller) antes de usar em qualquer ambiente.',
        },
        {
          type: 'code',
          value: `// ILUSTRATIVO: a API real pode diferir. Verifique o repo.
// https://github.com/SheIITear/baileys-caller
const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
// Import ilustrativo do helper de chamadas:
const { makeCaller } = require('baileys-caller');

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  // Pareamento via pairing code (sem QR), informe o numero do bot:
  if (!sock.authState.creds.registered) {
    const code = await sock.requestPairingCode('5511999999999');
    console.log('Digite este codigo no WhatsApp do celular:', code);
  }

  // Camada de chamadas (ilustrativa):
  const caller = makeCaller(sock);

  return { sock, caller };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Com a sessão ativa, você inicia a chamada e trata os eventos de ciclo de vida. De novo, os nomes são ilustrativos: o importante é o padrão de tratar ringing, accepted, rejected e timeout.',
        },
        {
          type: 'code',
          value: `// ILUSTRATIVO: nomes de metodos/eventos podem variar.
async function ligar(caller, destino) {
  // destino no formato JID do WhatsApp, ex: '5511988888888@s.whatsapp.net'
  const call = await caller.offerCall(destino, { video: false });

  call.on('ringing', () => console.log('Tocando no destino...'));
  call.on('accepted', () => console.log('Chamada aceita.'));
  call.on('rejected', () => console.log('Chamada rejeitada.'));
  call.on('timeout', () => console.log('Sem resposta (timeout).'));

  // Encerrar apos um limite, evitando chamada pendurada:
  setTimeout(() => call.hangup().catch(() => {}), 45000);
}`,
        },
      ],
    },
    {
      title: 'Riscos e mitigação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Usar uma biblioteca não oficial não é gratuito em termos de risco. O ponto mais importante: o WhatsApp pode banir o número usado, sem aviso e sem recurso prático. Trate isso como uma certeza eventual, não como uma possibilidade remota, e desenhe o sistema para sobreviver a ela.',
        },
        {
          type: 'list',
          items: [
            'ToS do WhatsApp: originar chamadas via Baileys está fora dos termos de uso oficiais. Avalie o risco jurídico e de marca antes de seguir.',
            'Risco de ban do número: use um número dedicado e descartável, nunca o número principal do negócio ou um número pessoal.',
            'Instabilidade do protocolo: quando o WhatsApp muda o protocolo do Web, a biblioteca pode parar de funcionar até ser atualizada. Tenha um plano para indisponibilidade.',
            'Rate limit próprio: limite a frequência de chamadas (por minuto e por destino) para não parecer comportamento automatizado abusivo, que acelera o ban.',
            'Consentimento do destinatário: só ligue para quem aceitou receber chamadas. Chamadas não solicitadas geram denúncias, que também aceleram o ban.',
            'Sessão isolada: rode a sessão Baileys isolada, com auth state protegido, para conter o impacto se a credencial vazar.',
          ],
        },
      ],
    },
    {
      title: 'Quando usar e quando NÃO usar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A regra prática é simples: só use baileys-caller se o valor de negócio justificar o risco de ban e a manutenção contínua. Para produção crítica, prefira sempre um canal de voz oficial (telefonia, SIP, provedores de voz) e deixe o WhatsApp para mensagens via Cloud API.',
        },
        {
          type: 'list',
          items: [
            'Use se: for um piloto, um caso de uso de baixo volume, com número dedicado e tolerância explícita a quedas e ban.',
            'Use se: o valor da chamada por voz no WhatsApp for alto o suficiente para compensar a infra e a manutenção contínua.',
            'NÃO use se: o fluxo for crítico para receita ou compliance e não puder tolerar indisponibilidade ou perda do número.',
            'NÃO use se: existir um canal de voz oficial (telefonia ou provedor de voz) que atenda o mesmo caso de uso com previsibilidade.',
            'NÃO use se: você não puder garantir consentimento do destinatário e rate limit responsável.',
          ],
        },
      ],
    },
    {
      title: 'Arquitetura responsável',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Se a decisão for seguir, contenha o risco com arquitetura. O objetivo é isolar a parte frágil e não oficial do resto do sistema, com fallback claro e observabilidade.',
        },
        {
          type: 'ordered',
          items: [
            'Isole a sessão Baileys em um worker dedicado, separado da sua API principal, com o auth state em armazenamento protegido.',
            'Coloque as chamadas atrás de uma fila, para controlar concorrência, aplicar rate limit e nunca disparar tudo de uma vez.',
            'Defina um fallback explícito: se a sessão Baileys cair ou o número for banido, caia para a Cloud API (mensagem) ou para SMS / telefonia.',
            'Registre logging estruturado de cada chamada (destino mascarado, status, duração, motivo de falha) para auditar e detectar degradação cedo.',
            'Monitore a saúde da sessão (connection.update) e alerte quando o pareamento cair, para reagir antes que a fila acumule.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'baileys-caller é oficial?',
      answer:
        'Não. É um projeto da comunidade baseado em Baileys, que fala o protocolo do WhatsApp Web via WebSocket. Não tem relação, suporte nem garantia da Meta, e opera fora dos termos de uso oficiais do WhatsApp.',
    },
    {
      question: 'Posso usar em produção?',
      answer:
        'Tecnicamente sim, mas com ressalvas sérias. Para fluxos críticos de receita ou compliance, prefira um canal de voz oficial. Se mesmo assim usar, faça com número dedicado, fila, rate limit, consentimento do destinatário e fallback para Cloud API ou telefonia.',
    },
    {
      question: 'Qual o risco de ban?',
      answer:
        'Alto e imprevisível. Originar chamadas via Baileys está fora do ToS, então o WhatsApp pode banir o número a qualquer momento, sem aviso. Trate o ban como algo que vai acontecer e use sempre um número descartável, nunca o principal do negócio.',
    },
  ],
  conclusion: {
    title: 'Use o trade-off com os olhos abertos',
    description:
      'O baileys-caller resolve um gap real (originar chamadas de voz que a Cloud API não permite), mas cobra esse poder em risco de ban e manutenção contínua. Trate como solução não oficial, isole a sessão, tenha fallback e só siga quando o valor justificar o risco.',
    cta: 'Quer avaliar se chamadas de voz no WhatsApp fazem sentido no seu caso? Vamos conversar.',
  },
  related: [
    { label: 'Guia do WhatsApp Cloud API', to: '/blog/guia-whatsapp-cloud-api' },
    { label: 'Segurança em integrações Meta e WhatsApp', to: '/blog/seguranca-integracoes-meta-whatsapp' },
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
  ],
  repo: {
    name: 'baileys-caller-demo',
    description: 'Exemplo ilustrativo de chamadas de voz no WhatsApp com Baileys, fila e fallback.',
    url: 'https://github.com/joaosouz4dev/baileys-caller-demo',
  },
};

const en = {
  intro:
    "WhatsApp's official Cloud API is excellent for messages, templates and webhooks, but it has a clear limit: it does not let you originate arbitrary voice calls from your system. When the use case requires it (a support callback, a voice confirmation, an urgent alert), the path goes through unofficial libraries based on Baileys, such as baileys-caller. This article shows how to start voice calls programmatically, how Baileys works under the hood and, above all, when this trade-off (unofficial solution versus official Cloud API) is actually worth it.",
  sections: [
    {
      title: 'The gap: the official Cloud API does not originate voice calls',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The official Cloud API covers sending and receiving messages, approved templates, media and status webhooks. It does not expose an endpoint for your backend to dial a voice call to a number. For some use cases (confirming a delivery by voice, doing an automatic support callback, firing an alert that needs to ring like a phone call), this gap is a real blocker, and that is where libraries based on the WhatsApp Web protocol come in.',
        },
        {
          type: 'paragraph',
          value:
            'Baileys is a Node.js library that speaks the WhatsApp Web protocol over a WebSocket. It is not the official Cloud API: it runs on top of a paired session (as if it were your WhatsApp Web), which opens doors the official API closes, but also brings risks the official API does not have. baileys-caller (https://github.com/SheIITear/baileys-caller) is a project focused on initiating and managing voice and video calls on top of that Baileys session.',
        },
        {
          type: 'table',
          columns: ['Criterion', 'Official Cloud API', 'Baileys / baileys-caller'],
          rows: [
            ['Official', 'Yes, supported by Meta', 'No, community library'],
            ['Voice calls', 'Does not originate calls', 'Initiates voice and video calls'],
            ['Stability', 'High, versioned contract', 'Fragile, breaks when protocol changes'],
            ['Ban risk', 'Low, within the ToS', 'High, outside the official ToS'],
            ['Cost', 'Per conversation, predictable', 'Own infra, no per-call fee'],
            ['Support', 'Meta docs and support', 'Community, no guarantee'],
          ],
        },
      ],
    },
    {
      title: 'How Baileys works at a high level',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Baileys does not use HTTP REST like the Cloud API. It opens a WebSocket against the WhatsApp Web infrastructure and keeps an authenticated session, exactly like the WhatsApp Web app does in the browser. Pairing happens via QR code or via a pairing code (a numeric code typed into the phone). From there, messages and events arrive through an asynchronous event stream.',
        },
        {
          type: 'diagram',
          value: `Your backend (Node.js)
        |
   [Baileys socket]  <== WebSocket ==>  WhatsApp Web infra
        |                                       |
   session credentials                     paired phone
   (saved auth state)                      (QR / pairing code)
        |
   events: connection.update, messages.upsert, call`,
        },
        {
          type: 'paragraph',
          value:
            'The session must be persisted (the so-called auth state) so it does not require a new pairing on every restart. The most relevant events are connection.update (connection state), messages.upsert (messages) and the call events, which are exactly what baileys-caller extends to allow originating the call, not just observing it.',
        },
      ],
    },
    {
      title: 'Illustrative setup: connect, pair and start a call',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The code below is illustrative. It shows the general pattern of connecting with Baileys, authenticating via pairing code and the idea of starting a call with baileys-caller. The exact function names may differ from the real version of the project, always check the repository (https://github.com/SheIITear/baileys-caller) before using it in any environment.',
        },
        {
          type: 'code',
          value: `// ILLUSTRATIVE: the real API may differ. Check the repo.
// https://github.com/SheIITear/baileys-caller
const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
// Illustrative import of the calling helper:
const { makeCaller } = require('baileys-caller');

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  // Pairing via pairing code (no QR), pass the bot number:
  if (!sock.authState.creds.registered) {
    const code = await sock.requestPairingCode('5511999999999');
    console.log('Type this code in the phone WhatsApp:', code);
  }

  // Calling layer (illustrative):
  const caller = makeCaller(sock);

  return { sock, caller };
}`,
        },
        {
          type: 'paragraph',
          value:
            'With the session active, you start the call and handle the lifecycle events. Again, the names are illustrative: what matters is the pattern of handling ringing, accepted, rejected and timeout.',
        },
        {
          type: 'code',
          value: `// ILLUSTRATIVE: method/event names may vary.
async function call(caller, target) {
  // target in WhatsApp JID format, e.g. '5511988888888@s.whatsapp.net'
  const c = await caller.offerCall(target, { video: false });

  c.on('ringing', () => console.log('Ringing on the target...'));
  c.on('accepted', () => console.log('Call accepted.'));
  c.on('rejected', () => console.log('Call rejected.'));
  c.on('timeout', () => console.log('No answer (timeout).'));

  // Hang up after a limit to avoid a stuck call:
  setTimeout(() => c.hangup().catch(() => {}), 45000);
}`,
        },
      ],
    },
    {
      title: 'Risks and mitigation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Using an unofficial library is not free in terms of risk. The most important point: WhatsApp can ban the number you use, without warning and without any practical appeal. Treat this as an eventual certainty, not a remote possibility, and design the system to survive it.',
        },
        {
          type: 'list',
          items: [
            'WhatsApp ToS: originating calls via Baileys is outside the official terms of use. Assess the legal and brand risk before proceeding.',
            'Number ban risk: use a dedicated, disposable number, never the main business number or a personal one.',
            'Protocol instability: when WhatsApp changes the Web protocol, the library may stop working until it is updated. Have a plan for downtime.',
            'Your own rate limit: limit call frequency (per minute and per target) so it does not look like abusive automated behavior, which accelerates the ban.',
            'Recipient consent: only call those who agreed to receive calls. Unsolicited calls generate reports, which also accelerate the ban.',
            'Isolated session: run the Baileys session isolated, with protected auth state, to contain the impact if the credential leaks.',
          ],
        },
      ],
    },
    {
      title: 'When to use and when NOT to use',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The practical rule is simple: only use baileys-caller if the business value justifies the ban risk and the ongoing maintenance. For critical production, always prefer an official voice channel (telephony, SIP, voice providers) and keep WhatsApp for messages via the Cloud API.',
        },
        {
          type: 'list',
          items: [
            'Use if: it is a pilot, a low-volume use case, with a dedicated number and explicit tolerance for outages and bans.',
            'Use if: the value of a WhatsApp voice call is high enough to offset the infra and the ongoing maintenance.',
            'Do NOT use if: the flow is critical for revenue or compliance and cannot tolerate downtime or loss of the number.',
            'Do NOT use if: there is an official voice channel (telephony or voice provider) that serves the same use case with predictability.',
            'Do NOT use if: you cannot guarantee recipient consent and a responsible rate limit.',
          ],
        },
      ],
    },
    {
      title: 'Responsible architecture',
      blocks: [
        {
          type: 'paragraph',
          value:
            'If the decision is to proceed, contain the risk with architecture. The goal is to isolate the fragile, unofficial part from the rest of the system, with a clear fallback and observability.',
        },
        {
          type: 'ordered',
          items: [
            'Isolate the Baileys session in a dedicated worker, separate from your main API, with the auth state in protected storage.',
            'Put calls behind a queue to control concurrency, apply rate limiting and never fire everything at once.',
            'Define an explicit fallback: if the Baileys session drops or the number is banned, fall back to the Cloud API (message) or to SMS / telephony.',
            'Record structured logging for each call (masked target, status, duration, failure reason) to audit and detect degradation early.',
            'Monitor session health (connection.update) and alert when pairing drops, so you can react before the queue piles up.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is baileys-caller official?',
      answer:
        'No. It is a community project based on Baileys, which speaks the WhatsApp Web protocol over a WebSocket. It has no relationship, support or guarantee from Meta, and it operates outside the official WhatsApp terms of use.',
    },
    {
      question: 'Can I use it in production?',
      answer:
        'Technically yes, but with serious caveats. For critical revenue or compliance flows, prefer an official voice channel. If you still use it, do so with a dedicated number, a queue, rate limiting, recipient consent and a fallback to the Cloud API or telephony.',
    },
    {
      question: 'What is the ban risk?',
      answer:
        'High and unpredictable. Originating calls via Baileys is outside the ToS, so WhatsApp can ban the number at any time, without warning. Treat the ban as something that will happen and always use a disposable number, never the main business one.',
    },
  ],
  conclusion: {
    title: 'Use the trade-off with eyes open',
    description:
      'baileys-caller solves a real gap (originating voice calls the Cloud API does not allow), but it charges for that power in ban risk and ongoing maintenance. Treat it as an unofficial solution, isolate the session, have a fallback and only proceed when the value justifies the risk.',
    cta: 'Want to assess whether WhatsApp voice calls make sense in your case? Let us talk.',
  },
  related: [
    { label: 'WhatsApp Cloud API guide', to: '/blog/guia-whatsapp-cloud-api' },
    { label: 'Security in Meta and WhatsApp integrations', to: '/blog/seguranca-integracoes-meta-whatsapp' },
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
  ],
  repo: {
    name: 'baileys-caller-demo',
    description: 'Illustrative example of WhatsApp voice calls with Baileys, a queue and fallback.',
    url: 'https://github.com/joaosouz4dev/baileys-caller-demo',
  },
};

const es = {
  intro:
    'La Cloud API oficial de WhatsApp es excelente para mensajes, plantillas y webhooks, pero tiene un límite claro: no permite originar llamadas de voz arbitrarias desde tu sistema. Cuando el caso de uso lo exige (un callback de atención, una confirmación por voz, una alerta urgente), el camino pasa por bibliotecas no oficiales basadas en Baileys, como baileys-caller. Este artículo muestra cómo iniciar llamadas de voz de forma programática, cómo funciona Baileys por debajo y, sobre todo, cuándo este trade-off (solución no oficial versus Cloud API oficial) realmente vale la pena.',
  sections: [
    {
      title: 'El gap: la Cloud API oficial no origina llamadas de voz',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La Cloud API oficial cubre el envío y la recepción de mensajes, plantillas aprobadas, medios y webhooks de estado. No expone un endpoint para que tu backend marque una llamada de voz a un número. Para algunos casos de uso (confirmar una entrega por voz, hacer un callback automático de atención, disparar una alerta que necesita sonar como una llamada), esa brecha es un bloqueo real, y ahí entran las bibliotecas basadas en el protocolo de WhatsApp Web.',
        },
        {
          type: 'paragraph',
          value:
            'Baileys es una biblioteca Node.js que habla el protocolo de WhatsApp Web por WebSocket. No es la Cloud API oficial: corre sobre una sesión emparejada (como si fuera tu WhatsApp Web), lo que abre puertas que la API oficial cierra, pero también trae riesgos que la API oficial no tiene. baileys-caller (https://github.com/SheIITear/baileys-caller) es un proyecto enfocado en iniciar y gestionar llamadas de voz y vídeo sobre esa sesión Baileys.',
        },
        {
          type: 'table',
          columns: ['Criterio', 'Cloud API oficial', 'Baileys / baileys-caller'],
          rows: [
            ['Oficial', 'Sí, soportada por Meta', 'No, biblioteca de la comunidad'],
            ['Llamadas de voz', 'No origina llamadas', 'Inicia llamadas de voz y vídeo'],
            ['Estabilidad', 'Alta, contrato versionado', 'Frágil, se rompe al cambiar el protocolo'],
            ['Riesgo de ban', 'Bajo, dentro del ToS', 'Alto, fuera del ToS oficial'],
            ['Costo', 'Por conversación, previsible', 'Infra propia, sin tarifa por llamada'],
            ['Soporte', 'Documentación y soporte de Meta', 'Comunidad, sin garantía'],
          ],
        },
      ],
    },
    {
      title: 'Cómo funciona Baileys a alto nivel',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Baileys no usa HTTP REST como la Cloud API. Abre un WebSocket contra la infraestructura de WhatsApp Web y mantiene una sesión autenticada, exactamente como hace la app de WhatsApp Web en el navegador. El emparejamiento ocurre por código QR o por un pairing code (un código numérico que se escribe en el celular). A partir de ahí, los mensajes y eventos llegan por un flujo de eventos asíncrono.',
        },
        {
          type: 'diagram',
          value: `Tu backend (Node.js)
        |
   [Baileys socket]  <== WebSocket ==>  WhatsApp Web infra
        |                                       |
   credenciales de la sesión               celular emparejado
   (auth state guardado)                   (QR / pairing code)
        |
   eventos: connection.update, messages.upsert, call`,
        },
        {
          type: 'paragraph',
          value:
            'La sesión debe persistirse (el llamado auth state) para no exigir un nuevo emparejamiento en cada reinicio. Los eventos más relevantes son connection.update (estado de la conexión), messages.upsert (mensajes) y los eventos de llamada, que son justamente lo que baileys-caller extiende para permitir originar la llamada, y no solo observarla.',
        },
      ],
    },
    {
      title: 'Setup ilustrativo: conectar, emparejar e iniciar una llamada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El código de abajo es ilustrativo. Muestra el patrón general de conexión con Baileys, autenticación por pairing code y la idea de iniciar una llamada con baileys-caller. Los nombres exactos de las funciones pueden diferir de la versión real del proyecto, consulta siempre el repositorio (https://github.com/SheIITear/baileys-caller) antes de usarlo en cualquier entorno.',
        },
        {
          type: 'code',
          value: `// ILUSTRATIVO: la API real puede diferir. Revisa el repo.
// https://github.com/SheIITear/baileys-caller
const { makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
// Import ilustrativo del helper de llamadas:
const { makeCaller } = require('baileys-caller');

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  // Emparejamiento por pairing code (sin QR), pasa el numero del bot:
  if (!sock.authState.creds.registered) {
    const code = await sock.requestPairingCode('5511999999999');
    console.log('Escribe este codigo en el WhatsApp del celular:', code);
  }

  // Capa de llamadas (ilustrativa):
  const caller = makeCaller(sock);

  return { sock, caller };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Con la sesión activa, inicias la llamada y manejas los eventos del ciclo de vida. De nuevo, los nombres son ilustrativos: lo importante es el patrón de manejar ringing, accepted, rejected y timeout.',
        },
        {
          type: 'code',
          value: `// ILUSTRATIVO: los nombres de metodos/eventos pueden variar.
async function llamar(caller, destino) {
  // destino en formato JID de WhatsApp, ej: '5511988888888@s.whatsapp.net'
  const c = await caller.offerCall(destino, { video: false });

  c.on('ringing', () => console.log('Sonando en el destino...'));
  c.on('accepted', () => console.log('Llamada aceptada.'));
  c.on('rejected', () => console.log('Llamada rechazada.'));
  c.on('timeout', () => console.log('Sin respuesta (timeout).'));

  // Colgar tras un limite para evitar una llamada colgada:
  setTimeout(() => c.hangup().catch(() => {}), 45000);
}`,
        },
      ],
    },
    {
      title: 'Riesgos y mitigación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Usar una biblioteca no oficial no es gratis en términos de riesgo. El punto más importante: WhatsApp puede banear el número que uses, sin aviso y sin recurso práctico. Trata esto como una certeza eventual, no como una posibilidad remota, y diseña el sistema para sobrevivir a ello.',
        },
        {
          type: 'list',
          items: [
            'ToS de WhatsApp: originar llamadas vía Baileys está fuera de los términos de uso oficiales. Evalúa el riesgo jurídico y de marca antes de seguir.',
            'Riesgo de ban del número: usa un número dedicado y descartable, nunca el número principal del negocio ni uno personal.',
            'Inestabilidad del protocolo: cuando WhatsApp cambia el protocolo de Web, la biblioteca puede dejar de funcionar hasta actualizarse. Ten un plan para la indisponibilidad.',
            'Rate limit propio: limita la frecuencia de llamadas (por minuto y por destino) para no parecer comportamiento automatizado abusivo, que acelera el ban.',
            'Consentimiento del destinatario: solo llama a quien aceptó recibir llamadas. Las llamadas no solicitadas generan denuncias, que también aceleran el ban.',
            'Sesión aislada: corre la sesión Baileys aislada, con el auth state protegido, para contener el impacto si la credencial se filtra.',
          ],
        },
      ],
    },
    {
      title: 'Cuándo usar y cuándo NO usar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La regla práctica es simple: solo usa baileys-caller si el valor de negocio justifica el riesgo de ban y el mantenimiento continuo. Para producción crítica, prefiere siempre un canal de voz oficial (telefonía, SIP, proveedores de voz) y deja WhatsApp para mensajes vía Cloud API.',
        },
        {
          type: 'list',
          items: [
            'Usa si: es un piloto, un caso de uso de bajo volumen, con número dedicado y tolerancia explícita a caídas y bans.',
            'Usa si: el valor de la llamada de voz en WhatsApp es lo bastante alto para compensar la infra y el mantenimiento continuo.',
            'NO uses si: el flujo es crítico para ingresos o compliance y no puede tolerar indisponibilidad ni la pérdida del número.',
            'NO uses si: existe un canal de voz oficial (telefonía o proveedor de voz) que atienda el mismo caso de uso con previsibilidad.',
            'NO uses si: no puedes garantizar el consentimiento del destinatario y un rate limit responsable.',
          ],
        },
      ],
    },
    {
      title: 'Arquitectura responsable',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Si la decisión es seguir, contén el riesgo con arquitectura. El objetivo es aislar la parte frágil y no oficial del resto del sistema, con fallback claro y observabilidad.',
        },
        {
          type: 'ordered',
          items: [
            'Aísla la sesión Baileys en un worker dedicado, separado de tu API principal, con el auth state en almacenamiento protegido.',
            'Coloca las llamadas detrás de una cola, para controlar concurrencia, aplicar rate limit y nunca disparar todo de una vez.',
            'Define un fallback explícito: si la sesión Baileys cae o el número es baneado, cae a la Cloud API (mensaje) o a SMS / telefonía.',
            'Registra logging estructurado de cada llamada (destino enmascarado, estado, duración, motivo de falla) para auditar y detectar degradación temprano.',
            'Monitorea la salud de la sesión (connection.update) y alerta cuando el emparejamiento caiga, para reaccionar antes de que la cola se acumule.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿baileys-caller es oficial?',
      answer:
        'No. Es un proyecto de la comunidad basado en Baileys, que habla el protocolo de WhatsApp Web por WebSocket. No tiene relación, soporte ni garantía de Meta, y opera fuera de los términos de uso oficiales de WhatsApp.',
    },
    {
      question: '¿Puedo usarlo en producción?',
      answer:
        'Técnicamente sí, pero con reservas serias. Para flujos críticos de ingresos o compliance, prefiere un canal de voz oficial. Si aun así lo usas, hazlo con número dedicado, cola, rate limit, consentimiento del destinatario y fallback a la Cloud API o telefonía.',
    },
    {
      question: '¿Cuál es el riesgo de ban?',
      answer:
        'Alto e impredecible. Originar llamadas vía Baileys está fuera del ToS, así que WhatsApp puede banear el número en cualquier momento, sin aviso. Trata el ban como algo que va a pasar y usa siempre un número descartable, nunca el principal del negocio.',
    },
  ],
  conclusion: {
    title: 'Usa el trade-off con los ojos abiertos',
    description:
      'baileys-caller resuelve un gap real (originar llamadas de voz que la Cloud API no permite), pero cobra ese poder en riesgo de ban y mantenimiento continuo. Trátalo como solución no oficial, aísla la sesión, ten fallback y solo sigue cuando el valor justifique el riesgo.',
    cta: '¿Quieres evaluar si las llamadas de voz en WhatsApp tienen sentido en tu caso? Hablemos.',
  },
  related: [
    { label: 'Guía del WhatsApp Cloud API', to: '/blog/guia-whatsapp-cloud-api' },
    { label: 'Seguridad en integraciones Meta y WhatsApp', to: '/blog/seguranca-integracoes-meta-whatsapp' },
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
  ],
  repo: {
    name: 'baileys-caller-demo',
    description: 'Ejemplo ilustrativo de llamadas de voz en WhatsApp con Baileys, cola y fallback.',
    url: 'https://github.com/joaosouz4dev/baileys-caller-demo',
  },
};

export default { pt, en, es };
