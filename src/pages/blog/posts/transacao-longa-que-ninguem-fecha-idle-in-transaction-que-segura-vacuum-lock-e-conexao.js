// Conteudo do artigo: transacao longa que ninguem fecha. O que uma sessao "idle in transaction"
// segura mesmo sem executar nada (locks, horizonte de xmin e uma conexao do pool), como encontrar
// a sessao e o que ela esta travando com pg_stat_activity e pg_locks, de onde essas transacoes
// nascem no codigo Node.js, como garantir o fim pelo codigo e pelo servidor e o que monitorar.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const diagnosticoCode = `-- Sessoes com transacao aberta ha mais de 30 s, da mais antiga para a mais nova.
-- "idle in transaction" e a pior combinacao: segura tudo e nao executa nada.
SELECT pid,
       usename,
       application_name,
       client_addr,
       state,
       now() - xact_start                        AS idade_transacao,
       now() - state_change                      AS parada_ha,
       age(backend_xmin)                         AS xids_retidos,   -- quanto do vacuum esta preso
       wait_event_type || ':' || wait_event      AS esperando,
       left(query, 80)                           AS ultimo_comando
  FROM pg_stat_activity
 WHERE backend_type = 'client backend'
   AND xact_start IS NOT NULL
   AND now() - xact_start > interval '30 seconds'
 ORDER BY xact_start;

-- O que a sessao esta segurando: tabelas e modos de lock.
SELECT l.pid,
       l.locktype,
       l.relation::regclass AS tabela,
       l.mode,
       l.granted
  FROM pg_locks l
 WHERE l.pid = 48213            -- pid da sessao suspeita
   AND l.locktype = 'relation'
 ORDER BY tabela;

-- Quem esta preso atras dela, direta ou indiretamente.
SELECT pid,
       state,
       now() - xact_start AS esperando_ha,
       pg_blocking_pids(pid) AS bloqueado_por,
       left(query, 80) AS query
  FROM pg_stat_activity
 WHERE cardinality(pg_blocking_pids(pid)) > 0
 ORDER BY xact_start;

-- O horizonte que o vacuum consegue enxergar neste momento.
SELECT min(age(backend_xmin)) FILTER (WHERE backend_xmin IS NOT NULL) AS mais_antiga_sessao,
       (SELECT max(age(xmin)) FROM pg_replication_slots)             AS slot_mais_antigo,
       (SELECT max(age(transaction)) FROM pg_prepared_xacts)         AS prepared_mais_antiga
  FROM pg_stat_activity;`;

const padraoRuimCode = `// faturamento.js (antes): tres formas de deixar a transacao aberta sem perceber.
export async function emitirFatura(pool, pedidoId) {
  const client = await pool.connect();
  await client.query('BEGIN');

  const { rows } = await client.query(
    'SELECT * FROM pedidos WHERE id = $1 FOR UPDATE',
    [pedidoId],
  );
  const pedido = rows[0];

  // 1. Retorno antecipado: sai da funcao com BEGIN aberto e sem release.
  if (pedido.status === 'faturado') return pedido;

  // 2. Chamada externa dentro da transacao: o lock em pedidos e o xmin ficam
  //    presos pelo tempo que o ERP levar para responder. Sem timeout, para sempre.
  const nota = await fetch(process.env.ERP_URL + '/notas', {
    method: 'POST',
    body: JSON.stringify({ pedidoId, total: pedido.total }),
  }).then((r) => r.json());

  await client.query(
    'UPDATE pedidos SET status = $2, nota_fiscal = $3 WHERE id = $1',
    [pedidoId, 'faturado', nota.numero],
  );

  // 3. Se qualquer await acima lancar, nao ha ROLLBACK nem release: a conexao
  //    volta ao pool (ou nem isso) com a transacao ainda aberta.
  await client.query('COMMIT');
  client.release();
  return { ...pedido, nota };
}`;

const padraoBomCode = `// db/transacao.js: todo caminho de saida termina a transacao e devolve a conexao.
import { setTimeout as sleep } from 'node:timers/promises';

export async function emTransacao(pool, trabalho, { nome, limiteMs = 5000 } = {}) {
  const client = await pool.connect();
  let terminou = false;
  try {
    await client.query('BEGIN');
    // Nomeia a transacao para pg_stat_activity e limita a duracao no servidor:
    // uma transacao que estoura o limite cai por timeout, nao fica pendurada.
    await client.query(\`SET LOCAL application_name = '\${nome ?? 'app'}'\`);
    await client.query(\`SET LOCAL idle_in_transaction_session_timeout = '\${limiteMs}ms'\`);
    await client.query(\`SET LOCAL lock_timeout = '2s'\`);

    const resultado = await trabalho(client);

    await client.query('COMMIT');
    terminou = true;
    return resultado;
  } catch (erro) {
    try {
      await client.query('ROLLBACK');
      terminou = true;
    } catch {
      // Conexao quebrada: nao pode voltar ao pool.
    }
    throw erro;
  } finally {
    // Uma conexao cujo estado e incerto e descartada, nunca reutilizada.
    client.release(terminou ? undefined : new Error('transacao em estado desconhecido'));
  }
}

// faturamento.js (depois): o banco decide dentro da transacao, o mundo externo fica fora.
export async function emitirFatura(pool, pedidoId) {
  // Fase 1: curta, so banco. Marca a intencao e registra o efeito pendente (outbox).
  const reservado = await emTransacao(
    pool,
    async (client) => {
      const { rows } = await client.query(
        \`UPDATE pedidos
            SET status = 'faturando'
          WHERE id = $1 AND status = 'pago'
      RETURNING id, total\`,
        [pedidoId],
      );
      if (!rows[0]) return null; // ja faturado ou em andamento: nada a fazer
      await client.query(
        \`INSERT INTO efeitos_pendentes (tipo, chave, payload)
         VALUES ('emitir_nota', $1, $2)
         ON CONFLICT (tipo, chave) DO NOTHING\`,
        [\`pedido:\${pedidoId}\`, JSON.stringify(rows[0])],
      );
      return rows[0];
    },
    { nome: 'faturamento:reservar' },
  );
  if (!reservado) return;

  // Fase 2: chamada externa sem nenhuma transacao aberta, com timeout proprio.
  const nota = await emitirNoErp(reservado, { timeoutMs: 15000 });

  // Fase 3: curta, so banco. Idempotente: se o worker reprocessar, nao duplica.
  await emTransacao(
    pool,
    async (client) => {
      await client.query(
        \`UPDATE pedidos SET status = 'faturado', nota_fiscal = $2
          WHERE id = $1 AND status = 'faturando'\`,
        [pedidoId, nota.numero],
      );
      await client.query(
        \`DELETE FROM efeitos_pendentes WHERE tipo = 'emitir_nota' AND chave = $1\`,
        [\`pedido:\${pedidoId}\`],
      );
    },
    { nome: 'faturamento:confirmar' },
  );
}

async function emitirNoErp(pedido, { timeoutMs }) {
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      const resposta = await fetch(process.env.ERP_URL + '/notas', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': \`pedido:\${pedido.id}\` },
        body: JSON.stringify({ pedidoId: pedido.id, total: pedido.total }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!resposta.ok) throw new Error(\`ERP respondeu \${resposta.status}\`);
      return resposta.json();
    } catch (erro) {
      if (tentativa >= 3) throw erro;
      await sleep(500 * 2 ** tentativa);
    }
  }
}`;

const limitesCode = `-- Limites por papel: cada tipo de cliente do banco tem um teto proprio.
-- A aplicacao nao tem motivo para ficar parada dentro de uma transacao.
ALTER ROLE app_api      SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE app_api      SET statement_timeout = '15s';
ALTER ROLE app_api      SET lock_timeout = '3s';

-- Workers fazem lotes maiores, mas tambem nao param no meio.
ALTER ROLE app_worker   SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE app_worker   SET statement_timeout = '5min';

-- BI e pessoas: consultas longas sao legitimas, transacao parada nao e.
ALTER ROLE bi_leitura   SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE bi_leitura   SET statement_timeout = '30min';
ALTER ROLE bi_leitura   SET default_transaction_read_only = on;

-- Postgres 17 ou superior: teto para a transacao inteira, ativa ou parada.
ALTER ROLE app_api      SET transaction_timeout = '30s';

-- Migracoes: desistem do lock rapido em vez de formar fila atras de alguem.
ALTER ROLE app_migracao SET lock_timeout = '5s';

-- Alerta: idade da transacao mais antiga por estado, para o coletor de metricas.
SELECT state,
       count(*)                                             AS sessoes,
       coalesce(extract(epoch FROM max(now() - xact_start)), 0)::int AS mais_antiga_s
  FROM pg_stat_activity
 WHERE backend_type = 'client backend'
   AND xact_start IS NOT NULL
 GROUP BY state;`;

const diagramaPt = `t=0        worker abre BEGIN, faz SELECT ... FOR UPDATE em pedidos (pid 48213)
t=0,2 s    worker chama o ERP e fica esperando (state = idle in transaction)
t=0,2 s    locks em pedidos e xmin = 9.412.807 ficam presos; 1 conexao do pool ocupada
t=3 min    autovacuum em pedidos termina sem remover nada: tuplas mortas > xmin retido
t=12 min   migracao roda ALTER TABLE pedidos ADD COLUMN: pede ACCESS EXCLUSIVE, entra na fila
t=12 min   toda consulta nova em pedidos entra na fila atras do ALTER: a API trava
t=14 min   pool da API chega a 40/40 conexoes esperando lock; p99 passa de 30 s
t=47 min   ERP responde; worker faz UPDATE e COMMIT; fila inteira anda em 400 ms`;

const diagramaEn = `t=0        worker opens BEGIN, runs SELECT ... FOR UPDATE on orders (pid 48213)
t=0.2 s    worker calls the ERP and waits (state = idle in transaction)
t=0.2 s    locks on orders and xmin = 9,412,807 are held; 1 pool connection busy
t=3 min    autovacuum on orders finishes removing nothing: dead tuples > retained xmin
t=12 min   migration runs ALTER TABLE orders ADD COLUMN: asks ACCESS EXCLUSIVE, queues up
t=12 min   every new query on orders queues behind the ALTER: the API stalls
t=14 min   API pool reaches 40/40 connections waiting on locks; p99 passes 30 s
t=47 min   ERP answers; worker runs UPDATE and COMMIT; the whole queue drains in 400 ms`;

const diagramaEs = `t=0        worker abre BEGIN, hace SELECT ... FOR UPDATE en pedidos (pid 48213)
t=0,2 s    worker llama al ERP y se queda esperando (state = idle in transaction)
t=0,2 s    locks en pedidos y xmin = 9.412.807 quedan retenidos; 1 conexión del pool ocupada
t=3 min    autovacuum en pedidos termina sin eliminar nada: tuplas muertas > xmin retenido
t=12 min   migración ejecuta ALTER TABLE pedidos ADD COLUMN: pide ACCESS EXCLUSIVE, entra en cola
t=12 min   toda consulta nueva en pedidos entra en cola detrás del ALTER: la API se traba
t=14 min   pool de la API llega a 40/40 conexiones esperando lock; p99 supera 30 s
t=47 min   ERP responde; worker hace UPDATE y COMMIT; toda la cola avanza en 400 ms`;

const pt = {
  intro:
    'Um SaaS de logística com 40 conexões no pool da API e um worker de faturamento sofreu três incidentes no mesmo mês que pareciam não ter relação: a API travando por alguns minutos em horários aleatórios, uma migração de 2 segundos que ficou 35 minutos presa e a tabela de pedidos crescendo 3 GB por semana sem ganhar linhas. A causa era a mesma: uma transação aberta por um worker que chamava o ERP com um lock na mão, e algumas sessões de BI que abriam BEGIN e iam almoçar. Este artigo mostra o que uma transação parada segura mesmo sem executar nada, como encontrar a sessão e o que ela está travando, de onde essas transações nascem no código Node.js e como garantir que toda transação termine, pelo código e pelo servidor.',
  sections: [
    {
      title: 'Três incidentes sem relação aparente e uma única causa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O primeiro chamado veio do suporte: a tela de pedidos ficava sem responder por dois ou três minutos, algumas vezes por dia, e voltava sozinha. O segundo veio do time de plataforma: uma migração que adicionava uma coluna anulável em pedidos, operação que no Postgres é só uma mudança de catálogo, ficou 35 minutos esperando e foi cancelada à mão. O terceiro veio do custo: a tabela de pedidos tinha 4,1 milhões de linhas em setembro e 4,3 milhões em outubro, mas passou de 19 GB para 31 GB, e o autovacuum rodava 140 vezes por semana sem recuperar nada.',
        },
        {
          type: 'paragraph',
          value:
            'Os três foram tratados separadamente por semanas. O travamento da API ganhou um aumento de pool de 40 para 60 conexões, que piorou o problema, porque mais conexões entraram na mesma fila. A migração foi reagendada para a madrugada e travou de novo. O inchaço ganhou um ajuste de autovacuum por tabela, que não teve efeito, porque o vacuum não estava atrasado: estava impedido de remover.',
        },
        {
          type: 'paragraph',
          value:
            'A conexão entre eles apareceu quando alguém olhou pg_stat_activity durante um travamento e viu uma sessão com state igual a "idle in transaction" havia 41 minutos, pid 48213, application_name vazio, último comando um SELECT FOR UPDATE em pedidos. Atrás dela, uma migração esperando ACCESS EXCLUSIVE; atrás da migração, 40 sessões da API esperando ACCESS SHARE. E a coluna backend_xmin daquela sessão era a mais antiga do servidor, o que impedia o vacuum de limpar qualquer tupla morta criada desde que ela começou.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'Uma transação parada é pior que uma consulta longa. A consulta longa pelo menos está fazendo algo e vai terminar. A transação parada não consome CPU, não aparece em consultas lentas, não dispara o statement_timeout, porque não há statement rodando, e segura tudo o que adquiriu pelo tempo que o cliente quiser. O resto do artigo é sobre esse "tudo".',
        },
      ],
    },
    {
      title: 'O que uma transação aberta segura mesmo sem fazer nada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No Postgres, três recursos ficam presos à transação, não ao comando, e são liberados apenas no COMMIT ou ROLLBACK. O primeiro são os locks: todo lock de tabela ou de linha adquirido por qualquer comando dentro da transação dura até o fim dela. Um SELECT comum em pedidos deixa um ACCESS SHARE pendurado na tabela, que por si só não atrapalha ninguém, até que uma migração peça ACCESS EXCLUSIVE. Nesse momento, a migração entra na fila atrás do ACCESS SHARE, e tudo o que vier depois dela entra na fila atrás da migração, porque a fila de locks do Postgres respeita a ordem de chegada para evitar que o pedido mais forte morra de fome.',
        },
        {
          type: 'paragraph',
          value:
            'O segundo é o horizonte de visibilidade. Toda transação com snapshot ativo publica em backend_xmin o id da transação mais antiga que ela ainda pode precisar enxergar. O vacuum calcula o horizonte global como o menor xmin entre todas as sessões, slots de replicação e transações preparadas, e só remove tuplas mortas anteriores a ele. Uma única sessão parada com um snapshot de 47 minutos atrás impede a remoção de toda tupla morta criada nesses 47 minutos, em todas as tabelas do banco, não só na que ela consultou. O autovacuum roda, conta as tuplas, informa no log que "N dead row versions cannot be removed yet" e sai sem recuperar espaço.',
        },
        {
          type: 'paragraph',
          value:
            'O terceiro é a conexão. Uma sessão em transação ocupa um backend do servidor e uma conexão do pool da aplicação, e nenhum pool pode entregá-la a outra requisição enquanto a transação não terminar. Com um pool de 40 e dez transações penduradas, a aplicação opera com 30 conexões, e ninguém vê isso nos gráficos de CPU ou de consultas lentas.',
        },
        {
          type: 'table',
          columns: ['Recurso retido', 'Até quando', 'Quem paga', 'Como aparece'],
          rows: [
            [
              'Locks de tabela e de linha',
              'COMMIT ou ROLLBACK',
              'Migrações, UPDATE e DELETE nas mesmas linhas, depois toda consulta atrás de uma migração enfileirada',
              'Fila em pg_locks com granted = false, pg_blocking_pids apontando para a sessão parada',
            ],
            [
              'Horizonte de xmin',
              'Fim da transação (ou da sessão, em REPEATABLE READ)',
              'Vacuum de todas as tabelas do banco, índices que crescem, HOT que deixa de acontecer',
              'Log do autovacuum com "dead row versions cannot be removed yet", bloat crescendo com linhas estáveis',
            ],
            [
              'Conexão do pool e backend do servidor',
              'Fim da transação e release do cliente',
              'Requisições que esperam o pool, max_connections do servidor',
              'Tempo de espera do pool subindo com CPU do banco baixa',
            ],
            [
              'Arquivos temporários e cursores WITH HOLD',
              'Fim da transação',
              'Disco do servidor',
              'temp_files e temp_bytes em pg_stat_database',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A consequência prática é que a transação não é uma unidade de código, é uma unidade de posse de recursos compartilhados. Cada milissegundo que ela fica aberta além do necessário é cobrado de outro cliente, e o pior cenário é o em que ela fica aberta esperando algo que o banco não controla.',
        },
      ],
    },
    {
      title: 'Encontrar a sessão e o que ela está segurando',
      blocks: [
        {
          type: 'paragraph',
          value:
            'pg_stat_activity tem tudo o que é preciso, desde que se olhe as colunas certas. xact_start diz quando a transação começou. state_change diz quando a sessão mudou de estado pela última vez, então em uma sessão "idle in transaction" é o instante em que o último comando terminou e a transação ficou parada. backend_xmin diz qual horizonte ela está segurando, e age dessa coluna diz quantas transações já aconteceram desde então. A coluna query guarda o último comando executado, que costuma ser a pista de qual trecho de código abriu a transação, mesmo que application_name esteja vazio.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'paragraph',
          value:
            'A primeira consulta lista as transações antigas. A segunda mostra os locks da sessão suspeita: no incidente, o pid 48213 segurava ROW SHARE em pedidos, do SELECT FOR UPDATE, e ACCESS SHARE em três outras tabelas que o worker tinha consultado antes. A terceira usa pg_blocking_pids, que resolve a fila inteira: a migração estava bloqueada pelo 48213, e cada sessão da API estava bloqueada pela migração. Só a quarta consulta explica o inchaço, porque mostra que o horizonte do vacuum estava a 1,9 milhão de transações do presente, e que era uma sessão, não um slot abandonado nem uma transação preparada, que o segurava.',
        },
        {
          type: 'paragraph',
          value:
            'Com a sessão identificada, o encerramento imediato é pg_terminate_backend(pid), que derruba a conexão e faz ROLLBACK de tudo. pg_cancel_backend não ajuda em uma sessão parada, porque não há comando para cancelar. Terminar a sessão resolve o travamento em segundos, e é o que o time fez às 14h47 daquele dia, mas é remédio para o sintoma: o mesmo worker abriu outra transação igual na execução seguinte.',
        },
        {
          type: 'list',
          items: [
            'Preencha application_name em todas as conexões, com nome do serviço e do processo. Uma sessão parada com nome "faturamento-worker" leva ao código em minutos; sem nome, leva horas de correlação por client_addr e horário.',
            'Guarde snapshots de pg_stat_activity a cada 30 segundos em uma tabela ou no sistema de métricas. Transações paradas de 5 minutos, que não chegam a derrubar nada, só aparecem em série histórica.',
            'Ao analisar bloat, separe "vacuum atrasado" de "vacuum impedido". O primeiro se resolve com ajuste de autovacuum; o segundo só se resolve achando quem segura o horizonte, e qualquer ajuste de vacuum é tempo perdido.',
          ],
        },
      ],
    },
    {
      title: 'De onde vêm as transações que ninguém fecha',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quase nenhuma transação parada é aberta de propósito. Elas nascem de padrões de código que parecem corretos no caminho feliz e deixam a transação aberta em algum caminho alternativo, ou que fazem dentro da transação algo cuja duração o banco não controla. O worker de faturamento tinha os três problemas mais comuns no mesmo arquivo.',
        },
        {
          type: 'code',
          value: padraoRuimCode,
        },
        {
          type: 'paragraph',
          value:
            'O retorno antecipado sai da função com BEGIN aberto e sem release. Dependendo do pool, essa conexão fica perdida para sempre, ou volta ao pool com a transação aberta e é entregue à próxima requisição, que vai executar seus comandos dentro de uma transação que não abriu, com um lock em pedidos que não pediu. A chamada ao ERP dentro da transação é o que travou a API: o lock e o xmin ficam presos pelo tempo que o ERP levar, e um fetch sem signal de timeout espera indefinidamente em um socket que o outro lado esqueceu. E a ausência de try/finally faz qualquer exceção, de rede ou de banco, pular o COMMIT e o release de uma vez.',
        },
        {
          type: 'paragraph',
          value:
            'Outras origens frequentes, encontradas em auditorias de bases diferentes:',
        },
        {
          type: 'list',
          items: [
            'ORMs configurados para abrir uma transação por requisição em um middleware, que fica aberta enquanto o handler faz chamadas HTTP, envia e-mail ou espera upload. A transação dura o tempo da requisição inteira, não o do acesso ao banco.',
            'Clientes com autocommit desligado por padrão, como o psycopg2 e alguns drivers JDBC, em que o primeiro SELECT abre uma transação que ninguém fecha porque a leitura "não precisava de commit".',
            'Sessões interativas de analistas em ferramentas de BI ou psql que executam BEGIN, ou que usam um modo "manual commit", e ficam abertas durante o almoço. Essas são as que mais seguram o horizonte, porque duram horas.',
            'Pool que devolve conexões sem verificar o estado. Uma conexão liberada com transação aberta por um bug de um endpoint contamina o endpoint seguinte, e a sessão parada aparece com um último comando que não tem nada a ver com a origem.',
            'Conexões de jobs que morrem no meio sem fechar o socket, por kill -9 ou OOM do contêiner. O servidor só percebe quando tcp_keepalives vence, que no padrão do kernel pode ser mais de duas horas.',
          ],
        },
      ],
    },
    {
      title: 'Fechar pelo código: todo caminho termina e o mundo externo fica fora',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A correção tem duas partes. A primeira é estrutural: nenhum código da aplicação chama BEGIN diretamente. Toda transação passa por um helper que garante COMMIT no sucesso, ROLLBACK em qualquer exceção, release em todos os casos e descarte da conexão quando o estado dela é incerto. A segunda é de desenho: dentro do helper só entra código que fala com o banco. Chamada HTTP, fila, e-mail e espera por qualquer coisa que não seja o Postgres ficam fora, e a consistência entre as duas fases é garantida por um registro de efeito pendente, não por um lock.',
        },
        {
          type: 'code',
          value: padraoBomCode,
        },
        {
          type: 'paragraph',
          value:
            'O helper faz três coisas que não são óbvias. SET LOCAL application_name dá nome à transação em pg_stat_activity, então uma sessão parada diz de qual fluxo veio. SET LOCAL idle_in_transaction_session_timeout faz o servidor derrubar a sessão se ela ficar parada além do limite, mesmo que o código tenha um bug novo que o helper não previu: o helper é a rede e o timeout é a rede da rede. E o release com um erro como argumento, no node-postgres, destrói a conexão em vez de devolvê-la ao pool, o que impede que uma conexão em estado desconhecido contamine a requisição seguinte.',
        },
        {
          type: 'paragraph',
          value:
            'O fluxo de faturamento virou três fases. A primeira reserva o pedido com um UPDATE condicional e grava o efeito pendente, em uma transação que dura alguns milissegundos. A segunda chama o ERP sem nenhuma conexão ao banco na mão, com timeout, retentativa e chave de idempotência, então o ERP pode demorar 47 minutos e o único prejuízo é desse pedido. A terceira confirma o resultado e apaga o efeito pendente. Se o processo morrer entre a segunda e a terceira fase, um worker de reconciliação lê efeitos_pendentes, repete a chamada ao ERP com a mesma chave de idempotência e completa o fluxo, e o status "faturando" impede que duas instâncias disputem o mesmo pedido.',
        },
        {
          type: 'paragraph',
          value:
            'Esse desenho troca uma garantia por outra. A versão original prometia atomicidade entre banco e ERP, que nunca existiu de fato, porque um COMMIT que falhasse depois da nota emitida já deixaria o sistema inconsistente. A nova versão promete convergência: o pedido pode ficar em "faturando" por alguns minutos, mas sempre chega a "faturado" ou volta a "pago" pela reconciliação, e nenhuma dessas esperas segura um lock.',
        },
      ],
    },
    {
      title: 'Fechar pelo servidor: limites por papel e um alerta que chega antes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O código corrige o que o time controla, mas o banco recebe conexões de ORMs, ferramentas de BI, scripts de migração e pessoas, e nem todos passam pelo helper. O servidor precisa de limites próprios, e o lugar certo para eles é o papel de banco, não o postgresql.conf: a API, o worker, o BI e a migração têm necessidades diferentes, e um limite único ou é frouxo demais para a API ou quebra o BI.',
        },
        {
          type: 'code',
          value: limitesCode,
        },
        {
          type: 'table',
          columns: ['Parâmetro', 'O que limita', 'Valor típico por papel', 'Cuidado'],
          rows: [
            [
              'idle_in_transaction_session_timeout',
              'Tempo parado dentro de uma transação; ao estourar, a sessão é encerrada com ROLLBACK',
              'API 10 s, worker 30 s, BI 60 s',
              'Encerra a sessão inteira, não só a transação; o pool precisa tratar a conexão perdida',
            ],
            [
              'statement_timeout',
              'Duração de um único comando',
              'API 15 s, worker 5 min, BI 30 min',
              'Não ajuda com transação parada: não há comando rodando',
            ],
            [
              'lock_timeout',
              'Tempo esperando por um lock',
              'API 3 s, migração 5 s',
              'Faz a migração desistir em vez de formar fila; precisa de retentativa no script',
            ],
            [
              'transaction_timeout (Postgres 17 ou superior)',
              'Duração total da transação, ativa ou parada',
              'API 30 s',
              'Cobre o caso de muitos comandos curtos em sequência que nenhum outro limite pega',
            ],
            [
              'idle_session_timeout (Postgres 14 ou superior)',
              'Sessão parada fora de transação',
              'BI 2 h',
              'Libera conexões esquecidas, mas não protege locks nem xmin, porque fora de transação não há o que proteger',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O limite por papel precisa de uma contrapartida na aplicação: quando o servidor encerra uma sessão por timeout, o pool recebe um erro de conexão fechada na próxima consulta e precisa descartar a conexão e abrir outra, em vez de repetir o erro para o usuário. O node-postgres faz isso quando o erro chega pelo evento error do cliente, mas vale testar derrubando uma sessão com pg_terminate_backend em homologação e observando o que a aplicação faz na requisição seguinte.',
        },
        {
          type: 'paragraph',
          value:
            'O alerta que importa não é "houve uma transação parada", porque isso acontece o tempo todo por frações de segundo. É a idade da transação mais antiga por estado, coletada a cada 15 segundos pela última consulta do bloco acima e exportada como métrica. A regra adotada foi: "idle in transaction" com mais de 30 segundos gera aviso com pid, application_name e último comando; qualquer transação com mais de 5 minutos gera alerta para quem está de plantão; e o horizonte de xmin acima de 20 milhões de transações gera alerta de risco de wraparound. Os três chegam antes de a API travar.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'Antes', 'Depois'],
          rows: [
            ['Transação "idle in transaction" mais longa no mês', '2 h 50 min (sessão de BI)', '58 s (BI, encerrada por timeout)'],
            ['Travamentos da API por fila de lock', '14 em 30 dias', '0 em 60 dias'],
            ['Migração ADD COLUMN em pedidos', '35 min, cancelada', '1,8 s, com uma retentativa por lock_timeout'],
            ['Tamanho de pedidos com 4,3 milhões de linhas', '31 GB', '21 GB após pg_repack, estável'],
            ['Tuplas mortas que o autovacuum não pôde remover (média por execução)', '1,2 milhão', '0'],
            ['Conexões do pool da API efetivamente disponíveis em pico', '29 de 40', '40 de 40'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que não usar um idle_in_transaction_session_timeout global curto, como 5 segundos, e resolver tudo de uma vez?',
      answer:
        'Porque o limite certo depende de quem está do outro lado. Cinco segundos é generoso para uma API, mas derruba um worker que faz um lote legítimo de 10 segundos entre dois comandos e quebra qualquer analista que use transação manual. Um limite global curto tende a ser afrouxado na primeira reclamação e acaba em 10 minutos, o que não protege ninguém. Por papel, cada limite pode ser justo: a API fica em 10 segundos, o worker em 30, o BI em 60, e cada um só reclama do seu.',
    },
    {
      question: 'Uma transação só de leitura, sem nenhum UPDATE, também causa esses problemas?',
      answer:
        'Sim, em dois dos três recursos. Um SELECT deixa ACCESS SHARE pendurado até o fim da transação, o que basta para enfileirar uma migração e tudo o que vier atrás dela. E qualquer transação com snapshot ativo segura o horizonte de xmin, então uma consulta de BI em READ COMMITTED que executou um SELECT e ficou parada impede o vacuum do banco inteiro exatamente como um UPDATE faria. A única coisa que ela não segura são locks de linha.',
    },
    {
      question: 'Em vez de reestruturar em três fases, não basta pôr um timeout no fetch dentro da transação?',
      answer:
        'O timeout reduz o dano, mas mantém o desenho errado. Com 15 segundos de timeout, o lock em pedidos fica preso por até 15 segundos a cada chamada, e com 50 faturamentos por minuto isso é uma fila permanente. Além disso, o timeout que estoura depois de o ERP ter emitido a nota deixa o sistema inconsistente de qualquer jeito, e o ROLLBACK desfaz o registro do banco enquanto a nota existe no ERP. Separar as fases com um efeito pendente resolve os dois problemas: a transação dura milissegundos e a reconciliação garante que a nota emitida seja registrada.',
    },
  ],
  conclusion: {
    title: 'Transação é posse, não só código',
    description:
      'Os três incidentes tinham uma raiz só: transações que ficavam abertas enquanto o código esperava algo que o banco não controla, ou que ninguém fechava porque o caminho de saída não previa o fim. Uma transação parada não gasta CPU e não aparece em nenhum painel de consultas lentas, mas segura locks, horizonte de vacuum e conexões por tempo ilimitado, e cobra isso de todo mundo. A correção foi tornar o fim da transação impossível de esquecer pelo código, tirar o mundo externo de dentro dela, dar ao servidor limites por papel para o que o código não cobre e medir a idade da transação mais antiga como indicador de saúde do banco. A pergunta que vale para qualquer serviço é: qual é a transação mais antiga aberta agora, quem a abriu e o que ela está esperando?',
    cta: 'Revisar as transações e os limites do meu banco',
  },
  related: [
    {
      label: 'Autovacuum que não acompanha: quando a tabela incha e a consulta fica lenta sem mudar nada',
      to: '/blog/autovacuum-que-nao-acompanha-tabela-incha-consulta-lenta-sem-mudar-nada',
    },
    {
      label: 'Limite de conexões do banco esgotado: quando o pool vira o gargalo do serviço',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Serviço de arquitetura e modernização backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A logistics SaaS with 40 connections in the API pool and an invoicing worker had three incidents in the same month that looked unrelated: the API freezing for a few minutes at random times, a 2 second migration that sat stuck for 35 minutes, and the orders table growing 3 GB a week without gaining rows. The cause was the same: a transaction left open by a worker that called the ERP while holding a lock, plus a few BI sessions that ran BEGIN and went to lunch. This article shows what an idle transaction holds even while doing nothing, how to find the session and what it is blocking, where these transactions are born in Node.js code, and how to make sure every transaction ends, both in the code and on the server.',
  sections: [
    {
      title: 'Three seemingly unrelated incidents and a single cause',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first ticket came from support: the orders screen stopped responding for two or three minutes, a few times a day, and recovered on its own. The second came from the platform team: a migration adding a nullable column to orders, which in Postgres is only a catalog change, waited 35 minutes and was cancelled by hand. The third came from the bill: the orders table had 4.1 million rows in September and 4.3 million in October, yet went from 19 GB to 31 GB, and autovacuum ran 140 times a week without reclaiming anything.',
        },
        {
          type: 'paragraph',
          value:
            'The three were handled separately for weeks. The API freeze got a pool increase from 40 to 60 connections, which made it worse, because more connections joined the same queue. The migration was rescheduled to the early morning and got stuck again. The bloat got a per table autovacuum tuning that had no effect, because vacuum was not behind: it was being prevented from removing anything.',
        },
        {
          type: 'paragraph',
          value:
            'The connection between them appeared when someone looked at pg_stat_activity during a freeze and saw a session whose state had been "idle in transaction" for 41 minutes, pid 48213, empty application_name, last command a SELECT FOR UPDATE on orders. Behind it, a migration waiting for ACCESS EXCLUSIVE; behind the migration, 40 API sessions waiting for ACCESS SHARE. And that session\'s backend_xmin was the oldest on the server, which prevented vacuum from cleaning any dead tuple created since it began.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'An idle transaction is worse than a long query. The long query is at least doing something and will finish. The idle transaction uses no CPU, does not show up in slow query reports, does not trigger statement_timeout because no statement is running, and holds everything it acquired for as long as the client likes. The rest of this article is about that "everything".',
        },
      ],
    },
    {
      title: 'What an open transaction holds even while doing nothing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In Postgres, three resources are tied to the transaction rather than to the statement, and are released only at COMMIT or ROLLBACK. The first is locks: every table or row lock acquired by any statement inside the transaction lasts until the transaction ends. A plain SELECT on orders leaves an ACCESS SHARE hanging on the table, which bothers nobody on its own, until a migration asks for ACCESS EXCLUSIVE. At that moment the migration queues behind the ACCESS SHARE, and everything arriving after it queues behind the migration, because the Postgres lock queue honors arrival order so that the strongest request does not starve.',
        },
        {
          type: 'paragraph',
          value:
            'The second is the visibility horizon. Every transaction with an active snapshot publishes in backend_xmin the id of the oldest transaction it may still need to see. Vacuum computes the global horizon as the smallest xmin across all sessions, replication slots and prepared transactions, and only removes dead tuples older than it. A single idle session with a snapshot from 47 minutes ago prevents the removal of every dead tuple created in those 47 minutes, in every table of the database, not only the one it queried. Autovacuum runs, counts the tuples, logs that "N dead row versions cannot be removed yet" and leaves without reclaiming space.',
        },
        {
          type: 'paragraph',
          value:
            'The third is the connection. A session inside a transaction occupies a server backend and a connection in the application pool, and no pool can hand it to another request until the transaction ends. With a pool of 40 and ten hanging transactions, the application runs on 30 connections, and nobody sees that in CPU or slow query charts.',
        },
        {
          type: 'table',
          columns: ['Held resource', 'Until when', 'Who pays', 'How it shows up'],
          rows: [
            [
              'Table and row locks',
              'COMMIT or ROLLBACK',
              'Migrations, UPDATE and DELETE on the same rows, then every query behind a queued migration',
              'Queue in pg_locks with granted = false, pg_blocking_pids pointing at the idle session',
            ],
            [
              'xmin horizon',
              'End of the transaction (or of the session, in REPEATABLE READ)',
              'Vacuum on every table in the database, growing indexes, HOT updates that stop happening',
              'Autovacuum log with "dead row versions cannot be removed yet", bloat growing with a stable row count',
            ],
            [
              'Pool connection and server backend',
              'End of the transaction and client release',
              'Requests waiting on the pool, server max_connections',
              'Pool wait time rising while database CPU stays low',
            ],
            [
              'Temporary files and WITH HOLD cursors',
              'End of the transaction',
              'Server disk',
              'temp_files and temp_bytes in pg_stat_database',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The practical consequence is that a transaction is not a unit of code, it is a unit of ownership over shared resources. Every millisecond it stays open beyond what is needed is charged to some other client, and the worst case is when it stays open waiting for something the database does not control.',
        },
      ],
    },
    {
      title: 'Finding the session and what it is holding',
      blocks: [
        {
          type: 'paragraph',
          value:
            'pg_stat_activity has everything you need, as long as you look at the right columns. xact_start says when the transaction began. state_change says when the session last changed state, so for an "idle in transaction" session it is the moment the last statement finished and the transaction went idle. backend_xmin says which horizon it is holding, and age of that column says how many transactions have happened since. The query column keeps the last statement executed, which is usually the clue to which piece of code opened the transaction, even when application_name is empty.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'paragraph',
          value:
            'The first query lists old transactions. The second shows the suspect session\'s locks: in the incident, pid 48213 held ROW SHARE on orders, from the SELECT FOR UPDATE, and ACCESS SHARE on three other tables the worker had read earlier. The third uses pg_blocking_pids, which resolves the whole queue: the migration was blocked by 48213, and every API session was blocked by the migration. Only the fourth query explains the bloat, because it shows the vacuum horizon was 1.9 million transactions behind the present, and that a session, not an abandoned slot or a prepared transaction, was holding it.',
        },
        {
          type: 'paragraph',
          value:
            'Once the session is identified, the immediate fix is pg_terminate_backend(pid), which drops the connection and rolls everything back. pg_cancel_backend does not help with an idle session, because there is no statement to cancel. Terminating the session clears the freeze in seconds, and that is what the team did at 14:47 that day, but it treats the symptom: the same worker opened another identical transaction on its next run.',
        },
        {
          type: 'list',
          items: [
            'Set application_name on every connection, with the service and process name. An idle session named "invoicing-worker" leads to the code in minutes; without a name it takes hours of correlating client_addr and timestamps.',
            'Store snapshots of pg_stat_activity every 30 seconds in a table or in your metrics system. Five minute idle transactions, which never bring anything down, only show up in a time series.',
            'When analyzing bloat, separate "vacuum behind" from "vacuum prevented". The first is fixed with autovacuum tuning; the second is only fixed by finding who holds the horizon, and any vacuum tuning is wasted time.',
          ],
        },
      ],
    },
    {
      title: 'Where the transactions nobody closes come from',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Almost no idle transaction is opened on purpose. They are born from code patterns that look correct on the happy path and leave the transaction open on some alternative path, or that do something inside the transaction whose duration the database does not control. The invoicing worker had the three most common problems in the same file.',
        },
        {
          type: 'code',
          value: padraoRuimCode,
        },
        {
          type: 'paragraph',
          value:
            'The early return leaves the function with BEGIN open and no release. Depending on the pool, that connection is lost forever, or returns to the pool with the transaction open and is handed to the next request, which will run its statements inside a transaction it never opened, holding a lock on orders it never asked for. The ERP call inside the transaction is what froze the API: the lock and the xmin stay held for as long as the ERP takes, and a fetch without a timeout signal waits indefinitely on a socket the other side forgot. And the missing try/finally makes any exception, network or database, skip both the COMMIT and the release at once.',
        },
        {
          type: 'paragraph',
          value:
            'Other frequent origins, found in audits of different systems:',
        },
        {
          type: 'list',
          items: [
            'ORMs configured to open one transaction per request in a middleware, which stays open while the handler makes HTTP calls, sends email or waits for an upload. The transaction lasts the whole request, not the database access.',
            'Clients with autocommit off by default, such as psycopg2 and some JDBC drivers, where the first SELECT opens a transaction nobody closes because the read "did not need a commit".',
            'Interactive sessions from analysts in BI tools or psql that run BEGIN, or use a "manual commit" mode, and stay open through lunch. These are the ones that hold the horizon the longest, because they last for hours.',
            'Pools that return connections without checking their state. A connection released with an open transaction by a bug in one endpoint contaminates the next endpoint, and the idle session shows a last command that has nothing to do with the origin.',
            'Job connections that die halfway without closing the socket, through kill -9 or a container OOM. The server only notices when tcp_keepalives expire, which with kernel defaults can take over two hours.',
          ],
        },
      ],
    },
    {
      title: 'Closing from the code: every path ends and the outside world stays out',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The fix has two parts. The first is structural: no application code calls BEGIN directly. Every transaction goes through a helper that guarantees COMMIT on success, ROLLBACK on any exception, release in every case, and discarding the connection when its state is uncertain. The second is about design: only code that talks to the database goes inside the helper. HTTP calls, queues, email and waiting for anything that is not Postgres stay outside, and consistency between the two phases is guaranteed by a pending effect record, not by a lock.',
        },
        {
          type: 'code',
          value: padraoBomCode,
        },
        {
          type: 'paragraph',
          value:
            'The helper does three things that are not obvious. SET LOCAL application_name names the transaction in pg_stat_activity, so an idle session says which flow it came from. SET LOCAL idle_in_transaction_session_timeout makes the server drop the session if it goes idle beyond the limit, even if the code has a new bug the helper did not anticipate: the helper is the safety net and the timeout is the net under the net. And calling release with an error argument, in node-postgres, destroys the connection instead of returning it to the pool, which keeps a connection in an unknown state from contaminating the next request.',
        },
        {
          type: 'paragraph',
          value:
            'The invoicing flow became three phases. The first reserves the order with a conditional UPDATE and records the pending effect, in a transaction that lasts a few milliseconds. The second calls the ERP with no database connection in hand, with a timeout, retries and an idempotency key, so the ERP can take 47 minutes and the only damage is to that order. The third confirms the result and deletes the pending effect. If the process dies between the second and third phase, a reconciliation worker reads pending effects, repeats the ERP call with the same idempotency key and completes the flow, and the "invoicing" status keeps two instances from competing for the same order.',
        },
        {
          type: 'paragraph',
          value:
            'This design trades one guarantee for another. The original version promised atomicity between the database and the ERP, which never really existed, because a COMMIT failing after the invoice was issued would already leave the system inconsistent. The new version promises convergence: the order may sit in "invoicing" for a few minutes, but it always reaches "invoiced" or goes back to "paid" through reconciliation, and none of that waiting holds a lock.',
        },
      ],
    },
    {
      title: 'Closing from the server: limits per role and an alert that arrives early',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The code fixes what the team controls, but the database receives connections from ORMs, BI tools, migration scripts and people, and not all of them go through the helper. The server needs limits of its own, and the right place for them is the database role, not postgresql.conf: the API, the worker, BI and migrations have different needs, and a single limit is either too loose for the API or breaks BI.',
        },
        {
          type: 'code',
          value: limitesCode,
        },
        {
          type: 'table',
          columns: ['Parameter', 'What it limits', 'Typical value per role', 'Caveat'],
          rows: [
            [
              'idle_in_transaction_session_timeout',
              'Time idle inside a transaction; when exceeded, the session is terminated with ROLLBACK',
              'API 10 s, worker 30 s, BI 60 s',
              'Terminates the whole session, not only the transaction; the pool must handle the lost connection',
            ],
            [
              'statement_timeout',
              'Duration of a single statement',
              'API 15 s, worker 5 min, BI 30 min',
              'Does not help with an idle transaction: no statement is running',
            ],
            [
              'lock_timeout',
              'Time waiting for a lock',
              'API 3 s, migration 5 s',
              'Makes the migration give up instead of queueing; the script needs a retry',
            ],
            [
              'transaction_timeout (Postgres 17 or later)',
              'Total transaction duration, active or idle',
              'API 30 s',
              'Covers the case of many short statements in a row that no other limit catches',
            ],
            [
              'idle_session_timeout (Postgres 14 or later)',
              'Session idle outside a transaction',
              'BI 2 h',
              'Frees forgotten connections, but protects neither locks nor xmin, because outside a transaction there is nothing to protect',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Per role limits need a counterpart in the application: when the server terminates a session on timeout, the pool receives a closed connection error on the next query and must discard the connection and open another, instead of passing the error on to the user. node-postgres does this when the error arrives through the client error event, but it is worth testing by terminating a session with pg_terminate_backend in staging and watching what the application does on the next request.',
        },
        {
          type: 'paragraph',
          value:
            'The alert that matters is not "there was an idle transaction", because that happens all the time for fractions of a second. It is the age of the oldest transaction per state, collected every 15 seconds by the last query in the block above and exported as a metric. The rule adopted was: "idle in transaction" over 30 seconds raises a warning with pid, application_name and last command; any transaction over 5 minutes pages whoever is on call; and an xmin horizon above 20 million transactions raises a wraparound risk alert. All three arrive before the API freezes.',
        },
        {
          type: 'table',
          columns: ['Indicator', 'Before', 'After'],
          rows: [
            ['Longest "idle in transaction" in the month', '2 h 50 min (BI session)', '58 s (BI, terminated by timeout)'],
            ['API freezes caused by lock queues', '14 in 30 days', '0 in 60 days'],
            ['ADD COLUMN migration on orders', '35 min, cancelled', '1.8 s, with one retry after lock_timeout'],
            ['Size of orders at 4.3 million rows', '31 GB', '21 GB after pg_repack, stable'],
            ['Dead tuples autovacuum could not remove (average per run)', '1.2 million', '0'],
            ['API pool connections actually available at peak', '29 of 40', '40 of 40'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why not set a short global idle_in_transaction_session_timeout, like 5 seconds, and solve everything at once?',
      answer:
        'Because the right limit depends on who is on the other side. Five seconds is generous for an API, but it kills a worker doing a legitimate 10 second batch between two statements and breaks any analyst using manual transactions. A short global limit tends to be loosened at the first complaint and ends up at 10 minutes, which protects nobody. Per role, each limit can be fair: the API stays at 10 seconds, the worker at 30, BI at 60, and each one only complains about its own.',
    },
    {
      question: 'Does a read only transaction, with no UPDATE at all, also cause these problems?',
      answer:
        'Yes, for two of the three resources. A SELECT leaves ACCESS SHARE hanging until the transaction ends, which is enough to queue a migration and everything behind it. And any transaction with an active snapshot holds the xmin horizon, so a BI query in READ COMMITTED that ran a SELECT and went idle prevents vacuum across the whole database exactly as an UPDATE would. The only thing it does not hold is row locks.',
    },
    {
      question: 'Instead of restructuring into three phases, is it not enough to put a timeout on the fetch inside the transaction?',
      answer:
        'The timeout reduces the damage but keeps the wrong design. With a 15 second timeout, the lock on orders is held for up to 15 seconds on every call, and at 50 invoices a minute that is a permanent queue. Besides, a timeout that fires after the ERP has issued the invoice leaves the system inconsistent anyway, and the ROLLBACK undoes the database record while the invoice exists in the ERP. Separating the phases with a pending effect solves both problems: the transaction lasts milliseconds and reconciliation guarantees the issued invoice gets recorded.',
    },
  ],
  conclusion: {
    title: 'A transaction is ownership, not just code',
    description:
      'The three incidents had a single root: transactions that stayed open while the code waited for something the database does not control, or that nobody closed because the exit path never planned for the end. An idle transaction burns no CPU and appears on no slow query dashboard, but it holds locks, the vacuum horizon and connections for unlimited time, and charges everyone for it. The fix was to make the end of the transaction impossible to forget in the code, take the outside world out of it, give the server per role limits for what the code does not cover, and measure the age of the oldest transaction as a database health indicator. The question worth asking of any service is: what is the oldest transaction open right now, who opened it, and what is it waiting for?',
    cta: 'Review the transactions and limits of my database',
  },
  related: [
    {
      label: 'Autovacuum that cannot keep up: when the table bloats and queries slow down with nothing changed',
      to: '/blog/autovacuum-que-nao-acompanha-tabela-incha-consulta-lenta-sem-mudar-nada',
    },
    {
      label: 'Exhausted database connection limits: when the pool becomes the service bottleneck',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Backend architecture and modernization service',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Un SaaS de logística con 40 conexiones en el pool de la API y un worker de facturación sufrió tres incidentes en el mismo mes que parecían no tener relación: la API que se congelaba unos minutos en horarios aleatorios, una migración de 2 segundos que quedó 35 minutos atascada y la tabla de pedidos que crecía 3 GB por semana sin ganar filas. La causa era la misma: una transacción abierta por un worker que llamaba al ERP con un lock en la mano, y algunas sesiones de BI que ejecutaban BEGIN y se iban a almorzar. Este artículo muestra qué retiene una transacción detenida aunque no ejecute nada, cómo encontrar la sesión y qué está bloqueando, de dónde nacen esas transacciones en el código Node.js y cómo garantizar que toda transacción termine, desde el código y desde el servidor.',
  sections: [
    {
      title: 'Tres incidentes sin relación aparente y una única causa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El primer ticket llegó de soporte: la pantalla de pedidos dejaba de responder durante dos o tres minutos, varias veces al día, y volvía sola. El segundo llegó del equipo de plataforma: una migración que agregaba una columna anulable en pedidos, operación que en Postgres es solo un cambio de catálogo, esperó 35 minutos y fue cancelada a mano. El tercero llegó del costo: la tabla de pedidos tenía 4,1 millones de filas en septiembre y 4,3 millones en octubre, pero pasó de 19 GB a 31 GB, y el autovacuum corría 140 veces por semana sin recuperar nada.',
        },
        {
          type: 'paragraph',
          value:
            'Los tres se trataron por separado durante semanas. El congelamiento de la API recibió un aumento de pool de 40 a 60 conexiones, que empeoró el problema, porque más conexiones entraron en la misma cola. La migración se reprogramó para la madrugada y volvió a atascarse. La hinchazón recibió un ajuste de autovacuum por tabla que no tuvo efecto, porque el vacuum no estaba atrasado: estaba impedido de eliminar.',
        },
        {
          type: 'paragraph',
          value:
            'La conexión entre ellos apareció cuando alguien miró pg_stat_activity durante un congelamiento y vio una sesión con state igual a "idle in transaction" desde hacía 41 minutos, pid 48213, application_name vacío, último comando un SELECT FOR UPDATE en pedidos. Detrás de ella, una migración esperando ACCESS EXCLUSIVE; detrás de la migración, 40 sesiones de la API esperando ACCESS SHARE. Y el backend_xmin de esa sesión era el más antiguo del servidor, lo que impedía al vacuum limpiar cualquier tupla muerta creada desde que empezó.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'Una transacción detenida es peor que una consulta larga. La consulta larga al menos está haciendo algo y va a terminar. La transacción detenida no consume CPU, no aparece en los reportes de consultas lentas, no dispara el statement_timeout porque no hay ningún statement en ejecución, y retiene todo lo que adquirió durante el tiempo que el cliente quiera. El resto del artículo trata de ese "todo".',
        },
      ],
    },
    {
      title: 'Qué retiene una transacción abierta aunque no haga nada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En Postgres, tres recursos quedan atados a la transacción, no al comando, y se liberan solo en el COMMIT o el ROLLBACK. El primero son los locks: todo lock de tabla o de fila adquirido por cualquier comando dentro de la transacción dura hasta el final de ella. Un SELECT común en pedidos deja un ACCESS SHARE colgado en la tabla, que por sí solo no molesta a nadie, hasta que una migración pide ACCESS EXCLUSIVE. En ese momento la migración entra en la cola detrás del ACCESS SHARE, y todo lo que llegue después entra en la cola detrás de la migración, porque la cola de locks de Postgres respeta el orden de llegada para evitar que el pedido más fuerte muera de hambre.',
        },
        {
          type: 'paragraph',
          value:
            'El segundo es el horizonte de visibilidad. Toda transacción con snapshot activo publica en backend_xmin el id de la transacción más antigua que todavía puede necesitar ver. El vacuum calcula el horizonte global como el menor xmin entre todas las sesiones, slots de replicación y transacciones preparadas, y solo elimina tuplas muertas anteriores a él. Una sola sesión detenida con un snapshot de hace 47 minutos impide la eliminación de toda tupla muerta creada en esos 47 minutos, en todas las tablas de la base, no solo en la que consultó. El autovacuum corre, cuenta las tuplas, informa en el log que "N dead row versions cannot be removed yet" y sale sin recuperar espacio.',
        },
        {
          type: 'paragraph',
          value:
            'El tercero es la conexión. Una sesión dentro de una transacción ocupa un backend del servidor y una conexión del pool de la aplicación, y ningún pool puede entregarla a otra petición mientras la transacción no termine. Con un pool de 40 y diez transacciones colgadas, la aplicación opera con 30 conexiones, y nadie lo ve en los gráficos de CPU ni de consultas lentas.',
        },
        {
          type: 'table',
          columns: ['Recurso retenido', 'Hasta cuándo', 'Quién paga', 'Cómo se manifiesta'],
          rows: [
            [
              'Locks de tabla y de fila',
              'COMMIT o ROLLBACK',
              'Migraciones, UPDATE y DELETE sobre las mismas filas, luego toda consulta detrás de una migración encolada',
              'Cola en pg_locks con granted = false, pg_blocking_pids apuntando a la sesión detenida',
            ],
            [
              'Horizonte de xmin',
              'Fin de la transacción (o de la sesión, en REPEATABLE READ)',
              'Vacuum de todas las tablas de la base, índices que crecen, HOT que deja de ocurrir',
              'Log del autovacuum con "dead row versions cannot be removed yet", bloat creciendo con filas estables',
            ],
            [
              'Conexión del pool y backend del servidor',
              'Fin de la transacción y release del cliente',
              'Peticiones que esperan el pool, max_connections del servidor',
              'Tiempo de espera del pool subiendo con CPU de la base baja',
            ],
            [
              'Archivos temporales y cursores WITH HOLD',
              'Fin de la transacción',
              'Disco del servidor',
              'temp_files y temp_bytes en pg_stat_database',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia práctica es que la transacción no es una unidad de código, es una unidad de posesión de recursos compartidos. Cada milisegundo que permanece abierta más allá de lo necesario se le cobra a otro cliente, y el peor escenario es cuando queda abierta esperando algo que la base no controla.',
        },
      ],
    },
    {
      title: 'Encontrar la sesión y qué está reteniendo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'pg_stat_activity tiene todo lo necesario, siempre que se miren las columnas correctas. xact_start dice cuándo empezó la transacción. state_change dice cuándo la sesión cambió de estado por última vez, así que en una sesión "idle in transaction" es el instante en que el último comando terminó y la transacción quedó detenida. backend_xmin dice qué horizonte está reteniendo, y age de esa columna dice cuántas transacciones ocurrieron desde entonces. La columna query guarda el último comando ejecutado, que suele ser la pista de qué fragmento de código abrió la transacción, aunque application_name esté vacío.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'paragraph',
          value:
            'La primera consulta lista las transacciones antiguas. La segunda muestra los locks de la sesión sospechosa: en el incidente, el pid 48213 retenía ROW SHARE en pedidos, del SELECT FOR UPDATE, y ACCESS SHARE en otras tres tablas que el worker había consultado antes. La tercera usa pg_blocking_pids, que resuelve la cola completa: la migración estaba bloqueada por el 48213, y cada sesión de la API estaba bloqueada por la migración. Solo la cuarta consulta explica la hinchazón, porque muestra que el horizonte del vacuum estaba a 1,9 millones de transacciones del presente, y que era una sesión, no un slot abandonado ni una transacción preparada, la que lo retenía.',
        },
        {
          type: 'paragraph',
          value:
            'Con la sesión identificada, el cierre inmediato es pg_terminate_backend(pid), que corta la conexión y hace ROLLBACK de todo. pg_cancel_backend no ayuda en una sesión detenida, porque no hay comando que cancelar. Terminar la sesión resuelve el congelamiento en segundos, y es lo que hizo el equipo a las 14:47 de ese día, pero es remedio para el síntoma: el mismo worker abrió otra transacción igual en la ejecución siguiente.',
        },
        {
          type: 'list',
          items: [
            'Completa application_name en todas las conexiones, con el nombre del servicio y del proceso. Una sesión detenida llamada "facturacion-worker" lleva al código en minutos; sin nombre, lleva horas de correlación por client_addr y horario.',
            'Guarda snapshots de pg_stat_activity cada 30 segundos en una tabla o en el sistema de métricas. Las transacciones detenidas de 5 minutos, que no llegan a tumbar nada, solo aparecen en una serie histórica.',
            'Al analizar bloat, separa "vacuum atrasado" de "vacuum impedido". El primero se resuelve ajustando autovacuum; el segundo solo se resuelve encontrando quién retiene el horizonte, y cualquier ajuste de vacuum es tiempo perdido.',
          ],
        },
      ],
    },
    {
      title: 'De dónde vienen las transacciones que nadie cierra',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Casi ninguna transacción detenida se abre a propósito. Nacen de patrones de código que parecen correctos en el camino feliz y dejan la transacción abierta en algún camino alternativo, o que hacen dentro de la transacción algo cuya duración la base no controla. El worker de facturación tenía los tres problemas más comunes en el mismo archivo.',
        },
        {
          type: 'code',
          value: padraoRuimCode,
        },
        {
          type: 'paragraph',
          value:
            'El retorno anticipado sale de la función con BEGIN abierto y sin release. Según el pool, esa conexión se pierde para siempre, o vuelve al pool con la transacción abierta y se entrega a la siguiente petición, que ejecutará sus comandos dentro de una transacción que no abrió, con un lock en pedidos que no pidió. La llamada al ERP dentro de la transacción es lo que congeló la API: el lock y el xmin quedan retenidos el tiempo que tarde el ERP, y un fetch sin signal de timeout espera indefinidamente en un socket que el otro lado olvidó. Y la ausencia de try/finally hace que cualquier excepción, de red o de base, se salte el COMMIT y el release de una vez.',
        },
        {
          type: 'paragraph',
          value:
            'Otros orígenes frecuentes, encontrados en auditorías de sistemas distintos:',
        },
        {
          type: 'list',
          items: [
            'ORMs configurados para abrir una transacción por petición en un middleware, que queda abierta mientras el handler hace llamadas HTTP, envía correos o espera una subida de archivo. La transacción dura toda la petición, no el acceso a la base.',
            'Clientes con autocommit desactivado por defecto, como psycopg2 y algunos drivers JDBC, donde el primer SELECT abre una transacción que nadie cierra porque la lectura "no necesitaba commit".',
            'Sesiones interactivas de analistas en herramientas de BI o psql que ejecutan BEGIN, o usan un modo de "commit manual", y quedan abiertas durante el almuerzo. Son las que más retienen el horizonte, porque duran horas.',
            'Pools que devuelven conexiones sin verificar su estado. Una conexión liberada con la transacción abierta por un bug de un endpoint contamina al endpoint siguiente, y la sesión detenida muestra un último comando que no tiene nada que ver con el origen.',
            'Conexiones de jobs que mueren a mitad sin cerrar el socket, por kill -9 u OOM del contenedor. El servidor solo se entera cuando vencen los tcp_keepalives, que con los valores por defecto del kernel pueden ser más de dos horas.',
          ],
        },
      ],
    },
    {
      title: 'Cerrar desde el código: todo camino termina y el mundo externo queda fuera',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La corrección tiene dos partes. La primera es estructural: ningún código de la aplicación llama a BEGIN directamente. Toda transacción pasa por un helper que garantiza COMMIT en el éxito, ROLLBACK ante cualquier excepción, release en todos los casos y descarte de la conexión cuando su estado es incierto. La segunda es de diseño: dentro del helper solo entra código que habla con la base. Llamadas HTTP, colas, correos y esperas por cualquier cosa que no sea Postgres quedan fuera, y la consistencia entre las dos fases la garantiza un registro de efecto pendiente, no un lock.',
        },
        {
          type: 'code',
          value: padraoBomCode,
        },
        {
          type: 'paragraph',
          value:
            'El helper hace tres cosas que no son obvias. SET LOCAL application_name le da nombre a la transacción en pg_stat_activity, así que una sesión detenida dice de qué flujo vino. SET LOCAL idle_in_transaction_session_timeout hace que el servidor corte la sesión si queda detenida más allá del límite, incluso si el código tiene un bug nuevo que el helper no previó: el helper es la red y el timeout es la red debajo de la red. Y el release con un error como argumento, en node-postgres, destruye la conexión en lugar de devolverla al pool, lo que impide que una conexión en estado desconocido contamine la petición siguiente.',
        },
        {
          type: 'paragraph',
          value:
            'El flujo de facturación pasó a tener tres fases. La primera reserva el pedido con un UPDATE condicional y graba el efecto pendiente, en una transacción que dura unos milisegundos. La segunda llama al ERP sin ninguna conexión a la base en la mano, con timeout, reintentos y clave de idempotencia, así que el ERP puede tardar 47 minutos y el único perjuicio es el de ese pedido. La tercera confirma el resultado y borra el efecto pendiente. Si el proceso muere entre la segunda y la tercera fase, un worker de reconciliación lee efectos_pendientes, repite la llamada al ERP con la misma clave de idempotencia y completa el flujo, y el estado "facturando" impide que dos instancias disputen el mismo pedido.',
        },
        {
          type: 'paragraph',
          value:
            'Este diseño cambia una garantía por otra. La versión original prometía atomicidad entre la base y el ERP, que nunca existió de verdad, porque un COMMIT que fallara después de emitida la factura ya dejaría el sistema inconsistente. La nueva versión promete convergencia: el pedido puede quedar en "facturando" unos minutos, pero siempre llega a "facturado" o vuelve a "pagado" por la reconciliación, y ninguna de esas esperas retiene un lock.',
        },
      ],
    },
    {
      title: 'Cerrar desde el servidor: límites por rol y una alerta que llega antes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El código corrige lo que el equipo controla, pero la base recibe conexiones de ORMs, herramientas de BI, scripts de migración y personas, y no todas pasan por el helper. El servidor necesita límites propios, y el lugar correcto para ellos es el rol de base de datos, no el postgresql.conf: la API, el worker, el BI y la migración tienen necesidades distintas, y un límite único o es demasiado laxo para la API o rompe el BI.',
        },
        {
          type: 'code',
          value: limitesCode,
        },
        {
          type: 'table',
          columns: ['Parámetro', 'Qué limita', 'Valor típico por rol', 'Cuidado'],
          rows: [
            [
              'idle_in_transaction_session_timeout',
              'Tiempo detenido dentro de una transacción; al superarlo, la sesión se termina con ROLLBACK',
              'API 10 s, worker 30 s, BI 60 s',
              'Termina la sesión completa, no solo la transacción; el pool debe manejar la conexión perdida',
            ],
            [
              'statement_timeout',
              'Duración de un único comando',
              'API 15 s, worker 5 min, BI 30 min',
              'No ayuda con una transacción detenida: no hay comando en ejecución',
            ],
            [
              'lock_timeout',
              'Tiempo esperando un lock',
              'API 3 s, migración 5 s',
              'Hace que la migración desista en lugar de hacer cola; el script necesita un reintento',
            ],
            [
              'transaction_timeout (Postgres 17 o superior)',
              'Duración total de la transacción, activa o detenida',
              'API 30 s',
              'Cubre el caso de muchos comandos cortos seguidos que ningún otro límite atrapa',
            ],
            [
              'idle_session_timeout (Postgres 14 o superior)',
              'Sesión detenida fuera de transacción',
              'BI 2 h',
              'Libera conexiones olvidadas, pero no protege locks ni xmin, porque fuera de transacción no hay nada que proteger',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El límite por rol necesita una contraparte en la aplicación: cuando el servidor termina una sesión por timeout, el pool recibe un error de conexión cerrada en la siguiente consulta y debe descartar la conexión y abrir otra, en lugar de devolver el error al usuario. node-postgres lo hace cuando el error llega por el evento error del cliente, pero conviene probarlo terminando una sesión con pg_terminate_backend en staging y observando qué hace la aplicación en la petición siguiente.',
        },
        {
          type: 'paragraph',
          value:
            'La alerta que importa no es "hubo una transacción detenida", porque eso ocurre todo el tiempo por fracciones de segundo. Es la edad de la transacción más antigua por estado, recogida cada 15 segundos por la última consulta del bloque anterior y exportada como métrica. La regla adoptada fue: "idle in transaction" de más de 30 segundos genera un aviso con pid, application_name y último comando; cualquier transacción de más de 5 minutos genera una alerta para quien esté de guardia; y un horizonte de xmin por encima de 20 millones de transacciones genera una alerta de riesgo de wraparound. Las tres llegan antes de que la API se congele.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'Antes', 'Después'],
          rows: [
            ['Transacción "idle in transaction" más larga del mes', '2 h 50 min (sesión de BI)', '58 s (BI, terminada por timeout)'],
            ['Congelamientos de la API por cola de locks', '14 en 30 días', '0 en 60 días'],
            ['Migración ADD COLUMN en pedidos', '35 min, cancelada', '1,8 s, con un reintento por lock_timeout'],
            ['Tamaño de pedidos con 4,3 millones de filas', '31 GB', '21 GB tras pg_repack, estable'],
            ['Tuplas muertas que el autovacuum no pudo eliminar (promedio por ejecución)', '1,2 millones', '0'],
            ['Conexiones del pool de la API realmente disponibles en pico', '29 de 40', '40 de 40'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué no usar un idle_in_transaction_session_timeout global corto, como 5 segundos, y resolver todo de una vez?',
      answer:
        'Porque el límite correcto depende de quién está del otro lado. Cinco segundos es generoso para una API, pero tumba a un worker que hace un lote legítimo de 10 segundos entre dos comandos y rompe a cualquier analista que use transacciones manuales. Un límite global corto tiende a aflojarse con la primera queja y termina en 10 minutos, lo que no protege a nadie. Por rol, cada límite puede ser justo: la API queda en 10 segundos, el worker en 30, el BI en 60, y cada uno solo se queja del suyo.',
    },
    {
      question: '¿Una transacción de solo lectura, sin ningún UPDATE, también causa estos problemas?',
      answer:
        'Sí, en dos de los tres recursos. Un SELECT deja ACCESS SHARE colgado hasta el final de la transacción, lo que basta para encolar una migración y todo lo que venga detrás. Y cualquier transacción con snapshot activo retiene el horizonte de xmin, así que una consulta de BI en READ COMMITTED que ejecutó un SELECT y quedó detenida impide el vacuum de toda la base exactamente como lo haría un UPDATE. Lo único que no retiene son locks de fila.',
    },
    {
      question: 'En lugar de reestructurar en tres fases, ¿no basta con poner un timeout al fetch dentro de la transacción?',
      answer:
        'El timeout reduce el daño, pero mantiene el diseño equivocado. Con 15 segundos de timeout, el lock en pedidos queda retenido hasta 15 segundos en cada llamada, y con 50 facturaciones por minuto eso es una cola permanente. Además, el timeout que vence después de que el ERP emitió la factura deja el sistema inconsistente de todos modos, y el ROLLBACK deshace el registro de la base mientras la factura existe en el ERP. Separar las fases con un efecto pendiente resuelve ambos problemas: la transacción dura milisegundos y la reconciliación garantiza que la factura emitida quede registrada.',
    },
  ],
  conclusion: {
    title: 'La transacción es posesión, no solo código',
    description:
      'Los tres incidentes tenían una sola raíz: transacciones que quedaban abiertas mientras el código esperaba algo que la base no controla, o que nadie cerraba porque el camino de salida no preveía el final. Una transacción detenida no gasta CPU y no aparece en ningún panel de consultas lentas, pero retiene locks, horizonte de vacuum y conexiones por tiempo ilimitado, y se lo cobra a todos. La corrección fue hacer que el final de la transacción fuera imposible de olvidar en el código, sacar el mundo externo de su interior, darle al servidor límites por rol para lo que el código no cubre y medir la edad de la transacción más antigua como indicador de salud de la base. La pregunta que vale para cualquier servicio es: ¿cuál es la transacción más antigua abierta ahora, quién la abrió y qué está esperando?',
    cta: 'Revisar las transacciones y los límites de mi base de datos',
  },
  related: [
    {
      label: 'Autovacuum que no da abasto: cuándo la tabla se hincha y la consulta se vuelve lenta sin que nada cambie',
      to: '/blog/autovacuum-que-nao-acompanha-tabela-incha-consulta-lenta-sem-mudar-nada',
    },
    {
      label: 'Límite de conexiones de la base agotado: cuándo el pool se vuelve el cuello de botella del servicio',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
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
