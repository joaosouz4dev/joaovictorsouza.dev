// Conteudo do artigo: indice que ninguem usa e toda escrita paga. Quanto cada indice custa em
// INSERT, UPDATE sem HOT, WAL, vacuum, replica e backup, por que idx_scan = 0 no primario nao
// basta para apagar, como medir o uso em todos os nos durante um ciclo inteiro, achar indices
// redundantes por prefixo e remover com hypopg, DROP INDEX CONCURRENTLY e volta ensaiada.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const candidatosCode = `-- Indices sem nenhuma varredura desde o ultimo reset, com tamanho e restricoes.
-- E so a lista de suspeitos: o numero vale para ESTA instancia e para ESTE periodo.
SELECT s.schemaname || '.' || s.indexrelname AS indice,
       s.relname                              AS tabela,
       s.idx_scan,
       s.last_idx_scan,                       -- Postgres 16 ou superior
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS tamanho,
       i.indisunique,
       i.indisprimary,
       (SELECT string_agg(c.conname, ', ')
          FROM pg_constraint c
         WHERE c.conindid = s.indexrelid)     AS restricoes
  FROM pg_stat_user_indexes s
  JOIN pg_index i ON i.indexrelid = s.indexrelid
 WHERE s.idx_scan = 0
 ORDER BY pg_relation_size(s.indexrelid) DESC;

-- Desde quando esses contadores valem nesta instancia.
SELECT stats_reset FROM pg_stat_database WHERE datname = current_database();

-- O que a tabela paga para manter os indices: proporcao de updates HOT.
SELECT relname,
       n_tup_ins,
       n_tup_upd,
       n_tup_hot_upd,
       round(100.0 * n_tup_hot_upd / nullif(n_tup_upd, 0), 1) AS pct_hot,
       pg_size_pretty(pg_relation_size(relid))       AS heap,
       pg_size_pretty(pg_indexes_size(relid))        AS indices
  FROM pg_stat_user_tables
 WHERE relname = 'pedidos';`;

const coletorCode = `// coletar-uso-indices.mjs: roda uma vez por dia (cron) e guarda o contador de
// varreduras de cada indice em TODOS os nos. As estatisticas sao por instancia:
// o primario nao enxerga o que as replicas leem.
import pg from 'pg';

const nos = [
  { nome: 'primario', url: process.env.DATABASE_URL_PRIMARIO },
  { nome: 'replica-api', url: process.env.DATABASE_URL_REPLICA_API },
  { nome: 'replica-relatorios', url: process.env.DATABASE_URL_REPLICA_RELATORIOS },
];

const CONSULTA_USO = \`
  SELECT s.schemaname || '.' || s.indexrelname AS indice,
         s.idx_scan,
         d.stats_reset
    FROM pg_stat_user_indexes s
   CROSS JOIN pg_stat_database d
   WHERE d.datname = current_database()\`;

export async function coletarUso(destino) {
  const coletadoEm = new Date();
  const falhas = [];

  for (const no of nos) {
    const client = new pg.Client({ connectionString: no.url, statement_timeout: 10000 });
    let conectado = false;
    try {
      await client.connect();
      conectado = true;
      const { rows } = await client.query(CONSULTA_USO);
      await destino.query(
        \`INSERT INTO indice_uso_snapshot (coletado_em, no, indice, idx_scan, stats_reset)
         SELECT $1, $2, u.indice, u.idx_scan, u.stats_reset
           FROM unnest($3::text[], $4::bigint[], $5::timestamptz[])
             AS u(indice, idx_scan, stats_reset)\`,
        [
          coletadoEm,
          no.nome,
          rows.map((r) => r.indice),
          rows.map((r) => r.idx_scan),
          rows.map((r) => r.stats_reset),
        ],
      );
    } catch (erro) {
      // Um no sem coleta nao pode virar "indice sem uso": a consulta de analise
      // exige que todos os nos tenham sido observados.
      falhas.push(\`\${no.nome}: \${erro.message}\`);
    } finally {
      if (conectado) await client.end().catch(() => {});
    }
  }

  if (falhas.length) throw new Error(\`Coleta incompleta: \${falhas.join('; ')}\`);
}

const destino = new pg.Pool({ connectionString: process.env.DATABASE_URL_COLETA });
try {
  await coletarUso(destino);
} finally {
  await destino.end();
}`;

const analiseCode = `CREATE TABLE IF NOT EXISTS indice_uso_snapshot (
  coletado_em timestamptz NOT NULL,
  no          text        NOT NULL,
  indice      text        NOT NULL,
  idx_scan    bigint      NOT NULL,
  stats_reset timestamptz,
  PRIMARY KEY (no, indice, coletado_em)
);

-- Varreduras de cada indice na janela, somando todos os nos e tratando resets.
WITH ordenado AS (
  SELECT no, indice, coletado_em, idx_scan, stats_reset,
         lag(idx_scan)    OVER w AS scan_anterior,
         lag(stats_reset) OVER w AS reset_anterior
    FROM indice_uso_snapshot
   WHERE coletado_em >= now() - interval '42 days'
  WINDOW w AS (PARTITION BY no, indice ORDER BY coletado_em)
),
delta AS (
  SELECT no, indice, coletado_em,
         CASE
           WHEN scan_anterior IS NULL THEN 0
           -- contador zerado (pg_stat_reset, crash, failover): o valor atual e todo novo
           WHEN stats_reset IS DISTINCT FROM reset_anterior
             OR idx_scan < scan_anterior THEN idx_scan
           ELSE idx_scan - scan_anterior
         END AS scans
    FROM ordenado
)
SELECT indice,
       sum(scans)                          AS scans_na_janela,
       count(DISTINCT no)                  AS nos_observados,
       max(coletado_em) - min(coletado_em) AS cobertura
  FROM delta
 GROUP BY indice
HAVING sum(scans) = 0
   AND count(DISTINCT no) = 3                               -- todos os nos configurados
   AND max(coletado_em) - min(coletado_em) >= interval '35 days'
 ORDER BY indice;`;

const redundantesCode = `-- Indices b-tree cujas colunas e classes de operador sao prefixo de outro indice
-- da mesma tabela. Parciais e com expressao ficam de fora: analise manual.
WITH idx AS (
  SELECT i.indexrelid,
         i.indrelid,
         i.indisunique,
         string_to_array(i.indkey::text, ' ')   AS colunas,
         string_to_array(i.indclass::text, ' ') AS classes,
         c.relam
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indpred IS NULL
     AND i.indexprs IS NULL
)
SELECT a.indrelid::regclass   AS tabela,
       a.indexrelid::regclass AS redundante,
       b.indexrelid::regclass AS coberto_por,
       pg_size_pretty(pg_relation_size(a.indexrelid)) AS tamanho
  FROM idx a
  JOIN idx b
    ON b.indrelid = a.indrelid
   AND b.indexrelid <> a.indexrelid
   AND b.relam = a.relam
   AND b.colunas[1:cardinality(a.colunas)] = a.colunas
   AND b.classes[1:cardinality(a.classes)] = a.classes
   -- duplicata exata: lista so um dos dois
   AND (cardinality(b.colunas) > cardinality(a.colunas) OR a.indexrelid > b.indexrelid)
 WHERE NOT a.indisunique
 ORDER BY pg_relation_size(a.indexrelid) DESC;`;

const remocaoCode = `-- 1. Guardar a volta: a definicao exata, versionada junto com a migracao.
SELECT pg_get_indexdef('public.pedidos_atualizado_em_idx'::regclass);
-- CREATE INDEX pedidos_atualizado_em_idx ON public.pedidos USING btree (atualizado_em)

-- 2. Ensaiar as consultas raras sem o indice, numa sessao da copia restaurada.
--    hypopg_hide_index esconde o indice do planejador so nesta sessao.
CREATE EXTENSION IF NOT EXISTS hypopg;
SELECT hypopg_hide_index('public.pedidos_atualizado_em_idx'::regclass);
EXPLAIN (COSTS ON)
SELECT loja_id, sum(valor_centavos)
  FROM pedidos
 WHERE atualizado_em >= date '2026-10-01' AND atualizado_em < date '2026-11-01'
 GROUP BY loja_id;
SELECT hypopg_unhide_all_indexes();

-- 3. Remover um por vez, fora do pico e fora da semana de fechamento.
--    CONCURRENTLY nao roda dentro de transacao: a migracao precisa desligar o BEGIN automatico.
SET lock_timeout = '3s';
DROP INDEX CONCURRENTLY IF EXISTS public.pedidos_atualizado_em_idx;

-- 4. Se a observacao mostrar regressao: recriar sem bloquear escrita e conferir o resultado.
CREATE INDEX CONCURRENTLY pedidos_atualizado_em_idx ON public.pedidos USING btree (atualizado_em);
SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.pedidos_atualizado_em_idx'::regclass;`;

const diagramaPt = `Índice candidato
      |
      v
Sustenta PK, UNIQUE ou EXCLUDE? ---- sim ----> fica (a regra depende dele)
      | não
      v
Varreduras em todos os nós, janela >= 35 dias ---- > 0 ----> fica (ou checar redundância)
      | zero
      v
EXPLAIN das consultas raras com o índice escondido (hypopg) ---- plano piora ----> fica
      | plano igual
      v
Guardar pg_get_indexdef + medir tempo de recriação na cópia
      |
      v
DROP INDEX CONCURRENTLY, um por vez, com lock_timeout, fora do fechamento
      |
      v
Observar um ciclo inteiro ---- regressão ----> CREATE INDEX CONCURRENTLY com a definição guardada`;

const diagramaEn = `Candidate index
      |
      v
Backs a PK, UNIQUE or EXCLUDE? ---- yes ----> keep (the rule depends on it)
      | no
      v
Scans on every node, window >= 35 days ---- > 0 ----> keep (or check redundancy)
      | zero
      v
EXPLAIN the rare queries with the index hidden (hypopg) ---- worse plan ----> keep
      | same plan
      v
Save pg_get_indexdef + measure rebuild time on the copy
      |
      v
DROP INDEX CONCURRENTLY, one at a time, with lock_timeout, outside closing week
      |
      v
Watch a full cycle ---- regression ----> CREATE INDEX CONCURRENTLY from the saved definition`;

const diagramaEs = `Índice candidato
      |
      v
¿Sostiene PK, UNIQUE o EXCLUDE? ---- sí ----> se queda (la regla depende de él)
      | no
      v
Lecturas en todos los nodos, ventana >= 35 días ---- > 0 ----> se queda (o revisar redundancia)
      | cero
      v
EXPLAIN de las consultas raras con el índice oculto (hypopg) ---- plan peor ----> se queda
      | mismo plan
      v
Guardar pg_get_indexdef + medir tiempo de recreación en la copia
      |
      v
DROP INDEX CONCURRENTLY, uno a la vez, con lock_timeout, fuera del cierre
      |
      v
Observar un ciclo entero ---- regresión ----> CREATE INDEX CONCURRENTLY con la definición guardada`;

const pt = {
  intro:
    'A tabela de pedidos de um ERP para varejo tinha 210 milhões de linhas, 38 GB de dados e 22 índices que somavam 91 GB. No pico, recebia 3.200 inserções e 5.800 atualizações por segundo, e o p99 do INSERT tinha subido para 19 ms sem nenhuma consulta nova. O banco gerava 2,3 TB de WAL por dia, a réplica de relatórios chegava a 40 segundos de atraso e o autovacuum da tabela levava seis horas por passada. Ninguém mexia nos índices por um motivo concreto: oito meses antes, alguém tinha apagado três índices com idx_scan = 0 no primário, e o fechamento fiscal do mês seguinte, que roda na réplica, passou de 3 para 52 minutos e estourou o statement_timeout. Recriar cada índice levou 47 minutos em horário comercial. Este artigo mostra quanto cada índice custa para toda escrita, por que o contador do primário engana, como medir o uso de verdade durante um ciclo inteiro e em todos os nós, como achar índices redundantes e como remover sem arriscar a consulta que só roda uma vez por mês.',
  sections: [
    {
      title: 'O custo que não aparece em nenhuma consulta lenta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Índice não é de graça só porque nenhuma leitura o usa. Toda inserção na tabela vira uma inserção em cada árvore de índice, cada uma com seu registro de WAL e suas páginas disputando espaço no shared_buffers. A atualização é pior: se qualquer coluna indexada mudar, ou se não houver espaço na página para a nova versão da linha, o Postgres não consegue fazer um update HOT e precisa inserir uma entrada nova em todos os índices da tabela, inclusive nos que não têm relação com a coluna alterada.',
        },
        {
          type: 'paragraph',
          value:
            'No ERP, o índice em atualizado_em tinha sido criado para um job de sincronização desativado havia um ano. Como toda atualização de pedido grava atualizado_em, nenhuma delas podia ser HOT: a taxa de updates HOT da tabela era de 4%, e cada mudança de status de pedido gerava 22 inserções em índices. O custo não aparece em pg_stat_statements como uma consulta lenta. Ele se espalha por todas as escritas, pelo vacuum, pela réplica e pelo backup.',
        },
        {
          type: 'table',
          columns: ['Operação', 'O que cada índice a mais adiciona', 'Observação'],
          rows: [
            ['INSERT', 'Uma inserção na árvore, com WAL e páginas no cache', 'Cresce linearmente com o número de índices'],
            ['UPDATE que muda coluna indexada ou não cabe na página', 'Uma entrada nova em todos os índices', 'Um único índice em coluna muito atualizada desliga o HOT da tabela inteira'],
            ['UPDATE HOT', 'Nada', 'Só acontece se nenhuma coluna indexada mudar e houver espaço na página'],
            ['DELETE', 'Nada na hora, limpeza depois', 'O vacuum precisa remover as entradas mortas de cada índice'],
            ['VACUUM', 'Uma varredura completa do índice a cada passada de limpeza', 'Com 22 índices, a fase de índices dominava as seis horas'],
            ['Réplica e backup', 'Replay do WAL do índice e gigabytes a mais em cada cópia', 'Atraso de réplica e tempo de restauração crescem juntos'],
          ],
        },
        {
          type: 'code',
          value: candidatosCode,
        },
        {
          type: 'paragraph',
          value:
            'A primeira consulta lista suspeitos, não culpados. No primário do ERP, ela trouxe 9 índices com idx_scan = 0, somando 31 GB. Dois deles eram exatamente os que o fechamento fiscal usava na réplica. A diferença entre essa lista e uma lista segura para apagar é o assunto das próximas seções.',
        },
      ],
    },
    {
      title: 'Por que idx_scan = 0 no primário não basta para apagar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O contador de pg_stat_user_indexes conta quantas vezes o índice foi usado em varreduras desde o último reset, nesta instância. Cada parte dessa frase esconde uma armadilha, e a remoção de oito meses antes caiu na primeira delas.',
        },
        {
          type: 'list',
          items: [
            'As estatísticas são por instância. Uma réplica de leitura mantém seus próprios contadores, e o primário não sabe o que ela leu. Um índice usado só pela réplica de BI aparece com idx_scan = 0 no primário, mesmo sendo essencial.',
            'O contador é zerado por pg_stat_reset(), por um crash ou desligamento imediato, por pg_upgrade e pela restauração de backup. Depois de um failover, o novo primário carrega os contadores que tinha como réplica. Sem olhar stats_reset, um "zero" pode significar só "zero desde ontem".',
            'A janela pode ser curta demais. Fechamento mensal, auditoria anual, exportação de dados pessoais a pedido do titular e scripts de incidente rodam raramente e dependem de índices que ficam semanas sem uma varredura.',
            'Índices que sustentam PRIMARY KEY, UNIQUE ou EXCLUDE aplicam uma regra. A checagem de unicidade na inserção não conta como varredura, então um índice único pode ter idx_scan = 0 e ser a única coisa que impede pedidos com número duplicado.',
            'O contrário também engana: idx_scan alto não prova que o índice é necessário. Se existem (loja_id) e (loja_id, criado_em), o planejador usa os dois, e os dois aparecem como usados, embora o segundo atenda sozinho as consultas do primeiro.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'No Postgres 16 ou superior, a coluna last_idx_scan mostra o momento da última varredura e ajuda a separar "nunca usado" de "usado no começo do mês". Ela continua sendo por instância e continua sendo zerada junto com os contadores, então resolve a leitura do tempo, não a do escopo.',
        },
      ],
    },
    {
      title: 'Medir o uso ao longo de um ciclo inteiro e em todos os nós',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A correção é transformar uma leitura pontual em uma série. Um coletor diário grava o contador de cada índice em cada nó, incluindo todas as réplicas que recebem leitura, e a análise soma os incrementos da janela. O coletor falha alto quando não consegue ler algum nó, porque um nó sem dados é exatamente o tipo de buraco que transforma um índice usado em candidato à remoção.',
        },
        {
          type: 'code',
          value: coletorCode,
        },
        {
          type: 'paragraph',
          value:
            'A análise compara cada coleta com a anterior do mesmo nó. Quando stats_reset muda ou o contador diminui, o valor atual é tratado como incremento inteiro, porque o contador recomeçou do zero. O índice só entra na lista final se a soma for zero, se todos os nós configurados tiverem sido observados e se a cobertura passar de 35 dias, o que garante pelo menos uma virada de mês.',
        },
        {
          type: 'code',
          value: analiseCode,
        },
        {
          type: 'paragraph',
          value:
            'A janela depende do negócio, não do banco. No ERP, a coleta ficou 42 dias ligada para cobrir o fechamento de outubro e a primeira semana de novembro, quando roda a apuração de impostos. Para os jobs anuais, que nenhuma janela razoável cobre, a fonte é outra: um catálogo das consultas raras, montado com quem cuida do fiscal, da auditoria e do atendimento ao titular de dados, que é usado na etapa de ensaio.',
        },
      ],
    },
    {
      title: 'Índices redundantes: os que são usados mas não precisam existir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A segunda fonte de desperdício são índices usados que outro índice já atende. Um b-tree em (loja_id, criado_em) serve qualquer consulta que filtre só por loja_id, porque a árvore está ordenada primeiro por essa coluna. Manter também um índice só em (loja_id) paga a escrita duas vezes para ganhar uma árvore um pouco menor na leitura. A consulta abaixo encontra esses casos comparando colunas e classes de operador como prefixo.',
        },
        {
          type: 'code',
          value: redundantesCode,
        },
        {
          type: 'table',
          columns: ['Situação', 'Exemplo', 'Pode remover?'],
          rows: [
            ['Duplicata exata', '(loja_id, criado_em) duas vezes, com nomes diferentes', 'Sim, um deles; preferir manter o que sustenta restrição'],
            ['Prefixo de índice maior', '(loja_id) e (loja_id, criado_em)', 'Em geral sim; o maior atende o filtro e a checagem da chave estrangeira'],
            ['Comum contido em único', 'UNIQUE (numero) e índice comum em (numero)', 'Sim, o comum; o único cumpre os dois papéis'],
            ['Parcial ou com expressão', '(status) WHERE status = \'pendente\'', 'Não pela consulta; o predicado muda o que o índice atende'],
            ['Mesma coluna, outro método', 'b-tree e GIN com pg_trgm em (descricao)', 'Não; atendem operadores diferentes'],
            ['Mesmas colunas, outra ordem', '(criado_em, loja_id) e (loja_id, criado_em)', 'Não automaticamente; servem filtros e ordenações diferentes'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'No ERP, a consulta apontou três índices de prefixo e uma duplicata exata criada por duas migrações de times diferentes, com nomes diferentes, no mesmo trimestre. Os redundantes também passam pelo ensaio da próxima seção: a árvore maior costuma ser só um pouco mais lenta, mas uma consulta muito frequente que faz index-only scan pode perder essa vantagem se o índice maior for bem mais largo.',
        },
      ],
    },
    {
      title: 'Remover sem arriscar: esconder, ensaiar e guardar a volta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O Postgres não tem índice invisível nativo, mas a extensão hypopg permite esconder um índice do planejador dentro de uma sessão. Isso não economiza nenhuma escrita, porque o índice continua sendo mantido, mas permite rodar o EXPLAIN de cada consulta rara do catálogo como se o índice não existisse, sem afetar nenhuma outra conexão. O ensaio é feito numa cópia restaurada com volume real, onde um plano ruim não custa nada.',
        },
        {
          type: 'code',
          value: remocaoCode,
        },
        {
          type: 'ordered',
          items: [
            'Classificar: índice que sustenta restrição fica, a menos que a restrição em si seja revista. Índice usado em qualquer nó na janela fica ou vai para a análise de redundância.',
            'Ensaiar: rodar o EXPLAIN de cada consulta do catálogo de raras com o índice escondido. Se o plano trocar uma varredura de índice por uma sequencial em tabela grande, o índice fica e ganha um comentário dizendo quem o usa.',
            'Guardar a volta: versionar o resultado de pg_get_indexdef e medir na cópia quanto tempo o CREATE INDEX CONCURRENTLY leva. É esse número que define o pior caso de uma remoção errada.',
            'Remover um por vez, com DROP INDEX CONCURRENTLY e lock_timeout, fora do pico e longe da semana de fechamento. Remover em lote torna impossível saber qual remoção causou uma regressão.',
            'Observar um ciclo: acompanhar o tempo médio das consultas principais em pg_stat_statements, o seq_scan da tabela em pg_stat_user_tables e os planos registrados pelo auto_explain para consultas acima de um limite.',
            'Se houver regressão, recriar com a definição guardada e conferir indisvalid, porque um CREATE INDEX CONCURRENTLY que falha deixa para trás um índice inválido que continua custando escrita.',
          ],
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'O cuidado com lock_timeout não é detalhe. DROP INDEX CONCURRENTLY não bloqueia leituras nem escritas durante a remoção, mas precisa esperar as transações que estão usando a tabela. Uma transação esquecida aberta pode deixar o comando esperando, e qualquer DDL que venha atrás dele fica na fila. Com o tempo limite, o comando desiste e pode ser repetido depois.',
        },
      ],
    },
    {
      title: 'Resultado e a regra para não acumular de novo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Dos 22 índices, 9 saíram em três semanas, um por dia útil: cinco sem uso em nenhum dos três nós durante 42 dias, três redundantes por prefixo e a duplicata exata. Os dois índices que o fechamento fiscal usa na réplica ficaram, agora com comentário, e o índice único em numero_pedido ficou apesar do idx_scan = 0. Nenhuma remoção precisou ser desfeita.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Antes', 'Depois'],
          rows: [
            ['Índices na tabela de pedidos', '22 (91 GB)', '13 (49 GB)'],
            ['p99 do INSERT no pico', '19 ms', '9 ms'],
            ['Updates HOT', '4%', '57%'],
            ['WAL gerado por dia', '2,3 TB', '1,4 TB'],
            ['Atraso máximo da réplica de relatórios', '40 s', '6 s'],
            ['Duração do autovacuum da tabela', '6 h', '2 h 40 min'],
            ['Fechamento fiscal na réplica', '3 min', '3 min'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O salto nos updates HOT veio quase inteiro da remoção do índice em atualizado_em, e foi ele que mais reduziu o WAL. Para que a tabela não voltasse a acumular índices, o time adotou três regras simples:',
        },
        {
          type: 'list',
          items: [
            'Todo índice novo entra por migração com COMMENT ON INDEX dizendo qual consulta atende e qual time é dono, o que transforma "ninguém sabe para que serve" em uma pergunta com destinatário.',
            'A revisão de migração roda a consulta de redundância contra o esquema com o índice novo, antes do merge.',
            'O coletor continua ligado, e a cada trimestre a lista de índices sem uso em todos os nós vira uma tarefa com dono, em vez de uma limpeza heroica a cada dois anos.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Posso desativar o índice com UPDATE pg_index SET indisvalid = false antes de apagar?',
      answer:
        'Não é uma boa ideia. Alterar o catálogo diretamente exige superusuário, não é suportado e não está disponível na maioria dos bancos gerenciados. Além disso, com indisready ainda verdadeiro, o índice continua sendo mantido em toda escrita, então você não mede o ganho, só o risco. Para testar o planejador sem o índice, use hypopg_hide_index numa sessão; para medir o ganho de escrita, a única forma é remover de verdade, com a definição guardada para recriar.',
    },
    {
      question: 'Qual é a janela mínima de observação antes de remover um índice?',
      answer:
        'Um ciclo inteiro do negócio, incluindo o processo mais raro que você consegue esperar. Para a maioria dos sistemas, isso significa pelo menos uma virada de mês, entre 35 e 45 dias, com todos os nós de leitura coletados. O que roda uma vez por ano não cabe em nenhuma janela razoável e precisa entrar no catálogo de consultas raras, que é ensaiado com o índice escondido antes da remoção.',
    },
    {
      question: 'Um índice único com idx_scan = 0 pode ser removido?',
      answer:
        'Não pela estatística de uso. A verificação de unicidade feita a cada inserção não incrementa idx_scan, então o contador zerado só diz que nenhuma consulta o usou para ler, não que a regra é dispensável. Se a unicidade não é mais necessária, isso é uma decisão de modelo de dados, tomada com o time do produto, e a remoção é da restrição, não do índice. Se ela continua necessária, o índice fica, e o que pode sair é algum índice comum redundante sobre as mesmas colunas.',
    },
  ],
  conclusion: {
    title: 'Índice é custo fixo em toda escrita',
    description:
      'A tabela de pedidos não estava lenta por falta de índice, e sim por excesso: nove árvores mantidas a cada escrita para atender consultas que não existiam mais ou que outro índice já atendia. A remoção anterior deu errado porque confiou num contador de uma instância e de um período, e a correção foi trocar essa leitura por uma série em todos os nós, um catálogo das consultas raras, um ensaio com o índice escondido e uma volta medida antes de apagar. A pergunta que vale para qualquer tabela muito escrita é: para cada índice, quem usa, em qual nó e quando foi a última vez?',
    cta: 'Revisar os índices e o custo de escrita do meu banco',
  },
  related: [
    {
      label: 'Índice que o banco decidiu ignorar: quando o plano de consulta muda sozinho',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Chave estrangeira sem índice: a exclusão que trava a tabela inteira',
      to: '/blog/chave-estrangeira-sem-indice-exclusao-que-trava-tabela-inteira',
    },
    {
      label: 'Serviço de arquitetura e modernização backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The orders table of a retail ERP had 210 million rows, 38 GB of data and 22 indexes adding up to 91 GB. At peak it took 3,200 inserts and 5,800 updates per second, and the INSERT p99 had climbed to 19 ms without a single new query. The database produced 2.3 TB of WAL per day, the reporting replica fell up to 40 seconds behind and autovacuum took six hours per pass on that table. Nobody touched the indexes for a concrete reason: eight months earlier, someone had dropped three indexes with idx_scan = 0 on the primary, and the following month-end tax closing, which runs on the replica, went from 3 to 52 minutes and hit statement_timeout. Rebuilding each index took 47 minutes during business hours. This article shows how much every index costs each write, why the counter on the primary is misleading, how to measure real usage over a full cycle and across all nodes, how to find redundant indexes and how to drop them without risking the query that only runs once a month.',
  sections: [
    {
      title: 'The cost that never shows up as a slow query',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An index is not free just because no read uses it. Every insert into the table becomes an insert into every index tree, each with its own WAL record and its own pages competing for room in shared_buffers. Updates are worse: if any indexed column changes, or if the page has no room for the new row version, Postgres cannot perform a HOT update and has to insert a new entry into every index on the table, including the ones unrelated to the column that changed.',
        },
        {
          type: 'paragraph',
          value:
            'In the ERP, the index on atualizado_em had been created for a synchronization job that was switched off a year earlier. Since every order update writes atualizado_em, none of them could be HOT: the HOT update rate on the table was 4%, and every order status change produced 22 index inserts. That cost never appears in pg_stat_statements as a slow query. It is spread across every write, vacuum, the replica and the backup.',
        },
        {
          type: 'table',
          columns: ['Operation', 'What each extra index adds', 'Note'],
          rows: [
            ['INSERT', 'One tree insert, with WAL and pages in cache', 'Grows linearly with the number of indexes'],
            ['UPDATE that changes an indexed column or does not fit in the page', 'A new entry in every index', 'A single index on a frequently updated column disables HOT for the whole table'],
            ['HOT UPDATE', 'Nothing', 'Only happens if no indexed column changes and the page has room'],
            ['DELETE', 'Nothing right away, cleanup later', 'Vacuum has to remove dead entries from every index'],
            ['VACUUM', 'A full scan of the index on every cleanup pass', 'With 22 indexes, the index phase dominated the six hours'],
            ['Replica and backup', 'WAL replay for the index and extra gigabytes in every copy', 'Replica lag and restore time grow together'],
          ],
        },
        {
          type: 'code',
          value: candidatosCode,
        },
        {
          type: 'paragraph',
          value:
            'The first query lists suspects, not culprits. On the ERP primary it returned 9 indexes with idx_scan = 0, totaling 31 GB. Two of them were exactly the ones the tax closing used on the replica. The gap between that list and a list that is safe to drop is what the next sections are about.',
        },
      ],
    },
    {
      title: 'Why idx_scan = 0 on the primary is not enough to drop an index',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The pg_stat_user_indexes counter tracks how many times the index was used in scans since the last reset, on this instance. Every part of that sentence hides a trap, and the removal eight months earlier fell into the first one.',
        },
        {
          type: 'list',
          items: [
            'Statistics are per instance. A read replica keeps its own counters, and the primary has no idea what it read. An index used only by the BI replica shows idx_scan = 0 on the primary even though it is essential.',
            'The counter is reset by pg_stat_reset(), by a crash or immediate shutdown, by pg_upgrade and by restoring a backup. After a failover, the new primary carries the counters it had as a replica. Without checking stats_reset, a "zero" may only mean "zero since yesterday".',
            'The window may be too short. Month-end closing, the yearly audit, personal data exports requested by data subjects and incident scripts run rarely and depend on indexes that go weeks without a single scan.',
            'Indexes that back a PRIMARY KEY, UNIQUE or EXCLUDE constraint enforce a rule. The uniqueness check on insert does not count as a scan, so a unique index can have idx_scan = 0 and still be the only thing preventing duplicate order numbers.',
            'The opposite is misleading too: a high idx_scan does not prove the index is needed. If both (loja_id) and (loja_id, criado_em) exist, the planner uses both and both show up as used, even though the second one alone serves the queries of the first.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'On Postgres 16 or later, the last_idx_scan column shows when the last scan happened and helps separate "never used" from "used at the start of the month". It is still per instance and is still reset along with the counters, so it fixes the time dimension, not the scope.',
        },
      ],
    },
    {
      title: 'Measuring usage over a full cycle and across all nodes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The fix is to turn a point-in-time reading into a series. A daily collector stores each index counter on each node, including every replica that serves reads, and the analysis adds up the increments over the window. The collector fails loudly when it cannot read a node, because a node without data is exactly the kind of gap that turns a used index into a removal candidate.',
        },
        {
          type: 'code',
          value: coletorCode,
        },
        {
          type: 'paragraph',
          value:
            'The analysis compares each sample with the previous one from the same node. When stats_reset changes or the counter goes down, the current value is treated as a full increment, because the counter started over from zero. An index only makes the final list if the sum is zero, every configured node was observed and coverage exceeds 35 days, which guarantees at least one month boundary.',
        },
        {
          type: 'code',
          value: analiseCode,
        },
        {
          type: 'paragraph',
          value:
            'The window depends on the business, not the database. In the ERP, collection ran for 42 days to cover the October closing and the first week of November, when tax calculation runs. For yearly jobs, which no reasonable window covers, the source is different: a catalog of rare queries, built with the people who own tax, audit and data subject requests, which is used in the rehearsal step.',
        },
      ],
    },
    {
      title: 'Redundant indexes: used, but with no reason to exist',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The second source of waste is indexes that are used but already covered by another index. A b-tree on (loja_id, criado_em) serves any query that filters on loja_id alone, because the tree is sorted by that column first. Keeping a separate index on (loja_id) pays for every write twice to get a slightly smaller tree on reads. The query below finds those cases by comparing columns and operator classes as a prefix.',
        },
        {
          type: 'code',
          value: redundantesCode,
        },
        {
          type: 'table',
          columns: ['Situation', 'Example', 'Can it be dropped?'],
          rows: [
            ['Exact duplicate', '(loja_id, criado_em) twice, with different names', 'Yes, one of them; prefer keeping the one that backs a constraint'],
            ['Prefix of a larger index', '(loja_id) and (loja_id, criado_em)', 'Usually yes; the larger one serves the filter and the foreign key check'],
            ['Plain index inside a unique one', 'UNIQUE (numero) and a plain index on (numero)', 'Yes, the plain one; the unique index does both jobs'],
            ['Partial or expression index', '(status) WHERE status = \'pendente\'', 'Not by the query; the predicate changes what the index serves'],
            ['Same column, different method', 'b-tree and GIN with pg_trgm on (descricao)', 'No; they serve different operators'],
            ['Same columns, different order', '(criado_em, loja_id) and (loja_id, criado_em)', 'Not automatically; they serve different filters and sorts'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'In the ERP, the query flagged three prefix indexes and one exact duplicate created by two migrations from different teams, with different names, in the same quarter. Redundant indexes also go through the rehearsal in the next section: the larger tree is usually only slightly slower, but a very frequent query that relies on an index-only scan can lose that advantage if the larger index is much wider.',
        },
      ],
    },
    {
      title: 'Dropping without risk: hide, rehearse and keep a way back',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Postgres has no native invisible index, but the hypopg extension can hide an index from the planner within a session. That saves no writes, since the index is still maintained, but it lets you run EXPLAIN for each rare query in the catalog as if the index did not exist, without affecting any other connection. The rehearsal happens on a restored copy with real volume, where a bad plan costs nothing.',
        },
        {
          type: 'code',
          value: remocaoCode,
        },
        {
          type: 'ordered',
          items: [
            'Classify: an index that backs a constraint stays, unless the constraint itself is reconsidered. An index used on any node during the window stays or moves to the redundancy analysis.',
            'Rehearse: run EXPLAIN for every query in the rare catalog with the index hidden. If the plan swaps an index scan for a sequential scan on a large table, the index stays and gets a comment saying who uses it.',
            'Keep a way back: version the output of pg_get_indexdef and measure on the copy how long CREATE INDEX CONCURRENTLY takes. That number defines the worst case of a wrong removal.',
            'Drop one at a time, with DROP INDEX CONCURRENTLY and lock_timeout, off peak and away from closing week. Dropping in batches makes it impossible to tell which removal caused a regression.',
            'Watch a full cycle: track the mean time of the main queries in pg_stat_statements, the table seq_scan in pg_stat_user_tables and the plans logged by auto_explain for queries above a threshold.',
            'If there is a regression, rebuild from the saved definition and check indisvalid, because a failed CREATE INDEX CONCURRENTLY leaves behind an invalid index that still costs writes.',
          ],
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'The lock_timeout is not a detail. DROP INDEX CONCURRENTLY does not block reads or writes during the removal, but it has to wait for transactions that are using the table. A forgotten open transaction can leave the command waiting, and any DDL behind it lines up in the queue. With the timeout, the command gives up and can be retried later.',
        },
      ],
    },
    {
      title: 'The result and the rule that keeps indexes from piling up again',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Of the 22 indexes, 9 were dropped over three weeks, one per business day: five unused on all three nodes for 42 days, three redundant by prefix and the exact duplicate. The two indexes the tax closing uses on the replica stayed, now with a comment, and the unique index on numero_pedido stayed despite idx_scan = 0. No removal had to be reverted.',
        },
        {
          type: 'table',
          columns: ['Metric', 'Before', 'After'],
          rows: [
            ['Indexes on the orders table', '22 (91 GB)', '13 (49 GB)'],
            ['INSERT p99 at peak', '19 ms', '9 ms'],
            ['HOT updates', '4%', '57%'],
            ['WAL generated per day', '2.3 TB', '1.4 TB'],
            ['Maximum reporting replica lag', '40 s', '6 s'],
            ['Table autovacuum duration', '6 h', '2 h 40 min'],
            ['Tax closing on the replica', '3 min', '3 min'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The jump in HOT updates came almost entirely from dropping the index on atualizado_em, and that was also the change that cut WAL the most. To keep the table from piling up indexes again, the team adopted three simple rules:',
        },
        {
          type: 'list',
          items: [
            'Every new index arrives through a migration with COMMENT ON INDEX stating which query it serves and which team owns it, which turns "nobody knows what it is for" into a question with an addressee.',
            'Migration review runs the redundancy query against the schema with the new index, before the merge.',
            'The collector stays on, and every quarter the list of indexes unused on all nodes becomes a task with an owner, instead of a heroic cleanup every two years.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can I disable the index with UPDATE pg_index SET indisvalid = false before dropping it?',
      answer:
        'It is not a good idea. Editing the catalog directly requires superuser, is unsupported and is not available on most managed databases. On top of that, with indisready still true the index keeps being maintained on every write, so you measure the risk but not the gain. To test the planner without the index, use hypopg_hide_index in a session; to measure the write gain, the only way is to actually drop it, with the definition saved so it can be rebuilt.',
    },
    {
      question: 'What is the minimum observation window before dropping an index?',
      answer:
        'A full business cycle, including the rarest process you can reasonably wait for. For most systems that means at least one month boundary, between 35 and 45 days, with every read node collected. Whatever runs once a year does not fit in any reasonable window and has to be in the rare query catalog, which is rehearsed with the index hidden before the removal.',
    },
    {
      question: 'Can a unique index with idx_scan = 0 be dropped?',
      answer:
        'Not based on usage statistics. The uniqueness check performed on every insert does not increment idx_scan, so a zero counter only says no query used it to read, not that the rule is expendable. If uniqueness is no longer required, that is a data model decision made with the product team, and what gets dropped is the constraint, not the index. If it is still required, the index stays, and what can go is a redundant plain index on the same columns.',
    },
  ],
  conclusion: {
    title: 'An index is a fixed cost on every write',
    description:
      'The orders table was not slow for lack of indexes but for having too many: nine trees maintained on every write to serve queries that no longer existed or that another index already served. The earlier removal went wrong because it trusted a counter from one instance and one period, and the fix was to replace that reading with a series across all nodes, a catalog of rare queries, a rehearsal with the index hidden and a measured way back before dropping anything. The question worth asking of any write-heavy table is: for each index, who uses it, on which node, and when was the last time?',
    cta: 'Review the indexes and write cost of my database',
  },
  related: [
    {
      label: 'The index the database decided to ignore: when the query plan changes on its own',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Foreign key without an index: the delete that locks the whole table',
      to: '/blog/chave-estrangeira-sem-indice-exclusao-que-trava-tabela-inteira',
    },
    {
      label: 'Backend architecture and modernization service',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'La tabla de pedidos de un ERP para retail tenía 210 millones de filas, 38 GB de datos y 22 índices que sumaban 91 GB. En el pico recibía 3.200 inserciones y 5.800 actualizaciones por segundo, y el p99 del INSERT había subido a 19 ms sin ninguna consulta nueva. La base generaba 2,3 TB de WAL por día, la réplica de reportes llegaba a 40 segundos de retraso y el autovacuum de la tabla tardaba seis horas por pasada. Nadie tocaba los índices por un motivo concreto: ocho meses antes, alguien había eliminado tres índices con idx_scan = 0 en el primario, y el cierre fiscal del mes siguiente, que corre en la réplica, pasó de 3 a 52 minutos y superó el statement_timeout. Recrear cada índice tomó 47 minutos en horario laboral. Este artículo muestra cuánto cuesta cada índice en toda escritura, por qué el contador del primario engaña, cómo medir el uso real durante un ciclo completo y en todos los nodos, cómo encontrar índices redundantes y cómo eliminarlos sin arriesgar la consulta que solo corre una vez al mes.',
  sections: [
    {
      title: 'El costo que no aparece en ninguna consulta lenta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un índice no es gratis solo porque ninguna lectura lo use. Cada inserción en la tabla se convierte en una inserción en cada árbol de índice, cada una con su registro de WAL y sus páginas compitiendo por espacio en shared_buffers. La actualización es peor: si cualquier columna indexada cambia, o si no hay espacio en la página para la nueva versión de la fila, Postgres no puede hacer un update HOT y tiene que insertar una entrada nueva en todos los índices de la tabla, incluso en los que no tienen relación con la columna modificada.',
        },
        {
          type: 'paragraph',
          value:
            'En el ERP, el índice en atualizado_em se había creado para un job de sincronización desactivado hacía un año. Como toda actualización de pedido escribe atualizado_em, ninguna podía ser HOT: la tasa de updates HOT de la tabla era del 4%, y cada cambio de estado de un pedido generaba 22 inserciones en índices. Ese costo no aparece en pg_stat_statements como una consulta lenta. Se reparte entre todas las escrituras, el vacuum, la réplica y el backup.',
        },
        {
          type: 'table',
          columns: ['Operación', 'Lo que agrega cada índice extra', 'Observación'],
          rows: [
            ['INSERT', 'Una inserción en el árbol, con WAL y páginas en caché', 'Crece linealmente con la cantidad de índices'],
            ['UPDATE que cambia una columna indexada o no cabe en la página', 'Una entrada nueva en todos los índices', 'Un solo índice en una columna muy actualizada apaga el HOT de toda la tabla'],
            ['UPDATE HOT', 'Nada', 'Solo ocurre si ninguna columna indexada cambia y hay espacio en la página'],
            ['DELETE', 'Nada en el momento, limpieza después', 'El vacuum tiene que quitar las entradas muertas de cada índice'],
            ['VACUUM', 'Un recorrido completo del índice en cada pasada de limpieza', 'Con 22 índices, la fase de índices dominaba las seis horas'],
            ['Réplica y backup', 'Replay del WAL del índice y gigabytes extra en cada copia', 'El retraso de la réplica y el tiempo de restauración crecen juntos'],
          ],
        },
        {
          type: 'code',
          value: candidatosCode,
        },
        {
          type: 'paragraph',
          value:
            'La primera consulta lista sospechosos, no culpables. En el primario del ERP devolvió 9 índices con idx_scan = 0, que sumaban 31 GB. Dos de ellos eran justamente los que el cierre fiscal usaba en la réplica. La diferencia entre esa lista y una lista segura para eliminar es el tema de las próximas secciones.',
        },
      ],
    },
    {
      title: 'Por qué idx_scan = 0 en el primario no alcanza para eliminar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El contador de pg_stat_user_indexes cuenta cuántas veces se usó el índice en lecturas desde el último reset, en esta instancia. Cada parte de esa frase esconde una trampa, y la eliminación de ocho meses antes cayó en la primera.',
        },
        {
          type: 'list',
          items: [
            'Las estadísticas son por instancia. Una réplica de lectura mantiene sus propios contadores, y el primario no sabe qué leyó. Un índice usado solo por la réplica de BI aparece con idx_scan = 0 en el primario aunque sea esencial.',
            'El contador se reinicia con pg_stat_reset(), con un crash o un apagado inmediato, con pg_upgrade y al restaurar un backup. Después de un failover, el nuevo primario trae los contadores que tenía como réplica. Sin mirar stats_reset, un "cero" puede significar solo "cero desde ayer".',
            'La ventana puede ser demasiado corta. El cierre mensual, la auditoría anual, la exportación de datos personales pedida por el titular y los scripts de incidente corren rara vez y dependen de índices que pasan semanas sin una sola lectura.',
            'Los índices que sostienen PRIMARY KEY, UNIQUE o EXCLUDE aplican una regla. La verificación de unicidad en la inserción no cuenta como lectura, así que un índice único puede tener idx_scan = 0 y ser lo único que impide números de pedido duplicados.',
            'Lo contrario también engaña: un idx_scan alto no prueba que el índice sea necesario. Si existen (loja_id) y (loja_id, criado_em), el planificador usa los dos y los dos aparecen como usados, aunque el segundo atienda por sí solo las consultas del primero.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'En Postgres 16 o superior, la columna last_idx_scan muestra el momento de la última lectura y ayuda a separar "nunca usado" de "usado a principio de mes". Sigue siendo por instancia y se reinicia junto con los contadores, así que resuelve la dimensión del tiempo, no la del alcance.',
        },
      ],
    },
    {
      title: 'Medir el uso durante un ciclo completo y en todos los nodos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La corrección es convertir una lectura puntual en una serie. Un recolector diario guarda el contador de cada índice en cada nodo, incluidas todas las réplicas que reciben lecturas, y el análisis suma los incrementos de la ventana. El recolector falla de forma visible cuando no puede leer un nodo, porque un nodo sin datos es justamente el tipo de hueco que convierte un índice usado en candidato a eliminación.',
        },
        {
          type: 'code',
          value: coletorCode,
        },
        {
          type: 'paragraph',
          value:
            'El análisis compara cada muestra con la anterior del mismo nodo. Cuando stats_reset cambia o el contador disminuye, el valor actual se trata como incremento completo, porque el contador empezó de nuevo desde cero. Un índice solo entra en la lista final si la suma es cero, si todos los nodos configurados fueron observados y si la cobertura supera los 35 días, lo que garantiza al menos un cambio de mes.',
        },
        {
          type: 'code',
          value: analiseCode,
        },
        {
          type: 'paragraph',
          value:
            'La ventana depende del negocio, no de la base. En el ERP, la recolección quedó activa 42 días para cubrir el cierre de octubre y la primera semana de noviembre, cuando corre el cálculo de impuestos. Para los jobs anuales, que ninguna ventana razonable cubre, la fuente es otra: un catálogo de consultas raras, armado con quienes se ocupan de lo fiscal, la auditoría y las solicitudes de los titulares de datos, que se usa en la etapa de ensayo.',
        },
      ],
    },
    {
      title: 'Índices redundantes: los que se usan pero no necesitan existir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La segunda fuente de desperdicio son índices usados que otro índice ya atiende. Un b-tree en (loja_id, criado_em) sirve cualquier consulta que filtre solo por loja_id, porque el árbol está ordenado primero por esa columna. Mantener además un índice solo en (loja_id) paga cada escritura dos veces para ganar un árbol un poco más chico en la lectura. La consulta de abajo encuentra esos casos comparando columnas y clases de operador como prefijo.',
        },
        {
          type: 'code',
          value: redundantesCode,
        },
        {
          type: 'table',
          columns: ['Situación', 'Ejemplo', '¿Se puede eliminar?'],
          rows: [
            ['Duplicado exacto', '(loja_id, criado_em) dos veces, con nombres distintos', 'Sí, uno de ellos; conviene conservar el que sostiene una restricción'],
            ['Prefijo de un índice mayor', '(loja_id) y (loja_id, criado_em)', 'En general sí; el mayor atiende el filtro y la verificación de la clave foránea'],
            ['Índice común dentro de uno único', 'UNIQUE (numero) e índice común en (numero)', 'Sí, el común; el único cumple los dos papeles'],
            ['Parcial o con expresión', '(status) WHERE status = \'pendente\'', 'No por la consulta; el predicado cambia lo que atiende el índice'],
            ['Misma columna, otro método', 'b-tree y GIN con pg_trgm en (descricao)', 'No; atienden operadores distintos'],
            ['Mismas columnas, otro orden', '(criado_em, loja_id) y (loja_id, criado_em)', 'No automáticamente; sirven filtros y ordenamientos distintos'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'En el ERP, la consulta señaló tres índices de prefijo y un duplicado exacto creado por dos migraciones de equipos distintos, con nombres distintos, en el mismo trimestre. Los redundantes también pasan por el ensayo de la próxima sección: el árbol mayor suele ser apenas más lento, pero una consulta muy frecuente que usa index-only scan puede perder esa ventaja si el índice mayor es mucho más ancho.',
        },
      ],
    },
    {
      title: 'Eliminar sin riesgo: ocultar, ensayar y guardar la vuelta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Postgres no tiene índices invisibles nativos, pero la extensión hypopg permite ocultar un índice del planificador dentro de una sesión. Eso no ahorra ninguna escritura, porque el índice se sigue manteniendo, pero permite correr el EXPLAIN de cada consulta rara del catálogo como si el índice no existiera, sin afectar ninguna otra conexión. El ensayo se hace en una copia restaurada con volumen real, donde un plan malo no cuesta nada.',
        },
        {
          type: 'code',
          value: remocaoCode,
        },
        {
          type: 'ordered',
          items: [
            'Clasificar: el índice que sostiene una restricción se queda, salvo que se revise la restricción misma. El índice usado en cualquier nodo durante la ventana se queda o pasa al análisis de redundancia.',
            'Ensayar: correr el EXPLAIN de cada consulta del catálogo de raras con el índice oculto. Si el plan cambia una lectura por índice por un recorrido secuencial en una tabla grande, el índice se queda y recibe un comentario que indica quién lo usa.',
            'Guardar la vuelta: versionar el resultado de pg_get_indexdef y medir en la copia cuánto tarda el CREATE INDEX CONCURRENTLY. Ese número define el peor caso de una eliminación equivocada.',
            'Eliminar de a uno, con DROP INDEX CONCURRENTLY y lock_timeout, fuera del pico y lejos de la semana de cierre. Eliminar en lote hace imposible saber qué eliminación causó una regresión.',
            'Observar un ciclo: seguir el tiempo medio de las consultas principales en pg_stat_statements, el seq_scan de la tabla en pg_stat_user_tables y los planes registrados por auto_explain para consultas por encima de un umbral.',
            'Si hay regresión, recrear con la definición guardada y verificar indisvalid, porque un CREATE INDEX CONCURRENTLY que falla deja un índice inválido que sigue costando escrituras.',
          ],
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'El lock_timeout no es un detalle. DROP INDEX CONCURRENTLY no bloquea lecturas ni escrituras durante la eliminación, pero tiene que esperar a las transacciones que están usando la tabla. Una transacción olvidada abierta puede dejar el comando esperando, y cualquier DDL que venga detrás queda en la cola. Con el tiempo límite, el comando desiste y se puede reintentar después.',
        },
      ],
    },
    {
      title: 'El resultado y la regla para no volver a acumular',
      blocks: [
        {
          type: 'paragraph',
          value:
            'De los 22 índices, 9 salieron en tres semanas, uno por día hábil: cinco sin uso en ninguno de los tres nodos durante 42 días, tres redundantes por prefijo y el duplicado exacto. Los dos índices que el cierre fiscal usa en la réplica se quedaron, ahora con comentario, y el índice único en numero_pedido se quedó a pesar del idx_scan = 0. Ninguna eliminación tuvo que revertirse.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Antes', 'Después'],
          rows: [
            ['Índices en la tabla de pedidos', '22 (91 GB)', '13 (49 GB)'],
            ['p99 del INSERT en el pico', '19 ms', '9 ms'],
            ['Updates HOT', '4%', '57%'],
            ['WAL generado por día', '2,3 TB', '1,4 TB'],
            ['Retraso máximo de la réplica de reportes', '40 s', '6 s'],
            ['Duración del autovacuum de la tabla', '6 h', '2 h 40 min'],
            ['Cierre fiscal en la réplica', '3 min', '3 min'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El salto en los updates HOT vino casi por completo de eliminar el índice en atualizado_em, y fue ese cambio el que más redujo el WAL. Para que la tabla no volviera a acumular índices, el equipo adoptó tres reglas simples:',
        },
        {
          type: 'list',
          items: [
            'Todo índice nuevo entra por migración con COMMENT ON INDEX que indica qué consulta atiende y qué equipo es dueño, lo que convierte "nadie sabe para qué sirve" en una pregunta con destinatario.',
            'La revisión de migraciones corre la consulta de redundancia contra el esquema con el índice nuevo, antes del merge.',
            'El recolector sigue activo, y cada trimestre la lista de índices sin uso en todos los nodos se convierte en una tarea con dueño, en lugar de una limpieza heroica cada dos años.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Puedo desactivar el índice con UPDATE pg_index SET indisvalid = false antes de eliminarlo?',
      answer:
        'No es buena idea. Modificar el catálogo directamente exige superusuario, no tiene soporte y no está disponible en la mayoría de las bases gestionadas. Además, con indisready todavía verdadero, el índice se sigue manteniendo en cada escritura, así que se mide el riesgo pero no la ganancia. Para probar el planificador sin el índice, conviene usar hypopg_hide_index en una sesión; para medir la ganancia en escritura, la única forma es eliminarlo de verdad, con la definición guardada para recrearlo.',
    },
    {
      question: '¿Cuál es la ventana mínima de observación antes de eliminar un índice?',
      answer:
        'Un ciclo completo del negocio, incluido el proceso más raro que se pueda esperar. Para la mayoría de los sistemas, eso significa al menos un cambio de mes, entre 35 y 45 días, con todos los nodos de lectura recolectados. Lo que corre una vez al año no entra en ninguna ventana razonable y tiene que estar en el catálogo de consultas raras, que se ensaya con el índice oculto antes de la eliminación.',
    },
    {
      question: '¿Se puede eliminar un índice único con idx_scan = 0?',
      answer:
        'No a partir de la estadística de uso. La verificación de unicidad que se hace en cada inserción no incrementa idx_scan, así que el contador en cero solo dice que ninguna consulta lo usó para leer, no que la regla sea prescindible. Si la unicidad ya no es necesaria, es una decisión de modelo de datos que se toma con el equipo de producto, y lo que se elimina es la restricción, no el índice. Si sigue siendo necesaria, el índice se queda, y lo que puede salir es algún índice común redundante sobre las mismas columnas.',
    },
  ],
  conclusion: {
    title: 'Un índice es un costo fijo en cada escritura',
    description:
      'La tabla de pedidos no estaba lenta por falta de índices, sino por exceso: nueve árboles mantenidos en cada escritura para atender consultas que ya no existían o que otro índice ya atendía. La eliminación anterior salió mal porque confió en un contador de una instancia y de un período, y la corrección fue reemplazar esa lectura por una serie en todos los nodos, un catálogo de consultas raras, un ensayo con el índice oculto y una vuelta medida antes de eliminar nada. La pregunta que vale para cualquier tabla con muchas escrituras es: para cada índice, ¿quién lo usa, en qué nodo y cuándo fue la última vez?',
    cta: 'Revisar los índices y el costo de escritura de mi base',
  },
  related: [
    {
      label: 'El índice que la base decidió ignorar: cuándo el plan de consulta cambia solo',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Clave foránea sin índice: el borrado que bloquea la tabla entera',
      to: '/blog/chave-estrangeira-sem-indice-exclusao-que-trava-tabela-inteira',
    },
    {
      label: 'Servicio de arquitectura y modernización backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
