// Conteudo do artigo: chave primaria int que vai estourar. Por que o limite chega antes do que o
// count(*) sugere e por que ALTER COLUMN TYPE bigint para a tabela por horas, quais caminhos
// existem e quanto cada um custa, o que precisa mudar na aplicacao antes do banco, como fazer a
// troca com coluna nova, gatilho, backfill em lotes, indice concorrente e NOT NULL sem varredura,
// e como fechar a migracao e impedir que a proxima tabela chegue ao mesmo ponto.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const deteccaoCode = `-- Quanto cada sequencia ja consumiu do tipo da coluna que ela alimenta.
-- Olha a SEQUENCIA, nao o max(id) nem o count(*): rollback, insert que falhou
-- e CACHE consomem valores que nunca viram linha.
SELECT c.relname AS tabela,
       a.attname AS coluna,
       format_type(a.atttypid, a.atttypmod) AS tipo,
       s.last_value,
       round(100.0 * s.last_value /
             CASE a.atttypid WHEN 'int2'::regtype THEN 32767 ELSE 2147483647 END, 1) AS pct_usado
FROM pg_sequences s
JOIN pg_namespace ns ON ns.nspname = s.schemaname
JOIN pg_class seq ON seq.relname = s.sequencename AND seq.relnamespace = ns.oid
JOIN pg_depend d ON d.objid = seq.oid
                AND d.classid = 'pg_class'::regclass
                AND d.refclassid = 'pg_class'::regclass
JOIN pg_class c ON c.oid = d.refobjid
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.refobjsubid
WHERE a.atttypid IN ('int2'::regtype, 'int4'::regtype)
  AND s.last_value IS NOT NULL
ORDER BY pct_usado DESC;

--      tabela       | coluna | tipo    | last_value | pct_usado
-- ------------------+--------+---------+------------+-----------
--  eventos_rastreio | id     | integer | 1868004113 |      87.0
--  notificacoes     | id     | integer |  812330954 |      37.8

-- Quem guarda esse id com outro nome e tambem vai estourar: as chaves estrangeiras.
SELECT con.conrelid::regclass AS tabela_filha,
       a.attname AS coluna,
       format_type(a.atttypid, a.atttypmod) AS tipo
FROM pg_constraint con
JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
WHERE con.contype = 'f'
  AND con.confrelid = 'eventos_rastreio'::regclass;`;

const tipoAplicacaoCode = `// db.js
// Depois da troca, a coluna id passa a ser int8. O node-postgres entrega int8
// como string, para nao perder precisao acima de 2^53: o mesmo id que hoje chega
// como 1868004113 passaria a chegar como "2147490001", e todo === entre id do
// banco e id da rota quebraria em silencio. Ids desta base levariam milhoes de
// anos para passar de 2^53, entao convertemos para number e falhamos alto se a
// premissa um dia quebrar. Este deploy sai ANTES da migracao: ele tambem muda
// count(*) e sum() de string para number, o que precisa ser testado com calma.
import pg from 'pg';

pg.types.setTypeParser(pg.types.builtins.INT8, (valor) => {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero)) {
    throw new RangeError(\`int8 fora do intervalo seguro do JavaScript: \${valor}\`);
  }
  return numero;
});

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  application_name: 'api-rastreio',
});`;

const preparoCode = `-- 1. Colunas novas sem DEFAULT: so altera o catalogo, nao reescreve a tabela.
--    O lock_timeout impede que o ALTER fique na fila atras de uma transacao longa
--    travando todas as consultas que chegarem depois dele. Se estourar, tente de novo.
SET lock_timeout = '2s';
ALTER TABLE eventos_rastreio ADD COLUMN id_novo bigint;
ALTER TABLE eventos_anexos ADD COLUMN evento_id_novo bigint;

-- 2. Gatilhos: toda linha inserida daqui em diante ja nasce com a copia.
--    O DEFAULT nextval() e aplicado antes do BEFORE INSERT, entao NEW.id existe.
--    UPDATE OF id dispara so quando o proprio id muda: o backfill, que altera
--    apenas id_novo, nao paga o custo do gatilho.
CREATE FUNCTION eventos_rastreio_copia_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.id_novo := NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER eventos_rastreio_copia_id
  BEFORE INSERT OR UPDATE OF id ON eventos_rastreio
  FOR EACH ROW EXECUTE FUNCTION eventos_rastreio_copia_id();

CREATE FUNCTION eventos_anexos_copia_evento_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.evento_id_novo := NEW.evento_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER eventos_anexos_copia_evento_id
  BEFORE INSERT OR UPDATE OF evento_id ON eventos_anexos
  FOR EACH ROW EXECUTE FUNCTION eventos_anexos_copia_evento_id();

-- 3. O backfill vai criar uma versao nova de cada linha. Autovacuum agressivo
--    nesta tabela durante a migracao, para o espaco morto ser reaproveitado
--    pelos lotes seguintes em vez de dobrar o tamanho do arquivo.
ALTER TABLE eventos_rastreio SET (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 5000000,
  autovacuum_vacuum_cost_limit = 2000
);`;

const backfillCode = `// backfill.js
// Copia a coluna int para a bigint em lotes por faixa de chave, com pausa entre
// lotes e freio por atraso de replica. Pode ser interrompido e retomado: linhas
// ja copiadas nao sao tocadas de novo (destino IS NULL) e o progresso vai para o log.
// Rode DEPOIS de criar os gatilhos: o max lido aqui cobre tudo que existia antes
// deles, e o que entrar depois ja chega copiado.
// Uso: node backfill.js eventos_rastreio [chave_inicial]
import pg from 'pg';

// Lista fechada: os nomes entram no SQL, entao nunca vem de entrada externa.
const ALVOS = {
  eventos_rastreio: { chave: 'id', origem: 'id', destino: 'id_novo' },
  eventos_anexos: { chave: 'id', origem: 'evento_id', destino: 'evento_id_novo' },
};
const LOTE = 20_000;
const PAUSA_MS = 150;
const ATRASO_MAX_BYTES = 256 * 1024 * 1024;

const [tabela, retomarDe = '0'] = process.argv.slice(2);
const alvo = ALVOS[tabela];
if (!alvo) throw new Error(\`tabela fora da lista: \${tabela}\`);

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  application_name: 'backfill-bigint',
});
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function atrasoReplica() {
  const { rows } = await client.query(\`
    SELECT COALESCE(MAX(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)), 0)::text AS atraso
    FROM pg_stat_replication\`);
  return Number(rows[0].atraso);
}

async function main() {
  await client.connect();
  // Lote que espera linha travada pela aplicacao desiste em vez de empilhar.
  await client.query("SET statement_timeout = '60s'");

  const { rows } = await client.query(\`SELECT max(\${alvo.chave})::text AS max FROM \${tabela}\`);
  const max = Number(rows[0].max ?? 0);
  let inicio = Number(retomarDe);
  let lotes = 0;
  let copiadas = 0;
  const t0 = Date.now();

  while (inicio <= max) {
    const fim = inicio + LOTE - 1;
    const { rowCount } = await client.query(
      \`UPDATE \${tabela} SET \${alvo.destino} = \${alvo.origem}
       WHERE \${alvo.chave} BETWEEN $1 AND $2 AND \${alvo.destino} IS NULL\`,
      [inicio, fim],
    );
    copiadas += rowCount;
    lotes += 1;

    if (lotes % 100 === 0) {
      const porSegundo = Math.round(copiadas / ((Date.now() - t0) / 1000));
      console.log(JSON.stringify({ tabela, ate: fim, copiadas, porSegundo,
        pct: ((fim / max) * 100).toFixed(2) }));
    }

    // Replica atrasada vira leitura velha para quem le dela: o backfill espera.
    while ((await atrasoReplica()) > ATRASO_MAX_BYTES) {
      console.log(JSON.stringify({ tabela, ate: fim, freio: 'atraso de replica' }));
      await esperar(5000);
    }

    inicio = fim + 1;
    await esperar(PAUSA_MS);
  }

  console.log(JSON.stringify({ tabela, fim: true, copiadas }));
  await client.end();
}

main().catch(async (erro) => {
  console.error(erro);
  await client.end().catch(() => {});
  process.exit(1);
});`;

const trocaCode = `-- 4. Depois do backfill: estatistica da coluna nova e indices sem travar escrita.
--    CREATE INDEX CONCURRENTLY que falha deixa um indice INVALID para tras:
--    confira pg_index.indisvalid e, se for o caso, DROP INDEX CONCURRENTLY e repita.
ANALYZE eventos_rastreio (id_novo);
CREATE UNIQUE INDEX CONCURRENTLY eventos_rastreio_id_novo_uidx ON eventos_rastreio (id_novo);
CREATE INDEX CONCURRENTLY eventos_anexos_evento_id_novo_idx ON eventos_anexos (evento_id_novo);

-- 5. NOT NULL em duas etapas. NOT VALID e instantaneo; VALIDATE varre a tabela com
--    SHARE UPDATE EXCLUSIVE, que nao bloqueia leitura nem escrita. A partir do
--    Postgres 12, SET NOT NULL usa esse CHECK validado e nao varre de novo.
--    O VALIDATE e tambem a prova de que o backfill nao pulou nenhuma linha.
ALTER TABLE eventos_rastreio
  ADD CONSTRAINT id_novo_not_null CHECK (id_novo IS NOT NULL) NOT VALID;
ALTER TABLE eventos_rastreio VALIDATE CONSTRAINT id_novo_not_null;
ALTER TABLE eventos_anexos
  ADD CONSTRAINT evento_id_novo_not_null CHECK (evento_id_novo IS NOT NULL) NOT VALID;
ALTER TABLE eventos_anexos VALIDATE CONSTRAINT evento_id_novo_not_null;

-- 6. A troca. Tudo aqui so mexe em catalogo: o ACCESS EXCLUSIVE dura milissegundos.
--    Rodar com psql -v ON_ERROR_STOP=1 e repetir se cair no lock_timeout.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE eventos_rastreio, eventos_anexos IN ACCESS EXCLUSIVE MODE;

-- Os gatilhos referenciam os nomes antigos e quebrariam depois do RENAME.
DROP TRIGGER eventos_rastreio_copia_id ON eventos_rastreio;
DROP TRIGGER eventos_anexos_copia_evento_id ON eventos_anexos;

-- A FK depende do indice da PK antiga: sai primeiro, volta no fim.
ALTER TABLE eventos_anexos DROP CONSTRAINT eventos_anexos_evento_id_fkey;

-- Pai: PK nova sobre o indice que ja existe.
ALTER TABLE eventos_rastreio DROP CONSTRAINT eventos_rastreio_pkey;
ALTER TABLE eventos_rastreio ALTER COLUMN id_novo SET NOT NULL;
ALTER TABLE eventos_rastreio DROP CONSTRAINT id_novo_not_null;
ALTER TABLE eventos_rastreio
  ADD CONSTRAINT eventos_rastreio_pkey PRIMARY KEY USING INDEX eventos_rastreio_id_novo_uidx;

-- Sequencia muda de tipo e de dono. A coluna antiga perde DEFAULT e NOT NULL,
-- senao todo INSERT novo falharia por nao preencher id_int_antigo.
ALTER TABLE eventos_rastreio ALTER COLUMN id DROP DEFAULT;
ALTER TABLE eventos_rastreio ALTER COLUMN id DROP NOT NULL;
ALTER SEQUENCE eventos_rastreio_id_seq AS bigint MAXVALUE 9223372036854775807;
ALTER TABLE eventos_rastreio RENAME COLUMN id TO id_int_antigo;
ALTER TABLE eventos_rastreio RENAME COLUMN id_novo TO id;
ALTER TABLE eventos_rastreio ALTER COLUMN id SET DEFAULT nextval('eventos_rastreio_id_seq');
ALTER SEQUENCE eventos_rastreio_id_seq OWNED BY eventos_rastreio.id;

-- Filha: mesma troca, sem PK envolvida.
ALTER TABLE eventos_anexos ALTER COLUMN evento_id_novo SET NOT NULL;
ALTER TABLE eventos_anexos DROP CONSTRAINT evento_id_novo_not_null;
ALTER TABLE eventos_anexos ALTER COLUMN evento_id DROP NOT NULL;
ALTER TABLE eventos_anexos RENAME COLUMN evento_id TO evento_id_int_antigo;
ALTER TABLE eventos_anexos RENAME COLUMN evento_id_novo TO evento_id;

-- Views ficam presas ao numero da coluna, nao ao nome: depois do RENAME elas
-- passariam a ler id_int_antigo. CREATE OR REPLACE nao aceita mudar o tipo da
-- coluna da view, entao e DROP e CREATE aqui dentro, com os GRANTs de volta.
DROP VIEW eventos_recentes;
CREATE VIEW eventos_recentes AS
  SELECT id, entrega_id, tipo, criado_em
  FROM eventos_rastreio
  WHERE criado_em > now() - interval '7 days';
GRANT SELECT ON eventos_recentes TO painel_suporte;

-- FK de volta, apontando para a PK bigint, sem validar agora (validar varre a filha).
ALTER TABLE eventos_anexos ADD CONSTRAINT eventos_anexos_evento_id_fkey
  FOREIGN KEY (evento_id) REFERENCES eventos_rastreio (id) NOT VALID;
COMMIT;

-- Fora da transacao, com SHARE UPDATE EXCLUSIVE: leitura e escrita continuam.
ALTER TABLE eventos_anexos VALIDATE CONSTRAINT eventos_anexos_evento_id_fkey;
ALTER TABLE eventos_rastreio RESET (autovacuum_vacuum_scale_factor,
  autovacuum_vacuum_threshold, autovacuum_vacuum_cost_limit);`;

const diagramaPt = `Linha do tempo da migração de eventos_rastreio (31 dias de margem no dia 0).

  D0        detecção              sequência em 87%, 9,1 milhões de ids por dia
            |
  D1-D2     aplicação             parser de int8, clientes int32, Avro e mapeamento do índice de busca
            |
  D3        ADD COLUMN + gatilhos 12 ms cada, uma retentativa por lock_timeout
            |
  D3-D5     backfill do pai       1,41 bilhão de linhas em 41 h; freio de réplica acionado 37 vezes
            |
  D5        backfill da filha     380 milhões de linhas em 9 h
            |
  D6        índices e VALIDATE    2 h 50 + 48 min concorrentes; CHECK validado em 52 min
            |
  D7        troca                 380 ms de ACCESS EXCLUSIVE; p99 da API sem alteração visível
            |
  D7        VALIDATE da FK        1 h 20 com leitura e escrita normais
            |
  D14       DROP das colunas int  colunas antigas removidas depois de uma semana sem uso`;

const diagramaEn = `Migration timeline for eventos_rastreio (31 days of headroom on day 0).

  D0        detection             sequence at 87%, 9.1 million ids per day
            |
  D1-D2     application           int8 parser, int32 clients, Avro and search index mapping
            |
  D3        ADD COLUMN + triggers 12 ms each, one retry due to lock_timeout
            |
  D3-D5     parent backfill       1.41 billion rows in 41 h; replica brake triggered 37 times
            |
  D5        child backfill        380 million rows in 9 h
            |
  D6        indexes and VALIDATE  2 h 50 + 48 min concurrently; CHECK validated in 52 min
            |
  D7        swap                  380 ms of ACCESS EXCLUSIVE; API p99 with no visible change
            |
  D7        FK VALIDATE           1 h 20 with normal reads and writes
            |
  D14       DROP int columns      old columns removed after a week without use`;

const diagramaEs = `Línea de tiempo de la migración de eventos_rastreio (31 días de margen en el día 0).

  D0        detección             secuencia en 87%, 9,1 millones de ids por día
            |
  D1-D2     aplicación            parser de int8, clientes int32, Avro y mapeo del índice de búsqueda
            |
  D3        ADD COLUMN + triggers 12 ms cada uno, un reintento por lock_timeout
            |
  D3-D5     backfill del padre    1,41 mil millones de filas en 41 h; freno de réplica activado 37 veces
            |
  D5        backfill de la hija   380 millones de filas en 9 h
            |
  D6        índices y VALIDATE    2 h 50 + 48 min concurrentes; CHECK validado en 52 min
            |
  D7        cambio                380 ms de ACCESS EXCLUSIVE; p99 de la API sin cambio visible
            |
  D7        VALIDATE de la FK     1 h 20 con lectura y escritura normales
            |
  D14       DROP de columnas int  columnas antiguas eliminadas tras una semana sin uso`;

const pt = {
  intro:
    'Uma plataforma de rastreamento de entregas grava cada leitura de scanner, mudança de status e tentativa de entrega na tabela eventos_rastreio, criada há seis anos com id serial, ou seja, integer de 32 bits. Em uma revisão de rotina, alguém percebe que os ids da tela de suporte já passam de 1,8 bilhão. A sequência está em 1.868.004.113, 87% dos 2.147.483.647 que o tipo aceita, e consome 9,1 milhões de valores por dia: faltam 31 dias para todo INSERT falhar com "reached maximum value of sequence". A tabela tem 410 GB, recebe escrita 24 horas e o ALTER COLUMN TYPE bigint ensaiado em um clone segurou a tabela bloqueada por 6 horas e 10 minutos. Este artigo mostra por que o limite chega antes do que o count(*) sugere, quais caminhos existem e quanto cada um custa, o que precisa mudar na aplicação antes de tocar no banco, como trocar para bigint com coluna nova, gatilho, backfill em lotes e uma troca de 380 ms, e como garantir que a próxima tabela não chegue ao mesmo ponto.',
  sections: [
    {
      title: 'Por que o int estoura antes do que o count(*) diz',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O número que importa não é quantas linhas a tabela tem, e sim o último valor que a sequência entregou. Toda chamada a nextval() consome um valor para sempre: INSERT que deu rollback, INSERT que falhou por violação de restrição, ON CONFLICT DO NOTHING que descartou a linha e os valores pré-alocados por CACHE em conexões que morreram. Na eventos_rastreio, o count(*) mostrava 1,41 bilhão de linhas, porque eventos com mais de dois anos são apagados, enquanto a sequência já estava em 1,87 bilhão. Quem monitora pelo tamanho da tabela descobre o problema pelo erro.',
        },
        {
          type: 'code',
          value: deteccaoCode,
        },
        {
          type: 'paragraph',
          value:
            'O caminho óbvio, ALTER TABLE eventos_rastreio ALTER COLUMN id TYPE bigint, reescreve a tabela inteira, porque cada linha muda de tamanho físico, e reconstrói todos os índices. Durante esse tempo ele segura ACCESS EXCLUSIVE, o bloqueio que impede até SELECT. Em uma tabela de poucos gigabytes isso é um minuto em uma janela; em 410 GB foram 6 horas e 10 minutos no clone, com o disco precisando de espaço para duas cópias. E ele não resolve sozinho: a coluna evento_id em eventos_anexos, que referencia esse id, também é integer e estoura no mesmo dia.',
        },
      ],
    },
    {
      title: 'Os caminhos possíveis e quanto cada um custa',
      blocks: [
        {
          type: 'table',
          columns: ['Caminho', 'Bloqueio', 'Neste caso', 'Quando faz sentido'],
          rows: [
            ['ALTER COLUMN TYPE bigint direto', 'ACCESS EXCLUSIVE durante toda a reescrita', '6 h 10 de tabela parada no clone', 'Tabelas de poucos GB ou quando a janela é aceita'],
            ['Tabela nova, cópia e troca de nome', 'Curto, só no final', 'Dias de cópia e o dobro do disco', 'Quando a tabela já vai ser reorganizada ou particionada junto'],
            ['Coluna nova, gatilho, backfill e troca', 'Milissegundos na troca', '7 dias de calendário, 380 ms de bloqueio', 'Tabela grande, em uso contínuo, com prazo de semanas'],
            ['Sequência em valores negativos', 'Nenhum', 'Segundos', 'Torniquete quando faltam horas ou poucos dias; não resolve'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O torniquete merece explicação, porque é o que salva quando o problema é descoberto tarde demais. ALTER SEQUENCE eventos_rastreio_id_seq MINVALUE -2147483648 RESTART WITH -2147483648 devolve mais 2,1 bilhões de valores sem tocar na tabela: a sequência sobe de -2.147.483.648 até -1 antes de colidir com os ids existentes. O preço é alto e escondido: ORDER BY id deixa de significar ordem de criação, paginação por cursor em id quebra, validações do tipo id > 0 rejeitam linhas novas e qualquer integração que trata id como sem sinal falha. É uma forma de ganhar meses para fazer a migração certa, não uma alternativa a ela.',
        },
        {
          type: 'paragraph',
          value:
            'Com 31 dias de margem, o caminho escolhido foi a coluna nova. A ideia é a mesma do padrão expandir e contrair: criar id_novo bigint ao lado de id, manter as duas iguais para tudo que for escrito a partir de agora, copiar o passado em lotes pequenos, construir índice e restrições sem bloquear e, no fim, trocar os nomes em uma transação que só mexe em catálogo. A tabela nunca fica bloqueada por mais do que alguns milissegundos.',
        },
      ],
    },
    {
      title: 'Antes do banco: a aplicação precisa aceitar bigint',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A parte do banco é mecânica; o que derruba a migração é o que está fora dele. No momento da troca, a coluna id passa a ser int8, e cada camada que lê esse valor precisa estar pronta para números acima de 2.147.483.647 antes que o primeiro deles exista. Isso vem primeiro no cronograma, com deploy próprio, porque é a parte que não dá para desfazer depressa.',
        },
        {
          type: 'code',
          value: tipoAplicacaoCode,
        },
        {
          type: 'list',
          items: [
            'Drivers: o node-postgres entrega int8 como string; o código acima converte para number com verificação. O mesmo deploy muda o retorno de count(*) e sum(), que também são int8, então comparações como total === \'0\' precisam ser procuradas antes.',
            'Clientes tipados: o aplicativo Android guardava o id em Int, o serviço de faturamento em Go usava int32 e um contrato protobuf declarava int32 evento_id. Todos foram para 64 bits antes do D3; em Java e Kotlin, Int estoura em 2.147.483.647 exatamente como o Postgres.',
            'Eventos e CDC: o schema Avro publicado pelo Debezium mudou de int para long, uma promoção que o Avro aceita para leitores atualizados. Os consumidores foram atualizados antes, porque um leitor com schema antigo não lê long.',
            'Busca e analytics: o mapeamento do índice de busca tinha id como integer, que não aceita valores acima de 2^31. Foi reindexado como long. No data warehouse, a coluna já era INT64.',
            'Banco: views que selecionam id, funções SQL com parâmetro integer e colunas de outras tabelas que guardam o id sem chave estrangeira, como entregas.ultimo_evento_id. Uma busca por "evento" com tipo integer no information_schema.columns encontrou três.',
          ],
        },
      ],
    },
    {
      title: 'Coluna nova, gatilho e backfill sem inchar a tabela',
      blocks: [
        {
          type: 'paragraph',
          value:
            'ADD COLUMN sem DEFAULT só registra a coluna no catálogo e termina em milissegundos, mas precisa de um bloqueio curto. Se houver uma transação longa aberta na tabela, o ALTER fica na fila e todas as consultas que chegam depois esperam atrás dele: é assim que um comando instantâneo derruba a API. O lock_timeout de 2 segundos troca esse risco por uma retentativa. Os gatilhos garantem que tudo que for inserido a partir de agora já nasce com a cópia, e só depois deles o backfill começa.',
        },
        {
          type: 'code',
          value: preparoCode,
        },
        {
          type: 'code',
          value: backfillCode,
        },
        {
          type: 'paragraph',
          value:
            'Três detalhes fazem o backfill não virar o incidente. Primeiro, lotes por faixa de chave primária, não por LIMIT com OFFSET, para cada UPDATE usar o índice e tocar só páginas vizinhas. Segundo, o índice da coluna nova só é criado depois do backfill: sem índice em id_novo e com espaço livre na página, o Postgres faz HOT update e não precisa gravar entrada nova em nenhum índice. Como as exclusões de retenção deixavam espaço livre em boa parte das páginas, cerca de um terço das atualizações saiu como HOT, e o autovacuum agressivo devolveu espaço para os lotes seguintes. Terceiro, o freio por atraso de réplica: cada lote gera WAL, e uma réplica de leitura 30 segundos atrasada mostra para o usuário um pacote que ainda não saiu. Com lotes de 20 mil linhas e pausa de 150 ms, o pai levou 41 horas e o freio parou o processo 37 vezes, quase sempre durante o pico da tarde.',
        },
      ],
    },
    {
      title: 'Índice, NOT NULL sem varredura e a troca em milissegundos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com o backfill terminado, falta deixar a coluna nova pronta para ser chave primária sem nenhum passo que bloqueie por muito tempo. O índice único é criado com CONCURRENTLY. O NOT NULL entra em duas etapas: um CHECK NOT VALID, instantâneo, e um VALIDATE, que varre a tabela com um bloqueio que não impede leitura nem escrita. Desde o Postgres 12, o SET NOT NULL encontra esse CHECK validado e não varre de novo. O VALIDATE serve também como auditoria: se o backfill tivesse pulado uma faixa, ele falharia aqui, antes da troca, e não depois.',
        },
        {
          type: 'code',
          value: trocaCode,
        },
        {
          type: 'paragraph',
          value:
            'A transação da troca executa mais de vinte comandos, e nenhum deles lê dados: PRIMARY KEY USING INDEX reaproveita o índice pronto, SET NOT NULL usa o CHECK validado, RENAME e mudança de tipo da sequência são catálogo. No ensaio com tráfego reproduzido ela levou 380 ms, e na produção, a primeira tentativa caiu no lock_timeout por causa de um relatório aberto havia 40 segundos e a segunda passou. A chave estrangeira volta NOT VALID e é validada depois, fora da transação, porque validar varre eventos_anexos inteira.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
      ],
    },
    {
      title: 'Depois da troca: limpar, validar e não repetir',
      blocks: [
        {
          type: 'ordered',
          items: [
            'Acompanhe por uma semana o primeiro id acima de 2.147.483.647 passando por todas as camadas: API, aplicativo, eventos, busca e relatórios. No caso, ele apareceu 31 dias depois do D0, como previsto, e a única falha foi um script interno de exportação em Python que fazia struct.pack(\'i\', id).',
            'Remova as colunas antigas com ALTER TABLE DROP COLUMN, que é só catálogo e termina em milissegundos. O espaço de 4 bytes por linha não volta de imediato; ele é reaproveitado à medida que as linhas são reescritas, o que é aceitável.',
            'Transforme a consulta de detecção em alerta: aviso em 50% e página em 75% para qualquer coluna int2 ou int4 alimentada por sequência. Na mesma varredura apareceu notificacoes em 37,8%, que foi migrada com calma no mês seguinte.',
            'Mude o padrão: tabela nova usa bigint GENERATED ALWAYS AS IDENTITY, e o lint de migrações rejeita serial e integer em chave primária. Os 4 bytes extras por linha custam muito menos do que a próxima migração com prazo.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'E se a coluna for identity, e não serial?',
      answer:
        'A sequência de uma coluna identity pertence à coluna e não pode ser simplesmente transferida para outra com OWNED BY. Na transação da troca, leia o último valor, rode ALTER TABLE ... ALTER COLUMN id DROP IDENTITY na coluna antiga e, já com a coluna nova renomeada e NOT NULL, rode ALTER TABLE ... ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (START WITH ultimo_valor + 1000). Os dois comandos são de catálogo. A margem de mil cobre valores pré-alocados por CACHE que ainda estejam em conexões abertas.',
    },
    {
      question: 'Já que vou mexer na chave, não vale trocar para UUID?',
      answer:
        'São problemas diferentes. O int estourando é falta de capacidade, e bigint resolve isso para sempre com 8 bytes. Trocar para UUID muda o tipo em toda chave estrangeira, em todos os clientes e contratos, dobra o tamanho de cada índice que carrega a chave e, com UUID v4, espalha as inserções pelo índice inteiro. Se o motivo real é não expor ids sequenciais, adicione uma coluna de identificador público, de preferência UUID v7, sem mexer na chave interna.',
    },
    {
      question: 'E se faltarem só horas, e não semanas?',
      answer:
        'Primeiro, o torniquete: reinicie a sequência em -2.147.483.648, o que dá mais 2,1 bilhões de valores sem tocar na tabela. Antes, confirme em minutos que o código não depende de id positivo nem de ordenação por id, e aceite que algumas telas vão ordenar errado por um tempo. Com a margem recuperada, faça a migração completa descrita aqui. Sem nenhuma das duas coisas, quando a sequência atingir o máximo, todo INSERT na tabela falha, e a aplicação para de registrar o que mais importa para ela.',
    },
  ],
  conclusion: {
    title: 'A troca de tipo é catálogo; o trabalho está em volta dela',
    description:
      'Uma chave primária integer alimentada por sequência estoura pelo último valor entregue, não pelo número de linhas, e o ALTER COLUMN TYPE que parece resolver segura a tabela bloqueada por horas em qualquer volume relevante. A migração sem parada transforma a mudança em etapas que nunca bloqueiam: aplicação pronta para int8 primeiro, coluna nova e gatilhos, backfill em lotes com freio de réplica, índice concorrente, NOT NULL validado sem varredura e uma troca de nomes de 380 ms, com a chave estrangeira validada depois. O que exige atenção está fora do banco, em drivers, clientes de 32 bits, schemas de eventos e índices de busca, e em detalhes como views presas ao número da coluna e a coluna antiga que perde o NOT NULL. Com a consulta de detecção virando alerta e bigint como padrão, a próxima tabela não chega a 87%.',
    cta: 'Revisar as chaves e migrações do meu banco',
  },
  related: [
    {
      label: 'Migração de banco sem janela: expandir, migrar e contrair sem derrubar escrita',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
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
    'A delivery tracking platform writes every scanner read, status change and delivery attempt to the eventos_rastreio table, created six years ago with a serial id, that is, a 32-bit integer. During a routine review, someone notices that ids on the support screen are already past 1.8 billion. The sequence is at 1,868,004,113, 87% of the 2,147,483,647 the type allows, and it consumes 9.1 million values a day: 31 days remain until every INSERT fails with "reached maximum value of sequence". The table holds 410 GB, takes writes around the clock, and the ALTER COLUMN TYPE bigint rehearsed on a clone kept the table locked for 6 hours and 10 minutes. This article shows why the limit arrives sooner than count(*) suggests, which paths exist and what each one costs, what has to change in the application before touching the database, how to switch to bigint with a new column, a trigger, batched backfill and a 380 ms swap, and how to make sure the next table never reaches the same point.',
  sections: [
    {
      title: 'Why the int overflows sooner than count(*) says',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The number that matters is not how many rows the table has, but the last value the sequence handed out. Every nextval() call consumes a value forever: an INSERT that rolled back, an INSERT that failed on a constraint violation, an ON CONFLICT DO NOTHING that discarded the row, and values preallocated by CACHE in connections that died. On eventos_rastreio, count(*) showed 1.41 billion rows, because events older than two years are deleted, while the sequence was already at 1.87 billion. Whoever monitors table size finds out about the problem from the error.',
        },
        {
          type: 'code',
          value: deteccaoCode,
        },
        {
          type: 'paragraph',
          value:
            'The obvious path, ALTER TABLE eventos_rastreio ALTER COLUMN id TYPE bigint, rewrites the whole table, because every row changes physical size, and rebuilds every index. For that whole time it holds ACCESS EXCLUSIVE, the lock that blocks even SELECT. On a table of a few gigabytes that is one minute inside a window; on 410 GB it took 6 hours and 10 minutes on the clone, with the disk needing room for two copies. And it does not solve the problem on its own: the evento_id column in eventos_anexos, which references that id, is also integer and overflows on the same day.',
        },
      ],
    },
    {
      title: 'The possible paths and what each one costs',
      blocks: [
        {
          type: 'table',
          columns: ['Path', 'Lock', 'In this case', 'When it makes sense'],
          rows: [
            ['Direct ALTER COLUMN TYPE bigint', 'ACCESS EXCLUSIVE for the entire rewrite', '6 h 10 of a frozen table on the clone', 'Tables of a few GB, or when the window is acceptable'],
            ['New table, copy and rename', 'Short, only at the end', 'Days of copying and twice the disk', 'When the table is about to be reorganized or partitioned anyway'],
            ['New column, trigger, backfill and swap', 'Milliseconds at the swap', '7 calendar days, 380 ms of locking', 'Large table, in continuous use, with weeks of headroom'],
            ['Sequence into negative values', 'None', 'Seconds', 'Tourniquet when hours or a few days remain; not a fix'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The tourniquet deserves an explanation, because it is what saves you when the problem is found too late. ALTER SEQUENCE eventos_rastreio_id_seq MINVALUE -2147483648 RESTART WITH -2147483648 gives back another 2.1 billion values without touching the table: the sequence climbs from -2,147,483,648 to -1 before colliding with existing ids. The price is high and hidden: ORDER BY id no longer means creation order, cursor pagination on id breaks, checks like id > 0 reject new rows, and any integration that treats id as unsigned fails. It is a way to buy months to do the right migration, not an alternative to it.',
        },
        {
          type: 'paragraph',
          value:
            'With 31 days of headroom, the chosen path was the new column. The idea is the same as the expand and contract pattern: create id_novo bigint next to id, keep both equal for everything written from now on, copy the past in small batches, build the index and constraints without blocking and, at the end, swap the names in a transaction that only touches the catalog. The table is never locked for more than a few milliseconds.',
        },
      ],
    },
    {
      title: 'Before the database: the application must accept bigint',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The database part is mechanical; what sinks the migration is everything outside it. At the moment of the swap, the id column becomes int8, and every layer that reads this value must be ready for numbers above 2,147,483,647 before the first one exists. This comes first in the schedule, with its own deploy, because it is the part that cannot be undone quickly.',
        },
        {
          type: 'code',
          value: tipoAplicacaoCode,
        },
        {
          type: 'list',
          items: [
            'Drivers: node-postgres returns int8 as a string; the code above converts it to a number with a check. The same deploy changes what count(*) and sum() return, since they are also int8, so comparisons such as total === \'0\' need to be found first.',
            'Typed clients: the Android app stored the id in an Int, the Go billing service used int32 and a protobuf contract declared int32 evento_id. All of them moved to 64 bits before D3; in Java and Kotlin, Int overflows at 2,147,483,647 exactly like Postgres.',
            'Events and CDC: the Avro schema published by Debezium changed from int to long, a promotion Avro accepts for updated readers. Consumers were updated first, because a reader with the old schema cannot read long.',
            'Search and analytics: the search index mapping had id as integer, which rejects values above 2^31. It was reindexed as long. In the data warehouse, the column was already INT64.',
            'Database: views that select id, SQL functions with integer parameters and columns in other tables that store the id without a foreign key, such as entregas.ultimo_evento_id. A search for "evento" columns of type integer in information_schema.columns found three.',
          ],
        },
      ],
    },
    {
      title: 'New column, trigger and backfill without bloating the table',
      blocks: [
        {
          type: 'paragraph',
          value:
            'ADD COLUMN without a DEFAULT only records the column in the catalog and finishes in milliseconds, but it needs a short lock. If a long transaction is open on the table, the ALTER waits in the queue and every query that arrives afterwards waits behind it: that is how an instant command takes the API down. A 2-second lock_timeout trades that risk for a retry. The triggers guarantee that everything inserted from now on is born with the copy, and only after them does the backfill start.',
        },
        {
          type: 'code',
          value: preparoCode,
        },
        {
          type: 'code',
          value: backfillCode,
        },
        {
          type: 'paragraph',
          value:
            'Three details keep the backfill from becoming the incident. First, batches by primary key range, not LIMIT with OFFSET, so each UPDATE uses the index and touches only neighboring pages. Second, the index on the new column is created only after the backfill: with no index on id_novo and free space on the page, Postgres performs a HOT update and does not need to write a new entry to any index. Since retention deletes had left free space in many pages, about a third of the updates went through as HOT, and the aggressive autovacuum returned space for the following batches. Third, the replica lag brake: every batch generates WAL, and a read replica 30 seconds behind shows the user a parcel that has not shipped yet. With 20 thousand rows per batch and a 150 ms pause, the parent took 41 hours and the brake stopped the process 37 times, almost always during the afternoon peak.',
        },
      ],
    },
    {
      title: 'Index, NOT NULL without a scan and the millisecond swap',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the backfill done, the new column must be made ready to become the primary key without any step that locks for long. The unique index is built with CONCURRENTLY. NOT NULL comes in two steps: a CHECK NOT VALID, which is instant, and a VALIDATE, which scans the table with a lock that blocks neither reads nor writes. Since Postgres 12, SET NOT NULL finds that validated CHECK and does not scan again. VALIDATE also works as an audit: if the backfill had skipped a range, it would fail here, before the swap, not after.',
        },
        {
          type: 'code',
          value: trocaCode,
        },
        {
          type: 'paragraph',
          value:
            'The swap transaction runs more than twenty commands, and none of them reads data: PRIMARY KEY USING INDEX reuses the finished index, SET NOT NULL uses the validated CHECK, RENAME and the sequence type change are catalog-only. In the rehearsal with replayed traffic it took 380 ms, and in production the first attempt hit lock_timeout because of a report that had been open for 40 seconds, and the second one went through. The foreign key comes back NOT VALID and is validated later, outside the transaction, because validating scans all of eventos_anexos.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
      ],
    },
    {
      title: 'After the swap: clean up, validate and do not repeat it',
      blocks: [
        {
          type: 'ordered',
          items: [
            'For a week, follow the first id above 2,147,483,647 through every layer: API, app, events, search and reports. Here it showed up 31 days after D0, as predicted, and the only failure was an internal Python export script that called struct.pack(\'i\', id).',
            'Drop the old columns with ALTER TABLE DROP COLUMN, which is catalog-only and finishes in milliseconds. The 4 bytes per row do not come back right away; they are reused as rows get rewritten, which is acceptable.',
            'Turn the detection query into an alert: a warning at 50% and a page at 75% for any int2 or int4 column fed by a sequence. The same sweep found notificacoes at 37.8%, which was migrated calmly the following month.',
            'Change the default: new tables use bigint GENERATED ALWAYS AS IDENTITY, and the migration linter rejects serial and integer primary keys. The extra 4 bytes per row cost far less than the next migration under a deadline.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'What if the column is an identity column, not serial?',
      answer:
        'The sequence of an identity column belongs to the column and cannot simply be handed to another one with OWNED BY. Inside the swap transaction, read the last value, run ALTER TABLE ... ALTER COLUMN id DROP IDENTITY on the old column and, with the new column already renamed and NOT NULL, run ALTER TABLE ... ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (START WITH last_value + 1000). Both commands are catalog-only. The margin of a thousand covers values preallocated by CACHE that may still sit in open connections.',
    },
    {
      question: 'Since I am touching the key anyway, should I switch to UUID?',
      answer:
        'These are different problems. An overflowing int is a capacity issue, and bigint solves it for good with 8 bytes. Switching to UUID changes the type in every foreign key, every client and every contract, doubles the size of every index that carries the key and, with UUID v4, scatters inserts across the whole index. If the real reason is to avoid exposing sequential ids, add a public identifier column, preferably UUID v7, without touching the internal key.',
    },
    {
      question: 'What if only hours remain, not weeks?',
      answer:
        'First, the tourniquet: restart the sequence at -2,147,483,648, which gives another 2.1 billion values without touching the table. Before doing it, confirm within minutes that the code does not depend on positive ids or on ordering by id, and accept that some screens will sort incorrectly for a while. With the headroom regained, run the full migration described here. Without either, once the sequence hits its maximum every INSERT into the table fails, and the application stops recording what matters most to it.',
    },
  ],
  conclusion: {
    title: 'The type change is catalog work; the real work is around it',
    description:
      'An integer primary key fed by a sequence overflows by the last value handed out, not by row count, and the ALTER COLUMN TYPE that looks like the fix keeps the table locked for hours at any relevant volume. A zero-downtime migration turns the change into steps that never block: application ready for int8 first, new column and triggers, batched backfill with a replica brake, concurrent index, NOT NULL validated without a scan and a 380 ms rename swap, with the foreign key validated afterwards. What demands attention lives outside the database, in drivers, 32-bit clients, event schemas and search indexes, and in details such as views bound to the column number and the old column that must lose its NOT NULL. With the detection query turned into an alert and bigint as the default, the next table never reaches 87%.',
    cta: 'Review the keys and migrations of my database',
  },
  related: [
    {
      label: 'Zero-downtime database migration: expand, migrate and contract without dropping writes',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
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
    'Una plataforma de rastreo de entregas registra cada lectura de escáner, cambio de estado e intento de entrega en la tabla eventos_rastreio, creada hace seis años con id serial, es decir, integer de 32 bits. En una revisión de rutina, alguien nota que los ids de la pantalla de soporte ya superan los 1.800 millones. La secuencia está en 1.868.004.113, el 87% de los 2.147.483.647 que admite el tipo, y consume 9,1 millones de valores por día: faltan 31 días para que todo INSERT falle con "reached maximum value of sequence". La tabla tiene 410 GB, recibe escrituras las 24 horas y el ALTER COLUMN TYPE bigint ensayado en un clon mantuvo la tabla bloqueada durante 6 horas y 10 minutos. Este artículo muestra por qué el límite llega antes de lo que sugiere el count(*), qué caminos existen y cuánto cuesta cada uno, qué tiene que cambiar en la aplicación antes de tocar la base, cómo pasar a bigint con columna nueva, trigger, backfill por lotes y un cambio de 380 ms, y cómo asegurar que la próxima tabla no llegue al mismo punto.',
  sections: [
    {
      title: 'Por qué el int se desborda antes de lo que dice el count(*)',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El número que importa no es cuántas filas tiene la tabla, sino el último valor que entregó la secuencia. Cada llamada a nextval() consume un valor para siempre: el INSERT que hizo rollback, el INSERT que falló por violación de restricción, el ON CONFLICT DO NOTHING que descartó la fila y los valores preasignados por CACHE en conexiones que murieron. En eventos_rastreio, el count(*) mostraba 1.410 millones de filas, porque los eventos con más de dos años se borran, mientras la secuencia ya estaba en 1.870 millones. Quien monitorea por el tamaño de la tabla descubre el problema por el error.',
        },
        {
          type: 'code',
          value: deteccaoCode,
        },
        {
          type: 'paragraph',
          value:
            'El camino obvio, ALTER TABLE eventos_rastreio ALTER COLUMN id TYPE bigint, reescribe la tabla entera, porque cada fila cambia de tamaño físico, y reconstruye todos los índices. Durante ese tiempo mantiene ACCESS EXCLUSIVE, el bloqueo que impide incluso un SELECT. En una tabla de pocos gigabytes eso es un minuto dentro de una ventana; en 410 GB fueron 6 horas y 10 minutos en el clon, con el disco necesitando espacio para dos copias. Y no resuelve el problema por sí solo: la columna evento_id de eventos_anexos, que referencia ese id, también es integer y se desborda el mismo día.',
        },
      ],
    },
    {
      title: 'Los caminos posibles y cuánto cuesta cada uno',
      blocks: [
        {
          type: 'table',
          columns: ['Camino', 'Bloqueo', 'En este caso', 'Cuándo tiene sentido'],
          rows: [
            ['ALTER COLUMN TYPE bigint directo', 'ACCESS EXCLUSIVE durante toda la reescritura', '6 h 10 de tabla detenida en el clon', 'Tablas de pocos GB o cuando la ventana es aceptable'],
            ['Tabla nueva, copia y cambio de nombre', 'Corto, solo al final', 'Días de copia y el doble de disco', 'Cuando la tabla igual se va a reorganizar o particionar'],
            ['Columna nueva, trigger, backfill y cambio', 'Milisegundos en el cambio', '7 días de calendario, 380 ms de bloqueo', 'Tabla grande, en uso continuo, con semanas de margen'],
            ['Secuencia en valores negativos', 'Ninguno', 'Segundos', 'Torniquete cuando faltan horas o pocos días; no resuelve'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El torniquete merece explicación, porque es lo que salva cuando el problema se descubre demasiado tarde. ALTER SEQUENCE eventos_rastreio_id_seq MINVALUE -2147483648 RESTART WITH -2147483648 devuelve otros 2.100 millones de valores sin tocar la tabla: la secuencia sube de -2.147.483.648 hasta -1 antes de chocar con los ids existentes. El precio es alto y está escondido: ORDER BY id deja de significar orden de creación, la paginación por cursor en id se rompe, validaciones como id > 0 rechazan filas nuevas y cualquier integración que trate el id como sin signo falla. Es una forma de ganar meses para hacer la migración correcta, no una alternativa a ella.',
        },
        {
          type: 'paragraph',
          value:
            'Con 31 días de margen, el camino elegido fue la columna nueva. La idea es la misma del patrón expandir y contraer: crear id_novo bigint junto a id, mantener ambas iguales para todo lo que se escriba a partir de ahora, copiar el pasado en lotes pequeños, construir índice y restricciones sin bloquear y, al final, intercambiar los nombres en una transacción que solo toca el catálogo. La tabla nunca queda bloqueada más que unos pocos milisegundos.',
        },
      ],
    },
    {
      title: 'Antes de la base: la aplicación tiene que aceptar bigint',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La parte de la base es mecánica; lo que hunde la migración es lo que está fuera de ella. En el momento del cambio, la columna id pasa a ser int8, y cada capa que lee ese valor tiene que estar lista para números por encima de 2.147.483.647 antes de que exista el primero. Esto va primero en el cronograma, con despliegue propio, porque es la parte que no se puede deshacer rápido.',
        },
        {
          type: 'code',
          value: tipoAplicacaoCode,
        },
        {
          type: 'list',
          items: [
            'Drivers: node-postgres entrega int8 como string; el código de arriba lo convierte a number con verificación. El mismo despliegue cambia lo que devuelven count(*) y sum(), que también son int8, así que comparaciones como total === \'0\' hay que buscarlas antes.',
            'Clientes tipados: la app Android guardaba el id en un Int, el servicio de facturación en Go usaba int32 y un contrato protobuf declaraba int32 evento_id. Todos pasaron a 64 bits antes del D3; en Java y Kotlin, Int se desborda en 2.147.483.647 exactamente igual que Postgres.',
            'Eventos y CDC: el schema Avro publicado por Debezium pasó de int a long, una promoción que Avro acepta para lectores actualizados. Los consumidores se actualizaron antes, porque un lector con el schema antiguo no lee long.',
            'Búsqueda y analytics: el mapeo del índice de búsqueda tenía id como integer, que no acepta valores por encima de 2^31. Se reindexó como long. En el data warehouse, la columna ya era INT64.',
            'Base de datos: vistas que seleccionan id, funciones SQL con parámetro integer y columnas de otras tablas que guardan el id sin clave foránea, como entregas.ultimo_evento_id. Una búsqueda de columnas "evento" de tipo integer en information_schema.columns encontró tres.',
          ],
        },
      ],
    },
    {
      title: 'Columna nueva, trigger y backfill sin inflar la tabla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'ADD COLUMN sin DEFAULT solo registra la columna en el catálogo y termina en milisegundos, pero necesita un bloqueo corto. Si hay una transacción larga abierta en la tabla, el ALTER queda en la cola y todas las consultas que llegan después esperan detrás de él: así es como un comando instantáneo tumba la API. El lock_timeout de 2 segundos cambia ese riesgo por un reintento. Los triggers garantizan que todo lo que se inserte a partir de ahora nazca con la copia, y solo después de ellos empieza el backfill.',
        },
        {
          type: 'code',
          value: preparoCode,
        },
        {
          type: 'code',
          value: backfillCode,
        },
        {
          type: 'paragraph',
          value:
            'Tres detalles evitan que el backfill se convierta en el incidente. Primero, lotes por rango de clave primaria, no LIMIT con OFFSET, para que cada UPDATE use el índice y toque solo páginas vecinas. Segundo, el índice de la columna nueva se crea solo después del backfill: sin índice en id_novo y con espacio libre en la página, Postgres hace un HOT update y no necesita escribir una entrada nueva en ningún índice. Como los borrados por retención dejaban espacio libre en buena parte de las páginas, cerca de un tercio de las actualizaciones salió como HOT, y el autovacuum agresivo devolvió espacio para los lotes siguientes. Tercero, el freno por retraso de réplica: cada lote genera WAL, y una réplica de lectura con 30 segundos de retraso le muestra al usuario un paquete que todavía no salió. Con lotes de 20 mil filas y pausa de 150 ms, el padre tardó 41 horas y el freno detuvo el proceso 37 veces, casi siempre durante el pico de la tarde.',
        },
      ],
    },
    {
      title: 'Índice, NOT NULL sin recorrido y el cambio en milisegundos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con el backfill terminado, falta dejar la columna nueva lista para ser clave primaria sin ningún paso que bloquee por mucho tiempo. El índice único se crea con CONCURRENTLY. El NOT NULL entra en dos etapas: un CHECK NOT VALID, instantáneo, y un VALIDATE, que recorre la tabla con un bloqueo que no impide lectura ni escritura. Desde Postgres 12, SET NOT NULL encuentra ese CHECK validado y no vuelve a recorrer. El VALIDATE sirve también como auditoría: si el backfill hubiera saltado un rango, fallaría aquí, antes del cambio, y no después.',
        },
        {
          type: 'code',
          value: trocaCode,
        },
        {
          type: 'paragraph',
          value:
            'La transacción del cambio ejecuta más de veinte comandos, y ninguno lee datos: PRIMARY KEY USING INDEX reutiliza el índice listo, SET NOT NULL usa el CHECK validado, RENAME y el cambio de tipo de la secuencia son solo catálogo. En el ensayo con tráfico reproducido tardó 380 ms, y en producción el primer intento cayó en el lock_timeout por un reporte abierto desde hacía 40 segundos y el segundo pasó. La clave foránea vuelve NOT VALID y se valida después, fuera de la transacción, porque validar recorre eventos_anexos entera.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
      ],
    },
    {
      title: 'Después del cambio: limpiar, validar y no repetir',
      blocks: [
        {
          type: 'ordered',
          items: [
            'Durante una semana, siga el primer id por encima de 2.147.483.647 a través de todas las capas: API, app, eventos, búsqueda y reportes. En este caso apareció 31 días después del D0, como estaba previsto, y la única falla fue un script interno de exportación en Python que hacía struct.pack(\'i\', id).',
            'Elimine las columnas antiguas con ALTER TABLE DROP COLUMN, que es solo catálogo y termina en milisegundos. Los 4 bytes por fila no vuelven de inmediato; se reaprovechan a medida que las filas se reescriben, lo que es aceptable.',
            'Convierta la consulta de detección en alerta: aviso al 50% y página al 75% para cualquier columna int2 o int4 alimentada por secuencia. En el mismo barrido apareció notificacoes al 37,8%, que se migró con calma el mes siguiente.',
            'Cambie el estándar: las tablas nuevas usan bigint GENERATED ALWAYS AS IDENTITY, y el lint de migraciones rechaza serial e integer en clave primaria. Los 4 bytes extra por fila cuestan mucho menos que la próxima migración con fecha límite.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Y si la columna es identity y no serial?',
      answer:
        'La secuencia de una columna identity pertenece a la columna y no se puede transferir a otra con OWNED BY sin más. Dentro de la transacción del cambio, lea el último valor, ejecute ALTER TABLE ... ALTER COLUMN id DROP IDENTITY en la columna antigua y, con la columna nueva ya renombrada y NOT NULL, ejecute ALTER TABLE ... ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (START WITH ultimo_valor + 1000). Ambos comandos son solo catálogo. El margen de mil cubre los valores preasignados por CACHE que aún estén en conexiones abiertas.',
    },
    {
      question: 'Ya que voy a tocar la clave, ¿no conviene pasar a UUID?',
      answer:
        'Son problemas distintos. El int que se desborda es falta de capacidad, y bigint lo resuelve para siempre con 8 bytes. Pasar a UUID cambia el tipo en cada clave foránea, en todos los clientes y contratos, duplica el tamaño de cada índice que lleva la clave y, con UUID v4, dispersa las inserciones por todo el índice. Si el motivo real es no exponer ids secuenciales, agregue una columna de identificador público, de preferencia UUID v7, sin tocar la clave interna.',
    },
    {
      question: '¿Y si faltan solo horas y no semanas?',
      answer:
        'Primero, el torniquete: reinicie la secuencia en -2.147.483.648, lo que da otros 2.100 millones de valores sin tocar la tabla. Antes, confirme en minutos que el código no depende de ids positivos ni del orden por id, y acepte que algunas pantallas van a ordenar mal por un tiempo. Con el margen recuperado, haga la migración completa descrita aquí. Sin ninguna de las dos cosas, cuando la secuencia llegue al máximo, todo INSERT en la tabla falla, y la aplicación deja de registrar lo que más le importa.',
    },
  ],
  conclusion: {
    title: 'El cambio de tipo es catálogo; el trabajo está alrededor',
    description:
      'Una clave primaria integer alimentada por secuencia se desborda por el último valor entregado, no por el número de filas, y el ALTER COLUMN TYPE que parece la solución mantiene la tabla bloqueada durante horas en cualquier volumen relevante. La migración sin parada convierte el cambio en etapas que nunca bloquean: aplicación lista para int8 primero, columna nueva y triggers, backfill por lotes con freno de réplica, índice concurrente, NOT NULL validado sin recorrido y un cambio de nombres de 380 ms, con la clave foránea validada después. Lo que exige atención está fuera de la base, en drivers, clientes de 32 bits, schemas de eventos e índices de búsqueda, y en detalles como las vistas atadas al número de la columna y la columna antigua que debe perder el NOT NULL. Con la consulta de detección convertida en alerta y bigint como estándar, la próxima tabla no llega al 87%.',
    cta: 'Revisar las claves y migraciones de mi base de datos',
  },
  related: [
    {
      label: 'Migración de base de datos sin ventana: expandir, migrar y contraer sin cortar escrituras',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
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
