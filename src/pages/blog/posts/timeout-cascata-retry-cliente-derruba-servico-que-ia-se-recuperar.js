// Conteudo do artigo: timeout em cascata e retry que impede a recuperacao.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O banco de dados ficou lento por quarenta segundos. O incidente durou vinte e dois minutos. Entre uma coisa e outra existe um mecanismo que quase todo sistema distribuído carrega sem perceber: o cliente desiste antes do servidor terminar, tenta de novo, e a tentativa nova chega em cima do trabalho antigo que ninguém cancelou. Este artigo mostra por que o timeout do cliente e a duração real do trabalho no servidor são grandezas independentes, por que a soma dos timeouts em cadeia produz uma espera que ninguém configurou, como o retry multiplica carga exatamente no pior momento e por que backoff sozinho não conserta, qual sinal precisa atravessar a cadeia para o trabalho abandonado morrer junto, por que a política de tentativa precisa de um orçamento global em vez de um contador local, e quais testes reproduzem a cascata antes de ela acontecer em produção.',
  sections: [
    {
      title: 'O timeout do cliente não interrompe o trabalho do servidor',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira coisa a entender é que timeout é uma decisão do lado que espera, não do lado que trabalha. Quando o cliente estoura três segundos e fecha a espera, o que acontece na prática é que ele para de ler a resposta. A consulta continua rodando no banco, a transação continua segurando o lock, o pool continua com a conexão ocupada, o handler continua alocando memória. Do ponto de vista do servidor, nada mudou: ele ainda está processando um pedido que já não tem destinatário. Esse trabalho órfão é a matéria-prima da cascata, porque ele consome recurso e não produz nem sucesso nem erro visível.',
        },
        {
          type: 'paragraph',
          value:
            'A consequência prática aparece na aritmética. Suponha um endpoint que normalmente responde em duzentos milissegundos, com timeout de cliente em três segundos e uma tentativa extra. Sob degradação, a resposta passa a levar oito segundos. O cliente desiste aos três, tenta de novo, e a segunda tentativa também desiste aos três. Ao fim de seis segundos, o cliente reporta falha e o servidor está com duas execuções vivas do mesmo pedido, ambas destinadas ao descarte. Se o volume de entrada for de mil requisições por segundo, o servidor não está processando mil, está processando algo entre duas e três mil, precisamente enquanto tenta se recuperar do que causou a lentidão inicial.',
        },
        {
          type: 'diagram',
          value: `SEM PROPAGACAO DE CANCELAMENTO

cliente   |--espera 3s--|X (desiste, tenta de novo)
                        |--espera 3s--|X (desiste, reporta erro)

servidor  |=========trabalho 1 (8s, orfao apos 3s)=========|
                        |=========trabalho 2 (8s, orfao)=========|

                        ^ a partir daqui o servidor
                          processa 2x a carga real
                          e nenhum dos dois resultados
                          tem quem receba

COM PROPAGACAO DE CANCELAMENTO

cliente   |--espera 3s--|X
servidor  |==trabalho 1==|X  <- abortado junto, libera conexao e lock`,
        },
        {
          type: 'paragraph',
          value:
            'Vale nomear o efeito com precisão, porque ele costuma ser confundido com sobrecarga comum. Sobrecarga é quando chega mais tráfego do que a capacidade. Aqui a carga externa não mudou: o que aumentou foi a carga interna gerada pelo próprio mecanismo de tolerância a falha. O sistema está se atacando com o comportamento que existia para protegê-lo, e por isso a lentidão inicial de quarenta segundos vira um incidente de vinte minutos: mesmo depois de o banco se recuperar, a fila de trabalho acumulada e as tentativas em voo mantêm a saturação por conta própria.',
        },
      ],
    },
    {
      title: 'Timeouts em cadeia somam, e a soma ninguém configurou',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Em uma arquitetura com mais de duas camadas, cada serviço costuma ter seu próprio timeout configurado de forma isolada, escolhido por quem escreveu aquele cliente HTTP naquela semana. O problema é que esses valores se compõem de maneira multiplicativa quando há retry, e não aditiva como a intuição sugere. Uma cadeia de três serviços, cada um com timeout de cinco segundos e duas tentativas, produz um pior caso de trinta segundos para uma requisição que o navegador desiste de esperar aos dez. Ninguém escreveu trinta em lugar nenhum: o número emergiu da composição.',
        },
        {
          type: 'table',
          columns: ['Camada', 'Timeout local', 'Tentativas', 'Pior caso acumulado'],
          rows: [
            [
              'Navegador ou app',
              '10s',
              '1',
              '10s (é o único orçamento que o usuário percebe)',
            ],
            [
              'API de borda',
              '5s por chamada',
              '2',
              '10s, já no limite do que o cliente aceita',
            ],
            [
              'Serviço de domínio',
              '5s por chamada',
              '2',
              '20s, ninguém do lado de fora ainda está esperando',
            ],
            [
              'Banco ou serviço externo',
              '5s por consulta',
              '2',
              '30s de trabalho que nunca teve destinatário',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A correção não é escolher números menores por tentativa e erro, é inverter o sentido em que o valor é decidido. O timeout deixa de ser configuração local de cada cliente e passa a ser um orçamento que entra pela borda e é distribuído para dentro: a borda recebe dez segundos, gasta o que precisa em validação e roteamento e repassa o restante como prazo explícito para a próxima camada, que faz o mesmo. Cada serviço recebe quanto tempo ainda tem, em vez de decidir sozinho quanto tempo quer. A regra que fecha o desenho é simples de verificar: nenhuma camada pode prometer para baixo um prazo maior do que aquele que recebeu de cima.',
        },
        {
          type: 'code',
          value: `// http/deadline.js
// Orcamento de tempo que atravessa a cadeia como prazo absoluto.
//
// Prazo absoluto, nao duracao relativa: se cada camada repassasse
// "voce tem 5s", o tempo ja gasto na camada anterior seria esquecido
// e o total cresceria a cada salto. Um instante de expiracao so pode
// diminuir conforme desce.

const DEADLINE_HEADER = 'x-deadline-ms';
// Margem para a resposta voltar pela rede antes de o chamador desistir.
// Sem ela, o servico termina exatamente no instante em que o cliente
// para de ouvir, e o trabalho e desperdicado no ultimo milissegundo.
const NETWORK_MARGIN_MS = 150;

export const deadlineFromRequest = (req, fallbackMs) => {
  const header = Number(req.headers[DEADLINE_HEADER]);
  // Nunca aceite um prazo maior que o fallback local: um cliente
  // que pede 60s nao pode alongar o orcamento do servico.
  if (Number.isFinite(header) && header > 0) {
    return Math.min(header, Date.now() + fallbackMs);
  }
  return Date.now() + fallbackMs;
};

export const remainingMs = (deadline) => deadline - Date.now();

// Prazo repassado para a proxima chamada: o que sobra, menos a margem.
// Retorna null quando ja nao ha tempo util, e o chamador deve falhar
// rapido em vez de iniciar um trabalho que nascera orfao.
export const childDeadline = (deadline, reserveMs = NETWORK_MARGIN_MS) => {
  const remaining = remainingMs(deadline) - reserveMs;
  return remaining > 0 ? Date.now() + remaining : null;
};

export const callDownstream = async (url, { deadline, signal, body }) => {
  const child = childDeadline(deadline);
  if (child === null) {
    const error = new Error('deadline_exceeded_before_call');
    error.code = 'DEADLINE_EXCEEDED';
    throw error;
  }

  // AbortSignal.any junta o cancelamento vindo de cima com o timeout local:
  // qualquer um dos dois aborta a chamada, e o trabalho para de verdade.
  const localTimeout = AbortSignal.timeout(remainingMs(child));
  const combined = AbortSignal.any([signal, localTimeout].filter(Boolean));

  return fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      [DEADLINE_HEADER]: String(child),
    },
    signal: combined,
  });
};`,
        },
        {
          type: 'paragraph',
          value:
            'Um detalhe de implementação decide se isso funciona ou não: o prazo precisa viajar como instante de expiração, não como duração. Se cada camada repassa a string cinco segundos, o tempo já gasto pela camada anterior desaparece da conta e o orçamento é renovado a cada salto, que é exatamente o bug que se queria evitar. Repassando um instante, o valor só pode encolher. O custo dessa escolha é depender de relógios razoavelmente sincronizados entre os serviços, o que é aceitável dentro de um mesmo ambiente com NTP, mas exige cuidado ao atravessar a fronteira para um terceiro: nesse caso, converta para duração na saída e volte a instante na entrada.',
        },
      ],
    },
    {
      title: 'Retry multiplica carga exatamente quando ela é escassa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Retry é uma aposta razoável quando a falha é independente e rara: um pacote perdido, um nó que reiniciou, um deploy trocando instâncias. Nesses casos a segunda tentativa acha um sistema saudável e o custo extra é irrelevante. A aposta deixa de valer quando a falha é correlacionada, e a degradação de um recurso compartilhado é o caso correlacionado por excelência. Se o banco está lento para todo mundo, todas as requisições estouram o timeout ao mesmo tempo e todas retentam ao mesmo tempo. A carga chega em bloco, num instante em que a capacidade disponível é justamente a menor do dia.',
        },
        {
          type: 'paragraph',
          value:
            'O multiplicador é maior do que aparenta porque ele se aplica em cada nível da cadeia. Três camadas com duas tentativas cada não geram duas chamadas ao banco, geram oito no pior caso, porque o retry da camada de cima reexecuta toda a subárvore de chamadas abaixo dela. É o que se chama de amplificação de retry, e é a razão pela qual uma política de tentativa aparentemente inofensiva por serviço vira uma bomba quando composta. A regra prática que evita o pior é permitir retry em apenas uma camada da cadeia, normalmente a mais próxima da borda, e desligá-lo nas demais.',
        },
        {
          type: 'list',
          items: [
            'Jitter não é opcional: backoff exponencial sem aleatoriedade só reagrupa as tentativas em ondas cada vez mais espaçadas, mas ainda sincronizadas, porque todos os clientes começaram a contar no mesmo instante.',
            'Retry só faz sentido para erro que possa ter sido transitório: timeout, indisponibilidade, conflito de escrita. Um 400 ou um 422 vai falhar de novo, e retentá-lo é gastar capacidade para receber a mesma resposta.',
            'Retry de operação que muda estado exige chave de idempotência, senão a tentativa que resolveu o timeout do cliente cobra duas vezes o cliente de verdade.',
            'Um contador local por chamada não limita nada em cadeia, porque cada camada tem o seu. O que limita é um orçamento de tentativas que viaja junto do prazo e é decrementado a cada retry.',
            'Retry precisa parar quando o prazo acabou: tentar de novo com trezentos milissegundos restantes é gastar capacidade para produzir um resultado que ninguém vai conseguir ler.',
          ],
        },
        {
          type: 'code',
          value: `// http/retry-budget.js
// Retry com orcamento compartilhado, nao contador por chamada.
//
// Duas travas independentes:
//   1) prazo: nao inicia tentativa que nao cabe no tempo restante
//   2) orcamento por janela: sob falha correlacionada, o retry se
//      desliga sozinho antes de virar amplificador de carga

const RETRYABLE = new Set([408, 429, 502, 503, 504]);

// Teto proporcional ao trafego, nao numero fixo: em 1000 req/s com
// ratio 0.1, cabem 100 retries/s. Se a falha for correlacionada, o
// orcamento esvazia em segundos e as chamadas passam a falhar rapido.
export const createRetryBudget = ({ ratio = 0.1, windowMs = 10_000 } = {}) => {
  let attempts = 0;
  let retries = 0;
  let windowStart = Date.now();

  const roll = () => {
    if (Date.now() - windowStart < windowMs) return;
    windowStart = Date.now();
    attempts = 0;
    retries = 0;
  };

  return {
    recordAttempt: () => {
      roll();
      attempts += 1;
    },
    tryConsume: () => {
      roll();
      if (retries + 1 > attempts * ratio) return false;
      retries += 1;
      return true;
    },
    // Exponha isto como metrica: a queda para zero e o sinal de que
    // o sistema esta sob falha correlacionada, nao ruido isolado.
    available: () => {
      roll();
      return Math.max(0, Math.floor(attempts * ratio) - retries);
    },
  };
};

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export const withRetry = async (fn, { deadline, budget, signal, baseMs = 100 }) => {
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    budget.recordAttempt();
    try {
      return await fn({ attempt });
    } catch (error) {
      lastError = error;

      const retryable = error.code === 'DEADLINE_EXCEEDED' || RETRYABLE.has(error.status);
      if (!retryable) throw error;

      // Jitter completo: sem ele, todos os clientes que falharam no
      // mesmo instante voltam juntos na mesma onda.
      const backoff = Math.random() * baseMs * 2 ** attempt;
      if (deadline - Date.now() <= backoff) throw error;
      if (!budget.tryConsume()) throw error;

      await sleep(backoff, signal);
    }
  }

  throw lastError;
};`,
        },
      ],
    },
    {
      title: 'Cancelamento precisa atravessar a cadeia inteira',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Propagar o prazo resolve metade do problema: cada camada sabe quando parar de esperar. A outra metade é fazer o trabalho já iniciado morrer quando a espera acaba, e isso exige um sinal que desça junto da chamada. No ecossistema JavaScript esse sinal é o AbortSignal, encadeado do handler HTTP até a última chamada de rede. Em outras plataformas o nome muda mas o desenho é o mesmo: um contexto cancelável que acompanha a requisição e é verificado nos pontos de bloqueio.',
        },
        {
          type: 'paragraph',
          value:
            'O ponto que costuma ficar de fora é o banco de dados, e é justamente ele que segura o recurso mais escasso. Abortar a chamada no cliente HTTP não interrompe uma consulta que já está executando no servidor de banco: a conexão fica ocupada até a consulta terminar sozinha. Por isso a configuração precisa existir também do lado do banco, como tempo máximo de execução de comando, e não apenas como timeout do driver. Sem isso, uma consulta lenta continua consumindo a conexão do pool mesmo depois de todo o resto da cadeia ter desistido, e o pool esgotado transforma a lentidão de uma rota em indisponibilidade de todas as outras.',
        },
        {
          type: 'code',
          value: `// db/query.js
// Cancelamento que chega ate o banco, nao so ate o driver.
//
// Sem statement_timeout, abortar do lado do cliente apenas devolve
// a conexao ao pool depois que a consulta terminar por conta propria.
// A consulta continua rodando no servidor e o recurso continua preso.

export const queryWithDeadline = async (pool, { sql, params, deadline, signal }) => {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    const error = new Error('deadline_exceeded_before_query');
    error.code = 'DEADLINE_EXCEEDED';
    throw error;
  }

  const client = await pool.connect();
  // Nunca deixe a conexao vazar quando o abort chega no meio do caminho.
  const release = () => client.release();
  signal?.addEventListener('abort', release, { once: true });

  try {
    // statement_timeout e por sessao: aplicado na conexao emprestada,
    // vale para as consultas seguintes ate a conexao voltar ao pool.
    await client.query('SET LOCAL statement_timeout = $1', [Math.floor(remaining)]);
    return await client.query({ text: sql, values: params });
  } catch (error) {
    // 57014 = query_canceled no PostgreSQL. Traduzir aqui evita que a
    // camada de cima trate expiracao de prazo como erro de banco e
    // dispare um retry que so vai expirar de novo.
    if (error.code === '57014') {
      const timeout = new Error('query_timeout');
      timeout.code = 'DEADLINE_EXCEEDED';
      throw timeout;
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', release);
    release();
  }
};`,
        },
        {
          type: 'paragraph',
          value:
            'Há um caso em que o cancelamento é a decisão errada, e vale reconhecê-lo: quando o trabalho já produziu efeito colateral parcial. Abortar no meio de uma sequência de escritas deixa o sistema num estado que ninguém desenhou. A saída aqui não é desistir do cancelamento, é mover a fronteira: a parte que muda estado vira uma unidade que ou completa ou não começa, e o cancelamento passa a acontecer antes dela ou depois dela, nunca no meio. Na prática, isso significa verificar o prazo restante logo antes de entrar na transação e tratar a transação como não interrompível uma vez iniciada.',
        },
      ],
    },
    {
      title: 'Rejeitar cedo vale mais que enfileirar mais',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando a chegada supera a capacidade, alguma requisição vai falhar. A única escolha real é onde e quando. Enfileirar sem limite transfere a falha para o futuro na forma de latência crescente, e é a pior das opções porque produz o trabalho órfão em escala: quando a requisição finalmente sai da fila, o cliente já desistiu há muito tempo. Uma fila com teto pequeno e rejeição imediata do excedente falha mais cedo e falha melhor, porque a rejeição é barata, é imediatamente visível para o chamador e não consome capacidade.',
        },
        {
          type: 'paragraph',
          value:
            'A checagem mais barata de todas custa uma comparação e evita todo o resto: antes de tirar um item da fila, verifique se o prazo dele ainda não expirou. Se expirou, descarte sem processar. Em uma fila saturada isso limpa sozinha a parte da carga que já não tem destinatário, e a capacidade volta a ser gasta em trabalho útil. É a diferença entre uma fila que se recupera quando a pressão diminui e uma que continua saturada por minutos depois, processando pedidos que ninguém está esperando.',
        },
        {
          type: 'table',
          columns: ['Estratégia sob saturação', 'O que acontece', 'Quando usar'],
          rows: [
            [
              'Fila ilimitada',
              'Latência cresce sem teto, memória cresce junto, tudo vira trabalho órfão',
              'Nunca em caminho síncrono de requisição',
            ],
            [
              'Fila com teto e rejeição',
              'Excedente falha em milissegundos e libera capacidade para o resto',
              'Padrão para qualquer serviço síncrono',
            ],
            [
              'Descarte por prazo expirado',
              'Trabalho sem destinatário sai da fila sem consumir capacidade',
              'Sempre que houver prazo propagado',
            ],
            [
              'Disjuntor por dependência',
              'Para de tentar a dependência degradada e devolve erro imediato',
              'Falha correlacionada persistente, não pico curto',
            ],
            [
              'Degradação funcional',
              'Devolve resposta parcial ou de cache em vez de erro',
              'Quando existe resposta aceitável sem a dependência',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O disjuntor merece uma ressalva porque costuma ser adotado como primeira medida quando deveria ser a última. Ele resolve falha correlacionada persistente, cortando tentativas contra uma dependência que já se sabe indisponível, mas é ruim para pico curto: o limiar dispara, o serviço passa a recusar tudo por alguns segundos e, ao voltar, manda a onda represada de uma vez. Prazo propagado, cancelamento efetivo e orçamento de retry resolvem a maior parte dos casos com menos efeito colateral. O disjuntor entra quando a dependência fica fora por minutos e continuar tentando é apenas queimar capacidade.',
        },
      ],
    },
    {
      title: 'Provando que a cascata não acontece mais',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cascata é um comportamento emergente: cada componente parece correto isoladamente e o problema só aparece na composição sob pressão. Por isso teste unitário não pega, e por isso a validação precisa reproduzir a condição real, que é uma dependência lenta e não uma dependência quebrada. Injetar erro é fácil e não prova nada aqui, porque o erro rápido não gera trabalho órfão. O que prova é injetar latência.',
        },
        {
          type: 'ordered',
          items: [
            'Injete latência na dependência mais profunda, algo entre três e cinco vezes o timeout configurado, mantendo o tráfego de entrada constante. A hipótese sob teste é que a carga na dependência permaneça igual à carga de entrada.',
            'Meça as chamadas efetivas que chegam na dependência durante a injeção. Se o número subir acima da entrada, existe amplificação de retry em algum ponto da cadeia e a primeira coisa a procurar é retry ligado em mais de uma camada.',
            'Meça o trabalho órfão diretamente: conte quantas respostas o servidor produziu para requisições cujo cliente já havia desistido. Um contador nesse ponto é a métrica mais honesta de propagação de cancelamento, porque só chega a zero quando o cancelamento realmente atravessa.',
            'Verifique o tempo de recuperação, que é o que separa quarenta segundos de vinte minutos. Remova a injeção e cronometre até a latência voltar ao normal. Se demorar muito mais do que a duração da injeção, sobrou trabalho acumulado que ninguém descartou.',
            'Confirme o pior caso ponta a ponta com um teste que soma prazos ao longo da cadeia e falha se o total ultrapassar o orçamento da borda. Esse teste é barato, roda no pipeline e pega a regressão no dia em que alguém aumentar um timeout local por conta própria.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Vale um alerta específico para a métrica que engana. A latência média cai durante uma cascata, porque as requisições que falham rápido por prazo expirado entram na conta como respostas curtas. Um painel de latência média fica verde no meio do incidente. O que enxerga a cascata é a razão entre chamadas de saída e requisições de entrada por dependência, que deve ficar próxima de um e cuja subida indica amplificação. O alerta certo é sobre essa razão, não sobre latência.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Basta desligar o retry para resolver o problema?',
      answer:
        'Desligar resolve a amplificação e cria outro custo, então é uma troca e não uma correção. Sem retry, toda falha transitória vira erro visível para o usuário: um pacote perdido, uma instância reiniciando durante o deploy, uma reeleição de líder no banco. Essas falhas são frequentes o bastante para que a taxa de erro percebida suba de forma perceptível, e é por isso que o retry existe. A correção não é remover o mecanismo, é limitá-lo em três dimensões ao mesmo tempo. Primeiro, permitir retry em apenas uma camada da cadeia, normalmente a mais próxima da borda, porque é o retry composto que multiplica. Segundo, condicionar a tentativa ao prazo restante, para não iniciar uma chamada que já nasce sem tempo de terminar. Terceiro, submeter a tentativa a um orçamento proporcional ao tráfego, que se esgota rápido quando a falha é correlacionada e permanece disponível quando ela é isolada. Com as três travas, o retry continua cobrindo a falha rara e para de participar da cascata, que é exatamente a distinção que o contador local por chamada não consegue fazer.',
    },
    {
      question: 'Como escolher o timeout de cada camada sem chutar?',
      answer:
        'Escolhendo apenas um número e derivando o resto. O único valor que tem significado externo é o orçamento da borda, e ele vem do que o usuário e o cliente chamador toleram, tipicamente entre um e dez segundos dependendo da interação. Todos os demais são derivados de dentro desse orçamento, subtraindo o tempo que cada camada gasta em trabalho próprio e uma margem de rede, e nenhum deles pode ser maior do que o que recebeu de cima. Os valores locais servem só como teto de segurança para o caso de a requisição chegar sem prazo declarado, e nesse papel devem ser calibrados a partir do p99 observado por rota com uma folga, nunca de um número redondo escolhido por hábito. Um limiar acima do p99 real nunca dispara e não protege nada, e um limiar abaixo do p95 transforma tráfego saudável em erro. Vale ainda separar o timeout de conexão do timeout total: falha em estabelecer conexão aparece em centenas de milissegundos e não deve consumir o orçamento inteiro esperando por algo que já se sabe indisponível.',
    },
    {
      question: 'Prazo propagado funciona quando a chamada passa por uma fila?',
      answer:
        'Funciona, e é justamente onde ele evita mais desperdício, mas exige duas mudanças em relação à chamada síncrona. A primeira é que o prazo precisa ser gravado no próprio envelope da mensagem, não no cabeçalho da requisição que a produziu, porque o consumidor pode processá-la minutos depois e não tem outra forma de saber quanto tempo restava. A segunda é que o consumidor precisa verificar esse prazo antes de começar o trabalho, e descartar a mensagem expirada em vez de processá-la, contabilizando o descarte numa métrica própria para que ele fique visível. Há uma diferença importante entre fila síncrona e assíncrona: quando existe alguém esperando do outro lado, o descarte por prazo é correto e barato. Quando a fila é de trabalho em segundo plano e ninguém está esperando, o prazo não deve ser o do chamador original e sim um limite de validade do negócio, definido pela operação em si, porque descartar uma cobrança pendente porque ela ficou dez segundos na fila seria trocar um problema de latência por perda de trabalho.',
    },
  ],
  conclusion: {
    title: 'A recuperação começa quando o sistema para de se atacar',
    description:
      'A cascata não é um bug em um componente específico, é uma propriedade que emerge quando timeout, retry e fila são configurados isoladamente e se compõem sob pressão. O sistema fica indisponível por muito mais tempo do que a falha original durou, e a causa é o próprio mecanismo que existia para tolerar falha. Posso revisar a cadeia de chamadas do seu sistema e definir o orçamento de prazo que entra pela borda e desce até o banco, a propagação de cancelamento que mata o trabalho órfão, a política de retry limitada por orçamento em vez de contador local, a estratégia de rejeição sob saturação e os testes de latência injetada que provam que a cascata não volta.',
    cta: 'Falar sobre a cadeia de timeouts do meu sistema',
  },
  related: [
    {
      label: 'Timeout e cancelamento em cadeia de chamadas LLM',
      to: '/blog/timeout-cancelamento-cadeia-chamadas-llm',
    },
    {
      label: 'Backpressure em pipeline de IA: quando o consumidor não acompanha',
      to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha',
    },
    {
      label: 'Observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'The database was slow for forty seconds. The incident lasted twenty-two minutes. Between those two facts sits a mechanism almost every distributed system carries without noticing: the client gives up before the server finishes, tries again, and the new attempt lands on top of the old work that nobody cancelled. This article shows why the client timeout and the real duration of the work on the server are independent quantities, why chained timeouts produce a wait nobody configured, how retries multiply load at exactly the worst moment and why backoff alone does not fix it, which signal has to cross the chain so abandoned work dies with it, why the attempt policy needs a global budget instead of a local counter, and which tests reproduce the cascade before it happens in production.',
  sections: [
    {
      title: 'The client timeout does not interrupt the work on the server',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first thing to understand is that a timeout is a decision made by the side that waits, not by the side that works. When the client hits three seconds and closes the wait, what actually happens is that it stops reading the response. The query keeps running in the database, the transaction keeps holding the lock, the pool keeps the connection busy, the handler keeps allocating memory. From the server point of view nothing changed: it is still processing a request that no longer has a recipient. That orphaned work is the raw material of the cascade, because it consumes resources and produces neither success nor a visible error.',
        },
        {
          type: 'paragraph',
          value:
            'The practical consequence shows up in the arithmetic. Suppose an endpoint that normally answers in two hundred milliseconds, with a client timeout of three seconds and one extra attempt. Under degradation the response starts taking eight seconds. The client gives up at three, tries again, and the second attempt also gives up at three. After six seconds the client reports failure and the server has two live executions of the same request, both destined to be discarded. If the incoming volume is a thousand requests per second, the server is not processing a thousand, it is processing somewhere between two and three thousand, precisely while it tries to recover from whatever caused the initial slowdown.',
        },
        {
          type: 'diagram',
          value: `WITHOUT CANCELLATION PROPAGATION

client   |--waits 3s--|X (gives up, tries again)
                      |--waits 3s--|X (gives up, reports error)

server   |=========work 1 (8s, orphaned after 3s)=========|
                      |=========work 2 (8s, orphaned)=========|

                      ^ from here on the server
                        processes 2x the real load
                        and neither result has
                        anyone left to receive it

WITH CANCELLATION PROPAGATION

client   |--waits 3s--|X
server   |===work 1===|X  <- aborted along with it, frees connection and lock`,
        },
        {
          type: 'paragraph',
          value:
            'It is worth naming the effect precisely, because it is often confused with ordinary overload. Overload is when more traffic arrives than there is capacity. Here the external load did not change: what grew was the internal load generated by the fault tolerance mechanism itself. The system is attacking itself with the behaviour that existed to protect it, and that is why an initial forty second slowdown becomes a twenty minute incident: even after the database recovers, the accumulated work queue and the attempts in flight keep the saturation going on their own.',
        },
      ],
    },
    {
      title: 'Chained timeouts add up, and nobody configured the sum',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In an architecture with more than two layers, each service usually has its own timeout configured in isolation, chosen by whoever wrote that HTTP client that week. The problem is that these values compose multiplicatively when retries exist, not additively as intuition suggests. A chain of three services, each with a five second timeout and two attempts, produces a worst case of thirty seconds for a request the browser stops waiting for at ten. Nobody wrote thirty anywhere: the number emerged from the composition.',
        },
        {
          type: 'table',
          columns: ['Layer', 'Local timeout', 'Attempts', 'Accumulated worst case'],
          rows: [
            [
              'Browser or app',
              '10s',
              '1',
              '10s (the only budget the user perceives)',
            ],
            [
              'Edge API',
              '5s per call',
              '2',
              '10s, already at the limit the client accepts',
            ],
            [
              'Domain service',
              '5s per call',
              '2',
              '20s, nobody outside is still waiting',
            ],
            [
              'Database or external service',
              '5s per query',
              '2',
              '30s of work that never had a recipient',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fix is not picking smaller numbers by trial and error, it is inverting the direction in which the value is decided. The timeout stops being local configuration in each client and becomes a budget that enters at the edge and is distributed inward: the edge receives ten seconds, spends what it needs on validation and routing and passes the remainder down as an explicit deadline for the next layer, which does the same. Each service is told how much time it still has, instead of deciding on its own how much time it wants. The rule that closes the design is easy to verify: no layer may promise downward a deadline larger than the one it received from above.',
        },
        {
          type: 'code',
          value: `// http/deadline.js
// Time budget that crosses the chain as an absolute deadline.
//
// Absolute deadline, not relative duration: if each layer passed down
// "you have 5s", the time already spent in the previous layer would be
// forgotten and the total would grow at every hop. An expiry instant
// can only shrink as it goes down.

const DEADLINE_HEADER = 'x-deadline-ms';
// Margin for the response to travel back over the network before the
// caller gives up. Without it, the service finishes at the exact instant
// the client stops listening, and the work is wasted on the last millisecond.
const NETWORK_MARGIN_MS = 150;

export const deadlineFromRequest = (req, fallbackMs) => {
  const header = Number(req.headers[DEADLINE_HEADER]);
  // Never accept a deadline larger than the local fallback: a client
  // asking for 60s cannot extend the service budget.
  if (Number.isFinite(header) && header > 0) {
    return Math.min(header, Date.now() + fallbackMs);
  }
  return Date.now() + fallbackMs;
};

export const remainingMs = (deadline) => deadline - Date.now();

// Deadline passed to the next call: what is left, minus the margin.
// Returns null when there is no useful time, and the caller should fail
// fast instead of starting work that would be born orphaned.
export const childDeadline = (deadline, reserveMs = NETWORK_MARGIN_MS) => {
  const remaining = remainingMs(deadline) - reserveMs;
  return remaining > 0 ? Date.now() + remaining : null;
};

export const callDownstream = async (url, { deadline, signal, body }) => {
  const child = childDeadline(deadline);
  if (child === null) {
    const error = new Error('deadline_exceeded_before_call');
    error.code = 'DEADLINE_EXCEEDED';
    throw error;
  }

  // AbortSignal.any joins the cancellation coming from above with the local
  // timeout: either one aborts the call, and the work actually stops.
  const localTimeout = AbortSignal.timeout(remainingMs(child));
  const combined = AbortSignal.any([signal, localTimeout].filter(Boolean));

  return fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      [DEADLINE_HEADER]: String(child),
    },
    signal: combined,
  });
};`,
        },
        {
          type: 'paragraph',
          value:
            'One implementation detail decides whether this works at all: the deadline has to travel as an expiry instant, not as a duration. If each layer passes down the string five seconds, the time already spent by the previous layer disappears from the accounting and the budget is renewed at every hop, which is exactly the bug you were trying to avoid. By passing an instant, the value can only shrink. The cost of that choice is depending on reasonably synchronised clocks between services, which is acceptable inside a single environment with NTP but requires care when crossing the boundary to a third party: there, convert to a duration on the way out and back to an instant on the way in.',
        },
      ],
    },
    {
      title: 'Retries multiply load exactly when it is scarce',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A retry is a reasonable bet when the failure is independent and rare: a dropped packet, a node that restarted, a deploy swapping instances. In those cases the second attempt finds a healthy system and the extra cost is irrelevant. The bet stops paying off when the failure is correlated, and degradation of a shared resource is the correlated case par excellence. If the database is slow for everyone, every request hits the timeout at the same time and every request retries at the same time. The load arrives in a block, at the exact moment when available capacity is the lowest of the day.',
        },
        {
          type: 'paragraph',
          value:
            'The multiplier is larger than it looks because it applies at every level of the chain. Three layers with two attempts each do not produce two calls to the database, they produce eight in the worst case, because the retry from the upper layer re-executes the whole subtree of calls below it. This is called retry amplification, and it is why an apparently harmless per-service attempt policy turns into a bomb when composed. The practical rule that avoids the worst is allowing retries in only one layer of the chain, usually the one closest to the edge, and turning them off everywhere else.',
        },
        {
          type: 'list',
          items: [
            'Jitter is not optional: exponential backoff without randomness only regroups the attempts into waves that are further apart but still synchronised, because every client started counting at the same instant.',
            'Retries only make sense for errors that might have been transient: timeout, unavailability, write conflict. A 400 or a 422 will fail again, and retrying it spends capacity to receive the same answer.',
            'Retrying a state-changing operation requires an idempotency key, otherwise the attempt that solved the client timeout charges the real customer twice.',
            'A local per-call counter limits nothing in a chain, because every layer has its own. What limits is a retry budget that travels along with the deadline and is decremented on every retry.',
            'Retries have to stop when the deadline is gone: trying again with three hundred milliseconds left is spending capacity to produce a result nobody will be able to read.',
          ],
        },
        {
          type: 'code',
          value: `// http/retry-budget.js
// Retry with a shared budget, not a per-call counter.
//
// Two independent locks:
//   1) deadline: never start an attempt that does not fit in the time left
//   2) budget per window: under correlated failure, retries switch
//      themselves off before becoming a load amplifier

const RETRYABLE = new Set([408, 429, 502, 503, 504]);

// Cap proportional to traffic, not a fixed number: at 1000 req/s with
// ratio 0.1 there is room for 100 retries/s. If the failure is correlated,
// the budget drains in seconds and calls start failing fast.
export const createRetryBudget = ({ ratio = 0.1, windowMs = 10_000 } = {}) => {
  let attempts = 0;
  let retries = 0;
  let windowStart = Date.now();

  const roll = () => {
    if (Date.now() - windowStart < windowMs) return;
    windowStart = Date.now();
    attempts = 0;
    retries = 0;
  };

  return {
    recordAttempt: () => {
      roll();
      attempts += 1;
    },
    tryConsume: () => {
      roll();
      if (retries + 1 > attempts * ratio) return false;
      retries += 1;
      return true;
    },
    // Expose this as a metric: dropping to zero is the signal that the
    // system is under correlated failure, not isolated noise.
    available: () => {
      roll();
      return Math.max(0, Math.floor(attempts * ratio) - retries);
    },
  };
};

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export const withRetry = async (fn, { deadline, budget, signal, baseMs = 100 }) => {
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    budget.recordAttempt();
    try {
      return await fn({ attempt });
    } catch (error) {
      lastError = error;

      const retryable = error.code === 'DEADLINE_EXCEEDED' || RETRYABLE.has(error.status);
      if (!retryable) throw error;

      // Full jitter: without it, every client that failed at the same
      // instant comes back together in the same wave.
      const backoff = Math.random() * baseMs * 2 ** attempt;
      if (deadline - Date.now() <= backoff) throw error;
      if (!budget.tryConsume()) throw error;

      await sleep(backoff, signal);
    }
  }

  throw lastError;
};`,
        },
      ],
    },
    {
      title: 'Cancellation has to cross the whole chain',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Propagating the deadline solves half the problem: every layer knows when to stop waiting. The other half is making work that already started die when the wait ends, and that requires a signal travelling down with the call. In the JavaScript ecosystem that signal is the AbortSignal, chained from the HTTP handler to the last network call. On other platforms the name changes but the design is the same: a cancellable context that follows the request and is checked at the blocking points.',
        },
        {
          type: 'paragraph',
          value:
            'The part usually left out is the database, and it is precisely the one holding the scarcest resource. Aborting the call in the HTTP client does not interrupt a query already executing on the database server: the connection stays busy until the query finishes on its own. That is why the setting has to exist on the database side as well, as a maximum statement execution time, and not only as a driver timeout. Without it, a slow query keeps consuming a pool connection long after the rest of the chain gave up, and an exhausted pool turns the slowness of one route into unavailability of all the others.',
        },
        {
          type: 'code',
          value: `// db/query.js
// Cancellation that reaches the database, not only the driver.
//
// Without statement_timeout, aborting on the client side only returns the
// connection to the pool after the query finishes by itself. The query keeps
// running on the server and the resource stays held.

export const queryWithDeadline = async (pool, { sql, params, deadline, signal }) => {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    const error = new Error('deadline_exceeded_before_query');
    error.code = 'DEADLINE_EXCEEDED';
    throw error;
  }

  const client = await pool.connect();
  // Never let the connection leak when the abort arrives halfway through.
  const release = () => client.release();
  signal?.addEventListener('abort', release, { once: true });

  try {
    // statement_timeout is per session: applied on the borrowed connection,
    // it holds for the following queries until the connection goes back.
    await client.query('SET LOCAL statement_timeout = $1', [Math.floor(remaining)]);
    return await client.query({ text: sql, values: params });
  } catch (error) {
    // 57014 = query_canceled in PostgreSQL. Translating it here prevents the
    // upper layer from treating a deadline expiry as a database error and
    // firing a retry that will only expire again.
    if (error.code === '57014') {
      const timeout = new Error('query_timeout');
      timeout.code = 'DEADLINE_EXCEEDED';
      throw timeout;
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', release);
    release();
  }
};`,
        },
        {
          type: 'paragraph',
          value:
            'There is one case where cancellation is the wrong decision, and it is worth recognising: when the work has already produced a partial side effect. Aborting in the middle of a sequence of writes leaves the system in a state nobody designed. The answer here is not to give up on cancellation, it is to move the boundary: the state-changing part becomes a unit that either completes or never starts, and cancellation happens before it or after it, never in the middle. In practice, that means checking the remaining deadline right before entering the transaction and treating the transaction as non-interruptible once started.',
        },
      ],
    },
    {
      title: 'Rejecting early beats queueing more',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When arrival exceeds capacity, some request is going to fail. The only real choice is where and when. Queueing without a limit moves the failure into the future as growing latency, and it is the worst option because it produces orphaned work at scale: by the time the request finally leaves the queue, the client gave up long ago. A queue with a small cap and immediate rejection of the excess fails earlier and fails better, because rejection is cheap, is immediately visible to the caller and consumes no capacity.',
        },
        {
          type: 'paragraph',
          value:
            'The cheapest check of all costs one comparison and avoids everything else: before pulling an item from the queue, verify that its deadline has not already expired. If it has, discard it without processing. In a saturated queue this cleans up on its own the part of the load that no longer has a recipient, and capacity goes back to being spent on useful work. It is the difference between a queue that recovers when pressure drops and one that stays saturated for minutes afterwards, processing requests nobody is waiting for.',
        },
        {
          type: 'table',
          columns: ['Strategy under saturation', 'What happens', 'When to use it'],
          rows: [
            [
              'Unbounded queue',
              'Latency grows without a cap, memory grows with it, everything becomes orphaned work',
              'Never on a synchronous request path',
            ],
            [
              'Bounded queue with rejection',
              'The excess fails in milliseconds and frees capacity for the rest',
              'Default for any synchronous service',
            ],
            [
              'Drop on expired deadline',
              'Work without a recipient leaves the queue without consuming capacity',
              'Whenever there is a propagated deadline',
            ],
            [
              'Circuit breaker per dependency',
              'Stops trying the degraded dependency and returns an immediate error',
              'Persistent correlated failure, not a short spike',
            ],
            [
              'Functional degradation',
              'Returns a partial or cached answer instead of an error',
              'When an acceptable answer exists without the dependency',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The circuit breaker deserves a caveat because it tends to be adopted as the first measure when it should be the last. It solves persistent correlated failure by cutting attempts against a dependency already known to be down, but it is bad for short spikes: the threshold trips, the service starts refusing everything for a few seconds and, when it comes back, sends the pent-up wave all at once. A propagated deadline, effective cancellation and a retry budget solve most cases with fewer side effects. The breaker comes in when the dependency is out for minutes and continuing to try is just burning capacity.',
        },
      ],
    },
    {
      title: 'Proving the cascade does not happen any more',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A cascade is emergent behaviour: every component looks correct in isolation and the problem only appears in the composition under pressure. That is why unit tests do not catch it, and why validation has to reproduce the real condition, which is a slow dependency and not a broken one. Injecting errors is easy and proves nothing here, because a fast error generates no orphaned work. What proves it is injecting latency.',
        },
        {
          type: 'ordered',
          items: [
            'Inject latency into the deepest dependency, something between three and five times the configured timeout, while keeping incoming traffic constant. The hypothesis under test is that the load on the dependency stays equal to the incoming load.',
            'Measure the effective calls reaching the dependency during the injection. If the number rises above the incoming rate, there is retry amplification somewhere in the chain and the first thing to look for is retries enabled in more than one layer.',
            'Measure orphaned work directly: count how many responses the server produced for requests whose client had already given up. A counter at that point is the most honest cancellation propagation metric, because it only reaches zero when cancellation really crosses.',
            'Check the recovery time, which is what separates forty seconds from twenty minutes. Remove the injection and time how long until latency is back to normal. If it takes much longer than the injection lasted, there is accumulated work nobody discarded.',
            'Confirm the end-to-end worst case with a test that adds up deadlines along the chain and fails if the total exceeds the edge budget. That test is cheap, runs in the pipeline and catches the regression on the day someone raises a local timeout on their own.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'One specific warning about the metric that misleads. Average latency drops during a cascade, because requests that fail fast on an expired deadline enter the accounting as short responses. An average latency dashboard stays green in the middle of the incident. What sees the cascade is the ratio between outgoing calls and incoming requests per dependency, which should sit close to one and whose rise indicates amplification. The right alert is on that ratio, not on latency.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is turning retries off enough to solve the problem?',
      answer:
        'Turning them off solves the amplification and creates another cost, so it is a trade and not a fix. Without retries, every transient failure becomes a visible error for the user: a dropped packet, an instance restarting during a deploy, a leader re-election in the database. Those failures are frequent enough that the perceived error rate rises noticeably, and that is why the retry exists in the first place. The fix is not removing the mechanism, it is bounding it in three dimensions at once. First, allowing retries in only one layer of the chain, usually the one closest to the edge, because it is the composed retry that multiplies. Second, conditioning the attempt on the remaining deadline, so you never start a call born without time to finish. Third, submitting the attempt to a budget proportional to traffic, which drains fast when the failure is correlated and stays available when it is isolated. With those three locks, retries keep covering rare failures and stop taking part in the cascade, which is exactly the distinction a local per-call counter cannot make.',
    },
    {
      question: 'How do you pick each layer timeout without guessing?',
      answer:
        'By picking one number and deriving the rest. The only value with external meaning is the edge budget, and it comes from what the user and the calling client tolerate, typically between one and ten seconds depending on the interaction. Every other value is derived from inside that budget, subtracting the time each layer spends on its own work plus a network margin, and none of them may be larger than what it received from above. Local values serve only as a safety cap for the case where the request arrives with no declared deadline, and in that role they should be calibrated from the observed p99 per route with some slack, never from a round number chosen out of habit. A threshold above the real p99 never fires and protects nothing, and a threshold below the p95 turns healthy traffic into errors. It is also worth separating the connection timeout from the total timeout: a failure to establish a connection shows up in hundreds of milliseconds and should not consume the whole budget waiting for something already known to be unavailable.',
    },
    {
      question: 'Does a propagated deadline work when the call goes through a queue?',
      answer:
        'It does, and that is where it prevents the most waste, but it requires two changes compared with a synchronous call. The first is that the deadline has to be written into the message envelope itself, not into the header of the request that produced it, because the consumer may process it minutes later and has no other way of knowing how much time was left. The second is that the consumer has to check that deadline before starting work, and discard the expired message instead of processing it, counting the discard in a dedicated metric so it stays visible. There is an important difference between a synchronous and an asynchronous queue: when someone is waiting on the other side, dropping on an expired deadline is correct and cheap. When the queue is background work and nobody is waiting, the deadline should not be the original caller one but a business validity limit defined by the operation itself, because discarding a pending charge just because it spent ten seconds in the queue would trade a latency problem for lost work.',
    },
  ],
  conclusion: {
    title: 'Recovery starts when the system stops attacking itself',
    description:
      'The cascade is not a bug in one specific component, it is a property that emerges when timeout, retry and queue are configured in isolation and compose under pressure. The system stays unavailable far longer than the original failure lasted, and the cause is the very mechanism that existed to tolerate failure. I can review your system call chain and define the deadline budget that enters at the edge and reaches the database, the cancellation propagation that kills orphaned work, the retry policy bounded by a budget instead of a local counter, the rejection strategy under saturation and the injected latency tests that prove the cascade does not come back.',
    cta: 'Talk about the timeout chain in my system',
  },
  related: [
    {
      label: 'Timeout and cancellation in LLM call chains',
      to: '/blog/timeout-cancelamento-cadeia-chamadas-llm',
    },
    {
      label: 'Backpressure in AI pipelines: when the consumer cannot keep up',
      to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha',
    },
    {
      label: 'Observability and reliability',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'La base de datos estuvo lenta durante cuarenta segundos. El incidente duró veintidós minutos. Entre una cosa y la otra existe un mecanismo que casi todo sistema distribuido carga sin darse cuenta: el cliente se rinde antes de que el servidor termine, lo intenta de nuevo, y el intento nuevo llega encima del trabajo viejo que nadie canceló. Este artículo muestra por qué el timeout del cliente y la duración real del trabajo en el servidor son magnitudes independientes, por qué la suma de los timeouts en cadena produce una espera que nadie configuró, cómo el retry multiplica carga justo en el peor momento y por qué el backoff solo no lo arregla, qué señal tiene que atravesar la cadena para que el trabajo abandonado muera con ella, por qué la política de reintento necesita un presupuesto global en vez de un contador local, y qué pruebas reproducen la cascada antes de que ocurra en producción.',
  sections: [
    {
      title: 'El timeout del cliente no interrumpe el trabajo del servidor',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Lo primero que hay que entender es que el timeout es una decisión del lado que espera, no del lado que trabaja. Cuando el cliente llega a los tres segundos y cierra la espera, lo que pasa en la práctica es que deja de leer la respuesta. La consulta sigue corriendo en la base, la transacción sigue sosteniendo el lock, el pool sigue con la conexión ocupada, el handler sigue reservando memoria. Desde el punto de vista del servidor no cambió nada: sigue procesando un pedido que ya no tiene destinatario. Ese trabajo huérfano es la materia prima de la cascada, porque consume recursos y no produce ni éxito ni error visible.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia práctica aparece en la aritmética. Supón un endpoint que normalmente responde en doscientos milisegundos, con timeout de cliente en tres segundos y un intento extra. Bajo degradación, la respuesta pasa a tardar ocho segundos. El cliente se rinde a los tres, lo intenta de nuevo, y el segundo intento también se rinde a los tres. Al cabo de seis segundos el cliente reporta falla y el servidor tiene dos ejecuciones vivas del mismo pedido, ambas destinadas al descarte. Si el volumen de entrada es de mil peticiones por segundo, el servidor no está procesando mil, está procesando algo entre dos y tres mil, precisamente mientras intenta recuperarse de lo que causó la lentitud inicial.',
        },
        {
          type: 'diagram',
          value: `SIN PROPAGACION DE CANCELACION

cliente   |--espera 3s--|X (se rinde, reintenta)
                        |--espera 3s--|X (se rinde, reporta error)

servidor  |=========trabajo 1 (8s, huerfano tras 3s)=========|
                        |=========trabajo 2 (8s, huerfano)=========|

                        ^ a partir de aqui el servidor
                          procesa 2x la carga real
                          y ninguno de los dos resultados
                          tiene quien lo reciba

CON PROPAGACION DE CANCELACION

cliente   |--espera 3s--|X
servidor  |==trabajo 1==|X  <- abortado junto, libera conexion y lock`,
        },
        {
          type: 'paragraph',
          value:
            'Vale nombrar el efecto con precisión, porque suele confundirse con sobrecarga común. Sobrecarga es cuando llega más tráfico que capacidad. Aquí la carga externa no cambió: lo que aumentó fue la carga interna generada por el propio mecanismo de tolerancia a fallas. El sistema se está atacando con el comportamiento que existía para protegerlo, y por eso la lentitud inicial de cuarenta segundos se vuelve un incidente de veinte minutos: incluso después de que la base se recupera, la cola de trabajo acumulada y los intentos en vuelo mantienen la saturación por su cuenta.',
        },
      ],
    },
    {
      title: 'Los timeouts en cadena suman, y la suma no la configuró nadie',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En una arquitectura con más de dos capas, cada servicio suele tener su propio timeout configurado de forma aislada, elegido por quien escribió ese cliente HTTP esa semana. El problema es que esos valores se componen de manera multiplicativa cuando hay retry, y no aditiva como sugiere la intuición. Una cadena de tres servicios, cada uno con timeout de cinco segundos y dos intentos, produce un peor caso de treinta segundos para una petición que el navegador deja de esperar a los diez. Nadie escribió treinta en ningún lado: el número emergió de la composición.',
        },
        {
          type: 'table',
          columns: ['Capa', 'Timeout local', 'Intentos', 'Peor caso acumulado'],
          rows: [
            [
              'Navegador o app',
              '10s',
              '1',
              '10s (es el único presupuesto que el usuario percibe)',
            ],
            [
              'API de borde',
              '5s por llamada',
              '2',
              '10s, ya en el límite de lo que el cliente acepta',
            ],
            [
              'Servicio de dominio',
              '5s por llamada',
              '2',
              '20s, nadie de afuera sigue esperando',
            ],
            [
              'Base o servicio externo',
              '5s por consulta',
              '2',
              '30s de trabajo que nunca tuvo destinatario',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La corrección no es elegir números más chicos por ensayo y error, es invertir el sentido en el que se decide el valor. El timeout deja de ser configuración local de cada cliente y pasa a ser un presupuesto que entra por el borde y se distribuye hacia adentro: el borde recibe diez segundos, gasta lo que necesita en validación y ruteo y pasa el resto como plazo explícito para la capa siguiente, que hace lo mismo. Cada servicio recibe cuánto tiempo le queda, en vez de decidir solo cuánto tiempo quiere. La regla que cierra el diseño es fácil de verificar: ninguna capa puede prometer hacia abajo un plazo mayor que el que recibió de arriba.',
        },
        {
          type: 'code',
          value: `// http/deadline.js
// Presupuesto de tiempo que atraviesa la cadena como plazo absoluto.
//
// Plazo absoluto, no duracion relativa: si cada capa pasara hacia abajo
// "tienes 5s", el tiempo ya gastado en la capa anterior quedaria olvidado
// y el total creceria en cada salto. Un instante de expiracion solo puede
// disminuir a medida que baja.

const DEADLINE_HEADER = 'x-deadline-ms';
// Margen para que la respuesta vuelva por la red antes de que el llamador
// se rinda. Sin el, el servicio termina justo en el instante en que el
// cliente deja de escuchar, y el trabajo se desperdicia en el ultimo ms.
const NETWORK_MARGIN_MS = 150;

export const deadlineFromRequest = (req, fallbackMs) => {
  const header = Number(req.headers[DEADLINE_HEADER]);
  // Nunca aceptes un plazo mayor que el fallback local: un cliente que
  // pide 60s no puede alargar el presupuesto del servicio.
  if (Number.isFinite(header) && header > 0) {
    return Math.min(header, Date.now() + fallbackMs);
  }
  return Date.now() + fallbackMs;
};

export const remainingMs = (deadline) => deadline - Date.now();

// Plazo pasado a la llamada siguiente: lo que sobra, menos el margen.
// Devuelve null cuando ya no hay tiempo util, y el llamador debe fallar
// rapido en vez de iniciar un trabajo que nacera huerfano.
export const childDeadline = (deadline, reserveMs = NETWORK_MARGIN_MS) => {
  const remaining = remainingMs(deadline) - reserveMs;
  return remaining > 0 ? Date.now() + remaining : null;
};

export const callDownstream = async (url, { deadline, signal, body }) => {
  const child = childDeadline(deadline);
  if (child === null) {
    const error = new Error('deadline_exceeded_before_call');
    error.code = 'DEADLINE_EXCEEDED';
    throw error;
  }

  // AbortSignal.any une la cancelacion que viene de arriba con el timeout
  // local: cualquiera de los dos aborta la llamada, y el trabajo para de verdad.
  const localTimeout = AbortSignal.timeout(remainingMs(child));
  const combined = AbortSignal.any([signal, localTimeout].filter(Boolean));

  return fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      [DEADLINE_HEADER]: String(child),
    },
    signal: combined,
  });
};`,
        },
        {
          type: 'paragraph',
          value:
            'Un detalle de implementación decide si esto funciona o no: el plazo tiene que viajar como instante de expiración, no como duración. Si cada capa pasa hacia abajo la cadena cinco segundos, el tiempo ya gastado por la capa anterior desaparece de la cuenta y el presupuesto se renueva en cada salto, que es exactamente el bug que se quería evitar. Pasando un instante, el valor solo puede encoger. El costo de esa elección es depender de relojes razonablemente sincronizados entre los servicios, algo aceptable dentro de un mismo entorno con NTP, pero que exige cuidado al cruzar la frontera hacia un tercero: en ese caso, convierte a duración en la salida y vuelve a instante en la entrada.',
        },
      ],
    },
    {
      title: 'El retry multiplica carga justo cuando es escasa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El retry es una apuesta razonable cuando la falla es independiente y rara: un paquete perdido, un nodo que reinició, un deploy cambiando instancias. En esos casos el segundo intento encuentra un sistema sano y el costo extra es irrelevante. La apuesta deja de valer cuando la falla es correlacionada, y la degradación de un recurso compartido es el caso correlacionado por excelencia. Si la base está lenta para todos, todas las peticiones agotan el timeout al mismo tiempo y todas reintentan al mismo tiempo. La carga llega en bloque, en un instante en el que la capacidad disponible es justamente la más baja del día.',
        },
        {
          type: 'paragraph',
          value:
            'El multiplicador es mayor de lo que parece porque se aplica en cada nivel de la cadena. Tres capas con dos intentos cada una no generan dos llamadas a la base, generan ocho en el peor caso, porque el retry de la capa de arriba reejecuta todo el subárbol de llamadas por debajo. Es lo que se llama amplificación de retry, y es la razón por la que una política de reintento aparentemente inofensiva por servicio se vuelve una bomba al componerse. La regla práctica que evita lo peor es permitir retry en una sola capa de la cadena, normalmente la más cercana al borde, y apagarlo en las demás.',
        },
        {
          type: 'list',
          items: [
            'El jitter no es opcional: el backoff exponencial sin aleatoriedad solo reagrupa los intentos en olas cada vez más espaciadas, pero todavía sincronizadas, porque todos los clientes empezaron a contar en el mismo instante.',
            'El retry solo tiene sentido para un error que pudo ser transitorio: timeout, indisponibilidad, conflicto de escritura. Un 400 o un 422 va a fallar de nuevo, y reintentarlo es gastar capacidad para recibir la misma respuesta.',
            'Reintentar una operación que cambia estado exige clave de idempotencia, si no el intento que resolvió el timeout del cliente le cobra dos veces al cliente de verdad.',
            'Un contador local por llamada no limita nada en cadena, porque cada capa tiene el suyo. Lo que limita es un presupuesto de intentos que viaja junto al plazo y se decrementa en cada retry.',
            'El retry tiene que parar cuando el plazo se acabó: intentar de nuevo con trescientos milisegundos restantes es gastar capacidad para producir un resultado que nadie va a poder leer.',
          ],
        },
        {
          type: 'code',
          value: `// http/retry-budget.js
// Retry con presupuesto compartido, no contador por llamada.
//
// Dos trabas independientes:
//   1) plazo: no inicia un intento que no cabe en el tiempo restante
//   2) presupuesto por ventana: bajo falla correlacionada, el retry se
//      apaga solo antes de volverse amplificador de carga

const RETRYABLE = new Set([408, 429, 502, 503, 504]);

// Techo proporcional al trafico, no numero fijo: en 1000 req/s con ratio
// 0.1 caben 100 retries/s. Si la falla es correlacionada, el presupuesto
// se vacia en segundos y las llamadas pasan a fallar rapido.
export const createRetryBudget = ({ ratio = 0.1, windowMs = 10_000 } = {}) => {
  let attempts = 0;
  let retries = 0;
  let windowStart = Date.now();

  const roll = () => {
    if (Date.now() - windowStart < windowMs) return;
    windowStart = Date.now();
    attempts = 0;
    retries = 0;
  };

  return {
    recordAttempt: () => {
      roll();
      attempts += 1;
    },
    tryConsume: () => {
      roll();
      if (retries + 1 > attempts * ratio) return false;
      retries += 1;
      return true;
    },
    // Expon esto como metrica: la caida a cero es la senal de que el
    // sistema esta bajo falla correlacionada, no ruido aislado.
    available: () => {
      roll();
      return Math.max(0, Math.floor(attempts * ratio) - retries);
    },
  };
};

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

export const withRetry = async (fn, { deadline, budget, signal, baseMs = 100 }) => {
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    budget.recordAttempt();
    try {
      return await fn({ attempt });
    } catch (error) {
      lastError = error;

      const retryable = error.code === 'DEADLINE_EXCEEDED' || RETRYABLE.has(error.status);
      if (!retryable) throw error;

      // Jitter completo: sin el, todos los clientes que fallaron en el
      // mismo instante vuelven juntos en la misma ola.
      const backoff = Math.random() * baseMs * 2 ** attempt;
      if (deadline - Date.now() <= backoff) throw error;
      if (!budget.tryConsume()) throw error;

      await sleep(backoff, signal);
    }
  }

  throw lastError;
};`,
        },
      ],
    },
    {
      title: 'La cancelación tiene que atravesar la cadena entera',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Propagar el plazo resuelve la mitad del problema: cada capa sabe cuándo dejar de esperar. La otra mitad es hacer que el trabajo ya iniciado muera cuando la espera termina, y eso exige una señal que baje junto con la llamada. En el ecosistema JavaScript esa señal es el AbortSignal, encadenado desde el handler HTTP hasta la última llamada de red. En otras plataformas el nombre cambia pero el diseño es el mismo: un contexto cancelable que acompaña la petición y se verifica en los puntos de bloqueo.',
        },
        {
          type: 'paragraph',
          value:
            'El punto que suele quedar afuera es la base de datos, y es justamente la que sostiene el recurso más escaso. Abortar la llamada en el cliente HTTP no interrumpe una consulta que ya está ejecutándose en el servidor de base: la conexión queda ocupada hasta que la consulta termine sola. Por eso la configuración tiene que existir también del lado de la base, como tiempo máximo de ejecución de sentencia, y no solo como timeout del driver. Sin eso, una consulta lenta sigue consumiendo la conexión del pool mucho después de que el resto de la cadena se rindió, y el pool agotado transforma la lentitud de una ruta en indisponibilidad de todas las demás.',
        },
        {
          type: 'code',
          value: `// db/query.js
// Cancelacion que llega hasta la base, no solo hasta el driver.
//
// Sin statement_timeout, abortar del lado del cliente solo devuelve la
// conexion al pool despues de que la consulta termine por su cuenta. La
// consulta sigue corriendo en el servidor y el recurso sigue tomado.

export const queryWithDeadline = async (pool, { sql, params, deadline, signal }) => {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    const error = new Error('deadline_exceeded_before_query');
    error.code = 'DEADLINE_EXCEEDED';
    throw error;
  }

  const client = await pool.connect();
  // Nunca dejes que la conexion se filtre cuando el abort llega a mitad de camino.
  const release = () => client.release();
  signal?.addEventListener('abort', release, { once: true });

  try {
    // statement_timeout es por sesion: aplicado en la conexion prestada,
    // vale para las consultas siguientes hasta que la conexion vuelva al pool.
    await client.query('SET LOCAL statement_timeout = $1', [Math.floor(remaining)]);
    return await client.query({ text: sql, values: params });
  } catch (error) {
    // 57014 = query_canceled en PostgreSQL. Traducirlo aqui evita que la
    // capa de arriba trate la expiracion de plazo como error de base y
    // dispare un retry que solo va a expirar de nuevo.
    if (error.code === '57014') {
      const timeout = new Error('query_timeout');
      timeout.code = 'DEADLINE_EXCEEDED';
      throw timeout;
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', release);
    release();
  }
};`,
        },
        {
          type: 'paragraph',
          value:
            'Hay un caso en el que la cancelación es la decisión equivocada, y vale reconocerlo: cuando el trabajo ya produjo un efecto colateral parcial. Abortar en medio de una secuencia de escrituras deja el sistema en un estado que nadie diseñó. La salida acá no es renunciar a la cancelación, es mover la frontera: la parte que cambia estado se vuelve una unidad que o completa o no empieza, y la cancelación pasa a ocurrir antes de ella o después de ella, nunca en el medio. En la práctica, eso significa verificar el plazo restante justo antes de entrar en la transacción y tratar la transacción como no interrumpible una vez iniciada.',
        },
      ],
    },
    {
      title: 'Rechazar temprano vale más que encolar más',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando la llegada supera la capacidad, alguna petición va a fallar. La única elección real es dónde y cuándo. Encolar sin límite traslada la falla al futuro en forma de latencia creciente, y es la peor opción porque produce trabajo huérfano a escala: cuando la petición finalmente sale de la cola, el cliente se rindió hace mucho. Una cola con techo pequeño y rechazo inmediato del excedente falla más temprano y falla mejor, porque el rechazo es barato, es inmediatamente visible para el llamador y no consume capacidad.',
        },
        {
          type: 'paragraph',
          value:
            'La verificación más barata de todas cuesta una comparación y evita todo el resto: antes de sacar un ítem de la cola, verifica que su plazo no haya expirado. Si expiró, descártalo sin procesar. En una cola saturada eso limpia sola la parte de la carga que ya no tiene destinatario, y la capacidad vuelve a gastarse en trabajo útil. Es la diferencia entre una cola que se recupera cuando la presión baja y una que sigue saturada durante minutos después, procesando pedidos que nadie está esperando.',
        },
        {
          type: 'table',
          columns: ['Estrategia bajo saturación', 'Qué pasa', 'Cuándo usarla'],
          rows: [
            [
              'Cola ilimitada',
              'La latencia crece sin techo, la memoria crece con ella, todo se vuelve trabajo huérfano',
              'Nunca en camino síncrono de petición',
            ],
            [
              'Cola con techo y rechazo',
              'El excedente falla en milisegundos y libera capacidad para el resto',
              'Estándar para cualquier servicio síncrono',
            ],
            [
              'Descarte por plazo expirado',
              'El trabajo sin destinatario sale de la cola sin consumir capacidad',
              'Siempre que haya plazo propagado',
            ],
            [
              'Disyuntor por dependencia',
              'Deja de intentar la dependencia degradada y devuelve error inmediato',
              'Falla correlacionada persistente, no pico corto',
            ],
            [
              'Degradación funcional',
              'Devuelve respuesta parcial o de caché en vez de error',
              'Cuando existe respuesta aceptable sin la dependencia',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El disyuntor merece una salvedad porque suele adoptarse como primera medida cuando debería ser la última. Resuelve la falla correlacionada persistente cortando intentos contra una dependencia que ya se sabe indisponible, pero es malo para el pico corto: el umbral se dispara, el servicio pasa a rechazar todo por unos segundos y, al volver, manda la ola represada de una vez. Plazo propagado, cancelación efectiva y presupuesto de retry resuelven la mayor parte de los casos con menos efecto colateral. El disyuntor entra cuando la dependencia queda fuera durante minutos y seguir intentando es solo quemar capacidad.',
        },
      ],
    },
    {
      title: 'Probando que la cascada ya no ocurre',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La cascada es un comportamiento emergente: cada componente parece correcto aislado y el problema solo aparece en la composición bajo presión. Por eso la prueba unitaria no lo agarra, y por eso la validación tiene que reproducir la condición real, que es una dependencia lenta y no una dependencia rota. Inyectar error es fácil y no prueba nada acá, porque el error rápido no genera trabajo huérfano. Lo que sí prueba es inyectar latencia.',
        },
        {
          type: 'ordered',
          items: [
            'Inyecta latencia en la dependencia más profunda, algo entre tres y cinco veces el timeout configurado, manteniendo el tráfico de entrada constante. La hipótesis bajo prueba es que la carga en la dependencia se mantenga igual a la carga de entrada.',
            'Mide las llamadas efectivas que llegan a la dependencia durante la inyección. Si el número sube por encima de la entrada, hay amplificación de retry en algún punto de la cadena y lo primero que hay que buscar es retry encendido en más de una capa.',
            'Mide el trabajo huérfano directamente: cuenta cuántas respuestas produjo el servidor para peticiones cuyo cliente ya se había rendido. Un contador en ese punto es la métrica más honesta de propagación de cancelación, porque solo llega a cero cuando la cancelación realmente atraviesa.',
            'Verifica el tiempo de recuperación, que es lo que separa cuarenta segundos de veinte minutos. Quita la inyección y cronometra hasta que la latencia vuelva a lo normal. Si tarda mucho más que la duración de la inyección, sobró trabajo acumulado que nadie descartó.',
            'Confirma el peor caso punta a punta con una prueba que suma plazos a lo largo de la cadena y falla si el total supera el presupuesto del borde. Esa prueba es barata, corre en el pipeline y agarra la regresión el día en que alguien suba un timeout local por su cuenta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Vale una advertencia específica sobre la métrica que engaña. La latencia promedio baja durante una cascada, porque las peticiones que fallan rápido por plazo expirado entran en la cuenta como respuestas cortas. Un panel de latencia promedio queda verde en medio del incidente. Lo que ve la cascada es la razón entre llamadas de salida y peticiones de entrada por dependencia, que debería quedar cerca de uno y cuya subida indica amplificación. La alerta correcta es sobre esa razón, no sobre latencia.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Alcanza con apagar el retry para resolver el problema?',
      answer:
        'Apagarlo resuelve la amplificación y crea otro costo, así que es un intercambio y no una corrección. Sin retry, toda falla transitoria se vuelve error visible para el usuario: un paquete perdido, una instancia reiniciando durante el deploy, una reelección de líder en la base. Esas fallas son lo bastante frecuentes como para que la tasa de error percibida suba de forma perceptible, y por eso existe el retry. La corrección no es quitar el mecanismo, es limitarlo en tres dimensiones al mismo tiempo. Primero, permitir retry en una sola capa de la cadena, normalmente la más cercana al borde, porque es el retry compuesto el que multiplica. Segundo, condicionar el intento al plazo restante, para no iniciar una llamada que ya nace sin tiempo de terminar. Tercero, someter el intento a un presupuesto proporcional al tráfico, que se agota rápido cuando la falla es correlacionada y permanece disponible cuando es aislada. Con las tres trabas, el retry sigue cubriendo la falla rara y deja de participar en la cascada, que es exactamente la distinción que el contador local por llamada no logra hacer.',
    },
    {
      question: '¿Cómo elegir el timeout de cada capa sin adivinar?',
      answer:
        'Eligiendo un solo número y derivando el resto. El único valor con significado externo es el presupuesto del borde, y viene de lo que el usuario y el cliente llamador toleran, típicamente entre uno y diez segundos según la interacción. Todos los demás se derivan dentro de ese presupuesto, restando el tiempo que cada capa gasta en trabajo propio más un margen de red, y ninguno puede ser mayor que el que recibió de arriba. Los valores locales sirven solo como techo de seguridad para el caso de que la petición llegue sin plazo declarado, y en ese papel deben calibrarse a partir del p99 observado por ruta con cierta holgura, nunca de un número redondo elegido por costumbre. Un umbral por encima del p99 real nunca se dispara y no protege nada, y un umbral por debajo del p95 convierte tráfico sano en errores. Vale además separar el timeout de conexión del timeout total: una falla al establecer conexión aparece en cientos de milisegundos y no debería consumir el presupuesto entero esperando algo que ya se sabe indisponible.',
    },
    {
      question: '¿El plazo propagado funciona cuando la llamada pasa por una cola?',
      answer:
        'Funciona, y es justamente donde más desperdicio evita, pero exige dos cambios respecto de la llamada síncrona. El primero es que el plazo tiene que grabarse en el propio sobre del mensaje, no en el encabezado de la petición que lo produjo, porque el consumidor puede procesarlo minutos después y no tiene otra forma de saber cuánto tiempo quedaba. El segundo es que el consumidor tiene que verificar ese plazo antes de empezar el trabajo, y descartar el mensaje expirado en vez de procesarlo, contabilizando el descarte en una métrica propia para que quede visible. Hay una diferencia importante entre cola síncrona y asíncrona: cuando hay alguien esperando del otro lado, el descarte por plazo es correcto y barato. Cuando la cola es de trabajo en segundo plano y nadie está esperando, el plazo no debe ser el del llamador original sino un límite de validez del negocio, definido por la operación en sí, porque descartar un cobro pendiente porque estuvo diez segundos en la cola sería cambiar un problema de latencia por pérdida de trabajo.',
    },
  ],
  conclusion: {
    title: 'La recuperación empieza cuando el sistema deja de atacarse a sí mismo',
    description:
      'La cascada no es un bug en un componente específico, es una propiedad que emerge cuando timeout, retry y cola se configuran de forma aislada y se componen bajo presión. El sistema queda indisponible mucho más tiempo del que duró la falla original, y la causa es el propio mecanismo que existía para tolerar fallas. Puedo revisar la cadena de llamadas de tu sistema y definir el presupuesto de plazo que entra por el borde y baja hasta la base, la propagación de cancelación que mata el trabajo huérfano, la política de retry limitada por presupuesto en vez de contador local, la estrategia de rechazo bajo saturación y las pruebas de latencia inyectada que demuestran que la cascada no vuelve.',
    cta: 'Hablar sobre la cadena de timeouts de mi sistema',
  },
  related: [
    {
      label: 'Timeout y cancelación en cadena de llamadas LLM',
      to: '/blog/timeout-cancelamento-cadeia-chamadas-llm',
    },
    {
      label: 'Backpressure en pipeline de IA: cuando el consumidor no acompaña',
      to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha',
    },
    {
      label: 'Observabilidad y confiabilidad',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

export default { pt, en, es };
