// Conteudo do artigo: advisory lock que fica preso no pool. Por que pg_advisory_lock de sessao
// sobrevive ao COMMIT, como o PgBouncer em modo transacao entrega a trava para outro cliente,
// por que o unlock em outra conexao falha e o lock reentrante deixa dois jobs rodarem juntos,
// como achar o backend que segura a chave e como corrigir com trava de transacao, conexao
// dedicada ou lease em tabela.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const comments = {
  pt: {
    a1: 'Job de conciliação: 3 instâncias, agendado a cada 5 minutos, usando o pool compartilhado.',
    a2: 'Cada pool.query pode cair numa conexão diferente do servidor.',
    a3: 'outra instância já está rodando a conciliação',
    a4: 'O unlock vai para outra conexão: o Postgres responde false e só registra um WARNING.',
    b1: 'Chave da trava calculada do mesmo jeito que o job calcula.',
    b2: 'Uma chave bigint aparece dividida em classid (32 bits altos) e objid (32 bits baixos), com objsubid = 1.',
    b3: 'Resultado: a conexão do PgBouncer segura a trava há 19 horas e acabou de atender outra rota.',
    b4: 'Libera a trava encerrando o backend que a segura (está idle, nenhuma transação é cortada).',
    c1: 'Em modo transação, a consulta de reset não roda entre transações:',
    c2: 'Ligar isso não corrige: a trava passaria a durar uma única transação, e o job perderia a exclusão durante o processamento.',
    c3: 'Conexão do servidor reaproveitada por um dia inteiro, levando junto qualquer trava de sessão esquecida.',
    d1: 'Trava de transação: mesma conexão do início ao fim e liberação garantida no COMMIT ou no ROLLBACK.',
    d2: 'Limite para a transação inteira não virar uma transação longa esquecida.',
    d3: 'Outra instância está com a trava: encerra a transação e sai sem erro.',
    d4: 'A tarefa recebe o client para que todo o trabalho fique dentro da mesma transação.',
    d5: 'Se nem o ROLLBACK funcionou, a conexão está em estado desconhecido: descarta em vez de devolver ao pool.',
    e1: 'Job longo: conexão própria, direto no Postgres (porta 5432), sem passar pelo PgBouncer.',
    e2: 'O nome aparece em pg_stat_activity e identifica o dono da trava no diagnóstico.',
    e3: 'O trabalho pode usar o pool normal: a trava só precisa da conexão dedicada viva.',
    e4: 'Encerrar a conexão libera qualquer trava de sessão que tenha sobrado, mesmo se o unlock falhar.',
    f1: 'Alternativa sem conexão aberta: trava com prazo de validade em uma tabela.',
    f2: 'Adquire se não existe ou se a trava anterior venceu; devolve uma linha só quando conseguiu.',
    f3: 'Renovação periódica: zero linhas atualizadas significa que a trava foi perdida e o job deve parar.',
    f4: 'Liberação: só o dono atual apaga.',
  },
  en: {
    a1: 'Reconciliation job: 3 instances, scheduled every 5 minutes, using the shared pool.',
    a2: 'Each pool.query may land on a different server connection.',
    a3: 'another instance is already running the reconciliation',
    a4: 'The unlock goes to another connection: Postgres answers false and only logs a WARNING.',
    b1: 'Lock key computed the same way the job computes it.',
    b2: 'A bigint key shows up split into classid (high 32 bits) and objid (low 32 bits), with objsubid = 1.',
    b3: 'Result: the PgBouncer connection has held the lock for 19 hours and has just served another route.',
    b4: 'Releases the lock by terminating the backend that holds it (it is idle, no transaction is cut).',
    c1: 'In transaction mode, the reset query does not run between transactions:',
    c2: 'Turning this on is not a fix: the lock would last a single transaction, and the job would lose mutual exclusion while processing.',
    c3: 'Server connection reused for a whole day, carrying along any forgotten session lock.',
    d1: 'Transaction lock: the same connection from start to end, released for sure on COMMIT or ROLLBACK.',
    d2: 'A limit so the whole transaction does not become a forgotten long transaction.',
    d3: 'Another instance holds the lock: end the transaction and leave without an error.',
    d4: 'The task receives the client so all the work stays inside the same transaction.',
    d5: 'If even ROLLBACK failed, the connection is in an unknown state: destroy it instead of returning it to the pool.',
    e1: 'Long job: its own connection, straight to Postgres (port 5432), not through PgBouncer.',
    e2: 'The name shows up in pg_stat_activity and identifies the lock owner during diagnosis.',
    e3: 'The work can use the regular pool: the lock only needs the dedicated connection to stay alive.',
    e4: 'Closing the connection releases any session lock left behind, even if the unlock failed.',
    f1: 'Alternative without an open connection: a lock with an expiration time in a table.',
    f2: 'Acquires if it does not exist or if the previous lock expired; returns a row only when it succeeded.',
    f3: 'Periodic renewal: zero updated rows means the lock was lost and the job must stop.',
    f4: 'Release: only the current owner deletes it.',
  },
  es: {
    a1: 'Job de conciliación: 3 instancias, programado cada 5 minutos, usando el pool compartido.',
    a2: 'Cada pool.query puede caer en una conexión distinta del servidor.',
    a3: 'otra instancia ya está ejecutando la conciliación',
    a4: 'El unlock va a otra conexión: Postgres responde false y solo registra un WARNING.',
    b1: 'Clave del lock calculada de la misma forma que la calcula el job.',
    b2: 'Una clave bigint aparece dividida en classid (32 bits altos) y objid (32 bits bajos), con objsubid = 1.',
    b3: 'Resultado: la conexión de PgBouncer tiene el lock hace 19 horas y acaba de atender otra ruta.',
    b4: 'Libera el lock terminando el backend que lo tiene (está idle, no se corta ninguna transacción).',
    c1: 'En modo transacción, la consulta de reset no se ejecuta entre transacciones:',
    c2: 'Activarlo no lo corrige: el lock duraría una sola transacción y el job perdería la exclusión durante el procesamiento.',
    c3: 'Conexión del servidor reutilizada durante un día entero, llevando consigo cualquier lock de sesión olvidado.',
    d1: 'Lock de transacción: la misma conexión de principio a fin y liberación garantizada en COMMIT o ROLLBACK.',
    d2: 'Un límite para que la transacción completa no se convierta en una transacción larga olvidada.',
    d3: 'Otra instancia tiene el lock: termina la transacción y sale sin error.',
    d4: 'La tarea recibe el client para que todo el trabajo quede dentro de la misma transacción.',
    d5: 'Si ni el ROLLBACK funcionó, la conexión está en un estado desconocido: se descarta en vez de devolverla al pool.',
    e1: 'Job largo: conexión propia, directo a Postgres (puerto 5432), sin pasar por PgBouncer.',
    e2: 'El nombre aparece en pg_stat_activity e identifica al dueño del lock en el diagnóstico.',
    e3: 'El trabajo puede usar el pool normal: el lock solo necesita que la conexión dedicada siga viva.',
    e4: 'Cerrar la conexión libera cualquier lock de sesión que haya quedado, aunque el unlock falle.',
    f1: 'Alternativa sin conexión abierta: un lock con fecha de vencimiento en una tabla.',
    f2: 'Adquiere si no existe o si el lock anterior venció; devuelve una fila solo cuando lo consiguió.',
    f3: 'Renovación periódica: cero filas actualizadas significa que el lock se perdió y el job debe detenerse.',
    f4: 'Liberación: solo el dueño actual lo borra.',
  },
};

const buggyJobCode = (c) => `// ${c.a1}
// ${c.a2}
const CHAVE = 'job:conciliacao';

export async function conciliar(pool) {
  const { rows } = await pool.query(
    'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS obtida',
    [CHAVE],
  );
  if (!rows[0].obtida) {
    console.info('${c.a3}');
    return;
  }
  try {
    await processarLote(pool);
  } finally {
    // ${c.a4}
    await pool.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [CHAVE]);
  }
}

// Postgres log:
// WARNING:  you don't own a lock of type ExclusiveLock`;

const diagnosticCode = (c) => `-- ${c.b1}
-- ${c.b2}
WITH alvo AS (SELECT hashtextextended('job:conciliacao', 0) AS k)
SELECT l.pid,
       l.granted,
       a.client_addr,
       a.state,
       now() - a.backend_start AS idade_conexao,
       now() - a.state_change  AS parado_ha,
       left(a.query, 50)       AS ultima_consulta
  FROM pg_locks l
  JOIN pg_stat_activity a ON a.pid = l.pid
 CROSS JOIN alvo
 WHERE l.locktype = 'advisory'
   AND l.objsubid = 1
   AND l.classid::bigint = (alvo.k >> 32) & 4294967295
   AND l.objid::bigint   = alvo.k & 4294967295;

  pid  | granted | client_addr | state | idade_conexao | parado_ha | ultima_consulta
-------+---------+-------------+-------+---------------+-----------+---------------------------------
 48121 | t       | 10.0.3.7    | idle  | 19:42:10      | 00:00:02  | SELECT id, status FROM pedidos W
-- ${c.b3}

-- ${c.b4}
SELECT pg_terminate_backend(48121);`;

const pgbouncerCode = (c) => `[pgbouncer]
pool_mode = transaction

; ${c.c1}
server_reset_query = DISCARD ALL
server_reset_query_always = 0
; ${c.c2}

; ${c.c3}
server_lifetime = 86400`;

const xactLockCode = (c) => `import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

// ${c.d1}
export async function executarComTrava(nome, tarefa) {
  const client = await pool.connect();
  let descartar = false;
  try {
    await client.query('BEGIN');
    // ${c.d2}
    await client.query("SET LOCAL statement_timeout = '10min'");
    const { rows } = await client.query(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS obtida',
      [nome],
    );
    if (!rows[0].obtida) {
      // ${c.d3}
      await client.query('ROLLBACK');
      return { executou: false };
    }
    // ${c.d4}
    const resultado = await tarefa(client);
    await client.query('COMMIT');
    return { executou: true, resultado };
  } catch (erro) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ${c.d5}
      descartar = true;
    }
    throw erro;
  } finally {
    client.release(descartar);
  }
}

// uso / usage / uso:
// await executarComTrava('job:conciliacao', (client) => processarLote(client));`;

const dedicatedConnectionCode = (c) => `import pg from 'pg';

// ${c.e1}
export async function executarComTravaDeSessao(nome, tarefa) {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL_DIRETA,
    keepAlive: true,
    // ${c.e2}
    application_name: 'trava:' + nome,
  });
  await client.connect();
  try {
    const { rows } = await client.query(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS obtida',
      [nome],
    );
    if (!rows[0].obtida) return { executou: false };
    try {
      // ${c.e3}
      return { executou: true, resultado: await tarefa() };
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [nome]);
    }
  } finally {
    // ${c.e4}
    await client.end();
  }
}`;

const leaseCode = (c) => `-- ${c.f1}
CREATE TABLE travas_job (
  nome      text PRIMARY KEY,
  dono      text NOT NULL,
  expira_em timestamptz NOT NULL
);

-- ${c.f2}
INSERT INTO travas_job (nome, dono, expira_em)
VALUES ($1, $2, now() + interval '2 minutes')
ON CONFLICT (nome) DO UPDATE
   SET dono = EXCLUDED.dono, expira_em = EXCLUDED.expira_em
 WHERE travas_job.expira_em < now()
RETURNING dono;

-- ${c.f3}
UPDATE travas_job
   SET expira_em = now() + interval '2 minutes'
 WHERE nome = $1 AND dono = $2;

-- ${c.f4}
DELETE FROM travas_job WHERE nome = $1 AND dono = $2;`;

const pt = {
  intro:
    'Uma plataforma de cobrança rodava a conciliação de pagamentos a cada 5 minutos, em 3 instâncias, e usava pg_try_advisory_lock para garantir que só uma delas processasse o lote. Funcionou por dois anos. Na semana em que o time colocou o PgBouncer em modo transação na frente do Postgres, para parar de esgotar conexões nos picos, a conciliação simplesmente parou: durante 19 horas todas as execuções registraram "outra instância já está rodando" e saíram sem erro, enquanto 11 mil pagamentos ficavam pendentes. Nenhuma instância estava rodando. A trava estava presa numa conexão do servidor que o PgBouncer continuava entregando, a cada poucos segundos, para requisições da API que nem sabiam que seguravam a chave. Dois dias depois, já com a trava liberada à mão, apareceu o defeito oposto: duas instâncias processaram o mesmo lote ao mesmo tempo. Este artigo explica por que advisory lock de sessão e pool de conexões não combinam, o que o PgBouncer faz com o estado da sessão, como encontrar quem segura a trava e como escolher entre trava de transação, conexão dedicada e lease em tabela.',
  sections: [
    {
      title: 'O job que parou de rodar sem nenhum erro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O código do job era curto e parecia correto: tentar a trava, sair se outra instância a tivesse, processar e liberar num finally. O detalhe que mudou tudo é que as duas chamadas usavam pool.query, e cada pool.query pega qualquer conexão livre. Antes do PgBouncer, o pool do node-postgres com poucas conexões quase sempre devolvia a mesma, e quando não devolvia a conexão ociosa era fechada em 10 segundos, levando a trava junto. O problema existia, mas se curava sozinho.',
        },
        { type: 'code', value: buggyJobCode(comments.pt) },
        {
          type: 'paragraph',
          value:
            'Com o PgBouncer em modo transação, cada comando fora de BEGIN é uma transação, e cada transação pode ser atendida por uma conexão diferente do servidor. A trava foi obtida na conexão S1; o unlock foi executado na S2. O Postgres respondeu false, registrou um WARNING que ninguém monitorava e a função retornou normalmente. A S1 voltou ao pool segurando a chave, e como o time tinha subido server_lifetime para 24 horas para evitar reconexões, ela continuou viva e ocupada atendendo a API.',
        },
        {
          type: 'list',
          items: [
            'Sintoma 1: o job sai sem erro em todas as instâncias, com a mensagem de que outra está rodando.',
            'Sintoma 2: pg_locks mostra uma trava advisory concedida a um backend idle que roda consultas de outras rotas.',
            'Sintoma 3, mais raro e pior: duas instâncias processando o mesmo lote, porque a trava é reentrante dentro da mesma sessão.',
          ],
        },
      ],
    },
    {
      title: 'Advisory lock de sessão não conhece a transação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O Postgres oferece dois níveis de advisory lock. O de sessão, obtido com pg_advisory_lock ou pg_try_advisory_lock, pertence à conexão: sobrevive a COMMIT e ROLLBACK e só é liberado por pg_advisory_unlock na mesma sessão ou quando a conexão termina. O de transação, com pg_advisory_xact_lock ou pg_try_advisory_xact_lock, pertence à transação e some no fim dela; não existe função de unlock para ele.',
        },
        {
          type: 'table',
          columns: ['Função', 'Duração', 'Liberada por', 'Se a chave está ocupada', 'Seguro com PgBouncer em modo transação'],
          rows: [
            ['pg_advisory_lock(k)', 'Sessão', 'pg_advisory_unlock na mesma sessão ou fim da conexão', 'Espera, limitado só por lock_timeout', 'Não'],
            ['pg_try_advisory_lock(k)', 'Sessão', 'pg_advisory_unlock na mesma sessão ou fim da conexão', 'Devolve false na hora', 'Não'],
            ['pg_advisory_xact_lock(k)', 'Transação', 'COMMIT ou ROLLBACK', 'Espera, limitado só por lock_timeout', 'Sim'],
            ['pg_try_advisory_xact_lock(k)', 'Transação', 'COMMIT ou ROLLBACK', 'Devolve false na hora', 'Sim'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Duas propriedades da trava de sessão explicam os dois defeitos. A primeira: pg_advisory_unlock chamado numa sessão que não tem a trava não é erro, é false com WARNING, então o código não percebe que nada foi liberado. A segunda: a trava é reentrante e contada. Se a mesma sessão chamar pg_try_advisory_lock duas vezes, as duas retornam true e são necessários dois unlocks. Isso foi feito para código que aninha chamadas, mas atrás de um pooler significa que qualquer cliente que cair na conexão que já segura a chave também a obtém.',
        },
      ],
    },
    {
      title: 'O que o PgBouncer em modo transação faz com a trava',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No modo transação, a conexão do servidor fica com o cliente só enquanto a transação dura. No COMMIT, ela volta ao pool e o próximo cliente que abrir uma transação pode recebê-la. Tudo que é estado de sessão vai junto: SET sem LOCAL, prepared statements nomeados, tabelas temporárias e advisory locks de sessão. O diagrama mostra a sequência do incidente.',
        },
        {
          type: 'diagram',
          value: `instância 1 (job)            PgBouncer           conexões do servidor
------------------           ---------           --------------------
pg_try_advisory_lock(k)  ----------------------> S1   true  (S1 segura k, contador 1)
processa o lote ...
pg_advisory_unlock(k)    ----------------------> S2   false + WARNING (S2 não tem k)

API: BEGIN ... COMMIT    ----------------------> S1   cliente qualquer herda k sem saber

instância 2, 5 min depois:
pg_try_advisory_lock(k)  ----------------------> S3   false  "outra instância já está rodando"

instância 3, outro dia:
pg_try_advisory_lock(k)  ----------------------> S1   true   (mesma sessão, contador 2)
instância 1, ao mesmo tempo:
pg_try_advisory_lock(k)  ----------------------> S1   true   (contador 3: dois jobs juntos)`,
        },
        {
          type: 'paragraph',
          value:
            'O PgBouncer tem uma consulta de reset, por padrão DISCARD ALL, que inclui pg_advisory_unlock_all. Mas em modo transação ela só roda se server_reset_query_always estiver ligado, e ligar isso não resolve: a trava passaria a ser liberada no fim de cada transação, ou seja, logo depois do pg_try_advisory_lock, e o job processaria o lote sem exclusão nenhuma. No modo sessão a consulta de reset roda quando o cliente desconecta, o que libera a trava, mas o pool da aplicação continua podendo mandar lock e unlock por conexões diferentes.',
        },
        { type: 'code', value: pgbouncerCode(comments.pt) },
        {
          type: 'table',
          columns: ['Configuração', 'Onde a trava de sessão fica', 'Quando é liberada se o unlock falhar'],
          rows: [
            ['pool.query do node-postgres direto no Postgres', 'Numa conexão qualquer do pool da aplicação', 'Quando a conexão fica ociosa por idleTimeoutMillis (10 s por padrão) ou nunca, se o pool está sempre ocupado'],
            ['PgBouncer em modo sessão', 'Na conexão do servidor ligada ao cliente', 'Quando o cliente desconecta e o DISCARD ALL roda'],
            ['PgBouncer em modo transação', 'Na conexão do servidor que atendeu aquela transação', 'Só quando o PgBouncer fecha a conexão do servidor, por server_lifetime ou server_idle_timeout'],
            ['Conexão dedicada direta (pg.Client)', 'Na sessão do próprio job', 'No unlock ou quando o job encerra a conexão'],
          ],
        },
      ],
    },
    {
      title: 'Encontrar quem segura a chave',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A trava aparece em pg_locks com locktype advisory. Uma chave bigint é dividida em duas colunas de 32 bits, classid e objid, com objsubid igual a 1; a forma com dois inteiros usa objsubid igual a 2. Calcular a chave no próprio SQL, do mesmo jeito que o job calcula, evita conferir números à mão. O cruzamento com pg_stat_activity é o que entrega o diagnóstico.',
        },
        { type: 'code', value: diagnosticCode(comments.pt) },
        {
          type: 'paragraph',
          value:
            'Três colunas contam a história. client_addr é o endereço do PgBouncer, não de uma instância do job. idade_conexao é de horas, mas parado_ha é de segundos, porque a conexão é reutilizada o tempo todo. E ultima_consulta é de outra rota da aplicação. Uma trava de sessão segura por um backend nessas condições é um vazamento, não um job em andamento. Encerrar esse backend com pg_terminate_backend libera a trava; o PgBouncer detecta a conexão encerrada e abre outra. Como o estado é idle, nenhuma transação é cortada, mas confira isso antes, porque se estiver active a requisição em curso recebe erro.',
        },
        {
          type: 'list',
          items: [
            'Alerta útil: trava advisory concedida a backend com state idle há mais tempo que a duração máxima do job.',
            'Outro sinal barato: contar no log do Postgres o WARNING you don\'t own a lock of type ExclusiveLock. Ele só aparece quando um unlock foi para a sessão errada.',
            'Dê application_name às conexões dos jobs. Atrás do PgBouncer em modo transação, o nome que aparece é o da primeira conexão, o que já indica que a trava não está onde deveria.',
          ],
        },
      ],
    },
    {
      title: 'A correção padrão: trava de transação na mesma conexão',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Para a maioria dos jobs, a correção é trocar a trava de sessão por pg_try_advisory_xact_lock e fazer o trabalho dentro da mesma transação, num client obtido com pool.connect. A trava passa a ter a mesma vida da transação: COMMIT ou ROLLBACK a liberam, e se o processo morrer a conexão cai, a transação é desfeita e a trava some. Funciona igual com ou sem PgBouncer, porque em modo transação a conexão do servidor fica presa ao cliente justamente até o fim da transação.',
        },
        { type: 'code', value: xactLockCode(comments.pt) },
        {
          type: 'paragraph',
          value:
            'Dois cuidados. O primeiro é que o trabalho precisa usar o client recebido; se a tarefa chamar pool.query, ela roda fora da transação e fora da proteção. O segundo é o custo: o job vira uma transação aberta pelo tempo do processamento. Para alguns segundos ou poucos minutos isso é aceitável, e statement_timeout com SET LOCAL limita o pior caso. Para dezenas de minutos, uma transação longa segura o horizonte do vacuum, prende locks de linha e ocupa uma conexão do pool, e aí vale uma das alternativas da próxima seção.',
        },
      ],
    },
    {
      title: 'Jobs longos: conexão dedicada ou lease em tabela',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando o job leva muito tempo e não deve rodar numa única transação, a trava de sessão continua sendo uma boa ferramenta, desde que a sessão seja do job. Uma conexão própria, aberta direto no Postgres, sem PgBouncer, segura a trava enquanto o trabalho roda com o pool normal. O fim da conexão é a garantia final: se o processo morrer, o Postgres encerra a sessão e libera a trava. Para quedas de rede em que o processo some sem fechar o socket, configure keepAlive no cliente e tcp_keepalives_idle no servidor, senão o backend pode ficar vivo esperando um cliente que não existe mais.',
        },
        { type: 'code', value: dedicatedConnectionCode(comments.pt) },
        {
          type: 'paragraph',
          value:
            'Quando não há acesso direto ao Postgres, como em alguns serviços gerenciados que só expõem o pooler, ou quando o job atravessa vários processos, a saída é uma trava em tabela com prazo de validade. Ela não depende de conexão aberta, sobrevive a qualquer pooler e expira sozinha se o dono morrer. Em troca, o job precisa renovar o prazo enquanto trabalha e parar se a renovação falhar.',
        },
        { type: 'code', value: leaseCode(comments.pt) },
        {
          type: 'ordered',
          items: [
            'Liste os pontos que usam pg_advisory_lock ou pg_try_advisory_lock e verifique se lock e unlock passam pela mesma conexão.',
            'Troque por pg_try_advisory_xact_lock os jobs que cabem numa transação curta.',
            'Mova os jobs longos para uma conexão dedicada direta ou para lease em tabela com renovação.',
            'Alerte sobre travas advisory concedidas a backends idle e sobre o WARNING de unlock na sessão errada.',
            'Antes de mudar o pool_mode do PgBouncer, procure também SET de sessão, prepared statements nomeados e tabelas temporárias: todos quebram pelo mesmo motivo.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Posso usar pg_advisory_xact_lock num job que leva 40 minutos?',
      answer:
        'Funciona, mas o custo aparece em outro lugar. Uma transação aberta por 40 minutos impede o vacuum de limpar tuplas mortas geradas depois do seu início em todo o banco, segura os locks de linha que o job pegar e mantém uma conexão ocupada. Para jobs desse tamanho, prefira uma conexão dedicada com trava de sessão, ou lease em tabela, e processe em lotes com commits curtos.',
    },
    {
      question: 'Como escolher a chave de um advisory lock?',
      answer:
        'As chaves são globais no banco, então dois sistemas que usam o mesmo número se bloqueiam sem saber. Use um nome legível com prefixo do domínio, como job:conciliacao, e converta com hashtextextended(nome, 0), que gera um bigint e torna colisões improváveis. Evite hashtext, que tem só 32 bits. Se quiser separar por espaço de nomes, a forma com dois inteiros, pg_try_advisory_xact_lock(classe, id), deixa a primeira chave para o tipo de recurso.',
    },
    {
      question: 'Em modo sessão do PgBouncer, ou sem PgBouncer, o problema desaparece?',
      answer:
        'Diminui, mas não desaparece. Sem o pooler na frente, o pool da própria aplicação ainda pode mandar lock e unlock por conexões diferentes, como no pool.query do exemplo. A trava presa dura menos porque a conexão ociosa é fechada, mas sob carga constante ela pode nunca ficar ociosa. A regra vale em qualquer arquitetura: trava de sessão só com uma conexão obtida explicitamente e usada do lock ao unlock.',
    },
  ],
  conclusion: {
    title: 'A trava vive onde a sessão vive',
    description:
      'Advisory lock de sessão pertence à conexão, não ao processo nem à transação. Atrás de um pool, e principalmente do PgBouncer em modo transação, essa conexão passa de mão em mão, e a trava vai junto: o unlock falha em silêncio, o job para de rodar e, por ser reentrante, outro cliente pode obter a mesma chave. Trava de transação na mesma conexão resolve a maioria dos casos; conexão dedicada direta ou lease em tabela cobrem os jobs longos. E vale procurar travas concedidas a backends idle antes que a fila de pendências avise por você.',
    cta: 'Quer revisar jobs, travas e a configuração do pool antes de colocar o PgBouncer em modo transação?',
  },
  related: [
    {
      label: 'Job agendado que roda duas vezes: exclusão mútua distribuída sem trava eterna',
      to: '/blog/job-agendado-que-roda-duas-vezes-exclusao-mutua-distribuida-sem-trava-eterna',
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
    'A billing platform ran payment reconciliation every 5 minutes, on 3 instances, and used pg_try_advisory_lock to make sure only one of them processed each batch. It worked for two years. The week the team put PgBouncer in transaction mode in front of Postgres, to stop running out of connections during peaks, reconciliation simply stopped: for 19 hours every run logged "another instance is already running" and exited without an error, while 11 thousand payments piled up as pending. No instance was running. The lock was stuck on a server connection that PgBouncer kept handing out, every few seconds, to API requests that had no idea they were holding the key. Two days later, with the lock already released by hand, the opposite defect showed up: two instances processed the same batch at the same time. This article explains why session advisory locks and connection pools do not mix, what PgBouncer does with session state, how to find who holds the lock and how to choose between a transaction lock, a dedicated connection and a lease in a table.',
  sections: [
    {
      title: 'The job that stopped running without a single error',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The job code was short and looked correct: try the lock, leave if another instance had it, process and release in a finally. The detail that changed everything is that both calls used pool.query, and each pool.query takes any free connection. Before PgBouncer, the node-postgres pool with few connections almost always handed back the same one, and when it did not, the idle connection was closed after 10 seconds, taking the lock with it. The problem existed, but it healed itself.',
        },
        { type: 'code', value: buggyJobCode(comments.en) },
        {
          type: 'paragraph',
          value:
            'With PgBouncer in transaction mode, each statement outside a BEGIN is a transaction, and each transaction may be served by a different server connection. The lock was acquired on connection S1; the unlock ran on S2. Postgres answered false, logged a WARNING nobody monitored, and the function returned normally. S1 went back to the pool holding the key, and since the team had raised server_lifetime to 24 hours to avoid reconnections, it stayed alive and busy serving the API.',
        },
        {
          type: 'list',
          items: [
            'Symptom 1: the job exits without an error on every instance, saying another one is running.',
            'Symptom 2: pg_locks shows an advisory lock granted to an idle backend that runs queries from other routes.',
            'Symptom 3, rarer and worse: two instances processing the same batch, because the lock is reentrant within the same session.',
          ],
        },
      ],
    },
    {
      title: 'A session advisory lock knows nothing about the transaction',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Postgres offers two levels of advisory lock. The session level, acquired with pg_advisory_lock or pg_try_advisory_lock, belongs to the connection: it survives COMMIT and ROLLBACK and is only released by pg_advisory_unlock in the same session or when the connection ends. The transaction level, with pg_advisory_xact_lock or pg_try_advisory_xact_lock, belongs to the transaction and disappears when it ends; there is no unlock function for it.',
        },
        {
          type: 'table',
          columns: ['Function', 'Lifetime', 'Released by', 'If the key is taken', 'Safe with PgBouncer in transaction mode'],
          rows: [
            ['pg_advisory_lock(k)', 'Session', 'pg_advisory_unlock in the same session or end of the connection', 'Waits, bounded only by lock_timeout', 'No'],
            ['pg_try_advisory_lock(k)', 'Session', 'pg_advisory_unlock in the same session or end of the connection', 'Returns false immediately', 'No'],
            ['pg_advisory_xact_lock(k)', 'Transaction', 'COMMIT or ROLLBACK', 'Waits, bounded only by lock_timeout', 'Yes'],
            ['pg_try_advisory_xact_lock(k)', 'Transaction', 'COMMIT or ROLLBACK', 'Returns false immediately', 'Yes'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Two properties of the session lock explain both defects. First: pg_advisory_unlock called in a session that does not hold the lock is not an error, it is false plus a WARNING, so the code never notices that nothing was released. Second: the lock is reentrant and counted. If the same session calls pg_try_advisory_lock twice, both calls return true and two unlocks are needed. That was designed for code that nests calls, but behind a pooler it means any client that lands on the connection already holding the key also gets it.',
        },
      ],
    },
    {
      title: 'What PgBouncer in transaction mode does with the lock',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In transaction mode, the server connection stays with the client only for the duration of the transaction. On COMMIT, it goes back to the pool and the next client that opens a transaction may get it. Everything that is session state goes along: SET without LOCAL, named prepared statements, temporary tables and session advisory locks. The diagram shows the sequence of the incident.',
        },
        {
          type: 'diagram',
          value: `instance 1 (job)             PgBouncer           server connections
----------------             ---------           ------------------
pg_try_advisory_lock(k)  ----------------------> S1   true  (S1 holds k, count 1)
processes the batch ...
pg_advisory_unlock(k)    ----------------------> S2   false + WARNING (S2 does not hold k)

API: BEGIN ... COMMIT    ----------------------> S1   some client inherits k unknowingly

instance 2, 5 min later:
pg_try_advisory_lock(k)  ----------------------> S3   false  "another instance is already running"

instance 3, another day:
pg_try_advisory_lock(k)  ----------------------> S1   true   (same session, count 2)
instance 1, at the same time:
pg_try_advisory_lock(k)  ----------------------> S1   true   (count 3: two jobs at once)`,
        },
        {
          type: 'paragraph',
          value:
            'PgBouncer has a reset query, DISCARD ALL by default, which includes pg_advisory_unlock_all. But in transaction mode it only runs if server_reset_query_always is enabled, and enabling it does not solve anything: the lock would be released at the end of every transaction, that is, right after pg_try_advisory_lock, and the job would process the batch with no mutual exclusion at all. In session mode the reset query runs when the client disconnects, which releases the lock, but the application pool can still send lock and unlock over different connections.',
        },
        { type: 'code', value: pgbouncerCode(comments.en) },
        {
          type: 'table',
          columns: ['Setup', 'Where the session lock lives', 'When it is released if the unlock fails'],
          rows: [
            ['node-postgres pool.query straight to Postgres', 'On any connection of the application pool', 'When the connection stays idle for idleTimeoutMillis (10 s by default), or never if the pool is always busy'],
            ['PgBouncer in session mode', 'On the server connection bound to the client', 'When the client disconnects and DISCARD ALL runs'],
            ['PgBouncer in transaction mode', 'On the server connection that served that transaction', 'Only when PgBouncer closes the server connection, through server_lifetime or server_idle_timeout'],
            ['Dedicated direct connection (pg.Client)', 'On the job\'s own session', 'On unlock or when the job closes the connection'],
          ],
        },
      ],
    },
    {
      title: 'Finding who holds the key',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The lock shows up in pg_locks with locktype advisory. A bigint key is split into two 32 bit columns, classid and objid, with objsubid equal to 1; the two integer form uses objsubid equal to 2. Computing the key in SQL itself, the same way the job does, avoids checking numbers by hand. Joining with pg_stat_activity is what gives you the diagnosis.',
        },
        { type: 'code', value: diagnosticCode(comments.en) },
        {
          type: 'paragraph',
          value:
            'Three columns tell the story. client_addr is the PgBouncer address, not a job instance. idade_conexao (connection age) is hours, but parado_ha (idle for) is seconds, because the connection is reused all the time. And ultima_consulta (last query) comes from another route of the application. A session lock held by a backend in that state is a leak, not a running job. Terminating that backend with pg_terminate_backend releases the lock; PgBouncer notices the closed connection and opens a new one. Since the state is idle, no transaction is cut, but check it first, because if it is active the request in flight gets an error.',
        },
        {
          type: 'list',
          items: [
            'Useful alert: an advisory lock granted to a backend whose state has been idle longer than the maximum job duration.',
            'Another cheap signal: count the WARNING you don\'t own a lock of type ExclusiveLock in the Postgres log. It only shows up when an unlock went to the wrong session.',
            'Give job connections an application_name. Behind PgBouncer in transaction mode, the name you see is the one from the first connection, which already tells you the lock is not where it should be.',
          ],
        },
      ],
    },
    {
      title: 'The default fix: a transaction lock on the same connection',
      blocks: [
        {
          type: 'paragraph',
          value:
            'For most jobs, the fix is to replace the session lock with pg_try_advisory_xact_lock and do the work inside the same transaction, on a client obtained with pool.connect. The lock now has the same lifetime as the transaction: COMMIT or ROLLBACK release it, and if the process dies the connection drops, the transaction is rolled back and the lock is gone. It works the same with or without PgBouncer, because in transaction mode the server connection is bound to the client precisely until the transaction ends.',
        },
        { type: 'code', value: xactLockCode(comments.en) },
        {
          type: 'paragraph',
          value:
            'Two caveats. First, the work must use the client it receives; if the task calls pool.query, it runs outside the transaction and outside the protection. Second, the cost: the job becomes a transaction left open for the whole processing time. For a few seconds or a few minutes that is acceptable, and statement_timeout with SET LOCAL bounds the worst case. For tens of minutes, a long transaction holds back the vacuum horizon, keeps row locks and ties up a pool connection, and then one of the alternatives in the next section is worth it.',
        },
      ],
    },
    {
      title: 'Long jobs: a dedicated connection or a lease in a table',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When the job takes a long time and should not run in a single transaction, the session lock is still a good tool, as long as the session belongs to the job. A connection of its own, opened straight to Postgres, without PgBouncer, holds the lock while the work runs on the regular pool. The end of the connection is the final guarantee: if the process dies, Postgres ends the session and releases the lock. For network failures where the process disappears without closing the socket, set keepAlive on the client and tcp_keepalives_idle on the server, otherwise the backend may stay alive waiting for a client that no longer exists.',
        },
        { type: 'code', value: dedicatedConnectionCode(comments.en) },
        {
          type: 'paragraph',
          value:
            'When there is no direct access to Postgres, as with some managed services that only expose the pooler, or when the job spans several processes, the way out is a lock in a table with an expiration time. It does not depend on an open connection, survives any pooler and expires on its own if the owner dies. In exchange, the job must renew the expiration while it works and stop if the renewal fails.',
        },
        { type: 'code', value: leaseCode(comments.en) },
        {
          type: 'ordered',
          items: [
            'List the places that use pg_advisory_lock or pg_try_advisory_lock and check whether lock and unlock go through the same connection.',
            'Switch to pg_try_advisory_xact_lock the jobs that fit in a short transaction.',
            'Move long jobs to a dedicated direct connection or to a lease in a table with renewal.',
            'Alert on advisory locks granted to idle backends and on the WARNING for an unlock in the wrong session.',
            'Before changing the PgBouncer pool_mode, also look for session SET, named prepared statements and temporary tables: they all break for the same reason.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can I use pg_advisory_xact_lock in a job that takes 40 minutes?',
      answer:
        'It works, but the cost shows up elsewhere. A transaction open for 40 minutes prevents vacuum from cleaning dead tuples created after it started across the whole database, holds the row locks the job takes and keeps a connection busy. For jobs of that size, prefer a dedicated connection with a session lock, or a lease in a table, and process in batches with short commits.',
    },
    {
      question: 'How should I choose the key of an advisory lock?',
      answer:
        'Keys are global to the database, so two systems using the same number block each other without knowing it. Use a readable name with a domain prefix, such as job:conciliacao, and convert it with hashtextextended(name, 0), which produces a bigint and makes collisions unlikely. Avoid hashtext, which has only 32 bits. If you want namespaces, the two integer form, pg_try_advisory_xact_lock(class, id), leaves the first key for the resource type.',
    },
    {
      question: 'In PgBouncer session mode, or without PgBouncer, does the problem go away?',
      answer:
        'It shrinks, but it does not go away. Without a pooler in front, the application pool itself can still send lock and unlock over different connections, as with pool.query in the example. The stuck lock lasts less because the idle connection gets closed, but under constant load it may never become idle. The rule holds in any architecture: session locks only on a connection obtained explicitly and used from lock to unlock.',
    },
  ],
  conclusion: {
    title: 'The lock lives where the session lives',
    description:
      'A session advisory lock belongs to the connection, not to the process or the transaction. Behind a pool, and especially behind PgBouncer in transaction mode, that connection changes hands, and the lock goes with it: the unlock fails silently, the job stops running and, because the lock is reentrant, another client can get the same key. A transaction lock on the same connection solves most cases; a dedicated direct connection or a lease in a table covers long jobs. And it pays to look for locks granted to idle backends before the pending queue tells you about them.',
    cta: 'Want to review jobs, locks and pool settings before putting PgBouncer in transaction mode?',
  },
  related: [
    {
      label: 'The scheduled job that runs twice: distributed mutual exclusion without a lock held forever',
      to: '/blog/job-agendado-que-roda-duas-vezes-exclusao-mutua-distribuida-sem-trava-eterna',
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
    'Una plataforma de cobros ejecutaba la conciliación de pagos cada 5 minutos, en 3 instancias, y usaba pg_try_advisory_lock para garantizar que solo una de ellas procesara cada lote. Funcionó durante dos años. La semana en que el equipo puso PgBouncer en modo transacción delante de Postgres, para dejar de agotar conexiones en los picos, la conciliación simplemente se detuvo: durante 19 horas todas las ejecuciones registraron "otra instancia ya está ejecutando la conciliación" y salieron sin error, mientras 11 mil pagos quedaban pendientes. Ninguna instancia se estaba ejecutando. El lock estaba atrapado en una conexión del servidor que PgBouncer seguía entregando, cada pocos segundos, a peticiones de la API que ni sabían que tenían la clave. Dos días después, con el lock ya liberado a mano, apareció el defecto opuesto: dos instancias procesaron el mismo lote al mismo tiempo. Este artículo explica por qué el advisory lock de sesión y el pool de conexiones no combinan, qué hace PgBouncer con el estado de la sesión, cómo encontrar a quien tiene el lock y cómo elegir entre lock de transacción, conexión dedicada y lease en una tabla.',
  sections: [
    {
      title: 'El job que dejó de ejecutarse sin ningún error',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El código del job era corto y parecía correcto: intentar el lock, salir si otra instancia lo tenía, procesar y liberar en un finally. El detalle que lo cambió todo es que las dos llamadas usaban pool.query, y cada pool.query toma cualquier conexión libre. Antes de PgBouncer, el pool de node-postgres con pocas conexiones casi siempre devolvía la misma, y cuando no, la conexión ociosa se cerraba a los 10 segundos y se llevaba el lock. El problema existía, pero se curaba solo.',
        },
        { type: 'code', value: buggyJobCode(comments.es) },
        {
          type: 'paragraph',
          value:
            'Con PgBouncer en modo transacción, cada comando fuera de un BEGIN es una transacción, y cada transacción puede ser atendida por una conexión distinta del servidor. El lock se obtuvo en la conexión S1; el unlock se ejecutó en S2. Postgres respondió false, registró un WARNING que nadie monitoreaba y la función terminó con normalidad. S1 volvió al pool con la clave, y como el equipo había subido server_lifetime a 24 horas para evitar reconexiones, siguió viva y ocupada atendiendo a la API.',
        },
        {
          type: 'list',
          items: [
            'Síntoma 1: el job sale sin error en todas las instancias, con el mensaje de que otra se está ejecutando.',
            'Síntoma 2: pg_locks muestra un advisory lock concedido a un backend idle que ejecuta consultas de otras rutas.',
            'Síntoma 3, más raro y peor: dos instancias procesando el mismo lote, porque el lock es reentrante dentro de la misma sesión.',
          ],
        },
      ],
    },
    {
      title: 'El advisory lock de sesión no conoce la transacción',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Postgres ofrece dos niveles de advisory lock. El de sesión, obtenido con pg_advisory_lock o pg_try_advisory_lock, pertenece a la conexión: sobrevive a COMMIT y ROLLBACK y solo se libera con pg_advisory_unlock en la misma sesión o cuando la conexión termina. El de transacción, con pg_advisory_xact_lock o pg_try_advisory_xact_lock, pertenece a la transacción y desaparece al terminarla; no existe función de unlock para él.',
        },
        {
          type: 'table',
          columns: ['Función', 'Duración', 'Liberado por', 'Si la clave está ocupada', 'Seguro con PgBouncer en modo transacción'],
          rows: [
            ['pg_advisory_lock(k)', 'Sesión', 'pg_advisory_unlock en la misma sesión o fin de la conexión', 'Espera, limitado solo por lock_timeout', 'No'],
            ['pg_try_advisory_lock(k)', 'Sesión', 'pg_advisory_unlock en la misma sesión o fin de la conexión', 'Devuelve false al instante', 'No'],
            ['pg_advisory_xact_lock(k)', 'Transacción', 'COMMIT o ROLLBACK', 'Espera, limitado solo por lock_timeout', 'Sí'],
            ['pg_try_advisory_xact_lock(k)', 'Transacción', 'COMMIT o ROLLBACK', 'Devuelve false al instante', 'Sí'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Dos propiedades del lock de sesión explican los dos defectos. La primera: pg_advisory_unlock llamado en una sesión que no tiene el lock no es un error, es false con un WARNING, así que el código no se entera de que no liberó nada. La segunda: el lock es reentrante y se cuenta. Si la misma sesión llama dos veces a pg_try_advisory_lock, ambas devuelven true y hacen falta dos unlocks. Eso se pensó para código que anida llamadas, pero detrás de un pooler significa que cualquier cliente que caiga en la conexión que ya tiene la clave también la obtiene.',
        },
      ],
    },
    {
      title: 'Qué hace PgBouncer en modo transacción con el lock',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En modo transacción, la conexión del servidor queda con el cliente solo mientras dura la transacción. En el COMMIT vuelve al pool y el próximo cliente que abra una transacción puede recibirla. Todo lo que es estado de sesión viaja con ella: SET sin LOCAL, prepared statements con nombre, tablas temporales y advisory locks de sesión. El diagrama muestra la secuencia del incidente.',
        },
        {
          type: 'diagram',
          value: `instancia 1 (job)            PgBouncer           conexiones del servidor
-----------------            ---------           -----------------------
pg_try_advisory_lock(k)  ----------------------> S1   true  (S1 tiene k, contador 1)
procesa el lote ...
pg_advisory_unlock(k)    ----------------------> S2   false + WARNING (S2 no tiene k)

API: BEGIN ... COMMIT    ----------------------> S1   un cliente cualquiera hereda k sin saberlo

instancia 2, 5 min después:
pg_try_advisory_lock(k)  ----------------------> S3   false  "otra instancia ya está ejecutando"

instancia 3, otro día:
pg_try_advisory_lock(k)  ----------------------> S1   true   (misma sesión, contador 2)
instancia 1, al mismo tiempo:
pg_try_advisory_lock(k)  ----------------------> S1   true   (contador 3: dos jobs a la vez)`,
        },
        {
          type: 'paragraph',
          value:
            'PgBouncer tiene una consulta de reset, DISCARD ALL por defecto, que incluye pg_advisory_unlock_all. Pero en modo transacción solo se ejecuta si server_reset_query_always está activado, y activarlo no resuelve nada: el lock se liberaría al final de cada transacción, es decir, justo después de pg_try_advisory_lock, y el job procesaría el lote sin ninguna exclusión. En modo sesión la consulta de reset se ejecuta cuando el cliente se desconecta, lo que libera el lock, pero el pool de la aplicación todavía puede enviar lock y unlock por conexiones distintas.',
        },
        { type: 'code', value: pgbouncerCode(comments.es) },
        {
          type: 'table',
          columns: ['Configuración', 'Dónde queda el lock de sesión', 'Cuándo se libera si el unlock falla'],
          rows: [
            ['pool.query de node-postgres directo a Postgres', 'En cualquier conexión del pool de la aplicación', 'Cuando la conexión queda ociosa durante idleTimeoutMillis (10 s por defecto), o nunca si el pool siempre está ocupado'],
            ['PgBouncer en modo sesión', 'En la conexión del servidor asociada al cliente', 'Cuando el cliente se desconecta y se ejecuta DISCARD ALL'],
            ['PgBouncer en modo transacción', 'En la conexión del servidor que atendió esa transacción', 'Solo cuando PgBouncer cierra la conexión del servidor, por server_lifetime o server_idle_timeout'],
            ['Conexión dedicada directa (pg.Client)', 'En la sesión del propio job', 'En el unlock o cuando el job cierra la conexión'],
          ],
        },
      ],
    },
    {
      title: 'Encontrar quién tiene la clave',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El lock aparece en pg_locks con locktype advisory. Una clave bigint se divide en dos columnas de 32 bits, classid y objid, con objsubid igual a 1; la forma con dos enteros usa objsubid igual a 2. Calcular la clave en el propio SQL, igual que la calcula el job, evita revisar números a mano. El cruce con pg_stat_activity es lo que entrega el diagnóstico.',
        },
        { type: 'code', value: diagnosticCode(comments.es) },
        {
          type: 'paragraph',
          value:
            'Tres columnas cuentan la historia. client_addr es la dirección de PgBouncer, no de una instancia del job. idade_conexao (edad de la conexión) es de horas, pero parado_ha (inactiva hace) es de segundos, porque la conexión se reutiliza todo el tiempo. Y ultima_consulta (última consulta) viene de otra ruta de la aplicación. Un lock de sesión en manos de un backend en esas condiciones es una fuga, no un job en curso. Terminar ese backend con pg_terminate_backend libera el lock; PgBouncer detecta la conexión cerrada y abre otra. Como el estado es idle, no se corta ninguna transacción, pero compruébalo antes, porque si está active la petición en curso recibe un error.',
        },
        {
          type: 'list',
          items: [
            'Alerta útil: advisory lock concedido a un backend con state idle durante más tiempo que la duración máxima del job.',
            'Otra señal barata: contar en el log de Postgres el WARNING you don\'t own a lock of type ExclusiveLock. Solo aparece cuando un unlock fue a la sesión equivocada.',
            'Da un application_name a las conexiones de los jobs. Detrás de PgBouncer en modo transacción, el nombre que aparece es el de la primera conexión, lo que ya indica que el lock no está donde debería.',
          ],
        },
      ],
    },
    {
      title: 'La corrección estándar: lock de transacción en la misma conexión',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Para la mayoría de los jobs, la corrección es cambiar el lock de sesión por pg_try_advisory_xact_lock y hacer el trabajo dentro de la misma transacción, en un client obtenido con pool.connect. El lock pasa a tener la misma vida que la transacción: COMMIT o ROLLBACK lo liberan, y si el proceso muere la conexión se cae, la transacción se deshace y el lock desaparece. Funciona igual con o sin PgBouncer, porque en modo transacción la conexión del servidor queda asociada al cliente justamente hasta el final de la transacción.',
        },
        { type: 'code', value: xactLockCode(comments.es) },
        {
          type: 'paragraph',
          value:
            'Dos cuidados. El primero es que el trabajo debe usar el client recibido; si la tarea llama a pool.query, se ejecuta fuera de la transacción y fuera de la protección. El segundo es el costo: el job se convierte en una transacción abierta durante todo el procesamiento. Para unos segundos o pocos minutos es aceptable, y statement_timeout con SET LOCAL limita el peor caso. Para decenas de minutos, una transacción larga retiene el horizonte del vacuum, mantiene locks de fila y ocupa una conexión del pool, y entonces vale una de las alternativas de la siguiente sección.',
        },
      ],
    },
    {
      title: 'Jobs largos: conexión dedicada o lease en una tabla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando el job tarda mucho y no debe ejecutarse en una sola transacción, el lock de sesión sigue siendo una buena herramienta, siempre que la sesión sea del job. Una conexión propia, abierta directo a Postgres, sin PgBouncer, mantiene el lock mientras el trabajo se ejecuta con el pool normal. El cierre de la conexión es la garantía final: si el proceso muere, Postgres termina la sesión y libera el lock. Para caídas de red en las que el proceso desaparece sin cerrar el socket, configura keepAlive en el cliente y tcp_keepalives_idle en el servidor; si no, el backend puede seguir vivo esperando a un cliente que ya no existe.',
        },
        { type: 'code', value: dedicatedConnectionCode(comments.es) },
        {
          type: 'paragraph',
          value:
            'Cuando no hay acceso directo a Postgres, como en algunos servicios gestionados que solo exponen el pooler, o cuando el job abarca varios procesos, la salida es un lock en una tabla con fecha de vencimiento. No depende de una conexión abierta, sobrevive a cualquier pooler y vence solo si el dueño muere. A cambio, el job debe renovar el plazo mientras trabaja y detenerse si la renovación falla.',
        },
        { type: 'code', value: leaseCode(comments.es) },
        {
          type: 'ordered',
          items: [
            'Lista los puntos que usan pg_advisory_lock o pg_try_advisory_lock y verifica si lock y unlock pasan por la misma conexión.',
            'Cambia a pg_try_advisory_xact_lock los jobs que caben en una transacción corta.',
            'Mueve los jobs largos a una conexión dedicada directa o a un lease en una tabla con renovación.',
            'Alerta sobre advisory locks concedidos a backends idle y sobre el WARNING de unlock en la sesión equivocada.',
            'Antes de cambiar el pool_mode de PgBouncer, busca también SET de sesión, prepared statements con nombre y tablas temporales: todos se rompen por la misma razón.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Puedo usar pg_advisory_xact_lock en un job que tarda 40 minutos?',
      answer:
        'Funciona, pero el costo aparece en otro lugar. Una transacción abierta durante 40 minutos impide que el vacuum limpie las tuplas muertas creadas después de su inicio en toda la base, mantiene los locks de fila que tome el job y ocupa una conexión. Para jobs de ese tamaño, prefiere una conexión dedicada con lock de sesión, o un lease en una tabla, y procesa en lotes con commits cortos.',
    },
    {
      question: '¿Cómo elegir la clave de un advisory lock?',
      answer:
        'Las claves son globales en la base de datos, así que dos sistemas que usan el mismo número se bloquean sin saberlo. Usa un nombre legible con prefijo del dominio, como job:conciliacao, y conviértelo con hashtextextended(nombre, 0), que genera un bigint y hace improbables las colisiones. Evita hashtext, que tiene solo 32 bits. Si quieres separar por espacios de nombres, la forma con dos enteros, pg_try_advisory_xact_lock(clase, id), deja la primera clave para el tipo de recurso.',
    },
    {
      question: 'En modo sesión de PgBouncer, o sin PgBouncer, ¿el problema desaparece?',
      answer:
        'Disminuye, pero no desaparece. Sin un pooler delante, el pool de la propia aplicación todavía puede enviar lock y unlock por conexiones distintas, como el pool.query del ejemplo. El lock atrapado dura menos porque la conexión ociosa se cierra, pero con carga constante puede que nunca quede ociosa. La regla vale en cualquier arquitectura: lock de sesión solo con una conexión obtenida explícitamente y usada del lock al unlock.',
    },
  ],
  conclusion: {
    title: 'El lock vive donde vive la sesión',
    description:
      'El advisory lock de sesión pertenece a la conexión, no al proceso ni a la transacción. Detrás de un pool, y sobre todo de PgBouncer en modo transacción, esa conexión pasa de mano en mano y el lock va con ella: el unlock falla en silencio, el job deja de ejecutarse y, por ser reentrante, otro cliente puede obtener la misma clave. El lock de transacción en la misma conexión resuelve la mayoría de los casos; la conexión dedicada directa o el lease en una tabla cubren los jobs largos. Y conviene buscar locks concedidos a backends idle antes de que la cola de pendientes te avise.',
    cta: '¿Quieres revisar jobs, locks y la configuración del pool antes de poner PgBouncer en modo transacción?',
  },
  related: [
    {
      label: 'El job programado que corre dos veces: exclusión mutua distribuida sin un bloqueo eterno',
      to: '/blog/job-agendado-que-roda-duas-vezes-exclusao-mutua-distribuida-sem-trava-eterna',
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
