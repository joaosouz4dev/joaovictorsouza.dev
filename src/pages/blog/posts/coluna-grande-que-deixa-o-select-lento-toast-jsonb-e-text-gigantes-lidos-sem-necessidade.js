// Conteudo do artigo: coluna grande que deixa o SELECT * lento. Como o TOAST guarda valores
// grandes fora da linha, quando eles sao lidos e descomprimidos, por que o EXPLAIN ANALYZE nao
// mostra esse custo (e como o SERIALIZE do PostgreSQL 17 mostra), como medir o peso de cada
// coluna e como corrigir leitura e escrita: colunas explicitas, tabela separada, coluna derivada
// e jsonb que deixa de crescer a cada mensagem.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const comments = {
  pt: {
    ex1: 'A consulta da listagem, exatamente como a API envia.',
    ex2: 'O EXPLAIN ANALYZE descarta as linhas sem convertê-las: o TOAST nunca é lido aqui.',
    ex3: 'PostgreSQL 17: SERIALIZE converte cada linha para o formato de saída, com detoast.',
    ex4: '19 MB de saída para 50 linhas, quase tudo de historico.',
    ex5: 'Só as colunas que a tela mostra: o TOAST não é tocado.',
    d1: 'Quanto da tabela mora fora da linha principal.',
    d2: 'Peso médio e máximo das colunas grandes, numa amostra de 1% das páginas.',
    d3: 'A amostra ainda descomprime esses valores: rode fora do pico ou numa réplica.',
    d4: 'Algoritmo de compressão dos valores gravados (PostgreSQL 14 ou superior).',
    a1: 'Listagem: só as colunas da tela, nenhuma delas vai para o TOAST.',
    a2: 'Detalhe: as mensagens vêm paginadas da tabela própria, nunca a conversa inteira.',
    a3: 'Escrita: uma linha nova por mensagem e colunas derivadas atualizadas na mesma transação.',
    a4: 'Trava a linha da conversa: duas mensagens simultâneas não perdem incremento.',
    m1: 'Mensagens viram linhas: cada escrita grava só a mensagem nova.',
    m2: 'Instantâneo desde o PostgreSQL 11: não reescreve a tabela.',
    m3: 'Backfill por faixa de id, uma transação por lote. Repita avançando 20 mil ids por vez.',
    m4: 'Copia, soma ao contador e anula o historico no mesmo comando: rodar de novo não duplica.',
    m5: 'Depois de todos os lotes: o vacuum torna o espaço do TOAST reutilizável.',
    m6: 'DROP COLUMN é só metadado e não devolve espaço ao sistema operacional;',
    m7: 'para encolher os arquivos, pg_repack ou VACUUM FULL numa janela de manutenção.',
    w1: 'O padrão que reescreve tudo: anexar uma mensagem ao array.',
    w2: 'Cada execução descomprime o valor inteiro, grava uma versão nova no TOAST e deixa a antiga como lixo.',
    w3: 'Quanto WAL uma única mensagem gera (psql, numa sessão sem outras escritas).',
    w4: '101 kB de WAL para uma mensagem de 240 bytes',
    w5: 'lz4 descomprime bem mais rápido que pglz; vale só para valores gravados daqui em diante.',
    w6: 'Texto grande lido em pedaços com substring: sem compressão, o Postgres busca só os chunks necessários.',
  },
  en: {
    ex1: 'The listing query, exactly as the API sends it.',
    ex2: 'EXPLAIN ANALYZE discards rows without converting them: TOAST is never read here.',
    ex3: 'PostgreSQL 17: SERIALIZE converts every row to the output format, detoasting included.',
    ex4: '19 MB of output for 50 rows, almost all of it from historico.',
    ex5: 'Only the columns the screen shows: TOAST is not touched.',
    d1: 'How much of the table lives outside the main row.',
    d2: 'Average and maximum weight of the large columns, on a 1% page sample.',
    d3: 'The sample still decompresses those values: run it off peak or on a replica.',
    d4: 'Compression algorithm of the stored values (PostgreSQL 14 or later).',
    a1: 'Listing: only the columns on screen, none of them goes to TOAST.',
    a2: 'Detail: messages come paginated from their own table, never the whole conversation.',
    a3: 'Write: one new row per message and derived columns updated in the same transaction.',
    a4: 'Locks the conversation row: two simultaneous messages do not lose an increment.',
    m1: 'Messages become rows: each write stores only the new message.',
    m2: 'Instant since PostgreSQL 11: it does not rewrite the table.',
    m3: 'Backfill by id range, one transaction per batch. Repeat moving forward 20 thousand ids at a time.',
    m4: 'Copies, adds to the counter and nulls historico in the same statement: running it again does not duplicate.',
    m5: 'After all batches: vacuum makes the TOAST space reusable.',
    m6: 'DROP COLUMN is metadata only and does not return space to the operating system;',
    m7: 'to shrink the files, use pg_repack or VACUUM FULL in a maintenance window.',
    w1: 'The pattern that rewrites everything: appending one message to the array.',
    w2: 'Every execution decompresses the whole value, writes a new version to TOAST and leaves the old one as garbage.',
    w3: 'How much WAL a single message generates (psql, in a session with no other writes).',
    w4: '101 kB of WAL for a 240 byte message',
    w5: 'lz4 decompresses much faster than pglz; it only applies to values written from now on.',
    w6: 'Large text read in pieces with substring: without compression, Postgres fetches only the chunks it needs.',
  },
  es: {
    ex1: 'La consulta del listado, exactamente como la envía la API.',
    ex2: 'EXPLAIN ANALYZE descarta las filas sin convertirlas: el TOAST nunca se lee aquí.',
    ex3: 'PostgreSQL 17: SERIALIZE convierte cada fila al formato de salida, con detoast incluido.',
    ex4: '19 MB de salida para 50 filas, casi todo de historico.',
    ex5: 'Solo las columnas que muestra la pantalla: el TOAST no se toca.',
    d1: 'Cuánto de la tabla vive fuera de la fila principal.',
    d2: 'Peso medio y máximo de las columnas grandes, en una muestra del 1% de las páginas.',
    d3: 'La muestra igual descomprime esos valores: ejecútela fuera del pico o en una réplica.',
    d4: 'Algoritmo de compresión de los valores guardados (PostgreSQL 14 o superior).',
    a1: 'Listado: solo las columnas de la pantalla, ninguna va al TOAST.',
    a2: 'Detalle: los mensajes vienen paginados de su propia tabla, nunca la conversación entera.',
    a3: 'Escritura: una fila nueva por mensaje y columnas derivadas actualizadas en la misma transacción.',
    a4: 'Bloquea la fila de la conversación: dos mensajes simultáneos no pierden incremento.',
    m1: 'Los mensajes pasan a ser filas: cada escritura guarda solo el mensaje nuevo.',
    m2: 'Instantáneo desde PostgreSQL 11: no reescribe la tabla.',
    m3: 'Backfill por rango de id, una transacción por lote. Repita avanzando 20 mil ids por vez.',
    m4: 'Copia, suma al contador y anula historico en el mismo comando: ejecutarlo de nuevo no duplica.',
    m5: 'Después de todos los lotes: el vacuum vuelve reutilizable el espacio del TOAST.',
    m6: 'DROP COLUMN es solo metadato y no devuelve espacio al sistema operativo;',
    m7: 'para achicar los archivos, pg_repack o VACUUM FULL en una ventana de mantenimiento.',
    w1: 'El patrón que reescribe todo: agregar un mensaje al array.',
    w2: 'Cada ejecución descomprime el valor entero, graba una versión nueva en el TOAST y deja la anterior como basura.',
    w3: 'Cuánto WAL genera un solo mensaje (psql, en una sesión sin otras escrituras).',
    w4: '101 kB de WAL para un mensaje de 240 bytes',
    w5: 'lz4 descomprime mucho más rápido que pglz; vale solo para valores grabados de aquí en adelante.',
    w6: 'Texto grande leído por partes con substring: sin compresión, Postgres busca solo los chunks necesarios.',
  },
};

const explainCode = (c) => `-- ${c.ex1}
-- ${c.ex2}
EXPLAIN (ANALYZE, BUFFERS)
SELECT *
  FROM conversas
 WHERE tenant_id = 42
 ORDER BY atualizado_em DESC
 LIMIT 50;

Limit  (rows=50) (actual time=0.052..3.044 rows=50 loops=1)
  Buffers: shared hit=58
  ->  Index Scan Backward using conversas_tenant_atualizado_idx on conversas
        (rows=187400) (actual time=0.050..3.021 rows=50 loops=1)
        Index Cond: (tenant_id = 42)
        Buffers: shared hit=58
Planning Time: 0.211 ms
Execution Time: 3.102 ms

-- ${c.ex3}
EXPLAIN (ANALYZE, BUFFERS, SERIALIZE)
SELECT *
  FROM conversas
 WHERE tenant_id = 42
 ORDER BY atualizado_em DESC
 LIMIT 50;

...
Planning Time: 0.198 ms
Serialization: time=186.420 ms  output=19034kB  format=text
  Buffers: shared hit=97 read=611
Execution Time: 189.611 ms
-- ${c.ex4}

-- ${c.ex5}
EXPLAIN (ANALYZE, BUFFERS, SERIALIZE)
SELECT id, contato_nome, status, ultima_mensagem, atualizado_em
  FROM conversas
 WHERE tenant_id = 42
 ORDER BY atualizado_em DESC
 LIMIT 50;

...
Serialization: time=0.091 ms  output=9kB  format=text
Execution Time: 3.188 ms`;

const diagnoseCode = (c) => `-- ${c.d1}
SELECT c.relname,
       pg_size_pretty(pg_relation_size(c.oid))           AS heap,
       pg_size_pretty(pg_relation_size(c.reltoastrelid)) AS toast,
       pg_size_pretty(pg_indexes_size(c.oid))            AS indices,
       t.relname                                         AS tabela_toast
  FROM pg_class c
  JOIN pg_class t ON t.oid = c.reltoastrelid
 WHERE c.oid = 'public.conversas'::regclass;
-- conversas | 2338 MB | 61 GB | 912 MB | pg_toast_418204

-- ${c.d2}
-- ${c.d3}
SELECT count(*)                                  AS linhas_amostra,
       avg(pg_column_size(historico))::int       AS historico_armazenado,
       avg(octet_length(historico::text))::int   AS historico_em_texto,
       max(pg_column_size(historico))            AS historico_maior,
       avg(pg_column_size(resumo_ia))::int       AS resumo_armazenado
  FROM conversas TABLESAMPLE SYSTEM (1)
 WHERE historico IS NOT NULL;
-- 6412 | 98304 | 389120 | 2911840 | 1730

-- ${c.d4}
SELECT pg_column_compression(historico) AS algoritmo, count(*)
  FROM conversas TABLESAMPLE SYSTEM (1)
 WHERE historico IS NOT NULL
 GROUP BY 1;
-- pglz | 6412`;

const appCode = (c) => `// conversas-repositorio.js
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// ${c.a1}
export async function listarConversas(tenantId, { antesDe = null, limite = 50 } = {}) {
  const { rows } = await pool.query(
    \`SELECT id, contato_nome, status, ultima_mensagem, total_mensagens, atualizado_em
       FROM conversas
      WHERE tenant_id = $1
        AND ($2::timestamptz IS NULL OR atualizado_em < $2::timestamptz)
      ORDER BY atualizado_em DESC
      LIMIT $3\`,
    [tenantId, antesDe, limite],
  );
  return rows;
}

// ${c.a2}
export async function listarMensagens(tenantId, conversaId, { limite = 100 } = {}) {
  const { rows } = await pool.query(
    \`SELECT m.id, m.autor, m.texto, m.enviada_em
       FROM mensagens m
       JOIN conversas c ON c.id = m.conversa_id
      WHERE c.tenant_id = $1
        AND m.conversa_id = $2
      ORDER BY m.enviada_em DESC, m.id DESC
      LIMIT $3\`,
    [tenantId, conversaId, limite],
  );
  return rows.reverse();
}

// ${c.a3}
export async function registrarMensagem(conversaId, { autor, texto, enviadaEm, metadados = {} }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ${c.a4}
    const atualizada = await client.query(
      \`UPDATE conversas
          SET total_mensagens = total_mensagens + 1,
              ultima_mensagem = left($2, 280),
              atualizado_em   = greatest(atualizado_em, $3::timestamptz)
        WHERE id = $1\`,
      [conversaId, texto, enviadaEm],
    );
    if (atualizada.rowCount === 0) {
      throw new Error('conversa inexistente: ' + conversaId);
    }

    const { rows } = await client.query(
      \`INSERT INTO mensagens (conversa_id, autor, texto, enviada_em, metadados)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id\`,
      [conversaId, autor, texto, enviadaEm, metadados],
    );

    await client.query('COMMIT');
    return rows[0].id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}`;

const migrationCode = (c) => `-- ${c.m1}
CREATE TABLE mensagens (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversa_id bigint      NOT NULL REFERENCES conversas (id) ON DELETE CASCADE,
  autor       text        NOT NULL,
  texto       text        NOT NULL,
  enviada_em  timestamptz NOT NULL,
  metadados   jsonb       NOT NULL DEFAULT '{}'
);
CREATE INDEX mensagens_conversa_enviada_idx ON mensagens (conversa_id, enviada_em, id);

-- ${c.m2}
ALTER TABLE conversas ADD COLUMN total_mensagens integer NOT NULL DEFAULT 0;

-- ${c.m3}
-- ${c.m4}
WITH lote AS (
  SELECT id, historico
    FROM conversas
   WHERE id > 0 AND id <= 20000
     AND historico IS NOT NULL
     FOR UPDATE
), copiadas AS (
  INSERT INTO mensagens (conversa_id, autor, texto, enviada_em, metadados)
  SELECT l.id,
         coalesce(m->>'autor', 'desconhecido'),
         coalesce(m->>'texto', ''),
         (m->>'enviada_em')::timestamptz,
         m - 'autor' - 'texto' - 'enviada_em'
    FROM lote l
    CROSS JOIN LATERAL jsonb_array_elements(l.historico->'mensagens') AS m
)
UPDATE conversas c
   SET total_mensagens = c.total_mensagens + jsonb_array_length(l.historico->'mensagens'),
       historico = NULL
  FROM lote l
 WHERE c.id = l.id;

-- ${c.m5}
VACUUM (VERBOSE) conversas;

-- ${c.m6}
-- ${c.m7}
ALTER TABLE conversas DROP COLUMN historico;`;

const writeCode = (c) => `-- ${c.w1}
-- ${c.w2}
UPDATE conversas
   SET historico = jsonb_set(historico, '{mensagens}', (historico->'mensagens') || $2::jsonb),
       atualizado_em = now()
 WHERE id = $1;

-- ${c.w3}
SELECT pg_current_wal_lsn() AS antes \\gset
UPDATE conversas
   SET historico = jsonb_set(historico, '{mensagens}',
         (historico->'mensagens') || '[{"autor":"cliente","texto":"ok, obrigado"}]'::jsonb)
 WHERE id = 3918022;
SELECT pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), :'antes'));
-- ${c.w4}

-- ${c.w5}
ALTER TABLE conversas ALTER COLUMN resumo_ia SET COMPRESSION lz4;

-- ${c.w6}
ALTER TABLE anexos ALTER COLUMN conteudo_texto SET STORAGE EXTERNAL;`;

const diagramaPt = `S0  conversas: 4,2 milhões de linhas, tabela de 2,1 GB, listagem com p95 de 40 ms
S1  deploy: coluna historico jsonb guarda a conversa inteira para o resumo por IA
    cada mensagem nova faz UPDATE anexando ao array
S3  historico médio: 380 KB como texto, 96 KB armazenado comprimido no TOAST
S6  640 mil conversas com historico: pg_toast_418204 com 61 GB
    a tabela principal continua com 2,3 GB, e o monitoramento de tamanho não acusa nada
S6  GET /conversas?limit=50: p95 de 2,8 s, CPU do Node em 90%, WAL diário 6 vezes maior
S6  EXPLAIN ANALYZE da mesma consulta: 3,1 ms
S6  hotfix com colunas explícitas na listagem: p95 de volta a 38 ms
S8  mensagens migradas para tabela própria: WAL diário volta ao patamar anterior`;

const diagramaEn = `W0  conversas: 4.2 million rows, 2.1 GB table, listing p95 of 40 ms
W1  deploy: historico jsonb column stores the whole conversation for the AI summary
    every new message runs an UPDATE appending to the array
W3  average historico: 380 KB as text, 96 KB stored compressed in TOAST
W6  640 thousand conversations with historico: pg_toast_418204 at 61 GB
    the main table stays at 2.3 GB, and size monitoring reports nothing
W6  GET /conversas?limit=50: p95 of 2.8 s, Node CPU at 90%, daily WAL 6 times larger
W6  EXPLAIN ANALYZE of the same query: 3.1 ms
W6  hotfix with explicit columns in the listing: p95 back to 38 ms
W8  messages migrated to their own table: daily WAL back to the previous level`;

const diagramaEs = `S0  conversas: 4,2 millones de filas, tabla de 2,1 GB, listado con p95 de 40 ms
S1  deploy: la columna historico jsonb guarda la conversación entera para el resumen con IA
    cada mensaje nuevo hace un UPDATE agregando al array
S3  historico medio: 380 KB como texto, 96 KB guardado comprimido en el TOAST
S6  640 mil conversaciones con historico: pg_toast_418204 con 61 GB
    la tabla principal sigue con 2,3 GB, y el monitoreo de tamaño no alerta nada
S6  GET /conversas?limit=50: p95 de 2,8 s, CPU de Node al 90%, WAL diario 6 veces mayor
S6  EXPLAIN ANALYZE de la misma consulta: 3,1 ms
S6  hotfix con columnas explícitas en el listado: p95 de vuelta a 38 ms
S8  mensajes migrados a su propia tabla: el WAL diario vuelve al nivel anterior`;

const pt = {
  intro:
    'Uma plataforma de atendimento por WhatsApp passou a guardar a conversa inteira numa coluna jsonb da tabela conversas, para alimentar o resumo gerado por IA. Seis semanas depois, a tela de listagem, que mostra só contato, status e última mensagem, saiu de 40 ms para 2,8 segundos de p95, o Node ficou com CPU em 90% e o volume diário de WAL ficou seis vezes maior. A consulta não tinha mudado, o índice estava sendo usado e o EXPLAIN ANALYZE dizia 3,1 ms. O custo estava em outro lugar: o SELECT * trazia, para cada uma das 50 linhas da página, 380 KB de histórico que ninguém exibia, guardados fora da linha pelo TOAST e descomprimidos a cada requisição. Este artigo mostra como o TOAST funciona, por que esse custo não aparece no EXPLAIN ANALYZE, como medir o peso de cada coluna e como corrigir a leitura e a escrita sem reescrever a aplicação inteira.',
  sections: [
    {
      title: 'A listagem que ficou 70 vezes mais lenta sem mudar a consulta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O incidente demorou a ser entendido porque todos os sinais clássicos estavam bons. A tabela principal tinha praticamente o mesmo tamanho, o plano usava o índice composto de tenant e data, não havia lock nem consulta nova no pg_stat_statements. O que cresceu foi uma tabela que quase ninguém olha: a tabela TOAST associada a conversas, que saiu de zero para 61 GB.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'A causa tinha duas metades. Na leitura, a listagem usava SELECT * herdado de quando a tabela só tinha colunas pequenas, e passou a carregar 19 MB por página. Na escrita, cada mensagem nova reescrevia o histórico inteiro, gerando WAL e lixo no TOAST proporcionais ao tamanho da conversa, não ao tamanho da mensagem. A primeira metade se resolve em uma hora; a segunda pede mudança de modelo.',
        },
      ],
    },
    {
      title: 'Como o TOAST guarda valores grandes e quando ele é lido',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma linha do Postgres precisa caber numa página de 8 kB. Quando uma linha passa de cerca de 2 kB (TOAST_TUPLE_THRESHOLD), o Postgres primeiro tenta comprimir os maiores valores de tamanho variável e, se a linha ainda não couber abaixo de toast_tuple_target (também cerca de 2 kB por padrão), move esses valores para a tabela TOAST, quebrados em pedaços de aproximadamente 2 kB. Na linha principal fica só um ponteiro de 18 bytes. Por isso a tabela conversas continuou com 2,3 GB enquanto o histórico ocupava 61 GB em pg_toast.pg_toast_418204.',
        },
        {
          type: 'paragraph',
          value:
            'O ponto que importa para desempenho: o valor fora da linha só é buscado e descomprimido quando a consulta precisa dele. Uma consulta que não referencia historico nunca toca a tabela TOAST. Uma consulta que devolve historico ao cliente, filtra por uma chave dele ou calcula algo sobre ele paga a leitura dos chunks, a descompressão e, no caso do jsonb, o valor inteiro, porque não existe leitura parcial de jsonb comprimido: para ler payload->>\'status\' de um documento de 380 KB, o Postgres descomprime os 380 KB.',
        },
        {
          type: 'table',
          columns: ['Estratégia de STORAGE', 'Comprime', 'Vai para o TOAST', 'Padrão de'],
          rows: [
            ['PLAIN', 'Não', 'Não', 'Tipos de tamanho fixo: integer, bigint, timestamptz'],
            ['MAIN', 'Sim', 'Só em último caso', 'numeric'],
            ['EXTERNAL', 'Não', 'Sim', 'Nenhum tipo; útil para text e bytea lidos com substring'],
            ['EXTENDED', 'Sim', 'Sim', 'text, varchar, jsonb, bytea'],
          ],
        },
        {
          type: 'list',
          items: [
            'SELECT * em tabela com coluna grande lê o TOAST de toda linha devolvida, mesmo que a tela use três campos.',
            'Filtrar ou ordenar por uma chave de dentro do jsonb descomprime o documento inteiro em cada linha avaliada.',
            'UPDATE que não mexe na coluna grande reaproveita o ponteiro: o valor no TOAST não é regravado.',
            'UPDATE que muda qualquer parte do jsonb grava um valor novo inteiro no TOAST e deixa o antigo para o vacuum.',
          ],
        },
      ],
    },
    {
      title: 'Por que o EXPLAIN ANALYZE diz 3 ms e a API leva 2,8 s',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O EXPLAIN ANALYZE executa a consulta, mas descarta as linhas em vez de enviá-las. Como os valores TOAST só são buscados quando alguém precisa do conteúdo, e nesse caso ninguém precisa, o plano mede o acesso ao índice e à linha principal e para por aí. A consulta parece perfeita. A partir do PostgreSQL 17, a opção SERIALIZE converte cada linha para o formato que seria enviado ao cliente, o que inclui buscar e descomprimir os valores TOAST, e mostra esse custo separado.',
        },
        {
          type: 'code',
          value: explainCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'Os 186 ms de serialização são só a parte do banco. Depois deles vêm 19 MB atravessando a rede, o driver node-postgres montando strings e chamando JSON.parse em cada jsonb, e tudo isso acontecendo na thread principal do Node. Com 30 atendentes abrindo a listagem ao mesmo tempo, o event loop enfileira esses parses e o p95 chega a 2,8 s, enquanto o banco parece ocioso.',
        },
        {
          type: 'table',
          columns: ['Etapa por página de 50 linhas', 'SELECT *', 'Colunas explícitas'],
          rows: [
            ['Execução no banco (índice e linha principal)', '3,1 ms', '3,1 ms'],
            ['Detoast e serialização', '186 ms, 611 páginas lidas do disco', '0,09 ms'],
            ['Bytes transferidos', '19 MB', '9 kB'],
            ['JSON.parse no Node, bloqueando o event loop', 'cerca de 150 ms', 'nenhum'],
            ['p95 da API com 30 requisições simultâneas', '2,8 s', '38 ms'],
          ],
        },
      ],
    },
    {
      title: 'Medir o que cada coluna pesa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'pg_relation_size da tabela mede só a linha principal. Para saber quanto está fora dela, é preciso olhar reltoastrelid. E para saber o peso por linha, pg_column_size devolve o tamanho armazenado, já comprimido, enquanto octet_length do valor convertido em texto mostra o que de fato trafega até a aplicação. A diferença entre os dois é o quanto a compressão está escondendo.',
        },
        {
          type: 'code',
          value: diagnoseCode(comments.pt),
        },
        {
          type: 'list',
          items: [
            'Toast muito maior que o heap é o sinal de que existe coluna grande que merece revisão de leitura.',
            'Média armazenada de 96 kB e texto de 380 kB significam que cada linha devolvida custa 380 kB de rede e de parse.',
            'O máximo importa tanto quanto a média: uma conversa de 2,9 MB numa página de listagem já estoura o orçamento de memória de um worker pequeno.',
            'pg_stats.avg_width não serve aqui: para valores fora da linha, ele mede o ponteiro, não o conteúdo.',
            'Alerte também sobre o tamanho do TOAST, não só da tabela: era ali que o crescimento estava.',
          ],
        },
      ],
    },
    {
      title: 'Corrigir a leitura: colunas explícitas, tabela própria e colunas derivadas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O hotfix do mesmo dia foi trocar SELECT * por uma lista de colunas na listagem. Isso resolveu o p95, mas deixava a armadilha armada para a próxima consulta escrita com pressa ou para o ORM que seleciona todos os campos por padrão. A correção definitiva tirou o histórico da linha principal: as mensagens viraram linhas de uma tabela própria, e o que a listagem precisa, como última mensagem e total de mensagens, virou coluna pequena mantida na escrita.',
        },
        {
          type: 'code',
          value: appCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'A migração não precisa de janela. A tabela nova é criada vazia, a aplicação passa a gravar mensagens novas só nela e a tela de detalhe lê das duas fontes enquanto o backfill não termina. O backfill anda por faixas de id, e cada lote copia, soma ao contador e anula o historico no mesmo comando, o que o torna seguro para rodar de novo depois de uma falha.',
        },
        {
          type: 'code',
          value: migrationCode(comments.pt),
        },
        {
          type: 'table',
          columns: ['Opção', 'Ganho na leitura', 'Custo', 'Quando usar'],
          rows: [
            ['Lista explícita de colunas', 'Imediato nas consultas corrigidas', 'Disciplina em todo código novo; o ORM precisa de select ou omit', 'Sempre, como primeiro passo'],
            ['Tabela 1:1 para a coluna grande', 'SELECT * volta a ser barato', 'Join quando o conteúdo é necessário', 'Documento grande lido raramente e escrito inteiro'],
            ['Tabela 1:N no lugar de array jsonb', 'Leitura paginada do detalhe', 'Migração de dados e mais linhas', 'Lista que cresce com o tempo: mensagens, eventos, anexos'],
            ['Coluna derivada mantida na escrita', 'Listagem sem tocar no documento', 'Código de escrita precisa manter a coluna', 'Campos que a listagem mostra ou filtra'],
            ['Coluna gerada STORED a partir do jsonb', 'Igual à derivada, sem código na aplicação', 'ADD COLUMN reescreve a tabela com lock exclusivo', 'Tabelas pequenas ou criadas já com a coluna'],
          ],
        },
      ],
    },
    {
      title: 'A escrita também paga: jsonb que cresce a cada mensagem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A segunda metade do incidente era o WAL. Anexar um elemento a um array jsonb parece uma operação pequena, mas o Postgres não altera um valor TOAST no lugar: ele lê o valor inteiro, descomprime, monta o documento novo, comprime de novo, grava todos os chunks e marca os antigos como mortos. Numa conversa de 380 KB, uma mensagem de 240 bytes gerava cerca de 100 kB de WAL, que também ia para as réplicas e para o backup contínuo.',
        },
        {
          type: 'code',
          value: writeCode(comments.pt),
        },
        {
          type: 'list',
          items: [
            'O custo de escrita cresce com o tamanho do documento, então piora justamente nas conversas mais ativas.',
            'Os chunks mortos incham a tabela TOAST e dependem do autovacuum, que é disparado pelas contagens da tabela TOAST, não da principal.',
            'Duas escritas concorrentes no mesmo documento disputam a mesma linha e uma espera a outra pelo tempo de reescrever 380 KB.',
            'Trocar pglz por lz4 reduz o custo de CPU da compressão e da descompressão, mas não muda o fato de que o valor inteiro é reescrito.',
            'SET STORAGE EXTERNAL só compensa para texto ou bytea lidos em pedaços com substring; para jsonb, que é lido inteiro, ele só aumenta o espaço.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A regra prática que saiu do incidente: jsonb é ótimo para um documento que é gravado de uma vez e lido de uma vez, como o payload original de um webhook ou a configuração de uma integração. Para algo que cresce item a item, como mensagens, eventos ou anotações, o modelo certo é uma linha por item. E qualquer coluna que pode passar de alguns kB fica fora das consultas de listagem por padrão, não por exceção.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'SELECT * é sempre ruim?',
      answer:
        'Não. Numa tabela só com colunas pequenas, o custo de trazer todas é desprezível, e em consultas ad hoc ele é prático. O problema aparece quando a tabela ganha uma coluna text, jsonb ou bytea que pode passar de alguns kB: a partir daí, todo SELECT * passa a ler o TOAST de cada linha devolvida. Em código de produção, a lista explícita de colunas protege a consulta de mudanças futuras no esquema, o que vale mais do que a economia de digitação.',
    },
    {
      question: 'Comprimir com lz4 resolve a lentidão?',
      answer:
        'Ajuda na CPU, porque lz4 comprime e descomprime bem mais rápido que pglz, mas não reduz o volume que trafega até a aplicação nem o parse do JSON, que eram a maior parte dos 2,8 s. Também só vale para valores gravados depois do ALTER TABLE ... SET COMPRESSION lz4, e o servidor precisa ter sido compilado com suporte a lz4. É um ajuste complementar; a correção é não ler a coluna quando ela não é necessária.',
    },
    {
      question: 'Como descobrir se o meu ORM está trazendo colunas grandes?',
      answer:
        'Ative o log das consultas geradas em ambiente de teste e procure SELECT com todas as colunas da tabela, ou use EXPLAIN (ANALYZE, SERIALIZE) no PostgreSQL 17 com a consulta capturada para ver o output em kB. Nas versões recentes do Prisma, omit exclui campos por padrão; em TypeORM e Sequelize, select e attributes resolvem por consulta, e uma coluna marcada para não ser selecionada por padrão resolve para todas.',
    },
  ],
  conclusion: {
    title: 'A coluna que ninguém mostra também tem custo',
    description:
      'Uma consulta que usa o índice certo pode ficar lenta porque traz dados que a tela não usa. O TOAST esconde o tamanho real da tabela, o EXPLAIN ANALYZE não mede o detoast e o custo aparece na rede, no parse e no event loop da aplicação. A correção começa com colunas explícitas nas consultas de listagem e termina no modelo: documento grande em tabela própria, lista que cresce virando linhas e campos de listagem mantidos como colunas pequenas. Se a sua aplicação ficou lenta depois de começar a guardar payloads, transcrições ou históricos no banco, eu posso revisar o modelo de dados, as consultas e a migração.',
    cta: 'Revisar o modelo de dados',
  },
  related: [
    {
      label: 'Coluna JSON que virou esquema escondido: quando o campo flexível passa a precisar de índice, validação e migração',
      to: '/blog/coluna-json-que-virou-esquema-escondido-quando-o-campo-flexivel-passa-a-precisar-de-indice-validacao-e-migracao',
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
    'A WhatsApp customer service platform started storing the whole conversation in a jsonb column on the conversas table, to feed an AI generated summary. Six weeks later, the listing screen, which only shows contact, status and last message, went from 40 ms to a 2.8 second p95, Node sat at 90% CPU and daily WAL volume grew six times. The query had not changed, the index was being used and EXPLAIN ANALYZE reported 3.1 ms. The cost was somewhere else: SELECT * brought, for each of the 50 rows on the page, 380 KB of history that nobody displayed, stored out of line by TOAST and decompressed on every request. This article shows how TOAST works, why this cost does not show up in EXPLAIN ANALYZE, how to measure the weight of each column and how to fix reads and writes without rewriting the whole application.',
  sections: [
    {
      title: 'The listing that became 70 times slower without changing the query',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The incident took a while to understand because every classic signal looked fine. The main table was practically the same size, the plan used the composite tenant and date index, and there were no locks and no new queries in pg_stat_statements. What grew was a table almost nobody looks at: the TOAST table attached to conversas, which went from zero to 61 GB.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'The cause had two halves. On reads, the listing used a SELECT * inherited from the days when the table only had small columns, and it started loading 19 MB per page. On writes, every new message rewrote the whole history, producing WAL and TOAST garbage proportional to the size of the conversation, not the size of the message. The first half takes an hour to fix; the second one requires a model change.',
        },
      ],
    },
    {
      title: 'How TOAST stores large values and when it reads them',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A Postgres row has to fit in an 8 kB page. When a row goes over roughly 2 kB (TOAST_TUPLE_THRESHOLD), Postgres first tries to compress the largest variable length values and, if the row still does not fit under toast_tuple_target (also about 2 kB by default), moves those values to the TOAST table, split into chunks of about 2 kB. The main row keeps only an 18 byte pointer. That is why the conversas table stayed at 2.3 GB while the history took 61 GB in pg_toast.pg_toast_418204.',
        },
        {
          type: 'paragraph',
          value:
            'The point that matters for performance: an out of line value is only fetched and decompressed when the query needs it. A query that does not reference historico never touches the TOAST table. A query that returns historico to the client, filters on one of its keys or computes something over it pays for reading the chunks, for decompression and, with jsonb, for the whole value, because there is no partial read of compressed jsonb: to read payload->>\'status\' from a 380 KB document, Postgres decompresses all 380 KB.',
        },
        {
          type: 'table',
          columns: ['STORAGE strategy', 'Compresses', 'Moves to TOAST', 'Default for'],
          rows: [
            ['PLAIN', 'No', 'No', 'Fixed length types: integer, bigint, timestamptz'],
            ['MAIN', 'Yes', 'Only as a last resort', 'numeric'],
            ['EXTERNAL', 'No', 'Yes', 'No type; useful for text and bytea read with substring'],
            ['EXTENDED', 'Yes', 'Yes', 'text, varchar, jsonb, bytea'],
          ],
        },
        {
          type: 'list',
          items: [
            'SELECT * on a table with a large column reads TOAST for every returned row, even if the screen uses three fields.',
            'Filtering or sorting by a key inside the jsonb decompresses the whole document for every evaluated row.',
            'An UPDATE that does not touch the large column reuses the pointer: the TOAST value is not rewritten.',
            'An UPDATE that changes any part of the jsonb writes a whole new value to TOAST and leaves the old one for vacuum.',
          ],
        },
      ],
    },
    {
      title: 'Why EXPLAIN ANALYZE says 3 ms and the API takes 2.8 s',
      blocks: [
        {
          type: 'paragraph',
          value:
            'EXPLAIN ANALYZE executes the query, but it discards the rows instead of sending them. Since TOAST values are only fetched when someone needs the content, and here nobody does, the plan measures the index and main row access and stops there. The query looks perfect. Starting with PostgreSQL 17, the SERIALIZE option converts every row to the format that would be sent to the client, which includes fetching and decompressing TOAST values, and reports that cost separately.',
        },
        {
          type: 'code',
          value: explainCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'The 186 ms of serialization are only the database part. After that come 19 MB over the network, the node-postgres driver building strings and calling JSON.parse on every jsonb, all of it on the main Node thread. With 30 agents opening the listing at the same time, the event loop queues those parses and the p95 reaches 2.8 s, while the database looks idle.',
        },
        {
          type: 'table',
          columns: ['Step per 50 row page', 'SELECT *', 'Explicit columns'],
          rows: [
            ['Execution in the database (index and main row)', '3.1 ms', '3.1 ms'],
            ['Detoast and serialization', '186 ms, 611 pages read from disk', '0.09 ms'],
            ['Bytes transferred', '19 MB', '9 kB'],
            ['JSON.parse in Node, blocking the event loop', 'about 150 ms', 'none'],
            ['API p95 with 30 concurrent requests', '2.8 s', '38 ms'],
          ],
        },
      ],
    },
    {
      title: 'Measuring what each column weighs',
      blocks: [
        {
          type: 'paragraph',
          value:
            'pg_relation_size on the table only measures the main row storage. To know how much lives outside of it, you have to look at reltoastrelid. And to know the weight per row, pg_column_size returns the stored, already compressed size, while octet_length of the value cast to text shows what actually travels to the application. The gap between the two is how much compression is hiding.',
        },
        {
          type: 'code',
          value: diagnoseCode(comments.en),
        },
        {
          type: 'list',
          items: [
            'TOAST much larger than the heap is the sign that some large column deserves a read review.',
            'A stored average of 96 kB and 380 kB of text mean every returned row costs 380 kB of network and parsing.',
            'The maximum matters as much as the average: a 2.9 MB conversation on a listing page already blows the memory budget of a small worker.',
            'pg_stats.avg_width does not help here: for out of line values it measures the pointer, not the content.',
            'Alert on TOAST size too, not only on the table: that is where the growth was.',
          ],
        },
      ],
    },
    {
      title: 'Fixing reads: explicit columns, a dedicated table and derived columns',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The same day hotfix was to replace SELECT * with a column list in the listing. That fixed the p95, but left the trap armed for the next query written in a hurry or for the ORM that selects every field by default. The definitive fix took the history out of the main row: messages became rows in their own table, and what the listing needs, such as last message and message count, became small columns maintained on write.',
        },
        {
          type: 'code',
          value: appCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'The migration does not need a maintenance window. The new table is created empty, the application starts writing new messages only to it, and the detail screen reads from both sources while the backfill is running. The backfill walks id ranges, and each batch copies, adds to the counter and nulls historico in the same statement, which makes it safe to rerun after a failure.',
        },
        {
          type: 'code',
          value: migrationCode(comments.en),
        },
        {
          type: 'table',
          columns: ['Option', 'Read gain', 'Cost', 'When to use'],
          rows: [
            ['Explicit column list', 'Immediate on the fixed queries', 'Discipline in all new code; the ORM needs select or omit', 'Always, as the first step'],
            ['1:1 table for the large column', 'SELECT * becomes cheap again', 'A join when the content is needed', 'Large document read rarely and written whole'],
            ['1:N table instead of a jsonb array', 'Paginated detail reads', 'Data migration and more rows', 'Lists that grow over time: messages, events, attachments'],
            ['Derived column maintained on write', 'Listing without touching the document', 'Write code must maintain the column', 'Fields the listing shows or filters by'],
            ['STORED generated column from the jsonb', 'Same as derived, with no application code', 'ADD COLUMN rewrites the table under an exclusive lock', 'Small tables or tables created with the column'],
          ],
        },
      ],
    },
    {
      title: 'Writes pay too: a jsonb that grows with every message',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The second half of the incident was WAL. Appending an element to a jsonb array looks like a small operation, but Postgres does not change a TOAST value in place: it reads the whole value, decompresses it, builds the new document, compresses it again, writes every chunk and marks the old ones as dead. On a 380 KB conversation, a 240 byte message produced about 100 kB of WAL, which also went to the replicas and to continuous backup.',
        },
        {
          type: 'code',
          value: writeCode(comments.en),
        },
        {
          type: 'list',
          items: [
            'Write cost grows with the document size, so it gets worse precisely on the most active conversations.',
            'Dead chunks bloat the TOAST table and depend on autovacuum, which is triggered by the TOAST table counters, not the main table ones.',
            'Two concurrent writes to the same document contend for the same row, and one waits for the other to rewrite 380 KB.',
            'Switching pglz for lz4 lowers the CPU cost of compression and decompression, but does not change the fact that the whole value is rewritten.',
            'SET STORAGE EXTERNAL only pays off for text or bytea read in pieces with substring; for jsonb, which is read whole, it just takes more space.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The rule of thumb that came out of the incident: jsonb is great for a document written once and read once, like the original payload of a webhook or the configuration of an integration. For something that grows item by item, like messages, events or notes, the right model is one row per item. And any column that can go beyond a few kB stays out of listing queries by default, not by exception.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is SELECT * always bad?',
      answer:
        'No. On a table with only small columns, the cost of bringing all of them is negligible, and in ad hoc queries it is convenient. The problem shows up when the table gains a text, jsonb or bytea column that can go beyond a few kB: from then on, every SELECT * reads TOAST for every returned row. In production code, an explicit column list protects the query from future schema changes, which is worth more than the typing it saves.',
    },
    {
      question: 'Does compressing with lz4 fix the slowness?',
      answer:
        'It helps with CPU, because lz4 compresses and decompresses much faster than pglz, but it does not reduce the volume that travels to the application or the JSON parsing, which were most of the 2.8 s. It also only applies to values written after ALTER TABLE ... SET COMPRESSION lz4, and the server must have been built with lz4 support. It is a complementary tweak; the fix is to not read the column when it is not needed.',
    },
    {
      question: 'How do I find out if my ORM is loading large columns?',
      answer:
        'Turn on logging of generated queries in a test environment and look for SELECTs listing every column of the table, or run EXPLAIN (ANALYZE, SERIALIZE) on PostgreSQL 17 with the captured query to see the output in kB. In recent Prisma versions, omit excludes fields by default; in TypeORM and Sequelize, select and attributes solve it per query, and a column marked as not selected by default solves it for all of them.',
    },
  ],
  conclusion: {
    title: 'The column nobody shows still has a cost',
    description:
      'A query that uses the right index can still be slow because it brings data the screen does not use. TOAST hides the real size of the table, EXPLAIN ANALYZE does not measure detoasting, and the cost shows up in the network, in parsing and in the application event loop. The fix starts with explicit columns in listing queries and ends in the model: large documents in their own table, growing lists turned into rows, and listing fields kept as small columns. If your application got slow after it started storing payloads, transcripts or histories in the database, I can review the data model, the queries and the migration.',
    cta: 'Review the data model',
  },
  related: [
    {
      label: 'The JSON column that became a hidden schema: when the flexible field starts needing indexes, validation and migrations',
      to: '/blog/coluna-json-que-virou-esquema-escondido-quando-o-campo-flexivel-passa-a-precisar-de-indice-validacao-e-migracao',
    },
    {
      label: 'Autovacuum that cannot keep up: when the table bloats and the query slows down without any change',
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
    'Una plataforma de atención por WhatsApp empezó a guardar la conversación entera en una columna jsonb de la tabla conversas, para alimentar el resumen generado con IA. Seis semanas después, la pantalla de listado, que solo muestra contacto, estado y último mensaje, pasó de 40 ms a 2,8 segundos de p95, Node quedó con la CPU al 90% y el volumen diario de WAL se multiplicó por seis. La consulta no había cambiado, el índice se estaba usando y el EXPLAIN ANALYZE decía 3,1 ms. El costo estaba en otro lado: el SELECT * traía, para cada una de las 50 filas de la página, 380 KB de historial que nadie mostraba, guardados fuera de la fila por el TOAST y descomprimidos en cada request. Este artículo muestra cómo funciona el TOAST, por qué ese costo no aparece en el EXPLAIN ANALYZE, cómo medir el peso de cada columna y cómo corregir la lectura y la escritura sin reescribir la aplicación entera.',
  sections: [
    {
      title: 'El listado que se volvió 70 veces más lento sin cambiar la consulta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El incidente tardó en entenderse porque todas las señales clásicas estaban bien. La tabla principal tenía prácticamente el mismo tamaño, el plan usaba el índice compuesto de tenant y fecha, y no había locks ni consultas nuevas en pg_stat_statements. Lo que creció fue una tabla que casi nadie mira: la tabla TOAST asociada a conversas, que pasó de cero a 61 GB.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'La causa tenía dos mitades. En la lectura, el listado usaba un SELECT * heredado de cuando la tabla solo tenía columnas pequeñas, y pasó a cargar 19 MB por página. En la escritura, cada mensaje nuevo reescribía el historial entero, generando WAL y basura en el TOAST proporcionales al tamaño de la conversación, no al del mensaje. La primera mitad se resuelve en una hora; la segunda exige cambiar el modelo.',
        },
      ],
    },
    {
      title: 'Cómo el TOAST guarda valores grandes y cuándo se leen',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una fila de Postgres tiene que caber en una página de 8 kB. Cuando una fila supera unos 2 kB (TOAST_TUPLE_THRESHOLD), Postgres primero intenta comprimir los mayores valores de tamaño variable y, si la fila todavía no queda por debajo de toast_tuple_target (también unos 2 kB por defecto), mueve esos valores a la tabla TOAST, partidos en chunks de aproximadamente 2 kB. En la fila principal queda solo un puntero de 18 bytes. Por eso la tabla conversas siguió con 2,3 GB mientras el historial ocupaba 61 GB en pg_toast.pg_toast_418204.',
        },
        {
          type: 'paragraph',
          value:
            'El punto que importa para el rendimiento: el valor fuera de la fila solo se busca y se descomprime cuando la consulta lo necesita. Una consulta que no referencia historico nunca toca la tabla TOAST. Una consulta que devuelve historico al cliente, filtra por una de sus claves o calcula algo sobre él paga la lectura de los chunks, la descompresión y, con jsonb, el valor entero, porque no existe lectura parcial de jsonb comprimido: para leer payload->>\'status\' de un documento de 380 KB, Postgres descomprime los 380 KB.',
        },
        {
          type: 'table',
          columns: ['Estrategia de STORAGE', 'Comprime', 'Va al TOAST', 'Por defecto en'],
          rows: [
            ['PLAIN', 'No', 'No', 'Tipos de tamaño fijo: integer, bigint, timestamptz'],
            ['MAIN', 'Sí', 'Solo como último recurso', 'numeric'],
            ['EXTERNAL', 'No', 'Sí', 'Ningún tipo; útil para text y bytea leídos con substring'],
            ['EXTENDED', 'Sí', 'Sí', 'text, varchar, jsonb, bytea'],
          ],
        },
        {
          type: 'list',
          items: [
            'SELECT * en una tabla con columna grande lee el TOAST de cada fila devuelta, aunque la pantalla use tres campos.',
            'Filtrar u ordenar por una clave dentro del jsonb descomprime el documento entero en cada fila evaluada.',
            'Un UPDATE que no toca la columna grande reutiliza el puntero: el valor en el TOAST no se vuelve a grabar.',
            'Un UPDATE que cambia cualquier parte del jsonb graba un valor nuevo entero en el TOAST y deja el anterior para el vacuum.',
          ],
        },
      ],
    },
    {
      title: 'Por qué el EXPLAIN ANALYZE dice 3 ms y la API tarda 2,8 s',
      blocks: [
        {
          type: 'paragraph',
          value:
            'EXPLAIN ANALYZE ejecuta la consulta, pero descarta las filas en lugar de enviarlas. Como los valores TOAST solo se buscan cuando alguien necesita el contenido, y aquí nadie lo necesita, el plan mide el acceso al índice y a la fila principal y se detiene ahí. La consulta parece perfecta. A partir de PostgreSQL 17, la opción SERIALIZE convierte cada fila al formato que se enviaría al cliente, lo que incluye buscar y descomprimir los valores TOAST, y muestra ese costo por separado.',
        },
        {
          type: 'code',
          value: explainCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'Los 186 ms de serialización son solo la parte de la base. Después vienen 19 MB atravesando la red, el driver node-postgres armando strings y llamando a JSON.parse en cada jsonb, todo en el hilo principal de Node. Con 30 agentes abriendo el listado al mismo tiempo, el event loop encola esos parses y el p95 llega a 2,8 s, mientras la base parece ociosa.',
        },
        {
          type: 'table',
          columns: ['Etapa por página de 50 filas', 'SELECT *', 'Columnas explícitas'],
          rows: [
            ['Ejecución en la base (índice y fila principal)', '3,1 ms', '3,1 ms'],
            ['Detoast y serialización', '186 ms, 611 páginas leídas del disco', '0,09 ms'],
            ['Bytes transferidos', '19 MB', '9 kB'],
            ['JSON.parse en Node, bloqueando el event loop', 'unos 150 ms', 'ninguno'],
            ['p95 de la API con 30 requests simultáneos', '2,8 s', '38 ms'],
          ],
        },
      ],
    },
    {
      title: 'Medir cuánto pesa cada columna',
      blocks: [
        {
          type: 'paragraph',
          value:
            'pg_relation_size de la tabla mide solo la fila principal. Para saber cuánto está fuera de ella hay que mirar reltoastrelid. Y para saber el peso por fila, pg_column_size devuelve el tamaño almacenado, ya comprimido, mientras que octet_length del valor convertido a texto muestra lo que de verdad viaja hasta la aplicación. La diferencia entre ambos es cuánto está escondiendo la compresión.',
        },
        {
          type: 'code',
          value: diagnoseCode(comments.es),
        },
        {
          type: 'list',
          items: [
            'Un TOAST mucho mayor que el heap es la señal de que existe una columna grande que merece revisión de lectura.',
            'Un promedio almacenado de 96 kB y 380 kB de texto significan que cada fila devuelta cuesta 380 kB de red y de parse.',
            'El máximo importa tanto como el promedio: una conversación de 2,9 MB en una página de listado ya rompe el presupuesto de memoria de un worker pequeño.',
            'pg_stats.avg_width no sirve aquí: para valores fuera de la fila mide el puntero, no el contenido.',
            'Alerte también sobre el tamaño del TOAST, no solo de la tabla: ahí estaba el crecimiento.',
          ],
        },
      ],
    },
    {
      title: 'Corregir la lectura: columnas explícitas, tabla propia y columnas derivadas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El hotfix del mismo día fue cambiar el SELECT * por una lista de columnas en el listado. Eso resolvió el p95, pero dejaba la trampa armada para la próxima consulta escrita con prisa o para el ORM que selecciona todos los campos por defecto. La corrección definitiva sacó el historial de la fila principal: los mensajes pasaron a ser filas de una tabla propia, y lo que el listado necesita, como último mensaje y total de mensajes, pasó a ser una columna pequeña mantenida en la escritura.',
        },
        {
          type: 'code',
          value: appCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'La migración no necesita ventana de mantenimiento. La tabla nueva se crea vacía, la aplicación pasa a grabar los mensajes nuevos solo en ella y la pantalla de detalle lee de las dos fuentes mientras el backfill no termina. El backfill avanza por rangos de id, y cada lote copia, suma al contador y anula historico en el mismo comando, lo que lo vuelve seguro para ejecutarlo de nuevo después de una falla.',
        },
        {
          type: 'code',
          value: migrationCode(comments.es),
        },
        {
          type: 'table',
          columns: ['Opción', 'Ganancia en la lectura', 'Costo', 'Cuándo usarla'],
          rows: [
            ['Lista explícita de columnas', 'Inmediata en las consultas corregidas', 'Disciplina en todo código nuevo; el ORM necesita select u omit', 'Siempre, como primer paso'],
            ['Tabla 1:1 para la columna grande', 'SELECT * vuelve a ser barato', 'Un join cuando se necesita el contenido', 'Documento grande leído rara vez y escrito entero'],
            ['Tabla 1:N en lugar de array jsonb', 'Lectura paginada del detalle', 'Migración de datos y más filas', 'Listas que crecen con el tiempo: mensajes, eventos, adjuntos'],
            ['Columna derivada mantenida en la escritura', 'Listado sin tocar el documento', 'El código de escritura debe mantener la columna', 'Campos que el listado muestra o filtra'],
            ['Columna generada STORED a partir del jsonb', 'Igual a la derivada, sin código en la aplicación', 'ADD COLUMN reescribe la tabla con lock exclusivo', 'Tablas pequeñas o creadas ya con la columna'],
          ],
        },
      ],
    },
    {
      title: 'La escritura también paga: un jsonb que crece con cada mensaje',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La segunda mitad del incidente era el WAL. Agregar un elemento a un array jsonb parece una operación pequeña, pero Postgres no modifica un valor TOAST en el lugar: lee el valor entero, lo descomprime, arma el documento nuevo, lo vuelve a comprimir, graba todos los chunks y marca los anteriores como muertos. En una conversación de 380 KB, un mensaje de 240 bytes generaba unos 100 kB de WAL, que además iban a las réplicas y al backup continuo.',
        },
        {
          type: 'code',
          value: writeCode(comments.es),
        },
        {
          type: 'list',
          items: [
            'El costo de escritura crece con el tamaño del documento, así que empeora justamente en las conversaciones más activas.',
            'Los chunks muertos hinchan la tabla TOAST y dependen del autovacuum, que se dispara con los contadores de la tabla TOAST, no de la principal.',
            'Dos escrituras concurrentes sobre el mismo documento compiten por la misma fila, y una espera a la otra el tiempo de reescribir 380 KB.',
            'Cambiar pglz por lz4 reduce el costo de CPU de la compresión y la descompresión, pero no cambia el hecho de que el valor entero se reescribe.',
            'SET STORAGE EXTERNAL solo compensa para text o bytea leídos por partes con substring; para jsonb, que se lee entero, solo ocupa más espacio.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La regla práctica que dejó el incidente: jsonb es excelente para un documento que se graba una vez y se lee una vez, como el payload original de un webhook o la configuración de una integración. Para algo que crece ítem por ítem, como mensajes, eventos o anotaciones, el modelo correcto es una fila por ítem. Y cualquier columna que pueda superar algunos kB queda fuera de las consultas de listado por defecto, no por excepción.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿SELECT * siempre es malo?',
      answer:
        'No. En una tabla solo con columnas pequeñas, el costo de traerlas todas es despreciable, y en consultas ad hoc es práctico. El problema aparece cuando la tabla gana una columna text, jsonb o bytea que puede superar algunos kB: desde ahí, todo SELECT * pasa a leer el TOAST de cada fila devuelta. En código de producción, la lista explícita de columnas protege la consulta de cambios futuros en el esquema, lo que vale más que el ahorro al escribir.',
    },
    {
      question: '¿Comprimir con lz4 resuelve la lentitud?',
      answer:
        'Ayuda con la CPU, porque lz4 comprime y descomprime mucho más rápido que pglz, pero no reduce el volumen que viaja hasta la aplicación ni el parse del JSON, que eran la mayor parte de los 2,8 s. Además, solo vale para valores grabados después del ALTER TABLE ... SET COMPRESSION lz4, y el servidor tiene que estar compilado con soporte para lz4. Es un ajuste complementario; la corrección es no leer la columna cuando no se necesita.',
    },
    {
      question: '¿Cómo descubro si mi ORM está trayendo columnas grandes?',
      answer:
        'Active el log de las consultas generadas en un ambiente de prueba y busque SELECT con todas las columnas de la tabla, o use EXPLAIN (ANALYZE, SERIALIZE) en PostgreSQL 17 con la consulta capturada para ver el output en kB. En las versiones recientes de Prisma, omit excluye campos por defecto; en TypeORM y Sequelize, select y attributes lo resuelven por consulta, y una columna marcada para no seleccionarse por defecto lo resuelve para todas.',
    },
  ],
  conclusion: {
    title: 'La columna que nadie muestra también tiene costo',
    description:
      'Una consulta que usa el índice correcto puede ser lenta porque trae datos que la pantalla no usa. El TOAST esconde el tamaño real de la tabla, el EXPLAIN ANALYZE no mide el detoast y el costo aparece en la red, en el parse y en el event loop de la aplicación. La corrección empieza con columnas explícitas en las consultas de listado y termina en el modelo: documentos grandes en su propia tabla, listas que crecen convertidas en filas y campos de listado mantenidos como columnas pequeñas. Si su aplicación se volvió lenta después de empezar a guardar payloads, transcripciones o historiales en la base, puedo revisar el modelo de datos, las consultas y la migración.',
    cta: 'Revisar el modelo de datos',
  },
  related: [
    {
      label: 'La columna JSON que se volvió un esquema escondido: cuándo el campo flexible empieza a necesitar índice, validación y migración',
      to: '/blog/coluna-json-que-virou-esquema-escondido-quando-o-campo-flexivel-passa-a-precisar-de-indice-validacao-e-migracao',
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
