// Conteudo do artigo: slot de replicacao esquecido que enche o disco. Como um slot fisico ou
// logico sem consumidor retem WAL ate o disco da primaria acabar, como descobrir quem segura o
// pg_wal, como remover o slot com seguranca, quais tetos o Postgres oferece
// (max_slot_wal_keep_size e idle_replication_slot_timeout) e como monitorar antes do incidente.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const comments = {
  pt: {
    diag1: 'Quanto WAL cada slot esta segurando e se alguem esta conectado nele.',
    diag2: 'inactive_since existe a partir do Postgres 17. Em versoes anteriores, remova a coluna.',
    diag3: 'Tamanho real do pg_wal (precisa de superusuario ou do papel pg_monitor).',
    diag4: 'Arquivamento falhando tambem retem WAL: compare failed_count com archived_count.',
    drop1: '1. Confirmar o slot, o tipo e se existe processo conectado.',
    drop2: '2. Se ainda houver um consumidor conectado, pare o servico dele antes. So entao encerre o walsender.',
    drop3: '3. Remover o slot. Para slot logico, rode no mesmo banco em que ele foi criado.',
    drop4: '4. Forcar um checkpoint para o WAL que ninguem mais precisa ser removido ou reciclado.',
    cfg1: 'Teto de WAL por slot: passou disso, o slot e invalidado em vez de o disco encher.',
    cfg2: 'Postgres 18+: invalida slots sem conexao ha mais de 1 dia (verificado no checkpoint).',
    cfg3: 'Arquivos de WAL extras mantidos para replicas sem slot. Mantenha pequeno.',
    mon1: 'Estado observado de cada slot entre uma verificacao e outra.',
    mon2: 'restart_lsn nulo significa slot invalidado: o consumidor precisa ser recriado.',
    mon3: 'Sem inactive_since (antes do 17), o proprio monitor registra desde quando o slot esta parado.',
    mon4: 'Ativo mas atrasado tambem e problema: o consumidor existe e nao confirma o LSN.',
  },
  en: {
    diag1: 'How much WAL each slot is holding and whether anyone is connected to it.',
    diag2: 'inactive_since exists from Postgres 17 onward. On older versions, remove the column.',
    diag3: 'Actual size of pg_wal (requires superuser or the pg_monitor role).',
    diag4: 'Failing archiving also retains WAL: compare failed_count with archived_count.',
    drop1: '1. Confirm the slot, its type and whether a process is connected.',
    drop2: '2. If a consumer is still connected, stop its service first. Only then terminate the walsender.',
    drop3: '3. Drop the slot. For a logical slot, run it in the same database where it was created.',
    drop4: '4. Force a checkpoint so the WAL nobody needs anymore is removed or recycled.',
    cfg1: 'WAL ceiling per slot: past it, the slot is invalidated instead of the disk filling up.',
    cfg2: 'Postgres 18+: invalidates slots with no connection for more than 1 day (checked at checkpoint).',
    cfg3: 'Extra WAL files kept for replicas without a slot. Keep it small.',
    mon1: 'Observed state of each slot between one check and the next.',
    mon2: 'A null restart_lsn means the slot was invalidated: the consumer must be recreated.',
    mon3: 'Without inactive_since (before 17), the monitor itself records since when the slot is idle.',
    mon4: 'Active but lagging is also a problem: the consumer exists and does not confirm the LSN.',
  },
  es: {
    diag1: 'Cuanto WAL retiene cada slot y si hay alguien conectado a el.',
    diag2: 'inactive_since existe desde Postgres 17. En versiones anteriores, quite la columna.',
    diag3: 'Tamano real de pg_wal (requiere superusuario o el rol pg_monitor).',
    diag4: 'Un archivado que falla tambien retiene WAL: compare failed_count con archived_count.',
    drop1: '1. Confirmar el slot, el tipo y si hay un proceso conectado.',
    drop2: '2. Si aun hay un consumidor conectado, detenga su servicio antes. Solo entonces termine el walsender.',
    drop3: '3. Eliminar el slot. Para un slot logico, ejecutelo en la misma base donde fue creado.',
    drop4: '4. Forzar un checkpoint para que el WAL que nadie necesita se elimine o se recicle.',
    cfg1: 'Techo de WAL por slot: pasado ese valor, el slot se invalida en lugar de llenar el disco.',
    cfg2: 'Postgres 18+: invalida slots sin conexion hace mas de 1 dia (se verifica en el checkpoint).',
    cfg3: 'Archivos de WAL extra mantenidos para replicas sin slot. Mantengalo pequeno.',
    mon1: 'Estado observado de cada slot entre una verificacion y la siguiente.',
    mon2: 'restart_lsn nulo significa slot invalidado: el consumidor debe recrearse.',
    mon3: 'Sin inactive_since (antes de la 17), el propio monitor registra desde cuando el slot esta parado.',
    mon4: 'Activo pero atrasado tambien es un problema: el consumidor existe y no confirma el LSN.',
  },
};

const diagnosticoCode = (c) => `-- ${c.diag1}
-- ${c.diag2}
SELECT slot_name,
       slot_type,
       plugin,
       database,
       active,
       active_pid,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal,
       wal_status,
       pg_size_pretty(safe_wal_size)                                      AS safe_wal_size,
       inactive_since
  FROM pg_replication_slots
 ORDER BY pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) DESC NULLS LAST;

-- ${c.diag3}
SELECT count(*) AS wal_files, pg_size_pretty(sum(size)) AS pg_wal_size
  FROM pg_ls_waldir();

-- ${c.diag4}
SELECT archived_count, failed_count, last_failed_wal, last_failed_time
  FROM pg_stat_archiver;`;

const dropCode = (c) => `-- ${c.drop1}
SELECT slot_name, slot_type, database, active, active_pid
  FROM pg_replication_slots
 WHERE slot_name = 'debezium_orders';

-- ${c.drop2}
SELECT pg_terminate_backend(active_pid)
  FROM pg_replication_slots
 WHERE slot_name = 'debezium_orders' AND active;

-- ${c.drop3}
SELECT pg_drop_replication_slot('debezium_orders');

-- ${c.drop4}
CHECKPOINT;
SELECT pg_size_pretty(sum(size)) AS pg_wal_size FROM pg_ls_waldir();`;

const configCode = (c) => `# postgresql.conf (primaria / primary)
# ${c.cfg1}
max_slot_wal_keep_size = 80GB

# ${c.cfg2}
idle_replication_slot_timeout = 1d

# ${c.cfg3}
wal_keep_size = 1GB`;

const monitorCode = (c) => `// slot-watchdog.js
import pg from 'pg';

const RETAINED_LIMIT_BYTES = 20 * 1024 ** 3;
const INACTIVE_LIMIT_MS = 15 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 1000;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

// ${c.mon1}
const inactiveSince = new Map();

const SLOTS_SQL = \`
  SELECT slot_name,
         slot_type,
         active,
         wal_status,
         pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)::bigint AS retained_bytes
    FROM pg_replication_slots\`;

async function sendAlert(text) {
  console.error(text);
  if (!process.env.ALERT_WEBHOOK_URL) return;
  await fetch(process.env.ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text }),
  });
}

export async function checkSlots(now = Date.now()) {
  const { rows } = await pool.query(SLOTS_SQL);
  const alerts = [];
  const seen = new Set();

  for (const slot of rows) {
    seen.add(slot.slot_name);
    const gib = (Number(slot.retained_bytes ?? 0) / 1024 ** 3).toFixed(1);

    // ${c.mon2}
    if (slot.retained_bytes === null || slot.wal_status === 'lost') {
      alerts.push(\`slot \${slot.slot_name} invalidated (wal_status=\${slot.wal_status})\`);
      continue;
    }

    // ${c.mon3}
    if (slot.active) {
      inactiveSince.delete(slot.slot_name);
    } else if (!inactiveSince.has(slot.slot_name)) {
      inactiveSince.set(slot.slot_name, now);
    }

    const idleMs = slot.active ? 0 : now - inactiveSince.get(slot.slot_name);
    if (idleMs > INACTIVE_LIMIT_MS) {
      alerts.push(\`slot \${slot.slot_name} (\${slot.slot_type}) idle for \${Math.round(idleMs / 60000)} min, holding \${gib} GiB\`);
    } else if (Number(slot.retained_bytes) > RETAINED_LIMIT_BYTES) {
      // ${c.mon4}
      alerts.push(\`slot \${slot.slot_name} active=\${slot.active} holding \${gib} GiB (wal_status=\${slot.wal_status})\`);
    }
  }

  for (const name of inactiveSince.keys()) {
    if (!seen.has(name)) inactiveSince.delete(name);
  }

  if (alerts.length > 0) await sendAlert(alerts.join('\\n'));
  return alerts;
}

setInterval(() => {
  checkSlots().catch((error) => console.error('slot check failed', error));
}, CHECK_EVERY_MS);`;

const diagramaPt = `Dia 0   pipeline de analytics migrado; conector Debezium antigo desligado
        slot logico "debezium_orders" continua na primaria (active = false)
        restart_lsn congela no ultimo LSN confirmado

Dia 1..8  primaria gera ~40 GB de WAL por dia
          checkpoint quer reciclar segmentos antigos, mas o slot ainda "precisa" deles
          pg_wal: 1 GB -> 40 GB -> 120 GB -> ... -> 320 GB
          volume de 500 GB: dados 150 GB + pg_wal crescendo

Dia 8, 22:10  alerta de disco em 90%: tratado como crescimento normal de dados
Dia 9, 03:42  PANIC: could not write to file "pg_wal/xlogtemp.48121": No space left on device
              primaria fora do ar, API e workers parados

Correcao: pg_drop_replication_slot('debezium_orders') + CHECKPOINT
          pg_wal volta para ~2 GB em menos de 1 minuto`;

const diagramaEn = `Day 0   analytics pipeline migrated; old Debezium connector turned off
        logical slot "debezium_orders" stays on the primary (active = false)
        restart_lsn freezes at the last confirmed LSN

Day 1..8  primary generates ~40 GB of WAL per day
          checkpoint wants to recycle old segments, but the slot still "needs" them
          pg_wal: 1 GB -> 40 GB -> 120 GB -> ... -> 320 GB
          500 GB volume: 150 GB of data + growing pg_wal

Day 8, 22:10  disk alert at 90%: treated as normal data growth
Day 9, 03:42  PANIC: could not write to file "pg_wal/xlogtemp.48121": No space left on device
              primary down, API and workers stopped

Fix: pg_drop_replication_slot('debezium_orders') + CHECKPOINT
     pg_wal back to ~2 GB in less than 1 minute`;

const diagramaEs = `Dia 0   pipeline de analytics migrado; conector Debezium antiguo apagado
        el slot logico "debezium_orders" sigue en la primaria (active = false)
        restart_lsn se congela en el ultimo LSN confirmado

Dia 1..8  la primaria genera ~40 GB de WAL por dia
          el checkpoint quiere reciclar segmentos antiguos, pero el slot aun los "necesita"
          pg_wal: 1 GB -> 40 GB -> 120 GB -> ... -> 320 GB
          volumen de 500 GB: datos 150 GB + pg_wal creciendo

Dia 8, 22:10  alerta de disco en 90%: tratada como crecimiento normal de datos
Dia 9, 03:42  PANIC: could not write to file "pg_wal/xlogtemp.48121": No space left on device
              primaria caida, API y workers detenidos

Correccion: pg_drop_replication_slot('debezium_orders') + CHECKPOINT
            pg_wal vuelve a ~2 GB en menos de 1 minuto`;

const pt = {
  intro:
    'Às 3h42 de um sábado, a primária de um e-commerce parou de aceitar escrita com "PANIC: could not write to file ... No space left on device". O banco tinha 150 GB de dados num volume de 500 GB, e os dados não tinham crescido de forma anormal. Quem ocupava os outros 320 GB era o diretório pg_wal, cheio de segmentos que o Postgres não podia apagar porque um slot de replicação ainda dizia precisar deles. O slot pertencia a um conector Debezium desligado nove dias antes, numa migração do pipeline de analytics. Ninguém lembrou de removê-lo, e o Postgres fez exatamente o que um slot promete: guardar todo o WAL até o consumidor confirmar que leu. Este artigo explica como o slot retém WAL (e o que mais ele segura), como descobrir em poucos minutos quem está enchendo o pg_wal, como remover um slot sem piorar o incidente, quais tetos o Postgres oferece para isso nunca derrubar a primária e como monitorar antes de chegar perto do limite.',
  sections: [
    {
      title: 'O disco que encheu sem o banco crescer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O time de dados tinha trocado o pipeline de analytics: saiu um conector Debezium que lia a tabela de pedidos por replicação lógica, entrou uma exportação incremental para o data warehouse. O conector foi desligado, o serviço removido do cluster e o ticket fechado. O slot lógico debezium_orders, criado pelo conector na primeira execução, continuou existindo na primária. Um slot não depende de o consumidor estar vivo. Ele é um objeto persistente do servidor, sobrevive a reinícios e não expira por padrão.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'Dois sinais foram ignorados porque pareciam normais. O alerta de disco em 90% disparou na noite anterior e foi lido como crescimento de dados, já que ninguém olhava o tamanho do pg_wal separado do tamanho das tabelas. E o painel de replicação mostrava a réplica física em dia, com atraso de milissegundos, porque o slot problemático não era dela. O incidente só foi entendido quando alguém rodou du no diretório de dados e viu 320 GB dentro do pg_wal.',
        },
        {
          type: 'paragraph',
          value:
            'O primeiro impulso do plantão foi apagar arquivos antigos do pg_wal para liberar espaço. Isso teria sido o pior desfecho possível: os segmentos ali incluem o WAL necessário para a recuperação após a queda, e apagar o arquivo errado transforma um disco cheio em um banco que não sobe ou em dados corrompidos. A correção certa levou três comandos SQL, mas só depois de liberar espaço fora do pg_wal para a primária conseguir iniciar.',
        },
      ],
    },
    {
      title: 'Como o slot segura o WAL: restart_lsn, confirmed_flush_lsn e catalog_xmin',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Sem slots, o Postgres recicla os segmentos de WAL depois de cada checkpoint, mantendo só o necessário para recuperação, para o arquivamento e para wal_keep_size. Uma réplica que fica para trás além disso perde o WAL de que precisa e tem de ser reconstruída. O slot resolve esse problema invertendo a responsabilidade: a primária passa a guardar todo segmento a partir do restart_lsn do slot até que o consumidor avance. Para a réplica, é uma garantia. Para a primária, é uma promessa sem prazo.',
        },
        {
          type: 'list',
          items: [
            'restart_lsn: o LSN mais antigo que o slot ainda pode precisar. Todo segmento de WAL a partir dele fica no disco. Num slot parado, ele congela, e o WAL retido cresce na mesma velocidade em que a primária escreve.',
            'confirmed_flush_lsn (só em slots lógicos): até onde o consumidor confirmou ter processado as mudanças. O restart_lsn avança conforme essa confirmação avança.',
            'xmin (slots físicos com hot_standby_feedback): impede o vacuum de remover versões de linha que a réplica ainda pode ler. Um slot físico parado congela esse horizonte e a primária acumula tuplas mortas.',
            'catalog_xmin (slots lógicos): impede o vacuum de limpar o catálogo do sistema, porque a decodificação lógica precisa da definição das tabelas no instante de cada mudança. Um slot lógico parado faz pg_class, pg_attribute e afins incharem, o que pesa em toda consulta que consulta o catálogo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O volume retido é previsível: taxa de geração de WAL vezes o tempo parado. Uma primária que gera 40 GB por dia enche 320 GB em oito dias. Medir essa taxa é simples: anote pg_current_wal_lsn() em dois momentos e calcule pg_wal_lsn_diff entre eles. Com ela, o "quanto tempo até o disco acabar" deixa de ser palpite.',
        },
        {
          type: 'paragraph',
          value:
            'Um detalhe engana bastante gente: um slot ativo também pode reter WAL sem limite. Um conector Debezium conectado a um banco onde as tabelas monitoradas quase não mudam, mas outras tabelas mudam muito, recebe pouca coisa para confirmar e não avança o confirmed_flush_lsn. O slot aparece como active = true, o painel fica verde e o WAL retido sobe do mesmo jeito. A solução no Debezium é heartbeat.interval.ms com heartbeat.action.query gravando numa tabela de heartbeat incluída na publicação, para que sempre haja uma mudança a confirmar.',
        },
      ],
    },
    {
      title: 'Diagnóstico: quem está segurando o pg_wal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de remover qualquer coisa, três consultas na primária dizem quem é o responsável. A primeira lista os slots ordenados pelo WAL que cada um retém, com o status da retenção. A segunda mede o tamanho real do pg_wal. A terceira descarta a outra causa comum de pg_wal grande: arquivamento falhando, que também impede a reciclagem dos segmentos.',
        },
        {
          type: 'code',
          value: diagnosticoCode(comments.pt),
        },
        {
          type: 'table',
          columns: ['Causa', 'Sinal nas consultas', 'Ação'],
          rows: [
            ['Slot sem consumidor', 'active = false e retained_wal crescendo a cada hora', 'Confirmar o dono e remover o slot'],
            ['Consumidor ativo e atrasado', 'active = true, retained_wal alto e confirmed_flush_lsn parado', 'Investigar o consumidor; no Debezium, configurar heartbeat'],
            ['Réplica física fora do ar', 'Slot físico com active = false, réplica ausente em pg_stat_replication', 'Religar a réplica ou remover o slot e reconstruí-la depois'],
            ['archive_command falhando', 'failed_count subindo e last_failed_wal recente em pg_stat_archiver', 'Corrigir o destino do arquivamento; o WAL sai sozinho depois'],
            ['wal_keep_size alto demais', 'Nenhum slot retendo muito e pg_wal estável num valor grande', 'Reduzir wal_keep_size e usar slots para as réplicas'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A coluna wal_status resume o risco. reserved significa que o WAL retido cabe em max_wal_size. extended significa que passou disso, mas ainda está garantido. unreserved significa que o slot ultrapassou max_slot_wal_keep_size e pode perder WAL no próximo checkpoint. lost significa que já perdeu: o slot foi invalidado e o consumidor não consegue mais continuar de onde parou. safe_wal_size mostra quantos bytes ainda podem ser escritos antes de o slot entrar em unreserved, e é nulo quando não há teto configurado.',
        },
      ],
    },
    {
      title: 'Remover o slot com segurança, e o que nunca fazer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com o dono identificado e confirmado que ninguém depende do slot, a remoção é curta. A ordem importa porque não é possível remover um slot com um processo conectado nele, e encerrar o walsender de um consumidor que continua rodando só faz ele reconectar ou recriar o slot.',
        },
        {
          type: 'code',
          value: dropCode(comments.pt),
        },
        {
          type: 'ordered',
          items: [
            'Se a primária já caiu por disco cheio, libere espaço fora do pg_wal: aumente o volume, mova logs do servidor ou apague arquivos temporários que não pertencem ao Postgres. Ela precisa de alguns megabytes para concluir a recuperação e aceitar conexões.',
            'Nunca apague arquivos dentro do pg_wal manualmente nem use pg_resetwal para "limpar". O WAL ali inclui o que é necessário para a recuperação após a queda, e apagar o segmento errado corrompe o banco.',
            'Antes de remover um slot lógico de um consumidor que ainda importa, saiba que ele vai precisar de uma nova carga completa. O WAL entre o último LSN confirmado e agora deixa de existir para ele.',
            'Remover o slot de uma réplica física que vai voltar tem o mesmo efeito: ela não encontra mais o WAL de que precisa e tem de ser reconstruída com pg_basebackup.',
            'Depois do CHECKPOINT, confirme que pg_wal_size caiu e que wal_status dos slots restantes voltou a reserved.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Slots esquecidos costumam nascer de processos que criam o slot automaticamente: conectores de CDC, pg_basebackup com -C para uma réplica que depois é desligada, testes com pg_recvlogical e upgrades por replicação lógica. Neste último caso, um DROP SUBSCRIPTION feito depois de ALTER SUBSCRIPTION ... SET (slot_name = NONE), ou sem conexão com o publicador, deixa o slot para trás no servidor de origem. Toda remoção de consumidor precisa ter "remover o slot" como passo explícito do runbook.',
        },
      ],
    },
    {
      title: 'Um teto para o slot: max_slot_wal_keep_size e idle_replication_slot_timeout',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O valor padrão de max_slot_wal_keep_size é -1, sem limite. Isso significa que, por padrão, qualquer consumidor esquecido pode derrubar a primária. Configurar um teto troca o modo de falha: em vez de o disco encher e o banco parar, o slot que passar do limite é invalidado e só aquele consumidor perde a continuidade. Para um sistema de produção, é quase sempre a troca certa.',
        },
        {
          type: 'code',
          value: configCode(comments.pt),
        },
        {
          type: 'table',
          columns: ['Configuração', 'O que acontece com o slot esquecido', 'Quem paga'],
          rows: [
            ['Padrão (sem teto)', 'Retém WAL até o disco acabar', 'A primária inteira, que para de aceitar escrita'],
            ['max_slot_wal_keep_size = 80GB', 'Invalidado ao passar de 80 GB de WAL retido', 'Só o consumidor, que precisa ser recriado ou recarregado'],
            ['idle_replication_slot_timeout = 1d (Postgres 18+)', 'Invalidado após 1 dia sem conexão, mesmo com pouco WAL retido', 'Só o consumidor parado, e o catalog_xmin deixa de segurar o vacuum'],
            ['Monitoramento com alerta', 'Alguém é avisado antes de qualquer limite', 'Ninguém, se o alerta tiver dono e runbook'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O teto precisa caber no disco com folga e ser maior que a pior parada legítima. Se uma réplica pode ficar até 6 horas em manutenção e a primária gera 2 GB de WAL por hora, ela precisa de pelo menos 12 GB, e 80 GB num disco com 300 GB livres deixa margem para picos de escrita e para o próprio max_wal_size. O idle_replication_slot_timeout complementa o teto de volume: ele pega o slot lógico parado num banco de pouca escrita, que nunca chegaria aos 80 GB mas segura o catalog_xmin por semanas. Os dois são verificados no checkpoint, então a invalidação não é instantânea.',
        },
      ],
    },
    {
      title: 'Monitorar antes de encher: alerta por slot, não só por disco',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O alerta de disco chegou tarde e sem contexto. O que faltava era um alerta que nomeasse o slot. O monitor abaixo roda a cada minuto, lê pg_replication_slots e avisa em dois casos: slot parado há mais de 15 minutos ou slot retendo mais de 20 GB, mesmo ativo. O usuário de banco dele precisa apenas do papel pg_monitor.',
        },
        {
          type: 'code',
          value: monitorCode(comments.pt),
        },
        {
          type: 'list',
          items: [
            'Separe o tamanho do pg_wal do tamanho dos dados nos painéis. Disco subindo com tabelas estáveis é quase sempre WAL retido.',
            'Alerte sobre wal_status diferente de reserved. extended é aceitável por pouco tempo; unreserved e lost exigem ação imediata.',
            'Inclua na revisão mensal a lista de slots com o dono de cada um. Um slot sem dono conhecido é candidato a remoção.',
            'Em serviços gerenciados, a métrica de "uso de disco por logs de transação" do provedor mostra o mesmo sintoma. Os tetos acima funcionam também ali, a partir do Postgres 13.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Se eu configurar max_slot_wal_keep_size, posso perder dados?',
      answer:
        'A primária não perde nada: o teto só decide até quando ela guarda WAL para um consumidor atrasado. Quem perde é o consumidor do slot invalidado, que não consegue mais continuar do ponto onde parou. Uma réplica física precisa ser reconstruída com pg_basebackup, e um consumidor lógico, como um conector de CDC, precisa de uma nova carga completa para não ficar com lacuna. É uma perda de continuidade de um consumidor, trocada pela disponibilidade da primária inteira.',
    },
    {
      question: 'Por que o slot aparece ativo e mesmo assim o WAL retido não para de subir?',
      answer:
        'Porque estar conectado não é o mesmo que confirmar. O restart_lsn só avança quando o consumidor confirma ter processado as mudanças, e alguns consumidores só confirmam quando recebem algo relevante. No Debezium, um banco com muita escrita em tabelas fora da publicação e pouca nas tabelas monitoradas produz exatamente isso. Configurar heartbeat.action.query, gravando numa tabela incluída na publicação, garante uma mudança periódica para confirmar. Em outros consumidores, verifique se a confirmação de LSN acontece depois do processamento e se não está travada por erro silencioso.',
    },
    {
      question: 'Réplicas devem usar slot físico ou wal_keep_size?',
      answer:
        'Slot, com teto. wal_keep_size guarda uma quantidade fixa de WAL para todas as réplicas, ocupa esse espaço o tempo todo e ainda assim falha se a réplica atrasar mais do que o valor. O slot guarda exatamente o necessário para cada réplica e, com max_slot_wal_keep_size, deixa de ser um risco para o disco. A combinação prática é slot físico por réplica, teto dimensionado pela pior manutenção esperada e wal_keep_size pequeno ou zero.',
    },
  ],
  conclusion: {
    title: 'Todo slot precisa de dono, teto e alerta',
    description:
      'Um slot de replicação é uma promessa sem prazo: guardar todo o WAL até o consumidor voltar. Quando o consumidor morre ou é desligado sem que alguém remova o slot, a primária cumpre a promessa até o disco acabar, e ainda segura o vacuum pelo xmin ou pelo catalog_xmin no caminho. A prevenção é barata: medir o WAL retido por slot, configurar max_slot_wal_keep_size e, no Postgres 18, idle_replication_slot_timeout, alertar pelo nome do slot e não só pelo disco, e incluir a remoção do slot em todo runbook de desligamento de consumidor. Com isso, um conector esquecido vira um aviso no canal de alertas, não uma primária fora do ar às 3h da manhã.',
    cta: 'Revisar a replicação e os alertas do meu banco',
  },
  related: [
    {
      label: 'Upgrade de versão major do Postgres sem janela: replicação lógica para trocar de versão com tráfego ligado',
      to: '/blog/upgrade-de-versao-major-do-postgres-sem-janela-replicacao-logica-para-trocar-de-versao-com-trafego-ligado',
    },
    {
      label: 'Consulta de relatório na réplica que cancela sozinha: conflito de recuperação e hot_standby_feedback',
      to: '/blog/consulta-de-relatorio-na-replica-que-cancela-sozinha-conflito-de-recuperacao-e-hot-standby-feedback',
    },
    {
      label: 'Serviço de observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'At 3:42 on a Saturday morning, the primary of an e-commerce company stopped accepting writes with "PANIC: could not write to file ... No space left on device". The database held 150 GB of data on a 500 GB volume, and the data had not grown abnormally. The other 320 GB were taken by the pg_wal directory, full of segments Postgres could not delete because a replication slot still claimed to need them. The slot belonged to a Debezium connector turned off nine days earlier, during a migration of the analytics pipeline. Nobody remembered to drop it, and Postgres did exactly what a slot promises: keep all WAL until the consumer confirms it has read it. This article explains how a slot retains WAL (and what else it holds back), how to find out within minutes who is filling pg_wal, how to drop a slot without making the incident worse, which ceilings Postgres offers so this never takes the primary down, and how to monitor before getting close to the limit.',
  sections: [
    {
      title: 'The disk that filled up without the database growing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The data team had replaced the analytics pipeline: out went a Debezium connector reading the orders table through logical replication, in came an incremental export to the data warehouse. The connector was turned off, the service removed from the cluster and the ticket closed. The logical slot debezium_orders, created by the connector on its first run, kept existing on the primary. A slot does not depend on its consumer being alive. It is a persistent server object, it survives restarts and it does not expire by default.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'Two signals were ignored because they looked normal. The 90% disk alert fired the night before and was read as data growth, since nobody looked at the size of pg_wal separately from the size of the tables. And the replication dashboard showed the physical replica up to date, with millisecond lag, because the problematic slot was not its slot. The incident was only understood when someone ran du on the data directory and saw 320 GB inside pg_wal.',
        },
        {
          type: 'paragraph',
          value:
            'The first impulse of the on-call engineer was to delete old files from pg_wal to free space. That would have been the worst possible outcome: the segments there include the WAL needed for crash recovery, and deleting the wrong file turns a full disk into a database that does not start or into corrupted data. The right fix took three SQL commands, but only after freeing space outside pg_wal so the primary could start.',
        },
      ],
    },
    {
      title: 'How the slot holds WAL: restart_lsn, confirmed_flush_lsn and catalog_xmin',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Without slots, Postgres recycles WAL segments after each checkpoint, keeping only what is needed for recovery, for archiving and for wal_keep_size. A replica that falls behind beyond that loses the WAL it needs and has to be rebuilt. The slot solves this by inverting the responsibility: the primary keeps every segment from the restart_lsn of the slot onward until the consumer moves forward. For the replica it is a guarantee. For the primary it is a promise with no deadline.',
        },
        {
          type: 'list',
          items: [
            'restart_lsn: the oldest LSN the slot may still need. Every WAL segment from it onward stays on disk. On an idle slot it freezes, and retained WAL grows at the same speed the primary writes.',
            'confirmed_flush_lsn (logical slots only): how far the consumer has confirmed processing changes. restart_lsn advances as this confirmation advances.',
            'xmin (physical slots with hot_standby_feedback): prevents vacuum from removing row versions the replica may still read. An idle physical slot freezes that horizon and the primary piles up dead tuples.',
            'catalog_xmin (logical slots): prevents vacuum from cleaning the system catalog, because logical decoding needs the table definitions as of each change. An idle logical slot makes pg_class, pg_attribute and friends bloat, which weighs on every query that touches the catalog.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The retained volume is predictable: WAL generation rate times idle time. A primary that generates 40 GB per day fills 320 GB in eight days. Measuring that rate is simple: record pg_current_wal_lsn() at two moments and compute pg_wal_lsn_diff between them. With it, "how long until the disk runs out" stops being a guess.',
        },
        {
          type: 'paragraph',
          value:
            'One detail fools a lot of people: an active slot can also retain WAL without limit. A Debezium connector attached to a database where the monitored tables barely change, while other tables change a lot, receives little to confirm and does not advance confirmed_flush_lsn. The slot shows active = true, the dashboard stays green and retained WAL climbs just the same. The fix in Debezium is heartbeat.interval.ms with heartbeat.action.query writing to a heartbeat table included in the publication, so there is always a change to confirm.',
        },
      ],
    },
    {
      title: 'Diagnosis: who is holding pg_wal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before dropping anything, three queries on the primary tell you who is responsible. The first lists slots ordered by the WAL each one retains, with the retention status. The second measures the actual size of pg_wal. The third rules out the other common cause of a large pg_wal: failing archiving, which also prevents segments from being recycled.',
        },
        {
          type: 'code',
          value: diagnosticoCode(comments.en),
        },
        {
          type: 'table',
          columns: ['Cause', 'Signal in the queries', 'Action'],
          rows: [
            ['Slot with no consumer', 'active = false and retained_wal growing every hour', 'Confirm the owner and drop the slot'],
            ['Active consumer that is lagging', 'active = true, high retained_wal and confirmed_flush_lsn not moving', 'Investigate the consumer; in Debezium, configure a heartbeat'],
            ['Physical replica down', 'Physical slot with active = false, replica missing from pg_stat_replication', 'Bring the replica back or drop the slot and rebuild it later'],
            ['Failing archive_command', 'failed_count rising and a recent last_failed_wal in pg_stat_archiver', 'Fix the archive destination; the WAL goes away on its own afterwards'],
            ['wal_keep_size set too high', 'No slot retaining much and pg_wal stable at a large value', 'Reduce wal_keep_size and use slots for the replicas'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The wal_status column summarizes the risk. reserved means the retained WAL fits within max_wal_size. extended means it went beyond that but is still guaranteed. unreserved means the slot exceeded max_slot_wal_keep_size and may lose WAL at the next checkpoint. lost means it already has: the slot was invalidated and the consumer can no longer continue from where it stopped. safe_wal_size shows how many bytes can still be written before the slot becomes unreserved, and it is null when no ceiling is configured.',
        },
      ],
    },
    {
      title: 'Dropping the slot safely, and what never to do',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the owner identified and confirmation that nobody depends on the slot, dropping it is short. The order matters because a slot cannot be dropped while a process is connected to it, and terminating the walsender of a consumer that is still running only makes it reconnect or recreate the slot.',
        },
        {
          type: 'code',
          value: dropCode(comments.en),
        },
        {
          type: 'ordered',
          items: [
            'If the primary has already gone down because of a full disk, free space outside pg_wal: grow the volume, move server logs or delete temporary files that do not belong to Postgres. It needs a few megabytes to finish recovery and accept connections.',
            'Never delete files inside pg_wal by hand or use pg_resetwal to "clean up". The WAL there includes what crash recovery needs, and deleting the wrong segment corrupts the database.',
            'Before dropping a logical slot whose consumer still matters, know that it will need a new full load. The WAL between the last confirmed LSN and now no longer exists for it.',
            'Dropping the slot of a physical replica that will come back has the same effect: it no longer finds the WAL it needs and has to be rebuilt with pg_basebackup.',
            'After the CHECKPOINT, confirm that pg_wal_size dropped and that wal_status of the remaining slots is back to reserved.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Forgotten slots usually come from processes that create the slot automatically: CDC connectors, pg_basebackup with -C for a replica that is later shut down, tests with pg_recvlogical and upgrades through logical replication. In that last case, a DROP SUBSCRIPTION issued after ALTER SUBSCRIPTION ... SET (slot_name = NONE), or without a connection to the publisher, leaves the slot behind on the source server. Every consumer removal needs "drop the slot" as an explicit runbook step.',
        },
      ],
    },
    {
      title: 'A ceiling for the slot: max_slot_wal_keep_size and idle_replication_slot_timeout',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The default value of max_slot_wal_keep_size is -1, no limit. That means that, by default, any forgotten consumer can take the primary down. Setting a ceiling changes the failure mode: instead of the disk filling up and the database stopping, the slot that crosses the limit is invalidated and only that consumer loses continuity. For a production system it is almost always the right trade.',
        },
        {
          type: 'code',
          value: configCode(comments.en),
        },
        {
          type: 'table',
          columns: ['Configuration', 'What happens to the forgotten slot', 'Who pays'],
          rows: [
            ['Default (no ceiling)', 'Retains WAL until the disk runs out', 'The whole primary, which stops accepting writes'],
            ['max_slot_wal_keep_size = 80GB', 'Invalidated when retained WAL passes 80 GB', 'Only the consumer, which must be recreated or reloaded'],
            ['idle_replication_slot_timeout = 1d (Postgres 18+)', 'Invalidated after 1 day without a connection, even with little WAL retained', 'Only the idle consumer, and catalog_xmin stops holding vacuum back'],
            ['Monitoring with alerts', 'Someone is notified before any limit', 'Nobody, if the alert has an owner and a runbook'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The ceiling must fit on the disk with room to spare and be larger than the worst legitimate outage. If a replica may spend up to 6 hours in maintenance and the primary generates 2 GB of WAL per hour, it needs at least 12 GB, and 80 GB on a disk with 300 GB free leaves margin for write spikes and for max_wal_size itself. idle_replication_slot_timeout complements the volume ceiling: it catches the idle logical slot on a low write database, which would never reach 80 GB but holds catalog_xmin for weeks. Both are checked at checkpoint, so invalidation is not instantaneous.',
        },
      ],
    },
    {
      title: 'Monitor before it fills: alert per slot, not just per disk',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The disk alert came late and without context. What was missing was an alert that named the slot. The monitor below runs every minute, reads pg_replication_slots and warns in two cases: a slot idle for more than 15 minutes or a slot retaining more than 20 GB, even when active. Its database user only needs the pg_monitor role.',
        },
        {
          type: 'code',
          value: monitorCode(comments.en),
        },
        {
          type: 'list',
          items: [
            'Separate pg_wal size from data size on dashboards. Disk climbing with stable tables is almost always retained WAL.',
            'Alert on wal_status other than reserved. extended is acceptable for a short time; unreserved and lost require immediate action.',
            'Include the list of slots, with the owner of each one, in the monthly review. A slot with no known owner is a candidate for removal.',
            'On managed services, the provider metric for "disk used by transaction logs" shows the same symptom. The ceilings above also work there, from Postgres 13 onward.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'If I set max_slot_wal_keep_size, can I lose data?',
      answer:
        'The primary loses nothing: the ceiling only decides how long it keeps WAL for a lagging consumer. The one that loses is the consumer of the invalidated slot, which can no longer continue from where it stopped. A physical replica must be rebuilt with pg_basebackup, and a logical consumer, such as a CDC connector, needs a new full load to avoid a gap. It is a loss of continuity for one consumer, traded for the availability of the whole primary.',
    },
    {
      question: 'Why does the slot show as active while retained WAL keeps climbing?',
      answer:
        'Because being connected is not the same as confirming. restart_lsn only advances when the consumer confirms it has processed the changes, and some consumers only confirm when they receive something relevant. In Debezium, a database with heavy writes on tables outside the publication and few on the monitored tables produces exactly this. Configuring heartbeat.action.query, writing to a table included in the publication, guarantees a periodic change to confirm. For other consumers, check that LSN confirmation happens after processing and is not stuck on a silent error.',
    },
    {
      question: 'Should replicas use a physical slot or wal_keep_size?',
      answer:
        'A slot, with a ceiling. wal_keep_size keeps a fixed amount of WAL for all replicas, takes that space all the time and still fails if a replica lags beyond the value. A slot keeps exactly what each replica needs and, with max_slot_wal_keep_size, stops being a risk to the disk. The practical combination is one physical slot per replica, a ceiling sized by the worst expected maintenance window and a small or zero wal_keep_size.',
    },
  ],
  conclusion: {
    title: 'Every slot needs an owner, a ceiling and an alert',
    description:
      'A replication slot is a promise with no deadline: keep all WAL until the consumer comes back. When the consumer dies or is turned off without anyone dropping the slot, the primary keeps that promise until the disk runs out, and holds vacuum back through xmin or catalog_xmin along the way. Prevention is cheap: measure retained WAL per slot, set max_slot_wal_keep_size and, on Postgres 18, idle_replication_slot_timeout, alert by slot name and not just by disk, and include dropping the slot in every consumer shutdown runbook. With that, a forgotten connector becomes a message in the alerts channel, not a primary down at 3 in the morning.',
    cta: 'Review replication and alerting on my database',
  },
  related: [
    {
      label: 'Major Postgres version upgrade without downtime: logical replication to switch versions with traffic on',
      to: '/blog/upgrade-de-versao-major-do-postgres-sem-janela-replicacao-logica-para-trocar-de-versao-com-trafego-ligado',
    },
    {
      label: 'The report query on the replica that cancels itself: recovery conflicts and hot_standby_feedback',
      to: '/blog/consulta-de-relatorio-na-replica-que-cancela-sozinha-conflito-de-recuperacao-e-hot-standby-feedback',
    },
    {
      label: 'Observability and reliability service',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'A las 3:42 de un sábado, la primaria de un e-commerce dejó de aceptar escrituras con "PANIC: could not write to file ... No space left on device". La base tenía 150 GB de datos en un volumen de 500 GB, y los datos no habían crecido de forma anormal. Los otros 320 GB los ocupaba el directorio pg_wal, lleno de segmentos que Postgres no podía borrar porque un slot de replicación todavía decía necesitarlos. El slot pertenecía a un conector Debezium apagado nueve días antes, en una migración del pipeline de analytics. Nadie se acordó de eliminarlo, y Postgres hizo exactamente lo que un slot promete: guardar todo el WAL hasta que el consumidor confirme que lo leyó. Este artículo explica cómo el slot retiene WAL (y qué más retiene), cómo descubrir en pocos minutos quién está llenando pg_wal, cómo eliminar un slot sin empeorar el incidente, qué techos ofrece Postgres para que esto nunca tumbe la primaria y cómo monitorear antes de acercarse al límite.',
  sections: [
    {
      title: 'El disco que se llenó sin que la base creciera',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El equipo de datos había cambiado el pipeline de analytics: salió un conector Debezium que leía la tabla de pedidos por replicación lógica y entró una exportación incremental al data warehouse. El conector se apagó, el servicio se quitó del clúster y el ticket se cerró. El slot lógico debezium_orders, creado por el conector en su primera ejecución, siguió existiendo en la primaria. Un slot no depende de que el consumidor esté vivo. Es un objeto persistente del servidor, sobrevive a los reinicios y no expira por defecto.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'Dos señales se ignoraron porque parecían normales. La alerta de disco al 90% saltó la noche anterior y se leyó como crecimiento de datos, ya que nadie miraba el tamaño de pg_wal por separado del tamaño de las tablas. Y el panel de replicación mostraba la réplica física al día, con atraso de milisegundos, porque el slot problemático no era el suyo. El incidente solo se entendió cuando alguien ejecutó du en el directorio de datos y vio 320 GB dentro de pg_wal.',
        },
        {
          type: 'paragraph',
          value:
            'El primer impulso de la guardia fue borrar archivos antiguos de pg_wal para liberar espacio. Ese habría sido el peor desenlace posible: los segmentos de ahí incluyen el WAL necesario para la recuperación tras la caída, y borrar el archivo equivocado convierte un disco lleno en una base que no arranca o en datos corruptos. La corrección correcta llevó tres comandos SQL, pero solo después de liberar espacio fuera de pg_wal para que la primaria pudiera arrancar.',
        },
      ],
    },
    {
      title: 'Cómo el slot retiene el WAL: restart_lsn, confirmed_flush_lsn y catalog_xmin',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Sin slots, Postgres recicla los segmentos de WAL después de cada checkpoint y mantiene solo lo necesario para la recuperación, el archivado y wal_keep_size. Una réplica que se atrasa más allá de eso pierde el WAL que necesita y hay que reconstruirla. El slot resuelve ese problema invirtiendo la responsabilidad: la primaria pasa a guardar todo segmento desde el restart_lsn del slot hasta que el consumidor avance. Para la réplica es una garantía. Para la primaria es una promesa sin plazo.',
        },
        {
          type: 'list',
          items: [
            'restart_lsn: el LSN más antiguo que el slot todavía puede necesitar. Todo segmento de WAL desde ahí queda en el disco. En un slot parado se congela, y el WAL retenido crece a la misma velocidad a la que escribe la primaria.',
            'confirmed_flush_lsn (solo en slots lógicos): hasta dónde el consumidor confirmó haber procesado los cambios. El restart_lsn avanza a medida que avanza esa confirmación.',
            'xmin (slots físicos con hot_standby_feedback): impide que el vacuum elimine versiones de fila que la réplica todavía puede leer. Un slot físico parado congela ese horizonte y la primaria acumula tuplas muertas.',
            'catalog_xmin (slots lógicos): impide que el vacuum limpie el catálogo del sistema, porque la decodificación lógica necesita la definición de las tablas en el instante de cada cambio. Un slot lógico parado hace que pg_class, pg_attribute y similares se hinchen, lo que pesa en toda consulta que toca el catálogo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El volumen retenido es predecible: tasa de generación de WAL por tiempo parado. Una primaria que genera 40 GB por día llena 320 GB en ocho días. Medir esa tasa es simple: anote pg_current_wal_lsn() en dos momentos y calcule pg_wal_lsn_diff entre ellos. Con ella, el "cuánto falta para que se acabe el disco" deja de ser una suposición.',
        },
        {
          type: 'paragraph',
          value:
            'Un detalle engaña a mucha gente: un slot activo también puede retener WAL sin límite. Un conector Debezium conectado a una base donde las tablas monitoreadas casi no cambian, pero otras tablas cambian mucho, recibe poco que confirmar y no avanza el confirmed_flush_lsn. El slot aparece como active = true, el panel queda en verde y el WAL retenido sube igual. La solución en Debezium es heartbeat.interval.ms con heartbeat.action.query escribiendo en una tabla de heartbeat incluida en la publicación, para que siempre haya un cambio que confirmar.',
        },
      ],
    },
    {
      title: 'Diagnóstico: quién está reteniendo pg_wal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de eliminar nada, tres consultas en la primaria dicen quién es el responsable. La primera lista los slots ordenados por el WAL que retiene cada uno, con el estado de la retención. La segunda mide el tamaño real de pg_wal. La tercera descarta la otra causa común de un pg_wal grande: un archivado que falla, que también impide reciclar los segmentos.',
        },
        {
          type: 'code',
          value: diagnosticoCode(comments.es),
        },
        {
          type: 'table',
          columns: ['Causa', 'Señal en las consultas', 'Acción'],
          rows: [
            ['Slot sin consumidor', 'active = false y retained_wal creciendo cada hora', 'Confirmar el dueño y eliminar el slot'],
            ['Consumidor activo y atrasado', 'active = true, retained_wal alto y confirmed_flush_lsn detenido', 'Investigar el consumidor; en Debezium, configurar heartbeat'],
            ['Réplica física caída', 'Slot físico con active = false, réplica ausente en pg_stat_replication', 'Levantar la réplica o eliminar el slot y reconstruirla después'],
            ['archive_command fallando', 'failed_count subiendo y last_failed_wal reciente en pg_stat_archiver', 'Corregir el destino del archivado; el WAL se va solo después'],
            ['wal_keep_size demasiado alto', 'Ningún slot retiene mucho y pg_wal está estable en un valor grande', 'Reducir wal_keep_size y usar slots para las réplicas'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La columna wal_status resume el riesgo. reserved significa que el WAL retenido cabe en max_wal_size. extended significa que lo superó, pero sigue garantizado. unreserved significa que el slot superó max_slot_wal_keep_size y puede perder WAL en el próximo checkpoint. lost significa que ya lo perdió: el slot fue invalidado y el consumidor ya no puede seguir desde donde se detuvo. safe_wal_size muestra cuántos bytes pueden escribirse todavía antes de que el slot pase a unreserved, y es nulo cuando no hay techo configurado.',
        },
      ],
    },
    {
      title: 'Eliminar el slot con seguridad, y lo que nunca hay que hacer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con el dueño identificado y confirmado que nadie depende del slot, la eliminación es corta. El orden importa porque no se puede eliminar un slot con un proceso conectado, y terminar el walsender de un consumidor que sigue corriendo solo hace que se reconecte o recree el slot.',
        },
        {
          type: 'code',
          value: dropCode(comments.es),
        },
        {
          type: 'ordered',
          items: [
            'Si la primaria ya cayó por disco lleno, libere espacio fuera de pg_wal: amplíe el volumen, mueva logs del servidor o borre archivos temporales que no pertenecen a Postgres. Necesita algunos megabytes para terminar la recuperación y aceptar conexiones.',
            'Nunca borre archivos dentro de pg_wal a mano ni use pg_resetwal para "limpiar". El WAL de ahí incluye lo necesario para la recuperación tras la caída, y borrar el segmento equivocado corrompe la base.',
            'Antes de eliminar un slot lógico cuyo consumidor todavía importa, sepa que va a necesitar una nueva carga completa. El WAL entre el último LSN confirmado y ahora deja de existir para él.',
            'Eliminar el slot de una réplica física que va a volver tiene el mismo efecto: ya no encuentra el WAL que necesita y hay que reconstruirla con pg_basebackup.',
            'Después del CHECKPOINT, confirme que pg_wal_size bajó y que el wal_status de los slots restantes volvió a reserved.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Los slots olvidados suelen nacer de procesos que crean el slot automáticamente: conectores de CDC, pg_basebackup con -C para una réplica que después se apaga, pruebas con pg_recvlogical y actualizaciones por replicación lógica. En este último caso, un DROP SUBSCRIPTION ejecutado después de ALTER SUBSCRIPTION ... SET (slot_name = NONE), o sin conexión con el publicador, deja el slot en el servidor de origen. Toda baja de un consumidor necesita "eliminar el slot" como paso explícito del runbook.',
        },
      ],
    },
    {
      title: 'Un techo para el slot: max_slot_wal_keep_size e idle_replication_slot_timeout',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El valor por defecto de max_slot_wal_keep_size es -1, sin límite. Eso significa que, por defecto, cualquier consumidor olvidado puede tumbar la primaria. Configurar un techo cambia el modo de falla: en lugar de que el disco se llene y la base se detenga, el slot que supera el límite se invalida y solo ese consumidor pierde la continuidad. Para un sistema en producción, es casi siempre el intercambio correcto.',
        },
        {
          type: 'code',
          value: configCode(comments.es),
        },
        {
          type: 'table',
          columns: ['Configuración', 'Qué pasa con el slot olvidado', 'Quién paga'],
          rows: [
            ['Por defecto (sin techo)', 'Retiene WAL hasta que se acaba el disco', 'Toda la primaria, que deja de aceptar escrituras'],
            ['max_slot_wal_keep_size = 80GB', 'Se invalida al pasar de 80 GB de WAL retenido', 'Solo el consumidor, que debe recrearse o recargarse'],
            ['idle_replication_slot_timeout = 1d (Postgres 18+)', 'Se invalida tras 1 día sin conexión, aunque retenga poco WAL', 'Solo el consumidor parado, y catalog_xmin deja de frenar el vacuum'],
            ['Monitoreo con alertas', 'Alguien recibe el aviso antes de cualquier límite', 'Nadie, si la alerta tiene dueño y runbook'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El techo debe caber en el disco con holgura y ser mayor que la peor parada legítima. Si una réplica puede pasar hasta 6 horas en mantenimiento y la primaria genera 2 GB de WAL por hora, necesita al menos 12 GB, y 80 GB en un disco con 300 GB libres deja margen para picos de escritura y para el propio max_wal_size. idle_replication_slot_timeout complementa el techo de volumen: atrapa el slot lógico parado en una base con poca escritura, que nunca llegaría a 80 GB pero retiene el catalog_xmin durante semanas. Los dos se verifican en el checkpoint, así que la invalidación no es instantánea.',
        },
      ],
    },
    {
      title: 'Monitorear antes de que se llene: alerta por slot, no solo por disco',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La alerta de disco llegó tarde y sin contexto. Lo que faltaba era una alerta que nombrara el slot. El monitor de abajo corre cada minuto, lee pg_replication_slots y avisa en dos casos: un slot parado hace más de 15 minutos o un slot que retiene más de 20 GB, aunque esté activo. Su usuario de base de datos solo necesita el rol pg_monitor.',
        },
        {
          type: 'code',
          value: monitorCode(comments.es),
        },
        {
          type: 'list',
          items: [
            'Separe el tamaño de pg_wal del tamaño de los datos en los paneles. Un disco que sube con tablas estables casi siempre es WAL retenido.',
            'Alerte sobre un wal_status distinto de reserved. extended es aceptable por poco tiempo; unreserved y lost exigen acción inmediata.',
            'Incluya en la revisión mensual la lista de slots con el dueño de cada uno. Un slot sin dueño conocido es candidato a eliminación.',
            'En servicios gestionados, la métrica del proveedor de "uso de disco por logs de transacciones" muestra el mismo síntoma. Los techos de arriba también funcionan ahí, desde Postgres 13.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Si configuro max_slot_wal_keep_size, ¿puedo perder datos?',
      answer:
        'La primaria no pierde nada: el techo solo decide hasta cuándo guarda WAL para un consumidor atrasado. Quien pierde es el consumidor del slot invalidado, que ya no puede seguir desde donde se detuvo. Una réplica física debe reconstruirse con pg_basebackup, y un consumidor lógico, como un conector de CDC, necesita una nueva carga completa para no quedar con un hueco. Es una pérdida de continuidad de un consumidor, a cambio de la disponibilidad de toda la primaria.',
    },
    {
      question: '¿Por qué el slot aparece activo y aun así el WAL retenido no deja de subir?',
      answer:
        'Porque estar conectado no es lo mismo que confirmar. El restart_lsn solo avanza cuando el consumidor confirma haber procesado los cambios, y algunos consumidores solo confirman cuando reciben algo relevante. En Debezium, una base con mucha escritura en tablas fuera de la publicación y poca en las tablas monitoreadas produce exactamente esto. Configurar heartbeat.action.query, escribiendo en una tabla incluida en la publicación, garantiza un cambio periódico que confirmar. En otros consumidores, verifique que la confirmación del LSN ocurra después del procesamiento y que no esté trabada por un error silencioso.',
    },
    {
      question: '¿Las réplicas deben usar slot físico o wal_keep_size?',
      answer:
        'Slot, con techo. wal_keep_size guarda una cantidad fija de WAL para todas las réplicas, ocupa ese espacio todo el tiempo y aun así falla si una réplica se atrasa más que ese valor. El slot guarda exactamente lo necesario para cada réplica y, con max_slot_wal_keep_size, deja de ser un riesgo para el disco. La combinación práctica es un slot físico por réplica, un techo dimensionado según el peor mantenimiento esperado y un wal_keep_size pequeño o cero.',
    },
  ],
  conclusion: {
    title: 'Todo slot necesita dueño, techo y alerta',
    description:
      'Un slot de replicación es una promesa sin plazo: guardar todo el WAL hasta que el consumidor vuelva. Cuando el consumidor muere o se apaga sin que nadie elimine el slot, la primaria cumple la promesa hasta que se acaba el disco, y además frena el vacuum por el xmin o el catalog_xmin en el camino. La prevención es barata: medir el WAL retenido por slot, configurar max_slot_wal_keep_size y, en Postgres 18, idle_replication_slot_timeout, alertar por el nombre del slot y no solo por el disco, e incluir la eliminación del slot en todo runbook de baja de un consumidor. Así, un conector olvidado se convierte en un aviso en el canal de alertas y no en una primaria caída a las 3 de la mañana.',
    cta: 'Revisar la replicación y las alertas de mi base de datos',
  },
  related: [
    {
      label: 'Actualización de versión mayor de Postgres sin ventana: replicación lógica para cambiar de versión con el tráfico activo',
      to: '/blog/upgrade-de-versao-major-do-postgres-sem-janela-replicacao-logica-para-trocar-de-versao-com-trafego-ligado',
    },
    {
      label: 'La consulta de reporte en la réplica que se cancela sola: conflictos de recuperación y hot_standby_feedback',
      to: '/blog/consulta-de-relatorio-na-replica-que-cancela-sozinha-conflito-de-recuperacao-e-hot-standby-feedback',
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
