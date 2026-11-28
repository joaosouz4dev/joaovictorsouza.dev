// Conteudo do artigo: fila no Postgres com SKIP LOCKED que fica lenta. Por que a busca do
// proximo lote passa a varrer centenas de milhares de versoes mortas que o VACUUM nao pode
// remover enquanto um snapshot antigo estiver aberto, como o indice inchado encarece cada
// VACUUM e como redesenhar a fila com tabela pequena, indice parcial e reserva curta.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const comments = {
  pt: {
    a1: 'Fila de tarefas: tudo na mesma tabela, pendentes e concluídas.',
    a2: 'Worker (4 instâncias): pega 10 tarefas, executa e marca como concluídas na mesma transação.',
    a3: 'A aplicação executa as 10 tarefas aqui, com a transação aberta.',
    a4: 'Limpeza noturna, às 02:00: apaga de uma vez as concluídas com mais de 7 dias.',
    b1: 'EXPLAIN ANALYZE com FOR UPDATE trava as linhas de verdade: rode dentro de BEGIN e ROLLBACK.',
    b2: '10 linhas devolvidas, 38 mil buffers lidos: o trabalho está no que a consulta descarta, não no que ela devolve.',
    b3: 'Versões mortas acumuladas e a última passada do autovacuum.',
    b4: 'O VACUUM diz com todas as letras quando não pode remover.',
    c1: 'Sessões: transação ou snapshot mais antigo em aberto.',
    c2: 'Slots de replicação que seguram xmin (réplica com hot_standby_feedback, por exemplo).',
    c3: 'Transações preparadas (2PC) esquecidas.',
    d1: 'Tamanho em disco da tabela e do índice.',
    d2: 'Densidade das folhas do índice: abaixo de 50% indica muito espaço vazio.',
    d3: 'Reconstrói o índice sem bloquear leitura nem escrita.',
    e1: 'Colunas para agendamento, reserva com prazo e novas tentativas.',
    e2: 'Índices parciais: só o que falta fazer entra no índice.',
    e3: 'Histórico particionado por dia: a fila guarda só trabalho pendente.',
    e4: 'Retenção sem DELETE: remover a partição não gera nenhuma versão morta.',
    e5: 'Autovacuum por contagem absoluta, sem pausa de custo: a tabela é pequena e a passada é barata.',
    e6: 'Quem roda relatório não pode segurar o horizonte do banco inteiro.',
    f1: 'Reserva em uma única instrução, com commit automático: a trava de linha dura milissegundos.',
    f2: 'Conclui e arquiva na mesma instrução: a linha sai da fila e entra no histórico.',
    f3: 'Falha: volta para pendente com espera exponencial; depois de 8 tentativas fica como falhou.',
    f4: 'Devolve para a fila o que foi reservado por um worker que morreu.',
    f5: 'A execução acontece fora de qualquer transação; executar precisa ser idempotente.',
    f6: 'Fila vazia: espera um pouco em vez de consultar em laço.',
  },
  en: {
    a1: 'Task queue: everything in the same table, pending and completed.',
    a2: 'Worker (4 instances): takes 10 tasks, runs them and marks them completed in the same transaction.',
    a3: 'The application runs the 10 tasks here, with the transaction open.',
    a4: 'Nightly cleanup, at 02:00: deletes in one go the completed tasks older than 7 days.',
    b1: 'EXPLAIN ANALYZE with FOR UPDATE really locks the rows: run it inside BEGIN and ROLLBACK.',
    b2: '10 rows returned, 38 thousand buffers read: the work is in what the query discards, not in what it returns.',
    b3: 'Accumulated dead versions and the last autovacuum pass.',
    b4: 'VACUUM says in plain words when it cannot remove them.',
    c1: 'Sessions: oldest open transaction or snapshot.',
    c2: 'Replication slots holding xmin (a replica with hot_standby_feedback, for example).',
    c3: 'Forgotten prepared transactions (2PC).',
    d1: 'On-disk size of the table and the index.',
    d2: 'Leaf density of the index: below 50% means a lot of empty space.',
    d3: 'Rebuilds the index without blocking reads or writes.',
    e1: 'Columns for scheduling, leases with a deadline and retries.',
    e2: 'Partial indexes: only what is still to be done goes into the index.',
    e3: 'History partitioned by day: the queue keeps only pending work.',
    e4: 'Retention without DELETE: dropping the partition creates no dead version at all.',
    e5: 'Autovacuum by absolute count, with no cost delay: the table is small and the pass is cheap.',
    e6: 'Whoever runs reports must not hold the horizon of the whole database.',
    f1: 'Reservation in a single statement, with autocommit: the row lock lasts milliseconds.',
    f2: 'Completes and archives in the same statement: the row leaves the queue and enters the history.',
    f3: 'Failure: back to pending with exponential backoff; after 8 attempts it stays as failed.',
    f4: 'Returns to the queue whatever was reserved by a worker that died.',
    f5: 'Execution happens outside any transaction; executar must be idempotent.',
    f6: 'Empty queue: wait a little instead of polling in a tight loop.',
  },
  es: {
    a1: 'Cola de tareas: todo en la misma tabla, pendientes y concluidas.',
    a2: 'Worker (4 instancias): toma 10 tareas, las ejecuta y las marca como concluidas en la misma transacción.',
    a3: 'La aplicación ejecuta las 10 tareas aquí, con la transacción abierta.',
    a4: 'Limpieza nocturna, a las 02:00: borra de una vez las concluidas con más de 7 días.',
    b1: 'EXPLAIN ANALYZE con FOR UPDATE bloquea las filas de verdad: ejecútalo dentro de BEGIN y ROLLBACK.',
    b2: '10 filas devueltas, 38 mil buffers leídos: el trabajo está en lo que la consulta descarta, no en lo que devuelve.',
    b3: 'Versiones muertas acumuladas y la última pasada del autovacuum.',
    b4: 'El VACUUM dice con todas las letras cuándo no puede eliminar.',
    c1: 'Sesiones: transacción o snapshot más antiguo abierto.',
    c2: 'Slots de replicación que retienen xmin (una réplica con hot_standby_feedback, por ejemplo).',
    c3: 'Transacciones preparadas (2PC) olvidadas.',
    d1: 'Tamaño en disco de la tabla y del índice.',
    d2: 'Densidad de las hojas del índice: por debajo del 50% indica mucho espacio vacío.',
    d3: 'Reconstruye el índice sin bloquear lectura ni escritura.',
    e1: 'Columnas para programación, reserva con plazo y reintentos.',
    e2: 'Índices parciales: solo lo que falta por hacer entra en el índice.',
    e3: 'Historial particionado por día: la cola guarda solo trabajo pendiente.',
    e4: 'Retención sin DELETE: eliminar la partición no genera ninguna versión muerta.',
    e5: 'Autovacuum por conteo absoluto, sin pausa de costo: la tabla es pequeña y la pasada es barata.',
    e6: 'Quien ejecuta reportes no puede retener el horizonte de toda la base.',
    f1: 'Reserva en una sola instrucción, con commit automático: el bloqueo de fila dura milisegundos.',
    f2: 'Concluye y archiva en la misma instrucción: la fila sale de la cola y entra en el historial.',
    f3: 'Falla: vuelve a pendiente con espera exponencial; después de 8 intentos queda como fallida.',
    f4: 'Devuelve a la cola lo que fue reservado por un worker que murió.',
    f5: 'La ejecución ocurre fuera de cualquier transacción; executar debe ser idempotente.',
    f6: 'Cola vacía: espera un poco en lugar de consultar en bucle.',
  },
};

const buggyCode = (c) => `-- ${c.a1}
CREATE TABLE tarefas (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo      text        NOT NULL,
  payload   jsonb       NOT NULL,
  status    text        NOT NULL DEFAULT 'pendente',
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tarefas_status_criado_idx ON tarefas (status, criado_em);

-- ${c.a2}
BEGIN;
SELECT id, tipo, payload
  FROM tarefas
 WHERE status = 'pendente'
 ORDER BY criado_em
 LIMIT 10
   FOR UPDATE SKIP LOCKED;
-- ${c.a3}
UPDATE tarefas SET status = 'concluida' WHERE id = ANY($1);
COMMIT;

-- ${c.a4}
DELETE FROM tarefas
 WHERE status = 'concluida'
   AND criado_em < now() - interval '7 days';`;

const diagnosticCode = (c) => `-- ${c.b1}
BEGIN;
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM tarefas
 WHERE status = 'pendente'
 ORDER BY criado_em
 LIMIT 10
   FOR UPDATE SKIP LOCKED;
ROLLBACK;
--  Limit (actual time=641.870..641.912 rows=10 loops=1)
--    Buffers: shared hit=38412
--    ->  LockRows (actual time=641.868..641.908 rows=10 loops=1)
--          ->  Index Scan using tarefas_status_criado_idx on tarefas
--                (actual time=641.790..641.842 rows=40 loops=1)
--                Index Cond: (status = 'pendente'::text)
-- ${c.b2}

-- ${c.b3}
SELECT n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze
  FROM pg_stat_user_tables
 WHERE relname = 'tarefas';

-- ${c.b4}
VACUUM (VERBOSE) tarefas;
--  tuples: 0 removed, 9412077 remain, 918344 are dead but not yet removable
--  removable cutoff: 48211907, which was 1836911 XIDs old when operation ended`;

const horizonCode = (c) => `-- ${c.c1}
SELECT 'sessao' AS origem, pid::text AS quem, usename::text AS usuario,
       application_name, state,
       greatest(age(backend_xmin), age(backend_xid)) AS idade_xids,
       now() - xact_start AS aberta_ha
  FROM pg_stat_activity
 WHERE backend_xmin IS NOT NULL OR backend_xid IS NOT NULL
UNION ALL
-- ${c.c2}
SELECT 'slot', slot_name::text, NULL, NULL,
       CASE WHEN active THEN 'active' ELSE 'inactive' END,
       age(xmin), NULL
  FROM pg_replication_slots
 WHERE xmin IS NOT NULL
UNION ALL
-- ${c.c3}
SELECT 'prepared', gid, owner::text, NULL, NULL, age(transaction), now() - prepared
  FROM pg_prepared_xacts
 ORDER BY idade_xids DESC
 LIMIT 5;`;

const bloatCode = (c) => `-- ${c.d1}
SELECT pg_size_pretty(pg_relation_size('tarefas')) AS tabela,
       pg_size_pretty(pg_relation_size('tarefas_status_criado_idx')) AS indice;

-- ${c.d2}
CREATE EXTENSION IF NOT EXISTS pgstattuple;
SELECT leaf_pages, deleted_pages, avg_leaf_density, leaf_fragmentation
  FROM pgstatindex('tarefas_status_criado_idx');

-- ${c.d3}
REINDEX INDEX CONCURRENTLY tarefas_status_criado_idx;`;

const schemaCode = (c) => `-- ${c.e1}
ALTER TABLE tarefas
  ADD COLUMN executar_em   timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN reservado_ate timestamptz,
  ADD COLUMN tentativas    integer     NOT NULL DEFAULT 0,
  ADD COLUMN ultimo_erro   text;

-- ${c.e2}
CREATE INDEX CONCURRENTLY tarefas_pendentes_idx
    ON tarefas (executar_em, id)
 WHERE status = 'pendente';
CREATE INDEX CONCURRENTLY tarefas_reservadas_idx
    ON tarefas (reservado_ate)
 WHERE status = 'processando';
DROP INDEX CONCURRENTLY tarefas_status_criado_idx;

-- ${c.e3}
CREATE TABLE tarefas_historico (
  id           bigint      NOT NULL,
  tipo         text        NOT NULL,
  payload      jsonb       NOT NULL,
  criado_em    timestamptz NOT NULL,
  tentativas   integer     NOT NULL,
  concluido_em timestamptz NOT NULL
) PARTITION BY RANGE (concluido_em);
CREATE TABLE tarefas_historico_2026_11_28 PARTITION OF tarefas_historico
  FOR VALUES FROM ('2026-11-28') TO ('2026-11-29');
-- ${c.e4}
DROP TABLE tarefas_historico_2026_11_21;

-- ${c.e5}
ALTER TABLE tarefas SET (
  autovacuum_vacuum_scale_factor  = 0,
  autovacuum_vacuum_threshold     = 2000,
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold    = 2000,
  autovacuum_vacuum_cost_delay    = 0
);

-- ${c.e6}
ALTER ROLE relatorios SET statement_timeout = '5min';
ALTER ROLE relatorios SET idle_in_transaction_session_timeout = '1min';`;

const workerCode = (c) => `import pg from 'pg';
import { executar } from './tarefas.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  application_name: 'worker-tarefas',
  max: 12,
});
const LOTE = 10;

// ${c.f1}
const RESERVAR = [
  'WITH lote AS (',
  '  SELECT id FROM tarefas',
  "   WHERE status = 'pendente' AND executar_em <= now()",
  '   ORDER BY executar_em, id',
  '   LIMIT $1',
  '     FOR UPDATE SKIP LOCKED',
  ')',
  'UPDATE tarefas t',
  "   SET status = 'processando',",
  "       reservado_ate = now() + interval '2 minutes',",
  '       tentativas = t.tentativas + 1',
  '  FROM lote',
  ' WHERE t.id = lote.id',
  'RETURNING t.id, t.tipo, t.payload, t.tentativas',
].join('\\n');

// ${c.f2}
const CONCLUIR = [
  'WITH feita AS (',
  "  DELETE FROM tarefas WHERE id = $1 AND status = 'processando'",
  '  RETURNING id, tipo, payload, criado_em, tentativas',
  ')',
  'INSERT INTO tarefas_historico (id, tipo, payload, criado_em, tentativas, concluido_em)',
  'SELECT id, tipo, payload, criado_em, tentativas, now() FROM feita',
].join('\\n');

// ${c.f3}
const FALHAR = [
  'UPDATE tarefas',
  "   SET status = CASE WHEN tentativas >= 8 THEN 'falhou' ELSE 'pendente' END,",
  '       executar_em = now() + make_interval(secs => least(3600, 15 * 2 ^ tentativas)),',
  '       reservado_ate = NULL,',
  '       ultimo_erro = $2',
  " WHERE id = $1 AND status = 'processando'",
].join('\\n');

// ${c.f4}
const DEVOLVER_EXPIRADAS = [
  'UPDATE tarefas',
  "   SET status = 'pendente', reservado_ate = NULL",
  " WHERE status = 'processando' AND reservado_ate < now()",
].join('\\n');

async function ciclo() {
  const { rows: tarefas } = await pool.query(RESERVAR, [LOTE]);
  await Promise.all(
    tarefas.map(async (tarefa) => {
      try {
        // ${c.f5}
        await executar(tarefa);
        await pool.query(CONCLUIR, [tarefa.id]);
      } catch (erro) {
        await pool.query(FALHAR, [tarefa.id, String(erro?.message ?? erro).slice(0, 500)]);
      }
    }),
  );
  return tarefas.length;
}

async function rodar() {
  for (;;) {
    let processadas = 0;
    try {
      processadas = await ciclo();
    } catch (erro) {
      console.error('falha no ciclo da fila', erro);
    }
    // ${c.f6}
    if (processadas === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

setInterval(() => {
  pool.query(DEVOLVER_EXPIRADAS).catch((erro) => console.error('falha ao devolver tarefas', erro));
}, 30_000);

rodar();`;

const diagramPt = `tarefas_status_criado_idx, trecho status = 'pendente', ordenado por criado_em

 mais antigo                                                      mais novo
 [x][x][x][x][x][x][x][x][x][x][x][x][x][x] ... [x][x][L][L][L][P][P][P]
 |<------------- 918 mil versões mortas ------------->| |        |
   concluídas depois das 09:02, mas ainda visíveis      |        primeiras 10 livres
   para o snapshot aberto pelo relatório                travadas por outros workers

 x = versão morta que o VACUUM ainda não pode remover
 L = pendente, travada por outro worker (SKIP LOCKED pula)
 P = pendente e livre: o que o worker queria desde o início`;

const diagramEn = `tarefas_status_criado_idx, range status = 'pendente', ordered by criado_em

 oldest                                                              newest
 [x][x][x][x][x][x][x][x][x][x][x][x][x][x] ... [x][x][L][L][L][P][P][P]
 |<------------- 918 thousand dead versions --------->| |        |
   completed after 09:02, but still visible             |        first 10 free rows
   to the snapshot opened by the report                 locked by other workers

 x = dead version that VACUUM cannot remove yet
 L = pending, locked by another worker (SKIP LOCKED skips it)
 P = pending and free: what the worker wanted from the start`;

const diagramEs = `tarefas_status_criado_idx, tramo status = 'pendente', ordenado por criado_em

 más antiguo                                                     más nuevo
 [x][x][x][x][x][x][x][x][x][x][x][x][x][x] ... [x][x][L][L][L][P][P][P]
 |<------------- 918 mil versiones muertas ---------->| |        |
   concluidas después de las 09:02, pero aún visibles   |        primeras 10 libres
   para el snapshot abierto por el reporte              bloqueadas por otros workers

 x = versión muerta que el VACUUM todavía no puede eliminar
 L = pendiente, bloqueada por otro worker (SKIP LOCKED la salta)
 P = pendiente y libre: lo que el worker quería desde el principio`;

const pt = {
  intro:
    'Uma plataforma de logística usava uma tabela do Postgres como fila: cada mudança de status de entrega virava uma tarefa de notificação, e quatro workers buscavam lotes de 10 com FOR UPDATE SKIP LOCKED. Durante mais de um ano a busca do próximo lote levou 3 ms. Numa segunda-feira, sem nenhum deploy, ela passou a levar 640 ms. A vazão dos workers caiu de cerca de 110 para 40 tarefas por segundo, com 90 chegando no pico; às 11:52 havia 310 mil tarefas pendentes, clientes recebendo aviso de entrega com mais de uma hora de atraso e o banco com 94% de CPU. A fila de verdade tinha poucas centenas de linhas pendentes quando tudo começou. O que cresceu foi o que já tinha sido processado: 918 mil versões mortas, na frente das linhas vivas, que o VACUUM não podia remover porque uma sessão de relatório estava aberta desde as 09:02. Este artigo mostra por que o worker varre o que já foi processado, como confirmar isso com EXPLAIN e VACUUM VERBOSE, quem segura o horizonte de limpeza, onde entra o índice inchado e como redesenhar a fila para que ela continue rápida mesmo com churn alto.',
  sections: [
    {
      title: 'A fila que ficou lenta sem nenhum deploy',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O desenho era o que quase todo time escreve na primeira versão: uma tabela com as tarefas, uma coluna de status, um índice por status e data, e um worker que trava um lote, executa e marca como concluído. As concluídas ficavam na mesma tabela por sete dias, para auditoria, e um job noturno apagava as mais antigas.',
        },
        { type: 'code', value: buggyCode(comments.pt) },
        {
          type: 'paragraph',
          value:
            'Nada nesse código está errado no sentido de produzir resultado incorreto. SKIP LOCKED faz exatamente o que promete: cada worker pega linhas diferentes, sem esperar pelos outros. O problema é de custo, e ele só aparece com o tempo. Cada tarefa concluída deixa para trás uma versão morta da linha e uma entrada morta no índice, exatamente no ponto em que a próxima busca começa a ler. Enquanto o VACUUM remove essas versões em minutos, ninguém percebe. Quando ele não pode remover, a busca fica mais lenta a cada tarefa processada.',
        },
        {
          type: 'list',
          items: [
            'Sintoma 1: a busca do lote fica lenta de forma progressiva, sem deploy, sem mudança de plano e sem aumento de volume.',
            'Sintoma 2: a tabela tem poucas linhas pendentes, mas a consulta lê dezenas de milhares de buffers.',
            'Sintoma 3: adicionar workers piora, porque todos pagam a mesma varredura e a CPU do banco satura.',
            'Sintoma 4: o problema some sozinho em algum momento, quando a sessão que segurava o horizonte termina, e ninguém fica sabendo a causa.',
          ],
        },
      ],
    },
    {
      title: 'Por que o worker varre o que já foi processado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No Postgres, UPDATE e DELETE não alteram a linha no lugar. O UPDATE que marca a tarefa como concluída cria uma nova versão da linha e deixa a antiga marcada como expirada. Como a coluna status faz parte do índice, a atualização não pode ser HOT: a nova versão ganha uma entrada nova no índice (na região de concluida) e a entrada antiga (na região de pendente) continua lá, apontando para a versão morta. Só o VACUUM remove as duas.',
        },
        {
          type: 'paragraph',
          value:
            'A busca do worker pede as pendentes mais antigas, então ela entra no índice pelo começo do trecho status = pendente. É justamente onde ficam as entradas das tarefas que acabaram de ser concluídas. O índice não guarda informação de visibilidade: para cada entrada, o banco precisa ir até a tabela, ler a versão da linha e descobrir que ela não é mais visível. Só depois de passar por todas as mortas ele chega às vivas.',
        },
        { type: 'diagram', value: diagramPt },
        {
          type: 'paragraph',
          value:
            'Em condições normais existe um atalho que esconde esse custo. Quando uma varredura de índice visita uma versão que já está morta para todas as transações, ela marca a entrada do índice como morta, e as próximas varreduras pulam essa entrada sem ir à tabela. Por isso a fila aguenta bem o intervalo entre uma passada do autovacuum e outra. O atalho tem uma condição: a versão precisa estar morta para todos. Se existe um snapshot aberto antes da conclusão da tarefa, aquela versão ainda é visível para ele; o banco não pode marcar a entrada nem remover a linha. Cada busca refaz o trabalho inteiro, e o trabalho cresce 90 linhas por segundo.',
        },
        {
          type: 'paragraph',
          value:
            'O SKIP LOCKED acrescenta uma parcela menor ao mesmo efeito. Com quatro workers e lotes de 10, cada busca também passa por até 30 linhas vivas que estão travadas pelos outros, tenta a trava, falha e segue. Isso é barato com 4 workers e lotes pequenos, mas cresce com o número de workers e com o tempo que cada um segura a transação. Por isso a reação instintiva de subir mais instâncias durante o incidente não ajudou: cada nova instância paga a mesma varredura de 918 mil versões e ainda aumenta a quantidade de linhas travadas a pular.',
        },
      ],
    },
    {
      title: 'Como confirmar: buffers, versões mortas e quem segura o horizonte',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O plano de execução não muda, e é isso que confunde: é o mesmo Index Scan de sempre. Versões mortas também não aparecem em Rows Removed by Filter. O sinal está na contagem de buffers: uma consulta que devolve 10 linhas não deveria ler 38 mil páginas. O segundo sinal vem das estatísticas da tabela e o terceiro, definitivo, do próprio VACUUM.',
        },
        { type: 'code', value: diagnosticCode(comments.pt) },
        {
          type: 'paragraph',
          value:
            'A linha dead but not yet removable encerra a dúvida: o autovacuum estava rodando, só não podia remover nada. O removable cutoff mostra a partir de qual transação as versões ainda precisam ser preservadas. Falta descobrir quem está segurando esse limite. Ele é o mínimo entre todas as transações e snapshots abertos no cluster, em qualquer banco, mais os slots de replicação e as transações preparadas.',
        },
        { type: 'code', value: horizonCode(comments.pt) },
        {
          type: 'paragraph',
          value:
            'No incidente, a primeira linha era uma sessão do usuário de relatórios, em idle in transaction desde as 09:02: uma ferramenta de BI abriu uma transação REPEATABLE READ para exportar um fechamento, o analista deixou a aba aberta e foi para uma reunião. A sessão nunca tocou na tabela tarefas. Não importa: o horizonte é do cluster inteiro. Encerrada a sessão com pg_terminate_backend, o autovacuum seguinte removeu 918 mil versões e a busca voltou para 4 ms em menos de dois minutos.',
        },
        {
          type: 'table',
          columns: ['Quem segura o horizonte', 'Onde aparece', 'Como limitar'],
          rows: [
            [
              'Sessão ociosa com transação aberta',
              'pg_stat_activity, state = idle in transaction',
              'idle_in_transaction_session_timeout por role',
            ],
            [
              'Consulta longa, exportação ou pg_dump',
              'pg_stat_activity, state = active com xact_start antigo',
              'statement_timeout por role; rodar em réplica dedicada',
            ],
            [
              'Réplica com hot_standby_feedback = on',
              'pg_stat_replication.backend_xmin e xmin do slot',
              'Réplica separada para relatórios, sem feedback',
            ],
            [
              'Slot de replicação com xmin parado',
              'pg_replication_slots',
              'Alertar pela idade do xmin e remover slots órfãos',
            ],
            [
              'Transação preparada esquecida',
              'pg_prepared_xacts',
              'COMMIT ou ROLLBACK PREPARED; max_prepared_transactions = 0 se não usa 2PC',
            ],
            [
              'O próprio worker, com a transação aberta durante uma chamada externa',
              'pg_stat_activity, pelo application_name do worker',
              'Reserva curta com prazo, execução fora da transação',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha da tabela merece atenção porque é a que o time controla. No desenho original o worker mantinha a transação aberta enquanto executava as tarefas. Em dias normais isso durava 350 ms. No dia em que o provedor de SMS passou a responder em 60 segundos, cada worker virou uma transação de um minuto, e a fila começou a acumular versões mortas por conta própria, sem nenhum relatório envolvido.',
        },
      ],
    },
    {
      title: 'O índice inchado e o VACUUM que fica caro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Resolvido o incidente, sobrou uma pergunta: por que cada passada do autovacuum nessa tabela levava seis minutos? A tabela tinha 9,4 milhões de linhas, das quais algumas centenas eram pendentes. Todo o resto eram tarefas concluídas esperando os sete dias de retenção. E o índice por status e data ocupava 2,1 GB.',
        },
        { type: 'code', value: bloatCode(comments.pt) },
        {
          type: 'paragraph',
          value:
            'O pgstatindex mostrou avg_leaf_density de 31%. A causa era a combinação da limpeza noturna com o formato do índice: todo dia às 02:00 um único DELETE apagava cerca de 7,8 milhões de linhas, enquanto as novas entradas de concluida continuavam entrando no meio do índice, onde a divisão de páginas deixa folhas pela metade. Uma página de B-tree só é reaproveitada quando fica totalmente vazia e depois que o VACUUM passa por ela; páginas meio vazias continuam meio vazias, e o arquivo do índice nunca diminui sozinho. O REINDEX CONCURRENTLY levou o índice de 2,1 GB para 310 MB.',
        },
        {
          type: 'paragraph',
          value:
            'O inchaço não deixa a busca do lote muito mais lenta por si só, porque a descida na árvore continua curta. O custo aparece em outro lugar: o VACUUM precisa ler o índice inteiro a cada passada. Com um índice de 2,1 GB e uma tabela de 9,4 milhões de linhas, cada passada levava minutos, e nesse intervalo as versões mortas da frente da fila continuavam lá. A limpeza noturna piorava o quadro: 7,8 milhões de versões mortas de uma vez, que o autovacuum com limite de custo levava 50 minutos para remover. Olhando o histórico, a busca do lote subia de 3 ms para 40 ms toda madrugada entre 02:00 e 03:00, e ninguém nunca tinha notado.',
        },
        {
          type: 'paragraph',
          value:
            'A conclusão prática é que o tamanho da tabela da fila define o custo da limpeza, e o custo da limpeza define quanto tempo as versões mortas vivem. Uma fila que guarda histórico junto com trabalho pendente obriga o VACUUM a percorrer milhões de linhas para limpar algumas centenas. Reindexar resolve o sintoma por algumas semanas. Separar o histórico resolve a causa.',
        },
      ],
    },
    {
      title: 'A correção: tabela pequena, índice parcial e reserva curta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A correção teve quatro partes. A tabela da fila passou a guardar só o que falta fazer; as concluídas vão para um histórico particionado por dia, e a retenção vira DROP de partição. Os índices passaram a ser parciais, cobrindo apenas pendentes e reservadas. O autovacuum da tabela foi configurado por contagem absoluta. E o usuário de relatórios ganhou limites de tempo.',
        },
        { type: 'code', value: schemaCode(comments.pt) },
        {
          type: 'paragraph',
          value:
            'Alguns detalhes dessa configuração importam. Com scale_factor zerado e threshold de 2.000, o autovacuum dispara por quantidade de versões mortas e não por percentual da tabela; na prática ele roda a cada ciclo do autovacuum_naptime, que por padrão é de um minuto. Com a tabela contendo só pendentes, cada passada leva menos de um segundo. As 9,4 milhões de linhas concluídas existentes foram movidas para o histórico em lotes de 5 mil, com pausa entre os lotes, antes de trocar o worker.',
        },
        {
          type: 'paragraph',
          value:
            'O worker também mudou. Em vez de manter uma transação aberta durante a execução, ele reserva o lote em uma única instrução, que faz commit imediatamente, executa as tarefas fora de qualquer transação e depois conclui cada uma. A trava de linha existe por milissegundos; o que protege a tarefa durante a execução é o status processando com prazo em reservado_ate.',
        },
        { type: 'code', value: workerCode(comments.pt) },
        {
          type: 'list',
          items: [
            'A reserva usa o índice parcial tarefas_pendentes_idx: ao mudar o status, a linha sai do índice e deixa de ser candidata para os outros workers.',
            'Se o worker morrer no meio, a tarefa volta para a fila quando reservado_ate vencer. Por isso executar precisa ser idempotente: uma tarefa lenta pode ser executada duas vezes.',
            'O prazo da reserva deve ser maior que o timeout da chamada externa. Aqui a chamada tem timeout de 30 segundos e a reserva dura 2 minutos.',
            'Cada tarefa ainda gera duas versões mortas (a reserva e a conclusão). Isso é aceitável: o objetivo é que elas vivam pouco, e não que deixem de existir.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Depois da mudança, a busca do lote ficou em 2 ms com 30 buffers. Para validar, o time repetiu o cenário em homologação: abriu uma transação REPEATABLE READ por três horas com a carga de pico. A busca chegou a 210 ms no fim do teste, porque nenhum desenho elimina o efeito de um horizonte preso, mas o limite de um minuto para sessões ociosas do usuário de relatórios impede que esse cenário se repita em produção.',
        },
      ],
    },
    {
      title: 'O que vigiar para não voltar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Fila em tabela funciona bem no Postgres até volumes altos, desde que as versões mortas vivam pouco. Os alertas abaixo medem diretamente essa condição, em vez de esperar o atraso aparecer para o cliente.',
        },
        {
          type: 'ordered',
          items: [
            'Idade da tarefa pendente mais antiga (now() menos o menor executar_em entre as pendentes): é o indicador que o negócio sente.',
            'n_dead_tup da tabela da fila em relação a n_live_tup: se as mortas passam de algumas vezes as vivas, a limpeza não está acompanhando.',
            'Idade do horizonte: maior valor de age(backend_xmin) e age(backend_xid) em pg_stat_activity, mais slots e transações preparadas. Alerte acima de alguns minutos.',
            'Tempo desde o último autovacuum da tabela da fila. Numa fila ativa ele deve ser de poucos minutos.',
            'Buffers por execução da busca do lote, via pg_stat_statements (shared_blks_hit dividido por calls). O tempo médio esconde o problema no começo; os buffers não.',
            'Tamanho dos índices da fila ao longo das semanas. Crescimento sem aumento de volume pede REINDEX CONCURRENTLY e uma revisão do padrão de escrita.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Vale incluir o cenário no ensaio de carga: uma transação longa aberta em outra sessão enquanto a fila recebe o volume de pico. É um teste barato, e mostra em minutos se o desenho da fila depende de um horizonte que nem sempre vai estar livre.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Rodar VACUUM manual na hora do incidente resolve?',
      answer:
        'Só se o horizonte estiver livre. Se existe uma transação, um slot ou uma transação preparada segurando o limite, o VACUUM manual percorre a tabela inteira e termina informando que as versões estão mortas mas ainda não podem ser removidas. O primeiro passo é sempre achar e encerrar quem segura o horizonte; depois disso o autovacuum normal resolve em uma passada, e o VACUUM manual só acelera alguns segundos.',
    },
    {
      question: 'Colocar mais workers ajuda a drenar a fila mais rápido?',
      answer:
        'Enquanto a busca do lote está barata, sim. Quando ela está cara por causa de versões mortas, não: cada worker repete a mesma varredura, a CPU do banco satura e cada um ainda precisa pular as linhas travadas pelos demais. No incidente, subir de 4 para 8 workers aumentou o tempo da busca em vez de aumentar a vazão. Aumentar o tamanho do lote ajuda mais do que aumentar o número de workers, porque dilui o custo fixo da varredura em mais tarefas.',
    },
    {
      question: 'Isso é sinal de que está na hora de trocar a tabela por um broker de mensagens?',
      answer:
        'Não necessariamente. A fila em tabela tem uma vantagem que nenhum broker dá: a tarefa é gravada na mesma transação do dado de negócio. Com tabela pequena, índice parcial, autovacuum ajustado e horizonte vigiado, ela sustenta milhares de tarefas por segundo. Um broker passa a compensar quando o volume é muito maior, quando há muitos consumidores independentes para o mesmo evento ou quando o banco não pode gastar escrita com isso. Trocar sem entender a causa só move o problema: o banco continua sujeito a horizonte preso em todas as outras tabelas.',
    },
  ],
  conclusion: {
    title: 'A fila é rápida enquanto o lixo vive pouco',
    description:
      'SKIP LOCKED resolve a disputa entre workers, mas não o custo do MVCC: cada tarefa concluída deixa uma versão morta bem no ponto em que a próxima busca começa. Enquanto o VACUUM remove essas versões em minutos, a fila parece gratuita. Quando um snapshot antigo, um slot ou o próprio worker seguram o horizonte, a busca passa a varrer tudo o que já foi processado, e mais workers só aumentam a conta. A correção é de desenho: tabela que guarda só trabalho pendente, índices parciais, histórico em partições descartáveis, reserva curta com prazo, autovacuum por contagem absoluta e limites de tempo para quem pode abrir transações longas.',
    cta: 'Quer revisar filas, workers e rotinas de limpeza do seu Postgres antes que o atraso apareça para o cliente?',
  },
  related: [
    {
      label: 'Autovacuum que não acompanha: quando a tabela incha e a consulta fica lenta sem mudar nada',
      to: '/blog/autovacuum-que-nao-acompanha-tabela-incha-consulta-lenta-sem-mudar-nada',
    },
    {
      label: 'Transação longa que ninguém fecha: idle in transaction que segura vacuum, lock e conexão',
      to: '/blog/transacao-longa-que-ninguem-fecha-idle-in-transaction-que-segura-vacuum-lock-e-conexao',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A logistics platform used a Postgres table as a queue: every delivery status change became a notification task, and four workers fetched batches of 10 with FOR UPDATE SKIP LOCKED. For more than a year fetching the next batch took 3 ms. On a Monday, with no deploy at all, it started taking 640 ms. Worker throughput dropped from about 110 to 40 tasks per second, with 90 arriving at peak; at 11:52 there were 310 thousand pending tasks, customers getting delivery notices more than an hour late and the database at 94% CPU. The real queue had a few hundred pending rows when it all began. What had grown was what had already been processed: 918 thousand dead versions, sitting in front of the live rows, which VACUUM could not remove because a reporting session had been open since 09:02. This article shows why the worker scans what was already processed, how to confirm it with EXPLAIN and VACUUM VERBOSE, who holds the cleanup horizon, where the bloated index comes in and how to redesign the queue so it stays fast even under heavy churn.',
  sections: [
    {
      title: 'The queue that got slow with no deploy',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The design was what almost every team writes in the first version: a table with the tasks, a status column, an index on status and date, and a worker that locks a batch, runs it and marks it completed. Completed tasks stayed in the same table for seven days, for auditing, and a nightly job deleted the older ones.',
        },
        { type: 'code', value: buggyCode(comments.en) },
        {
          type: 'paragraph',
          value:
            'Nothing in this code is wrong in the sense of producing an incorrect result. SKIP LOCKED does exactly what it promises: each worker takes different rows without waiting for the others. The problem is cost, and it only shows up over time. Every completed task leaves behind a dead row version and a dead index entry, exactly at the point where the next fetch starts reading. While VACUUM removes those versions within minutes, nobody notices. When it cannot remove them, the fetch gets slower with every task processed.',
        },
        {
          type: 'list',
          items: [
            'Symptom 1: the batch fetch slows down progressively, with no deploy, no plan change and no increase in volume.',
            'Symptom 2: the table has few pending rows, yet the query reads tens of thousands of buffers.',
            'Symptom 3: adding workers makes it worse, because all of them pay for the same scan and the database CPU saturates.',
            'Symptom 4: the problem goes away by itself at some point, when the session holding the horizon ends, and nobody learns the cause.',
          ],
        },
      ],
    },
    {
      title: 'Why the worker scans what was already processed',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In Postgres, UPDATE and DELETE do not change the row in place. The UPDATE that marks the task as completed creates a new row version and leaves the old one flagged as expired. Since the status column is part of the index, the update cannot be HOT: the new version gets a new index entry (in the concluida range) and the old entry (in the pendente range) stays there, pointing to the dead version. Only VACUUM removes both.',
        },
        {
          type: 'paragraph',
          value:
            'The worker query asks for the oldest pending tasks, so it enters the index at the beginning of the status = pendente range. That is precisely where the entries of the tasks that were just completed live. The index stores no visibility information: for every entry, the database has to go to the table, read the row version and find out that it is no longer visible. Only after going through all the dead ones does it reach the live ones.',
        },
        { type: 'diagram', value: diagramEn },
        {
          type: 'paragraph',
          value:
            'Under normal conditions there is a shortcut that hides this cost. When an index scan visits a version that is already dead to every transaction, it flags the index entry as dead, and later scans skip that entry without visiting the table. That is why the queue copes well with the interval between one autovacuum pass and the next. The shortcut has one condition: the version must be dead to everyone. If a snapshot was opened before the task was completed, that version is still visible to it; the database can neither flag the entry nor remove the row. Every fetch redoes the whole job, and the job grows by 90 rows per second.',
        },
        {
          type: 'paragraph',
          value:
            'SKIP LOCKED adds a smaller share to the same effect. With four workers and batches of 10, each fetch also walks past up to 30 live rows that are locked by the others, tries the lock, fails and moves on. That is cheap with 4 workers and small batches, but it grows with the number of workers and with how long each one holds its transaction. This is why the instinctive reaction of starting more instances during the incident did not help: each new instance pays for the same scan over 918 thousand versions and also increases the number of locked rows to skip.',
        },
      ],
    },
    {
      title: 'How to confirm it: buffers, dead versions and who holds the horizon',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The execution plan does not change, and that is what makes it confusing: it is the same Index Scan as always. Dead versions do not show up in Rows Removed by Filter either. The signal is in the buffer count: a query that returns 10 rows should not read 38 thousand pages. The second signal comes from the table statistics and the third, the definitive one, from VACUUM itself.',
        },
        { type: 'code', value: diagnosticCode(comments.en) },
        {
          type: 'paragraph',
          value:
            'The dead but not yet removable line settles the question: autovacuum was running, it just could not remove anything. The removable cutoff shows from which transaction onwards versions still have to be preserved. What remains is finding out who is holding that limit. It is the minimum across all transactions and snapshots open in the cluster, in any database, plus replication slots and prepared transactions.',
        },
        { type: 'code', value: horizonCode(comments.en) },
        {
          type: 'paragraph',
          value:
            'In the incident, the first row was a session of the reporting user, idle in transaction since 09:02: a BI tool had opened a REPEATABLE READ transaction to export a monthly closing, the analyst left the tab open and went to a meeting. That session never touched the tarefas table. It does not matter: the horizon belongs to the whole cluster. Once the session was ended with pg_terminate_backend, the next autovacuum removed 918 thousand versions and the fetch was back at 4 ms in less than two minutes.',
        },
        {
          type: 'table',
          columns: ['Who holds the horizon', 'Where it shows up', 'How to limit it'],
          rows: [
            [
              'Idle session with an open transaction',
              'pg_stat_activity, state = idle in transaction',
              'idle_in_transaction_session_timeout per role',
            ],
            [
              'Long query, export or pg_dump',
              'pg_stat_activity, state = active with an old xact_start',
              'statement_timeout per role; run it on a dedicated replica',
            ],
            [
              'Replica with hot_standby_feedback = on',
              'pg_stat_replication.backend_xmin and the slot xmin',
              'Separate replica for reports, without feedback',
            ],
            [
              'Replication slot with a stalled xmin',
              'pg_replication_slots',
              'Alert on xmin age and drop orphaned slots',
            ],
            [
              'Forgotten prepared transaction',
              'pg_prepared_xacts',
              'COMMIT or ROLLBACK PREPARED; max_prepared_transactions = 0 if 2PC is not used',
            ],
            [
              'The worker itself, with its transaction open during an external call',
              'pg_stat_activity, by the worker application_name',
              'Short reservation with a deadline, execution outside the transaction',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row of the table deserves attention because it is the one the team controls. In the original design the worker kept its transaction open while it ran the tasks. On normal days that lasted 350 ms. On the day the SMS provider started answering in 60 seconds, every worker became a one-minute transaction, and the queue began to pile up dead versions by itself, with no report involved.',
        },
      ],
    },
    {
      title: 'The bloated index and the VACUUM that gets expensive',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the incident solved, one question was left: why did every autovacuum pass on this table take six minutes? The table had 9.4 million rows, of which a few hundred were pending. All the rest were completed tasks waiting out the seven days of retention. And the index on status and date took 2.1 GB.',
        },
        { type: 'code', value: bloatCode(comments.en) },
        {
          type: 'paragraph',
          value:
            'pgstatindex showed an avg_leaf_density of 31%. The cause was the nightly cleanup combined with the shape of the index: every day at 02:00 a single DELETE removed about 7.8 million rows, while new concluida entries kept arriving in the middle of the index, where page splits leave leaves half full. A B-tree page is only reused when it becomes completely empty and after VACUUM has gone through it; half-empty pages stay half-empty, and the index file never shrinks by itself. REINDEX CONCURRENTLY took the index from 2.1 GB to 310 MB.',
        },
        {
          type: 'paragraph',
          value:
            'Bloat does not make the batch fetch much slower by itself, because the descent through the tree stays short. The cost shows up elsewhere: VACUUM has to read the entire index on every pass. With a 2.1 GB index and a table of 9.4 million rows, each pass took minutes, and during that interval the dead versions at the front of the queue stayed there. The nightly cleanup made it worse: 7.8 million dead versions at once, which cost-limited autovacuum took 50 minutes to remove. Looking at the history, the batch fetch went from 3 ms to 40 ms every night between 02:00 and 03:00, and nobody had ever noticed.',
        },
        {
          type: 'paragraph',
          value:
            'The practical conclusion is that the size of the queue table sets the cost of cleanup, and the cost of cleanup sets how long dead versions live. A queue that keeps history together with pending work forces VACUUM to walk millions of rows to clean a few hundred. Reindexing fixes the symptom for a few weeks. Separating the history fixes the cause.',
        },
      ],
    },
    {
      title: 'The fix: a small table, partial indexes and a short reservation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The fix had four parts. The queue table now holds only what is left to do; completed tasks go to a history partitioned by day, and retention becomes dropping a partition. The indexes became partial, covering only pending and reserved tasks. Autovacuum for the table was configured by absolute count. And the reporting user got time limits.',
        },
        { type: 'code', value: schemaCode(comments.en) },
        {
          type: 'paragraph',
          value:
            'Some details of this configuration matter. With scale_factor at zero and a threshold of 2,000, autovacuum triggers on the number of dead versions and not on a percentage of the table; in practice it runs on every autovacuum_naptime cycle, which is one minute by default. With the table holding only pending work, each pass takes less than a second. The 9.4 million existing completed rows were moved to the history in batches of 5 thousand, with a pause between batches, before switching the worker.',
        },
        {
          type: 'paragraph',
          value:
            'The worker changed too. Instead of keeping a transaction open during execution, it reserves the batch in a single statement, which commits immediately, runs the tasks outside any transaction and then completes each one. The row lock exists for milliseconds; what protects the task during execution is the processando status with a deadline in reservado_ate.',
        },
        { type: 'code', value: workerCode(comments.en) },
        {
          type: 'list',
          items: [
            'The reservation uses the partial index tarefas_pendentes_idx: when the status changes, the row leaves the index and stops being a candidate for the other workers.',
            'If the worker dies halfway, the task goes back to the queue when reservado_ate expires. That is why executar must be idempotent: a slow task may run twice.',
            'The reservation deadline must be longer than the timeout of the external call. Here the call has a 30 second timeout and the reservation lasts 2 minutes.',
            'Each task still produces two dead versions (the reservation and the completion). That is acceptable: the goal is for them to be short-lived, not for them to stop existing.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'After the change, the batch fetch settled at 2 ms with 30 buffers. To validate it, the team repeated the scenario in staging: a REPEATABLE READ transaction held open for three hours under peak load. The fetch reached 210 ms at the end of the test, because no design eliminates the effect of a stuck horizon, but the one-minute limit for idle sessions of the reporting user keeps that scenario from happening again in production.',
        },
      ],
    },
    {
      title: 'What to watch so it does not come back',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A table-based queue works well in Postgres up to high volumes, as long as dead versions are short-lived. The alerts below measure that condition directly, instead of waiting for the delay to reach the customer.',
        },
        {
          type: 'ordered',
          items: [
            'Age of the oldest pending task (now() minus the smallest executar_em among pending rows): this is the indicator the business feels.',
            'n_dead_tup of the queue table relative to n_live_tup: if dead versions exceed live ones several times over, cleanup is not keeping up.',
            'Horizon age: the largest age(backend_xmin) and age(backend_xid) in pg_stat_activity, plus slots and prepared transactions. Alert above a few minutes.',
            'Time since the last autovacuum of the queue table. On an active queue it should be a few minutes.',
            'Buffers per execution of the batch fetch, through pg_stat_statements (shared_blks_hit divided by calls). Average time hides the problem early on; buffers do not.',
            'Size of the queue indexes over the weeks. Growth without an increase in volume calls for REINDEX CONCURRENTLY and a review of the write pattern.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'It is worth adding the scenario to load testing: a long transaction open in another session while the queue receives peak volume. It is a cheap test, and it shows within minutes whether the queue design depends on a horizon that will not always be free.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does running a manual VACUUM during the incident fix it?',
      answer:
        'Only if the horizon is free. If a transaction, a slot or a prepared transaction is holding the limit, the manual VACUUM walks the whole table and ends by reporting that the versions are dead but cannot be removed yet. The first step is always to find and end whoever holds the horizon; after that regular autovacuum fixes it in a single pass, and a manual VACUUM only saves a few seconds.',
    },
    {
      question: 'Do more workers help drain the queue faster?',
      answer:
        'While the batch fetch is cheap, yes. When it is expensive because of dead versions, no: every worker repeats the same scan, the database CPU saturates and each one still has to skip the rows locked by the others. In the incident, going from 4 to 8 workers increased the fetch time instead of increasing throughput. Increasing the batch size helps more than increasing the number of workers, because it spreads the fixed cost of the scan over more tasks.',
    },
    {
      question: 'Is this a sign that it is time to replace the table with a message broker?',
      answer:
        'Not necessarily. A table-based queue has an advantage no broker offers: the task is written in the same transaction as the business data. With a small table, partial indexes, tuned autovacuum and a monitored horizon, it sustains thousands of tasks per second. A broker starts to pay off when the volume is much larger, when many independent consumers need the same event or when the database cannot afford the write load. Switching without understanding the cause only moves the problem: the database remains exposed to a stuck horizon on every other table.',
    },
  ],
  conclusion: {
    title: 'The queue is fast while the garbage is short-lived',
    description:
      'SKIP LOCKED solves contention between workers, but not the cost of MVCC: every completed task leaves a dead version right where the next fetch starts. While VACUUM removes those versions within minutes, the queue looks free. When an old snapshot, a slot or the worker itself holds the horizon, the fetch starts scanning everything that was already processed, and more workers only raise the bill. The fix is in the design: a table that holds only pending work, partial indexes, history in disposable partitions, a short reservation with a deadline, autovacuum by absolute count and time limits for whoever can open long transactions.',
    cta: 'Want to review the queues, workers and cleanup routines of your Postgres before the delay reaches the customer?',
  },
  related: [
    {
      label: 'Autovacuum that cannot keep up: when the table bloats and queries slow down with nothing changed',
      to: '/blog/autovacuum-que-nao-acompanha-tabela-incha-consulta-lenta-sem-mudar-nada',
    },
    {
      label: 'The long transaction nobody closes: idle in transaction holding back vacuum, locks and connections',
      to: '/blog/transacao-longa-que-ninguem-fecha-idle-in-transaction-que-segura-vacuum-lock-e-conexao',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Una plataforma de logística usaba una tabla de Postgres como cola: cada cambio de estado de una entrega se convertía en una tarea de notificación, y cuatro workers buscaban lotes de 10 con FOR UPDATE SKIP LOCKED. Durante más de un año la búsqueda del siguiente lote tardó 3 ms. Un lunes, sin ningún despliegue, pasó a tardar 640 ms. El rendimiento de los workers cayó de unas 110 a 40 tareas por segundo, con 90 llegando en el pico; a las 11:52 había 310 mil tareas pendientes, clientes recibiendo el aviso de entrega con más de una hora de retraso y la base de datos con 94% de CPU. La cola real tenía unos pocos cientos de filas pendientes cuando todo empezó. Lo que creció fue lo que ya se había procesado: 918 mil versiones muertas, delante de las filas vivas, que el VACUUM no podía eliminar porque una sesión de reportes estaba abierta desde las 09:02. Este artículo muestra por qué el worker recorre lo que ya se procesó, cómo confirmarlo con EXPLAIN y VACUUM VERBOSE, quién retiene el horizonte de limpieza, dónde entra el índice inflado y cómo rediseñar la cola para que siga siendo rápida incluso con mucho churn.',
  sections: [
    {
      title: 'La cola que se volvió lenta sin ningún despliegue',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El diseño era el que casi todo equipo escribe en la primera versión: una tabla con las tareas, una columna de estado, un índice por estado y fecha, y un worker que bloquea un lote, lo ejecuta y lo marca como concluido. Las concluidas quedaban en la misma tabla durante siete días, para auditoría, y un job nocturno borraba las más antiguas.',
        },
        { type: 'code', value: buggyCode(comments.es) },
        {
          type: 'paragraph',
          value:
            'Nada en este código está mal en el sentido de producir un resultado incorrecto. SKIP LOCKED hace exactamente lo que promete: cada worker toma filas distintas, sin esperar a los demás. El problema es de costo, y solo aparece con el tiempo. Cada tarea concluida deja atrás una versión muerta de la fila y una entrada muerta en el índice, justo en el punto donde la siguiente búsqueda empieza a leer. Mientras el VACUUM elimina esas versiones en minutos, nadie lo nota. Cuando no puede eliminarlas, la búsqueda se vuelve más lenta con cada tarea procesada.',
        },
        {
          type: 'list',
          items: [
            'Síntoma 1: la búsqueda del lote se vuelve lenta de forma progresiva, sin despliegue, sin cambio de plan y sin aumento de volumen.',
            'Síntoma 2: la tabla tiene pocas filas pendientes, pero la consulta lee decenas de miles de buffers.',
            'Síntoma 3: agregar workers lo empeora, porque todos pagan el mismo recorrido y la CPU de la base se satura.',
            'Síntoma 4: el problema desaparece solo en algún momento, cuando termina la sesión que retenía el horizonte, y nadie llega a conocer la causa.',
          ],
        },
      ],
    },
    {
      title: 'Por qué el worker recorre lo que ya se procesó',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En Postgres, UPDATE y DELETE no modifican la fila en su lugar. El UPDATE que marca la tarea como concluida crea una nueva versión de la fila y deja la anterior marcada como expirada. Como la columna status forma parte del índice, la actualización no puede ser HOT: la nueva versión recibe una entrada nueva en el índice (en el tramo de concluida) y la entrada anterior (en el tramo de pendente) sigue ahí, apuntando a la versión muerta. Solo el VACUUM elimina ambas.',
        },
        {
          type: 'paragraph',
          value:
            'La búsqueda del worker pide las pendientes más antiguas, así que entra al índice por el comienzo del tramo status = pendente. Es justamente donde quedan las entradas de las tareas que acaban de concluirse. El índice no guarda información de visibilidad: para cada entrada, la base tiene que ir a la tabla, leer la versión de la fila y descubrir que ya no es visible. Solo después de pasar por todas las muertas llega a las vivas.',
        },
        { type: 'diagram', value: diagramEs },
        {
          type: 'paragraph',
          value:
            'En condiciones normales existe un atajo que esconde este costo. Cuando un recorrido de índice visita una versión que ya está muerta para todas las transacciones, marca la entrada del índice como muerta, y los siguientes recorridos saltan esa entrada sin ir a la tabla. Por eso la cola soporta bien el intervalo entre una pasada del autovacuum y la siguiente. El atajo tiene una condición: la versión debe estar muerta para todos. Si existe un snapshot abierto antes de que la tarea concluyera, esa versión todavía es visible para él; la base no puede marcar la entrada ni eliminar la fila. Cada búsqueda rehace todo el trabajo, y el trabajo crece 90 filas por segundo.',
        },
        {
          type: 'paragraph',
          value:
            'SKIP LOCKED suma una parte menor al mismo efecto. Con cuatro workers y lotes de 10, cada búsqueda también pasa por hasta 30 filas vivas que están bloqueadas por los demás, intenta el bloqueo, falla y sigue. Eso es barato con 4 workers y lotes pequeños, pero crece con la cantidad de workers y con el tiempo que cada uno mantiene la transacción. Por eso la reacción instintiva de levantar más instancias durante el incidente no ayudó: cada instancia nueva paga el mismo recorrido de 918 mil versiones y además aumenta la cantidad de filas bloqueadas que hay que saltar.',
        },
      ],
    },
    {
      title: 'Cómo confirmarlo: buffers, versiones muertas y quién retiene el horizonte',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El plan de ejecución no cambia, y eso es lo que confunde: es el mismo Index Scan de siempre. Las versiones muertas tampoco aparecen en Rows Removed by Filter. La señal está en el conteo de buffers: una consulta que devuelve 10 filas no debería leer 38 mil páginas. La segunda señal viene de las estadísticas de la tabla y la tercera, la definitiva, del propio VACUUM.',
        },
        { type: 'code', value: diagnosticCode(comments.es) },
        {
          type: 'paragraph',
          value:
            'La línea dead but not yet removable cierra la duda: el autovacuum estaba corriendo, solo que no podía eliminar nada. El removable cutoff muestra a partir de qué transacción las versiones todavía deben conservarse. Falta descubrir quién está reteniendo ese límite. Es el mínimo entre todas las transacciones y snapshots abiertos en el clúster, en cualquier base, más los slots de replicación y las transacciones preparadas.',
        },
        { type: 'code', value: horizonCode(comments.es) },
        {
          type: 'paragraph',
          value:
            'En el incidente, la primera fila era una sesión del usuario de reportes, en idle in transaction desde las 09:02: una herramienta de BI abrió una transacción REPEATABLE READ para exportar un cierre, el analista dejó la pestaña abierta y se fue a una reunión. La sesión nunca tocó la tabla tarefas. No importa: el horizonte es de todo el clúster. Terminada la sesión con pg_terminate_backend, el siguiente autovacuum eliminó 918 mil versiones y la búsqueda volvió a 4 ms en menos de dos minutos.',
        },
        {
          type: 'table',
          columns: ['Quién retiene el horizonte', 'Dónde aparece', 'Cómo limitarlo'],
          rows: [
            [
              'Sesión inactiva con una transacción abierta',
              'pg_stat_activity, state = idle in transaction',
              'idle_in_transaction_session_timeout por rol',
            ],
            [
              'Consulta larga, exportación o pg_dump',
              'pg_stat_activity, state = active con xact_start antiguo',
              'statement_timeout por rol; ejecutarla en una réplica dedicada',
            ],
            [
              'Réplica con hot_standby_feedback = on',
              'pg_stat_replication.backend_xmin y el xmin del slot',
              'Réplica separada para reportes, sin feedback',
            ],
            [
              'Slot de replicación con xmin detenido',
              'pg_replication_slots',
              'Alertar por la edad del xmin y eliminar slots huérfanos',
            ],
            [
              'Transacción preparada olvidada',
              'pg_prepared_xacts',
              'COMMIT o ROLLBACK PREPARED; max_prepared_transactions = 0 si no se usa 2PC',
            ],
            [
              'El propio worker, con la transacción abierta durante una llamada externa',
              'pg_stat_activity, por el application_name del worker',
              'Reserva corta con plazo, ejecución fuera de la transacción',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila de la tabla merece atención porque es la que el equipo controla. En el diseño original el worker mantenía la transacción abierta mientras ejecutaba las tareas. En días normales eso duraba 350 ms. El día en que el proveedor de SMS empezó a responder en 60 segundos, cada worker se convirtió en una transacción de un minuto, y la cola empezó a acumular versiones muertas por cuenta propia, sin ningún reporte de por medio.',
        },
      ],
    },
    {
      title: 'El índice inflado y el VACUUM que se vuelve caro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Resuelto el incidente, quedó una pregunta: por qué cada pasada del autovacuum sobre esta tabla tardaba seis minutos. La tabla tenía 9,4 millones de filas, de las cuales unos pocos cientos eran pendientes. Todo lo demás eran tareas concluidas esperando los siete días de retención. Y el índice por estado y fecha ocupaba 2,1 GB.',
        },
        { type: 'code', value: bloatCode(comments.es) },
        {
          type: 'paragraph',
          value:
            'pgstatindex mostró un avg_leaf_density de 31%. La causa era la combinación de la limpieza nocturna con la forma del índice: todos los días a las 02:00 un único DELETE borraba cerca de 7,8 millones de filas, mientras las nuevas entradas de concluida seguían entrando en medio del índice, donde la división de páginas deja hojas a la mitad. Una página de B-tree solo se reutiliza cuando queda completamente vacía y después de que el VACUUM pasa por ella; las páginas medio vacías siguen medio vacías, y el archivo del índice nunca se reduce solo. El REINDEX CONCURRENTLY llevó el índice de 2,1 GB a 310 MB.',
        },
        {
          type: 'paragraph',
          value:
            'La inflación no vuelve mucho más lenta la búsqueda del lote por sí sola, porque el descenso por el árbol sigue siendo corto. El costo aparece en otro lugar: el VACUUM tiene que leer el índice completo en cada pasada. Con un índice de 2,1 GB y una tabla de 9,4 millones de filas, cada pasada tardaba minutos, y en ese intervalo las versiones muertas del frente de la cola seguían ahí. La limpieza nocturna empeoraba el cuadro: 7,8 millones de versiones muertas de una vez, que el autovacuum con límite de costo tardaba 50 minutos en eliminar. Mirando el historial, la búsqueda del lote subía de 3 ms a 40 ms cada madrugada entre las 02:00 y las 03:00, y nadie lo había notado nunca.',
        },
        {
          type: 'paragraph',
          value:
            'La conclusión práctica es que el tamaño de la tabla de la cola define el costo de la limpieza, y el costo de la limpieza define cuánto tiempo viven las versiones muertas. Una cola que guarda historial junto con trabajo pendiente obliga al VACUUM a recorrer millones de filas para limpiar unos pocos cientos. Reindexar resuelve el síntoma por unas semanas. Separar el historial resuelve la causa.',
        },
      ],
    },
    {
      title: 'La corrección: tabla pequeña, índice parcial y reserva corta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La corrección tuvo cuatro partes. La tabla de la cola pasó a guardar solo lo que falta por hacer; las concluidas van a un historial particionado por día, y la retención se convierte en eliminar una partición. Los índices pasaron a ser parciales, cubriendo solo pendientes y reservadas. El autovacuum de la tabla se configuró por conteo absoluto. Y el usuario de reportes recibió límites de tiempo.',
        },
        { type: 'code', value: schemaCode(comments.es) },
        {
          type: 'paragraph',
          value:
            'Algunos detalles de esta configuración importan. Con scale_factor en cero y un threshold de 2.000, el autovacuum se dispara por cantidad de versiones muertas y no por porcentaje de la tabla; en la práctica corre en cada ciclo de autovacuum_naptime, que por defecto es de un minuto. Con la tabla conteniendo solo pendientes, cada pasada tarda menos de un segundo. Los 9,4 millones de filas concluidas existentes se movieron al historial en lotes de 5 mil, con pausa entre lotes, antes de cambiar el worker.',
        },
        {
          type: 'paragraph',
          value:
            'El worker también cambió. En lugar de mantener una transacción abierta durante la ejecución, reserva el lote en una sola instrucción, que hace commit de inmediato, ejecuta las tareas fuera de cualquier transacción y después concluye cada una. El bloqueo de fila existe durante milisegundos; lo que protege la tarea durante la ejecución es el estado processando con plazo en reservado_ate.',
        },
        { type: 'code', value: workerCode(comments.es) },
        {
          type: 'list',
          items: [
            'La reserva usa el índice parcial tarefas_pendentes_idx: al cambiar el estado, la fila sale del índice y deja de ser candidata para los demás workers.',
            'Si el worker muere a mitad de camino, la tarea vuelve a la cola cuando vence reservado_ate. Por eso executar debe ser idempotente: una tarea lenta puede ejecutarse dos veces.',
            'El plazo de la reserva debe ser mayor que el timeout de la llamada externa. Aquí la llamada tiene un timeout de 30 segundos y la reserva dura 2 minutos.',
            'Cada tarea todavía genera dos versiones muertas (la reserva y la conclusión). Es aceptable: el objetivo es que vivan poco, no que dejen de existir.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Después del cambio, la búsqueda del lote quedó en 2 ms con 30 buffers. Para validarlo, el equipo repitió el escenario en staging: abrió una transacción REPEATABLE READ durante tres horas con la carga de pico. La búsqueda llegó a 210 ms al final de la prueba, porque ningún diseño elimina el efecto de un horizonte retenido, pero el límite de un minuto para las sesiones inactivas del usuario de reportes impide que ese escenario se repita en producción.',
        },
      ],
    },
    {
      title: 'Qué vigilar para que no vuelva',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una cola en tabla funciona bien en Postgres hasta volúmenes altos, siempre que las versiones muertas vivan poco. Las alertas siguientes miden directamente esa condición, en lugar de esperar a que el retraso le llegue al cliente.',
        },
        {
          type: 'ordered',
          items: [
            'Edad de la tarea pendiente más antigua (now() menos el menor executar_em entre las pendientes): es el indicador que siente el negocio.',
            'n_dead_tup de la tabla de la cola en relación con n_live_tup: si las muertas superan varias veces a las vivas, la limpieza no está dando abasto.',
            'Edad del horizonte: el mayor valor de age(backend_xmin) y age(backend_xid) en pg_stat_activity, más slots y transacciones preparadas. Alerta por encima de unos minutos.',
            'Tiempo desde el último autovacuum de la tabla de la cola. En una cola activa debe ser de pocos minutos.',
            'Buffers por ejecución de la búsqueda del lote, mediante pg_stat_statements (shared_blks_hit dividido por calls). El tiempo promedio esconde el problema al principio; los buffers no.',
            'Tamaño de los índices de la cola a lo largo de las semanas. Un crecimiento sin aumento de volumen pide REINDEX CONCURRENTLY y una revisión del patrón de escritura.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Vale la pena incluir el escenario en las pruebas de carga: una transacción larga abierta en otra sesión mientras la cola recibe el volumen de pico. Es una prueba barata, y muestra en minutos si el diseño de la cola depende de un horizonte que no siempre va a estar libre.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Ejecutar un VACUUM manual durante el incidente lo resuelve?',
      answer:
        'Solo si el horizonte está libre. Si existe una transacción, un slot o una transacción preparada reteniendo el límite, el VACUUM manual recorre toda la tabla y termina informando que las versiones están muertas pero todavía no pueden eliminarse. El primer paso siempre es encontrar y terminar a quien retiene el horizonte; después de eso el autovacuum normal lo resuelve en una pasada, y el VACUUM manual solo ahorra unos segundos.',
    },
    {
      question: '¿Poner más workers ayuda a drenar la cola más rápido?',
      answer:
        'Mientras la búsqueda del lote es barata, sí. Cuando es cara por las versiones muertas, no: cada worker repite el mismo recorrido, la CPU de la base se satura y cada uno además tiene que saltar las filas bloqueadas por los demás. En el incidente, pasar de 4 a 8 workers aumentó el tiempo de la búsqueda en lugar de aumentar el rendimiento. Aumentar el tamaño del lote ayuda más que aumentar la cantidad de workers, porque reparte el costo fijo del recorrido entre más tareas.',
    },
    {
      question: '¿Es señal de que llegó la hora de cambiar la tabla por un broker de mensajes?',
      answer:
        'No necesariamente. La cola en tabla tiene una ventaja que ningún broker ofrece: la tarea se guarda en la misma transacción que el dato de negocio. Con tabla pequeña, índices parciales, autovacuum ajustado y horizonte vigilado, sostiene miles de tareas por segundo. Un broker empieza a compensar cuando el volumen es mucho mayor, cuando hay muchos consumidores independientes para el mismo evento o cuando la base no puede gastar escritura en eso. Cambiar sin entender la causa solo mueve el problema: la base sigue expuesta a un horizonte retenido en todas las demás tablas.',
    },
  ],
  conclusion: {
    title: 'La cola es rápida mientras la basura vive poco',
    description:
      'SKIP LOCKED resuelve la disputa entre workers, pero no el costo del MVCC: cada tarea concluida deja una versión muerta justo en el punto donde empieza la siguiente búsqueda. Mientras el VACUUM elimina esas versiones en minutos, la cola parece gratuita. Cuando un snapshot antiguo, un slot o el propio worker retienen el horizonte, la búsqueda pasa a recorrer todo lo que ya se procesó, y más workers solo aumentan la cuenta. La corrección es de diseño: una tabla que guarda solo trabajo pendiente, índices parciales, historial en particiones descartables, reserva corta con plazo, autovacuum por conteo absoluto y límites de tiempo para quien puede abrir transacciones largas.',
    cta: '¿Quieres revisar las colas, los workers y las rutinas de limpieza de tu Postgres antes de que el retraso le llegue al cliente?',
  },
  related: [
    {
      label: 'Autovacuum que no da abasto: cuándo la tabla se hincha y la consulta se vuelve lenta sin que nada cambie',
      to: '/blog/autovacuum-que-nao-acompanha-tabela-incha-consulta-lenta-sem-mudar-nada',
    },
    {
      label: 'La transacción larga que nadie cierra: idle in transaction que retiene vacuum, locks y conexiones',
      to: '/blog/transacao-longa-que-ninguem-fecha-idle-in-transaction-que-segura-vacuum-lock-e-conexao',
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
