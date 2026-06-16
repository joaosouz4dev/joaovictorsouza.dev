// Conteudo do artigo: crm-whatsapp-playbook-vendas
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections, faq, conclusion, related, repo }

const pt = {
  intro:
    'O WhatsApp virou o canal onde a venda realmente acontece, mas sem CRM no meio o time perde contexto, esquece follow-up e nao consegue medir nada. O segredo nao e jogar todo o chat dentro do CRM: e mapear os eventos certos (lead criado, mensagem recebida, qualificacao, agendamento, fechamento), modelar o funil com etapas claras e automatizar roteamento, lead scoring e SLA de primeira resposta. Este playbook mostra como ligar atendimento, qualificacao e fechamento sem perder qualidade nem poluir a base.',
  sections: [
    {
      title: 'Mapa de eventos que saem do WhatsApp para o CRM',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O primeiro passo e decidir quais sinais do WhatsApp viram eventos de negocio no CRM. Nem tudo precisa ir: o que importa e o que move o funil ou aciona uma automacao. Cada evento carrega um payload minimo, suficiente para o CRM atualizar o contato, o deal e os campos customizados sem depender do historico bruto de conversa.',
        },
        {
          type: 'table',
          columns: ['Evento', 'Quando dispara', 'Payload essencial'],
          rows: [
            [
              'lead.created',
              'Primeiro contato de um numero ainda desconhecido',
              'phone, name, source, first_message, timestamp',
            ],
            [
              'message.received',
              'Mensagem do lead que muda o estado (nao todas)',
              'phone, intent, deal_id, channel, timestamp',
            ],
            [
              'lead.qualified',
              'Lead respondeu criterios minimos (orcamento, fit)',
              'deal_id, score, budget, segment, owner',
            ],
            [
              'meeting.scheduled',
              'Agendamento confirmado de call ou visita',
              'deal_id, meeting_at, owner, calendar_link',
            ],
            [
              'deal.closed',
              'Fechamento ganho ou perdido',
              'deal_id, status, amount, reason, owner',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Repare que message.received aparece com filtro: so vira evento quando muda o estado do lead (uma intencao de compra, um pedido de orcamento, um aceite). Espelhar cada mensagem trocada no CRM e o caminho mais rapido para uma base impossivel de ler.',
        },
      ],
    },
    {
      title: 'Funil e etapas: do primeiro oi ao fechamento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com os eventos definidos, cada um deles empurra o deal por uma etapa do funil. O funil precisa ser simples o bastante para o time vendedor seguir sem treinamento extenso, e granular o bastante para o gestor enxergar onde os leads travam.',
        },
        {
          type: 'diagram',
          value: `WhatsApp                          CRM (funil de vendas)
   |
   | lead.created          -->  [ 1. Novo lead ]
   |                                   |
   | message.received       -->  [ 2. Em atendimento ]
   |                                   |
   | lead.qualified         -->  [ 3. Qualificado ]
   |                                   |
   | meeting.scheduled      -->  [ 4. Agendado ]
   |                                   |
   | deal.closed (won)      -->  [ 5a. Ganho ]
   | deal.closed (lost)     -->  [ 5b. Perdido ]
   v
(cada evento move o deal de etapa
 e dispara a automacao da etapa)`,
        },
        {
          type: 'paragraph',
          value:
            'A regra pratica: uma etapa, um evento de entrada, uma automacao de saida. Quando um deal entra em Qualificado, o roteamento por SDR e o lead scoring rodam; quando entra em Agendado, o lembrete automatico e o SLA de comparecimento entram em cena. Etapas sem evento de entrada claro tendem a virar limbo.',
        },
      ],
    },
    {
      title: 'Automacoes recomendadas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'As automacoes sao o que transforma o CRM de planilha bonita em maquina de vendas. Quatro merecem prioridade por impacto direto em velocidade e taxa de conversao:',
        },
        {
          type: 'list',
          items: [
            'Lead scoring: pontue cada lead a partir de fit (segmento, ticket potencial) e engajamento (respondeu rapido, abriu link, pediu orcamento). O score define prioridade na fila e quem recebe o lead.',
            'Roteamento por SDR: distribua leads qualificados por regras (rodizio, especializacao por produto, idioma ou regiao) em vez de deixar todos brigarem pela mesma fila. Atribua um owner no evento lead.qualified.',
            'Follow-up automatico com template: se o lead nao responde em X horas, dispare um template aprovado (HSM) de retomada. Cada follow-up deve ter limite de tentativas e parar no primeiro sinal de resposta ou opt-out.',
            'SLA de primeira resposta: meça o tempo entre lead.created e a primeira resposta humana. Configure alerta quando ultrapassar o limite (ex.: 5 minutos em horario comercial) para o gestor agir antes do lead esfriar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Essas quatro automacoes se reforçam: o scoring alimenta o roteamento, o roteamento define quem responde dentro do SLA, e o follow-up recupera quem escapou. Comece pelo SLA de primeira resposta, que costuma ser o de maior retorno imediato.',
        },
      ],
    },
    {
      title: 'Exemplo de payload enviado ao CRM',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Na pratica, o evento lead.qualified vira um POST para a API do CRM criando ou atualizando contato, deal e campos customizados de uma vez. O payload abaixo usa upsert por telefone para nao duplicar contatos quando o mesmo lead volta a falar.',
        },
        {
          type: 'code',
          value: `// POST https://api.crm.example.com/v1/events
// Header: Authorization: Bearer <token>
{
  "event": "lead.qualified",
  "occurred_at": "2026-06-16T14:32:05Z",
  "contact": {
    "match_by": "phone",
    "phone": "+5511999998888",
    "name": "Mariana Lopes",
    "source": "whatsapp",
    "tags": ["inbound", "campanha-junho"]
  },
  "deal": {
    "external_id": "wa-deal-8f12c",
    "pipeline": "vendas-inbound",
    "stage": "qualificado",
    "owner_email": "sdr.ana@example.com",
    "amount_estimated": 4800.00,
    "currency": "BRL"
  },
  "custom_fields": {
    "lead_score": 82,
    "budget_confirmed": true,
    "segment": "varejo",
    "first_response_seconds": 143,
    "wa_conversation_id": "CONV-7731"
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Tres detalhes que evitam dor de cabeca: occurred_at em UTC (ISO 8601) para o CRM ordenar os eventos corretamente; external_id estavel no deal para idempotencia (reenvios nao criam deals duplicados); e match_by por telefone para o CRM resolver o contato existente em vez de criar um novo.',
        },
      ],
    },
    {
      title: 'Anti-padroes que destroem a qualidade da base',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Conectar WhatsApp e CRM mal feito e pior do que nao conectar: gera ruido, retrabalho e risco de bloqueio. Os erros mais caros sao previsiveis.',
        },
        {
          type: 'list',
          items: [
            'Poluir o CRM com cada mensagem: espelhar todo o chat enche a timeline de ruido, esconde os eventos que importam e torna relatorio inutil. Envie eventos de negocio, nao logs de conversa.',
            'Automacao sem opt-out: disparar follow-up sem respeitar pedido de parar (ou sem checar opt-out) queima reputacao do numero e arrisca bloqueio pela Meta. Todo fluxo automatico precisa de saida limpa.',
            'Criar deal duplicado a cada retorno: sem upsert por telefone e external_id estavel, o mesmo lead vira tres deals e o funil mente. Sempre faça match do contato e idempotencia do deal.',
            'Scoring sem revisao: um score que nunca e recalibrado prioriza lead errado por meses. Revise os pesos com base em quem realmente fechou.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A pergunta de controle antes de criar qualquer evento ou automacao: isso ajuda o vendedor a fechar ou o gestor a decidir? Se a resposta e nao, provavelmente e ruido que deveria ficar fora do CRM.',
        },
      ],
    },
    {
      title: 'Checklist de implementacao',
      blocks: [
        {
          type: 'ordered',
          items: [
            'Definir o mapa de eventos de negocio (5 eventos chave) e o payload minimo de cada um.',
            'Modelar o funil com uma etapa por evento de entrada e uma automacao de saida.',
            'Implementar upsert de contato por telefone e idempotencia de deal por external_id.',
            'Ativar SLA de primeira resposta com alerta antes de ligar as demais automacoes.',
            'Configurar lead scoring e roteamento por SDR sobre o evento lead.qualified.',
            'Garantir opt-out e limite de tentativas em todo follow-up automatico.',
            'Revisar mensalmente o que vira evento, cortando ruido e recalibrando o scoring.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Devo registrar todas as mensagens do WhatsApp no CRM?',
      answer:
        'Nao. Espelhar cada mensagem enche a base de ruido, esconde os eventos que movem o funil e torna relatorios inuteis. Registre apenas eventos de negocio (lead criado, qualificacao, agendamento, fechamento) e mensagens que mudam o estado do lead. Se precisar do historico completo da conversa, mantenha-o na plataforma de atendimento e referencie pelo wa_conversation_id, em vez de duplicar tudo dentro do CRM.',
    },
    {
      question: 'Como evitar deals duplicados quando o mesmo lead volta a falar?',
      answer:
        'Use upsert de contato por telefone (match_by phone) e um external_id estavel no deal. Assim, reenvios de evento ou retornos do mesmo lead atualizam o registro existente em vez de criar um novo. A idempotencia por external_id e o que garante que um evento reentregue nao gere um deal fantasma no funil.',
    },
    {
      question: 'Qual automacao traz retorno mais rapido?',
      answer:
        'O SLA de primeira resposta. Medir o tempo entre lead.created e a primeira resposta humana, com alerta quando passa do limite (por exemplo, 5 minutos em horario comercial), costuma elevar a conversao quase de imediato, porque lead que espera esfria rapido. Depois dele, lead scoring e roteamento por SDR multiplicam o efeito ao colocar o lead certo na mao certa.',
    },
  ],
  conclusion: {
    title: 'CRM e WhatsApp juntos vendem mais, se os eventos forem certos',
    description:
      'O ganho nao vem de copiar o chat para dentro do CRM, e de mapear os eventos certos, modelar o funil com etapas claras e automatizar scoring, roteamento, follow-up e SLA sem poluir a base. Se voce quer ligar atendimento, qualificacao e fechamento sem perder qualidade, posso ajudar a desenhar esse playbook na sua operacao.',
    cta: 'Falar sobre minha operacao de vendas',
  },
  related: [
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'Integracao ERP e CRM sem retrabalho', to: '/blog/integracao-erp-crm-sem-retrabalho' },
    { label: 'Case: WhatsApp com IA no atendimento', to: '/cases/whatsapp-ia-atendimento' },
  ],
  repo: {
    name: 'whatsapp-crm-events',
    description:
      'Mapa de eventos e exemplos de payload para ligar WhatsApp ao CRM (lead, qualificacao, agendamento, fechamento) com upsert e idempotencia.',
    url: 'https://github.com/joaosouz4dev/whatsapp-crm-events',
  },
};

const en = {
  intro:
    'WhatsApp has become the channel where sales actually happen, but without a CRM in the middle the team loses context, forgets follow-ups and cannot measure anything. The secret is not to dump the whole chat into the CRM: it is to map the right events (lead created, message received, qualification, scheduling, closing), model the funnel with clear stages and automate routing, lead scoring and first-response SLA. This playbook shows how to connect support, qualification and closing without losing quality or polluting the database.',
  sections: [
    {
      title: 'Map of events that flow from WhatsApp to the CRM',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first step is to decide which WhatsApp signals become business events in the CRM. Not everything needs to go: what matters is what moves the funnel or triggers an automation. Each event carries a minimal payload, enough for the CRM to update the contact, the deal and the custom fields without depending on the raw conversation history.',
        },
        {
          type: 'table',
          columns: ['Event', 'When it fires', 'Essential payload'],
          rows: [
            [
              'lead.created',
              'First contact from a still unknown number',
              'phone, name, source, first_message, timestamp',
            ],
            [
              'message.received',
              'Lead message that changes state (not all of them)',
              'phone, intent, deal_id, channel, timestamp',
            ],
            [
              'lead.qualified',
              'Lead met the minimum criteria (budget, fit)',
              'deal_id, score, budget, segment, owner',
            ],
            [
              'meeting.scheduled',
              'Confirmed call or visit scheduling',
              'deal_id, meeting_at, owner, calendar_link',
            ],
            [
              'deal.closed',
              'Closing, won or lost',
              'deal_id, status, amount, reason, owner',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Notice that message.received comes with a filter: it only becomes an event when it changes the lead state (a buying intent, a quote request, an acceptance). Mirroring every message exchanged into the CRM is the fastest path to a database that is impossible to read.',
        },
      ],
    },
    {
      title: 'Funnel and stages: from first hello to closing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the events defined, each one pushes the deal through a funnel stage. The funnel must be simple enough for the sales team to follow without extensive training, and granular enough for the manager to see where leads get stuck.',
        },
        {
          type: 'diagram',
          value: `WhatsApp                          CRM (sales funnel)
   |
   | lead.created          -->  [ 1. New lead ]
   |                                   |
   | message.received       -->  [ 2. In progress ]
   |                                   |
   | lead.qualified         -->  [ 3. Qualified ]
   |                                   |
   | meeting.scheduled      -->  [ 4. Scheduled ]
   |                                   |
   | deal.closed (won)      -->  [ 5a. Won ]
   | deal.closed (lost)     -->  [ 5b. Lost ]
   v
(each event moves the deal one stage
 and triggers the stage automation)`,
        },
        {
          type: 'paragraph',
          value:
            'The practical rule: one stage, one entry event, one exit automation. When a deal enters Qualified, SDR routing and lead scoring run; when it enters Scheduled, the automatic reminder and the show-up SLA kick in. Stages without a clear entry event tend to become limbo.',
        },
      ],
    },
    {
      title: 'Recommended automations',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Automations are what turn the CRM from a pretty spreadsheet into a sales machine. Four deserve priority for their direct impact on speed and conversion rate:',
        },
        {
          type: 'list',
          items: [
            'Lead scoring: score each lead based on fit (segment, potential ticket) and engagement (replied fast, opened a link, asked for a quote). The score sets the priority in the queue and who receives the lead.',
            'SDR routing: distribute qualified leads by rules (round-robin, specialization by product, language or region) instead of letting everyone fight over the same queue. Assign an owner on the lead.qualified event.',
            'Automatic follow-up with a template: if the lead does not reply within X hours, send an approved template (HSM) to re-engage. Each follow-up must have an attempt limit and stop at the first sign of a reply or opt-out.',
            'First-response SLA: measure the time between lead.created and the first human reply. Set an alert when it crosses the limit (e.g. 5 minutes during business hours) so the manager can act before the lead cools off.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'These four automations reinforce each other: scoring feeds routing, routing defines who replies within the SLA, and follow-up recovers whoever slipped away. Start with the first-response SLA, which is usually the one with the highest immediate return.',
        },
      ],
    },
    {
      title: 'Example payload sent to the CRM',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In practice, the lead.qualified event becomes a POST to the CRM API creating or updating contact, deal and custom fields at once. The payload below uses upsert by phone to avoid duplicating contacts when the same lead comes back.',
        },
        {
          type: 'code',
          value: `// POST https://api.crm.example.com/v1/events
// Header: Authorization: Bearer <token>
{
  "event": "lead.qualified",
  "occurred_at": "2026-06-16T14:32:05Z",
  "contact": {
    "match_by": "phone",
    "phone": "+5511999998888",
    "name": "Mariana Lopes",
    "source": "whatsapp",
    "tags": ["inbound", "june-campaign"]
  },
  "deal": {
    "external_id": "wa-deal-8f12c",
    "pipeline": "inbound-sales",
    "stage": "qualified",
    "owner_email": "sdr.ana@example.com",
    "amount_estimated": 4800.00,
    "currency": "BRL"
  },
  "custom_fields": {
    "lead_score": 82,
    "budget_confirmed": true,
    "segment": "retail",
    "first_response_seconds": 143,
    "wa_conversation_id": "CONV-7731"
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Three details that prevent headaches: occurred_at in UTC (ISO 8601) so the CRM orders events correctly; a stable external_id on the deal for idempotency (resends do not create duplicate deals); and match_by phone so the CRM resolves the existing contact instead of creating a new one.',
        },
      ],
    },
    {
      title: 'Anti-patterns that destroy database quality',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Connecting WhatsApp and CRM badly is worse than not connecting at all: it generates noise, rework and blocking risk. The most expensive mistakes are predictable.',
        },
        {
          type: 'list',
          items: [
            'Polluting the CRM with every message: mirroring the whole chat fills the timeline with noise, hides the events that matter and makes reporting useless. Send business events, not conversation logs.',
            'Automation without opt-out: firing follow-ups without honoring a stop request (or without checking opt-out) burns the number reputation and risks a Meta block. Every automatic flow needs a clean exit.',
            'Creating a duplicate deal on every return: without upsert by phone and a stable external_id, the same lead becomes three deals and the funnel lies. Always match the contact and keep the deal idempotent.',
            'Scoring without review: a score that is never recalibrated prioritizes the wrong lead for months. Revisit the weights based on who actually closed.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The control question before creating any event or automation: does this help the rep close or the manager decide? If the answer is no, it is probably noise that should stay out of the CRM.',
        },
      ],
    },
    {
      title: 'Implementation checklist',
      blocks: [
        {
          type: 'ordered',
          items: [
            'Define the business event map (5 key events) and the minimal payload of each one.',
            'Model the funnel with one stage per entry event and one exit automation.',
            'Implement contact upsert by phone and deal idempotency by external_id.',
            'Enable the first-response SLA with an alert before turning on the other automations.',
            'Configure lead scoring and SDR routing on top of the lead.qualified event.',
            'Ensure opt-out and an attempt limit on every automatic follow-up.',
            'Review monthly what becomes an event, cutting noise and recalibrating the scoring.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Should I log every WhatsApp message in the CRM?',
      answer:
        'No. Mirroring every message fills the database with noise, hides the events that move the funnel and makes reports useless. Log only business events (lead created, qualification, scheduling, closing) and messages that change the lead state. If you need the full conversation history, keep it in the support platform and reference it by wa_conversation_id, instead of duplicating everything inside the CRM.',
    },
    {
      question: 'How do I avoid duplicate deals when the same lead comes back?',
      answer:
        'Use contact upsert by phone (match_by phone) and a stable external_id on the deal. That way, event resends or returns from the same lead update the existing record instead of creating a new one. Idempotency by external_id is what guarantees that a redelivered event does not create a phantom deal in the funnel.',
    },
    {
      question: 'Which automation brings the fastest return?',
      answer:
        'The first-response SLA. Measuring the time between lead.created and the first human reply, with an alert when it crosses the limit (for example, 5 minutes during business hours), usually lifts conversion almost immediately, because a lead that waits cools off fast. After it, lead scoring and SDR routing multiply the effect by putting the right lead in the right hands.',
    },
  ],
  conclusion: {
    title: 'CRM and WhatsApp together sell more, if the events are right',
    description:
      'The gain does not come from copying the chat into the CRM, it comes from mapping the right events, modeling the funnel with clear stages and automating scoring, routing, follow-up and SLA without polluting the database. If you want to connect support, qualification and closing without losing quality, I can help design this playbook for your operation.',
    cta: 'Talk about my sales operation',
  },
  related: [
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'ERP and CRM integration without rework', to: '/blog/integracao-erp-crm-sem-retrabalho' },
    { label: 'Case: WhatsApp with AI in support', to: '/cases/whatsapp-ia-atendimento' },
  ],
  repo: {
    name: 'whatsapp-crm-events',
    description:
      'Event map and payload examples to connect WhatsApp to the CRM (lead, qualification, scheduling, closing) with upsert and idempotency.',
    url: 'https://github.com/joaosouz4dev/whatsapp-crm-events',
  },
};

const es = {
  intro:
    'WhatsApp se convirtio en el canal donde la venta realmente ocurre, pero sin un CRM en el medio el equipo pierde contexto, olvida el follow-up y no logra medir nada. El secreto no es volcar todo el chat dentro del CRM: es mapear los eventos correctos (lead creado, mensaje recibido, calificacion, agendamiento, cierre), modelar el embudo con etapas claras y automatizar enrutamiento, lead scoring y SLA de primera respuesta. Este playbook muestra como conectar atencion, calificacion y cierre sin perder calidad ni contaminar la base.',
  sections: [
    {
      title: 'Mapa de eventos que salen de WhatsApp hacia el CRM',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El primer paso es decidir que senales de WhatsApp se convierten en eventos de negocio en el CRM. No todo debe ir: lo que importa es lo que mueve el embudo o dispara una automatizacion. Cada evento lleva un payload minimo, suficiente para que el CRM actualice el contacto, el deal y los campos personalizados sin depender del historial bruto de la conversacion.',
        },
        {
          type: 'table',
          columns: ['Evento', 'Cuando dispara', 'Payload esencial'],
          rows: [
            [
              'lead.created',
              'Primer contacto de un numero aun desconocido',
              'phone, name, source, first_message, timestamp',
            ],
            [
              'message.received',
              'Mensaje del lead que cambia el estado (no todos)',
              'phone, intent, deal_id, channel, timestamp',
            ],
            [
              'lead.qualified',
              'El lead cumplio los criterios minimos (presupuesto, fit)',
              'deal_id, score, budget, segment, owner',
            ],
            [
              'meeting.scheduled',
              'Agendamiento confirmado de call o visita',
              'deal_id, meeting_at, owner, calendar_link',
            ],
            [
              'deal.closed',
              'Cierre, ganado o perdido',
              'deal_id, status, amount, reason, owner',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Observa que message.received viene con filtro: solo se convierte en evento cuando cambia el estado del lead (una intencion de compra, un pedido de cotizacion, una aceptacion). Espejar cada mensaje intercambiado en el CRM es el camino mas rapido hacia una base imposible de leer.',
        },
      ],
    },
    {
      title: 'Embudo y etapas: del primer hola al cierre',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con los eventos definidos, cada uno empuja el deal por una etapa del embudo. El embudo debe ser bastante simple para que el equipo de ventas lo siga sin entrenamiento extenso, y bastante granular para que el gestor vea donde se traban los leads.',
        },
        {
          type: 'diagram',
          value: `WhatsApp                          CRM (embudo de ventas)
   |
   | lead.created          -->  [ 1. Nuevo lead ]
   |                                   |
   | message.received       -->  [ 2. En atencion ]
   |                                   |
   | lead.qualified         -->  [ 3. Calificado ]
   |                                   |
   | meeting.scheduled      -->  [ 4. Agendado ]
   |                                   |
   | deal.closed (won)      -->  [ 5a. Ganado ]
   | deal.closed (lost)     -->  [ 5b. Perdido ]
   v
(cada evento mueve el deal una etapa
 y dispara la automatizacion de la etapa)`,
        },
        {
          type: 'paragraph',
          value:
            'La regla practica: una etapa, un evento de entrada, una automatizacion de salida. Cuando un deal entra en Calificado, el enrutamiento por SDR y el lead scoring se ejecutan; cuando entra en Agendado, el recordatorio automatico y el SLA de asistencia entran en accion. Las etapas sin evento de entrada claro tienden a volverse un limbo.',
        },
      ],
    },
    {
      title: 'Automatizaciones recomendadas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Las automatizaciones son lo que transforma el CRM de una planilla bonita en una maquina de ventas. Cuatro merecen prioridad por su impacto directo en velocidad y tasa de conversion:',
        },
        {
          type: 'list',
          items: [
            'Lead scoring: puntua cada lead a partir del fit (segmento, ticket potencial) y el engagement (respondio rapido, abrio un enlace, pidio cotizacion). El score define la prioridad en la fila y quien recibe el lead.',
            'Enrutamiento por SDR: distribuye los leads calificados por reglas (rotacion, especializacion por producto, idioma o region) en lugar de dejar que todos peleen por la misma fila. Asigna un owner en el evento lead.qualified.',
            'Follow-up automatico con plantilla: si el lead no responde en X horas, dispara una plantilla aprobada (HSM) de retoma. Cada follow-up debe tener limite de intentos y detenerse ante la primera senal de respuesta u opt-out.',
            'SLA de primera respuesta: mide el tiempo entre lead.created y la primera respuesta humana. Configura una alerta cuando supere el limite (ej.: 5 minutos en horario comercial) para que el gestor actue antes de que el lead se enfrie.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Estas cuatro automatizaciones se refuerzan entre si: el scoring alimenta el enrutamiento, el enrutamiento define quien responde dentro del SLA, y el follow-up recupera a quien se escapo. Empieza por el SLA de primera respuesta, que suele ser el de mayor retorno inmediato.',
        },
      ],
    },
    {
      title: 'Ejemplo de payload enviado al CRM',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En la practica, el evento lead.qualified se convierte en un POST a la API del CRM que crea o actualiza contacto, deal y campos personalizados de una vez. El payload de abajo usa upsert por telefono para no duplicar contactos cuando el mismo lead vuelve a hablar.',
        },
        {
          type: 'code',
          value: `// POST https://api.crm.example.com/v1/events
// Header: Authorization: Bearer <token>
{
  "event": "lead.qualified",
  "occurred_at": "2026-06-16T14:32:05Z",
  "contact": {
    "match_by": "phone",
    "phone": "+5511999998888",
    "name": "Mariana Lopes",
    "source": "whatsapp",
    "tags": ["inbound", "campana-junio"]
  },
  "deal": {
    "external_id": "wa-deal-8f12c",
    "pipeline": "ventas-inbound",
    "stage": "calificado",
    "owner_email": "sdr.ana@example.com",
    "amount_estimated": 4800.00,
    "currency": "BRL"
  },
  "custom_fields": {
    "lead_score": 82,
    "budget_confirmed": true,
    "segment": "retail",
    "first_response_seconds": 143,
    "wa_conversation_id": "CONV-7731"
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Tres detalles que evitan dolores de cabeza: occurred_at en UTC (ISO 8601) para que el CRM ordene los eventos correctamente; un external_id estable en el deal para la idempotencia (los reenvios no crean deals duplicados); y match_by por telefono para que el CRM resuelva el contacto existente en lugar de crear uno nuevo.',
        },
      ],
    },
    {
      title: 'Anti-patrones que destruyen la calidad de la base',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Conectar WhatsApp y CRM mal hecho es peor que no conectar: genera ruido, retrabajo y riesgo de bloqueo. Los errores mas caros son predecibles.',
        },
        {
          type: 'list',
          items: [
            'Contaminar el CRM con cada mensaje: espejar todo el chat llena la timeline de ruido, esconde los eventos que importan y vuelve inutil el reporte. Envia eventos de negocio, no logs de conversacion.',
            'Automatizacion sin opt-out: disparar follow-up sin respetar un pedido de detener (o sin verificar el opt-out) quema la reputacion del numero y arriesga un bloqueo de Meta. Todo flujo automatico necesita una salida limpia.',
            'Crear un deal duplicado en cada retorno: sin upsert por telefono y un external_id estable, el mismo lead se vuelve tres deals y el embudo miente. Siempre haz match del contacto y manten la idempotencia del deal.',
            'Scoring sin revision: un score que nunca se recalibra prioriza el lead equivocado durante meses. Revisa los pesos con base en quien realmente cerro.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La pregunta de control antes de crear cualquier evento o automatizacion: esto ayuda al vendedor a cerrar o al gestor a decidir? Si la respuesta es no, probablemente es ruido que deberia quedar fuera del CRM.',
        },
      ],
    },
    {
      title: 'Checklist de implementacion',
      blocks: [
        {
          type: 'ordered',
          items: [
            'Definir el mapa de eventos de negocio (5 eventos clave) y el payload minimo de cada uno.',
            'Modelar el embudo con una etapa por evento de entrada y una automatizacion de salida.',
            'Implementar upsert de contacto por telefono e idempotencia del deal por external_id.',
            'Activar el SLA de primera respuesta con alerta antes de encender las demas automatizaciones.',
            'Configurar lead scoring y enrutamiento por SDR sobre el evento lead.qualified.',
            'Garantizar opt-out y limite de intentos en todo follow-up automatico.',
            'Revisar mensualmente que se convierte en evento, cortando ruido y recalibrando el scoring.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Debo registrar todos los mensajes de WhatsApp en el CRM?',
      answer:
        'No. Espejar cada mensaje llena la base de ruido, esconde los eventos que mueven el embudo y vuelve inutiles los reportes. Registra solo eventos de negocio (lead creado, calificacion, agendamiento, cierre) y mensajes que cambian el estado del lead. Si necesitas el historial completo de la conversacion, mantenlo en la plataforma de atencion y referencialo por wa_conversation_id, en lugar de duplicar todo dentro del CRM.',
    },
    {
      question: 'Como evitar deals duplicados cuando el mismo lead vuelve a hablar?',
      answer:
        'Usa upsert de contacto por telefono (match_by phone) y un external_id estable en el deal. Asi, los reenvios de evento o los retornos del mismo lead actualizan el registro existente en lugar de crear uno nuevo. La idempotencia por external_id es lo que garantiza que un evento reentregado no genere un deal fantasma en el embudo.',
    },
    {
      question: 'Que automatizacion trae el retorno mas rapido?',
      answer:
        'El SLA de primera respuesta. Medir el tiempo entre lead.created y la primera respuesta humana, con alerta cuando supera el limite (por ejemplo, 5 minutos en horario comercial), suele elevar la conversion casi de inmediato, porque un lead que espera se enfria rapido. Despues de el, el lead scoring y el enrutamiento por SDR multiplican el efecto al poner el lead correcto en las manos correctas.',
    },
  ],
  conclusion: {
    title: 'CRM y WhatsApp juntos venden mas, si los eventos son los correctos',
    description:
      'La ganancia no viene de copiar el chat dentro del CRM, viene de mapear los eventos correctos, modelar el embudo con etapas claras y automatizar scoring, enrutamiento, follow-up y SLA sin contaminar la base. Si quieres conectar atencion, calificacion y cierre sin perder calidad, puedo ayudar a disenar este playbook en tu operacion.',
    cta: 'Hablar sobre mi operacion de ventas',
  },
  related: [
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'Integracion ERP y CRM sin retrabajo', to: '/blog/integracao-erp-crm-sem-retrabalho' },
    { label: 'Caso: WhatsApp con IA en la atencion', to: '/cases/whatsapp-ia-atendimento' },
  ],
  repo: {
    name: 'whatsapp-crm-events',
    description:
      'Mapa de eventos y ejemplos de payload para conectar WhatsApp al CRM (lead, calificacion, agendamiento, cierre) con upsert e idempotencia.',
    url: 'https://github.com/joaosouz4dev/whatsapp-crm-events',
  },
};

export default { pt, en, es };
