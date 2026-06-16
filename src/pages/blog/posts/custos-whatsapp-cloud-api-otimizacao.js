// Conteudo do artigo: custos-whatsapp-cloud-api-otimizacao
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections, faq, conclusion, related }

const pt = {
  intro:
    'A WhatsApp Cloud API nao cobra por mensagem, ela cobra por conversa. Esse detalhe muda completamente como voce deve pensar custo. Quem raciocina em "preco por mensagem" tende a otimizar a coisa errada e acaba pagando por conversas abertas sem necessidade, templates de marketing mal segmentados e janelas reabertas a toa. Este artigo aplica logica de FinOps ao canal: entender o modelo de cobranca por conversa, mapear onde o dinheiro vaza, aplicar estrategias concretas de otimizacao e, no fim, medir custo por jornada resolvida em vez de custo por mensagem.',
  sections: [
    {
      title: 'O modelo de cobranca por conversa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O WhatsApp adota conversation-based pricing. A unidade de cobranca nao e a mensagem individual, mas a conversa: uma janela de 24 horas que se abre quando a primeira mensagem de uma categoria e entregue. Dentro dessa janela voce pode trocar quantas mensagens quiser pelo mesmo custo da conversa. A cobranca acontece por categoria, e cada categoria tem sua propria regra de quando a conversa e tarifada.',
        },
        {
          type: 'paragraph',
          value:
            'Existem quatro categorias. Marketing cobre promocoes, ofertas e reengajamento. Utility cobre transacoes e atualizacoes ligadas a uma acao do usuario (confirmacao de pedido, aviso de entrega, fatura). Authentication cobre codigos de verificacao e OTP. Service cobre o atendimento dentro da janela aberta pelo proprio cliente, quando ele inicia a conversa.',
        },
        {
          type: 'table',
          columns: ['Categoria', 'Quem inicia', 'Uso tipico', 'Como reduzir custo'],
          rows: [
            [
              'Marketing',
              'Empresa (template)',
              'Promocoes, ofertas, reengajamento de base',
              'Segmentar bem e disparar so para quem tem chance real de converter',
            ],
            [
              'Utility',
              'Empresa (template)',
              'Confirmacoes, atualizacoes de pedido, faturas, lembretes',
              'Consolidar atualizacoes na mesma janela em vez de varias conversas',
            ],
            [
              'Authentication',
              'Empresa (template)',
              'Codigos OTP e verificacao de identidade',
              'Enviar so o necessario; evitar reenvios por timeout curto demais',
            ],
            [
              'Service',
              'Cliente',
              'Atendimento e suporte na janela de 24h aberta pelo cliente',
              'Aproveitar a janela gratuita ou de menor custo iniciada pelo usuario',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Os valores variam por pais e por categoria e a Meta os reajusta periodicamente, entao nao trabalhe com numeros fixos de cabeca. O que se mantem estavel e a estrutura: voce paga por conversa, por categoria, dentro de uma janela de 24 horas. Toda decisao de otimizacao se apoia nessa estrutura, nao em um preco congelado.',
        },
      ],
    },
    {
      title: 'Onde o dinheiro vaza',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de otimizar e preciso enxergar o desperdicio. Na pratica, o custo escapa por poucos pontos recorrentes, quase sempre ligados a abrir conversas que nao precisavam existir ou que nao geraram resultado.',
        },
        {
          type: 'list',
          items: [
            'Templates de marketing mal segmentados: disparar para a base inteira abre uma conversa cobrada por contato, mesmo nos contatos sem qualquer intencao de compra. O custo escala com o tamanho da lista, nao com a receita.',
            'Reabertura de janela desnecessaria: enviar uma mensagem proativa para um cliente que voltaria a falar sozinho, ou fragmentar avisos em varios disparos em vez de consolidar, abre conversas extras que poderiam ser uma so.',
            'Falta de resolucao no primeiro contato: quando o atendimento nao resolve e o assunto volta dias depois, cada retorno pode reabrir conversa e multiplicar o custo da mesma jornada.',
            'Categoria errada no template: classificar como marketing algo que seria utility (ou vice-versa) muda a regra de cobranca e pode encarecer mensagens que deveriam ser mais baratas.',
            'Ignorar a service window: responder via template pago quando o cliente acabou de escrever, em vez de usar a janela de service aberta por ele, paga por algo que poderia custar menos ou nada.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Repare que nenhum desses vazamentos e sobre o preco unitario. Todos sao sobre volume de conversas mal direcionadas. E ai que esta a alavanca de FinOps: reduzir conversas desperdicadas pesa muito mais do que negociar centavos por mensagem.',
        },
      ],
    },
    {
      title: 'Estrategias de otimizacao',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com o mapa do desperdicio em maos, as estrategias seguem uma ordem logica: primeiro evitar conversas desnecessarias, depois usar a janela mais barata disponivel, depois classificar certo e, por fim, resolver de uma vez.',
        },
        {
          type: 'ordered',
          items: [
            'Consolide mensagens dentro da janela de 24h. Uma vez aberta a conversa, todas as mensagens daquela categoria cabem nela pelo mesmo custo. Agrupe atualizacoes (pedido confirmado, em separacao, enviado) na mesma janela em vez de abrir uma conversa para cada evento.',
            'Use a service window gratuita ou mais barata quando o cliente inicia. Se o usuario acabou de escrever, voce esta dentro da janela de service iniciada por ele: responda nessa janela em vez de disparar um template pago. So recorra a template quando a janela ja fechou.',
            'Escolha a categoria certa do template. Uma confirmacao de pedido e utility, nao marketing. Classificar corretamente alinha a cobranca a regra mais favoravel daquele tipo de mensagem e evita que utilidades sejam tarifadas como promocao.',
            'Resolva no primeiro contato. Uma jornada resolvida de uma vez consome uma conversa; a mesma jornada arrastada por reaberturas consome varias. Invista em respostas completas, contexto preservado e handoff humano no momento certo para fechar o assunto antes que ele volte.',
            'Segmente o marketing por intencao, nao por tamanho de base. Disparar para quem demonstrou interesse converte mais e abre menos conversas vazias. Menos volume bem direcionado costuma render mais receita com menos custo do que envio em massa.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A logica comum a todas elas: cada conversa aberta deve ter um proposito que justifique o custo. Quando esse proposito existe e a conversa resolve, o gasto vira investimento; quando nao existe, vira vazamento.',
        },
      ],
    },
    {
      title: 'A formula do custo por jornada resolvida',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A metrica que importa nao e quanto custa uma conversa, e quanto custa resolver uma jornada do cliente. Uma jornada pode consumir mais de uma conversa (um aviso utility, depois um atendimento service, talvez um reengajamento). O custo real e a soma das conversas que aquela jornada precisou para chegar ao fim.',
        },
        {
          type: 'code',
          value: `// Custo por jornada resolvida (estrutura, nao precos fixos).
// Os precos por categoria mudam por regiao e sao reajustados pela Meta,
// entao trate-os como variaveis de entrada, nao como constantes.

const precoConversa = {
  marketing: 0,       // preencha com o valor vigente da sua regiao
  utility: 0,
  authentication: 0,
  service: 0,         // muitas vezes a mais barata ou gratuita
};

// Conversas abertas em uma jornada tipica, por categoria.
function custoDaJornada(conversasPorCategoria) {
  return Object.entries(conversasPorCategoria).reduce(
    (total, [categoria, qtd]) => total + qtd * precoConversa[categoria],
    0,
  );
}

// Custo por RESOLUCAO = custo total das conversas / jornadas resolvidas.
// Esta e a metrica de FinOps que voce deve acompanhar ao longo do tempo.
function custoPorResolucao(custoTotalConversas, jornadasResolvidas) {
  if (jornadasResolvidas === 0) return Infinity; // gasto sem resultado
  return custoTotalConversas / jornadasResolvidas;
}

// Exemplo de leitura:
// Mais conversas por jornada => custo por resolucao sobe.
// Mais resolucao no primeiro contato => custo por resolucao cai.`,
        },
        {
          type: 'diagram',
          value: `Jornada do cliente (1 problema a resolver)
        |
        v
+-------------------------------+
|  Conversas abertas na jornada |
|  utility   -> 1 conversa      |
|  service   -> 1 conversa      |
|  marketing -> 0..N conversas  |
+-------------------------------+
        |
        |  soma dos custos por categoria
        v
   Custo total da jornada
        |
        |  dividido por jornadas resolvidas
        v
+-------------------------------+
|   CUSTO POR RESOLUCAO         |  <-- metrica que importa
+-------------------------------+
   menos conversas por jornada  => mais barato
   mais resolucao 1o contato    => mais barato`,
        },
        {
          type: 'paragraph',
          value:
            'A formula deixa explicito o que melhora o numero: reduzir conversas por jornada e aumentar a taxa de resolucao. Cortar mensagens dentro de uma conversa ja aberta nao muda nada no custo, porque a conversa ja foi tarifada. Por isso otimizar mensagem a mensagem e quase sempre energia desperdicada.',
        },
      ],
    },
    {
      title: 'Meca custo por resolucao, nao por mensagem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro de FinOps mais comum nesse canal e olhar para o numero de mensagens enviadas. Como a cobranca e por conversa, a contagem de mensagens nao tem relacao direta com o gasto. Uma conversa com 2 mensagens custa o mesmo que uma com 20. Otimizar o numero de mensagens cria atrito no atendimento sem economizar nada.',
        },
        {
          type: 'paragraph',
          value:
            'A metrica certa e custo por resolucao: quanto voce gastou em conversas dividido pelas jornadas efetivamente resolvidas. Ela captura ao mesmo tempo o desperdicio (conversas que nao resolveram) e a eficiencia (resolver com menos conversas). Acompanhe-a por categoria e por fluxo para descobrir onde o custo por resultado esta alto.',
        },
        {
          type: 'table',
          columns: ['Sinal observado', 'Diagnostico provavel', 'Acao'],
          rows: [
            [
              'Muitas conversas de marketing, poucas conversoes',
              'Segmentacao fraca; disparo por tamanho de base',
              'Segmentar por intencao e cortar envio em massa',
            ],
            [
              'Varias conversas utility por pedido',
              'Atualizacoes fragmentadas fora da janela de 24h',
              'Consolidar avisos na mesma conversa aberta',
            ],
            [
              'Custo por resolucao subindo com o tempo',
              'Baixa resolucao no primeiro contato; jornadas reabrem',
              'Melhorar respostas e handoff para fechar de uma vez',
            ],
            [
              'Templates pagos logo apos o cliente escrever',
              'Service window ignorada',
              'Responder na janela de service iniciada pelo usuario',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Quando o time passa a otimizar custo por resolucao, as decisoes mudam de natureza: em vez de cortar mensagens e degradar a experiencia, voce reduz conversas inuteis e resolve mais rapido. O resultado e custo menor com atendimento melhor, que e exatamente o que FinOps aplicado deveria entregar.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'O WhatsApp cobra por mensagem ou por conversa?',
      answer:
        'Por conversa. A Cloud API usa conversation-based pricing: uma janela de 24 horas que se abre quando a primeira mensagem de uma categoria e entregue, e dentro dela voce troca quantas mensagens quiser pelo mesmo custo. Por isso otimizar o numero de mensagens nao reduz a conta; o que reduz e abrir menos conversas e resolver mais dentro de cada uma.',
    },
    {
      question: 'Como uso a janela de service para gastar menos?',
      answer:
        'Quando o cliente inicia a conversa, abre-se uma janela de service de 24 horas. Enquanto ela estiver aberta, responda dentro dela em vez de disparar um template pago. So recorra a template (utility ou marketing, conforme o caso) quando essa janela ja tiver fechado e voce precisar reabrir o contato de forma proativa.',
    },
    {
      question: 'Por que nao falar em valores exatos de custo?',
      answer:
        'Porque os precos por conversa variam por pais e por categoria e a Meta os reajusta periodicamente. Trabalhar com numeros fixos leva a decisoes erradas assim que a tabela muda. O que permanece estavel e a estrutura: cobranca por conversa, por categoria, em janela de 24h. Otimize sobre a estrutura e use os precos vigentes apenas como variaveis de entrada na conta.',
    },
  ],
  conclusion: {
    title: 'Custo controlado e questao de estrutura, nao de cortar mensagens',
    description:
      'Entender a cobranca por conversa, fechar os vazamentos de conversas mal direcionadas e medir custo por resolucao em vez de por mensagem mantem o canal eficiente sem degradar a experiencia. Se voce quer enxergar onde o custo do seu WhatsApp esta vazando e como otimizar, posso ajudar nessa analise.',
    cta: 'Falar sobre meus custos de WhatsApp',
  },
  related: [
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'ROI real de automacao com IA', to: '/blog/roi-real-automacao-ia' },
    { label: 'Governanca de templates em times grandes', to: '/blog/governanca-templates-times-grandes' },
  ],
};

const en = {
  intro:
    'The WhatsApp Cloud API does not charge per message, it charges per conversation. That single detail changes how you should think about cost. Anyone reasoning in "price per message" tends to optimize the wrong thing and ends up paying for conversations opened with no need, poorly segmented marketing templates and windows reopened for nothing. This article applies FinOps thinking to the channel: understand the conversation-based pricing model, map where the money leaks, apply concrete optimization strategies and, in the end, measure cost per resolved journey instead of cost per message.',
  sections: [
    {
      title: 'The conversation-based pricing model',
      blocks: [
        {
          type: 'paragraph',
          value:
            'WhatsApp uses conversation-based pricing. The billing unit is not the individual message, but the conversation: a 24-hour window that opens when the first message of a category is delivered. Within that window you can exchange as many messages as you want for the same conversation cost. Billing happens per category, and each category has its own rule for when the conversation is charged.',
        },
        {
          type: 'paragraph',
          value:
            'There are four categories. Marketing covers promotions, offers and re-engagement. Utility covers transactions and updates tied to a user action (order confirmation, delivery notice, invoice). Authentication covers verification codes and OTPs. Service covers support inside the window opened by the customer, when they start the conversation.',
        },
        {
          type: 'table',
          columns: ['Category', 'Who starts', 'Typical use', 'How to reduce cost'],
          rows: [
            [
              'Marketing',
              'Business (template)',
              'Promotions, offers, base re-engagement',
              'Segment well and send only to those with real chance to convert',
            ],
            [
              'Utility',
              'Business (template)',
              'Confirmations, order updates, invoices, reminders',
              'Consolidate updates in the same window instead of many conversations',
            ],
            [
              'Authentication',
              'Business (template)',
              'OTP codes and identity verification',
              'Send only what is needed; avoid resends from a too-short timeout',
            ],
            [
              'Service',
              'Customer',
              'Support within the 24h window opened by the customer',
              'Use the free or cheaper window the user has started',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Prices vary by country and by category and Meta adjusts them periodically, so do not work with fixed numbers from memory. What stays stable is the structure: you pay per conversation, per category, within a 24-hour window. Every optimization decision rests on this structure, not on a frozen price.',
        },
      ],
    },
    {
      title: 'Where the money leaks',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before optimizing you need to see the waste. In practice, cost escapes through a few recurring points, almost always tied to opening conversations that did not need to exist or that produced no result.',
        },
        {
          type: 'list',
          items: [
            'Poorly segmented marketing templates: blasting the whole base opens a billed conversation per contact, even for contacts with zero buying intent. Cost scales with list size, not with revenue.',
            'Unnecessary window reopening: sending a proactive message to a customer who would come back on their own, or splitting notices into several sends instead of consolidating, opens extra conversations that could have been one.',
            'No first-contact resolution: when support does not resolve and the topic comes back days later, each return can reopen a conversation and multiply the cost of the same journey.',
            'Wrong template category: classifying as marketing something that should be utility (or vice versa) changes the billing rule and can make messages more expensive than they should be.',
            'Ignoring the service window: replying via a paid template when the customer has just written, instead of using the service window they opened, pays for something that could cost less or nothing.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Note that none of these leaks is about unit price. They are all about the volume of misdirected conversations. That is where the FinOps lever sits: cutting wasted conversations matters far more than negotiating cents per message.',
        },
      ],
    },
    {
      title: 'Optimization strategies',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the waste map in hand, the strategies follow a logical order: first avoid unnecessary conversations, then use the cheapest available window, then classify correctly and, finally, resolve in one go.',
        },
        {
          type: 'ordered',
          items: [
            'Consolidate messages within the 24h window. Once a conversation is open, every message of that category fits in it for the same cost. Group updates (order confirmed, picking, shipped) in the same window instead of opening a conversation for each event.',
            'Use the free or cheaper service window when the customer starts. If the user has just written, you are inside the service window they opened: reply within it instead of sending a paid template. Only fall back to a template once the window has closed.',
            'Choose the right template category. An order confirmation is utility, not marketing. Classifying correctly aligns billing with the most favorable rule for that message type and keeps utilities from being charged as promotions.',
            'Resolve on first contact. A journey resolved in one go consumes one conversation; the same journey dragged through reopenings consumes several. Invest in complete answers, preserved context and human handoff at the right moment to close the topic before it returns.',
            'Segment marketing by intent, not by base size. Sending to those who showed interest converts more and opens fewer empty conversations. Less, well-targeted volume usually yields more revenue at lower cost than mass blasts.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The logic common to all of them: every conversation opened should have a purpose that justifies the cost. When that purpose exists and the conversation resolves, the spend becomes an investment; when it does not, it becomes a leak.',
        },
      ],
    },
    {
      title: 'The cost-per-resolved-journey formula',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The metric that matters is not how much a conversation costs, it is how much it costs to resolve a customer journey. A journey may consume more than one conversation (a utility notice, then a service interaction, maybe a re-engagement). The real cost is the sum of the conversations that journey needed to reach the end.',
        },
        {
          type: 'code',
          value: `// Cost per resolved journey (structure, not fixed prices).
// Per-category prices change by region and are adjusted by Meta,
// so treat them as input variables, not constants.

const conversationPrice = {
  marketing: 0,       // fill in with your region's current value
  utility: 0,
  authentication: 0,
  service: 0,         // often the cheapest or free
};

// Conversations opened in a typical journey, by category.
function journeyCost(conversationsByCategory) {
  return Object.entries(conversationsByCategory).reduce(
    (total, [category, count]) => total + count * conversationPrice[category],
    0,
  );
}

// Cost per RESOLUTION = total conversation cost / resolved journeys.
// This is the FinOps metric you should track over time.
function costPerResolution(totalConversationCost, resolvedJourneys) {
  if (resolvedJourneys === 0) return Infinity; // spend with no result
  return totalConversationCost / resolvedJourneys;
}

// How to read it:
// More conversations per journey => cost per resolution goes up.
// More first-contact resolution => cost per resolution goes down.`,
        },
        {
          type: 'diagram',
          value: `Customer journey (1 problem to solve)
        |
        v
+-------------------------------+
|  Conversations in the journey |
|  utility   -> 1 conversation  |
|  service   -> 1 conversation  |
|  marketing -> 0..N conversations|
+-------------------------------+
        |
        |  sum of costs per category
        v
   Total journey cost
        |
        |  divided by resolved journeys
        v
+-------------------------------+
|   COST PER RESOLUTION         |  <-- the metric that matters
+-------------------------------+
   fewer conversations/journey  => cheaper
   more first-contact resolution=> cheaper`,
        },
        {
          type: 'paragraph',
          value:
            'The formula makes explicit what improves the number: fewer conversations per journey and a higher resolution rate. Cutting messages inside an already-open conversation changes nothing in cost, because the conversation was already charged. That is why optimizing message by message is almost always wasted energy.',
        },
      ],
    },
    {
      title: 'Measure cost per resolution, not per message',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common FinOps mistake on this channel is to look at the number of messages sent. Since billing is per conversation, message count has no direct relation to spend. A conversation with 2 messages costs the same as one with 20. Optimizing message count creates friction in support while saving nothing.',
        },
        {
          type: 'paragraph',
          value:
            'The right metric is cost per resolution: how much you spent on conversations divided by the journeys actually resolved. It captures both the waste (conversations that did not resolve) and the efficiency (resolving with fewer conversations). Track it per category and per flow to find where cost per outcome is high.',
        },
        {
          type: 'table',
          columns: ['Observed signal', 'Likely diagnosis', 'Action'],
          rows: [
            [
              'Many marketing conversations, few conversions',
              'Weak segmentation; sending by base size',
              'Segment by intent and cut mass blasts',
            ],
            [
              'Several utility conversations per order',
              'Fragmented updates outside the 24h window',
              'Consolidate notices in the same open conversation',
            ],
            [
              'Cost per resolution rising over time',
              'Low first-contact resolution; journeys reopen',
              'Improve answers and handoff to close in one go',
            ],
            [
              'Paid templates right after the customer writes',
              'Service window ignored',
              'Reply within the service window the user started',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'When the team starts optimizing cost per resolution, decisions change in nature: instead of cutting messages and degrading the experience, you reduce useless conversations and resolve faster. The result is lower cost with better service, which is exactly what applied FinOps should deliver.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does WhatsApp charge per message or per conversation?',
      answer:
        'Per conversation. The Cloud API uses conversation-based pricing: a 24-hour window that opens when the first message of a category is delivered, and within it you exchange as many messages as you want for the same cost. That is why optimizing message count does not lower the bill; what lowers it is opening fewer conversations and resolving more within each one.',
    },
    {
      question: 'How do I use the service window to spend less?',
      answer:
        'When the customer starts the conversation, a 24-hour service window opens. While it is open, reply within it instead of sending a paid template. Only fall back to a template (utility or marketing, as the case may be) once that window has closed and you need to reopen contact proactively.',
    },
    {
      question: 'Why not state exact cost figures?',
      answer:
        'Because per-conversation prices vary by country and category and Meta adjusts them periodically. Working with fixed numbers leads to wrong decisions as soon as the table changes. What stays stable is the structure: billing per conversation, per category, in a 24h window. Optimize on the structure and use current prices only as input variables in the calculation.',
    },
  ],
  conclusion: {
    title: 'Controlled cost is a matter of structure, not cutting messages',
    description:
      'Understanding conversation-based billing, closing the leaks of misdirected conversations and measuring cost per resolution instead of per message keeps the channel efficient without degrading the experience. If you want to see where your WhatsApp cost is leaking and how to optimize, I can help with that analysis.',
    cta: 'Talk about my WhatsApp costs',
  },
  related: [
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'Real ROI of AI automation', to: '/blog/roi-real-automacao-ia' },
    { label: 'Template governance in large teams', to: '/blog/governanca-templates-times-grandes' },
  ],
};

const es = {
  intro:
    'La WhatsApp Cloud API no cobra por mensaje, cobra por conversacion. Ese unico detalle cambia por completo como debes pensar el costo. Quien razona en "precio por mensaje" tiende a optimizar lo equivocado y termina pagando por conversaciones abiertas sin necesidad, plantillas de marketing mal segmentadas y ventanas reabiertas sin motivo. Este articulo aplica logica de FinOps al canal: entender el modelo de cobro por conversacion, mapear donde se fuga el dinero, aplicar estrategias concretas de optimizacion y, al final, medir costo por jornada resuelta en lugar de costo por mensaje.',
  sections: [
    {
      title: 'El modelo de cobro por conversacion',
      blocks: [
        {
          type: 'paragraph',
          value:
            'WhatsApp usa conversation-based pricing. La unidad de cobro no es el mensaje individual, sino la conversacion: una ventana de 24 horas que se abre cuando se entrega el primer mensaje de una categoria. Dentro de esa ventana puedes intercambiar tantos mensajes como quieras por el mismo costo de la conversacion. El cobro ocurre por categoria, y cada categoria tiene su propia regla de cuando se tarifa la conversacion.',
        },
        {
          type: 'paragraph',
          value:
            'Existen cuatro categorias. Marketing cubre promociones, ofertas y reenganche. Utility cubre transacciones y actualizaciones ligadas a una accion del usuario (confirmacion de pedido, aviso de entrega, factura). Authentication cubre codigos de verificacion y OTP. Service cubre la atencion dentro de la ventana que abre el propio cliente, cuando el inicia la conversacion.',
        },
        {
          type: 'table',
          columns: ['Categoria', 'Quien inicia', 'Uso tipico', 'Como reducir costo'],
          rows: [
            [
              'Marketing',
              'Empresa (plantilla)',
              'Promociones, ofertas, reenganche de base',
              'Segmentar bien y enviar solo a quien tiene chance real de convertir',
            ],
            [
              'Utility',
              'Empresa (plantilla)',
              'Confirmaciones, actualizaciones de pedido, facturas, recordatorios',
              'Consolidar actualizaciones en la misma ventana en vez de varias conversaciones',
            ],
            [
              'Authentication',
              'Empresa (plantilla)',
              'Codigos OTP y verificacion de identidad',
              'Enviar solo lo necesario; evitar reenvios por timeout demasiado corto',
            ],
            [
              'Service',
              'Cliente',
              'Atencion y soporte en la ventana de 24h abierta por el cliente',
              'Aprovechar la ventana gratuita o de menor costo iniciada por el usuario',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Los valores varian por pais y por categoria y Meta los reajusta periodicamente, asi que no trabajes con numeros fijos de memoria. Lo que se mantiene estable es la estructura: pagas por conversacion, por categoria, dentro de una ventana de 24 horas. Toda decision de optimizacion se apoya en esa estructura, no en un precio congelado.',
        },
      ],
    },
    {
      title: 'Donde se fuga el dinero',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de optimizar hay que ver el desperdicio. En la practica, el costo se escapa por pocos puntos recurrentes, casi siempre ligados a abrir conversaciones que no necesitaban existir o que no generaron resultado.',
        },
        {
          type: 'list',
          items: [
            'Plantillas de marketing mal segmentadas: disparar a toda la base abre una conversacion cobrada por contacto, incluso en contactos sin ninguna intencion de compra. El costo escala con el tamano de la lista, no con los ingresos.',
            'Reapertura de ventana innecesaria: enviar un mensaje proactivo a un cliente que volveria a escribir solo, o fragmentar avisos en varios envios en vez de consolidar, abre conversaciones extra que podrian ser una sola.',
            'Falta de resolucion en el primer contacto: cuando la atencion no resuelve y el tema vuelve dias despues, cada retorno puede reabrir conversacion y multiplicar el costo de la misma jornada.',
            'Categoria equivocada en la plantilla: clasificar como marketing algo que seria utility (o viceversa) cambia la regla de cobro y puede encarecer mensajes que deberian ser mas baratos.',
            'Ignorar la service window: responder con una plantilla paga cuando el cliente acaba de escribir, en vez de usar la ventana de service que el abrio, paga por algo que podria costar menos o nada.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Fijate en que ninguna de estas fugas es sobre el precio unitario. Todas son sobre el volumen de conversaciones mal dirigidas. Ahi esta la palanca de FinOps: reducir conversaciones desperdiciadas pesa mucho mas que negociar centavos por mensaje.',
        },
      ],
    },
    {
      title: 'Estrategias de optimizacion',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con el mapa del desperdicio en mano, las estrategias siguen un orden logico: primero evitar conversaciones innecesarias, luego usar la ventana mas barata disponible, luego clasificar bien y, por ultimo, resolver de una vez.',
        },
        {
          type: 'ordered',
          items: [
            'Consolida mensajes dentro de la ventana de 24h. Una vez abierta la conversacion, todos los mensajes de esa categoria caben en ella por el mismo costo. Agrupa actualizaciones (pedido confirmado, en preparacion, enviado) en la misma ventana en vez de abrir una conversacion por cada evento.',
            'Usa la service window gratuita o mas barata cuando el cliente inicia. Si el usuario acaba de escribir, estas dentro de la ventana de service que el abrio: responde en esa ventana en vez de disparar una plantilla paga. Solo recurre a plantilla cuando la ventana ya cerro.',
            'Elige la categoria correcta de la plantilla. Una confirmacion de pedido es utility, no marketing. Clasificar bien alinea el cobro con la regla mas favorable de ese tipo de mensaje y evita que las utilidades se tarifen como promocion.',
            'Resuelve en el primer contacto. Una jornada resuelta de una vez consume una conversacion; la misma jornada arrastrada por reaperturas consume varias. Invierte en respuestas completas, contexto preservado y handoff humano en el momento justo para cerrar el tema antes de que vuelva.',
            'Segmenta el marketing por intencion, no por tamano de base. Disparar a quien mostro interes convierte mas y abre menos conversaciones vacias. Menos volumen bien dirigido suele rendir mas ingresos con menos costo que el envio masivo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La logica comun a todas: cada conversacion abierta debe tener un proposito que justifique el costo. Cuando ese proposito existe y la conversacion resuelve, el gasto se vuelve inversion; cuando no existe, se vuelve fuga.',
        },
      ],
    },
    {
      title: 'La formula del costo por jornada resuelta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La metrica que importa no es cuanto cuesta una conversacion, es cuanto cuesta resolver una jornada del cliente. Una jornada puede consumir mas de una conversacion (un aviso utility, luego una atencion service, tal vez un reenganche). El costo real es la suma de las conversaciones que esa jornada necesito para llegar al final.',
        },
        {
          type: 'code',
          value: `// Costo por jornada resuelta (estructura, no precios fijos).
// Los precios por categoria cambian por region y los reajusta Meta,
// asi que tratalos como variables de entrada, no como constantes.

const precioConversacion = {
  marketing: 0,       // completa con el valor vigente de tu region
  utility: 0,
  authentication: 0,
  service: 0,         // muchas veces la mas barata o gratuita
};

// Conversaciones abiertas en una jornada tipica, por categoria.
function costoDeJornada(conversacionesPorCategoria) {
  return Object.entries(conversacionesPorCategoria).reduce(
    (total, [categoria, cant]) => total + cant * precioConversacion[categoria],
    0,
  );
}

// Costo por RESOLUCION = costo total de conversaciones / jornadas resueltas.
// Esta es la metrica de FinOps que debes seguir en el tiempo.
function costoPorResolucion(costoTotalConversaciones, jornadasResueltas) {
  if (jornadasResueltas === 0) return Infinity; // gasto sin resultado
  return costoTotalConversaciones / jornadasResueltas;
}

// Como leerlo:
// Mas conversaciones por jornada => costo por resolucion sube.
// Mas resolucion en el primer contacto => costo por resolucion baja.`,
        },
        {
          type: 'diagram',
          value: `Jornada del cliente (1 problema a resolver)
        |
        v
+-------------------------------+
|  Conversaciones en la jornada |
|  utility   -> 1 conversacion  |
|  service   -> 1 conversacion  |
|  marketing -> 0..N conversaciones|
+-------------------------------+
        |
        |  suma de costos por categoria
        v
   Costo total de la jornada
        |
        |  dividido por jornadas resueltas
        v
+-------------------------------+
|   COSTO POR RESOLUCION        |  <-- la metrica que importa
+-------------------------------+
   menos conversaciones/jornada => mas barato
   mas resolucion 1er contacto  => mas barato`,
        },
        {
          type: 'paragraph',
          value:
            'La formula deja explicito que mejora el numero: reducir conversaciones por jornada y aumentar la tasa de resolucion. Cortar mensajes dentro de una conversacion ya abierta no cambia nada en el costo, porque la conversacion ya fue tarifada. Por eso optimizar mensaje a mensaje es casi siempre energia desperdiciada.',
        },
      ],
    },
    {
      title: 'Mide costo por resolucion, no por mensaje',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error de FinOps mas comun en este canal es mirar el numero de mensajes enviados. Como el cobro es por conversacion, el conteo de mensajes no tiene relacion directa con el gasto. Una conversacion con 2 mensajes cuesta lo mismo que una con 20. Optimizar el numero de mensajes crea friccion en la atencion sin ahorrar nada.',
        },
        {
          type: 'paragraph',
          value:
            'La metrica correcta es costo por resolucion: cuanto gastaste en conversaciones dividido por las jornadas efectivamente resueltas. Captura a la vez el desperdicio (conversaciones que no resolvieron) y la eficiencia (resolver con menos conversaciones). Siguela por categoria y por flujo para descubrir donde el costo por resultado esta alto.',
        },
        {
          type: 'table',
          columns: ['Senal observada', 'Diagnostico probable', 'Accion'],
          rows: [
            [
              'Muchas conversaciones de marketing, pocas conversiones',
              'Segmentacion debil; envio por tamano de base',
              'Segmentar por intencion y cortar el envio masivo',
            ],
            [
              'Varias conversaciones utility por pedido',
              'Actualizaciones fragmentadas fuera de la ventana de 24h',
              'Consolidar avisos en la misma conversacion abierta',
            ],
            [
              'Costo por resolucion subiendo con el tiempo',
              'Baja resolucion en el primer contacto; las jornadas reabren',
              'Mejorar respuestas y handoff para cerrar de una vez',
            ],
            [
              'Plantillas pagas justo despues de que el cliente escribe',
              'Service window ignorada',
              'Responder en la ventana de service iniciada por el usuario',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Cuando el equipo pasa a optimizar costo por resolucion, las decisiones cambian de naturaleza: en vez de cortar mensajes y degradar la experiencia, reduces conversaciones inutiles y resuelves mas rapido. El resultado es menor costo con mejor atencion, que es exactamente lo que el FinOps aplicado deberia entregar.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'WhatsApp cobra por mensaje o por conversacion?',
      answer:
        'Por conversacion. La Cloud API usa conversation-based pricing: una ventana de 24 horas que se abre cuando se entrega el primer mensaje de una categoria, y dentro de ella intercambias tantos mensajes como quieras por el mismo costo. Por eso optimizar el numero de mensajes no baja la cuenta; lo que la baja es abrir menos conversaciones y resolver mas dentro de cada una.',
    },
    {
      question: 'Como uso la service window para gastar menos?',
      answer:
        'Cuando el cliente inicia la conversacion, se abre una ventana de service de 24 horas. Mientras este abierta, responde dentro de ella en vez de disparar una plantilla paga. Solo recurre a plantilla (utility o marketing, segun el caso) cuando esa ventana ya haya cerrado y necesites reabrir el contacto de forma proactiva.',
    },
    {
      question: 'Por que no dar valores exactos de costo?',
      answer:
        'Porque los precios por conversacion varian por pais y por categoria y Meta los reajusta periodicamente. Trabajar con numeros fijos lleva a decisiones equivocadas en cuanto la tabla cambia. Lo que permanece estable es la estructura: cobro por conversacion, por categoria, en ventana de 24h. Optimiza sobre la estructura y usa los precios vigentes solo como variables de entrada en el calculo.',
    },
  ],
  conclusion: {
    title: 'El costo controlado es cuestion de estructura, no de cortar mensajes',
    description:
      'Entender el cobro por conversacion, cerrar las fugas de conversaciones mal dirigidas y medir costo por resolucion en vez de por mensaje mantiene el canal eficiente sin degradar la experiencia. Si quieres ver donde se fuga el costo de tu WhatsApp y como optimizar, puedo ayudarte en ese analisis.',
    cta: 'Hablar sobre mis costos de WhatsApp',
  },
  related: [
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'ROI real de automatizacion con IA', to: '/blog/roi-real-automacao-ia' },
    { label: 'Gobernanza de plantillas en equipos grandes', to: '/blog/governanca-templates-times-grandes' },
  ],
};

export default { pt, en, es };
