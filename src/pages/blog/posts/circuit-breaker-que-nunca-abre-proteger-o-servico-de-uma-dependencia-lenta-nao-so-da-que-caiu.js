// Conteudo do artigo: circuit breaker que nunca abre. Por que o breaker contado por erro
// e cego para a dependencia lenta, como tratar latencia como falha com janela deslizante e
// taxa de chamadas lentas, como o bulkhead limita o que esta em voo, como sondar no estado
// meio-aberto sem soltar a onda represada e como provar em teste que o circuito abre.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const breakerCode = `// circuit-breaker.js
export class CircuitoAbertoError extends Error {
  constructor(nome) {
    super(\`circuito \${nome} aberto\`);
    this.codigo = 'CIRCUITO_ABERTO';
  }
}

export class CircuitBreaker {
  constructor({
    nome,
    janela = 20, // ultimas N chamadas consideradas na decisao
    minimoChamadas = 10, // nao decidir com amostra menor que isso
    limiteLentaMs = 500, // a partir desta duracao a chamada conta como lenta
    taxaLentaAbrir = 0.5, // fracao de chamadas lentas que abre o circuito
    taxaErroAbrir = 0.5, // fracao de erros que abre o circuito
    timeoutMs = 2000, // teto de espera por uma unica chamada
    tempoAbertoMs = 10_000, // quanto tempo fica aberto antes de sondar
    sondasMeioAberto = 3, // chamadas reais permitidas no estado meio-aberto
    agora = () => Date.now(), // relogio injetavel para os testes
  }) {
    Object.assign(this, {
      nome, janela, minimoChamadas, limiteLentaMs, taxaLentaAbrir,
      taxaErroAbrir, timeoutMs, tempoAbertoMs, sondasMeioAberto, agora,
    });
    this.estado = 'fechado';
    this.amostras = []; // { erro, lenta }
    this.abertoAte = 0;
    this.sondasRestantes = 0;
  }

  async executar(fn) {
    this.admitir();
    const inicio = this.agora();
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), this.timeoutMs);
    try {
      const resultado = await fn(controlador.signal);
      this.registrar({ erro: false, duracaoMs: this.agora() - inicio });
      return resultado;
    } catch (erro) {
      this.registrar({ erro: true, duracaoMs: this.agora() - inicio });
      throw erro;
    } finally {
      clearTimeout(temporizador);
    }
  }

  admitir() {
    if (this.estado === 'aberto') {
      if (this.agora() < this.abertoAte) throw new CircuitoAbertoError(this.nome);
      this.estado = 'meio-aberto';
      this.sondasRestantes = this.sondasMeioAberto;
      this.amostras = [];
    }
    if (this.estado === 'meio-aberto') {
      if (this.sondasRestantes === 0) throw new CircuitoAbertoError(this.nome);
      this.sondasRestantes -= 1;
    }
  }

  registrar({ erro, duracaoMs }) {
    if (this.estado === 'aberto') return; // chamada que ja estava em voo: nao decide nada
    const lenta = duracaoMs >= this.limiteLentaMs;
    this.amostras.push({ erro, lenta });
    if (this.amostras.length > this.janela) this.amostras.shift();

    if (this.estado === 'meio-aberto') {
      if (erro || lenta) return this.abrir();
      if (this.amostras.length >= this.sondasMeioAberto) this.fechar();
      return;
    }
    if (this.amostras.length < this.minimoChamadas) return;
    const taxa = (chave) =>
      this.amostras.filter((amostra) => amostra[chave]).length / this.amostras.length;
    if (taxa('erro') >= this.taxaErroAbrir || taxa('lenta') >= this.taxaLentaAbrir) this.abrir();
  }

  abrir() {
    this.estado = 'aberto';
    this.abertoAte = this.agora() + this.tempoAbertoMs;
    this.amostras = [];
  }

  fechar() {
    this.estado = 'fechado';
    this.amostras = [];
  }
}`;

const bulkheadCode = `// bulkhead.js
export class Bulkhead {
  constructor({ nome, maxEmVoo = 20 }) {
    this.nome = nome;
    this.maxEmVoo = maxEmVoo;
    this.emVoo = 0;
  }

  async executar(fn) {
    if (this.emVoo >= this.maxEmVoo) {
      throw Object.assign(new Error(\`bulkhead \${this.nome} cheio\`), { codigo: 'BULKHEAD_CHEIO' });
    }
    this.emVoo += 1;
    try {
      return await fn();
    } finally {
      this.emVoo -= 1;
    }
  }
}

// cliente-catalogo.js
import { CircuitBreaker } from './circuit-breaker.js';
import { Bulkhead } from './bulkhead.js';
import { precoEmCache } from './cache-precos.js';

const breaker = new CircuitBreaker({ nome: 'catalogo', limiteLentaMs: 500, timeoutMs: 2000 });
const bulkhead = new Bulkhead({ nome: 'catalogo', maxEmVoo: 20 }); // menor que o pool de conexoes

export async function buscarPreco(sku) {
  try {
    return await bulkhead.executar(() =>
      breaker.executar(async (signal) => {
        const resposta = await fetch(\`http://catalogo/precos/\${sku}\`, { signal });
        if (!resposta.ok) throw new Error(\`catalogo respondeu \${resposta.status}\`);
        return resposta.json();
      }),
    );
  } catch (erro) {
    if (erro.codigo === 'CIRCUITO_ABERTO' || erro.codigo === 'BULKHEAD_CHEIO') {
      return precoEmCache(sku); // degradacao explicita: responde sem esperar
    }
    throw erro;
  }
}`;

const testeCode = `// circuit-breaker.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker, CircuitoAbertoError } from './circuit-breaker.js';

const criarBreaker = (relogio) =>
  new CircuitBreaker({
    nome: 'catalogo',
    janela: 10,
    minimoChamadas: 10,
    limiteLentaMs: 500,
    taxaLentaAbrir: 0.5,
    timeoutMs: 2000,
    tempoAbertoMs: 10_000,
    sondasMeioAberto: 3,
    agora: () => relogio.valor,
  });

const lentaComSucesso = (relogio) => async () => {
  relogio.valor += 800; // a dependencia responde 200, mas demora 800 ms
  return { ok: true };
};

test('abre com dependencia que responde sucesso em 800 ms', async () => {
  const relogio = { valor: 0 };
  const breaker = criarBreaker(relogio);

  for (let i = 0; i < 10; i += 1) await breaker.executar(lentaComSucesso(relogio));

  assert.equal(breaker.estado, 'aberto');
  await assert.rejects(breaker.executar(lentaComSucesso(relogio)), CircuitoAbertoError);
});

test('fecha de novo quando as sondas voltam rapido', async () => {
  const relogio = { valor: 0 };
  const breaker = criarBreaker(relogio);
  for (let i = 0; i < 10; i += 1) await breaker.executar(lentaComSucesso(relogio));
  relogio.valor += 10_000; // tempo aberto esgotado: as proximas chamadas sao sondas

  for (let i = 0; i < 3; i += 1) await breaker.executar(async () => ({ ok: true }));

  assert.equal(breaker.estado, 'fechado');
});

test('sonda lenta reabre o circuito mesmo devolvendo sucesso', async () => {
  const relogio = { valor: 0 };
  const breaker = criarBreaker(relogio);
  for (let i = 0; i < 10; i += 1) await breaker.executar(lentaComSucesso(relogio));
  relogio.valor += 10_000;

  await breaker.executar(async () => {
    relogio.valor += 3000;
    return { ok: true };
  });

  assert.equal(breaker.estado, 'aberto');
});`;

const diagramaPt = `Checkout chama o catálogo de preços com pool de 50 conexões. O catálogo passa de 80 ms para 8 s, ainda respondendo 200.

t=0       o catálogo começa a responder em 8 s; taxa de erro: 0%
t=4 s     50 chamadas em voo, todas esperando; a 51ª entra na fila do pool
t=8 s     as 50 primeiras voltam com 200; o breaker por erro não tem nada a registrar
t=30 s    p99 do checkout em 9,4 s; CPU em 12%; event loop livre; memória subindo
t=45 s    o balanceador tira o checkout de rotação: o health check também estourou
          em nenhum momento o circuito abriu, porque não houve erro para contar`;

const diagramaEn = `Checkout calls the price catalog with a pool of 50 connections. The catalog goes from 80 ms to 8 s, still answering 200.

t=0       the catalog starts answering in 8 s; error rate: 0%
t=4 s     50 calls in flight, all waiting; the 51st enters the pool queue
t=8 s     the first 50 come back with 200; the error-based breaker has nothing to record
t=30 s    checkout p99 at 9.4 s; CPU at 12%; event loop idle; memory climbing
t=45 s    the load balancer pulls checkout out of rotation: the health check timed out too
          at no point did the circuit open, because there was no error to count`;

const diagramaEs = `Checkout llama al catálogo de precios con un pool de 50 conexiones. El catálogo pasa de 80 ms a 8 s, todavía respondiendo 200.

t=0       el catálogo empieza a responder en 8 s; tasa de error: 0%
t=4 s     50 llamadas en vuelo, todas esperando; la número 51 entra en la cola del pool
t=8 s     las primeras 50 vuelven con 200; el breaker por error no tiene nada que registrar
t=30 s    p99 del checkout en 9,4 s; CPU al 12%; event loop libre; memoria subiendo
t=45 s    el balanceador saca el checkout de la rotación: el health check también venció
          en ningún momento se abrió el circuito, porque no hubo error que contar`;

const pt = {
  intro:
    'Um circuit breaker clássico conta erros. Quando a dependência cai, as chamadas falham rápido, o contador estoura, o circuito abre e o serviço se protege. Só que a dependência que mais derruba serviço em produção não cai: ela fica lenta. Responde 200 em oito segundos em vez de oitenta milissegundos, e o breaker configurado por taxa de erro nunca vê um erro para contar. Enquanto isso, cada chamada ocupa uma conexão, um slot do pool e uma promessa pendente, até o chamador esgotar os próprios recursos e morrer saudável por dentro. Este artigo mostra por que o breaker por erro é cego para a lentidão, como tratar latência como falha com uma janela deslizante e taxa de chamadas lentas, como um bulkhead impede que a lentidão ocupe tudo, como sondar no estado meio-aberto sem soltar a onda represada e como provar em teste que o circuito abre com uma dependência que só demora.',
  sections: [
    {
      title: 'Uma dependência que caiu custa menos do que uma que ficou lenta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando uma dependência cai de verdade, o erro chega rápido: conexão recusada, DNS que não resolve, 503 imediato. O chamador gasta alguns milissegundos por tentativa, libera a conexão e segue para o fallback. Quando a dependência fica lenta, nada disso acontece. A conexão é aceita, a requisição entra, e o chamador fica esperando, com o socket aberto, o slot do pool ocupado e a promessa pendente na memória. Durante toda a espera não existe erro. Existe só tempo passando. E tempo é o recurso que o breaker por erro não mede.',
        },
        {
          type: 'table',
          columns: ['Cenário', 'Sinal que o chamador vê', 'Tempo preso por chamada', 'O que o breaker por erro faz'],
          rows: [
            [
              'Dependência caiu',
              'ECONNREFUSED ou 503 em poucos milissegundos',
              'Milissegundos',
              'Conta o erro e abre em segundos',
            ],
            [
              'Dependência lenta com timeout',
              '200 depois de 8 s, ou timeout aos 10 s',
              'Até o timeout',
              'Só vê erro quando o timeout estoura; abre tarde ou não abre',
            ],
            [
              'Dependência lenta sem timeout',
              '200 quando ela quiser',
              'Indefinido',
              'Nunca abre; o chamador esgota o pool e para de atender',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'As duas últimas linhas são as que aparecem em pós-incidente acompanhadas da frase "o circuit breaker estava configurado". Ele estava. Só que a configuração media a dimensão errada: contava quantas chamadas falharam, quando o dano vinha de quanto tempo cada chamada ficou presa.',
        },
      ],
    },
    {
      title: 'Por que o breaker contado por erro nunca abre',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um serviço de checkout chama o catálogo de preços com um pool de 50 conexões. Em condição normal o catálogo responde em 80 ms, o que permite cerca de 600 chamadas por segundo com o pool inteiro ocupado. Um deploy ruim no catálogo faz o tempo de resposta subir para 8 s, mantendo o 200. Pela lei de Little, com as mesmas 50 conexões o checkout passa a conseguir no máximo 6 chamadas por segundo. O tráfego não caiu, então a fila do pool cresce, o p99 do checkout vai a nove segundos e o balanceador acaba tirando a instância de rotação quando o health check também estoura. Taxa de erro durante o episódio inteiro: zero.',
        },
        { type: 'diagram', value: diagramaPt },
        {
          type: 'paragraph',
          value:
            'O detalhe que costuma passar despercebido: um timeout no cliente converte lentidão em erro, mas só depois de a chamada ter ocupado o recurso pelo prazo inteiro. Com timeout de 10 s e latência de 8 s, nenhuma chamada estoura e o breaker continua cego. Com timeout de 2 s, cada chamada ainda prende a conexão por 2 s antes de virar um erro contável, e o breaker precisa de dezenas delas para abrir. O timeout é necessário como teto, mas não é o sinal certo para decidir.',
        },
      ],
    },
    {
      title: 'Latência é falha: janela deslizante com taxa de chamadas lentas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A correção é contar duas coisas em vez de uma. Cada chamada registra se falhou e se foi lenta, comparando a duração com um limite definido a partir da latência saudável da dependência. O circuito abre quando a taxa de erro ou a taxa de chamadas lentas passa do limiar dentro de uma janela deslizante com as últimas N chamadas, desde que a janela tenha um mínimo de amostras para não decidir com base em duas requisições. É o mesmo modelo que bibliotecas maduras como o Resilience4j adotam com o nome de slow call rate, e cabe em poucas dezenas de linhas quando o objetivo é entender o que está acontecendo.',
        },
        { type: 'code', value: breakerCode },
        {
          type: 'paragraph',
          value:
            'Três decisões no código merecem atenção. A primeira é que o timeout vive dentro do breaker e aborta a chamada pelo AbortSignal, de forma que a espera tem teto mesmo quando a dependência nunca responde. A segunda é que a duração é medida para erros também: um timeout de dois segundos conta como erro e como chamada lenta ao mesmo tempo. A terceira é que, no estado aberto, resultados de chamadas que ainda estavam em voo são ignorados, para que uma chamada atrasada não estenda o tempo de abertura nem feche o circuito sozinha.',
        },
        {
          type: 'table',
          columns: ['Parâmetro', 'Como definir', 'Erro comum'],
          rows: [
            [
              'limiteLentaMs',
              'Duas a três vezes o p99 da dependência saudável, medido em produção',
              'Copiar o valor do timeout; nessa altura a chamada já ocupou tudo',
            ],
            [
              'timeoutMs',
              'O máximo que o chamador aceita esperar por uma única resposta',
              'Deixar sem timeout e confiar só no breaker',
            ],
            [
              'janela e minimoChamadas',
              'Grandes o bastante para absorver um pico isolado de latência',
              'Janela de 5 chamadas que abre e fecha a cada rajada',
            ],
            [
              'taxaLentaAbrir',
              '50% é um ponto de partida; dependências críticas podem usar menos',
              'Exigir 100% e nunca abrir com uma dependência meio lenta',
            ],
            [
              'tempoAbertoMs',
              'Tempo suficiente para a dependência se recuperar, com jitter entre instâncias',
              'Valor idêntico em todas as réplicas, que sondam no mesmo instante',
            ],
          ],
        },
      ],
    },
    {
      title: 'Bulkhead: limitar o que está em voo para que a lentidão não ocupe tudo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O breaker com taxa de chamadas lentas resolve a cegueira, mas ainda precisa de amostras para decidir. Entre a dependência ficar lenta e a janela encher, as chamadas em voo continuam ocupando recursos, e com um pico de tráfego elas podem esgotar o pool antes que o circuito abra. O bulkhead fecha essa brecha: ele limita quantas chamadas àquela dependência podem estar em andamento ao mesmo tempo e rejeita na hora o que passar disso. Diferente do breaker, ele não precisa de histórico; a saturação atual é a evidência.',
        },
        { type: 'code', value: bulkheadCode },
        {
          type: 'paragraph',
          value:
            'A ordem da composição importa. O bulkhead fica por fora e o breaker por dentro: uma rejeição do breaker dura microssegundos e quase não ocupa o bulkhead, enquanto uma rejeição do bulkhead nunca chega ao breaker e por isso não contamina a janela com um erro que não diz nada sobre a dependência. O limite de chamadas em voo deve ser menor do que o pool de conexões do chamador, para que uma única dependência lenta nunca consiga ocupar o pool inteiro e levar junto as chamadas a dependências saudáveis.',
        },
      ],
    },
    {
      title: 'Meio-aberto: sondar sem soltar a onda represada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando o tempo de abertura termina, o circuito não deve simplesmente fechar. Ele passa para meio-aberto e deixa um número pequeno de chamadas reais servirem de sonda. Se as sondas voltam rápido e sem erro, fecha. Se uma delas falha ou demora, abre de novo e reinicia o relógio. O ponto crítico é que, durante a sondagem, todas as outras chamadas continuam recebendo a rejeição rápida. Sem esse limite, o instante em que o circuito reabre descarrega sobre a dependência todo o tráfego represado, e uma dependência que estava quase recuperada volta a ficar lenta.',
        },
        {
          type: 'list',
          items: [
            'Sondas com o mesmo critério de lentidão: uma sonda que responde 200 em três segundos é uma sonda que falhou.',
            'Jitter no tempo de abertura: com dez réplicas usando exatamente 10 s, todas sondam no mesmo segundo e as sondas somadas viram um pico.',
            'Fallback explícito enquanto o circuito está aberto: devolver preço em cache, esconder a seção ou enfileirar para depois, mas nunca esperar.',
            'Registro de cada transição de estado com o motivo, porque a pergunta do pós-incidente é sempre por que abriu às 14:07.',
          ],
        },
      ],
    },
    {
      title: 'O que medir para saber que o circuito está fazendo o trabalho dele',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um breaker que nunca abre e um breaker que nunca precisou abrir têm o mesmo gráfico até a lentidão chegar. Para diferenciar os dois antes do incidente, as métricas precisam expor o que o breaker está vendo, não só o estado em que ele está.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Granularidade', 'Alerta sugerido'],
          rows: [
            [
              'Taxa de chamadas lentas na janela',
              'Por dependência e operação',
              'Acima de metade do limiar de abertura por mais de um minuto',
            ],
            [
              'Chamadas em voo e rejeições do bulkhead',
              'Por dependência',
              'Qualquer rejeição fora de horário de pico',
            ],
            [
              'Transições de estado do circuito',
              'Por dependência e instância',
              'Mais de três aberturas em dez minutos indica oscilação',
            ],
            [
              'Tempo acumulado em estado aberto',
              'Por dependência',
              'Aberto por mais tempo do que o SLO da funcionalidade permite',
            ],
            [
              'Latência da dependência em p50 e p99',
              'Por operação',
              'p99 acima do limite de chamada lenta configurado',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha é a que mantém a configuração honesta. Se o p99 saudável da dependência sobe ao longo dos meses e ninguém revisa o limite, o breaker passa a abrir em dias normais, alguém aumenta o limiar para fazer o alerta parar, e o serviço volta a ficar cego.',
        },
      ],
    },
    {
      title: 'Como provar que ele abre com uma dependência que só demora',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O teste que importa não é o da dependência que cai; esse quase sempre passa. É o da dependência que responde sucesso devagar. Com o relógio injetado no breaker, dá para simular latência sem esperar de verdade: cada chamada falsa avança o relógio em 800 ms e devolve sucesso. Depois de dez chamadas, a janela está cheia de chamadas lentas sem nenhum erro, e a décima primeira precisa ser rejeitada sem executar.',
        },
        { type: 'code', value: testeCode },
        {
          type: 'paragraph',
          value:
            'Vale completar com dois cenários: uma chamada lenta isolada no meio de chamadas rápidas não deve abrir o circuito, e um timeout real, com a dependência que nunca responde, deve ser abortado pelo sinal e contado como erro. Esses testes rodam em milissegundos e são a única garantia de que a configuração mede o que o incidente vai exercitar.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'O timeout no cliente não resolve o mesmo problema?',
      answer:
        'Resolve parte. O timeout garante que nenhuma chamada espera para sempre, mas cada chamada ainda ocupa a conexão pelo prazo inteiro antes de virar erro, e o breaker por erro precisa de muitas delas para abrir. Com latência pouco abaixo do timeout, nenhuma estoura e o circuito permanece fechado enquanto o pool esgota. O timeout é o teto; a taxa de chamadas lentas é o sinal que permite abrir antes de o teto ser atingido.',
    },
    {
      question: 'Qual limite de chamada lenta usar quando a dependência tem latência variável?',
      answer:
        'Partir do p99 medido em produção em período saudável, multiplicado por dois ou três, e revisar junto com o SLO da funcionalidade. Se a dependência tem operações com latências muito diferentes, como uma busca simples e um relatório pesado, usar um breaker por operação, não um por host. Um único limite para tudo ou abre em dias normais por causa da operação pesada, ou nunca abre por causa da leve.',
    },
    {
      question: 'O bulkhead não torna o breaker desnecessário?',
      answer:
        'Não, eles cobrem falhas diferentes. O bulkhead reage à saturação atual e impede que uma dependência lenta ocupe o pool inteiro, mas continua mandando chamadas para ela até o limite, cada uma esperando o tempo todo. O breaker usa o histórico para parar de chamar quando a evidência mostra que não vale a pena, e devolve a rejeição em microssegundos. Juntos, um protege os recursos do chamador e o outro protege o tempo do usuário.',
    },
  ],
  conclusion: {
    title: 'Um breaker que só conta erros protege contra a falha que menos acontece',
    description:
      'A dependência que derruba serviço em produção costuma estar viva e lenta, não morta. Para que o circuito abra nesse caso, a latência precisa contar como falha, a janela precisa ter amostras suficientes para decidir, um bulkhead precisa limitar o que está em voo enquanto a janela enche, e o estado meio-aberto precisa sondar sem soltar a onda represada. Sem o teste da dependência lenta, a configuração continua sendo uma suposição.',
    cta: 'Revisar os circuit breakers do meu serviço',
  },
  related: [
    {
      label: 'Timeout em cascata entre serviços: quando o tempo de espera de um vira a fila do outro',
      to: '/blog/timeout-em-cascata-entre-servicos-quando-o-tempo-de-espera-de-um-vira-a-fila-do-outro',
    },
    {
      label: 'Limite de conexões do banco esgotado: quando o pool vira o gargalo do serviço',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Serviço de observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'A classic circuit breaker counts errors. When the dependency goes down, calls fail fast, the counter trips, the circuit opens and the service protects itself. But the dependency that takes down the most services in production does not go down: it gets slow. It answers 200 in eight seconds instead of eighty milliseconds, and a breaker configured on error rate never sees an error to count. Meanwhile, every call holds a connection, a pool slot and a pending promise, until the caller exhausts its own resources and dies looking healthy from the inside. This article shows why the error-based breaker is blind to slowness, how to treat latency as failure with a sliding window and a slow call rate, how a bulkhead keeps slowness from occupying everything, how to probe in the half-open state without releasing the pent-up wave, and how to prove in a test that the circuit opens against a dependency that merely takes too long.',
  sections: [
    {
      title: 'A dependency that is down costs less than one that got slow',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When a dependency is really down, the error arrives fast: connection refused, DNS that does not resolve, an immediate 503. The caller spends a few milliseconds per attempt, releases the connection and moves on to the fallback. When the dependency gets slow, none of that happens. The connection is accepted, the request goes in, and the caller sits waiting, with the socket open, the pool slot taken and the promise pending in memory. During the whole wait there is no error. There is only time passing. And time is the resource the error-based breaker does not measure.',
        },
        {
          type: 'table',
          columns: ['Scenario', 'Signal the caller sees', 'Time held per call', 'What the error-based breaker does'],
          rows: [
            [
              'Dependency is down',
              'ECONNREFUSED or 503 within milliseconds',
              'Milliseconds',
              'Counts the error and opens within seconds',
            ],
            [
              'Slow dependency with a timeout',
              '200 after 8 s, or a timeout at 10 s',
              'Up to the timeout',
              'Only sees an error when the timeout fires; opens late or not at all',
            ],
            [
              'Slow dependency without a timeout',
              '200 whenever it feels like it',
              'Unbounded',
              'Never opens; the caller exhausts the pool and stops serving',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last two rows are the ones that show up in postmortems next to the sentence "the circuit breaker was configured". It was. The configuration just measured the wrong dimension: it counted how many calls failed, when the damage came from how long each call stayed stuck.',
        },
      ],
    },
    {
      title: 'Why the error-counting breaker never opens',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A checkout service calls the price catalog with a pool of 50 connections. Under normal conditions the catalog answers in 80 ms, which allows about 600 calls per second with the whole pool busy. A bad deploy on the catalog pushes the response time to 8 s while keeping the 200. By Little\'s law, with the same 50 connections checkout can now complete at most 6 calls per second. Traffic has not dropped, so the pool queue grows, checkout p99 reaches nine seconds and the load balancer ends up pulling the instance out of rotation when the health check times out as well. Error rate during the whole episode: zero.',
        },
        { type: 'diagram', value: diagramaEn },
        {
          type: 'paragraph',
          value:
            'The detail that usually goes unnoticed: a client-side timeout converts slowness into an error, but only after the call has held the resource for the entire deadline. With a 10 s timeout and 8 s latency, no call fires and the breaker stays blind. With a 2 s timeout, every call still pins the connection for 2 s before becoming a countable error, and the breaker needs dozens of those to open. The timeout is necessary as a ceiling, but it is not the right signal for the decision.',
        },
      ],
    },
    {
      title: 'Latency is failure: a sliding window with a slow call rate',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The fix is to count two things instead of one. Each call records whether it failed and whether it was slow, comparing its duration with a threshold derived from the healthy latency of the dependency. The circuit opens when either the error rate or the slow call rate crosses the threshold within a sliding window of the last N calls, as long as the window holds a minimum number of samples so it never decides based on two requests. It is the same model that mature libraries such as Resilience4j adopt under the name slow call rate, and it fits in a few dozen lines when the goal is to understand what is going on.',
        },
        { type: 'code', value: breakerCode },
        {
          type: 'paragraph',
          value:
            'Three decisions in the code deserve attention. First, the timeout lives inside the breaker and aborts the call through the AbortSignal, so the wait has a ceiling even when the dependency never answers. Second, duration is measured for errors too: a two-second timeout counts as an error and as a slow call at the same time. Third, in the open state, results from calls that were still in flight are ignored, so a late call can neither extend the open period nor close the circuit on its own.',
        },
        {
          type: 'table',
          columns: ['Parameter', 'How to set it', 'Common mistake'],
          rows: [
            [
              'limiteLentaMs',
              'Two to three times the p99 of the healthy dependency, measured in production',
              'Copying the timeout value; by then the call has already held everything',
            ],
            [
              'timeoutMs',
              'The maximum the caller accepts waiting for a single response',
              'Leaving no timeout and trusting the breaker alone',
            ],
            [
              'janela and minimoChamadas',
              'Large enough to absorb an isolated latency spike',
              'A window of 5 calls that opens and closes on every burst',
            ],
            [
              'taxaLentaAbrir',
              '50% is a starting point; critical dependencies can use less',
              'Requiring 100% and never opening against a half-slow dependency',
            ],
            [
              'tempoAbertoMs',
              'Long enough for the dependency to recover, with jitter across instances',
              'The same value on every replica, so they all probe at the same instant',
            ],
          ],
        },
      ],
    },
    {
      title: 'Bulkhead: cap what is in flight so slowness cannot occupy everything',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The breaker with a slow call rate fixes the blindness, but it still needs samples before it can decide. Between the moment the dependency gets slow and the moment the window fills, in-flight calls keep holding resources, and under a traffic spike they can exhaust the pool before the circuit opens. The bulkhead closes that gap: it caps how many calls to that dependency can be in progress at the same time and rejects immediately anything beyond that. Unlike the breaker, it needs no history; the current saturation is the evidence.',
        },
        { type: 'code', value: bulkheadCode },
        {
          type: 'paragraph',
          value:
            'The order of composition matters. The bulkhead sits on the outside and the breaker on the inside: a breaker rejection lasts microseconds and barely occupies the bulkhead, while a bulkhead rejection never reaches the breaker and therefore does not pollute the window with an error that says nothing about the dependency. The in-flight limit must be smaller than the caller\'s connection pool, so a single slow dependency can never occupy the whole pool and drag down calls to healthy dependencies with it.',
        },
      ],
    },
    {
      title: 'Half-open: probe without releasing the pent-up wave',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When the open period ends, the circuit should not simply close. It moves to half-open and lets a small number of real calls act as probes. If the probes come back fast and without errors, it closes. If one of them fails or takes too long, it opens again and restarts the clock. The critical point is that, during probing, every other call keeps receiving the fast rejection. Without that limit, the instant the circuit reopens dumps all the pent-up traffic on the dependency, and a dependency that was almost recovered becomes slow again.',
        },
        {
          type: 'list',
          items: [
            'Probes judged by the same slowness criterion: a probe that answers 200 in three seconds is a probe that failed.',
            'Jitter on the open period: with ten replicas using exactly 10 s, all of them probe in the same second and the combined probes become a spike.',
            'An explicit fallback while the circuit is open: return the cached price, hide the section or enqueue for later, but never wait.',
            'A log entry for every state transition with its reason, because the postmortem question is always why it opened at 14:07.',
          ],
        },
      ],
    },
    {
      title: 'What to measure to know the circuit is doing its job',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A breaker that never opens and a breaker that never needed to open have the same graph until the slowness arrives. To tell the two apart before the incident, the metrics need to expose what the breaker is seeing, not only the state it is in.',
        },
        {
          type: 'table',
          columns: ['Metric', 'Granularity', 'Suggested alert'],
          rows: [
            [
              'Slow call rate in the window',
              'Per dependency and operation',
              'Above half the opening threshold for more than a minute',
            ],
            [
              'In-flight calls and bulkhead rejections',
              'Per dependency',
              'Any rejection outside peak hours',
            ],
            [
              'Circuit state transitions',
              'Per dependency and instance',
              'More than three openings in ten minutes indicates flapping',
            ],
            [
              'Cumulative time in the open state',
              'Per dependency',
              'Open for longer than the SLO of the dependent feature allows',
            ],
            [
              'Dependency latency at p50 and p99',
              'Per operation',
              'p99 above the configured slow call threshold',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row is what keeps the configuration honest. If the healthy p99 of the dependency creeps up over the months and nobody reviews the threshold, the breaker starts opening on normal days, someone raises the threshold to silence the alert, and the service goes blind again.',
        },
      ],
    },
    {
      title: 'How to prove it opens against a dependency that merely takes too long',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The test that matters is not the one with the dependency that goes down; that one almost always passes. It is the one with the dependency that answers success slowly. With the clock injected into the breaker, latency can be simulated without actually waiting: each fake call advances the clock by 800 ms and returns success. After ten calls the window is full of slow calls with no errors at all, and the eleventh must be rejected without executing.',
        },
        { type: 'code', value: testeCode },
        {
          type: 'paragraph',
          value:
            'Two more scenarios complete the suite: a single slow call among fast ones must not open the circuit, and a real timeout, with a dependency that never answers, must be aborted through the signal and counted as an error. These tests run in milliseconds and are the only guarantee that the configuration measures what the incident will exercise.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does a client-side timeout not solve the same problem?',
      answer:
        'It solves part of it. The timeout guarantees that no call waits forever, but each call still holds the connection for the entire deadline before becoming an error, and the error-based breaker needs many of those to open. With latency just below the timeout, none of them fire and the circuit stays closed while the pool drains. The timeout is the ceiling; the slow call rate is the signal that allows opening before the ceiling is reached.',
    },
    {
      question: 'Which slow call threshold should I use when the dependency has variable latency?',
      answer:
        'Start from the p99 measured in production during a healthy period, multiplied by two or three, and review it together with the SLO of the feature. If the dependency has operations with very different latencies, such as a simple lookup and a heavy report, use one breaker per operation, not one per host. A single threshold for everything either opens on normal days because of the heavy operation or never opens because of the light one.',
    },
    {
      question: 'Does the bulkhead make the breaker unnecessary?',
      answer:
        'No, they cover different failures. The bulkhead reacts to current saturation and keeps a slow dependency from occupying the whole pool, but it keeps sending calls to it up to the limit, each one waiting the full time. The breaker uses history to stop calling when the evidence shows it is not worth it, and returns the rejection in microseconds. Together, one protects the caller\'s resources and the other protects the user\'s time.',
    },
  ],
  conclusion: {
    title: 'A breaker that only counts errors protects against the failure that happens least',
    description:
      'The dependency that takes a service down in production is usually alive and slow, not dead. For the circuit to open in that case, latency has to count as failure, the window has to hold enough samples to decide, a bulkhead has to cap what is in flight while the window fills, and the half-open state has to probe without releasing the pent-up wave. Without the slow dependency test, the configuration remains an assumption.',
    cta: 'Review the circuit breakers in my service',
  },
  related: [
    {
      label: 'Cascading timeouts between services: when the wait of one service becomes the queue of another',
      to: '/blog/timeout-em-cascata-entre-servicos-quando-o-tempo-de-espera-de-um-vira-a-fila-do-outro',
    },
    {
      label: 'Exhausted database connection limit: when the pool becomes the service bottleneck',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Observability and reliability service',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'Un circuit breaker clásico cuenta errores. Cuando la dependencia se cae, las llamadas fallan rápido, el contador se dispara, el circuito se abre y el servicio se protege. Pero la dependencia que más servicios tumba en producción no se cae: se vuelve lenta. Responde 200 en ocho segundos en vez de ochenta milisegundos, y el breaker configurado por tasa de error nunca ve un error que contar. Mientras tanto, cada llamada ocupa una conexión, un slot del pool y una promesa pendiente, hasta que el llamador agota sus propios recursos y muere sano por dentro. Este artículo muestra por qué el breaker por error es ciego ante la lentitud, cómo tratar la latencia como fallo con una ventana deslizante y una tasa de llamadas lentas, cómo un bulkhead impide que la lentitud lo ocupe todo, cómo sondear en el estado semiabierto sin soltar la ola represada y cómo demostrar en una prueba que el circuito se abre ante una dependencia que solo tarda.',
  sections: [
    {
      title: 'Una dependencia caída cuesta menos que una que se volvió lenta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando una dependencia se cae de verdad, el error llega rápido: conexión rechazada, DNS que no resuelve, 503 inmediato. El llamador gasta unos milisegundos por intento, libera la conexión y sigue hacia el fallback. Cuando la dependencia se vuelve lenta, nada de eso ocurre. La conexión se acepta, la petición entra y el llamador se queda esperando, con el socket abierto, el slot del pool ocupado y la promesa pendiente en memoria. Durante toda la espera no existe error. Solo existe tiempo que pasa. Y el tiempo es el recurso que el breaker por error no mide.',
        },
        {
          type: 'table',
          columns: ['Escenario', 'Señal que ve el llamador', 'Tiempo retenido por llamada', 'Qué hace el breaker por error'],
          rows: [
            [
              'Dependencia caída',
              'ECONNREFUSED o 503 en pocos milisegundos',
              'Milisegundos',
              'Cuenta el error y se abre en segundos',
            ],
            [
              'Dependencia lenta con timeout',
              '200 después de 8 s, o timeout a los 10 s',
              'Hasta el timeout',
              'Solo ve error cuando vence el timeout; se abre tarde o no se abre',
            ],
            [
              'Dependencia lenta sin timeout',
              '200 cuando a ella le parezca',
              'Indefinido',
              'Nunca se abre; el llamador agota el pool y deja de atender',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Las dos últimas filas son las que aparecen en el postmortem acompañadas de la frase "el circuit breaker estaba configurado". Lo estaba. Solo que la configuración medía la dimensión equivocada: contaba cuántas llamadas fallaron, cuando el daño venía de cuánto tiempo quedó atascada cada llamada.',
        },
      ],
    },
    {
      title: 'Por qué el breaker que cuenta errores nunca se abre',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un servicio de checkout llama al catálogo de precios con un pool de 50 conexiones. En condiciones normales el catálogo responde en 80 ms, lo que permite unas 600 llamadas por segundo con todo el pool ocupado. Un despliegue malo en el catálogo sube el tiempo de respuesta a 8 s, manteniendo el 200. Por la ley de Little, con las mismas 50 conexiones el checkout pasa a completar como máximo 6 llamadas por segundo. El tráfico no bajó, así que la cola del pool crece, el p99 del checkout llega a nueve segundos y el balanceador termina sacando la instancia de la rotación cuando el health check también vence. Tasa de error durante todo el episodio: cero.',
        },
        { type: 'diagram', value: diagramaEs },
        {
          type: 'paragraph',
          value:
            'El detalle que suele pasar desapercibido: un timeout en el cliente convierte la lentitud en error, pero solo después de que la llamada ocupó el recurso durante todo el plazo. Con timeout de 10 s y latencia de 8 s, ninguna llamada vence y el breaker sigue ciego. Con timeout de 2 s, cada llamada todavía retiene la conexión 2 s antes de convertirse en un error contable, y el breaker necesita decenas de ellas para abrirse. El timeout es necesario como techo, pero no es la señal correcta para decidir.',
        },
      ],
    },
    {
      title: 'La latencia es fallo: ventana deslizante con tasa de llamadas lentas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La corrección es contar dos cosas en vez de una. Cada llamada registra si falló y si fue lenta, comparando su duración con un límite definido a partir de la latencia sana de la dependencia. El circuito se abre cuando la tasa de error o la tasa de llamadas lentas supera el umbral dentro de una ventana deslizante con las últimas N llamadas, siempre que la ventana tenga un mínimo de muestras para no decidir a partir de dos peticiones. Es el mismo modelo que bibliotecas maduras como Resilience4j adoptan con el nombre de slow call rate, y cabe en unas pocas decenas de líneas cuando el objetivo es entender qué está pasando.',
        },
        { type: 'code', value: breakerCode },
        {
          type: 'paragraph',
          value:
            'Tres decisiones del código merecen atención. La primera es que el timeout vive dentro del breaker y aborta la llamada mediante el AbortSignal, de modo que la espera tiene techo incluso cuando la dependencia nunca responde. La segunda es que la duración se mide también para los errores: un timeout de dos segundos cuenta como error y como llamada lenta al mismo tiempo. La tercera es que, en el estado abierto, los resultados de llamadas que todavía estaban en vuelo se ignoran, para que una llamada tardía no extienda el tiempo de apertura ni cierre el circuito por su cuenta.',
        },
        {
          type: 'table',
          columns: ['Parámetro', 'Cómo definirlo', 'Error común'],
          rows: [
            [
              'limiteLentaMs',
              'Dos o tres veces el p99 de la dependencia sana, medido en producción',
              'Copiar el valor del timeout; a esa altura la llamada ya lo ocupó todo',
            ],
            [
              'timeoutMs',
              'Lo máximo que el llamador acepta esperar por una única respuesta',
              'Dejarlo sin timeout y confiar solo en el breaker',
            ],
            [
              'janela y minimoChamadas',
              'Lo bastante grandes para absorber un pico aislado de latencia',
              'Ventana de 5 llamadas que se abre y se cierra con cada ráfaga',
            ],
            [
              'taxaLentaAbrir',
              '50% es un punto de partida; dependencias críticas pueden usar menos',
              'Exigir 100% y nunca abrirse con una dependencia medio lenta',
            ],
            [
              'tempoAbertoMs',
              'Tiempo suficiente para que la dependencia se recupere, con jitter entre instancias',
              'El mismo valor en todas las réplicas, que sondean en el mismo instante',
            ],
          ],
        },
      ],
    },
    {
      title: 'Bulkhead: limitar lo que está en vuelo para que la lentitud no lo ocupe todo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El breaker con tasa de llamadas lentas resuelve la ceguera, pero todavía necesita muestras para decidir. Entre que la dependencia se vuelve lenta y la ventana se llena, las llamadas en vuelo siguen ocupando recursos, y con un pico de tráfico pueden agotar el pool antes de que el circuito se abra. El bulkhead cierra esa brecha: limita cuántas llamadas a esa dependencia pueden estar en curso al mismo tiempo y rechaza de inmediato lo que supere ese límite. A diferencia del breaker, no necesita historial; la saturación actual es la evidencia.',
        },
        { type: 'code', value: bulkheadCode },
        {
          type: 'paragraph',
          value:
            'El orden de la composición importa. El bulkhead queda por fuera y el breaker por dentro: un rechazo del breaker dura microsegundos y casi no ocupa el bulkhead, mientras que un rechazo del bulkhead nunca llega al breaker y por eso no contamina la ventana con un error que no dice nada sobre la dependencia. El límite de llamadas en vuelo debe ser menor que el pool de conexiones del llamador, para que una sola dependencia lenta nunca pueda ocupar todo el pool y arrastrar con ella las llamadas a dependencias sanas.',
        },
      ],
    },
    {
      title: 'Semiabierto: sondear sin soltar la ola represada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando termina el tiempo de apertura, el circuito no debe simplemente cerrarse. Pasa a semiabierto y deja que un número pequeño de llamadas reales sirvan de sonda. Si las sondas vuelven rápido y sin error, se cierra. Si una de ellas falla o tarda, se abre de nuevo y reinicia el reloj. El punto crítico es que, durante el sondeo, todas las demás llamadas siguen recibiendo el rechazo rápido. Sin ese límite, el instante en que el circuito se reabre descarga sobre la dependencia todo el tráfico represado, y una dependencia que estaba casi recuperada vuelve a ponerse lenta.',
        },
        {
          type: 'list',
          items: [
            'Sondas con el mismo criterio de lentitud: una sonda que responde 200 en tres segundos es una sonda que falló.',
            'Jitter en el tiempo de apertura: con diez réplicas usando exactamente 10 s, todas sondean en el mismo segundo y las sondas sumadas se convierten en un pico.',
            'Fallback explícito mientras el circuito está abierto: devolver el precio en caché, ocultar la sección o encolar para después, pero nunca esperar.',
            'Registro de cada transición de estado con su motivo, porque la pregunta del postmortem es siempre por qué se abrió a las 14:07.',
          ],
        },
      ],
    },
    {
      title: 'Qué medir para saber que el circuito está haciendo su trabajo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un breaker que nunca se abre y un breaker que nunca necesitó abrirse tienen la misma gráfica hasta que llega la lentitud. Para distinguirlos antes del incidente, las métricas tienen que exponer lo que el breaker está viendo, no solo el estado en el que está.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Granularidad', 'Alerta sugerida'],
          rows: [
            [
              'Tasa de llamadas lentas en la ventana',
              'Por dependencia y operación',
              'Por encima de la mitad del umbral de apertura durante más de un minuto',
            ],
            [
              'Llamadas en vuelo y rechazos del bulkhead',
              'Por dependencia',
              'Cualquier rechazo fuera de la hora pico',
            ],
            [
              'Transiciones de estado del circuito',
              'Por dependencia e instancia',
              'Más de tres aperturas en diez minutos indica oscilación',
            ],
            [
              'Tiempo acumulado en estado abierto',
              'Por dependencia',
              'Abierto más tiempo del que permite el SLO de la funcionalidad dependiente',
            ],
            [
              'Latencia de la dependencia en p50 y p99',
              'Por operación',
              'p99 por encima del límite de llamada lenta configurado',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila es la que mantiene honesta la configuración. Si el p99 sano de la dependencia sube a lo largo de los meses y nadie revisa el límite, el breaker empieza a abrirse en días normales, alguien sube el umbral para silenciar la alerta, y el servicio vuelve a quedarse ciego.',
        },
      ],
    },
    {
      title: 'Cómo demostrar que se abre ante una dependencia que solo tarda',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La prueba que importa no es la de la dependencia que se cae; esa casi siempre pasa. Es la de la dependencia que responde éxito despacio. Con el reloj inyectado en el breaker, se puede simular latencia sin esperar de verdad: cada llamada falsa avanza el reloj 800 ms y devuelve éxito. Después de diez llamadas, la ventana está llena de llamadas lentas sin ningún error, y la undécima tiene que ser rechazada sin ejecutarse.',
        },
        { type: 'code', value: testeCode },
        {
          type: 'paragraph',
          value:
            'Conviene completar con dos escenarios: una llamada lenta aislada en medio de llamadas rápidas no debe abrir el circuito, y un timeout real, con la dependencia que nunca responde, debe abortarse mediante la señal y contarse como error. Estas pruebas corren en milisegundos y son la única garantía de que la configuración mide lo que el incidente va a ejercitar.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿El timeout en el cliente no resuelve el mismo problema?',
      answer:
        'Resuelve una parte. El timeout garantiza que ninguna llamada espere para siempre, pero cada llamada sigue ocupando la conexión durante todo el plazo antes de convertirse en error, y el breaker por error necesita muchas de ellas para abrirse. Con una latencia apenas por debajo del timeout, ninguna vence y el circuito permanece cerrado mientras el pool se agota. El timeout es el techo; la tasa de llamadas lentas es la señal que permite abrirse antes de alcanzar el techo.',
    },
    {
      question: '¿Qué límite de llamada lenta usar cuando la dependencia tiene latencia variable?',
      answer:
        'Partir del p99 medido en producción en un período sano, multiplicado por dos o tres, y revisarlo junto con el SLO de la funcionalidad. Si la dependencia tiene operaciones con latencias muy distintas, como una búsqueda simple y un informe pesado, usar un breaker por operación, no uno por host. Un único límite para todo o se abre en días normales por culpa de la operación pesada, o nunca se abre por culpa de la ligera.',
    },
    {
      question: '¿El bulkhead no vuelve innecesario al breaker?',
      answer:
        'No, cubren fallos distintos. El bulkhead reacciona a la saturación actual e impide que una dependencia lenta ocupe todo el pool, pero sigue enviándole llamadas hasta el límite, cada una esperando todo el tiempo. El breaker usa el historial para dejar de llamar cuando la evidencia muestra que no vale la pena, y devuelve el rechazo en microsegundos. Juntos, uno protege los recursos del llamador y el otro protege el tiempo del usuario.',
    },
  ],
  conclusion: {
    title: 'Un breaker que solo cuenta errores protege contra el fallo que menos ocurre',
    description:
      'La dependencia que tumba un servicio en producción suele estar viva y lenta, no muerta. Para que el circuito se abra en ese caso, la latencia tiene que contar como fallo, la ventana tiene que tener muestras suficientes para decidir, un bulkhead tiene que limitar lo que está en vuelo mientras la ventana se llena, y el estado semiabierto tiene que sondear sin soltar la ola represada. Sin la prueba de la dependencia lenta, la configuración sigue siendo una suposición.',
    cta: 'Revisar los circuit breakers de mi servicio',
  },
  related: [
    {
      label: 'Timeouts en cascada entre servicios: cuando la espera de uno se convierte en la cola del otro',
      to: '/blog/timeout-em-cascata-entre-servicos-quando-o-tempo-de-espera-de-um-vira-a-fila-do-outro',
    },
    {
      label: 'Límite de conexiones de la base de datos agotado: cuando el pool se vuelve el cuello de botella del servicio',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Servicio de observabilidad y confiabilidad',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
