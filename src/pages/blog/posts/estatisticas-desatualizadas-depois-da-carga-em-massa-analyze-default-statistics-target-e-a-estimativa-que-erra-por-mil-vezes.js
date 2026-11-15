// Conteudo do artigo: estatisticas desatualizadas depois da carga em massa. Como o planejador
// estima linhas a partir de reltuples, MCV, histograma e n_distinct, por que o autoanalyze nao
// roda depois de uma importacao abaixo de 10% da tabela, quais tabelas ele nunca analisa, como
// colocar ANALYZE dentro do job de carga e quando ajustar default_statistics_target,
// SET STATISTICS e estatisticas estendidas.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const comments = {
  pt: {
    plan1: 'Antes do ANALYZE: o planejador espera 2.304 linhas e escolhe nested loop.',
    plan2: 'Real: 3.912.455 linhas, e o índice de pedido_itens é consultado 3,9 milhões de vezes.',
    plan3: 'Depois do ANALYZE: estimativa na ordem certa e hash join.',
    st1: 'O que o planejador sabe sobre cliente_id.',
    st2: 'Estimativa para um valor fora da lista de MCV:',
    st3: '(1 - null_frac - soma_freq_mcv) / (n_distinct - qtd_mcv) x linhas da tabela',
    st4: 'cerca de 2.300 linhas, contra 3,9 milhões reais',
    st5: 'Quando o autoanalyze vai rodar nesta tabela.',
    load1: 'Carga e ANALYZE na mesma transação: quem consultar depois do COMMIT já encontra estatística nova.',
    load2: 'ANALYZE enxerga as linhas inseridas pela própria transação e não bloqueia leitura nem escrita.',
    load3: 'Sem coluna listada: atualiza todas as colunas e as estatísticas estendidas da tabela.',
    load4: 'Tabela temporária: o autovacuum nunca a analisa, então o ANALYZE é obrigatório.',
    load5: 'Agora a consulta pesada roda com estimativa correta.',
    tune1: 'Autoanalyze por tabela: 1% de mudança ou 50 mil linhas, o que vier primeiro.',
    tune2: 'Mais amostra e mais MCV só na coluna com distribuição muito desigual.',
    tune3: 'Correlação entre colunas: o planejador para de multiplicar seletividades como se fossem independentes.',
    tune4: 'Toda mudança de alvo ou estatística nova só vale depois do próximo ANALYZE.',
    tune5: 'Tabela particionada: o autovacuum analisa as partições, mas nunca o pai.',
    mon1: 'Tabelas com muita mudança desde o último ANALYZE, ordenadas pelo percentual.',
    mon2: 'Limite efetivo de autoanalyze, considerando os parâmetros globais.',
  },
  en: {
    plan1: 'Before ANALYZE: the planner expects 2,304 rows and picks a nested loop.',
    plan2: 'Actual: 3,912,455 rows, and the pedido_itens index is probed 3.9 million times.',
    plan3: 'After ANALYZE: the estimate has the right magnitude and the plan uses a hash join.',
    st1: 'What the planner knows about cliente_id.',
    st2: 'Estimate for a value that is not in the MCV list:',
    st3: '(1 - null_frac - sum_mcv_freq) / (n_distinct - mcv_count) x table rows',
    st4: 'about 2,300 rows, against 3.9 million actual rows',
    st5: 'When autoanalyze is going to run on this table.',
    load1: 'Load and ANALYZE in the same transaction: anyone querying after COMMIT already sees fresh statistics.',
    load2: 'ANALYZE sees the rows inserted by its own transaction and does not block reads or writes.',
    load3: 'No column list: updates every column and the extended statistics of the table.',
    load4: 'Temporary table: autovacuum never analyzes it, so ANALYZE is mandatory.',
    load5: 'Now the heavy query runs with a correct estimate.',
    tune1: 'Per table autoanalyze: 1% of changes or 50 thousand rows, whichever comes first.',
    tune2: 'Larger sample and more MCVs only on the column with a very skewed distribution.',
    tune3: 'Correlated columns: the planner stops multiplying selectivities as if they were independent.',
    tune4: 'Any target change or new statistics object only takes effect after the next ANALYZE.',
    tune5: 'Partitioned table: autovacuum analyzes the partitions, but never the parent.',
    mon1: 'Tables with many changes since the last ANALYZE, ordered by percentage.',
    mon2: 'Effective autoanalyze threshold, using the global parameters.',
  },
  es: {
    plan1: 'Antes del ANALYZE: el planificador espera 2.304 filas y elige nested loop.',
    plan2: 'Real: 3.912.455 filas, y el índice de pedido_itens se consulta 3,9 millones de veces.',
    plan3: 'Después del ANALYZE: estimación en el orden correcto y hash join.',
    st1: 'Lo que el planificador sabe sobre cliente_id.',
    st2: 'Estimación para un valor que no está en la lista de MCV:',
    st3: '(1 - null_frac - suma_frec_mcv) / (n_distinct - cant_mcv) x filas de la tabla',
    st4: 'unas 2.300 filas, contra 3,9 millones reales',
    st5: 'Cuándo va a ejecutarse el autoanalyze en esta tabla.',
    load1: 'Carga y ANALYZE en la misma transacción: quien consulte después del COMMIT ya encuentra estadísticas nuevas.',
    load2: 'ANALYZE ve las filas insertadas por su propia transacción y no bloquea lecturas ni escrituras.',
    load3: 'Sin lista de columnas: actualiza todas las columnas y las estadísticas extendidas de la tabla.',
    load4: 'Tabla temporal: el autovacuum nunca la analiza, así que el ANALYZE es obligatorio.',
    load5: 'Ahora la consulta pesada se ejecuta con una estimación correcta.',
    tune1: 'Autoanalyze por tabla: 1% de cambios o 50 mil filas, lo que ocurra primero.',
    tune2: 'Más muestra y más MCV solo en la columna con distribución muy desigual.',
    tune3: 'Columnas correlacionadas: el planificador deja de multiplicar selectividades como si fueran independientes.',
    tune4: 'Cualquier cambio de objetivo o estadística nueva solo vale después del próximo ANALYZE.',
    tune5: 'Tabla particionada: el autovacuum analiza las particiones, pero nunca la tabla padre.',
    mon1: 'Tablas con muchos cambios desde el último ANALYZE, ordenadas por porcentaje.',
    mon2: 'Umbral efectivo de autoanalyze, usando los parámetros globales.',
  },
};

const planCode = (c) => `EXPLAIN (ANALYZE, BUFFERS)
SELECT i.sku, sum(i.quantidade) AS unidades, sum(i.total) AS receita
  FROM pedidos p
  JOIN pedido_itens i ON i.pedido_id = p.id
 WHERE p.cliente_id = 9123
 GROUP BY i.sku;

-- ${c.plan1}
-- ${c.plan2}
HashAggregate  (rows=2304) (actual time=2463102.338..2463551.244 rows=48211 loops=1)
  ->  Nested Loop  (rows=6912) (actual time=0.061..2461308.114 rows=11734870 loops=1)
        ->  Index Scan using pedidos_cliente_idx on pedidos p
              (rows=2304) (actual time=0.031..9120.556 rows=3912455 loops=1)
              Index Cond: (cliente_id = 9123)
        ->  Index Scan using pedido_itens_pedido_idx on pedido_itens i
              (rows=3) (actual time=0.412..0.624 rows=3 loops=3912455)
              Index Cond: (pedido_id = p.id)
Execution Time: 2463551.870 ms

-- ${c.plan3}
HashAggregate  (rows=51000) (actual time=47920.114..48102.630 rows=48211 loops=1)
  ->  Hash Join  (rows=11790000) (actual time=3412.880..44016.301 rows=11734870 loops=1)
        Hash Cond: (i.pedido_id = p.id)
        ->  Seq Scan on pedido_itens i  (rows=131200000) (actual ... rows=131184020 loops=1)
        ->  Hash  (rows=3930000) (actual ... rows=3912455 loops=1)
              ->  Index Scan using pedidos_cliente_idx on pedidos p  (rows=3930000) ...
Execution Time: 48102.630 ms`;

const statsCode = (c) => `-- ${c.st1}
SELECT null_frac,
       n_distinct,
       array_length(most_common_freqs, 1)                AS qtd_mcv,
       (SELECT sum(f) FROM unnest(most_common_freqs) f)  AS soma_freq_mcv,
       9123 = ANY (most_common_vals::text::bigint[])     AS cliente_no_mcv
  FROM pg_stats
 WHERE schemaname = 'public'
   AND tablename = 'pedidos'
   AND attname = 'cliente_id';
-- null_frac 0 | n_distinct 18400 | qtd_mcv 100 | soma_freq_mcv 0.041 | cliente_no_mcv false

-- ${c.st2}
-- ${c.st3}
-- (1 - 0 - 0.041) / (18400 - 100) x 44.000.000 = ${c.st4}

-- ${c.st5}
SELECT s.n_mod_since_analyze,
       50 + 0.1 * c.reltuples AS limite_autoanalyze,
       greatest(s.last_analyze, s.last_autoanalyze) AS ultimo_analyze
  FROM pg_stat_user_tables s
  JOIN pg_class c ON c.oid = s.relid
 WHERE s.relname = 'pedidos';
-- n_mod_since_analyze 3912455 | limite_autoanalyze 4010050 | ultimo_analyze 2026-10-28 03:12`;

const loadCode = (c) => `// importar-pedidos.js
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function importarPedidos(arquivoCsv, clienteId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '30min'");

    await pipeline(
      createReadStream(arquivoCsv),
      client.query(
        copyFrom(
          'COPY pedidos (cliente_id, status, criado_em, total) FROM STDIN WITH (FORMAT csv, HEADER true)',
        ),
      ),
    );

    // ${c.load1}
    // ${c.load2}
    // ${c.load3}
    await client.query('ANALYZE pedidos');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await consolidarCliente(clienteId);
}

async function consolidarCliente(clienteId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'CREATE TEMP TABLE pedidos_cliente (id bigint PRIMARY KEY, total numeric(14, 2)) ON COMMIT DROP',
    );
    await client.query(
      'INSERT INTO pedidos_cliente (id, total) SELECT id, total FROM pedidos WHERE cliente_id = $1',
      [clienteId],
    );
    // ${c.load4}
    await client.query('ANALYZE pedidos_cliente');

    // ${c.load5}
    await client.query(
      \`INSERT INTO resumo_sku (cliente_id, sku, unidades, receita)
       SELECT $1::bigint, i.sku, sum(i.quantidade), sum(i.total)
         FROM pedidos_cliente p
         JOIN pedido_itens i ON i.pedido_id = p.id
        GROUP BY i.sku
       ON CONFLICT (cliente_id, sku)
       DO UPDATE SET unidades = EXCLUDED.unidades, receita = EXCLUDED.receita\`,
      [clienteId],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}`;

const tuneCode = (c) => `-- ${c.tune1}
ALTER TABLE pedidos SET (
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_analyze_threshold    = 50000
);

-- ${c.tune2}
ALTER TABLE pedidos ALTER COLUMN cliente_id SET STATISTICS 1000;

-- ${c.tune3}
CREATE STATISTICS pedidos_cliente_status (ndistinct, dependencies, mcv)
  ON cliente_id, status FROM pedidos;

-- ${c.tune4}
ANALYZE pedidos;

-- ${c.tune5}
ANALYZE eventos;            -- pai particionado: estatística da hierarquia inteira
ANALYZE eventos_2026_11;    -- partição recém-carregada`;

const monitorCode = (c) => `-- ${c.mon1}
-- ${c.mon2}
SELECT s.schemaname,
       s.relname,
       c.reltuples::bigint                          AS linhas,
       s.n_mod_since_analyze,
       round((100.0 * s.n_mod_since_analyze / greatest(c.reltuples, 1))::numeric, 1) AS pct_modificado,
       current_setting('autovacuum_analyze_threshold')::bigint
         + current_setting('autovacuum_analyze_scale_factor')::float8 * c.reltuples AS limite_global,
       greatest(s.last_analyze, s.last_autoanalyze) AS ultimo_analyze
  FROM pg_stat_user_tables s
  JOIN pg_class c ON c.oid = s.relid
 WHERE s.n_mod_since_analyze > 10000
 ORDER BY s.n_mod_since_analyze / greatest(c.reltuples, 1) DESC
 LIMIT 20;`;

const diagramaPt = `D0 22:10  importação do cliente novo (cliente_id 9123): 3.912.455 pedidos via COPY
          pedidos tinha 40,1 milhões de linhas
          limite de autoanalyze: 50 + 0,1 x 40.100.000 = 4.010.050 linhas modificadas
          n_mod_since_analyze depois da carga: 3.912.455 -> abaixo do limite

D0 23:00  job de consolidação do cliente 9123: cancelado por statement_timeout (15 min)
D1 08:30  relatório de vendas por SKU do cliente: carregando até o timeout do gateway
D1 14:20  EXPLAIN ANALYZE: estimado rows=2304, real rows=3.912.455 (1.698 vezes mais)
D1 14:26  ANALYZE pedidos (11 s) -> o mesmo relatório em 48 s, com hash join
D2 05:40  autoanalyze roda sozinho, quando as escritas normais do dia passam do limite`;

const diagramaEn = `D0 22:10  new customer import (cliente_id 9123): 3,912,455 orders via COPY
          pedidos had 40.1 million rows
          autoanalyze threshold: 50 + 0.1 x 40,100,000 = 4,010,050 modified rows
          n_mod_since_analyze after the load: 3,912,455 -> below the threshold

D0 23:00  consolidation job for customer 9123: cancelled by statement_timeout (15 min)
D1 08:30  sales by SKU report for the customer: spinning until the gateway timeout
D1 14:20  EXPLAIN ANALYZE: estimated rows=2304, actual rows=3,912,455 (1,698 times more)
D1 14:26  ANALYZE pedidos (11 s) -> the same report in 48 s, with a hash join
D2 05:40  autoanalyze runs on its own, once regular daily writes cross the threshold`;

const diagramaEs = `D0 22:10  importación del cliente nuevo (cliente_id 9123): 3.912.455 pedidos vía COPY
          pedidos tenía 40,1 millones de filas
          umbral de autoanalyze: 50 + 0,1 x 40.100.000 = 4.010.050 filas modificadas
          n_mod_since_analyze después de la carga: 3.912.455 -> por debajo del umbral

D0 23:00  job de consolidación del cliente 9123: cancelado por statement_timeout (15 min)
D1 08:30  reporte de ventas por SKU del cliente: cargando hasta el timeout del gateway
D1 14:20  EXPLAIN ANALYZE: estimado rows=2304, real rows=3.912.455 (1.698 veces más)
D1 14:26  ANALYZE pedidos (11 s) -> el mismo reporte en 48 s, con hash join
D2 05:40  el autoanalyze se ejecuta solo, cuando las escrituras normales del día superan el umbral`;

const pt = {
  intro:
    'Um SaaS de gestão de pedidos importou o histórico de um cliente novo: 3,9 milhões de pedidos entraram via COPY numa tabela de 40 milhões de linhas. A importação terminou sem erro, os dados estavam corretos e, mesmo assim, o job de consolidação daquele cliente foi cancelado por timeout na mesma noite e o relatório de vendas por SKU não abriu no dia seguinte. Nenhum índice tinha sumido, nenhuma consulta tinha mudado. O planejador do Postgres estimava 2.304 pedidos para o cliente, quando havia 3.912.455, e com essa estimativa escolheu um nested loop que consultou um índice 3,9 milhões de vezes. Um ANALYZE de 11 segundos levou a consulta de 41 minutos para 48 segundos. Este artigo explica de onde vem a estimativa, por que o autoanalyze não rodou depois da carga, quais tabelas ele nunca analisa, como colocar ANALYZE dentro do job de carga e quando vale ajustar default_statistics_target, SET STATISTICS e estatísticas estendidas.',
  sections: [
    {
      title: 'A importação que deixou o relatório do cliente novo 1.698 vezes errado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O sintoma confunde porque afeta só uma parte dos dados. Os clientes antigos continuavam com relatórios rápidos, e o time começou procurando problema no volume do cliente novo, no tamanho do arquivo importado ou em lock deixado pela carga. A pista certa só apareceu quando alguém comparou, no EXPLAIN ANALYZE, a coluna rows estimada com a real.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'code',
          value: planCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'O plano ruim não é um defeito do planejador. Para 2.304 pedidos, buscar os itens de cada um pelo índice é de fato a escolha mais barata. O problema é que ele decidiu com uma fotografia da tabela tirada antes da importação, quando o cliente 9123 não existia. Estimativa errada por três ordens de grandeza é sempre o primeiro suspeito quando uma consulta que não mudou fica lenta logo depois de uma carga.',
        },
      ],
    },
    {
      title: 'De onde vem a estimativa: reltuples, MCV, histograma e n_distinct',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O planejador não conta linhas na hora de planejar. Ele usa o que o ANALYZE gravou: o total de linhas e páginas em pg_class (reltuples e relpages) e, por coluna, a fração de nulos, a quantidade estimada de valores distintos, a lista dos valores mais comuns com suas frequências (MCV) e um histograma com os demais valores. Tudo isso vem de uma amostra de 300 x default_statistics_target linhas, ou seja, 30 mil linhas no padrão, independentemente do tamanho da tabela.',
        },
        {
          type: 'code',
          value: statsCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'Para igualdade, se o valor está na lista de MCV, o planejador usa a frequência medida. Se não está, ele assume que todos os valores fora da lista dividem igualmente o que sobrou. Era exatamente o caso do cliente 9123: fora da lista, porque não existia na última amostra, ele recebeu a mesma fatia de um cliente médio. O total de linhas não estava tão errado, porque o planejador corrige reltuples pelo tamanho físico atual da tabela. O que estava errado era a distribuição, e só um novo ANALYZE corrige distribuição.',
        },
        {
          type: 'list',
          items: [
            'Valor novo fora da MCV: estimado como um valor médio, mesmo que tenha virado o maior da tabela.',
            'Data acima do último limite do histograma: o planejador consulta o índice para descobrir o valor máximo real, mas só quando existe índice B-tree na coluna.',
            'Colunas correlacionadas, como cliente_id e status: sem estatística estendida, as seletividades são multiplicadas como se fossem independentes.',
            'n_distinct subestimado em coluna com muitos valores raros: a amostra vê poucos repetidos e o planejador espera menos grupos no GROUP BY.',
          ],
        },
      ],
    },
    {
      title: 'Por que o autoanalyze não salvou a carga',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O autovacuum dispara um ANALYZE quando n_mod_since_analyze passa de autovacuum_analyze_threshold + autovacuum_analyze_scale_factor x reltuples. Com os padrões, 50 linhas mais 10% da tabela. Numa tabela de 40,1 milhões de linhas, isso dá 4.010.050 modificações. A importação inseriu 3.912.455. Ficou abaixo do limite, e o autoanalyze só rodou no dia seguinte, quando as escritas normais completaram a diferença.',
        },
        {
          type: 'paragraph',
          value:
            'Mesmo quando a carga passa do limite, há uma janela sem estatística: o autovacuum acorda a cada autovacuum_naptime (1 minuto por padrão), só enxerga as modificações depois do COMMIT e pode estar ocupado com outras tabelas, limitado por autovacuum_max_workers. O job que carrega e consulta em seguida quase sempre cai nessa janela. Em alguns tipos de tabela, ele simplesmente nunca vai rodar.',
        },
        {
          type: 'table',
          columns: ['Situação', 'O autoanalyze resolve?', 'O que fazer'],
          rows: [
            ['Carga abaixo de 10% de uma tabela grande', 'Só quando o acumulado passar do limite, às vezes dias depois', 'ANALYZE no próprio job ou scale_factor menor na tabela'],
            ['Carga seguida de consulta no mesmo job', 'Não, a consulta roda antes de o autovacuum acordar', 'ANALYZE entre a carga e a consulta'],
            ['Tabela temporária', 'Nunca: o autovacuum não acessa tabelas temporárias', 'ANALYZE logo depois de preencher'],
            ['Tabela particionada (pai)', 'Nunca para o pai; as partições são analisadas normalmente', 'ANALYZE periódico no pai, que alimenta consultas e joins na hierarquia'],
            ['Restore de dump lógico ou pg_upgrade até o 17', 'Demora, e as consultas rodam sem estatística até lá', 'vacuumdb --all --analyze-in-stages logo depois'],
            ['TRUNCATE seguido de recarga completa', 'Só depois da carga e do naptime, com estatística antiga no meio', 'ANALYZE ao final da recarga, antes de liberar a tabela'],
          ],
        },
      ],
    },
    {
      title: 'ANALYZE como parte da carga, não como manutenção',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A correção estrutural é tratar estatística como parte do dado carregado. Quem muda a distribuição da tabela de forma brusca é responsável por atualizar a estatística antes de liberar a tabela para consultas pesadas. ANALYZE pega um lock SHARE UPDATE EXCLUSIVE, que não bloqueia SELECT, INSERT, UPDATE nem DELETE, pode rodar dentro de transação e enxerga as linhas inseridas pela própria transação.',
        },
        {
          type: 'code',
          value: loadCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'O custo é previsível: o ANALYZE lê uma amostra de páginas, não a tabela inteira, e por isso levou 11 segundos numa tabela de 44 milhões de linhas. Em tabelas muito largas ou com alvo de estatística alto, listar só as colunas usadas em filtros e joins reduz o tempo, com uma ressalva: as estatísticas estendidas só são recalculadas quando todas as colunas delas estão no ANALYZE. Na dúvida, ANALYZE na tabela inteira.',
        },
        {
          type: 'ordered',
          items: [
            'Carregar com COPY ou INSERT em lotes.',
            'Rodar ANALYZE na tabela de destino, na mesma transação ou logo depois do COMMIT.',
            'Rodar ANALYZE em toda tabela temporária ou de staging usada em join.',
            'Só então executar consolidações, refresh de materialized view e relatórios.',
            'Registrar o tempo do ANALYZE no log do job, para perceber quando ele começar a crescer.',
          ],
        },
      ],
    },
    {
      title: 'default_statistics_target, SET STATISTICS e estatísticas estendidas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Atualizar a estatística resolve o caso da carga. Há outra família de erro em que a estatística está atualizada e mesmo assim é pobre demais: a coluna tem distribuição muito desigual, com poucos valores enormes e milhares de valores pequenos, ou duas colunas andam juntas. Aí o ajuste é no conteúdo da estatística, e sempre por coluna, nunca subindo default_statistics_target para o banco inteiro.',
        },
        {
          type: 'code',
          value: tuneCode(comments.pt),
        },
        {
          type: 'table',
          columns: ['Ajuste', 'Quando usar', 'Custo'],
          rows: [
            ['autovacuum_analyze_scale_factor por tabela', 'Tabela grande que recebe cargas abaixo de 10% do tamanho', 'Mais ANALYZE automático, cada um barato'],
            ['SET STATISTICS 500 a 1000 na coluna', 'Distribuição desigual: tenants, status raros, chaves com cauda longa', 'ANALYZE mais lento e planejamento um pouco mais caro nessa coluna'],
            ['CREATE STATISTICS (dependencies, ndistinct, mcv)', 'Filtros e GROUP BY em colunas correlacionadas', 'Mais espaço em pg_statistic_ext_data e tempo de ANALYZE'],
            ['ALTER COLUMN SET (n_distinct = ...)', 'n_distinct estimado muito abaixo do real e estável no tempo', 'Valor fixo que precisa ser revisto se o dado mudar'],
            ['default_statistics_target global', 'Quase nunca: aumenta o custo de todas as colunas', 'ANALYZE e planejamento mais lentos no banco inteiro'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Com alvo 1000, a amostra passa de 30 mil para 300 mil linhas e a lista de MCV pode guardar até mil valores. No caso do cliente novo, isso não teria evitado o incidente, porque nenhuma amostra antiga conhece um valor que ainda não existia. Alvo maior melhora a fotografia; só o ANALYZE tira uma fotografia nova.',
        },
      ],
    },
    {
      title: 'Detectar estatística velha antes do usuário',
      blocks: [
        {
          type: 'paragraph',
          value:
            'pg_stat_user_tables mostra quanto cada tabela mudou desde o último ANALYZE. Uma consulta agendada que lista as tabelas com maior percentual modificado encontra o problema antes que um relatório fique lento, e serve como alerta para cargas que alguém esqueceu de acompanhar com ANALYZE.',
        },
        {
          type: 'code',
          value: monitorCode(comments.pt),
        },
        {
          type: 'list',
          items: [
            'Alertar quando uma tabela com mais de 1 milhão de linhas passar de 5% modificado sem ANALYZE.',
            'Ativar auto_explain com log_min_duration e log_analyze em amostragem, para guardar o plano das consultas lentas com rows estimado e real.',
            'Em pg_stat_statements, observar consultas cujo tempo médio salta logo depois de janelas de carga.',
            'No EXPLAIN ANALYZE, desconfiar de qualquer nó com diferença acima de 10 vezes entre rows estimado e real, principalmente em nested loop.',
            'Incluir ANALYZE no runbook de restore, de pg_upgrade e de qualquer backfill grande.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Devo rodar ANALYZE depois de toda inserção?',
      answer:
        'Não. Para escrita contínua e distribuída, o autoanalyze já é suficiente, eventualmente com scale_factor menor nas tabelas grandes. ANALYZE explícito vale depois de mudanças bruscas de distribuição: importação, backfill, TRUNCATE com recarga, preenchimento de tabela temporária ou de staging e restore. A regra prática é: se o job muda mais de alguns por cento da tabela de uma vez, ele termina com ANALYZE.',
    },
    {
      question: 'ANALYZE trava a tabela em produção?',
      answer:
        'Não para a aplicação. Ele usa SHARE UPDATE EXCLUSIVE, que convive com leituras e escritas e só conflita com VACUUM, outro ANALYZE, CREATE INDEX CONCURRENTLY e alterações de esquema. O custo é de I/O para ler a amostra, normalmente alguns segundos mesmo em tabelas grandes. Se um autovacuum estiver rodando na mesma tabela, o ANALYZE manual espera por ele, o que vale considerar no timeout do job.',
    },
    {
      question: 'Aumentar default_statistics_target resolve estimativa errada?',
      answer:
        'Só quando a estatística está atualizada e pobre, por exemplo numa coluna com distribuição muito desigual. Se a causa é estatística velha depois de uma carga, alvo maior não ajuda, porque a amostra antiga não conhece os valores novos. E subir o valor global encarece ANALYZE e planejamento de todas as colunas: prefira SET STATISTICS na coluna problemática e CREATE STATISTICS para colunas correlacionadas.',
    },
  ],
  conclusion: {
    title: 'Quem muda a distribuição da tabela atualiza a estatística',
    description:
      'Consulta que fica lenta logo depois de uma carga, sem mudança de código nem de índice, quase sempre é estatística velha: o planejador decide com uma fotografia anterior aos dados novos, erra a estimativa por ordens de grandeza e escolhe o plano errado. O autoanalyze não cobre cargas abaixo de 10% da tabela, a janela entre carga e consulta, tabelas temporárias e o pai de tabelas particionadas. A correção é colocar ANALYZE dentro do job de carga, reduzir o scale_factor das tabelas grandes, usar SET STATISTICS e estatísticas estendidas só onde a distribuição pede e monitorar n_mod_since_analyze. Se os seus jobs de importação deixam relatórios lentos no dia seguinte, eu posso revisar o fluxo de carga, os planos e a configuração do banco.',
    cta: 'Revisar cargas e planos de consulta',
  },
  related: [
    {
      label: 'Índice que o banco decidiu ignorar: quando o plano de consulta muda sozinho',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Autovacuum que não acompanha: quando a tabela incha e a consulta fica lenta sem mudar nada',
      to: '/blog/autovacuum-que-nao-acompanha-tabela-incha-consulta-lenta-sem-mudar-nada',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'An order management SaaS imported the history of a new customer: 3.9 million orders went in through COPY into a table with 40 million rows. The import finished without errors, the data was correct and, even so, the consolidation job for that customer was cancelled by timeout that same night and the sales by SKU report would not open the next day. No index had disappeared, no query had changed. The Postgres planner estimated 2,304 orders for the customer when there were 3,912,455, and with that estimate it picked a nested loop that probed an index 3.9 million times. An 11 second ANALYZE took the query from 41 minutes to 48 seconds. This article explains where the estimate comes from, why autoanalyze did not run after the load, which tables it never analyzes, how to put ANALYZE inside the load job and when it is worth tuning default_statistics_target, SET STATISTICS and extended statistics.',
  sections: [
    {
      title: 'The import that made the new customer report 1,698 times wrong',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The symptom is confusing because it only affects part of the data. Older customers still had fast reports, so the team started looking at the volume of the new customer, at the size of the imported file or at a lock left behind by the load. The right clue only showed up when someone compared, in EXPLAIN ANALYZE, the estimated rows column with the actual one.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'code',
          value: planCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'The bad plan is not a planner bug. For 2,304 orders, fetching the items of each one through the index really is the cheapest choice. The problem is that it decided with a picture of the table taken before the import, when customer 9123 did not exist. An estimate that is off by three orders of magnitude is always the first suspect when a query that did not change gets slow right after a load.',
        },
      ],
    },
    {
      title: 'Where the estimate comes from: reltuples, MCV, histogram and n_distinct',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The planner does not count rows when it plans. It uses what ANALYZE stored: the total number of rows and pages in pg_class (reltuples and relpages) and, per column, the null fraction, the estimated number of distinct values, the list of most common values with their frequencies (MCV) and a histogram for the remaining values. All of it comes from a sample of 300 x default_statistics_target rows, that is, 30 thousand rows by default, regardless of the table size.',
        },
        {
          type: 'code',
          value: statsCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'For equality, if the value is in the MCV list, the planner uses the measured frequency. If it is not, it assumes every value outside the list shares what is left equally. That was exactly the case of customer 9123: outside the list, because it did not exist in the last sample, it got the same slice as an average customer. The total row count was not that wrong, because the planner scales reltuples by the current physical size of the table. What was wrong was the distribution, and only a new ANALYZE fixes the distribution.',
        },
        {
          type: 'list',
          items: [
            'New value outside the MCV list: estimated as an average value, even if it became the largest one in the table.',
            'Date above the last histogram bound: the planner probes the index to find the real maximum, but only when there is a B-tree index on the column.',
            'Correlated columns, such as cliente_id and status: without extended statistics, selectivities are multiplied as if they were independent.',
            'Underestimated n_distinct on a column with many rare values: the sample sees few repeats and the planner expects fewer groups in GROUP BY.',
          ],
        },
      ],
    },
    {
      title: 'Why autoanalyze did not save the load',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Autovacuum triggers an ANALYZE when n_mod_since_analyze goes above autovacuum_analyze_threshold + autovacuum_analyze_scale_factor x reltuples. With the defaults, 50 rows plus 10% of the table. On a 40.1 million row table, that is 4,010,050 changes. The import inserted 3,912,455. It stayed below the threshold, and autoanalyze only ran the next day, when regular writes made up the difference.',
        },
        {
          type: 'paragraph',
          value:
            'Even when the load crosses the threshold, there is a window without statistics: autovacuum wakes up every autovacuum_naptime (1 minute by default), only sees the changes after COMMIT and may be busy with other tables, limited by autovacuum_max_workers. A job that loads and then queries almost always falls into that window. For some kinds of table, it will simply never run.',
        },
        {
          type: 'table',
          columns: ['Situation', 'Does autoanalyze fix it?', 'What to do'],
          rows: [
            ['Load below 10% of a large table', 'Only when the accumulated changes cross the threshold, sometimes days later', 'ANALYZE in the job itself or a lower scale_factor on the table'],
            ['Load followed by a query in the same job', 'No, the query runs before autovacuum wakes up', 'ANALYZE between the load and the query'],
            ['Temporary table', 'Never: autovacuum cannot access temporary tables', 'ANALYZE right after filling it'],
            ['Partitioned table (parent)', 'Never for the parent; partitions are analyzed normally', 'Periodic ANALYZE on the parent, which feeds queries and joins across the hierarchy'],
            ['Logical dump restore or pg_upgrade up to 17', 'It takes a while, and queries run without statistics until then', 'vacuumdb --all --analyze-in-stages right after'],
            ['TRUNCATE followed by a full reload', 'Only after the load and the naptime, with old statistics in between', 'ANALYZE at the end of the reload, before releasing the table'],
          ],
        },
      ],
    },
    {
      title: 'ANALYZE as part of the load, not as maintenance',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The structural fix is to treat statistics as part of the loaded data. Whoever changes the distribution of the table abruptly is responsible for refreshing the statistics before releasing the table for heavy queries. ANALYZE takes a SHARE UPDATE EXCLUSIVE lock, which does not block SELECT, INSERT, UPDATE or DELETE, can run inside a transaction and sees the rows inserted by its own transaction.',
        },
        {
          type: 'code',
          value: loadCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'The cost is predictable: ANALYZE reads a sample of pages, not the whole table, which is why it took 11 seconds on a 44 million row table. On very wide tables or with a high statistics target, listing only the columns used in filters and joins reduces the time, with one caveat: extended statistics are only rebuilt when all of their columns are in the ANALYZE. When in doubt, ANALYZE the whole table.',
        },
        {
          type: 'ordered',
          items: [
            'Load with COPY or batched INSERT.',
            'Run ANALYZE on the target table, in the same transaction or right after COMMIT.',
            'Run ANALYZE on every temporary or staging table used in a join.',
            'Only then run consolidations, materialized view refreshes and reports.',
            'Log the ANALYZE duration in the job, to notice when it starts growing.',
          ],
        },
      ],
    },
    {
      title: 'default_statistics_target, SET STATISTICS and extended statistics',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Refreshing statistics solves the load case. There is another family of errors where statistics are fresh and still too poor: the column has a very skewed distribution, with a few huge values and thousands of small ones, or two columns move together. In that case the fix is in the content of the statistics, and always per column, never by raising default_statistics_target for the whole database.',
        },
        {
          type: 'code',
          value: tuneCode(comments.en),
        },
        {
          type: 'table',
          columns: ['Setting', 'When to use it', 'Cost'],
          rows: [
            ['Per table autovacuum_analyze_scale_factor', 'Large table that receives loads below 10% of its size', 'More automatic ANALYZE runs, each one cheap'],
            ['SET STATISTICS 500 to 1000 on the column', 'Skewed distribution: tenants, rare statuses, long tail keys', 'Slower ANALYZE and slightly more expensive planning for that column'],
            ['CREATE STATISTICS (dependencies, ndistinct, mcv)', 'Filters and GROUP BY on correlated columns', 'More space in pg_statistic_ext_data and ANALYZE time'],
            ['ALTER COLUMN SET (n_distinct = ...)', 'n_distinct estimated far below reality and stable over time', 'Fixed value that must be revisited if the data changes'],
            ['Global default_statistics_target', 'Almost never: it raises the cost for every column', 'Slower ANALYZE and planning across the whole database'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'With a target of 1000, the sample grows from 30 thousand to 300 thousand rows and the MCV list can hold up to a thousand values. For the new customer, that would not have prevented the incident, because no old sample knows a value that did not exist yet. A higher target improves the picture; only ANALYZE takes a new one.',
        },
      ],
    },
    {
      title: 'Detecting stale statistics before the user does',
      blocks: [
        {
          type: 'paragraph',
          value:
            'pg_stat_user_tables shows how much each table changed since its last ANALYZE. A scheduled query that lists the tables with the highest modified percentage finds the problem before a report gets slow, and works as an alert for loads that someone forgot to follow with ANALYZE.',
        },
        {
          type: 'code',
          value: monitorCode(comments.en),
        },
        {
          type: 'list',
          items: [
            'Alert when a table with more than 1 million rows goes above 5% modified without ANALYZE.',
            'Enable auto_explain with log_min_duration and sampled log_analyze, to keep the plan of slow queries with estimated and actual rows.',
            'In pg_stat_statements, watch queries whose mean time jumps right after load windows.',
            'In EXPLAIN ANALYZE, distrust any node with more than a 10 times gap between estimated and actual rows, especially under a nested loop.',
            'Add ANALYZE to the runbook for restores, pg_upgrade and any large backfill.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Should I run ANALYZE after every insert?',
      answer:
        'No. For continuous and distributed writes, autoanalyze is enough, possibly with a lower scale_factor on large tables. Explicit ANALYZE pays off after abrupt distribution changes: imports, backfills, TRUNCATE with reload, filling temporary or staging tables and restores. The practical rule is: if the job changes more than a few percent of the table at once, it ends with ANALYZE.',
    },
    {
      question: 'Does ANALYZE lock the table in production?',
      answer:
        'Not for the application. It uses SHARE UPDATE EXCLUSIVE, which coexists with reads and writes and only conflicts with VACUUM, another ANALYZE, CREATE INDEX CONCURRENTLY and schema changes. The cost is the I/O to read the sample, usually a few seconds even on large tables. If an autovacuum is running on the same table, the manual ANALYZE waits for it, which is worth considering in the job timeout.',
    },
    {
      question: 'Does raising default_statistics_target fix wrong estimates?',
      answer:
        'Only when statistics are fresh but poor, for example on a column with a very skewed distribution. If the cause is stale statistics after a load, a higher target does not help, because the old sample does not know the new values. And raising the global value makes ANALYZE and planning more expensive for every column: prefer SET STATISTICS on the problematic column and CREATE STATISTICS for correlated columns.',
    },
  ],
  conclusion: {
    title: 'Whoever changes the table distribution refreshes the statistics',
    description:
      'A query that gets slow right after a load, with no code or index change, is almost always stale statistics: the planner decides with a picture taken before the new data, misses the estimate by orders of magnitude and picks the wrong plan. Autoanalyze does not cover loads below 10% of the table, the window between load and query, temporary tables or the parent of partitioned tables. The fix is to put ANALYZE inside the load job, lower the scale_factor on large tables, use SET STATISTICS and extended statistics only where the distribution calls for it and monitor n_mod_since_analyze. If your import jobs leave reports slow the next day, I can review the load flow, the plans and the database configuration.',
    cta: 'Review loads and query plans',
  },
  related: [
    {
      label: 'The index the database decided to ignore: when the query plan changes on its own',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Autovacuum that cannot keep up: when the table bloats and queries slow down with nothing changed',
      to: '/blog/autovacuum-que-nao-acompanha-tabela-incha-consulta-lenta-sem-mudar-nada',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Un SaaS de gestión de pedidos importó el historial de un cliente nuevo: 3,9 millones de pedidos entraron vía COPY en una tabla de 40 millones de filas. La importación terminó sin errores, los datos eran correctos y, aun así, el job de consolidación de ese cliente fue cancelado por timeout esa misma noche y el reporte de ventas por SKU no abrió al día siguiente. Ningún índice había desaparecido, ninguna consulta había cambiado. El planificador de Postgres estimaba 2.304 pedidos para el cliente, cuando había 3.912.455, y con esa estimación eligió un nested loop que consultó un índice 3,9 millones de veces. Un ANALYZE de 11 segundos llevó la consulta de 41 minutos a 48 segundos. Este artículo explica de dónde viene la estimación, por qué el autoanalyze no se ejecutó después de la carga, qué tablas nunca analiza, cómo poner ANALYZE dentro del job de carga y cuándo vale la pena ajustar default_statistics_target, SET STATISTICS y estadísticas extendidas.',
  sections: [
    {
      title: 'La importación que dejó el reporte del cliente nuevo 1.698 veces equivocado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El síntoma confunde porque afecta solo a una parte de los datos. Los clientes antiguos seguían con reportes rápidos, y el equipo empezó buscando el problema en el volumen del cliente nuevo, en el tamaño del archivo importado o en un lock dejado por la carga. La pista correcta solo apareció cuando alguien comparó, en el EXPLAIN ANALYZE, la columna rows estimada con la real.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'code',
          value: planCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'El plan malo no es un defecto del planificador. Para 2.304 pedidos, buscar los ítems de cada uno por el índice es de verdad la opción más barata. El problema es que decidió con una fotografía de la tabla tomada antes de la importación, cuando el cliente 9123 no existía. Una estimación equivocada por tres órdenes de magnitud es siempre el primer sospechoso cuando una consulta que no cambió se vuelve lenta justo después de una carga.',
        },
      ],
    },
    {
      title: 'De dónde viene la estimación: reltuples, MCV, histograma y n_distinct',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El planificador no cuenta filas al planificar. Usa lo que el ANALYZE guardó: el total de filas y páginas en pg_class (reltuples y relpages) y, por columna, la fracción de nulos, la cantidad estimada de valores distintos, la lista de valores más comunes con sus frecuencias (MCV) y un histograma con los demás valores. Todo eso viene de una muestra de 300 x default_statistics_target filas, es decir, 30 mil filas por defecto, sin importar el tamaño de la tabla.',
        },
        {
          type: 'code',
          value: statsCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'Para igualdad, si el valor está en la lista de MCV, el planificador usa la frecuencia medida. Si no está, asume que todos los valores fuera de la lista se reparten por igual lo que queda. Era exactamente el caso del cliente 9123: fuera de la lista, porque no existía en la última muestra, recibió la misma porción que un cliente promedio. El total de filas no estaba tan equivocado, porque el planificador corrige reltuples según el tamaño físico actual de la tabla. Lo que estaba mal era la distribución, y solo un nuevo ANALYZE corrige la distribución.',
        },
        {
          type: 'list',
          items: [
            'Valor nuevo fuera de la MCV: se estima como un valor promedio, aunque se haya convertido en el mayor de la tabla.',
            'Fecha por encima del último límite del histograma: el planificador consulta el índice para descubrir el máximo real, pero solo cuando hay un índice B-tree en la columna.',
            'Columnas correlacionadas, como cliente_id y status: sin estadística extendida, las selectividades se multiplican como si fueran independientes.',
            'n_distinct subestimado en una columna con muchos valores raros: la muestra ve pocas repeticiones y el planificador espera menos grupos en el GROUP BY.',
          ],
        },
      ],
    },
    {
      title: 'Por qué el autoanalyze no salvó la carga',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El autovacuum dispara un ANALYZE cuando n_mod_since_analyze supera autovacuum_analyze_threshold + autovacuum_analyze_scale_factor x reltuples. Con los valores por defecto, 50 filas más el 10% de la tabla. En una tabla de 40,1 millones de filas, eso da 4.010.050 modificaciones. La importación insertó 3.912.455. Quedó por debajo del umbral, y el autoanalyze solo se ejecutó al día siguiente, cuando las escrituras normales completaron la diferencia.',
        },
        {
          type: 'paragraph',
          value:
            'Incluso cuando la carga supera el umbral, hay una ventana sin estadísticas: el autovacuum despierta cada autovacuum_naptime (1 minuto por defecto), solo ve las modificaciones después del COMMIT y puede estar ocupado con otras tablas, limitado por autovacuum_max_workers. El job que carga y consulta enseguida casi siempre cae en esa ventana. En algunos tipos de tabla, simplemente nunca se va a ejecutar.',
        },
        {
          type: 'table',
          columns: ['Situación', '¿El autoanalyze lo resuelve?', 'Qué hacer'],
          rows: [
            ['Carga por debajo del 10% de una tabla grande', 'Solo cuando lo acumulado supere el umbral, a veces días después', 'ANALYZE en el propio job o scale_factor menor en la tabla'],
            ['Carga seguida de consulta en el mismo job', 'No, la consulta se ejecuta antes de que despierte el autovacuum', 'ANALYZE entre la carga y la consulta'],
            ['Tabla temporal', 'Nunca: el autovacuum no accede a tablas temporales', 'ANALYZE justo después de llenarla'],
            ['Tabla particionada (padre)', 'Nunca para el padre; las particiones se analizan normalmente', 'ANALYZE periódico en el padre, que alimenta consultas y joins en la jerarquía'],
            ['Restore de dump lógico o pg_upgrade hasta la 17', 'Tarda, y las consultas se ejecutan sin estadísticas mientras tanto', 'vacuumdb --all --analyze-in-stages justo después'],
            ['TRUNCATE seguido de recarga completa', 'Solo después de la carga y del naptime, con estadísticas viejas en el medio', 'ANALYZE al final de la recarga, antes de liberar la tabla'],
          ],
        },
      ],
    },
    {
      title: 'ANALYZE como parte de la carga, no como mantenimiento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La corrección estructural es tratar la estadística como parte del dato cargado. Quien cambia la distribución de la tabla de forma brusca es responsable de actualizar la estadística antes de liberar la tabla para consultas pesadas. ANALYZE toma un lock SHARE UPDATE EXCLUSIVE, que no bloquea SELECT, INSERT, UPDATE ni DELETE, puede ejecutarse dentro de una transacción y ve las filas insertadas por su propia transacción.',
        },
        {
          type: 'code',
          value: loadCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'El costo es predecible: ANALYZE lee una muestra de páginas, no la tabla entera, y por eso tardó 11 segundos en una tabla de 44 millones de filas. En tablas muy anchas o con objetivo de estadística alto, listar solo las columnas usadas en filtros y joins reduce el tiempo, con una salvedad: las estadísticas extendidas solo se recalculan cuando todas sus columnas están en el ANALYZE. En la duda, ANALYZE en la tabla entera.',
        },
        {
          type: 'ordered',
          items: [
            'Cargar con COPY o INSERT por lotes.',
            'Ejecutar ANALYZE en la tabla de destino, en la misma transacción o justo después del COMMIT.',
            'Ejecutar ANALYZE en toda tabla temporal o de staging usada en un join.',
            'Solo entonces ejecutar consolidaciones, refresh de materialized views y reportes.',
            'Registrar el tiempo del ANALYZE en el log del job, para notar cuándo empieza a crecer.',
          ],
        },
      ],
    },
    {
      title: 'default_statistics_target, SET STATISTICS y estadísticas extendidas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Actualizar la estadística resuelve el caso de la carga. Hay otra familia de errores en la que la estadística está actualizada y aun así es demasiado pobre: la columna tiene una distribución muy desigual, con pocos valores enormes y miles de valores pequeños, o dos columnas se mueven juntas. Ahí el ajuste está en el contenido de la estadística, y siempre por columna, nunca subiendo default_statistics_target para toda la base.',
        },
        {
          type: 'code',
          value: tuneCode(comments.es),
        },
        {
          type: 'table',
          columns: ['Ajuste', 'Cuándo usarlo', 'Costo'],
          rows: [
            ['autovacuum_analyze_scale_factor por tabla', 'Tabla grande que recibe cargas por debajo del 10% de su tamaño', 'Más ANALYZE automáticos, cada uno barato'],
            ['SET STATISTICS 500 a 1000 en la columna', 'Distribución desigual: tenants, status raros, claves con cola larga', 'ANALYZE más lento y planificación un poco más cara en esa columna'],
            ['CREATE STATISTICS (dependencies, ndistinct, mcv)', 'Filtros y GROUP BY en columnas correlacionadas', 'Más espacio en pg_statistic_ext_data y tiempo de ANALYZE'],
            ['ALTER COLUMN SET (n_distinct = ...)', 'n_distinct estimado muy por debajo del real y estable en el tiempo', 'Valor fijo que hay que revisar si el dato cambia'],
            ['default_statistics_target global', 'Casi nunca: aumenta el costo de todas las columnas', 'ANALYZE y planificación más lentos en toda la base'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Con objetivo 1000, la muestra pasa de 30 mil a 300 mil filas y la lista de MCV puede guardar hasta mil valores. En el caso del cliente nuevo, eso no habría evitado el incidente, porque ninguna muestra antigua conoce un valor que todavía no existía. Un objetivo mayor mejora la fotografía; solo el ANALYZE toma una fotografía nueva.',
        },
      ],
    },
    {
      title: 'Detectar estadísticas viejas antes que el usuario',
      blocks: [
        {
          type: 'paragraph',
          value:
            'pg_stat_user_tables muestra cuánto cambió cada tabla desde el último ANALYZE. Una consulta programada que lista las tablas con mayor porcentaje modificado encuentra el problema antes de que un reporte se vuelva lento, y sirve como alerta para cargas que alguien olvidó acompañar con ANALYZE.',
        },
        {
          type: 'code',
          value: monitorCode(comments.es),
        },
        {
          type: 'list',
          items: [
            'Alertar cuando una tabla con más de 1 millón de filas supere el 5% modificado sin ANALYZE.',
            'Activar auto_explain con log_min_duration y log_analyze por muestreo, para guardar el plan de las consultas lentas con rows estimado y real.',
            'En pg_stat_statements, observar consultas cuyo tiempo medio salta justo después de las ventanas de carga.',
            'En el EXPLAIN ANALYZE, desconfiar de cualquier nodo con una diferencia de más de 10 veces entre rows estimado y real, sobre todo en un nested loop.',
            'Incluir ANALYZE en el runbook de restore, de pg_upgrade y de cualquier backfill grande.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Debo ejecutar ANALYZE después de cada inserción?',
      answer:
        'No. Para escrituras continuas y distribuidas, el autoanalyze ya alcanza, eventualmente con un scale_factor menor en las tablas grandes. El ANALYZE explícito vale después de cambios bruscos de distribución: importaciones, backfills, TRUNCATE con recarga, llenado de tablas temporales o de staging y restores. La regla práctica es: si el job cambia más de unos pocos por ciento de la tabla de una vez, termina con ANALYZE.',
    },
    {
      question: '¿ANALYZE bloquea la tabla en producción?',
      answer:
        'No para la aplicación. Usa SHARE UPDATE EXCLUSIVE, que convive con lecturas y escrituras y solo entra en conflicto con VACUUM, otro ANALYZE, CREATE INDEX CONCURRENTLY y cambios de esquema. El costo es el I/O para leer la muestra, normalmente unos segundos incluso en tablas grandes. Si hay un autovacuum ejecutándose en la misma tabla, el ANALYZE manual lo espera, lo que conviene considerar en el timeout del job.',
    },
    {
      question: '¿Subir default_statistics_target resuelve una estimación equivocada?',
      answer:
        'Solo cuando la estadística está actualizada pero es pobre, por ejemplo en una columna con distribución muy desigual. Si la causa es una estadística vieja después de una carga, un objetivo mayor no ayuda, porque la muestra antigua no conoce los valores nuevos. Y subir el valor global encarece el ANALYZE y la planificación de todas las columnas: prefiera SET STATISTICS en la columna problemática y CREATE STATISTICS para columnas correlacionadas.',
    },
  ],
  conclusion: {
    title: 'Quien cambia la distribución de la tabla actualiza la estadística',
    description:
      'Una consulta que se vuelve lenta justo después de una carga, sin cambio de código ni de índice, casi siempre es estadística vieja: el planificador decide con una fotografía anterior a los datos nuevos, falla la estimación por órdenes de magnitud y elige el plan equivocado. El autoanalyze no cubre cargas por debajo del 10% de la tabla, la ventana entre carga y consulta, las tablas temporales ni el padre de las tablas particionadas. La corrección es poner ANALYZE dentro del job de carga, reducir el scale_factor de las tablas grandes, usar SET STATISTICS y estadísticas extendidas solo donde la distribución lo pide y monitorear n_mod_since_analyze. Si sus jobs de importación dejan reportes lentos al día siguiente, puedo revisar el flujo de carga, los planes y la configuración de la base.',
    cta: 'Revisar cargas y planes de consulta',
  },
  related: [
    {
      label: 'El índice que la base decidió ignorar: cuándo el plan de consulta cambia solo',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Autovacuum que no da abasto: cuándo la tabla se hincha y la consulta se vuelve lenta sin que nada cambie',
      to: '/blog/autovacuum-que-nao-acompanha-tabela-incha-consulta-lenta-sem-mudar-nada',
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
