// Conteudo do artigo: upgrade de versao major do Postgres sem janela. Por que pg_upgrade e o
// upgrade gerenciado do provedor exigem uma parada que o negocio nao aceita, quais pre-requisitos
// da replicacao logica travam o plano se forem descobertos tarde, como montar o alvo e fazer a
// copia inicial de 1,4 TB sem derrubar a origem, como executar o corte com trafego ligado e
// caminho de volta, o que a replicacao nao leva e como provar que os dados batem, e como ensaiar.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const inventarioCode = `-- 1. Tabelas sem chave primaria. Depois que a publicacao existe, UPDATE e DELETE
--    nelas falham na origem com "cannot update table because it does not have
--    a replica identity". Descubra antes, nao durante.
SELECT n.nspname AS esquema, c.relname AS tabela, c.relreplident AS identidade
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary);

-- Para as poucas que sobram (log, staging de importacao), identidade completa:
-- cada UPDATE envia a linha inteira pelo WAL. Mais caro, mas funciona.
ALTER TABLE importacao_linhas REPLICA IDENTITY FULL;

-- 2. Sequencias nao sao replicadas. Liste todas: serao alinhadas no corte.
SELECT schemaname, sequencename, last_value FROM pg_sequences;

-- 3. Extensoes: precisam existir no alvo, em versao compativel, ANTES do esquema.
SELECT extname, extversion FROM pg_extension ORDER BY 1;

-- 4. O que a replicacao logica nao carrega e precisa de plano proprio.
SELECT count(*) AS large_objects FROM pg_largeobject_metadata;
SELECT relname FROM pg_class WHERE relpersistence = 'u';   -- UNLOGGED: fora do WAL
SELECT matviewname FROM pg_matviews;                        -- REFRESH no alvo

-- 5. Tabela de marcador usada no corte: criada agora, para entrar no esquema
--    e na publicacao junto com as outras.
CREATE TABLE upgrade_marcador (id uuid PRIMARY KEY, criado_em timestamptz DEFAULT now());

-- 6. Configuracao da origem. wal_level exige reinicio: faca na proxima janela
--    de patch, semanas antes, nao na madrugada do corte.
ALTER SYSTEM SET wal_level = 'logical';
ALTER SYSTEM SET max_replication_slots = 10;
ALTER SYSTEM SET max_wal_senders = 10;`;

const copiaInicialCode = `# Esquema sem dados, com o pg_dump da versao NOVA apontado para a origem antiga:
# o pg_dump 17 sabe emitir DDL que o 17 aceita. Papeis vem separado.
pg_dumpall -h origem --globals-only > globals.sql
pg_dump -h origem -d clinicas --schema-only --no-publications --no-subscriptions > esquema.sql
psql -h alvo -f globals.sql
psql -h alvo -d clinicas -f esquema.sql

-- Na origem (12): tudo que existe hoje. Tabela criada depois NAO entra sozinha.
CREATE PUBLICATION pub_upgrade FOR ALL TABLES;

-- No alvo (17): indices secundarios e chaves estrangeiras custam caro na copia
-- inicial. Guarde o DDL, derrube, recrie depois. Chave primaria e UNIQUE ficam:
-- sem elas o apply de cada UPDATE vira varredura sequencial no alvo.
SELECT indexdef || ';' AS recriar
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE contype IN ('p', 'u'));

CREATE SUBSCRIPTION sub_upgrade
  CONNECTION 'host=origem dbname=clinicas user=replicador'
  PUBLICATION pub_upgrade
  WITH (copy_data = true);

-- Tabelas copiadas em paralelo (padrao 2). Quatro foi o maximo sem saturar a origem.
ALTER SYSTEM SET max_sync_workers_per_subscription = 4;
SELECT pg_reload_conf();

-- Estado por tabela: i = iniciando, d = copiando, f = terminou a copia,
-- s = sincronizada, r = pronta (recebendo mudancas em tempo real).
SELECT srrelid::regclass AS tabela, srsubstate AS estado
FROM pg_subscription_rel ORDER BY 2, 1;

-- Visto da origem: quanto WAL o slot esta segurando. Esse numero e disco.
SELECT slot_name, active,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) AS atraso
FROM pg_replication_slots;

-- Quando todas estiverem em 'r': recriar os indices guardados (com CONCURRENTLY)
-- e gerar estatisticas, que a copia nao traz. Sem ANALYZE, o alvo escolhe planos
-- ruins no primeiro minuto de trafego, e o upgrade "deixou tudo lento".
# vacuumdb -h alvo -d clinicas --analyze-in-stages`;

const corteCode = `// corte.js
// Corte com trafego ligado. O pgbouncer segura as novas transacoes na fila (PAUSE),
// a origem vira somente leitura, um marcador prova que o alvo recebeu a ultima
// escrita, as sequencias sao alinhadas, a replicacao de volta e criada e so entao
// o pgbouncer passa a apontar para o alvo (RESUME). Qualquer erro antes do RESUME
// devolve o trafego para a origem: o cliente ve latencia, nao erro.
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';

const exec = promisify(execFile);
const origem = new pg.Client({ connectionString: process.env.ORIGEM_URL });
const alvo = new pg.Client({ connectionString: process.env.ALVO_URL });
const bouncer = new pg.Client({ connectionString: process.env.PGBOUNCER_ADMIN_URL });
const TETO_MS = 30_000;

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function esperarMarcador(id) {
  const inicio = Date.now();
  while (Date.now() - inicio < TETO_MS) {
    const { rowCount } = await alvo.query('SELECT 1 FROM upgrade_marcador WHERE id = $1', [id]);
    if (rowCount === 1) return Date.now() - inicio;
    await esperar(100);
  }
  throw new Error(\`alvo nao recebeu o marcador \${id} em \${TETO_MS} ms\`);
}

async function alinharSequencias() {
  const { rows } = await origem.query(
    'SELECT schemaname, sequencename, last_value FROM pg_sequences WHERE last_value IS NOT NULL',
  );
  for (const seq of rows) {
    // A margem cobre valores pre-alocados por CACHE que nunca chegaram ao disco.
    await alvo.query(
      "SELECT setval(format('%I.%I', $1, $2)::regclass, $3::bigint + 1000, true)",
      [seq.schemaname, seq.sequencename, seq.last_value],
    );
  }
  return rows.length;
}

async function corte() {
  await Promise.all([origem.connect(), alvo.connect(), bouncer.connect()]);
  // Esta sessao continua escrevendo na origem depois que o banco virar read-only.
  await origem.query('SET default_transaction_read_only = off');

  const t0 = Date.now();
  await bouncer.query('PAUSE clinicas'); // espera as transacoes abertas terminarem
  try {
    // 1. Fecha a porta para quem nao passa pelo pgbouncer (cron, job antigo).
    await origem.query('ALTER DATABASE clinicas SET default_transaction_read_only = on');
    await origem.query(\`
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = 'clinicas' AND pid <> pg_backend_pid()
        AND backend_type = 'client backend' AND usename <> 'replicador'\`);

    // 2. Ultima escrita da origem. Quando chegar no alvo, nada ficou para tras.
    const marcador = randomUUID();
    await origem.query('INSERT INTO upgrade_marcador (id) VALUES ($1)', [marcador]);
    const atrasoMs = await esperarMarcador(marcador);

    // 3. O que a replicacao nao leva.
    const sequencias = await alinharSequencias();

    // 4. Caminho de volta: tudo que for escrito no alvo a partir daqui volta para
    //    a origem. Criado ANTES do RESUME, para nenhuma escrita nova escapar.
    //    O papel replicador recebe read-only = off no nivel de ROLE, que prevalece
    //    sobre o do banco: sem isso o apply na origem falha por transacao read-only.
    await alvo.query('ALTER SUBSCRIPTION sub_upgrade DISABLE');
    await alvo.query('CREATE PUBLICATION pub_volta FOR ALL TABLES');
    await origem.query('ALTER ROLE replicador SET default_transaction_read_only = off');
    await origem.query(\`
      CREATE SUBSCRIPTION sub_volta
        CONNECTION '\${process.env.VOLTA_CONN}' PUBLICATION pub_volta
        WITH (copy_data = false)\`);

    // 5. Ponto sem volta deste script: pgbouncer passa a apontar para o alvo.
    await exec('cp', ['/etc/pgbouncer/pgbouncer.alvo.ini', '/etc/pgbouncer/pgbouncer.ini']);
    await bouncer.query('RELOAD');
    await bouncer.query('RESUME clinicas');
    console.log({ pausaMs: Date.now() - t0, atrasoMs, sequencias });
  } catch (erro) {
    // Nada mudou para o cliente ainda: reabre a origem e libera a fila nela.
    await origem.query('ALTER DATABASE clinicas SET default_transaction_read_only = off');
    await bouncer.query('RESUME clinicas');
    throw erro;
  } finally {
    await Promise.all([origem.end(), alvo.end(), bouncer.end()]);
  }
}

corte().catch((erro) => {
  console.error(erro);
  process.exit(1);
});`;

const verificacaoCode = `-- Mesma consulta nos dois lados, mesma faixa de ids, mesmos parametros de formato.
-- Sem fixar DateStyle, TimeZone e extra_float_digits, a mesma linha vira texto
-- diferente em cada versao e o hash acusa divergencia que nao existe.
SET DateStyle = 'ISO, YMD'; SET TimeZone = 'UTC'; SET extra_float_digits = 3;

SELECT count(*) AS linhas,
       md5(string_agg(md5(t::text), '' ORDER BY id)) AS hash
FROM agendamentos t
WHERE id > 0 AND id <= 500000;        -- avancar a faixa em lotes

-- Contagem estimada de todas as tabelas: acha a tabela que ficou de fora.
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY 1;

-- Sequencias: o alvo precisa estar a frente da origem em todas.
SELECT sequencename, last_value FROM pg_sequences ORDER BY 1;

-- Encerramento, uma semana depois, sem ter precisado voltar.
-- Cada DROP SUBSCRIPTION derruba o slot do outro lado junto. Slot esquecido
-- segura WAL para sempre, ate encher o disco de quem ficou.
-- No alvo:
DROP SUBSCRIPTION sub_upgrade;
-- Na origem, antes de desligar o servidor:
DROP SUBSCRIPTION sub_volta;`;

const diagramaPt = `Linha do tempo do corte (9 s de pausa no ensaio final e em produção).

  t0       PAUSE clinicas        novas transações esperam na fila do pgbouncer
           |
  +0,8 s   origem read-only      sessões fora do pgbouncer encerradas
           |
  +1,1 s   INSERT marcador       última escrita que a origem aceita
           |
  +2,4 s   marcador no alvo      atraso real da replicação naquele instante: 1,3 s
           |
  +4,0 s   96 sequências         setval(last_value + 1000) no alvo
           |
  +6,9 s   sub_volta criada      alvo -> origem, slot aberto antes de qualquer escrita nova
           |
  +8,7 s   RELOAD + RESUME       fila drena no Postgres 17; p99 da API: 11 s nesse minuto, 0 erros
           |
  +7 dias  DROP sub_volta        origem desligada depois de uma semana sem precisar voltar`;

const diagramaEn = `Cutover timeline (9 s of pause in the final rehearsal and in production).

  t0       PAUSE clinicas        new transactions wait in the pgbouncer queue
           |
  +0.8 s   source read-only      sessions outside pgbouncer terminated
           |
  +1.1 s   INSERT marker         last write the source accepts
           |
  +2.4 s   marker on target      real replication lag at that instant: 1.3 s
           |
  +4.0 s   96 sequences          setval(last_value + 1000) on the target
           |
  +6.9 s   sub_volta created     target -> source, slot opened before any new write
           |
  +8.7 s   RELOAD + RESUME       queue drains into Postgres 17; API p99: 11 s that minute, 0 errors
           |
  +7 days  DROP sub_volta        source shut down after a week without needing to go back`;

const diagramaEs = `Línea de tiempo del corte (9 s de pausa en el ensayo final y en producción).

  t0       PAUSE clinicas        las transacciones nuevas esperan en la cola del pgbouncer
           |
  +0,8 s   origen read-only      sesiones fuera del pgbouncer terminadas
           |
  +1,1 s   INSERT marcador       última escritura que el origen acepta
           |
  +2,4 s   marcador en destino   retraso real de la replicación en ese instante: 1,3 s
           |
  +4,0 s   96 secuencias         setval(last_value + 1000) en el destino
           |
  +6,9 s   sub_volta creada      destino -> origen, slot abierto antes de cualquier escritura nueva
           |
  +8,7 s   RELOAD + RESUME       la cola drena en Postgres 17; p99 de la API: 11 s ese minuto, 0 errores
           |
  +7 días  DROP sub_volta        origen apagado tras una semana sin necesitar volver`;

const pt = {
  intro:
    'Um SaaS de gestão de clínicas roda em um Postgres 12 que perdeu o suporte em novembro de 2024. O banco tem 1,4 TB, 212 tabelas e 3.800 transações por segundo no pico, com clientes em três fusos e unidades de pronto-atendimento que operam de madrugada. O provedor oferece o upgrade gerenciado com "janela estimada de 40 minutos", e o ensaio com pg_upgrade --link em uma cópia levou 6 minutos de parada, mais 50 minutos de banco lento até as estatísticas serem refeitas. Nenhuma das duas opções passa pela diretoria. Este artigo mostra como trocar da versão 12 para a 17 com replicação lógica e tráfego ligado: quais pré-requisitos derrubam o plano quando descobertos tarde, como montar o alvo e fazer a cópia inicial sem derrubar a origem, como executar o corte em segundos com caminho de volta, o que a replicação não leva e como provar que os dados batem, e como ensaiar até o número de segundos de pausa ser previsível.',
  sections: [
    {
      title: 'Por que a janela não cabe e o que cada caminho de upgrade custa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Upgrade de versão major muda o formato interno do catálogo e, em alguns casos, dos arquivos de dados. Por isso ele não acontece com um restart: ou os dados são convertidos com o banco parado (pg_upgrade), ou são reescritos do zero em outro servidor (dump e restore), ou são copiados por replicação enquanto o antigo continua atendendo. O upgrade gerenciado do provedor é um pg_upgrade com interface bonita, e a estimativa de 40 minutos cobre snapshot antes, conversão, reinício e nenhum ANALYZE: o banco volta sem estatísticas e o planejador escolhe planos ruins no primeiro horário de pico.',
        },
        {
          type: 'table',
          columns: ['Caminho', 'Indisponibilidade', 'Volta atrás', 'Custo escondido'],
          rows: [
            ['pg_upgrade com cópia', 'Horas para 1,4 TB', 'Sim, o diretório antigo fica intacto', 'Dobra o disco; a cópia inteira acontece com tudo parado'],
            ['pg_upgrade --link', 'Minutos, mais o tempo de ANALYZE', 'Não: depois do primeiro start do cluster novo o antigo está inutilizado', 'Estatísticas zeradas; qualquer erro depois do start é restauração de backup'],
            ['Upgrade gerenciado do provedor', '20 a 60 minutos, decididos por ele', 'Snapshot anterior, com restauração demorada', 'Nem sempre permite ensaiar; extensões com versão incompatível só aparecem na hora'],
            ['pg_dump e pg_restore', 'Proporcional ao volume, horas', 'Sim, a origem fica intacta', 'Só vale para bancos pequenos ou que toleram a parada'],
            ['Replicação lógica', 'Segundos, em um corte controlado', 'Sim, com replicação de volta ligada', 'Mais trabalho: chave primária, sequências, DDL e extensões cuidados à mão'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A replicação lógica decodifica o WAL da origem em mudanças de linha (INSERT, UPDATE, DELETE, TRUNCATE) e as aplica no alvo como se fossem comandos SQL. Como o formato é lógico e não físico, a versão dos dois lados pode ser diferente: o alvo já roda a 17 enquanto a origem continua na 12, e a troca vira a decisão de para onde a aplicação aponta. O preço é que ela só leva o que está no WAL como mudança de linha, e tudo que não está precisa de plano próprio.',
        },
      ],
    },
    {
      title: 'Pré-requisitos que travam o plano se forem descobertos tarde',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Três descobertas costumam acontecer na madrugada do corte, quando deveriam ter acontecido um mês antes. A primeira é que wal_level = logical exige reinício da origem, ou seja, uma pequena parada que precisa entrar na próxima janela de patch. A segunda é que toda tabela que recebe UPDATE ou DELETE precisa de chave primária ou REPLICA IDENTITY; sem isso, a partir do momento em que a publicação existe, esses comandos falham na origem com erro, não no alvo. A terceira é que extensão com versão incompatível na versão nova (um pg_trgm antigo, um PostGIS que mudou de major) só aparece na hora de restaurar o esquema.',
        },
        {
          type: 'code',
          value: inventarioCode,
        },
        {
          type: 'list',
          items: [
            'Tabelas sem chave primária: no SaaS de clínicas eram 9 de 212, todas de log e importação. Quatro ganharam chave primária com ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY em lotes; cinco ficaram com REPLICA IDENTITY FULL porque só recebem INSERT.',
            'O papel replicador precisa de REPLICATION e de SELECT nas tabelas publicadas; na versão 12 a assinatura precisa ser criada por superusuário no alvo, e a conexão de replicação precisa estar liberada no pg_hba.conf da origem.',
            'Slot de replicação segura WAL até o assinante confirmar. Se o alvo cair por uma noite, a origem acumula WAL até encher o disco e parar de aceitar escrita. Alarme em pg_replication_slots é obrigatório desde o primeiro dia.',
            'Large objects, tabelas UNLOGGED e views materializadas ficam de fora. No caso, 3.100 large objects de laudos foram migrados para armazenamento de objetos antes do upgrade, o que já era dívida antiga.',
          ],
        },
      ],
    },
    {
      title: 'Esquema, publicação e cópia inicial de 1,4 TB sem derrubar a origem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O esquema vai primeiro, sem dados, usando o pg_dump da versão nova apontado para a origem antiga: ele sabe emitir DDL que a versão nova aceita e avisa de extensão que não existe no alvo. Depois vem a publicação na origem e a assinatura no alvo com copy_data, que faz a carga inicial tabela a tabela usando COPY e, ao terminar cada uma, começa a aplicar as mudanças em tempo real. O ponto que decide se isso leva 4 horas ou 11 é o que existe no alvo durante a cópia: cada índice secundário é mantido a cada linha inserida, e cada chave estrangeira é checada.',
        },
        {
          type: 'code',
          value: copiaInicialCode,
        },
        {
          type: 'list',
          items: [
            'Derrubar índices secundários e chaves estrangeiras no alvo antes da cópia e recriar depois, com CONCURRENTLY, levou a carga de 11 horas estimadas para 4 horas e 10 minutos. Chave primária e UNIQUE ficam: o apply usa a identidade de réplica para localizar a linha de cada UPDATE.',
            'Durante a cópia inicial, o slot segura todo o WAL gerado desde o início. No caso foram 180 GB de pico, e a origem precisou de 250 GB livres que ninguém tinha previsto. Meça a geração de WAL por hora antes de começar.',
            'Congele as migrações de esquema enquanto a replicação existe, ou aplique cada DDL nos dois lados na mesma ordem. Uma coluna nova só na origem faz o apply parar no alvo no primeiro INSERT que a usa.',
            'Tabela criada depois da publicação não entra sozinha, mesmo com FOR ALL TABLES no alvo: crie nos dois lados e rode ALTER SUBSCRIPTION sub_upgrade REFRESH PUBLICATION.',
            'Estatísticas não são copiadas. O vacuumdb --analyze-in-stages antes do corte é o que impede o "upgrade deixou tudo lento" dos primeiros minutos.',
          ],
        },
      ],
    },
    {
      title: 'O corte com tráfego ligado: pausar, provar, alinhar, apontar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com o alvo sincronizado, atraso abaixo de 2 segundos e índices recriados, o corte é um procedimento de segundos que precisa ser um script, não um checklist executado à mão. O pgbouncer faz o papel central: PAUSE espera as transações abertas terminarem e segura as novas na fila, sem erro para o cliente. A origem vira somente leitura, um marcador escrito na origem prova que o alvo recebeu a última mudança, as sequências são alinhadas, a replicação de volta é criada e só então o pgbouncer é recarregado apontando para o alvo e a fila drena.',
        },
        {
          type: 'code',
          value: corteCode,
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'Duas decisões no script merecem atenção. A replicação de volta é criada antes do RESUME, com copy_data = false, porque o slot é criado no momento do CREATE SUBSCRIPTION: tudo que for escrito no alvo a partir dali volta para a origem, e nenhuma escrita escapa entre a criação e a liberação da fila. E o ponto sem volta do script é o RELOAD do pgbouncer: até ele, qualquer exceção reabre a origem e libera a fila nela, e o cliente viu só uma pausa. Depois dele, voltar é executar o mesmo procedimento no sentido contrário, o que também é ensaiado.',
        },
      ],
    },
    {
      title: 'O que a replicação não leva e como provar que os dados batem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A lista do que a replicação lógica não transporta é curta, mas cada item vira um incidente se for esquecido. Sequências são o clássico: o alvo recebe as linhas com os ids da origem, mas a sequência do alvo continua em 1, e o primeiro INSERT depois do corte falha por chave duplicada. O setval com margem no script resolve. Os demais estão na tabela.',
        },
        {
          type: 'table',
          columns: ['Objeto', 'O que acontece', 'O que fazer'],
          rows: [
            ['Sequências', 'Não replicadas; o alvo fica com o valor inicial', 'setval(last_value + margem) no corte, para todas'],
            ['DDL', 'Não replicado; coluna nova só na origem para o apply no alvo', 'Congelar migrações, ou aplicar nos dois lados: ADD COLUMN primeiro no alvo, DROP COLUMN primeiro na origem'],
            ['Tabela nova', 'FOR ALL TABLES só vale para quem existia; o alvo nunca recebe', 'Criar nos dois lados e ALTER SUBSCRIPTION REFRESH PUBLICATION'],
            ['Large objects', 'Não replicados', 'Exportar com lo_export ou mover para bytea ou armazenamento de objetos antes'],
            ['Tabelas UNLOGGED', 'Não entram no WAL', 'Copiar à parte no corte ou aceitar perda, se for cache'],
            ['Views materializadas', 'Definição vai no esquema, dados não', 'REFRESH MATERIALIZED VIEW no alvo antes do corte'],
            ['Tabela particionada com publicador na versão 12', 'Só as partições folha entram, pelo nome', 'Mesmos nomes de partição nos dois lados; publish_via_partition_root só existe a partir da 13'],
            ['Tabela sem REPLICA IDENTITY', 'UPDATE e DELETE falham na origem', 'Chave primária ou REPLICA IDENTITY FULL antes de criar a publicação'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Provar que os dados batem é comparar origem e alvo com a mesma consulta, na mesma faixa de ids, com os mesmos parâmetros de formatação. A contagem por tabela encontra a tabela que ficou de fora; o hash por faixa encontra a linha divergente sem trazer os dados para fora do banco. A comparação roda com a replicação ativa, antes do corte, e de novo logo depois, enquanto a replicação de volta mantém os dois lados iguais.',
        },
        {
          type: 'code',
          value: verificacaoCode,
        },
      ],
    },
    {
      title: 'Ensaiar até o número ser previsível, e o que fazer com o banco antigo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O corte em produção foi o quarto. Os três anteriores rodaram em um clone da origem recebendo tráfego reproduzido do log do pgbouncer, e cada um encontrou algo: o primeiro parou no marcador porque a tabela não estava na publicação, o segundo demorou 40 segundos porque um job de BI fora do pgbouncer segurava uma transação aberta, e o terceiro mostrou que o setval sem margem colidia com valores em cache de sequências com CACHE 50. Os números abaixo são do ensaio final e se repetiram em produção.',
        },
        {
          type: 'table',
          columns: ['Medição', 'Valor'],
          rows: [
            ['Volume', '1,4 TB, 212 tabelas, 96 sequências, 3.100 large objects migrados antes'],
            ['Cópia inicial com índices secundários no alvo', '11 horas estimadas no primeiro ensaio, abortada'],
            ['Cópia inicial sem índices secundários, 4 workers', '4 horas e 10 minutos'],
            ['Recriação dos índices com CONCURRENTLY', '1 hora e 50 minutos'],
            ['Pico de WAL retido pelo slot durante a cópia', '180 GB; a origem precisou de 250 GB livres'],
            ['Atraso em regime, antes do corte', 'Abaixo de 2 segundos'],
            ['Pausa do pgbouncer no corte', '9 segundos'],
            ['Erros vistos pelo cliente', 'Zero; p99 da API em 11 segundos no minuto do corte'],
            ['Replicação de volta mantida', '7 dias, cobrindo um fechamento de faturamento'],
          ],
        },
        {
          type: 'ordered',
          items: [
            'Faça o inventário: tabelas sem chave primária, sequências, extensões, large objects, UNLOGGED e views materializadas. Resolva cada item antes de criar a publicação.',
            'Ligue wal_level = logical na próxima janela de patch e instale o alarme de WAL retido por slot.',
            'Restaure o esquema no alvo com o pg_dump da versão nova, derrube índices secundários e chaves estrangeiras, crie a assinatura com copy_data e acompanhe pg_subscription_rel.',
            'Recrie índices com CONCURRENTLY, rode ANALYZE em estágios e compare contagens e hashes por faixa com a replicação ativa.',
            'Ensaie o corte em um clone com tráfego reproduzido até a pausa ter duração previsível, incluindo o caminho de volta.',
            'Execute o corte por script, com a replicação de volta criada antes do RESUME, e mantenha a origem sincronizada por um ciclo de negócio inteiro antes de derrubar as assinaturas e desligar o servidor antigo.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Isso funciona em banco gerenciado, como RDS, Cloud SQL ou Azure?',
      answer:
        'Funciona, com duas diferenças. O wal_level é controlado por parâmetro do provedor (rds.logical_replication no RDS, cloudsql.logical_decoding no Cloud SQL) e também exige reinício. E não existe superusuário: o papel precisa do privilégio de replicação que o provedor oferece (rds_replication, por exemplo), e a assinatura é criada com o usuário administrador. O pgbouncer, ou o proxy equivalente, continua sendo o ponto de troca; sem ele, o corte vira troca de string de conexão com deploy, que é mais lenta e mais difícil de reverter.',
    },
    {
      question: 'E se uma migração de esquema precisar sair durante as semanas de replicação?',
      answer:
        'Aplique nos dois lados, na ordem certa. Coluna nova entra primeiro no alvo e depois na origem: o assinante pode ter colunas a mais, mas não a menos. Coluna removida sai primeiro da origem e depois do alvo. Tabela nova é criada nos dois lados e exige ALTER SUBSCRIPTION REFRESH PUBLICATION no alvo, senão nunca recebe dados. Índice novo pode entrar só no alvo, com CONCURRENTLY. O mais seguro é combinar com o time uma janela sem migração entre a cópia inicial e o corte, que costuma ser de uma a duas semanas.',
    },
    {
      question: 'Por quanto tempo manter a replicação de volta e quando desligar o banco antigo?',
      answer:
        'Por um ciclo de negócio completo: no SaaS de clínicas foi uma semana, cobrindo um fechamento de faturamento e um fim de semana de plantão. Durante esse período, voltar é executar o mesmo corte no sentido contrário, sem perder dados. Ao desligar, derrube a assinatura de volta na origem antes de parar o servidor, porque o slot que ela criou no alvo segura WAL até ser removido, e um slot esquecido enche o disco do banco novo semanas depois, quando ninguém mais lembra do upgrade.',
    },
  ],
  conclusion: {
    title: 'Trocar de versão é mudar para onde a aplicação aponta',
    description:
      'O pg_upgrade e o upgrade gerenciado do provedor convertem os dados com o banco parado e devolvem um servidor sem estatísticas, o que para um SaaS com 1,4 TB e clientes 24 horas é uma janela que o negócio não aceita. A replicação lógica transforma o upgrade em um alvo já na versão nova recebendo as mudanças da origem, e o corte vira um script de segundos: pausar no pgbouncer, tornar a origem somente leitura, provar com um marcador que nada ficou para trás, alinhar as sequências, criar a replicação de volta e apontar para o alvo. O que exige cuidado está nos detalhes que não vão pelo WAL: chave primária em toda tabela, sequências, DDL congelado, extensões, large objects e estatísticas, mais o disco que o slot vai segurar. Com inventário, ensaio em clone e caminho de volta ligado por um ciclo de negócio, a troca de versão sai da categoria "janela de madrugada" e entra na de procedimento previsível.',
    cta: 'Planejar o upgrade do meu banco sem janela',
  },
  related: [
    {
      label: 'Migração de banco sem janela: expandir, migrar e contrair sem derrubar escrita',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Backup que nunca foi restaurado: transformar cópia em garantia de recuperação',
      to: '/blog/backup-que-nunca-foi-restaurado-transformar-copia-em-garantia-de-recuperacao',
    },
    {
      label: 'Serviço de arquitetura e modernização backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A clinic management SaaS runs on a Postgres 12 that lost support in November 2024. The database has 1.4 TB, 212 tables and 3,800 transactions per second at peak, with customers in three time zones and urgent care units that operate overnight. The provider offers a managed upgrade with an "estimated 40-minute window", and the rehearsal with pg_upgrade --link on a copy took 6 minutes of downtime plus 50 minutes of a slow database until statistics were rebuilt. Neither option gets past the board. This article shows how to move from version 12 to 17 with logical replication and traffic on: which prerequisites sink the plan when discovered late, how to build the target and run the initial copy without hurting the source, how to execute the cutover in seconds with a way back, what replication does not carry and how to prove the data matches, and how to rehearse until the number of seconds of pause becomes predictable.',
  sections: [
    {
      title: 'Why the window does not fit and what each upgrade path costs',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A major version upgrade changes the internal format of the catalog and, in some cases, of the data files. That is why it does not happen with a restart: either the data is converted with the database stopped (pg_upgrade), or it is rewritten from scratch on another server (dump and restore), or it is copied through replication while the old one keeps serving. The provider\'s managed upgrade is pg_upgrade with a nice interface, and the 40-minute estimate covers a snapshot beforehand, conversion, restart and no ANALYZE: the database comes back without statistics and the planner picks bad plans during the first peak hour.',
        },
        {
          type: 'table',
          columns: ['Path', 'Downtime', 'Way back', 'Hidden cost'],
          rows: [
            ['pg_upgrade with copy', 'Hours for 1.4 TB', 'Yes, the old directory stays intact', 'Doubles the disk; the whole copy happens with everything stopped'],
            ['pg_upgrade --link', 'Minutes, plus ANALYZE time', 'No: after the new cluster\'s first start the old one is unusable', 'Statistics wiped; any error after the start means restoring a backup'],
            ['Provider managed upgrade', '20 to 60 minutes, decided by them', 'Previous snapshot, with a slow restore', 'Not always rehearsable; extensions with incompatible versions only show up at the time'],
            ['pg_dump and pg_restore', 'Proportional to volume, hours', 'Yes, the source stays intact', 'Only worth it for small databases or ones that tolerate the stop'],
            ['Logical replication', 'Seconds, in a controlled cutover', 'Yes, with reverse replication on', 'More work: primary keys, sequences, DDL and extensions handled by hand'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Logical replication decodes the source WAL into row changes (INSERT, UPDATE, DELETE, TRUNCATE) and applies them on the target as if they were SQL commands. Because the format is logical rather than physical, the two sides can run different versions: the target already runs 17 while the source stays on 12, and the switch becomes the decision of where the application points. The price is that it only carries what is in the WAL as a row change, and everything that is not needs its own plan.',
        },
      ],
    },
    {
      title: 'Prerequisites that sink the plan if discovered late',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Three discoveries tend to happen in the early hours of cutover day, when they should have happened a month earlier. The first is that wal_level = logical requires restarting the source, that is, a short stop that has to go into the next patch window. The second is that every table that receives UPDATE or DELETE needs a primary key or REPLICA IDENTITY; without it, from the moment the publication exists, those commands fail on the source with an error, not on the target. The third is that an extension with an incompatible version on the new release (an old pg_trgm, a PostGIS that changed major) only shows up when restoring the schema.',
        },
        {
          type: 'code',
          value: inventarioCode,
        },
        {
          type: 'list',
          items: [
            'Tables without a primary key: in the clinic SaaS there were 9 out of 212, all logs and imports. Four got a primary key with ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY in batches; five stayed with REPLICA IDENTITY FULL because they only receive INSERT.',
            'The replicator role needs REPLICATION and SELECT on the published tables; on version 12 the subscription must be created by a superuser on the target, and the replication connection must be allowed in the source\'s pg_hba.conf.',
            'A replication slot retains WAL until the subscriber confirms. If the target goes down for a night, the source accumulates WAL until the disk fills and it stops accepting writes. An alarm on pg_replication_slots is mandatory from day one.',
            'Large objects, UNLOGGED tables and materialized views are left out. In this case, 3,100 large objects holding reports were moved to object storage before the upgrade, which was old debt anyway.',
          ],
        },
      ],
    },
    {
      title: 'Schema, publication and the initial copy of 1.4 TB without hurting the source',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The schema goes first, without data, using the new version\'s pg_dump pointed at the old source: it knows how to emit DDL the new version accepts and warns about extensions missing on the target. Then comes the publication on the source and the subscription on the target with copy_data, which does the initial load table by table using COPY and, as each one finishes, starts applying changes in real time. What decides whether this takes 4 hours or 11 is what exists on the target during the copy: every secondary index is maintained on every inserted row, and every foreign key is checked.',
        },
        {
          type: 'code',
          value: copiaInicialCode,
        },
        {
          type: 'list',
          items: [
            'Dropping secondary indexes and foreign keys on the target before the copy and recreating them afterwards, with CONCURRENTLY, took the load from an estimated 11 hours to 4 hours and 10 minutes. Primary keys and UNIQUE stay: apply uses the replica identity to locate the row for each UPDATE.',
            'During the initial copy, the slot retains all WAL generated since the start. In this case it peaked at 180 GB, and the source needed 250 GB free that nobody had planned for. Measure WAL generation per hour before starting.',
            'Freeze schema migrations while replication exists, or apply every DDL on both sides in the same order. A new column only on the source stops apply on the target at the first INSERT that uses it.',
            'A table created after the publication does not join on its own, even with FOR ALL TABLES: create it on both sides and run ALTER SUBSCRIPTION sub_upgrade REFRESH PUBLICATION.',
            'Statistics are not copied. vacuumdb --analyze-in-stages before the cutover is what prevents the "upgrade made everything slow" of the first minutes.',
          ],
        },
      ],
    },
    {
      title: 'The cutover with traffic on: pause, prove, align, point',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the target in sync, lag under 2 seconds and indexes rebuilt, the cutover is a procedure of seconds that has to be a script, not a checklist run by hand. pgbouncer plays the central role: PAUSE waits for open transactions to finish and holds new ones in the queue, with no error for the client. The source becomes read-only, a marker written on the source proves the target received the last change, sequences are aligned, reverse replication is created and only then is pgbouncer reloaded pointing at the target and the queue drains.',
        },
        {
          type: 'code',
          value: corteCode,
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'Two decisions in the script deserve attention. Reverse replication is created before RESUME, with copy_data = false, because the slot is created at CREATE SUBSCRIPTION time: everything written on the target from then on flows back to the source, and no write escapes between creation and releasing the queue. And the script\'s point of no return is the pgbouncer RELOAD: until it, any exception reopens the source and releases the queue there, and the client saw only a pause. After it, going back means running the same procedure in the opposite direction, which is also rehearsed.',
        },
      ],
    },
    {
      title: 'What replication does not carry and how to prove the data matches',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The list of what logical replication does not transport is short, but every item becomes an incident if forgotten. Sequences are the classic: the target receives rows with the source\'s ids, but the target\'s sequence stays at 1, and the first INSERT after the cutover fails with a duplicate key. The setval with a margin in the script handles that. The rest is in the table.',
        },
        {
          type: 'table',
          columns: ['Object', 'What happens', 'What to do'],
          rows: [
            ['Sequences', 'Not replicated; the target keeps the initial value', 'setval(last_value + margin) at cutover, for all of them'],
            ['DDL', 'Not replicated; a new column only on the source stops apply on the target', 'Freeze migrations, or apply on both sides: ADD COLUMN on the target first, DROP COLUMN on the source first'],
            ['New table', 'FOR ALL TABLES only covers what existed; the target never receives it', 'Create on both sides and ALTER SUBSCRIPTION REFRESH PUBLICATION'],
            ['Large objects', 'Not replicated', 'Export with lo_export or move to bytea or object storage beforehand'],
            ['UNLOGGED tables', 'Never enter the WAL', 'Copy separately at cutover or accept the loss, if it is a cache'],
            ['Materialized views', 'Definition goes in the schema, data does not', 'REFRESH MATERIALIZED VIEW on the target before the cutover'],
            ['Partitioned table with a version 12 publisher', 'Only leaf partitions join, by name', 'Same partition names on both sides; publish_via_partition_root only exists from 13 on'],
            ['Table without REPLICA IDENTITY', 'UPDATE and DELETE fail on the source', 'Primary key or REPLICA IDENTITY FULL before creating the publication'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Proving the data matches means comparing source and target with the same query, over the same id range, with the same formatting parameters. The per-table count finds the table that was left out; the per-range hash finds the divergent row without pulling data out of the database. The comparison runs with replication active, before the cutover, and again right after, while reverse replication keeps both sides equal.',
        },
        {
          type: 'code',
          value: verificacaoCode,
        },
      ],
    },
    {
      title: 'Rehearse until the number is predictable, and what to do with the old database',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The production cutover was the fourth one. The three before it ran on a clone of the source receiving traffic replayed from the pgbouncer log, and each one found something: the first stopped at the marker because the table was not in the publication, the second took 40 seconds because a BI job outside pgbouncer was holding a transaction open, and the third showed that setval without a margin collided with cached values of sequences declared with CACHE 50. The numbers below are from the final rehearsal and repeated in production.',
        },
        {
          type: 'table',
          columns: ['Measurement', 'Value'],
          rows: [
            ['Volume', '1.4 TB, 212 tables, 96 sequences, 3,100 large objects migrated beforehand'],
            ['Initial copy with secondary indexes on the target', '11 hours estimated in the first rehearsal, aborted'],
            ['Initial copy without secondary indexes, 4 workers', '4 hours and 10 minutes'],
            ['Index rebuild with CONCURRENTLY', '1 hour and 50 minutes'],
            ['Peak WAL retained by the slot during the copy', '180 GB; the source needed 250 GB free'],
            ['Steady-state lag, before the cutover', 'Under 2 seconds'],
            ['pgbouncer pause at cutover', '9 seconds'],
            ['Errors seen by the client', 'Zero; API p99 at 11 seconds during the cutover minute'],
            ['Reverse replication kept', '7 days, covering one billing close'],
          ],
        },
        {
          type: 'ordered',
          items: [
            'Take the inventory: tables without a primary key, sequences, extensions, large objects, UNLOGGED and materialized views. Resolve each item before creating the publication.',
            'Turn on wal_level = logical in the next patch window and install the alarm for WAL retained per slot.',
            'Restore the schema on the target with the new version\'s pg_dump, drop secondary indexes and foreign keys, create the subscription with copy_data and watch pg_subscription_rel.',
            'Rebuild indexes with CONCURRENTLY, run ANALYZE in stages and compare counts and per-range hashes with replication active.',
            'Rehearse the cutover on a clone with replayed traffic until the pause has a predictable duration, including the way back.',
            'Run the cutover by script, with reverse replication created before RESUME, and keep the source in sync for a full business cycle before dropping the subscriptions and shutting down the old server.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does this work on a managed database, such as RDS, Cloud SQL or Azure?',
      answer:
        'It does, with two differences. wal_level is controlled by a provider parameter (rds.logical_replication on RDS, cloudsql.logical_decoding on Cloud SQL) and also requires a restart. And there is no superuser: the role needs the replication privilege the provider offers (rds_replication, for example), and the subscription is created with the administrator user. pgbouncer, or the equivalent proxy, remains the switching point; without it, the cutover becomes a connection string change with a deploy, which is slower and harder to revert.',
    },
    {
      question: 'What if a schema migration has to ship during the weeks of replication?',
      answer:
        'Apply it on both sides, in the right order. A new column goes on the target first and then on the source: the subscriber may have extra columns, but not fewer. A removed column leaves the source first and then the target. A new table is created on both sides and requires ALTER SUBSCRIPTION REFRESH PUBLICATION on the target, otherwise it never receives data. A new index can go on the target only, with CONCURRENTLY. The safest option is agreeing with the team on a migration-free window between the initial copy and the cutover, which is usually one to two weeks.',
    },
    {
      question: 'How long should reverse replication stay on, and when do I shut down the old database?',
      answer:
        'For one full business cycle: in the clinic SaaS it was a week, covering a billing close and an on-call weekend. During that period, going back means running the same cutover in the opposite direction, without losing data. When shutting down, drop the reverse subscription on the source before stopping the server, because the slot it created on the target retains WAL until removed, and a forgotten slot fills the new database\'s disk weeks later, when nobody remembers the upgrade anymore.',
    },
  ],
  conclusion: {
    title: 'Switching versions means changing where the application points',
    description:
      'pg_upgrade and the provider\'s managed upgrade convert the data with the database stopped and hand back a server without statistics, which for a SaaS with 1.4 TB and 24-hour customers is a window the business does not accept. Logical replication turns the upgrade into a target already on the new version receiving changes from the source, and the cutover becomes a script of seconds: pause in pgbouncer, make the source read-only, prove with a marker that nothing was left behind, align sequences, create reverse replication and point at the target. What demands care lives in the details that do not travel through the WAL: a primary key on every table, sequences, frozen DDL, extensions, large objects and statistics, plus the disk the slot will hold. With an inventory, a rehearsal on a clone and a way back kept on for a business cycle, the version switch leaves the "overnight window" category and joins the predictable procedure one.',
    cta: 'Plan my database upgrade without a window',
  },
  related: [
    {
      label: 'Zero downtime database migration: expand, migrate and contract without stopping writes',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'The backup nobody ever restored: turning a copy into an actual recovery guarantee',
      to: '/blog/backup-que-nunca-foi-restaurado-transformar-copia-em-garantia-de-recuperacao',
    },
    {
      label: 'Backend architecture and modernization service',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Un SaaS de gestión de clínicas corre en un Postgres 12 que perdió el soporte en noviembre de 2024. La base tiene 1,4 TB, 212 tablas y 3.800 transacciones por segundo en el pico, con clientes en tres husos horarios y unidades de urgencias que operan de madrugada. El proveedor ofrece la actualización gestionada con una "ventana estimada de 40 minutos", y el ensayo con pg_upgrade --link en una copia tomó 6 minutos de parada más 50 minutos de base lenta hasta que se regeneraron las estadísticas. Ninguna de las dos opciones pasa por la dirección. Este artículo muestra cómo pasar de la versión 12 a la 17 con replicación lógica y el tráfico activo: qué prerrequisitos hunden el plan cuando se descubren tarde, cómo montar el destino y hacer la copia inicial sin castigar el origen, cómo ejecutar el corte en segundos con camino de vuelta, qué no transporta la replicación y cómo demostrar que los datos coinciden, y cómo ensayar hasta que el número de segundos de pausa sea predecible.',
  sections: [
    {
      title: 'Por qué la ventana no cabe y qué cuesta cada camino de actualización',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una actualización de versión mayor cambia el formato interno del catálogo y, en algunos casos, de los archivos de datos. Por eso no ocurre con un reinicio: o los datos se convierten con la base detenida (pg_upgrade), o se reescriben desde cero en otro servidor (dump y restore), o se copian por replicación mientras la antigua sigue atendiendo. La actualización gestionada del proveedor es un pg_upgrade con una interfaz bonita, y la estimación de 40 minutos cubre un snapshot previo, la conversión, el reinicio y ningún ANALYZE: la base vuelve sin estadísticas y el planificador elige planes malos en la primera hora pico.',
        },
        {
          type: 'table',
          columns: ['Camino', 'Indisponibilidad', 'Vuelta atrás', 'Costo oculto'],
          rows: [
            ['pg_upgrade con copia', 'Horas para 1,4 TB', 'Sí, el directorio antiguo queda intacto', 'Duplica el disco; toda la copia ocurre con todo detenido'],
            ['pg_upgrade --link', 'Minutos, más el tiempo de ANALYZE', 'No: tras el primer arranque del clúster nuevo el antiguo queda inutilizable', 'Estadísticas en cero; cualquier error después del arranque es restaurar un backup'],
            ['Actualización gestionada del proveedor', '20 a 60 minutos, decididos por él', 'Snapshot anterior, con restauración lenta', 'No siempre permite ensayar; las extensiones con versión incompatible aparecen en el momento'],
            ['pg_dump y pg_restore', 'Proporcional al volumen, horas', 'Sí, el origen queda intacto', 'Solo vale para bases pequeñas o que toleran la parada'],
            ['Replicación lógica', 'Segundos, en un corte controlado', 'Sí, con replicación de vuelta activa', 'Más trabajo: claves primarias, secuencias, DDL y extensiones cuidados a mano'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La replicación lógica decodifica el WAL del origen en cambios de fila (INSERT, UPDATE, DELETE, TRUNCATE) y los aplica en el destino como si fueran comandos SQL. Como el formato es lógico y no físico, los dos lados pueden tener versiones distintas: el destino ya corre la 17 mientras el origen sigue en la 12, y el cambio se convierte en la decisión de hacia dónde apunta la aplicación. El precio es que solo transporta lo que está en el WAL como cambio de fila, y todo lo que no está necesita un plan propio.',
        },
      ],
    },
    {
      title: 'Prerrequisitos que hunden el plan si se descubren tarde',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Tres descubrimientos suelen ocurrir en la madrugada del corte, cuando deberían haber ocurrido un mes antes. El primero es que wal_level = logical exige reiniciar el origen, es decir, una pequeña parada que debe entrar en la próxima ventana de parches. El segundo es que toda tabla que recibe UPDATE o DELETE necesita clave primaria o REPLICA IDENTITY; sin eso, desde el momento en que existe la publicación, esos comandos fallan en el origen con error, no en el destino. El tercero es que una extensión con versión incompatible en la versión nueva (un pg_trgm antiguo, un PostGIS que cambió de mayor) solo aparece al restaurar el esquema.',
        },
        {
          type: 'code',
          value: inventarioCode,
        },
        {
          type: 'list',
          items: [
            'Tablas sin clave primaria: en el SaaS de clínicas eran 9 de 212, todas de log e importación. Cuatro recibieron clave primaria con ADD COLUMN id bigint GENERATED ALWAYS AS IDENTITY por lotes; cinco quedaron con REPLICA IDENTITY FULL porque solo reciben INSERT.',
            'El rol replicador necesita REPLICATION y SELECT sobre las tablas publicadas; en la versión 12 la suscripción debe crearla un superusuario en el destino, y la conexión de replicación debe estar permitida en el pg_hba.conf del origen.',
            'Un slot de replicación retiene WAL hasta que el suscriptor confirma. Si el destino cae una noche, el origen acumula WAL hasta llenar el disco y deja de aceptar escrituras. Una alarma sobre pg_replication_slots es obligatoria desde el primer día.',
            'Los large objects, las tablas UNLOGGED y las vistas materializadas quedan fuera. En este caso, 3.100 large objects con informes se movieron a almacenamiento de objetos antes de la actualización, lo que ya era deuda antigua.',
          ],
        },
      ],
    },
    {
      title: 'Esquema, publicación y copia inicial de 1,4 TB sin castigar el origen',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El esquema va primero, sin datos, usando el pg_dump de la versión nueva apuntado al origen antiguo: sabe emitir DDL que la versión nueva acepta y avisa de extensiones que no existen en el destino. Luego viene la publicación en el origen y la suscripción en el destino con copy_data, que hace la carga inicial tabla por tabla usando COPY y, al terminar cada una, empieza a aplicar los cambios en tiempo real. Lo que decide si esto tarda 4 horas u 11 es lo que existe en el destino durante la copia: cada índice secundario se mantiene en cada fila insertada, y cada clave foránea se verifica.',
        },
        {
          type: 'code',
          value: copiaInicialCode,
        },
        {
          type: 'list',
          items: [
            'Eliminar índices secundarios y claves foráneas en el destino antes de la copia y recrearlos después, con CONCURRENTLY, llevó la carga de 11 horas estimadas a 4 horas y 10 minutos. Clave primaria y UNIQUE se quedan: el apply usa la identidad de réplica para localizar la fila de cada UPDATE.',
            'Durante la copia inicial, el slot retiene todo el WAL generado desde el inicio. En este caso el pico fue de 180 GB, y el origen necesitó 250 GB libres que nadie había previsto. Mide la generación de WAL por hora antes de empezar.',
            'Congela las migraciones de esquema mientras exista la replicación, o aplica cada DDL en los dos lados en el mismo orden. Una columna nueva solo en el origen detiene el apply en el destino en el primer INSERT que la usa.',
            'Una tabla creada después de la publicación no entra sola, ni siquiera con FOR ALL TABLES: créala en los dos lados y ejecuta ALTER SUBSCRIPTION sub_upgrade REFRESH PUBLICATION.',
            'Las estadísticas no se copian. El vacuumdb --analyze-in-stages antes del corte es lo que evita el "la actualización dejó todo lento" de los primeros minutos.',
          ],
        },
      ],
    },
    {
      title: 'El corte con tráfico activo: pausar, demostrar, alinear, apuntar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con el destino sincronizado, retraso por debajo de 2 segundos e índices recreados, el corte es un procedimiento de segundos que tiene que ser un script, no una lista ejecutada a mano. El pgbouncer cumple el papel central: PAUSE espera a que las transacciones abiertas terminen y retiene las nuevas en la cola, sin error para el cliente. El origen pasa a solo lectura, un marcador escrito en el origen demuestra que el destino recibió el último cambio, las secuencias se alinean, se crea la replicación de vuelta y solo entonces se recarga el pgbouncer apuntando al destino y la cola drena.',
        },
        {
          type: 'code',
          value: corteCode,
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'Dos decisiones del script merecen atención. La replicación de vuelta se crea antes del RESUME, con copy_data = false, porque el slot se crea en el momento del CREATE SUBSCRIPTION: todo lo que se escriba en el destino desde ahí vuelve al origen, y ninguna escritura se escapa entre la creación y la liberación de la cola. Y el punto sin retorno del script es el RELOAD del pgbouncer: hasta él, cualquier excepción reabre el origen y libera la cola allí, y el cliente solo vio una pausa. Después de él, volver es ejecutar el mismo procedimiento en sentido contrario, que también se ensaya.',
        },
      ],
    },
    {
      title: 'Qué no transporta la replicación y cómo demostrar que los datos coinciden',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La lista de lo que la replicación lógica no transporta es corta, pero cada elemento se convierte en un incidente si se olvida. Las secuencias son el clásico: el destino recibe las filas con los ids del origen, pero la secuencia del destino sigue en 1, y el primer INSERT después del corte falla por clave duplicada. El setval con margen del script lo resuelve. El resto está en la tabla.',
        },
        {
          type: 'table',
          columns: ['Objeto', 'Qué ocurre', 'Qué hacer'],
          rows: [
            ['Secuencias', 'No se replican; el destino se queda con el valor inicial', 'setval(last_value + margen) en el corte, para todas'],
            ['DDL', 'No se replica; una columna nueva solo en el origen detiene el apply en el destino', 'Congelar migraciones, o aplicar en los dos lados: ADD COLUMN primero en el destino, DROP COLUMN primero en el origen'],
            ['Tabla nueva', 'FOR ALL TABLES solo cubre lo que existía; el destino nunca la recibe', 'Crear en los dos lados y ALTER SUBSCRIPTION REFRESH PUBLICATION'],
            ['Large objects', 'No se replican', 'Exportar con lo_export o mover a bytea o almacenamiento de objetos antes'],
            ['Tablas UNLOGGED', 'No entran en el WAL', 'Copiar aparte en el corte o aceptar la pérdida, si es caché'],
            ['Vistas materializadas', 'La definición va en el esquema, los datos no', 'REFRESH MATERIALIZED VIEW en el destino antes del corte'],
            ['Tabla particionada con publicador en la versión 12', 'Solo entran las particiones hoja, por nombre', 'Mismos nombres de partición en los dos lados; publish_via_partition_root solo existe desde la 13'],
            ['Tabla sin REPLICA IDENTITY', 'UPDATE y DELETE fallan en el origen', 'Clave primaria o REPLICA IDENTITY FULL antes de crear la publicación'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Demostrar que los datos coinciden es comparar origen y destino con la misma consulta, en el mismo rango de ids, con los mismos parámetros de formato. El conteo por tabla encuentra la tabla que quedó fuera; el hash por rango encuentra la fila divergente sin sacar los datos de la base. La comparación corre con la replicación activa, antes del corte, y de nuevo justo después, mientras la replicación de vuelta mantiene iguales los dos lados.',
        },
        {
          type: 'code',
          value: verificacaoCode,
        },
      ],
    },
    {
      title: 'Ensayar hasta que el número sea predecible, y qué hacer con la base antigua',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El corte en producción fue el cuarto. Los tres anteriores corrieron en un clon del origen recibiendo tráfico reproducido desde el log del pgbouncer, y cada uno encontró algo: el primero se detuvo en el marcador porque la tabla no estaba en la publicación, el segundo tardó 40 segundos porque un job de BI fuera del pgbouncer mantenía una transacción abierta, y el tercero mostró que el setval sin margen colisionaba con valores en caché de secuencias declaradas con CACHE 50. Los números de abajo son del ensayo final y se repitieron en producción.',
        },
        {
          type: 'table',
          columns: ['Medición', 'Valor'],
          rows: [
            ['Volumen', '1,4 TB, 212 tablas, 96 secuencias, 3.100 large objects migrados antes'],
            ['Copia inicial con índices secundarios en el destino', '11 horas estimadas en el primer ensayo, abortada'],
            ['Copia inicial sin índices secundarios, 4 workers', '4 horas y 10 minutos'],
            ['Recreación de índices con CONCURRENTLY', '1 hora y 50 minutos'],
            ['Pico de WAL retenido por el slot durante la copia', '180 GB; el origen necesitó 250 GB libres'],
            ['Retraso en régimen, antes del corte', 'Por debajo de 2 segundos'],
            ['Pausa del pgbouncer en el corte', '9 segundos'],
            ['Errores vistos por el cliente', 'Cero; p99 de la API en 11 segundos en el minuto del corte'],
            ['Replicación de vuelta mantenida', '7 días, cubriendo un cierre de facturación'],
          ],
        },
        {
          type: 'ordered',
          items: [
            'Haz el inventario: tablas sin clave primaria, secuencias, extensiones, large objects, UNLOGGED y vistas materializadas. Resuelve cada elemento antes de crear la publicación.',
            'Activa wal_level = logical en la próxima ventana de parches e instala la alarma de WAL retenido por slot.',
            'Restaura el esquema en el destino con el pg_dump de la versión nueva, elimina índices secundarios y claves foráneas, crea la suscripción con copy_data y sigue pg_subscription_rel.',
            'Recrea los índices con CONCURRENTLY, ejecuta ANALYZE por etapas y compara conteos y hashes por rango con la replicación activa.',
            'Ensaya el corte en un clon con tráfico reproducido hasta que la pausa tenga una duración predecible, incluido el camino de vuelta.',
            'Ejecuta el corte por script, con la replicación de vuelta creada antes del RESUME, y mantén el origen sincronizado durante un ciclo de negocio completo antes de eliminar las suscripciones y apagar el servidor antiguo.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Esto funciona en una base gestionada, como RDS, Cloud SQL o Azure?',
      answer:
        'Funciona, con dos diferencias. El wal_level se controla con un parámetro del proveedor (rds.logical_replication en RDS, cloudsql.logical_decoding en Cloud SQL) y también exige reinicio. Y no hay superusuario: el rol necesita el privilegio de replicación que ofrece el proveedor (rds_replication, por ejemplo), y la suscripción se crea con el usuario administrador. El pgbouncer, o el proxy equivalente, sigue siendo el punto de cambio; sin él, el corte se convierte en un cambio de cadena de conexión con deploy, que es más lento y más difícil de revertir.',
    },
    {
      question: '¿Y si una migración de esquema tiene que salir durante las semanas de replicación?',
      answer:
        'Aplícala en los dos lados, en el orden correcto. Una columna nueva entra primero en el destino y luego en el origen: el suscriptor puede tener columnas de más, pero no de menos. Una columna eliminada sale primero del origen y luego del destino. Una tabla nueva se crea en los dos lados y exige ALTER SUBSCRIPTION REFRESH PUBLICATION en el destino, si no nunca recibe datos. Un índice nuevo puede entrar solo en el destino, con CONCURRENTLY. Lo más seguro es acordar con el equipo una ventana sin migraciones entre la copia inicial y el corte, que suele ser de una a dos semanas.',
    },
    {
      question: '¿Cuánto tiempo mantener la replicación de vuelta y cuándo apagar la base antigua?',
      answer:
        'Durante un ciclo de negocio completo: en el SaaS de clínicas fue una semana, cubriendo un cierre de facturación y un fin de semana de guardia. Durante ese período, volver es ejecutar el mismo corte en sentido contrario, sin perder datos. Al apagar, elimina la suscripción de vuelta en el origen antes de detener el servidor, porque el slot que creó en el destino retiene WAL hasta que se elimina, y un slot olvidado llena el disco de la base nueva semanas después, cuando ya nadie recuerda la actualización.',
    },
  ],
  conclusion: {
    title: 'Cambiar de versión es cambiar hacia dónde apunta la aplicación',
    description:
      'El pg_upgrade y la actualización gestionada del proveedor convierten los datos con la base detenida y devuelven un servidor sin estadísticas, lo que para un SaaS con 1,4 TB y clientes las 24 horas es una ventana que el negocio no acepta. La replicación lógica convierte la actualización en un destino ya en la versión nueva recibiendo los cambios del origen, y el corte pasa a ser un script de segundos: pausar en el pgbouncer, poner el origen en solo lectura, demostrar con un marcador que nada quedó atrás, alinear las secuencias, crear la replicación de vuelta y apuntar al destino. Lo que exige cuidado está en los detalles que no viajan por el WAL: clave primaria en toda tabla, secuencias, DDL congelado, extensiones, large objects y estadísticas, más el disco que el slot va a retener. Con inventario, ensayo en un clon y camino de vuelta activo durante un ciclo de negocio, el cambio de versión sale de la categoría "ventana de madrugada" y entra en la de procedimiento predecible.',
    cta: 'Planificar la actualización de mi base sin ventana',
  },
  related: [
    {
      label: 'Migración de base de datos sin ventana: expandir, migrar y contraer sin detener la escritura',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'El backup que nunca se restauró: convertir la copia en una garantía real de recuperación',
      to: '/blog/backup-que-nunca-foi-restaurado-transformar-copia-em-garantia-de-recuperacao',
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
