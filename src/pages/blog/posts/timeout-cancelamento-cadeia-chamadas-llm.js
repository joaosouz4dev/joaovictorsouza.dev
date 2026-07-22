// Conteudo do artigo: timeout e cancelamento em cadeia de chamadas de LLM.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Cadeia de chamadas de LLM com orçamento de tempo e cancelamento propagado: cada etapa recebe um deadline derivado do orçamento total da requisição, toda chamada carrega um AbortSignal que cancela o trabalho pendente quando o tempo acaba ou o cliente desiste, e a cadeia degrada por etapa em vez de estourar no fim, devolvendo a melhor resposta possível dentro do prazo em vez de nenhuma.',
  en: 'LLM call chain with a time budget and propagated cancellation: each step receives a deadline derived from the total request budget, every call carries an AbortSignal that cancels pending work when time runs out or the client gives up, and the chain degrades per step instead of blowing at the end, returning the best possible answer within the deadline instead of none.',
  es: 'Cadena de llamadas de LLM con presupuesto de tiempo y cancelación propagada: cada etapa recibe un deadline derivado del presupuesto total de la petición, toda llamada lleva un AbortSignal que cancela el trabajo pendiente cuando el tiempo se acaba o el cliente desiste, y la cadena degrada por etapa en vez de estallar al final, devolviendo la mejor respuesta posible dentro del plazo en vez de ninguna.',
};

const repoUrl = 'https://github.com/joaosouz4dev/llm-timeout-chain-mini';

const pt = {
  intro:
    'Um pipeline de IA raramente é uma chamada só. Uma pergunta do cliente vira uma consulta de embedding, um retrieval, um rerank, uma chamada ao modelo e talvez uma validação de saída, cada etapa esperando a anterior. Cada uma dessas chamadas pode demorar, e a soma delas é o tempo que o cliente espera olhando para o indicador de digitando. O erro clássico é dar um timeout generoso para cada etapa isoladamente: trinta segundos para o retrieval, sessenta para o modelo, trinta para a validação. Cada etapa parece razoável sozinha, mas a cadeia inteira pode levar dois minutos, e o cliente desistiu no primeiro. Pior: quando ele desiste, as chamadas continuam rodando, queimando tokens e ocupando conexão para produzir uma resposta que ninguém vai ler. Este artigo mostra como tratar o tempo como um orçamento único da requisição, propagar o deadline pela cadeia, cancelar de verdade o trabalho que perdeu o prazo, distinguir o timeout que merece retry do que merece degradação e testar que a cadeia responde algo útil dentro do prazo em vez de nada depois dele.',
  sections: [
    {
      title: 'Timeout por etapa esconde o estouro da cadeia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando cada etapa da cadeia define o próprio timeout sem olhar para as outras, a matemática trai. Retrieval com timeout de dez segundos, rerank com cinco, chamada ao modelo com sessenta, validação com dez: nenhum número parece absurdo, e a soma é oitenta e cinco segundos de pior caso para uma requisição que o cliente esperava em cinco. O pior caso parece raro até o dia em que o provedor do modelo degrada e todas as chamadas passam a encostar no próprio limite ao mesmo tempo. Nesse dia, a cadeia inteira anda no pior caso, o p99 da requisição vira a soma dos p99 das etapas, e o atendimento trava sem que nenhuma etapa individual tenha tecnicamente falhado. O timeout por etapa responde à pergunta errada: ele limita quanto cada peça pode demorar, quando a pergunta que importa é quanto a requisição inteira pode demorar.',
        },
        {
          type: 'paragraph',
          value:
            'A inversão correta é começar pelo orçamento da requisição e derivar os limites das etapas dele. O cliente tolera oito segundos? Esse é o orçamento total, e ele é gasto conforme a cadeia anda: se o retrieval consumiu três segundos, a chamada ao modelo não tem mais os sessenta do seu timeout local, tem os cinco que sobraram. Cada etapa recebe um deadline, um instante absoluto no relógio em que a resposta precisa existir, e calcula o próprio limite como a diferença entre o deadline e o agora. Uma etapa que recebe um deadline já vencido nem executa: falha rápido ou aciona a degradação, em vez de gastar tempo produzindo um resultado que chegará tarde demais. O deadline transforma um conjunto de timeouts locais desconectados num contrato único que a cadeia inteira respeita.',
        },
        {
          type: 'table',
          columns: ['Abordagem', 'Como limita', 'O que quebra'],
          rows: [
            [
              'Timeout por etapa',
              'Cada chamada tem limite próprio e isolado',
              'A soma dos piores casos estoura o prazo do cliente sem nenhuma etapa falhar',
            ],
            [
              'Timeout global sem propagação',
              'Um relógio na borda derruba tudo no fim',
              'A cadeia trabalha até o fim e joga tudo fora; nada degrada no meio',
            ],
            [
              'Orçamento com deadline propagado',
              'Cada etapa herda o tempo que sobrou',
              'Exige passar deadline e signal por toda a cadeia, inclusive nas libs',
            ],
          ],
        },
      ],
    },
    {
      title: 'O orçamento de tempo da requisição',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O orçamento nasce na borda, onde a requisição entra, e é definido pelo canal, não pela infra. Um atendimento por chat tolera segundos; um webhook do WhatsApp precisa de resposta HTTP rápida mesmo que o processamento continue depois; um job de análise noturno tolera minutos. O número certo vem da pergunta "quanto tempo o cliente espera antes de considerar que quebrou", e não de "quanto tempo as etapas precisam". Definido o orçamento, ele vira um deadline absoluto, o instante de agora mais o orçamento, e esse instante viaja com a requisição pela cadeia inteira. Instante absoluto, não duração: se cada etapa recebesse "você tem cinco segundos", o tempo gasto em fila entre as etapas não seria descontado de ninguém, e a cadeia estouraria o prazo com todas as etapas dentro dos seus limites.',
        },
        {
          type: 'paragraph',
          value:
            'Com o deadline na mão, cada etapa faz a mesma conta antes de trabalhar: quanto falta até o deadline, descontada uma reserva para o que ainda vem depois. Se a chamada ao modelo é a última etapa cara, ela pode usar quase tudo que sobrou; se depois dela ainda vêm a validação e a formatação, ela precisa deixar espaço para elas. Essa reserva é o equivalente temporal de deixar espaço na janela de contexto para a resposta: usar o limite bruto até a borda é garantir que a última etapa nunca cabe. E a conta expõe cedo o caso perdido: uma etapa que calcula que sobraram duzentos milissegundos para uma chamada de modelo que nunca responde nisso não tenta, ela falha imediatamente ou degrada, devolvendo o tempo restante para a cadeia fazer algo útil com ele.',
        },
        {
          type: 'code',
          value: `// chain/deadline.js
// O orcamento nasce na borda e vira um deadline ABSOLUTO que viaja
// com a requisicao. Cada etapa calcula o proprio limite a partir dele.

export function startBudget(totalMs) {
  const deadline = Date.now() + totalMs;
  return {
    deadline,
    // Quanto sobra agora, descontando a reserva para as etapas seguintes.
    remaining(reserveMs = 0) {
      return deadline - Date.now() - reserveMs;
    },
  };
}

export async function callWithDeadline(fn, budget, { reserveMs, minMs }) {
  const timeLeft = budget.remaining(reserveMs);

  // Deadline ja vencido ou tempo insuficiente: nao tenta.
  // Falhar rapido devolve o tempo restante para a degradacao.
  if (timeLeft < minMs) {
    throw new DeadlineExceededError('sem tempo util para esta etapa');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeLeft);
  try {
    // O signal segue junto: quem estourar o prazo e CANCELADO,
    // nao apenas abandonado enquanto continua rodando.
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}`,
        },
      ],
    },
    {
      title: 'Cancelar de verdade, não apenas parar de esperar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe uma diferença enorme entre parar de esperar uma chamada e cancelar a chamada. Um timeout implementado como corrida entre a promessa da chamada e um relógio faz o primeiro: quando o relógio ganha, o seu código segue em frente, mas a chamada continua viva por baixo, a conexão segue aberta, o provedor segue gerando tokens e cobrando por eles, e o pool de conexões segue ocupado por um trabalho cujo resultado ninguém vai ler. Em carga normal isso passa despercebido; em degradação, quando os timeouts disparam em massa, essas chamadas zumbis se acumulam, esgotam o pool e derrubam também as requisições saudáveis. O timeout sem cancelamento transforma um problema de latência num problema de capacidade.',
        },
        {
          type: 'paragraph',
          value:
            'Cancelar de verdade é propagar um sinal de aborto até a operação de rede. No ecossistema JavaScript o mecanismo é o AbortSignal: o mesmo objeto desce do handler da requisição até o fetch da chamada ao provedor, e quando alguém chama abort, a conexão HTTP é encerrada, o provedor para de gerar e o pool libera a vaga. Os SDKs dos principais provedores de LLM aceitam signal nas opções da chamada exatamente para isso. E o cancelamento tem duas origens que o mesmo sinal deve cobrir: o prazo que venceu e o cliente que desistiu. Quando o usuário fecha o chat ou a conexão cai, manter a cadeia rodando é puro desperdício, e o sinal de desconexão da borda deve abortar a cadeia inteira da mesma forma que o deadline faria. Um único signal, combinando as duas fontes, atravessa a cadeia de ponta a ponta.',
        },
        {
          type: 'diagram',
          value: `Cancelamento propagado pela cadeia

  cliente          borda              cadeia de etapas
    |                |                     |
    | pergunta       |  budget = 8s        |
    |--------------->|  deadline absoluto  |
    |                |-------------------->| retrieval (signal)
    |                |                     | rerank    (signal)
    |                |                     | modelo    (signal)
    |                |                     |
    X desiste        |                     |
    |--- desconexao->| abort(signal) ----->X chamadas canceladas
    |                |                     | conexoes liberadas,
    |                |                     | provedor para de gerar
    |                |                     |
  sem signal: as chamadas viram zumbis, seguem gerando
  tokens e ocupando o pool para uma resposta que ninguem le`,
        },
      ],
    },
    {
      title: 'Timeout de conexão não é timeout de resposta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Tratar o tempo da chamada como um número só esconde fases com significados diferentes. Conectar ao provedor deve levar milissegundos: se a conexão não abre em dois ou três segundos, algo está errado na rede ou no provedor, e esperar mais não ajuda. Já a resposta de um modelo legitimamente leva segundos, e num streaming a fase que importa é outra: o tempo até o primeiro token, que mede se o provedor está vivo e processando, e o intervalo entre tokens, que detecta o stream que congelou no meio. Um timeout único e grande, dimensionado para a resposta completa, espera esse tempo inteiro até para descobrir que a conexão nunca abriu, desperdiçando quase todo o orçamento num caso que era diagnosticável no primeiro segundo.',
        },
        {
          type: 'list',
          items: [
            'Timeout de conexão: curto e agressivo, poucos segundos. Conexão que não abre rápido não vai abrir; falhar aqui cedo preserva orçamento para retry ou fallback.',
            'Timeout até o primeiro token: o sinal de vida do streaming. Se o modelo não começou a responder em um prazo curto, tratar como falha e agir enquanto ainda há orçamento.',
            'Timeout entre tokens: detecta o stream congelado. Tokens chegando, relógio zerando; silêncio prolongado no meio do stream é falha, mesmo com a conexão aberta.',
            'Deadline total da etapa: o teto que vale mesmo com tudo saudável. Um stream lento que vai estourar o orçamento deve ser cortado, e o parcial recebido pode alimentar a degradação.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Separar as fases também melhora a decisão sobre o que fazer depois da falha. Uma conexão recusada em milissegundos deixou o orçamento quase intacto: dá para retentar ou acionar o fallback de provedor com folga. Um stream que congelou aos quarenta segundos consumiu quase tudo: retentar do zero é estourar o prazo com certeza, e a escolha real é entre usar o parcial recebido, degradar para uma resposta mais simples ou admitir a falha para o cliente. O mesmo erro de timeout, em fases diferentes, pede reações opostas, e só medir as fases separadamente permite escolher a certa.',
        },
      ],
    },
    {
      title: 'Retry, degradação e o que fazer quando o prazo aperta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Timeout dentro de uma cadeia com orçamento muda a regra do retry. O retry clássico assume tempo de sobra: espera um backoff, tenta de novo, repete. Dentro de um orçamento, cada retry gasta o tempo das próximas etapas, e um retry que não cabe no tempo restante é pior que não retentar, porque queima o orçamento que a degradação usaria. A regra passa a ser: só retenta se o tempo restante comporta a nova tentativa inteira, com margem; senão, degrada. E degradar não é falhar, é responder menos: pular o rerank e usar o retrieval cru, trocar o modelo grande por um pequeno que responde no tempo que sobrou, responder sem a validação secundária, ou, no limite, dizer ao cliente que a resposta completa chega em instantes enquanto um caminho assíncrono termina o trabalho.',
        },
        {
          type: 'paragraph',
          value:
            'Para a degradação existir, cada etapa da cadeia precisa declarar o que acontece sem ela. Etapas obrigatórias, como a chamada principal ao modelo, não têm versão degradada, têm fallback, outro provedor ou modelo menor. Etapas opcionais, como rerank, enriquecimento e validações secundárias, declaram explicitamente o comportamento de pulo: o que a cadeia usa no lugar do resultado delas. Com isso, o estouro de prazo numa etapa opcional vira uma decisão local e barata, pula e segue, em vez de derrubar a requisição inteira. A cadeia bem desenhada sob pressão de tempo se parece com um avião soltando peso: vai abrindo mão do acessório para garantir que o essencial, uma resposta útil dentro do prazo, chega.',
        },
        {
          type: 'code',
          value: `// chain/steps.js
// Cada etapa declara se e opcional e o que acontece quando o tempo
// nao da: retry so se couber INTEIRO no orcamento; senao, degrada.

export async function runStep(step, input, budget, signal) {
  try {
    return await callWithDeadline(
      (stepSignal) => step.run(input, stepSignal),
      budget,
      { reserveMs: step.reserveForRest, minMs: step.minUsefulMs },
    );
  } catch (err) {
    if (!isTimeoutOrDeadline(err)) throw err;

    // Retry so quando a nova tentativa INTEIRA cabe no tempo restante.
    // Retry que nao cabe queima o orcamento da degradacao.
    const canRetry =
      step.retryable && budget.remaining(step.reserveForRest) > step.expectedMs;
    if (canRetry) {
      return await step.run(input, signal);
    }

    // Etapa opcional degrada: a cadeia segue com o valor de pulo
    // (retrieval cru sem rerank, resposta sem validacao secundaria).
    if (step.optional) {
      return step.skipValue(input);
    }

    // Etapa obrigatoria sem tempo: fallback declarado ou falha honesta.
    if (step.fallback) {
      return await step.fallback(input, signal);
    }
    throw err;
  }
}`,
        },
      ],
    },
    {
      title: 'Testar a cadeia sob prazo apertado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O comportamento da cadeia sob timeout não se descobre em produção, se ensaia em teste, e o ingrediente principal é um provedor falso que você controla no tempo: um stub que demora o quanto o teste mandar, que congela no meio do stream, que nunca conecta, que responde no último milissegundo. Com ele, os cenários que importam viram testes determinísticos: a requisição inteira respeita o orçamento mesmo com toda etapa no pior caso; a etapa opcional lenta é pulada e a resposta sai sem ela; o cancelamento da borda aborta as chamadas em voo, visível no stub como conexão encerrada; o deadline vencido no meio da cadeia impede as etapas seguintes de sequer executarem. Cada um desses testes falha alto no CI quando alguém adiciona uma etapa que ignora o deadline ou esquece de propagar o signal.',
        },
        {
          type: 'ordered',
          items: [
            'Teto do orçamento: com todas as etapas no pior caso simulado, a resposta ainda sai dentro do orçamento total; medir o tempo da requisição inteira, não o de cada etapa.',
            'Degradação por etapa: forçar timeout em cada etapa opcional, uma por vez, e verificar que a resposta sai sem ela e registra a degradação em vez de falhar.',
            'Cancelamento em voo: abortar a requisição na borda no meio da chamada ao modelo e verificar no stub que a conexão foi encerrada, não abandonada rodando.',
            'Deadline vencido a meio caminho: consumir o orçamento nas primeiras etapas e verificar que as seguintes falham rápido sem executar, em vez de trabalhar para ninguém.',
            'Zumbis sob carga: disparar muitas requisições contra um provedor degradado e medir conexões abertas; timeout sem cancelamento aparece aqui como pool esgotado.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Em produção, as métricas que contam a história são o tempo total da requisição contra o orçamento, quanto de margem sobrou em cada resposta, a taxa de degradação por etapa e a contagem de cancelamentos por origem, prazo vencido ou cliente desistiu. Margem encolhendo semana a semana avisa que a cadeia está engordando antes do primeiro estouro; degradação alta numa etapa aponta o gargalo real; cancelamentos por desistência do cliente medem o quanto o orçamento está acima da paciência real de quem espera. O timeout deixa de ser um erro esporádico nos logs e vira um orçamento visível, com saldo, gasto por etapa e extrato.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que timeouts por etapa não bastam numa cadeia de chamadas de LLM?',
      answer:
        'Porque cada timeout limita uma peça isolada quando a pergunta que importa é quanto a requisição inteira pode demorar. Timeouts locais razoáveis, dez segundos aqui, sessenta ali, somam um pior caso de minutos, e no dia em que o provedor degrada todas as etapas encostam no próprio limite ao mesmo tempo: a cadeia anda inteira no pior caso sem que nenhuma etapa individual falhe, e o cliente desiste muito antes. A inversão correta é começar pelo orçamento da requisição, definido pela tolerância do canal, e derivar dele um deadline absoluto que viaja com a requisição: cada etapa calcula o próprio limite como o tempo que resta até o deadline, descontada a reserva para as etapas seguintes, e uma etapa que recebe deadline vencido falha rápido em vez de trabalhar para ninguém.',
    },
    {
      question: 'Qual a diferença entre dar timeout numa chamada e cancelar a chamada?',
      answer:
        'O timeout sem cancelamento apenas para de esperar: o código segue em frente, mas a chamada continua viva, a conexão aberta, o provedor gerando e cobrando tokens, o pool ocupado por um trabalho cujo resultado ninguém vai ler. Em carga normal passa despercebido; em degradação, quando os timeouts disparam em massa, essas chamadas zumbis esgotam o pool e derrubam também as requisições saudáveis, transformando latência em problema de capacidade. Cancelar de verdade é propagar um sinal de aborto, o AbortSignal no ecossistema JavaScript, do handler da borda até o fetch da chamada: quando o prazo vence ou o cliente desiste, a conexão é encerrada e o provedor para de gerar. Os SDKs dos principais provedores aceitam signal nas opções exatamente para isso.',
    },
    {
      question: 'O que a cadeia deve fazer quando o tempo não dá para tudo?',
      answer:
        'Degradar por etapa em vez de estourar no fim. Cada etapa declara se é opcional e o que a cadeia usa quando ela é pulada: sem rerank, segue o retrieval cru; sem validação secundária, a resposta sai com uma checagem a menos; sem o modelo grande, um menor responde no tempo que sobrou. O retry entra nessa conta: só vale retentar quando a nova tentativa inteira cabe no tempo restante com margem, porque um retry que não cabe queima justamente o orçamento que a degradação usaria. Etapas obrigatórias sem tempo acionam o fallback declarado ou falham honestamente. O resultado é uma cadeia que, sob pressão, abre mão do acessório para entregar o essencial: uma resposta útil dentro do prazo, em vez de uma resposta perfeita depois que o cliente já desistiu.',
    },
  ],
  conclusion: {
    title: 'O tempo da requisição é um orçamento, não uma esperança',
    description:
      'Uma cadeia de chamadas de LLM sem orçamento de tempo responde no prazo por sorte: cada etapa com seu timeout isolado, a soma estourando a paciência do cliente e as chamadas abandonadas rodando para ninguém. Tratar o tempo como orçamento, um deadline absoluto que viaja pela cadeia, um AbortSignal que cancela de verdade o trabalho vencido, fases de timeout separadas para conexão, primeiro token e stream, retry só quando cabe e degradação declarada por etapa, transforma o prazo de um acidente num contrato que a cadeia cumpre. Posso desenhar esse orçamento de tempo no seu pipeline de IA, definindo os deadlines por canal, propagando o cancelamento até os SDKs dos provedores e declarando a degradação de cada etapa, para que o seu atendimento responda algo útil dentro do prazo em vez de nada depois dele.',
    cta: 'Falar sobre timeout e cancelamento no meu pipeline de IA',
  },
  related: [
    { label: 'Fallback entre provedores de LLM sem parar o atendimento', to: '/blog/fallback-provedores-llm-sem-parar-atendimento' },
    { label: 'Streaming de resposta de LLM sem quebrar a UX', to: '/blog/streaming-resposta-llm-sem-quebrar-ux' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'llm-timeout-chain-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'An AI pipeline is rarely a single call. A customer question becomes an embedding query, a retrieval, a rerank, a model call and maybe an output validation, each step waiting for the previous one. Each of those calls can take a while, and their sum is the time the customer spends staring at the typing indicator. The classic mistake is giving each step a generous timeout in isolation: thirty seconds for retrieval, sixty for the model, thirty for validation. Each step looks reasonable on its own, but the whole chain can take two minutes, and the customer gave up in the first one. Worse: when they give up, the calls keep running, burning tokens and holding connections to produce an answer nobody will read. This article shows how to treat time as a single budget for the request, propagate the deadline through the chain, truly cancel work that missed its deadline, distinguish the timeout that deserves a retry from the one that deserves degradation, and test that the chain answers something useful within the deadline instead of nothing after it.',
  sections: [
    {
      title: 'Per-step timeouts hide the chain blowing up',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When each step in the chain sets its own timeout without looking at the others, the math betrays you. Retrieval with a ten-second timeout, rerank with five, model call with sixty, validation with ten: no number looks absurd, and the sum is an eighty-five-second worst case for a request the customer expected in five. The worst case looks rare until the day the model provider degrades and every call starts brushing against its own limit at the same time. On that day, the whole chain walks at worst case, the request p99 becomes the sum of the step p99s, and support stalls without any individual step having technically failed. The per-step timeout answers the wrong question: it limits how long each piece may take, when the question that matters is how long the whole request may take.',
        },
        {
          type: 'paragraph',
          value:
            'The correct inversion is to start from the request budget and derive the step limits from it. The customer tolerates eight seconds? That is the total budget, and it is spent as the chain moves: if retrieval consumed three seconds, the model call no longer has the sixty of its local timeout, it has the five that remain. Each step receives a deadline, an absolute instant on the clock by which the answer must exist, and computes its own limit as the difference between the deadline and now. A step that receives an already-expired deadline does not even execute: it fails fast or triggers degradation, instead of spending time producing a result that will arrive too late. The deadline turns a set of disconnected local timeouts into a single contract the whole chain honors.',
        },
        {
          type: 'table',
          columns: ['Approach', 'How it limits', 'What breaks'],
          rows: [
            [
              'Per-step timeout',
              'Each call has its own isolated limit',
              'The sum of worst cases blows the customer deadline with no step failing',
            ],
            [
              'Global timeout without propagation',
              'One clock at the edge kills everything at the end',
              'The chain works to the end and throws it all away; nothing degrades midway',
            ],
            [
              'Budget with propagated deadline',
              'Each step inherits the time that remains',
              'Requires passing deadline and signal through the whole chain, including libs',
            ],
          ],
        },
      ],
    },
    {
      title: 'The request time budget',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The budget is born at the edge, where the request enters, and is defined by the channel, not by the infra. A chat conversation tolerates seconds; a WhatsApp webhook needs a fast HTTP response even if processing continues afterwards; a nightly analysis job tolerates minutes. The right number comes from the question "how long does the customer wait before considering it broken", not from "how long do the steps need". Once defined, the budget becomes an absolute deadline, the instant of now plus the budget, and that instant travels with the request through the whole chain. Absolute instant, not duration: if each step received "you have five seconds", the time spent queued between steps would be charged to no one, and the chain would blow the deadline with every step within its limits.',
        },
        {
          type: 'paragraph',
          value:
            'With the deadline in hand, each step does the same math before working: how much is left until the deadline, minus a reserve for what still comes after. If the model call is the last expensive step, it can use almost everything that remains; if validation and formatting still come after it, it must leave room for them. That reserve is the temporal equivalent of leaving space in the context window for the answer: using the raw limit up to the edge guarantees the last step never fits. And the math exposes the lost case early: a step that computes two hundred milliseconds left for a model call that never answers in that does not try, it fails immediately or degrades, returning the remaining time for the chain to do something useful with it.',
        },
        {
          type: 'code',
          value: `// chain/deadline.js
// The budget is born at the edge and becomes an ABSOLUTE deadline that
// travels with the request. Each step derives its own limit from it.

export function startBudget(totalMs) {
  const deadline = Date.now() + totalMs;
  return {
    deadline,
    // How much remains now, minus the reserve for the following steps.
    remaining(reserveMs = 0) {
      return deadline - Date.now() - reserveMs;
    },
  };
}

export async function callWithDeadline(fn, budget, { reserveMs, minMs }) {
  const timeLeft = budget.remaining(reserveMs);

  // Deadline already expired or not enough time: do not try.
  // Failing fast returns the remaining time to the degradation path.
  if (timeLeft < minMs) {
    throw new DeadlineExceededError('no useful time for this step');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeLeft);
  try {
    // The signal goes along: whoever blows the deadline is CANCELLED,
    // not merely abandoned while it keeps running.
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}`,
        },
      ],
    },
    {
      title: 'Truly cancel, not just stop waiting',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There is a huge difference between no longer waiting for a call and cancelling the call. A timeout implemented as a race between the call promise and a clock does the former: when the clock wins, your code moves on, but the call stays alive underneath, the connection stays open, the provider keeps generating tokens and charging for them, and the connection pool stays occupied by work whose result nobody will read. Under normal load this goes unnoticed; under degradation, when timeouts fire en masse, these zombie calls pile up, exhaust the pool and take down the healthy requests too. Timeout without cancellation turns a latency problem into a capacity problem.',
        },
        {
          type: 'paragraph',
          value:
            'Truly cancelling is propagating an abort signal down to the network operation. In the JavaScript ecosystem the mechanism is the AbortSignal: the same object descends from the request handler to the fetch of the provider call, and when someone calls abort, the HTTP connection is closed, the provider stops generating and the pool frees the slot. The SDKs of the major LLM providers accept a signal in the call options exactly for this. And cancellation has two origins the same signal must cover: the deadline that expired and the client that gave up. When the user closes the chat or the connection drops, keeping the chain running is pure waste, and the disconnect signal from the edge should abort the whole chain the same way the deadline would. A single signal, combining both sources, crosses the chain end to end.',
        },
        {
          type: 'diagram',
          value: `Cancellation propagated through the chain

  client          edge               chain of steps
    |               |                     |
    | question      |  budget = 8s        |
    |-------------->|  absolute deadline  |
    |               |-------------------->| retrieval (signal)
    |               |                     | rerank    (signal)
    |               |                     | model     (signal)
    |               |                     |
    X gives up      |                     |
    |-- disconnect->| abort(signal) ----->X calls cancelled
    |               |                     | connections released,
    |               |                     | provider stops generating
    |               |                     |
  without signal: calls become zombies, keep generating
  tokens and holding the pool for an answer nobody reads`,
        },
      ],
    },
    {
      title: 'Connection timeout is not response timeout',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Treating the call time as a single number hides phases with different meanings. Connecting to the provider should take milliseconds: if the connection does not open in two or three seconds, something is wrong in the network or the provider, and waiting longer does not help. A model response, on the other hand, legitimately takes seconds, and in streaming the phase that matters is another: the time to first token, which measures whether the provider is alive and processing, and the gap between tokens, which detects the stream that froze midway. A single large timeout, sized for the complete response, waits that whole time even to discover the connection never opened, wasting almost the entire budget on a case that was diagnosable in the first second.',
        },
        {
          type: 'list',
          items: [
            'Connection timeout: short and aggressive, a few seconds. A connection that does not open fast will not open; failing early here preserves budget for retry or fallback.',
            'Time to first token: the streaming liveness signal. If the model has not started answering within a short window, treat it as failure and act while there is still budget.',
            'Inter-token timeout: detects the frozen stream. Tokens arriving, clock resetting; prolonged silence mid-stream is failure, even with the connection open.',
            'Total step deadline: the ceiling that holds even with everything healthy. A slow stream that will blow the budget must be cut, and the received partial can feed the degradation.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Separating the phases also improves the decision about what to do after the failure. A connection refused in milliseconds left the budget almost intact: there is room to retry or trigger the provider fallback comfortably. A stream that froze at forty seconds consumed almost everything: retrying from scratch is guaranteed to blow the deadline, and the real choice is between using the received partial, degrading to a simpler answer or admitting the failure to the customer. The same timeout error, in different phases, calls for opposite reactions, and only measuring the phases separately lets you pick the right one.',
        },
      ],
    },
    {
      title: 'Retry, degradation and what to do when the deadline tightens',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Timeout inside a budgeted chain changes the retry rule. Classic retry assumes spare time: wait a backoff, try again, repeat. Inside a budget, each retry spends the time of the following steps, and a retry that does not fit in the remaining time is worse than not retrying, because it burns the budget the degradation would use. The rule becomes: only retry if the remaining time fits the whole new attempt, with margin; otherwise, degrade. And degrading is not failing, it is answering with less: skipping the rerank and using the raw retrieval, swapping the big model for a small one that answers in the time left, answering without the secondary validation, or, at the limit, telling the customer the full answer arrives shortly while an asynchronous path finishes the work.',
        },
        {
          type: 'paragraph',
          value:
            'For degradation to exist, each step in the chain must declare what happens without it. Mandatory steps, like the main model call, do not have a degraded version, they have a fallback, another provider or a smaller model. Optional steps, like rerank, enrichment and secondary validations, explicitly declare their skip behavior: what the chain uses in place of their result. With that, a deadline blow in an optional step becomes a local, cheap decision, skip and move on, instead of taking down the whole request. A chain well designed under time pressure looks like a plane dropping weight: it gives up the accessory to guarantee the essential, a useful answer within the deadline, arrives.',
        },
        {
          type: 'code',
          value: `// chain/steps.js
// Each step declares whether it is optional and what happens when time
// runs out: retry only if it fits WHOLE in the budget; otherwise, degrade.

export async function runStep(step, input, budget, signal) {
  try {
    return await callWithDeadline(
      (stepSignal) => step.run(input, stepSignal),
      budget,
      { reserveMs: step.reserveForRest, minMs: step.minUsefulMs },
    );
  } catch (err) {
    if (!isTimeoutOrDeadline(err)) throw err;

    // Retry only when the WHOLE new attempt fits in the remaining time.
    // A retry that does not fit burns the degradation budget.
    const canRetry =
      step.retryable && budget.remaining(step.reserveForRest) > step.expectedMs;
    if (canRetry) {
      return await step.run(input, signal);
    }

    // Optional step degrades: the chain continues with the skip value
    // (raw retrieval without rerank, answer without secondary validation).
    if (step.optional) {
      return step.skipValue(input);
    }

    // Mandatory step out of time: declared fallback or honest failure.
    if (step.fallback) {
      return await step.fallback(input, signal);
    }
    throw err;
  }
}`,
        },
      ],
    },
    {
      title: 'Testing the chain under a tight deadline',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The chain behavior under timeout is not discovered in production, it is rehearsed in tests, and the main ingredient is a fake provider you control in time: a stub that takes as long as the test says, that freezes mid-stream, that never connects, that answers at the last millisecond. With it, the scenarios that matter become deterministic tests: the whole request honors the budget even with every step at worst case; the slow optional step is skipped and the answer goes out without it; the edge cancellation aborts the in-flight calls, visible in the stub as a closed connection; the deadline expired mid-chain prevents the following steps from even executing. Each of these tests fails loudly in CI when someone adds a step that ignores the deadline or forgets to propagate the signal.',
        },
        {
          type: 'ordered',
          items: [
            'Budget ceiling: with all steps at simulated worst case, the answer still goes out within the total budget; measure the whole request time, not each step.',
            'Per-step degradation: force a timeout in each optional step, one at a time, and verify the answer goes out without it and logs the degradation instead of failing.',
            'In-flight cancellation: abort the request at the edge in the middle of the model call and verify in the stub that the connection was closed, not abandoned running.',
            'Deadline expired midway: consume the budget in the first steps and verify the following ones fail fast without executing, instead of working for nobody.',
            'Zombies under load: fire many requests against a degraded provider and measure open connections; timeout without cancellation shows up here as an exhausted pool.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'In production, the metrics that tell the story are the total request time against the budget, how much margin was left in each answer, the degradation rate per step and the cancellation count by origin, deadline expired or client gave up. Margin shrinking week over week warns the chain is getting fat before the first blow; high degradation in a step points to the real bottleneck; cancellations by client give-up measure how far the budget sits above the real patience of whoever waits. Timeout stops being a sporadic error in the logs and becomes a visible budget, with balance, per-step spend and a statement.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why are per-step timeouts not enough in a chain of LLM calls?',
      answer:
        'Because each timeout limits an isolated piece when the question that matters is how long the whole request may take. Reasonable local timeouts, ten seconds here, sixty there, add up to a worst case of minutes, and on the day the provider degrades every step brushes against its own limit at the same time: the whole chain walks at worst case without any individual step failing, and the customer gives up much earlier. The correct inversion is to start from the request budget, defined by the channel tolerance, and derive from it an absolute deadline that travels with the request: each step computes its own limit as the time left until the deadline, minus the reserve for the following steps, and a step that receives an expired deadline fails fast instead of working for nobody.',
    },
    {
      question: 'What is the difference between timing out a call and cancelling it?',
      answer:
        'Timeout without cancellation merely stops waiting: your code moves on, but the call stays alive, the connection open, the provider generating and charging tokens, the pool occupied by work whose result nobody will read. Under normal load it goes unnoticed; under degradation, when timeouts fire en masse, these zombie calls exhaust the pool and take down the healthy requests too, turning latency into a capacity problem. Truly cancelling is propagating an abort signal, the AbortSignal in the JavaScript ecosystem, from the edge handler down to the fetch of the call: when the deadline expires or the client gives up, the connection is closed and the provider stops generating. The SDKs of the major providers accept a signal in the call options exactly for this.',
    },
    {
      question: 'What should the chain do when there is not enough time for everything?',
      answer:
        'Degrade per step instead of blowing up at the end. Each step declares whether it is optional and what the chain uses when it is skipped: without rerank, the raw retrieval goes on; without secondary validation, the answer goes out with one check less; without the big model, a smaller one answers in the time left. Retry enters this math: it is only worth retrying when the whole new attempt fits in the remaining time with margin, because a retry that does not fit burns exactly the budget the degradation would use. Mandatory steps out of time trigger the declared fallback or fail honestly. The result is a chain that, under pressure, gives up the accessory to deliver the essential: a useful answer within the deadline, instead of a perfect answer after the customer already gave up.',
    },
  ],
  conclusion: {
    title: 'Request time is a budget, not a hope',
    description:
      'A chain of LLM calls without a time budget answers on time by luck: each step with its isolated timeout, the sum blowing the customer patience and the abandoned calls running for nobody. Treating time as a budget, an absolute deadline that travels through the chain, an AbortSignal that truly cancels the expired work, separate timeout phases for connection, first token and stream, retry only when it fits and declared degradation per step, turns the deadline from an accident into a contract the chain fulfills. I can design this time budget in your AI pipeline, defining the deadlines per channel, propagating the cancellation down to the provider SDKs and declaring the degradation of each step, so that your support answers something useful within the deadline instead of nothing after it.',
    cta: 'Talk about timeout and cancellation in my AI pipeline',
  },
  related: [
    { label: 'LLM provider fallback without stopping support', to: '/blog/fallback-provedores-llm-sem-parar-atendimento' },
    { label: 'Streaming LLM responses without breaking UX', to: '/blog/streaming-resposta-llm-sem-quebrar-ux' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'llm-timeout-chain-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Un pipeline de IA rara vez es una sola llamada. Una pregunta del cliente se convierte en una consulta de embedding, un retrieval, un rerank, una llamada al modelo y quizá una validación de salida, cada etapa esperando a la anterior. Cada una de esas llamadas puede tardar, y la suma es el tiempo que el cliente pasa mirando el indicador de escribiendo. El error clásico es dar un timeout generoso a cada etapa de forma aislada: treinta segundos para el retrieval, sesenta para el modelo, treinta para la validación. Cada etapa parece razonable por sí sola, pero la cadena entera puede tardar dos minutos, y el cliente desistió en el primero. Peor: cuando desiste, las llamadas siguen corriendo, quemando tokens y ocupando conexiones para producir una respuesta que nadie va a leer. Este artículo muestra cómo tratar el tiempo como un presupuesto único de la petición, propagar el deadline por la cadena, cancelar de verdad el trabajo que perdió el plazo, distinguir el timeout que merece retry del que merece degradación y probar que la cadena responde algo útil dentro del plazo en vez de nada después de él.',
  sections: [
    {
      title: 'El timeout por etapa esconde el estallido de la cadena',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando cada etapa de la cadena define su propio timeout sin mirar a las demás, la matemática traiciona. Retrieval con timeout de diez segundos, rerank con cinco, llamada al modelo con sesenta, validación con diez: ningún número parece absurdo, y la suma es un peor caso de ochenta y cinco segundos para una petición que el cliente esperaba en cinco. El peor caso parece raro hasta el día en que el proveedor del modelo se degrada y todas las llamadas empiezan a rozar su propio límite al mismo tiempo. Ese día, la cadena entera camina en el peor caso, el p99 de la petición se vuelve la suma de los p99 de las etapas, y la atención se atasca sin que ninguna etapa individual haya fallado técnicamente. El timeout por etapa responde a la pregunta equivocada: limita cuánto puede tardar cada pieza, cuando la pregunta que importa es cuánto puede tardar la petición entera.',
        },
        {
          type: 'paragraph',
          value:
            'La inversión correcta es empezar por el presupuesto de la petición y derivar de él los límites de las etapas. ¿El cliente tolera ocho segundos? Ese es el presupuesto total, y se gasta conforme la cadena avanza: si el retrieval consumió tres segundos, la llamada al modelo ya no tiene los sesenta de su timeout local, tiene los cinco que quedaron. Cada etapa recibe un deadline, un instante absoluto en el reloj en que la respuesta debe existir, y calcula su propio límite como la diferencia entre el deadline y el ahora. Una etapa que recibe un deadline ya vencido ni siquiera ejecuta: falla rápido o activa la degradación, en vez de gastar tiempo produciendo un resultado que llegará demasiado tarde. El deadline transforma un conjunto de timeouts locales desconectados en un contrato único que la cadena entera respeta.',
        },
        {
          type: 'table',
          columns: ['Enfoque', 'Cómo limita', 'Qué se rompe'],
          rows: [
            [
              'Timeout por etapa',
              'Cada llamada tiene un límite propio y aislado',
              'La suma de los peores casos revienta el plazo del cliente sin que ninguna etapa falle',
            ],
            [
              'Timeout global sin propagación',
              'Un reloj en el borde tumba todo al final',
              'La cadena trabaja hasta el final y lo tira todo; nada degrada a mitad de camino',
            ],
            [
              'Presupuesto con deadline propagado',
              'Cada etapa hereda el tiempo que queda',
              'Exige pasar deadline y signal por toda la cadena, incluidas las libs',
            ],
          ],
        },
      ],
    },
    {
      title: 'El presupuesto de tiempo de la petición',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El presupuesto nace en el borde, donde entra la petición, y lo define el canal, no la infra. Una atención por chat tolera segundos; un webhook de WhatsApp necesita respuesta HTTP rápida aunque el procesamiento continúe después; un job de análisis nocturno tolera minutos. El número correcto viene de la pregunta "cuánto tiempo espera el cliente antes de considerar que se rompió", no de "cuánto tiempo necesitan las etapas". Definido el presupuesto, se convierte en un deadline absoluto, el instante de ahora más el presupuesto, y ese instante viaja con la petición por toda la cadena. Instante absoluto, no duración: si cada etapa recibiera "tienes cinco segundos", el tiempo gastado en cola entre etapas no se descontaría a nadie, y la cadena reventaría el plazo con todas las etapas dentro de sus límites.',
        },
        {
          type: 'paragraph',
          value:
            'Con el deadline en mano, cada etapa hace la misma cuenta antes de trabajar: cuánto falta hasta el deadline, descontada una reserva para lo que todavía viene después. Si la llamada al modelo es la última etapa cara, puede usar casi todo lo que queda; si después de ella todavía vienen la validación y el formateo, debe dejarles espacio. Esa reserva es el equivalente temporal de dejar espacio en la ventana de contexto para la respuesta: usar el límite bruto hasta el borde es garantizar que la última etapa nunca cabe. Y la cuenta expone temprano el caso perdido: una etapa que calcula que quedan doscientos milisegundos para una llamada de modelo que nunca responde en eso no lo intenta, falla de inmediato o degrada, devolviendo el tiempo restante para que la cadena haga algo útil con él.',
        },
        {
          type: 'code',
          value: `// chain/deadline.js
// El presupuesto nace en el borde y se vuelve un deadline ABSOLUTO que
// viaja con la peticion. Cada etapa deriva su propio limite de el.

export function startBudget(totalMs) {
  const deadline = Date.now() + totalMs;
  return {
    deadline,
    // Cuanto queda ahora, descontando la reserva para las etapas siguientes.
    remaining(reserveMs = 0) {
      return deadline - Date.now() - reserveMs;
    },
  };
}

export async function callWithDeadline(fn, budget, { reserveMs, minMs }) {
  const timeLeft = budget.remaining(reserveMs);

  // Deadline ya vencido o tiempo insuficiente: no lo intenta.
  // Fallar rapido devuelve el tiempo restante a la degradacion.
  if (timeLeft < minMs) {
    throw new DeadlineExceededError('sin tiempo util para esta etapa');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeLeft);
  try {
    // El signal va junto: quien reviente el plazo es CANCELADO,
    // no solo abandonado mientras sigue corriendo.
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}`,
        },
      ],
    },
    {
      title: 'Cancelar de verdad, no solo dejar de esperar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Hay una diferencia enorme entre dejar de esperar una llamada y cancelar la llamada. Un timeout implementado como carrera entre la promesa de la llamada y un reloj hace lo primero: cuando el reloj gana, tu código sigue adelante, pero la llamada sigue viva por debajo, la conexión sigue abierta, el proveedor sigue generando tokens y cobrando por ellos, y el pool de conexiones sigue ocupado por un trabajo cuyo resultado nadie va a leer. Con carga normal pasa desapercibido; en degradación, cuando los timeouts se disparan en masa, esas llamadas zombis se acumulan, agotan el pool y tumban también las peticiones sanas. El timeout sin cancelación convierte un problema de latencia en un problema de capacidad.',
        },
        {
          type: 'paragraph',
          value:
            'Cancelar de verdad es propagar una señal de aborto hasta la operación de red. En el ecosistema JavaScript el mecanismo es el AbortSignal: el mismo objeto baja del handler de la petición hasta el fetch de la llamada al proveedor, y cuando alguien llama abort, la conexión HTTP se cierra, el proveedor deja de generar y el pool libera el lugar. Los SDKs de los principales proveedores de LLM aceptan signal en las opciones de la llamada exactamente para esto. Y la cancelación tiene dos orígenes que la misma señal debe cubrir: el plazo que venció y el cliente que desistió. Cuando el usuario cierra el chat o la conexión cae, mantener la cadena corriendo es puro desperdicio, y la señal de desconexión del borde debe abortar la cadena entera igual que lo haría el deadline. Un único signal, combinando ambas fuentes, atraviesa la cadena de punta a punta.',
        },
        {
          type: 'diagram',
          value: `Cancelacion propagada por la cadena

  cliente         borde              cadena de etapas
    |               |                     |
    | pregunta      |  budget = 8s        |
    |-------------->|  deadline absoluto  |
    |               |-------------------->| retrieval (signal)
    |               |                     | rerank    (signal)
    |               |                     | modelo    (signal)
    |               |                     |
    X desiste       |                     |
    |-- desconexion>| abort(signal) ----->X llamadas canceladas
    |               |                     | conexiones liberadas,
    |               |                     | proveedor deja de generar
    |               |                     |
  sin signal: las llamadas se vuelven zombis, siguen generando
  tokens y ocupando el pool para una respuesta que nadie lee`,
        },
      ],
    },
    {
      title: 'Timeout de conexión no es timeout de respuesta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Tratar el tiempo de la llamada como un solo número esconde fases con significados distintos. Conectar al proveedor debe tomar milisegundos: si la conexión no abre en dos o tres segundos, algo está mal en la red o en el proveedor, y esperar más no ayuda. La respuesta de un modelo, en cambio, legítimamente toma segundos, y en streaming la fase que importa es otra: el tiempo hasta el primer token, que mide si el proveedor está vivo y procesando, y el intervalo entre tokens, que detecta el stream que se congeló a mitad de camino. Un timeout único y grande, dimensionado para la respuesta completa, espera todo ese tiempo hasta para descubrir que la conexión nunca abrió, desperdiciando casi todo el presupuesto en un caso que era diagnosticable en el primer segundo.',
        },
        {
          type: 'list',
          items: [
            'Timeout de conexión: corto y agresivo, pocos segundos. Una conexión que no abre rápido no va a abrir; fallar aquí temprano preserva presupuesto para retry o fallback.',
            'Timeout hasta el primer token: la señal de vida del streaming. Si el modelo no empezó a responder en un plazo corto, tratarlo como falla y actuar mientras todavía hay presupuesto.',
            'Timeout entre tokens: detecta el stream congelado. Tokens llegando, reloj reiniciando; silencio prolongado a mitad del stream es falla, aun con la conexión abierta.',
            'Deadline total de la etapa: el techo que vale incluso con todo sano. Un stream lento que va a reventar el presupuesto debe cortarse, y el parcial recibido puede alimentar la degradación.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Separar las fases también mejora la decisión sobre qué hacer después de la falla. Una conexión rechazada en milisegundos dejó el presupuesto casi intacto: hay espacio para reintentar o activar el fallback de proveedor con holgura. Un stream que se congeló a los cuarenta segundos consumió casi todo: reintentar desde cero es reventar el plazo con seguridad, y la elección real es entre usar el parcial recibido, degradar a una respuesta más simple o admitir la falla ante el cliente. El mismo error de timeout, en fases distintas, pide reacciones opuestas, y solo medir las fases por separado permite elegir la correcta.',
        },
      ],
    },
    {
      title: 'Retry, degradación y qué hacer cuando el plazo aprieta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El timeout dentro de una cadena con presupuesto cambia la regla del retry. El retry clásico asume tiempo de sobra: espera un backoff, intenta de nuevo, repite. Dentro de un presupuesto, cada retry gasta el tiempo de las etapas siguientes, y un retry que no cabe en el tiempo restante es peor que no reintentar, porque quema el presupuesto que la degradación usaría. La regla pasa a ser: solo reintenta si el tiempo restante alberga la nueva tentativa entera, con margen; si no, degrada. Y degradar no es fallar, es responder con menos: saltar el rerank y usar el retrieval crudo, cambiar el modelo grande por uno pequeño que responde en el tiempo que queda, responder sin la validación secundaria o, en el límite, decir al cliente que la respuesta completa llega en instantes mientras un camino asíncrono termina el trabajo.',
        },
        {
          type: 'paragraph',
          value:
            'Para que la degradación exista, cada etapa de la cadena debe declarar qué pasa sin ella. Las etapas obligatorias, como la llamada principal al modelo, no tienen versión degradada, tienen fallback, otro proveedor o un modelo menor. Las etapas opcionales, como rerank, enriquecimiento y validaciones secundarias, declaran explícitamente su comportamiento de salto: qué usa la cadena en lugar de su resultado. Con eso, el estallido de plazo en una etapa opcional se vuelve una decisión local y barata, salta y sigue, en vez de tumbar la petición entera. Una cadena bien diseñada bajo presión de tiempo se parece a un avión soltando peso: va renunciando al accesorio para garantizar que lo esencial, una respuesta útil dentro del plazo, llega.',
        },
        {
          type: 'code',
          value: `// chain/steps.js
// Cada etapa declara si es opcional y que pasa cuando el tiempo no da:
// retry solo si cabe ENTERO en el presupuesto; si no, degrada.

export async function runStep(step, input, budget, signal) {
  try {
    return await callWithDeadline(
      (stepSignal) => step.run(input, stepSignal),
      budget,
      { reserveMs: step.reserveForRest, minMs: step.minUsefulMs },
    );
  } catch (err) {
    if (!isTimeoutOrDeadline(err)) throw err;

    // Retry solo cuando la nueva tentativa ENTERA cabe en el tiempo restante.
    // Un retry que no cabe quema el presupuesto de la degradacion.
    const canRetry =
      step.retryable && budget.remaining(step.reserveForRest) > step.expectedMs;
    if (canRetry) {
      return await step.run(input, signal);
    }

    // La etapa opcional degrada: la cadena sigue con el valor de salto
    // (retrieval crudo sin rerank, respuesta sin validacion secundaria).
    if (step.optional) {
      return step.skipValue(input);
    }

    // Etapa obligatoria sin tiempo: fallback declarado o falla honesta.
    if (step.fallback) {
      return await step.fallback(input, signal);
    }
    throw err;
  }
}`,
        },
      ],
    },
    {
      title: 'Probar la cadena bajo un plazo apretado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El comportamiento de la cadena bajo timeout no se descubre en producción, se ensaya en pruebas, y el ingrediente principal es un proveedor falso que controlas en el tiempo: un stub que tarda lo que la prueba mande, que se congela a mitad del stream, que nunca conecta, que responde en el último milisegundo. Con él, los escenarios que importan se vuelven pruebas deterministas: la petición entera respeta el presupuesto incluso con toda etapa en el peor caso; la etapa opcional lenta se salta y la respuesta sale sin ella; la cancelación del borde aborta las llamadas en vuelo, visible en el stub como conexión cerrada; el deadline vencido a mitad de la cadena impide que las etapas siguientes siquiera ejecuten. Cada una de esas pruebas falla fuerte en el CI cuando alguien agrega una etapa que ignora el deadline u olvida propagar el signal.',
        },
        {
          type: 'ordered',
          items: [
            'Techo del presupuesto: con todas las etapas en el peor caso simulado, la respuesta todavía sale dentro del presupuesto total; medir el tiempo de la petición entera, no el de cada etapa.',
            'Degradación por etapa: forzar timeout en cada etapa opcional, una por vez, y verificar que la respuesta sale sin ella y registra la degradación en vez de fallar.',
            'Cancelación en vuelo: abortar la petición en el borde a mitad de la llamada al modelo y verificar en el stub que la conexión fue cerrada, no abandonada corriendo.',
            'Deadline vencido a medio camino: consumir el presupuesto en las primeras etapas y verificar que las siguientes fallan rápido sin ejecutar, en vez de trabajar para nadie.',
            'Zombis bajo carga: disparar muchas peticiones contra un proveedor degradado y medir conexiones abiertas; el timeout sin cancelación aparece aquí como pool agotado.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'En producción, las métricas que cuentan la historia son el tiempo total de la petición contra el presupuesto, cuánto margen sobró en cada respuesta, la tasa de degradación por etapa y el conteo de cancelaciones por origen, plazo vencido o cliente que desistió. Un margen que encoge semana a semana avisa que la cadena está engordando antes del primer estallido; una degradación alta en una etapa apunta al cuello de botella real; las cancelaciones por desistimiento del cliente miden cuánto está el presupuesto por encima de la paciencia real de quien espera. El timeout deja de ser un error esporádico en los logs y se vuelve un presupuesto visible, con saldo, gasto por etapa y extracto.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué los timeouts por etapa no bastan en una cadena de llamadas de LLM?',
      answer:
        'Porque cada timeout limita una pieza aislada cuando la pregunta que importa es cuánto puede tardar la petición entera. Timeouts locales razonables, diez segundos aquí, sesenta allá, suman un peor caso de minutos, y el día en que el proveedor se degrada todas las etapas rozan su propio límite al mismo tiempo: la cadena entera camina en el peor caso sin que ninguna etapa individual falle, y el cliente desiste mucho antes. La inversión correcta es empezar por el presupuesto de la petición, definido por la tolerancia del canal, y derivar de él un deadline absoluto que viaja con la petición: cada etapa calcula su propio límite como el tiempo que queda hasta el deadline, descontada la reserva para las etapas siguientes, y una etapa que recibe un deadline vencido falla rápido en vez de trabajar para nadie.',
    },
    {
      question: '¿Cuál es la diferencia entre dar timeout a una llamada y cancelarla?',
      answer:
        'El timeout sin cancelación solo deja de esperar: tu código sigue adelante, pero la llamada sigue viva, la conexión abierta, el proveedor generando y cobrando tokens, el pool ocupado por un trabajo cuyo resultado nadie va a leer. Con carga normal pasa desapercibido; en degradación, cuando los timeouts se disparan en masa, esas llamadas zombis agotan el pool y tumban también las peticiones sanas, convirtiendo la latencia en un problema de capacidad. Cancelar de verdad es propagar una señal de aborto, el AbortSignal en el ecosistema JavaScript, del handler del borde hasta el fetch de la llamada: cuando el plazo vence o el cliente desiste, la conexión se cierra y el proveedor deja de generar. Los SDKs de los principales proveedores aceptan signal en las opciones exactamente para esto.',
    },
    {
      question: '¿Qué debe hacer la cadena cuando el tiempo no alcanza para todo?',
      answer:
        'Degradar por etapa en vez de estallar al final. Cada etapa declara si es opcional y qué usa la cadena cuando se salta: sin rerank, sigue el retrieval crudo; sin validación secundaria, la respuesta sale con una comprobación menos; sin el modelo grande, uno menor responde en el tiempo que queda. El retry entra en esa cuenta: solo vale reintentar cuando la nueva tentativa entera cabe en el tiempo restante con margen, porque un retry que no cabe quema exactamente el presupuesto que la degradación usaría. Las etapas obligatorias sin tiempo activan el fallback declarado o fallan honestamente. El resultado es una cadena que, bajo presión, renuncia al accesorio para entregar lo esencial: una respuesta útil dentro del plazo, en vez de una respuesta perfecta después de que el cliente ya desistió.',
    },
  ],
  conclusion: {
    title: 'El tiempo de la petición es un presupuesto, no una esperanza',
    description:
      'Una cadena de llamadas de LLM sin presupuesto de tiempo responde a tiempo por suerte: cada etapa con su timeout aislado, la suma reventando la paciencia del cliente y las llamadas abandonadas corriendo para nadie. Tratar el tiempo como presupuesto, un deadline absoluto que viaja por la cadena, un AbortSignal que cancela de verdad el trabajo vencido, fases de timeout separadas para conexión, primer token y stream, retry solo cuando cabe y degradación declarada por etapa, transforma el plazo de un accidente en un contrato que la cadena cumple. Puedo diseñar ese presupuesto de tiempo en tu pipeline de IA, definiendo los deadlines por canal, propagando la cancelación hasta los SDKs de los proveedores y declarando la degradación de cada etapa, para que tu atención responda algo útil dentro del plazo en vez de nada después de él.',
    cta: 'Hablar sobre timeout y cancelación en mi pipeline de IA',
  },
  related: [
    { label: 'Fallback entre proveedores de LLM sin detener la atención', to: '/blog/fallback-provedores-llm-sem-parar-atendimento' },
    { label: 'Streaming de respuesta de LLM sin romper la UX', to: '/blog/streaming-resposta-llm-sem-quebrar-ux' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'llm-timeout-chain-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
