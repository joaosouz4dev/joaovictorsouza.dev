// Conteudo do artigo: sinal de abandono no chat, detectar a desistencia antes do cliente sumir.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O cliente insatisfeito que reclama é o barato de tratar: ele diz o que está errado, aceita uma correção e continua na conversa. O caro é o que simplesmente para de responder. Não abre chamado, não avalia o atendimento, não aparece em nenhuma métrica de qualidade, e o sistema registra a conversa como concluída porque tecnicamente ninguém a interrompeu. Esse é o abandono silencioso, e ele costuma ser a maior fatia de perda de um atendimento automatizado justamente porque é invisível por construção. Este artigo mostra por que o abandono não é um evento e sim a ausência de um, como transformar essa ausência em sinal usando evidência que já existe no fluxo, qual é a diferença entre um cliente que desistiu e um que só foi almoçar, como decidir se vale intervir antes do silêncio e por que a intervenção errada acelera exatamente a saída que ela tentava evitar.',
  sections: [
    {
      title: 'Abandono não é um evento, é a ausência de um',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo sistema de atendimento sabe registrar o que acontece. Mensagem recebida, resposta enviada, transferência para humano, avaliação preenchida. O abandono não é nada disso: é o momento em que a próxima mensagem esperada não chega. Como não existe um evento correspondente, ele não pode ser capturado por um handler, e é por isso que a maior parte dos times descobre o problema meses depois, ao cruzar o funil de conversas com o de conversões e notar que um terço das conversas termina sem desfecho registrado.',
        },
        {
          type: 'paragraph',
          value:
            'A consequência prática é que detectar abandono exige inverter a arquitetura do fluxo. Em vez de reagir a mensagens, o sistema precisa agendar uma verificação futura a cada turno e cancelá-la quando o cliente responde. O abandono é o disparo dessa verificação sem cancelamento. Isso parece detalhe de implementação, mas define tudo o que vem depois: significa que a detecção tem custo por conversa aberta e não por mensagem trocada, e que qualquer política de abandono precisa ser barata o suficiente para rodar sobre cem por cento do tráfego.',
        },
        {
          type: 'diagram',
          value: `turno N: cliente envia mensagem
   |
   +-- cancela verificacao pendente da conversa
   +-- agente responde
   +-- agenda verificacao em T (deadline de silencio)
   |
   +--> cliente responde antes de T
   |       -> cancela, volta ao turno N+1, conversa saudavel
   |
   +--> T expira sem resposta
           -> avalia estado no momento do silencio
              |
              +-- desfecho ja alcancado -> conclusao natural, nao e abandono
              +-- sem desfecho + risco baixo -> abandono passivo, so registra
              +-- sem desfecho + risco alto  -> abandono ativo, dispara acao`,
        },
        {
          type: 'paragraph',
          value:
            'O ramo mais importante do diagrama é o primeiro do bloco de expiração, e é o que quase todo time esquece. Silêncio depois de "obrigado, era isso mesmo" não é abandono, é encerramento. Contar os dois juntos produz uma taxa de abandono inflada que ninguém consegue acionar, porque metade dela é composta de conversas bem-sucedidas. A primeira coisa a fazer antes de medir abandono é definir o que conta como desfecho no seu domínio, e essa definição é de produto, não de engenharia.',
        },
      ],
    },
    {
      title: 'Silêncio não é desistência: separar pausa de saída',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro mais comum na primeira versão de uma detecção de abandono é usar um único tempo de silêncio para tudo. Trinta segundos sem resposta num chat de site é anormal, e trinta minutos no WhatsApp é completamente normal, porque o canal é assíncrono por natureza e o cliente foi almoçar. Um limiar fixo aplicado a canais diferentes produz falso positivo em massa no canal assíncrono e falso negativo no síncrono, e o time conclui que a métrica não funciona quando o que não funciona é o limiar.',
        },
        {
          type: 'paragraph',
          value:
            'O limiar precisa ser derivado da distribuição real de intervalos entre turnos, por canal e por etapa da conversa. Um bom ponto de partida é o percentil noventa dos intervalos observados em conversas que terminaram com desfecho positivo: se noventa por cento das pausas de clientes que resolveram o problema são menores que quatro minutos, uma pausa de doze minutos naquele canal carrega informação. E o limiar precisa variar por etapa, porque a pausa depois de uma pergunta simples significa algo bem diferente da pausa depois de um pedido de dado sensível, em que o cliente legitimamente saiu para procurar um documento.',
        },
        {
          type: 'table',
          columns: ['Canal', 'Etapa da conversa', 'Silêncio esperado (p90)', 'Limiar de risco', 'Leitura do silêncio'],
          rows: [
            ['Widget no site', 'Pergunta inicial', '40 s', '3 min', 'Alta chance de saída, aba fechada'],
            ['Widget no site', 'Coleta de dado cadastral', '90 s', '6 min', 'Pode estar buscando informação'],
            ['WhatsApp', 'Pergunta inicial', '4 min', '25 min', 'Assíncrono, pausa é comum'],
            ['WhatsApp', 'Confirmação de pagamento', '2 min', '10 min', 'Hesitação, não distração'],
            ['App autenticado', 'Diagnóstico técnico', '3 min', '15 min', 'Cliente pode estar testando'],
            ['E-mail', 'Qualquer etapa', '4 h', '48 h', 'Silêncio não é sinal útil'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha existe para deixar explícito que o e-mail é o caso em que a detecção por silêncio simplesmente não paga. Quando o canal é lento por natureza, o intervalo entre turnos carrega tão pouca informação sobre a intenção do cliente que qualquer limiar vira ruído, e o esforço deve ir para sinais de conteúdo. Reconhecer onde a técnica não se aplica economiza um trimestre de ajuste de parâmetro que nunca convergiria.',
        },
      ],
    },
    {
      title: 'Sinais que aparecem antes do silêncio',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Silêncio é o sinal mais tardio possível: quando ele chega, o cliente já decidiu. O valor real está nos sinais que precedem a decisão, e todos eles já existem no fluxo sem instrumentação nova. Três famílias cobrem quase tudo. A primeira é comportamental e mede como o cliente escreve: latência de resposta subindo turno a turno, mensagens encurtando, uso de monossílabos onde antes havia frases. A segunda é semântica e mede o conteúdo: repetição da mesma pergunta com outras palavras, marcadores explícitos de frustração, pedido de humano. A terceira é estrutural e mede a conversa como um todo: número de turnos acima do esperado para aquela intenção, ausência de progresso em direção ao desfecho.',
        },
        {
          type: 'paragraph',
          value:
            'A tentação óbvia é jogar tudo isso num modelo e pedir uma probabilidade de abandono. Vale resistir a ela na primeira versão, por dois motivos. O primeiro é que não existe rótulo confiável no começo: o cliente que sumiu não disse por que sumiu, então o alvo de treino precisa ser construído por proxy, e um proxy ruim ensina o modelo a prever a definição em vez do fenômeno. O segundo é operacional: um escore de modelo não é explicável na hora do incidente, e um escore aditivo simples é auditável, ajustável e suficiente para pegar a maior parte do sinal.',
        },
        {
          type: 'code',
          value: `// abandonment/risk-score.js
// Escore aditivo de risco de abandono, calculado a cada turno do cliente.
// Deliberadamente sem modelo: cada componente e auditavel e ajustavel
// isoladamente, o que importa quando a operacao contesta um disparo.

const SIGNAL_WEIGHTS = {
  latencyTrend: 25,      // cliente demorando cada vez mais para responder
  messageShrink: 15,     // mensagens encurtando ao longo da conversa
  repetition: 30,        // mesma pergunta reformulada, agente nao resolveu
  frustration: 20,       // marcador lexical explicito de irritacao
  turnOverrun: 10,       // conversa mais longa que o esperado para a intencao
};

// Tendencia de latencia: compara a mediana dos 3 ultimos intervalos com a
// dos 3 primeiros. Mediana, e nao media, porque uma unica pausa longa
// (o cliente atendeu o telefone) nao deve dominar o sinal.
function latencyTrendSignal(gapsMs) {
  if (gapsMs.length < 6) return 0;
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const early = median(gapsMs.slice(0, 3));
  const recent = median(gapsMs.slice(-3));
  if (early === 0) return 0;
  const ratio = recent / early;
  // Abaixo de 2x e variacao normal. Acima de 4x satura: dobrar de novo
  // nao carrega mais informacao, e deixar crescer sem teto faz um unico
  // componente decidir o escore sozinho.
  return Math.max(0, Math.min(1, (ratio - 2) / 2));
}

// Encurtamento: razao entre o tamanho medio das ultimas mensagens e das
// primeiras. "ok" depois de tres paragrafos e desengajamento.
function messageShrinkSignal(lengths) {
  if (lengths.length < 4) return 0;
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const early = avg(lengths.slice(0, 2));
  const recent = avg(lengths.slice(-2));
  if (early === 0) return 0;
  return Math.max(0, Math.min(1, 1 - recent / early));
}

// Repeticao: o cliente reformulou a mesma pergunta. Similaridade por
// trigramas de caractere e barata e resiste a variacao de escrita,
// o que embedding tambem faz, mas custando uma chamada de rede por turno.
function jaccardTrigrams(a, b) {
  const grams = (s) => {
    const t = s.toLowerCase().replace(/\\s+/g, ' ').trim();
    const out = new Set();
    for (let i = 0; i + 3 <= t.length; i += 1) out.add(t.slice(i, i + 3));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter += 1;
  return inter / (ga.size + gb.size - inter);
}

function repetitionSignal(customerMessages) {
  if (customerMessages.length < 2) return 0;
  const last = customerMessages[customerMessages.length - 1];
  let best = 0;
  // So compara com os 5 anteriores: repetir algo dito 20 turnos atras
  // e retomada de assunto, nao insistencia.
  for (const prev of customerMessages.slice(-6, -1)) {
    best = Math.max(best, jaccardTrigrams(last, prev));
  }
  // Abaixo de 0.45 e coincidencia de vocabulario do dominio.
  return best < 0.45 ? 0 : Math.min(1, (best - 0.45) / 0.35);
}

export function computeAbandonmentRisk({
  gapsMs,
  messageLengths,
  customerMessages,
  frustrationHits,
  turnCount,
  expectedTurns,
}) {
  const components = {
    latencyTrend: latencyTrendSignal(gapsMs),
    messageShrink: messageShrinkSignal(messageLengths),
    repetition: repetitionSignal(customerMessages),
    frustration: Math.min(1, frustrationHits / 2),
    turnOverrun:
      expectedTurns > 0 ? Math.max(0, Math.min(1, (turnCount - expectedTurns) / expectedTurns)) : 0,
  };

  const score = Object.entries(components).reduce(
    (acc, [key, value]) => acc + value * SIGNAL_WEIGHTS[key],
    0,
  );

  // Retorna os componentes junto com o total: sem isso, ninguem consegue
  // responder "por que essa conversa disparou" durante um incidente.
  return { score: Math.round(score), components };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dois detalhes desse código carregam quase todo o aprendizado de produção. O primeiro é a saturação em cada componente: sem teto, uma única conversa com pausa de duas horas produz um escore astronômico e monopoliza a fila de intervenção. O segundo é o retorno dos componentes junto do total. Escore sem decomposição é impossível de defender quando a operação pergunta por que uma conversa saudável foi marcada, e a resposta "o modelo achou" encerra a credibilidade da feature na primeira semana.',
        },
      ],
    },
    {
      title: 'Do sinal à ação: intervir sem estragar a conversa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Detectar sem agir gera um painel bonito e nenhum resultado, mas agir errado é pior que não agir. A intervenção mais comum é também a menos eficaz: mandar "ainda está aí?" quando o silêncio passa do limiar. Essa mensagem não adiciona informação nenhuma, transfere ao cliente o custo de responder algo que não interessa a ele e, num canal com notificação, interrompe alguém que talvez fosse voltar sozinho. Ela converte pausa em saída com frequência maior do que se imagina.',
        },
        {
          type: 'paragraph',
          value:
            'A regra que funciona é que toda intervenção precisa carregar valor novo. Se o sistema não tem nada a acrescentar, o certo é não dizer nada e apenas registrar. E o valor novo quase sempre vem de responder à causa do risco, não ao silêncio em si, que é onde a decomposição do escore deixa de ser diagnóstico e vira roteamento.',
        },
        {
          type: 'table',
          columns: ['Componente dominante', 'Interpretação', 'Ação recomendada', 'O que não fazer'],
          rows: [
            [
              'Repetição',
              'O agente não resolveu e o cliente insiste',
              'Oferecer transbordo para humano com o contexto pronto',
              'Reformular a mesma resposta com outras palavras',
            ],
            [
              'Frustração',
              'O cliente está irritado com o atendimento',
              'Escalar imediatamente, sem passo intermediário',
              'Pedir avaliação ou oferecer autoatendimento',
            ],
            [
              'Latência crescente',
              'Atenção dispersa, não necessariamente insatisfação',
              'Nada no primeiro limiar, resumo do estado no segundo',
              'Mandar lembrete curto a cada limiar',
            ],
            [
              'Encurtamento de mensagem',
              'Desengajamento, o cliente está encerrando',
              'Oferecer um caminho de saída útil e assíncrono',
              'Insistir com nova pergunta aberta',
            ],
            [
              'Excesso de turnos',
              'A conversa não converge para o desfecho',
              'Propor mudança de canal ou agendamento',
              'Continuar o mesmo fluxo por mais turnos',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A linha de latência crescente é a que mais economiza dinheiro e a que mais gente implementa errado. Silêncio isolado, sem nenhum outro sinal, quase sempre é pausa e a melhor ação é ausência de ação. Só faz sentido intervir no segundo limiar, e com uma mensagem que devolve o estado da conversa em vez de perguntar se o cliente continua ali, porque o resumo permite retomar sem reler tudo e o "ainda está aí?" só cobra uma resposta.',
        },
      ],
    },
    {
      title: 'Medir se a intervenção funcionou, não se ela disparou',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A métrica que quase todo time coloca no painel primeiro é o número de intervenções disparadas, e ela não significa absolutamente nada sobre valor. O que importa é a diferença de desfecho entre conversas em risco que receberam intervenção e conversas em risco que não receberam. Isso exige manter um grupo de controle permanente: uma fatia do tráfego em que o risco é calculado e registrado, mas nenhuma ação é tomada.',
        },
        {
          type: 'paragraph',
          value:
            'O controle permanente incomoda porque parece deixar dinheiro na mesa de propósito, e é exatamente o que faz. A alternativa é pior: sem ele, a taxa de recuperação observada mistura o efeito da intervenção com o efeito dos clientes que voltariam de qualquer forma, e essa parcela costuma ser grande. Um controle de cinco por cento é suficiente para medir o efeito e barato o bastante para não ser questionado no fim do trimestre.',
        },
        {
          type: 'ordered',
          items: [
            'Defina o que conta como desfecho por tipo de conversa antes de qualquer coisa, porque abandono é a ausência de desfecho e sem essa definição a métrica não existe.',
            'Meça a distribuição real de intervalos entre turnos por canal e por etapa, e derive os limiares dela em vez de escolher um número redondo.',
            'Implemente a verificação agendada com cancelamento no turno seguinte, garantindo idempotência para que reentrega de mensagem não dispare duas vezes.',
            'Comece com escore aditivo e componentes visíveis, deixando modelo para quando houver rótulo confiável acumulado.',
            'Roteie a ação pelo componente dominante do escore, nunca pelo total, porque o total não diz o que fazer.',
            'Mantenha um grupo de controle permanente de cinco por cento, sem o qual a taxa de recuperação é impossível de interpretar.',
            'Acompanhe a taxa de intervenção sobre conversas que terminariam bem, que é o custo real da política e o primeiro número a piorar quando o limiar fica agressivo demais.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O último item merece um alarme próprio. Uma política de abandono agressiva demais não falha de forma visível: ela produz mais mensagens, mais notificações e uma leve queda na satisfação que ninguém atribui à causa certa. O único jeito de enxergar isso é medir quantas conversas que atingiram desfecho positivo receberam intervenção pelo caminho. Se esse número passar de dez por cento, o limiar está errado e o sistema está incomodando gente que estava sendo bem atendida.',
        },
        {
          type: 'paragraph',
          value:
            'Vale fechar reconhecendo o limite da técnica. Detecção de abandono não conserta um agente que responde mal, não substitui um fluxo de transbordo que funcione e não recupera cliente que desistiu por preço. Ela faz uma coisa só, e faz bem: transforma uma perda invisível em uma perda mensurável, com causa atribuída. A decisão sobre o que fazer com essa informação continua sendo de produto, mas pela primeira vez é uma decisão tomada com dado em vez de intuição.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Qual é o tempo certo de silêncio para considerar uma conversa abandonada?',
      answer:
        'Não existe um número universal, e adotar um é a causa mais comum de a métrica não funcionar. O intervalo esperado entre turnos varia por canal em mais de uma ordem de grandeza: num widget de site, quarenta segundos de silêncio já é anormal porque o cliente está com a aba aberta na frente dele; no WhatsApp, quinze minutos é completamente rotineiro porque o canal é assíncrono e ninguém fica olhando a tela. O limiar precisa ser derivado da distribuição observada no seu tráfego, e um ponto de partida sólido é o percentil noventa dos intervalos em conversas que terminaram com desfecho positivo, com uma folga que evita disparar sobre comportamento normal. Além do canal, a etapa importa: a pausa depois de um pedido de número de documento significa que o cliente foi procurar o documento, e a pausa depois de uma pergunta simples significa outra coisa. E há canais em que o silêncio simplesmente não é sinal útil, como e-mail, onde vale ignorar o tempo e olhar apenas conteúdo.',
    },
    {
      question: 'Vale a pena treinar um modelo para prever abandono em vez de usar regras?',
      answer:
        'Vale, mas quase nunca como primeira versão, e o motivo é a falta de rótulo confiável. O cliente que sumiu não disse por que sumiu, então qualquer alvo de treino inicial é um proxy construído por você, e um proxy ruim ensina o modelo a prever a sua definição em vez do fenômeno real. Há um segundo motivo, operacional: no dia em que a operação contestar um disparo, um escore de modelo não é explicável e um escore aditivo é. Um escore com cinco componentes visíveis, cada um saturado individualmente, captura a maior parte do sinal disponível e permite ajustar um peso isolado quando um canal se comporta diferente. O modelo passa a valer quando existir volume de rótulo derivado de intervenção real, ou seja, quando você já souber quais conversas em risco voltaram após ação e quais voltariam sozinhas. Esse rótulo só se acumula se houver grupo de controle desde o começo, o que torna o controle um investimento na versão seguinte, e não só uma métrica.',
    },
    {
      question: 'Mandar "ainda está aí?" quando o cliente para de responder ajuda ou atrapalha?',
      answer:
        'Na maior parte dos casos atrapalha, e é a intervenção mais implementada justamente por ser a mais fácil. Ela não acrescenta informação nenhuma à conversa, transfere ao cliente o custo de responder algo que não interessa a ele e, num canal com notificação, interrompe alguém que possivelmente voltaria sozinho, convertendo pausa em saída. A regra que sustenta uma boa política é que toda intervenção precisa carregar valor novo: se o sistema não tem nada a acrescentar, o correto é não dizer nada e apenas registrar o risco. Quando há valor a entregar, ele deve responder à causa do risco e não ao silêncio. Se o componente dominante é repetição, a ação certa é transbordo para humano com o contexto pronto, porque o agente já demonstrou que não resolve. Se é frustração, é escalada imediata. Se é apenas latência crescente sem nenhum outro sinal, a melhor ação no primeiro limiar é nenhuma, e no segundo limiar um resumo do estado da conversa, que permite retomar sem reler tudo.',
    },
  ],
  conclusion: {
    title: 'A perda que não reclama é a que mais custa',
    description:
      'Abandono não é um evento que chega no webhook, é a ausência de um, e por isso exige inverter o fluxo: agendar uma verificação a cada turno e cancelá-la quando o cliente responde. Detectar bem começa por definir o que conta como desfecho, derivar limiares da distribuição real de cada canal e etapa em vez de escolher um número redondo, e usar os sinais que precedem o silêncio, porque quando ele chega o cliente já decidiu. Um escore aditivo com componentes visíveis é suficiente e defensável, e é o componente dominante, não o total, que decide qual ação tomar. Sem grupo de controle permanente, a taxa de recuperação mistura o efeito da intervenção com o dos clientes que voltariam sozinhos e nenhuma conclusão é possível. Posso instrumentar a detecção sobre o seu fluxo atual, calibrar os limiares com o seu histórico e desenhar a política de intervenção por causa em vez de por silêncio.',
    cta: 'Falar sobre abandono no meu atendimento',
  },
  related: [
    {
      label: 'Detectar deriva de qualidade antes do cliente reclamar',
      to: '/blog/detectar-deriva-qualidade-bot-atendimento-antes-do-cliente-reclamar',
    },
    { label: 'Handoff humano em atendimento com IA', to: '/blog/handoff-humano-whatsapp-ia' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

const en = {
  intro:
    'The unhappy customer who complains is the cheap one to handle: they say what is wrong, accept a fix and stay in the conversation. The expensive one simply stops replying. No ticket, no rating, no appearance in any quality metric, and the system files the conversation as complete because technically nobody interrupted it. That is silent abandonment, and it is usually the largest share of loss in an automated support operation precisely because it is invisible by construction. This article shows why abandonment is not an event but the absence of one, how to turn that absence into signal using evidence that already exists in the flow, what separates a customer who gave up from one who just went to lunch, how to decide whether intervening before the silence is worth it, and why the wrong intervention accelerates exactly the exit it was trying to prevent.',
  sections: [
    {
      title: 'Abandonment is not an event, it is the absence of one',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Every support system knows how to record what happens. Message received, reply sent, handoff to a human, rating submitted. Abandonment is none of those: it is the moment the next expected message does not arrive. Since there is no corresponding event, it cannot be captured by a handler, which is why most teams discover the problem months later, when they cross the conversation funnel with the conversion funnel and notice that a third of conversations end with no recorded outcome.',
        },
        {
          type: 'paragraph',
          value:
            'The practical consequence is that detecting abandonment requires inverting the architecture of the flow. Instead of reacting to messages, the system must schedule a future check on every turn and cancel it when the customer replies. Abandonment is that check firing without a cancellation. This sounds like an implementation detail, but it defines everything that follows: it means detection costs scale with open conversations rather than with exchanged messages, and that any abandonment policy has to be cheap enough to run over one hundred percent of traffic.',
        },
        {
          type: 'diagram',
          value: `turn N: customer sends message
   |
   +-- cancel pending check for the conversation
   +-- agent replies
   +-- schedule check at T (silence deadline)
   |
   +--> customer replies before T
   |       -> cancel, move to turn N+1, healthy conversation
   |
   +--> T expires with no reply
           -> evaluate state at the moment of silence
              |
              +-- outcome already reached -> natural close, not abandonment
              +-- no outcome + low risk    -> passive abandonment, record only
              +-- no outcome + high risk   -> active abandonment, take action`,
        },
        {
          type: 'paragraph',
          value:
            'The most important branch of the diagram is the first one under expiration, and it is the one nearly every team forgets. Silence after "thanks, that was it" is not abandonment, it is a close. Counting both together produces an inflated abandonment rate nobody can act on, because half of it is made of successful conversations. The first thing to do before measuring abandonment is to define what counts as an outcome in your domain, and that definition belongs to product, not to engineering.',
        },
      ],
    },
    {
      title: 'Silence is not giving up: separating a pause from an exit',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common mistake in a first version of abandonment detection is using a single silence timeout for everything. Thirty seconds without a reply in a website chat is abnormal, and thirty minutes on WhatsApp is entirely normal, because the channel is asynchronous by nature and the customer went to lunch. A fixed threshold applied across different channels produces mass false positives on the asynchronous one and false negatives on the synchronous one, and the team concludes the metric does not work when what does not work is the threshold.',
        },
        {
          type: 'paragraph',
          value:
            'The threshold has to be derived from the real distribution of inter-turn intervals, per channel and per conversation stage. A good starting point is the ninetieth percentile of intervals observed in conversations that ended with a positive outcome: if ninety percent of pauses from customers who solved their problem are under four minutes, a twelve-minute pause on that channel carries information. And the threshold has to vary by stage, because a pause after a simple question means something very different from a pause after a request for sensitive data, where the customer legitimately left to find a document.',
        },
        {
          type: 'table',
          columns: ['Channel', 'Conversation stage', 'Expected silence (p90)', 'Risk threshold', 'Reading of the silence'],
          rows: [
            ['Website widget', 'Opening question', '40 s', '3 min', 'High chance of exit, tab closed'],
            ['Website widget', 'Collecting account data', '90 s', '6 min', 'May be looking information up'],
            ['WhatsApp', 'Opening question', '4 min', '25 min', 'Asynchronous, pausing is common'],
            ['WhatsApp', 'Payment confirmation', '2 min', '10 min', 'Hesitation, not distraction'],
            ['Authenticated app', 'Technical diagnosis', '3 min', '15 min', 'Customer may be testing something'],
            ['Email', 'Any stage', '4 h', '48 h', 'Silence is not a useful signal'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row exists to make explicit that email is the case where silence-based detection simply does not pay off. When the channel is slow by nature, the interval between turns carries so little information about customer intent that any threshold becomes noise, and the effort should go into content signals instead. Recognizing where the technique does not apply saves a quarter of parameter tuning that would never converge.',
        },
      ],
    },
    {
      title: 'Signals that appear before the silence',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Silence is the latest possible signal: by the time it arrives, the customer has already decided. The real value lies in the signals that precede the decision, and all of them already exist in the flow with no new instrumentation. Three families cover almost everything. The first is behavioral and measures how the customer writes: reply latency climbing turn after turn, messages getting shorter, one-word answers where there used to be sentences. The second is semantic and measures content: the same question rephrased, explicit frustration markers, asking for a human. The third is structural and measures the conversation as a whole: turn count above what that intent normally needs, no progress toward the outcome.',
        },
        {
          type: 'paragraph',
          value:
            'The obvious temptation is to throw all of that into a model and ask for an abandonment probability. It is worth resisting in the first version, for two reasons. The first is that there is no reliable label early on: the customer who vanished did not say why, so the training target has to be built by proxy, and a bad proxy teaches the model to predict your definition instead of the phenomenon. The second is operational: a model score is not explainable during an incident, whereas a simple additive score is auditable, tunable and enough to capture most of the signal.',
        },
        {
          type: 'code',
          value: `// abandonment/risk-score.js
// Additive abandonment risk score, computed on every customer turn.
// Deliberately model-free: each component is auditable and tunable in
// isolation, which matters when operations disputes a trigger.

const SIGNAL_WEIGHTS = {
  latencyTrend: 25,      // customer taking longer and longer to reply
  messageShrink: 15,     // messages shrinking across the conversation
  repetition: 30,        // same question rephrased, agent did not solve it
  frustration: 20,       // explicit lexical marker of irritation
  turnOverrun: 10,       // conversation longer than expected for the intent
};

// Latency trend: compares the median of the last 3 gaps with the first 3.
// Median rather than mean, because one long pause (the customer took a
// phone call) must not dominate the signal.
function latencyTrendSignal(gapsMs) {
  if (gapsMs.length < 6) return 0;
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const early = median(gapsMs.slice(0, 3));
  const recent = median(gapsMs.slice(-3));
  if (early === 0) return 0;
  const ratio = recent / early;
  // Under 2x is normal variation. Above 4x it saturates: doubling again
  // carries no extra information, and letting it grow unbounded lets a
  // single component decide the score on its own.
  return Math.max(0, Math.min(1, (ratio - 2) / 2));
}

// Shrink: ratio between the average length of the latest messages and the
// first ones. "ok" after three paragraphs is disengagement.
function messageShrinkSignal(lengths) {
  if (lengths.length < 4) return 0;
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const early = avg(lengths.slice(0, 2));
  const recent = avg(lengths.slice(-2));
  if (early === 0) return 0;
  return Math.max(0, Math.min(1, 1 - recent / early));
}

// Repetition: the customer rephrased the same question. Character trigram
// similarity is cheap and robust to writing variation, which embeddings
// also handle, at the price of a network call per turn.
function jaccardTrigrams(a, b) {
  const grams = (s) => {
    const t = s.toLowerCase().replace(/\\s+/g, ' ').trim();
    const out = new Set();
    for (let i = 0; i + 3 <= t.length; i += 1) out.add(t.slice(i, i + 3));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter += 1;
  return inter / (ga.size + gb.size - inter);
}

function repetitionSignal(customerMessages) {
  if (customerMessages.length < 2) return 0;
  const last = customerMessages[customerMessages.length - 1];
  let best = 0;
  // Only compares against the previous 5: repeating something said 20
  // turns ago is picking a topic back up, not insisting.
  for (const prev of customerMessages.slice(-6, -1)) {
    best = Math.max(best, jaccardTrigrams(last, prev));
  }
  // Below 0.45 it is just domain vocabulary overlap.
  return best < 0.45 ? 0 : Math.min(1, (best - 0.45) / 0.35);
}

export function computeAbandonmentRisk({
  gapsMs,
  messageLengths,
  customerMessages,
  frustrationHits,
  turnCount,
  expectedTurns,
}) {
  const components = {
    latencyTrend: latencyTrendSignal(gapsMs),
    messageShrink: messageShrinkSignal(messageLengths),
    repetition: repetitionSignal(customerMessages),
    frustration: Math.min(1, frustrationHits / 2),
    turnOverrun:
      expectedTurns > 0 ? Math.max(0, Math.min(1, (turnCount - expectedTurns) / expectedTurns)) : 0,
  };

  const score = Object.entries(components).reduce(
    (acc, [key, value]) => acc + value * SIGNAL_WEIGHTS[key],
    0,
  );

  // Returns the components alongside the total: without this, nobody can
  // answer "why did this conversation trigger" during an incident.
  return { score: Math.round(score), components };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Two details in that code carry almost all of the production learning. The first is the saturation in each component: with no ceiling, a single conversation with a two-hour pause produces an astronomical score and monopolizes the intervention queue. The second is returning the components alongside the total. A score without decomposition is impossible to defend when operations asks why a healthy conversation was flagged, and answering "the model thought so" ends the feature credibility in the first week.',
        },
      ],
    },
    {
      title: 'From signal to action: intervening without ruining the conversation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Detecting without acting produces a nice dashboard and no result, but acting wrongly is worse than not acting. The most common intervention is also the least effective: sending "are you still there?" when silence crosses the threshold. That message adds no information, shifts onto the customer the cost of replying to something they do not care about, and on a channel with push notifications it interrupts someone who might have come back on their own. It converts pauses into exits more often than people assume.',
        },
        {
          type: 'paragraph',
          value:
            'The rule that works is that every intervention must carry new value. If the system has nothing to add, the right move is to say nothing and simply record. And the new value almost always comes from responding to the cause of the risk rather than to the silence itself, which is where the score decomposition stops being diagnostics and becomes routing.',
        },
        {
          type: 'table',
          columns: ['Dominant component', 'Interpretation', 'Recommended action', 'What not to do'],
          rows: [
            [
              'Repetition',
              'The agent did not solve it and the customer insists',
              'Offer a human handoff with the context already prepared',
              'Rephrase the same answer in different words',
            ],
            [
              'Frustration',
              'The customer is irritated with the support experience',
              'Escalate immediately, with no intermediate step',
              'Ask for a rating or offer self-service',
            ],
            [
              'Rising latency',
              'Divided attention, not necessarily dissatisfaction',
              'Nothing at the first threshold, state summary at the second',
              'Send a short reminder at every threshold',
            ],
            [
              'Message shrinking',
              'Disengagement, the customer is wrapping up',
              'Offer a useful asynchronous exit path',
              'Push another open-ended question',
            ],
            [
              'Turn overrun',
              'The conversation is not converging on an outcome',
              'Propose a channel change or a scheduled call',
              'Keep running the same flow for more turns',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The rising latency row is the one that saves the most money and the one most people implement wrong. Isolated silence, with no other signal present, is almost always a pause and the best action is no action. Intervening only makes sense at the second threshold, and with a message that gives the conversation state back instead of asking whether the customer is still there, because a summary lets them resume without rereading everything while "are you still there?" only demands a reply.',
        },
      ],
    },
    {
      title: 'Measure whether the intervention worked, not whether it fired',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The metric almost every team puts on the dashboard first is the number of interventions fired, and it says absolutely nothing about value. What matters is the outcome difference between at-risk conversations that received an intervention and at-risk conversations that did not. That requires keeping a permanent control group: a slice of traffic where the risk is computed and recorded but no action is taken.',
        },
        {
          type: 'paragraph',
          value:
            'A permanent control group feels uncomfortable because it looks like leaving money on the table on purpose, and that is exactly what it does. The alternative is worse: without it, the observed recovery rate mixes the effect of the intervention with the effect of customers who would have come back anyway, and that share is usually large. A five percent control is enough to measure the effect and cheap enough not to be challenged at the end of the quarter.',
        },
        {
          type: 'ordered',
          items: [
            'Define what counts as an outcome per conversation type before anything else, because abandonment is the absence of an outcome and without that definition the metric does not exist.',
            'Measure the real distribution of inter-turn intervals per channel and per stage, and derive thresholds from it instead of picking a round number.',
            'Implement the scheduled check with cancellation on the next turn, making it idempotent so message redelivery does not fire it twice.',
            'Start with an additive score and visible components, leaving models for when reliable labels have accumulated.',
            'Route the action by the dominant component of the score, never by the total, because the total does not say what to do.',
            'Keep a permanent five percent control group, without which the recovery rate is impossible to interpret.',
            'Track the intervention rate over conversations that would have ended well, which is the real cost of the policy and the first number to degrade when the threshold gets too aggressive.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last item deserves an alarm of its own. An overly aggressive abandonment policy does not fail visibly: it produces more messages, more notifications and a slight drop in satisfaction that nobody attributes to the right cause. The only way to see it is to measure how many conversations that reached a positive outcome received an intervention along the way. If that number goes above ten percent, the threshold is wrong and the system is bothering people who were being served well.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth closing by acknowledging the limits of the technique. Abandonment detection does not fix an agent that answers badly, does not replace a handoff flow that actually works, and does not recover a customer who left over price. It does one thing, and does it well: it turns an invisible loss into a measurable one, with an attributed cause. Deciding what to do with that information is still a product call, but for the first time it is a call made with data instead of intuition.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'What is the right silence timeout for considering a conversation abandoned?',
      answer:
        'There is no universal number, and adopting one is the most common reason the metric fails to work. Expected inter-turn intervals vary across channels by more than an order of magnitude: in a website widget, forty seconds of silence is already abnormal because the customer has the tab open in front of them; on WhatsApp, fifteen minutes is entirely routine because the channel is asynchronous and nobody stares at the screen. The threshold has to be derived from the distribution observed in your own traffic, and a solid starting point is the ninetieth percentile of intervals in conversations that ended with a positive outcome, plus a margin that avoids firing on normal behavior. Beyond the channel, the stage matters: a pause after a request for a document number means the customer went to find the document, and a pause after a simple question means something else. And there are channels where silence is simply not a useful signal, such as email, where it is better to ignore timing and look only at content.',
    },
    {
      question: 'Is it worth training a model to predict abandonment instead of using rules?',
      answer:
        'It is, but almost never as a first version, and the reason is the lack of reliable labels. The customer who vanished did not say why, so any initial training target is a proxy you built yourself, and a bad proxy teaches the model to predict your definition rather than the actual phenomenon. There is a second, operational reason: on the day operations disputes a trigger, a model score is not explainable and an additive score is. A score with five visible components, each individually saturated, captures most of the available signal and lets you tune a single weight when one channel behaves differently. A model becomes worthwhile once you have label volume derived from real interventions, meaning you already know which at-risk conversations came back after action and which would have come back on their own. That label only accumulates if a control group exists from the start, which makes the control an investment in the next version, not just a metric.',
    },
    {
      question: 'Does sending "are you still there?" when the customer goes quiet help or hurt?',
      answer:
        'In most cases it hurts, and it is the most widely implemented intervention precisely because it is the easiest. It adds no information to the conversation, shifts onto the customer the cost of replying to something they do not care about, and on a channel with push notifications it interrupts someone who might well have returned on their own, converting a pause into an exit. The rule that holds a good policy together is that every intervention must carry new value: if the system has nothing to add, the correct move is to say nothing and simply record the risk. When there is value to deliver, it should respond to the cause of the risk rather than to the silence. If the dominant component is repetition, the right action is a human handoff with the context already prepared, because the agent has already demonstrated it cannot solve it. If it is frustration, it is immediate escalation. If it is only rising latency with no other signal, the best action at the first threshold is none, and at the second threshold a summary of the conversation state, which lets the customer resume without rereading everything.',
    },
  ],
  conclusion: {
    title: 'The loss that never complains is the one that costs the most',
    description:
      'Abandonment is not an event arriving on a webhook, it is the absence of one, which is why it requires inverting the flow: schedule a check on every turn and cancel it when the customer replies. Detecting it well starts by defining what counts as an outcome, deriving thresholds from the real distribution of each channel and stage instead of picking a round number, and using the signals that precede the silence, because once it arrives the customer has already decided. An additive score with visible components is sufficient and defensible, and it is the dominant component, not the total, that decides which action to take. Without a permanent control group, the recovery rate mixes the effect of the intervention with that of customers who would have returned anyway and no conclusion is possible. I can instrument detection over your current flow, calibrate thresholds from your history and design an intervention policy driven by cause rather than by silence.',
    cta: 'Talk about abandonment in my support flow',
  },
  related: [
    {
      label: 'Detecting quality drift before customers complain',
      to: '/blog/detectar-deriva-qualidade-bot-atendimento-antes-do-cliente-reclamar',
    },
    { label: 'Human handoff in AI-driven support', to: '/blog/handoff-humano-whatsapp-ia' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
};

const es = {
  intro:
    'El cliente insatisfecho que reclama es el barato de atender: dice qué está mal, acepta una corrección y sigue en la conversación. El caro es el que simplemente deja de responder. No abre ticket, no evalúa la atención, no aparece en ninguna métrica de calidad, y el sistema registra la conversación como concluida porque técnicamente nadie la interrumpió. Ese es el abandono silencioso, y suele ser la mayor porción de pérdida de una atención automatizada justamente porque es invisible por construcción. Este artículo muestra por qué el abandono no es un evento sino la ausencia de uno, cómo convertir esa ausencia en señal usando evidencia que ya existe en el flujo, cuál es la diferencia entre un cliente que desistió y uno que solo salió a almorzar, cómo decidir si vale intervenir antes del silencio y por qué la intervención equivocada acelera exactamente la salida que intentaba evitar.',
  sections: [
    {
      title: 'El abandono no es un evento, es la ausencia de uno',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo sistema de atención sabe registrar lo que ocurre. Mensaje recibido, respuesta enviada, transferencia a humano, evaluación completada. El abandono no es nada de eso: es el momento en que el siguiente mensaje esperado no llega. Como no existe un evento correspondiente, no puede capturarse con un handler, y por eso la mayoría de los equipos descubre el problema meses después, al cruzar el embudo de conversaciones con el de conversiones y notar que un tercio de las conversaciones termina sin desenlace registrado.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia práctica es que detectar abandono exige invertir la arquitectura del flujo. En lugar de reaccionar a mensajes, el sistema necesita agendar una verificación futura en cada turno y cancelarla cuando el cliente responde. El abandono es el disparo de esa verificación sin cancelación. Parece un detalle de implementación, pero define todo lo que viene después: significa que la detección tiene costo por conversación abierta y no por mensaje intercambiado, y que cualquier política de abandono debe ser lo bastante barata como para correr sobre el cien por ciento del tráfico.',
        },
        {
          type: 'diagram',
          value: `turno N: cliente envia mensaje
   |
   +-- cancela verificacion pendiente de la conversacion
   +-- el agente responde
   +-- agenda verificacion en T (deadline de silencio)
   |
   +--> el cliente responde antes de T
   |       -> cancela, pasa al turno N+1, conversacion sana
   |
   +--> T expira sin respuesta
           -> evalua el estado en el momento del silencio
              |
              +-- desenlace ya alcanzado -> cierre natural, no es abandono
              +-- sin desenlace + riesgo bajo -> abandono pasivo, solo registra
              +-- sin desenlace + riesgo alto -> abandono activo, dispara accion`,
        },
        {
          type: 'paragraph',
          value:
            'La rama más importante del diagrama es la primera del bloque de expiración, y es la que casi todo equipo olvida. El silencio después de "gracias, era eso" no es abandono, es cierre. Contar ambos juntos produce una tasa de abandono inflada sobre la que nadie puede accionar, porque la mitad está compuesta de conversaciones exitosas. Lo primero que hay que hacer antes de medir abandono es definir qué cuenta como desenlace en tu dominio, y esa definición es de producto, no de ingeniería.',
        },
      ],
    },
    {
      title: 'El silencio no es desistir: separar pausa de salida',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error más común en la primera versión de una detección de abandono es usar un único tiempo de silencio para todo. Treinta segundos sin respuesta en un chat de sitio es anormal, y treinta minutos en WhatsApp es completamente normal, porque el canal es asíncrono por naturaleza y el cliente salió a almorzar. Un umbral fijo aplicado a canales distintos produce falsos positivos masivos en el canal asíncrono y falsos negativos en el síncrono, y el equipo concluye que la métrica no funciona cuando lo que no funciona es el umbral.',
        },
        {
          type: 'paragraph',
          value:
            'El umbral tiene que derivarse de la distribución real de intervalos entre turnos, por canal y por etapa de la conversación. Un buen punto de partida es el percentil noventa de los intervalos observados en conversaciones que terminaron con desenlace positivo: si el noventa por ciento de las pausas de clientes que resolvieron su problema son menores a cuatro minutos, una pausa de doce minutos en ese canal carga información. Y el umbral debe variar por etapa, porque la pausa después de una pregunta simple significa algo muy distinto de la pausa después de un pedido de dato sensible, donde el cliente legítimamente salió a buscar un documento.',
        },
        {
          type: 'table',
          columns: ['Canal', 'Etapa de la conversación', 'Silencio esperado (p90)', 'Umbral de riesgo', 'Lectura del silencio'],
          rows: [
            ['Widget en el sitio', 'Pregunta inicial', '40 s', '3 min', 'Alta chance de salida, pestaña cerrada'],
            ['Widget en el sitio', 'Recolección de dato de cuenta', '90 s', '6 min', 'Puede estar buscando información'],
            ['WhatsApp', 'Pregunta inicial', '4 min', '25 min', 'Asíncrono, la pausa es común'],
            ['WhatsApp', 'Confirmación de pago', '2 min', '10 min', 'Duda, no distracción'],
            ['App autenticada', 'Diagnóstico técnico', '3 min', '15 min', 'El cliente puede estar probando'],
            ['Correo', 'Cualquier etapa', '4 h', '48 h', 'El silencio no es señal útil'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila existe para dejar explícito que el correo es el caso en el que la detección por silencio simplemente no rinde. Cuando el canal es lento por naturaleza, el intervalo entre turnos carga tan poca información sobre la intención del cliente que cualquier umbral se vuelve ruido, y el esfuerzo debe ir a señales de contenido. Reconocer dónde la técnica no aplica ahorra un trimestre de ajuste de parámetros que nunca convergería.',
        },
      ],
    },
    {
      title: 'Señales que aparecen antes del silencio',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El silencio es la señal más tardía posible: cuando llega, el cliente ya decidió. El valor real está en las señales que preceden la decisión, y todas ellas ya existen en el flujo sin instrumentación nueva. Tres familias cubren casi todo. La primera es conductual y mide cómo escribe el cliente: latencia de respuesta subiendo turno a turno, mensajes acortándose, monosílabos donde antes había frases. La segunda es semántica y mide el contenido: repetición de la misma pregunta con otras palabras, marcadores explícitos de frustración, pedido de humano. La tercera es estructural y mide la conversación completa: cantidad de turnos por encima de lo esperado para esa intención, ausencia de progreso hacia el desenlace.',
        },
        {
          type: 'paragraph',
          value:
            'La tentación obvia es meter todo eso en un modelo y pedir una probabilidad de abandono. Vale resistirla en la primera versión, por dos motivos. El primero es que no existe etiqueta confiable al comienzo: el cliente que desapareció no dijo por qué, así que el objetivo de entrenamiento hay que construirlo por proxy, y un proxy malo enseña al modelo a predecir la definición en vez del fenómeno. El segundo es operativo: un score de modelo no es explicable durante un incidente, mientras que un score aditivo simple es auditable, ajustable y suficiente para capturar la mayor parte de la señal.',
        },
        {
          type: 'code',
          value: `// abandonment/risk-score.js
// Score aditivo de riesgo de abandono, calculado en cada turno del cliente.
// Deliberadamente sin modelo: cada componente es auditable y ajustable de
// forma aislada, lo que importa cuando operaciones cuestiona un disparo.

const SIGNAL_WEIGHTS = {
  latencyTrend: 25,      // el cliente tarda cada vez mas en responder
  messageShrink: 15,     // mensajes acortandose a lo largo de la conversacion
  repetition: 30,        // misma pregunta reformulada, el agente no resolvio
  frustration: 20,       // marcador lexico explicito de irritacion
  turnOverrun: 10,       // conversacion mas larga de lo esperado para la intencion
};

// Tendencia de latencia: compara la mediana de los 3 ultimos intervalos con
// la de los 3 primeros. Mediana, y no media, porque una unica pausa larga
// (el cliente atendio el telefono) no debe dominar la senal.
function latencyTrendSignal(gapsMs) {
  if (gapsMs.length < 6) return 0;
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };
  const early = median(gapsMs.slice(0, 3));
  const recent = median(gapsMs.slice(-3));
  if (early === 0) return 0;
  const ratio = recent / early;
  // Debajo de 2x es variacion normal. Arriba de 4x satura: duplicar otra
  // vez no aporta mas informacion, y dejarlo crecer sin techo hace que un
  // solo componente decida el score por si mismo.
  return Math.max(0, Math.min(1, (ratio - 2) / 2));
}

// Acortamiento: razon entre el largo promedio de los ultimos mensajes y el
// de los primeros. "ok" despues de tres parrafos es desenganche.
function messageShrinkSignal(lengths) {
  if (lengths.length < 4) return 0;
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const early = avg(lengths.slice(0, 2));
  const recent = avg(lengths.slice(-2));
  if (early === 0) return 0;
  return Math.max(0, Math.min(1, 1 - recent / early));
}

// Repeticion: el cliente reformulo la misma pregunta. La similaridad por
// trigramas de caracter es barata y resiste variacion de escritura, algo
// que el embedding tambien hace, pero costando una llamada de red por turno.
function jaccardTrigrams(a, b) {
  const grams = (s) => {
    const t = s.toLowerCase().replace(/\\s+/g, ' ').trim();
    const out = new Set();
    for (let i = 0; i + 3 <= t.length; i += 1) out.add(t.slice(i, i + 3));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter += 1;
  return inter / (ga.size + gb.size - inter);
}

function repetitionSignal(customerMessages) {
  if (customerMessages.length < 2) return 0;
  const last = customerMessages[customerMessages.length - 1];
  let best = 0;
  // Solo compara con los 5 anteriores: repetir algo dicho 20 turnos atras
  // es retomar un tema, no insistir.
  for (const prev of customerMessages.slice(-6, -1)) {
    best = Math.max(best, jaccardTrigrams(last, prev));
  }
  // Debajo de 0.45 es coincidencia de vocabulario del dominio.
  return best < 0.45 ? 0 : Math.min(1, (best - 0.45) / 0.35);
}

export function computeAbandonmentRisk({
  gapsMs,
  messageLengths,
  customerMessages,
  frustrationHits,
  turnCount,
  expectedTurns,
}) {
  const components = {
    latencyTrend: latencyTrendSignal(gapsMs),
    messageShrink: messageShrinkSignal(messageLengths),
    repetition: repetitionSignal(customerMessages),
    frustration: Math.min(1, frustrationHits / 2),
    turnOverrun:
      expectedTurns > 0 ? Math.max(0, Math.min(1, (turnCount - expectedTurns) / expectedTurns)) : 0,
  };

  const score = Object.entries(components).reduce(
    (acc, [key, value]) => acc + value * SIGNAL_WEIGHTS[key],
    0,
  );

  // Devuelve los componentes junto con el total: sin esto, nadie puede
  // responder "por que disparo esta conversacion" durante un incidente.
  return { score: Math.round(score), components };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dos detalles de ese código cargan casi todo el aprendizaje de producción. El primero es la saturación en cada componente: sin techo, una única conversación con una pausa de dos horas produce un score astronómico y monopoliza la cola de intervención. El segundo es devolver los componentes junto con el total. Un score sin descomposición es imposible de defender cuando operaciones pregunta por qué se marcó una conversación sana, y responder "el modelo lo consideró así" termina con la credibilidad de la feature en la primera semana.',
        },
      ],
    },
    {
      title: 'De la señal a la acción: intervenir sin arruinar la conversación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Detectar sin actuar genera un panel bonito y ningún resultado, pero actuar mal es peor que no actuar. La intervención más común es también la menos eficaz: mandar "¿sigues ahí?" cuando el silencio pasa el umbral. Ese mensaje no agrega ninguna información, transfiere al cliente el costo de responder algo que no le interesa y, en un canal con notificación, interrumpe a alguien que quizá volvería solo. Convierte pausas en salidas con más frecuencia de lo que se supone.',
        },
        {
          type: 'paragraph',
          value:
            'La regla que funciona es que toda intervención debe cargar valor nuevo. Si el sistema no tiene nada que agregar, lo correcto es no decir nada y solo registrar. Y el valor nuevo casi siempre viene de responder a la causa del riesgo, no al silencio en sí, que es donde la descomposición del score deja de ser diagnóstico y se vuelve enrutamiento.',
        },
        {
          type: 'table',
          columns: ['Componente dominante', 'Interpretación', 'Acción recomendada', 'Qué no hacer'],
          rows: [
            [
              'Repetición',
              'El agente no resolvió y el cliente insiste',
              'Ofrecer transferencia a humano con el contexto listo',
              'Reformular la misma respuesta con otras palabras',
            ],
            [
              'Frustración',
              'El cliente está irritado con la atención',
              'Escalar de inmediato, sin paso intermedio',
              'Pedir evaluación u ofrecer autoservicio',
            ],
            [
              'Latencia creciente',
              'Atención dispersa, no necesariamente insatisfacción',
              'Nada en el primer umbral, resumen del estado en el segundo',
              'Mandar un recordatorio corto en cada umbral',
            ],
            [
              'Acortamiento de mensaje',
              'Desenganche, el cliente está cerrando',
              'Ofrecer un camino de salida útil y asíncrono',
              'Insistir con otra pregunta abierta',
            ],
            [
              'Exceso de turnos',
              'La conversación no converge al desenlace',
              'Proponer cambio de canal o agendamiento',
              'Seguir con el mismo flujo por más turnos',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La fila de latencia creciente es la que más dinero ahorra y la que más gente implementa mal. El silencio aislado, sin ninguna otra señal, casi siempre es pausa y la mejor acción es la ausencia de acción. Solo tiene sentido intervenir en el segundo umbral, y con un mensaje que devuelve el estado de la conversación en vez de preguntar si el cliente sigue ahí, porque el resumen permite retomar sin releer todo y el "¿sigues ahí?" solo exige una respuesta.',
        },
      ],
    },
    {
      title: 'Medir si la intervención funcionó, no si se disparó',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La métrica que casi todo equipo pone primero en el panel es la cantidad de intervenciones disparadas, y no significa absolutamente nada sobre valor. Lo que importa es la diferencia de desenlace entre conversaciones en riesgo que recibieron intervención y conversaciones en riesgo que no la recibieron. Eso exige mantener un grupo de control permanente: una porción del tráfico donde el riesgo se calcula y se registra, pero no se toma ninguna acción.',
        },
        {
          type: 'paragraph',
          value:
            'El control permanente incomoda porque parece dejar dinero sobre la mesa a propósito, y es exactamente lo que hace. La alternativa es peor: sin él, la tasa de recuperación observada mezcla el efecto de la intervención con el efecto de los clientes que habrían vuelto de todos modos, y esa porción suele ser grande. Un control de cinco por ciento alcanza para medir el efecto y es lo bastante barato como para no ser cuestionado al cierre del trimestre.',
        },
        {
          type: 'ordered',
          items: [
            'Define qué cuenta como desenlace por tipo de conversación antes que nada, porque el abandono es la ausencia de desenlace y sin esa definición la métrica no existe.',
            'Mide la distribución real de intervalos entre turnos por canal y por etapa, y deriva los umbrales de ella en vez de elegir un número redondo.',
            'Implementa la verificación agendada con cancelación en el turno siguiente, garantizando idempotencia para que la reentrega de mensajes no dispare dos veces.',
            'Empieza con score aditivo y componentes visibles, dejando el modelo para cuando haya etiquetas confiables acumuladas.',
            'Enruta la acción por el componente dominante del score, nunca por el total, porque el total no dice qué hacer.',
            'Mantén un grupo de control permanente de cinco por ciento, sin el cual la tasa de recuperación es imposible de interpretar.',
            'Sigue la tasa de intervención sobre conversaciones que habrían terminado bien, que es el costo real de la política y el primer número que empeora cuando el umbral se vuelve demasiado agresivo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El último ítem merece una alarma propia. Una política de abandono demasiado agresiva no falla de forma visible: produce más mensajes, más notificaciones y una leve caída de satisfacción que nadie atribuye a la causa correcta. La única manera de verlo es medir cuántas conversaciones que alcanzaron un desenlace positivo recibieron intervención en el camino. Si ese número pasa del diez por ciento, el umbral está mal y el sistema está molestando a gente que estaba siendo bien atendida.',
        },
        {
          type: 'paragraph',
          value:
            'Vale cerrar reconociendo el límite de la técnica. La detección de abandono no arregla un agente que responde mal, no reemplaza un flujo de transferencia que funcione y no recupera al cliente que desistió por precio. Hace una sola cosa, y la hace bien: convierte una pérdida invisible en una pérdida medible, con causa atribuida. La decisión sobre qué hacer con esa información sigue siendo de producto, pero por primera vez es una decisión tomada con datos en vez de intuición.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cuál es el tiempo correcto de silencio para considerar abandonada una conversación?',
      answer:
        'No existe un número universal, y adoptar uno es la causa más común de que la métrica no funcione. El intervalo esperado entre turnos varía por canal en más de un orden de magnitud: en un widget de sitio, cuarenta segundos de silencio ya es anormal porque el cliente tiene la pestaña abierta delante; en WhatsApp, quince minutos es completamente rutinario porque el canal es asíncrono y nadie mira la pantalla. El umbral debe derivarse de la distribución observada en tu propio tráfico, y un punto de partida sólido es el percentil noventa de los intervalos en conversaciones que terminaron con desenlace positivo, con un margen que evita disparar sobre comportamiento normal. Además del canal, la etapa importa: la pausa después de pedir un número de documento significa que el cliente salió a buscarlo, y la pausa después de una pregunta simple significa otra cosa. Y hay canales donde el silencio simplemente no es señal útil, como el correo, donde conviene ignorar el tiempo y mirar solo el contenido.',
    },
    {
      question: '¿Conviene entrenar un modelo para predecir abandono en vez de usar reglas?',
      answer:
        'Conviene, pero casi nunca como primera versión, y el motivo es la falta de etiquetas confiables. El cliente que desapareció no dijo por qué, así que cualquier objetivo de entrenamiento inicial es un proxy construido por ti, y un proxy malo enseña al modelo a predecir tu definición en vez del fenómeno real. Hay un segundo motivo, operativo: el día en que operaciones cuestione un disparo, un score de modelo no es explicable y uno aditivo sí. Un score con cinco componentes visibles, cada uno saturado individualmente, captura la mayor parte de la señal disponible y permite ajustar un peso aislado cuando un canal se comporta distinto. El modelo pasa a valer cuando exista volumen de etiquetas derivadas de intervención real, es decir, cuando ya sepas qué conversaciones en riesgo volvieron tras la acción y cuáles habrían vuelto solas. Esa etiqueta solo se acumula si hay grupo de control desde el comienzo, lo que convierte al control en una inversión para la versión siguiente, y no solo en una métrica.',
    },
    {
      question: '¿Mandar "¿sigues ahí?" cuando el cliente deja de responder ayuda o perjudica?',
      answer:
        'En la mayoría de los casos perjudica, y es la intervención más implementada justamente por ser la más fácil. No agrega ninguna información a la conversación, transfiere al cliente el costo de responder algo que no le interesa y, en un canal con notificación, interrumpe a alguien que posiblemente volvería solo, convirtiendo una pausa en una salida. La regla que sostiene una buena política es que toda intervención debe cargar valor nuevo: si el sistema no tiene nada que agregar, lo correcto es no decir nada y solo registrar el riesgo. Cuando hay valor que entregar, debe responder a la causa del riesgo y no al silencio. Si el componente dominante es repetición, la acción correcta es la transferencia a humano con el contexto listo, porque el agente ya demostró que no resuelve. Si es frustración, es escalada inmediata. Si es solo latencia creciente sin ninguna otra señal, la mejor acción en el primer umbral es ninguna, y en el segundo umbral un resumen del estado de la conversación, que permite retomar sin releer todo.',
    },
  ],
  conclusion: {
    title: 'La pérdida que no reclama es la que más cuesta',
    description:
      'El abandono no es un evento que llega al webhook, es la ausencia de uno, y por eso exige invertir el flujo: agendar una verificación en cada turno y cancelarla cuando el cliente responde. Detectar bien empieza por definir qué cuenta como desenlace, derivar los umbrales de la distribución real de cada canal y etapa en vez de elegir un número redondo, y usar las señales que preceden al silencio, porque cuando este llega el cliente ya decidió. Un score aditivo con componentes visibles es suficiente y defendible, y es el componente dominante, no el total, el que decide qué acción tomar. Sin grupo de control permanente, la tasa de recuperación mezcla el efecto de la intervención con el de los clientes que habrían vuelto solos y ninguna conclusión es posible. Puedo instrumentar la detección sobre tu flujo actual, calibrar los umbrales con tu histórico y diseñar la política de intervención por causa en vez de por silencio.',
    cta: 'Hablar sobre el abandono en mi atención',
  },
  related: [
    {
      label: 'Detectar deriva de calidad antes de que el cliente reclame',
      to: '/blog/detectar-deriva-qualidade-bot-atendimento-antes-do-cliente-reclamar',
    },
    { label: 'Handoff humano en atención con IA', to: '/blog/handoff-humano-whatsapp-ia' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

export default {
  pt,
  en,
  es,
};
