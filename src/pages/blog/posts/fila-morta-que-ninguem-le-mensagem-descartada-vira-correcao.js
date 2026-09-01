// Conteudo do artigo: fila morta ignorada e o processo que transforma mensagem descartada em correcao.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A fila morta tinha quarenta e um mil mensagens e a mais antiga era de catorze meses atrás. Ninguém tinha desligado o alerta: nunca existiu alerta. O painel mostrava a fila principal saudável, o consumidor com lag zero e a taxa de erro em zero vírgula três por cento, porque toda mensagem que falhava três vezes saía do numerador e ia parar num lugar que nenhum gráfico observava. Este artigo mostra por que a fila morta é um registro de defeitos e não um depósito, qual campo precisa acompanhar a mensagem para que o descarte seja diagnosticável meses depois, por que a taxa de erro que o time acompanha exclui exatamente as falhas que importam, como agrupar quarenta e um mil mensagens em cinco causas em vez de tratar uma a uma, por que reprocessar tudo de uma vez costuma derrubar o serviço que acabou de se recuperar, e qual regra decide o que é reprocessável e o que precisa ser encerrado sem retorno.',
  sections: [
    {
      title: 'A fila morta não é um depósito, é um relatório de defeitos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O nome atrapalha. Fila de mensagens mortas soa como o lugar onde vão as coisas que já não têm conserto, e essa leitura autoriza o comportamento que produz quarenta e um mil mensagens paradas: se está morto, não precisa de ninguém olhando. Mas nenhuma mensagem chega ali por decisão de negócio. Ela chega porque o consumidor tentou processá-la, falhou o número configurado de vezes e o broker seguiu a política que alguém definiu no dia em que a fila foi criada. Cada mensagem naquele lugar é um caso em que o sistema afirmou uma coisa e entregou outra, e a fila morta é o único inventário completo dessas afirmações quebradas.',
        },
        {
          type: 'paragraph',
          value:
            'A consequência prática é que a fila morta contém informação que não existe em nenhum outro lugar do sistema. O log tem a exceção mas raramente tem o payload completo, e quando tem, ele já foi rotacionado. A métrica tem o contador mas perdeu a identidade da mensagem. O rastreamento distribuído tem o caminho mas quase nunca sobrevive à amostragem, porque justamente as requisições com erro são as que a amostragem por taxa fixa descarta com a mesma probabilidade das outras. A mensagem morta é o único artefato que preserva ao mesmo tempo o dado de entrada e o fato de que o processamento falhou, e é por isso que descartá-la sem análise é apagar a evidência do defeito junto com o sintoma.',
        },
        {
          type: 'paragraph',
          value:
            'Há um segundo efeito que é mais silencioso e mais caro. A mensagem que vai para a fila morta some do cálculo de sucesso do consumidor. O consumidor que tentou três vezes, falhou e roteou a mensagem terminou o trabalho dele com êxito do ponto de vista do broker: ele confirmou o recebimento e seguiu para a próxima. Do ponto de vista do painel, aquela unidade de trabalho não é um erro, é uma conclusão. É assim que um sistema com dois por cento de falha real reporta zero vírgula três por cento e passa quatorze meses sendo considerado saudável por todo mundo que olha o gráfico.',
        },
        {
          type: 'diagram',
          value: `O QUE O PAINEL MEDE

  entrada 100k --> [consumidor] --+--> sucesso 99.7k  --> "99.7% de sucesso"
                                  |
                                  +--> erro 300       --> taxa de erro 0.3%
                                  |
                                  +--> 3 falhas -> DLQ 2.0k   (nao entra em nenhum dos dois)
                                                    ^
                                                    |
                                        invisivel para o SLO,
                                        visivel para o cliente

O QUE O CLIENTE MEDE

  entrada 100k --> resultado esperado 97.7k
                   resultado ausente   2.3k  --> 2.3% de falha real
                                              (300 erros + 2000 na DLQ)`,
        },
        {
          type: 'paragraph',
          value:
            'A correção de instrumentação é de uma linha e vale mais do que qualquer painel novo: a taxa de sucesso do consumidor precisa contar a mensagem roteada para a fila morta como falha, e não como conclusão. Isso normalmente significa emitir a métrica de resultado no ponto em que a decisão de roteamento é tomada, e não no ponto em que o broker recebe a confirmação. Enquanto essa contagem não mudar, todo o resto deste artigo é opcional, porque ninguém vai priorizar a análise de uma fila que o painel afirma não existir.',
        },
      ],
    },
    {
      title: 'A mensagem morta precisa carregar o motivo, não só o corpo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A maioria das filas mortas é inútil não por estar cheia, mas porque cada mensagem guardada ali é idêntica à mensagem original. Um payload de pedido com trezentos campos e nenhuma indicação do que aconteceu. Para descobrir por que aquela mensagem falhou, alguém precisa reconstruir o contexto: achar o log daquele instante, se ainda existir, correlacionar por identificador, se ele estiver no log, e adivinhar qual versão do consumidor estava rodando. Multiplicado por quarenta e um mil, esse trabalho não é caro, é impossível, e é exatamente por isso que a fila nunca é lida.',
        },
        {
          type: 'paragraph',
          value:
            'A alternativa é envelopar a mensagem no momento do descarte. O corpo original fica intacto num campo, para que o reprocessamento seja literal, e ao redor dele entram os metadados que respondem às perguntas que alguém vai fazer meses depois. Cinco campos resolvem quase todos os casos: a classe do erro, que é o que permite agrupar; a mensagem do erro truncada, que é o que permite diferenciar dentro do grupo; a versão do consumidor, que é o que responde se a falha ainda existe no código atual; o identificador de rastreamento, que é o que liga o descarte ao restante da requisição; e o carimbo de tempo da primeira tentativa, não da última, porque é ele que localiza o evento que causou o começo do problema.',
        },
        {
          type: 'code',
          value: `// queue/dead-letter.js
// Envelopa a mensagem no momento do descarte.
//
// O corpo original fica intacto em 'payload' para que o reprocessamento
// seja literal. Os metadados existem para responder, meses depois, as
// perguntas que ninguem consegue responder pelo log rotacionado.

const MAX_ERROR_MESSAGE = 500;

// A classe do erro e o que permite agrupar 41k mensagens em 5 causas.
// Sem normalizacao, 'timeout after 30012ms' e 'timeout after 30044ms'
// viram dois grupos distintos e o agrupamento perde a utilidade.
const classifyError = (error) => {
  if (error.name === 'ValidationError') return 'validation';
  if (error.name === 'TimeoutError') return 'dependency_timeout';
  if (error.status === 404) return 'reference_not_found';
  if (error.status >= 500) return 'dependency_unavailable';
  return 'unknown';
};

export const buildDeadLetter = ({ message, error, attempts, consumerVersion }) => ({
  // Corpo original, byte a byte. Nada de reserializar aqui: qualquer
  // normalizacao aplicada agora muda o que sera reprocessado depois.
  payload: message.body,

  errorClass: classifyError(error),
  errorMessage: String(error.message ?? '').slice(0, MAX_ERROR_MESSAGE),

  // Responde 'essa falha ainda existe no codigo atual?' sem arqueologia
  // de git. E o campo que autoriza descartar um grupo inteiro.
  consumerVersion,

  // Liga o descarte ao restante da requisicao enquanto o trace existir.
  traceId: message.headers['x-trace-id'] ?? null,

  attempts,
  // Primeira tentativa, nao a ultima: e ela que localiza o deploy ou o
  // incidente que iniciou o problema. A ultima so registra o backoff.
  firstAttemptAt: message.headers['x-first-attempt-at'] ?? message.receivedAt,
  deadLetteredAt: new Date().toISOString(),
});`,
        },
        {
          type: 'paragraph',
          value:
            'Há uma armadilha de conformidade nesse envelope que vale antecipar. A mensagem morta é frequentemente a cópia mais duradoura de um dado pessoal dentro do sistema, porque a fila principal expira em dias e a fila morta costuma ser configurada com retenção máxima. Se o pipeline tem uma política de retenção, ela precisa valer também ali, e o mesmo processo que apaga o dado do banco tem que alcançar a fila morta. Um envelope que guarda o payload completo por catorze meses é uma exposição que ninguém decidiu criar e que nenhum inventário registra.',
        },
      ],
    },
    {
      title: 'Agrupar por causa transforma quarenta e um mil casos em cinco decisões',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A razão pela qual ninguém começa a análise é que o volume sugere um esforço proporcional ao número de mensagens, e ele não é. Filas mortas reais têm uma distribuição fortemente concentrada: um punhado de causas responde por quase todo o volume, e a cauda são casos isolados. Quarenta e um mil mensagens costumam se resolver em cinco ou seis decisões, e o trabalho difícil é chegar a esse agrupamento sem carregar as quarenta e um mil para a memória de alguém.',
        },
        {
          type: 'paragraph',
          value:
            'O agrupamento útil não é por classe de erro sozinha, porque ela é grossa demais: dependency_timeout junta a fila inteira de um incidente de duas horas com falhas esporádicas de meses diferentes, que exigem tratamentos opostos. A chave que funciona é a combinação de classe do erro com versão do consumidor e uma assinatura do erro com os números removidos. Essa terceira parte é a que costuma ser esquecida, e sem ela cada milissegundo diferente num timeout vira um grupo próprio. Com os três campos, o relatório sai em uma passada e cabe numa tela.',
        },
        {
          type: 'code',
          value: `// scripts/triage-dead-letter.js
// Agrupa a fila morta por causa e produz um relatorio que cabe numa tela.
//
// Roda em uma passada, sem carregar tudo na memoria: o consumo e por
// lote e o acumulador so guarda um resumo por grupo.

// Remove numeros, UUIDs e aspas: 'timeout after 30012ms' e
// 'timeout after 30044ms' precisam cair no mesmo grupo.
const signatureOf = (errorMessage) =>
  errorMessage
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\\d+/g, '<n>')
    .replace(/'[^']*'|"[^"]*"/g, '<v>')
    .slice(0, 120);

const groupKey = (entry) =>
  \`\${entry.errorClass}|\${entry.consumerVersion}|\${signatureOf(entry.errorMessage)}\`;

export const triage = (entries) => {
  const groups = new Map();

  for (const entry of entries) {
    const key = groupKey(entry);
    const group = groups.get(key) ?? {
      errorClass: entry.errorClass,
      consumerVersion: entry.consumerVersion,
      signature: signatureOf(entry.errorMessage),
      count: 0,
      firstSeen: entry.firstAttemptAt,
      lastSeen: entry.firstAttemptAt,
      // Uma amostra por grupo: suficiente para investigar, e evita
      // guardar 41k payloads no relatorio.
      sample: entry,
    };

    group.count += 1;
    if (entry.firstAttemptAt < group.firstSeen) group.firstSeen = entry.firstAttemptAt;
    if (entry.firstAttemptAt > group.lastSeen) group.lastSeen = entry.firstAttemptAt;
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      // Janela concentrada indica incidente pontual e favorece
      // reprocessamento. Janela larga indica defeito estrutural e
      // reprocessar so devolve as mesmas mensagens para a fila morta.
      spanHours:
        (Date.parse(group.lastSeen) - Date.parse(group.firstSeen)) / 3_600_000,
    }))
    .sort((a, b) => b.count - a.count);
};`,
        },
        {
          type: 'paragraph',
          value:
            'O campo que decide a ação é o intervalo entre a primeira e a última ocorrência do grupo. Um grupo com nove mil mensagens concentradas em duas horas é o rastro de um incidente que já terminou, e reprocessar resolve. Um grupo com nove mil mensagens espalhadas por onze meses é um defeito que continua acontecendo, e reprocessar apenas devolve as mesmas mensagens à fila morta na semana seguinte. Essa distinção é a única que muda o que o time faz, e ela não aparece em nenhum agrupamento que ignore o tempo.',
        },
        {
          type: 'table',
          columns: ['Perfil do grupo', 'O que significa', 'Ação correta'],
          rows: [
            [
              'Volume alto, janela de horas, versão antiga',
              'Rastro de incidente encerrado em código que já mudou',
              'Reprocessar em lote com limite de vazão',
            ],
            [
              'Volume alto, janela de meses, versão atual',
              'Defeito estrutural ativo no consumidor',
              'Corrigir o código primeiro, reprocessar depois',
            ],
            [
              'Classe validation, qualquer janela',
              'Produtor emite payload que o contrato não aceita',
              'Corrigir no produtor, encerrar as mensagens antigas',
            ],
            [
              'Classe reference_not_found, janela larga',
              'Entidade referenciada foi apagada legitimamente',
              'Encerrar sem retorno e registrar a decisão',
            ],
            [
              'Volume baixo, ocorrências isoladas',
              'Cauda longa de casos únicos',
              'Amostrar dois ou três e encerrar o resto',
            ],
          ],
        },
      ],
    },
    {
      title: 'Reprocessar sem derrubar o serviço que acabou de se recuperar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro clássico depois de uma triagem bem-feita é redirecionar o grupo inteiro de volta para a fila principal de uma vez. Quarenta mil mensagens injetadas em segundos numa fila que processa duzentas por segundo em regime normal produzem três efeitos ao mesmo tempo: o tráfego atual passa a esperar atrás do reprocessamento, a dependência que causou o incidente original recebe uma rajada muito maior do que a que a derrubou, e se o defeito ainda existir, as mesmas mensagens voltam para a fila morta com o contador de tentativas zerado, apagando o histórico que a triagem acabou de construir.',
        },
        {
          type: 'paragraph',
          value:
            'O reprocessamento seguro tem quatro propriedades e nenhuma delas é opcional. Vazão limitada, para que o reprocessamento consuma uma fração da capacidade e o tráfego atual continue tendo prioridade. Lote pequeno de teste antes do volume, tipicamente cinquenta mensagens, com verificação do resultado antes de liberar o resto. Marcação de origem na mensagem, para que uma falha no reprocessamento seja distinguível de uma falha nova. E ponto de parada automático, que interrompe o processo quando a taxa de falha do próprio reprocessamento passa de um limiar, porque continuar depois disso só transforma um problema conhecido em dois.',
        },
        {
          type: 'code',
          value: `// scripts/replay-dead-letter.js
// Reprocessa um grupo da fila morta com vazao limitada e parada automatica.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const replay = async ({
  entries,
  publish,
  ratePerSecond = 20,
  canaryBatch = 50,
  abortFailureRate = 0.2,
}) => {
  const interval = 1000 / ratePerSecond;
  const stats = { published: 0, failed: 0, aborted: false };

  for (const [index, entry] of entries.entries()) {
    try {
      await publish({
        ...entry.payload,
        headers: {
          // Marca a origem: uma falha aqui e uma reincidencia conhecida,
          // nao um caso novo. Sem isso o proximo relatorio conta o mesmo
          // defeito duas vezes.
          'x-replay-of': entry.deadLetteredAt,
          'x-replay-reason': entry.errorClass,
        },
      });
      stats.published += 1;
    } catch (error) {
      stats.failed += 1;
    }

    const processed = stats.published + stats.failed;

    // Canario: para depois do primeiro lote e devolve o controle para
    // quem chamou verificar o efeito antes de liberar o volume.
    if (processed === canaryBatch && index + 1 < entries.length) {
      return { ...stats, paused: true, remaining: entries.length - processed };
    }

    // Parada automatica: se o proprio reprocessamento esta falhando,
    // continuar transforma um problema conhecido em dois.
    if (processed >= canaryBatch && stats.failed / processed > abortFailureRate) {
      return { ...stats, aborted: true, remaining: entries.length - processed };
    }

    await sleep(interval);
  }

  return { ...stats, paused: false, aborted: false, remaining: 0 };
};`,
        },
        {
          type: 'paragraph',
          value:
            'Falta uma verificação que costuma ser descoberta tarde demais: a mensagem antiga ainda faz sentido? Um evento de reserva de estoque de catorze meses atrás, reprocessado hoje, vai debitar um estoque que já foi vendido. Um evento de notificação vai mandar ao cliente uma mensagem sobre um pedido que ele já recebeu. Antes de reprocessar, cada grupo precisa passar por uma pergunta explícita sobre validade temporal, e a resposta muitas vezes é que o dado precisa ser corrigido no banco e não reinjetado no fluxo. Reprocessar é a ação padrão para incidentes recentes, não para tudo que estiver na fila.',
        },
      ],
    },
    {
      title: 'Encerrar sem retorno é uma decisão, e ela precisa ficar registrada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Boa parte da fila morta não deve ser reprocessada, e admitir isso é o que destrava a limpeza. Mensagens cuja entidade de referência já foi apagada, eventos cuja janela de validade expirou, payloads gerados por uma versão do produtor que não existe mais, duplicatas de algo que já foi processado por outro caminho. O caminho correto para esses casos não é apagar em silêncio: é encerrar registrando o motivo, porque a diferença entre uma fila limpa e uma fila esvaziada é justamente a existência desse registro.',
        },
        {
          type: 'paragraph',
          value:
            'O registro de encerramento é barato e resolve dois problemas futuros. O primeiro é a auditoria: quando alguém perguntar por que o pedido tal nunca foi processado, a resposta existe e tem data, autor e justificativa, em vez de um silêncio que obriga a reconstruir tudo. O segundo é a reincidência: com o motivo registrado, o próximo relatório da fila morta consegue distinguir o grupo que já foi analisado e encerrado do grupo novo, e a triagem seguinte não recomeça do zero. Sem esse registro, cada análise da fila morta é a primeira análise da fila morta.',
        },
        {
          type: 'code',
          value: `// queue/dead-letter-disposition.js
// Encerrar sem retorno e uma decisao registrada, nao um delete.

const VALID_REASONS = new Set([
  'entity_deleted',       // a entidade referenciada nao existe mais
  'window_expired',       // o evento perdeu validade temporal
  'producer_retired',     // formato de uma versao do produtor que nao existe
  'already_processed',    // outro caminho ja tratou o mesmo efeito
  'fixed_in_code',        // defeito corrigido, mensagens antigas irrelevantes
]);

export const closeGroup = async ({ group, reason, decidedBy, store }) => {
  if (!VALID_REASONS.has(reason)) {
    // Motivo livre vira 'outros' em tres meses e o registro perde a
    // funcao. A lista fechada e o que mantem o relatorio comparavel.
    throw new Error(\`motivo de encerramento invalido: \${reason}\`);
  }

  return store.recordDisposition({
    signature: group.signature,
    errorClass: group.errorClass,
    consumerVersion: group.consumerVersion,
    affectedCount: group.count,
    firstSeen: group.firstSeen,
    lastSeen: group.lastSeen,
    reason,
    decidedBy,
    decidedAt: new Date().toISOString(),
  });
};

// A triagem seguinte consulta as decisoes anteriores e separa o que ja
// foi analisado do que e novo. Sem isso, toda analise da fila morta e a
// primeira analise da fila morta.
export const splitAgainstHistory = (groups, dispositions) => {
  const closed = new Map(dispositions.map((d) => [d.signature, d]));

  return {
    // Grupo ja encerrado que voltou a aparecer: o motivo registrado nao
    // se sustentou, e isso e um achado por si so.
    recurring: groups
      .filter((group) => closed.has(group.signature))
      .map((group) => ({ ...group, previousDisposition: closed.get(group.signature) })),
    fresh: groups.filter((group) => !closed.has(group.signature)),
  };
};`,
        },
        {
          type: 'paragraph',
          value:
            'O grupo reincidente é o achado mais valioso desse desenho e ele não existe sem o histórico. Uma assinatura encerrada como corrigida no código que reaparece três meses depois significa que a correção não pegou o caso todo, e essa informação chega antes de o volume crescer o suficiente para virar incidente. É o mesmo raciocínio de um teste de regressão, com a diferença de que o gatilho é a produção e não a suíte, e por isso ele encontra a classe de defeito que nenhum teste escrito antecipou.',
        },
      ],
    },
    {
      title: 'O alerta que impede a fila de acumular catorze meses de novo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Depois da limpeza vem a parte que determina se o esforço se sustenta. A fila morta acumulou catorze meses porque nada avisava, e o instinto é criar um alerta de profundidade da fila com um limiar. Esse alerta funciona mal nos dois extremos: com limiar baixo, ele dispara em qualquer incidente e o time aprende a ignorá-lo em duas semanas; com limiar alto, ele nunca dispara em um vazamento lento de dez mensagens por dia, que é exatamente o padrão que produz quarenta e um mil ao longo de um ano.',
        },
        {
          type: 'paragraph',
          value:
            'Três sinais cobrem os casos que importam sem gerar ruído. A taxa de entrada na fila morta, medida por minuto, pega o incidente enquanto ele acontece e é o único desses sinais que merece acordar alguém. O aparecimento de uma assinatura nova, que nunca foi vista antes, pega o defeito recém-introduzido no dia do deploy que o criou e vira uma tarefa, não um chamado. E a idade da mensagem mais antiga não encerrada pega o vazamento lento, porque ela cresce monotonicamente enquanto ninguém olha e não depende de volume nenhum para disparar.',
        },
        {
          type: 'table',
          columns: ['Sinal', 'Detecta', 'Falha se usado sozinho', 'Destino'],
          rows: [
            [
              'Entrada por minuto acima do normal',
              'Incidente em curso',
              'Não vê acúmulo lento de dez por dia',
              'Chamado imediato',
            ],
            [
              'Assinatura de erro inédita',
              'Defeito introduzido no deploy',
              'Silencioso quando o defeito é antigo',
              'Tarefa no dia',
            ],
            [
              'Idade da mensagem mais antiga',
              'Vazamento lento e fila esquecida',
              'Só acusa depois que já acumulou',
              'Revisão semanal',
            ],
            [
              'Profundidade total da fila',
              'Nada que os outros três não peguem antes',
              'Ruidoso ou inútil, dependendo do limiar',
              'Painel apenas',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O último ajuste é de processo, não de ferramenta: a fila morta precisa de dono nomeado e de uma revisão recorrente curta, quinze minutos por semana com o relatório de triagem já pronto. A automação entrega o agrupamento, mas a decisão entre reprocessar, corrigir e encerrar é sempre humana, porque depende de contexto de negócio que nenhum classificador tem. Sem esse dono, os alertas passam a ser encaminhados e ignorados como qualquer outro, e a fila volta ao estado inicial em menos de um ano.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Quantas tentativas configurar antes de mandar a mensagem para a fila morta?',
      answer:
        'O número de tentativas importa menos do que a distinção entre os tipos de erro, e configurar um valor único para todos é o que produz filas mortas cheias de casos que nunca poderiam ter dado certo. Erros permanentes, como payload que viola o contrato, referência a uma entidade inexistente ou falha de autorização, não devem ser tentados nenhuma vez além da primeira: cada nova tentativa consome capacidade e adiciona latência para chegar ao mesmo resultado, e o único efeito prático é atrasar em minutos o momento em que o defeito fica visível. Erros transitórios, como timeout de dependência, indisponibilidade momentânea ou conflito de concorrência, se beneficiam de três a cinco tentativas com espera exponencial e uma componente aleatória, porque a maioria se resolve sozinha em segundos. A implementação que funciona é o consumidor classificar a exceção e decidir o caminho, em vez de delegar tudo à política única do broker. Um detalhe que costuma escapar é que a espera entre tentativas precisa caber dentro do tempo de visibilidade da mensagem: se o backoff ultrapassa esse limite, o broker devolve a mensagem para outro consumidor no meio da espera e o sistema processa a mesma mensagem em paralelo, o que gera efeito duplicado sem nenhum erro registrado.',
    },
    {
      question: 'Vale a pena manter uma fila morta separada por tipo de consumidor?',
      answer:
        'Vale, e o critério é a diferença de dono, não a diferença técnica. Uma fila morta única para dez consumidores diferentes produz um relatório em que ninguém se reconhece, e o resultado previsível é que nenhum time assume a análise, que é justamente o mecanismo que leva ao acúmulo. Filas mortas separadas por domínio dão a cada time um inventário que é claramente responsabilidade dele, com volume pequeno o suficiente para caber numa revisão semanal. O custo é operacional: mais filas para monitorar e mais painéis para manter, o que só compensa quando a separação corresponde a times reais. A configuração que costuma dar o melhor equilíbrio é uma fila morta por serviço, não por tipo de mensagem, com o relatório de triagem agregando todas elas numa visão única para quem precisa enxergar o conjunto. Assim a responsabilidade fica clara na operação diária e a visão transversal continua existindo para identificar defeitos que atravessam serviços, que são justamente os que nenhum time isolado enxerga.',
    },
    {
      question: 'Como lidar com a fila morta em um sistema que precisa preservar ordem?',
      answer:
        'Esse é o caso em que a fila morta padrão quebra uma garantia sem avisar, e ele exige um desenho diferente. Quando o processamento depende de ordem por entidade, mandar a terceira mensagem de uma sequência para a fila morta e continuar com a quarta significa aplicar uma atualização sobre um estado que nunca chegou, e o resultado é uma inconsistência silenciosa que aparece dias depois sem nenhum erro correspondente. A solução é parar o fluxo daquela entidade específica, não da fila inteira: ao falhar definitivamente, o consumidor marca a chave como bloqueada e passa a rotear diretamente para a fila morta toda mensagem subsequente da mesma chave, sem tentar processá-la. O restante do tráfego segue normal e a ordem daquela entidade fica preservada, ainda que interrompida. O reprocessamento, nesse desenho, tem uma exigência adicional: as mensagens precisam voltar na ordem original e antes de qualquer mensagem nova da mesma chave, o que na prática significa reprocessar com o bloqueio ainda ativo e liberá-lo apenas depois que a última mensagem pendente tiver sido concluída com sucesso.',
    },
  ],
  conclusion: {
    title: 'Uma fila morta ignorada é um defeito conhecido que ninguém está contando',
    description:
      'Quarenta e um mil mensagens paradas há catorze meses não são um problema de armazenamento, são o inventário completo de tudo que o sistema prometeu e não entregou, mantido fora do cálculo de sucesso que o time acompanha. Posso revisar o tratamento da sua fila morta e definir o envelope de descarte que torna a mensagem diagnosticável, a correção da métrica que faz o descarte contar como falha, o relatório de triagem que agrupa o volume em poucas decisões, o reprocessamento com vazão limitada e parada automática, o registro de encerramento que impede a próxima análise de recomeçar do zero e os alertas que pegam tanto o incidente quanto o vazamento lento.',
    cta: 'Falar sobre a fila morta do meu sistema',
  },
  related: [
    {
      label: 'Backpressure em pipeline de IA: quando o consumidor não acompanha',
      to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha',
    },
    {
      label: 'Chave de particionamento errada: quando um cliente sozinho ocupa a fila',
      to: '/blog/chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo',
    },
    {
      label: 'Observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'The dead letter queue held forty-one thousand messages and the oldest one was fourteen months old. Nobody had muted the alert: there had never been an alert. The dashboard showed the main queue healthy, the consumer at zero lag and the error rate at zero point three percent, because every message that failed three times left the numerator and landed somewhere no chart was watching. This article shows why a dead letter queue is a defect log and not a warehouse, which field has to travel with the message so the discard is still diagnosable months later, why the error rate the team tracks excludes exactly the failures that matter, how to group forty-one thousand messages into five causes instead of handling them one by one, why replaying everything at once usually takes down the service that had just recovered, and which rule decides what is replayable and what has to be closed for good.',
  sections: [
    {
      title: 'A dead letter queue is not a warehouse, it is a defect report',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The name gets in the way. Dead letter queue sounds like the place where things beyond repair go, and that reading authorizes exactly the behavior that produces forty-one thousand stranded messages: if it is dead, nobody needs to look. But no message arrives there by a business decision. It arrives because the consumer tried to process it, failed the configured number of times, and the broker followed the policy someone defined on the day the queue was created. Every message in there is a case where the system claimed one thing and delivered another, and the dead letter queue is the only complete inventory of those broken claims.',
        },
        {
          type: 'paragraph',
          value:
            'The practical consequence is that the dead letter queue holds information that exists nowhere else in the system. The log has the exception but rarely the full payload, and when it does, it has already been rotated. The metric has the counter but lost the identity of the message. The distributed trace has the path but almost never survives sampling, because failed requests are precisely the ones a fixed-rate sampler drops with the same probability as everything else. The dead message is the only artifact that preserves both the input data and the fact that processing failed, which is why discarding it without analysis erases the evidence of the defect along with the symptom.',
        },
        {
          type: 'paragraph',
          value:
            'There is a second effect that is quieter and more expensive. The message routed to the dead letter queue disappears from the consumer success calculation. The consumer that tried three times, failed and routed the message finished its work successfully from the broker point of view: it acknowledged and moved on. From the dashboard point of view, that unit of work is not an error, it is a completion. That is how a system with two percent real failure reports zero point three percent and spends fourteen months being considered healthy by everyone looking at the chart.',
        },
        {
          type: 'diagram',
          value: `WHAT THE DASHBOARD MEASURES

  input 100k --> [consumer] --+--> success 99.7k --> "99.7% success"
                              |
                              +--> error 300      --> error rate 0.3%
                              |
                              +--> 3 failures -> DLQ 2.0k  (in neither number)
                                                  ^
                                                  |
                                      invisible to the SLO,
                                      visible to the customer

WHAT THE CUSTOMER MEASURES

  input 100k --> expected outcome 97.7k
                 missing outcome   2.3k --> 2.3% real failure
                                           (300 errors + 2000 in the DLQ)`,
        },
        {
          type: 'paragraph',
          value:
            'The instrumentation fix is one line and worth more than any new dashboard: the consumer success rate has to count a message routed to the dead letter queue as a failure, not as a completion. In practice this means emitting the outcome metric at the point where the routing decision is made, not at the point where the broker receives the acknowledgement. Until that count changes, everything else in this article is optional, because nobody will prioritize analyzing a queue the dashboard claims does not exist.',
        },
      ],
    },
    {
      title: 'The dead message has to carry the reason, not just the body',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Most dead letter queues are useless not because they are full, but because every message stored there is identical to the original one. An order payload with three hundred fields and no indication of what happened. To find out why that message failed, someone has to reconstruct the context: find the log for that instant, if it still exists, correlate by identifier, if it made it into the log, and guess which consumer version was running. Multiplied by forty-one thousand, that work is not expensive, it is impossible, and that is exactly why the queue is never read.',
        },
        {
          type: 'paragraph',
          value:
            'The alternative is to envelope the message at the moment of discard. The original body stays intact in one field so the replay is literal, and around it go the metadata that answer the questions someone will ask months later. Five fields cover almost every case: the error class, which is what makes grouping possible; the truncated error message, which is what differentiates within the group; the consumer version, which answers whether the failure still exists in the current code; the trace identifier, which links the discard to the rest of the request; and the timestamp of the first attempt, not the last, because that is the one that locates the event that started the problem.',
        },
        {
          type: 'code',
          value: `// queue/dead-letter.js
// Envelopes the message at the moment of discard.
//
// The original body stays intact in 'payload' so the replay is literal.
// The metadata exist to answer, months later, the questions nobody can
// answer from a rotated log.

const MAX_ERROR_MESSAGE = 500;

// The error class is what turns 41k messages into 5 causes. Without
// normalization, 'timeout after 30012ms' and 'timeout after 30044ms'
// become two distinct groups and the grouping loses its purpose.
const classifyError = (error) => {
  if (error.name === 'ValidationError') return 'validation';
  if (error.name === 'TimeoutError') return 'dependency_timeout';
  if (error.status === 404) return 'reference_not_found';
  if (error.status >= 500) return 'dependency_unavailable';
  return 'unknown';
};

export const buildDeadLetter = ({ message, error, attempts, consumerVersion }) => ({
  // Original body, byte for byte. No reserializing here: any
  // normalization applied now changes what gets replayed later.
  payload: message.body,

  errorClass: classifyError(error),
  errorMessage: String(error.message ?? '').slice(0, MAX_ERROR_MESSAGE),

  // Answers 'does this failure still exist in the current code?' without
  // git archaeology. It is the field that authorizes closing a whole group.
  consumerVersion,

  // Links the discard to the rest of the request while the trace exists.
  traceId: message.headers['x-trace-id'] ?? null,

  attempts,
  // First attempt, not the last: it is the one that locates the deploy or
  // incident that started the problem. The last only records the backoff.
  firstAttemptAt: message.headers['x-first-attempt-at'] ?? message.receivedAt,
  deadLetteredAt: new Date().toISOString(),
});`,
        },
        {
          type: 'paragraph',
          value:
            'There is a compliance trap in this envelope worth anticipating. The dead message is often the longest-lived copy of personal data inside the system, because the main queue expires in days and the dead letter queue is usually configured with maximum retention. If the pipeline has a retention policy, it has to apply there too, and the same process that erases the data from the database has to reach the dead letter queue. An envelope holding the full payload for fourteen months is an exposure nobody decided to create and no inventory records.',
        },
      ],
    },
    {
      title: 'Grouping by cause turns forty-one thousand cases into five decisions',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The reason nobody starts the analysis is that the volume suggests an effort proportional to the number of messages, and it is not. Real dead letter queues have a heavily concentrated distribution: a handful of causes account for almost all the volume, and the tail is isolated cases. Forty-one thousand messages usually resolve into five or six decisions, and the hard part is reaching that grouping without loading all forty-one thousand into someone\'s head.',
        },
        {
          type: 'paragraph',
          value:
            'Useful grouping is not by error class alone, because that is too coarse: dependency_timeout lumps a two-hour incident together with sporadic failures from different months, which need opposite treatments. The key that works is the combination of error class, consumer version and an error signature with the numbers stripped out. That third part is the one usually forgotten, and without it every different millisecond in a timeout becomes its own group. With the three fields, the report comes out in a single pass and fits on one screen.',
        },
        {
          type: 'code',
          value: `// scripts/triage-dead-letter.js
// Groups the dead letter queue by cause into a report that fits on a screen.
//
// Runs in a single pass without loading everything into memory: consumption
// is batched and the accumulator only keeps a summary per group.

// Strips numbers, UUIDs and quoted values: 'timeout after 30012ms' and
// 'timeout after 30044ms' have to land in the same group.
const signatureOf = (errorMessage) =>
  errorMessage
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\\d+/g, '<n>')
    .replace(/'[^']*'|"[^"]*"/g, '<v>')
    .slice(0, 120);

const groupKey = (entry) =>
  \`\${entry.errorClass}|\${entry.consumerVersion}|\${signatureOf(entry.errorMessage)}\`;

export const triage = (entries) => {
  const groups = new Map();

  for (const entry of entries) {
    const key = groupKey(entry);
    const group = groups.get(key) ?? {
      errorClass: entry.errorClass,
      consumerVersion: entry.consumerVersion,
      signature: signatureOf(entry.errorMessage),
      count: 0,
      firstSeen: entry.firstAttemptAt,
      lastSeen: entry.firstAttemptAt,
      // One sample per group: enough to investigate, and it avoids
      // keeping 41k payloads in the report.
      sample: entry,
    };

    group.count += 1;
    if (entry.firstAttemptAt < group.firstSeen) group.firstSeen = entry.firstAttemptAt;
    if (entry.firstAttemptAt > group.lastSeen) group.lastSeen = entry.firstAttemptAt;
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      // A narrow window means a one-off incident and favors replay. A wide
      // window means a structural defect, and replaying only sends the same
      // messages back to the dead letter queue.
      spanHours:
        (Date.parse(group.lastSeen) - Date.parse(group.firstSeen)) / 3_600_000,
    }))
    .sort((a, b) => b.count - a.count);
};`,
        },
        {
          type: 'paragraph',
          value:
            'The field that decides the action is the interval between the first and last occurrence in the group. A group with nine thousand messages concentrated in two hours is the trace of an incident that already ended, and replaying fixes it. A group with nine thousand messages spread over eleven months is a defect that is still happening, and replaying only sends the same messages back to the dead letter queue next week. That distinction is the only one that changes what the team does, and it does not appear in any grouping that ignores time.',
        },
        {
          type: 'table',
          columns: ['Group profile', 'What it means', 'Correct action'],
          rows: [
            [
              'High volume, window of hours, old version',
              'Trace of a closed incident in code that has changed',
              'Replay in batches with a rate limit',
            ],
            [
              'High volume, window of months, current version',
              'Active structural defect in the consumer',
              'Fix the code first, replay afterwards',
            ],
            [
              'Validation class, any window',
              'Producer emits a payload the contract rejects',
              'Fix at the producer, close the old messages',
            ],
            [
              'Reference_not_found class, wide window',
              'The referenced entity was legitimately deleted',
              'Close for good and record the decision',
            ],
            [
              'Low volume, isolated occurrences',
              'Long tail of one-off cases',
              'Sample two or three and close the rest',
            ],
          ],
        },
      ],
    },
    {
      title: 'Replaying without taking down the service that just recovered',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The classic mistake after a good triage is to redirect the whole group back to the main queue at once. Forty thousand messages injected in seconds into a queue that processes two hundred per second under normal load produce three effects at the same time: current traffic starts waiting behind the replay, the dependency that caused the original incident gets a burst far larger than the one that took it down, and if the defect still exists, the same messages return to the dead letter queue with the attempt counter reset, erasing the history the triage had just built.',
        },
        {
          type: 'paragraph',
          value:
            'Safe replay has four properties and none of them is optional. A rate limit, so the replay consumes a fraction of capacity and current traffic keeps priority. A small canary batch before the volume, typically fifty messages, with the outcome verified before releasing the rest. An origin marker on the message, so a failure during replay is distinguishable from a new failure. And an automatic stop that halts the process when the replay failure rate crosses a threshold, because continuing past that only turns one known problem into two.',
        },
        {
          type: 'code',
          value: `// scripts/replay-dead-letter.js
// Replays a dead letter group with a rate limit and an automatic stop.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const replay = async ({
  entries,
  publish,
  ratePerSecond = 20,
  canaryBatch = 50,
  abortFailureRate = 0.2,
}) => {
  const interval = 1000 / ratePerSecond;
  const stats = { published: 0, failed: 0, aborted: false };

  for (const [index, entry] of entries.entries()) {
    try {
      await publish({
        ...entry.payload,
        headers: {
          // Marks the origin: a failure here is a known recurrence, not a
          // new case. Without it the next report counts the same defect
          // twice.
          'x-replay-of': entry.deadLetteredAt,
          'x-replay-reason': entry.errorClass,
        },
      });
      stats.published += 1;
    } catch (error) {
      stats.failed += 1;
    }

    const processed = stats.published + stats.failed;

    // Canary: stops after the first batch and hands control back to the
    // caller to check the effect before releasing the volume.
    if (processed === canaryBatch && index + 1 < entries.length) {
      return { ...stats, paused: true, remaining: entries.length - processed };
    }

    // Automatic stop: if the replay itself is failing, continuing turns
    // one known problem into two.
    if (processed >= canaryBatch && stats.failed / processed > abortFailureRate) {
      return { ...stats, aborted: true, remaining: entries.length - processed };
    }

    await sleep(interval);
  }

  return { ...stats, paused: false, aborted: false, remaining: 0 };
};`,
        },
        {
          type: 'paragraph',
          value:
            'One check is missing that teams usually discover too late: does the old message still make sense? A stock reservation event from fourteen months ago, replayed today, will debit stock that has already been sold. A notification event will send the customer a message about an order they already received. Before replaying, every group has to go through an explicit question about temporal validity, and the answer is often that the data needs to be corrected in the database rather than reinjected into the flow. Replay is the default action for recent incidents, not for everything sitting in the queue.',
        },
      ],
    },
    {
      title: 'Closing for good is a decision, and it has to be recorded',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A good share of the dead letter queue should not be replayed, and admitting that is what unlocks the cleanup. Messages whose reference entity has already been deleted, events whose validity window expired, payloads produced by a producer version that no longer exists, duplicates of something already handled by another path. The right route for those cases is not deleting silently: it is closing them with the reason recorded, because the difference between a clean queue and an emptied queue is precisely the existence of that record.',
        },
        {
          type: 'paragraph',
          value:
            'The disposition record is cheap and solves two future problems. The first is auditing: when someone asks why a given order was never processed, the answer exists and has a date, an author and a justification, instead of a silence that forces a full reconstruction. The second is recurrence: with the reason recorded, the next dead letter report can tell the group already analyzed and closed apart from the new one, and the next triage does not start from scratch. Without that record, every dead letter analysis is the first dead letter analysis.',
        },
        {
          type: 'code',
          value: `// queue/dead-letter-disposition.js
// Closing for good is a recorded decision, not a delete.

const VALID_REASONS = new Set([
  'entity_deleted',       // the referenced entity no longer exists
  'window_expired',       // the event lost its temporal validity
  'producer_retired',     // format from a producer version that is gone
  'already_processed',    // another path already produced the same effect
  'fixed_in_code',        // defect fixed, old messages irrelevant
]);

export const closeGroup = async ({ group, reason, decidedBy, store }) => {
  if (!VALID_REASONS.has(reason)) {
    // A free-text reason becomes 'other' in three months and the record
    // loses its function. The closed list is what keeps the report
    // comparable over time.
    throw new Error(\`invalid disposition reason: \${reason}\`);
  }

  return store.recordDisposition({
    signature: group.signature,
    errorClass: group.errorClass,
    consumerVersion: group.consumerVersion,
    affectedCount: group.count,
    firstSeen: group.firstSeen,
    lastSeen: group.lastSeen,
    reason,
    decidedBy,
    decidedAt: new Date().toISOString(),
  });
};

// The next triage reads previous decisions and separates what has already
// been analyzed from what is new. Without this, every dead letter analysis
// is the first dead letter analysis.
export const splitAgainstHistory = (groups, dispositions) => {
  const closed = new Map(dispositions.map((d) => [d.signature, d]));

  return {
    // A closed group that came back: the recorded reason did not hold,
    // and that is a finding in itself.
    recurring: groups
      .filter((group) => closed.has(group.signature))
      .map((group) => ({ ...group, previousDisposition: closed.get(group.signature) })),
    fresh: groups.filter((group) => !closed.has(group.signature)),
  };
};`,
        },
        {
          type: 'paragraph',
          value:
            'The recurring group is the most valuable finding in this design and it does not exist without the history. A signature closed as fixed in code that reappears three months later means the fix did not cover the whole case, and that information arrives before the volume grows enough to become an incident. It is the same reasoning as a regression test, except the trigger is production rather than the suite, which is why it catches the class of defect no written test anticipated.',
        },
      ],
    },
    {
      title: 'The alert that keeps the queue from piling up for fourteen months again',
      blocks: [
        {
          type: 'paragraph',
          value:
            'After the cleanup comes the part that determines whether the effort holds. The dead letter queue accumulated for fourteen months because nothing raised a flag, and the instinct is to create a queue depth alert with a threshold. That alert fails at both extremes: with a low threshold it fires on every incident and the team learns to ignore it within two weeks; with a high threshold it never fires on a slow leak of ten messages a day, which is exactly the pattern that produces forty-one thousand over a year.',
        },
        {
          type: 'paragraph',
          value:
            'Three signals cover the cases that matter without generating noise. The dead letter arrival rate, measured per minute, catches the incident while it is happening and is the only one of these signals that deserves to wake somebody up. The appearance of a signature never seen before catches the freshly introduced defect on the day of the deploy that created it and becomes a task, not a page. And the age of the oldest unclosed message catches the slow leak, because it grows monotonically while nobody looks and does not depend on any volume to fire.',
        },
        {
          type: 'table',
          columns: ['Signal', 'Detects', 'Fails if used alone', 'Destination'],
          rows: [
            [
              'Arrival rate above normal',
              'Incident in progress',
              'Blind to a slow buildup of ten a day',
              'Immediate page',
            ],
            [
              'Previously unseen error signature',
              'Defect introduced by the deploy',
              'Silent when the defect is old',
              'Same-day task',
            ],
            [
              'Age of the oldest message',
              'Slow leak and forgotten queue',
              'Only fires after the buildup',
              'Weekly review',
            ],
            [
              'Total queue depth',
              'Nothing the other three do not catch first',
              'Noisy or useless depending on the threshold',
              'Dashboard only',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last adjustment is process, not tooling: the dead letter queue needs a named owner and a short recurring review, fifteen minutes a week with the triage report already prepared. Automation delivers the grouping, but the decision between replaying, fixing and closing is always human, because it depends on business context no classifier has. Without that owner, the alerts get forwarded and ignored like any others, and the queue returns to its initial state in under a year.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'How many attempts should be configured before sending a message to the dead letter queue?',
      answer:
        'The number of attempts matters less than the distinction between error types, and configuring a single value for all of them is what produces dead letter queues full of cases that could never have succeeded. Permanent errors, such as a payload that violates the contract, a reference to a nonexistent entity or an authorization failure, should not be retried even once: each new attempt consumes capacity and adds latency to reach the same outcome, and the only practical effect is delaying by minutes the moment the defect becomes visible. Transient errors, such as a dependency timeout, momentary unavailability or a concurrency conflict, benefit from three to five attempts with exponential backoff and a random component, because most resolve on their own within seconds. The implementation that works is having the consumer classify the exception and choose the path, rather than delegating everything to the broker single policy. One detail that often escapes attention is that the wait between attempts has to fit inside the message visibility timeout: if the backoff exceeds that limit, the broker hands the message to another consumer in the middle of the wait and the system processes the same message in parallel, producing a duplicated effect with no error recorded anywhere.',
    },
    {
      question: 'Is it worth keeping a separate dead letter queue per consumer type?',
      answer:
        'It is, and the criterion is a difference in ownership, not a technical difference. A single dead letter queue for ten different consumers produces a report nobody recognizes themselves in, and the predictable result is that no team owns the analysis, which is exactly the mechanism that leads to accumulation. Dead letter queues split by domain give each team an inventory that is clearly its responsibility, with a volume small enough to fit into a weekly review. The cost is operational: more queues to monitor and more dashboards to maintain, which only pays off when the split matches real teams. The configuration that usually strikes the best balance is one dead letter queue per service, not per message type, with the triage report aggregating all of them into a single view for whoever needs to see the whole picture. That way responsibility is clear in daily operations and the cross-cutting view still exists to identify defects that span services, which are precisely the ones no isolated team can see.',
    },
    {
      question: 'How do you handle a dead letter queue in a system that must preserve ordering?',
      answer:
        'This is the case where the standard dead letter queue breaks a guarantee without warning, and it requires a different design. When processing depends on per-entity ordering, sending the third message of a sequence to the dead letter queue and continuing with the fourth means applying an update on top of a state that never arrived, and the result is a silent inconsistency that surfaces days later with no matching error. The solution is to stop the flow for that specific entity, not for the whole queue: on definitive failure, the consumer marks the key as blocked and starts routing every subsequent message with the same key straight to the dead letter queue without trying to process it. The rest of the traffic proceeds normally and the ordering for that entity stays intact, even if interrupted. Replay, in this design, carries an extra requirement: the messages have to come back in their original order and ahead of any new message for the same key, which in practice means replaying while the block is still active and releasing it only after the last pending message has completed successfully.',
    },
  ],
  conclusion: {
    title: 'An ignored dead letter queue is a known defect nobody is counting',
    description:
      'Forty-one thousand messages stranded for fourteen months are not a storage problem, they are the complete inventory of everything the system promised and did not deliver, kept outside the success calculation the team tracks. I can review how your dead letter queue is handled and define the discard envelope that makes the message diagnosable, the metric fix that makes a discard count as a failure, the triage report that groups the volume into a few decisions, the replay with a rate limit and an automatic stop, the disposition record that keeps the next analysis from starting over, and the alerts that catch both the incident and the slow leak.',
    cta: 'Talk about my system dead letter queue',
  },
  related: [
    {
      label: 'Backpressure in AI pipelines: when the consumer cannot keep up',
      to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha',
    },
    {
      label: 'The wrong partition key: when a single customer takes over the queue',
      to: '/blog/chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo',
    },
    {
      label: 'Observability and reliability',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'La cola muerta tenía cuarenta y un mil mensajes y el más antiguo era de hace catorce meses. Nadie había silenciado la alerta: nunca existió una alerta. El panel mostraba la cola principal saludable, el consumidor con lag cero y la tasa de error en cero coma tres por ciento, porque todo mensaje que fallaba tres veces salía del numerador e iba a parar a un lugar que ningún gráfico observaba. Este artículo muestra por qué la cola muerta es un registro de defectos y no un depósito, qué campo tiene que acompañar al mensaje para que el descarte sea diagnosticable meses después, por qué la tasa de error que el equipo sigue excluye justamente las fallas que importan, cómo agrupar cuarenta y un mil mensajes en cinco causas en vez de tratarlos uno por uno, por qué reprocesar todo de golpe suele tumbar el servicio que acababa de recuperarse, y qué regla decide qué es reprocesable y qué hay que cerrar sin retorno.',
  sections: [
    {
      title: 'La cola muerta no es un depósito, es un informe de defectos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El nombre estorba. Cola de mensajes muertos suena al lugar donde van las cosas que ya no tienen arreglo, y esa lectura autoriza justamente el comportamiento que produce cuarenta y un mil mensajes parados: si está muerto, nadie necesita mirarlo. Pero ningún mensaje llega ahí por una decisión de negocio. Llega porque el consumidor intentó procesarlo, falló el número configurado de veces y el broker siguió la política que alguien definió el día en que se creó la cola. Cada mensaje en ese lugar es un caso en que el sistema afirmó una cosa y entregó otra, y la cola muerta es el único inventario completo de esas afirmaciones rotas.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia práctica es que la cola muerta contiene información que no existe en ningún otro lugar del sistema. El log tiene la excepción pero rara vez el payload completo, y cuando lo tiene, ya fue rotado. La métrica tiene el contador pero perdió la identidad del mensaje. El rastreo distribuido tiene el camino pero casi nunca sobrevive al muestreo, porque justamente las peticiones con error son las que el muestreo por tasa fija descarta con la misma probabilidad que las demás. El mensaje muerto es el único artefacto que preserva a la vez el dato de entrada y el hecho de que el procesamiento falló, y por eso descartarlo sin análisis borra la evidencia del defecto junto con el síntoma.',
        },
        {
          type: 'paragraph',
          value:
            'Hay un segundo efecto más silencioso y más caro. El mensaje que va a la cola muerta desaparece del cálculo de éxito del consumidor. El consumidor que intentó tres veces, falló y enrutó el mensaje terminó su trabajo con éxito desde el punto de vista del broker: confirmó la recepción y siguió con el siguiente. Desde el punto de vista del panel, esa unidad de trabajo no es un error, es una conclusión. Así es como un sistema con dos por ciento de falla real reporta cero coma tres por ciento y pasa catorce meses siendo considerado saludable por todos los que miran el gráfico.',
        },
        {
          type: 'diagram',
          value: `LO QUE MIDE EL PANEL

  entrada 100k --> [consumidor] --+--> exito 99.7k --> "99.7% de exito"
                                  |
                                  +--> error 300   --> tasa de error 0.3%
                                  |
                                  +--> 3 fallas -> DLQ 2.0k  (en ninguno de los dos)
                                                    ^
                                                    |
                                        invisible para el SLO,
                                        visible para el cliente

LO QUE MIDE EL CLIENTE

  entrada 100k --> resultado esperado 97.7k
                   resultado ausente   2.3k --> 2.3% de falla real
                                              (300 errores + 2000 en la DLQ)`,
        },
        {
          type: 'paragraph',
          value:
            'La corrección de instrumentación es de una línea y vale más que cualquier panel nuevo: la tasa de éxito del consumidor tiene que contar el mensaje enrutado a la cola muerta como falla, y no como conclusión. En la práctica eso significa emitir la métrica de resultado en el punto donde se toma la decisión de enrutamiento, y no en el punto donde el broker recibe la confirmación. Mientras ese conteo no cambie, todo el resto de este artículo es opcional, porque nadie va a priorizar el análisis de una cola que el panel afirma que no existe.',
        },
      ],
    },
    {
      title: 'El mensaje muerto tiene que cargar el motivo, no solo el cuerpo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La mayoría de las colas muertas son inútiles no por estar llenas, sino porque cada mensaje guardado ahí es idéntico al mensaje original. Un payload de pedido con trescientos campos y ninguna indicación de lo que pasó. Para descubrir por qué falló ese mensaje, alguien tiene que reconstruir el contexto: encontrar el log de ese instante, si todavía existe, correlacionar por identificador, si llegó al log, y adivinar qué versión del consumidor estaba corriendo. Multiplicado por cuarenta y un mil, ese trabajo no es caro, es imposible, y es exactamente por eso que la cola nunca se lee.',
        },
        {
          type: 'paragraph',
          value:
            'La alternativa es envolver el mensaje en el momento del descarte. El cuerpo original queda intacto en un campo, para que el reprocesamiento sea literal, y a su alrededor entran los metadatos que responden las preguntas que alguien va a hacer meses después. Cinco campos resuelven casi todos los casos: la clase del error, que es lo que permite agrupar; el mensaje del error truncado, que es lo que permite diferenciar dentro del grupo; la versión del consumidor, que responde si la falla todavía existe en el código actual; el identificador de rastreo, que liga el descarte al resto de la petición; y la marca de tiempo del primer intento, no del último, porque es la que localiza el evento que originó el problema.',
        },
        {
          type: 'code',
          value: `// queue/dead-letter.js
// Envuelve el mensaje en el momento del descarte.
//
// El cuerpo original queda intacto en 'payload' para que el reprocesamiento
// sea literal. Los metadatos existen para responder, meses despues, las
// preguntas que nadie puede responder con el log rotado.

const MAX_ERROR_MESSAGE = 500;

// La clase del error es lo que convierte 41k mensajes en 5 causas. Sin
// normalizacion, 'timeout after 30012ms' y 'timeout after 30044ms' se
// vuelven dos grupos distintos y el agrupamiento pierde su utilidad.
const classifyError = (error) => {
  if (error.name === 'ValidationError') return 'validation';
  if (error.name === 'TimeoutError') return 'dependency_timeout';
  if (error.status === 404) return 'reference_not_found';
  if (error.status >= 500) return 'dependency_unavailable';
  return 'unknown';
};

export const buildDeadLetter = ({ message, error, attempts, consumerVersion }) => ({
  // Cuerpo original, byte a byte. Nada de reserializar aqui: cualquier
  // normalizacion aplicada ahora cambia lo que se reprocesara despues.
  payload: message.body,

  errorClass: classifyError(error),
  errorMessage: String(error.message ?? '').slice(0, MAX_ERROR_MESSAGE),

  // Responde 'esta falla todavia existe en el codigo actual?' sin
  // arqueologia de git. Es el campo que autoriza cerrar un grupo entero.
  consumerVersion,

  // Liga el descarte al resto de la peticion mientras el trace exista.
  traceId: message.headers['x-trace-id'] ?? null,

  attempts,
  // Primer intento, no el ultimo: es el que localiza el despliegue o el
  // incidente que inicio el problema. El ultimo solo registra el backoff.
  firstAttemptAt: message.headers['x-first-attempt-at'] ?? message.receivedAt,
  deadLetteredAt: new Date().toISOString(),
});`,
        },
        {
          type: 'paragraph',
          value:
            'Hay una trampa de cumplimiento en ese envoltorio que conviene anticipar. El mensaje muerto suele ser la copia más duradera de un dato personal dentro del sistema, porque la cola principal expira en días y la cola muerta suele configurarse con retención máxima. Si el pipeline tiene una política de retención, tiene que valer también ahí, y el mismo proceso que borra el dato de la base tiene que alcanzar la cola muerta. Un envoltorio que guarda el payload completo durante catorce meses es una exposición que nadie decidió crear y que ningún inventario registra.',
        },
      ],
    },
    {
      title: 'Agrupar por causa convierte cuarenta y un mil casos en cinco decisiones',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La razón por la que nadie empieza el análisis es que el volumen sugiere un esfuerzo proporcional al número de mensajes, y no lo es. Las colas muertas reales tienen una distribución fuertemente concentrada: un puñado de causas responde por casi todo el volumen, y la cola larga son casos aislados. Cuarenta y un mil mensajes suelen resolverse en cinco o seis decisiones, y el trabajo difícil es llegar a ese agrupamiento sin cargar los cuarenta y un mil en la cabeza de alguien.',
        },
        {
          type: 'paragraph',
          value:
            'El agrupamiento útil no es por clase de error sola, porque es demasiado gruesa: dependency_timeout junta la cola entera de un incidente de dos horas con fallas esporádicas de meses distintos, que exigen tratamientos opuestos. La clave que funciona es la combinación de clase del error con versión del consumidor y una firma del error con los números removidos. Esa tercera parte es la que suele olvidarse, y sin ella cada milisegundo distinto en un timeout se vuelve un grupo propio. Con los tres campos, el informe sale en una pasada y cabe en una pantalla.',
        },
        {
          type: 'code',
          value: `// scripts/triage-dead-letter.js
// Agrupa la cola muerta por causa en un informe que cabe en una pantalla.
//
// Corre en una pasada, sin cargar todo en memoria: el consumo es por lote
// y el acumulador solo guarda un resumen por grupo.

// Quita numeros, UUIDs y comillas: 'timeout after 30012ms' y
// 'timeout after 30044ms' tienen que caer en el mismo grupo.
const signatureOf = (errorMessage) =>
  errorMessage
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\\d+/g, '<n>')
    .replace(/'[^']*'|"[^"]*"/g, '<v>')
    .slice(0, 120);

const groupKey = (entry) =>
  \`\${entry.errorClass}|\${entry.consumerVersion}|\${signatureOf(entry.errorMessage)}\`;

export const triage = (entries) => {
  const groups = new Map();

  for (const entry of entries) {
    const key = groupKey(entry);
    const group = groups.get(key) ?? {
      errorClass: entry.errorClass,
      consumerVersion: entry.consumerVersion,
      signature: signatureOf(entry.errorMessage),
      count: 0,
      firstSeen: entry.firstAttemptAt,
      lastSeen: entry.firstAttemptAt,
      // Una muestra por grupo: suficiente para investigar, y evita
      // guardar 41k payloads en el informe.
      sample: entry,
    };

    group.count += 1;
    if (entry.firstAttemptAt < group.firstSeen) group.firstSeen = entry.firstAttemptAt;
    if (entry.firstAttemptAt > group.lastSeen) group.lastSeen = entry.firstAttemptAt;
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      // Ventana concentrada indica incidente puntual y favorece el
      // reprocesamiento. Ventana ancha indica defecto estructural y
      // reprocesar solo devuelve los mismos mensajes a la cola muerta.
      spanHours:
        (Date.parse(group.lastSeen) - Date.parse(group.firstSeen)) / 3_600_000,
    }))
    .sort((a, b) => b.count - a.count);
};`,
        },
        {
          type: 'paragraph',
          value:
            'El campo que decide la acción es el intervalo entre la primera y la última ocurrencia del grupo. Un grupo con nueve mil mensajes concentrados en dos horas es el rastro de un incidente que ya terminó, y reprocesar lo resuelve. Un grupo con nueve mil mensajes repartidos en once meses es un defecto que sigue ocurriendo, y reprocesar solo devuelve los mismos mensajes a la cola muerta la semana siguiente. Esa distinción es la única que cambia lo que hace el equipo, y no aparece en ningún agrupamiento que ignore el tiempo.',
        },
        {
          type: 'table',
          columns: ['Perfil del grupo', 'Qué significa', 'Acción correcta'],
          rows: [
            [
              'Volumen alto, ventana de horas, versión antigua',
              'Rastro de un incidente cerrado en código que ya cambió',
              'Reprocesar por lotes con límite de caudal',
            ],
            [
              'Volumen alto, ventana de meses, versión actual',
              'Defecto estructural activo en el consumidor',
              'Corregir el código primero, reprocesar después',
            ],
            [
              'Clase validation, cualquier ventana',
              'El productor emite un payload que el contrato rechaza',
              'Corregir en el productor, cerrar los mensajes antiguos',
            ],
            [
              'Clase reference_not_found, ventana ancha',
              'La entidad referenciada fue borrada legítimamente',
              'Cerrar sin retorno y registrar la decisión',
            ],
            [
              'Volumen bajo, ocurrencias aisladas',
              'Cola larga de casos únicos',
              'Muestrear dos o tres y cerrar el resto',
            ],
          ],
        },
      ],
    },
    {
      title: 'Reprocesar sin tumbar el servicio que acaba de recuperarse',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error clásico después de una buena clasificación es redirigir el grupo entero de vuelta a la cola principal de una sola vez. Cuarenta mil mensajes inyectados en segundos en una cola que procesa doscientos por segundo en régimen normal producen tres efectos al mismo tiempo: el tráfico actual pasa a esperar detrás del reprocesamiento, la dependencia que causó el incidente original recibe una ráfaga mucho mayor que la que la tumbó, y si el defecto todavía existe, los mismos mensajes vuelven a la cola muerta con el contador de intentos en cero, borrando el historial que la clasificación acababa de construir.',
        },
        {
          type: 'paragraph',
          value:
            'El reprocesamiento seguro tiene cuatro propiedades y ninguna es opcional. Caudal limitado, para que el reprocesamiento consuma una fracción de la capacidad y el tráfico actual mantenga la prioridad. Lote pequeño de prueba antes del volumen, típicamente cincuenta mensajes, con verificación del resultado antes de liberar el resto. Marca de origen en el mensaje, para que una falla durante el reprocesamiento sea distinguible de una falla nueva. Y punto de parada automático, que interrumpe el proceso cuando la tasa de falla del propio reprocesamiento supera un umbral, porque continuar después de eso solo convierte un problema conocido en dos.',
        },
        {
          type: 'code',
          value: `// scripts/replay-dead-letter.js
// Reprocesa un grupo de la cola muerta con caudal limitado y parada automatica.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const replay = async ({
  entries,
  publish,
  ratePerSecond = 20,
  canaryBatch = 50,
  abortFailureRate = 0.2,
}) => {
  const interval = 1000 / ratePerSecond;
  const stats = { published: 0, failed: 0, aborted: false };

  for (const [index, entry] of entries.entries()) {
    try {
      await publish({
        ...entry.payload,
        headers: {
          // Marca el origen: una falla aqui es una reincidencia conocida,
          // no un caso nuevo. Sin esto el proximo informe cuenta el mismo
          // defecto dos veces.
          'x-replay-of': entry.deadLetteredAt,
          'x-replay-reason': entry.errorClass,
        },
      });
      stats.published += 1;
    } catch (error) {
      stats.failed += 1;
    }

    const processed = stats.published + stats.failed;

    // Canario: para despues del primer lote y devuelve el control a quien
    // llamo para verificar el efecto antes de liberar el volumen.
    if (processed === canaryBatch && index + 1 < entries.length) {
      return { ...stats, paused: true, remaining: entries.length - processed };
    }

    // Parada automatica: si el propio reprocesamiento esta fallando,
    // continuar convierte un problema conocido en dos.
    if (processed >= canaryBatch && stats.failed / processed > abortFailureRate) {
      return { ...stats, aborted: true, remaining: entries.length - processed };
    }

    await sleep(interval);
  }

  return { ...stats, paused: false, aborted: false, remaining: 0 };
};`,
        },
        {
          type: 'paragraph',
          value:
            'Falta una verificación que suele descubrirse demasiado tarde: el mensaje antiguo, ¿todavía tiene sentido? Un evento de reserva de stock de hace catorce meses, reprocesado hoy, va a debitar un stock que ya fue vendido. Un evento de notificación va a enviarle al cliente un mensaje sobre un pedido que ya recibió. Antes de reprocesar, cada grupo tiene que pasar por una pregunta explícita sobre validez temporal, y la respuesta muchas veces es que el dato necesita corregirse en la base y no reinyectarse en el flujo. Reprocesar es la acción por defecto para incidentes recientes, no para todo lo que esté en la cola.',
        },
      ],
    },
    {
      title: 'Cerrar sin retorno es una decisión, y tiene que quedar registrada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Buena parte de la cola muerta no debe reprocesarse, y admitirlo es lo que destraba la limpieza. Mensajes cuya entidad de referencia ya fue borrada, eventos cuya ventana de validez expiró, payloads generados por una versión del productor que ya no existe, duplicados de algo que ya fue procesado por otro camino. El camino correcto para esos casos no es borrar en silencio: es cerrar registrando el motivo, porque la diferencia entre una cola limpia y una cola vaciada es justamente la existencia de ese registro.',
        },
        {
          type: 'paragraph',
          value:
            'El registro de cierre es barato y resuelve dos problemas futuros. El primero es la auditoría: cuando alguien pregunte por qué tal pedido nunca fue procesado, la respuesta existe y tiene fecha, autor y justificación, en vez de un silencio que obliga a reconstruir todo. El segundo es la reincidencia: con el motivo registrado, el siguiente informe de la cola muerta logra distinguir el grupo que ya fue analizado y cerrado del grupo nuevo, y la clasificación siguiente no empieza de cero. Sin ese registro, cada análisis de la cola muerta es el primer análisis de la cola muerta.',
        },
        {
          type: 'code',
          value: `// queue/dead-letter-disposition.js
// Cerrar sin retorno es una decision registrada, no un delete.

const VALID_REASONS = new Set([
  'entity_deleted',       // la entidad referenciada ya no existe
  'window_expired',       // el evento perdio validez temporal
  'producer_retired',     // formato de una version del productor que ya no existe
  'already_processed',    // otro camino ya produjo el mismo efecto
  'fixed_in_code',        // defecto corregido, mensajes antiguos irrelevantes
]);

export const closeGroup = async ({ group, reason, decidedBy, store }) => {
  if (!VALID_REASONS.has(reason)) {
    // Un motivo libre se vuelve 'otros' en tres meses y el registro pierde
    // su funcion. La lista cerrada es lo que mantiene el informe comparable.
    throw new Error(\`motivo de cierre invalido: \${reason}\`);
  }

  return store.recordDisposition({
    signature: group.signature,
    errorClass: group.errorClass,
    consumerVersion: group.consumerVersion,
    affectedCount: group.count,
    firstSeen: group.firstSeen,
    lastSeen: group.lastSeen,
    reason,
    decidedBy,
    decidedAt: new Date().toISOString(),
  });
};

// La clasificacion siguiente consulta las decisiones anteriores y separa
// lo ya analizado de lo nuevo. Sin esto, todo analisis de la cola muerta
// es el primer analisis de la cola muerta.
export const splitAgainstHistory = (groups, dispositions) => {
  const closed = new Map(dispositions.map((d) => [d.signature, d]));

  return {
    // Grupo ya cerrado que volvio a aparecer: el motivo registrado no se
    // sostuvo, y eso es un hallazgo por si solo.
    recurring: groups
      .filter((group) => closed.has(group.signature))
      .map((group) => ({ ...group, previousDisposition: closed.get(group.signature) })),
    fresh: groups.filter((group) => !closed.has(group.signature)),
  };
};`,
        },
        {
          type: 'paragraph',
          value:
            'El grupo reincidente es el hallazgo más valioso de este diseño y no existe sin el historial. Una firma cerrada como corregida en el código que reaparece tres meses después significa que la corrección no cubrió el caso entero, y esa información llega antes de que el volumen crezca lo suficiente para volverse incidente. Es el mismo razonamiento de una prueba de regresión, con la diferencia de que el disparador es la producción y no la suite, y por eso encuentra la clase de defecto que ninguna prueba escrita anticipó.',
        },
      ],
    },
    {
      title: 'La alerta que impide que la cola vuelva a acumular catorce meses',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Después de la limpieza viene la parte que determina si el esfuerzo se sostiene. La cola muerta acumuló catorce meses porque nada avisaba, y el instinto es crear una alerta de profundidad de cola con un umbral. Esa alerta falla en los dos extremos: con umbral bajo dispara en cualquier incidente y el equipo aprende a ignorarla en dos semanas; con umbral alto nunca dispara ante una fuga lenta de diez mensajes por día, que es exactamente el patrón que produce cuarenta y un mil a lo largo de un año.',
        },
        {
          type: 'paragraph',
          value:
            'Tres señales cubren los casos que importan sin generar ruido. La tasa de entrada en la cola muerta, medida por minuto, captura el incidente mientras ocurre y es la única de esas señales que merece despertar a alguien. La aparición de una firma nueva, que nunca se vio antes, captura el defecto recién introducido el día del despliegue que lo creó y se convierte en una tarea, no en una llamada. Y la edad del mensaje más antiguo sin cerrar captura la fuga lenta, porque crece de forma monótona mientras nadie mira y no depende de ningún volumen para dispararse.',
        },
        {
          type: 'table',
          columns: ['Señal', 'Detecta', 'Falla si se usa sola', 'Destino'],
          rows: [
            [
              'Entrada por minuto por encima de lo normal',
              'Incidente en curso',
              'No ve la acumulación lenta de diez por día',
              'Llamada inmediata',
            ],
            [
              'Firma de error inédita',
              'Defecto introducido en el despliegue',
              'Silenciosa cuando el defecto es antiguo',
              'Tarea del día',
            ],
            [
              'Edad del mensaje más antiguo',
              'Fuga lenta y cola olvidada',
              'Solo avisa cuando ya se acumuló',
              'Revisión semanal',
            ],
            [
              'Profundidad total de la cola',
              'Nada que las otras tres no capturen antes',
              'Ruidosa o inútil según el umbral',
              'Solo panel',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El último ajuste es de proceso, no de herramienta: la cola muerta necesita un dueño nombrado y una revisión recurrente corta, quince minutos por semana con el informe de clasificación ya listo. La automatización entrega el agrupamiento, pero la decisión entre reprocesar, corregir y cerrar es siempre humana, porque depende de contexto de negocio que ningún clasificador tiene. Sin ese dueño, las alertas pasan a reenviarse e ignorarse como cualquier otra, y la cola vuelve al estado inicial en menos de un año.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cuántos intentos configurar antes de mandar el mensaje a la cola muerta?',
      answer:
        'El número de intentos importa menos que la distinción entre los tipos de error, y configurar un valor único para todos es lo que produce colas muertas llenas de casos que nunca podrían haber funcionado. Los errores permanentes, como un payload que viola el contrato, una referencia a una entidad inexistente o una falla de autorización, no deben reintentarse ninguna vez más allá de la primera: cada nuevo intento consume capacidad y agrega latencia para llegar al mismo resultado, y el único efecto práctico es retrasar en minutos el momento en que el defecto se hace visible. Los errores transitorios, como un timeout de dependencia, una indisponibilidad momentánea o un conflicto de concurrencia, se benefician de tres a cinco intentos con espera exponencial y una componente aleatoria, porque la mayoría se resuelve sola en segundos. La implementación que funciona es que el consumidor clasifique la excepción y decida el camino, en vez de delegar todo a la política única del broker. Un detalle que suele escaparse es que la espera entre intentos tiene que caber dentro del tiempo de visibilidad del mensaje: si el backoff supera ese límite, el broker entrega el mensaje a otro consumidor en medio de la espera y el sistema procesa el mismo mensaje en paralelo, lo que genera un efecto duplicado sin ningún error registrado.',
    },
    {
      question: '¿Vale la pena mantener una cola muerta separada por tipo de consumidor?',
      answer:
        'Vale, y el criterio es la diferencia de dueño, no la diferencia técnica. Una cola muerta única para diez consumidores distintos produce un informe en el que nadie se reconoce, y el resultado previsible es que ningún equipo asume el análisis, que es justamente el mecanismo que lleva a la acumulación. Colas muertas separadas por dominio le dan a cada equipo un inventario que es claramente su responsabilidad, con un volumen lo bastante pequeño para caber en una revisión semanal. El costo es operativo: más colas que monitorear y más paneles que mantener, lo que solo compensa cuando la separación corresponde a equipos reales. La configuración que suele dar el mejor equilibrio es una cola muerta por servicio, no por tipo de mensaje, con el informe de clasificación agregando todas ellas en una vista única para quien necesita ver el conjunto. Así la responsabilidad queda clara en la operación diaria y la vista transversal sigue existiendo para identificar defectos que atraviesan servicios, que son justamente los que ningún equipo aislado ve.',
    },
    {
      question: '¿Cómo tratar la cola muerta en un sistema que necesita preservar el orden?',
      answer:
        'Este es el caso en que la cola muerta estándar rompe una garantía sin avisar, y exige un diseño distinto. Cuando el procesamiento depende del orden por entidad, mandar el tercer mensaje de una secuencia a la cola muerta y continuar con el cuarto significa aplicar una actualización sobre un estado que nunca llegó, y el resultado es una inconsistencia silenciosa que aparece días después sin ningún error correspondiente. La solución es detener el flujo de esa entidad específica, no de la cola entera: al fallar definitivamente, el consumidor marca la clave como bloqueada y pasa a enrutar directamente a la cola muerta todo mensaje posterior de la misma clave, sin intentar procesarlo. El resto del tráfico sigue normal y el orden de esa entidad queda preservado, aunque interrumpido. El reprocesamiento, en este diseño, tiene una exigencia adicional: los mensajes tienen que volver en el orden original y antes de cualquier mensaje nuevo de la misma clave, lo que en la práctica significa reprocesar con el bloqueo todavía activo y liberarlo solo después de que el último mensaje pendiente se haya completado con éxito.',
    },
  ],
  conclusion: {
    title: 'Una cola muerta ignorada es un defecto conocido que nadie está contando',
    description:
      'Cuarenta y un mil mensajes parados hace catorce meses no son un problema de almacenamiento, son el inventario completo de todo lo que el sistema prometió y no entregó, mantenido fuera del cálculo de éxito que el equipo sigue. Puedo revisar el tratamiento de tu cola muerta y definir el envoltorio de descarte que hace el mensaje diagnosticable, la corrección de la métrica que hace que el descarte cuente como falla, el informe de clasificación que agrupa el volumen en pocas decisiones, el reprocesamiento con caudal limitado y parada automática, el registro de cierre que impide que el próximo análisis empiece de cero y las alertas que capturan tanto el incidente como la fuga lenta.',
    cta: 'Hablar sobre la cola muerta de mi sistema',
  },
  related: [
    {
      label: 'Backpressure en un pipeline de IA: cuando el consumidor no da abasto',
      to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha',
    },
    {
      label: 'Clave de particionamiento equivocada: cuando un solo cliente ocupa la cola',
      to: '/blog/chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo',
    },
    {
      label: 'Observabilidad y confiabilidad',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

export default { pt, en, es };
