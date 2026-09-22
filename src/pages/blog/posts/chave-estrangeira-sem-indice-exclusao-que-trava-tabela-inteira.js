// Conteudo do artigo: chave estrangeira sem indice na tabela filha e a exclusao
// no pai que varre a filha inteira por linha e acaba travando a tabela.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O job de expurgo roda todo dia às nove e meia, apaga os pedidos cancelados há mais de noventa dias e sempre terminou em três minutos. Numa terça-feira ele levou cinquenta e três, e às dez e cinco um deploy rotineiro que adicionava uma coluna na tabela de histórico de status derrubou o checkout por dezoito minutos. Ninguém mexeu no job, ninguém mexeu na consulta e o plano do DELETE era o mesmo de sempre. O que mudou foi o tamanho de uma tabela que nem aparece no comando: a filha, que referencia o pedido por uma chave estrangeira sem índice. Este artigo mostra por que excluir uma linha no pai obriga o banco a varrer a filha inteira, por que esse custo cresce mais rápido que o negócio e nunca aparece em homologação, como uma exclusão lenta vira a tabela inteira parada quando entra um comando de esquema na fila, como encontrar pelo catálogo todas as chaves estrangeiras sem índice antes do incidente, como criar o índice em produção sem causar o bloqueio que você quer evitar, e quando é legítimo deixar uma chave estrangeira sem índice, desde que a decisão fique escrita e verificada no CI.',
  sections: [
    {
      title: 'O job que rodava em três minutos e passou a levar cinquenta e três',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira investigação quase sempre vai para o lugar errado. O time abre o comando do expurgo, roda o EXPLAIN, vê uma busca por índice em pedidos filtrando por status e data, com custo baixo e estimativa de duas mil linhas, e conclui que o problema não está ali. O plano está certo. O que o plano do DELETE não mostra é o trabalho que acontece depois de cada linha removida, fora do comando que você escreveu, nos gatilhos internos que o banco usa para garantir a integridade referencial.',
        },
        {
          type: 'paragraph',
          value:
            'No PostgreSQL, cada chave estrangeira é implementada por gatilhos de sistema. Quando uma linha de pedidos é excluída, o gatilho da restrição executa, para aquela linha, uma consulta na tabela filha procurando registros que apontam para o pedido removido: um DELETE se a restrição for ON DELETE CASCADE, um UPDATE se for SET NULL, ou uma verificação de existência se for NO ACTION ou RESTRICT. Se a coluna da filha tem índice, essa consulta é uma busca de microssegundos. Se não tem, é uma varredura sequencial da filha inteira. Por linha excluída no pai.',
        },
        {
          type: 'paragraph',
          value:
            'É aí que está o detalhe que engana: o banco cria índice automaticamente para a chave primária e para restrições UNIQUE, que é o lado referenciado, mas não cria nada na coluna que referencia. Declarar a chave estrangeira garante a integridade, não o desempenho de mantê-la. No caso do incidente, a tabela historico_status tinha índice por data para relatórios e nenhum por pedido_id, porque nenhuma tela buscava histórico por pedido no caminho quente. A restrição existia há três anos, com ON DELETE CASCADE, e cada exclusão de pedido pagava uma leitura completa de uma tabela que crescia mais rápido que qualquer outra do sistema.',
        },
        {
          type: 'diagram',
          value: `Custo do expurgo diario (2.000 pedidos cancelados por dia):

  ano 1: historico_status com 2 milhoes de linhas
    2.000 exclusoes x 1 varredura de 2 mi de linhas (~80 ms)  = ~3 min

  ano 3: historico_status com 40 milhoes de linhas
    2.000 exclusoes x 1 varredura de 40 mi de linhas (~1,6 s) = ~53 min

  com indice em historico_status (pedido_id), em qualquer ano:
    2.000 exclusoes x 1 busca no indice (~0,05 ms)            = ~0,1 s

Custo = (linhas excluidas no pai) x (tamanho da tabela filha)
Os dois fatores crescem com o negocio: o tempo cresce com o produto.`,
        },
        {
          type: 'paragraph',
          value:
            'A multiplicação explica por que o problema nunca aparece cedo. Em homologação, a filha tem dez mil linhas, a varredura cabe em memória e custa menos de um milissegundo. Nos primeiros meses de produção, o expurgo leva segundos. A degradação é contínua e silenciosa, sem um degrau que dispare alerta, até o dia em que o tempo do job ultrapassa alguma coisa que importa: a janela de manutenção, o intervalo do agendador, o timeout de uma migração ou a paciência do pool de conexões.',
        },
        {
          type: 'paragraph',
          value:
            'Há uma consequência ainda menos intuitiva. Com NO ACTION, que é o padrão quando ninguém escreve nada, excluir um pedido que não tem nenhuma linha na filha custa exatamente a mesma varredura completa. O banco precisa provar a ausência, e sem índice a única forma de provar que nenhuma das quarenta milhões de linhas aponta para aquele pedido é ler todas elas.',
        },
      ],
    },
    {
      title: 'O que o banco faz por baixo quando você exclui a linha pai',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A forma mais rápida de confirmar o diagnóstico é o EXPLAIN ANALYZE do próprio DELETE. Ele executa o comando de verdade, então precisa rodar dentro de uma transação que termina em ROLLBACK, e de preferência em uma cópia restaurada do banco, porque mesmo revertido ele segura os bloqueios pelo tempo inteiro da execução. O que interessa não é o plano, e sim as linhas de gatilho que aparecem no final da saída, com o tempo acumulado e o número de chamadas de cada restrição.',
        },
        {
          type: 'code',
          value: `-- Rodar numa copia restaurada: EXPLAIN ANALYZE executa o DELETE de verdade
-- e segura os bloqueios ate o ROLLBACK.
BEGIN;

EXPLAIN (ANALYZE, BUFFERS)
DELETE FROM pedidos
WHERE status = 'cancelado'
  AND atualizado_em < now() - interval '90 days';

ROLLBACK;

-- Saida resumida:
--  Delete on pedidos (actual time=41.2..41.2 rows=0 loops=1)
--    ->  Index Scan using pedidos_status_atualizado_idx on pedidos
--          (actual time=0.03..8.9 rows=2000 loops=1)
--  Planning Time: 0.4 ms
--  Trigger for constraint historico_status_pedido_id_fkey: time=3171840.5 calls=2000
--  Trigger for constraint pagamentos_pedido_id_fkey: time=96.1 calls=2000
--  Execution Time: 3171990.3 ms
--
-- O DELETE em si levou 41 ms. Os 53 minutos estao inteiros em uma restricao:
-- 2.000 chamadas, cerca de 1,6 s cada, uma varredura de historico_status por
-- pedido. A restricao de pagamentos tem indice e custa 96 ms no total.`,
        },
        {
          type: 'paragraph',
          value:
            'A comparação entre as duas linhas de gatilho é o que fecha o caso sem discussão. As duas restrições recebem o mesmo número de chamadas, uma por pedido removido, e a diferença de quatro ordens de grandeza no tempo vem só da existência do índice. Quando não dá para rodar o EXPLAIN ANALYZE, o sintoma aparece também nas estatísticas: o contador seq_scan da tabela filha em pg_stat_user_tables sobe em milhares durante a janela do job, e seq_tup_read acompanha na casa dos bilhões.',
        },
        {
          type: 'paragraph',
          value:
            'O comportamento varia entre motores, e a variação importa para quem opera mais de um banco ou migra entre eles. Quem vem do MySQL costuma não conhecer o problema porque o InnoDB exige um índice na coluna da chave estrangeira e cria um automaticamente se não houver. Quem vem do Oracle conhece a versão mais agressiva dele, em que a falta de índice faz a exclusão no pai bloquear a tabela filha inteira durante o comando.',
        },
        {
          type: 'table',
          columns: ['Motor', 'Cria índice na coluna filha?', 'Exclusão no pai sem índice na filha', 'Como o travamento aparece'],
          rows: [
            [
              'PostgreSQL',
              'Não',
              'Uma varredura sequencial da filha por linha excluída, dentro da mesma transação',
              'Transação longa segurando bloqueios; comando de esquema na fila congela todo acesso à tabela',
            ],
            [
              'MySQL (InnoDB)',
              'Sim, exige índice e cria um se faltar',
              'Busca pelo índice; o risco migra para cascatas enormes em uma única transação',
              'Bloqueios de linha e de intervalo acumulados pela cascata',
            ],
            [
              'SQL Server',
              'Não',
              'Varredura da filha para cada verificação ou cascata',
              'Milhares de bloqueios de linha escalam para bloqueio da tabela inteira',
            ],
            [
              'Oracle',
              'Não',
              'Bloqueio de tabela compartilhado na filha durante o comando',
              'Qualquer escrita na filha espera, mesmo em linhas sem relação com a exclusão',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O mesmo mecanismo dispara em mais situações do que a exclusão explícita. Um UPDATE que troca o valor da chave primária do pai executa a mesma busca na filha. ON DELETE SET NULL faz um UPDATE na filha por linha do pai, com a mesma varredura. E um expurgo por LGPD, que remove um cliente com cascata para pedidos, que por sua vez cascateia para histórico, pagamentos e eventos, multiplica o problema por cada nível da árvore em que falta índice.',
        },
      ],
    },
    {
      title: 'Como uma exclusão lenta vira a tabela inteira travada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No PostgreSQL, uma exclusão lenta por si só não bloqueia a tabela filha para todo mundo. Ela segura bloqueios de linha nos pedidos removidos, bloqueios de linha nas linhas de histórico que a cascata apaga e um bloqueio ROW EXCLUSIVE nas tabelas envolvidas, que convive com leituras e com outras escritas. Por cinquenta e três minutos isso é um desperdício de disco e de CPU, não uma queda. O que transforma a lentidão em indisponibilidade é o segundo participante: qualquer comando que precise de um bloqueio forte na mesma tabela.',
        },
        {
          type: 'paragraph',
          value:
            'Um ALTER TABLE que adiciona coluna, mesmo sendo uma operação instantânea de metadados, pede ACCESS EXCLUSIVE, o modo que conflita com todos os outros. Ele entra na fila atrás da transação do expurgo e espera. O problema é que a fila de bloqueios é ordenada: todo pedido de bloqueio que chega depois e conflita com o ACCESS EXCLUSIVE pendente fica atrás dele, inclusive um simples INSERT, que sozinho seria compatível com o expurgo. A partir desse instante, a tabela está travada para qualquer acesso, e ela fica assim até o expurgo terminar e a migração rodar.',
        },
        {
          type: 'diagram',
          value: `09:30  expurgo      BEGIN; DELETE FROM pedidos ...
                     ROW EXCLUSIVE em historico_status, dura 53 min
10:05  migracao     ALTER TABLE historico_status ADD COLUMN origem text
                     pede ACCESS EXCLUSIVE -> espera o expurgo
10:05  checkout #1  INSERT INTO historico_status ... -> espera a migracao
10:05  checkout #2  INSERT INTO historico_status ... -> espera a migracao
  ...               toda mudanca de status do sistema entra na fila
10:06  pool de conexoes esgotado, checkout responde 503
10:23  expurgo faz COMMIT -> migracao roda em 40 ms -> fila escoa

Nenhum dos tres comandos e lento sozinho, exceto o expurgo.
A queda nasce da combinacao: transacao longa + bloqueio forte na fila.`,
        },
        {
          type: 'paragraph',
          value:
            'Existe um efeito colateral mais lento e que continua depois do incidente. Uma transação aberta por quase uma hora impede o autovacuum de limpar versões mortas de linhas em todo o banco, não só nas tabelas envolvidas, porque o horizonte de visibilidade fica preso no início dela. Tabelas com alta taxa de atualização incham durante a janela e as consultas ficam mais lentas nas horas seguintes, o que costuma ser investigado como um segundo problema sem relação.',
        },
        {
          type: 'paragraph',
          value:
            'Quando o travamento está acontecendo, a pergunta útil não é qual consulta está lenta, e sim quem está esperando quem. A função pg_blocking_pids devolve, para cada sessão, as sessões que a bloqueiam, e cruzar isso com os bloqueios não concedidos mostra a cadeia inteira em uma consulta. O padrão do incidente é inconfundível: centenas de sessões esperando uma única sessão de migração, que por sua vez espera uma única transação antiga.',
        },
        {
          type: 'code',
          value: `-- Quem espera quem, com a idade da transacao e o modo de bloqueio pedido.
SELECT
  a.pid,
  pg_blocking_pids(a.pid)   AS bloqueado_por,
  now() - a.xact_start      AS idade_transacao,
  l.mode                    AS modo_pedido,
  l.relation::regclass      AS tabela,
  left(a.query, 60)         AS consulta
FROM pg_stat_activity a
LEFT JOIN pg_locks l
  ON l.pid = a.pid AND NOT l.granted
WHERE cardinality(pg_blocking_pids(a.pid)) > 0
ORDER BY a.xact_start;

-- Resultado tipico do incidente:
--   pid  | bloqueado_por | idade_transacao | modo_pedido         | consulta
--   8812 | {7710}        | 00:18:02        | AccessExclusiveLock | ALTER TABLE historico_status ...
--   9031 | {8812}        | 00:00:41        | RowExclusiveLock    | INSERT INTO historico_status ...
--   9044 | {8812}        | 00:00:39        | RowExclusiveLock    | INSERT INTO historico_status ...
--   (mais 212 linhas bloqueadas por 8812)
--
-- 7710 e o expurgo. Cancelar a migracao (pg_cancel_backend(8812)) libera
-- a fila em segundos; o expurgo pode continuar enquanto o indice nao existe.`,
        },
        {
          type: 'paragraph',
          value:
            'A mitigação imediata é cancelar a migração, não o expurgo. Cancelar o expurgo depois de cinquenta minutos joga fora todo o trabalho e o rollback de uma exclusão grande também leva tempo. Cancelar a migração libera a fila em segundos, e ela pode ser repetida depois. A prevenção estrutural para esse lado do problema é independente do índice: toda migração que pede bloqueio forte deve rodar com lock_timeout curto, de três a cinco segundos, e com retentativa. Uma migração que desiste depois de cinco segundos esperando é um aviso no log do deploy; uma que espera indefinidamente é uma queda.',
        },
      ],
    },
    {
      title: 'Encontrar todas as chaves estrangeiras sem índice antes do incidente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Esperar o próximo job lento para descobrir a próxima restrição sem índice é a estratégia que mantém o problema vivo. O catálogo do banco tem toda a informação necessária para listar, de uma vez, cada chave estrangeira cuja tabela filha não tem um índice capaz de atender a busca da restrição. O critério correto é mais estrito do que parece: não basta existir um índice que contenha a coluna.',
        },
        {
          type: 'list',
          items: [
            'O índice precisa começar pelas colunas da chave estrangeira. Um índice em (criado_em, pedido_id) não serve para buscar por pedido_id, porque a coluna não é a primeira.',
            'Em chave composta, as colunas da restrição precisam ocupar as primeiras posições do índice, em qualquer ordem entre elas. Um índice só por tenant_id não atende uma restrição em (tenant_id, pedido_id) em uma tabela com milhões de linhas por inquilino.',
            'Índice parcial não conta. Um índice em pedido_id WHERE ativo não é usado pela consulta interna da restrição, que não tem esse filtro.',
            'Índice inválido não conta. Uma criação concorrente que falhou deixa o índice no catálogo, ocupando espaço e custando escrita, sem ser usado por nenhuma consulta.',
            'Colunas incluídas com INCLUDE não contam como chave de busca, só as colunas-chave do índice.',
          ],
        },
        {
          type: 'code',
          value: `-- fk-sem-indice.sql
-- Chaves estrangeiras cuja tabela filha nao tem indice valido, nao parcial,
-- que comece exatamente pelas colunas da restricao. Ordenado pelo tamanho da
-- filha, que e o que define o custo de cada varredura.
SELECT
  c.conrelid::regclass  AS tabela_filha,
  c.conname             AS restricao,
  c.confrelid::regclass AS tabela_pai,
  (SELECT string_agg(a.attname, ', ' ORDER BY k.pos)
     FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, pos)
     JOIN pg_attribute a
       ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS colunas,
  CASE c.confdeltype
    WHEN 'c' THEN 'cascade'
    WHEN 'n' THEN 'set null'
    WHEN 'd' THEN 'set default'
    WHEN 'r' THEN 'restrict'
    ELSE 'no action'
  END AS ao_excluir,
  pg_size_pretty(pg_relation_size(c.conrelid)) AS tamanho_filha
FROM pg_constraint c
WHERE c.contype = 'f'
  AND NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = c.conrelid
      AND i.indisvalid
      AND i.indpred IS NULL
      AND i.indnkeyatts >= cardinality(c.conkey)
      -- As N primeiras colunas do indice sao exatamente as N colunas da FK.
      AND (SELECT array_agg(x.attnum ORDER BY x.attnum)
             FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS x(attnum, pos)
            WHERE x.pos <= cardinality(c.conkey))
        = (SELECT array_agg(y ORDER BY y) FROM unnest(c.conkey) AS y)
  )
ORDER BY pg_relation_size(c.conrelid) DESC;`,
        },
        {
          type: 'paragraph',
          value:
            'A primeira execução dessa consulta em um banco com alguns anos costuma devolver entre dez e cinquenta restrições, e a reação natural é criar índice em todas. Não é necessário, e a ordenação existe justamente para evitar isso. O que importa é o cruzamento de três colunas: o tamanho da filha, que define o custo de cada varredura; a regra de exclusão, que diz se o pai sofre remoção com efeito na filha; e o conhecimento de domínio sobre a tabela pai, que diz se ela é um catálogo imutável ou uma tabela transacional que tem expurgo, cancelamento ou pedido de exclusão de titular.',
        },
        {
          type: 'paragraph',
          value:
            'Um detalhe de leitura: em tabelas particionadas, a consulta devolve a restrição na tabela particionada, com tamanho zero, e em cada partição, com o tamanho real. O índice deve ser criado na tabela particionada, que propaga para todas as partições atuais e futuras, e não partição por partição.',
        },
      ],
    },
    {
      title: 'Criar o índice em produção sem causar o bloqueio que você quer evitar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A correção é uma linha, mas a forma ingênua de aplicá-la repete o incidente. Um CREATE INDEX comum pede bloqueio SHARE na tabela, que impede qualquer escrita durante toda a construção. Em uma tabela de quarenta milhões de linhas isso são vários minutos sem gravar histórico, ou seja, vários minutos sem checkout. A versão CONCURRENTLY constrói o índice sem bloquear escrita, ao custo de ler a tabela duas vezes e de ter três restrições operacionais que causam a maioria das falhas.',
        },
        {
          type: 'ordered',
          items: [
            'Ela não pode rodar dentro de um bloco de transação. Ferramentas de migração que envolvem cada arquivo em BEGIN e COMMIT precisam de uma marcação explícita para desligar isso naquele arquivo, e sem ela o comando falha na hora.',
            'Ela espera todas as transações que já tocam a tabela terminarem antes de concluir. Se o expurgo lento estiver rodando, a criação do índice fica parada atrás dele. Pare o job antes, ou rode fora da janela dele.',
            'Uma falha no meio, por timeout, cancelamento ou conflito, deixa o índice no catálogo marcado como inválido. Ele recebe todas as escritas e não serve nenhuma leitura, o pior dos dois mundos.',
            'IF NOT EXISTS não protege contra o item anterior: ele considera o índice inválido como existente e devolve sucesso sem fazer nada. Uma retentativa automática com IF NOT EXISTS depois de uma falha deixa o índice quebrado para sempre, em silêncio.',
          ],
        },
        {
          type: 'code',
          value: `-- migracao: 20260922_historico_status_pedido_id_idx.sql
-- Precisa rodar FORA de transacao explicita (desligue o BEGIN automatico
-- da ferramenta para este arquivo) e com o job de expurgo parado.

-- A construcao pode levar minutos; um timeout no meio deixa o indice invalido.
SET statement_timeout = 0;

CREATE INDEX CONCURRENTLY historico_status_pedido_id_idx
  ON historico_status (pedido_id);

-- Conferencia obrigatoria depois de criar: indisvalid precisa ser true.
SELECT indexrelid::regclass AS indice, indisvalid, indisready
FROM pg_index
WHERE indexrelid = 'historico_status_pedido_id_idx'::regclass;

-- Se indisvalid vier false, remova e repita o CREATE acima.
-- Nao use IF NOT EXISTS como retentativa: ele aceita o indice invalido.
-- DROP INDEX CONCURRENTLY historico_status_pedido_id_idx;`,
        },
        {
          type: 'paragraph',
          value:
            'Com o índice válido, o expurgo cai de cinquenta e três minutos para menos de um segundo, e o problema principal está resolvido. Vale ainda mudar a forma do job, porque o índice resolve o custo por linha, mas não o tamanho da transação. Excluir dois mil pedidos em um único comando ainda segura dois mil bloqueios de linha até o COMMIT, e no dia em que o volume de cancelamentos for dez vezes maior, por causa de uma campanha ou de uma falha de pagamento em massa, a transação volta a ficar longa. Processar em lotes com COMMIT entre eles mantém cada transação curta, independentemente do volume do dia.',
        },
        {
          type: 'code',
          value: `-- Expurgo em lotes: cada lote e uma transacao curta. Exige PostgreSQL 11+
-- (COMMIT dentro de procedimento) e deve ser chamado fora de transacao.
CREATE OR REPLACE PROCEDURE expurgar_pedidos_cancelados(tamanho_lote int DEFAULT 500)
LANGUAGE plpgsql
AS $$
DECLARE
  removidos int;
BEGIN
  LOOP
    DELETE FROM pedidos
    WHERE id IN (
      SELECT id
      FROM pedidos
      WHERE status = 'cancelado'
        AND atualizado_em < now() - interval '90 days'
      ORDER BY id
      LIMIT tamanho_lote
      -- Linhas travadas por outra sessao ficam para a proxima execucao.
      FOR UPDATE SKIP LOCKED
    );
    GET DIAGNOSTICS removidos = ROW_COUNT;
    EXIT WHEN removidos = 0;

    COMMIT;                -- libera bloqueios e o horizonte do vacuum
    PERFORM pg_sleep(0.1); -- deixa respirar a replicacao e o disco
  END LOOP;
END;
$$;

CALL expurgar_pedidos_cancelados(500);`,
        },
      ],
    },
    {
      title: 'Nem toda chave estrangeira merece índice, e a decisão precisa ficar escrita',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um índice em cada chave estrangeira é uma regra fácil de seguir e razoável como padrão, mas tem custo real em tabelas de escrita intensa: mais uma árvore para atualizar em cada INSERT, mais páginas no cache, mais volume no WAL e na replicação. Existe um conjunto pequeno de casos em que dispensar o índice é a escolha certa, e o que separa uma dispensa consciente de um esquecimento é exatamente o registro da decisão.',
        },
        {
          type: 'table',
          columns: ['Situação', 'Índice na coluna da FK', 'Motivo'],
          rows: [
            [
              'Pai sofre exclusão ou troca de chave: expurgo, cancelamento, pedido de exclusão de titular',
              'Obrigatório',
              'Cada linha removida no pai varre a filha inteira sem ele',
            ],
            [
              'Filha é consultada pela FK: itens do pedido, junções, telas de detalhe',
              'Obrigatório',
              'O mesmo índice atende a leitura e a manutenção da integridade',
            ],
            [
              'Pai é catálogo pequeno e imutável (moeda, país, tipo) e a filha tem escrita altíssima',
              'Pode dispensar, com exceção registrada',
              'A varredura só aconteceria em uma exclusão que o domínio não permite',
            ],
            [
              'FK composta com identificador de inquilino',
              'Índice com todas as colunas da FK na frente',
              'Índice só pelo inquilino não localiza as linhas de um pai específico',
            ],
            [
              'Tabela particionada',
              'Criar na tabela particionada',
              'Propaga para as partições atuais e futuras; índice por partição esquece as novas',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A terceira linha é a única dispensa legítima, e ela tem uma condição que envelhece: o catálogo é imutável hoje. No dia em que alguém decidir remover um tipo de pagamento descontinuado, aquela exclusão de uma linha vai varrer uma tabela de centenas de milhões de registros dentro de uma transação. Por isso a exceção precisa estar escrita em um lugar que alguém lê quando a premissa muda, e não apenas na memória de quem decidiu.',
        },
        {
          type: 'paragraph',
          value:
            'O lugar certo para isso é o CI. A mesma consulta de catálogo, rodada contra o banco criado pelas migrações do repositório, transforma o problema de uma descoberta em produção em uma falha de build no pull request que adicionou a restrição. A lista de exceções vive no código, com uma justificativa por entrada, e o script avisa quando uma exceção deixou de ser necessária, para que a lista não acumule entradas mortas.',
        },
        {
          type: 'code',
          value: `// verificar-fk-sem-indice.mjs
// Roda no CI contra o banco criado pelas migracoes. Falha o build quando
// aparece chave estrangeira sem indice fora da lista de excecoes.
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Toda excecao exige justificativa: quem ler daqui a um ano precisa saber
// por que a restricao ficou sem indice de proposito.
const EXCECOES = new Map([
  ['pagamentos_moeda_fkey', 'moedas e catalogo imutavel; nenhuma exclusao ou troca de chave'],
]);

const sql = await readFile(new URL('./fk-sem-indice.sql', import.meta.url), 'utf8');
const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });

await cliente.connect();
try {
  const { rows } = await cliente.query(sql);
  const encontradas = new Set(rows.map((linha) => linha.restricao));
  const violacoes = rows.filter((linha) => !EXCECOES.has(linha.restricao));

  for (const v of violacoes) {
    console.error(
      \`FK sem indice: \${v.restricao} em \${v.tabela_filha} (\${v.colunas}) -> \${v.tabela_pai}, ao excluir: \${v.ao_excluir}\`,
    );
  }
  for (const nome of EXCECOES.keys()) {
    if (!encontradas.has(nome)) console.warn(\`Excecao obsoleta, remova da lista: \${nome}\`);
  }

  if (violacoes.length > 0) process.exitCode = 1;
} finally {
  await cliente.end();
}`,
        },
        {
          type: 'paragraph',
          value:
            'Com essa verificação no pipeline, o custo de manter a regra cai para perto de zero: quem cria uma restrição nova recebe a falha no mesmo pull request, com o nome da tabela e da coluna, e decide ali entre criar o índice na mesma migração ou registrar a exceção com o motivo. A decisão continua sendo humana; o que deixa de existir é a possibilidade de ela não ser tomada.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Criar índice em toda chave estrangeira não vai deixar a escrita mais lenta?',
      answer:
        'Vai, e o custo deve ser medido em vez de presumido, porque na maioria das tabelas ele é bem menor do que a intuição sugere. Cada índice adicional acrescenta a cada INSERT uma inserção em uma árvore B, algumas páginas a mais no cache compartilhado e um volume proporcional no WAL, o que também chega à replicação e ao backup. Em uma tabela que já tem chave primária e dois ou três índices, somar mais um costuma representar um aumento de dez a vinte por cento no custo de escrita daquela tabela, e raramente é o gargalo do sistema, porque o tempo de uma transação típica é dominado por rede, validação e outras consultas. O outro lado da conta é assimétrico: sem o índice, uma única exclusão no pai custa uma varredura completa da filha, e um expurgo custa essa varredura multiplicada pelo número de linhas removidas, dentro de uma transação que segura bloqueios. Os casos em que o custo de escrita realmente pesa são tabelas de ingestão com dezenas de milhares de inserções por segundo, como eventos, telemetria e trilhas de auditoria, e são justamente as que mais crescem. Para elas, a pergunta certa não é se o índice custa, e sim se o pai pode sofrer exclusão. Se o pai é um catálogo imutável, dispensar o índice com a exceção registrada é legítimo. Se o pai é transacional, a alternativa ao índice não é economizar escrita, é mudar o modelo: particionar a filha por tempo e expurgar derrubando partições antigas, sem DELETE nenhum, o que elimina tanto a varredura quanto o custo da cascata.',
    },
    {
      question: 'Por que o problema não aparece em homologação nem nos testes de carga?',
      answer:
        'Porque o custo é o produto de duas grandezas que os ambientes de teste mantêm pequenas ao mesmo tempo, e o produto de dois números pequenos é irrelevante. Em homologação, a tabela filha tem de milhares a poucos milhões de linhas, cabe inteira no cache e uma varredura sequencial custa de um a dez milissegundos. O volume de exclusões também é baixo, porque ninguém simula o expurgo de dois mil pedidos por dia em um banco de teste. Mesmo um teste de carga bem feito costuma exercitar leitura e escrita no caminho quente, como checkout, busca e login, e não jobs de manutenção que rodam uma vez por dia com dados acumulados por anos. Há ainda um efeito de cache que mascara a medição: quando a filha cabe na memória, a varredura é limitada por CPU e parece aceitável; quando ela passa a exceder a memória disponível, cada varredura vira leitura de disco e o tempo salta uma ordem de grandeza de uma semana para outra, sem que nada no código tenha mudado. Por isso a forma confiável de pegar esse defeito não é teste de desempenho, e sim inspeção estrutural: a consulta de catálogo que lista chaves estrangeiras sem índice encontra o problema em um banco vazio, no primeiro dia, independentemente do volume. É uma verificação que custa milissegundos, não depende de dados realistas e não tem falso negativo por falta de volume, o que a torna muito mais adequada ao CI do que qualquer tentativa de reproduzir o tamanho de produção.',
    },
    {
      question: 'Trocar ON DELETE CASCADE por exclusão feita pela aplicação resolve o problema?',
      answer:
        'Não resolve, e costuma piorar, porque a aplicação precisa fazer exatamente a mesma busca que o gatilho interno faz, com as mesmas consequências quando falta o índice. Para excluir os filhos de um pedido antes de excluir o pedido, a aplicação executa um DELETE na filha filtrando por pedido_id, e sem índice esse comando é a mesma varredura sequencial, agora disparada pelo seu código em vez do gatilho. Se a restrição continuar existindo com NO ACTION, o banco ainda executa a verificação de existência depois, e sem índice essa verificação é uma segunda varredura. Se a restrição for removida para evitar isso, o problema muda de natureza: a integridade passa a depender de todo caminho de escrita da aplicação fazer a coisa certa, incluindo scripts de manutenção, correções manuais e serviços novos que ninguém lembrou de atualizar, e registros órfãos começam a aparecer em poucos meses. Há também uma perda de atomicidade quando a exclusão é feita em várias chamadas sem transação única, o que deixa estados intermediários visíveis para outras sessões. A exclusão lógica, com uma coluna de marcação em vez de DELETE, evita a cascata no momento da marcação, mas empurra o problema para o expurgo físico que um dia precisa acontecer, por volume ou por obrigação legal, e esse expurgo encontra a mesma filha sem índice. A correção que realmente elimina o custo é o índice na coluna da chave estrangeira, combinada com exclusão em lotes curtos, e mantendo a restrição no banco como a garantia de integridade que ela é.',
    },
  ],
  conclusion: {
    title: 'A chave estrangeira garante a integridade, o índice garante que ela seja barata de manter',
    description:
      'Declarar uma chave estrangeira sem índice na coluna da filha é assinar um custo que só aparece anos depois, multiplicado pelo tamanho da tabela e pelo volume de exclusões, e que chega na forma de um job lento que encontra um comando de esquema na fila e para a tabela inteira. O diagnóstico está nas linhas de gatilho do EXPLAIN ANALYZE, a lista completa está no catálogo, a correção é um índice criado de forma concorrente e conferido depois, e a prevenção é uma verificação de CI com exceções justificadas. Posso rodar o levantamento no seu banco, priorizar as restrições pelo risco real, criar os índices em produção sem janela de manutenção e deixar a verificação no pipeline para que a próxima restrição nasça correta.',
    cta: 'Revisar as chaves estrangeiras do meu banco',
  },
  related: [
    {
      label: 'Índice que o banco decidiu ignorar: quando o plano de consulta muda sozinho',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Migração de banco sem janela: expandir, migrar e contrair sem derrubar escrita',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Arquitetura e Modernização Backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The purge job runs every day at nine thirty, deletes orders cancelled more than ninety days ago and always finished in three minutes. One Tuesday it took fifty-three, and at five past ten a routine deploy that added a column to the status history table took checkout down for eighteen minutes. Nobody touched the job, nobody touched the query and the DELETE plan was the same as ever. What changed was the size of a table that does not even appear in the command: the child, which references the order through a foreign key with no index. This article shows why deleting one row in the parent forces the database to scan the entire child, why that cost grows faster than the business and never shows up in staging, how a slow delete turns into a fully frozen table when a schema change joins the queue, how to find every unindexed foreign key through the catalog before the incident, how to create the index in production without causing the very lock you want to avoid, and when it is legitimate to leave a foreign key without an index, as long as the decision is written down and checked in CI.',
  sections: [
    {
      title: 'The job that ran in three minutes and started taking fifty-three',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first investigation almost always goes to the wrong place. The team opens the purge command, runs EXPLAIN, sees an index scan on orders filtering by status and date, with low cost and an estimate of two thousand rows, and concludes the problem is not there. The plan is right. What the DELETE plan does not show is the work that happens after each removed row, outside the command you wrote, in the internal triggers the database uses to enforce referential integrity.',
        },
        {
          type: 'paragraph',
          value:
            'In PostgreSQL, every foreign key is implemented by system triggers. When a row in orders is deleted, the constraint trigger runs, for that row, a query on the child table looking for records that point to the removed order: a DELETE if the constraint is ON DELETE CASCADE, an UPDATE if it is SET NULL, or an existence check if it is NO ACTION or RESTRICT. If the child column has an index, that query is a lookup measured in microseconds. If it does not, it is a sequential scan of the entire child. Per deleted row in the parent.',
        },
        {
          type: 'paragraph',
          value:
            'That is the misleading detail: the database automatically creates an index for the primary key and for UNIQUE constraints, which is the referenced side, but creates nothing on the referencing column. Declaring the foreign key guarantees integrity, not the performance of maintaining it. In the incident, the status_history table had an index by date for reports and none by order_id, because no screen looked up history by order on the hot path. The constraint had existed for three years, with ON DELETE CASCADE, and every order deletion paid for a full read of a table that grew faster than any other in the system.',
        },
        {
          type: 'diagram',
          value: `Daily purge cost (2,000 cancelled orders per day):

  year 1: status_history with 2 million rows
    2,000 deletes x 1 scan of 2M rows (~80 ms)   = ~3 min

  year 3: status_history with 40 million rows
    2,000 deletes x 1 scan of 40M rows (~1.6 s)  = ~53 min

  with an index on status_history (order_id), any year:
    2,000 deletes x 1 index lookup (~0.05 ms)    = ~0.1 s

Cost = (rows deleted in the parent) x (size of the child table)
Both factors grow with the business: the time grows with their product.`,
        },
        {
          type: 'paragraph',
          value:
            'The multiplication explains why the problem never shows up early. In staging, the child has ten thousand rows, the scan fits in memory and costs less than a millisecond. In the first months of production, the purge takes seconds. The degradation is continuous and silent, with no step that fires an alert, until the day the job duration crosses something that matters: the maintenance window, the scheduler interval, a migration timeout or the patience of the connection pool.',
        },
        {
          type: 'paragraph',
          value:
            'There is an even less intuitive consequence. With NO ACTION, which is the default when nobody writes anything, deleting an order that has no rows at all in the child costs exactly the same full scan. The database has to prove absence, and without an index the only way to prove that none of the forty million rows points to that order is to read all of them.',
        },
      ],
    },
    {
      title: 'What the database does underneath when you delete the parent row',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The fastest way to confirm the diagnosis is EXPLAIN ANALYZE on the DELETE itself. It actually executes the command, so it has to run inside a transaction that ends in ROLLBACK, preferably on a restored copy of the database, because even when rolled back it holds the locks for the entire execution. What matters is not the plan but the trigger lines at the end of the output, with the accumulated time and the number of calls for each constraint.',
        },
        {
          type: 'code',
          value: `-- Run on a restored copy: EXPLAIN ANALYZE really executes the DELETE
-- and holds the locks until ROLLBACK.
BEGIN;

EXPLAIN (ANALYZE, BUFFERS)
DELETE FROM orders
WHERE status = 'cancelled'
  AND updated_at < now() - interval '90 days';

ROLLBACK;

-- Abridged output:
--  Delete on orders (actual time=41.2..41.2 rows=0 loops=1)
--    ->  Index Scan using orders_status_updated_idx on orders
--          (actual time=0.03..8.9 rows=2000 loops=1)
--  Planning Time: 0.4 ms
--  Trigger for constraint status_history_order_id_fkey: time=3171840.5 calls=2000
--  Trigger for constraint payments_order_id_fkey: time=96.1 calls=2000
--  Execution Time: 3171990.3 ms
--
-- The DELETE itself took 41 ms. All 53 minutes sit in one constraint:
-- 2,000 calls, about 1.6 s each, one scan of status_history per order.
-- The payments constraint has an index and costs 96 ms in total.`,
        },
        {
          type: 'paragraph',
          value:
            'Comparing the two trigger lines is what closes the case without argument. Both constraints receive the same number of calls, one per removed order, and the four orders of magnitude difference in time comes only from the existence of the index. When EXPLAIN ANALYZE is not an option, the symptom also shows up in the statistics: the seq_scan counter of the child table in pg_stat_user_tables climbs by thousands during the job window, and seq_tup_read follows into the billions.',
        },
        {
          type: 'paragraph',
          value:
            'The behavior varies across engines, and the variation matters for anyone who operates more than one database or migrates between them. People coming from MySQL often do not know the problem because InnoDB requires an index on the foreign key column and creates one automatically if there is none. People coming from Oracle know its most aggressive version, in which the missing index makes the parent delete lock the entire child table for the duration of the statement.',
        },
        {
          type: 'table',
          columns: ['Engine', 'Creates an index on the child column?', 'Parent delete with no index on the child', 'How the freeze shows up'],
          rows: [
            [
              'PostgreSQL',
              'No',
              'One sequential scan of the child per deleted row, inside the same transaction',
              'Long transaction holding locks; a queued schema change freezes all access to the table',
            ],
            [
              'MySQL (InnoDB)',
              'Yes, requires an index and creates one if missing',
              'Index lookup; the risk moves to huge cascades in a single transaction',
              'Row and gap locks piled up by the cascade',
            ],
            [
              'SQL Server',
              'No',
              'A scan of the child for every check or cascade',
              'Thousands of row locks escalate to a lock on the whole table',
            ],
            [
              'Oracle',
              'No',
              'A shared table lock on the child for the duration of the statement',
              'Any write to the child waits, even on rows unrelated to the delete',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The same mechanism fires in more situations than an explicit delete. An UPDATE that changes the value of the parent primary key runs the same lookup on the child. ON DELETE SET NULL performs an UPDATE on the child per parent row, with the same scan. And a GDPR erasure that removes a customer with a cascade to orders, which in turn cascades to history, payments and events, multiplies the problem by every level of the tree where an index is missing.',
        },
      ],
    },
    {
      title: 'How a slow delete becomes a fully locked table',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In PostgreSQL, a slow delete on its own does not lock the child table for everyone. It holds row locks on the removed orders, row locks on the history rows the cascade deletes and a ROW EXCLUSIVE lock on the tables involved, which coexists with reads and with other writes. For fifty-three minutes that is a waste of disk and CPU, not an outage. What turns slowness into unavailability is the second participant: any command that needs a strong lock on the same table.',
        },
        {
          type: 'paragraph',
          value:
            'An ALTER TABLE that adds a column, even though it is an instant metadata operation, requests ACCESS EXCLUSIVE, the mode that conflicts with every other one. It joins the queue behind the purge transaction and waits. The problem is that the lock queue is ordered: every lock request that arrives later and conflicts with the pending ACCESS EXCLUSIVE stays behind it, including a plain INSERT that on its own would be compatible with the purge. From that moment on the table is locked for any access, and it stays that way until the purge finishes and the migration runs.',
        },
        {
          type: 'diagram',
          value: `09:30  purge        BEGIN; DELETE FROM orders ...
                     ROW EXCLUSIVE on status_history, lasts 53 min
10:05  migration    ALTER TABLE status_history ADD COLUMN source text
                     requests ACCESS EXCLUSIVE -> waits for the purge
10:05  checkout #1  INSERT INTO status_history ... -> waits for the migration
10:05  checkout #2  INSERT INTO status_history ... -> waits for the migration
  ...               every status change in the system joins the queue
10:06  connection pool exhausted, checkout returns 503
10:23  purge COMMITs -> migration runs in 40 ms -> queue drains

None of the three commands is slow alone, except the purge.
The outage comes from the combination: long transaction + strong lock queued.`,
        },
        {
          type: 'paragraph',
          value:
            'There is a slower side effect that lingers after the incident. A transaction open for almost an hour prevents autovacuum from cleaning dead row versions across the whole database, not only in the tables involved, because the visibility horizon stays pinned at its start. Tables with a high update rate bloat during the window and queries get slower in the following hours, which is usually investigated as a second, unrelated problem.',
        },
        {
          type: 'paragraph',
          value:
            'While the freeze is happening, the useful question is not which query is slow but who is waiting for whom. The pg_blocking_pids function returns, for each session, the sessions blocking it, and crossing that with the ungranted locks shows the entire chain in one query. The incident pattern is unmistakable: hundreds of sessions waiting for a single migration session, which in turn waits for a single old transaction.',
        },
        {
          type: 'code',
          value: `-- Who waits for whom, with transaction age and the requested lock mode.
SELECT
  a.pid,
  pg_blocking_pids(a.pid)   AS blocked_by,
  now() - a.xact_start      AS transaction_age,
  l.mode                    AS requested_mode,
  l.relation::regclass      AS table_name,
  left(a.query, 60)         AS query
FROM pg_stat_activity a
LEFT JOIN pg_locks l
  ON l.pid = a.pid AND NOT l.granted
WHERE cardinality(pg_blocking_pids(a.pid)) > 0
ORDER BY a.xact_start;

-- Typical incident result:
--   pid  | blocked_by | transaction_age | requested_mode      | query
--   8812 | {7710}     | 00:18:02        | AccessExclusiveLock | ALTER TABLE status_history ...
--   9031 | {8812}     | 00:00:41        | RowExclusiveLock    | INSERT INTO status_history ...
--   9044 | {8812}     | 00:00:39        | RowExclusiveLock    | INSERT INTO status_history ...
--   (212 more rows blocked by 8812)
--
-- 7710 is the purge. Cancelling the migration (pg_cancel_backend(8812))
-- frees the queue in seconds; the purge can keep going while the index is missing.`,
        },
        {
          type: 'paragraph',
          value:
            'The immediate mitigation is to cancel the migration, not the purge. Cancelling the purge after fifty minutes throws away all the work, and rolling back a large delete also takes time. Cancelling the migration frees the queue in seconds, and it can be retried later. The structural prevention for this side of the problem is independent of the index: every migration that requests a strong lock should run with a short lock_timeout, three to five seconds, and with retries. A migration that gives up after five seconds of waiting is a warning in the deploy log; one that waits indefinitely is an outage.',
        },
      ],
    },
    {
      title: 'Finding every unindexed foreign key before the incident',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Waiting for the next slow job to discover the next unindexed constraint is the strategy that keeps the problem alive. The database catalog has all the information needed to list, at once, every foreign key whose child table lacks an index able to serve the constraint lookup. The correct criterion is stricter than it looks: it is not enough for an index containing the column to exist.',
        },
        {
          type: 'list',
          items: [
            'The index has to start with the foreign key columns. An index on (created_at, order_id) does not serve a lookup by order_id, because the column is not the first one.',
            'In a composite key, the constraint columns must occupy the first positions of the index, in any order among themselves. An index on tenant_id alone does not serve a constraint on (tenant_id, order_id) in a table with millions of rows per tenant.',
            'A partial index does not count. An index on order_id WHERE active is not used by the internal constraint query, which has no such filter.',
            'An invalid index does not count. A concurrent build that failed leaves the index in the catalog, taking space and costing writes, without being used by any query.',
            'Columns added with INCLUDE do not count as search keys, only the key columns of the index do.',
          ],
        },
        {
          type: 'code',
          value: `-- fk-without-index.sql
-- Foreign keys whose child table has no valid, non partial index starting
-- exactly with the constraint columns. Ordered by child size, which is what
-- defines the cost of each scan.
SELECT
  c.conrelid::regclass  AS child_table,
  c.conname             AS constraint_name,
  c.confrelid::regclass AS parent_table,
  (SELECT string_agg(a.attname, ', ' ORDER BY k.pos)
     FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, pos)
     JOIN pg_attribute a
       ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columns,
  CASE c.confdeltype
    WHEN 'c' THEN 'cascade'
    WHEN 'n' THEN 'set null'
    WHEN 'd' THEN 'set default'
    WHEN 'r' THEN 'restrict'
    ELSE 'no action'
  END AS on_delete,
  pg_size_pretty(pg_relation_size(c.conrelid)) AS child_size
FROM pg_constraint c
WHERE c.contype = 'f'
  AND NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = c.conrelid
      AND i.indisvalid
      AND i.indpred IS NULL
      AND i.indnkeyatts >= cardinality(c.conkey)
      -- The first N index columns are exactly the N foreign key columns.
      AND (SELECT array_agg(x.attnum ORDER BY x.attnum)
             FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS x(attnum, pos)
            WHERE x.pos <= cardinality(c.conkey))
        = (SELECT array_agg(y ORDER BY y) FROM unnest(c.conkey) AS y)
  )
ORDER BY pg_relation_size(c.conrelid) DESC;`,
        },
        {
          type: 'paragraph',
          value:
            'The first run of this query on a database a few years old usually returns between ten and fifty constraints, and the natural reaction is to index all of them. That is not necessary, and the ordering exists precisely to avoid it. What matters is crossing three columns: the child size, which defines the cost of each scan; the delete rule, which says whether the parent is removed with an effect on the child; and domain knowledge about the parent table, which says whether it is an immutable catalog or a transactional table with purges, cancellations or data subject erasure requests.',
        },
        {
          type: 'paragraph',
          value:
            'One reading detail: in partitioned tables, the query returns the constraint on the partitioned table, with size zero, and on each partition, with the real size. The index should be created on the partitioned table, which propagates to all current and future partitions, not partition by partition.',
        },
      ],
    },
    {
      title: 'Creating the index in production without causing the lock you want to avoid',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The fix is one line, but the naive way of applying it repeats the incident. A plain CREATE INDEX requests a SHARE lock on the table, which blocks every write for the entire build. On a forty million row table that means several minutes without writing history, which means several minutes without checkout. The CONCURRENTLY variant builds the index without blocking writes, at the cost of reading the table twice and of three operational constraints that cause most failures.',
        },
        {
          type: 'ordered',
          items: [
            'It cannot run inside a transaction block. Migration tools that wrap each file in BEGIN and COMMIT need an explicit marker to turn that off for that file, and without it the command fails immediately.',
            'It waits for every transaction already touching the table to finish before completing. If the slow purge is running, the index build stays stuck behind it. Stop the job first, or run outside its window.',
            'A failure midway, from a timeout, a cancellation or a conflict, leaves the index in the catalog marked as invalid. It receives every write and serves no reads, the worst of both worlds.',
            'IF NOT EXISTS does not protect against the previous item: it treats the invalid index as existing and returns success without doing anything. An automatic retry with IF NOT EXISTS after a failure leaves the index broken forever, silently.',
          ],
        },
        {
          type: 'code',
          value: `-- migration: 20260922_status_history_order_id_idx.sql
-- Must run OUTSIDE an explicit transaction (turn off the tool automatic
-- BEGIN for this file) and with the purge job stopped.

-- The build can take minutes; a timeout midway leaves the index invalid.
SET statement_timeout = 0;

CREATE INDEX CONCURRENTLY status_history_order_id_idx
  ON status_history (order_id);

-- Mandatory check after creation: indisvalid must be true.
SELECT indexrelid::regclass AS index_name, indisvalid, indisready
FROM pg_index
WHERE indexrelid = 'status_history_order_id_idx'::regclass;

-- If indisvalid comes back false, drop it and repeat the CREATE above.
-- Do not use IF NOT EXISTS as a retry: it accepts the invalid index.
-- DROP INDEX CONCURRENTLY status_history_order_id_idx;`,
        },
        {
          type: 'paragraph',
          value:
            'With the index valid, the purge drops from fifty-three minutes to under a second, and the main problem is solved. It is still worth changing the shape of the job, because the index solves the per row cost but not the transaction size. Deleting two thousand orders in a single statement still holds two thousand row locks until COMMIT, and on the day cancellations are ten times higher, because of a campaign or a mass payment failure, the transaction gets long again. Processing in batches with a COMMIT between them keeps each transaction short, regardless of the daily volume.',
        },
        {
          type: 'code',
          value: `-- Batched purge: each batch is a short transaction. Requires PostgreSQL 11+
-- (COMMIT inside a procedure) and must be called outside a transaction.
CREATE OR REPLACE PROCEDURE purge_cancelled_orders(batch_size int DEFAULT 500)
LANGUAGE plpgsql
AS $$
DECLARE
  removed int;
BEGIN
  LOOP
    DELETE FROM orders
    WHERE id IN (
      SELECT id
      FROM orders
      WHERE status = 'cancelled'
        AND updated_at < now() - interval '90 days'
      ORDER BY id
      LIMIT batch_size
      -- Rows locked by another session are left for the next run.
      FOR UPDATE SKIP LOCKED
    );
    GET DIAGNOSTICS removed = ROW_COUNT;
    EXIT WHEN removed = 0;

    COMMIT;                -- releases locks and the vacuum horizon
    PERFORM pg_sleep(0.1); -- gives replication and disk room to breathe
  END LOOP;
END;
$$;

CALL purge_cancelled_orders(500);`,
        },
      ],
    },
    {
      title: 'Not every foreign key deserves an index, and the decision must be written down',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An index on every foreign key is an easy rule to follow and a reasonable default, but it has a real cost on write heavy tables: one more tree to update on every INSERT, more pages in the cache, more volume in the WAL and in replication. There is a small set of cases in which skipping the index is the right choice, and what separates a deliberate exemption from an oversight is exactly the record of the decision.',
        },
        {
          type: 'table',
          columns: ['Situation', 'Index on the FK column', 'Reason'],
          rows: [
            [
              'Parent gets deleted or has its key changed: purge, cancellation, data subject erasure request',
              'Mandatory',
              'Without it, every row removed in the parent scans the entire child',
            ],
            [
              'Child is queried by the FK: order items, joins, detail screens',
              'Mandatory',
              'The same index serves both reads and integrity maintenance',
            ],
            [
              'Parent is a small immutable catalog (currency, country, type) and the child has very high write volume',
              'Can be skipped, with a recorded exception',
              'The scan would only happen on a delete the domain does not allow',
            ],
            [
              'Composite FK with a tenant identifier',
              'Index with all FK columns at the front',
              'An index on the tenant alone does not locate the rows of a specific parent',
            ],
            [
              'Partitioned table',
              'Create it on the partitioned table',
              'Propagates to current and future partitions; per partition indexes forget the new ones',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third row is the only legitimate exemption, and it has a condition that ages: the catalog is immutable today. The day someone decides to remove a discontinued payment type, that one row delete will scan a table with hundreds of millions of records inside a transaction. That is why the exception has to be written somewhere people read when the premise changes, and not only in the memory of whoever decided.',
        },
        {
          type: 'paragraph',
          value:
            'The right place for that is CI. The same catalog query, run against the database built by the repository migrations, turns the problem from a production discovery into a build failure on the pull request that added the constraint. The exception list lives in code, with one justification per entry, and the script warns when an exception is no longer needed, so the list does not accumulate dead entries.',
        },
        {
          type: 'code',
          value: `// check-fk-without-index.mjs
// Runs in CI against the database built by the migrations. Fails the build
// when a foreign key without an index appears outside the exception list.
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Every exception needs a justification: whoever reads this a year from now
// has to know why the constraint was left without an index on purpose.
const EXCEPTIONS = new Map([
  ['payments_currency_fkey', 'currencies is an immutable catalog; no deletes or key changes'],
]);

const sql = await readFile(new URL('./fk-without-index.sql', import.meta.url), 'utf8');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  const { rows } = await client.query(sql);
  const found = new Set(rows.map((row) => row.constraint_name));
  const violations = rows.filter((row) => !EXCEPTIONS.has(row.constraint_name));

  for (const v of violations) {
    console.error(
      \`FK without index: \${v.constraint_name} on \${v.child_table} (\${v.columns}) -> \${v.parent_table}, on delete: \${v.on_delete}\`,
    );
  }
  for (const name of EXCEPTIONS.keys()) {
    if (!found.has(name)) console.warn(\`Stale exception, remove it from the list: \${name}\`);
  }

  if (violations.length > 0) process.exitCode = 1;
} finally {
  await client.end();
}`,
        },
        {
          type: 'paragraph',
          value:
            'With that check in the pipeline, the cost of keeping the rule drops close to zero: whoever creates a new constraint gets the failure on the same pull request, with the table and column name, and decides right there between creating the index in the same migration or recording the exception with its reason. The decision stays human; what disappears is the possibility of it never being made.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Will indexing every foreign key make writes slower?',
      answer:
        'It will, and the cost should be measured rather than assumed, because on most tables it is much smaller than intuition suggests. Each additional index adds to every INSERT one insertion into a B-tree, a few more pages in shared buffers and a proportional volume in the WAL, which also reaches replication and backups. On a table that already has a primary key and two or three indexes, adding one more usually means a ten to twenty percent increase in the write cost of that table, and it is rarely the bottleneck of the system, because the time of a typical transaction is dominated by network, validation and other queries. The other side of the equation is asymmetric: without the index, a single parent delete costs a full scan of the child, and a purge costs that scan multiplied by the number of removed rows, inside a transaction that holds locks. The cases where write cost really weighs are ingestion tables with tens of thousands of inserts per second, such as events, telemetry and audit trails, and those are precisely the ones that grow the most. For them, the right question is not whether the index costs something but whether the parent can be deleted. If the parent is an immutable catalog, skipping the index with a recorded exception is legitimate. If the parent is transactional, the alternative to the index is not saving writes, it is changing the model: partition the child by time and purge by dropping old partitions, with no DELETE at all, which removes both the scan and the cascade cost.',
    },
    {
      question: 'Why does the problem not show up in staging or in load tests?',
      answer:
        'Because the cost is the product of two quantities that test environments keep small at the same time, and the product of two small numbers is irrelevant. In staging, the child table has from thousands to a few million rows, fits entirely in cache and a sequential scan costs one to ten milliseconds. The delete volume is also low, because nobody simulates purging two thousand orders a day on a test database. Even a well designed load test usually exercises reads and writes on the hot path, such as checkout, search and login, and not maintenance jobs that run once a day over data accumulated for years. There is also a cache effect that masks the measurement: while the child fits in memory, the scan is CPU bound and looks acceptable; once it exceeds the available memory, every scan becomes a disk read and the time jumps an order of magnitude from one week to the next, with nothing in the code having changed. That is why the reliable way to catch this defect is not performance testing but structural inspection: the catalog query that lists unindexed foreign keys finds the problem on an empty database, on day one, regardless of volume. It is a check that costs milliseconds, does not depend on realistic data and has no false negatives from lack of volume, which makes it far better suited to CI than any attempt to reproduce production size.',
    },
    {
      question: 'Does replacing ON DELETE CASCADE with deletion done by the application solve the problem?',
      answer:
        'It does not, and it usually makes things worse, because the application has to perform exactly the same lookup the internal trigger performs, with the same consequences when the index is missing. To delete the children of an order before deleting the order, the application runs a DELETE on the child filtering by order_id, and without an index that command is the same sequential scan, now fired by your code instead of the trigger. If the constraint remains with NO ACTION, the database still runs the existence check afterwards, and without an index that check is a second scan. If the constraint is dropped to avoid that, the problem changes nature: integrity now depends on every write path of the application doing the right thing, including maintenance scripts, manual fixes and new services nobody remembered to update, and orphan records start showing up within a few months. There is also a loss of atomicity when the deletion is done in several calls without a single transaction, which leaves intermediate states visible to other sessions. Soft deletion, with a marker column instead of DELETE, avoids the cascade at marking time, but pushes the problem to the physical purge that has to happen one day, because of volume or legal obligation, and that purge meets the same unindexed child. The fix that really removes the cost is the index on the foreign key column, combined with deletion in short batches, while keeping the constraint in the database as the integrity guarantee it is.',
    },
  ],
  conclusion: {
    title: 'The foreign key guarantees integrity, the index guarantees it is cheap to maintain',
    description:
      'Declaring a foreign key without an index on the child column is signing up for a cost that only shows up years later, multiplied by the table size and the delete volume, and that arrives as a slow job meeting a queued schema change and freezing the whole table. The diagnosis is in the EXPLAIN ANALYZE trigger lines, the full list is in the catalog, the fix is an index built concurrently and checked afterwards, and the prevention is a CI check with justified exceptions. I can run the survey on your database, prioritize constraints by real risk, create the indexes in production with no maintenance window and leave the check in the pipeline so the next constraint is born right.',
    cta: 'Review the foreign keys in my database',
  },
  related: [
    {
      label: 'The index the database decided to ignore: when the query plan changes on its own',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Zero downtime database migration: expand, migrate and contract without stopping writes',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Backend Architecture and Modernization',
      to: '/services/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'El job de purga corre todos los días a las nueve y media, borra los pedidos cancelados hace más de noventa días y siempre terminaba en tres minutos. Un martes tardó cincuenta y tres, y a las diez y cinco un despliegue rutinario que añadía una columna a la tabla de historial de estados tumbó el checkout durante dieciocho minutos. Nadie tocó el job, nadie tocó la consulta y el plan del DELETE era el de siempre. Lo que cambió fue el tamaño de una tabla que ni siquiera aparece en el comando: la hija, que referencia el pedido mediante una clave foránea sin índice. Este artículo muestra por qué borrar una fila en el padre obliga a la base a recorrer la hija entera, por qué ese costo crece más rápido que el negocio y nunca aparece en preproducción, cómo un borrado lento se convierte en la tabla entera detenida cuando entra un cambio de esquema en la cola, cómo encontrar en el catálogo todas las claves foráneas sin índice antes del incidente, cómo crear el índice en producción sin provocar el bloqueo que quieres evitar, y cuándo es legítimo dejar una clave foránea sin índice, siempre que la decisión quede escrita y verificada en el CI.',
  sections: [
    {
      title: 'El job que tardaba tres minutos y pasó a tardar cincuenta y tres',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La primera investigación casi siempre va al lugar equivocado. El equipo abre el comando de la purga, ejecuta EXPLAIN, ve un escaneo por índice en pedidos filtrando por estado y fecha, con costo bajo y una estimación de dos mil filas, y concluye que el problema no está ahí. El plan es correcto. Lo que el plan del DELETE no muestra es el trabajo que ocurre después de cada fila eliminada, fuera del comando que escribiste, en los disparadores internos que la base usa para garantizar la integridad referencial.',
        },
        {
          type: 'paragraph',
          value:
            'En PostgreSQL, cada clave foránea se implementa con disparadores de sistema. Cuando se borra una fila de pedidos, el disparador de la restricción ejecuta, para esa fila, una consulta en la tabla hija buscando registros que apuntan al pedido eliminado: un DELETE si la restricción es ON DELETE CASCADE, un UPDATE si es SET NULL, o una verificación de existencia si es NO ACTION o RESTRICT. Si la columna de la hija tiene índice, esa consulta es una búsqueda de microsegundos. Si no lo tiene, es un escaneo secuencial de la hija entera. Por cada fila borrada en el padre.',
        },
        {
          type: 'paragraph',
          value:
            'Ahí está el detalle que engaña: la base crea índice automáticamente para la clave primaria y para las restricciones UNIQUE, que son el lado referenciado, pero no crea nada en la columna que referencia. Declarar la clave foránea garantiza la integridad, no el rendimiento de mantenerla. En el incidente, la tabla historial_estado tenía un índice por fecha para informes y ninguno por pedido_id, porque ninguna pantalla buscaba historial por pedido en el camino caliente. La restricción existía hacía tres años, con ON DELETE CASCADE, y cada borrado de pedido pagaba una lectura completa de una tabla que crecía más rápido que cualquier otra del sistema.',
        },
        {
          type: 'diagram',
          value: `Costo de la purga diaria (2.000 pedidos cancelados por dia):

  ano 1: historial_estado con 2 millones de filas
    2.000 borrados x 1 escaneo de 2 M de filas (~80 ms)   = ~3 min

  ano 3: historial_estado con 40 millones de filas
    2.000 borrados x 1 escaneo de 40 M de filas (~1,6 s)  = ~53 min

  con indice en historial_estado (pedido_id), en cualquier ano:
    2.000 borrados x 1 busqueda en el indice (~0,05 ms)   = ~0,1 s

Costo = (filas borradas en el padre) x (tamano de la tabla hija)
Los dos factores crecen con el negocio: el tiempo crece con el producto.`,
        },
        {
          type: 'paragraph',
          value:
            'La multiplicación explica por qué el problema nunca aparece pronto. En preproducción, la hija tiene diez mil filas, el escaneo cabe en memoria y cuesta menos de un milisegundo. En los primeros meses de producción, la purga tarda segundos. La degradación es continua y silenciosa, sin un escalón que dispare una alerta, hasta el día en que la duración del job supera algo que importa: la ventana de mantenimiento, el intervalo del planificador, el timeout de una migración o la paciencia del pool de conexiones.',
        },
        {
          type: 'paragraph',
          value:
            'Hay una consecuencia todavía menos intuitiva. Con NO ACTION, que es el valor por defecto cuando nadie escribe nada, borrar un pedido que no tiene ninguna fila en la hija cuesta exactamente el mismo escaneo completo. La base necesita demostrar la ausencia, y sin índice la única forma de demostrar que ninguna de las cuarenta millones de filas apunta a ese pedido es leerlas todas.',
        },
      ],
    },
    {
      title: 'Lo que hace la base por debajo cuando borras la fila padre',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La forma más rápida de confirmar el diagnóstico es el EXPLAIN ANALYZE del propio DELETE. Ejecuta el comando de verdad, así que debe correr dentro de una transacción que termina en ROLLBACK, y preferiblemente en una copia restaurada de la base, porque incluso revertido mantiene los bloqueos durante toda la ejecución. Lo que interesa no es el plan, sino las líneas de disparador que aparecen al final de la salida, con el tiempo acumulado y el número de llamadas de cada restricción.',
        },
        {
          type: 'code',
          value: `-- Ejecutar en una copia restaurada: EXPLAIN ANALYZE ejecuta el DELETE de
-- verdad y mantiene los bloqueos hasta el ROLLBACK.
BEGIN;

EXPLAIN (ANALYZE, BUFFERS)
DELETE FROM pedidos
WHERE estado = 'cancelado'
  AND actualizado_en < now() - interval '90 days';

ROLLBACK;

-- Salida resumida:
--  Delete on pedidos (actual time=41.2..41.2 rows=0 loops=1)
--    ->  Index Scan using pedidos_estado_actualizado_idx on pedidos
--          (actual time=0.03..8.9 rows=2000 loops=1)
--  Planning Time: 0.4 ms
--  Trigger for constraint historial_estado_pedido_id_fkey: time=3171840.5 calls=2000
--  Trigger for constraint pagos_pedido_id_fkey: time=96.1 calls=2000
--  Execution Time: 3171990.3 ms
--
-- El DELETE en si tardo 41 ms. Los 53 minutos estan enteros en una
-- restriccion: 2.000 llamadas, cerca de 1,6 s cada una, un escaneo de
-- historial_estado por pedido. La restriccion de pagos tiene indice y
-- cuesta 96 ms en total.`,
        },
        {
          type: 'paragraph',
          value:
            'La comparación entre las dos líneas de disparador es lo que cierra el caso sin discusión. Las dos restricciones reciben el mismo número de llamadas, una por pedido eliminado, y la diferencia de cuatro órdenes de magnitud en el tiempo viene solo de la existencia del índice. Cuando no se puede ejecutar el EXPLAIN ANALYZE, el síntoma también aparece en las estadísticas: el contador seq_scan de la tabla hija en pg_stat_user_tables sube de a miles durante la ventana del job, y seq_tup_read lo acompaña en el orden de los miles de millones.',
        },
        {
          type: 'paragraph',
          value:
            'El comportamiento varía entre motores, y la variación importa para quien opera más de una base o migra entre ellas. Quien viene de MySQL suele no conocer el problema porque InnoDB exige un índice en la columna de la clave foránea y crea uno automáticamente si no existe. Quien viene de Oracle conoce su versión más agresiva, en la que la falta de índice hace que el borrado en el padre bloquee la tabla hija entera durante el comando.',
        },
        {
          type: 'table',
          columns: ['Motor', '¿Crea índice en la columna hija?', 'Borrado en el padre sin índice en la hija', 'Cómo aparece el bloqueo'],
          rows: [
            [
              'PostgreSQL',
              'No',
              'Un escaneo secuencial de la hija por fila borrada, dentro de la misma transacción',
              'Transacción larga reteniendo bloqueos; un cambio de esquema en la cola congela todo acceso a la tabla',
            ],
            [
              'MySQL (InnoDB)',
              'Sí, exige índice y crea uno si falta',
              'Búsqueda por índice; el riesgo pasa a las cascadas enormes en una sola transacción',
              'Bloqueos de fila y de intervalo acumulados por la cascada',
            ],
            [
              'SQL Server',
              'No',
              'Escaneo de la hija en cada verificación o cascada',
              'Miles de bloqueos de fila escalan a un bloqueo de la tabla entera',
            ],
            [
              'Oracle',
              'No',
              'Bloqueo compartido de tabla en la hija durante el comando',
              'Cualquier escritura en la hija espera, incluso en filas sin relación con el borrado',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El mismo mecanismo se dispara en más situaciones que el borrado explícito. Un UPDATE que cambia el valor de la clave primaria del padre ejecuta la misma búsqueda en la hija. ON DELETE SET NULL hace un UPDATE en la hija por cada fila del padre, con el mismo escaneo. Y una solicitud de supresión de datos según el RGPD, que elimina un cliente con cascada a pedidos, que a su vez se propaga a historial, pagos y eventos, multiplica el problema por cada nivel del árbol en el que falta índice.',
        },
      ],
    },
    {
      title: 'Cómo un borrado lento se convierte en la tabla entera bloqueada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En PostgreSQL, un borrado lento por sí solo no bloquea la tabla hija para todo el mundo. Retiene bloqueos de fila en los pedidos eliminados, bloqueos de fila en las filas de historial que la cascada borra y un bloqueo ROW EXCLUSIVE en las tablas involucradas, que convive con lecturas y con otras escrituras. Durante cincuenta y tres minutos eso es un desperdicio de disco y de CPU, no una caída. Lo que convierte la lentitud en indisponibilidad es el segundo participante: cualquier comando que necesite un bloqueo fuerte en la misma tabla.',
        },
        {
          type: 'paragraph',
          value:
            'Un ALTER TABLE que añade una columna, aunque sea una operación instantánea de metadatos, pide ACCESS EXCLUSIVE, el modo que entra en conflicto con todos los demás. Entra en la cola detrás de la transacción de la purga y espera. El problema es que la cola de bloqueos es ordenada: toda solicitud de bloqueo que llega después y choca con el ACCESS EXCLUSIVE pendiente queda detrás de él, incluso un simple INSERT, que por sí solo sería compatible con la purga. A partir de ese momento la tabla está bloqueada para cualquier acceso, y sigue así hasta que la purga termina y la migración se ejecuta.',
        },
        {
          type: 'diagram',
          value: `09:30  purga        BEGIN; DELETE FROM pedidos ...
                     ROW EXCLUSIVE en historial_estado, dura 53 min
10:05  migracion    ALTER TABLE historial_estado ADD COLUMN origen text
                     pide ACCESS EXCLUSIVE -> espera a la purga
10:05  checkout #1  INSERT INTO historial_estado ... -> espera a la migracion
10:05  checkout #2  INSERT INTO historial_estado ... -> espera a la migracion
  ...               todo cambio de estado del sistema entra en la cola
10:06  pool de conexiones agotado, el checkout responde 503
10:23  la purga hace COMMIT -> la migracion corre en 40 ms -> la cola se vacia

Ninguno de los tres comandos es lento por si solo, salvo la purga.
La caida nace de la combinacion: transaccion larga + bloqueo fuerte en cola.`,
        },
        {
          type: 'paragraph',
          value:
            'Hay un efecto secundario más lento que continúa después del incidente. Una transacción abierta durante casi una hora impide que el autovacuum limpie versiones muertas de filas en toda la base, no solo en las tablas involucradas, porque el horizonte de visibilidad queda anclado en su inicio. Las tablas con alta tasa de actualización se inflan durante la ventana y las consultas se vuelven más lentas en las horas siguientes, lo que suele investigarse como un segundo problema sin relación.',
        },
        {
          type: 'paragraph',
          value:
            'Mientras el bloqueo está ocurriendo, la pregunta útil no es qué consulta está lenta, sino quién está esperando a quién. La función pg_blocking_pids devuelve, para cada sesión, las sesiones que la bloquean, y cruzarlo con los bloqueos no concedidos muestra la cadena entera en una sola consulta. El patrón del incidente es inconfundible: cientos de sesiones esperando a una única sesión de migración, que a su vez espera a una única transacción antigua.',
        },
        {
          type: 'code',
          value: `-- Quien espera a quien, con la edad de la transaccion y el modo de bloqueo pedido.
SELECT
  a.pid,
  pg_blocking_pids(a.pid)   AS bloqueado_por,
  now() - a.xact_start      AS edad_transaccion,
  l.mode                    AS modo_pedido,
  l.relation::regclass      AS tabla,
  left(a.query, 60)         AS consulta
FROM pg_stat_activity a
LEFT JOIN pg_locks l
  ON l.pid = a.pid AND NOT l.granted
WHERE cardinality(pg_blocking_pids(a.pid)) > 0
ORDER BY a.xact_start;

-- Resultado tipico del incidente:
--   pid  | bloqueado_por | edad_transaccion | modo_pedido         | consulta
--   8812 | {7710}        | 00:18:02         | AccessExclusiveLock | ALTER TABLE historial_estado ...
--   9031 | {8812}        | 00:00:41         | RowExclusiveLock    | INSERT INTO historial_estado ...
--   9044 | {8812}        | 00:00:39         | RowExclusiveLock    | INSERT INTO historial_estado ...
--   (212 filas mas bloqueadas por 8812)
--
-- 7710 es la purga. Cancelar la migracion (pg_cancel_backend(8812)) libera
-- la cola en segundos; la purga puede seguir mientras el indice no exista.`,
        },
        {
          type: 'paragraph',
          value:
            'La mitigación inmediata es cancelar la migración, no la purga. Cancelar la purga después de cincuenta minutos tira a la basura todo el trabajo, y el rollback de un borrado grande también lleva tiempo. Cancelar la migración libera la cola en segundos, y se puede repetir después. La prevención estructural para este lado del problema es independiente del índice: toda migración que pide un bloqueo fuerte debe ejecutarse con un lock_timeout corto, de tres a cinco segundos, y con reintentos. Una migración que desiste tras cinco segundos de espera es un aviso en el registro del despliegue; una que espera indefinidamente es una caída.',
        },
      ],
    },
    {
      title: 'Encontrar todas las claves foráneas sin índice antes del incidente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Esperar al próximo job lento para descubrir la próxima restricción sin índice es la estrategia que mantiene vivo el problema. El catálogo de la base tiene toda la información necesaria para listar, de una vez, cada clave foránea cuya tabla hija no tiene un índice capaz de atender la búsqueda de la restricción. El criterio correcto es más estricto de lo que parece: no basta con que exista un índice que contenga la columna.',
        },
        {
          type: 'list',
          items: [
            'El índice tiene que empezar por las columnas de la clave foránea. Un índice en (creado_en, pedido_id) no sirve para buscar por pedido_id, porque la columna no es la primera.',
            'En una clave compuesta, las columnas de la restricción deben ocupar las primeras posiciones del índice, en cualquier orden entre ellas. Un índice solo por tenant_id no atiende una restricción en (tenant_id, pedido_id) en una tabla con millones de filas por inquilino.',
            'Un índice parcial no cuenta. Un índice en pedido_id WHERE activo no lo usa la consulta interna de la restricción, que no tiene ese filtro.',
            'Un índice inválido no cuenta. Una creación concurrente que falló deja el índice en el catálogo, ocupando espacio y costando escritura, sin que ninguna consulta lo use.',
            'Las columnas añadidas con INCLUDE no cuentan como clave de búsqueda, solo las columnas clave del índice.',
          ],
        },
        {
          type: 'code',
          value: `-- fk-sin-indice.sql
-- Claves foraneas cuya tabla hija no tiene un indice valido, no parcial,
-- que empiece exactamente por las columnas de la restriccion. Ordenado por el
-- tamano de la hija, que es lo que define el costo de cada escaneo.
SELECT
  c.conrelid::regclass  AS tabla_hija,
  c.conname             AS restriccion,
  c.confrelid::regclass AS tabla_padre,
  (SELECT string_agg(a.attname, ', ' ORDER BY k.pos)
     FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, pos)
     JOIN pg_attribute a
       ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columnas,
  CASE c.confdeltype
    WHEN 'c' THEN 'cascade'
    WHEN 'n' THEN 'set null'
    WHEN 'd' THEN 'set default'
    WHEN 'r' THEN 'restrict'
    ELSE 'no action'
  END AS al_borrar,
  pg_size_pretty(pg_relation_size(c.conrelid)) AS tamano_hija
FROM pg_constraint c
WHERE c.contype = 'f'
  AND NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = c.conrelid
      AND i.indisvalid
      AND i.indpred IS NULL
      AND i.indnkeyatts >= cardinality(c.conkey)
      -- Las N primeras columnas del indice son exactamente las N columnas de la FK.
      AND (SELECT array_agg(x.attnum ORDER BY x.attnum)
             FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS x(attnum, pos)
            WHERE x.pos <= cardinality(c.conkey))
        = (SELECT array_agg(y ORDER BY y) FROM unnest(c.conkey) AS y)
  )
ORDER BY pg_relation_size(c.conrelid) DESC;`,
        },
        {
          type: 'paragraph',
          value:
            'La primera ejecución de esta consulta en una base con algunos años suele devolver entre diez y cincuenta restricciones, y la reacción natural es crear índice en todas. No es necesario, y el orden existe justamente para evitarlo. Lo que importa es cruzar tres columnas: el tamaño de la hija, que define el costo de cada escaneo; la regla de borrado, que dice si el padre sufre eliminaciones con efecto en la hija; y el conocimiento del dominio sobre la tabla padre, que dice si es un catálogo inmutable o una tabla transaccional con purgas, cancelaciones o solicitudes de supresión de datos.',
        },
        {
          type: 'paragraph',
          value:
            'Un detalle de lectura: en tablas particionadas, la consulta devuelve la restricción en la tabla particionada, con tamaño cero, y en cada partición, con el tamaño real. El índice debe crearse en la tabla particionada, que lo propaga a todas las particiones actuales y futuras, y no partición por partición.',
        },
      ],
    },
    {
      title: 'Crear el índice en producción sin provocar el bloqueo que quieres evitar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La corrección es una línea, pero la forma ingenua de aplicarla repite el incidente. Un CREATE INDEX común pide un bloqueo SHARE en la tabla, que impide cualquier escritura durante toda la construcción. En una tabla de cuarenta millones de filas eso son varios minutos sin grabar historial, es decir, varios minutos sin checkout. La variante CONCURRENTLY construye el índice sin bloquear escrituras, a costa de leer la tabla dos veces y de tres restricciones operativas que causan la mayoría de los fallos.',
        },
        {
          type: 'ordered',
          items: [
            'No puede ejecutarse dentro de un bloque de transacción. Las herramientas de migración que envuelven cada archivo en BEGIN y COMMIT necesitan una marca explícita para desactivarlo en ese archivo, y sin ella el comando falla en el acto.',
            'Espera a que terminen todas las transacciones que ya tocan la tabla antes de concluir. Si la purga lenta está en marcha, la creación del índice queda detenida detrás de ella. Detén el job antes, o ejecútala fuera de su ventana.',
            'Un fallo a mitad de camino, por timeout, cancelación o conflicto, deja el índice en el catálogo marcado como inválido. Recibe todas las escrituras y no sirve ninguna lectura, lo peor de los dos mundos.',
            'IF NOT EXISTS no protege contra el punto anterior: considera el índice inválido como existente y devuelve éxito sin hacer nada. Un reintento automático con IF NOT EXISTS después de un fallo deja el índice roto para siempre, en silencio.',
          ],
        },
        {
          type: 'code',
          value: `-- migracion: 20260922_historial_estado_pedido_id_idx.sql
-- Debe ejecutarse FUERA de una transaccion explicita (desactiva el BEGIN
-- automatico de la herramienta para este archivo) y con la purga detenida.

-- La construccion puede tardar minutos; un timeout a mitad deja el indice invalido.
SET statement_timeout = 0;

CREATE INDEX CONCURRENTLY historial_estado_pedido_id_idx
  ON historial_estado (pedido_id);

-- Verificacion obligatoria despues de crear: indisvalid tiene que ser true.
SELECT indexrelid::regclass AS indice, indisvalid, indisready
FROM pg_index
WHERE indexrelid = 'historial_estado_pedido_id_idx'::regclass;

-- Si indisvalid vuelve false, elimina el indice y repite el CREATE de arriba.
-- No uses IF NOT EXISTS como reintento: acepta el indice invalido.
-- DROP INDEX CONCURRENTLY historial_estado_pedido_id_idx;`,
        },
        {
          type: 'paragraph',
          value:
            'Con el índice válido, la purga baja de cincuenta y tres minutos a menos de un segundo, y el problema principal está resuelto. Aun así conviene cambiar la forma del job, porque el índice resuelve el costo por fila, pero no el tamaño de la transacción. Borrar dos mil pedidos en un único comando sigue reteniendo dos mil bloqueos de fila hasta el COMMIT, y el día en que las cancelaciones sean diez veces más, por una campaña o por un fallo masivo de pagos, la transacción vuelve a ser larga. Procesar en lotes con COMMIT entre ellos mantiene cada transacción corta, sin importar el volumen del día.',
        },
        {
          type: 'code',
          value: `-- Purga por lotes: cada lote es una transaccion corta. Requiere PostgreSQL 11+
-- (COMMIT dentro de un procedimiento) y debe llamarse fuera de una transaccion.
CREATE OR REPLACE PROCEDURE purgar_pedidos_cancelados(tamano_lote int DEFAULT 500)
LANGUAGE plpgsql
AS $$
DECLARE
  borrados int;
BEGIN
  LOOP
    DELETE FROM pedidos
    WHERE id IN (
      SELECT id
      FROM pedidos
      WHERE estado = 'cancelado'
        AND actualizado_en < now() - interval '90 days'
      ORDER BY id
      LIMIT tamano_lote
      -- Las filas bloqueadas por otra sesion quedan para la proxima ejecucion.
      FOR UPDATE SKIP LOCKED
    );
    GET DIAGNOSTICS borrados = ROW_COUNT;
    EXIT WHEN borrados = 0;

    COMMIT;                -- libera bloqueos y el horizonte del vacuum
    PERFORM pg_sleep(0.1); -- da respiro a la replicacion y al disco
  END LOOP;
END;
$$;

CALL purgar_pedidos_cancelados(500);`,
        },
      ],
    },
    {
      title: 'No toda clave foránea merece un índice, y la decisión tiene que quedar escrita',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un índice en cada clave foránea es una regla fácil de seguir y razonable como valor por defecto, pero tiene un costo real en tablas de escritura intensa: un árbol más que actualizar en cada INSERT, más páginas en caché, más volumen en el WAL y en la replicación. Hay un conjunto pequeño de casos en los que prescindir del índice es la elección correcta, y lo que separa una exención consciente de un olvido es justamente el registro de la decisión.',
        },
        {
          type: 'table',
          columns: ['Situación', 'Índice en la columna de la FK', 'Motivo'],
          rows: [
            [
              'El padre sufre borrados o cambios de clave: purga, cancelación, solicitud de supresión de datos',
              'Obligatorio',
              'Sin él, cada fila eliminada en el padre recorre la hija entera',
            ],
            [
              'La hija se consulta por la FK: ítems del pedido, joins, pantallas de detalle',
              'Obligatorio',
              'El mismo índice sirve para la lectura y para mantener la integridad',
            ],
            [
              'El padre es un catálogo pequeño e inmutable (moneda, país, tipo) y la hija tiene escritura altísima',
              'Se puede omitir, con la excepción registrada',
              'El escaneo solo ocurriría en un borrado que el dominio no permite',
            ],
            [
              'FK compuesta con identificador de inquilino',
              'Índice con todas las columnas de la FK al frente',
              'Un índice solo por inquilino no localiza las filas de un padre concreto',
            ],
            [
              'Tabla particionada',
              'Crearlo en la tabla particionada',
              'Se propaga a las particiones actuales y futuras; el índice por partición olvida las nuevas',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tercera fila es la única exención legítima, y tiene una condición que envejece: el catálogo es inmutable hoy. El día en que alguien decida eliminar un tipo de pago descontinuado, ese borrado de una sola fila va a recorrer una tabla de cientos de millones de registros dentro de una transacción. Por eso la excepción tiene que estar escrita en un lugar que alguien lea cuando la premisa cambie, y no solo en la memoria de quien decidió.',
        },
        {
          type: 'paragraph',
          value:
            'El lugar correcto para eso es el CI. La misma consulta de catálogo, ejecutada contra la base creada por las migraciones del repositorio, convierte el problema de un descubrimiento en producción en un fallo de build en el pull request que añadió la restricción. La lista de excepciones vive en el código, con una justificación por entrada, y el script avisa cuando una excepción dejó de ser necesaria, para que la lista no acumule entradas muertas.',
        },
        {
          type: 'code',
          value: `// verificar-fk-sin-indice.mjs
// Corre en el CI contra la base creada por las migraciones. Rompe el build
// cuando aparece una clave foranea sin indice fuera de la lista de excepciones.
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Toda excepcion exige justificacion: quien lo lea dentro de un ano tiene que
// saber por que la restriccion quedo sin indice a proposito.
const EXCEPCIONES = new Map([
  ['pagos_moneda_fkey', 'monedas es un catalogo inmutable; sin borrados ni cambios de clave'],
]);

const sql = await readFile(new URL('./fk-sin-indice.sql', import.meta.url), 'utf8');
const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });

await cliente.connect();
try {
  const { rows } = await cliente.query(sql);
  const encontradas = new Set(rows.map((fila) => fila.restriccion));
  const violaciones = rows.filter((fila) => !EXCEPCIONES.has(fila.restriccion));

  for (const v of violaciones) {
    console.error(
      \`FK sin indice: \${v.restriccion} en \${v.tabla_hija} (\${v.columnas}) -> \${v.tabla_padre}, al borrar: \${v.al_borrar}\`,
    );
  }
  for (const nombre of EXCEPCIONES.keys()) {
    if (!encontradas.has(nombre)) console.warn(\`Excepcion obsoleta, quitala de la lista: \${nombre}\`);
  }

  if (violaciones.length > 0) process.exitCode = 1;
} finally {
  await cliente.end();
}`,
        },
        {
          type: 'paragraph',
          value:
            'Con esa verificación en el pipeline, el costo de mantener la regla cae casi a cero: quien crea una restricción nueva recibe el fallo en el mismo pull request, con el nombre de la tabla y de la columna, y decide ahí mismo entre crear el índice en la misma migración o registrar la excepción con su motivo. La decisión sigue siendo humana; lo que desaparece es la posibilidad de que nunca se tome.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Crear un índice en cada clave foránea no va a hacer más lenta la escritura?',
      answer:
        'Sí, y el costo debe medirse en lugar de suponerse, porque en la mayoría de las tablas es bastante menor de lo que sugiere la intuición. Cada índice adicional suma a cada INSERT una inserción en un árbol B, algunas páginas más en los buffers compartidos y un volumen proporcional en el WAL, que también llega a la replicación y a los respaldos. En una tabla que ya tiene clave primaria y dos o tres índices, añadir uno más suele representar un aumento de entre diez y veinte por ciento en el costo de escritura de esa tabla, y rara vez es el cuello de botella del sistema, porque el tiempo de una transacción típica lo dominan la red, la validación y otras consultas. El otro lado de la cuenta es asimétrico: sin el índice, un único borrado en el padre cuesta un escaneo completo de la hija, y una purga cuesta ese escaneo multiplicado por el número de filas eliminadas, dentro de una transacción que retiene bloqueos. Los casos en los que el costo de escritura realmente pesa son las tablas de ingesta con decenas de miles de inserciones por segundo, como eventos, telemetría y registros de auditoría, y son precisamente las que más crecen. Para ellas, la pregunta correcta no es si el índice cuesta, sino si el padre puede sufrir borrados. Si el padre es un catálogo inmutable, omitir el índice con la excepción registrada es legítimo. Si el padre es transaccional, la alternativa al índice no es ahorrar escritura, es cambiar el modelo: particionar la hija por tiempo y purgar eliminando particiones antiguas, sin ningún DELETE, lo que elimina tanto el escaneo como el costo de la cascada.',
    },
    {
      question: '¿Por qué el problema no aparece en preproducción ni en las pruebas de carga?',
      answer:
        'Porque el costo es el producto de dos magnitudes que los entornos de prueba mantienen pequeñas al mismo tiempo, y el producto de dos números pequeños es irrelevante. En preproducción, la tabla hija tiene entre miles y unos pocos millones de filas, cabe entera en caché y un escaneo secuencial cuesta entre uno y diez milisegundos. El volumen de borrados también es bajo, porque nadie simula la purga de dos mil pedidos al día en una base de pruebas. Incluso una prueba de carga bien hecha suele ejercitar lectura y escritura en el camino caliente, como checkout, búsqueda e inicio de sesión, y no jobs de mantenimiento que corren una vez al día sobre datos acumulados durante años. Hay además un efecto de caché que enmascara la medición: mientras la hija cabe en memoria, el escaneo está limitado por CPU y parece aceptable; cuando supera la memoria disponible, cada escaneo se convierte en lectura de disco y el tiempo salta un orden de magnitud de una semana a otra, sin que nada haya cambiado en el código. Por eso la forma fiable de detectar este defecto no es la prueba de rendimiento, sino la inspección estructural: la consulta de catálogo que lista las claves foráneas sin índice encuentra el problema en una base vacía, el primer día, sin importar el volumen. Es una verificación que cuesta milisegundos, no depende de datos realistas y no tiene falsos negativos por falta de volumen, lo que la hace mucho más adecuada para el CI que cualquier intento de reproducir el tamaño de producción.',
    },
    {
      question: '¿Reemplazar ON DELETE CASCADE por un borrado hecho desde la aplicación resuelve el problema?',
      answer:
        'No lo resuelve, y suele empeorarlo, porque la aplicación tiene que hacer exactamente la misma búsqueda que hace el disparador interno, con las mismas consecuencias cuando falta el índice. Para borrar los hijos de un pedido antes de borrar el pedido, la aplicación ejecuta un DELETE en la hija filtrando por pedido_id, y sin índice ese comando es el mismo escaneo secuencial, ahora disparado por tu código en lugar del disparador. Si la restricción sigue existiendo con NO ACTION, la base todavía ejecuta la verificación de existencia después, y sin índice esa verificación es un segundo escaneo. Si se elimina la restricción para evitarlo, el problema cambia de naturaleza: la integridad pasa a depender de que cada camino de escritura de la aplicación haga lo correcto, incluidos scripts de mantenimiento, correcciones manuales y servicios nuevos que nadie recordó actualizar, y en pocos meses empiezan a aparecer registros huérfanos. También hay una pérdida de atomicidad cuando el borrado se hace en varias llamadas sin una transacción única, lo que deja estados intermedios visibles para otras sesiones. El borrado lógico, con una columna de marca en vez de DELETE, evita la cascada en el momento de marcar, pero empuja el problema a la purga física que algún día tiene que ocurrir, por volumen o por obligación legal, y esa purga se encuentra con la misma hija sin índice. La corrección que realmente elimina el costo es el índice en la columna de la clave foránea, combinado con borrado en lotes cortos, manteniendo la restricción en la base como la garantía de integridad que es.',
    },
  ],
  conclusion: {
    title: 'La clave foránea garantiza la integridad, el índice garantiza que mantenerla sea barato',
    description:
      'Declarar una clave foránea sin índice en la columna de la hija es firmar un costo que solo aparece años después, multiplicado por el tamaño de la tabla y el volumen de borrados, y que llega en forma de un job lento que se encuentra con un cambio de esquema en la cola y detiene la tabla entera. El diagnóstico está en las líneas de disparador del EXPLAIN ANALYZE, la lista completa está en el catálogo, la corrección es un índice creado de forma concurrente y verificado después, y la prevención es una verificación en el CI con excepciones justificadas. Puedo ejecutar el relevamiento en tu base, priorizar las restricciones por riesgo real, crear los índices en producción sin ventana de mantenimiento y dejar la verificación en el pipeline para que la próxima restricción nazca correcta.',
    cta: 'Revisar las claves foráneas de mi base',
  },
  related: [
    {
      label: 'El índice que la base decidió ignorar: cuándo el plan de consulta cambia solo',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Migración de base de datos sin ventana: expandir, migrar y contraer sin detener la escritura',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Arquitectura y Modernización Backend',
      to: '/servicios/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
