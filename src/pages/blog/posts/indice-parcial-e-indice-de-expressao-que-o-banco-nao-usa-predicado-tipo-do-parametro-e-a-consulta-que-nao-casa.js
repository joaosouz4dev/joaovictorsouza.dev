// Conteudo do artigo: indice parcial e indice de expressao que o banco nao usa. Como o
// planejador prova que o WHERE da consulta implica o predicado do indice, por que parametro,
// now() e lista maior derrubam essa prova, por que a expressao precisa ser identica (inclusive
// no tipo) e como auditar e travar isso com um teste de plano na aplicacao Node.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const comments = {
  pt: {
    s1: 'A fila: 48 milhões de tarefas, 31 mil pendentes. O índice parcial tem 14 MB.',
    s2: 'Consulta original: o WHERE implica o predicado e o índice parcial entra no plano.',
    s3: "Depois do deploy: 'reprocessar' entrou no IN e não é coberto pelo predicado.",
    s4: 'Correção: o predicado do índice passa a cobrir os dois estados que o worker busca.',
    s5: 'PostgreSQL 16+: com $1 no lugar do literal, nenhum índice parcial de status serve.',
    e1: 'Índice de expressão criado para o relatório diário no horário de Brasília.',
    e2: 'Não casa: criado_em::date é outra expressão e ainda depende do TimeZone da sessão.',
    e3: 'Casa: a mesma expressão do índice, escrita do mesmo jeito.',
    e4: 'JSON: o índice guarda bigint, então a consulta precisa comparar bigint.',
    no: 'não usa: compara texto',
    noInt: 'não usa: integer não é bigint',
    yes: 'usa',
    e5: 'Tipo do parâmetro: numeric obriga a converter a coluna bigint e o índice da PK sai do plano.',
    a1: 'Os estados cobertos pelo predicado do índice ficam como literal no SQL, nunca como $1.',
    a2: 'São constantes do código, não entrada do usuário: não há risco de injeção.',
    a3: 'Lista os índices que o plano da consulta usa, com os parâmetros reais.',
    a4: 'enable_seqscan = off mede elegibilidade, não custo: numa base de teste pequena o seq scan venceria.',
    t1: 'Teste de contrato: quebra no CI se a consulta deixar de poder usar o índice parcial.',
    none: 'nenhum índice',
  },
  en: {
    s1: 'The queue: 48 million tasks, 31 thousand pending. The partial index is 14 MB.',
    s2: 'Original query: the WHERE implies the predicate and the partial index enters the plan.',
    s3: "After the deploy: 'reprocessar' joined the IN list and is not covered by the predicate.",
    s4: 'Fix: the index predicate now covers both states the worker looks for.',
    s5: 'PostgreSQL 16+: with $1 instead of the literal, no partial index on status qualifies.',
    e1: 'Expression index created for the daily report in São Paulo local time.',
    e2: 'No match: criado_em::date is another expression and also depends on the session TimeZone.',
    e3: 'Match: the same expression as the index, written the same way.',
    e4: 'JSON: the index stores bigint, so the query has to compare bigint.',
    no: 'not used: compares text',
    noInt: 'not used: integer is not bigint',
    yes: 'used',
    e5: 'Parameter type: numeric forces a cast on the bigint column and the PK index leaves the plan.',
    a1: 'The states covered by the index predicate stay as literals in the SQL, never as $1.',
    a2: 'They are code constants, not user input: there is no injection risk.',
    a3: 'Lists the indexes used by the query plan, with the real parameters.',
    a4: 'enable_seqscan = off measures eligibility, not cost: on a small test database the seq scan would win.',
    t1: 'Contract test: breaks in CI if the query can no longer use the partial index.',
    none: 'no index',
  },
  es: {
    s1: 'La cola: 48 millones de tareas, 31 mil pendientes. El índice parcial tiene 14 MB.',
    s2: 'Consulta original: el WHERE implica el predicado y el índice parcial entra en el plan.',
    s3: "Después del deploy: 'reprocessar' entró en el IN y no está cubierto por el predicado.",
    s4: 'Corrección: el predicado del índice pasa a cubrir los dos estados que busca el worker.',
    s5: 'PostgreSQL 16+: con $1 en lugar del literal, ningún índice parcial de status sirve.',
    e1: 'Índice de expresión creado para el reporte diario en horario de São Paulo.',
    e2: 'No coincide: criado_em::date es otra expresión y además depende del TimeZone de la sesión.',
    e3: 'Coincide: la misma expresión del índice, escrita de la misma forma.',
    e4: 'JSON: el índice guarda bigint, así que la consulta tiene que comparar bigint.',
    no: 'no lo usa: compara texto',
    noInt: 'no lo usa: integer no es bigint',
    yes: 'lo usa',
    e5: 'Tipo del parámetro: numeric obliga a convertir la columna bigint y el índice de la PK sale del plan.',
    a1: 'Los estados cubiertos por el predicado del índice quedan como literal en el SQL, nunca como $1.',
    a2: 'Son constantes del código, no entrada del usuario: no hay riesgo de inyección.',
    a3: 'Lista los índices que usa el plan de la consulta, con los parámetros reales.',
    a4: 'enable_seqscan = off mide elegibilidad, no costo: en una base de prueba pequeña el seq scan ganaría.',
    t1: 'Test de contrato: falla en el CI si la consulta deja de poder usar el índice parcial.',
    none: 'ningún índice',
  },
};

const partialCode = (c) => `-- ${c.s1}
CREATE INDEX CONCURRENTLY tarefas_pendentes_idx
    ON tarefas (agendada_para)
 WHERE status = 'pendente';

-- ${c.s2}
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM tarefas
 WHERE status = 'pendente' AND agendada_para <= now()
 ORDER BY agendada_para
 LIMIT 50
   FOR UPDATE SKIP LOCKED;

Limit  (actual time=0.071..0.412 rows=50 loops=1)
  ->  LockRows  (actual time=0.070..0.405 rows=50 loops=1)
        ->  Index Scan using tarefas_pendentes_idx on tarefas  (actual time=0.041..0.188 rows=50 loops=1)
              Index Cond: (agendada_para <= now())
              Buffers: shared hit=58
Execution Time: 0.447 ms

-- ${c.s3}
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM tarefas
 WHERE status IN ('pendente', 'reprocessar') AND agendada_para <= now()
 ORDER BY agendada_para
 LIMIT 50
   FOR UPDATE SKIP LOCKED;

Limit  (actual time=11204.388..11204.502 rows=50 loops=1)
  ->  LockRows  (actual time=11204.386..11204.494 rows=50 loops=1)
        ->  Sort  (actual time=11204.311..11204.330 rows=50 loops=1)
              Sort Key: agendada_para
              Sort Method: top-N heapsort  Memory: 31kB
              ->  Seq Scan on tarefas  (actual time=0.022..11187.604 rows=31877 loops=1)
                    Filter: ((status = ANY ('{pendente,reprocessar}'::text[])) AND (agendada_para <= now()))
                    Rows Removed by Filter: 47968123
                    Buffers: shared hit=402118 read=2468305
Execution Time: 11204.611 ms

-- ${c.s4}
CREATE INDEX CONCURRENTLY tarefas_a_processar_idx
    ON tarefas (agendada_para)
 WHERE status IN ('pendente', 'reprocessar');
DROP INDEX CONCURRENTLY tarefas_pendentes_idx;

-- ${c.s5}
EXPLAIN (GENERIC_PLAN)
SELECT id FROM tarefas
 WHERE status = $1 AND agendada_para <= now()
 ORDER BY agendada_para
 LIMIT 50;

Limit  (cost=3812744.18..3812744.30 rows=50 width=14)
  ->  Sort  (cost=3812744.18..3836697.43 rows=9581302 width=14)
        Sort Key: agendada_para
        ->  Seq Scan on tarefas  (cost=0.00..3494469.00 rows=9581302 width=14)
              Filter: ((status = $1) AND (agendada_para <= now()))`;

const expressionCode = (c) => `-- ${c.e1}
CREATE INDEX CONCURRENTLY pedidos_dia_local_idx
    ON pedidos (((criado_em AT TIME ZONE 'America/Sao_Paulo')::date));

-- ${c.e2}
SELECT count(*) FROM pedidos
 WHERE criado_em::date = '2026-11-17';

-- ${c.e3}
SELECT count(*) FROM pedidos
 WHERE (criado_em AT TIME ZONE 'America/Sao_Paulo')::date = '2026-11-17';

-- ${c.e4}
CREATE INDEX CONCURRENTLY eventos_cliente_idx
    ON eventos (((payload->>'cliente_id')::bigint));

SELECT * FROM eventos WHERE payload->>'cliente_id' = '4821';         -- ${c.no}
SELECT * FROM eventos WHERE (payload->>'cliente_id')::int = 4821;    -- ${c.noInt}
SELECT * FROM eventos WHERE (payload->>'cliente_id')::bigint = 4821; -- ${c.yes}

-- ${c.e5}
EXPLAIN SELECT * FROM pedidos WHERE id = 90210::numeric;

Seq Scan on pedidos  (cost=0.00..1015416.00 rows=150000 width=96)
  Filter: ((id)::numeric = '90210'::numeric)

EXPLAIN SELECT * FROM pedidos WHERE id = 90210::bigint;

Index Scan using pedidos_pkey on pedidos  (cost=0.56..8.58 rows=1 width=96)
  Index Cond: (id = '90210'::bigint)`;

const auditCode = `SELECT s.relname                                   AS tabela,
       s.indexrelname                              AS indice,
       s.idx_scan,
       s.last_idx_scan,                            -- PostgreSQL 16+
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS tamanho,
       pg_get_indexdef(s.indexrelid)               AS definicao
  FROM pg_stat_user_indexes s
  JOIN pg_index i ON i.indexrelid = s.indexrelid
 WHERE i.indpred IS NOT NULL      -- parcial
    OR i.indexprs IS NOT NULL     -- de expressão
 ORDER BY s.idx_scan, pg_relation_size(s.indexrelid) DESC;`;

const appCode = (c) => `// fila-repositorio.js
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

// ${c.a1}
// ${c.a2}
export const SQL_RESERVAR_TAREFAS = \`
  SELECT id, tipo, payload
    FROM tarefas
   WHERE status IN ('pendente', 'reprocessar')
     AND agendada_para <= now()
   ORDER BY agendada_para
   LIMIT $1
     FOR UPDATE SKIP LOCKED\`;

export async function reservarTarefas(client, limite = 50) {
  const { rows } = await client.query(SQL_RESERVAR_TAREFAS, [limite]);
  return rows;
}

// ${c.a3}
// ${c.a4}
export async function indicesDoPlano(client, sql, params = []) {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL enable_seqscan = off');
    const { rows } = await client.query(\`EXPLAIN (FORMAT JSON) \${sql}\`, params);
    const indices = new Set();
    const visitar = (no) => {
      if (no['Index Name']) indices.add(no['Index Name']);
      (no.Plans || []).forEach(visitar);
    };
    visitar(rows[0]['QUERY PLAN'][0].Plan);
    return [...indices];
  } finally {
    await client.query('ROLLBACK');
  }
}

// fila-repositorio.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, SQL_RESERVAR_TAREFAS, indicesDoPlano } from './fila-repositorio.js';

after(() => pool.end());

// ${c.t1}
test('reserva de tarefas usa tarefas_a_processar_idx', async () => {
  const client = await pool.connect();
  try {
    const indices = await indicesDoPlano(client, SQL_RESERVAR_TAREFAS, [50]);
    assert.ok(
      indices.includes('tarefas_a_processar_idx'),
      \`plano usou: \${indices.join(', ') || '${c.none}'}\`,
    );
  } finally {
    client.release();
  }
});`;

const diagramaPt = `D0 15:10  deploy: tarefas que falharam por timeout voltam para a fila com status 'reprocessar'
          o worker passa a buscar status IN ('pendente', 'reprocessar')
D0 15:12  consulta de reserva: de 0,4 ms para 11,2 s; leitura de disco do banco em 100%
D0 15:30  fila acumula 180 mil tarefas; escalar workers de 4 para 12 só piora a leitura
D0 16:05  rollback do deploy: a reserva volta a 0,4 ms em segundos
D1 10:00  EXPLAIN mostra Seq Scan com 47,9 milhões de linhas removidas pelo filtro
D1 10:40  tarefas_pendentes_idx não cobre 'reprocessar'; índice novo com os dois estados
D1 11:20  deploy refeito: reserva em 0,5 ms e idx_scan do índice novo subindo`;

const diagramaEn = `D0 15:10  deploy: tasks that failed with a timeout go back to the queue with status 'reprocessar'
          the worker now looks for status IN ('pendente', 'reprocessar')
D0 15:12  claim query: from 0.4 ms to 11.2 s; database disk reads at 100%
D0 15:30  queue piles up 180 thousand tasks; scaling workers from 4 to 12 only makes reads worse
D0 16:05  deploy rollback: the claim is back to 0.4 ms within seconds
D1 10:00  EXPLAIN shows a Seq Scan with 47.9 million rows removed by the filter
D1 10:40  tarefas_pendentes_idx does not cover 'reprocessar'; new index with both states
D1 11:20  deploy again: claim at 0.5 ms and idx_scan of the new index going up`;

const diagramaEs = `D0 15:10  deploy: las tareas que fallaron por timeout vuelven a la cola con status 'reprocessar'
          el worker pasa a buscar status IN ('pendente', 'reprocessar')
D0 15:12  consulta de reserva: de 0,4 ms a 11,2 s; lectura de disco de la base al 100%
D0 15:30  la cola acumula 180 mil tareas; escalar workers de 4 a 12 solo empeora la lectura
D0 16:05  rollback del deploy: la reserva vuelve a 0,4 ms en segundos
D1 10:00  EXPLAIN muestra un Seq Scan con 47,9 millones de filas removidas por el filtro
D1 10:40  tarefas_pendentes_idx no cubre 'reprocessar'; índice nuevo con los dos estados
D1 11:20  deploy de nuevo: reserva en 0,5 ms e idx_scan del índice nuevo subiendo`;

const pt = {
  intro:
    "Um sistema de cobrança processava suas tarefas assíncronas numa tabela de 48 milhões de linhas, das quais só 31 mil estavam pendentes em qualquer momento. Um índice parcial de 14 MB, com WHERE status = 'pendente', deixava a consulta de reserva dos workers em 0,4 ms. Um deploy simples, que fez tarefas com timeout voltarem para a fila com um novo status, 'reprocessar', trocou o filtro do worker para status IN ('pendente', 'reprocessar'). A consulta passou para 11,2 segundos, o disco do banco saturou e a fila acumulou 180 mil tarefas em vinte minutos. O índice continuava lá, válido e atualizado; o planejador só não conseguia provar que ele servia para a consulta nova. Índices parciais e índices de expressão são das ferramentas mais eficientes do Postgres, mas funcionam por um contrato estrito: o WHERE precisa implicar o predicado do índice, e a expressão da consulta precisa ser a mesma do índice, inclusive no tipo. Este artigo mostra como o planejador faz essa verificação, quais mudanças pequenas a quebram (um valor a mais no IN, um parâmetro no lugar do literal, um now(), um cast diferente) e como auditar e travar isso com um teste de plano na aplicação.",
  sections: [
    {
      title: 'O worker que passou a varrer 48 milhões de linhas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A tabela tarefas guardava todo o histórico: 99,9% das linhas estavam concluídas e nunca mais seriam lidas pelo worker. Por isso o índice era parcial. Um índice comum em (status, agendada_para) teria 1,9 GB e seria atualizado em toda escrita; o parcial tinha 14 MB, cabia inteiro em memória e só era tocado pelas linhas que entravam ou saíam do estado pendente.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'O diagnóstico demorou porque nada parecia quebrado. Não havia erro, o índice aparecia no \\d da tabela, o pg_stat_user_indexes mostrava idx_scan crescendo até as 15:10 e parando, e a consulta nova era só uma versão um pouco mais larga da antiga. O sintoma mais enganoso foi a reação ao escalonamento: mais workers significaram mais varreduras sequenciais simultâneas de 22 GB, e o banco ficou mais lento para todo o resto. Com FOR UPDATE na consulta, o Postgres nem pode usar varredura paralela, então cada reserva era um único processo lendo a tabela inteira.',
        },
      ],
    },
    {
      title: 'Como o planejador decide que um índice parcial serve',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um índice parcial só contém as linhas que satisfazem o predicado. Para usá-lo, o planejador precisa ter certeza de que nenhuma linha que a consulta quer ficou de fora, ou seja, que o WHERE da consulta implica logicamente o predicado do índice. Essa prova é feita no planejamento, antes de qualquer dado ser lido, e é deliberadamente conservadora: se não der para provar, o índice é descartado, mesmo que na prática todos os dados estejam lá.',
        },
        {
          type: 'ordered',
          items: [
            'O planejador separa o WHERE da consulta em condições combinadas por AND e tenta mostrar que elas, juntas, implicam cada parte do predicado do índice.',
            'Condições idênticas ao predicado provam na hora, depois da normalização: arquivada = false vira NOT arquivada, x IN (a) vira x = a.',
            "Comparações com constantes entram em regras de operadores B-tree: status = 'pendente' implica status IN ('pendente', 'reprocessar'), e agendada_para > '2026-06-01' implica agendada_para > '2026-01-01'.",
            'O que não é constante no momento do planejamento não prova nada: parâmetros de um plano genérico, now(), current_date e qualquer função que não seja IMMUTABLE.',
            'Se alguma parte do predicado não for provada, o índice parcial nem entra na lista de caminhos possíveis. Não é uma questão de custo: ele simplesmente não aparece.',
          ],
        },
        {
          type: 'code',
          value: partialCode(comments.pt),
        },
        {
          type: 'table',
          columns: ['Predicado do índice', 'Condição na consulta', 'O índice pode ser usado?'],
          rows: [
            ["status = 'pendente'", "status = 'pendente'", 'Sim, condição idêntica'],
            ["status IN ('pendente', 'reprocessar')", "status = 'pendente'", 'Sim, o valor está na lista'],
            ["status = 'pendente'", "status IN ('pendente', 'reprocessar')", "Não, 'reprocessar' fica fora do índice"],
            ["status = 'pendente'", 'status = $1 (plano genérico)', 'Não, o valor é desconhecido no planejamento'],
            ["agendada_para > '2026-01-01'", "agendada_para > '2026-06-01'", 'Sim, a faixa está contida'],
            ["agendada_para > '2026-01-01'", "agendada_para > now() - interval '1 day'", 'Não, now() não é constante no planejamento'],
            ['NOT arquivada', 'arquivada = false', 'Sim, o planejador normaliza para NOT arquivada'],
          ],
        },
        {
          type: 'paragraph',
          value:
            "A terceira linha é o incidente. A consulta pede um conjunto maior do que o índice guarda, e o planejador está certo em recusar: o índice não tem as tarefas em 'reprocessar'. A correção foi criar o índice com o predicado da consulta nova antes de subir o código, e só então remover o antigo. As duas operações com CONCURRENTLY, para não bloquear escrita numa tabela que recebe 300 inserções por segundo.",
        },
      ],
    },
    {
      title: 'Parâmetro no lugar do literal: o plano genérico não prova nada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A mesma regra tem uma consequência menos óbvia. Se o valor que casa com o predicado chega como parâmetro, status = $1, o índice parcial só pode ser usado quando o plano é montado com o valor real. Em consultas não preparadas e nos planos custom de prepared statements, o Postgres substitui $1 pelo valor antes de planejar e a prova funciona. No plano genérico, $1 continua desconhecido, e nenhum índice com predicado sobre status é elegível. O EXPLAIN (GENERIC_PLAN), disponível a partir do PostgreSQL 16, mostra isso sem precisar preparar nada: o plano cai em varredura sequencial e ordenação de 9,5 milhões de linhas estimadas.',
        },
        {
          type: 'paragraph',
          value:
            'No modo padrão de plan_cache_mode, isso costuma se esconder: como o plano genérico sem o índice parcial fica muito mais caro que os planos custom, o Postgres continua montando plano custom a cada execução. O problema aparece quando alguém força plano genérico para economizar planejamento, quando um pooler ou driver é configurado com force_generic_plan para toda a aplicação, ou em funções PL/pgSQL e statements preparados em que o genérico vence por outros motivos. Nesses casos, a consulta passa a ignorar o índice parcial sem nenhuma mudança no código SQL.',
        },
        {
          type: 'list',
          items: [
            'Valores que definem a fatia lógica do índice (estado da fila, tipo de registro, flag de exclusão) devem ficar como literal no SQL. São constantes do código, não entrada do usuário, então escrevê-los no texto não abre brecha para injeção.',
            'Parâmetros continuam no resto da consulta: limite, intervalo de datas, identificadores. Esses não fazem parte do predicado do índice.',
            'Se o mesmo código atende vários estados vindos de fora, prefira consultas distintas por estado, cada uma com seu literal, a uma única consulta com status = $1.',
            'Query builders e ORMs que parametrizam tudo automaticamente precisam de um escape para literal, como sql.raw ou equivalente, usado só para essas constantes.',
          ],
        },
      ],
    },
    {
      title: 'Índice de expressão: a consulta precisa repetir a mesma expressão',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Índices de expressão têm um contrato parecido, mas a verificação é ainda mais literal. O planejador compara a expressão da consulta com a expressão guardada no índice depois de normalizar as duas, e só usa o índice se forem estruturalmente iguais: mesmas funções, mesmos argumentos, mesmos casts. Ele não sabe que duas expressões diferentes produzem o mesmo valor, e não reescreve a consulta para caber no índice.',
        },
        {
          type: 'code',
          value: expressionCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            "O caso da data é comum. criado_em::date sobre uma coluna timestamptz não pode ser indexado, porque o resultado depende do TimeZone da sessão e a função não é IMMUTABLE. A equipe então cria o índice com AT TIME ZONE 'America/Sao_Paulo', que é estável, mas a consulta antiga continua com ::date e varre a tabela. Muitas vezes a melhor correção nem é o índice de expressão: um intervalo sobre a própria coluna, criado_em >= '2026-11-17 00:00-03' AND criado_em < '2026-11-18 00:00-03', usa o índice comum de criado_em e não depende do fuso da sessão.",
        },
        {
          type: 'table',
          columns: ['Expressão no índice', 'Expressão na consulta', 'Resultado'],
          rows: [
            ['lower(email)', 'lower(email) = $1', 'Usa o índice'],
            ['lower(email)', 'email ILIKE $1', 'Não usa: outra operação'],
            ["((payload->>'cliente_id')::bigint)", "payload->>'cliente_id' = '4821'", 'Não usa: compara texto'],
            ["((payload->>'cliente_id')::bigint)", "(payload->>'cliente_id')::int = 4821", 'Não usa: o cast é para integer'],
            ["((criado_em AT TIME ZONE 'America/Sao_Paulo')::date)", 'criado_em::date = $1', 'Não usa: expressão diferente'],
          ],
        },
      ],
    },
    {
      title: 'O tipo do parâmetro que faz até o índice comum sumir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O mesmo mecanismo afeta índices simples quando o tipo do valor comparado não é o da coluna. Para usar um índice B-tree, o operador da comparação precisa pertencer à família de operadores do índice com a coluna do lado esquerdo sem conversão. bigint comparado com integer ou smallint tem operadores cruzados na mesma família, e o índice funciona. bigint comparado com numeric não tem: o Postgres converte a coluna para numeric, a condição vira (id)::numeric = valor e o índice da chave primária deixa de ser elegível.',
        },
        {
          type: 'table',
          columns: ['Origem do valor', 'Tipo que chega ao servidor', 'Efeito em id bigint = $1'],
          rows: [
            ['node-postgres (pg) com number ou string', 'unknown, inferido pela coluna', 'bigint, usa o índice'],
            ['SQL gerado com $1::numeric ou literal 90210.0', 'numeric', 'Converte a coluna, ignora o índice'],
            ['JDBC setLong', 'int8', 'Usa o índice'],
            ['JDBC setBigDecimal', 'numeric', 'Converte a coluna, ignora o índice'],
            ['Coluna char(n) comparada com parâmetro text', 'text', 'Converte a coluna, ignora o índice'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O node-postgres envia parâmetros sem tipo e deixa o servidor inferir pelo contexto, o que evita a maioria desses casos. O risco aparece em casts explícitos escritos para "fazer a consulta passar", em camadas que declaram o tipo do parâmetro e em serviços de outras linguagens que acessam a mesma tabela. O sintoma no EXPLAIN é sempre o mesmo: um cast aplicado sobre a coluna dentro de Filter, em vez de Index Cond.',
        },
      ],
    },
    {
      title: 'Encontrar os índices que existem mas não trabalham',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Índices parciais e de expressão quebram em silêncio, então vale procurar por eles de propósito. A consulta abaixo lista apenas os índices com predicado ou expressão, ordenados pelos menos usados. Um idx_scan parado, ou um last_idx_scan antigo, num índice que foi criado para uma consulta frequente é o sinal de que a consulta mudou e o índice ficou para trás.',
        },
        {
          type: 'code',
          value: auditCode,
        },
        {
          type: 'ordered',
          items: [
            'Para cada índice suspeito, encontre no pg_stat_statements a consulta que deveria usá-lo, pelo texto ou pela tabela.',
            'Rode EXPLAIN com valores reais e procure Filter onde deveria haver Index Cond, ou Seq Scan onde deveria aparecer o índice.',
            'Compare o WHERE com pg_get_indexdef: valor fora do predicado, parâmetro no lugar do literal, now() na faixa, expressão ou cast diferente.',
            'Se o índice não serve para nenhuma consulta atual, remova com DROP INDEX CONCURRENTLY depois de conferir nas réplicas, porque as estatísticas de uso são por servidor.',
          ],
        },
      ],
    },
    {
      title: 'Corrigir e impedir que volte: literal no SQL e teste de plano',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A correção do incidente teve duas partes. No banco, o índice novo com o predicado que a consulta realmente usa. Na aplicação, um teste de contrato que roda no CI contra um banco com o mesmo esquema e quebra se a consulta deixar de poder usar o índice esperado. O teste desliga o seq scan só dentro da transação: o objetivo não é medir custo, que numa base de teste pequena sempre favorece a varredura, e sim garantir que o índice continua elegível.',
        },
        {
          type: 'code',
          value: appCode(comments.pt),
        },
        {
          type: 'list',
          items: [
            'Crie o índice novo antes do deploy que muda a consulta, nunca depois. CREATE INDEX CONCURRENTLY não bloqueia escrita, mas leva tempo numa tabela grande.',
            'Trate o predicado do índice e o WHERE da consulta como um contrato: quem muda um precisa mudar o outro no mesmo pull request.',
            "Prefira predicados com lista explícita, status IN ('pendente', 'reprocessar'), a negações como status <> 'concluida', que incluem qualquer estado novo e fazem o índice crescer sem ninguém perceber.",
            'Mantenha o auto_explain registrando planos acima de algumas centenas de milissegundos nas consultas da fila: a troca de Index Scan por Seq Scan aparece no log antes de virar incidente.',
          ],
        },
        {
          type: 'paragraph',
          value:
            "Com o índice tarefas_a_processar_idx no lugar, a reserva voltou a 0,5 ms, o índice ficou em 15 MB e a fila de 180 mil tarefas foi drenada em onze minutos pelos quatro workers originais. Duas semanas depois, o teste de plano pegou um pull request que adicionava o estado 'agendada_manual' ao IN sem mexer no índice.",
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que o Postgres não usa o índice parcial se todas as linhas que eu quero estão nele?',
      answer:
        'Porque ele precisa provar isso no planejamento, só com o texto da consulta e o predicado do índice, sem olhar os dados. Se o WHERE não implica o predicado por regras que o planejador conhece, como valores constantes contidos na lista ou faixas contidas na faixa do índice, o índice é descartado. Usar um índice parcial sem essa prova poderia devolver um resultado incompleto, e o Postgres prefere ser lento a ser errado.',
    },
    {
      question: 'Posso usar now() ou current_date no predicado de um índice parcial?',
      answer:
        "Não. Funções em predicados e expressões de índice precisam ser IMMUTABLE, e now() muda a cada transação. A alternativa é um predicado com data fixa, como agendada_para > '2026-01-01', recriado periodicamente, ou um predicado sobre estado em vez de tempo. E mesmo com predicado fixo, uma consulta com agendada_para > now() - interval '1 day' não prova a implicação, porque now() não é constante no planejamento: a consulta precisa repetir a condição do índice de forma literal para usá-lo.",
    },
    {
      question: 'Como saber se o problema é o predicado, a expressão ou o tipo do parâmetro?',
      answer:
        'O EXPLAIN com os valores reais mostra. Se a condição aparece em Filter com um cast sobre a coluna, como (id)::numeric, o problema é tipo. Se a expressão aparece em Filter escrita de um jeito diferente da do índice, é expressão. Se o índice parcial simplesmente não aparece e a condição está correta, compare o WHERE com o pg_get_indexdef do índice: quase sempre há um valor fora do predicado, um parâmetro ou um now() onde o índice espera um literal.',
    },
  ],
  conclusion: {
    title: 'O índice certo só funciona com a consulta que casa com ele',
    description:
      'Índices parciais e de expressão economizam espaço, escrita e memória, mas dependem de uma prova feita no planejamento: o WHERE precisa implicar o predicado, a expressão precisa ser a mesma e o tipo do valor não pode forçar um cast na coluna. Um valor a mais no IN, um parâmetro no lugar do literal ou um cast diferente quebram essa prova sem erro e sem aviso, e a consulta volta a varrer a tabela inteira. Tratar índice e consulta como um contrato, auditar os índices que pararam de ser usados e travar o plano com um teste no CI evita que isso apareça como incidente. Se o seu sistema tem consultas que ficaram lentas depois de mudanças pequenas, ou índices que existem mas não aparecem nos planos, eu posso revisar o esquema, as consultas e a estratégia de indexação.',
    cta: 'Revisar índices e consultas',
  },
  related: [
    {
      label: 'Índice que o banco decidiu ignorar: quando o plano de consulta muda sozinho',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Prepared statement que fica lento na sexta execução: plano genérico, plan_cache_mode e parâmetros desiguais',
      to: '/blog/prepared-statement-que-fica-lento-na-sexta-execucao-plano-generico-plan-cache-mode-e-parametros-desiguais',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    "A billing system processed its asynchronous tasks in a 48 million row table, of which only 31 thousand were pending at any given time. A 14 MB partial index, with WHERE status = 'pendente', kept the worker claim query at 0.4 ms. A simple deploy, which made tasks that timed out return to the queue with a new status, 'reprocessar', changed the worker filter to status IN ('pendente', 'reprocessar'). The query went to 11.2 seconds, the database disk saturated and the queue piled up 180 thousand tasks in twenty minutes. The index was still there, valid and up to date; the planner just could not prove it was usable for the new query. Partial indexes and expression indexes are among the most efficient tools in Postgres, but they work under a strict contract: the WHERE must imply the index predicate, and the query expression must be the same as the index expression, type included. This article shows how the planner performs that check, which small changes break it (one more value in the IN list, a parameter instead of a literal, a now(), a different cast) and how to audit it and lock it in with a plan test in the application.",
  sections: [
    {
      title: 'The worker that started scanning 48 million rows',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The tarefas table kept the entire history: 99.9% of the rows were completed and would never be read by the worker again. That is why the index was partial. A regular index on (status, agendada_para) would take 1.9 GB and be updated on every write; the partial one took 14 MB, fit entirely in memory and was only touched by rows entering or leaving the pending state.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'The diagnosis took a while because nothing looked broken. There was no error, the index showed up in the \\d output of the table, pg_stat_user_indexes showed idx_scan growing until 15:10 and then stopping, and the new query was just a slightly wider version of the old one. The most misleading symptom was the reaction to scaling: more workers meant more simultaneous 22 GB sequential scans, and the database got slower for everything else. With FOR UPDATE in the query, Postgres cannot even use a parallel scan, so each claim was a single process reading the whole table.',
        },
      ],
    },
    {
      title: 'How the planner decides that a partial index qualifies',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A partial index only contains the rows that satisfy its predicate. To use it, the planner must be certain that no row the query wants was left out, that is, that the query WHERE logically implies the index predicate. That proof happens at planning time, before any data is read, and it is deliberately conservative: if it cannot be proven, the index is discarded, even if in practice all the data is there.',
        },
        {
          type: 'ordered',
          items: [
            'The planner splits the query WHERE into conditions combined with AND and tries to show that, together, they imply each part of the index predicate.',
            'Conditions identical to the predicate prove it immediately, after normalization: arquivada = false becomes NOT arquivada, x IN (a) becomes x = a.',
            "Comparisons with constants go through B-tree operator rules: status = 'pendente' implies status IN ('pendente', 'reprocessar'), and agendada_para > '2026-06-01' implies agendada_para > '2026-01-01'.",
            'Anything that is not constant at planning time proves nothing: parameters of a generic plan, now(), current_date and any function that is not IMMUTABLE.',
            'If any part of the predicate is not proven, the partial index does not even enter the list of possible paths. It is not a cost decision: it simply does not show up.',
          ],
        },
        {
          type: 'code',
          value: partialCode(comments.en),
        },
        {
          type: 'table',
          columns: ['Index predicate', 'Condition in the query', 'Can the index be used?'],
          rows: [
            ["status = 'pendente'", "status = 'pendente'", 'Yes, identical condition'],
            ["status IN ('pendente', 'reprocessar')", "status = 'pendente'", 'Yes, the value is in the list'],
            ["status = 'pendente'", "status IN ('pendente', 'reprocessar')", "No, 'reprocessar' is not in the index"],
            ["status = 'pendente'", 'status = $1 (generic plan)', 'No, the value is unknown at planning time'],
            ["agendada_para > '2026-01-01'", "agendada_para > '2026-06-01'", 'Yes, the range is contained'],
            ["agendada_para > '2026-01-01'", "agendada_para > now() - interval '1 day'", 'No, now() is not constant at planning time'],
            ['NOT arquivada', 'arquivada = false', 'Yes, the planner normalizes it to NOT arquivada'],
          ],
        },
        {
          type: 'paragraph',
          value:
            "The third row is the incident. The query asks for a larger set than the index holds, and the planner is right to refuse: the index does not have the tasks in 'reprocessar'. The fix was to create the index with the new query predicate before shipping the code, and only then drop the old one. Both operations with CONCURRENTLY, so writes are not blocked on a table receiving 300 inserts per second.",
        },
      ],
    },
    {
      title: 'A parameter instead of the literal: the generic plan proves nothing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The same rule has a less obvious consequence. If the value that matches the predicate arrives as a parameter, status = $1, the partial index can only be used when the plan is built with the real value. In non-prepared queries and in custom plans of prepared statements, Postgres replaces $1 with the value before planning and the proof works. In the generic plan, $1 stays unknown, and no index with a predicate on status is eligible. EXPLAIN (GENERIC_PLAN), available since PostgreSQL 16, shows this without preparing anything: the plan falls back to a sequential scan and a sort of 9.5 million estimated rows.',
        },
        {
          type: 'paragraph',
          value:
            'With the default plan_cache_mode, this usually stays hidden: since the generic plan without the partial index is much more expensive than the custom plans, Postgres keeps building a custom plan on every execution. The problem shows up when someone forces a generic plan to save planning time, when a pooler or driver is configured with force_generic_plan for the whole application, or in PL/pgSQL functions and prepared statements where the generic plan wins for other reasons. In those cases, the query starts ignoring the partial index without any change to the SQL.',
        },
        {
          type: 'list',
          items: [
            'Values that define the logical slice of the index (queue state, record type, deletion flag) should stay as literals in the SQL. They are code constants, not user input, so writing them in the text does not open the door to injection.',
            'Parameters remain in the rest of the query: limit, date range, identifiers. Those are not part of the index predicate.',
            'If the same code handles several states coming from outside, prefer separate queries per state, each with its literal, over a single query with status = $1.',
            'Query builders and ORMs that parameterize everything automatically need an escape hatch for literals, such as sql.raw or an equivalent, used only for these constants.',
          ],
        },
      ],
    },
    {
      title: 'Expression index: the query has to repeat the same expression',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Expression indexes have a similar contract, but the check is even more literal. The planner compares the query expression with the expression stored in the index after normalizing both, and only uses the index if they are structurally equal: same functions, same arguments, same casts. It does not know that two different expressions produce the same value, and it does not rewrite the query to fit the index.',
        },
        {
          type: 'code',
          value: expressionCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            "The date case is common. criado_em::date over a timestamptz column cannot be indexed, because the result depends on the session TimeZone and the function is not IMMUTABLE. The team then creates the index with AT TIME ZONE 'America/Sao_Paulo', which is stable, but the old query still uses ::date and scans the table. Often the best fix is not even the expression index: a range over the column itself, criado_em >= '2026-11-17 00:00-03' AND criado_em < '2026-11-18 00:00-03', uses the regular index on criado_em and does not depend on the session time zone.",
        },
        {
          type: 'table',
          columns: ['Expression in the index', 'Expression in the query', 'Result'],
          rows: [
            ['lower(email)', 'lower(email) = $1', 'Uses the index'],
            ['lower(email)', 'email ILIKE $1', 'Not used: different operation'],
            ["((payload->>'cliente_id')::bigint)", "payload->>'cliente_id' = '4821'", 'Not used: compares text'],
            ["((payload->>'cliente_id')::bigint)", "(payload->>'cliente_id')::int = 4821", 'Not used: the cast is to integer'],
            ["((criado_em AT TIME ZONE 'America/Sao_Paulo')::date)", 'criado_em::date = $1', 'Not used: different expression'],
          ],
        },
      ],
    },
    {
      title: 'The parameter type that makes even a regular index disappear',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The same mechanism affects plain indexes when the type of the compared value is not the column type. To use a B-tree index, the comparison operator must belong to the index operator family with the column on the left side and no conversion. bigint compared with integer or smallint has cross-type operators in the same family, and the index works. bigint compared with numeric does not: Postgres converts the column to numeric, the condition becomes (id)::numeric = value and the primary key index is no longer eligible.',
        },
        {
          type: 'table',
          columns: ['Where the value comes from', 'Type that reaches the server', 'Effect on id bigint = $1'],
          rows: [
            ['node-postgres (pg) with number or string', 'unknown, inferred from the column', 'bigint, uses the index'],
            ['SQL generated with $1::numeric or literal 90210.0', 'numeric', 'Casts the column, ignores the index'],
            ['JDBC setLong', 'int8', 'Uses the index'],
            ['JDBC setBigDecimal', 'numeric', 'Casts the column, ignores the index'],
            ['char(n) column compared with a text parameter', 'text', 'Casts the column, ignores the index'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'node-postgres sends parameters untyped and lets the server infer the type from context, which avoids most of these cases. The risk shows up in explicit casts written to "make the query work", in layers that declare the parameter type and in services written in other languages that access the same table. The symptom in EXPLAIN is always the same: a cast applied to the column inside Filter, instead of Index Cond.',
        },
      ],
    },
    {
      title: 'Finding the indexes that exist but do not work',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Partial and expression indexes break silently, so it is worth looking for them on purpose. The query below lists only indexes with a predicate or an expression, starting with the least used. A stalled idx_scan, or an old last_idx_scan, on an index that was created for a frequent query is the sign that the query changed and the index was left behind.',
        },
        {
          type: 'code',
          value: auditCode,
        },
        {
          type: 'ordered',
          items: [
            'For each suspicious index, find in pg_stat_statements the query that should use it, by text or by table.',
            'Run EXPLAIN with real values and look for Filter where there should be Index Cond, or a Seq Scan where the index should be.',
            'Compare the WHERE with pg_get_indexdef: a value outside the predicate, a parameter instead of a literal, now() in the range, a different expression or cast.',
            'If the index serves no current query, drop it with DROP INDEX CONCURRENTLY after checking the replicas, because usage statistics are per server.',
          ],
        },
      ],
    },
    {
      title: 'Fix it and keep it from coming back: literal in the SQL and a plan test',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The incident fix had two parts. In the database, the new index with the predicate the query actually uses. In the application, a contract test that runs in CI against a database with the same schema and fails if the query can no longer use the expected index. The test disables seq scan only inside the transaction: the goal is not to measure cost, which on a small test database always favors the scan, but to guarantee that the index is still eligible.',
        },
        {
          type: 'code',
          value: appCode(comments.en),
        },
        {
          type: 'list',
          items: [
            'Create the new index before the deploy that changes the query, never after. CREATE INDEX CONCURRENTLY does not block writes, but it takes time on a large table.',
            'Treat the index predicate and the query WHERE as a contract: whoever changes one has to change the other in the same pull request.',
            "Prefer predicates with an explicit list, status IN ('pendente', 'reprocessar'), over negations such as status <> 'concluida', which include any new state and make the index grow without anyone noticing.",
            'Keep auto_explain logging plans above a few hundred milliseconds for the queue queries: the switch from Index Scan to Seq Scan shows up in the log before it becomes an incident.',
          ],
        },
        {
          type: 'paragraph',
          value:
            "With the tarefas_a_processar_idx index in place, the claim went back to 0.5 ms, the index stayed at 15 MB and the 180 thousand task backlog was drained in eleven minutes by the original four workers. Two weeks later, the plan test caught a pull request that added the 'agendada_manual' state to the IN list without touching the index.",
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why does Postgres not use the partial index if all the rows I want are in it?',
      answer:
        'Because it has to prove that at planning time, using only the query text and the index predicate, without looking at the data. If the WHERE does not imply the predicate through rules the planner knows, such as constant values contained in the list or ranges contained in the index range, the index is discarded. Using a partial index without that proof could return an incomplete result, and Postgres prefers being slow to being wrong.',
    },
    {
      question: 'Can I use now() or current_date in a partial index predicate?',
      answer:
        "No. Functions in index predicates and expressions must be IMMUTABLE, and now() changes on every transaction. The alternative is a predicate with a fixed date, such as agendada_para > '2026-01-01', recreated periodically, or a predicate on state instead of time. And even with a fixed predicate, a query with agendada_para > now() - interval '1 day' does not prove the implication, because now() is not constant at planning time: the query must repeat the index condition literally to use it.",
    },
    {
      question: 'How do I know whether the problem is the predicate, the expression or the parameter type?',
      answer:
        'EXPLAIN with real values tells you. If the condition shows up in Filter with a cast on the column, such as (id)::numeric, the problem is the type. If the expression shows up in Filter written differently from the index expression, it is the expression. If the partial index simply does not appear and the condition is correct, compare the WHERE with the pg_get_indexdef of the index: there is almost always a value outside the predicate, a parameter or a now() where the index expects a literal.',
    },
  ],
  conclusion: {
    title: 'The right index only works with the query that matches it',
    description:
      'Partial and expression indexes save space, writes and memory, but they depend on a proof made at planning time: the WHERE must imply the predicate, the expression must be the same and the value type must not force a cast on the column. One more value in the IN list, a parameter instead of a literal or a different cast break that proof with no error and no warning, and the query goes back to scanning the whole table. Treating index and query as a contract, auditing indexes that stopped being used and locking the plan with a test in CI keeps this from showing up as an incident. If your system has queries that got slow after small changes, or indexes that exist but never show up in plans, I can review the schema, the queries and the indexing strategy.',
    cta: 'Review indexes and queries',
  },
  related: [
    {
      label: 'The index the database decided to ignore: when the query plan changes on its own',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'The prepared statement that gets slow on the sixth execution: generic plan, plan_cache_mode and skewed parameters',
      to: '/blog/prepared-statement-que-fica-lento-na-sexta-execucao-plano-generico-plan-cache-mode-e-parametros-desiguais',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    "Un sistema de cobranza procesaba sus tareas asíncronas en una tabla de 48 millones de filas, de las cuales solo 31 mil estaban pendientes en cualquier momento. Un índice parcial de 14 MB, con WHERE status = 'pendente', mantenía la consulta de reserva de los workers en 0,4 ms. Un deploy simple, que hizo que las tareas con timeout volvieran a la cola con un nuevo status, 'reprocessar', cambió el filtro del worker a status IN ('pendente', 'reprocessar'). La consulta pasó a 11,2 segundos, el disco de la base se saturó y la cola acumuló 180 mil tareas en veinte minutos. El índice seguía ahí, válido y actualizado; el planificador simplemente no podía probar que servía para la consulta nueva. Los índices parciales y los índices de expresión están entre las herramientas más eficientes de Postgres, pero funcionan con un contrato estricto: el WHERE tiene que implicar el predicado del índice, y la expresión de la consulta tiene que ser la misma del índice, incluso en el tipo. Este artículo muestra cómo el planificador hace esa verificación, qué cambios pequeños la rompen (un valor más en el IN, un parámetro en lugar del literal, un now(), un cast distinto) y cómo auditarlo y fijarlo con un test de plan en la aplicación.",
  sections: [
    {
      title: 'El worker que empezó a recorrer 48 millones de filas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La tabla tarefas guardaba todo el historial: el 99,9% de las filas estaban concluidas y el worker nunca más las leería. Por eso el índice era parcial. Un índice común en (status, agendada_para) ocuparía 1,9 GB y se actualizaría en cada escritura; el parcial ocupaba 14 MB, cabía entero en memoria y solo lo tocaban las filas que entraban o salían del estado pendiente.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'El diagnóstico tardó porque nada parecía roto. No había error, el índice aparecía en el \\d de la tabla, pg_stat_user_indexes mostraba idx_scan creciendo hasta las 15:10 y deteniéndose, y la consulta nueva era solo una versión un poco más amplia de la anterior. El síntoma más engañoso fue la reacción al escalado: más workers significaron más recorridos secuenciales simultáneos de 22 GB, y la base se volvió más lenta para todo lo demás. Con FOR UPDATE en la consulta, Postgres ni siquiera puede usar un recorrido paralelo, así que cada reserva era un único proceso leyendo la tabla entera.',
        },
      ],
    },
    {
      title: 'Cómo decide el planificador que un índice parcial sirve',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un índice parcial solo contiene las filas que cumplen el predicado. Para usarlo, el planificador necesita tener la certeza de que ninguna fila que la consulta quiere quedó afuera, es decir, de que el WHERE de la consulta implica lógicamente el predicado del índice. Esa prueba se hace en la planificación, antes de leer cualquier dato, y es deliberadamente conservadora: si no se puede probar, el índice se descarta, aunque en la práctica todos los datos estén ahí.',
        },
        {
          type: 'ordered',
          items: [
            'El planificador separa el WHERE de la consulta en condiciones combinadas con AND e intenta mostrar que, juntas, implican cada parte del predicado del índice.',
            'Las condiciones idénticas al predicado lo prueban de inmediato, después de la normalización: arquivada = false pasa a NOT arquivada, x IN (a) pasa a x = a.',
            "Las comparaciones con constantes pasan por reglas de operadores B-tree: status = 'pendente' implica status IN ('pendente', 'reprocessar'), y agendada_para > '2026-06-01' implica agendada_para > '2026-01-01'.",
            'Lo que no es constante en el momento de la planificación no prueba nada: parámetros de un plan genérico, now(), current_date y cualquier función que no sea IMMUTABLE.',
            'Si alguna parte del predicado no se prueba, el índice parcial ni siquiera entra en la lista de caminos posibles. No es una cuestión de costo: simplemente no aparece.',
          ],
        },
        {
          type: 'code',
          value: partialCode(comments.es),
        },
        {
          type: 'table',
          columns: ['Predicado del índice', 'Condición en la consulta', '¿Se puede usar el índice?'],
          rows: [
            ["status = 'pendente'", "status = 'pendente'", 'Sí, condición idéntica'],
            ["status IN ('pendente', 'reprocessar')", "status = 'pendente'", 'Sí, el valor está en la lista'],
            ["status = 'pendente'", "status IN ('pendente', 'reprocessar')", "No, 'reprocessar' queda fuera del índice"],
            ["status = 'pendente'", 'status = $1 (plan genérico)', 'No, el valor es desconocido en la planificación'],
            ["agendada_para > '2026-01-01'", "agendada_para > '2026-06-01'", 'Sí, el rango está contenido'],
            ["agendada_para > '2026-01-01'", "agendada_para > now() - interval '1 day'", 'No, now() no es constante en la planificación'],
            ['NOT arquivada', 'arquivada = false', 'Sí, el planificador lo normaliza a NOT arquivada'],
          ],
        },
        {
          type: 'paragraph',
          value:
            "La tercera fila es el incidente. La consulta pide un conjunto mayor del que guarda el índice, y el planificador tiene razón al rechazarlo: el índice no tiene las tareas en 'reprocessar'. La corrección fue crear el índice con el predicado de la consulta nueva antes de publicar el código, y solo después eliminar el anterior. Las dos operaciones con CONCURRENTLY, para no bloquear escritura en una tabla que recibe 300 inserciones por segundo.",
        },
      ],
    },
    {
      title: 'Un parámetro en lugar del literal: el plan genérico no prueba nada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La misma regla tiene una consecuencia menos obvia. Si el valor que coincide con el predicado llega como parámetro, status = $1, el índice parcial solo se puede usar cuando el plan se arma con el valor real. En consultas no preparadas y en los planes custom de prepared statements, Postgres reemplaza $1 por el valor antes de planificar y la prueba funciona. En el plan genérico, $1 sigue desconocido, y ningún índice con predicado sobre status es elegible. EXPLAIN (GENERIC_PLAN), disponible desde PostgreSQL 16, lo muestra sin preparar nada: el plan cae en un recorrido secuencial y un ordenamiento de 9,5 millones de filas estimadas.',
        },
        {
          type: 'paragraph',
          value:
            'Con el plan_cache_mode por defecto, esto suele quedar oculto: como el plan genérico sin el índice parcial es mucho más caro que los planes custom, Postgres sigue armando un plan custom en cada ejecución. El problema aparece cuando alguien fuerza el plan genérico para ahorrar planificación, cuando un pooler o driver se configura con force_generic_plan para toda la aplicación, o en funciones PL/pgSQL y statements preparados en los que el genérico gana por otros motivos. En esos casos, la consulta empieza a ignorar el índice parcial sin ningún cambio en el SQL.',
        },
        {
          type: 'list',
          items: [
            'Los valores que definen el recorte lógico del índice (estado de la cola, tipo de registro, flag de borrado) deben quedar como literal en el SQL. Son constantes del código, no entrada del usuario, así que escribirlos en el texto no abre la puerta a la inyección.',
            'Los parámetros siguen en el resto de la consulta: límite, intervalo de fechas, identificadores. Esos no forman parte del predicado del índice.',
            'Si el mismo código atiende varios estados que vienen de afuera, prefiera consultas separadas por estado, cada una con su literal, a una única consulta con status = $1.',
            'Los query builders y ORMs que parametrizan todo automáticamente necesitan una salida para literales, como sql.raw o equivalente, usada solo para estas constantes.',
          ],
        },
      ],
    },
    {
      title: 'Índice de expresión: la consulta tiene que repetir la misma expresión',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Los índices de expresión tienen un contrato parecido, pero la verificación es todavía más literal. El planificador compara la expresión de la consulta con la expresión guardada en el índice después de normalizar las dos, y solo usa el índice si son estructuralmente iguales: mismas funciones, mismos argumentos, mismos casts. No sabe que dos expresiones distintas producen el mismo valor, y no reescribe la consulta para que encaje en el índice.',
        },
        {
          type: 'code',
          value: expressionCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            "El caso de la fecha es común. criado_em::date sobre una columna timestamptz no se puede indexar, porque el resultado depende del TimeZone de la sesión y la función no es IMMUTABLE. El equipo entonces crea el índice con AT TIME ZONE 'America/Sao_Paulo', que es estable, pero la consulta anterior sigue con ::date y recorre la tabla. Muchas veces la mejor corrección ni siquiera es el índice de expresión: un rango sobre la propia columna, criado_em >= '2026-11-17 00:00-03' AND criado_em < '2026-11-18 00:00-03', usa el índice común de criado_em y no depende de la zona horaria de la sesión.",
        },
        {
          type: 'table',
          columns: ['Expresión en el índice', 'Expresión en la consulta', 'Resultado'],
          rows: [
            ['lower(email)', 'lower(email) = $1', 'Usa el índice'],
            ['lower(email)', 'email ILIKE $1', 'No lo usa: otra operación'],
            ["((payload->>'cliente_id')::bigint)", "payload->>'cliente_id' = '4821'", 'No lo usa: compara texto'],
            ["((payload->>'cliente_id')::bigint)", "(payload->>'cliente_id')::int = 4821", 'No lo usa: el cast es a integer'],
            ["((criado_em AT TIME ZONE 'America/Sao_Paulo')::date)", 'criado_em::date = $1', 'No lo usa: expresión distinta'],
          ],
        },
      ],
    },
    {
      title: 'El tipo del parámetro que hace desaparecer incluso el índice común',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El mismo mecanismo afecta índices simples cuando el tipo del valor comparado no es el de la columna. Para usar un índice B-tree, el operador de la comparación tiene que pertenecer a la familia de operadores del índice con la columna del lado izquierdo y sin conversión. bigint comparado con integer o smallint tiene operadores cruzados en la misma familia, y el índice funciona. bigint comparado con numeric no: Postgres convierte la columna a numeric, la condición pasa a (id)::numeric = valor y el índice de la clave primaria deja de ser elegible.',
        },
        {
          type: 'table',
          columns: ['Origen del valor', 'Tipo que llega al servidor', 'Efecto en id bigint = $1'],
          rows: [
            ['node-postgres (pg) con number o string', 'unknown, inferido por la columna', 'bigint, usa el índice'],
            ['SQL generado con $1::numeric o literal 90210.0', 'numeric', 'Convierte la columna, ignora el índice'],
            ['JDBC setLong', 'int8', 'Usa el índice'],
            ['JDBC setBigDecimal', 'numeric', 'Convierte la columna, ignora el índice'],
            ['Columna char(n) comparada con parámetro text', 'text', 'Convierte la columna, ignora el índice'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'node-postgres envía los parámetros sin tipo y deja que el servidor lo infiera por el contexto, lo que evita la mayoría de estos casos. El riesgo aparece en casts explícitos escritos para "hacer pasar la consulta", en capas que declaran el tipo del parámetro y en servicios de otros lenguajes que acceden a la misma tabla. El síntoma en el EXPLAIN es siempre el mismo: un cast aplicado sobre la columna dentro de Filter, en lugar de Index Cond.',
        },
      ],
    },
    {
      title: 'Encontrar los índices que existen pero no trabajan',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Los índices parciales y de expresión se rompen en silencio, así que vale la pena buscarlos a propósito. La consulta de abajo lista solo los índices con predicado o expresión, empezando por los menos usados. Un idx_scan detenido, o un last_idx_scan antiguo, en un índice creado para una consulta frecuente es la señal de que la consulta cambió y el índice quedó atrás.',
        },
        {
          type: 'code',
          value: auditCode,
        },
        {
          type: 'ordered',
          items: [
            'Para cada índice sospechoso, encuentre en pg_stat_statements la consulta que debería usarlo, por el texto o por la tabla.',
            'Ejecute EXPLAIN con valores reales y busque Filter donde debería haber Index Cond, o un Seq Scan donde debería estar el índice.',
            'Compare el WHERE con pg_get_indexdef: un valor fuera del predicado, un parámetro en lugar del literal, now() en el rango, una expresión o un cast distinto.',
            'Si el índice no sirve para ninguna consulta actual, elimínelo con DROP INDEX CONCURRENTLY después de confirmarlo en las réplicas, porque las estadísticas de uso son por servidor.',
          ],
        },
      ],
    },
    {
      title: 'Corregir y evitar que vuelva: literal en el SQL y test de plan',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La corrección del incidente tuvo dos partes. En la base, el índice nuevo con el predicado que la consulta realmente usa. En la aplicación, un test de contrato que corre en el CI contra una base con el mismo esquema y falla si la consulta deja de poder usar el índice esperado. El test desactiva el seq scan solo dentro de la transacción: el objetivo no es medir costo, que en una base de prueba pequeña siempre favorece el recorrido, sino garantizar que el índice sigue siendo elegible.',
        },
        {
          type: 'code',
          value: appCode(comments.es),
        },
        {
          type: 'list',
          items: [
            'Cree el índice nuevo antes del deploy que cambia la consulta, nunca después. CREATE INDEX CONCURRENTLY no bloquea escritura, pero tarda en una tabla grande.',
            'Trate el predicado del índice y el WHERE de la consulta como un contrato: quien cambia uno tiene que cambiar el otro en el mismo pull request.',
            "Prefiera predicados con lista explícita, status IN ('pendente', 'reprocessar'), a negaciones como status <> 'concluida', que incluyen cualquier estado nuevo y hacen crecer el índice sin que nadie lo note.",
            'Mantenga auto_explain registrando planes por encima de algunos cientos de milisegundos en las consultas de la cola: el cambio de Index Scan a Seq Scan aparece en el log antes de convertirse en incidente.',
          ],
        },
        {
          type: 'paragraph',
          value:
            "Con el índice tarefas_a_processar_idx en su lugar, la reserva volvió a 0,5 ms, el índice quedó en 15 MB y la cola de 180 mil tareas se vació en once minutos con los cuatro workers originales. Dos semanas después, el test de plan atrapó un pull request que agregaba el estado 'agendada_manual' al IN sin tocar el índice.",
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué Postgres no usa el índice parcial si todas las filas que quiero están en él?',
      answer:
        'Porque tiene que probarlo en la planificación, solo con el texto de la consulta y el predicado del índice, sin mirar los datos. Si el WHERE no implica el predicado mediante reglas que el planificador conoce, como valores constantes contenidos en la lista o rangos contenidos en el rango del índice, el índice se descarta. Usar un índice parcial sin esa prueba podría devolver un resultado incompleto, y Postgres prefiere ser lento a estar equivocado.',
    },
    {
      question: '¿Puedo usar now() o current_date en el predicado de un índice parcial?',
      answer:
        "No. Las funciones en predicados y expresiones de índice tienen que ser IMMUTABLE, y now() cambia en cada transacción. La alternativa es un predicado con fecha fija, como agendada_para > '2026-01-01', recreado periódicamente, o un predicado sobre estado en lugar de tiempo. E incluso con un predicado fijo, una consulta con agendada_para > now() - interval '1 day' no prueba la implicación, porque now() no es constante en la planificación: la consulta tiene que repetir la condición del índice de forma literal para usarlo.",
    },
    {
      question: '¿Cómo saber si el problema es el predicado, la expresión o el tipo del parámetro?',
      answer:
        'El EXPLAIN con los valores reales lo muestra. Si la condición aparece en Filter con un cast sobre la columna, como (id)::numeric, el problema es el tipo. Si la expresión aparece en Filter escrita de otra forma que la del índice, es la expresión. Si el índice parcial simplemente no aparece y la condición es correcta, compare el WHERE con el pg_get_indexdef del índice: casi siempre hay un valor fuera del predicado, un parámetro o un now() donde el índice espera un literal.',
    },
  ],
  conclusion: {
    title: 'El índice correcto solo funciona con la consulta que coincide con él',
    description:
      'Los índices parciales y de expresión ahorran espacio, escritura y memoria, pero dependen de una prueba hecha en la planificación: el WHERE tiene que implicar el predicado, la expresión tiene que ser la misma y el tipo del valor no puede forzar un cast en la columna. Un valor más en el IN, un parámetro en lugar del literal o un cast distinto rompen esa prueba sin error y sin aviso, y la consulta vuelve a recorrer la tabla entera. Tratar índice y consulta como un contrato, auditar los índices que dejaron de usarse y fijar el plan con un test en el CI evita que esto aparezca como incidente. Si su sistema tiene consultas que se volvieron lentas después de cambios pequeños, o índices que existen pero no aparecen en los planes, puedo revisar el esquema, las consultas y la estrategia de indexación.',
    cta: 'Revisar índices y consultas',
  },
  related: [
    {
      label: 'El índice que la base decidió ignorar: cuándo el plan de consulta cambia solo',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'El prepared statement que se vuelve lento en la sexta ejecución: plan genérico, plan_cache_mode y parámetros desiguales',
      to: '/blog/prepared-statement-que-fica-lento-na-sexta-execucao-plano-generico-plan-cache-mode-e-parametros-desiguais',
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
