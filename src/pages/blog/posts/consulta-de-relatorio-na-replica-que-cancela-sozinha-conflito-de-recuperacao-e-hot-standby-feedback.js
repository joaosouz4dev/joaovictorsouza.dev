// Conteudo do artigo: consulta de relatorio na replica que cancela sozinha. Por que o replay do
// WAL cancela consultas longas no hot standby (conflito de recuperacao), como medir qual tipo de
// conflito acontece, o que hot_standby_feedback e max_standby_streaming_delay trocam de lugar
// (bloat na primaria ou atraso na replica) e como separar a replica de relatorio da de leitura.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const comments = {
  pt: {
    rep1: 'Na replica: quantas consultas foram canceladas e por qual tipo de conflito.',
    rep2: 'Na replica: os tres parametros que decidem quem perde, a consulta ou o replay.',
    rep3: 'Na replica: quanto WAL ja chegou e ainda nao foi aplicado, e de quando e o dado visivel.',
    pri1: 'Na primaria: o xmin que cada replica esta pedindo para preservar e ha quantas transacoes.',
    pri2: 'Na primaria: com slot fisico, o xmin fica guardado no slot mesmo se a replica cair.',
    pri3: 'Na primaria: tabelas onde o vacuum roda e nao consegue remover as tuplas mortas.',
    cfg1: 'replica-app: leitura da aplicacao e candidata a failover. Prioridade: dado fresco.',
    cfg2: 'replica-reports: relatorios longos. Prioridade: a consulta termina, o replay espera.',
    cfg3: 'Na primaria (papeis e parametros de papel sao replicados): teto para o que roda na replica.',
    app1: 'Um snapshot unico para o relatorio inteiro: todas as consultas enxergam o mesmo instante.',
    app2: 'O relatorio informa de quando e o dado, em vez de fingir que e de agora.',
    app3: 'Conflito de recuperacao pode encerrar a conexao (FATAL): descarta em vez de devolver ao pool.',
    app4: '40001 em replica somente leitura = conflito de recuperacao: repetir do zero e seguro.',
  },
  en: {
    rep1: 'On the replica: how many queries were canceled and by which conflict type.',
    rep2: 'On the replica: the three settings that decide who loses, the query or the replay.',
    rep3: 'On the replica: how much WAL arrived and is not applied yet, and how old the visible data is.',
    pri1: 'On the primary: the xmin each replica asks to preserve and how many transactions old it is.',
    pri2: 'On the primary: with a physical slot, the xmin stays in the slot even if the replica goes down.',
    pri3: 'On the primary: tables where vacuum runs and cannot remove the dead tuples.',
    cfg1: 'replica-app: application reads and failover candidate. Priority: fresh data.',
    cfg2: 'replica-reports: long reports. Priority: the query finishes, the replay waits.',
    cfg3: 'On the primary (roles and role settings are replicated): a ceiling for what runs on the replica.',
    app1: 'A single snapshot for the whole report: every query sees the same instant.',
    app2: 'The report states how old the data is instead of pretending it is current.',
    app3: 'A recovery conflict may close the connection (FATAL): discard it instead of returning it to the pool.',
    app4: '40001 on a read only replica = recovery conflict: repeating from scratch is safe.',
  },
  es: {
    rep1: 'En la replica: cuantas consultas se cancelaron y por que tipo de conflicto.',
    rep2: 'En la replica: los tres parametros que deciden quien pierde, la consulta o el replay.',
    rep3: 'En la replica: cuanto WAL llego y aun no se aplico, y de cuando es el dato visible.',
    pri1: 'En la primaria: el xmin que cada replica pide preservar y hace cuantas transacciones.',
    pri2: 'En la primaria: con slot fisico, el xmin queda guardado en el slot aunque la replica caiga.',
    pri3: 'En la primaria: tablas donde el vacuum corre y no logra eliminar las tuplas muertas.',
    cfg1: 'replica-app: lectura de la aplicacion y candidata a failover. Prioridad: dato fresco.',
    cfg2: 'replica-reports: reportes largos. Prioridad: la consulta termina, el replay espera.',
    cfg3: 'En la primaria (roles y parametros de rol se replican): techo para lo que corre en la replica.',
    app1: 'Un snapshot unico para todo el reporte: todas las consultas ven el mismo instante.',
    app2: 'El reporte informa de cuando es el dato, en lugar de fingir que es de ahora.',
    app3: 'Un conflicto de recuperacion puede cerrar la conexion (FATAL): descartarla en vez de devolverla al pool.',
    app4: '40001 en replica de solo lectura = conflicto de recuperacion: repetir desde cero es seguro.',
  },
};

const replicaDiagnostico = (c) => `-- ${c.rep1}
SELECT datname,
       confl_snapshot,
       confl_lock,
       confl_bufferpin,
       confl_deadlock,
       confl_tablespace
  FROM pg_stat_database_conflicts
 WHERE datname = current_database();

-- ${c.rep2}
SELECT name, setting, unit
  FROM pg_settings
 WHERE name IN ('hot_standby_feedback',
                'max_standby_streaming_delay',
                'max_standby_archive_delay');

-- ${c.rep3}
SELECT pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()) AS bytes_not_replayed,
       pg_last_xact_replay_timestamp()                                      AS data_as_of,
       now() - pg_last_xact_replay_timestamp()                              AS replay_delay;`;

const primariaDiagnostico = (c) => `-- ${c.pri1}
SELECT application_name,
       client_addr,
       state,
       backend_xmin,
       age(backend_xmin) AS xmin_age,
       replay_lag
  FROM pg_stat_replication;

-- ${c.pri2}
SELECT slot_name, active, xmin, age(xmin) AS xmin_age
  FROM pg_replication_slots
 WHERE slot_type = 'physical';

-- ${c.pri3}
SELECT relname,
       n_live_tup,
       n_dead_tup,
       last_autovacuum
  FROM pg_stat_user_tables
 ORDER BY n_dead_tup DESC
 LIMIT 10;`;

const configCode = (c) => `# ${c.cfg1}
# postgresql.conf (replica-app)
hot_standby_feedback = off
max_standby_streaming_delay = 30s
max_standby_archive_delay = 30s

# ${c.cfg2}
# postgresql.conf (replica-reports)
hot_standby_feedback = off
max_standby_streaming_delay = -1
max_standby_archive_delay = -1
log_recovery_conflict_waits = on

-- ${c.cfg3}
ALTER ROLE reporting SET statement_timeout = '15min';
ALTER ROLE reporting SET idle_in_transaction_session_timeout = '60s';`;

const appCode = (c) => `// replica-report.js
const RECOVERY_CONFLICT = '40001';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withReplicaSnapshot(replicaPool, work, { maxAttempts = 4 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let client;
    try {
      client = await replicaPool.connect();
      // ${c.app1}
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      // ${c.app2}
      const { rows } = await client.query('SELECT pg_last_xact_replay_timestamp() AS data_as_of');
      const result = await work(client);
      await client.query('COMMIT');
      client.release();
      return { result, dataAsOf: rows[0].data_as_of, attempt };
    } catch (error) {
      // ${c.app3}
      if (client) client.release(error);
      // ${c.app4}
      if (error.code !== RECOVERY_CONFLICT || attempt === maxAttempts) throw error;
      const wait = Math.min(1000 * 2 ** attempt, 20000) + Math.floor(Math.random() * 1000);
      console.warn('recovery conflict on replica (attempt ' + attempt + '), retrying in ' + wait + ' ms');
      await sleep(wait);
    }
  }
}

export async function monthlyClosing(replicaPool, tenantId, month) {
  return withReplicaSnapshot(replicaPool, async (client) => {
    const totals = await client.query(
      \`SELECT account_id, sum(amount) AS total
         FROM ledger_entries
        WHERE tenant_id = $1 AND posted_at >= $2::date AND posted_at < $2::date + interval '1 month'
        GROUP BY account_id\`,
      [tenantId, month],
    );
    const pending = await client.query(
      \`SELECT count(*)::int AS open_items
         FROM ledger_entries
        WHERE tenant_id = $1 AND posted_at < $2::date + interval '1 month' AND reconciled_at IS NULL\`,
      [tenantId, month],
    );
    return { totals: totals.rows, openItems: pending.rows[0].open_items };
  });
}`;

const diagramaPt = `PRIMARIA                                   REPLICA (hot standby)
t=0                                        relatorio comeca, snapshot enxerga a linha versao A
t=20 s  UPDATE troca A por B, commit
t=45 s  autovacuum remove A (ninguem
        na primaria precisa mais dela)
        WAL: "limpeza, horizonte = xid de A" --->  replay recebe o registro de limpeza
                                           o relatorio ainda pode precisar da versao A: CONFLITO
                                           replay espera ate max_standby_streaming_delay (30 s)
t=75 s                                     prazo esgotado: relatorio cancelado
                                           ERROR: canceling statement due to conflict with recovery
                                           replay aplica a limpeza e segue

Quem cede em cada configuracao:
padrao (30 s)                   a consulta e cancelada
hot_standby_feedback = on       a primaria adia a limpeza (acumula tuplas mortas)
max_standby_streaming_delay=-1  o replay espera (a replica fica atrasada)`;

const diagramaEn = `PRIMARY                                    REPLICA (hot standby)
t=0                                        report starts, snapshot sees row version A
t=20 s  UPDATE replaces A with B, commit
t=45 s  autovacuum removes A (nobody on
        the primary needs it anymore)
        WAL: "cleanup, horizon = xid of A" --->  replay receives the cleanup record
                                           the report may still need version A: CONFLICT
                                           replay waits up to max_standby_streaming_delay (30 s)
t=75 s                                     deadline reached: report canceled
                                           ERROR: canceling statement due to conflict with recovery
                                           replay applies the cleanup and moves on

Who yields under each configuration:
default (30 s)                  the query is canceled
hot_standby_feedback = on       the primary postpones cleanup (dead tuples pile up)
max_standby_streaming_delay=-1  the replay waits (the replica falls behind)`;

const diagramaEs = `PRIMARIA                                   REPLICA (hot standby)
t=0                                        el reporte empieza, el snapshot ve la fila version A
t=20 s  UPDATE cambia A por B, commit
t=45 s  autovacuum elimina A (nadie en
        la primaria la necesita ya)
        WAL: "limpieza, horizonte = xid de A" --->  el replay recibe el registro de limpieza
                                           el reporte aun puede necesitar la version A: CONFLICTO
                                           el replay espera hasta max_standby_streaming_delay (30 s)
t=75 s                                     plazo agotado: reporte cancelado
                                           ERROR: canceling statement due to conflict with recovery
                                           el replay aplica la limpieza y sigue

Quien cede en cada configuracion:
por defecto (30 s)              la consulta se cancela
hot_standby_feedback = on       la primaria pospone la limpieza (se acumulan tuplas muertas)
max_standby_streaming_delay=-1  el replay espera (la replica se atrasa)`;

const pt = {
  intro:
    'Um SaaS de gestão financeira moveu o relatório de fechamento mensal para a réplica de leitura, para tirar 11 minutos de consulta pesada de cima da primária. A decisão estava certa, mas o relatório passou a falhar sozinho: 7 de cada 10 execuções em horário comercial terminavam com "canceling statement due to conflict with recovery", sempre entre 30 e 50 segundos depois de começar. De madrugada, a mesma consulta passava. Ninguém tinha alterado o SQL, e não havia timeout configurado na aplicação. Quem cancelava era o próprio Postgres da réplica, para conseguir continuar aplicando o WAL que chegava da primária. Este artigo explica por que o replay e a consulta longa disputam a réplica, como medir qual tipo de conflito está acontecendo, o que hot_standby_feedback e max_standby_streaming_delay realmente fazem (cada um só muda quem paga a conta) e como separar a réplica de relatório da réplica de leitura da aplicação.',
  sections: [
    {
      title: 'O relatório que falha sozinho, só em horário comercial',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O fechamento mensal agrega a tabela ledger_entries, com 310 milhões de lançamentos, e leva cerca de 11 minutos. Na primária, ele competia por cache e I/O com a API. Na réplica, deveria rodar em paz. O que o time viu foi um padrão estranho: o erro nunca aparecia nos primeiros 30 segundos, quase sempre aparecia antes de 1 minuto, e a taxa de falha acompanhava o volume de escrita da primária. Quanto mais lançamentos sendo conciliados durante o dia, mais o relatório morria.',
        },
        {
          type: 'paragraph',
          value:
            'O padrão tem explicação direta. Uma réplica em hot standby faz duas coisas ao mesmo tempo: atende consultas de leitura e aplica, em ordem, o WAL que a primária envia. Às vezes aplicar o próximo registro de WAL destruiria algo de que uma consulta em andamento ainda precisa. O Postgres chama isso de conflito de recuperação e resolve assim: o replay espera um prazo e, se a consulta não terminar, ela é cancelada.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'Os 30 segundos do padrão são o valor padrão de max_standby_streaming_delay. A madrugada tranquila também se explica: sem UPDATE e DELETE na primária, não há versão de linha para limpar, então não há registro de limpeza no WAL e não há conflito. O relatório não tinha um problema de desempenho. Tinha um problema de convivência com o replay.',
        },
      ],
    },
    {
      title: 'Por que a réplica cancela: o replay do WAL contra o snapshot da consulta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Na primária, o vacuum só remove uma versão de linha quando nenhuma transação ativa ainda pode enxergá-la. O detalhe é que "nenhuma transação ativa" quer dizer nenhuma transação da primária. Ela não sabe quais snapshots estão abertos na réplica. Para a primária, a versão antiga do lançamento atualizado há 25 segundos é lixo. Para o relatório que começou na réplica há 40 segundos, ela ainda é a versão correta da linha.',
        },
        {
          type: 'paragraph',
          value:
            'Cada registro de limpeza no WAL carrega um horizonte: o identificador da transação mais recente cujas versões foram removidas. Ao aplicar o registro, a réplica verifica se existe consulta com snapshot mais antigo que esse horizonte. Se existir, há conflito de snapshot. E a limpeza não vem só do autovacuum: a poda de página (HOT pruning), disparada por leituras e escritas comuns na primária, gera o mesmo tipo de registro. Por isso desligar ou atrasar o autovacuum não elimina o problema.',
        },
        {
          type: 'paragraph',
          value:
            'Conflito de snapshot é o tipo mais comum, mas não é o único, e a distinção importa porque o remédio mais conhecido só trata um deles.',
        },
        {
          type: 'table',
          columns: ['Contador em pg_stat_database_conflicts', 'O que aconteceu na primária', 'hot_standby_feedback evita?', 'O que resolve'],
          rows: [
            ['confl_snapshot', 'Vacuum ou poda de página removeu versões que a consulta ainda enxerga', 'Sim, na maior parte dos casos', 'Feedback, prazo maior de replay ou retentativa'],
            ['confl_lock', 'DDL, TRUNCATE ou o truncamento do fim da tabela feito pelo vacuum pediu ACCESS EXCLUSIVE', 'Não', 'vacuum_truncate = false na tabela, DDL fora do horário do relatório, prazo maior'],
            ['confl_bufferpin', 'Vacuum precisa de acesso exclusivo a uma página que a consulta mantém fixada', 'Não', 'Prazo maior; evitar cursores abertos parados em uma página'],
            ['confl_deadlock', 'Replay e consulta se bloquearam mutuamente', 'Não', 'Retentativa na aplicação'],
            ['confl_tablespace', 'DROP TABLESPACE com arquivo temporário da consulta em uso', 'Não', 'Raro; coordenar a operação'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Um detalhe do prazo costuma surpreender. max_standby_streaming_delay não é "quanto tempo a consulta pode rodar", e sim o atraso total que o replay aceita acumular desde que o WAL chegou. Se a réplica já está 30 segundos atrasada por causa de um conflito anterior, a próxima consulta que conflitar é cancelada praticamente na hora, sem carência. É por isso que, em dias de muita escrita, até consultas de poucos segundos começam a falhar em rajadas.',
        },
      ],
    },
    {
      title: 'Medir antes de mexer: qual conflito, em qual réplica, com que atraso',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de mudar qualquer parâmetro, três consultas na réplica dizem com o que você está lidando. A primeira lê pg_stat_database_conflicts, uma visão que só tem valores na réplica e conta cancelamentos por tipo. A segunda mostra os parâmetros em vigor. A terceira mede o atraso do replay em bytes e informa de quando é o dado que a réplica está servindo.',
        },
        {
          type: 'code',
          value: replicaDiagnostico(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'No incidente, a leitura foi clara: confl_snapshot em 1.840 no mês, confl_lock em 12 e os demais em zero. Os 12 conflitos de lock coincidiam com o autovacuum truncando o fim de uma tabela de staging que é esvaziada todo dia. Sem essa medição, o time teria ligado hot_standby_feedback e continuado com uma dúzia de falhas mensais sem explicação.',
        },
        {
          type: 'list',
          items: [
            'replay_delay só é confiável quando a primária está escrevendo. Com a primária ociosa, o último commit aplicado envelhece e o valor cresce sem que haja atraso real. Use bytes_not_replayed como sinal principal.',
            'Em Postgres 14 ou superior, log_recovery_conflict_waits = on registra no log quando o replay fica esperando uma consulta por mais de deadlock_timeout, com o tipo de conflito. É a forma mais barata de saber quem está segurando o replay.',
            'A mensagem de erro traz um DETAIL que distingue os casos: "User query might have needed to see row versions that must be removed" é snapshot; "User was holding a relation lock for too long" é lock.',
          ],
        },
      ],
    },
    {
      title: 'hot_standby_feedback: o cancelamento vira bloat na primária',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com hot_standby_feedback = on, a réplica informa periodicamente à primária o xmin mais antigo entre as suas consultas. A primária passa a tratar esse xmin como se fosse de uma transação local e deixa de remover as versões de linha que a réplica ainda pode precisar. O conflito de snapshot praticamente desaparece. Foi a primeira correção aplicada, e o relatório parou de falhar no mesmo dia.',
        },
        {
          type: 'paragraph',
          value:
            'Três semanas depois veio a conta. Uma ferramenta de BI conectada à mesma réplica deixou uma consulta ad hoc rodando por 3 horas e 10 minutos. Durante esse tempo, nenhum vacuum da primária conseguiu remover tuplas mortas mais novas que o snapshot daquela consulta, em nenhuma tabela. A ledger_entries foi de 42 GB para 61 GB em duas semanas de episódios parecidos, e as consultas da API ficaram mais lentas sem que nada no código tivesse mudado. O efeito é idêntico ao de uma transação longa aberta na própria primária, com a diferença de que ela não aparece em pg_stat_activity da primária.',
        },
        {
          type: 'code',
          value: primariaDiagnostico(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'O sinal a procurar é xmin_age alto e crescente em pg_stat_replication ou no slot, junto com tabelas em que last_autovacuum é recente e n_dead_tup não cai. Isso significa que o vacuum roda, mas não tem permissão para limpar.',
        },
        {
          type: 'list',
          items: [
            'O feedback não evita conflito de lock nem de buffer pin. Para o caso mais comum de lock, o truncamento do fim da tabela pelo vacuum, use ALTER TABLE ... SET (vacuum_truncate = false) nas tabelas que esvaziam e enchem.',
            'Sem slot de replicação, o xmin informado se perde quando a conexão de replicação cai, e a primária pode limpar o que a réplica precisava nesse intervalo. Com slot físico, o xmin persiste, e junto com ele o risco: uma réplica parada continua segurando o vacuum.',
            'Em réplicas em cascata, o feedback sobe a cadeia inteira. Uma consulta longa na réplica da réplica segura o vacuum na primária.',
            'O custo é proporcional à consulta mais longa da réplica, não à média. Feedback sem teto de duração na réplica é um cheque em branco.',
          ],
        },
      ],
    },
    {
      title: 'max_standby_streaming_delay e a réplica dedicada de relatório',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A alternativa é fazer o replay ceder. Com max_standby_streaming_delay maior, ou -1 para esperar sem limite, a consulta nunca é cancelada: o replay fica parado até ela terminar. A primária não é afetada, o vacuum segue limpando normalmente e o custo fica todo na réplica, que passa a servir dado cada vez mais velho enquanto a consulta roda. Isso é inaceitável na réplica que atende leituras da aplicação ou que é candidata a failover, e é perfeitamente aceitável em uma réplica que só existe para relatório.',
        },
        {
          type: 'paragraph',
          value:
            'Por isso a solução definitiva foi separar os papéis. Cada estratégia transfere o custo para um lugar diferente, e a tabela ajuda a escolher onde ele dói menos.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'Quem paga', 'Risco principal', 'Quando usar'],
          rows: [
            ['Padrão: prazo de 30 s, sem feedback', 'A consulta longa, que é cancelada', 'Relatório falha de forma intermitente', 'Réplica de leitura da aplicação, com consultas curtas e retentativa'],
            ['hot_standby_feedback = on', 'A primária, que acumula tuplas mortas', 'Bloat e lentidão na primária por causa de uma consulta na réplica', 'Consultas de poucos minutos, com statement_timeout curto na réplica'],
            ['Prazo longo ou -1 na mesma réplica', 'Todos os leitores da réplica, que veem dado atrasado', 'Leitura velha na aplicação e failover com replay pendente', 'Quase nunca: mistura cargas com exigências opostas'],
            ['Réplica dedicada de relatório com prazo -1', 'O custo de mais um servidor', 'Atraso sem limite se as consultas se encadearem', 'Relatórios e exportações longas, BI, consultas ad hoc'],
          ],
        },
        {
          type: 'code',
          value: configCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'O prazo -1 precisa de um teto vindo de outro lugar, e é esse o papel dos limites no papel reporting. Sem eles, uma consulta esquecida para o replay indefinidamente, o WAL recebido se acumula no disco da réplica e o atraso só cresce. Há também um efeito menos óbvio: enquanto o replay está parado, novas consultas abrem snapshots naquele mesmo ponto antigo e podem prolongar a espera. Com consultas encadeadas sem intervalo, a réplica pode nunca alcançar a primária. Agendar os relatórios com folga e alertar sobre atraso acima de 30 minutos resolve os dois casos.',
        },
      ],
    },
    {
      title: 'O que fica no código: snapshot único, idade do dado e retentativa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo com a infraestrutura certa, o código que lê da réplica precisa tratar o conflito como um resultado esperado. O erro chega com SQLSTATE 40001, o mesmo código de falha de serialização, e a escolha não é acidental: significa que a operação pode ser repetida do zero. Em uma conexão somente leitura, repetir não tem efeito colateral. O conflito também pode encerrar a sessão inteira com um FATAL quando ela está parada dentro de uma transação, então a conexão deve ser descartada, não devolvida ao pool.',
        },
        {
          type: 'code',
          value: appCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'Dois detalhes do código valem mais que a retentativa. O primeiro é o REPEATABLE READ: sem ele, cada consulta do relatório abre um snapshot novo, e os totais e os itens em aberto podem ser de instantes diferentes, o que em relatório financeiro vira diferença de centavos impossível de explicar. O segundo é devolver data_as_of: na réplica de relatório o dado pode ter 15 minutos, e o relatório deve dizer "dados até 14:32" em vez de deixar o usuário descobrir sozinho.',
        },
        {
          type: 'ordered',
          items: [
            'Alerte sobre o crescimento de confl_snapshot e confl_lock por réplica. Um salto indica mudança no padrão de escrita da primária ou relatório novo sem teto.',
            'Na réplica de relatório, alerte sobre bytes_not_replayed e atraso acima do maior relatório previsto. Na réplica da aplicação, o limite é de segundos.',
            'Na primária, alerte sobre xmin_age das réplicas e dos slots. É o único sinal que mostra uma consulta remota segurando o vacuum.',
            'Quebre exportações gigantes em páginas por chave. Cada consulta dura segundos e sobrevive ao prazo padrão, ao custo de perder o snapshot único, o que é aceitável para exportação e não para fechamento.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Posso ligar hot_standby_feedback e aumentar max_standby_streaming_delay ao mesmo tempo?',
      answer:
        'Pode, e em alguns cenários faz sentido, porque os dois tratam conflitos diferentes: o feedback evita a maior parte dos conflitos de snapshot, e o prazo maior cobre os de lock e buffer pin que o feedback não alcança. O cuidado é não somar os dois custos sem teto. Com feedback ligado, limite a duração das consultas na réplica com statement_timeout por papel, para que o xmin retido na primária nunca passe de alguns minutos. E mantenha o prazo de replay compatível com o uso da réplica: segundos se ela atende a aplicação, minutos se é só para relatório.',
    },
    {
      question: 'Por que não rodar o relatório direto na primária, já que lá não existe conflito de recuperação?',
      answer:
        'Na primária a consulta não é cancelada, mas o custo aparece de outra forma: uma leitura de 11 minutos segura o horizonte de xmin localmente, impede o vacuum pelo mesmo mecanismo do feedback e ainda disputa cache, I/O e CPU com as transações da aplicação. É a pior combinação. Rodar na primária só é razoável para relatórios de poucos segundos ou em bases pequenas. Para o resto, a réplica dedicada isola os dois custos: nem a primária incha, nem a aplicação vê dado atrasado.',
    },
    {
      question: 'Uma réplica com atraso de vários minutos ainda serve como candidata a failover?',
      answer:
        'Serve mal. Em streaming, o WAL continua chegando e sendo gravado no disco da réplica mesmo com o replay parado, então normalmente não há perda de dados. Mas, antes de ser promovida, ela precisa aplicar tudo o que está pendente, e esse tempo entra direto no tempo de recuperação. Além disso, o replay parado só é retomado quando as consultas conflitantes terminam ou são canceladas. Por isso a réplica de relatório não deve ser a candidata principal: deixe o failover para a réplica da aplicação, que mantém o replay em dia.',
    },
  ],
  conclusion: {
    title: 'O conflito não some, ele só muda de lugar',
    description:
      'A consulta longa na réplica e o replay do WAL querem coisas incompatíveis, e toda configuração apenas escolhe quem cede: a consulta, que é cancelada; a primária, que acumula tuplas mortas com hot_standby_feedback; ou a réplica, que atrasa com max_standby_streaming_delay. A escolha boa depende de para que a réplica existe. Meça o tipo de conflito em pg_stat_database_conflicts, mantenha a réplica da aplicação com replay em dia e consultas curtas, mova relatórios longos para uma réplica dedicada com teto de duração, e faça o código tratar o 40001 como retentativa e informar a idade do dado. Com isso, o relatório para de falhar sem que a conta apareça semanas depois em outro lugar.',
    cta: 'Revisar a topologia de réplicas do meu banco',
  },
  related: [
    {
      label: 'Réplica de leitura atrasada: quando o usuário salva e não vê o que acabou de salvar',
      to: '/blog/replica-leitura-atrasada-usuario-salva-e-nao-ve-o-que-salvou',
    },
    {
      label: 'Autovacuum que não acompanha: quando a tabela incha e a consulta fica lenta sem mudar nada',
      to: '/blog/autovacuum-que-nao-acompanha-tabela-incha-consulta-lenta-sem-mudar-nada',
    },
    {
      label: 'Serviço de arquitetura e modernização backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A financial management SaaS moved its monthly closing report to the read replica, to take 11 minutes of heavy querying off the primary. The decision was right, but the report started failing on its own: 7 out of 10 runs during business hours ended with "canceling statement due to conflict with recovery", always between 30 and 50 seconds after starting. At night the same query went through. Nobody had changed the SQL, and the application had no timeout configured. The one doing the canceling was Postgres itself on the replica, so that it could keep applying the WAL arriving from the primary. This article explains why replay and a long query compete for the replica, how to measure which type of conflict is happening, what hot_standby_feedback and max_standby_streaming_delay really do (each one only changes who pays the bill) and how to separate the reporting replica from the application read replica.',
  sections: [
    {
      title: 'The report that fails on its own, only during business hours',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The monthly closing aggregates the ledger_entries table, with 310 million entries, and takes about 11 minutes. On the primary it competed with the API for cache and I/O. On the replica it was supposed to run in peace. What the team saw was an odd pattern: the error never showed up in the first 30 seconds, almost always showed up before the 1 minute mark, and the failure rate followed the write volume on the primary. The more entries being reconciled during the day, the more often the report died.',
        },
        {
          type: 'paragraph',
          value:
            'The pattern has a direct explanation. A hot standby replica does two things at once: it serves read queries and it applies, in order, the WAL the primary sends. Sometimes applying the next WAL record would destroy something a running query still needs. Postgres calls this a recovery conflict and resolves it like this: replay waits for a deadline and, if the query has not finished, the query is canceled.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'The 30 seconds in the pattern are the default value of max_standby_streaming_delay. The quiet nights are explained too: with no UPDATE or DELETE on the primary there is no row version to clean, so there is no cleanup record in the WAL and no conflict. The report did not have a performance problem. It had a problem coexisting with replay.',
        },
      ],
    },
    {
      title: 'Why the replica cancels: WAL replay against the query snapshot',
      blocks: [
        {
          type: 'paragraph',
          value:
            'On the primary, vacuum only removes a row version when no active transaction can still see it. The catch is that "no active transaction" means no transaction on the primary. It has no idea which snapshots are open on the replica. To the primary, the old version of an entry updated 25 seconds ago is garbage. To the report that started on the replica 40 seconds ago, it is still the correct version of the row.',
        },
        {
          type: 'paragraph',
          value:
            'Each cleanup record in the WAL carries a horizon: the identifier of the most recent transaction whose versions were removed. When applying the record, the replica checks whether any query holds a snapshot older than that horizon. If one does, there is a snapshot conflict. And cleanup does not come only from autovacuum: page pruning (HOT pruning), triggered by ordinary reads and writes on the primary, produces the same kind of record. That is why turning autovacuum off or slowing it down does not remove the problem.',
        },
        {
          type: 'paragraph',
          value:
            'Snapshot conflict is the most common type, but not the only one, and the distinction matters because the best known remedy only treats one of them.',
        },
        {
          type: 'table',
          columns: ['Counter in pg_stat_database_conflicts', 'What happened on the primary', 'Does hot_standby_feedback prevent it?', 'What fixes it'],
          rows: [
            ['confl_snapshot', 'Vacuum or page pruning removed versions the query can still see', 'Yes, in most cases', 'Feedback, a longer replay deadline or a retry'],
            ['confl_lock', 'DDL, TRUNCATE or the end of table truncation done by vacuum requested ACCESS EXCLUSIVE', 'No', 'vacuum_truncate = false on the table, DDL outside report hours, a longer deadline'],
            ['confl_bufferpin', 'Vacuum needs exclusive access to a page the query keeps pinned', 'No', 'A longer deadline; avoid open cursors parked on a page'],
            ['confl_deadlock', 'Replay and the query blocked each other', 'No', 'Retry in the application'],
            ['confl_tablespace', 'DROP TABLESPACE while a temporary file of the query is in use', 'No', 'Rare; coordinate the operation'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'One detail about the deadline tends to surprise people. max_standby_streaming_delay is not "how long a query may run" but the total delay replay accepts to accumulate since the WAL arrived. If the replica is already 30 seconds behind because of an earlier conflict, the next conflicting query is canceled almost immediately, with no grace period. That is why, on write heavy days, even queries of a few seconds start failing in bursts.',
        },
      ],
    },
    {
      title: 'Measure before touching anything: which conflict, on which replica, with how much lag',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before changing any setting, three queries on the replica tell you what you are dealing with. The first reads pg_stat_database_conflicts, a view that only has values on a replica and counts cancellations by type. The second shows the settings in effect. The third measures replay lag in bytes and reports how old the data served by the replica is.',
        },
        {
          type: 'code',
          value: replicaDiagnostico(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'In the incident the reading was clear: confl_snapshot at 1,840 for the month, confl_lock at 12 and the rest at zero. The 12 lock conflicts matched autovacuum truncating the end of a staging table that is emptied every day. Without this measurement the team would have turned hot_standby_feedback on and kept a dozen unexplained failures per month.',
        },
        {
          type: 'list',
          items: [
            'replay_delay is only reliable while the primary is writing. With an idle primary, the last applied commit ages and the value grows with no real lag. Use bytes_not_replayed as the main signal.',
            'On Postgres 14 or later, log_recovery_conflict_waits = on logs when replay has been waiting on a query for longer than deadlock_timeout, with the conflict type. It is the cheapest way to learn who is holding replay back.',
            'The error message has a DETAIL line that tells the cases apart: "User query might have needed to see row versions that must be removed" is snapshot; "User was holding a relation lock for too long" is lock.',
          ],
        },
      ],
    },
    {
      title: 'hot_standby_feedback: the cancellation becomes bloat on the primary',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With hot_standby_feedback = on, the replica periodically tells the primary the oldest xmin among its queries. The primary treats that xmin as if it belonged to a local transaction and stops removing the row versions the replica may still need. Snapshot conflicts practically disappear. It was the first fix applied, and the report stopped failing the same day.',
        },
        {
          type: 'paragraph',
          value:
            'Three weeks later the bill arrived. A BI tool connected to the same replica left an ad hoc query running for 3 hours and 10 minutes. During that time no vacuum on the primary could remove dead tuples newer than the snapshot of that query, on any table. ledger_entries went from 42 GB to 61 GB after two weeks of similar episodes, and API queries got slower with nothing changed in the code. The effect is identical to a long transaction left open on the primary itself, except that it does not show up in pg_stat_activity on the primary.',
        },
        {
          type: 'code',
          value: primariaDiagnostico(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'The signal to look for is a high and growing xmin_age in pg_stat_replication or in the slot, together with tables where last_autovacuum is recent and n_dead_tup does not drop. It means vacuum runs but is not allowed to clean.',
        },
        {
          type: 'list',
          items: [
            'Feedback does not prevent lock or buffer pin conflicts. For the most common lock case, vacuum truncating the end of the table, use ALTER TABLE ... SET (vacuum_truncate = false) on tables that empty and refill.',
            'Without a replication slot, the reported xmin is lost when the replication connection drops, and the primary may clean what the replica needed in that window. With a physical slot the xmin persists, and so does the risk: a stopped replica keeps holding vacuum back.',
            'With cascading replicas, feedback travels up the whole chain. A long query on the replica of a replica holds back vacuum on the primary.',
            'The cost is proportional to the longest query on the replica, not the average. Feedback with no duration ceiling on the replica is a blank check.',
          ],
        },
      ],
    },
    {
      title: 'max_standby_streaming_delay and the dedicated reporting replica',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The alternative is to make replay yield. With a larger max_standby_streaming_delay, or -1 to wait without limit, the query is never canceled: replay stays paused until it finishes. The primary is unaffected, vacuum keeps cleaning as usual and the whole cost lands on the replica, which serves older and older data while the query runs. That is unacceptable on the replica that serves application reads or is a failover candidate, and perfectly acceptable on a replica that exists only for reporting.',
        },
        {
          type: 'paragraph',
          value:
            'That is why the definitive solution was to split the roles. Each strategy moves the cost to a different place, and the table helps choose where it hurts least.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'Who pays', 'Main risk', 'When to use'],
          rows: [
            ['Default: 30 s deadline, no feedback', 'The long query, which is canceled', 'The report fails intermittently', 'Application read replica, with short queries and retry'],
            ['hot_standby_feedback = on', 'The primary, which accumulates dead tuples', 'Bloat and slowness on the primary caused by a query on the replica', 'Queries of a few minutes, with a short statement_timeout on the replica'],
            ['Long deadline or -1 on the same replica', 'Every reader of the replica, who sees stale data', 'Stale reads in the application and failover with pending replay', 'Almost never: it mixes workloads with opposite requirements'],
            ['Dedicated reporting replica with deadline -1', 'The cost of one more server', 'Unbounded lag if queries chain together', 'Long reports and exports, BI, ad hoc queries'],
          ],
        },
        {
          type: 'code',
          value: configCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'A deadline of -1 needs a ceiling from somewhere else, and that is the job of the limits on the reporting role. Without them a forgotten query pauses replay indefinitely, received WAL piles up on the replica disk and the lag only grows. There is also a less obvious effect: while replay is paused, new queries open snapshots at that same old point and may prolong the wait. With queries chained back to back, the replica may never catch up with the primary. Scheduling reports with slack and alerting on lag above 30 minutes covers both cases.',
        },
      ],
    },
    {
      title: 'What stays in the code: single snapshot, data age and retry',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Even with the right infrastructure, code that reads from the replica must treat the conflict as an expected outcome. The error arrives with SQLSTATE 40001, the same code as a serialization failure, and the choice is not accidental: it means the operation can be repeated from scratch. On a read only connection, repeating has no side effect. The conflict can also terminate the whole session with a FATAL when it sits idle inside a transaction, so the connection must be discarded, not returned to the pool.',
        },
        {
          type: 'code',
          value: appCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'Two details in the code matter more than the retry. The first is REPEATABLE READ: without it each query in the report opens a new snapshot, and the totals and the open items may come from different instants, which in a financial report becomes a difference of cents nobody can explain. The second is returning data_as_of: on the reporting replica the data may be 15 minutes old, and the report should say "data as of 14:32" instead of letting the user find out alone.',
        },
        {
          type: 'ordered',
          items: [
            'Alert on the growth of confl_snapshot and confl_lock per replica. A jump points to a change in the write pattern of the primary or a new report with no ceiling.',
            'On the reporting replica, alert on bytes_not_replayed and on lag above the longest expected report. On the application replica the limit is seconds.',
            'On the primary, alert on the xmin_age of replicas and slots. It is the only signal that shows a remote query holding vacuum back.',
            'Split giant exports into keyset pages. Each query lasts seconds and survives the default deadline, at the cost of losing the single snapshot, which is acceptable for an export and not for a closing.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can I turn hot_standby_feedback on and raise max_standby_streaming_delay at the same time?',
      answer:
        'Yes, and in some scenarios it makes sense, because the two address different conflicts: feedback prevents most snapshot conflicts, and the longer deadline covers the lock and buffer pin conflicts feedback cannot reach. The care needed is not to add both costs with no ceiling. With feedback on, cap query duration on the replica with a per role statement_timeout, so that the xmin retained on the primary never exceeds a few minutes. And keep the replay deadline compatible with what the replica is for: seconds if it serves the application, minutes if it is only for reporting.',
    },
    {
      question: 'Why not run the report directly on the primary, since recovery conflicts do not exist there?',
      answer:
        'On the primary the query is not canceled, but the cost shows up in another form: an 11 minute read holds the xmin horizon locally, blocks vacuum through the same mechanism as feedback and also competes for cache, I/O and CPU with application transactions. It is the worst combination. Running on the primary is only reasonable for reports of a few seconds or on small databases. For everything else, the dedicated replica isolates both costs: the primary does not bloat and the application does not see stale data.',
    },
    {
      question: 'Is a replica lagging by several minutes still a valid failover candidate?',
      answer:
        'A poor one. With streaming, WAL keeps arriving and being written to the replica disk even while replay is paused, so normally no data is lost. But before being promoted it must apply everything that is pending, and that time goes straight into the recovery time. On top of that, paused replay only resumes when the conflicting queries finish or are canceled. That is why the reporting replica should not be the main candidate: leave failover to the application replica, which keeps replay up to date.',
    },
  ],
  conclusion: {
    title: 'The conflict does not go away, it only moves',
    description:
      'A long query on the replica and WAL replay want incompatible things, and every configuration merely chooses who yields: the query, which is canceled; the primary, which accumulates dead tuples under hot_standby_feedback; or the replica, which lags under max_standby_streaming_delay. The good choice depends on what the replica exists for. Measure the conflict type in pg_stat_database_conflicts, keep the application replica with replay up to date and short queries, move long reports to a dedicated replica with a duration ceiling, and make the code treat 40001 as a retry and state the age of the data. With that, the report stops failing without the bill showing up weeks later somewhere else.',
    cta: 'Review the replica topology of my database',
  },
  related: [
    {
      label: 'The lagging read replica: when users save and do not see what they just saved',
      to: '/blog/replica-leitura-atrasada-usuario-salva-e-nao-ve-o-que-salvou',
    },
    {
      label: 'Autovacuum that cannot keep up: when the table bloats and queries slow down with nothing changed',
      to: '/blog/autovacuum-que-nao-acompanha-tabela-incha-consulta-lenta-sem-mudar-nada',
    },
    {
      label: 'Backend architecture and modernization service',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Un SaaS de gestión financiera movió el reporte de cierre mensual a la réplica de lectura, para quitarle a la primaria 11 minutos de consulta pesada. La decisión era correcta, pero el reporte empezó a fallar solo: 7 de cada 10 ejecuciones en horario laboral terminaban con "canceling statement due to conflict with recovery", siempre entre 30 y 50 segundos después de empezar. De madrugada, la misma consulta pasaba. Nadie había cambiado el SQL y la aplicación no tenía ningún timeout configurado. Quien cancelaba era el propio Postgres de la réplica, para poder seguir aplicando el WAL que llegaba de la primaria. Este artículo explica por qué el replay y la consulta larga se disputan la réplica, cómo medir qué tipo de conflicto está ocurriendo, qué hacen realmente hot_standby_feedback y max_standby_streaming_delay (cada uno solo cambia quién paga la cuenta) y cómo separar la réplica de reportes de la réplica de lectura de la aplicación.',
  sections: [
    {
      title: 'El reporte que falla solo, únicamente en horario laboral',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El cierre mensual agrega la tabla ledger_entries, con 310 millones de asientos, y tarda unos 11 minutos. En la primaria competía por caché e I/O con la API. En la réplica debía correr en paz. Lo que el equipo vio fue un patrón extraño: el error nunca aparecía en los primeros 30 segundos, casi siempre aparecía antes del minuto, y la tasa de fallos seguía el volumen de escritura de la primaria. Cuantos más asientos se conciliaban durante el día, más moría el reporte.',
        },
        {
          type: 'paragraph',
          value:
            'El patrón tiene una explicación directa. Una réplica en hot standby hace dos cosas a la vez: atiende consultas de lectura y aplica, en orden, el WAL que envía la primaria. A veces aplicar el siguiente registro de WAL destruiría algo que una consulta en curso todavía necesita. Postgres lo llama conflicto de recuperación y lo resuelve así: el replay espera un plazo y, si la consulta no termina, la cancela.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'Los 30 segundos del patrón son el valor por defecto de max_standby_streaming_delay. La madrugada tranquila también se explica: sin UPDATE ni DELETE en la primaria no hay versión de fila que limpiar, así que no hay registro de limpieza en el WAL y no hay conflicto. El reporte no tenía un problema de rendimiento. Tenía un problema de convivencia con el replay.',
        },
      ],
    },
    {
      title: 'Por qué la réplica cancela: el replay del WAL contra el snapshot de la consulta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En la primaria, el vacuum solo elimina una versión de fila cuando ninguna transacción activa puede verla todavía. El detalle es que "ninguna transacción activa" significa ninguna transacción de la primaria. Esta no sabe qué snapshots están abiertos en la réplica. Para la primaria, la versión antigua del asiento actualizado hace 25 segundos es basura. Para el reporte que empezó en la réplica hace 40 segundos, sigue siendo la versión correcta de la fila.',
        },
        {
          type: 'paragraph',
          value:
            'Cada registro de limpieza en el WAL lleva un horizonte: el identificador de la transacción más reciente cuyas versiones fueron eliminadas. Al aplicar el registro, la réplica verifica si existe alguna consulta con un snapshot más antiguo que ese horizonte. Si existe, hay conflicto de snapshot. Y la limpieza no viene solo del autovacuum: la poda de página (HOT pruning), disparada por lecturas y escrituras comunes en la primaria, genera el mismo tipo de registro. Por eso apagar o retrasar el autovacuum no elimina el problema.',
        },
        {
          type: 'paragraph',
          value:
            'El conflicto de snapshot es el tipo más común, pero no el único, y la distinción importa porque el remedio más conocido solo trata uno de ellos.',
        },
        {
          type: 'table',
          columns: ['Contador en pg_stat_database_conflicts', 'Qué ocurrió en la primaria', '¿hot_standby_feedback lo evita?', 'Qué lo resuelve'],
          rows: [
            ['confl_snapshot', 'El vacuum o la poda de página eliminó versiones que la consulta aún ve', 'Sí, en la mayoría de los casos', 'Feedback, un plazo de replay mayor o un reintento'],
            ['confl_lock', 'Un DDL, un TRUNCATE o el truncado del final de la tabla hecho por el vacuum pidió ACCESS EXCLUSIVE', 'No', 'vacuum_truncate = false en la tabla, DDL fuera del horario del reporte, un plazo mayor'],
            ['confl_bufferpin', 'El vacuum necesita acceso exclusivo a una página que la consulta mantiene fijada', 'No', 'Un plazo mayor; evitar cursores abiertos detenidos en una página'],
            ['confl_deadlock', 'El replay y la consulta se bloquearon mutuamente', 'No', 'Reintento en la aplicación'],
            ['confl_tablespace', 'DROP TABLESPACE con un archivo temporal de la consulta en uso', 'No', 'Poco frecuente; coordinar la operación'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Un detalle del plazo suele sorprender. max_standby_streaming_delay no es "cuánto tiempo puede correr la consulta", sino el atraso total que el replay acepta acumular desde que llegó el WAL. Si la réplica ya lleva 30 segundos de atraso por un conflicto anterior, la siguiente consulta que entre en conflicto se cancela prácticamente al instante, sin margen. Por eso, en días de mucha escritura, hasta las consultas de pocos segundos empiezan a fallar en ráfagas.',
        },
      ],
    },
    {
      title: 'Medir antes de tocar: qué conflicto, en qué réplica, con cuánto atraso',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de cambiar cualquier parámetro, tres consultas en la réplica dicen con qué se está lidiando. La primera lee pg_stat_database_conflicts, una vista que solo tiene valores en la réplica y cuenta las cancelaciones por tipo. La segunda muestra los parámetros vigentes. La tercera mide el atraso del replay en bytes e informa de cuándo es el dato que la réplica está sirviendo.',
        },
        {
          type: 'code',
          value: replicaDiagnostico(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'En el incidente la lectura fue clara: confl_snapshot en 1.840 en el mes, confl_lock en 12 y el resto en cero. Los 12 conflictos de lock coincidían con el autovacuum truncando el final de una tabla de staging que se vacía todos los días. Sin esa medición, el equipo habría activado hot_standby_feedback y seguido con una docena de fallos mensuales sin explicación.',
        },
        {
          type: 'list',
          items: [
            'replay_delay solo es confiable cuando la primaria está escribiendo. Con la primaria ociosa, el último commit aplicado envejece y el valor crece sin que exista atraso real. Use bytes_not_replayed como señal principal.',
            'En Postgres 14 o superior, log_recovery_conflict_waits = on registra en el log cuando el replay lleva esperando a una consulta más de deadlock_timeout, con el tipo de conflicto. Es la forma más barata de saber quién está frenando el replay.',
            'El mensaje de error trae un DETAIL que distingue los casos: "User query might have needed to see row versions that must be removed" es snapshot; "User was holding a relation lock for too long" es lock.',
          ],
        },
      ],
    },
    {
      title: 'hot_standby_feedback: la cancelación se convierte en bloat en la primaria',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con hot_standby_feedback = on, la réplica informa periódicamente a la primaria el xmin más antiguo entre sus consultas. La primaria pasa a tratar ese xmin como si fuera de una transacción local y deja de eliminar las versiones de fila que la réplica aún puede necesitar. El conflicto de snapshot prácticamente desaparece. Fue la primera corrección aplicada, y el reporte dejó de fallar ese mismo día.',
        },
        {
          type: 'paragraph',
          value:
            'Tres semanas después llegó la cuenta. Una herramienta de BI conectada a la misma réplica dejó una consulta ad hoc corriendo durante 3 horas y 10 minutos. En ese tiempo, ningún vacuum de la primaria pudo eliminar tuplas muertas más nuevas que el snapshot de esa consulta, en ninguna tabla. ledger_entries pasó de 42 GB a 61 GB en dos semanas de episodios parecidos, y las consultas de la API se volvieron más lentas sin que nada hubiera cambiado en el código. El efecto es idéntico al de una transacción larga abierta en la propia primaria, con la diferencia de que no aparece en pg_stat_activity de la primaria.',
        },
        {
          type: 'code',
          value: primariaDiagnostico(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'La señal a buscar es un xmin_age alto y creciente en pg_stat_replication o en el slot, junto con tablas donde last_autovacuum es reciente y n_dead_tup no baja. Significa que el vacuum corre, pero no tiene permiso para limpiar.',
        },
        {
          type: 'list',
          items: [
            'El feedback no evita los conflictos de lock ni de buffer pin. Para el caso más común de lock, el truncado del final de la tabla por el vacuum, use ALTER TABLE ... SET (vacuum_truncate = false) en las tablas que se vacían y se llenan.',
            'Sin slot de replicación, el xmin informado se pierde cuando cae la conexión de replicación, y la primaria puede limpiar lo que la réplica necesitaba en ese intervalo. Con slot físico el xmin persiste, y con él el riesgo: una réplica detenida sigue frenando el vacuum.',
            'En réplicas en cascada, el feedback sube por toda la cadena. Una consulta larga en la réplica de la réplica frena el vacuum en la primaria.',
            'El costo es proporcional a la consulta más larga de la réplica, no al promedio. Feedback sin techo de duración en la réplica es un cheque en blanco.',
          ],
        },
      ],
    },
    {
      title: 'max_standby_streaming_delay y la réplica dedicada de reportes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La alternativa es hacer que ceda el replay. Con un max_standby_streaming_delay mayor, o -1 para esperar sin límite, la consulta nunca se cancela: el replay queda detenido hasta que termine. La primaria no se ve afectada, el vacuum sigue limpiando con normalidad y todo el costo queda en la réplica, que sirve datos cada vez más viejos mientras la consulta corre. Eso es inaceptable en la réplica que atiende lecturas de la aplicación o que es candidata a failover, y perfectamente aceptable en una réplica que solo existe para reportes.',
        },
        {
          type: 'paragraph',
          value:
            'Por eso la solución definitiva fue separar los roles. Cada estrategia traslada el costo a un lugar distinto, y la tabla ayuda a elegir dónde duele menos.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Quién paga', 'Riesgo principal', 'Cuándo usarla'],
          rows: [
            ['Por defecto: plazo de 30 s, sin feedback', 'La consulta larga, que se cancela', 'El reporte falla de forma intermitente', 'Réplica de lectura de la aplicación, con consultas cortas y reintento'],
            ['hot_standby_feedback = on', 'La primaria, que acumula tuplas muertas', 'Bloat y lentitud en la primaria por una consulta en la réplica', 'Consultas de pocos minutos, con statement_timeout corto en la réplica'],
            ['Plazo largo o -1 en la misma réplica', 'Todos los lectores de la réplica, que ven datos atrasados', 'Lectura vieja en la aplicación y failover con replay pendiente', 'Casi nunca: mezcla cargas con exigencias opuestas'],
            ['Réplica dedicada de reportes con plazo -1', 'El costo de un servidor más', 'Atraso sin límite si las consultas se encadenan', 'Reportes y exportaciones largas, BI, consultas ad hoc'],
          ],
        },
        {
          type: 'code',
          value: configCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'El plazo -1 necesita un techo que venga de otro lado, y ese es el papel de los límites en el rol reporting. Sin ellos, una consulta olvidada detiene el replay indefinidamente, el WAL recibido se acumula en el disco de la réplica y el atraso solo crece. Hay además un efecto menos obvio: mientras el replay está detenido, las consultas nuevas abren snapshots en ese mismo punto antiguo y pueden prolongar la espera. Con consultas encadenadas sin pausa, la réplica puede no alcanzar nunca a la primaria. Programar los reportes con holgura y alertar sobre un atraso superior a 30 minutos resuelve ambos casos.',
        },
      ],
    },
    {
      title: 'Lo que queda en el código: snapshot único, edad del dato y reintento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Incluso con la infraestructura correcta, el código que lee de la réplica debe tratar el conflicto como un resultado esperado. El error llega con SQLSTATE 40001, el mismo código de un fallo de serialización, y la elección no es casual: significa que la operación puede repetirse desde cero. En una conexión de solo lectura, repetir no tiene efectos secundarios. El conflicto también puede cerrar la sesión entera con un FATAL cuando está detenida dentro de una transacción, así que la conexión debe descartarse, no devolverse al pool.',
        },
        {
          type: 'code',
          value: appCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'Dos detalles del código valen más que el reintento. El primero es REPEATABLE READ: sin él, cada consulta del reporte abre un snapshot nuevo, y los totales y las partidas abiertas pueden ser de instantes distintos, lo que en un reporte financiero se convierte en una diferencia de centavos imposible de explicar. El segundo es devolver data_as_of: en la réplica de reportes el dato puede tener 15 minutos, y el reporte debe decir "datos hasta las 14:32" en lugar de dejar que el usuario lo descubra solo.',
        },
        {
          type: 'ordered',
          items: [
            'Alerte sobre el crecimiento de confl_snapshot y confl_lock por réplica. Un salto indica un cambio en el patrón de escritura de la primaria o un reporte nuevo sin techo.',
            'En la réplica de reportes, alerte sobre bytes_not_replayed y sobre un atraso mayor que el reporte más largo previsto. En la réplica de la aplicación el límite es de segundos.',
            'En la primaria, alerte sobre el xmin_age de las réplicas y de los slots. Es la única señal que muestra una consulta remota frenando el vacuum.',
            'Divida las exportaciones gigantes en páginas por clave. Cada consulta dura segundos y sobrevive al plazo por defecto, a costa de perder el snapshot único, algo aceptable para una exportación y no para un cierre.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Puedo activar hot_standby_feedback y aumentar max_standby_streaming_delay al mismo tiempo?',
      answer:
        'Sí, y en algunos escenarios tiene sentido, porque los dos tratan conflictos distintos: el feedback evita la mayoría de los conflictos de snapshot, y el plazo mayor cubre los de lock y buffer pin que el feedback no alcanza. El cuidado está en no sumar ambos costos sin techo. Con el feedback activo, limite la duración de las consultas en la réplica con statement_timeout por rol, para que el xmin retenido en la primaria nunca pase de unos minutos. Y mantenga el plazo de replay acorde con el uso de la réplica: segundos si atiende a la aplicación, minutos si es solo para reportes.',
    },
    {
      question: '¿Por qué no ejecutar el reporte directamente en la primaria, si allí no existe el conflicto de recuperación?',
      answer:
        'En la primaria la consulta no se cancela, pero el costo aparece de otra forma: una lectura de 11 minutos retiene el horizonte de xmin localmente, impide el vacuum por el mismo mecanismo que el feedback y además compite por caché, I/O y CPU con las transacciones de la aplicación. Es la peor combinación. Ejecutar en la primaria solo es razonable para reportes de pocos segundos o en bases pequeñas. Para el resto, la réplica dedicada aísla los dos costos: ni la primaria se hincha ni la aplicación ve datos atrasados.',
    },
    {
      question: '¿Una réplica con varios minutos de atraso sigue sirviendo como candidata a failover?',
      answer:
        'Sirve mal. En streaming, el WAL sigue llegando y escribiéndose en el disco de la réplica aunque el replay esté detenido, así que normalmente no se pierden datos. Pero antes de ser promovida debe aplicar todo lo pendiente, y ese tiempo entra directo en el tiempo de recuperación. Además, el replay detenido solo se reanuda cuando las consultas en conflicto terminan o se cancelan. Por eso la réplica de reportes no debe ser la candidata principal: deje el failover a la réplica de la aplicación, que mantiene el replay al día.',
    },
  ],
  conclusion: {
    title: 'El conflicto no desaparece, solo cambia de lugar',
    description:
      'La consulta larga en la réplica y el replay del WAL quieren cosas incompatibles, y toda configuración solo elige quién cede: la consulta, que se cancela; la primaria, que acumula tuplas muertas con hot_standby_feedback; o la réplica, que se atrasa con max_standby_streaming_delay. La buena elección depende de para qué existe la réplica. Mida el tipo de conflicto en pg_stat_database_conflicts, mantenga la réplica de la aplicación con el replay al día y consultas cortas, mueva los reportes largos a una réplica dedicada con techo de duración, y haga que el código trate el 40001 como reintento e informe la edad del dato. Así el reporte deja de fallar sin que la cuenta aparezca semanas después en otro lugar.',
    cta: 'Revisar la topología de réplicas de mi base de datos',
  },
  related: [
    {
      label: 'Réplica de lectura atrasada: cuándo el usuario guarda y no ve lo que acaba de guardar',
      to: '/blog/replica-leitura-atrasada-usuario-salva-e-nao-ve-o-que-salvou',
    },
    {
      label: 'Autovacuum que no da abasto: cuándo la tabla se hincha y la consulta se vuelve lenta sin que nada cambie',
      to: '/blog/autovacuum-que-nao-acompanha-tabela-incha-consulta-lenta-sem-mudar-nada',
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
