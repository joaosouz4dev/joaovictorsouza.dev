// Conteudo do artigo: o problema N+1 que passa em teste e aparece em producao,
// por que depende dos dados e da latencia e nao do codigo, como contar consultas
// por requisicao, como corrigir com carregamento em lote, onde ele se esconde
// (serializadores, resolvers, "ultimo evento") e como impedir que volte com um
// teste que conta consultas.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const naiveCode = `// Versao com N+1: uma consulta para a lista e mais uma por pedido, por item e por evento
export async function listarPedidosDoDia(db, { porPagina = 100 } = {}) {
  const { rows: pedidos } = await db.query(
    \`SELECT id, cliente_id, criado_em FROM pedidos
      WHERE criado_em >= current_date ORDER BY criado_em DESC LIMIT $1\`,
    [porPagina],
  );

  for (const pedido of pedidos) {
    const cliente = await db.query('SELECT id, nome FROM clientes WHERE id = $1', [pedido.cliente_id]);
    pedido.cliente = cliente.rows[0] ?? null;

    const itens = await db.query(
      'SELECT id, produto_id, quantidade FROM itens_pedido WHERE pedido_id = $1',
      [pedido.id],
    );
    for (const item of itens.rows) {
      const produto = await db.query('SELECT id, nome, sku FROM produtos WHERE id = $1', [item.produto_id]);
      item.produto = produto.rows[0] ?? null;
    }
    pedido.itens = itens.rows;

    const ultimo = await db.query(
      'SELECT status, ocorrido_em FROM eventos_pedido WHERE pedido_id = $1 ORDER BY ocorrido_em DESC LIMIT 1',
      [pedido.id],
    );
    pedido.ultimoEvento = ultimo.rows[0] ?? null;
  }
  return pedidos;
}
// Seed de teste (10 pedidos, 2 itens cada): 1 + 10 + 10 + 20 + 10 = 51 consultas, 5 ms na rede local.
// Producao (100 pedidos, 9 itens em media): 1 + 100 + 100 + 900 + 100 = 1.201 consultas.`;

const waterfallDiagram = `GET /pedidos (100 pedidos, 9 itens em media, 0,8 ms de ida e volta ate o banco)

Com N+1                                        Em lote
|- SELECT pedidos ............... 1            |- SELECT pedidos ..................... 1
|- para cada pedido:                           |- SELECT clientes WHERE id = ANY .... 1
|   |- SELECT cliente ........... 100          |- SELECT itens WHERE pedido_id = ANY  1
|   |- SELECT itens ............. 100          |- SELECT eventos DISTINCT ON ........ 1
|   |- para cada item:                         |- SELECT produtos WHERE id = ANY .... 1
|   |   |- SELECT produto ....... 900
|   |- SELECT ultimo evento ..... 100          Total: 5 consultas (constante)
Total: 1.201 consultas (cresce com os dados)   Rede: 5 x 0,8 ms = 4 ms
Rede: 1.201 x 0,8 ms = 961 ms, em serie`;

const counterCode = `import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

const contexto = new AsyncLocalStorage();
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

// Envolve pool.query: cada consulta soma no contador da requisicao em andamento.
// Para transacoes (pool.connect), envolva client.query do mesmo jeito.
const queryOriginal = pool.query.bind(pool);
pool.query = async (...args) => {
  const inicio = process.hrtime.bigint();
  try {
    return await queryOriginal(...args);
  } finally {
    const req = contexto.getStore();
    if (req) {
      req.consultas += 1;
      req.tempoDbMs += Number(process.hrtime.bigint() - inicio) / 1e6;
    }
  }
};

// Middleware: abre um contexto por requisicao e, ao terminar, registra quantas
// consultas ela fez. Acima do limite, marca como suspeita de N+1.
export function contarConsultas({ limite = 30, registrar }) {
  return (req, res, next) => {
    const medicao = { consultas: 0, tempoDbMs: 0 };
    contexto.run(medicao, () => {
      res.on('finish', () => {
        registrar({
          rota: req.route?.path ?? req.path,
          status: res.statusCode,
          consultas: medicao.consultas,
          tempoDbMs: Math.round(medicao.tempoDbMs),
          suspeitaDeNMais1: medicao.consultas > limite,
        });
      });
      next();
    });
  };
}

// app.use(contarConsultas({ registrar: (m) => { metricas.histograma('db_consultas_por_requisicao', m.consultas, { rota: m.rota }); if (m.suspeitaDeNMais1) logger.warn(m, 'possivel N+1'); } }));`;

const pgStatCode = `-- A assinatura do N+1 vista do banco: uma consulta barata chamada milhares de vezes.
-- Ordene por chamadas, nao por tempo medio: o N+1 nunca aparece no topo das consultas lentas.
SELECT calls,
       round(mean_exec_time::numeric, 2)           AS media_ms,
       round(total_exec_time::numeric)             AS total_ms,
       round((100 * total_exec_time / sum(total_exec_time) OVER ())::numeric, 1) AS pct_do_tempo,
       left(query, 70)                             AS consulta
FROM pg_stat_statements
WHERE calls > 10000
ORDER BY calls DESC
LIMIT 10;

-- Exemplo do que aparece:
-- calls    media_ms  total_ms  pct_do_tempo  consulta
-- 4812330  0.31      1491822   38.2          SELECT id, nome, sku FROM produtos WHERE id = $1
-- 534700   0.44      235268    6.0           SELECT id, nome FROM clientes WHERE id = $1`;

const batchCode = `const indexarPor = (linhas, chave = 'id') => new Map(linhas.map((linha) => [linha[chave], linha]));

const agruparPor = (linhas, chave) =>
  linhas.reduce((mapa, linha) => {
    const lista = mapa.get(linha[chave]) ?? [];
    lista.push(linha);
    return mapa.set(linha[chave], lista);
  }, new Map());

// Versao em lote: 5 consultas, com 10 ou com 100 pedidos na pagina
export async function listarPedidosDoDia(db, { porPagina = 100 } = {}) {
  const { rows: pedidos } = await db.query(
    \`SELECT id, cliente_id, criado_em FROM pedidos
      WHERE criado_em >= current_date ORDER BY criado_em DESC LIMIT $1\`,
    [porPagina],
  );
  if (pedidos.length === 0) return [];
  const idsPedidos = pedidos.map((p) => p.id);

  const [{ rows: clientes }, { rows: itens }, { rows: eventos }] = await Promise.all([
    db.query('SELECT id, nome FROM clientes WHERE id = ANY($1)', [
      [...new Set(pedidos.map((p) => p.cliente_id))],
    ]),
    db.query(
      'SELECT id, pedido_id, produto_id, quantidade FROM itens_pedido WHERE pedido_id = ANY($1)',
      [idsPedidos],
    ),
    // O evento mais recente de cada pedido em uma unica consulta.
    // Precisa do indice (pedido_id, ocorrido_em DESC) para nao varrer o historico inteiro.
    db.query(
      \`SELECT DISTINCT ON (pedido_id) pedido_id, status, ocorrido_em
         FROM eventos_pedido
        WHERE pedido_id = ANY($1)
        ORDER BY pedido_id, ocorrido_em DESC\`,
      [idsPedidos],
    ),
  ]);

  // Produtos dependem dos itens, por isso vem depois: segunda rodada, ainda uma consulta so
  const { rows: produtos } = await db.query('SELECT id, nome, sku FROM produtos WHERE id = ANY($1)', [
    [...new Set(itens.map((i) => i.produto_id))],
  ]);

  const clientePorId = indexarPor(clientes);
  const produtoPorId = indexarPor(produtos);
  const itensPorPedido = agruparPor(itens, 'pedido_id');
  const eventoPorPedido = indexarPor(eventos, 'pedido_id');

  return pedidos.map((pedido) => ({
    ...pedido,
    cliente: clientePorId.get(pedido.cliente_id) ?? null,
    itens: (itensPorPedido.get(pedido.id) ?? []).map((item) => ({
      ...item,
      produto: produtoPorId.get(item.produto_id) ?? null,
    })),
    ultimoEvento: eventoPorPedido.get(pedido.id) ?? null,
  }));
}`;

const loaderCode = `// Carregador em lote com escopo de requisicao: junta os ids pedidos no mesmo tick
// e dispara uma consulta so. Resolve o N+1 que nasce fora do seu laco (resolvers
// GraphQL, serializadores, getters de ORM), sem reescrever quem chama.
export function criarCarregador(buscarEmLote) {
  const pendentes = new Map(); // id -> { resolve, reject }
  const cache = new Map(); // id -> Promise (vale so para esta requisicao)
  let agendado = false;

  const despachar = async () => {
    agendado = false;
    const lote = new Map(pendentes);
    pendentes.clear();
    try {
      const resultados = await buscarEmLote([...lote.keys()]); // Map<id, linha>
      for (const [id, { resolve }] of lote) resolve(resultados.get(id) ?? null);
    } catch (erro) {
      for (const { reject } of lote.values()) reject(erro);
    }
  };

  return {
    carregar(id) {
      if (cache.has(id)) return cache.get(id);
      const promessa = new Promise((resolve, reject) => pendentes.set(id, { resolve, reject }));
      cache.set(id, promessa);
      if (!agendado) {
        agendado = true;
        // Depois das promessas ja enfileiradas, antes da proxima fase de I/O:
        // todos os resolvers do mesmo nivel ja pediram seus ids quando isto roda.
        Promise.resolve().then(() => process.nextTick(despachar));
      }
      return promessa;
    },
  };
}

// Por requisicao (contexto do GraphQL ou do handler), nunca global:
export const criarCarregadores = (db) => ({
  clientes: criarCarregador(async (ids) => {
    const { rows } = await db.query('SELECT id, nome FROM clientes WHERE id = ANY($1)', [ids]);
    return new Map(rows.map((c) => [c.id, c]));
  }),
  produtos: criarCarregador(async (ids) => {
    const { rows } = await db.query('SELECT id, nome, sku FROM produtos WHERE id = ANY($1)', [ids]);
    return new Map(rows.map((p) => [p.id, p]));
  }),
});

// Resolver que antes fazia uma consulta por pedido:
// Pedido: { cliente: (pedido, _args, ctx) => ctx.carregadores.clientes.carregar(pedido.cliente_id) }`;

const testCode = `import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { listarPedidosDoDia } from './pedidos.js';
import { semearPedidos } from './seed.js';

// Conta as consultas feitas pelo pool durante um trecho de codigo
const comContador = (pool) => {
  let consultas = 0;
  const original = pool.query.bind(pool);
  pool.query = (...args) => {
    consultas += 1;
    return original(...args);
  };
  return { zerar: () => (consultas = 0), total: () => consultas };
};

test('o numero de consultas nao cresce com o numero de pedidos', async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const contador = comContador(pool);
  await pool.query('TRUNCATE eventos_pedido, itens_pedido, pedidos, clientes, produtos CASCADE');

  await semearPedidos(pool, { pedidos: 5, itensPorPedido: 3 });
  contador.zerar();
  await listarPedidosDoDia(pool, { porPagina: 100 });
  const comCinco = contador.total();

  await semearPedidos(pool, { pedidos: 95, itensPorPedido: 9 });
  contador.zerar();
  const pedidos = await listarPedidosDoDia(pool, { porPagina: 100 });
  const comCem = contador.total();

  assert.equal(pedidos.length, 100);
  assert.ok(pedidos.every((p) => p.cliente && p.itens.every((i) => i.produto)));
  // A unica afirmacao que importa: mesma contagem com 5 e com 100 pedidos
  assert.equal(comCem, comCinco, \`5 pedidos: \${comCinco} consultas; 100 pedidos: \${comCem}\`);
  assert.ok(comCinco <= 6, \`esperava no maximo 6 consultas, foram \${comCinco}\`);
  await pool.end();
});`;

const pt = {
  intro:
    'Uma distribuidora de materiais de construção lançou a nova tela de pedidos do dia: lista de pedidos com cliente, itens, produto de cada item e último status de entrega. Em teste, com o seed de 10 pedidos, a página respondia em 40 milissegundos. Em staging, em 180. Em produção, para o cliente que mais vendia, levava 6 segundos no horário de pico e derrubava outras telas junto, porque esgotava o pool de conexões. O código não mudou entre os ambientes. O que mudou foi o tamanho dos dados e a distância até o banco: a tela fazia uma consulta por pedido, por item e por evento, 51 consultas com o seed e 1.201 com dados reais, cada uma pagando uma ida e volta à rede. Este artigo mostra por que o N+1 é um defeito que os testes de unidade não enxergam, como medi-lo em cada requisição e no banco, como corrigi-lo com carregamento em lote, onde ele se esconde quando o laço não está no seu código, e como escrever o teste que impede que ele volte.',
  sections: [
    {
      title: 'Por que o teste passa: o N+1 é função dos dados, não do código',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O padrão é sempre o mesmo: uma consulta traz a lista e, para cada linha, outra consulta traz algo relacionado. Com N linhas e k relações, o total é 1 + N × k consultas. Em um teste de unidade, N é pequeno porque o seed é pequeno, e cada consulta custa frações de milissegundo porque o banco roda na mesma máquina. Em produção, N é o que o cliente tem, e cada consulta paga a ida e volta até o banco gerenciado, que fica em outra máquina, em outra zona, com 0,5 a 2 milissegundos de latência. Como as consultas acontecem em série dentro do laço, esse tempo soma, não se sobrepõe.',
        },
        {
          type: 'paragraph',
          value:
            'É por isso que o problema é invisível em teste e em staging e aparece em produção. Nada falha: o resultado está correto, o teste passa, a revisão de código não vê nenhuma consulta lenta porque não existe consulta lenta. Existem mil consultas rápidas. O exemplo abaixo é a tela do caso, em Node com o driver pg, e vale igual para qualquer ORM que faça carregamento preguiçoso de relações.',
        },
        { type: 'code', value: naiveCode },
        {
          type: 'table',
          columns: ['Ambiente', 'Pedidos na página', 'Itens por pedido', 'Consultas', 'Ida e volta ao banco', 'Tempo só de rede'],
          rows: [
            ['Teste local (seed)', '10', '2', '51', '0,1 ms', '5 ms'],
            ['Staging', '30', '4', '211', '0,4 ms', '84 ms'],
            ['Produção, cliente médio', '100', '9', '1.201', '0,8 ms', '961 ms'],
            ['Produção, pico, pool de 10 disputado', '100', '9', '1.201', '0,8 ms + espera por conexão', '3 a 6 s'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha explica a parte mais grave do incidente. Cada uma das 1.201 consultas pega uma conexão do pool, usa por menos de um milissegundo e devolve. Com 40 usuários abrindo a tela no mesmo minuto, são 48 mil pedidos de conexão disputando 10 vagas. As outras telas, que fazem 3 consultas e deveriam responder em 20 milissegundos, ficam na fila atrás delas. O N+1 de uma tela vira a latência de todas.',
        },
      ],
    },
    {
      title: 'Enxergar o problema: contar consultas por requisição e ler o banco pelo lado certo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Latência média e consultas lentas não mostram N+1, porque nenhuma consulta é lenta. A métrica que mostra é a contagem de consultas por requisição. Ela é barata de produzir: um contexto por requisição com AsyncLocalStorage e um envoltório em volta do método de consulta do driver. O resultado vai para um histograma por rota e para o log quando passa de um teto. Uma rota saudável faz entre 1 e 10 consultas por requisição. Uma rota com 400 está fazendo laço sobre dados.',
        },
        { type: 'code', value: counterCode },
        {
          type: 'paragraph',
          value:
            'Com a métrica ligada, a tela do caso aparece em minutos: a rota de pedidos faz, em média, 1.150 consultas por requisição, com p99 acima de 3.000 para os clientes grandes, enquanto todas as outras rotas ficam abaixo de 12. Se o ORM for Prisma, o evento de query serve ao mesmo propósito; em Sequelize e TypeORM, o logger de consultas recebe uma chamada por comando e pode somar no mesmo contexto.',
        },
        {
          type: 'paragraph',
          value:
            'Do lado do banco, o N+1 também tem assinatura, mas ela só aparece quando a extensão pg_stat_statements é ordenada por número de chamadas e não por tempo médio. Uma consulta por chave primária com média de 0,3 milissegundos e 4 milhões de chamadas no dia é a prova: ninguém escreve uma consulta assim fora de um laço.',
        },
        { type: 'code', value: pgStatCode },
      ],
    },
    {
      title: 'Corrigir: trocar o laço por carregamento em lote',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A correção não é fazer cada consulta mais rápida, é fazer menos consultas. Em vez de buscar o cliente de cada pedido, busca-se de uma vez todos os clientes cujos ids aparecem na página, com WHERE id = ANY($1), e monta-se um mapa em memória para associar. O mesmo para itens, eventos e produtos. O total deixa de ser 1 + N × k e vira 1 + k: uma consulta por relação, independentemente de quantas linhas a página tem.',
        },
        { type: 'code', value: batchCode },
        { type: 'diagram', value: waterfallDiagram },
        {
          type: 'paragraph',
          value:
            'Três detalhes fazem diferença. O primeiro é remover ids repetidos antes de consultar: 100 pedidos de 12 clientes viram uma lista de 12 ids, não 100. O segundo é que relações independentes podem ir em paralelo com Promise.all, usando conexões distintas do pool, enquanto relações encadeadas, como produto que depende de item, esperam a rodada anterior. O terceiro é o tamanho da lista: ANY com 100 ids é trivial, mas com 50 mil ids o planejador perde eficiência e o pacote de rede cresce. Quando a página pode ser grande, divida a lista em blocos de cerca de mil ids por consulta.',
        },
        {
          type: 'paragraph',
          value:
            'Esse padrão é o que os ORMs chamam de carregamento antecipado: include no Prisma, with na maioria dos query builders, eager loading no Sequelize e no Hibernate. Por baixo, eles geram exatamente essas consultas em lote. O que o ORM não faz é obrigar você a usá-las, e qualquer acesso a uma relação não carregada dentro de um laço volta a disparar uma consulta por linha.',
        },
      ],
    },
    {
      title: 'O N+1 que não está no seu laço: ORM, serializador e o "último evento"',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O caso mais traiçoeiro é o laço que você não escreveu. Um serializador que acessa pedido.cliente.nome para montar o JSON, um template que percorre itens e imprime item.produto.sku, um resolver GraphQL que resolve o campo cliente de cada Pedido. Em todos esses lugares o código parece inocente, porque a consulta é disparada pelo getter preguiçoso do ORM ou pelo motor de resolução, e o laço é o framework percorrendo a lista.',
        },
        {
          type: 'paragraph',
          value:
            'Quando não dá para controlar quem chama, a solução é um carregador em lote com escopo de requisição, o padrão popularizado pelo DataLoader. Cada chamada registra o id que quer e recebe uma promessa; no fim do tick, todas as promessas pendentes são atendidas com uma única consulta. Os resolvers continuam pedindo um cliente por pedido, mas o banco recebe uma consulta por página.',
        },
        { type: 'code', value: loaderCode },
        {
          type: 'paragraph',
          value:
            'O cache precisa viver dentro da requisição e morrer com ela. Um carregador global, compartilhado entre requisições, devolveria dados de um usuário para outro e nunca veria atualizações. Por isso ele é criado no contexto de cada requisição, junto com a conexão ou a transação que vai usar.',
        },
        {
          type: 'paragraph',
          value:
            'Há ainda o N+1 que persiste mesmo com include: o campo calculado por linha. O "último evento de entrega" de cada pedido é uma consulta com ORDER BY e LIMIT 1 que o carregamento antecipado comum não cobre, e que por isso sobrevive à primeira rodada de correção. Em PostgreSQL, DISTINCT ON (pedido_id) com ORDER BY pedido_id, ocorrido_em DESC devolve o mais recente de cada pedido em uma consulta só, como no exemplo em lote acima. Em outros bancos, uma função de janela com ROW_NUMBER() OVER (PARTITION BY pedido_id ORDER BY ocorrido_em DESC) filtrada em 1 faz o mesmo. Nos dois casos o índice composto (pedido_id, ocorrido_em DESC) é o que transforma essa consulta em uma leitura curta por pedido em vez de uma varredura do histórico.',
        },
      ],
    },
    {
      title: 'Impedir que volte: o teste que conta consultas e o seed que parece produção',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Corrigir a tela resolve o incidente. Impedir que a próxima tela nasça com o mesmo defeito exige um teste que falhe quando o número de consultas depender do número de linhas. O teste não afirma um número mágico; ele executa a função com 5 pedidos e com 100, e afirma que a contagem foi a mesma. Essa afirmação é estável, sobrevive a refatorações e falha exatamente quando alguém adiciona um acesso preguiçoso dentro do laço.',
        },
        { type: 'code', value: testCode },
        {
          type: 'paragraph',
          value:
            'O segundo mecanismo é o seed. Um ambiente de staging com 10 pedidos de 2 itens não ensaia nada: ele é o motivo de o N+1 chegar em produção. O seed precisa ter a forma dos dados reais, em especial a cardinalidade das relações: quantos itens por pedido, quantos eventos por pedido, quantos pedidos por cliente no percentil alto. Não precisa ter o volume de produção para isso; precisa ter a distribuição. Com 200 pedidos de 9 itens e 15 eventos, a tela em staging já faria 2.400 consultas e o problema seria visto antes do deploy.',
        },
        {
          type: 'table',
          columns: ['Sinal', 'Onde ver', 'Limiar sugerido'],
          rows: [
            ['Consultas por requisição', 'Histograma por rota do middleware', 'Alertar acima de 30 na mesma rota; investigar qualquer rota com p99 acima de 50'],
            ['Chamadas altas com tempo médio baixo', 'pg_stat_statements ordenado por calls', 'Mais de 10 mil chamadas por minuto com média abaixo de 1 ms'],
            ['Tempo de banco em relação ao tempo da resposta', 'Trace da requisição', 'Mais de 70% do tempo em consultas de menos de 2 ms cada'],
            ['Contagem igual com N pequeno e N grande', 'Teste no CI', 'Falhar se a contagem com 100 linhas for maior que com 5'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Em produção, o alerta certo é sobre a contagem por requisição, não sobre a latência. A latência só sobe quando o pool já está disputado, e a essa altura várias telas estão lentas. A contagem sobe na primeira requisição depois do deploy, para o primeiro cliente grande, antes de qualquer usuário reclamar.',
        },
      ],
    },
    {
      title: 'Decidir entre lote, JOIN, carregador e cache',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nem toda relação se resolve do mesmo jeito, e a escolha errada troca um problema por outro. Um JOIN único traz tudo em uma consulta, mas em relações um-para-muitos repete as colunas do pai em cada linha do filho: 100 pedidos com 9 itens viram 900 linhas com o nome do cliente repetido 900 vezes, e com dois filhos independentes no mesmo JOIN o produto cartesiano multiplica de novo. O lote por tabela custa uma consulta a mais por relação e transfere cada linha uma vez.',
        },
        {
          type: 'table',
          columns: ['Abordagem', 'Consultas', 'Quando usar', 'Cuidado'],
          rows: [
            ['Consulta por linha dentro do laço', '1 + N × k', 'Só quando N é limitado pelo código e pequeno, por exemplo os 3 endereços de um cliente', 'Cresce com os dados; nunca em listagem paginada por volume do cliente'],
            ['Lote por tabela com WHERE id = ANY', '1 + k', 'Padrão para listas com relações um-para-muitos e muitos-para-um', 'Remover ids repetidos; dividir listas acima de cerca de mil ids'],
            ['JOIN único', '1', 'Relações um-para-um e muitos-para-um com poucas colunas', 'Em um-para-muitos multiplica linhas e bytes; dois filhos no mesmo JOIN viram produto cartesiano'],
            ['Carregador em lote por requisição', '1 + k por requisição', 'GraphQL, serializadores e getters de ORM, onde o laço não é seu', 'Cache só dentro da requisição; criar no contexto, nunca global'],
            ['Cache de aplicação', '0 no acerto', 'Dado estável e pequeno, como catálogo de produtos', 'Não corrige a consulta; o N+1 volta inteiro no primeiro erro de cache'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Uma regra prática: para listagens, lote por tabela como padrão, JOIN para as relações muitos-para-um com poucas colunas, carregador quando o framework é quem percorre a lista. Cache entra depois da correção, nunca no lugar dela, porque um cache que esconde um N+1 transforma uma invalidação ou um reinício em incidente.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'O ORM não resolve isso sozinho com eager loading?',
      answer:
        'Resolve as relações que você pede explicitamente com include, with ou equivalente, e gera as consultas em lote por baixo. Mas não impede o acesso preguiçoso: qualquer relação não incluída que seja tocada dentro de um laço, em um serializador ou em um template volta a disparar uma consulta por linha. Alguns ORMs permitem desligar o carregamento preguiçoso ou fazê-lo lançar erro em produção, e essa configuração vale a pena: transforma um N+1 silencioso em uma exceção que o teste pega.',
    },
    {
      question: 'Um JOIN único não é sempre melhor do que várias consultas em lote?',
      answer:
        'Não. Em relações muitos-para-um com poucas colunas, o JOIN é ótimo e economiza uma ida ao banco. Em relações um-para-muitos, ele repete as colunas do pai em cada linha do filho e, com dois filhos independentes, multiplica as linhas pelo produto das cardinalidades. O lote por tabela custa uma consulta a mais por relação, geralmente abaixo de um milissegundo cada, e transfere cada linha exatamente uma vez. A diferença entre 5 e 1 consulta é irrelevante; a diferença entre 5 e 1.201 é o incidente.',
    },
    {
      question: 'Vale colocar cache na frente em vez de corrigir a consulta?',
      answer:
        'Cache depois da correção, não no lugar dela. Um cache que esconde um N+1 mantém a tela rápida enquanto acerta, e devolve as 1.201 consultas de uma vez em cada erro de cache, invalidação em massa ou reinício do serviço, exatamente quando o sistema está mais frágil. Corrija primeiro para que a tela faça 5 consultas, e aí decida se o catálogo de produtos, que muda pouco, merece um cache para cortar uma delas.',
    },
  ],
  conclusion: {
    title: 'O N+1 se mede em consultas por requisição, não em latência',
    description:
      'A tela rápida em teste e lenta em produção não tem bug de lógica: tem um laço cujo custo depende dos dados do cliente e da distância até o banco, duas coisas que o ambiente de teste não reproduz. A saída é medir o que o teste não mede, a contagem de consultas por requisição, corrigir trocando o laço por carregamento em lote e carregadores com escopo de requisição, e travar a correção com um teste que falha quando a contagem cresce com o número de linhas. Com um seed que tem a forma dos dados reais e um alerta sobre a contagem, o próximo N+1 aparece no CI ou no primeiro minuto depois do deploy, e não no horário de pico do maior cliente.',
    cta: 'Falar sobre as consultas do meu sistema',
  },
  related: [
    {
      label: 'Teste de carga que mente: por que o ensaio passa e a produção cai no mesmo volume',
      to: '/blog/teste-de-carga-que-mente-ensaio-passa-e-producao-cai-no-mesmo-volume',
    },
    {
      label: 'Paginação por offset em tabela grande: quando a página 500 derruba o banco',
      to: '/blog/paginacao-offset-tabela-grande-pagina-500-derruba-banco',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A building materials distributor shipped a new daily orders screen: a list of orders with the customer, the items, each item\'s product and the latest delivery status. In tests, with a 10-order seed, the page responded in 40 milliseconds. In staging, in 180. In production, for the customer that sold the most, it took 6 seconds at peak time and took other screens down with it, because it exhausted the connection pool. The code did not change between environments. What changed was the size of the data and the distance to the database: the screen ran one query per order, per item and per event, 51 queries with the seed and 1,201 with real data, each one paying a network round trip. This article shows why N+1 is a defect that unit tests cannot see, how to measure it per request and from the database side, how to fix it with batch loading, where it hides when the loop is not in your code, and how to write the test that keeps it from coming back.',
  sections: [
    {
      title: 'Why the test passes: N+1 is a function of the data, not of the code',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The pattern is always the same: one query fetches the list and, for each row, another query fetches something related. With N rows and k relations, the total is 1 + N × k queries. In a unit test, N is small because the seed is small, and each query costs a fraction of a millisecond because the database runs on the same machine. In production, N is whatever the customer has, and each query pays the round trip to the managed database, which lives on another machine, in another zone, 0.5 to 2 milliseconds away. Since the queries run serially inside the loop, that time adds up instead of overlapping.',
        },
        {
          type: 'paragraph',
          value:
            'That is why the problem is invisible in tests and staging and shows up in production. Nothing fails: the result is correct, the test passes, code review does not see any slow query because there is no slow query. There are a thousand fast ones. The example below is the screen from the case, in Node with the pg driver, and it applies equally to any ORM that lazy-loads relations.',
        },
        { type: 'code', value: naiveCode },
        {
          type: 'table',
          columns: ['Environment', 'Orders per page', 'Items per order', 'Queries', 'Round trip to the database', 'Network time alone'],
          rows: [
            ['Local test (seed)', '10', '2', '51', '0.1 ms', '5 ms'],
            ['Staging', '30', '4', '211', '0.4 ms', '84 ms'],
            ['Production, average customer', '100', '9', '1,201', '0.8 ms', '961 ms'],
            ['Production, peak, contended pool of 10', '100', '9', '1,201', '0.8 ms + waiting for a connection', '3 to 6 s'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row explains the worst part of the incident. Each of the 1,201 queries takes a connection from the pool, uses it for under a millisecond and gives it back. With 40 users opening the screen in the same minute, that is 48 thousand connection requests competing for 10 slots. The other screens, which run 3 queries and should answer in 20 milliseconds, wait in line behind them. One screen\'s N+1 becomes everyone\'s latency.',
        },
      ],
    },
    {
      title: 'Seeing the problem: count queries per request and read the database the right way around',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Average latency and slow query logs do not show N+1, because no query is slow. The metric that shows it is the number of queries per request. It is cheap to produce: one context per request with AsyncLocalStorage and a wrapper around the driver\'s query method. The result goes to a histogram per route and to the log when it crosses a ceiling. A healthy route runs between 1 and 10 queries per request. A route running 400 is looping over data.',
        },
        { type: 'code', value: counterCode },
        {
          type: 'paragraph',
          value:
            'With the metric on, the screen from the case shows up within minutes: the orders route averages 1,150 queries per request, with a p99 above 3,000 for large customers, while every other route stays under 12. If the ORM is Prisma, its query event serves the same purpose; in Sequelize and TypeORM, the query logger receives one call per statement and can add to the same context.',
        },
        {
          type: 'paragraph',
          value:
            'On the database side, N+1 also has a signature, but it only appears when the pg_stat_statements extension is sorted by number of calls rather than by mean time. A primary key lookup averaging 0.3 milliseconds with 4 million calls in a day is the proof: nobody writes a query like that outside a loop.',
        },
        { type: 'code', value: pgStatCode },
      ],
    },
    {
      title: 'Fixing it: replace the loop with batch loading',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The fix is not making each query faster, it is running fewer queries. Instead of fetching each order\'s customer, fetch at once every customer whose id appears on the page, with WHERE id = ANY($1), and build an in-memory map to join them. Same for items, events and products. The total stops being 1 + N × k and becomes 1 + k: one query per relation, regardless of how many rows the page has.',
        },
        { type: 'code', value: batchCode },
        { type: 'diagram', value: waterfallDiagram },
        {
          type: 'paragraph',
          value:
            'Three details matter. The first is removing duplicate ids before querying: 100 orders from 12 customers become a list of 12 ids, not 100. The second is that independent relations can run in parallel with Promise.all, using separate pool connections, while chained relations, such as product depending on item, wait for the previous round. The third is the size of the list: ANY with 100 ids is trivial, but with 50 thousand ids the planner loses efficiency and the network packet grows. When the page can be large, split the list into chunks of about a thousand ids per query.',
        },
        {
          type: 'paragraph',
          value:
            'This pattern is what ORMs call eager loading: include in Prisma, with in most query builders, eager loading in Sequelize and Hibernate. Underneath, they generate exactly these batch queries. What the ORM does not do is force you to use them, and any access to a relation that was not loaded inside a loop goes back to firing one query per row.',
        },
      ],
    },
    {
      title: 'The N+1 that is not in your loop: ORM, serializer and the "latest event"',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most treacherous case is the loop you did not write. A serializer that reads order.customer.name to build the JSON, a template that iterates items and prints item.product.sku, a GraphQL resolver that resolves the customer field of every Order. In all those places the code looks innocent, because the query is fired by the ORM\'s lazy getter or by the resolution engine, and the loop is the framework walking the list.',
        },
        {
          type: 'paragraph',
          value:
            'When you cannot control who calls, the solution is a request-scoped batch loader, the pattern popularized by DataLoader. Each call registers the id it wants and gets a promise; at the end of the tick, every pending promise is fulfilled with a single query. The resolvers keep asking for one customer per order, but the database receives one query per page.',
        },
        { type: 'code', value: loaderCode },
        {
          type: 'paragraph',
          value:
            'The cache has to live inside the request and die with it. A global loader shared across requests would hand one user\'s data to another and would never see updates. That is why it is created in each request\'s context, alongside the connection or transaction it will use.',
        },
        {
          type: 'paragraph',
          value:
            'Then there is the N+1 that survives even include: the per-row computed field. Each order\'s "latest delivery event" is a query with ORDER BY and LIMIT 1 that ordinary eager loading does not cover, and so it outlives the first round of fixes. In PostgreSQL, DISTINCT ON (pedido_id) with ORDER BY pedido_id, ocorrido_em DESC returns the most recent event of each order in one query, as in the batch example above. In other databases, a window function with ROW_NUMBER() OVER (PARTITION BY pedido_id ORDER BY ocorrido_em DESC) filtered to 1 does the same. In both cases the composite index (pedido_id, ocorrido_em DESC) is what turns that query into a short read per order instead of a scan of the whole history.',
        },
      ],
    },
    {
      title: 'Keeping it from coming back: the test that counts queries and the seed that looks like production',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Fixing the screen resolves the incident. Keeping the next screen from being born with the same defect requires a test that fails when the number of queries depends on the number of rows. The test does not assert a magic number; it runs the function with 5 orders and with 100, and asserts that the count was the same. That assertion is stable, survives refactoring and fails exactly when someone adds a lazy access inside the loop.',
        },
        { type: 'code', value: testCode },
        {
          type: 'paragraph',
          value:
            'The second mechanism is the seed. A staging environment with 10 orders of 2 items rehearses nothing: it is the reason N+1 reaches production. The seed needs the shape of the real data, especially the cardinality of the relations: how many items per order, how many events per order, how many orders per customer at the high percentile. It does not need production volume for that; it needs the distribution. With 200 orders of 9 items and 15 events, the screen in staging would already run 2,400 queries and the problem would be seen before the deploy.',
        },
        {
          type: 'table',
          columns: ['Signal', 'Where to see it', 'Suggested threshold'],
          rows: [
            ['Queries per request', 'Per-route histogram from the middleware', 'Alert above 30 on the same route; investigate any route with p99 above 50'],
            ['High call count with low mean time', 'pg_stat_statements sorted by calls', 'More than 10 thousand calls per minute with a mean under 1 ms'],
            ['Database time relative to response time', 'Request trace', 'More than 70% of the time in queries under 2 ms each'],
            ['Same count with small N and large N', 'Test in CI', 'Fail if the count with 100 rows is higher than with 5'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'In production, the right alert is on the count per request, not on latency. Latency only rises once the pool is already contended, and by then several screens are slow. The count rises on the first request after the deploy, for the first large customer, before any user complains.',
        },
      ],
    },
    {
      title: 'Choosing between batch, JOIN, loader and cache',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Not every relation is solved the same way, and the wrong choice trades one problem for another. A single JOIN brings everything in one query, but in one-to-many relations it repeats the parent\'s columns on every child row: 100 orders with 9 items become 900 rows with the customer name repeated 900 times, and with two independent children in the same JOIN the cartesian product multiplies again. Batching per table costs one extra query per relation and transfers each row once.',
        },
        {
          type: 'table',
          columns: ['Approach', 'Queries', 'When to use it', 'Watch out for'],
          rows: [
            ['Query per row inside the loop', '1 + N × k', 'Only when N is bounded by the code and small, for example a customer\'s 3 addresses', 'Grows with the data; never in a listing paginated by customer volume'],
            ['Batch per table with WHERE id = ANY', '1 + k', 'Default for lists with one-to-many and many-to-one relations', 'Remove duplicate ids; split lists above roughly a thousand ids'],
            ['Single JOIN', '1', 'One-to-one and many-to-one relations with few columns', 'In one-to-many it multiplies rows and bytes; two children in the same JOIN become a cartesian product'],
            ['Request-scoped batch loader', '1 + k per request', 'GraphQL, serializers and ORM getters, where the loop is not yours', 'Cache only within the request; create it in the context, never globally'],
            ['Application cache', '0 on a hit', 'Stable, small data, such as a product catalog', 'Does not fix the query; the whole N+1 comes back on the first cache miss'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A practical rule: for listings, batch per table by default, JOIN for many-to-one relations with few columns, a loader when the framework is the one walking the list. Cache comes after the fix, never instead of it, because a cache hiding an N+1 turns an invalidation or a restart into an incident.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Doesn\'t the ORM solve this by itself with eager loading?',
      answer:
        'It solves the relations you ask for explicitly with include, with or the equivalent, and generates the batch queries underneath. But it does not prevent lazy access: any relation that was not included and gets touched inside a loop, a serializer or a template goes back to firing one query per row. Some ORMs let you disable lazy loading or make it throw in production, and that setting is worth it: it turns a silent N+1 into an exception the test catches.',
    },
    {
      question: 'Isn\'t a single JOIN always better than several batch queries?',
      answer:
        'No. In many-to-one relations with few columns, the JOIN is great and saves a round trip. In one-to-many relations, it repeats the parent\'s columns on every child row and, with two independent children, multiplies the rows by the product of the cardinalities. Batching per table costs one extra query per relation, usually under a millisecond each, and transfers each row exactly once. The difference between 5 and 1 queries is irrelevant; the difference between 5 and 1,201 is the incident.',
    },
    {
      question: 'Is it worth putting a cache in front instead of fixing the query?',
      answer:
        'Cache after the fix, not instead of it. A cache hiding an N+1 keeps the screen fast while it hits, and hands back all 1,201 queries at once on every cache miss, mass invalidation or service restart, exactly when the system is most fragile. Fix it first so the screen runs 5 queries, then decide whether the product catalog, which rarely changes, deserves a cache to cut one of them.',
    },
  ],
  conclusion: {
    title: 'N+1 is measured in queries per request, not in latency',
    description:
      'The screen that is fast in tests and slow in production has no logic bug: it has a loop whose cost depends on the customer\'s data and on the distance to the database, two things the test environment does not reproduce. The way out is to measure what the test does not measure, the query count per request, to fix it by replacing the loop with batch loading and request-scoped loaders, and to lock the fix in with a test that fails when the count grows with the number of rows. With a seed shaped like real data and an alert on the count, the next N+1 shows up in CI or in the first minute after the deploy, not at the biggest customer\'s peak hour.',
    cta: 'Talk about my system\'s queries',
  },
  related: [
    {
      label: 'The load test that lies: why the rehearsal passes and production falls at the same volume',
      to: '/blog/teste-de-carga-que-mente-ensaio-passa-e-producao-cai-no-mesmo-volume',
    },
    {
      label: 'Offset pagination on a large table: when page 500 takes down the database',
      to: '/blog/paginacao-offset-tabela-grande-pagina-500-derruba-banco',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/services/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Una distribuidora de materiales de construcción lanzó la nueva pantalla de pedidos del día: lista de pedidos con cliente, artículos, producto de cada artículo y último estado de entrega. En pruebas, con el seed de 10 pedidos, la página respondía en 40 milisegundos. En staging, en 180. En producción, para el cliente que más vendía, tardaba 6 segundos en hora punta y tumbaba otras pantallas con ella, porque agotaba el pool de conexiones. El código no cambió entre entornos. Lo que cambió fue el tamaño de los datos y la distancia hasta la base de datos: la pantalla hacía una consulta por pedido, por artículo y por evento, 51 consultas con el seed y 1.201 con datos reales, cada una pagando un viaje de ida y vuelta por la red. Este artículo muestra por qué el N+1 es un defecto que las pruebas unitarias no ven, cómo medirlo por petición y desde la base de datos, cómo corregirlo con carga por lotes, dónde se esconde cuando el bucle no está en tu código y cómo escribir la prueba que impide que vuelva.',
  sections: [
    {
      title: 'Por qué la prueba pasa: el N+1 depende de los datos, no del código',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El patrón es siempre el mismo: una consulta trae la lista y, por cada fila, otra consulta trae algo relacionado. Con N filas y k relaciones, el total es 1 + N × k consultas. En una prueba unitaria, N es pequeño porque el seed es pequeño, y cada consulta cuesta fracciones de milisegundo porque la base de datos corre en la misma máquina. En producción, N es lo que tenga el cliente, y cada consulta paga el viaje de ida y vuelta hasta la base de datos gestionada, que está en otra máquina, en otra zona, a 0,5 o 2 milisegundos de distancia. Como las consultas ocurren en serie dentro del bucle, ese tiempo se suma, no se solapa.',
        },
        {
          type: 'paragraph',
          value:
            'Por eso el problema es invisible en pruebas y en staging y aparece en producción. Nada falla: el resultado es correcto, la prueba pasa, la revisión de código no ve ninguna consulta lenta porque no existe ninguna consulta lenta. Existen mil consultas rápidas. El ejemplo de abajo es la pantalla del caso, en Node con el driver pg, y vale igual para cualquier ORM que cargue relaciones de forma perezosa.',
        },
        { type: 'code', value: naiveCode },
        {
          type: 'table',
          columns: ['Entorno', 'Pedidos por página', 'Artículos por pedido', 'Consultas', 'Ida y vuelta a la base de datos', 'Tiempo solo de red'],
          rows: [
            ['Prueba local (seed)', '10', '2', '51', '0,1 ms', '5 ms'],
            ['Staging', '30', '4', '211', '0,4 ms', '84 ms'],
            ['Producción, cliente medio', '100', '9', '1.201', '0,8 ms', '961 ms'],
            ['Producción, hora punta, pool de 10 disputado', '100', '9', '1.201', '0,8 ms + espera por conexión', '3 a 6 s'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila explica la parte más grave del incidente. Cada una de las 1.201 consultas toma una conexión del pool, la usa durante menos de un milisegundo y la devuelve. Con 40 usuarios abriendo la pantalla en el mismo minuto, son 48 mil peticiones de conexión disputándose 10 plazas. Las otras pantallas, que hacen 3 consultas y deberían responder en 20 milisegundos, se quedan en la cola detrás de ellas. El N+1 de una pantalla se convierte en la latencia de todas.',
        },
      ],
    },
    {
      title: 'Ver el problema: contar consultas por petición y leer la base de datos por el lado correcto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La latencia media y las consultas lentas no muestran el N+1, porque ninguna consulta es lenta. La métrica que lo muestra es el número de consultas por petición. Es barata de producir: un contexto por petición con AsyncLocalStorage y un envoltorio alrededor del método de consulta del driver. El resultado va a un histograma por ruta y al log cuando supera un techo. Una ruta sana hace entre 1 y 10 consultas por petición. Una ruta con 400 está haciendo un bucle sobre datos.',
        },
        { type: 'code', value: counterCode },
        {
          type: 'paragraph',
          value:
            'Con la métrica activada, la pantalla del caso aparece en minutos: la ruta de pedidos hace, de media, 1.150 consultas por petición, con un p99 por encima de 3.000 para los clientes grandes, mientras todas las demás rutas se quedan por debajo de 12. Si el ORM es Prisma, su evento de query sirve para lo mismo; en Sequelize y TypeORM, el logger de consultas recibe una llamada por sentencia y puede sumar en el mismo contexto.',
        },
        {
          type: 'paragraph',
          value:
            'Del lado de la base de datos, el N+1 también tiene firma, pero solo aparece cuando la extensión pg_stat_statements se ordena por número de llamadas y no por tiempo medio. Una consulta por clave primaria con una media de 0,3 milisegundos y 4 millones de llamadas al día es la prueba: nadie escribe una consulta así fuera de un bucle.',
        },
        { type: 'code', value: pgStatCode },
      ],
    },
    {
      title: 'Corregir: cambiar el bucle por carga por lotes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La corrección no es hacer cada consulta más rápida, es hacer menos consultas. En lugar de buscar el cliente de cada pedido, se buscan de una vez todos los clientes cuyos ids aparecen en la página, con WHERE id = ANY($1), y se monta un mapa en memoria para asociarlos. Lo mismo para artículos, eventos y productos. El total deja de ser 1 + N × k y pasa a ser 1 + k: una consulta por relación, sin importar cuántas filas tenga la página.',
        },
        { type: 'code', value: batchCode },
        { type: 'diagram', value: waterfallDiagram },
        {
          type: 'paragraph',
          value:
            'Tres detalles marcan la diferencia. El primero es eliminar los ids repetidos antes de consultar: 100 pedidos de 12 clientes se convierten en una lista de 12 ids, no de 100. El segundo es que las relaciones independientes pueden ir en paralelo con Promise.all, usando conexiones distintas del pool, mientras que las relaciones encadenadas, como producto que depende de artículo, esperan a la ronda anterior. El tercero es el tamaño de la lista: ANY con 100 ids es trivial, pero con 50 mil ids el planificador pierde eficiencia y el paquete de red crece. Cuando la página puede ser grande, divide la lista en bloques de alrededor de mil ids por consulta.',
        },
        {
          type: 'paragraph',
          value:
            'Este patrón es lo que los ORM llaman carga anticipada: include en Prisma, with en la mayoría de los query builders, eager loading en Sequelize y en Hibernate. Por debajo, generan exactamente estas consultas por lotes. Lo que el ORM no hace es obligarte a usarlas, y cualquier acceso a una relación no cargada dentro de un bucle vuelve a disparar una consulta por fila.',
        },
      ],
    },
    {
      title: 'El N+1 que no está en tu bucle: ORM, serializador y el "último evento"',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El caso más traicionero es el bucle que tú no escribiste. Un serializador que accede a pedido.cliente.nombre para montar el JSON, una plantilla que recorre artículos e imprime articulo.producto.sku, un resolver de GraphQL que resuelve el campo cliente de cada Pedido. En todos esos lugares el código parece inocente, porque la consulta la dispara el getter perezoso del ORM o el motor de resolución, y el bucle es el framework recorriendo la lista.',
        },
        {
          type: 'paragraph',
          value:
            'Cuando no puedes controlar quién llama, la solución es un cargador por lotes con alcance de petición, el patrón que popularizó DataLoader. Cada llamada registra el id que quiere y recibe una promesa; al final del tick, todas las promesas pendientes se resuelven con una única consulta. Los resolvers siguen pidiendo un cliente por pedido, pero la base de datos recibe una consulta por página.',
        },
        { type: 'code', value: loaderCode },
        {
          type: 'paragraph',
          value:
            'La caché tiene que vivir dentro de la petición y morir con ella. Un cargador global, compartido entre peticiones, devolvería datos de un usuario a otro y nunca vería las actualizaciones. Por eso se crea en el contexto de cada petición, junto con la conexión o la transacción que va a usar.',
        },
        {
          type: 'paragraph',
          value:
            'Queda además el N+1 que sobrevive incluso con include: el campo calculado por fila. El "último evento de entrega" de cada pedido es una consulta con ORDER BY y LIMIT 1 que la carga anticipada habitual no cubre, y que por eso sobrevive a la primera ronda de corrección. En PostgreSQL, DISTINCT ON (pedido_id) con ORDER BY pedido_id, ocorrido_em DESC devuelve el más reciente de cada pedido en una sola consulta, como en el ejemplo por lotes de arriba. En otras bases de datos, una función de ventana con ROW_NUMBER() OVER (PARTITION BY pedido_id ORDER BY ocorrido_em DESC) filtrada a 1 hace lo mismo. En ambos casos el índice compuesto (pedido_id, ocorrido_em DESC) es lo que convierte esa consulta en una lectura corta por pedido en lugar de un barrido de todo el historial.',
        },
      ],
    },
    {
      title: 'Impedir que vuelva: la prueba que cuenta consultas y el seed que se parece a producción',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Corregir la pantalla resuelve el incidente. Impedir que la próxima pantalla nazca con el mismo defecto exige una prueba que falle cuando el número de consultas dependa del número de filas. La prueba no afirma un número mágico; ejecuta la función con 5 pedidos y con 100, y afirma que el recuento fue el mismo. Esa afirmación es estable, sobrevive a las refactorizaciones y falla exactamente cuando alguien añade un acceso perezoso dentro del bucle.',
        },
        { type: 'code', value: testCode },
        {
          type: 'paragraph',
          value:
            'El segundo mecanismo es el seed. Un entorno de staging con 10 pedidos de 2 artículos no ensaya nada: es el motivo de que el N+1 llegue a producción. El seed necesita tener la forma de los datos reales, en especial la cardinalidad de las relaciones: cuántos artículos por pedido, cuántos eventos por pedido, cuántos pedidos por cliente en el percentil alto. No necesita el volumen de producción para eso; necesita la distribución. Con 200 pedidos de 9 artículos y 15 eventos, la pantalla en staging ya haría 2.400 consultas y el problema se vería antes del despliegue.',
        },
        {
          type: 'table',
          columns: ['Señal', 'Dónde verla', 'Umbral sugerido'],
          rows: [
            ['Consultas por petición', 'Histograma por ruta del middleware', 'Alertar por encima de 30 en la misma ruta; investigar cualquier ruta con p99 por encima de 50'],
            ['Muchas llamadas con tiempo medio bajo', 'pg_stat_statements ordenado por calls', 'Más de 10 mil llamadas por minuto con media por debajo de 1 ms'],
            ['Tiempo de base de datos respecto al tiempo de respuesta', 'Traza de la petición', 'Más del 70% del tiempo en consultas de menos de 2 ms cada una'],
            ['Mismo recuento con N pequeño y N grande', 'Prueba en CI', 'Fallar si el recuento con 100 filas es mayor que con 5'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'En producción, la alerta correcta es sobre el recuento por petición, no sobre la latencia. La latencia solo sube cuando el pool ya está disputado, y para entonces varias pantallas están lentas. El recuento sube en la primera petición después del despliegue, para el primer cliente grande, antes de que ningún usuario se queje.',
        },
      ],
    },
    {
      title: 'Decidir entre lote, JOIN, cargador y caché',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No todas las relaciones se resuelven igual, y la elección equivocada cambia un problema por otro. Un JOIN único trae todo en una consulta, pero en relaciones uno a muchos repite las columnas del padre en cada fila del hijo: 100 pedidos con 9 artículos se convierten en 900 filas con el nombre del cliente repetido 900 veces, y con dos hijos independientes en el mismo JOIN el producto cartesiano multiplica otra vez. El lote por tabla cuesta una consulta más por relación y transfiere cada fila una sola vez.',
        },
        {
          type: 'table',
          columns: ['Enfoque', 'Consultas', 'Cuándo usarlo', 'Cuidado'],
          rows: [
            ['Consulta por fila dentro del bucle', '1 + N × k', 'Solo cuando N está acotado por el código y es pequeño, por ejemplo las 3 direcciones de un cliente', 'Crece con los datos; nunca en un listado paginado por volumen del cliente'],
            ['Lote por tabla con WHERE id = ANY', '1 + k', 'Opción por defecto para listas con relaciones uno a muchos y muchos a uno', 'Eliminar ids repetidos; dividir listas por encima de unos mil ids'],
            ['JOIN único', '1', 'Relaciones uno a uno y muchos a uno con pocas columnas', 'En uno a muchos multiplica filas y bytes; dos hijos en el mismo JOIN se convierten en producto cartesiano'],
            ['Cargador por lotes por petición', '1 + k por petición', 'GraphQL, serializadores y getters de ORM, donde el bucle no es tuyo', 'Caché solo dentro de la petición; crearlo en el contexto, nunca global'],
            ['Caché de aplicación', '0 en acierto', 'Datos estables y pequeños, como el catálogo de productos', 'No corrige la consulta; el N+1 vuelve entero en el primer fallo de caché'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Una regla práctica: para listados, lote por tabla por defecto, JOIN para las relaciones muchos a uno con pocas columnas, cargador cuando el framework es quien recorre la lista. La caché entra después de la corrección, nunca en su lugar, porque una caché que esconde un N+1 convierte una invalidación o un reinicio en un incidente.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿El ORM no resuelve esto solo con eager loading?',
      answer:
        'Resuelve las relaciones que pides explícitamente con include, with o el equivalente, y genera las consultas por lotes por debajo. Pero no impide el acceso perezoso: cualquier relación no incluida que se toque dentro de un bucle, en un serializador o en una plantilla vuelve a disparar una consulta por fila. Algunos ORM permiten desactivar la carga perezosa o hacer que lance un error en producción, y esa configuración merece la pena: convierte un N+1 silencioso en una excepción que la prueba atrapa.',
    },
    {
      question: '¿Un JOIN único no es siempre mejor que varias consultas por lotes?',
      answer:
        'No. En relaciones muchos a uno con pocas columnas, el JOIN es excelente y ahorra un viaje a la base de datos. En relaciones uno a muchos, repite las columnas del padre en cada fila del hijo y, con dos hijos independientes, multiplica las filas por el producto de las cardinalidades. El lote por tabla cuesta una consulta más por relación, normalmente por debajo de un milisegundo cada una, y transfiere cada fila exactamente una vez. La diferencia entre 5 y 1 consulta es irrelevante; la diferencia entre 5 y 1.201 es el incidente.',
    },
    {
      question: '¿Merece la pena poner una caché delante en lugar de corregir la consulta?',
      answer:
        'Caché después de la corrección, no en su lugar. Una caché que esconde un N+1 mantiene la pantalla rápida mientras acierta, y devuelve las 1.201 consultas de golpe en cada fallo de caché, invalidación masiva o reinicio del servicio, justo cuando el sistema está más frágil. Corrige primero para que la pantalla haga 5 consultas, y entonces decide si el catálogo de productos, que cambia poco, merece una caché para ahorrarse una de ellas.',
    },
  ],
  conclusion: {
    title: 'El N+1 se mide en consultas por petición, no en latencia',
    description:
      'La pantalla rápida en pruebas y lenta en producción no tiene un bug de lógica: tiene un bucle cuyo coste depende de los datos del cliente y de la distancia hasta la base de datos, dos cosas que el entorno de pruebas no reproduce. La salida es medir lo que la prueba no mide, el recuento de consultas por petición, corregir cambiando el bucle por carga por lotes y cargadores con alcance de petición, y fijar la corrección con una prueba que falla cuando el recuento crece con el número de filas. Con un seed que tiene la forma de los datos reales y una alerta sobre el recuento, el próximo N+1 aparece en el CI o en el primer minuto después del despliegue, y no en la hora punta del cliente más grande.',
    cta: 'Hablar sobre las consultas de mi sistema',
  },
  related: [
    {
      label: 'La prueba de carga que miente: por qué el ensayo pasa y la producción cae con el mismo volumen',
      to: '/blog/teste-de-carga-que-mente-ensaio-passa-e-producao-cai-no-mesmo-volume',
    },
    {
      label: 'Paginación por offset en una tabla grande: cuándo la página 500 tumba la base de datos',
      to: '/blog/paginacao-offset-tabela-grande-pagina-500-derruba-banco',
    },
    {
      label: 'Arquitectura y modernización de backend',
      to: '/servicios/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
