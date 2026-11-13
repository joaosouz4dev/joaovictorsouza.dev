// Conteudo do artigo: tabela temporaria e consulta pesada que estouram o disco. Como work_mem
// vira arquivo temporario (spill) em sort, hash join e hash aggregate, por que tabela temporaria
// nao conta para temp_file_limit, como achar em minutos qual sessao esta enchendo o pgsql_tmp e
// quais limites (work_mem por papel, temp_file_limit, temp_tablespaces, log_temp_files) colocar.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const comments = {
  pt: {
    plan1: 'Sort que nao coube em work_mem: external merge com 58,6 GB em disco.',
    plan2: 'temp written em blocos de 8 kB: 7.684.160 x 8 kB = 58,6 GB.',
    plan3: 'Hash join que precisou particionar: 32 batches em vez de 1.',
    tmp1: 'Quem esta escrevendo arquivo temporario agora, somado por sessao.',
    tmp2: 'Workers paralelos sao agrupados no pid do lider.',
    tmp3: 'Acumulado desde o ultimo reset: quantos arquivos e quantos bytes.',
    tmp4: 'As consultas que mais escreveram temp (requer pg_stat_statements).',
    tmp5: 'Tabelas temporarias vivas e o tamanho de cada uma.',
    cfg1: 'Instancia: registrar todo arquivo temporario de 100 MB ou mais.',
    cfg2: 'Teto por processo para arquivos temporarios de sort e hash.',
    cfg3: 'Arquivos e tabelas temporarias em outro volume, longe do pg_wal.',
    cfg4: 'Papel do BI: mais memoria por operacao, teto de temp e de tempo.',
    cfg5: 'Job de ETL: memoria grande so dentro da transacao.',
    cfg6: 'Volta ao valor do papel no COMMIT.',
    mon1: 'Soma dos arquivos temporarios de todas as sessoes, por tablespace.',
    mon2: 'pg_ls_tmpdir so lista arquivos regulares: o fileset de hash paralelo fica de fora.',
    mon3: 'Evita alerta repetido a cada ciclo.',
    mon4: 'Acima do limite duro, cancela a consulta (nao derruba a conexao).',
    mon5: 'Nunca sobrepor duas verificacoes.',
  },
  en: {
    plan1: 'A sort that did not fit in work_mem: external merge with 58.6 GB on disk.',
    plan2: 'temp written in 8 kB blocks: 7,684,160 x 8 kB = 58.6 GB.',
    plan3: 'A hash join that had to partition: 32 batches instead of 1.',
    tmp1: 'Who is writing temporary files right now, summed per session.',
    tmp2: 'Parallel workers are grouped under the leader pid.',
    tmp3: 'Accumulated since the last reset: how many files and how many bytes.',
    tmp4: 'The queries that wrote the most temp (requires pg_stat_statements).',
    tmp5: 'Live temporary tables and the size of each one.',
    cfg1: 'Instance: log every temporary file of 100 MB or more.',
    cfg2: 'Per process ceiling for sort and hash temporary files.',
    cfg3: 'Temporary files and tables on another volume, away from pg_wal.',
    cfg4: 'BI role: more memory per operation, a temp ceiling and a time ceiling.',
    cfg5: 'ETL job: large memory only inside the transaction.',
    cfg6: 'Goes back to the role value on COMMIT.',
    mon1: 'Sum of the temporary files of every session, per tablespace.',
    mon2: 'pg_ls_tmpdir only lists regular files: the parallel hash fileset is left out.',
    mon3: 'Avoids repeating the alert on every cycle.',
    mon4: 'Above the hard limit, cancels the query (does not kill the connection).',
    mon5: 'Never overlap two checks.',
  },
  es: {
    plan1: 'Un sort que no cupo en work_mem: external merge con 58,6 GB en disco.',
    plan2: 'temp written en bloques de 8 kB: 7.684.160 x 8 kB = 58,6 GB.',
    plan3: 'Un hash join que tuvo que particionar: 32 batches en lugar de 1.',
    tmp1: 'Quien esta escribiendo archivos temporales ahora, sumado por sesion.',
    tmp2: 'Los workers paralelos se agrupan en el pid del lider.',
    tmp3: 'Acumulado desde el ultimo reset: cuantos archivos y cuantos bytes.',
    tmp4: 'Las consultas que mas temp escribieron (requiere pg_stat_statements).',
    tmp5: 'Tablas temporales vivas y el tamano de cada una.',
    cfg1: 'Instancia: registrar todo archivo temporal de 100 MB o mas.',
    cfg2: 'Techo por proceso para archivos temporales de sort y hash.',
    cfg3: 'Archivos y tablas temporales en otro volumen, lejos de pg_wal.',
    cfg4: 'Rol de BI: mas memoria por operacion, techo de temp y de tiempo.',
    cfg5: 'Job de ETL: memoria grande solo dentro de la transaccion.',
    cfg6: 'Vuelve al valor del rol en el COMMIT.',
    mon1: 'Suma de los archivos temporales de todas las sesiones, por tablespace.',
    mon2: 'pg_ls_tmpdir solo lista archivos regulares: el fileset de hash paralelo queda fuera.',
    mon3: 'Evita repetir la alerta en cada ciclo.',
    mon4: 'Por encima del limite duro, cancela la consulta (no mata la conexion).',
    mon5: 'Nunca superponer dos verificaciones.',
  },
};

const planCode = (c) => `EXPLAIN (ANALYZE, BUFFERS)
SELECT c.id, c.nome, i.categoria_id, sum(i.valor) AS faturamento
  FROM clientes c
  JOIN pedidos p        ON p.cliente_id = c.id
  JOIN pedidos_itens i  ON i.pedido_id = p.id
  JOIN promocoes pr     ON pr.categoria_id = i.categoria_id
 WHERE p.criado_em >= '2026-10-01' AND p.criado_em < '2026-11-01'
 GROUP BY c.id, c.nome, i.categoria_id;

-- ${c.plan1}
GroupAggregate  (actual time=688120.552..701934.207 rows=1840221 loops=1)
  Group Key: c.id, i.categoria_id
  ->  Sort  (actual time=612034.118..688120.552 rows=412000000 loops=1)
        Sort Key: c.id, i.categoria_id
        Sort Method: external merge  Disk: 61473280kB
        -- ${c.plan2}
        Buffers: shared hit=1203 read=5821044, temp read=7684160 written=7684160
        ->  Hash Join  (actual time=4120.334..401227.918 rows=412000000 loops=1)
              Hash Cond: (i.categoria_id = pr.categoria_id)
              ->  Hash Join  (actual rows=10300000 loops=1)
                    ...
              ->  Hash  (actual rows=2400 loops=1)
                    -- ${c.plan3}
                    Buckets: 262144  Batches: 32 (originally 1)  Memory Usage: 8193kB`;

const diagnosticoCode = (c) => `-- ${c.tmp1}
-- ${c.tmp2}
WITH arquivos AS (
  SELECT substring(t.name FROM '^pgsql_tmp([0-9]+)')::int AS pid, t.size
    FROM pg_tablespace ts
   CROSS JOIN LATERAL pg_ls_tmpdir(ts.oid) t
   WHERE ts.spcname <> 'pg_global'
), por_sessao AS (
  SELECT COALESCE(a.leader_pid, a.pid) AS pid, sum(f.size)::bigint AS bytes
    FROM arquivos f
    JOIN pg_stat_activity a ON a.pid = f.pid
   GROUP BY 1
)
SELECT s.pid, pg_size_pretty(s.bytes) AS temp_em_uso,
       a.usename, a.application_name,
       now() - a.query_start AS duracao,
       left(a.query, 120) AS consulta
  FROM por_sessao s
  JOIN pg_stat_activity a ON a.pid = s.pid
 ORDER BY s.bytes DESC;

-- ${c.tmp3}
SELECT datname, temp_files, pg_size_pretty(temp_bytes) AS temp_total, stats_reset
  FROM pg_stat_database
 WHERE datname = current_database();

-- ${c.tmp4}
SELECT queryid, calls,
       pg_size_pretty(temp_blks_written * current_setting('block_size')::bigint) AS temp_escrito,
       left(query, 120) AS consulta
  FROM pg_stat_statements
 ORDER BY temp_blks_written DESC
 LIMIT 10;

-- ${c.tmp5}
SELECT n.nspname AS schema_temp, c.relname,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS tamanho
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relpersistence = 't' AND c.relkind = 'r'
 ORDER BY pg_total_relation_size(c.oid) DESC
 LIMIT 20;`;

const configCode = (c) => `-- ${c.cfg1}
ALTER SYSTEM SET log_temp_files = '100MB';
-- ${c.cfg2}
ALTER SYSTEM SET temp_file_limit = '20GB';
SELECT pg_reload_conf();

-- ${c.cfg3}
-- mkdir -p /mnt/pgtemp/data && chown postgres:postgres /mnt/pgtemp/data
CREATE TABLESPACE temp_local LOCATION '/mnt/pgtemp/data';
ALTER SYSTEM SET temp_tablespaces = 'temp_local';
SELECT pg_reload_conf();

-- ${c.cfg4}
ALTER ROLE metabase SET work_mem = '64MB';
ALTER ROLE metabase SET temp_file_limit = '50GB';
ALTER ROLE metabase SET statement_timeout = '10min';

-- ${c.cfg5}
BEGIN;
SET LOCAL work_mem = '512MB';
SET LOCAL hash_mem_multiplier = 2.0;
INSERT INTO resumo_vendas_mensal (mes, cliente_id, categoria_id, total)
SELECT date_trunc('month', p.criado_em), p.cliente_id, i.categoria_id, sum(i.valor)
  FROM pedidos p
  JOIN pedidos_itens i ON i.pedido_id = p.id
 WHERE p.criado_em >= '2026-10-01' AND p.criado_em < '2026-11-01'
 GROUP BY 1, 2, 3;
COMMIT;  -- ${c.cfg6}`;

const tempTableCode = `-- ETL antigo: a tabela vive enquanto a conexao do pool viver.
CREATE TEMP TABLE staging_pedidos AS
SELECT * FROM pedidos WHERE criado_em >= now() - interval '90 days';

-- ETL corrigido: escopo da transacao, so as colunas usadas, estatistica antes do join.
BEGIN;
CREATE TEMP TABLE staging_pedidos ON COMMIT DROP AS
SELECT id, cliente_id, total
  FROM pedidos
 WHERE criado_em >= now() - interval '90 days';

ANALYZE staging_pedidos;  -- autovacuum nunca analisa tabela temporaria

UPDATE clientes c
   SET total_90d = s.total
  FROM (SELECT cliente_id, sum(total) AS total
          FROM staging_pedidos
         GROUP BY cliente_id) s
 WHERE s.cliente_id = c.id;
COMMIT;  -- a tabela e os arquivos dela somem aqui`;

const monitorCode = (c) => `// temp-watchdog.js
import pg from 'pg';

const GB = 1024 ** 3;
const ALERTA_BYTES = Number(process.env.TEMP_ALERTA_GB ?? 50) * GB;
const CANCELAR_BYTES = Number(process.env.TEMP_CANCELAR_GB ?? 150) * GB;
const INTERVALO_MS = 15_000;
const SILENCIO_MS = 10 * 60_000;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

// ${c.mon1}
// ${c.mon2}
const SQL = \`
  WITH arquivos AS (
    SELECT substring(t.name FROM '^pgsql_tmp([0-9]+)')::int AS pid, t.size
      FROM pg_tablespace ts
     CROSS JOIN LATERAL pg_ls_tmpdir(ts.oid) t
     WHERE ts.spcname <> 'pg_global'
  ), por_sessao AS (
    SELECT COALESCE(a.leader_pid, a.pid) AS pid, sum(f.size)::bigint AS bytes
      FROM arquivos f
      JOIN pg_stat_activity a ON a.pid = f.pid
     GROUP BY 1
  )
  SELECT s.pid, s.bytes, a.usename, a.application_name,
         extract(epoch FROM now() - a.query_start)::int AS segundos,
         left(a.query, 200) AS consulta
    FROM por_sessao s
    JOIN pg_stat_activity a ON a.pid = s.pid
   ORDER BY s.bytes DESC\`;

const gb = (bytes) => (Number(bytes) / GB).toFixed(1);
let ultimoAlerta = 0;

async function alertar(mensagem) {
  console.warn(mensagem);
  if (!process.env.ALERT_WEBHOOK_URL) return;
  await fetch(process.env.ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: mensagem.slice(0, 1900) }),
  });
}

async function verificar() {
  const { rows } = await pool.query(SQL);
  const total = rows.reduce((soma, r) => soma + Number(r.bytes), 0);

  // ${c.mon3}
  if (total >= ALERTA_BYTES && Date.now() - ultimoAlerta > SILENCIO_MS) {
    ultimoAlerta = Date.now();
    const maior = rows[0];
    await alertar(
      \`[temp] \${gb(total)} GB em arquivos temporarios. Maior: pid \${maior.pid} \` +
        \`(\${maior.usename}/\${maior.application_name}) com \${gb(maior.bytes)} GB \` +
        \`ha \${maior.segundos}s: \${maior.consulta}\`,
    );
  }

  // ${c.mon4}
  for (const r of rows.filter((linha) => Number(linha.bytes) >= CANCELAR_BYTES)) {
    const { rows: [res] } = await pool.query('SELECT pg_cancel_backend($1) AS ok', [r.pid]);
    await alertar(\`[temp] pid \${r.pid} com \${gb(r.bytes)} GB: cancelado=\${res.ok}\`);
  }
}

// ${c.mon5}
async function loop() {
  try {
    await verificar();
  } catch (error) {
    console.error('[temp] falha na verificacao', error.message);
  } finally {
    setTimeout(loop, INTERVALO_MS);
  }
}

loop();`;

const diagramaPt = `14:02  Metabase dispara "faturamento por cliente e categoria" (outubro)
       novo filtro de promoção faz join por categoria_id, sem condição de data
       10,3 mi de itens x ~40 promoções por categoria = 412 mi de linhas

14:03  Hash Join com work_mem = 4MB: 32 batches em base/pgsql_tmp
14:09  GROUP BY vira Sort external merge: arquivos de 1 GB, um atrás do outro
14:15  Metabase reexecuta o card por timeout do navegador: segunda cópia da consulta
14:20  disco do volume de dados + pg_wal: 71% -> 88%    (sem alerta abaixo de 90%)
14:31  100%. PANIC: could not write to file "pg_wal/xlogtemp.48121": No space left on device
14:31  postmaster encerra todas as sessões, crash recovery
14:33  banco volta, arquivos temporários apagados no restart: disco em 62%
14:40  "não tem nada no log": log_temp_files = -1, nenhuma linha sobre os 380 GB`;

const diagramaEn = `14:02  Metabase fires "revenue per customer and category" (October)
       a new promotion filter joins on categoria_id, with no date condition
       10.3 M items x ~40 promotions per category = 412 M rows

14:03  Hash Join with work_mem = 4MB: 32 batches in base/pgsql_tmp
14:09  GROUP BY becomes an external merge Sort: 1 GB files, one after another
14:15  Metabase reruns the card after a browser timeout: second copy of the query
14:20  disk of the data + pg_wal volume: 71% -> 88%    (no alert below 90%)
14:31  100%. PANIC: could not write to file "pg_wal/xlogtemp.48121": No space left on device
14:31  postmaster terminates every session, crash recovery
14:33  database back, temporary files removed on restart: disk at 62%
14:40  "there is nothing in the log": log_temp_files = -1, not a single line about the 380 GB`;

const diagramaEs = `14:02  Metabase dispara "facturación por cliente y categoría" (octubre)
       un nuevo filtro de promoción hace join por categoria_id, sin condición de fecha
       10,3 M de ítems x ~40 promociones por categoría = 412 M de filas

14:03  Hash Join con work_mem = 4MB: 32 batches en base/pgsql_tmp
14:09  el GROUP BY se vuelve Sort external merge: archivos de 1 GB, uno tras otro
14:15  Metabase reejecuta la tarjeta por timeout del navegador: segunda copia de la consulta
14:20  disco del volumen de datos + pg_wal: 71% -> 88%    (sin alerta por debajo de 90%)
14:31  100%. PANIC: could not write to file "pg_wal/xlogtemp.48121": No space left on device
14:31  el postmaster termina todas las sesiones, crash recovery
14:33  la base vuelve, archivos temporales borrados en el reinicio: disco en 62%
14:40  "no hay nada en el log": log_temp_files = -1, ni una línea sobre los 380 GB`;

const pt = {
  intro:
    'Às 14h31 de uma terça-feira, a primária de um e-commerce caiu com "PANIC: could not write to file pg_wal/xlogtemp: No space left on device". Dois minutos depois o banco voltou sozinho, o disco estava com 62% de uso e o log não tinha uma linha sequer explicando quem tinha escrito 380 GB em meia hora. O culpado era um relatório do BI com um join sem condição de data, que gerou 412 milhões de linhas intermediárias e despejou tudo em arquivos temporários porque nada cabia nos 4 MB de work_mem. O restart apagou a evidência. Este artigo explica como o Postgres transforma falta de memória em disco, por que tabela temporária é um consumidor de disco à parte que temp_file_limit não enxerga, como descobrir em minutos qual sessão está enchendo o pgsql_tmp e quais limites colocar para que a próxima consulta descontrolada falhe sozinha em vez de derrubar a primária.',
  sections: [
    {
      title: 'O incidente: 380 GB de arquivo temporário em 29 minutos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O volume da primária tinha 1 TB e guardava dados e pg_wal juntos, configuração padrão na maioria das instalações. O alerta de disco disparava em 90%, pensado para crescimento de tabelas, que leva semanas. Arquivo temporário não respeita esse ritmo: uma única consulta escreve centenas de megabytes por segundo, e o caminho entre 70% e 100% levou onze minutos.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'Três detalhes tornam esse incidente típico. Primeiro, o disco não encheu por causa de dados, encheu por causa de trabalho intermediário de uma consulta que nem gravava nada. Segundo, quem morreu não foi a consulta, foi o banco inteiro: quando o Postgres não consegue escrever WAL, ele entra em PANIC, porque não pode garantir durabilidade. Terceiro, desde o Postgres 14 o parâmetro remove_temp_files_after_crash vem ligado e o restart limpa o pgsql_tmp. É o comportamento correto para devolver o espaço, e também o motivo de o time ter encontrado um disco saudável e nenhum culpado.',
        },
        {
          type: 'paragraph',
          value:
            'A reexecução às 14h15 merece atenção. O Metabase, como a maioria das ferramentas de BI, reexecuta a consulta quando o usuário recarrega o painel, e a consulta anterior continua rodando no banco até terminar ou ser cancelada. Duas cópias da mesma consulta descontrolada dobram a velocidade com que o disco enche.',
        },
      ],
    },
    {
      title: 'Como work_mem vira disco: sort, hash join e hash aggregate',
      blocks: [
        {
          type: 'paragraph',
          value:
            'work_mem não é a memória de uma sessão nem de uma consulta. É o limite de cada operação de ordenação ou de hash dentro do plano. Uma consulta com três hash joins e um sort pode usar quatro vezes work_mem, e cada worker paralelo tem o seu próprio orçamento. Operações de hash ainda podem usar work_mem multiplicado por hash_mem_multiplier, que vale 2.0 a partir do Postgres 15. Quando a operação passa do limite, ela não falha: continua em disco, escrevendo arquivos em base/pgsql_tmp (ou no tablespace de temp_tablespaces), em segmentos de 1 GB chamados pgsql_tmp<pid>.<n>.',
        },
        {
          type: 'table',
          columns: ['Operação', 'O que faz ao passar de work_mem', 'Como aparece no EXPLAIN ANALYZE'],
          rows: [
            ['Sort (ORDER BY, DISTINCT, merge join)', 'Ordena em blocos e faz merge em disco', 'Sort Method: external merge  Disk: N kB'],
            ['Hash Join', 'Particiona as duas entradas em batches gravados em disco', 'Batches: 32 (originally 1)'],
            ['HashAggregate (GROUP BY)', 'Despeja grupos em disco desde o Postgres 13', 'Batches: N  Memory Usage  Disk Usage'],
            ['Materialize, CTE materializada', 'Guarda o resultado intermediário em tuplestore no disco', 'Storage: Disk  Maximum Storage: N kB (Postgres 18+)'],
            ['Window function', 'Mantém a partição em tuplestore que transborda para disco', 'Storage: Disk (Postgres 18+)'],
          ],
        },
        {
          type: 'code',
          value: planCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'Leia o plano de baixo para cima. O join com promocoes multiplica 10,3 milhões de itens por cerca de 40 promoções por categoria, porque a condição de vigência da promoção ficou de fora. Daí em diante nenhum ajuste de memória salva a consulta: ordenar 412 milhões de linhas para depois o GROUP BY reduzi-las a 1,8 milhão de grupos, com o faturamento multiplicado por 40 no caminho, é trabalho inútil e ainda produz um número errado, e o disco é só onde esse trabalho fica visível. A linha temp read/written de BUFFERS é a métrica mais honesta, porque mostra o volume real que foi para o disco, inclusive de nós que não exibem Disk.',
        },
        {
          type: 'paragraph',
          value:
            'Cuidado com EXPLAIN ANALYZE em consulta suspeita: ele executa a consulta de verdade e escreve os mesmos 380 GB. Comece com EXPLAIN sem ANALYZE para ver as estimativas de linhas, depois rode ANALYZE com um período de um dia em vez de um mês, sempre com statement_timeout e temp_file_limit definidos na sessão. A correção aqui foi juntar promocoes pela vigência (pr.inicio <= p.criado_em AND pr.fim > p.criado_em) e agregar os itens antes do join. A consulta caiu para 1,9 milhão de linhas intermediárias, terminou em 41 segundos e não escreveu nenhum arquivo temporário com work_mem de 64 MB.',
        },
      ],
    },
    {
      title: 'Tabela temporária: o consumo de disco que temp_file_limit não vê',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Arquivo temporário de consulta e tabela temporária são coisas diferentes, e a documentação deixa explícito que temp_file_limit não conta o espaço de tabelas temporárias criadas com CREATE TEMP TABLE. Elas são relações de verdade: têm arquivo em disco (base/<oid do banco>/t<id da sessão>_<relfilenode>, ou no tablespace de temp_tablespaces), passam por um cache local da sessão com tamanho definido por temp_buffers, que tem 8 MB por padrão, e não geram WAL. Uma tabela temporária de 200 GB cresce até encher o disco sem nenhum limite de configuração no caminho.',
        },
        {
          type: 'list',
          items: [
            'Pool de conexões prolonga a vida da tabela. Sem ON COMMIT DROP, a tabela temporária só some quando a sessão termina. Atrás de um pool, a sessão pode viver dias, e o espaço fica ocupado depois que o job já acabou.',
            'Autovacuum não processa tabelas temporárias. Sem ANALYZE manual, o planejador usa estimativas padrão, escolhe nested loop onde deveria usar hash join e a consulta seguinte demora horas.',
            'Criar e apagar tabelas temporárias em alta frequência incha pg_class e pg_attribute, porque cada tabela insere e remove linhas no catálogo. Já vi pg_attribute com 40 GB em um sistema que criava uma tabela temporária por requisição HTTP.',
            'Um crash deixa schemas pg_temp_N órfãos. O autovacuum remove essas tabelas depois, mas o espaço só volta quando isso acontece.',
          ],
        },
        {
          type: 'code',
          value: tempTableCode,
        },
        {
          type: 'paragraph',
          value:
            'A versão corrigida resolve os quatro pontos: ON COMMIT DROP amarra a tabela à transação e não à conexão, selecionar só três colunas reduz o tamanho em dez vezes nesse caso, ANALYZE dá ao planejador o número real de linhas e o job deixa de depender de quando o pool resolve fechar a conexão. Se o ETL usa PgBouncer em transaction pooling, tabela temporária fora de uma transação nem é segura: a próxima instrução pode cair em outra conexão do servidor.',
        },
      ],
    },
    {
      title: 'Diagnóstico: quem está enchendo o disco agora e quem encheu ontem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Durante o incidente, a pergunta é qual sessão está escrevendo. O nome de cada arquivo em pgsql_tmp carrega o pid do processo, e pg_ls_tmpdir (Postgres 12+, liberada para o papel pg_monitor) lista os arquivos com tamanho. Basta extrair o pid do nome e cruzar com pg_stat_activity. Depois do incidente, a pergunta muda para qual consulta faz isso com frequência, e aí entram pg_stat_database e pg_stat_statements.',
        },
        {
          type: 'code',
          value: diagnosticoCode(comments.pt),
        },
        {
          type: 'list',
          items: [
            'Hash join paralelo grava os batches em subdiretórios com sufixo .fileset (.sharedfileset antes do Postgres 15). pg_ls_tmpdir só lista arquivos regulares e deixa esses diretórios de fora. Se a soma da consulta ficar muito abaixo do que o df mostra, rode du -sh no pgsql_tmp para confirmar.',
            'pg_stat_database.temp_bytes só é incrementado quando o arquivo é fechado. Uma consulta que ainda está escrevendo não aparece ali, por isso ele serve para tendência e não para o incidente em curso.',
            'log_temp_files registra o caminho e o tamanho de cada arquivo removido, seguido do STATEMENT que o criou. É a única evidência que sobrevive a um crash, porque o log fica fora do pgsql_tmp.',
            'Para parar a consulta, use pg_cancel_backend(pid). Os arquivos temporários são apagados quando a operação termina. Nunca apague arquivos do pgsql_tmp com rm enquanto o banco está de pé: o processo ainda tem o arquivo aberto, o espaço não volta e a consulta falha de forma imprevisível.',
          ],
        },
      ],
    },
    {
      title: 'Limites em camadas: memória por papel, teto de temp e outro volume',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Não existe um parâmetro único que resolva. work_mem global alto parece a saída óbvia, mas é multiplicado por operação, por worker e por conexão: 100 conexões ativas com três operações de hash cada e work_mem de 256 MB podem pedir 150 GB de RAM em um servidor de 64 GB, e o OOM killer derruba o banco do mesmo jeito. O caminho é dar memória a quem precisa, colocar teto em quem pode escapar e tirar o pg_wal do caminho do arquivo temporário.',
        },
        {
          type: 'code',
          value: configCode(comments.pt),
        },
        {
          type: 'table',
          columns: ['Configuração', 'Escopo', 'O que protege', 'O que não protege'],
          rows: [
            ['work_mem por papel ou SET LOCAL', 'Cada operação de sort ou hash', 'Spill desnecessário em relatório e ETL', 'Não limita disco, só reduz a chance de usar'],
            ['temp_file_limit', 'Cada processo, inclusive cada worker paralelo', 'Uma consulta descontrolada: falha com ERROR em vez de encher o disco', 'Tabela temporária e a soma de várias sessões'],
            ['statement_timeout', 'Cada comando', 'Consulta que roda por horas', 'Consulta rápida que escreve 100 GB em 5 minutos'],
            ['temp_tablespaces em outro volume', 'Instância, papel ou sessão', 'pg_wal e dados: disco cheio vira erro de consulta, não PANIC', 'Não reduz o volume escrito'],
            ['log_temp_files', 'Instância', 'Evidência depois do incidente, inclusive depois de crash', 'Não impede nada'],
            ['Monitor de pgsql_tmp', 'Soma de todas as sessões', 'Alerta e cancelamento antes de o volume encher', 'Depende de estar rodando e com permissão'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'temp_file_limit só pode ser alterado por superusuário (ou por quem recebeu GRANT SET no parâmetro, a partir do Postgres 15), o que é proposital: um usuário comum não consegue desligar o próprio teto. Quando a consulta passa do limite, ela recebe "ERROR: temporary file size exceeds temp_file_limit" e os arquivos são removidos. O teto global de 20 GB serve para as aplicações, e o papel do BI recebe 50 GB porque relatórios legítimos chegam perto disso. Com temp_tablespaces em um disco separado, mesmo o pior caso enche apenas esse disco, e o banco continua aceitando escrita. Em serviços gerenciados como RDS, Cloud SQL e Azure, o arquivo temporário costuma ficar no mesmo armazenamento dos dados e o tablespace separado nem sempre está disponível, então temp_file_limit e o monitor passam a ser a defesa principal.',
        },
      ],
    },
    {
      title: 'Um monitor que avisa e cancela antes de o disco encher',
      blocks: [
        {
          type: 'paragraph',
          value:
            'temp_file_limit protege contra uma consulta, mas dez sessões com 20 GB cada somam 200 GB e nenhuma delas passou do limite. O alerta de disco olha o volume inteiro e chega tarde. O monitor abaixo olha especificamente os arquivos temporários de todas as sessões a cada 15 segundos, avisa quando a soma passa de 50 GB com o nome de quem está escrevendo e cancela qualquer consulta que passe de 150 GB. Ele precisa de um papel com pg_monitor, para ler pg_ls_tmpdir e o texto das consultas, e pg_signal_backend, para cancelar.',
        },
        {
          type: 'code',
          value: monitorCode(comments.pt),
        },
        {
          type: 'ordered',
          items: [
            'Crie o papel: CREATE ROLE temp_watchdog LOGIN PASSWORD ... e GRANT pg_monitor, pg_signal_backend TO temp_watchdog. pg_signal_backend não cancela sessões de superusuário, o que é o comportamento desejado.',
            'Calibre os limites pelo espaço livre real: o alerta em cerca de 25% do espaço livre e o cancelamento em cerca de 60%, deixando folga para o pg_wal.',
            'Rode o monitor fora do servidor do banco, com reinício automático (systemd, container ou o mesmo orquestrador da aplicação), e alerte também se ele parar de reportar.',
            'Mantenha o alerta de disco do sistema operacional baseado em velocidade de crescimento, não só em percentual: 5% em cinco minutos é incidente, 5% em uma semana é planejamento.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Aumentar work_mem globalmente resolve o problema de arquivos temporários?',
      answer:
        'Reduz o spill de consultas que estavam no limite, mas troca risco de disco por risco de memória. work_mem é por operação, por worker e por conexão, então um valor alto multiplicado por centenas de conexões leva o servidor ao OOM killer. A forma segura é manter o global baixo, entre 4 e 16 MB para OLTP, e subir por papel (ALTER ROLE ... SET work_mem) ou por transação (SET LOCAL) para relatórios e jobs que realmente precisam. E se a consulta gera centenas de milhões de linhas intermediárias, nenhum work_mem resolve: o problema é a consulta.',
    },
    {
      question: 'O disco está enchendo de arquivos temporários agora. O que eu faço primeiro?',
      answer:
        'Rode a consulta de pg_ls_tmpdir cruzada com pg_stat_activity para achar o pid, confira o texto da consulta e execute SELECT pg_cancel_backend(pid). Os arquivos temporários somem quando a consulta é cancelada. Se o cancelamento não responder em alguns segundos, use pg_terminate_backend(pid). Não apague arquivos do pgsql_tmp manualmente com o banco no ar. Depois, ligue log_temp_files se ainda estiver desligado, porque essa é a evidência que você vai querer na próxima vez.',
    },
    {
      question: 'Posso colocar temp_tablespaces em tmpfs ou em disco efêmero da nuvem?',
      answer:
        'Disco local efêmero (NVMe de instância) é uma boa escolha: é rápido e o conteúdo de temp não precisa sobreviver a um restart. O cuidado é que o diretório do tablespace precisa existir, com dono postgres, antes de o banco subir; caso contrário, toda consulta que precisar de arquivo temporário falha até alguém recriar o diretório. Um script de boot resolve. tmpfs é pior, porque usa a mesma RAM que shared_buffers, work_mem e o cache do sistema operacional: você troca disco cheio por pressão de memória, justamente no momento em que uma consulta pesada está rodando.',
    },
  ],
  conclusion: {
    title: 'Arquivo temporário é sintoma, disco cheio é consequência',
    description:
      'Quando o Postgres não tem memória para uma operação, ele usa disco, e isso é uma qualidade: a consulta termina em vez de falhar. O problema é quando nada limita quanto disco uma consulta, uma tabela temporária ou a soma das sessões pode usar, e esse disco é o mesmo do pg_wal. Separe o temp do WAL, coloque temp_file_limit para aplicações e para o BI, dê work_mem alto apenas por papel ou por transação, use ON COMMIT DROP e ANALYZE em tabelas temporárias, ligue log_temp_files e monitore o pgsql_tmp somado. Com isso, a próxima consulta com join errado vira um ERROR no painel de quem a escreveu, não um PANIC na primária às 14h31.',
    cta: 'Revisar a configuração e as consultas pesadas do meu Postgres',
  },
  related: [
    {
      label: 'Slot de replicação esquecido que enche o disco: WAL retido por um consumidor que morreu',
      to: '/blog/slot-de-replicacao-esquecido-que-enche-o-disco-wal-retido-por-um-consumidor-que-morreu',
    },
    {
      label: 'Relatório pesado que derruba a API: mover a consulta para execução assíncrona com resultado em cache',
      to: '/blog/relatorio-pesado-que-derruba-a-api-mover-a-consulta-para-execucao-assincrona-com-resultado-em-cache',
    },
    {
      label: 'Serviço de observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'At 14:31 on a Tuesday, the primary of an e-commerce database went down with "PANIC: could not write to file pg_wal/xlogtemp: No space left on device". Two minutes later the database came back on its own, the disk was at 62% and the log had not a single line explaining who had written 380 GB in half an hour. The culprit was a BI report with a join missing its date condition, which produced 412 million intermediate rows and dumped all of them into temporary files because nothing fit in 4 MB of work_mem. The restart erased the evidence. This article explains how Postgres turns a lack of memory into disk usage, why temporary tables are a separate disk consumer that temp_file_limit does not see, how to find within minutes which session is filling pgsql_tmp and which limits to put in place so that the next runaway query fails on its own instead of taking down the primary.',
  sections: [
    {
      title: 'The incident: 380 GB of temporary files in 29 minutes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The primary volume had 1 TB and held both data and pg_wal, the default layout in most installations. The disk alert fired at 90%, designed for table growth, which takes weeks. Temporary files do not follow that pace: a single query writes hundreds of megabytes per second, and going from 70% to 100% took eleven minutes.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'Three details make this incident typical. First, the disk did not fill up with data, it filled up with the intermediate work of a query that did not even write anything. Second, what died was not the query but the whole database: when Postgres cannot write WAL, it PANICs, because it can no longer guarantee durability. Third, since Postgres 14 remove_temp_files_after_crash is on by default and the restart cleans pgsql_tmp. That is the right behavior to free the space, and also the reason the team found a healthy disk and no culprit.',
        },
        {
          type: 'paragraph',
          value:
            'The rerun at 14:15 deserves attention. Metabase, like most BI tools, runs the query again when the user reloads the dashboard, and the previous query keeps running in the database until it finishes or is cancelled. Two copies of the same runaway query double the speed at which the disk fills.',
        },
      ],
    },
    {
      title: 'How work_mem turns into disk: sort, hash join and hash aggregate',
      blocks: [
        {
          type: 'paragraph',
          value:
            'work_mem is neither the memory of a session nor of a query. It is the limit of each sort or hash operation inside the plan. A query with three hash joins and a sort can use four times work_mem, and every parallel worker has its own budget. Hash operations can also use work_mem multiplied by hash_mem_multiplier, which is 2.0 from Postgres 15 on. When the operation goes over the limit it does not fail: it continues on disk, writing files in base/pgsql_tmp (or in the temp_tablespaces tablespace), in 1 GB segments named pgsql_tmp<pid>.<n>.',
        },
        {
          type: 'table',
          columns: ['Operation', 'What it does when it exceeds work_mem', 'How it shows in EXPLAIN ANALYZE'],
          rows: [
            ['Sort (ORDER BY, DISTINCT, merge join)', 'Sorts in runs and merges them on disk', 'Sort Method: external merge  Disk: N kB'],
            ['Hash Join', 'Partitions both inputs into batches written to disk', 'Batches: 32 (originally 1)'],
            ['HashAggregate (GROUP BY)', 'Spills groups to disk since Postgres 13', 'Batches: N  Memory Usage  Disk Usage'],
            ['Materialize, materialized CTE', 'Keeps the intermediate result in an on disk tuplestore', 'Storage: Disk  Maximum Storage: N kB (Postgres 18+)'],
            ['Window function', 'Keeps the partition in a tuplestore that overflows to disk', 'Storage: Disk (Postgres 18+)'],
          ],
        },
        {
          type: 'code',
          value: planCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'Read the plan from the bottom up. The join with promocoes multiplies 10.3 million items by about 40 promotions per category, because the promotion validity condition was left out. From there on no memory tuning saves the query: sorting 412 million rows so that GROUP BY can then collapse them into 1.8 million groups, with revenue multiplied by 40 along the way, is wasted work that also produces a wrong number, and the disk is just where that work becomes visible. The temp read/written line from BUFFERS is the most honest metric, because it shows the real volume that went to disk, including nodes that do not display Disk.',
        },
        {
          type: 'paragraph',
          value:
            'Be careful with EXPLAIN ANALYZE on a suspicious query: it actually runs the query and writes the same 380 GB. Start with EXPLAIN without ANALYZE to look at the row estimates, then run ANALYZE over one day instead of one month, always with statement_timeout and temp_file_limit set in the session. The fix here was to join promocoes on its validity window (pr.inicio <= p.criado_em AND pr.fim > p.criado_em) and aggregate the items before the join. The query dropped to 1.9 million intermediate rows, finished in 41 seconds and wrote no temporary file at all with a 64 MB work_mem.',
        },
      ],
    },
    {
      title: 'Temporary tables: the disk usage temp_file_limit does not see',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Query temporary files and temporary tables are different things, and the documentation is explicit that temp_file_limit does not count the space of tables created with CREATE TEMP TABLE. They are real relations: they have a file on disk (base/<database oid>/t<session id>_<relfilenode>, or in the temp_tablespaces tablespace), go through a session local cache sized by temp_buffers, 8 MB by default, and do not generate WAL. A 200 GB temporary table grows until the disk is full with no configuration limit in the way.',
        },
        {
          type: 'list',
          items: [
            'Connection pools extend the life of the table. Without ON COMMIT DROP, a temporary table only goes away when the session ends. Behind a pool the session may live for days, and the space stays taken long after the job is over.',
            'Autovacuum does not process temporary tables. Without a manual ANALYZE, the planner uses default estimates, picks a nested loop where it should use a hash join and the next query takes hours.',
            'Creating and dropping temporary tables at high frequency bloats pg_class and pg_attribute, because each table inserts and deletes catalog rows. I have seen a 40 GB pg_attribute in a system that created one temporary table per HTTP request.',
            'A crash leaves orphan pg_temp_N schemas behind. Autovacuum removes those tables later, but the space only comes back when that happens.',
          ],
        },
        {
          type: 'code',
          value: tempTableCode,
        },
        {
          type: 'paragraph',
          value:
            'The fixed version addresses all four points: ON COMMIT DROP ties the table to the transaction rather than the connection, selecting only three columns makes it ten times smaller in this case, ANALYZE gives the planner the real row count and the job no longer depends on when the pool decides to close the connection. If the ETL goes through PgBouncer in transaction pooling, a temporary table outside a transaction is not even safe: the next statement may land on a different server connection.',
        },
      ],
    },
    {
      title: 'Diagnosis: who is filling the disk now and who filled it yesterday',
      blocks: [
        {
          type: 'paragraph',
          value:
            'During the incident, the question is which session is writing. The name of every file in pgsql_tmp carries the process pid, and pg_ls_tmpdir (Postgres 12+, granted to the pg_monitor role) lists the files with their size. Extract the pid from the name and join it with pg_stat_activity. After the incident, the question becomes which query does this often, and that is where pg_stat_database and pg_stat_statements come in.',
        },
        {
          type: 'code',
          value: diagnosticoCode(comments.en),
        },
        {
          type: 'list',
          items: [
            'Parallel hash join writes its batches into subdirectories with a .fileset suffix (.sharedfileset before Postgres 15). pg_ls_tmpdir only lists regular files and skips those directories. If the sum from the query is far below what df shows, run du -sh on pgsql_tmp to confirm.',
            'pg_stat_database.temp_bytes is only incremented when a file is closed. A query that is still writing does not show up there, so it is useful for trends, not for the incident in progress.',
            'log_temp_files logs the path and size of every file removed, followed by the STATEMENT that created it. It is the only evidence that survives a crash, because the log lives outside pgsql_tmp.',
            'To stop the query, use pg_cancel_backend(pid). Temporary files are removed when the operation ends. Never delete files from pgsql_tmp with rm while the database is up: the process still holds the file open, the space does not come back and the query fails unpredictably.',
          ],
        },
      ],
    },
    {
      title: 'Layered limits: memory per role, a temp ceiling and another volume',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There is no single parameter that solves it. A high global work_mem looks like the obvious answer, but it is multiplied per operation, per worker and per connection: 100 active connections with three hash operations each and a 256 MB work_mem can ask for 150 GB of RAM on a 64 GB server, and the OOM killer takes the database down just the same. The way out is to give memory to whoever needs it, put a ceiling on whoever can run away and get pg_wal out of the path of temporary files.',
        },
        {
          type: 'code',
          value: configCode(comments.en),
        },
        {
          type: 'table',
          columns: ['Setting', 'Scope', 'What it protects', 'What it does not protect'],
          rows: [
            ['work_mem per role or SET LOCAL', 'Each sort or hash operation', 'Needless spill in reports and ETL', 'Does not limit disk, only lowers the chance of using it'],
            ['temp_file_limit', 'Each process, including each parallel worker', 'A runaway query: fails with ERROR instead of filling the disk', 'Temporary tables and the sum of several sessions'],
            ['statement_timeout', 'Each statement', 'A query that runs for hours', 'A fast query that writes 100 GB in 5 minutes'],
            ['temp_tablespaces on another volume', 'Instance, role or session', 'pg_wal and data: a full disk becomes a query error, not a PANIC', 'Does not reduce the volume written'],
            ['log_temp_files', 'Instance', 'Evidence after the incident, even after a crash', 'Prevents nothing'],
            ['pgsql_tmp monitor', 'Sum of all sessions', 'Alert and cancellation before the volume fills', 'Depends on it running and having permission'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'temp_file_limit can only be changed by a superuser (or by whoever was granted SET on the parameter, from Postgres 15 on), which is on purpose: a regular user cannot turn off their own ceiling. When a query goes over the limit it gets "ERROR: temporary file size exceeds temp_file_limit" and its files are removed. The 20 GB global ceiling is for applications, and the BI role gets 50 GB because legitimate reports come close to that. With temp_tablespaces on a separate disk, even the worst case only fills that disk, and the database keeps accepting writes. On managed services such as RDS, Cloud SQL and Azure, temporary files usually live on the same storage as the data and a separate tablespace is not always available, so temp_file_limit and the monitor become the main defense.',
        },
      ],
    },
    {
      title: 'A monitor that warns and cancels before the disk fills',
      blocks: [
        {
          type: 'paragraph',
          value:
            'temp_file_limit protects against one query, but ten sessions with 20 GB each add up to 200 GB and none of them went over the limit. The disk alert looks at the whole volume and arrives late. The monitor below looks specifically at the temporary files of every session every 15 seconds, warns when the sum goes above 50 GB with the name of who is writing and cancels any query that goes above 150 GB. It needs a role with pg_monitor, to read pg_ls_tmpdir and the query text, and pg_signal_backend, to cancel.',
        },
        {
          type: 'code',
          value: monitorCode(comments.en),
        },
        {
          type: 'ordered',
          items: [
            'Create the role: CREATE ROLE temp_watchdog LOGIN PASSWORD ... and GRANT pg_monitor, pg_signal_backend TO temp_watchdog. pg_signal_backend cannot cancel superuser sessions, which is the desired behavior.',
            'Calibrate the limits from the real free space: the alert at about 25% of the free space and the cancellation at about 60%, leaving room for pg_wal.',
            'Run the monitor outside the database server, with automatic restart (systemd, a container or the same orchestrator as the application), and also alert if it stops reporting.',
            'Keep the operating system disk alert based on growth rate, not only on percentage: 5% in five minutes is an incident, 5% in a week is planning.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does raising work_mem globally solve the temporary file problem?',
      answer:
        'It reduces spill in queries that were right at the edge, but trades disk risk for memory risk. work_mem is per operation, per worker and per connection, so a high value multiplied by hundreds of connections sends the server to the OOM killer. The safe approach is to keep the global value low, between 4 and 16 MB for OLTP, and raise it per role (ALTER ROLE ... SET work_mem) or per transaction (SET LOCAL) for reports and jobs that really need it. And if the query produces hundreds of millions of intermediate rows, no work_mem helps: the problem is the query.',
    },
    {
      question: 'The disk is filling up with temporary files right now. What do I do first?',
      answer:
        'Run the pg_ls_tmpdir query joined with pg_stat_activity to find the pid, check the query text and run SELECT pg_cancel_backend(pid). The temporary files go away when the query is cancelled. If the cancel does not respond within a few seconds, use pg_terminate_backend(pid). Do not delete files from pgsql_tmp by hand while the database is up. Afterwards, turn on log_temp_files if it is still off, because that is the evidence you will want next time.',
    },
    {
      question: 'Can I put temp_tablespaces on tmpfs or on ephemeral cloud disk?',
      answer:
        'Ephemeral local disk (instance NVMe) is a good choice: it is fast and temp content does not need to survive a restart. The catch is that the tablespace directory must exist, owned by postgres, before the database starts; otherwise every query that needs a temporary file fails until someone recreates the directory. A boot script takes care of it. tmpfs is worse, because it uses the same RAM as shared_buffers, work_mem and the operating system cache: you trade a full disk for memory pressure, exactly when a heavy query is running.',
    },
  ],
  conclusion: {
    title: 'Temporary files are the symptom, a full disk is the consequence',
    description:
      'When Postgres does not have memory for an operation it uses disk, and that is a feature: the query finishes instead of failing. The problem is when nothing limits how much disk a query, a temporary table or the sum of all sessions can use, and that disk is the same one pg_wal lives on. Separate temp from WAL, set temp_file_limit for applications and for BI, give high work_mem only per role or per transaction, use ON COMMIT DROP and ANALYZE on temporary tables, turn on log_temp_files and monitor the total size of pgsql_tmp. With that in place, the next query with a broken join becomes an ERROR on the dashboard of whoever wrote it, not a PANIC on the primary at 14:31.',
    cta: 'Review the configuration and heavy queries of my Postgres',
  },
  related: [
    {
      label: 'The forgotten replication slot that fills the disk: WAL retained by a consumer that died',
      to: '/blog/slot-de-replicacao-esquecido-que-enche-o-disco-wal-retido-por-um-consumidor-que-morreu',
    },
    {
      label: 'The heavy report that takes down the API: moving the query to asynchronous execution with a cached result',
      to: '/blog/relatorio-pesado-que-derruba-a-api-mover-a-consulta-para-execucao-assincrona-com-resultado-em-cache',
    },
    {
      label: 'Observability and reliability service',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'A las 14:31 de un martes, la primaria de un e-commerce cayó con "PANIC: could not write to file pg_wal/xlogtemp: No space left on device". Dos minutos después la base volvió sola, el disco estaba al 62% y el log no tenía una sola línea que explicara quién había escrito 380 GB en media hora. El culpable era un reporte de BI con un join sin condición de fecha, que generó 412 millones de filas intermedias y volcó todo en archivos temporales porque nada cabía en los 4 MB de work_mem. El reinicio borró la evidencia. Este artículo explica cómo Postgres convierte la falta de memoria en disco, por qué la tabla temporal es un consumidor de disco aparte que temp_file_limit no ve, cómo descubrir en minutos qué sesión está llenando pgsql_tmp y qué límites poner para que la próxima consulta descontrolada falle sola en lugar de tumbar la primaria.',
  sections: [
    {
      title: 'El incidente: 380 GB de archivos temporales en 29 minutos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El volumen de la primaria tenía 1 TB y guardaba datos y pg_wal juntos, la configuración por defecto en la mayoría de las instalaciones. La alerta de disco saltaba en 90%, pensada para el crecimiento de las tablas, que lleva semanas. Los archivos temporales no respetan ese ritmo: una sola consulta escribe cientos de megabytes por segundo, y pasar de 70% a 100% llevó once minutos.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'Tres detalles hacen típico este incidente. Primero, el disco no se llenó por datos, se llenó por el trabajo intermedio de una consulta que ni siquiera escribía nada. Segundo, lo que murió no fue la consulta sino la base entera: cuando Postgres no puede escribir WAL, entra en PANIC, porque ya no puede garantizar durabilidad. Tercero, desde Postgres 14 remove_temp_files_after_crash viene activado y el reinicio limpia pgsql_tmp. Es el comportamiento correcto para liberar el espacio, y también la razón por la que el equipo encontró un disco sano y ningún culpable.',
        },
        {
          type: 'paragraph',
          value:
            'La reejecución de las 14:15 merece atención. Metabase, como la mayoría de las herramientas de BI, vuelve a ejecutar la consulta cuando el usuario recarga el panel, y la consulta anterior sigue corriendo en la base hasta terminar o ser cancelada. Dos copias de la misma consulta descontrolada duplican la velocidad con la que se llena el disco.',
        },
      ],
    },
    {
      title: 'Cómo work_mem se convierte en disco: sort, hash join y hash aggregate',
      blocks: [
        {
          type: 'paragraph',
          value:
            'work_mem no es la memoria de una sesión ni de una consulta. Es el límite de cada operación de ordenamiento o de hash dentro del plan. Una consulta con tres hash joins y un sort puede usar cuatro veces work_mem, y cada worker paralelo tiene su propio presupuesto. Las operaciones de hash además pueden usar work_mem multiplicado por hash_mem_multiplier, que vale 2.0 a partir de Postgres 15. Cuando la operación supera el límite no falla: continúa en disco, escribiendo archivos en base/pgsql_tmp (o en el tablespace de temp_tablespaces), en segmentos de 1 GB llamados pgsql_tmp<pid>.<n>.',
        },
        {
          type: 'table',
          columns: ['Operación', 'Qué hace al superar work_mem', 'Cómo aparece en EXPLAIN ANALYZE'],
          rows: [
            ['Sort (ORDER BY, DISTINCT, merge join)', 'Ordena por bloques y hace el merge en disco', 'Sort Method: external merge  Disk: N kB'],
            ['Hash Join', 'Particiona las dos entradas en batches escritos en disco', 'Batches: 32 (originally 1)'],
            ['HashAggregate (GROUP BY)', 'Vuelca grupos a disco desde Postgres 13', 'Batches: N  Memory Usage  Disk Usage'],
            ['Materialize, CTE materializada', 'Guarda el resultado intermedio en un tuplestore en disco', 'Storage: Disk  Maximum Storage: N kB (Postgres 18+)'],
            ['Window function', 'Mantiene la partición en un tuplestore que desborda a disco', 'Storage: Disk (Postgres 18+)'],
          ],
        },
        {
          type: 'code',
          value: planCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'Lea el plan de abajo hacia arriba. El join con promocoes multiplica 10,3 millones de ítems por unas 40 promociones por categoría, porque la condición de vigencia de la promoción quedó fuera. A partir de ahí ningún ajuste de memoria salva la consulta: ordenar 412 millones de filas para que luego el GROUP BY las reduzca a 1,8 millones de grupos, con la facturación multiplicada por 40 en el camino, es trabajo inútil que además produce un número equivocado, y el disco es solo donde ese trabajo se vuelve visible. La línea temp read/written de BUFFERS es la métrica más honesta, porque muestra el volumen real que fue a disco, incluso de nodos que no muestran Disk.',
        },
        {
          type: 'paragraph',
          value:
            'Cuidado con EXPLAIN ANALYZE en una consulta sospechosa: ejecuta la consulta de verdad y escribe los mismos 380 GB. Empiece con EXPLAIN sin ANALYZE para ver las estimaciones de filas, luego ejecute ANALYZE con un período de un día en lugar de un mes, siempre con statement_timeout y temp_file_limit definidos en la sesión. La corrección aquí fue unir promocoes por su vigencia (pr.inicio <= p.criado_em AND pr.fim > p.criado_em) y agregar los ítems antes del join. La consulta bajó a 1,9 millones de filas intermedias, terminó en 41 segundos y no escribió ningún archivo temporal con un work_mem de 64 MB.',
        },
      ],
    },
    {
      title: 'Tabla temporal: el consumo de disco que temp_file_limit no ve',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Los archivos temporales de consulta y las tablas temporales son cosas distintas, y la documentación deja explícito que temp_file_limit no cuenta el espacio de las tablas creadas con CREATE TEMP TABLE. Son relaciones de verdad: tienen archivo en disco (base/<oid de la base>/t<id de la sesión>_<relfilenode>, o en el tablespace de temp_tablespaces), pasan por una caché local de la sesión con el tamaño definido por temp_buffers, 8 MB por defecto, y no generan WAL. Una tabla temporal de 200 GB crece hasta llenar el disco sin ningún límite de configuración en el camino.',
        },
        {
          type: 'list',
          items: [
            'El pool de conexiones prolonga la vida de la tabla. Sin ON COMMIT DROP, la tabla temporal solo desaparece cuando termina la sesión. Detrás de un pool, la sesión puede vivir días, y el espacio sigue ocupado mucho después de que el job terminó.',
            'Autovacuum no procesa tablas temporales. Sin un ANALYZE manual, el planificador usa estimaciones por defecto, elige nested loop donde debería usar hash join y la siguiente consulta tarda horas.',
            'Crear y borrar tablas temporales con alta frecuencia infla pg_class y pg_attribute, porque cada tabla inserta y elimina filas del catálogo. He visto un pg_attribute de 40 GB en un sistema que creaba una tabla temporal por cada petición HTTP.',
            'Un crash deja esquemas pg_temp_N huérfanos. Autovacuum elimina esas tablas más tarde, pero el espacio solo vuelve cuando eso ocurre.',
          ],
        },
        {
          type: 'code',
          value: tempTableCode,
        },
        {
          type: 'paragraph',
          value:
            'La versión corregida resuelve los cuatro puntos: ON COMMIT DROP ata la tabla a la transacción y no a la conexión, seleccionar solo tres columnas la reduce diez veces en este caso, ANALYZE le da al planificador el número real de filas y el job deja de depender de cuándo el pool decide cerrar la conexión. Si el ETL pasa por PgBouncer en transaction pooling, una tabla temporal fuera de una transacción ni siquiera es segura: la siguiente instrucción puede caer en otra conexión del servidor.',
        },
      ],
    },
    {
      title: 'Diagnóstico: quién está llenando el disco ahora y quién lo llenó ayer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Durante el incidente, la pregunta es qué sesión está escribiendo. El nombre de cada archivo en pgsql_tmp lleva el pid del proceso, y pg_ls_tmpdir (Postgres 12+, habilitada para el rol pg_monitor) lista los archivos con su tamaño. Basta con extraer el pid del nombre y cruzarlo con pg_stat_activity. Después del incidente, la pregunta pasa a ser qué consulta hace esto con frecuencia, y ahí entran pg_stat_database y pg_stat_statements.',
        },
        {
          type: 'code',
          value: diagnosticoCode(comments.es),
        },
        {
          type: 'list',
          items: [
            'El hash join paralelo escribe sus batches en subdirectorios con sufijo .fileset (.sharedfileset antes de Postgres 15). pg_ls_tmpdir solo lista archivos regulares y deja fuera esos directorios. Si la suma de la consulta queda muy por debajo de lo que muestra df, ejecute du -sh en pgsql_tmp para confirmar.',
            'pg_stat_database.temp_bytes solo se incrementa cuando el archivo se cierra. Una consulta que sigue escribiendo no aparece ahí, por eso sirve para tendencias y no para el incidente en curso.',
            'log_temp_files registra la ruta y el tamaño de cada archivo eliminado, seguido del STATEMENT que lo creó. Es la única evidencia que sobrevive a un crash, porque el log vive fuera de pgsql_tmp.',
            'Para detener la consulta, use pg_cancel_backend(pid). Los archivos temporales se eliminan cuando la operación termina. Nunca borre archivos de pgsql_tmp con rm con la base en marcha: el proceso aún tiene el archivo abierto, el espacio no vuelve y la consulta falla de forma impredecible.',
          ],
        },
      ],
    },
    {
      title: 'Límites en capas: memoria por rol, techo de temp y otro volumen',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No existe un único parámetro que lo resuelva. Un work_mem global alto parece la salida obvia, pero se multiplica por operación, por worker y por conexión: 100 conexiones activas con tres operaciones de hash cada una y un work_mem de 256 MB pueden pedir 150 GB de RAM en un servidor de 64 GB, y el OOM killer tumba la base igual. El camino es dar memoria a quien la necesita, poner techo a quien puede descontrolarse y sacar pg_wal del camino de los archivos temporales.',
        },
        {
          type: 'code',
          value: configCode(comments.es),
        },
        {
          type: 'table',
          columns: ['Configuración', 'Alcance', 'Qué protege', 'Qué no protege'],
          rows: [
            ['work_mem por rol o SET LOCAL', 'Cada operación de sort o hash', 'Spill innecesario en reportes y ETL', 'No limita el disco, solo reduce la probabilidad de usarlo'],
            ['temp_file_limit', 'Cada proceso, incluido cada worker paralelo', 'Una consulta descontrolada: falla con ERROR en lugar de llenar el disco', 'Tablas temporales y la suma de varias sesiones'],
            ['statement_timeout', 'Cada sentencia', 'Una consulta que corre durante horas', 'Una consulta rápida que escribe 100 GB en 5 minutos'],
            ['temp_tablespaces en otro volumen', 'Instancia, rol o sesión', 'pg_wal y datos: el disco lleno se vuelve error de consulta, no PANIC', 'No reduce el volumen escrito'],
            ['log_temp_files', 'Instancia', 'Evidencia después del incidente, incluso después de un crash', 'No impide nada'],
            ['Monitor de pgsql_tmp', 'Suma de todas las sesiones', 'Alerta y cancelación antes de que se llene el volumen', 'Depende de que esté corriendo y con permiso'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'temp_file_limit solo puede cambiarlo un superusuario (o quien recibió GRANT SET sobre el parámetro, a partir de Postgres 15), lo cual es intencional: un usuario común no puede desactivar su propio techo. Cuando la consulta supera el límite recibe "ERROR: temporary file size exceeds temp_file_limit" y sus archivos se eliminan. El techo global de 20 GB es para las aplicaciones, y el rol de BI recibe 50 GB porque los reportes legítimos se acercan a eso. Con temp_tablespaces en un disco separado, incluso el peor caso solo llena ese disco, y la base sigue aceptando escrituras. En servicios gestionados como RDS, Cloud SQL y Azure, los archivos temporales suelen vivir en el mismo almacenamiento que los datos y el tablespace separado no siempre está disponible, así que temp_file_limit y el monitor pasan a ser la defensa principal.',
        },
      ],
    },
    {
      title: 'Un monitor que avisa y cancela antes de que se llene el disco',
      blocks: [
        {
          type: 'paragraph',
          value:
            'temp_file_limit protege contra una consulta, pero diez sesiones con 20 GB cada una suman 200 GB y ninguna superó el límite. La alerta de disco mira el volumen entero y llega tarde. El monitor de abajo mira específicamente los archivos temporales de todas las sesiones cada 15 segundos, avisa cuando la suma supera 50 GB con el nombre de quien está escribiendo y cancela cualquier consulta que supere 150 GB. Necesita un rol con pg_monitor, para leer pg_ls_tmpdir y el texto de las consultas, y pg_signal_backend, para cancelar.',
        },
        {
          type: 'code',
          value: monitorCode(comments.es),
        },
        {
          type: 'ordered',
          items: [
            'Cree el rol: CREATE ROLE temp_watchdog LOGIN PASSWORD ... y GRANT pg_monitor, pg_signal_backend TO temp_watchdog. pg_signal_backend no cancela sesiones de superusuario, que es el comportamiento deseado.',
            'Calibre los límites según el espacio libre real: la alerta en alrededor del 25% del espacio libre y la cancelación en alrededor del 60%, dejando margen para pg_wal.',
            'Ejecute el monitor fuera del servidor de la base, con reinicio automático (systemd, contenedor o el mismo orquestador de la aplicación), y alerte también si deja de reportar.',
            'Mantenga la alerta de disco del sistema operativo basada en velocidad de crecimiento, no solo en porcentaje: 5% en cinco minutos es un incidente, 5% en una semana es planificación.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Subir work_mem globalmente resuelve el problema de los archivos temporales?',
      answer:
        'Reduce el spill de las consultas que estaban al límite, pero cambia riesgo de disco por riesgo de memoria. work_mem es por operación, por worker y por conexión, así que un valor alto multiplicado por cientos de conexiones lleva el servidor al OOM killer. La forma segura es mantener el global bajo, entre 4 y 16 MB para OLTP, y subirlo por rol (ALTER ROLE ... SET work_mem) o por transacción (SET LOCAL) para reportes y jobs que realmente lo necesitan. Y si la consulta genera cientos de millones de filas intermedias, ningún work_mem ayuda: el problema es la consulta.',
    },
    {
      question: 'El disco se está llenando de archivos temporales ahora. ¿Qué hago primero?',
      answer:
        'Ejecute la consulta de pg_ls_tmpdir cruzada con pg_stat_activity para encontrar el pid, revise el texto de la consulta y ejecute SELECT pg_cancel_backend(pid). Los archivos temporales desaparecen cuando se cancela la consulta. Si la cancelación no responde en unos segundos, use pg_terminate_backend(pid). No borre archivos de pgsql_tmp a mano con la base en marcha. Después, active log_temp_files si todavía está desactivado, porque esa es la evidencia que va a querer la próxima vez.',
    },
    {
      question: '¿Puedo poner temp_tablespaces en tmpfs o en un disco efímero de la nube?',
      answer:
        'Un disco local efímero (NVMe de instancia) es una buena opción: es rápido y el contenido temporal no necesita sobrevivir a un reinicio. El cuidado es que el directorio del tablespace debe existir, con dueño postgres, antes de que la base arranque; de lo contrario, toda consulta que necesite un archivo temporal falla hasta que alguien recree el directorio. Un script de arranque lo resuelve. tmpfs es peor, porque usa la misma RAM que shared_buffers, work_mem y la caché del sistema operativo: cambia disco lleno por presión de memoria, justo cuando una consulta pesada está corriendo.',
    },
  ],
  conclusion: {
    title: 'El archivo temporal es el síntoma, el disco lleno es la consecuencia',
    description:
      'Cuando Postgres no tiene memoria para una operación usa disco, y eso es una virtud: la consulta termina en lugar de fallar. El problema es cuando nada limita cuánto disco puede usar una consulta, una tabla temporal o la suma de las sesiones, y ese disco es el mismo de pg_wal. Separe el temp del WAL, ponga temp_file_limit para las aplicaciones y para el BI, dé un work_mem alto solo por rol o por transacción, use ON COMMIT DROP y ANALYZE en las tablas temporales, active log_temp_files y monitoree el total de pgsql_tmp. Con eso, la próxima consulta con un join equivocado se convierte en un ERROR en el panel de quien la escribió, no en un PANIC en la primaria a las 14:31.',
    cta: 'Revisar la configuración y las consultas pesadas de mi Postgres',
  },
  related: [
    {
      label: 'El slot de replicación olvidado que llena el disco: WAL retenido por un consumidor que murió',
      to: '/blog/slot-de-replicacao-esquecido-que-enche-o-disco-wal-retido-por-um-consumidor-que-morreu',
    },
    {
      label: 'El reporte pesado que tumba la API: mover la consulta a ejecución asíncrona con resultado en caché',
      to: '/blog/relatorio-pesado-que-derruba-a-api-mover-a-consulta-para-execucao-assincrona-com-resultado-em-cache',
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
