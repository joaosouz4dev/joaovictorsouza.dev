// Conteudo do artigo: aquecimento de indice vetorial, por que a primeira consulta do dia e lenta.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'Existe um sintoma que quase todo sistema de RAG em produção tem e quase nenhum time mede: a primeira consulta da manhã demora oito segundos e a segunda demora quatrocentos milissegundos. O painel mostra a média do dia e a média está ótima, então ninguém investiga. Só que essa primeira consulta não é um caso raro: ela acontece toda vez que o processo reinicia, toda vez que o autoscaler sobe uma réplica nova, toda vez que a máquina fica ociosa por vinte minutos e o sistema operacional devolve as páginas do índice para o disco. Quem paga é o primeiro cliente depois de cada evento desses, e como esses eventos se concentram nos horários de menor tráfego, o cliente que mais sofre é justamente o que estava sozinho na fila. Este artigo mostra onde exatamente esse tempo é gasto, por que aquecer não é apenas rodar uma consulta boba no boot, como escolher entre pré-carregar o índice na memória e aceitar a latência do primeiro acesso, e como medir isso com uma métrica que não seja apagada pela média.',
  sections: [
    {
      title: 'O tempo não está no modelo, está em quatro caches frios',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando alguém diz que a primeira consulta é lenta, o palpite imediato costuma ser o modelo de embedding. Às vezes é, mas quase nunca é só ele. Uma consulta de RAG atravessa uma cadeia de componentes que têm estados frios independentes, e cada um deles cobra o próprio pedágio na primeira execução. Se você otimizar o componente errado, o gráfico não muda e o time conclui que o problema é inevitável.',
        },
        {
          type: 'paragraph',
          value:
            'A separação útil é por natureza do custo. Há custo de carregar bytes do disco para a memória, há custo de compilar ou alocar estruturas na primeira chamada, há custo de estabelecer conexão e há custo de construir estruturas auxiliares de busca que o índice mantém em memória. Cada um responde a uma técnica diferente de aquecimento, e é por isso que uma única consulta sintética no boot resolve parcialmente e engana bastante.',
        },
        {
          type: 'table',
          columns: ['Componente frio', 'O que custa na primeira vez', 'Ordem de grandeza típica', 'O que aquece de verdade'],
          rows: [
            [
              'Modelo de embedding local',
              'Carregar pesos, alocar buffers e compilar kernels do runtime',
              '1 a 10 s',
              'Uma inferência real com o mesmo formato de entrada do tráfego',
            ],
            [
              'API de embedding remota',
              'Handshake TLS e resolução de DNS sem pool aberto',
              '100 a 500 ms',
              'Abrir o pool de conexões no boot e mantê-lo vivo com keep-alive',
            ],
            [
              'Páginas do índice no disco',
              'Ler do disco os blocos do grafo ou das listas invertidas',
              '0,5 a 30 s conforme o tamanho',
              'Tocar as páginas de fato, com consultas que percorrem o índice',
            ],
            [
              'Estruturas em memória do motor',
              'Montar grafo de navegação, tabelas de quantização e mapas de id',
              '0,2 a 5 s',
              'Chamada explícita de load ou warmup exposta pelo motor',
            ],
            [
              'Cache do sistema operacional',
              'Reler arquivo mapeado que foi devolvido por falta de uso',
              'Reaparece após ociosidade',
              'Consulta periódica de manutenção, não só no boot',
            ],
            [
              'Camada de reranking',
              'Carregar um segundo modelo, quase sempre esquecido',
              '1 a 5 s',
              'Aquecer com um par consulta-documento representativo',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A linha do cache do sistema operacional é a que mais gera discussão, porque contraria a intuição de que aquecer é uma tarefa de inicialização. Um índice grande acessado por arquivo mapeado vive na memória por cortesia do sistema operacional, e essa cortesia é revogada assim que outro processo precisa de memória ou assim que aquelas páginas ficam tempo demais sem uso. Em um serviço que recebe tráfego contínuo isso raramente acontece; em um serviço com tráfego irregular, acontece todo dia de madrugada, e é exatamente esse o caso em que o time percebe o sintoma.',
        },
      ],
    },
    {
      title: 'Aquecer não é rodar uma consulta qualquer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O aquecimento ingênuo é uma consulta fixa no boot, com um texto qualquer, geralmente a palavra "teste". Ela funciona bem para o modelo de embedding, porque a inferência é a mesma independentemente do texto, e funciona muito mal para o índice, porque uma busca por vizinho aproximado só toca a parte do grafo que fica perto daquele vetor. Se o índice tem oito milhões de vetores e você aquece com um ponto, aqueceu a vizinhança de um ponto. A segunda consulta real, sobre outro assunto, continua fria.',
        },
        {
          type: 'paragraph',
          value:
            'A regra que resolve isso é usar consultas de aquecimento que sejam representativas da distribuição do tráfego real, não sintéticas. Elas existem de graça: pegue as consultas mais frequentes das últimas semanas, agrupe por tema e escolha um punhado que cubra as regiões densas do espaço. O objetivo não é validar a resposta, é forçar o percurso pelo grafo em regiões diferentes para que as páginas correspondentes subam para a memória.',
        },
        {
          type: 'code',
          value: `// warmup/index-warmup.js
// Aquecimento com consultas representativas do trafego real, nao sinteticas.
// Roda no boot e depois periodicamente, porque a paginacao do SO esfria
// o indice de novo durante janelas de ociosidade.

const WARMUP_QUERIES = [
  // Uma por regiao densa do espaco. Extraidas do log de consultas reais,
  // agrupadas por tema e revisadas quando a base muda de forma relevante.
  'como faco para cancelar meu pedido',
  'qual o prazo de entrega para o nordeste',
  'quero trocar o produto por defeito',
  'como emitir a segunda via do boleto',
  'a maquininha nao conecta no wifi',
  'quais formas de pagamento voces aceitam',
];

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;

export function createWarmup({ embed, search, rerank, logger, now = () => Date.now() }) {
  let lastRealQueryAt = now();
  let running = false;

  // Chamado pelo caminho de consulta real: se ha trafego, nao ha o que aquecer.
  function markRealQuery() {
    lastRealQueryAt = now();
  }

  async function warmOnce({ reason }) {
    if (running) return { skipped: 'ja em execucao' };
    running = true;
    const startedAt = now();
    let touched = 0;

    try {
      for (const text of WARMUP_QUERIES) {
        // A ordem importa: embedding aquece o modelo, search aquece o grafo
        // e o rerank aquece o segundo modelo, que quase sempre e esquecido.
        const vector = await embed(text);
        const hits = await search(vector, { topK: 10 });
        if (rerank && hits.length) {
          await rerank(text, hits.slice(0, 5));
        }
        touched += hits.length;
      }
      const elapsedMs = now() - startedAt;
      logger.info('warmup.done', { reason, queries: WARMUP_QUERIES.length, touched, elapsedMs });
      return { elapsedMs, touched };
    } catch (error) {
      // Aquecimento que falha nunca derruba o servico: ele e otimizacao,
      // nao dependencia. Mas precisa aparecer no log, senao morre calado.
      logger.warn('warmup.failed', { reason, message: error.message });
      return { failed: true };
    } finally {
      running = false;
    }
  }

  function startKeepWarm(intervalMs = 60 * 1000) {
    const timer = setInterval(() => {
      // Se houve trafego real recente, o indice ja esta quente:
      // aquecer de novo so gasta CPU e polui a metrica de latencia.
      if (now() - lastRealQueryAt < IDLE_THRESHOLD_MS) return;
      warmOnce({ reason: 'ocioso' });
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { warmOnce, startKeepWarm, markRealQuery };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dois detalhes desse código são o que separam um aquecimento útil de um cron inútil. O primeiro é a checagem de ociosidade: aquecer um serviço que está recebendo tráfego normal não melhora nada e ainda infla o percentil, porque as consultas de aquecimento entram na mesma fila das reais. O segundo é o tratamento de falha: aquecimento é otimização, então falhar nele não pode derrubar o processo, mas falhar em silêncio é pior, porque o time passa meses acreditando que existe um aquecimento que na verdade nunca rodou.',
        },
        {
          type: 'list',
          items: [
            'Use consultas reais anonimizadas, cobrindo temas diferentes, e não uma única consulta sintética.',
            'Aqueça também o reranking e qualquer segundo modelo do caminho, porque eles têm carregamento próprio.',
            'Repita periodicamente durante ociosidade, já que o índice esfria por paginação e não só por reinício.',
            'Não aqueça quando há tráfego real recente: além de inútil, contamina a métrica de latência.',
            'Revise a lista de consultas quando a base mudar de forma relevante, senão você aquece a região errada do espaço.',
          ],
        },
      ],
    },
    {
      title: 'Prontidão é diferente de saúde',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O maior amplificador desse problema não é o aquecimento em si, é o momento em que a réplica começa a receber tráfego. Em quase toda implantação em contêiner, o teste de prontidão responde que está pronto assim que o processo sobe uma porta HTTP. O orquestrador então roteia tráfego imediatamente e o primeiro cliente da nova réplica paga o custo integral do carregamento do índice. Como isso acontece justamente durante uma implantação ou um pico de escala, é o pior momento possível.',
        },
        {
          type: 'paragraph',
          value:
            'A correção é barata e quase sempre esquecida: separar o teste de vivacidade do teste de prontidão e fazer a prontidão depender do aquecimento concluído. O processo está vivo desde o começo, mas só se declara pronto depois que uma consulta representativa completou dentro do orçamento de latência esperado.',
        },
        {
          type: 'diagram',
          value: `Linha do tempo de uma replica nova

  SEM controle de prontidao
  t0  processo sobe -------------------------------------------+
  t0  porta HTTP abre                                          |
  t0  /ready responde 200  <-- mentira: o indice esta no disco  |
  t0  orquestrador comeca a rotear                             |
  t0  cliente A chega ...... 8.2 s  <-- paga o carregamento    |
  t8  cliente B chega ...... 0.4 s                             |
                                                               v
                                          reclamacao chega sem rastro no painel

  COM controle de prontidao
  t0  processo sobe
  t0  /health (vivacidade) responde 200
  t0  /ready responde 503  <-- honesto: ainda esta aquecendo
  t0  warmup: embed -> search -> rerank, 6 consultas reais
  t6  ultima consulta de aquecimento em 0.35 s
  t6  /ready responde 200
  t6  orquestrador comeca a rotear
  t6  cliente A chega ...... 0.4 s

  O custo nao sumiu: ele mudou de dono.
  Antes pagava o cliente. Agora paga a implantacao.`,
        },
        {
          type: 'paragraph',
          value:
            'Vale ser explícito sobre o que essa mudança faz e o que ela não faz. Ela não torna o carregamento mais rápido: os mesmos seis segundos continuam existindo. O que ela faz é transferir esses seis segundos da conta do cliente para a conta da implantação, que é onde o custo é aceitável porque a implantação já espera por isso. Esse é o mesmo raciocínio de qualquer transferência de custo em sistemas distribuídos, e é o motivo pelo qual a mudança compensa mesmo sem nenhum ganho de tempo total.',
        },
        {
          type: 'paragraph',
          value:
            'Há um efeito colateral a vigiar: se a prontidão depende do aquecimento e o aquecimento demora demais, o orquestrador pode interpretar a réplica como falha e reiniciá-la, criando um laço de reinícios que nunca converge. O orçamento de tempo do teste de prontidão precisa ser maior que o pior tempo de aquecimento medido, com folga, e o aquecimento precisa ter um limite superior próprio: se ele passar do teto, a réplica se declara pronta assim mesmo e registra o evento, porque uma réplica lenta serve melhor que uma réplica que nunca entra.',
        },
      ],
    },
    {
      title: 'Pré-carregar na memória ou aceitar o primeiro acesso',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Depois de resolver a prontidão, sobra a decisão estrutural: o índice inteiro deve morar na memória do processo, ou é aceitável que ele fique no disco e suba por demanda? Não existe resposta única, e o critério não é o tamanho absoluto do índice, é a relação entre o tamanho e a memória disponível, somada à tolerância a latência de cauda.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'Quando faz sentido', 'Custo', 'Risco principal'],
          rows: [
            [
              'Índice inteiro em memória',
              'O índice cabe com folga e a latência de cauda é crítica',
              'Memória reservada o tempo todo, mesmo ocioso',
              'Escalar horizontalmente fica caro por réplica',
            ],
            [
              'Arquivo mapeado com aquecimento periódico',
              'Índice grande, tráfego irregular, latência tolerante',
              'CPU esporádica do aquecimento',
              'O sistema operacional pode devolver as páginas a qualquer momento',
            ],
            [
              'Índice remoto gerenciado',
              'Muitas réplicas pequenas e sem estado',
              'Latência de rede em toda consulta, não só na primeira',
              'O aquecimento vira problema do provedor e some do seu controle',
            ],
            [
              'Índice quente parcial',
              'Distribuição muito enviesada, poucos temas dominam',
              'Complexidade de manter a partição quente atualizada',
              'Consulta fora da partição quente volta a ser lenta',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A quarta linha é a mais interessante e a menos usada. Em atendimento, a distribuição de consultas é extremamente enviesada: uma fração pequena dos documentos responde à maioria esmagadora das perguntas. Manter um índice pequeno e sempre quente com esses documentos, com recurso ao índice completo quando a busca quente não atinge o limiar de similaridade, dá quase todo o benefício de manter tudo em memória com uma fração do custo. O preço é operacional: alguém precisa recalcular a partição quente periodicamente, e uma partição desatualizada silenciosamente vira uma camada que nunca acerta e só adiciona latência.',
        },
        {
          type: 'paragraph',
          value:
            'Uma armadilha comum nessa decisão é dimensionar a memória pelo tamanho do arquivo do índice. O consumo real em memória inclui o grafo de navegação, os mapas de identificadores, as tabelas de quantização e a folga que o alocador precisa durante a construção, o que costuma dar bem mais que o arquivo em disco. Dimensionar pelo arquivo é o caminho mais curto para descobrir a diferença através do processo sendo encerrado por falta de memória em produção, e um processo encerrado dessa forma reinicia frio, o que reintroduz exatamente o problema que se queria resolver.',
        },
      ],
    },
    {
      title: 'Medir com percentil por estado, não com a média do dia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A razão pela qual esse problema sobrevive tanto tempo é estatística. Se um serviço responde dez mil consultas por dia e cinco delas custam oito segundos, a média sobe alguns milissegundos e o percentil noventa e cinco não se move. Até o percentil noventa e nove pode não se mover. O evento é real, é sentido pelo cliente, e é invisível em todo painel construído sobre agregação simples.',
        },
        {
          type: 'paragraph',
          value:
            'A correção é medir separando estados em vez de mudar de percentil. Marque cada consulta com o estado do processo no momento em que ela chegou e agregue por esse rótulo. A partir daí, a pergunta deixa de ser "qual a latência do serviço" e passa a ser "qual a latência da primeira consulta depois de uma janela fria", que é a pergunta que corresponde ao sintoma.',
        },
        {
          type: 'code',
          value: `// metrics/query-state.js
// Rotula a consulta pelo estado do processo, para que a latencia fria
// nao seja diluida pela latencia quente na mesma serie.

const COLD_WINDOW_MS = 5 * 60 * 1000;

export function createQueryStateTracker({ metrics, now = () => Date.now() }) {
  const bootedAt = now();
  let lastQueryAt = null;
  let queriesSinceBoot = 0;

  function classify() {
    queriesSinceBoot += 1;
    if (queriesSinceBoot === 1) return 'first_after_boot';
    if (lastQueryAt !== null && now() - lastQueryAt > COLD_WINDOW_MS) return 'first_after_idle';
    return 'warm';
  }

  async function observe(fn) {
    const state = classify();
    const startedAt = now();
    try {
      return await fn();
    } finally {
      const elapsedMs = now() - startedAt;
      lastQueryAt = now();
      // Um unico histograma com rotulo de estado: permite ver p50 quente
      // e p50 frio lado a lado sem criar duas pipelines de metrica.
      metrics.histogram('rag.query.latency_ms', elapsedMs, {
        state,
        uptime_bucket: now() - bootedAt < 60000 ? 'lt_1m' : 'gte_1m',
      });
      if (state !== 'warm') {
        metrics.counter('rag.query.cold_start_total', 1, { state });
      }
    }
  }

  return { observe };
}

// O alerta util nao e sobre a media do servico. E este:
//   p50 de rag.query.latency_ms{state="first_after_idle"} > 2000ms
// Ele dispara com cinco eventos por dia, que e exatamente
// o volume que a media do dia apaga por completo.`,
        },
        {
          type: 'paragraph',
          value:
            'Com esse rótulo, o gráfico conta uma história direta: a série quente fica plana e baixa, a série fria fica alta e esparsa, e o efeito de qualquer mudança no aquecimento aparece na série fria em minutos. Sem o rótulo, a mesma mudança produz uma variação de dois milissegundos na média, que ninguém consegue distinguir de ruído, e o time desiste de otimizar aquilo por falta de sinal.',
        },
        {
          type: 'list',
          items: [
            'Conte o número de partidas frias por dia: se ele for alto, o problema não é aquecimento, é o processo reiniciando demais.',
            'Meça o tempo de aquecimento como métrica própria, porque ele cresce junto com a base e avisa antes de virar problema.',
            'Correlacione partida fria com implantação e com evento de escala, para saber qual dos dois domina.',
            'Alerte pelo percentil da série fria, não pelo da série agregada, que já nasce diluída.',
            'Registre no log quando o aquecimento é pulado por ociosidade insuficiente, para não confundir pulo com falha.',
          ],
        },
      ],
    },
    {
      title: 'A ordem de ataque que compensa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todas as técnicas acima têm custo de implementação e nem todas valem a pena no mesmo momento. A ordem abaixo é a que dá mais resultado por unidade de esforço na maioria dos sistemas de RAG de porte médio, e cada etapa só faz sentido depois da anterior porque sem medição você não sabe se a etapa seguinte melhorou alguma coisa.',
        },
        {
          type: 'ordered',
          items: [
            'Instrumente o estado da consulta antes de mudar qualquer coisa: sem a série fria separada, todo ganho posterior é invisível e toda regressão passa.',
            'Separe vivacidade de prontidão e faça a prontidão esperar o aquecimento, com teto de tempo e registro quando o teto estourar.',
            'Substitua a consulta sintética por um conjunto de consultas reais que cubram temas diferentes, incluindo o reranking na cadeia aquecida.',
            'Adicione aquecimento periódico condicionado a ociosidade, que é o que resolve o caso da primeira consulta da manhã.',
            'Só então decida sobre memória: pré-carregar tudo, manter partição quente ou aceitar o arquivo mapeado, com a série fria mostrando o efeito de cada escolha.',
            'Se o número de partidas frias por dia continuar alto, pare de otimizar aquecimento e investigue por que o processo reinicia tanto.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O último item é o que mais economiza tempo. Muito time investe semanas em aquecimento sofisticado quando a causa real é um limite de memória apertado demais que faz o contêiner ser encerrado três vezes por dia, ou uma implantação contínua que sobe réplicas novas a cada meia hora. Nesses casos o aquecimento é um curativo caro sobre um problema de dimensionamento, e a correção certa custa uma linha de configuração.',
        },
        {
          type: 'paragraph',
          value:
            'Fecha bem lembrar de onde vem o ganho real: aquecimento não deixa o sistema mais rápido, ele deixa o sistema previsível. A média já estava boa antes de tudo isso. O que muda é que o cliente que chega às sete da manhã passa a ter a mesma experiência do cliente que chega às três da tarde, e é essa consistência, não o número no painel, que determina se as pessoas confiam no atendimento.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Basta rodar uma consulta no boot para aquecer o índice vetorial?',
      answer:
        'Resolve parte do problema e esconde o resto, que é o pior dos dois mundos. Uma consulta única aquece bem o modelo de embedding, porque a inferência custa praticamente o mesmo para qualquer texto, mas aquece muito mal o índice, já que a busca por vizinho aproximado só percorre a região do grafo próxima daquele vetor específico. Com um índice de milhões de vetores, você acabou de subir para a memória a vizinhança de um ponto e nada mais, então a próxima consulta real sobre outro assunto continua pagando leitura de disco. O aquecimento que funciona usa um conjunto de consultas reais anonimizadas que cubram temas diferentes, inclui o reranking na cadeia porque ele carrega um segundo modelo, e se repete durante janelas de ociosidade, já que o índice esfria por paginação do sistema operacional e não apenas por reinício do processo.',
    },
    {
      question: 'Se o aquecimento não reduz o tempo total, por que ele compensa?',
      answer:
        'Porque ele muda quem paga esse tempo. Os seis segundos de carregamento continuam existindo em qualquer cenário: a diferença é se eles caem na conta do primeiro cliente que chega ou na conta da implantação, que já é um processo assíncrono onde ninguém está esperando resposta. Fazer o teste de prontidão depender do aquecimento concluído transfere o custo para o lado certo, e o cliente deixa de encontrar oito segundos de espera sem nenhuma explicação visível no painel. O ganho, portanto, não é de velocidade média, é de previsibilidade: a diferença entre a experiência das sete da manhã e a das três da tarde desaparece, e é essa consistência que define se as pessoas confiam no canal. Vale só cuidar do orçamento de tempo do teste de prontidão, que precisa ser maior que o pior aquecimento medido para não gerar um laço de reinícios.',
    },
    {
      question: 'Como saber se vale manter o índice inteiro em memória?',
      answer:
        'O critério não é o tamanho absoluto do índice, é a relação entre o consumo real em memória e o que a réplica pode reservar, cruzada com a tolerância a latência de cauda. O erro clássico é dimensionar pelo tamanho do arquivo no disco, quando o consumo verdadeiro inclui grafo de navegação, mapas de identificadores, tabelas de quantização e a folga do alocador, o que costuma ficar bem acima do arquivo. Se o índice cabe com folga e a cauda importa, pré-carregar é a escolha simples. Se ele é grande e o tráfego é irregular, arquivo mapeado com aquecimento periódico entrega quase o mesmo com muito menos memória reservada. E quando a distribuição de consultas é bem enviesada, o que é a regra em atendimento, um índice quente parcial com os documentos que respondem a maioria das perguntas, com recurso ao índice completo abaixo do limiar de similaridade, costuma ser o melhor custo-benefício, desde que alguém mantenha essa partição atualizada.',
    },
  ],
  conclusion: {
    title: 'A primeira consulta do dia é uma métrica, não um detalhe',
    description:
      'A lentidão da primeira consulta não vem de um componente, vem de quatro caches frios independentes: o modelo de embedding, as páginas do índice no disco, as estruturas em memória do motor de busca e o modelo de reranking que quase ninguém lembra de aquecer. Consulta sintética no boot resolve só o primeiro deles, prontidão que responde pronto antes do aquecimento joga o custo no cliente, e a média do dia apaga completamente um evento que acontece cinco vezes e é sentido por cinco pessoas reais. Instrumentar o estado da consulta, separar vivacidade de prontidão, aquecer com consultas representativas, repetir durante ociosidade e só então decidir sobre memória é a sequência que transforma latência imprevisível em latência estável. Posso instrumentar o seu pipeline de RAG para separar a série fria da quente, ajustar prontidão e aquecimento e dimensionar a estratégia de memória com dado medido em vez de estimativa.',
    cta: 'Falar sobre latência do meu sistema de RAG',
  },
  related: [
    { label: 'Reranking em RAG sem trocar de modelo', to: '/blog/reranking-rag-melhorar-retrieval-sem-trocar-modelo' },
    { label: 'Migrar embeddings sem reindexar tudo de uma vez', to: '/blog/migrar-embeddings-sem-reindexar-tudo-de-uma-vez' },
    { label: 'Observabilidade e confiabilidade', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const en = {
  intro:
    'There is a symptom almost every RAG system in production has and almost no team measures: the first query of the morning takes eight seconds and the second takes four hundred milliseconds. The dashboard shows the daily average and the average looks fine, so nobody investigates. Except that first query is not a rare case: it happens every time the process restarts, every time the autoscaler brings up a new replica, every time the machine sits idle for twenty minutes and the operating system hands the index pages back to disk. Whoever pays is the first customer after each of those events, and since those events cluster in low-traffic hours, the customer who suffers most is precisely the one who was alone in the queue. This article shows where that time is actually spent, why warming up is not simply running a dummy query at boot, how to choose between preloading the index into memory and accepting first-access latency, and how to measure all of it with a metric the average cannot erase.',
  sections: [
    {
      title: 'The time is not in the model, it is in four cold caches',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When someone says the first query is slow, the immediate guess is usually the embedding model. Sometimes it is, but it is almost never only that. A RAG query crosses a chain of components with independent cold states, and each one charges its own toll on the first execution. Optimize the wrong component and the graph does not move, so the team concludes the problem is unavoidable.',
        },
        {
          type: 'paragraph',
          value:
            'The useful split is by nature of the cost. There is the cost of loading bytes from disk into memory, the cost of compiling or allocating structures on the first call, the cost of establishing connections, and the cost of building the auxiliary search structures the index keeps in memory. Each responds to a different warming technique, which is why a single synthetic query at boot solves part of it and misleads a lot.',
        },
        {
          type: 'table',
          columns: ['Cold component', 'What it costs the first time', 'Typical order of magnitude', 'What actually warms it'],
          rows: [
            [
              'Local embedding model',
              'Loading weights, allocating buffers and compiling runtime kernels',
              '1 to 10 s',
              'A real inference with the same input shape as production traffic',
            ],
            [
              'Remote embedding API',
              'TLS handshake and DNS resolution with no open pool',
              '100 to 500 ms',
              'Opening the connection pool at boot and keeping it alive',
            ],
            [
              'Index pages on disk',
              'Reading graph blocks or inverted lists from disk',
              '0.5 to 30 s depending on size',
              'Actually touching the pages with queries that traverse the index',
            ],
            [
              'In-memory engine structures',
              'Building the navigation graph, quantization tables and id maps',
              '0.2 to 5 s',
              'The explicit load or warmup call the engine exposes',
            ],
            [
              'Operating system page cache',
              'Rereading a mapped file that was evicted for lack of use',
              'Returns after idle periods',
              'A periodic maintenance query, not only one at boot',
            ],
            [
              'Reranking layer',
              'Loading a second model, almost always forgotten',
              '1 to 5 s',
              'Warming with a representative query-document pair',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The operating system cache row causes the most debate, because it contradicts the intuition that warming is a startup task. A large index accessed through a mapped file lives in memory by courtesy of the operating system, and that courtesy is revoked as soon as another process needs memory or those pages go unused for too long. In a service with continuous traffic this rarely happens; in a service with irregular traffic it happens every night, and that is exactly the case where teams notice the symptom.',
        },
      ],
    },
    {
      title: 'Warming up is not running just any query',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The naive warmup is a fixed query at boot with arbitrary text, usually the word "test". It works well for the embedding model, because inference costs the same regardless of the text, and works very poorly for the index, because an approximate nearest neighbor search only touches the part of the graph near that vector. If the index holds eight million vectors and you warm it with one point, you warmed one point\'s neighborhood. The second real query, about a different topic, is still cold.',
        },
        {
          type: 'paragraph',
          value:
            'The rule that fixes this is to use warmup queries that are representative of the real traffic distribution rather than synthetic. They are available for free: take the most frequent queries from the last few weeks, group them by topic and pick a handful that cover the dense regions of the space. The goal is not to validate the answer, it is to force traversal through different regions of the graph so the corresponding pages get pulled into memory.',
        },
        {
          type: 'code',
          value: `// warmup/index-warmup.js
// Warming with queries representative of real traffic, not synthetic ones.
// Runs at boot and then periodically, because OS paging cools the index
// down again during idle windows.

const WARMUP_QUERIES = [
  // One per dense region of the space. Extracted from the real query log,
  // grouped by topic and revisited when the corpus changes meaningfully.
  'how do i cancel my order',
  'what is the delivery time for the northeast region',
  'i want to exchange a defective product',
  'how do i get a second copy of the invoice',
  'the card reader will not connect to wifi',
  'which payment methods do you accept',
];

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;

export function createWarmup({ embed, search, rerank, logger, now = () => Date.now() }) {
  let lastRealQueryAt = now();
  let running = false;

  // Called by the real query path: if there is traffic, there is nothing to warm.
  function markRealQuery() {
    lastRealQueryAt = now();
  }

  async function warmOnce({ reason }) {
    if (running) return { skipped: 'already running' };
    running = true;
    const startedAt = now();
    let touched = 0;

    try {
      for (const text of WARMUP_QUERIES) {
        // Order matters: embedding warms the model, search warms the graph
        // and rerank warms the second model, which is almost always forgotten.
        const vector = await embed(text);
        const hits = await search(vector, { topK: 10 });
        if (rerank && hits.length) {
          await rerank(text, hits.slice(0, 5));
        }
        touched += hits.length;
      }
      const elapsedMs = now() - startedAt;
      logger.info('warmup.done', { reason, queries: WARMUP_QUERIES.length, touched, elapsedMs });
      return { elapsedMs, touched };
    } catch (error) {
      // A failing warmup must never take the service down: it is an
      // optimization, not a dependency. But it must show up in the log,
      // otherwise it dies silently.
      logger.warn('warmup.failed', { reason, message: error.message });
      return { failed: true };
    } finally {
      running = false;
    }
  }

  function startKeepWarm(intervalMs = 60 * 1000) {
    const timer = setInterval(() => {
      // If there was recent real traffic, the index is already warm:
      // warming again only burns CPU and pollutes the latency metric.
      if (now() - lastRealQueryAt < IDLE_THRESHOLD_MS) return;
      warmOnce({ reason: 'idle' });
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { warmOnce, startKeepWarm, markRealQuery };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Two details in that code separate a useful warmup from a useless cron job. The first is the idle check: warming a service that is receiving normal traffic improves nothing and inflates the percentile, because warmup queries enter the same queue as real ones. The second is failure handling: warming is an optimization, so failing at it cannot take the process down, but failing silently is worse, because the team spends months believing there is a warmup that in fact never ran.',
        },
        {
          type: 'list',
          items: [
            'Use anonymized real queries covering different topics, not a single synthetic query.',
            'Warm the reranker and any second model in the path as well, because they have their own loading cost.',
            'Repeat periodically during idle windows, since the index cools by paging and not only by restart.',
            'Do not warm when there is recent real traffic: besides being useless, it contaminates the latency metric.',
            'Revisit the query list when the corpus changes meaningfully, otherwise you warm the wrong region of the space.',
          ],
        },
      ],
    },
    {
      title: 'Readiness is different from health',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The biggest amplifier of this problem is not warming itself, it is the moment the replica starts receiving traffic. In almost every container deployment, the readiness probe answers ready as soon as the process opens an HTTP port. The orchestrator then routes traffic immediately and the first customer of the new replica pays the full index loading cost. Since this happens precisely during a deployment or a scaling spike, it is the worst possible moment.',
        },
        {
          type: 'paragraph',
          value:
            'The fix is cheap and almost always forgotten: separate the liveness probe from the readiness probe and make readiness depend on warming being complete. The process is alive from the start, but it only declares itself ready after a representative query completes within the expected latency budget.',
        },
        {
          type: 'diagram',
          value: `Timeline of a new replica

  WITHOUT readiness control
  t0  process starts ------------------------------------------+
  t0  HTTP port opens                                          |
  t0  /ready returns 200  <-- a lie: the index is still on disk|
  t0  orchestrator starts routing                              |
  t0  customer A arrives .... 8.2 s  <-- pays the loading cost |
  t8  customer B arrives .... 0.4 s                            |
                                                               v
                                       complaint arrives with no trace on the dashboard

  WITH readiness control
  t0  process starts
  t0  /health (liveness) returns 200
  t0  /ready returns 503  <-- honest: still warming up
  t0  warmup: embed -> search -> rerank, 6 real queries
  t6  last warmup query in 0.35 s
  t6  /ready returns 200
  t6  orchestrator starts routing
  t6  customer A arrives .... 0.4 s

  The cost did not disappear: it changed owner.
  Before, the customer paid. Now, the deployment pays.`,
        },
        {
          type: 'paragraph',
          value:
            'It is worth being explicit about what this change does and does not do. It does not make loading faster: the same six seconds still exist. What it does is move those six seconds from the customer\'s account to the deployment\'s account, which is where the cost is acceptable because the deployment already expects it. This is the same reasoning behind any cost transfer in distributed systems, and it is why the change pays off even with no gain in total time.',
        },
        {
          type: 'paragraph',
          value:
            'There is one side effect to watch: if readiness depends on warming and warming takes too long, the orchestrator may read the replica as failed and restart it, creating a restart loop that never converges. The readiness probe time budget must exceed the worst measured warmup time with margin, and the warmup itself needs an upper bound: if it goes past the ceiling, the replica declares itself ready anyway and records the event, because a slow replica serves better than a replica that never joins.',
        },
      ],
    },
    {
      title: 'Preload into memory or accept the first access',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Once readiness is handled, the structural decision remains: should the entire index live in the process memory, or is it acceptable for it to stay on disk and page in on demand? There is no single answer, and the criterion is not the absolute size of the index, it is the ratio between size and available memory, combined with tail latency tolerance.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'When it makes sense', 'Cost', 'Main risk'],
          rows: [
            [
              'Entire index in memory',
              'The index fits with margin and tail latency is critical',
              'Memory reserved at all times, even when idle',
              'Horizontal scaling becomes expensive per replica',
            ],
            [
              'Mapped file with periodic warming',
              'Large index, irregular traffic, latency-tolerant',
              'Occasional CPU spent on warming',
              'The operating system may evict the pages at any time',
            ],
            [
              'Managed remote index',
              'Many small stateless replicas',
              'Network latency on every query, not just the first',
              'Warming becomes the provider problem and leaves your control',
            ],
            [
              'Partial hot index',
              'Heavily skewed distribution, a few topics dominate',
              'Complexity of keeping the hot partition current',
              'A query outside the hot partition is slow again',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fourth row is the most interesting and the least used. In customer support, query distribution is extremely skewed: a small fraction of documents answers the overwhelming majority of questions. Keeping a small, always-warm index with those documents, falling back to the full index when the hot search does not reach the similarity threshold, delivers almost all the benefit of keeping everything in memory at a fraction of the cost. The price is operational: someone must recompute the hot partition periodically, and a stale partition silently becomes a layer that never hits and only adds latency.',
        },
        {
          type: 'paragraph',
          value:
            'A common trap in this decision is sizing memory by the index file size. Real memory consumption includes the navigation graph, identifier maps, quantization tables and the headroom the allocator needs during construction, which is usually well above the on-disk file. Sizing by the file is the shortest path to discovering the difference through the process being killed for running out of memory in production, and a process killed that way restarts cold, which reintroduces exactly the problem you were trying to solve.',
        },
      ],
    },
    {
      title: 'Measure with percentiles per state, not the daily average',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The reason this problem survives so long is statistical. If a service answers ten thousand queries a day and five of them cost eight seconds, the average rises by a few milliseconds and the ninety-fifth percentile does not move. Even the ninety-ninth may not move. The event is real, it is felt by the customer, and it is invisible in every dashboard built on simple aggregation.',
        },
        {
          type: 'paragraph',
          value:
            'The fix is to measure by separating states rather than changing percentiles. Tag every query with the process state at the moment it arrived and aggregate by that label. From there, the question stops being "what is the service latency" and becomes "what is the latency of the first query after a cold window", which is the question that matches the symptom.',
        },
        {
          type: 'code',
          value: `// metrics/query-state.js
// Tags the query with the process state so cold latency is not
// diluted by warm latency in the same series.

const COLD_WINDOW_MS = 5 * 60 * 1000;

export function createQueryStateTracker({ metrics, now = () => Date.now() }) {
  const bootedAt = now();
  let lastQueryAt = null;
  let queriesSinceBoot = 0;

  function classify() {
    queriesSinceBoot += 1;
    if (queriesSinceBoot === 1) return 'first_after_boot';
    if (lastQueryAt !== null && now() - lastQueryAt > COLD_WINDOW_MS) return 'first_after_idle';
    return 'warm';
  }

  async function observe(fn) {
    const state = classify();
    const startedAt = now();
    try {
      return await fn();
    } finally {
      const elapsedMs = now() - startedAt;
      lastQueryAt = now();
      // A single histogram with a state label: lets you see warm p50 and
      // cold p50 side by side without building two metric pipelines.
      metrics.histogram('rag.query.latency_ms', elapsedMs, {
        state,
        uptime_bucket: now() - bootedAt < 60000 ? 'lt_1m' : 'gte_1m',
      });
      if (state !== 'warm') {
        metrics.counter('rag.query.cold_start_total', 1, { state });
      }
    }
  }

  return { observe };
}

// The useful alert is not about the service average. It is this one:
//   p50 of rag.query.latency_ms{state="first_after_idle"} > 2000ms
// It fires on five events a day, which is exactly
// the volume the daily average erases completely.`,
        },
        {
          type: 'paragraph',
          value:
            'With that label, the graph tells a direct story: the warm series stays flat and low, the cold series stays high and sparse, and the effect of any warming change shows up in the cold series within minutes. Without the label, the same change produces a two millisecond shift in the average, which nobody can tell apart from noise, and the team gives up on optimizing it for lack of signal.',
        },
        {
          type: 'list',
          items: [
            'Count cold starts per day: if that number is high, the problem is not warming, it is a process restarting too often.',
            'Measure warmup duration as its own metric, because it grows with the corpus and warns you before it becomes a problem.',
            'Correlate cold starts with deployments and scaling events, to know which of the two dominates.',
            'Alert on the cold series percentile, not the aggregate one, which is diluted by construction.',
            'Log when warming is skipped for insufficient idle time, so a skip is never confused with a failure.',
          ],
        },
      ],
    },
    {
      title: 'The order of attack that pays off',
      blocks: [
        {
          type: 'paragraph',
          value:
            'All the techniques above have an implementation cost and not all of them are worth it at the same time. The order below yields the most result per unit of effort in most mid-sized RAG systems, and each step only makes sense after the previous one because without measurement you cannot tell whether the next step improved anything.',
        },
        {
          type: 'ordered',
          items: [
            'Instrument query state before changing anything: without a separated cold series, every later gain is invisible and every regression slips through.',
            'Separate liveness from readiness and make readiness wait for warming, with a time ceiling and a log entry when the ceiling is hit.',
            'Replace the synthetic query with a set of real queries covering different topics, including the reranker in the warmed chain.',
            'Add periodic warming conditioned on idleness, which is what solves the first-query-of-the-morning case.',
            'Only then decide about memory: preload everything, keep a hot partition or accept the mapped file, with the cold series showing the effect of each choice.',
            'If cold starts per day remain high, stop optimizing warming and investigate why the process restarts so much.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last item saves the most time. Many teams invest weeks in sophisticated warming when the real cause is a memory limit set too tight, killing the container three times a day, or a continuous deployment that brings up new replicas every half hour. In those cases warming is an expensive bandage over a sizing problem, and the right fix costs one configuration line.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth closing by remembering where the real gain comes from: warming does not make the system faster, it makes the system predictable. The average was already fine before any of this. What changes is that the customer who arrives at seven in the morning gets the same experience as the customer who arrives at three in the afternoon, and it is that consistency, not the number on the dashboard, that determines whether people trust the channel.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is running one query at boot enough to warm a vector index?',
      answer:
        'It solves part of the problem and hides the rest, which is the worst of both worlds. A single query warms the embedding model well, because inference costs practically the same for any text, but it warms the index very poorly, since approximate nearest neighbor search only traverses the region of the graph near that specific vector. With an index of millions of vectors you have just pulled one point\'s neighborhood into memory and nothing else, so the next real query about a different topic still pays for disk reads. Warming that works uses a set of anonymized real queries covering different topics, includes the reranker in the chain because it loads a second model, and repeats during idle windows, since the index cools through operating system paging and not only through process restarts.',
    },
    {
      question: 'If warming does not reduce total time, why is it worth it?',
      answer:
        'Because it changes who pays that time. The six seconds of loading exist in any scenario: the difference is whether they land on the account of the first customer who arrives or on the account of the deployment, which is already an asynchronous process where nobody is waiting for an answer. Making the readiness probe depend on completed warming moves the cost to the right side, and the customer stops running into eight seconds of waiting with no visible explanation on the dashboard. The gain, therefore, is not in average speed but in predictability: the difference between the seven-in-the-morning experience and the three-in-the-afternoon one disappears, and that consistency is what defines whether people trust the channel. Just watch the readiness probe time budget, which must exceed the worst measured warmup to avoid creating a restart loop.',
    },
    {
      question: 'How do I know whether keeping the whole index in memory is worth it?',
      answer:
        'The criterion is not the absolute index size, it is the ratio between real memory consumption and what the replica can reserve, crossed with tail latency tolerance. The classic mistake is sizing by the on-disk file size, when true consumption includes the navigation graph, identifier maps, quantization tables and allocator headroom, usually well above the file. If the index fits with margin and the tail matters, preloading is the simple choice. If it is large and traffic is irregular, a mapped file with periodic warming delivers almost the same with far less reserved memory. And when query distribution is heavily skewed, which is the rule in customer support, a partial hot index holding the documents that answer most questions, with fallback to the full index below the similarity threshold, is usually the best cost-benefit, provided someone keeps that partition current.',
    },
  ],
  conclusion: {
    title: 'The first query of the day is a metric, not a detail',
    description:
      'First-query slowness does not come from one component, it comes from four independent cold caches: the embedding model, the index pages on disk, the in-memory structures of the search engine and the reranking model almost nobody remembers to warm. A synthetic query at boot only solves the first of them, readiness that answers ready before warming throws the cost at the customer, and the daily average completely erases an event that happens five times and is felt by five real people. Instrumenting query state, separating liveness from readiness, warming with representative queries, repeating during idle windows and only then deciding about memory is the sequence that turns unpredictable latency into stable latency. I can instrument your RAG pipeline to separate the cold series from the warm one, tune readiness and warming, and size the memory strategy with measured data instead of guesswork.',
    cta: 'Talk about latency in my RAG system',
  },
  related: [
    { label: 'Reranking in RAG without switching models', to: '/blog/reranking-rag-melhorar-retrieval-sem-trocar-modelo' },
    { label: 'Migrating embeddings without reindexing everything at once', to: '/blog/migrar-embeddings-sem-reindexar-tudo-de-uma-vez' },
    { label: 'Observability and reliability', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const es = {
  intro:
    'Hay un síntoma que casi todo sistema de RAG en producción tiene y casi ningún equipo mide: la primera consulta de la mañana tarda ocho segundos y la segunda tarda cuatrocientos milisegundos. El panel muestra el promedio del día y el promedio se ve bien, así que nadie investiga. Solo que esa primera consulta no es un caso raro: pasa cada vez que el proceso reinicia, cada vez que el autoescalador levanta una réplica nueva, cada vez que la máquina queda ociosa veinte minutos y el sistema operativo devuelve las páginas del índice al disco. Quien paga es el primer cliente después de cada uno de esos eventos, y como esos eventos se concentran en los horarios de menor tráfico, el cliente que más sufre es justamente el que estaba solo en la fila. Este artículo muestra dónde se gasta realmente ese tiempo, por qué calentar no es apenas correr una consulta cualquiera en el arranque, cómo elegir entre precargar el índice en memoria y aceptar la latencia del primer acceso, y cómo medirlo con una métrica que el promedio no pueda borrar.',
  sections: [
    {
      title: 'El tiempo no está en el modelo, está en cuatro cachés frías',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando alguien dice que la primera consulta es lenta, la sospecha inmediata suele ser el modelo de embedding. A veces lo es, pero casi nunca es solo él. Una consulta de RAG atraviesa una cadena de componentes con estados fríos independientes, y cada uno cobra su propio peaje en la primera ejecución. Si optimizás el componente equivocado, el gráfico no se mueve y el equipo concluye que el problema es inevitable.',
        },
        {
          type: 'paragraph',
          value:
            'La separación útil es por naturaleza del costo. Hay costo de cargar bytes del disco a la memoria, costo de compilar o reservar estructuras en la primera llamada, costo de establecer conexión y costo de construir las estructuras auxiliares de búsqueda que el índice mantiene en memoria. Cada uno responde a una técnica distinta de calentamiento, y por eso una única consulta sintética en el arranque resuelve parcialmente y engaña bastante.',
        },
        {
          type: 'table',
          columns: ['Componente frío', 'Qué cuesta la primera vez', 'Orden de magnitud típico', 'Qué lo calienta de verdad'],
          rows: [
            [
              'Modelo de embedding local',
              'Cargar pesos, reservar buffers y compilar kernels del runtime',
              '1 a 10 s',
              'Una inferencia real con el mismo formato de entrada del tráfico',
            ],
            [
              'API de embedding remota',
              'Handshake TLS y resolución de DNS sin pool abierto',
              '100 a 500 ms',
              'Abrir el pool de conexiones en el arranque y mantenerlo vivo',
            ],
            [
              'Páginas del índice en disco',
              'Leer del disco los bloques del grafo o de las listas invertidas',
              '0,5 a 30 s según el tamaño',
              'Tocar las páginas de verdad, con consultas que recorren el índice',
            ],
            [
              'Estructuras en memoria del motor',
              'Armar grafo de navegación, tablas de cuantización y mapas de id',
              '0,2 a 5 s',
              'La llamada explícita de load o warmup que expone el motor',
            ],
            [
              'Caché del sistema operativo',
              'Releer un archivo mapeado que fue desalojado por falta de uso',
              'Reaparece tras periodos de ociosidad',
              'Consulta periódica de mantenimiento, no solo en el arranque',
            ],
            [
              'Capa de reranking',
              'Cargar un segundo modelo, casi siempre olvidado',
              '1 a 5 s',
              'Calentar con un par consulta-documento representativo',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La fila de la caché del sistema operativo es la que más discusión genera, porque contradice la intuición de que calentar es una tarea de inicialización. Un índice grande accedido por archivo mapeado vive en memoria por cortesía del sistema operativo, y esa cortesía se revoca apenas otro proceso necesita memoria o apenas esas páginas pasan demasiado tiempo sin uso. En un servicio con tráfico continuo eso casi no ocurre; en un servicio con tráfico irregular ocurre todas las madrugadas, y es exactamente el caso en que el equipo percibe el síntoma.',
        },
      ],
    },
    {
      title: 'Calentar no es correr una consulta cualquiera',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El calentamiento ingenuo es una consulta fija en el arranque, con un texto cualquiera, normalmente la palabra "prueba". Funciona bien para el modelo de embedding, porque la inferencia cuesta lo mismo sin importar el texto, y funciona muy mal para el índice, porque una búsqueda por vecino aproximado solo toca la parte del grafo cercana a ese vector. Si el índice tiene ocho millones de vectores y lo calentás con un punto, calentaste la vecindad de un punto. La segunda consulta real, sobre otro tema, sigue fría.',
        },
        {
          type: 'paragraph',
          value:
            'La regla que resuelve esto es usar consultas de calentamiento representativas de la distribución del tráfico real, no sintéticas. Existen gratis: tomá las consultas más frecuentes de las últimas semanas, agrupalas por tema y elegí un puñado que cubra las regiones densas del espacio. El objetivo no es validar la respuesta, es forzar el recorrido por el grafo en regiones distintas para que las páginas correspondientes suban a memoria.',
        },
        {
          type: 'code',
          value: `// warmup/index-warmup.js
// Calentamiento con consultas representativas del trafico real, no sinteticas.
// Corre en el arranque y luego periodicamente, porque la paginacion del SO
// enfria el indice de nuevo durante ventanas de ociosidad.

const WARMUP_QUERIES = [
  // Una por region densa del espacio. Extraidas del log de consultas reales,
  // agrupadas por tema y revisadas cuando la base cambia de forma relevante.
  'como hago para cancelar mi pedido',
  'cual es el plazo de entrega para el interior',
  'quiero cambiar el producto por defecto de fabrica',
  'como emito la segunda copia de la factura',
  'el posnet no conecta al wifi',
  'que formas de pago aceptan',
];

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;

export function createWarmup({ embed, search, rerank, logger, now = () => Date.now() }) {
  let lastRealQueryAt = now();
  let running = false;

  // Lo llama el camino de consulta real: si hay trafico, no hay que calentar.
  function markRealQuery() {
    lastRealQueryAt = now();
  }

  async function warmOnce({ reason }) {
    if (running) return { skipped: 'ya en ejecucion' };
    running = true;
    const startedAt = now();
    let touched = 0;

    try {
      for (const text of WARMUP_QUERIES) {
        // El orden importa: embedding calienta el modelo, search calienta el
        // grafo y rerank calienta el segundo modelo, casi siempre olvidado.
        const vector = await embed(text);
        const hits = await search(vector, { topK: 10 });
        if (rerank && hits.length) {
          await rerank(text, hits.slice(0, 5));
        }
        touched += hits.length;
      }
      const elapsedMs = now() - startedAt;
      logger.info('warmup.done', { reason, queries: WARMUP_QUERIES.length, touched, elapsedMs });
      return { elapsedMs, touched };
    } catch (error) {
      // Un calentamiento que falla nunca puede tirar el servicio: es
      // optimizacion, no dependencia. Pero tiene que aparecer en el log,
      // si no muere callado.
      logger.warn('warmup.failed', { reason, message: error.message });
      return { failed: true };
    } finally {
      running = false;
    }
  }

  function startKeepWarm(intervalMs = 60 * 1000) {
    const timer = setInterval(() => {
      // Si hubo trafico real reciente, el indice ya esta caliente:
      // calentar de nuevo solo gasta CPU y ensucia la metrica de latencia.
      if (now() - lastRealQueryAt < IDLE_THRESHOLD_MS) return;
      warmOnce({ reason: 'ocioso' });
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { warmOnce, startKeepWarm, markRealQuery };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dos detalles de ese código son los que separan un calentamiento útil de un cron inútil. El primero es la verificación de ociosidad: calentar un servicio que está recibiendo tráfico normal no mejora nada y encima infla el percentil, porque las consultas de calentamiento entran en la misma fila que las reales. El segundo es el manejo de fallas: calentar es optimización, así que fallar ahí no puede tirar el proceso, pero fallar en silencio es peor, porque el equipo pasa meses creyendo que existe un calentamiento que en realidad nunca corrió.',
        },
        {
          type: 'list',
          items: [
            'Usá consultas reales anonimizadas que cubran temas distintos, y no una única consulta sintética.',
            'Calentá también el reranking y cualquier segundo modelo del camino, porque tienen carga propia.',
            'Repetí periódicamente durante la ociosidad, ya que el índice se enfría por paginación y no solo por reinicio.',
            'No calientes cuando hay tráfico real reciente: además de inútil, contamina la métrica de latencia.',
            'Revisá la lista de consultas cuando la base cambie de forma relevante, si no calentás la región equivocada del espacio.',
          ],
        },
      ],
    },
    {
      title: 'Preparación no es lo mismo que salud',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El mayor amplificador de este problema no es el calentamiento en sí, es el momento en que la réplica empieza a recibir tráfico. En casi toda implementación en contenedor, la prueba de preparación responde que está lista apenas el proceso abre un puerto HTTP. El orquestador entonces enruta tráfico de inmediato y el primer cliente de la réplica nueva paga el costo íntegro de la carga del índice. Como eso ocurre justamente durante un despliegue o un pico de escala, es el peor momento posible.',
        },
        {
          type: 'paragraph',
          value:
            'La corrección es barata y casi siempre se olvida: separar la prueba de vitalidad de la prueba de preparación y hacer que la preparación dependa del calentamiento concluido. El proceso está vivo desde el comienzo, pero solo se declara listo después de que una consulta representativa completó dentro del presupuesto de latencia esperado.',
        },
        {
          type: 'diagram',
          value: `Linea de tiempo de una replica nueva

  SIN control de preparacion
  t0  el proceso arranca --------------------------------------+
  t0  el puerto HTTP abre                                      |
  t0  /ready responde 200  <-- mentira: el indice esta en disco|
  t0  el orquestador empieza a enrutar                         |
  t0  cliente A llega ....... 8.2 s  <-- paga la carga         |
  t8  cliente B llega ....... 0.4 s                            |
                                                               v
                                          el reclamo llega sin rastro en el panel

  CON control de preparacion
  t0  el proceso arranca
  t0  /health (vitalidad) responde 200
  t0  /ready responde 503  <-- honesto: todavia esta calentando
  t0  warmup: embed -> search -> rerank, 6 consultas reales
  t6  ultima consulta de calentamiento en 0.35 s
  t6  /ready responde 200
  t6  el orquestador empieza a enrutar
  t6  cliente A llega ....... 0.4 s

  El costo no desaparecio: cambio de dueno.
  Antes pagaba el cliente. Ahora paga el despliegue.`,
        },
        {
          type: 'paragraph',
          value:
            'Vale ser explícito sobre lo que ese cambio hace y lo que no hace. No vuelve la carga más rápida: los mismos seis segundos siguen existiendo. Lo que hace es transferir esos seis segundos de la cuenta del cliente a la cuenta del despliegue, que es donde el costo es aceptable porque el despliegue ya lo espera. Es el mismo razonamiento de cualquier transferencia de costo en sistemas distribuidos, y es el motivo por el cual el cambio compensa incluso sin ninguna ganancia de tiempo total.',
        },
        {
          type: 'paragraph',
          value:
            'Hay un efecto secundario a vigilar: si la preparación depende del calentamiento y el calentamiento tarda demasiado, el orquestador puede interpretar la réplica como fallada y reiniciarla, creando un bucle de reinicios que nunca converge. El presupuesto de tiempo de la prueba de preparación tiene que ser mayor que el peor calentamiento medido, con margen, y el calentamiento necesita su propio límite superior: si pasa el techo, la réplica se declara lista igual y registra el evento, porque una réplica lenta sirve más que una réplica que nunca entra.',
        },
      ],
    },
    {
      title: 'Precargar en memoria o aceptar el primer acceso',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Después de resolver la preparación, queda la decisión estructural: ¿el índice entero debe vivir en la memoria del proceso, o es aceptable que quede en disco y suba por demanda? No hay una respuesta única, y el criterio no es el tamaño absoluto del índice, es la relación entre el tamaño y la memoria disponible, sumada a la tolerancia a latencia de cola.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Cuándo tiene sentido', 'Costo', 'Riesgo principal'],
          rows: [
            [
              'Índice entero en memoria',
              'El índice entra con margen y la latencia de cola es crítica',
              'Memoria reservada todo el tiempo, incluso ociosa',
              'Escalar horizontalmente sale caro por réplica',
            ],
            [
              'Archivo mapeado con calentamiento periódico',
              'Índice grande, tráfico irregular, latencia tolerante',
              'CPU esporádica del calentamiento',
              'El sistema operativo puede desalojar las páginas en cualquier momento',
            ],
            [
              'Índice remoto gestionado',
              'Muchas réplicas chicas y sin estado',
              'Latencia de red en toda consulta, no solo en la primera',
              'El calentamiento pasa a ser problema del proveedor y sale de tu control',
            ],
            [
              'Índice caliente parcial',
              'Distribución muy sesgada, pocos temas dominan',
              'Complejidad de mantener actualizada la partición caliente',
              'Una consulta fuera de la partición caliente vuelve a ser lenta',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La cuarta fila es la más interesante y la menos usada. En atención al cliente, la distribución de consultas es extremadamente sesgada: una fracción pequeña de los documentos responde la abrumadora mayoría de las preguntas. Mantener un índice chico y siempre caliente con esos documentos, con recurso al índice completo cuando la búsqueda caliente no alcanza el umbral de similitud, da casi todo el beneficio de tener todo en memoria a una fracción del costo. El precio es operativo: alguien tiene que recalcular la partición caliente periódicamente, y una partición desactualizada se vuelve en silencio una capa que nunca acierta y solo agrega latencia.',
        },
        {
          type: 'paragraph',
          value:
            'Una trampa común en esta decisión es dimensionar la memoria por el tamaño del archivo del índice. El consumo real en memoria incluye el grafo de navegación, los mapas de identificadores, las tablas de cuantización y el margen que el asignador necesita durante la construcción, lo que suele quedar bastante por encima del archivo en disco. Dimensionar por el archivo es el camino más corto para descubrir la diferencia a través del proceso siendo terminado por falta de memoria en producción, y un proceso terminado así reinicia frío, lo que reintroduce exactamente el problema que se quería resolver.',
        },
      ],
    },
    {
      title: 'Medir con percentil por estado, no con el promedio del día',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La razón por la cual este problema sobrevive tanto tiempo es estadística. Si un servicio responde diez mil consultas por día y cinco de ellas cuestan ocho segundos, el promedio sube unos milisegundos y el percentil noventa y cinco no se mueve. Incluso el percentil noventa y nueve puede no moverse. El evento es real, lo siente el cliente, y es invisible en todo panel construido sobre agregación simple.',
        },
        {
          type: 'paragraph',
          value:
            'La corrección es medir separando estados en vez de cambiar de percentil. Marcá cada consulta con el estado del proceso en el momento en que llegó y agregá por esa etiqueta. A partir de ahí, la pregunta deja de ser "cuál es la latencia del servicio" y pasa a ser "cuál es la latencia de la primera consulta después de una ventana fría", que es la pregunta que corresponde al síntoma.',
        },
        {
          type: 'code',
          value: `// metrics/query-state.js
// Etiqueta la consulta por el estado del proceso, para que la latencia
// fria no quede diluida por la latencia caliente en la misma serie.

const COLD_WINDOW_MS = 5 * 60 * 1000;

export function createQueryStateTracker({ metrics, now = () => Date.now() }) {
  const bootedAt = now();
  let lastQueryAt = null;
  let queriesSinceBoot = 0;

  function classify() {
    queriesSinceBoot += 1;
    if (queriesSinceBoot === 1) return 'first_after_boot';
    if (lastQueryAt !== null && now() - lastQueryAt > COLD_WINDOW_MS) return 'first_after_idle';
    return 'warm';
  }

  async function observe(fn) {
    const state = classify();
    const startedAt = now();
    try {
      return await fn();
    } finally {
      const elapsedMs = now() - startedAt;
      lastQueryAt = now();
      // Un unico histograma con etiqueta de estado: permite ver p50 caliente
      // y p50 frio lado a lado sin armar dos pipelines de metrica.
      metrics.histogram('rag.query.latency_ms', elapsedMs, {
        state,
        uptime_bucket: now() - bootedAt < 60000 ? 'lt_1m' : 'gte_1m',
      });
      if (state !== 'warm') {
        metrics.counter('rag.query.cold_start_total', 1, { state });
      }
    }
  }

  return { observe };
}

// La alerta util no es sobre el promedio del servicio. Es esta:
//   p50 de rag.query.latency_ms{state="first_after_idle"} > 2000ms
// Dispara con cinco eventos por dia, que es exactamente
// el volumen que el promedio del dia borra por completo.`,
        },
        {
          type: 'paragraph',
          value:
            'Con esa etiqueta, el gráfico cuenta una historia directa: la serie caliente queda plana y baja, la serie fría queda alta y dispersa, y el efecto de cualquier cambio en el calentamiento aparece en la serie fría en minutos. Sin la etiqueta, el mismo cambio produce una variación de dos milisegundos en el promedio, que nadie logra distinguir del ruido, y el equipo abandona la optimización por falta de señal.',
        },
        {
          type: 'list',
          items: [
            'Contá la cantidad de arranques fríos por día: si es alta, el problema no es el calentamiento, es un proceso que reinicia demasiado.',
            'Medí la duración del calentamiento como métrica propia, porque crece junto con la base y avisa antes de volverse un problema.',
            'Correlacioná arranque frío con despliegue y con evento de escala, para saber cuál de los dos domina.',
            'Alertá por el percentil de la serie fría, no por el de la serie agregada, que ya nace diluida.',
            'Registrá en el log cuándo el calentamiento se saltea por ociosidad insuficiente, para no confundir salteo con falla.',
          ],
        },
      ],
    },
    {
      title: 'El orden de ataque que compensa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todas las técnicas de arriba tienen costo de implementación y no todas valen la pena en el mismo momento. El orden siguiente es el que da más resultado por unidad de esfuerzo en la mayoría de los sistemas de RAG de porte medio, y cada etapa solo tiene sentido después de la anterior porque sin medición no sabés si la etapa siguiente mejoró algo.',
        },
        {
          type: 'ordered',
          items: [
            'Instrumentá el estado de la consulta antes de cambiar cualquier cosa: sin la serie fría separada, toda ganancia posterior es invisible y toda regresión pasa.',
            'Separá vitalidad de preparación y hacé que la preparación espere el calentamiento, con techo de tiempo y registro cuando el techo se supere.',
            'Reemplazá la consulta sintética por un conjunto de consultas reales que cubran temas distintos, incluyendo el reranking en la cadena calentada.',
            'Agregá calentamiento periódico condicionado a la ociosidad, que es lo que resuelve el caso de la primera consulta de la mañana.',
            'Recién entonces decidí sobre memoria: precargar todo, mantener partición caliente o aceptar el archivo mapeado, con la serie fría mostrando el efecto de cada elección.',
            'Si la cantidad de arranques fríos por día sigue alta, dejá de optimizar el calentamiento e investigá por qué el proceso reinicia tanto.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El último punto es el que más tiempo ahorra. Muchos equipos invierten semanas en calentamiento sofisticado cuando la causa real es un límite de memoria demasiado ajustado que hace que el contenedor sea terminado tres veces por día, o un despliegue continuo que levanta réplicas nuevas cada media hora. En esos casos el calentamiento es un parche caro sobre un problema de dimensionamiento, y la corrección correcta cuesta una línea de configuración.',
        },
        {
          type: 'paragraph',
          value:
            'Cierra bien recordar de dónde viene la ganancia real: calentar no vuelve el sistema más rápido, lo vuelve previsible. El promedio ya estaba bien antes de todo esto. Lo que cambia es que el cliente que llega a las siete de la mañana pasa a tener la misma experiencia que el cliente que llega a las tres de la tarde, y es esa consistencia, no el número del panel, la que determina si la gente confía en la atención.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Alcanza con correr una consulta en el arranque para calentar el índice vectorial?',
      answer:
        'Resuelve parte del problema y esconde el resto, que es lo peor de los dos mundos. Una consulta única calienta bien el modelo de embedding, porque la inferencia cuesta prácticamente lo mismo para cualquier texto, pero calienta muy mal el índice, ya que la búsqueda por vecino aproximado solo recorre la región del grafo cercana a ese vector específico. Con un índice de millones de vectores, acabás de subir a memoria la vecindad de un punto y nada más, así que la próxima consulta real sobre otro tema sigue pagando lectura de disco. El calentamiento que funciona usa un conjunto de consultas reales anonimizadas que cubran temas distintos, incluye el reranking en la cadena porque carga un segundo modelo, y se repite durante ventanas de ociosidad, ya que el índice se enfría por paginación del sistema operativo y no solo por reinicio del proceso.',
    },
    {
      question: 'Si el calentamiento no reduce el tiempo total, ¿por qué compensa?',
      answer:
        'Porque cambia quién paga ese tiempo. Los seis segundos de carga siguen existiendo en cualquier escenario: la diferencia es si caen en la cuenta del primer cliente que llega o en la cuenta del despliegue, que ya es un proceso asíncrono donde nadie está esperando respuesta. Hacer que la prueba de preparación dependa del calentamiento concluido transfiere el costo al lado correcto, y el cliente deja de encontrarse con ocho segundos de espera sin ninguna explicación visible en el panel. La ganancia, entonces, no es de velocidad promedio sino de previsibilidad: la diferencia entre la experiencia de las siete de la mañana y la de las tres de la tarde desaparece, y esa consistencia es la que define si la gente confía en el canal. Solo hay que cuidar el presupuesto de tiempo de la prueba de preparación, que tiene que ser mayor que el peor calentamiento medido para no generar un bucle de reinicios.',
    },
    {
      question: '¿Cómo sé si conviene mantener el índice entero en memoria?',
      answer:
        'El criterio no es el tamaño absoluto del índice, es la relación entre el consumo real en memoria y lo que la réplica puede reservar, cruzada con la tolerancia a latencia de cola. El error clásico es dimensionar por el tamaño del archivo en disco, cuando el consumo verdadero incluye grafo de navegación, mapas de identificadores, tablas de cuantización y el margen del asignador, que suele quedar bastante por encima del archivo. Si el índice entra con margen y la cola importa, precargar es la opción simple. Si es grande y el tráfico es irregular, archivo mapeado con calentamiento periódico entrega casi lo mismo con mucha menos memoria reservada. Y cuando la distribución de consultas es muy sesgada, que es la regla en atención al cliente, un índice caliente parcial con los documentos que responden la mayoría de las preguntas, con recurso al índice completo por debajo del umbral de similitud, suele ser el mejor costo-beneficio, siempre que alguien mantenga esa partición actualizada.',
    },
  ],
  conclusion: {
    title: 'La primera consulta del día es una métrica, no un detalle',
    description:
      'La lentitud de la primera consulta no viene de un componente, viene de cuatro cachés frías independientes: el modelo de embedding, las páginas del índice en disco, las estructuras en memoria del motor de búsqueda y el modelo de reranking que casi nadie recuerda calentar. Una consulta sintética en el arranque resuelve solo el primero, una preparación que responde listo antes del calentamiento tira el costo al cliente, y el promedio del día borra por completo un evento que ocurre cinco veces y lo sienten cinco personas reales. Instrumentar el estado de la consulta, separar vitalidad de preparación, calentar con consultas representativas, repetir durante la ociosidad y recién entonces decidir sobre memoria es la secuencia que convierte latencia impredecible en latencia estable. Puedo instrumentar tu pipeline de RAG para separar la serie fría de la caliente, ajustar preparación y calentamiento, y dimensionar la estrategia de memoria con dato medido en vez de estimación.',
    cta: 'Hablar sobre la latencia de mi sistema de RAG',
  },
  related: [
    { label: 'Reranking en RAG sin cambiar de modelo', to: '/blog/reranking-rag-melhorar-retrieval-sem-trocar-modelo' },
    { label: 'Migrar embeddings sin reindexar todo de una vez', to: '/blog/migrar-embeddings-sem-reindexar-tudo-de-uma-vez' },
    { label: 'Observabilidad y confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

export default {
  pt,
  en,
  es,
};
