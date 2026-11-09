// Conteudo do artigo: ALTER TABLE que para a producao. Como uma migracao de milissegundos que
// espera um lock vira parada total por causa da fila de locks do Postgres, como enxergar a fila,
// como fazer a migracao desistir rapido e tentar de novo (lock_timeout com retentativa) e quais
// padroes de DDL evitam o lock longo (NOT VALID, CONCURRENTLY, backfill em lotes).
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const comments = {
  pt: {
    diag1: 'Quem esta esperando lock e quem esta na frente da fila.',
    diag2: 'Pedidos de lock ainda nao concedidos: o ALTER aparece aqui, esperando.',
    diag3: 'Antes de migrar: transacoes abertas ha mais de 30 s que podem segurar a tabela.',
    run1: 'Cada tentativa e uma transacao curta: ou pega o lock em ate 2 s, ou desiste e libera a fila.',
    run2: 'CREATE INDEX CONCURRENTLY nao roda em transacao; o limite vai na sessao e e desfeito no fim.',
    run3: 'Erro 55P03 (lock_not_available) e esperado: espera com backoff e jitter e tenta de novo.',
    safe1: '1. Coluna anulavel sem default: so catalogo, o ACCESS EXCLUSIVE dura milissegundos.',
    safe2: '2. Preenchimento fora do DDL, em lotes pequenos, repetido ate nao restar linha nula.',
    safe3: '3. NOT NULL sem varredura sob lock (Postgres 12+): a constraint validada dispensa o scan.',
    safe4: '4. Chave estrangeira em duas etapas: criar sem validar e validar sem bloquear escrita.',
    safe5: '5. Indice sem bloquear escrita. Se falhar, sobra um indice INVALID: remover e repetir.',
  },
  en: {
    diag1: 'Who is waiting for a lock and who is at the front of the queue.',
    diag2: 'Lock requests not yet granted: the ALTER shows up here, waiting.',
    diag3: 'Before migrating: transactions open for more than 30 s that may hold the table.',
    run1: 'Each attempt is a short transaction: it gets the lock within 2 s or gives up and frees the queue.',
    run2: 'CREATE INDEX CONCURRENTLY cannot run in a transaction; the limit goes on the session and is undone at the end.',
    run3: 'Error 55P03 (lock_not_available) is expected: wait with backoff and jitter, then try again.',
    safe1: '1. Nullable column without default: catalog only, ACCESS EXCLUSIVE lasts milliseconds.',
    safe2: '2. Backfill outside the DDL, in small batches, repeated until no null row remains.',
    safe3: '3. NOT NULL without a scan under lock (Postgres 12+): the validated constraint skips the scan.',
    safe4: '4. Foreign key in two steps: create without validating, then validate without blocking writes.',
    safe5: '5. Index without blocking writes. If it fails an INVALID index is left behind: drop it and repeat.',
  },
  es: {
    diag1: 'Quien espera un lock y quien esta al frente de la cola.',
    diag2: 'Pedidos de lock aun no concedidos: el ALTER aparece aqui, esperando.',
    diag3: 'Antes de migrar: transacciones abiertas hace mas de 30 s que pueden retener la tabla.',
    run1: 'Cada intento es una transaccion corta: obtiene el lock en 2 s o desiste y libera la cola.',
    run2: 'CREATE INDEX CONCURRENTLY no corre en transaccion; el limite va en la sesion y se deshace al final.',
    run3: 'El error 55P03 (lock_not_available) es esperado: espera con backoff y jitter y vuelve a intentar.',
    safe1: '1. Columna anulable sin default: solo catalogo, el ACCESS EXCLUSIVE dura milisegundos.',
    safe2: '2. Relleno fuera del DDL, en lotes pequenos, repetido hasta que no quede fila nula.',
    safe3: '3. NOT NULL sin escaneo bajo lock (Postgres 12+): la constraint validada evita el scan.',
    safe4: '4. Clave foranea en dos pasos: crear sin validar y validar sin bloquear escrituras.',
    safe5: '5. Indice sin bloquear escrituras. Si falla queda un indice INVALID: eliminarlo y repetir.',
  },
};

const diagnosticoCode = (c) => `-- ${c.diag1}
SELECT a.pid,
       a.state,
       a.wait_event_type,
       now() - a.query_start     AS running_for,
       pg_blocking_pids(a.pid)   AS blocked_by,
       left(a.query, 70)         AS query
  FROM pg_stat_activity a
 WHERE a.datname = current_database()
   AND a.backend_type = 'client backend'
   AND (a.wait_event_type = 'Lock'
        OR a.pid IN (SELECT unnest(pg_blocking_pids(x.pid)) FROM pg_stat_activity x))
 ORDER BY a.query_start;

-- ${c.diag2}
SELECT pid, mode, relation::regclass AS table_name
  FROM pg_locks
 WHERE NOT granted;

-- ${c.diag3}
SELECT pid, now() - xact_start AS open_for, state, left(query, 70) AS query
  FROM pg_stat_activity
 WHERE xact_start < now() - interval '30 seconds'
   AND pid <> pg_backend_pid();`;

const runnerCode = (c) => `// migrate.js
const LOCK_TIMEOUT_MS = 2000;
const STATEMENT_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 8;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function applyDdl(pool, { name, sql, transactional = true }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const client = await pool.connect();
    try {
      if (transactional) {
        // ${c.run1}
        await client.query('BEGIN');
        await client.query("SELECT set_config('lock_timeout', $1, true)", [LOCK_TIMEOUT_MS + 'ms']);
        await client.query("SELECT set_config('statement_timeout', $1, true)", [STATEMENT_TIMEOUT_MS + 'ms']);
        await client.query(sql);
        await client.query('COMMIT');
      } else {
        // ${c.run2}
        await client.query('SET lock_timeout = ' + LOCK_TIMEOUT_MS);
        await client.query(sql);
      }
      return { name, attempt };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      // ${c.run3}
      if (error.code !== '55P03' || attempt === MAX_ATTEMPTS) throw error;
      const wait = Math.min(500 * 2 ** attempt, 15000) + Math.floor(Math.random() * 500);
      console.warn(name + ': lock not acquired (attempt ' + attempt + '), retrying in ' + wait + ' ms');
      await sleep(wait);
    } finally {
      if (!transactional) await client.query('RESET lock_timeout').catch(() => {});
      client.release();
    }
  }
}`;

const padroesSeguros = (c) => `-- ${c.safe1}
ALTER TABLE orders ADD COLUMN channel text;

-- ${c.safe2}
UPDATE orders SET channel = 'web'
 WHERE id BETWEEN 1 AND 50000 AND channel IS NULL;

-- ${c.safe3}
ALTER TABLE orders ADD CONSTRAINT orders_channel_nn CHECK (channel IS NOT NULL) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT orders_channel_nn;
ALTER TABLE orders ALTER COLUMN channel SET NOT NULL;
ALTER TABLE orders DROP CONSTRAINT orders_channel_nn;

-- ${c.safe4}
ALTER TABLE orders ADD CONSTRAINT orders_customer_fk
  FOREIGN KEY (customer_id) REFERENCES customers (id) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT orders_customer_fk;

-- ${c.safe5}
CREATE INDEX CONCURRENTLY idx_orders_channel ON orders (channel);
DROP INDEX CONCURRENTLY IF EXISTS idx_orders_channel;`;

const diagramaPt = `t=0      relatorio de BI abre transacao e le orders (ACCESS SHARE), vai durar 5 min 40 s
t=10 s   migracao: ALTER TABLE orders ADD COLUMN ... pede ACCESS EXCLUSIVE -> espera o relatorio
t=10 s   API: SELECT em orders pede ACCESS SHARE -> entra na fila ATRAS do ALTER
t=12 s   pool de 50 conexoes inteiro preso na fila, health check ainda responde 200
t=15 s   usuarios veem timeout; novas requisicoes seguem chegando
t=5m40   relatorio termina -> ALTER pega o lock, roda em 40 ms, solta -> a fila drena

Com lock_timeout = 2 s:
t=12 s   ALTER desiste (55P03), libera a fila; API volta em milissegundos
t=14 s   migracao tenta de novo com backoff, ate o relatorio terminar`;

const diagramaEn = `t=0      BI report opens a transaction and reads orders (ACCESS SHARE), will last 5 min 40 s
t=10 s   migration: ALTER TABLE orders ADD COLUMN ... requests ACCESS EXCLUSIVE -> waits for the report
t=10 s   API: SELECT on orders requests ACCESS SHARE -> queues BEHIND the ALTER
t=12 s   the whole 50 connection pool is stuck in the queue, health check still answers 200
t=15 s   users see timeouts; new requests keep arriving
t=5m40   report ends -> ALTER gets the lock, runs in 40 ms, releases -> the queue drains

With lock_timeout = 2 s:
t=12 s   ALTER gives up (55P03), frees the queue; API recovers in milliseconds
t=14 s   migration retries with backoff, until the report is done`;

const diagramaEs = `t=0      reporte de BI abre transaccion y lee orders (ACCESS SHARE), durara 5 min 40 s
t=10 s   migracion: ALTER TABLE orders ADD COLUMN ... pide ACCESS EXCLUSIVE -> espera al reporte
t=10 s   API: SELECT en orders pide ACCESS SHARE -> entra en la cola DETRAS del ALTER
t=12 s   el pool de 50 conexiones completo queda atascado en la cola, el health check aun responde 200
t=15 s   los usuarios ven timeouts; siguen llegando nuevas solicitudes
t=5m40   el reporte termina -> ALTER obtiene el lock, corre en 40 ms, lo suelta -> la cola se drena

Con lock_timeout = 2 s:
t=12 s   ALTER desiste (55P03), libera la cola; la API se recupera en milisegundos
t=14 s   la migracion reintenta con backoff, hasta que el reporte termine`;

const pt = {
  intro:
    'Um marketplace B2B com 38 milhões de pedidos rodou uma migração que o time considerava trivial: ALTER TABLE orders ADD COLUMN channel text. Em teste levou 40 ms. Em produção, a API ficou 5 minutos e 40 segundos sem responder, com o health check devolvendo 200 o tempo todo. A migração em si nunca foi lenta: ela ficou esperando um lock, e tudo o que chegou depois dela esperou junto. Este artigo explica a fila de locks do Postgres que transforma um comando de milissegundos em parada total, como enxergar essa fila durante o incidente, como fazer a migração desistir rápido e tentar de novo com lock_timeout, e quais padrões de DDL evitam o lock longo de vez.',
  sections: [
    {
      title: 'A migração de 40 ms que derrubou a API por quase seis minutos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O deploy rodava a migração antes de subir a nova versão, como manda o roteiro. Naquele dia, um analista tinha disparado um relatório de BI que abre uma transação, lê a tabela orders e passa minutos agregando. Essa transação segura um ACCESS SHARE em orders, um lock fraco que ninguém percebe. Quando a migração pediu o ACCESS EXCLUSIVE que o ALTER TABLE exige, ela não pôde ser atendida e entrou na fila de espera do lock.',
        },
        {
          type: 'paragraph',
          value:
            'Até aqui o dano seria só um deploy lento. O problema é o que acontece com as consultas seguintes: um SELECT comum da API pede ACCESS SHARE, que não conflita com o ACCESS SHARE do relatório, mas conflita com o ACCESS EXCLUSIVE que está esperando na frente. O Postgres respeita a ordem da fila, então a API passa a esperar atrás da migração. Em 12 segundos as 50 conexões do pool estavam ocupadas esperando, e o serviço ficou mudo até o relatório terminar.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'Dois sinais enganaram o time. O health check não toca a tabela orders e continuou verde, então o balanceador manteve a instância no ar. E o gráfico de CPU do banco estava quase zerado, porque nada estava executando: tudo estava esperando. Um incidente de lock não parece um incidente de banco nos painéis comuns.',
        },
      ],
    },
    {
      title: 'Por que um lock pequeno vira parada total: a fila e o ACCESS EXCLUSIVE',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O ALTER TABLE costuma pedir o modo mais forte, o ACCESS EXCLUSIVE, que conflita com todos os outros modos, inclusive o ACCESS SHARE de um SELECT. A regra de enfileiramento é simples: um pedido de lock espera por todos os locks já concedidos que conflitam com ele e também pelos pedidos conflitantes que chegaram antes. Isso evita que um pedido forte morra de inanição, mas dá a ele o poder de bloquear qualquer coisa que venha depois.',
        },
        {
          type: 'paragraph',
          value:
            'O resultado é uma assimetria perigosa. O custo do ALTER, uma vez com o lock, é de milissegundos. O custo de esperar o lock é ilimitado e é pago por todos os outros. O tempo da migração não é o tempo do comando, é o tempo da transação mais longa que estiver tocando a tabela naquele momento, mais o tempo que a fila leva para drenar depois que o lock é liberado.',
        },
        {
          type: 'table',
          columns: ['Operação', 'Lock na tabela', 'Bloqueia leitura e escrita?', 'Observação'],
          rows: [
            ['ADD COLUMN anulável, sem default ou com default constante', 'ACCESS EXCLUSIVE', 'Sim, por milissegundos', 'Só catálogo no Postgres 11+, sem reescrever a tabela'],
            ['ADD COLUMN com default volátil, ALTER COLUMN TYPE', 'ACCESS EXCLUSIVE', 'Sim, durante a reescrita', 'Reescreve a tabela inteira: use expansão e troca'],
            ['SET NOT NULL', 'ACCESS EXCLUSIVE', 'Sim, durante a varredura', 'No Postgres 12+ dispensa o scan com CHECK validado'],
            ['ADD CONSTRAINT ... NOT VALID', 'ACCESS EXCLUSIVE', 'Sim, por milissegundos', 'Não verifica as linhas existentes'],
            ['VALIDATE CONSTRAINT', 'SHARE UPDATE EXCLUSIVE', 'Não bloqueia leitura nem escrita', 'Varre a tabela, mas sem travar a aplicação'],
            ['CREATE INDEX CONCURRENTLY', 'SHARE UPDATE EXCLUSIVE', 'Não bloqueia escrita', 'Não roda em transação; falha deixa índice INVALID'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A tabela mostra por que a pergunta certa nunca é "quanto o comando demora", e sim "que lock ele pede e por quanto tempo vai esperar para consegui-lo". Mesmo as operações rápidas dependem de conseguir o ACCESS EXCLUSIVE, e é essa espera que precisa de um teto.',
        },
      ],
    },
    {
      title: 'Enxergar a fila durante o incidente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Durante o travamento, três consultas contam a história inteira. A primeira lista as sessões em espera de lock e quem está na frente da fila, usando pg_blocking_pids. A segunda lista os pedidos de lock não concedidos em pg_locks, onde o ALTER aparece com o modo AccessExclusiveLock. A terceira, que vale rodar antes de qualquer migração, lista transações abertas há mais de 30 segundos, as candidatas a segurar a tabela.',
        },
        {
          type: 'code',
          value: diagnosticoCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'A leitura típica mostra uma cadeia: o relatório de BI no começo, sem esperar nada e com a transação mais antiga; o ALTER logo depois, esperando por ele; e dezenas de SELECT da API esperando pelo ALTER, todos com wait_event_type igual a Lock. A tentação é matar o ALTER, e isso funciona na hora, porque libera a fila. Mas a causa que volta amanhã é o relatório, não a migração.',
        },
      ],
    },
    {
      title: 'Migração que desiste rápido: lock_timeout com retentativa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A defesa principal é fazer a migração perder a paciência rápido. Com lock_timeout de 2 segundos, o ALTER espera no máximo 2 segundos na fila; se não conseguir, falha com o erro 55P03 e libera todo mundo que estava atrás dele. O custo para a aplicação cai de minutos para no máximo 2 segundos de lentidão. A migração então tenta de novo, com espera crescente e um pouco de aleatoriedade, até encontrar uma janela em que o relatório não esteja segurando a tabela.',
        },
        {
          type: 'code',
          value: runnerCode(comments.pt),
        },
        {
          type: 'list',
          items: [
            'Use set_config com o terceiro argumento verdadeiro (equivalente a SET LOCAL) dentro da transação: o limite some no COMMIT ou ROLLBACK e não contamina a conexão do pool.',
            'Em operações fora de transação, como CREATE INDEX CONCURRENTLY, o limite é de sessão: restaure com RESET antes de devolver a conexão ao pool.',
            'Trate somente 55P03 como erro retentável. Qualquer outro erro de DDL, como coluna duplicada, deve parar a migração.',
            'Defina um número máximo de tentativas e falhe com mensagem clara. Uma migração que tenta para sempre é só outra forma de espera sem teto.',
            'Rode o statement_timeout junto, para que um DDL que escolheu varrer a tabela não segure o lock por minutos.',
          ],
        },
      ],
    },
    {
      title: 'Padrões que evitam o lock longo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O timeout limita o dano da espera, mas o desenho da migração decide quanto tempo o lock fica com você depois de conseguido. A regra é separar o que é mudança de catálogo, que é instantânea, do que exige olhar todas as linhas, que deve rodar em passos com lock fraco ou em lotes fora do DDL.',
        },
        {
          type: 'code',
          value: padroesSeguros(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'No passo 3, o SET NOT NULL ainda pede ACCESS EXCLUSIVE, por isso deve passar pelo mesmo executor com lock_timeout. A diferença é que, com a constraint já validada, o Postgres 12 ou superior reconhece que nenhuma linha é nula e não varre a tabela. Para troca de tipo, como int para bigint, a abordagem é criar uma coluna nova, preencher em lotes, sincronizar com gatilho e fazer a troca em uma transação curta, o mesmo princípio de expandir, migrar e contrair.',
        },
      ],
    },
    {
      title: 'Proteger o processo: ensaio, análise automática e horário',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Migração segura é um processo, não um comando. Quatro proteções custam pouco e pegam a maioria dos casos antes da produção.',
        },
        {
          type: 'ordered',
          items: [
            'Ensaio com carga e transação longa: no ambiente de homologação, abra uma transação de leitura em orders por um minuto e rode a migração durante o tráfego sintético. Se a API engasgar, o executor ainda não tem timeout ou o DDL pede mais lock do que o previsto.',
            'Análise automática no CI: rejeite migrações que contenham ADD COLUMN com default volátil, SET NOT NULL direto, CREATE INDEX sem CONCURRENTLY, ADD FOREIGN KEY sem NOT VALID ou ALTER COLUMN TYPE. Uma verificação por texto já pega o erro comum.',
            'Consulta de pré-voo: antes de aplicar, rode a lista de transações abertas há mais de 30 segundos. Se houver uma que toque a tabela, espere ou avise o dono, em vez de apostar na retentativa.',
            'Janela com alerta: alerte quando houver sessão em wait_event_type igual a Lock por mais de 5 segundos. Esse alerta teria avisado o incidente aos 15 segundos, não aos 6 minutos.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Rodar de madrugada ajuda a reduzir o número de usuários afetados, mas não resolve a causa: o relatório noturno de BI e os jobs agendados costumam estar justamente ali. O que protege é o teto de espera, não o horário.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'O lock_timeout não pode fazer a migração nunca terminar, se a tabela estiver sempre em uso?',
      answer:
        'Pode, e isso é um sinal útil. Em tabelas com tráfego constante, sempre haverá alguma transação em curso, mas o ACCESS EXCLUSIVE só precisa de um instante em que nenhuma transação conflitante esteja ativa, e consultas curtas costumam deixar essa folga. Se mesmo com oito tentativas a migração não passa, o motivo quase sempre é uma transação longa de verdade, como um relatório ou um worker parado, e o caminho é encontrá-la com pg_stat_activity e resolvê-la, não aumentar o timeout.',
    },
    {
      question: 'Adicionar uma coluna com default ainda trava a tabela inteira?',
      answer:
        'Depende do default. No Postgres 11 ou superior, um default constante ou estável, como um valor fixo ou now(), é gravado no catálogo e não reescreve a tabela, então o ALTER só precisa do ACCESS EXCLUSIVE por milissegundos. Um default volátil, como random() ou clock_timestamp(), ainda reescreve todas as linhas sob o lock. Em versões anteriores ao 11, qualquer default reescrevia a tabela. Em todos os casos, o ALTER precisa conseguir o lock, e é por isso que o lock_timeout continua necessário.',
    },
    {
      question: 'Por que não rodar a migração em uma réplica ou em um banco novo e trocar depois?',
      answer:
        'Porque o DDL em um banco de leitura não existe, e trocar de banco exige replicação lógica, com todos os cuidados de sincronização, o que é um projeto próprio. Para a grande maioria das mudanças de esquema, os padrões deste artigo resolvem no mesmo banco com um custo muito menor. A troca de banco só se justifica em mudanças verdadeiramente grandes, como upgrade de versão major, e mesmo assim cada migração de esquema do dia a dia deve seguir o limite de espera.',
    },
  ],
  conclusion: {
    title: 'Em migração, o risco está na espera, não no comando',
    description:
      'O ALTER TABLE de 40 ms só derrubou a API porque pôde esperar sem limite por um lock e, com isso, trancou a fila inteira atrás de si. O remédio tem três partes: um teto de espera com lock_timeout e retentativa, padrões de DDL que usam lock fraco ou lotes fora do comando, e um processo que ensaia a migração com transação longa e alerta sobre sessões em espera de lock. Com isso, a migração deixa de ser um risco aleatório do deploy e passa a ser uma operação previsível, que falha rápido e tenta de novo.',
    cta: 'Revisar o processo de migrações do meu banco',
  },
  related: [
    {
      label: 'Transação longa que ninguém fecha: idle in transaction que segura vacuum, lock e conexão',
      to: '/blog/transacao-longa-que-ninguem-fecha-idle-in-transaction-que-segura-vacuum-lock-e-conexao',
    },
    {
      label: 'Deadlock em produção: quando duas transações corretas se travam uma na outra',
      to: '/blog/deadlock-em-producao-quando-duas-transacoes-corretas-se-travam-uma-na-outra',
    },
    {
      label: 'Serviço de arquitetura e modernização backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A B2B marketplace with 38 million orders ran a migration the team considered trivial: ALTER TABLE orders ADD COLUMN channel text. In testing it took 40 ms. In production the API stayed unresponsive for 5 minutes and 40 seconds, with the health check answering 200 the whole time. The migration itself was never slow: it was waiting for a lock, and everything that arrived after it waited along. This article explains the Postgres lock queue that turns a millisecond command into a full outage, how to see that queue during the incident, how to make the migration give up fast and retry with lock_timeout, and which DDL patterns avoid the long lock altogether.',
  sections: [
    {
      title: 'The 40 ms migration that took the API down for almost six minutes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The deploy ran the migration before starting the new version, as the playbook says. That day an analyst had launched a BI report that opens a transaction, reads the orders table and spends minutes aggregating. That transaction holds an ACCESS SHARE on orders, a weak lock nobody notices. When the migration requested the ACCESS EXCLUSIVE that ALTER TABLE requires, it could not be granted and joined the lock wait queue.',
        },
        {
          type: 'paragraph',
          value:
            'Up to here the damage would be just a slow deploy. The problem is what happens to the following queries: a regular API SELECT requests ACCESS SHARE, which does not conflict with the report ACCESS SHARE but does conflict with the ACCESS EXCLUSIVE waiting in front. Postgres respects queue order, so the API starts waiting behind the migration. Within 12 seconds all 50 pool connections were busy waiting, and the service stayed silent until the report finished.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'Two signals fooled the team. The health check does not touch the orders table and stayed green, so the load balancer kept the instance in rotation. And the database CPU chart was nearly flat, because nothing was executing: everything was waiting. A lock incident does not look like a database incident on common dashboards.',
        },
      ],
    },
    {
      title: 'Why a small lock becomes a full outage: the queue and ACCESS EXCLUSIVE',
      blocks: [
        {
          type: 'paragraph',
          value:
            'ALTER TABLE usually asks for the strongest mode, ACCESS EXCLUSIVE, which conflicts with every other mode, including the ACCESS SHARE of a SELECT. The queueing rule is simple: a lock request waits for all granted locks that conflict with it and also for conflicting requests that arrived earlier. This prevents a strong request from starving, but gives it the power to block anything that comes after.',
        },
        {
          type: 'paragraph',
          value:
            'The result is a dangerous asymmetry. The cost of the ALTER, once it has the lock, is milliseconds. The cost of waiting for the lock is unbounded and is paid by everyone else. The migration time is not the command time, it is the time of the longest transaction touching the table at that moment, plus the time the queue takes to drain after the lock is released.',
        },
        {
          type: 'table',
          columns: ['Operation', 'Table lock', 'Blocks reads and writes?', 'Note'],
          rows: [
            ['ADD COLUMN nullable, no default or constant default', 'ACCESS EXCLUSIVE', 'Yes, for milliseconds', 'Catalog only on Postgres 11+, no table rewrite'],
            ['ADD COLUMN with volatile default, ALTER COLUMN TYPE', 'ACCESS EXCLUSIVE', 'Yes, during the rewrite', 'Rewrites the whole table: use expand and swap'],
            ['SET NOT NULL', 'ACCESS EXCLUSIVE', 'Yes, during the scan', 'On Postgres 12+ skips the scan with a validated CHECK'],
            ['ADD CONSTRAINT ... NOT VALID', 'ACCESS EXCLUSIVE', 'Yes, for milliseconds', 'Does not check existing rows'],
            ['VALIDATE CONSTRAINT', 'SHARE UPDATE EXCLUSIVE', 'Does not block reads or writes', 'Scans the table, but without freezing the application'],
            ['CREATE INDEX CONCURRENTLY', 'SHARE UPDATE EXCLUSIVE', 'Does not block writes', 'Cannot run in a transaction; failure leaves an INVALID index'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The table shows why the right question is never "how long does the command take", but "which lock does it request and how long will it wait to get it". Even the fast operations depend on obtaining the ACCESS EXCLUSIVE, and that wait is what needs a ceiling.',
        },
      ],
    },
    {
      title: 'Seeing the queue during the incident',
      blocks: [
        {
          type: 'paragraph',
          value:
            'During the freeze, three queries tell the whole story. The first lists sessions waiting for a lock and who is at the front of the queue, using pg_blocking_pids. The second lists ungranted lock requests in pg_locks, where the ALTER shows up with the AccessExclusiveLock mode. The third, worth running before any migration, lists transactions open for more than 30 seconds, the candidates to be holding the table.',
        },
        {
          type: 'code',
          value: diagnosticoCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'The typical reading shows a chain: the BI report at the start, waiting for nothing and holding the oldest transaction; the ALTER right after, waiting for it; and dozens of API SELECTs waiting for the ALTER, all with wait_event_type equal to Lock. The temptation is to kill the ALTER, and that works instantly because it frees the queue. But the cause that returns tomorrow is the report, not the migration.',
        },
      ],
    },
    {
      title: 'A migration that gives up fast: lock_timeout with retry',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The main defense is making the migration lose patience quickly. With a lock_timeout of 2 seconds, the ALTER waits at most 2 seconds in the queue; if it cannot get the lock it fails with error 55P03 and frees everyone behind it. The cost to the application drops from minutes to at most 2 seconds of slowness. The migration then tries again, with growing waits and a bit of randomness, until it finds a window where the report is not holding the table.',
        },
        {
          type: 'code',
          value: runnerCode(comments.en),
        },
        {
          type: 'list',
          items: [
            'Use set_config with true as the third argument (equivalent to SET LOCAL) inside the transaction: the limit disappears on COMMIT or ROLLBACK and does not leak into the pool connection.',
            'For operations outside a transaction, such as CREATE INDEX CONCURRENTLY, the limit is per session: restore it with RESET before returning the connection to the pool.',
            'Treat only 55P03 as retryable. Any other DDL error, such as a duplicate column, must stop the migration.',
            'Set a maximum number of attempts and fail with a clear message. A migration that retries forever is just another unbounded wait.',
            'Run statement_timeout alongside, so a DDL that chose to scan the table does not hold the lock for minutes.',
          ],
        },
      ],
    },
    {
      title: 'Patterns that avoid the long lock',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The timeout limits the damage of waiting, but the migration design decides how long you keep the lock once you have it. The rule is to separate what is a catalog change, which is instant, from what requires looking at every row, which should run in steps with a weak lock or in batches outside the DDL.',
        },
        {
          type: 'code',
          value: padroesSeguros(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'In step 3, SET NOT NULL still requests ACCESS EXCLUSIVE, so it should go through the same executor with lock_timeout. The difference is that, with the constraint already validated, Postgres 12 or later recognizes that no row is null and does not scan the table. For type changes, such as int to bigint, the approach is to create a new column, backfill in batches, keep it in sync with a trigger and swap in a short transaction, the same expand, migrate and contract principle.',
        },
      ],
    },
    {
      title: 'Protecting the process: rehearsal, automatic checks and timing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A safe migration is a process, not a command. Four protections cost little and catch most cases before production.',
        },
        {
          type: 'ordered',
          items: [
            'Rehearsal with load and a long transaction: in staging, open a read transaction on orders for one minute and run the migration during synthetic traffic. If the API chokes, the executor has no timeout yet or the DDL requests more lock than expected.',
            'Automatic checks in CI: reject migrations containing ADD COLUMN with a volatile default, a direct SET NOT NULL, CREATE INDEX without CONCURRENTLY, ADD FOREIGN KEY without NOT VALID or ALTER COLUMN TYPE. A text based check already catches the common mistake.',
            'Pre flight query: before applying, run the list of transactions open for more than 30 seconds. If one touches the table, wait or warn its owner instead of betting on the retry.',
            'Window with an alert: alert when a session has wait_event_type equal to Lock for more than 5 seconds. That alert would have flagged the incident at 15 seconds, not at 6 minutes.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Running at night helps reduce the number of affected users, but it does not fix the cause: the nightly BI report and scheduled jobs are usually right there. What protects is the wait ceiling, not the time of day.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can lock_timeout make the migration never finish if the table is always in use?',
      answer:
        'It can, and that is a useful signal. On tables with constant traffic there will always be some transaction in flight, but ACCESS EXCLUSIVE only needs an instant when no conflicting transaction is active, and short queries usually leave that gap. If even with eight attempts the migration does not go through, the reason is almost always a truly long transaction, such as a report or a stalled worker, and the way out is to find it with pg_stat_activity and fix it, not to raise the timeout.',
    },
    {
      question: 'Does adding a column with a default still lock the whole table?',
      answer:
        'It depends on the default. On Postgres 11 or later, a constant or stable default, such as a fixed value or now(), is stored in the catalog and does not rewrite the table, so the ALTER only needs ACCESS EXCLUSIVE for milliseconds. A volatile default, such as random() or clock_timestamp(), still rewrites every row under the lock. Before version 11, any default rewrote the table. In every case the ALTER must obtain the lock, which is why lock_timeout is still needed.',
    },
    {
      question: 'Why not run the migration on a replica or a new database and switch later?',
      answer:
        'Because DDL does not exist on a read replica, and switching databases requires logical replication, with all its synchronization concerns, which is a project of its own. For the vast majority of schema changes, the patterns in this article solve it on the same database at a much lower cost. Switching databases is only justified for truly large changes, such as a major version upgrade, and even then every day to day schema migration should follow the wait limit.',
    },
  ],
  conclusion: {
    title: 'In migrations, the risk is in the wait, not in the command',
    description:
      'The 40 ms ALTER TABLE only took the API down because it was allowed to wait without limit for a lock and, in doing so, blocked the whole queue behind it. The remedy has three parts: a wait ceiling with lock_timeout and retry, DDL patterns that use weak locks or batches outside the command, and a process that rehearses the migration with a long transaction and alerts on sessions waiting for locks. With that, the migration stops being a random deploy risk and becomes a predictable operation that fails fast and tries again.',
    cta: 'Review the migration process of my database',
  },
  related: [
    {
      label: 'The long transaction nobody closes: idle in transaction holding back vacuum, locks and connections',
      to: '/blog/transacao-longa-que-ninguem-fecha-idle-in-transaction-que-segura-vacuum-lock-e-conexao',
    },
    {
      label: 'Deadlock in production: when two correct transactions lock each other',
      to: '/blog/deadlock-em-producao-quando-duas-transacoes-corretas-se-travam-uma-na-outra',
    },
    {
      label: 'Backend architecture and modernization service',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Un marketplace B2B con 38 millones de pedidos ejecutó una migración que el equipo consideraba trivial: ALTER TABLE orders ADD COLUMN channel text. En pruebas tardó 40 ms. En producción la API estuvo 5 minutos y 40 segundos sin responder, con el health check devolviendo 200 todo el tiempo. La migración nunca fue lenta: estaba esperando un lock, y todo lo que llegó después esperó con ella. Este artículo explica la cola de locks de Postgres que convierte un comando de milisegundos en una caída total, cómo ver esa cola durante el incidente, cómo hacer que la migración desista rápido y reintente con lock_timeout, y qué patrones de DDL evitan el lock largo de raíz.',
  sections: [
    {
      title: 'La migración de 40 ms que tumbó la API durante casi seis minutos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El deploy ejecutaba la migración antes de levantar la nueva versión, como indica el guion. Ese día un analista había lanzado un reporte de BI que abre una transacción, lee la tabla orders y pasa minutos agregando. Esa transacción retiene un ACCESS SHARE en orders, un lock débil que nadie nota. Cuando la migración pidió el ACCESS EXCLUSIVE que exige ALTER TABLE, no pudo ser atendida y entró en la cola de espera del lock.',
        },
        {
          type: 'paragraph',
          value:
            'Hasta aquí el daño sería solo un deploy lento. El problema es lo que ocurre con las consultas siguientes: un SELECT común de la API pide ACCESS SHARE, que no entra en conflicto con el ACCESS SHARE del reporte, pero sí con el ACCESS EXCLUSIVE que espera al frente. Postgres respeta el orden de la cola, así que la API pasa a esperar detrás de la migración. En 12 segundos las 50 conexiones del pool estaban ocupadas esperando, y el servicio quedó mudo hasta que el reporte terminó.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'Dos señales engañaron al equipo. El health check no toca la tabla orders y siguió en verde, así que el balanceador mantuvo la instancia activa. Y el gráfico de CPU de la base estaba casi en cero, porque nada se ejecutaba: todo esperaba. Un incidente de locks no parece un incidente de base de datos en los paneles comunes.',
        },
      ],
    },
    {
      title: 'Por qué un lock pequeño se vuelve una caída total: la cola y el ACCESS EXCLUSIVE',
      blocks: [
        {
          type: 'paragraph',
          value:
            'ALTER TABLE suele pedir el modo más fuerte, ACCESS EXCLUSIVE, que entra en conflicto con todos los demás modos, incluido el ACCESS SHARE de un SELECT. La regla de encolado es simple: un pedido de lock espera a todos los locks ya concedidos que entran en conflicto con él y también a los pedidos conflictivos que llegaron antes. Esto evita que un pedido fuerte muera de inanición, pero le da el poder de bloquear todo lo que llegue después.',
        },
        {
          type: 'paragraph',
          value:
            'El resultado es una asimetría peligrosa. El costo del ALTER, una vez con el lock, es de milisegundos. El costo de esperar el lock es ilimitado y lo pagan todos los demás. El tiempo de la migración no es el tiempo del comando, es el tiempo de la transacción más larga que esté tocando la tabla en ese momento, más el tiempo que tarda la cola en drenarse tras liberar el lock.',
        },
        {
          type: 'table',
          columns: ['Operación', 'Lock en la tabla', '¿Bloquea lectura y escritura?', 'Observación'],
          rows: [
            ['ADD COLUMN anulable, sin default o con default constante', 'ACCESS EXCLUSIVE', 'Sí, por milisegundos', 'Solo catálogo en Postgres 11+, sin reescribir la tabla'],
            ['ADD COLUMN con default volátil, ALTER COLUMN TYPE', 'ACCESS EXCLUSIVE', 'Sí, durante la reescritura', 'Reescribe toda la tabla: usar expansión y cambio'],
            ['SET NOT NULL', 'ACCESS EXCLUSIVE', 'Sí, durante el escaneo', 'En Postgres 12+ evita el scan con un CHECK validado'],
            ['ADD CONSTRAINT ... NOT VALID', 'ACCESS EXCLUSIVE', 'Sí, por milisegundos', 'No verifica las filas existentes'],
            ['VALIDATE CONSTRAINT', 'SHARE UPDATE EXCLUSIVE', 'No bloquea lectura ni escritura', 'Escanea la tabla, pero sin congelar la aplicación'],
            ['CREATE INDEX CONCURRENTLY', 'SHARE UPDATE EXCLUSIVE', 'No bloquea escritura', 'No corre en transacción; un fallo deja un índice INVALID'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tabla muestra por qué la pregunta correcta nunca es "cuánto tarda el comando", sino "qué lock pide y cuánto va a esperar para obtenerlo". Incluso las operaciones rápidas dependen de conseguir el ACCESS EXCLUSIVE, y esa espera es la que necesita un techo.',
        },
      ],
    },
    {
      title: 'Ver la cola durante el incidente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Durante el congelamiento, tres consultas cuentan toda la historia. La primera lista las sesiones que esperan un lock y quién está al frente de la cola, usando pg_blocking_pids. La segunda lista los pedidos de lock no concedidos en pg_locks, donde el ALTER aparece con el modo AccessExclusiveLock. La tercera, que conviene ejecutar antes de cualquier migración, lista las transacciones abiertas hace más de 30 segundos, las candidatas a retener la tabla.',
        },
        {
          type: 'code',
          value: diagnosticoCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'La lectura típica muestra una cadena: el reporte de BI al comienzo, sin esperar nada y con la transacción más antigua; el ALTER justo después, esperándolo; y decenas de SELECT de la API esperando al ALTER, todos con wait_event_type igual a Lock. La tentación es matar el ALTER, y eso funciona al instante porque libera la cola. Pero la causa que vuelve mañana es el reporte, no la migración.',
        },
      ],
    },
    {
      title: 'Una migración que desiste rápido: lock_timeout con reintento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La defensa principal es hacer que la migración pierda la paciencia rápido. Con un lock_timeout de 2 segundos, el ALTER espera como máximo 2 segundos en la cola; si no consigue el lock falla con el error 55P03 y libera a todos los que estaban detrás. El costo para la aplicación baja de minutos a como máximo 2 segundos de lentitud. La migración vuelve a intentar, con esperas crecientes y algo de aleatoriedad, hasta encontrar una ventana en la que el reporte no retenga la tabla.',
        },
        {
          type: 'code',
          value: runnerCode(comments.es),
        },
        {
          type: 'list',
          items: [
            'Use set_config con true como tercer argumento (equivalente a SET LOCAL) dentro de la transacción: el límite desaparece con COMMIT o ROLLBACK y no contamina la conexión del pool.',
            'En operaciones fuera de transacción, como CREATE INDEX CONCURRENTLY, el límite es de sesión: restáurelo con RESET antes de devolver la conexión al pool.',
            'Trate solo 55P03 como error reintentable. Cualquier otro error de DDL, como una columna duplicada, debe detener la migración.',
            'Defina un número máximo de intentos y falle con un mensaje claro. Una migración que reintenta para siempre es solo otra espera sin techo.',
            'Ejecute statement_timeout en conjunto, para que un DDL que decidió escanear la tabla no retenga el lock durante minutos.',
          ],
        },
      ],
    },
    {
      title: 'Patrones que evitan el lock largo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El timeout limita el daño de la espera, pero el diseño de la migración decide cuánto tiempo conserva el lock una vez conseguido. La regla es separar lo que es un cambio de catálogo, que es instantáneo, de lo que exige mirar todas las filas, que debe correr en pasos con lock débil o en lotes fuera del DDL.',
        },
        {
          type: 'code',
          value: padroesSeguros(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'En el paso 3, el SET NOT NULL todavía pide ACCESS EXCLUSIVE, por eso debe pasar por el mismo ejecutor con lock_timeout. La diferencia es que, con la constraint ya validada, Postgres 12 o superior reconoce que ninguna fila es nula y no escanea la tabla. Para cambios de tipo, como int a bigint, el enfoque es crear una columna nueva, rellenar en lotes, sincronizar con un trigger y hacer el cambio en una transacción corta, el mismo principio de expandir, migrar y contraer.',
        },
      ],
    },
    {
      title: 'Proteger el proceso: ensayo, análisis automático y horario',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una migración segura es un proceso, no un comando. Cuatro protecciones cuestan poco y atrapan la mayoría de los casos antes de producción.',
        },
        {
          type: 'ordered',
          items: [
            'Ensayo con carga y transacción larga: en el entorno de pruebas, abra una transacción de lectura en orders durante un minuto y ejecute la migración con tráfico sintético. Si la API se atasca, el ejecutor aún no tiene timeout o el DDL pide más lock de lo previsto.',
            'Análisis automático en CI: rechace migraciones que contengan ADD COLUMN con default volátil, SET NOT NULL directo, CREATE INDEX sin CONCURRENTLY, ADD FOREIGN KEY sin NOT VALID o ALTER COLUMN TYPE. Una verificación por texto ya atrapa el error común.',
            'Consulta previa: antes de aplicar, ejecute la lista de transacciones abiertas hace más de 30 segundos. Si alguna toca la tabla, espere o avise a su dueño en lugar de apostar al reintento.',
            'Ventana con alerta: alerte cuando haya una sesión con wait_event_type igual a Lock por más de 5 segundos. Esa alerta habría avisado del incidente a los 15 segundos, no a los 6 minutos.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Ejecutar de madrugada ayuda a reducir el número de usuarios afectados, pero no resuelve la causa: el reporte nocturno de BI y los jobs programados suelen estar justamente ahí. Lo que protege es el techo de espera, no el horario.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿El lock_timeout no puede hacer que la migración nunca termine si la tabla está siempre en uso?',
      answer:
        'Puede, y es una señal útil. En tablas con tráfico constante siempre habrá alguna transacción en curso, pero el ACCESS EXCLUSIVE solo necesita un instante en que ninguna transacción conflictiva esté activa, y las consultas cortas suelen dejar ese hueco. Si incluso con ocho intentos la migración no pasa, el motivo casi siempre es una transacción realmente larga, como un reporte o un worker detenido, y el camino es encontrarla con pg_stat_activity y resolverla, no subir el timeout.',
    },
    {
      question: '¿Agregar una columna con default sigue bloqueando toda la tabla?',
      answer:
        'Depende del default. En Postgres 11 o superior, un default constante o estable, como un valor fijo o now(), se guarda en el catálogo y no reescribe la tabla, así que el ALTER solo necesita el ACCESS EXCLUSIVE por milisegundos. Un default volátil, como random() o clock_timestamp(), todavía reescribe todas las filas bajo el lock. En versiones anteriores a la 11, cualquier default reescribía la tabla. En todos los casos el ALTER debe conseguir el lock, y por eso el lock_timeout sigue siendo necesario.',
    },
    {
      question: '¿Por qué no ejecutar la migración en una réplica o en una base nueva y cambiar después?',
      answer:
        'Porque el DDL no existe en una réplica de lectura, y cambiar de base exige replicación lógica, con todos sus cuidados de sincronización, lo que es un proyecto propio. Para la gran mayoría de los cambios de esquema, los patrones de este artículo lo resuelven en la misma base con un costo mucho menor. Cambiar de base solo se justifica en cambios realmente grandes, como un upgrade de versión mayor, y aun así cada migración de esquema del día a día debe respetar el límite de espera.',
    },
  ],
  conclusion: {
    title: 'En migraciones, el riesgo está en la espera, no en el comando',
    description:
      'El ALTER TABLE de 40 ms solo tumbó la API porque pudo esperar sin límite por un lock y, con eso, bloqueó toda la cola detrás de sí. El remedio tiene tres partes: un techo de espera con lock_timeout y reintento, patrones de DDL que usan locks débiles o lotes fuera del comando, y un proceso que ensaya la migración con una transacción larga y alerta sobre sesiones que esperan locks. Con eso, la migración deja de ser un riesgo aleatorio del deploy y pasa a ser una operación previsible, que falla rápido y vuelve a intentar.',
    cta: 'Revisar el proceso de migraciones de mi base de datos',
  },
  related: [
    {
      label: 'La transacción larga que nadie cierra: idle in transaction que retiene vacuum, locks y conexiones',
      to: '/blog/transacao-longa-que-ninguem-fecha-idle-in-transaction-que-segura-vacuum-lock-e-conexao',
    },
    {
      label: 'Deadlock en producción: cuando dos transacciones correctas se bloquean entre sí',
      to: '/blog/deadlock-em-producao-quando-duas-transacoes-corretas-se-travam-uma-na-outra',
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
