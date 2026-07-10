// Conteudo do artigo "Handoff humano no WhatsApp".
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const pt = {
  intro:
    'Um chatbot com IA resolve a maior parte das conversas, mas existe um momento em que insistir custa CSAT e dinheiro. O handoff humano é o protocolo que decide quando o bot para de tentar e passa a conversa para um atendente, sem que o cliente precise repetir nada. Este artigo descreve um modelo operacional prático: gatilhos de transferência, a máquina de estados do atendimento, como preservar contexto no momento do handoff e quais métricas provam que o desenho está certo.',
  sections: [
    {
      title: 'Gatilhos de handoff: quando transferir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro clássico é transferir cedo demais (o humano vira datilógrafo do bot) ou tarde demais (o cliente já está irritado). O handoff precisa de gatilhos objetivos, avaliados a cada turno da conversa. Os cinco gatilhos abaixo cobrem a maioria dos casos em produção:',
        },
        {
          type: 'list',
          items: [
            'Baixa confiança do modelo: o score da intenção classificada (ou a confiança do RAG) cai abaixo de um limiar definido, por exemplo 0,6. O bot não deve chutar.',
            'Intenção sensível: cancelamento, reclamação formal, cobrança, fraude, questão jurídica ou qualquer tema com risco reputacional ou financeiro entra direto na fila humana.',
            'Pedido explícito: o cliente digita "quero falar com atendente", "atendimento humano" ou variações. Sempre respeitar, sem fricção nem segunda pergunta.',
            'Loop detectado: o bot repete a mesma resposta ou pergunta dois turnos seguidos, sinal de que não está entendendo. Transferir antes de irritar.',
            'N tentativas sem resolução: após N turnos (tipicamente 3) sem fechar a intenção ou sem progresso mensurável, escalar em vez de continuar tentando.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Cada gatilho deve ser logado com o motivo da transferência. Isso alimenta as métricas e mostra onde o bot precisa de mais conhecimento ou de novos fluxos.',
        },
      ],
    },
    {
      title: 'Máquina de estados do atendimento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Modelar o atendimento como uma máquina de estados explícita evita ambiguidade sobre quem está no controle da conversa em cada instante. São quatro estados principais e transições bem definidas entre eles.',
        },
        {
          type: 'diagram',
          value: `[BOT] --gatilho de handoff--> [FILA HUMANA]
   ^                                  |
   |                            atendente assume
   |                                  v
[RETORNO AO BOT] <--resolvido/auto--- [HUMANO]
   |                                  |
   |                            cliente responde
   +----------------------------------+

Estados:
  BOT           conversa automatizada (IA + fluxos)
  FILA HUMANA   aguardando atendente disponível
  HUMANO        atendente conduz a conversa
  RETORNO AO BOT volta ao automático após resolução`,
        },
        {
          type: 'paragraph',
          value:
            'Pontos de atenção nas transições: enquanto a conversa está em FILA HUMANA, o bot deve avisar o cliente sobre a espera e não responder por cima do atendente. Ao entrar em HUMANO, o bot fica em modo silencioso. O RETORNO AO BOT acontece quando o atendente marca a conversa como resolvida ou após timeout de inatividade, devolvendo o controle ao automático para pesquisas de satisfação ou novas perguntas.',
        },
      ],
    },
    {
      title: 'Preservação de contexto no handoff',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A promessa do handoff é simples: o cliente não repete nada. Para cumprir isso, o atendente recebe um pacote de contexto montado no momento da transferência, com três camadas: um resumo gerado pela IA, o histórico bruto e as variáveis estruturadas da conversa.',
        },
        {
          type: 'list',
          items: [
            'Resumo da IA: dois ou três parágrafos curtos com o que o cliente quer, o que já foi tentado e qual o próximo passo sugerido. Reduz o tempo de leitura do atendente.',
            'Histórico: as últimas mensagens trocadas, para o atendente conferir o tom e detalhes que o resumo não captura.',
            'Variáveis: dados estruturados já coletados (pedido, CPF, plano, canal de origem) e o motivo do handoff, para o atendente não perguntar de novo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Esse pacote chega ao desk do atendente (CRM, helpdesk ou inbox) junto com a conversa. Exemplo do payload de contexto entregue:',
        },
        {
          type: 'code',
          value: `{
  "conversation_id": "wa_5511998877665_1718",
  "handoff": {
    "trigger": "intencao_sensivel",
    "reason": "cliente pediu cancelamento de plano",
    "model_confidence": 0.42,
    "attempts": 2,
    "queued_at": "2026-02-23T14:31:09Z"
  },
  "customer": {
    "phone": "+55 11 99887-7665",
    "name": "Ana Ribeiro",
    "locale": "pt-BR"
  },
  "ai_summary": "Cliente quer cancelar o plano Pro por achar caro. Bot ofereceu desconto de retenção, ela recusou. Próximo passo: avaliar retenção ou processar cancelamento conforme política.",
  "variables": {
    "plano": "Pro",
    "valor_mensal": "R$ 149,90",
    "ciclo": "anual",
    "ultimo_pagamento": "2026-02-05",
    "cliente_desde": "2024-08-12"
  },
  "history": [
    { "role": "user", "text": "quero cancelar minha assinatura" },
    { "role": "bot", "text": "Posso te oferecer 30% de desconto nos próximos 3 meses. Aceita?" },
    { "role": "user", "text": "não, quero falar com alguém" }
  ]
}`,
        },
      ],
    },
    {
      title: 'Gatilho por ação: o que o sistema faz',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cada gatilho mapeia para uma ação determinista. A tabela abaixo serve de referência para configurar o roteamento e evitar decisões ad hoc no código.',
        },
        {
          type: 'table',
          columns: ['Gatilho', 'Ação', 'Prioridade na fila'],
          rows: [
            ['Baixa confiança do modelo', 'Enviar para fila humana com resumo e flag de revisão', 'Média'],
            ['Intenção sensível', 'Rotear para fila especializada (retenção, financeiro)', 'Alta'],
            ['Pedido explícito', 'Transferir imediatamente, sem nova pergunta', 'Alta'],
            ['Loop detectado', 'Encerrar tentativa do bot e escalar', 'Média'],
            ['N tentativas sem resolução', 'Escalar com histórico completo', 'Média'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A coluna de prioridade alimenta a fila: pedidos explícitos e intenções sensíveis furam a fila normal, porque a tolerância do cliente nesses casos é menor.',
        },
      ],
    },
    {
      title: 'Fila e roteamento para o atendente certo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Transferir para um humano não basta: precisa ser o humano certo. O roteamento usa o motivo do handoff e as variáveis da conversa para escolher a fila e o agente.',
        },
        {
          type: 'ordered',
          items: [
            'Classificar a conversa por skill necessária (financeiro, suporte técnico, retenção, comercial).',
            'Verificar disponibilidade e carga atual dos atendentes daquela skill.',
            'Aplicar prioridade do gatilho para ordenar quem é atendido primeiro.',
            'Atribuir ao atendente e entregar o pacote de contexto antes do primeiro "olá".',
            'Se ninguém estiver disponível dentro do SLA, oferecer agendamento ou retorno assíncrono.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Sem esse passo de roteamento, o handoff vira uma fila única genérica e o tempo até o humano dispara nos horários de pico.',
        },
      ],
    },
    {
      title: 'Métricas que provam que o handoff funciona',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Três métricas dizem se o modelo de handoff está calibrado. Acompanhe todas juntas, porque otimizar uma sozinha distorce as outras.',
        },
        {
          type: 'list',
          items: [
            'Taxa de handoff: percentual de conversas transferidas para humano. Muito alta indica bot fraco; muito baixa pode indicar transferência tardia e clientes presos no automático.',
            'Tempo até humano: do gatilho até o atendente assumir. É o indicador mais sensível de satisfação quando o cliente já pediu ajuda.',
            'CSAT pos-handoff: satisfação medida após conversas que passaram por atendente. Separe do CSAT geral para enxergar a qualidade específica da transferência.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Segmente cada métrica por gatilho. Se o CSAT pos-handoff cai sobretudo nas transferências por "N tentativas", o sinal é que o bot está segurando a conversa tempo demais antes de escalar, e o limiar de N precisa baixar.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'O bot deve avisar o cliente que vai transferir para um humano?',
      answer:
        'Sim. Uma mensagem curta confirmando a transferência e dando uma expectativa de espera reduz a ansiedade e evita que o cliente repita a mensagem achando que não foi lido.',
    },
    {
      question: 'Como evitar que o cliente repita informações após o handoff?',
      answer:
        'Entregando ao atendente o pacote de contexto (resumo da IA, histórico e variáveis) no mesmo instante da transferência. O atendente abre a conversa já sabendo o que aconteceu e qual o próximo passo.',
    },
    {
      question: 'Qual deve ser o limiar de confianca para acionar o handoff?',
      answer:
        'Não existe número universal. Comece em torno de 0,6, observe a taxa de handoff e o CSAT pos-handoff e ajuste. Intenções sensíveis devem transferir independente do score.',
    },
  ],
  conclusion: {
    title: 'Handoff bem desenhado é o que separa um bom atendimento de um frustrante',
    description:
      'Gatilhos objetivos, uma máquina de estados clara e um pacote de contexto completo fazem a transição do bot para o humano parecer natural. Medir taxa de handoff, tempo até humano e CSAT pos-handoff mantém o modelo calibrado ao longo do tempo.',
    cta: 'Quer desenhar o handoff do seu atendimento no WhatsApp? Vamos conversar.',
  },
  related: [
    { label: 'Chatbots e IA para atendimento', to: '/servicos/chatbots-e-ia' },
    { label: 'SLAs entre bot e humano no atendimento', to: '/blog/slas-atendimento-bot-humano' },
    { label: 'RAG no atendimento WhatsApp em produção', to: '/blog/rag-atendimento-whatsapp-producao' },
  ],
};

const en = {
  intro:
    'An AI chatbot resolves most conversations, but there is a moment when insisting costs CSAT and money. Human handoff is the protocol that decides when the bot stops trying and passes the conversation to an agent, without making the customer repeat anything. This article describes a practical operating model: handoff triggers, the support state machine, how to preserve context at the moment of handoff and which metrics prove the design is right.',
  sections: [
    {
      title: 'Handoff triggers: when to transfer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The classic mistake is transferring too early (the human becomes the bot typist) or too late (the customer is already upset). Handoff needs objective triggers, evaluated on every turn of the conversation. The five triggers below cover most production cases:',
        },
        {
          type: 'list',
          items: [
            'Low model confidence: the score of the classified intent (or the RAG confidence) drops below a defined threshold, for example 0.6. The bot should not guess.',
            'Sensitive intent: cancellation, formal complaint, billing, fraud, legal matters or any topic with reputational or financial risk goes straight to the human queue.',
            'Explicit request: the customer types "I want to talk to an agent", "human support" or variations. Always honor it, with no friction and no second question.',
            'Loop detected: the bot repeats the same answer or question two turns in a row, a sign it is not understanding. Transfer before frustration builds.',
            'N attempts without resolution: after N turns (typically 3) without closing the intent or making measurable progress, escalate instead of continuing to try.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Every trigger should be logged with the reason for the transfer. This feeds the metrics and shows where the bot needs more knowledge or new flows.',
        },
      ],
    },
    {
      title: 'The support state machine',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Modeling support as an explicit state machine removes ambiguity about who controls the conversation at any moment. There are four main states and well-defined transitions between them.',
        },
        {
          type: 'diagram',
          value: `[BOT] --handoff trigger--> [HUMAN QUEUE]
   ^                                  |
   |                            agent takes over
   |                                  v
[BACK TO BOT] <--resolved/auto------- [HUMAN]
   |                                  |
   |                            customer replies
   +----------------------------------+

States:
  BOT          automated conversation (AI + flows)
  HUMAN QUEUE  waiting for an available agent
  HUMAN        agent drives the conversation
  BACK TO BOT  return to automation after resolution`,
        },
        {
          type: 'paragraph',
          value:
            'Watch the transitions: while the conversation is in HUMAN QUEUE, the bot should inform the customer about the wait and never answer over the agent. On entering HUMAN, the bot goes silent. BACK TO BOT happens when the agent marks the conversation as resolved or after an inactivity timeout, returning control to automation for satisfaction surveys or new questions.',
        },
      ],
    },
    {
      title: 'Preserving context during handoff',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The handoff promise is simple: the customer repeats nothing. To deliver it, the agent receives a context package assembled at the moment of transfer, with three layers: an AI-generated summary, the raw history and the structured conversation variables.',
        },
        {
          type: 'list',
          items: [
            'AI summary: two or three short paragraphs with what the customer wants, what has been tried and the suggested next step. It cuts the agent reading time.',
            'History: the last messages exchanged, so the agent can check the tone and details the summary does not capture.',
            'Variables: structured data already collected (order, ID, plan, source channel) and the handoff reason, so the agent does not ask again.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'This package reaches the agent desk (CRM, helpdesk or inbox) along with the conversation. Example of the context payload delivered:',
        },
        {
          type: 'code',
          value: `{
  "conversation_id": "wa_5511998877665_1718",
  "handoff": {
    "trigger": "sensitive_intent",
    "reason": "customer requested plan cancellation",
    "model_confidence": 0.42,
    "attempts": 2,
    "queued_at": "2026-02-23T14:31:09Z"
  },
  "customer": {
    "phone": "+55 11 99887-7665",
    "name": "Ana Ribeiro",
    "locale": "pt-BR"
  },
  "ai_summary": "Customer wants to cancel the Pro plan because she finds it expensive. Bot offered a retention discount, she declined. Next step: evaluate retention or process cancellation per policy.",
  "variables": {
    "plan": "Pro",
    "monthly_value": "R$ 149.90",
    "cycle": "annual",
    "last_payment": "2026-02-05",
    "customer_since": "2024-08-12"
  },
  "history": [
    { "role": "user", "text": "I want to cancel my subscription" },
    { "role": "bot", "text": "I can offer you 30% off for the next 3 months. Do you accept?" },
    { "role": "user", "text": "no, I want to talk to someone" }
  ]
}`,
        },
      ],
    },
    {
      title: 'Trigger to action: what the system does',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Each trigger maps to a deterministic action. The table below is a reference for configuring routing and avoiding ad hoc decisions in code.',
        },
        {
          type: 'table',
          columns: ['Trigger', 'Action', 'Queue priority'],
          rows: [
            ['Low model confidence', 'Send to human queue with summary and review flag', 'Medium'],
            ['Sensitive intent', 'Route to specialized queue (retention, billing)', 'High'],
            ['Explicit request', 'Transfer immediately, with no new question', 'High'],
            ['Loop detected', 'End the bot attempt and escalate', 'Medium'],
            ['N attempts without resolution', 'Escalate with full history', 'Medium'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The priority column feeds the queue: explicit requests and sensitive intents skip the normal line, because customer tolerance is lower in those cases.',
        },
      ],
    },
    {
      title: 'Queue and routing to the right agent',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Transferring to a human is not enough: it has to be the right human. Routing uses the handoff reason and the conversation variables to choose the queue and the agent.',
        },
        {
          type: 'ordered',
          items: [
            'Classify the conversation by required skill (billing, technical support, retention, sales).',
            'Check availability and current load of agents with that skill.',
            'Apply the trigger priority to order who is served first.',
            'Assign to the agent and deliver the context package before the first "hello".',
            'If no one is available within the SLA, offer scheduling or an asynchronous callback.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Without this routing step, handoff becomes a single generic queue and time to human spikes during peak hours.',
        },
      ],
    },
    {
      title: 'Metrics that prove handoff works',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Three metrics tell whether the handoff model is calibrated. Track them together, because optimizing one alone distorts the others.',
        },
        {
          type: 'list',
          items: [
            'Handoff rate: percentage of conversations transferred to a human. Too high signals a weak bot; too low may signal late transfer and customers stuck in automation.',
            'Time to human: from the trigger until the agent takes over. It is the most sensitive satisfaction indicator once the customer has already asked for help.',
            'Post-handoff CSAT: satisfaction measured after conversations that went through an agent. Keep it separate from overall CSAT to see the specific quality of the transfer.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Segment each metric by trigger. If post-handoff CSAT drops mostly on "N attempts" transfers, the signal is that the bot is holding the conversation too long before escalating, and the N threshold needs to come down.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Should the bot tell the customer it will transfer to a human?',
      answer:
        'Yes. A short message confirming the transfer and setting a wait expectation reduces anxiety and prevents the customer from repeating the message thinking it was not read.',
    },
    {
      question: 'How do you avoid the customer repeating information after handoff?',
      answer:
        'By delivering the context package (AI summary, history and variables) to the agent at the very moment of transfer. The agent opens the conversation already knowing what happened and the next step.',
    },
    {
      question: 'What confidence threshold should trigger handoff?',
      answer:
        'There is no universal number. Start around 0.6, watch the handoff rate and post-handoff CSAT, and adjust. Sensitive intents should transfer regardless of the score.',
    },
  ],
  conclusion: {
    title: 'A well-designed handoff is what separates good support from a frustrating one',
    description:
      'Objective triggers, a clear state machine and a complete context package make the bot-to-human transition feel natural. Measuring handoff rate, time to human and post-handoff CSAT keeps the model calibrated over time.',
    cta: 'Want to design the handoff for your WhatsApp support? Let us talk.',
  },
  related: [
    { label: 'Chatbots and AI for support', to: '/servicos/chatbots-e-ia' },
    { label: 'SLAs between bot and human in support', to: '/blog/slas-atendimento-bot-humano' },
    { label: 'RAG for WhatsApp support in production', to: '/blog/rag-atendimento-whatsapp-producao' },
  ],
};

const es = {
  intro:
    'Un chatbot con IA resuelve la mayoría de las conversaciones, pero hay un momento en que insistir cuesta CSAT y dinero. El handoff humano es el protocolo que decide cuándo el bot deja de intentar y pasa la conversación a un agente, sin que el cliente tenga que repetir nada. Este artículo describe un modelo operativo práctico: disparadores de transferencia, la máquina de estados de la atención, cómo preservar el contexto en el momento del handoff y qué métricas demuestran que el diseño es correcto.',
  sections: [
    {
      title: 'Disparadores de handoff: cuándo transferir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error clásico es transferir demasiado pronto (el humano se vuelve el mecanógrafo del bot) o demasiado tarde (el cliente ya está molesto). El handoff necesita disparadores objetivos, evaluados en cada turno de la conversación. Los cinco disparadores siguientes cubren la mayoría de los casos en producción:',
        },
        {
          type: 'list',
          items: [
            'Baja confianza del modelo: el score de la intención clasificada (o la confianza del RAG) cae por debajo de un umbral definido, por ejemplo 0,6. El bot no debe adivinar.',
            'Intención sensible: cancelación, reclamo formal, cobro, fraude, asunto jurídico o cualquier tema con riesgo reputacional o financiero entra directo a la fila humana.',
            'Solicitud explícita: el cliente escribe "quiero hablar con un agente", "atención humana" o variaciones. Siempre respetarlo, sin fricción ni segunda pregunta.',
            'Bucle detectado: el bot repite la misma respuesta o pregunta dos turnos seguidos, señal de que no está entendiendo. Transferir antes de irritar.',
            'N intentos sin resolución: tras N turnos (típicamente 3) sin cerrar la intención o sin progreso medible, escalar en lugar de seguir intentando.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Cada disparador debe registrarse con el motivo de la transferencia. Esto alimenta las métricas y muestra dónde el bot necesita más conocimiento o nuevos flujos.',
        },
      ],
    },
    {
      title: 'La máquina de estados de la atención',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Modelar la atención como una máquina de estados explícita elimina la ambigüedad sobre quién controla la conversación en cada instante. Hay cuatro estados principales y transiciones bien definidas entre ellos.',
        },
        {
          type: 'diagram',
          value: `[BOT] --disparador de handoff--> [FILA HUMANA]
   ^                                    |
   |                            el agente asume
   |                                    v
[VUELTA AL BOT] <--resuelto/auto------- [HUMANO]
   |                                    |
   |                            el cliente responde
   +------------------------------------+

Estados:
  BOT           conversación automatizada (IA + flujos)
  FILA HUMANA   esperando un agente disponible
  HUMANO        el agente conduce la conversación
  VUELTA AL BOT regreso al automático tras la resolución`,
        },
        {
          type: 'paragraph',
          value:
            'Atención en las transiciones: mientras la conversación está en FILA HUMANA, el bot debe avisar al cliente sobre la espera y nunca responder por encima del agente. Al entrar en HUMANO, el bot queda en silencio. La VUELTA AL BOT ocurre cuando el agente marca la conversación como resuelta o tras un timeout de inactividad, devolviendo el control al automático para encuestas de satisfacción o nuevas preguntas.',
        },
      ],
    },
    {
      title: 'Preservación del contexto en el handoff',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La promesa del handoff es simple: el cliente no repite nada. Para cumplirla, el agente recibe un paquete de contexto armado en el momento de la transferencia, con tres capas: un resumen generado por la IA, el historial en bruto y las variables estructuradas de la conversación.',
        },
        {
          type: 'list',
          items: [
            'Resumen de la IA: dos o tres párrafos cortos con lo que el cliente quiere, lo que ya se intentó y el próximo paso sugerido. Reduce el tiempo de lectura del agente.',
            'Historial: los últimos mensajes intercambiados, para que el agente verifique el tono y detalles que el resumen no captura.',
            'Variables: datos estructurados ya recogidos (pedido, identificación, plan, canal de origen) y el motivo del handoff, para que el agente no pregunte de nuevo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Este paquete llega al escritorio del agente (CRM, helpdesk o bandeja) junto con la conversación. Ejemplo del payload de contexto entregado:',
        },
        {
          type: 'code',
          value: `{
  "conversation_id": "wa_5511998877665_1718",
  "handoff": {
    "trigger": "intencion_sensible",
    "reason": "el cliente pidió cancelar el plan",
    "model_confidence": 0.42,
    "attempts": 2,
    "queued_at": "2026-02-23T14:31:09Z"
  },
  "customer": {
    "phone": "+55 11 99887-7665",
    "name": "Ana Ribeiro",
    "locale": "pt-BR"
  },
  "ai_summary": "La cliente quiere cancelar el plan Pro porque lo considera caro. El bot ofreció un descuento de retención, ella lo rechazó. Próximo paso: evaluar retención o procesar la cancelación según la política.",
  "variables": {
    "plan": "Pro",
    "valor_mensual": "R$ 149,90",
    "ciclo": "anual",
    "ultimo_pago": "2026-02-05",
    "cliente_desde": "2024-08-12"
  },
  "history": [
    { "role": "user", "text": "quiero cancelar mi suscripción" },
    { "role": "bot", "text": "Puedo ofrecerte 30% de descuento por los próximos 3 meses. ¿Aceptas?" },
    { "role": "user", "text": "no, quiero hablar con alguien" }
  ]
}`,
        },
      ],
    },
    {
      title: 'Disparador por acción: qué hace el sistema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cada disparador mapea a una acción determinista. La tabla siguiente sirve de referencia para configurar el enrutamiento y evitar decisiones ad hoc en el código.',
        },
        {
          type: 'table',
          columns: ['Disparador', 'Acción', 'Prioridad en la fila'],
          rows: [
            ['Baja confianza del modelo', 'Enviar a fila humana con resumen y bandera de revisión', 'Media'],
            ['Intención sensible', 'Enrutar a fila especializada (retención, financiero)', 'Alta'],
            ['Solicitud explícita', 'Transferir de inmediato, sin nueva pregunta', 'Alta'],
            ['Bucle detectado', 'Terminar el intento del bot y escalar', 'Media'],
            ['N intentos sin resolución', 'Escalar con historial completo', 'Media'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La columna de prioridad alimenta la fila: las solicitudes explícitas y las intenciones sensibles se saltan la fila normal, porque la tolerancia del cliente en esos casos es menor.',
        },
      ],
    },
    {
      title: 'Fila y enrutamiento al agente correcto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Transferir a un humano no basta: tiene que ser el humano correcto. El enrutamiento usa el motivo del handoff y las variables de la conversación para elegir la fila y el agente.',
        },
        {
          type: 'ordered',
          items: [
            'Clasificar la conversación por habilidad necesaria (financiero, soporte técnico, retención, comercial).',
            'Verificar disponibilidad y carga actual de los agentes con esa habilidad.',
            'Aplicar la prioridad del disparador para ordenar a quién se atiende primero.',
            'Asignar al agente y entregar el paquete de contexto antes del primer "hola".',
            'Si nadie está disponible dentro del SLA, ofrecer agendamiento o devolución asíncrona.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Sin este paso de enrutamiento, el handoff se vuelve una fila única genérica y el tiempo hasta el humano se dispara en las horas pico.',
        },
      ],
    },
    {
      title: 'Métricas que demuestran que el handoff funciona',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Tres métricas dicen si el modelo de handoff está calibrado. Síguelas juntas, porque optimizar una sola distorsiona las demás.',
        },
        {
          type: 'list',
          items: [
            'Tasa de handoff: porcentaje de conversaciones transferidas a un humano. Muy alta indica un bot débil; muy baja puede indicar transferencia tardía y clientes atrapados en el automático.',
            'Tiempo hasta el humano: desde el disparador hasta que el agente asume. Es el indicador de satisfacción más sensible cuando el cliente ya pidió ayuda.',
            'CSAT post-handoff: satisfacción medida tras conversaciones que pasaron por un agente. Sepáralo del CSAT general para ver la calidad específica de la transferencia.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Segmenta cada métrica por disparador. Si el CSAT post-handoff cae sobre todo en las transferencias por "N intentos", la señal es que el bot retiene la conversación demasiado tiempo antes de escalar, y el umbral de N debe bajar.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿El bot debe avisar al cliente que va a transferir a un humano?',
      answer:
        'Sí. Un mensaje corto confirmando la transferencia y dando una expectativa de espera reduce la ansiedad y evita que el cliente repita el mensaje creyendo que no fue leído.',
    },
    {
      question: '¿Cómo evitar que el cliente repita información después del handoff?',
      answer:
        'Entregando al agente el paquete de contexto (resumen de la IA, historial y variables) en el mismo instante de la transferencia. El agente abre la conversación ya sabiendo qué pasó y cuál es el próximo paso.',
    },
    {
      question: '¿Cuál debe ser el umbral de confianza para activar el handoff?',
      answer:
        'No existe un número universal. Empieza alrededor de 0,6, observa la tasa de handoff y el CSAT post-handoff, y ajusta. Las intenciones sensibles deben transferir sin importar el score.',
    },
  ],
  conclusion: {
    title: 'Un handoff bien diseñado es lo que separa una buena atención de una frustrante',
    description:
      'Disparadores objetivos, una máquina de estados clara y un paquete de contexto completo hacen que la transición del bot al humano se sienta natural. Medir la tasa de handoff, el tiempo hasta el humano y el CSAT post-handoff mantiene el modelo calibrado en el tiempo.',
    cta: '¿Quieres diseñar el handoff de tu atención en WhatsApp? Hablemos.',
  },
  related: [
    { label: 'Chatbots e IA para atención', to: '/servicos/chatbots-e-ia' },
    { label: 'SLAs entre bot y humano en la atención', to: '/blog/slas-atendimento-bot-humano' },
    { label: 'RAG en la atención WhatsApp en producción', to: '/blog/rag-atendimento-whatsapp-producao' },
  ],
};

export default { pt, en, es };
