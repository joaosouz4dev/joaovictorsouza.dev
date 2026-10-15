// Conteudo do artigo: cache stampede. Por que a expiracao da chave mais quente produz
// centenas de consultas identicas ao banco no mesmo instante, por que o jitter sozinho nao
// resolve uma chave unica, como single-flight no processo e lock no Redis reduzem a carga
// a uma recomputacao, como TTL logico com folga fisica permite servir o valor velho enquanto
// recalcula, como a expiracao antecipada probabilistica (XFetch) renova antes do vencimento,
// como sobreviver ao cache frio depois de restart ou deploy e como provar tudo em teste.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const versaoComProblemaCode = `// vitrine.js (versao com problema)
export async function obterVitrine({ redis, carregarVitrine }) {
  const emCache = await redis.get('vitrine:home');
  if (emCache) return JSON.parse(emCache);

  // 400 ms de consulta: toda requisicao que chegar nessa janela tambem erra o cache
  const vitrine = await carregarVitrine();
  await redis.set('vitrine:home', JSON.stringify(vitrine), 'EX', 60);
  return vitrine;
}`;

const singleFlightCode = `// single-flight.js
export function criarSingleFlight() {
  const emVoo = new Map();

  return function executar(chave, carregar) {
    const existente = emVoo.get(chave);
    if (existente) return existente;

    // Promise.resolve().then garante que carregar so roda depois do set,
    // mesmo que lance erro de forma sincrona.
    const promessa = Promise.resolve()
      .then(carregar)
      .finally(() => emVoo.delete(chave));
    emVoo.set(chave, promessa);
    return promessa;
  };
}`;

const cacheProtegidoCode = `// cache-protegido.js
import { randomUUID } from 'node:crypto';
import { criarSingleFlight } from './single-flight.js';

// Apaga o lock somente se ele ainda pertence a quem o criou.
const LIBERAR_LOCK = \`
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0\`;

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function criarCacheProtegido({
  redis, // cliente ioredis
  ttlLogicoMs, // depois disso o valor esta velho, mas ainda pode ser servido
  folgaFisicaMs, // quanto tempo o valor velho continua existindo no Redis
  lockMs = 5_000, // maior que o p99 da recomputacao
  esperaMaxMs = 1_000,
  metricas,
}) {
  const singleFlight = criarSingleFlight();

  async function ler(chave) {
    const bruto = await redis.get(chave);
    return bruto ? JSON.parse(bruto) : null; // { valor, venceEm, custoMs }
  }

  async function recomputar(chave, carregar) {
    const token = randomUUID();
    const obteve = await redis.set(\`lock:\${chave}\`, token, 'PX', lockMs, 'NX');
    if (obteve !== 'OK') return null; // outra instancia ja esta recomputando

    try {
      const inicio = Date.now();
      const valor = await carregar();
      const custoMs = Date.now() - inicio;
      const entrada = { valor, venceEm: Date.now() + ttlLogicoMs, custoMs };
      await redis.set(chave, JSON.stringify(entrada), 'PX', ttlLogicoMs + folgaFisicaMs);
      metricas?.recomputacao(chave, custoMs);
      return entrada;
    } finally {
      await redis.eval(LIBERAR_LOCK, 1, \`lock:\${chave}\`, token);
    }
  }

  async function aguardarOutraInstancia(chave) {
    const limite = Date.now() + esperaMaxMs;
    while (Date.now() < limite) {
      await esperar(50);
      const entrada = await ler(chave);
      if (entrada && entrada.venceEm > Date.now()) return entrada;
    }
    return null;
  }

  return async function obter(chave, carregar) {
    const entrada = await ler(chave);

    if (entrada && entrada.venceEm > Date.now()) return entrada.valor; // fresco

    if (entrada) {
      // velho, mas presente: serve agora e recomputa em segundo plano, uma vez so
      metricas?.velhoServido(chave);
      singleFlight(\`revalidar:\${chave}\`, () => recomputar(chave, carregar)).catch((erro) =>
        metricas?.falhaRecomputacao(chave, erro),
      );
      return entrada.valor;
    }

    // ausente: nao ha o que servir, alguem precisa esperar
    return singleFlight(\`carregar:\${chave}\`, async () => {
      const recomputada = await recomputar(chave, carregar);
      if (recomputada) return recomputada.valor;

      const daOutra = await aguardarOutraInstancia(chave);
      if (daOutra) return daOutra.valor;

      // ultimo recurso: no maximo uma carga por instancia, nunca uma por requisicao
      metricas?.esperaEsgotada(chave);
      return carregar();
    });
  };
}`;

const expiracaoAntecipadaCode = `// expiracao-antecipada.js
// XFetch (Vattani, Chierichetti e Lowenstein, 2015): quanto mais perto do vencimento
// e quanto mais cara a recomputacao, maior a chance de uma requisicao recomputar antes.
export function deveRecomputarAntes(
  entrada,
  { beta = 1, agora = Date.now(), aleatorio = Math.random } = {},
) {
  // 1 - aleatorio() fica em (0, 1], entao o logaritmo nunca vira -Infinity
  const antecipacaoMs = -entrada.custoMs * beta * Math.log(1 - aleatorio());
  return agora + antecipacaoMs >= entrada.venceEm;
}

// cache-protegido.js: o ramo "fresco" de obter() passa a ser este
if (entrada && entrada.venceEm > Date.now()) {
  if (deveRecomputarAntes(entrada)) {
    singleFlight(\`revalidar:\${chave}\`, () => recomputar(chave, carregar)).catch((erro) =>
      metricas?.falhaRecomputacao(chave, erro),
    );
  }
  return entrada.valor; // fresco, e talvez ja sendo renovado
}`;

const limitadorCode = `// limitador.js: no maximo N recomputacoes simultaneas por instancia
export function criarLimitador(maximo) {
  let ativos = 0;
  const fila = [];

  const liberar = () => {
    const proximo = fila.shift();
    if (proximo) proximo(); // passa a vaga direto para quem espera
    else ativos -= 1;
  };

  return async function limitar(fn) {
    if (ativos < maximo) ativos += 1;
    else await new Promise((resolve) => fila.push(resolve));

    try {
      return await fn();
    } finally {
      liberar();
    }
  };
}

// uso em cache-protegido.js, dentro de recomputar():
//   const valor = await limitarRecomputacao(() => carregar());
// com limitarRecomputacao = criarLimitador(4), criado uma vez por instancia`;

const testeCode = `// cache-protegido.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarCacheProtegido } from './cache-protegido.js';

// Redis em memoria com o subconjunto usado pelo cache: GET, SET PX [NX] e o script de liberacao.
function criarRedisFalso() {
  const dados = new Map();
  const vivo = (chave) => {
    const item = dados.get(chave);
    if (item && item.expiraEm <= Date.now()) dados.delete(chave);
    return dados.get(chave);
  };
  return {
    async get(chave) {
      return vivo(chave)?.valor ?? null;
    },
    async set(chave, valor, _px, ms, nx) {
      if (nx === 'NX' && vivo(chave)) return null;
      dados.set(chave, { valor, expiraEm: Date.now() + ms });
      return 'OK';
    },
    async eval(_script, _numChaves, chave, token) {
      if (vivo(chave)?.valor !== token) return 0;
      dados.delete(chave);
      return 1;
    },
  };
}

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('mil leituras simultaneas de uma chave ausente consultam o banco uma vez', async () => {
  const redis = criarRedisFalso();
  let consultas = 0;
  const carregar = async () => {
    consultas += 1;
    await esperar(100);
    return { produtos: 42 };
  };
  // duas instancias do servico compartilhando o mesmo Redis
  const instancias = [1, 2].map(() =>
    criarCacheProtegido({ redis, ttlLogicoMs: 60_000, folgaFisicaMs: 30_000 }),
  );

  const resultados = await Promise.all(
    Array.from({ length: 1000 }, (_, i) => instancias[i % 2]('vitrine:home', carregar)),
  );

  assert.equal(consultas, 1);
  assert.ok(resultados.every((r) => r.produtos === 42));
});

test('valor velho e servido na hora e recomputado uma vez so', async () => {
  const redis = criarRedisFalso();
  let consultas = 0;
  const carregar = async () => {
    consultas += 1;
    await esperar(100);
    return consultas;
  };
  const cache = criarCacheProtegido({ redis, ttlLogicoMs: 50, folgaFisicaMs: 10_000 });

  assert.equal(await cache('vitrine:home', carregar), 1);
  await esperar(60); // passa do TTL logico, mas a entrada continua no Redis

  const inicio = Date.now();
  const resultados = await Promise.all(
    Array.from({ length: 500 }, () => cache('vitrine:home', carregar)),
  );
  assert.ok(Date.now() - inicio < 50, 'nenhuma requisicao esperou a recomputacao');
  assert.ok(resultados.every((r) => r === 1));

  await esperar(150); // a recomputacao em segundo plano termina
  assert.equal(consultas, 2);
});`;

const diagramaPt = `Vitrine da home: 2.000 req/s, consulta de 400 ms, TTL de 60 s, pool de 20 conexões.

t = 60,000 s   vitrine:home expira no Redis
t = 60,001 s   req 1 erra o cache -> consulta ao banco (400 ms em condição normal)
t = 60,002 s   req 2, 3, 4 erram o cache -> mais 3 consultas idênticas
   ...         2.000 req/s x 0,4 s = ~800 consultas idênticas em voo
t = 60,010 s   pool de 20 conexões esgotado, o resto espera na fila do pool
t = 60,400 s   a consulta passa a levar 3 s por disputa de CPU e I/O
               -> a janela sem cache cresce de 0,4 s para 3 s
               -> ~6.000 consultas idênticas, timeouts e retries do cliente
t = 63,000 s   a primeira consulta termina e grava o cache
               o banco ainda leva segundos para drenar o que ficou na fila

Misses simultâneos = taxa de requisições x tempo de recomputação.
O tempo de recomputação cresce com a própria carga: realimentação positiva.`;

const diagramaEn = `Home page showcase: 2,000 req/s, 400 ms query, 60 s TTL, pool of 20 connections.

t = 60.000 s   vitrine:home expires in Redis
t = 60.001 s   req 1 misses the cache -> query to the database (400 ms under normal load)
t = 60.002 s   req 2, 3, 4 miss the cache -> 3 more identical queries
   ...         2,000 req/s x 0.4 s = ~800 identical queries in flight
t = 60.010 s   pool of 20 connections exhausted, the rest waits in the pool queue
t = 60.400 s   the query now takes 3 s due to CPU and I/O contention
               -> the uncached window grows from 0.4 s to 3 s
               -> ~6,000 identical queries, timeouts and client retries
t = 63.000 s   the first query finishes and writes the cache
               the database still needs seconds to drain what piled up

Concurrent misses = request rate x recomputation time.
Recomputation time grows with the load itself: positive feedback.`;

const diagramaEs = `Escaparate de la home: 2.000 req/s, consulta de 400 ms, TTL de 60 s, pool de 20 conexiones.

t = 60,000 s   vitrine:home expira en Redis
t = 60,001 s   req 1 falla en la caché -> consulta a la base (400 ms en condiciones normales)
t = 60,002 s   req 2, 3, 4 fallan en la caché -> 3 consultas idénticas más
   ...         2.000 req/s x 0,4 s = ~800 consultas idénticas en vuelo
t = 60,010 s   pool de 20 conexiones agotado, el resto espera en la cola del pool
t = 60,400 s   la consulta pasa a tardar 3 s por contención de CPU e I/O
               -> la ventana sin caché crece de 0,4 s a 3 s
               -> ~6.000 consultas idénticas, timeouts y reintentos del cliente
t = 63,000 s   la primera consulta termina y escribe la caché
               la base todavía tarda segundos en drenar lo que quedó en cola

Fallos simultáneos = tasa de peticiones x tiempo de recálculo.
El tiempo de recálculo crece con la propia carga: realimentación positiva.`;

const pt = {
  intro:
    'O cache estava funcionando: 99,8% de acerto, banco folgado, latência baixa. Então, a cada sessenta segundos, o gráfico de CPU do banco mostrava um pico estreito e alto, e uma vez por dia, no horário de maior tráfego, esse pico virava um incidente de três minutos com timeouts em cascata. Nenhuma consulta nova, nenhum deploy, nenhum bug no código do cache. Era a chave mais quente do sistema expirando, e todas as requisições que chegaram nos 400 ms seguintes descobrindo, ao mesmo tempo, que precisavam ir ao banco. Este artigo mostra a conta que explica por que isso acontece, por que o jitter não resolve uma chave única, como single-flight no processo e lock no Redis reduzem centenas de consultas a uma, como servir o valor velho enquanto a recomputação acontece, como a expiração antecipada probabilística renova a chave antes do vencimento, como sobreviver ao cache frio depois de um restart e como provar em teste que mil leituras simultâneas viram uma consulta.',
  sections: [
    {
      title: 'Anatomia do stampede: o que acontece no milissegundo em que a chave expira',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O padrão mais comum de cache é o cache-aside: lê do Redis, e se não estiver lá, consulta o banco e grava o resultado com TTL. O código abaixo é exatamente isso, e ele está correto para qualquer chave com pouco tráfego. O problema aparece quando a mesma chave recebe milhares de leituras por segundo e a consulta que a produz não é trivial, como a vitrine da página inicial de um e-commerce, que agrega estoque, preço promocional e ranking de vendas.',
        },
        {
          type: 'code',
          value: versaoComProblemaCode,
        },
        {
          type: 'paragraph',
          value:
            'Entre o instante em que a chave expira e o instante em que a primeira requisição grava o novo valor, todas as outras requisições também erram o cache e também consultam o banco. A quantidade de consultas idênticas em voo é simples de calcular: taxa de requisições vezes tempo de recomputação. Com 2.000 requisições por segundo e uma consulta de 400 ms, são cerca de 800 consultas iguais disparadas em menos de meio segundo, contra um pool de 20 conexões.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que transforma um pico em incidente é a realimentação. As 800 consultas disputam CPU, buffer e locks no banco, então cada uma demora mais; como cada uma demora mais, a janela sem cache se alonga; como a janela se alonga, mais requisições erram o cache. Uma consulta de 400 ms vira uma de 3 s, e 800 consultas viram 6.000. O banco que suportava a carga normal com folga cai por uma consulta que ele já tinha respondido um minuto antes, e os retries dos clientes empurram o sistema para o mesmo lugar depois que o cache volta.',
        },
      ],
    },
    {
      title: 'Por que o jitter sozinho não resolve, e o que cada técnica realmente cobre',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira recomendação que aparece é adicionar jitter ao TTL: em vez de 60 s fixos, algo entre 54 s e 66 s. Isso é correto e necessário, mas resolve outro problema. O jitter espalha a expiração de chaves diferentes que foram gravadas juntas, como as dez mil páginas de produto populadas pelo mesmo job. Uma chave única continua tendo um único instante de expiração, com ou sem sorteio, e todas as requisições daquela chave continuam chegando juntas nele.',
        },
        {
          type: 'paragraph',
          value:
            'O stampede de uma chave quente tem três partes, e cada técnica ataca uma delas: quantas requisições recomputam ao mesmo tempo, o que as outras fazem enquanto esperam e quando a recomputação acontece. Nenhuma técnica sozinha cobre as três, e por isso a solução em produção costuma ser uma combinação pequena e não uma biblioteca.',
        },
        {
          type: 'table',
          columns: ['Técnica', 'O que resolve', 'O que não resolve', 'Custo'],
          rows: [
            ['Jitter no TTL', 'Muitas chaves expirando juntas', 'Uma única chave quente', 'Quase nenhum'],
            ['Single-flight no processo', 'Requisições repetidas dentro de uma instância', 'N instâncias recomputando ao mesmo tempo', 'Um Map de promessas'],
            ['Lock no Redis', 'Recomputação duplicada entre instâncias', 'O que os perdedores fazem enquanto esperam', 'Uma ida extra ao Redis e um TTL de lock bem escolhido'],
            ['TTL lógico com folga física', 'Espera dos perdedores: servem o valor velho', 'Chave ausente, que não tem valor velho', 'Dado até um TTL lógico mais velho'],
            ['Expiração antecipada (XFetch)', 'Renova antes de a chave vencer', 'Chave fria, que nunca é antecipada', 'Recomputações ligeiramente mais frequentes'],
            ['Aquecimento e limitador', 'Cache inteiro vazio depois de restart ou deploy', 'Chave quente isolada no dia a dia', 'Tempo de subida maior'],
          ],
        },
      ],
    },
    {
      title: 'Single-flight: uma instância, uma recomputação por chave',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O primeiro passo é barato e elimina a maior parte do problema: dentro de um mesmo processo, a primeira requisição que erra o cache cria a promessa da recomputação, e todas as outras que chegam enquanto ela está em voo recebem a mesma promessa. Em Go, isso é o pacote singleflight; em Node.js, cabe em quinze linhas.',
        },
        {
          type: 'code',
          value: singleFlightCode,
        },
        {
          type: 'list',
          items: [
            'A remoção no finally é obrigatória: sem ela, um erro fica guardado para sempre e a chave nunca mais é recomputada naquela instância.',
            'O Promise.resolve().then existe por um motivo concreto: se carregar lançasse erro de forma síncrona dentro de uma função async, o finally rodaria antes do set, e a promessa rejeitada ficaria presa no Map.',
            'Todos os que compartilham a promessa recebem o mesmo erro. Isso é desejável: 800 requisições falhando juntas por uma consulta é melhor que 800 consultas falhando juntas.',
            'Os chamadores recebem o mesmo objeto. Se algum deles mutar o resultado, todos veem a mutação; trate o valor retornado como imutável.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Com single-flight, 800 consultas por instância viram uma consulta por instância. Numa frota de 40 réplicas, isso ainda são 40 consultas idênticas no mesmo meio segundo, o que muitas vezes já é aceitável. Quando não é, porque a consulta é pesada ou a frota é grande, a coordenação precisa sair do processo.',
        },
      ],
    },
    {
      title: 'Lock no Redis e TTL lógico: uma recomputação na frota e ninguém esperando',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Coordenar entre instâncias resolve quem recomputa, mas cria a pergunta que costuma ser esquecida: o que as outras requisições fazem enquanto isso. Se elas esperam, o lock só transferiu a fila do banco para o Redis. A saída é separar duas validades: o TTL lógico, gravado dentro do valor, diz quando ele fica velho; o TTL físico do Redis é maior, com uma folga, e mantém o valor velho disponível. Quem encontra o valor velho serve na hora e dispara uma revalidação em segundo plano; só quem encontra a chave ausente precisa esperar.',
        },
        {
          type: 'code',
          value: cacheProtegidoCode,
        },
        {
          type: 'ordered',
          items: [
            'O lock é um SET NX PX com um token aleatório, e a liberação é um script Lua que só apaga a chave se o token ainda for o seu. Sem essa comparação, uma instância lenta, cujo lock já expirou, apagaria o lock de outra instância que o pegou depois.',
            'O lockMs precisa ser maior que o p99 da recomputação. Se for menor, o lock expira no meio da consulta, outra instância o pega e o stampede volta em câmera lenta.',
            'O custo medido da recomputação é gravado junto com o valor. Ele serve para a expiração antecipada da próxima seção e para uma métrica que avisa quando a consulta está ficando mais cara.',
            'Com a chave ausente, quem perde o lock consulta o Redis a cada 50 ms até um limite. Se o limite estoura, carrega sozinho: no máximo uma carga por instância, graças ao single-flight, e nunca uma por requisição.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A folga física também vira proteção contra falha do banco. Se a recomputação falhar, o valor velho continua sendo servido até a folga acabar, e a próxima requisição tenta de novo. Uma vitrine com dois minutos de atraso é um problema de negócio pequeno; uma vitrine que retorna erro é um problema grande. Para dados em que valor velho não é aceitável, como saldo, a chave simplesmente não deve usar esse caminho, e o próprio cache talvez não seja o lugar certo para ela.',
        },
      ],
    },
    {
      title: 'Expiração antecipada probabilística: renovar antes de vencer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo servindo o valor velho, a chave passa algum tempo velha depois de cada vencimento. A técnica conhecida como XFetch, publicada por Vattani, Chierichetti e Lowenstein, faz com que cada leitura decida, com uma probabilidade que cresce perto do vencimento, recomputar antes da hora. A probabilidade depende do custo da recomputação: chaves caras começam a ser renovadas mais cedo.',
        },
        {
          type: 'code',
          value: expiracaoAntecipadaCode,
        },
        {
          type: 'paragraph',
          value:
            'A conta mostra por que isso funciona sem coordenação. Com custo de 400 ms e beta 1, a chance de uma leitura antecipar quando faltam t milissegundos é e elevado a menos t sobre 400. Com 2.000 leituras por segundo, a primeira antecipação acontece, em média, cerca de 2,9 segundos antes do vencimento, e a chave praticamente nunca chega a ficar velha. Com uma leitura por segundo, a chance acumulada é tão baixa que a chave expira normalmente, e isso está certo: uma chave com pouco tráfego não tem stampede para evitar.',
        },
        {
          type: 'list',
          items: [
            'Beta maior que 1 antecipa mais cedo e recomputa com mais frequência; beta menor que 1 faz o contrário. Comece com 1 e ajuste só com métrica.',
            'Várias leituras podem decidir antecipar quase ao mesmo tempo. O single-flight e o lock da seção anterior continuam sendo a rede de segurança que garante uma recomputação.',
            'O custo gravado no valor precisa ser o custo real medido, não uma constante. Se a consulta ficar lenta, a antecipação se ajusta sozinha.',
          ],
        },
      ],
    },
    {
      title: 'Cache frio: quando todas as chaves somem ao mesmo tempo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe uma versão do stampede que nenhuma das técnicas anteriores resolve sozinha: o cache inteiro vazio. Acontece quando o Redis reinicia sem persistência, quando um failover promove uma réplica atrasada, quando um flush é rodado no ambiente errado ou quando um deploy muda o prefixo das chaves de v1 para v2. Nesse momento, não existe valor velho para servir em chave nenhuma, e o single-flight por chave não limita nada, porque são milhares de chaves diferentes.',
        },
        {
          type: 'list',
          items: [
            'Limite a concorrência de recomputação por instância, independentemente da chave. Quatro recomputações simultâneas por réplica numa frota de 40 são 160 consultas no banco, um número que dá para dimensionar; sem limite, são milhares.',
            'Aqueça as chaves mais lidas antes de a instância entrar no balanceador. A lista vem da própria métrica de acessos por chave, e cem chaves costumam cobrir a maior parte do tráfego.',
            'Ao mudar o formato da chave, leia a versão nova e, se ela não existir, a antiga, convertendo na leitura. O prefixo novo é populado aos poucos pelo tráfego, e não de uma vez pela ausência.',
            'Aplique jitter no TTL físico de tudo que é gravado em lote. Aqui o jitter é exatamente a ferramenta certa.',
            'Guarde também a ausência. Uma chave de produto inexistente consultada em loop vai ao banco toda vez; um marcador de "não existe" com TTL curto resolve.',
          ],
        },
        {
          type: 'code',
          value: limitadorCode,
        },
        {
          type: 'paragraph',
          value:
            'O limitador passa a vaga diretamente para quem está na fila, sem devolver ao contador. Parece um detalhe, mas a versão ingênua que decrementa e deixa o próximo incrementar permite que uma requisição nova passe na frente entre as duas operações e ultrapasse o máximo justamente no pico, que é o único momento em que o limite importa.',
        },
      ],
    },
    {
      title: 'Como provar em teste e enxergar em produção',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A propriedade que importa é verificável: para N leituras simultâneas de uma chave ausente, o carregador roda uma vez; para N leituras de uma chave velha, nenhuma requisição espera e o carregador roda uma vez em segundo plano. O teste abaixo usa um Redis em memória com o subconjunto de comandos do cache e duas instâncias compartilhando o mesmo Redis, para cobrir o lock e não só o single-flight.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'paragraph',
          value:
            'Em produção, a taxa de acerto não mostra o problema, porque um stampede de meio segundo mal altera a média do minuto. As métricas que mostram são outras, e todas por chave ou pelo menos pelas chaves mais quentes.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'O que indica', 'Sinal de alerta'],
          rows: [
            ['Recomputações por chave por janela de TTL', 'Se a coordenação funciona', 'Mais de uma por TTL lógico numa chave quente'],
            ['Valor velho servido por segundo', 'Quanto tráfego depende da folga física', 'Crescimento contínuo: a recomputação está falhando'],
            ['Esperas esgotadas', 'Quantas instâncias caíram no último recurso', 'Qualquer valor diferente de zero recorrente'],
            ['Custo da recomputação (p99)', 'Se a consulta está ficando mais cara', 'p99 se aproximando do lockMs'],
            ['Idade do valor servido', 'Quanto o usuário está vendo de atraso', 'Idade acima do TTL lógico mais a folga planejada'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O teste de carga também precisa de um cenário específico: expirar a chave mais quente no meio do pico, de propósito, e medir conexões ativas no banco nos dois segundos seguintes. Um teste de carga que só mede a vazão em regime constante passa sem encontrar o stampede, porque o cache já está quente desde o primeiro minuto.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Lock com Redis em um nó só não é inseguro? E o debate sobre o Redlock?',
      answer:
        'O debate é sobre exclusão mútua usada para correção, como garantir que duas instâncias nunca escrevam o mesmo registro. Aqui o lock é uma otimização: se ele falhar e duas instâncias recomputarem juntas, o custo é uma consulta a mais, e o valor gravado é o mesmo. Para esse uso, um SET NX PX com token num único Redis é suficiente. Se o seu lock protege correção, ele precisa de fencing token na escrita, e o problema deixa de ser de cache.',
    },
    {
      question: 'Como escolher o TTL lógico e a folga física?',
      answer:
        'O TTL lógico vem do negócio: quanto tempo um dado pode ficar desatualizado sem causar dano. A folga física vem da operação: precisa cobrir pelo menos o p99 da recomputação com margem e, se você quer que o cache segure o tráfego durante uma falha do banco, o tempo que você aceita servir dado velho nesse cenário. Uma vitrine com TTL lógico de 60 s e folga de 5 minutos é um ponto de partida comum. Se nenhum atraso é aceitável, a chave não deve servir valor velho.',
    },
    {
      question: 'Quando não vale a pena proteger uma chave contra stampede?',
      answer:
        'Quando a taxa de requisições vezes o tempo de recomputação fica perto de 1. Uma chave lida 5 vezes por segundo com consulta de 20 ms tem, em média, 0,1 miss simultâneo: não existe stampede. Uma chave lida 2.000 vezes por segundo com consulta de 400 ms tem 800. O single-flight é barato o bastante para usar em tudo; lock, folga física e XFetch fazem sentido para as poucas chaves em que essa conta passa de algumas unidades.',
    },
  ],
  conclusion: {
    title: 'O cache protege o banco até o instante em que expira',
    description:
      'Stampede não é falta de cache, é a expiração do cache acontecendo para todo mundo ao mesmo tempo. A conta que o explica é taxa vezes tempo de recomputação, e a solução é reduzir cada fator: single-flight e lock para que só uma requisição recompute, TTL lógico com folga física para que ninguém espere por ela, expiração antecipada para que a chave quente raramente chegue a vencer, e limitador com aquecimento para o dia em que o cache inteiro some. Sem o teste das mil leituras simultâneas, a proteção é só uma suposição.',
    cta: 'Revisar a estratégia de cache do meu serviço',
  },
  related: [
    {
      label: 'Cache invalidado errado: quando o dado velho custa mais caro que a consulta',
      to: '/blog/cache-invalidado-errado-dado-velho-custa-mais-caro-que-consulta',
    },
    {
      label: 'Limite de conexões do banco esgotado: quando o pool vira o gargalo do serviço',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The cache was working: 99.8% hit rate, a relaxed database, low latency. Yet every sixty seconds the database CPU graph showed a narrow, tall spike, and once a day, at peak traffic, that spike turned into a three-minute incident with cascading timeouts. No new query, no deploy, no bug in the cache code. It was the hottest key in the system expiring, and every request that arrived in the next 400 ms discovering, at the same time, that it had to go to the database. This article shows the arithmetic that explains why this happens, why jitter does not fix a single key, how in-process single-flight and a Redis lock reduce hundreds of queries to one, how to serve the stale value while recomputation happens, how probabilistic early expiration renews the key before it expires, how to survive a cold cache after a restart, and how to prove in a test that a thousand concurrent reads become one query.',
  sections: [
    {
      title: 'Anatomy of a stampede: what happens in the millisecond the key expires',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common caching pattern is cache-aside: read from Redis, and if the value is not there, query the database and write the result with a TTL. The code below is exactly that, and it is correct for any key with little traffic. The problem shows up when the same key receives thousands of reads per second and the query that produces it is not trivial, like the showcase on the home page of an e-commerce site, which aggregates stock, promotional prices and sales ranking.',
        },
        {
          type: 'code',
          value: versaoComProblemaCode,
        },
        {
          type: 'paragraph',
          value:
            'Between the instant the key expires and the instant the first request writes the new value, every other request also misses the cache and also queries the database. The number of identical queries in flight is simple to calculate: request rate times recomputation time. With 2,000 requests per second and a 400 ms query, that is about 800 identical queries fired in less than half a second, against a pool of 20 connections.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'The detail that turns a spike into an incident is feedback. The 800 queries compete for CPU, buffers and locks in the database, so each one takes longer; because each one takes longer, the uncached window stretches; because the window stretches, more requests miss the cache. A 400 ms query becomes a 3 s query, and 800 queries become 6,000. The database that handled normal load comfortably falls over because of a query it had already answered a minute earlier, and client retries push the system back to the same place after the cache returns.',
        },
      ],
    },
    {
      title: 'Why jitter alone does not fix it, and what each technique actually covers',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first recommendation that shows up is adding jitter to the TTL: instead of a fixed 60 s, something between 54 s and 66 s. That is correct and necessary, but it solves a different problem. Jitter spreads the expiration of different keys that were written together, like the ten thousand product pages populated by the same job. A single key still has a single expiration instant, randomized or not, and all requests for that key still arrive together at that instant.',
        },
        {
          type: 'paragraph',
          value:
            'A hot key stampede has three parts, and each technique attacks one of them: how many requests recompute at the same time, what the others do while they wait, and when recomputation happens. No single technique covers all three, which is why the production solution is usually a small combination rather than a library.',
        },
        {
          type: 'table',
          columns: ['Technique', 'What it solves', 'What it does not solve', 'Cost'],
          rows: [
            ['TTL jitter', 'Many keys expiring together', 'A single hot key', 'Almost none'],
            ['In-process single-flight', 'Repeated requests within one instance', 'N instances recomputing at the same time', 'A Map of promises'],
            ['Redis lock', 'Duplicate recomputation across instances', 'What the losers do while they wait', 'One extra Redis round trip and a well chosen lock TTL'],
            ['Logical TTL with physical slack', 'Losers waiting: they serve the stale value', 'A missing key, which has no stale value', 'Data up to one logical TTL older'],
            ['Early expiration (XFetch)', 'Renews before the key expires', 'A cold key, which is never renewed early', 'Slightly more frequent recomputation'],
            ['Warm-up and limiter', 'Entire cache empty after a restart or deploy', 'An isolated hot key on a regular day', 'Longer startup time'],
          ],
        },
      ],
    },
    {
      title: 'Single-flight: one instance, one recomputation per key',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first step is cheap and removes most of the problem: within a single process, the first request that misses the cache creates the recomputation promise, and every other request that arrives while it is in flight receives the same promise. In Go, this is the singleflight package; in Node.js, it fits in fifteen lines.',
        },
        {
          type: 'code',
          value: singleFlightCode,
        },
        {
          type: 'list',
          items: [
            'The removal in finally is mandatory: without it, an error is kept forever and the key is never recomputed again on that instance.',
            'The Promise.resolve().then exists for a concrete reason: if carregar threw synchronously inside an async function, finally would run before the set, and the rejected promise would get stuck in the Map.',
            'Everyone sharing the promise receives the same error. That is desirable: 800 requests failing together because of one query is better than 800 queries failing together.',
            'Callers receive the same object. If one of them mutates the result, all of them see the mutation; treat the returned value as immutable.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'With single-flight, 800 queries per instance become one query per instance. In a fleet of 40 replicas, that is still 40 identical queries in the same half second, which is often acceptable already. When it is not, because the query is heavy or the fleet is large, coordination has to move out of the process.',
        },
      ],
    },
    {
      title: 'Redis lock and logical TTL: one recomputation across the fleet and nobody waiting',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Coordinating across instances settles who recomputes, but it raises the question that is usually forgotten: what the other requests do in the meantime. If they wait, the lock merely moved the queue from the database to Redis. The way out is to separate two validity periods: the logical TTL, stored inside the value, says when it becomes stale; the physical Redis TTL is longer, with some slack, and keeps the stale value available. Whoever finds the stale value serves it immediately and triggers a background revalidation; only whoever finds the key missing has to wait.',
        },
        {
          type: 'code',
          value: cacheProtegidoCode,
        },
        {
          type: 'ordered',
          items: [
            'The lock is a SET NX PX with a random token, and release is a Lua script that only deletes the key if the token is still yours. Without that comparison, a slow instance whose lock had already expired would delete the lock of another instance that acquired it afterwards.',
            'lockMs has to be greater than the p99 of recomputation. If it is smaller, the lock expires in the middle of the query, another instance takes it, and the stampede comes back in slow motion.',
            'The measured recomputation cost is stored with the value. It feeds the early expiration in the next section and a metric that warns when the query is getting more expensive.',
            'When the key is missing, whoever loses the lock polls Redis every 50 ms up to a limit. If the limit runs out, it loads on its own: at most one load per instance, thanks to single-flight, and never one per request.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The physical slack also becomes protection against database failure. If recomputation fails, the stale value keeps being served until the slack runs out, and the next request tries again. A showcase two minutes behind is a small business problem; a showcase that returns an error is a big one. For data where a stale value is not acceptable, like an account balance, the key simply should not use this path, and the cache itself may not be the right place for it.',
        },
      ],
    },
    {
      title: 'Probabilistic early expiration: renewing before it expires',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Even when serving the stale value, the key spends some time stale after each expiration. The technique known as XFetch, published by Vattani, Chierichetti and Lowenstein, makes each read decide, with a probability that grows close to expiration, to recompute ahead of time. The probability depends on the recomputation cost: expensive keys start being renewed earlier.',
        },
        {
          type: 'code',
          value: expiracaoAntecipadaCode,
        },
        {
          type: 'paragraph',
          value:
            'The arithmetic shows why this works without coordination. With a 400 ms cost and beta 1, the chance that a read renews early when t milliseconds remain is e to the power of minus t over 400. With 2,000 reads per second, the first early renewal happens, on average, about 2.9 seconds before expiration, and the key practically never becomes stale. With one read per second, the cumulative chance is so low that the key expires normally, and that is right: a key with little traffic has no stampede to avoid.',
        },
        {
          type: 'list',
          items: [
            'A beta greater than 1 renews earlier and recomputes more often; a beta below 1 does the opposite. Start with 1 and tune only with metrics.',
            'Several reads may decide to renew early at almost the same time. Single-flight and the lock from the previous section remain the safety net that guarantees one recomputation.',
            'The cost stored with the value has to be the real measured cost, not a constant. If the query gets slower, early renewal adjusts itself.',
          ],
        },
      ],
    },
    {
      title: 'Cold cache: when every key disappears at once',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There is a version of the stampede that none of the previous techniques solves on its own: the entire cache empty. It happens when Redis restarts without persistence, when a failover promotes a lagging replica, when a flush runs in the wrong environment, or when a deploy changes the key prefix from v1 to v2. At that moment there is no stale value to serve for any key, and per-key single-flight limits nothing, because there are thousands of different keys.',
        },
        {
          type: 'list',
          items: [
            'Limit recomputation concurrency per instance, regardless of the key. Four concurrent recomputations per replica in a fleet of 40 means 160 queries on the database, a number you can size for; without a limit, it means thousands.',
            'Warm up the most read keys before the instance joins the load balancer. The list comes from the per-key access metric itself, and a hundred keys usually cover most of the traffic.',
            'When changing the key format, read the new version and, if it does not exist, the old one, converting on read. The new prefix gets populated gradually by traffic, not all at once by absence.',
            'Apply jitter to the physical TTL of everything written in batches. Here jitter is exactly the right tool.',
            'Cache absence too. A nonexistent product key queried in a loop goes to the database every time; a "does not exist" marker with a short TTL fixes it.',
          ],
        },
        {
          type: 'code',
          value: limitadorCode,
        },
        {
          type: 'paragraph',
          value:
            'The limiter hands the slot directly to whoever is waiting in the queue, without returning it to the counter. It looks like a detail, but the naive version that decrements and lets the next one increment allows a new request to slip in between the two operations and exceed the maximum precisely at the peak, which is the only moment the limit matters.',
        },
      ],
    },
    {
      title: 'How to prove it in a test and see it in production',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The property that matters is verifiable: for N concurrent reads of a missing key, the loader runs once; for N reads of a stale key, no request waits and the loader runs once in the background. The test below uses an in-memory Redis with the subset of commands the cache needs and two instances sharing the same Redis, so that it covers the lock and not only single-flight.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'paragraph',
          value:
            'In production, the hit rate does not show the problem, because a half-second stampede barely moves the per-minute average. The metrics that do show it are different, and all of them are per key, or at least per hottest key.',
        },
        {
          type: 'table',
          columns: ['Metric', 'What it indicates', 'Warning sign'],
          rows: [
            ['Recomputations per key per TTL window', 'Whether coordination works', 'More than one per logical TTL on a hot key'],
            ['Stale values served per second', 'How much traffic depends on the physical slack', 'Continuous growth: recomputation is failing'],
            ['Exhausted waits', 'How many instances fell back to the last resort', 'Any recurring nonzero value'],
            ['Recomputation cost (p99)', 'Whether the query is getting more expensive', 'p99 approaching lockMs'],
            ['Age of the served value', 'How much delay the user is seeing', 'Age above the logical TTL plus the planned slack'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The load test also needs a specific scenario: expire the hottest key in the middle of the peak, on purpose, and measure active database connections over the next two seconds. A load test that only measures steady-state throughput passes without ever finding the stampede, because the cache is already warm from the first minute.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is a lock on a single Redis node not unsafe? What about the Redlock debate?',
      answer:
        'That debate is about mutual exclusion used for correctness, such as guaranteeing that two instances never write the same record. Here the lock is an optimization: if it fails and two instances recompute together, the cost is one extra query, and the value written is the same. For this use, a SET NX PX with a token on a single Redis is enough. If your lock protects correctness, it needs a fencing token on the write, and the problem is no longer about caching.',
    },
    {
      question: 'How do I choose the logical TTL and the physical slack?',
      answer:
        'The logical TTL comes from the business: how long data can be out of date without causing harm. The physical slack comes from operations: it has to cover at least the p99 of recomputation with margin and, if you want the cache to hold traffic during a database outage, the time you accept serving stale data in that scenario. A showcase with a 60 s logical TTL and 5 minutes of slack is a common starting point. If no delay is acceptable, the key should not serve stale values.',
    },
    {
      question: 'When is it not worth protecting a key against stampede?',
      answer:
        'When request rate times recomputation time stays close to 1. A key read 5 times per second with a 20 ms query has, on average, 0.1 concurrent misses: there is no stampede. A key read 2,000 times per second with a 400 ms query has 800. Single-flight is cheap enough to use everywhere; the lock, physical slack and XFetch make sense for the few keys where that product goes above a handful.',
    },
  ],
  conclusion: {
    title: 'The cache protects the database until the instant it expires',
    description:
      'A stampede is not a lack of cache, it is the cache expiring for everyone at the same time. The arithmetic that explains it is rate times recomputation time, and the solution is to shrink each factor: single-flight and a lock so that only one request recomputes, a logical TTL with physical slack so that nobody waits for it, early expiration so that the hot key rarely gets to expire, and a limiter with warm-up for the day the whole cache disappears. Without the test of a thousand concurrent reads, the protection is just an assumption.',
    cta: 'Review the caching strategy of my service',
  },
  related: [
    {
      label: 'Wrongly invalidated cache: when stale data costs more than the query',
      to: '/blog/cache-invalidado-errado-dado-velho-custa-mais-caro-que-consulta',
    },
    {
      label: 'Exhausted database connection limits: when the pool becomes the service bottleneck',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'La caché funcionaba: 99,8% de aciertos, la base de datos holgada, latencia baja. Aun así, cada sesenta segundos la gráfica de CPU de la base mostraba un pico estrecho y alto, y una vez al día, en la hora de más tráfico, ese pico se convertía en un incidente de tres minutos con timeouts en cascada. Ninguna consulta nueva, ningún despliegue, ningún bug en el código de la caché. Era la clave más caliente del sistema expirando, y todas las peticiones que llegaron en los 400 ms siguientes descubriendo, al mismo tiempo, que tenían que ir a la base. Este artículo muestra la cuenta que explica por qué ocurre, por qué el jitter no resuelve una clave única, cómo el single-flight en el proceso y un lock en Redis reducen cientos de consultas a una, cómo servir el valor viejo mientras se recalcula, cómo la expiración anticipada probabilística renueva la clave antes del vencimiento, cómo sobrevivir a la caché fría después de un reinicio y cómo demostrar en una prueba que mil lecturas simultáneas se convierten en una consulta.',
  sections: [
    {
      title: 'Anatomía del stampede: qué pasa en el milisegundo en que la clave expira',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El patrón de caché más común es el cache-aside: se lee de Redis y, si el valor no está, se consulta la base y se escribe el resultado con TTL. El código de abajo es exactamente eso, y es correcto para cualquier clave con poco tráfico. El problema aparece cuando la misma clave recibe miles de lecturas por segundo y la consulta que la produce no es trivial, como el escaparate de la página principal de un e-commerce, que agrega stock, precio promocional y ranking de ventas.',
        },
        {
          type: 'code',
          value: versaoComProblemaCode,
        },
        {
          type: 'paragraph',
          value:
            'Entre el instante en que la clave expira y el instante en que la primera petición escribe el nuevo valor, todas las demás peticiones también fallan en la caché y también consultan la base. La cantidad de consultas idénticas en vuelo es fácil de calcular: tasa de peticiones por tiempo de recálculo. Con 2.000 peticiones por segundo y una consulta de 400 ms, son unas 800 consultas iguales disparadas en menos de medio segundo, contra un pool de 20 conexiones.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'El detalle que convierte un pico en un incidente es la realimentación. Las 800 consultas compiten por CPU, buffers y locks en la base, así que cada una tarda más; como cada una tarda más, la ventana sin caché se alarga; como la ventana se alarga, más peticiones fallan en la caché. Una consulta de 400 ms pasa a tardar 3 s, y 800 consultas se convierten en 6.000. La base que soportaba la carga normal con holgura cae por una consulta que ya había respondido un minuto antes, y los reintentos de los clientes empujan el sistema al mismo lugar después de que la caché vuelve.',
        },
      ],
    },
    {
      title: 'Por qué el jitter solo no lo resuelve, y qué cubre realmente cada técnica',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La primera recomendación que aparece es añadir jitter al TTL: en lugar de 60 s fijos, algo entre 54 s y 66 s. Es correcto y necesario, pero resuelve otro problema. El jitter reparte la expiración de claves distintas que se escribieron juntas, como las diez mil páginas de producto pobladas por el mismo job. Una clave única sigue teniendo un único instante de expiración, con sorteo o sin él, y todas las peticiones de esa clave siguen llegando juntas a ese instante.',
        },
        {
          type: 'paragraph',
          value:
            'El stampede de una clave caliente tiene tres partes, y cada técnica ataca una: cuántas peticiones recalculan al mismo tiempo, qué hacen las demás mientras esperan y cuándo ocurre el recálculo. Ninguna técnica sola cubre las tres, y por eso la solución en producción suele ser una combinación pequeña y no una biblioteca.',
        },
        {
          type: 'table',
          columns: ['Técnica', 'Qué resuelve', 'Qué no resuelve', 'Costo'],
          rows: [
            ['Jitter en el TTL', 'Muchas claves expirando juntas', 'Una única clave caliente', 'Casi ninguno'],
            ['Single-flight en el proceso', 'Peticiones repetidas dentro de una instancia', 'N instancias recalculando al mismo tiempo', 'Un Map de promesas'],
            ['Lock en Redis', 'Recálculo duplicado entre instancias', 'Qué hacen los perdedores mientras esperan', 'Un viaje extra a Redis y un TTL de lock bien elegido'],
            ['TTL lógico con holgura física', 'Espera de los perdedores: sirven el valor viejo', 'Clave ausente, que no tiene valor viejo', 'Datos hasta un TTL lógico más viejos'],
            ['Expiración anticipada (XFetch)', 'Renueva antes de que la clave venza', 'Clave fría, que nunca se anticipa', 'Recálculos un poco más frecuentes'],
            ['Precalentamiento y limitador', 'Caché entera vacía después de un reinicio o despliegue', 'Clave caliente aislada en el día a día', 'Arranque más lento'],
          ],
        },
      ],
    },
    {
      title: 'Single-flight: una instancia, un recálculo por clave',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El primer paso es barato y elimina la mayor parte del problema: dentro de un mismo proceso, la primera petición que falla en la caché crea la promesa del recálculo, y todas las demás que llegan mientras está en vuelo reciben la misma promesa. En Go, esto es el paquete singleflight; en Node.js, cabe en quince líneas.',
        },
        {
          type: 'code',
          value: singleFlightCode,
        },
        {
          type: 'list',
          items: [
            'La eliminación en el finally es obligatoria: sin ella, un error queda guardado para siempre y la clave nunca más se recalcula en esa instancia.',
            'El Promise.resolve().then existe por un motivo concreto: si carregar lanzara un error de forma síncrona dentro de una función async, el finally se ejecutaría antes del set, y la promesa rechazada quedaría atrapada en el Map.',
            'Todos los que comparten la promesa reciben el mismo error. Es lo deseable: 800 peticiones fallando juntas por una consulta es mejor que 800 consultas fallando juntas.',
            'Los llamadores reciben el mismo objeto. Si alguno muta el resultado, todos ven la mutación; trate el valor devuelto como inmutable.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Con single-flight, 800 consultas por instancia se convierten en una consulta por instancia. En una flota de 40 réplicas siguen siendo 40 consultas idénticas en el mismo medio segundo, lo que muchas veces ya es aceptable. Cuando no lo es, porque la consulta es pesada o la flota es grande, la coordinación tiene que salir del proceso.',
        },
      ],
    },
    {
      title: 'Lock en Redis y TTL lógico: un recálculo en toda la flota y nadie esperando',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Coordinar entre instancias resuelve quién recalcula, pero plantea la pregunta que suele olvidarse: qué hacen las demás peticiones mientras tanto. Si esperan, el lock solo trasladó la cola de la base a Redis. La salida es separar dos plazos de validez: el TTL lógico, guardado dentro del valor, dice cuándo se vuelve viejo; el TTL físico de Redis es mayor, con una holgura, y mantiene disponible el valor viejo. Quien encuentra el valor viejo lo sirve en el acto y dispara una revalidación en segundo plano; solo quien encuentra la clave ausente tiene que esperar.',
        },
        {
          type: 'code',
          value: cacheProtegidoCode,
        },
        {
          type: 'ordered',
          items: [
            'El lock es un SET NX PX con un token aleatorio, y la liberación es un script Lua que solo borra la clave si el token sigue siendo el suyo. Sin esa comparación, una instancia lenta, cuyo lock ya expiró, borraría el lock de otra instancia que lo tomó después.',
            'El lockMs tiene que ser mayor que el p99 del recálculo. Si es menor, el lock expira en medio de la consulta, otra instancia lo toma y el stampede vuelve en cámara lenta.',
            'El costo medido del recálculo se guarda junto con el valor. Sirve para la expiración anticipada de la siguiente sección y para una métrica que avisa cuando la consulta se está encareciendo.',
            'Con la clave ausente, quien pierde el lock consulta Redis cada 50 ms hasta un límite. Si el límite se agota, carga por su cuenta: como máximo una carga por instancia, gracias al single-flight, y nunca una por petición.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La holgura física también se convierte en protección contra fallos de la base. Si el recálculo falla, el valor viejo se sigue sirviendo hasta que la holgura se agota, y la siguiente petición lo intenta de nuevo. Un escaparate con dos minutos de retraso es un problema de negocio pequeño; un escaparate que devuelve error es uno grande. Para datos en los que un valor viejo no es aceptable, como un saldo, la clave simplemente no debe usar este camino, y quizá la propia caché no sea el lugar adecuado para ella.',
        },
      ],
    },
    {
      title: 'Expiración anticipada probabilística: renovar antes de vencer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Aun sirviendo el valor viejo, la clave pasa algún tiempo vieja después de cada vencimiento. La técnica conocida como XFetch, publicada por Vattani, Chierichetti y Lowenstein, hace que cada lectura decida, con una probabilidad que crece cerca del vencimiento, recalcular antes de tiempo. La probabilidad depende del costo del recálculo: las claves caras empiezan a renovarse antes.',
        },
        {
          type: 'code',
          value: expiracaoAntecipadaCode,
        },
        {
          type: 'paragraph',
          value:
            'La cuenta muestra por qué funciona sin coordinación. Con un costo de 400 ms y beta 1, la probabilidad de que una lectura se anticipe cuando faltan t milisegundos es e elevado a menos t sobre 400. Con 2.000 lecturas por segundo, la primera anticipación ocurre, en promedio, unos 2,9 segundos antes del vencimiento, y la clave prácticamente nunca llega a quedar vieja. Con una lectura por segundo, la probabilidad acumulada es tan baja que la clave expira normalmente, y eso está bien: una clave con poco tráfico no tiene stampede que evitar.',
        },
        {
          type: 'list',
          items: [
            'Un beta mayor que 1 anticipa antes y recalcula con más frecuencia; un beta menor que 1 hace lo contrario. Empiece con 1 y ajuste solo con métricas.',
            'Varias lecturas pueden decidir anticiparse casi al mismo tiempo. El single-flight y el lock de la sección anterior siguen siendo la red de seguridad que garantiza un solo recálculo.',
            'El costo guardado en el valor tiene que ser el costo real medido, no una constante. Si la consulta se vuelve lenta, la anticipación se ajusta sola.',
          ],
        },
      ],
    },
    {
      title: 'Caché fría: cuando todas las claves desaparecen a la vez',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe una versión del stampede que ninguna de las técnicas anteriores resuelve por sí sola: la caché entera vacía. Ocurre cuando Redis se reinicia sin persistencia, cuando un failover promueve una réplica atrasada, cuando se ejecuta un flush en el entorno equivocado o cuando un despliegue cambia el prefijo de las claves de v1 a v2. En ese momento no hay valor viejo que servir en ninguna clave, y el single-flight por clave no limita nada, porque son miles de claves distintas.',
        },
        {
          type: 'list',
          items: [
            'Limite la concurrencia de recálculo por instancia, independientemente de la clave. Cuatro recálculos simultáneos por réplica en una flota de 40 son 160 consultas en la base, un número que se puede dimensionar; sin límite, son miles.',
            'Precaliente las claves más leídas antes de que la instancia entre en el balanceador. La lista sale de la propia métrica de accesos por clave, y cien claves suelen cubrir la mayor parte del tráfico.',
            'Al cambiar el formato de la clave, lea la versión nueva y, si no existe, la antigua, convirtiendo en la lectura. El prefijo nuevo se puebla poco a poco con el tráfico, y no de golpe por la ausencia.',
            'Aplique jitter al TTL físico de todo lo que se escribe en lote. Aquí el jitter es exactamente la herramienta correcta.',
            'Guarde también la ausencia. Una clave de producto inexistente consultada en bucle va a la base cada vez; un marcador de "no existe" con TTL corto lo resuelve.',
          ],
        },
        {
          type: 'code',
          value: limitadorCode,
        },
        {
          type: 'paragraph',
          value:
            'El limitador pasa la plaza directamente a quien está en la cola, sin devolverla al contador. Parece un detalle, pero la versión ingenua que decrementa y deja que el siguiente incremente permite que una petición nueva se cuele entre las dos operaciones y supere el máximo justo en el pico, que es el único momento en que el límite importa.',
        },
      ],
    },
    {
      title: 'Cómo demostrarlo en una prueba y verlo en producción',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La propiedad que importa es verificable: para N lecturas simultáneas de una clave ausente, el cargador se ejecuta una vez; para N lecturas de una clave vieja, ninguna petición espera y el cargador se ejecuta una vez en segundo plano. La prueba de abajo usa un Redis en memoria con el subconjunto de comandos que necesita la caché y dos instancias compartiendo el mismo Redis, para cubrir el lock y no solo el single-flight.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'paragraph',
          value:
            'En producción, la tasa de aciertos no muestra el problema, porque un stampede de medio segundo apenas mueve el promedio del minuto. Las métricas que sí lo muestran son otras, y todas por clave o, al menos, por las claves más calientes.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Qué indica', 'Señal de alerta'],
          rows: [
            ['Recálculos por clave por ventana de TTL', 'Si la coordinación funciona', 'Más de uno por TTL lógico en una clave caliente'],
            ['Valores viejos servidos por segundo', 'Cuánto tráfico depende de la holgura física', 'Crecimiento continuo: el recálculo está fallando'],
            ['Esperas agotadas', 'Cuántas instancias cayeron en el último recurso', 'Cualquier valor distinto de cero recurrente'],
            ['Costo del recálculo (p99)', 'Si la consulta se está encareciendo', 'p99 acercándose al lockMs'],
            ['Edad del valor servido', 'Cuánto retraso está viendo el usuario', 'Edad por encima del TTL lógico más la holgura planificada'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La prueba de carga también necesita un escenario específico: expirar la clave más caliente en medio del pico, a propósito, y medir las conexiones activas en la base durante los dos segundos siguientes. Una prueba de carga que solo mide el throughput en régimen constante pasa sin encontrar el stampede, porque la caché ya está caliente desde el primer minuto.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Un lock con Redis en un solo nodo no es inseguro? ¿Y el debate sobre Redlock?',
      answer:
        'Ese debate trata de exclusión mutua usada para corrección, como garantizar que dos instancias nunca escriban el mismo registro. Aquí el lock es una optimización: si falla y dos instancias recalculan juntas, el costo es una consulta más, y el valor escrito es el mismo. Para este uso, un SET NX PX con token en un único Redis es suficiente. Si su lock protege la corrección, necesita un fencing token en la escritura, y el problema deja de ser de caché.',
    },
    {
      question: '¿Cómo elegir el TTL lógico y la holgura física?',
      answer:
        'El TTL lógico viene del negocio: cuánto tiempo un dato puede estar desactualizado sin causar daño. La holgura física viene de la operación: tiene que cubrir al menos el p99 del recálculo con margen y, si quiere que la caché sostenga el tráfico durante una caída de la base, el tiempo que acepta servir datos viejos en ese escenario. Un escaparate con TTL lógico de 60 s y holgura de 5 minutos es un punto de partida común. Si ningún retraso es aceptable, la clave no debe servir valores viejos.',
    },
    {
      question: '¿Cuándo no vale la pena proteger una clave contra el stampede?',
      answer:
        'Cuando la tasa de peticiones por el tiempo de recálculo se queda cerca de 1. Una clave leída 5 veces por segundo con una consulta de 20 ms tiene, en promedio, 0,1 fallos simultáneos: no hay stampede. Una clave leída 2.000 veces por segundo con una consulta de 400 ms tiene 800. El single-flight es lo bastante barato para usarlo en todo; el lock, la holgura física y XFetch tienen sentido para las pocas claves en las que esa cuenta supera unas pocas unidades.',
    },
  ],
  conclusion: {
    title: 'La caché protege la base hasta el instante en que expira',
    description:
      'Un stampede no es falta de caché, es la expiración de la caché ocurriendo para todos al mismo tiempo. La cuenta que lo explica es tasa por tiempo de recálculo, y la solución es reducir cada factor: single-flight y lock para que solo una petición recalcule, TTL lógico con holgura física para que nadie la espere, expiración anticipada para que la clave caliente rara vez llegue a vencer, y limitador con precalentamiento para el día en que la caché entera desaparece. Sin la prueba de las mil lecturas simultáneas, la protección es solo una suposición.',
    cta: 'Revisar la estrategia de caché de mi servicio',
  },
  related: [
    {
      label: 'Caché invalidada mal: cuando el dato viejo cuesta más caro que la consulta',
      to: '/blog/cache-invalidado-errado-dado-velho-custa-mais-caro-que-consulta',
    },
    {
      label: 'Límite de conexiones de la base agotado: cuándo el pool se vuelve el cuello de botella del servicio',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Arquitectura y modernización de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
