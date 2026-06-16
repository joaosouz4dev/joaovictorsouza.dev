// Conteudo do artigo: Como desenhar SLAs de atendimento com bot + humano.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections, faq, conclusion, related }.

const pt = {
  intro:
    'Quando o atendimento mistura bot e humano, o SLA classico de "responder em X minutos" ' +
    'desmorona. O bot responde em milissegundos, mas a duvida real so e resolvida quando alguem ' +
    'do time entra. Se voce cobra o time pelo relogio que rodou enquanto o bot conversava ou ' +
    'enquanto o cliente sumiu, mede injustica, nao desempenho. Este guia mostra um modelo de SLA ' +
    'por estagio: quais metricas importam, onde o relogio conta ou pausa, como priorizar a fila e ' +
    'como cobrar cada lado so pelo que ele controla.',
  sections: [
    {
      title: 'Por que um SLA unico nao funciona com bot + humano',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um SLA unico assume que um unico ator e responsavel do inicio ao fim. No atendimento ' +
            'hibrido isso e falso: a responsabilidade troca de mao varias vezes. O bot atende, ' +
            'tenta resolver, transfere para a fila humana, o agente responde, pede um dado ao ' +
            'cliente e espera. Se o relogio do SLA corre o tempo todo, o time leva a culpa por ' +
            'periodos em que a bola nem estava com ele. O relogio precisa pausar e contar por ' +
            'estagio, seguindo quem de fato deve agir naquele momento. Sem isso, voce penaliza o ' +
            'agente pelo tempo que o cliente demorou para responder e premia uma operacao que ' +
            'parece rapida so porque o bot fecha ticket sem resolver nada.',
        },
      ],
    },
    {
      title: 'Os SLAs que importam e como o bot afeta cada um',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Em vez de um numero, trabalhe com um pequeno conjunto de SLAs que medem momentos ' +
            'diferentes da jornada. Cada um responde a uma pergunta distinta e o bot influencia ' +
            'cada um de um jeito proprio.',
        },
        {
          type: 'table',
          columns: ['SLA', 'O que mede', 'Como o bot afeta'],
          rows: [
            ['First response time', 'Tempo ate a primeira resposta ao cliente', 'O bot quase zera: responde na hora, mas isso nao prova resolucao'],
            ['Time to human', 'Tempo do pedido de humano ate um agente assumir', 'O bot pode adiar ou antecipar conforme decide quando escalar'],
            ['Resolution time', 'Tempo total ate o problema ser resolvido', 'O bot reduz se resolve sozinho; infla se so empurra ao humano'],
            ['Handoff accuracy', 'Quantos handoffs chegam com contexto util', 'Bom bot entrega resumo e intencao; bot ruim joga o ticket cru'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O erro comum e otimizar so o first response time. Com bot, ele fica lindo e esconde o ' +
            'que importa: o time to human e o resolution time. Meca os tres juntos, senao o bot vira ' +
            'uma maquina de responder rapido sem resolver.',
        },
      ],
    },
    {
      title: 'A maquina de estados do ticket e onde o relogio conta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Modele o ticket como uma maquina de estados. Cada estado define de quem e a ' +
            'responsabilidade e, portanto, se o relogio do SLA de resolucao conta ou pausa. A regra ' +
            'e simples: o relogio so conta quando a bola esta com o time. Quando o bot esta no ' +
            'controle ou quando se espera o cliente, o relogio do time pausa.',
        },
        {
          type: 'diagram',
          value:
            '            [Bot ativo]\n' +
            '          relogio: nao conta p/ time\n' +
            '                |\n' +
            '         pede humano | resolve\n' +
            '                v          \\\n' +
            '         [Fila humana]      v\n' +
            '       relogio: CONTA    [Resolvido]\n' +
            '                |\n' +
            '          agente assume\n' +
            '                v\n' +
            '       [Em atendimento]\n' +
            '         relogio: CONTA\n' +
            '            /        \\\n' +
            '   pede dado          resolve\n' +
            '        v                v\n' +
            '[Aguardando cliente]  [Resolvido]\n' +
            ' relogio: PAUSA\n' +
            '        |\n' +
            '  cliente responde\n' +
            '        v\n' +
            '  volta p/ Fila humana ou Em atendimento',
        },
        {
          type: 'paragraph',
          value:
            'Os estados que mais geram disputa sao "bot ativo" e "aguardando cliente". Nos dois, o ' +
            'tempo nao deve pesar contra o agente, porque a acao depende do bot ou do proprio ' +
            'cliente. Ja "fila humana" e "em atendimento" sao integralmente do time e ali o relogio ' +
            'corre cheio.',
        },
      ],
    },
    {
      title: 'Como priorizar a fila humana',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando varios tickets esperam um agente, a ordem importa tanto quanto a velocidade. ' +
            'Atender por ordem de chegada e simples, mas deixa caso urgente atras de caso trivial e ' +
            'estoura SLA sem necessidade. Combine criterios.',
        },
        {
          type: 'list',
          items: [
            'Por prioridade: cliente VIP, plano pago ou assunto critico (cobranca, falha de pagamento) sobem na fila.',
            'Por tempo de espera: dentro da mesma prioridade, quem espera ha mais tempo e atendido primeiro, evitando inanicao.',
            'Por SLA em risco: tickets cujo tempo restante ate estourar o SLA esta baixo ganham boost automatico, mesmo com prioridade media.',
            'Por esforco do handoff: ticket que o bot ja qualificou e resumiu pode ser resolvido rapido e desafogar a fila.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Uma fila madura mistura esses sinais num score unico. O SLA em risco e o desempate mais ' +
            'importante: nao adianta priorizar VIP se um caso comum vai estourar em dois minutos e ' +
            'manchar a metrica do dia.',
        },
      ],
    },
    {
      title: 'Calculando o SLA com pausa de "aguardando cliente"',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O calculo justo soma apenas o tempo em que o ticket esteve sob responsabilidade do ' +
            'time. A funcao abaixo percorre os intervalos de estado e acumula so os que contam, ' +
            'ignorando bot ativo e aguardando cliente.',
        },
        {
          type: 'code',
          value: `// sla.js
// Estados que contam para o SLA de resolucao do time humano.
const ESTADOS_QUE_CONTAM = new Set(['fila_humana', 'em_atendimento']);

// Recebe os segmentos de estado do ticket, na ordem em que ocorreram.
// Cada segmento: { estado, inicio, fim } com timestamps em ms.
// Retorna o tempo (ms) sob responsabilidade do time, descontando
// bot ativo e aguardando cliente.
function tempoSobResponsabilidadeDoTime(segmentos) {
  return segmentos.reduce((total, seg) => {
    if (!ESTADOS_QUE_CONTAM.has(seg.estado)) return total;
    const fim = seg.fim ?? Date.now(); // segmento aberto: conta ate agora
    return total + Math.max(0, fim - seg.inicio);
  }, 0);
}

// Verifica se o ticket cumpriu o SLA de resolucao.
function cumpriuSla(segmentos, slaMs) {
  return tempoSobResponsabilidadeDoTime(segmentos) <= slaMs;
}

// Exemplo: SLA de 30 min (1800000 ms).
const segmentos = [
  { estado: 'bot_ativo',          inicio: 0,       fim: 120000 },  // 2 min, nao conta
  { estado: 'fila_humana',        inicio: 120000,  fim: 300000 },  // 3 min, conta
  { estado: 'em_atendimento',     inicio: 300000,  fim: 600000 },  // 5 min, conta
  { estado: 'aguardando_cliente', inicio: 600000,  fim: 4200000 }, // 60 min, NAO conta
  { estado: 'em_atendimento',     inicio: 4200000, fim: 4500000 }, // 5 min, conta
];

tempoSobResponsabilidadeDoTime(segmentos); // 780000 ms = 13 min
cumpriuSla(segmentos, 1800000);            // true: 13 min <= 30 min

module.exports = { tempoSobResponsabilidadeDoTime, cumpriuSla };`,
        },
        {
          type: 'paragraph',
          value:
            'Repare que o relogio bruto marcaria 75 minutos, mas o tempo justo e 13. Sem a pausa, ' +
            'esse ticket estouraria o SLA por culpa do cliente que sumiu por uma hora. O segredo e ' +
            'guardar cada transicao de estado com timestamp para reconstruir os segmentos depois.',
        },
      ],
    },
    {
      title: 'Metricas para nao cobrar o time pelo que nao controla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um numero agregado de resolution time esconde de quem foi a demora. Separe o tempo por ' +
            'fase para que cada area olhe a sua. Assim voce melhora o bot, dimensiona o time e cobra ' +
            'o cliente sem injusticas.',
        },
        {
          type: 'list',
          items: [
            'Tempo de bot: quanto o ticket passou em bot ativo. Mede se o bot resolve ou so empurra.',
            'Tempo de fila: quanto esperou na fila humana antes de um agente assumir. Mede dimensionamento do time.',
            'Tempo de humano: quanto durou o atendimento ativo do agente. Mede a produtividade real, e o unico que pesa no SLA dele.',
            'Tempo aguardando cliente: quanto ficou parado esperando resposta. Nunca entra no SLA do time, mas ajuda a entender resolucao lenta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Com essa separacao, fila alta vira problema de capacidade (contrate ou ajuste turnos), ' +
            'tempo de humano alto vira problema de treino ou ferramenta, e tempo de bot alto sem ' +
            'resolucao vira problema de fluxo do bot. Cada um responde pelo que controla, e a ' +
            'conversa de melhoria deixa de ser briga sobre um numero unico.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'O bot que responde na hora nao deveria zerar meu SLA?',
      answer:
        'Ele zera so o first response time, e isso engana. Uma resposta automatica instantanea nao ' +
        'e resolucao. Se voce parar so nessa metrica, o painel fica verde enquanto o cliente segue ' +
        'sem solucao. Por isso meca tambem time to human e resolution time, que sao os SLAs que ' +
        'refletem a experiencia real.',
    },
    {
      question: 'Como impeco que o cliente que some estoure meu SLA?',
      answer:
        'Use o estado "aguardando cliente" e pause o relogio do SLA enquanto o ticket estiver nele. ' +
        'O tempo so volta a contar quando o cliente responde e a bola retorna ao time. A funcao de ' +
        'calculo deve somar apenas os estados sob responsabilidade do time, ignorando esse periodo.',
    },
    {
      question: 'Por ordem de chegada nao e a fila mais justa?',
      answer:
        'E a mais simples, nao a mais justa. Ordem de chegada pura deixa um caso critico atras de ' +
        'um trivial e estoura SLA a toa. O ideal e combinar prioridade, tempo de espera e SLA em ' +
        'risco num score, dando boost automatico aos tickets perto de estourar para nao penalizar ' +
        'quem ja esperou demais.',
    },
  ],
  conclusion: {
    title: 'SLA justo mede responsabilidade, nao relogio',
    description:
      'Atendimento com bot e humano so e mensuravel quando o SLA segue a maquina de estados e o ' +
      'relogio pausa fora da mao do time. Adote os SLAs por estagio, priorize a fila por risco e ' +
      'separe os tempos de bot, fila e humano. Assim voce cobra cada lado pelo que controla e ' +
      'melhora a operacao com dado, nao com achismo. Posso ajudar a desenhar esse modelo no seu ' +
      'atendimento.',
    cta: 'Desenhar SLAs do meu atendimento',
  },
  related: [
    { label: 'Handoff humano no WhatsApp com IA', to: '/blog/handoff-humano-whatsapp-ia' },
    { label: 'Roadmap de automacao de suporte com IA em 90 dias', to: '/blog/roadmap-automacao-suporte-ia-90-dias' },
    { label: 'Fale comigo', to: '/contato' },
  ],
};

const en = {
  intro:
    'When support mixes bot and human, the classic "respond within X minutes" SLA falls apart. ' +
    'The bot replies in milliseconds, but the real question is only solved when a teammate steps ' +
    'in. If you charge the team for the clock that ran while the bot was chatting or while the ' +
    'customer went silent, you are measuring unfairness, not performance. This guide shows a ' +
    'stage-based SLA model: which metrics matter, where the clock counts or pauses, how to ' +
    'prioritize the queue, and how to hold each side accountable only for what it controls.',
  sections: [
    {
      title: 'Why a single SLA fails with bot + human',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A single SLA assumes one actor is responsible from start to finish. In hybrid support ' +
            'that is false: responsibility changes hands several times. The bot answers, tries to ' +
            'solve, hands off to the human queue, the agent replies, asks the customer for data and ' +
            'waits. If the SLA clock runs the whole time, the team takes the blame for periods when ' +
            'the ball was not even with them. The clock has to pause and count per stage, following ' +
            'who actually should act at that moment. Without that, you penalize the agent for the ' +
            'time the customer took to reply, and you reward an operation that looks fast only ' +
            'because the bot closes tickets without solving anything.',
        },
      ],
    },
    {
      title: 'The SLAs that matter and how the bot affects each',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Instead of one number, work with a small set of SLAs that measure different moments of ' +
            'the journey. Each answers a distinct question and the bot influences each in its own way.',
        },
        {
          type: 'table',
          columns: ['SLA', 'What it measures', 'How the bot affects it'],
          rows: [
            ['First response time', 'Time until the first reply to the customer', 'The bot nearly zeroes it: instant reply, but that does not prove resolution'],
            ['Time to human', 'Time from the human request until an agent takes over', 'The bot can delay or speed it up depending on when it escalates'],
            ['Resolution time', 'Total time until the problem is solved', 'The bot lowers it if it solves alone; inflates it if it just pushes to the human'],
            ['Handoff accuracy', 'How many handoffs arrive with useful context', 'A good bot delivers a summary and intent; a bad one dumps the raw ticket'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The common mistake is optimizing only the first response time. With a bot it looks ' +
            'great and hides what matters: time to human and resolution time. Measure all three ' +
            'together, otherwise the bot becomes a machine that answers fast without solving.',
        },
      ],
    },
    {
      title: 'The ticket state machine and where the clock counts',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Model the ticket as a state machine. Each state defines whose responsibility it is and ' +
            'therefore whether the resolution SLA clock counts or pauses. The rule is simple: the ' +
            'clock only counts when the ball is with the team. When the bot is in control or when we ' +
            'wait for the customer, the team clock pauses.',
        },
        {
          type: 'diagram',
          value:
            '            [Bot active]\n' +
            '          clock: not counted for team\n' +
            '                |\n' +
            '       asks human | resolves\n' +
            '                v          \\\n' +
            '         [Human queue]      v\n' +
            '       clock: COUNTS    [Resolved]\n' +
            '                |\n' +
            '         agent takes over\n' +
            '                v\n' +
            '        [In handling]\n' +
            '         clock: COUNTS\n' +
            '            /        \\\n' +
            '   asks for data       resolves\n' +
            '        v                 v\n' +
            '[Awaiting customer]    [Resolved]\n' +
            ' clock: PAUSES\n' +
            '        |\n' +
            '  customer replies\n' +
            '        v\n' +
            '  back to Human queue or In handling',
        },
        {
          type: 'paragraph',
          value:
            'The states that cause the most disputes are "bot active" and "awaiting customer". In ' +
            'both, time should not count against the agent, because the action depends on the bot or ' +
            'the customer. Meanwhile "human queue" and "in handling" are fully on the team, and there ' +
            'the clock runs in full.',
        },
      ],
    },
    {
      title: 'How to prioritize the human queue',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When several tickets wait for an agent, the order matters as much as the speed. Serving ' +
            'by arrival order is simple, but it leaves an urgent case behind a trivial one and busts ' +
            'the SLA needlessly. Combine criteria.',
        },
        {
          type: 'list',
          items: [
            'By priority: VIP customer, paid plan or critical topic (billing, payment failure) move up the queue.',
            'By waiting time: within the same priority, whoever waited longest is served first, avoiding starvation.',
            'By SLA at risk: tickets whose remaining time before the SLA breaches is low get an automatic boost, even at medium priority.',
            'By handoff effort: a ticket the bot already qualified and summarized can be solved fast and relieve the queue.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A mature queue blends these signals into a single score. SLA at risk is the most ' +
            'important tiebreaker: there is no point prioritizing a VIP if a common case is about to ' +
            'breach in two minutes and stain the day metric.',
        },
      ],
    },
    {
      title: 'Computing the SLA with an "awaiting customer" pause',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A fair calculation sums only the time the ticket was under the team responsibility. The ' +
            'function below walks the state intervals and accumulates only those that count, ignoring ' +
            'bot active and awaiting customer.',
        },
        {
          type: 'code',
          value: `// sla.js
// States that count toward the human team resolution SLA.
const COUNTING_STATES = new Set(['human_queue', 'in_handling']);

// Receives the ticket state segments, in the order they happened.
// Each segment: { state, start, end } with timestamps in ms.
// Returns the time (ms) under team responsibility, discounting
// bot active and awaiting customer.
function timeUnderTeamResponsibility(segments) {
  return segments.reduce((total, seg) => {
    if (!COUNTING_STATES.has(seg.state)) return total;
    const end = seg.end ?? Date.now(); // open segment: count until now
    return total + Math.max(0, end - seg.start);
  }, 0);
}

// Checks whether the ticket met the resolution SLA.
function metSla(segments, slaMs) {
  return timeUnderTeamResponsibility(segments) <= slaMs;
}

// Example: SLA of 30 min (1800000 ms).
const segments = [
  { state: 'bot_active',        start: 0,       end: 120000 },  // 2 min, does not count
  { state: 'human_queue',       start: 120000,  end: 300000 },  // 3 min, counts
  { state: 'in_handling',       start: 300000,  end: 600000 },  // 5 min, counts
  { state: 'awaiting_customer', start: 600000,  end: 4200000 }, // 60 min, does NOT count
  { state: 'in_handling',       start: 4200000, end: 4500000 }, // 5 min, counts
];

timeUnderTeamResponsibility(segments); // 780000 ms = 13 min
metSla(segments, 1800000);             // true: 13 min <= 30 min

module.exports = { timeUnderTeamResponsibility, metSla };`,
        },
        {
          type: 'paragraph',
          value:
            'Note that the raw clock would read 75 minutes, but the fair time is 13. Without the ' +
            'pause, this ticket would breach the SLA because of a customer who vanished for an hour. ' +
            'The trick is to store every state transition with a timestamp so you can rebuild the ' +
            'segments later.',
        },
      ],
    },
    {
      title: 'Metrics so you do not charge the team for what it does not control',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A single aggregate resolution time hides whose delay it was. Split the time by phase so ' +
            'each area looks at its own. That way you improve the bot, size the team and follow up ' +
            'with the customer without unfairness.',
        },
        {
          type: 'list',
          items: [
            'Bot time: how long the ticket spent in bot active. Measures whether the bot solves or just pushes.',
            'Queue time: how long it waited in the human queue before an agent took over. Measures team sizing.',
            'Human time: how long the agent active handling lasted. Measures real productivity, the only one that weighs on their SLA.',
            'Awaiting customer time: how long it sat waiting for a reply. Never enters the team SLA, but helps explain slow resolution.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'With this split, high queue time becomes a capacity problem (hire or adjust shifts), ' +
            'high human time becomes a training or tooling problem, and high bot time without ' +
            'resolution becomes a bot flow problem. Each side answers for what it controls, and the ' +
            'improvement conversation stops being a fight over a single number.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Should the bot that replies instantly not zero my SLA?',
      answer:
        'It only zeroes the first response time, and that is misleading. An instant automated reply ' +
        'is not resolution. If you stop at that metric, the dashboard goes green while the customer ' +
        'is still unsolved. That is why you should also measure time to human and resolution time, ' +
        'the SLAs that reflect the real experience.',
    },
    {
      question: 'How do I stop a customer who vanishes from breaching my SLA?',
      answer:
        'Use the "awaiting customer" state and pause the SLA clock while the ticket sits in it. Time ' +
        'only resumes when the customer replies and the ball returns to the team. The calculation ' +
        'function should sum only the states under team responsibility, ignoring that period.',
    },
    {
      question: 'Is arrival order not the fairest queue?',
      answer:
        'It is the simplest, not the fairest. Pure arrival order leaves a critical case behind a ' +
        'trivial one and busts the SLA for nothing. The ideal is to combine priority, waiting time ' +
        'and SLA at risk into a score, giving an automatic boost to tickets near breaching so you ' +
        'do not penalize whoever already waited too long.',
    },
  ],
  conclusion: {
    title: 'A fair SLA measures responsibility, not the clock',
    description:
      'Bot and human support is only measurable when the SLA follows the state machine and the ' +
      'clock pauses outside the team hands. Adopt stage-based SLAs, prioritize the queue by risk ' +
      'and split bot, queue and human time. That way you hold each side to what it controls and ' +
      'improve the operation with data, not guesswork. I can help you design this model for your ' +
      'support.',
    cta: 'Design my support SLAs',
  },
  related: [
    { label: 'Human handoff on WhatsApp with AI', to: '/blog/handoff-humano-whatsapp-ia' },
    { label: '90-day AI support automation roadmap', to: '/blog/roadmap-automacao-suporte-ia-90-dias' },
    { label: 'Get in touch', to: '/contato' },
  ],
};

const es = {
  intro:
    'Cuando la atencion mezcla bot y humano, el SLA clasico de "responder en X minutos" se ' +
    'derrumba. El bot responde en milisegundos, pero la duda real solo se resuelve cuando entra ' +
    'alguien del equipo. Si cobras al equipo por el reloj que corrio mientras el bot conversaba o ' +
    'mientras el cliente desaparecio, mides injusticia, no desempeno. Esta guia muestra un modelo ' +
    'de SLA por etapa: que metricas importan, donde el reloj cuenta o se pausa, como priorizar la ' +
    'cola y como responsabilizar a cada lado solo por lo que controla.',
  sections: [
    {
      title: 'Por que un SLA unico no funciona con bot + humano',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un SLA unico asume que un solo actor es responsable de principio a fin. En la atencion ' +
            'hibrida eso es falso: la responsabilidad cambia de mano varias veces. El bot atiende, ' +
            'intenta resolver, transfiere a la cola humana, el agente responde, pide un dato al ' +
            'cliente y espera. Si el reloj del SLA corre todo el tiempo, el equipo carga la culpa ' +
            'por periodos en que la pelota ni estaba con el. El reloj debe pausarse y contar por ' +
            'etapa, siguiendo a quien de verdad debe actuar en ese momento. Sin eso, penalizas al ' +
            'agente por el tiempo que el cliente tardo en responder y premias una operacion que ' +
            'parece rapida solo porque el bot cierra tickets sin resolver nada.',
        },
      ],
    },
    {
      title: 'Los SLAs que importan y como el bot afecta a cada uno',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En lugar de un numero, trabaja con un pequeno conjunto de SLAs que miden momentos ' +
            'distintos del recorrido. Cada uno responde a una pregunta diferente y el bot influye en ' +
            'cada uno a su manera.',
        },
        {
          type: 'table',
          columns: ['SLA', 'Que mide', 'Como lo afecta el bot'],
          rows: [
            ['First response time', 'Tiempo hasta la primera respuesta al cliente', 'El bot casi lo anula: responde al instante, pero eso no prueba resolucion'],
            ['Time to human', 'Tiempo desde el pedido de humano hasta que un agente asume', 'El bot puede retrasar o adelantar segun cuando escala'],
            ['Resolution time', 'Tiempo total hasta resolver el problema', 'El bot lo reduce si resuelve solo; lo infla si solo empuja al humano'],
            ['Handoff accuracy', 'Cuantos handoffs llegan con contexto util', 'Un buen bot entrega resumen e intencion; uno malo arroja el ticket crudo'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El error comun es optimizar solo el first response time. Con bot queda lindo y esconde ' +
            'lo que importa: el time to human y el resolution time. Mide los tres juntos, si no el ' +
            'bot se vuelve una maquina de responder rapido sin resolver.',
        },
      ],
    },
    {
      title: 'La maquina de estados del ticket y donde el reloj cuenta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Modela el ticket como una maquina de estados. Cada estado define de quien es la ' +
            'responsabilidad y, por tanto, si el reloj del SLA de resolucion cuenta o se pausa. La ' +
            'regla es simple: el reloj solo cuenta cuando la pelota esta con el equipo. Cuando el bot ' +
            'tiene el control o cuando se espera al cliente, el reloj del equipo se pausa.',
        },
        {
          type: 'diagram',
          value:
            '            [Bot activo]\n' +
            '          reloj: no cuenta p/ equipo\n' +
            '                |\n' +
            '       pide humano | resuelve\n' +
            '                v          \\\n' +
            '         [Cola humana]      v\n' +
            '       reloj: CUENTA     [Resuelto]\n' +
            '                |\n' +
            '          agente asume\n' +
            '                v\n' +
            '       [En atencion]\n' +
            '        reloj: CUENTA\n' +
            '            /        \\\n' +
            '   pide dato           resuelve\n' +
            '        v                 v\n' +
            '[Esperando cliente]    [Resuelto]\n' +
            ' reloj: PAUSA\n' +
            '        |\n' +
            '  cliente responde\n' +
            '        v\n' +
            '  vuelve a Cola humana o En atencion',
        },
        {
          type: 'paragraph',
          value:
            'Los estados que mas generan disputa son "bot activo" y "esperando cliente". En ambos, el ' +
            'tiempo no debe pesar contra el agente, porque la accion depende del bot o del propio ' +
            'cliente. En cambio "cola humana" y "en atencion" son enteramente del equipo, y ahi el ' +
            'reloj corre completo.',
        },
      ],
    },
    {
      title: 'Como priorizar la cola humana',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando varios tickets esperan a un agente, el orden importa tanto como la velocidad. ' +
            'Atender por orden de llegada es simple, pero deja un caso urgente detras de uno trivial ' +
            'y revienta el SLA sin necesidad. Combina criterios.',
        },
        {
          type: 'list',
          items: [
            'Por prioridad: cliente VIP, plan pago o asunto critico (cobranza, fallo de pago) suben en la cola.',
            'Por tiempo de espera: dentro de la misma prioridad, quien espera hace mas tiempo se atiende primero, evitando inanicion.',
            'Por SLA en riesgo: los tickets cuyo tiempo restante antes de reventar el SLA es bajo reciben un boost automatico, aun con prioridad media.',
            'Por esfuerzo del handoff: un ticket que el bot ya califico y resumio puede resolverse rapido y descongestionar la cola.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Una cola madura mezcla esas senales en un score unico. El SLA en riesgo es el desempate ' +
            'mas importante: no sirve priorizar a un VIP si un caso comun va a reventar en dos ' +
            'minutos y mancha la metrica del dia.',
        },
      ],
    },
    {
      title: 'Calcular el SLA con pausa de "esperando cliente"',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El calculo justo suma solo el tiempo en que el ticket estuvo bajo responsabilidad del ' +
            'equipo. La funcion de abajo recorre los intervalos de estado y acumula solo los que ' +
            'cuentan, ignorando bot activo y esperando cliente.',
        },
        {
          type: 'code',
          value: `// sla.js
// Estados que cuentan para el SLA de resolucion del equipo humano.
const ESTADOS_QUE_CUENTAN = new Set(['cola_humana', 'en_atencion']);

// Recibe los segmentos de estado del ticket, en el orden en que ocurrieron.
// Cada segmento: { estado, inicio, fin } con timestamps en ms.
// Devuelve el tiempo (ms) bajo responsabilidad del equipo, descontando
// bot activo y esperando cliente.
function tiempoBajoResponsabilidadDelEquipo(segmentos) {
  return segmentos.reduce((total, seg) => {
    if (!ESTADOS_QUE_CUENTAN.has(seg.estado)) return total;
    const fin = seg.fin ?? Date.now(); // segmento abierto: cuenta hasta ahora
    return total + Math.max(0, fin - seg.inicio);
  }, 0);
}

// Verifica si el ticket cumplio el SLA de resolucion.
function cumplioSla(segmentos, slaMs) {
  return tiempoBajoResponsabilidadDelEquipo(segmentos) <= slaMs;
}

// Ejemplo: SLA de 30 min (1800000 ms).
const segmentos = [
  { estado: 'bot_activo',         inicio: 0,       fin: 120000 },  // 2 min, no cuenta
  { estado: 'cola_humana',        inicio: 120000,  fin: 300000 },  // 3 min, cuenta
  { estado: 'en_atencion',        inicio: 300000,  fin: 600000 },  // 5 min, cuenta
  { estado: 'esperando_cliente',  inicio: 600000,  fin: 4200000 }, // 60 min, NO cuenta
  { estado: 'en_atencion',        inicio: 4200000, fin: 4500000 }, // 5 min, cuenta
];

tiempoBajoResponsabilidadDelEquipo(segmentos); // 780000 ms = 13 min
cumplioSla(segmentos, 1800000);                // true: 13 min <= 30 min

module.exports = { tiempoBajoResponsabilidadDelEquipo, cumplioSla };`,
        },
        {
          type: 'paragraph',
          value:
            'Fijate que el reloj bruto marcaria 75 minutos, pero el tiempo justo es 13. Sin la pausa, ' +
            'este ticket reventaria el SLA por culpa del cliente que desaparecio por una hora. El ' +
            'secreto es guardar cada transicion de estado con timestamp para reconstruir los ' +
            'segmentos despues.',
        },
      ],
    },
    {
      title: 'Metricas para no cobrar al equipo por lo que no controla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un numero agregado de resolution time esconde de quien fue la demora. Separa el tiempo ' +
            'por fase para que cada area mire la suya. Asi mejoras el bot, dimensionas el equipo y ' +
            'das seguimiento al cliente sin injusticias.',
        },
        {
          type: 'list',
          items: [
            'Tiempo de bot: cuanto paso el ticket en bot activo. Mide si el bot resuelve o solo empuja.',
            'Tiempo de cola: cuanto espero en la cola humana antes de que un agente asumiera. Mide el dimensionamiento del equipo.',
            'Tiempo de humano: cuanto duro la atencion activa del agente. Mide la productividad real, el unico que pesa en su SLA.',
            'Tiempo esperando cliente: cuanto quedo parado esperando respuesta. Nunca entra en el SLA del equipo, pero ayuda a entender una resolucion lenta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Con esa separacion, una cola alta se vuelve un problema de capacidad (contrata o ajusta ' +
            'turnos), un tiempo de humano alto se vuelve un problema de entrenamiento o herramienta, ' +
            'y un tiempo de bot alto sin resolucion se vuelve un problema de flujo del bot. Cada uno ' +
            'responde por lo que controla, y la conversacion de mejora deja de ser una pelea por un ' +
            'numero unico.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'El bot que responde al instante no deberia anular mi SLA?',
      answer:
        'Solo anula el first response time, y eso engana. Una respuesta automatica instantanea no es ' +
        'resolucion. Si te quedas solo en esa metrica, el panel queda verde mientras el cliente ' +
        'sigue sin solucion. Por eso mide tambien time to human y resolution time, que son los SLAs ' +
        'que reflejan la experiencia real.',
    },
    {
      question: 'Como impido que el cliente que desaparece reviente mi SLA?',
      answer:
        'Usa el estado "esperando cliente" y pausa el reloj del SLA mientras el ticket este en el. ' +
        'El tiempo solo vuelve a contar cuando el cliente responde y la pelota regresa al equipo. La ' +
        'funcion de calculo debe sumar solo los estados bajo responsabilidad del equipo, ignorando ' +
        'ese periodo.',
    },
    {
      question: 'No es la cola por orden de llegada la mas justa?',
      answer:
        'Es la mas simple, no la mas justa. El orden de llegada puro deja un caso critico detras de ' +
        'uno trivial y revienta el SLA en vano. Lo ideal es combinar prioridad, tiempo de espera y ' +
        'SLA en riesgo en un score, dando boost automatico a los tickets cerca de reventar para no ' +
        'penalizar a quien ya espero demasiado.',
    },
  ],
  conclusion: {
    title: 'Un SLA justo mide responsabilidad, no el reloj',
    description:
      'La atencion con bot y humano solo es medible cuando el SLA sigue la maquina de estados y el ' +
      'reloj se pausa fuera de la mano del equipo. Adopta SLAs por etapa, prioriza la cola por ' +
      'riesgo y separa los tiempos de bot, cola y humano. Asi responsabilizas a cada lado por lo ' +
      'que controla y mejoras la operacion con datos, no con suposiciones. Puedo ayudarte a disenar ' +
      'este modelo en tu atencion.',
    cta: 'Disenar los SLAs de mi atencion',
  },
  related: [
    { label: 'Handoff humano en WhatsApp con IA', to: '/blog/handoff-humano-whatsapp-ia' },
    { label: 'Roadmap de automatizacion de soporte con IA en 90 dias', to: '/blog/roadmap-automacao-suporte-ia-90-dias' },
    { label: 'Hablemos', to: '/contato' },
  ],
};

export default { pt, en, es };
