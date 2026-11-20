// Conteudo do artigo: sequence que pula numeros e ID que acaba. Por que uma tabela pequena
// esgota uma sequencia de 32 bits (upsert, rollback e CACHE consomem valores), por que migrar
// a coluna para bigint nao basta quando a sequencia do serial continua AS integer, onde mais o
// limite de 32 bits se esconde (chaves estrangeiras e aplicacao) e como medir e corrigir.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const comments = {
  pt: {
    u1: 'Duas linhas novas: a sequência entrega 1 e 2.',
    u2: 'As mesmas duas chaves de novo, só com um preço diferente. Nenhuma linha nova:',
    u3: 'O default de id é avaliado antes da checagem de conflito, para toda linha proposta.',
    u4: 'A tabela continua com 2 linhas; a sequência já gastou 4 valores.',
    u5: 'serial cria a sequência AS integer desde o PostgreSQL 10.',
    s1: 'A coluna vira bigint (reescreve a tabela inteira)...',
    s2: '...mas a sequência de um serial continua integer e o nextval segue falhando.',
    s3: 'Só a sequência precisa mudar: catálogo, sem reescrever nada.',
    s4: 'O máximo era o do tipo antigo, então acompanha o tipo novo.',
    m1: 'node monitorar-sequencias.js  (rodar 1x por dia; sai com código 1 se houver risco)',
    m2: 'Cada execução guarda uma foto de todas as sequências para calcular o consumo diário.',
    m3: 'Percentual usado e consumo por dia, comparando com a foto de ~1 dia atrás.',
    m4: 'Sequência de tipo diferente da coluna que ela alimenta (serial migrado pela metade).',
    m5: 'Chave estrangeira com tipo diferente da chave que ela referencia.',
    m6: 'Sem foto anterior ainda: só o percentual vale nesta execução.',
    f1: 'A carga horária do ERP chega inteira nesta tabela de staging.',
    f2: 'Atualiza só o que mudou: não consome sequência e não gera tupla morta à toa.',
    f3: 'Insere só o que é novo. O ON CONFLICT fica para a corrida rara entre dois processos.',
    n1: 'node-postgres devolve int8 como string por padrão, para não perder precisão.',
    n2: 'Converte para Number, mas falha alto em vez de arredondar acima de 2^53 - 1.',
  },
  en: {
    u1: 'Two new rows: the sequence hands out 1 and 2.',
    u2: 'The same two keys again, only one price changed. No new row:',
    u3: 'The id default is evaluated before the conflict check, for every proposed row.',
    u4: 'The table still has 2 rows; the sequence has already spent 4 values.',
    u5: 'serial creates the sequence AS integer since PostgreSQL 10.',
    s1: 'The column becomes bigint (rewrites the whole table)...',
    s2: '...but the sequence behind a serial stays integer and nextval keeps failing.',
    s3: 'Only the sequence needs to change: catalog only, nothing is rewritten.',
    s4: 'The maximum was the old type default, so it follows the new type.',
    m1: 'node monitorar-sequencias.js  (run once a day; exits with code 1 when there is risk)',
    m2: 'Every run stores a snapshot of all sequences to compute daily consumption.',
    m3: 'Percentage used and consumption per day, compared with the snapshot from ~1 day ago.',
    m4: 'Sequence whose type differs from the column it feeds (a half migrated serial).',
    m5: 'Foreign key whose type differs from the key it references.',
    m6: 'No previous snapshot yet: only the percentage is meaningful on this run.',
    f1: 'The hourly ERP load lands in full in this staging table.',
    f2: 'Updates only what changed: no sequence consumption and no needless dead tuples.',
    f3: 'Inserts only what is new. ON CONFLICT stays for the rare race between two processes.',
    n1: 'node-postgres returns int8 as a string by default, so no precision is lost.',
    n2: 'Converts to Number, but fails loudly instead of rounding above 2^53 - 1.',
  },
  es: {
    u1: 'Dos filas nuevas: la secuencia entrega 1 y 2.',
    u2: 'Las mismas dos claves otra vez, solo con un precio distinto. Ninguna fila nueva:',
    u3: 'El default de id se evalúa antes de la verificación de conflicto, para cada fila propuesta.',
    u4: 'La tabla sigue con 2 filas; la secuencia ya gastó 4 valores.',
    u5: 'serial crea la secuencia AS integer desde PostgreSQL 10.',
    s1: 'La columna pasa a bigint (reescribe toda la tabla)...',
    s2: '...pero la secuencia de un serial sigue siendo integer y el nextval sigue fallando.',
    s3: 'Solo la secuencia necesita cambiar: catálogo, sin reescribir nada.',
    s4: 'El máximo era el del tipo antiguo, así que acompaña al tipo nuevo.',
    m1: 'node monitorar-sequencias.js  (correr 1 vez al día; sale con código 1 si hay riesgo)',
    m2: 'Cada ejecución guarda una foto de todas las secuencias para calcular el consumo diario.',
    m3: 'Porcentaje usado y consumo por día, comparando con la foto de hace ~1 día.',
    m4: 'Secuencia con un tipo distinto de la columna que alimenta (serial migrado a medias).',
    m5: 'Clave foránea con un tipo distinto de la clave que referencia.',
    m6: 'Todavía no hay foto anterior: en esta ejecución solo vale el porcentaje.',
    f1: 'La carga horaria del ERP llega completa a esta tabla de staging.',
    f2: 'Actualiza solo lo que cambió: no consume secuencia ni genera tuplas muertas sin motivo.',
    f3: 'Inserta solo lo nuevo. El ON CONFLICT queda para la carrera rara entre dos procesos.',
    n1: 'node-postgres devuelve int8 como string por defecto, para no perder precisión.',
    n2: 'Convierte a Number, pero falla de forma explícita en lugar de redondear por encima de 2^53 - 1.',
  },
};

const upsertCode = (c) => `CREATE TABLE precos (
  id      serial PRIMARY KEY,
  loja_id integer       NOT NULL,
  sku     text          NOT NULL,
  valor   numeric(12,2) NOT NULL,
  UNIQUE (loja_id, sku)
);

-- ${c.u1}
INSERT INTO precos (loja_id, sku, valor) VALUES (1, 'A', 10.00), (1, 'B', 20.00);
SELECT last_value FROM precos_id_seq;          -- 2

-- ${c.u2}
-- ${c.u3}
INSERT INTO precos (loja_id, sku, valor) VALUES (1, 'A', 10.00), (1, 'B', 21.00)
ON CONFLICT (loja_id, sku) DO UPDATE SET valor = excluded.valor;
SELECT last_value FROM precos_id_seq;          -- 4

-- ${c.u4}
SELECT count(*), max(id) FROM precos;          -- 2 | 2

-- ${c.u5}
SELECT data_type, max_value FROM pg_sequences WHERE sequencename = 'precos_id_seq';
 data_type | max_value
-----------+------------
 integer   | 2147483647`;

const sequenceTypeCode = (c) => `ERROR:  nextval: reached maximum value of sequence "precos_id_seq" (2147483647)

-- ${c.s1}
ALTER TABLE precos ALTER COLUMN id TYPE bigint;

-- ${c.s2}
SELECT data_type, max_value, last_value
  FROM pg_sequences WHERE sequencename = 'precos_id_seq';
 data_type | max_value  | last_value
-----------+------------+------------
 integer   | 2147483647 | 2147483647

-- ${c.s3}
ALTER SEQUENCE precos_id_seq AS bigint;

-- ${c.s4}
SELECT data_type, max_value FROM pg_sequences WHERE sequencename = 'precos_id_seq';
 data_type |      max_value
-----------+---------------------
 bigint    | 9223372036854775807

SELECT nextval('precos_id_seq');               -- 2147483648`;

const monitorCode = (c) => `// monitorar-sequencias.js
// ${c.m1}
import pg from 'pg';

const LIMITE_PCT = 75;
const LIMITE_DIAS = 90;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

// ${c.m2}
const SQL_FOTO = \`
  CREATE TABLE IF NOT EXISTS monitor_sequencias (
    capturado_em timestamptz NOT NULL DEFAULT now(),
    sequencia    text        NOT NULL,
    ultimo_valor bigint      NOT NULL
  );
  INSERT INTO monitor_sequencias (sequencia, ultimo_valor)
  SELECT format('%I.%I', schemaname, sequencename), last_value
    FROM pg_sequences
   WHERE last_value IS NOT NULL\`;

// ${c.m3}
const SQL_CONSUMO = \`
  WITH atual AS (
    SELECT format('%I.%I', schemaname, sequencename) AS sequencia,
           data_type::text AS tipo, last_value, max_value
      FROM pg_sequences
     WHERE last_value IS NOT NULL AND increment_by > 0
  ),
  anterior AS (
    SELECT DISTINCT ON (sequencia) sequencia, capturado_em, ultimo_valor
      FROM monitor_sequencias
     WHERE capturado_em BETWEEN now() - interval '8 days' AND now() - interval '20 hours'
     ORDER BY sequencia, capturado_em DESC
  )
  SELECT a.sequencia, a.tipo,
         a.last_value::text AS ultimo, a.max_value::text AS maximo,
         round(100.0 * a.last_value / a.max_value, 2)::float8 AS pct,
         round((a.last_value - p.ultimo_valor)
               / (extract(epoch FROM now() - p.capturado_em) / 86400))::float8 AS por_dia
    FROM atual a
    LEFT JOIN anterior p USING (sequencia)
   ORDER BY pct DESC\`;

// ${c.m4}
const SQL_SEQUENCIA_X_COLUNA = \`
  SELECT d.refobjid::regclass::text AS tabela, a.attname AS coluna,
         format_type(a.atttypid, a.atttypmod) AS tipo_coluna,
         s.seqrelid::regclass::text AS sequencia,
         s.seqtypid::regtype::text AS tipo_sequencia
    FROM pg_sequence s
    JOIN pg_depend d    ON d.objid = s.seqrelid
                       AND d.classid = 'pg_class'::regclass
                       AND d.refclassid = 'pg_class'::regclass
                       AND d.deptype IN ('a', 'i')
    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
   WHERE s.seqtypid <> a.atttypid\`;

// ${c.m5}
const SQL_FK_DESALINHADA = \`
  SELECT con.conname AS fk,
         con.conrelid::regclass::text  || '.' || af.attname AS coluna_filha,
         format_type(af.atttypid, af.atttypmod) AS tipo_filha,
         con.confrelid::regclass::text || '.' || ap.attname AS coluna_pai,
         format_type(ap.atttypid, ap.atttypmod) AS tipo_pai
    FROM pg_constraint con
    CROSS JOIN LATERAL unnest(con.conkey, con.confkey) AS k(filha, pai)
    JOIN pg_attribute af ON af.attrelid = con.conrelid  AND af.attnum = k.filha
    JOIN pg_attribute ap ON ap.attrelid = con.confrelid AND ap.attnum = k.pai
   WHERE con.contype = 'f' AND af.atttypid <> ap.atttypid\`;

async function main() {
  await client.connect();
  try {
    await client.query(SQL_FOTO);
    const { rows: sequencias } = await client.query(SQL_CONSUMO);

    const relatorio = sequencias.map((s) => {
      const restante = Number(s.maximo) - Number(s.ultimo);
      // ${c.m6}
      const dias = s.por_dia > 0 ? Math.floor(restante / s.por_dia) : null;
      const risco = s.pct >= LIMITE_PCT || (dias !== null && dias <= LIMITE_DIAS);
      return { ...s, dias_restantes: dias, risco };
    });
    console.table(relatorio.filter((s) => s.risco || s.pct >= 10));

    const { rows: desalinhadas } = await client.query(SQL_SEQUENCIA_X_COLUNA);
    const { rows: fks } = await client.query(SQL_FK_DESALINHADA);
    if (desalinhadas.length) console.table(desalinhadas);
    if (fks.length) console.table(fks);

    if (relatorio.some((s) => s.risco) || desalinhadas.length || fks.length) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});`;

const syncFixCode = (c) => `-- ${c.f1}
CREATE UNLOGGED TABLE IF NOT EXISTS precos_staging (
  loja_id integer       NOT NULL,
  sku     text          NOT NULL,
  valor   numeric(12,2) NOT NULL
);

BEGIN;

-- ${c.f2}
UPDATE precos p
   SET valor = s.valor
  FROM precos_staging s
 WHERE p.loja_id = s.loja_id
   AND p.sku = s.sku
   AND p.valor IS DISTINCT FROM s.valor;

-- ${c.f3}
INSERT INTO precos (loja_id, sku, valor)
SELECT s.loja_id, s.sku, s.valor
  FROM precos_staging s
 WHERE NOT EXISTS (
         SELECT 1 FROM precos p
          WHERE p.loja_id = s.loja_id AND p.sku = s.sku
       )
ON CONFLICT (loja_id, sku) DO NOTHING;

TRUNCATE precos_staging;

COMMIT;`;

const nodeParserCode = (c) => `import pg from 'pg';

// ${c.n1}
// ${c.n2}
pg.types.setTypeParser(pg.types.builtins.INT8, (valor) => {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero)) {
    throw new RangeError(\`int8 fora do intervalo seguro de Number: \${valor}\`);
  }
  return numero;
});`;

const diagramaPt = `D-17       deploy: sincronização de preços passa de diária e incremental para horária e completa
           (4,2 milhões de linhas por hora com ON CONFLICT DO UPDATE: 100,8 milhões de nextval por dia)
D0  03:12  nextval: reached maximum value of sequence "precos_id_seq"; nenhum preço novo entra
D0  03:40  plantão roda ALTER TABLE precos ALTER COLUMN id TYPE bigint (41 s com a tabela bloqueada)
D0  04:05  o mesmo erro volta: a sequência do serial continua AS integer
D0  04:20  ALTER SEQUENCE precos_id_seq AS bigint; a sincronização volta a rodar
D0  04:21  gatilho de historico_precos falha: integer out of range (preco_id é integer)
D0  05:10  historico_precos.preco_id migrada para bigint (9 min de tabela bloqueada)
D0  09:00  serviço de catálogo em Java: Bad value for type int : 2147483651
D0  11:30  API em Node: cache de preços deixa de casar, porque o id passou a chegar como string
D1         sincronização reescrita: consumo cai de 100,8 milhões para cerca de 180 mil valores por dia`;

const diagramaEn = `D-17       deploy: price sync goes from daily and incremental to hourly and full
           (4.2 million rows per hour with ON CONFLICT DO UPDATE: 100.8 million nextval calls per day)
D0  03:12  nextval: reached maximum value of sequence "precos_id_seq"; no new price gets in
D0  03:40  on call runs ALTER TABLE precos ALTER COLUMN id TYPE bigint (41 s with the table locked)
D0  04:05  the same error comes back: the serial sequence is still AS integer
D0  04:20  ALTER SEQUENCE precos_id_seq AS bigint; the sync runs again
D0  04:21  historico_precos trigger fails: integer out of range (preco_id is integer)
D0  05:10  historico_precos.preco_id migrated to bigint (9 min with the table locked)
D0  09:00  Java catalog service: Bad value for type int : 2147483651
D0  11:30  Node API: price cache stops matching, because the id now arrives as a string
D1         sync rewritten: consumption drops from 100.8 million to about 180 thousand values per day`;

const diagramaEs = `D-17       deploy: la sincronización de precios pasa de diaria e incremental a horaria y completa
           (4,2 millones de filas por hora con ON CONFLICT DO UPDATE: 100,8 millones de nextval por día)
D0  03:12  nextval: reached maximum value of sequence "precos_id_seq"; no entra ningún precio nuevo
D0  03:40  la guardia ejecuta ALTER TABLE precos ALTER COLUMN id TYPE bigint (41 s con la tabla bloqueada)
D0  04:05  vuelve el mismo error: la secuencia del serial sigue siendo AS integer
D0  04:20  ALTER SEQUENCE precos_id_seq AS bigint; la sincronización vuelve a correr
D0  04:21  el trigger de historico_precos falla: integer out of range (preco_id es integer)
D0  05:10  historico_precos.preco_id migrada a bigint (9 min con la tabla bloqueada)
D0  09:00  servicio de catálogo en Java: Bad value for type int : 2147483651
D0  11:30  API en Node: la caché de precios deja de coincidir, porque el id empezó a llegar como string
D1         sincronización reescrita: el consumo cae de 100,8 millones a unos 180 mil valores por día`;

const pt = {
  intro:
    'Um varejista com 380 lojas mantinha os preços de cada loja numa tabela precos com 4,2 milhões de linhas, criada em 2019 com id serial. Ninguém imaginava que ela pudesse ficar sem ID: o count(*) estava a menos de 0,2% do limite de 2.147.483.647 de um integer. Mesmo assim, numa madrugada de sexta, a sincronização com o ERP começou a falhar com "reached maximum value of sequence" e nenhum preço novo entrou nas lojas. A causa era um deploy de 17 dias antes, que trocou a sincronização incremental diária por uma carga completa a cada hora com INSERT ... ON CONFLICT DO UPDATE. Cada linha proposta consome um valor da sequência, mesmo quando vira UPDATE. A correção de emergência também tropeçou: o plantão migrou a coluna para bigint e o erro continuou, porque a sequência de um serial não muda junto. Depois vieram a chave estrangeira em integer, o serviço Java que lia o id com getInt e a API em Node que passou a receber o id como string. Este artigo explica o que consome uma sequência além das linhas inseridas, onde o limite de 32 bits se esconde fora da coluna da chave primária, como medir o consumo real antes do erro e como corrigir sem trocar um incidente por outro.',
  sections: [
    {
      title: 'A tabela de 4,2 milhões de linhas que ficou sem ID',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A sincronização antiga recebia do ERP só os preços alterados no dia, cerca de 200 mil linhas, e fazia um upsert com elas. Em cinco anos, a sequência tinha chegado a 430 milhões, um número alto para uma tabela de 4,2 milhões de linhas, mas ainda longe do limite. A refatoração de setembro simplificou o processo: o ERP passou a exportar o catálogo inteiro de preços a cada hora e o job fazia upsert de tudo, porque era idempotente e dispensava controlar o que tinha mudado. O consumo saltou de 200 mil para 100,8 milhões de valores por dia, e os 1,7 bilhão restantes duraram 17 dias.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'Nenhum monitoramento acusou nada antes, porque todos olhavam para a tabela: tamanho em disco, quantidade de linhas, crescimento diário. Todos estáveis. O único número que importava, o last_value da sequência, não estava em nenhum painel. E cada etapa da correção revelou um lugar diferente onde o mesmo limite de 32 bits estava gravado.',
        },
      ],
    },
    {
      title: 'Quem consome a sequência além das linhas inseridas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma sequência não sabe se o valor que entregou virou linha. O nextval é chamado quando o valor default da coluna é avaliado, e a partir daí o valor está gasto, aconteça o que acontecer com a transação. No INSERT ... ON CONFLICT, o default é avaliado para cada linha proposta antes de o Postgres verificar o conflito, então um upsert que só atualiza linhas existentes consome a sequência exatamente como se estivesse inserindo.',
        },
        {
          type: 'code',
          value: upsertCode(comments.pt),
        },
        {
          type: 'table',
          columns: ['Origem do consumo', 'Valores gastos', 'Quando vira problema'],
          rows: [
            ['INSERT que vira linha', '1 por linha', 'Só em tabelas realmente grandes ou de eventos'],
            ['INSERT ... ON CONFLICT DO UPDATE ou DO NOTHING', '1 por linha proposta, inclusive as que já existiam', 'Upsert periódico do conjunto inteiro, como sincronização de catálogo'],
            ['INSERT que falha ou transação com ROLLBACK', '1 por linha tentada', 'Retentativas em laço, validação feita depois do INSERT'],
            ['CACHE n na sequência', 'Até n por sessão encerrada', 'CACHE alto com conexões de vida curta, como funções serverless'],
            ['Crash ou failover', 'Até 32 por sequência', 'Raramente relevante para o limite, só para buracos'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A razão entre last_value e count(*) é o indicador mais útil aqui. Na tabela precos, ela era 102 antes do deploy e passou de 500 no dia do incidente. Uma tabela em que essa razão passa de 10 tem algum padrão de escrita que gasta a sequência sem gerar linha, e esse padrão define quando o ID acaba, não o tamanho da tabela.',
        },
      ],
    },
    {
      title: 'Migrar a coluna não basta: a sequência do serial continua integer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Desde o PostgreSQL 10, serial cria a sequência com AS integer, e o máximo dela é 2.147.483.647 independentemente do tipo da coluna. ALTER TABLE ... ALTER COLUMN id TYPE bigint reescreve a tabela e os índices, mas não toca na sequência de um serial, que é um objeto separado ligado à coluna só por dependência. Colunas GENERATED AS IDENTITY se comportam diferente: ao mudar o tipo da coluna, o Postgres ajusta junto o tipo da sequência interna. Como a mesma base costuma ter tabelas criadas em épocas diferentes, com serial e com identity, o seguro é sempre conferir em pg_sequences depois da migração.',
        },
        {
          type: 'code',
          value: sequenceTypeCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'No incidente, os 41 segundos de tabela bloqueada da reescrita foram desnecessários para destravar a escrita. Para uma sequência que estoura com a coluna já em bigint, o ALTER SEQUENCE ... AS bigint resolve sozinho e é instantâneo. Se a coluna ainda for integer e a tabela for grande demais para uma reescrita de emergência, existe um recurso de último caso: ALTER SEQUENCE ... MINVALUE -2147483648 RESTART WITH -2147483648 dá mais 2,1 bilhões de valores negativos enquanto a migração para bigint é feita com calma. Só use se a aplicação aceitar ids negativos, o que vale testar antes, não durante o incidente.',
        },
      ],
    },
    {
      title: 'Onde mais o limite de 32 bits se esconde',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O id não mora só na chave primária. Ele é copiado para chaves estrangeiras, gatilhos de histórico, tabelas de auditoria, mensagens de fila, caches e tipos da aplicação. Cada cópia criada quando o id era integer continua com o limite antigo, e cada uma falha no primeiro valor acima de 2.147.483.647, em horários diferentes, com mensagens diferentes.',
        },
        {
          type: 'table',
          columns: ['Lugar', 'Como falha', 'Correção'],
          rows: [
            ['Sequência AS integer de um serial', 'nextval: reached maximum value of sequence', 'ALTER SEQUENCE ... AS bigint'],
            ['Chave estrangeira integer apontando para bigint', 'integer out of range no INSERT da tabela filha', 'Migrar a coluna filha para bigint'],
            ['Coluna que guarda o id sem FK (auditoria, jsonb, filas)', 'integer out of range ou valor truncado no consumidor', 'Migrar a coluna e o schema da mensagem'],
            ['Java ou Kotlin com int, ResultSet.getInt', 'Bad value for type int', 'long e getLong'],
            ['C# com int, Go com int32, Protobuf int32', 'Overflow ou exceção na conversão', 'long, int64, int64'],
            ['Node com node-postgres', 'int8 chega como string; comparações estritas e chaves de Map deixam de casar', 'Parser explícito para int8 ou tratar ids como string'],
            ['JavaScript no navegador ou JSON', 'Perde precisão acima de 2^53 - 1', 'Serializar ids como string a partir de bigint'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O caso do Node é o mais traiçoeiro, porque não dá erro. O node-postgres converte int4 para Number, mas devolve int8 como string, para não perder precisão acima de 2^53 - 1. Depois da migração, a mesma consulta passou a devolver "2147483651" em vez de um número, e o cache de preços, um Map indexado pelo id numérico vindo da URL, deixou de encontrar qualquer entrada. Um parser explícito torna a decisão visível no código, em vez de depender do tipo da coluna no banco.',
        },
        {
          type: 'code',
          value: nodeParserCode(comments.pt),
        },
      ],
    },
    {
      title: 'Medir antes do erro: percentual, consumo por dia e tipos desalinhados',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O monitoramento que faltou não é complicado. pg_sequences mostra o último valor e o máximo de cada sequência, mas o percentual sozinho não basta: 40% pode significar dez anos ou dez dias. O script abaixo guarda uma foto diária de todas as sequências, calcula o consumo por dia e os dias restantes e, na mesma execução, lista sequências com tipo diferente da coluna que alimentam e chaves estrangeiras com tipo diferente da chave referenciada.',
        },
        {
          type: 'code',
          value: monitorCode(comments.pt),
        },
        {
          type: 'list',
          items: [
            'Rode uma vez por dia, no agendador que já existir, e trate o código de saída 1 como alerta. Um limite de 90 dias dá tempo de planejar a migração sem pressa.',
            'pg_sequences só mostra last_value para sequências em que o usuário tem permissão de leitura. Rode com um papel que tenha USAGE ou SELECT em todas, ou o relatório fica incompleto sem avisar.',
            'Mudança brusca de consumo é sinal tão importante quanto o percentual. Comparar o por_dia com a média da semana anterior teria apontado o deploy de setembro no dia seguinte.',
            'As duas checagens de tipo valem como teste de migração: rodar o script no CI contra um banco migrado impede que um serial ou uma FK em integer passem despercebidos.',
          ],
        },
      ],
    },
    {
      title: 'Corrigir sem trocar um incidente por outro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A ordem dos passos define quanto tempo a escrita fica parada e quantos incidentes novos a correção cria. O que funcionou, refeito do jeito certo, foi este:',
        },
        {
          type: 'ordered',
          items: [
            'Destravar a escrita com o menor comando possível: ALTER SEQUENCE ... AS bigint se a coluna já for bigint; reescrita da coluna só se a tabela for pequena; ids negativos como último recurso.',
            'Antes de liberar o tráfego, listar todas as colunas que recebem esse id: chaves estrangeiras pela consulta do script, gatilhos e funções pelo código-fonte, colunas sem FK pelo nome e pelo conhecimento do domínio.',
            'Migrar as colunas filhas pequenas na hora e planejar as grandes com coluna nova, gatilho e backfill, enquanto o id ainda tem margem.',
            'Auditar os consumidores do id na aplicação: getInt, int32, schemas de mensagem e parsers de banco. Um teste de integração que insere uma linha com id 2.147.483.648 encontra todos de uma vez.',
            'Corrigir a fonte do consumo, para que a próxima sequência não chegue ao limite pelo mesmo motivo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O último passo é o que de fato resolve. A sincronização foi reescrita para separar o que muda do que é novo: UPDATE só nas linhas cujo preço mudou e INSERT só das chaves que não existem. O ON CONFLICT continua, mas só dispara na corrida rara entre duas execuções. O consumo caiu de 100,8 milhões para cerca de 180 mil valores por dia, e como bônus o UPDATE com IS DISTINCT FROM deixou de gerar 4,2 milhões de tuplas mortas por hora, o que também aliviou o autovacuum.',
        },
        {
          type: 'code',
          value: syncFixCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'Para tabelas novas, a regra que evita todo o resto é simples: chave primária bigint GENERATED ALWAYS AS IDENTITY, chaves estrangeiras bigint e long ou int64 na aplicação. Os 4 bytes economizados por linha com integer não pagam nem uma madrugada como essa.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Posso usar CYCLE para a sequência voltar ao início quando chegar ao limite?',
      answer:
        'Não numa chave primária. Com CYCLE, depois do máximo o nextval volta ao MINVALUE e entrega ids que já existem, então o INSERT passa a falhar com duplicate key em vez de reached maximum value. CYCLE só faz sentido quando o valor não precisa ser único, como um contador circular de lote. Para identificador, a saída é sempre aumentar o tipo.',
    },
    {
      question: 'Vale trocar para UUID em vez de bigint?',
      answer:
        'Só se houver outro motivo, como gerar o id fora do banco ou não expor quantidade de registros. O bigint vai até 9,2 quintilhões: mesmo com os 100,8 milhões de valores por dia do incidente, levaria mais de 250 milhões de anos para acabar. UUID ocupa 16 bytes e, na versão 4, é aleatório, o que espalha as inserções pelo índice inteiro. Se a escolha for UUID, prefira a versão 7, ordenada por tempo, que o PostgreSQL 18 gera com uuidv7().',
    },
    {
      question: 'ALTER SEQUENCE ... AS bigint é seguro em produção com tráfego?',
      answer:
        'Sim. Ele altera só o catálogo e o próprio objeto da sequência, que é minúsculo, sem tocar na tabela. Se o MINVALUE e o MAXVALUE eram os padrões do tipo antigo, passam automaticamente para os do bigint; se alguém definiu um MAXVALUE explícito, ele permanece e precisa ser alterado no mesmo comando. Sessões com valores em CACHE terminam de usar o bloco já reservado, o que não causa problema porque todos estão abaixo do limite antigo.',
    },
  ],
  conclusion: {
    title: 'O ID acaba onde ninguém está olhando',
    description:
      'Uma sequência acaba pelo número de chamadas a nextval, não pelo número de linhas, e upsert, rollback e CACHE podem fazer uma tabela pequena gastar bilhões de valores. Quando acaba, o limite de 32 bits não está só na coluna: está na sequência do serial, nas chaves estrangeiras, nos gatilhos e nos tipos da aplicação. Monitorar o last_value com consumo diário, conferir tipos de sequência e de FK depois de cada migração e criar tabelas novas com bigint identity transformam esse incidente de madrugada numa tarefa planejada.',
    cta: 'Quer revisar sequências, chaves e tipos antes que o limite chegue em produção?',
  },
  related: [
    {
      label: 'Chave primária int que vai estourar: migrar para bigint com a tabela em uso',
      to: '/blog/chave-primaria-int-que-vai-estourar-migrar-para-bigint-com-a-tabela-em-uso',
    },
    {
      label: 'Sequência que dá saltos e colide: nextval, rollback e IDs que não são contínuos',
      to: '/blog/sequencia-que-da-saltos-e-colide-nextval-rollback-e-ids-que-nao-sao-continuos',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A retailer with 380 stores kept each store\'s prices in a precos table with 4.2 million rows, created in 2019 with a serial id. Nobody imagined it could run out of IDs: count(*) was at less than 0.2% of the 2,147,483,647 limit of an integer. Even so, early on a Friday morning, the ERP sync started failing with "reached maximum value of sequence" and no new price reached the stores. The cause was a deploy from 17 days earlier that replaced the daily incremental sync with a full load every hour using INSERT ... ON CONFLICT DO UPDATE. Every proposed row consumes a sequence value, even when it becomes an UPDATE. The emergency fix stumbled too: on call migrated the column to bigint and the error kept coming, because the sequence behind a serial does not change with it. Then came the integer foreign key, the Java service reading the id with getInt and the Node API that started receiving the id as a string. This article explains what consumes a sequence besides inserted rows, where the 32 bit limit hides outside the primary key column, how to measure real consumption before the error and how to fix it without trading one incident for another.',
  sections: [
    {
      title: 'The 4.2 million row table that ran out of IDs',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The old sync received from the ERP only the prices changed that day, about 200 thousand rows, and upserted them. In five years the sequence had reached 430 million, a high number for a 4.2 million row table but still far from the limit. The September refactor simplified the process: the ERP started exporting the full price catalog every hour and the job upserted everything, because it was idempotent and did not need to track what had changed. Consumption jumped from 200 thousand to 100.8 million values per day, and the remaining 1.7 billion lasted 17 days.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'No monitoring flagged anything beforehand, because everything looked at the table: size on disk, row count, daily growth. All stable. The only number that mattered, the sequence last_value, was on no dashboard. And every step of the fix revealed a different place where the same 32 bit limit was baked in.',
        },
      ],
    },
    {
      title: 'What consumes the sequence besides inserted rows',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A sequence does not know whether the value it handed out became a row. nextval is called when the column default is evaluated, and from then on the value is spent, whatever happens to the transaction. In INSERT ... ON CONFLICT, the default is evaluated for every proposed row before Postgres checks for the conflict, so an upsert that only updates existing rows consumes the sequence exactly as if it were inserting.',
        },
        {
          type: 'code',
          value: upsertCode(comments.en),
        },
        {
          type: 'table',
          columns: ['Source of consumption', 'Values spent', 'When it becomes a problem'],
          rows: [
            ['INSERT that becomes a row', '1 per row', 'Only on truly large or event tables'],
            ['INSERT ... ON CONFLICT DO UPDATE or DO NOTHING', '1 per proposed row, including the ones that already existed', 'Periodic upsert of the whole set, such as a catalog sync'],
            ['Failed INSERT or transaction with ROLLBACK', '1 per attempted row', 'Retries in a loop, validation done after the INSERT'],
            ['CACHE n on the sequence', 'Up to n per closed session', 'High CACHE with short lived connections, such as serverless functions'],
            ['Crash or failover', 'Up to 32 per sequence', 'Rarely relevant for the limit, only for gaps'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The ratio between last_value and count(*) is the most useful indicator here. On the precos table it was 102 before the deploy and went past 500 on the day of the incident. A table where that ratio goes above 10 has some write pattern that spends the sequence without producing rows, and that pattern decides when the ID runs out, not the table size.',
        },
      ],
    },
    {
      title: 'Migrating the column is not enough: the serial sequence stays integer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Since PostgreSQL 10, serial creates the sequence AS integer, and its maximum is 2,147,483,647 regardless of the column type. ALTER TABLE ... ALTER COLUMN id TYPE bigint rewrites the table and its indexes, but does not touch the sequence of a serial, which is a separate object tied to the column only through a dependency. GENERATED AS IDENTITY columns behave differently: when the column type changes, Postgres adjusts the type of the internal sequence too. Since the same database usually has tables created at different times, with serial and with identity, the safe move is to always check pg_sequences after the migration.',
        },
        {
          type: 'code',
          value: sequenceTypeCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'In the incident, the 41 seconds of locked table from the rewrite were not needed to unblock writes. For a sequence that overflows with the column already bigint, ALTER SEQUENCE ... AS bigint solves it alone and is instantaneous. If the column is still integer and the table is too large for an emergency rewrite, there is a last resort: ALTER SEQUENCE ... MINVALUE -2147483648 RESTART WITH -2147483648 buys another 2.1 billion negative values while the migration to bigint is done calmly. Only use it if the application accepts negative ids, which is worth testing beforehand, not during the incident.',
        },
      ],
    },
    {
      title: 'Where else the 32 bit limit hides',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The id does not live only in the primary key. It is copied into foreign keys, history triggers, audit tables, queue messages, caches and application types. Every copy created while the id was integer keeps the old limit, and each one fails at the first value above 2,147,483,647, at different times, with different messages.',
        },
        {
          type: 'table',
          columns: ['Place', 'How it fails', 'Fix'],
          rows: [
            ['AS integer sequence of a serial', 'nextval: reached maximum value of sequence', 'ALTER SEQUENCE ... AS bigint'],
            ['integer foreign key pointing to bigint', 'integer out of range on the child table INSERT', 'Migrate the child column to bigint'],
            ['Column that stores the id without an FK (audit, jsonb, queues)', 'integer out of range or truncated value in the consumer', 'Migrate the column and the message schema'],
            ['Java or Kotlin with int, ResultSet.getInt', 'Bad value for type int', 'long and getLong'],
            ['C# with int, Go with int32, Protobuf int32', 'Overflow or conversion exception', 'long, int64, int64'],
            ['Node with node-postgres', 'int8 arrives as a string; strict comparisons and Map keys stop matching', 'Explicit int8 parser or treat ids as strings'],
            ['JavaScript in the browser or JSON', 'Loses precision above 2^53 - 1', 'Serialize ids as strings once they are bigint'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The Node case is the most treacherous, because it raises no error. node-postgres converts int4 to Number, but returns int8 as a string so that no precision is lost above 2^53 - 1. After the migration, the same query started returning "2147483651" instead of a number, and the price cache, a Map keyed by the numeric id taken from the URL, stopped finding any entry. An explicit parser makes the decision visible in code, instead of depending on the column type in the database.',
        },
        {
          type: 'code',
          value: nodeParserCode(comments.en),
        },
      ],
    },
    {
      title: 'Measure before the error: percentage, daily consumption and mismatched types',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The missing monitoring is not complicated. pg_sequences shows the last value and the maximum of every sequence, but the percentage alone is not enough: 40% can mean ten years or ten days. The script below stores a daily snapshot of every sequence, computes consumption per day and days remaining and, in the same run, lists sequences whose type differs from the column they feed and foreign keys whose type differs from the referenced key.',
        },
        {
          type: 'code',
          value: monitorCode(comments.en),
        },
        {
          type: 'list',
          items: [
            'Run it once a day, in whatever scheduler already exists, and treat exit code 1 as an alert. A 90 day threshold leaves time to plan the migration without rushing.',
            'pg_sequences only shows last_value for sequences the user can read. Run it with a role that has USAGE or SELECT on all of them, or the report becomes incomplete without warning.',
            'A sudden change in consumption is as important a signal as the percentage. Comparing por_dia with the previous week average would have pointed at the September deploy the next day.',
            'Both type checks work as a migration test: running the script in CI against a migrated database keeps a serial or an integer FK from slipping through.',
          ],
        },
      ],
    },
    {
      title: 'Fix it without trading one incident for another',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The order of the steps decides how long writes stay stopped and how many new incidents the fix creates. What worked, redone the right way, was this:',
        },
        {
          type: 'ordered',
          items: [
            'Unblock writes with the smallest possible command: ALTER SEQUENCE ... AS bigint if the column is already bigint; a column rewrite only if the table is small; negative ids as a last resort.',
            'Before letting traffic back in, list every column that receives that id: foreign keys through the script query, triggers and functions through the source code, columns without an FK by name and domain knowledge.',
            'Migrate the small child columns right away and plan the large ones with a new column, trigger and backfill, while the id still has headroom.',
            'Audit the id consumers in the application: getInt, int32, message schemas and database parsers. An integration test that inserts a row with id 2,147,483,648 finds all of them at once.',
            'Fix the source of consumption, so the next sequence does not reach the limit for the same reason.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last step is the one that actually solves it. The sync was rewritten to separate what changes from what is new: UPDATE only on rows whose price changed and INSERT only for keys that do not exist. ON CONFLICT stays, but only fires in the rare race between two runs. Consumption dropped from 100.8 million to about 180 thousand values per day, and as a bonus the UPDATE with IS DISTINCT FROM stopped producing 4.2 million dead tuples per hour, which also relieved autovacuum.',
        },
        {
          type: 'code',
          value: syncFixCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'For new tables, the rule that avoids everything else is simple: bigint GENERATED ALWAYS AS IDENTITY primary key, bigint foreign keys and long or int64 in the application. The 4 bytes per row saved with integer do not pay for even one night like this.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can I use CYCLE so the sequence starts over when it hits the limit?',
      answer:
        'Not on a primary key. With CYCLE, after the maximum nextval goes back to MINVALUE and hands out ids that already exist, so the INSERT starts failing with duplicate key instead of reached maximum value. CYCLE only makes sense when the value does not need to be unique, such as a circular batch counter. For an identifier, the way out is always a larger type.',
    },
    {
      question: 'Is it worth switching to UUID instead of bigint?',
      answer:
        'Only if there is another reason, such as generating the id outside the database or not exposing record counts. bigint goes up to 9.2 quintillion: even with the 100.8 million values per day from the incident, it would take more than 250 million years to run out. A UUID takes 16 bytes and, in version 4, is random, which spreads inserts across the whole index. If you choose UUID, prefer version 7, ordered by time, which PostgreSQL 18 generates with uuidv7().',
    },
    {
      question: 'Is ALTER SEQUENCE ... AS bigint safe in production under traffic?',
      answer:
        'Yes. It changes only the catalog and the sequence object itself, which is tiny, without touching the table. If MINVALUE and MAXVALUE were the defaults of the old type, they move to the bigint defaults automatically; if someone set an explicit MAXVALUE, it stays and has to be changed in the same command. Sessions holding CACHE values finish using the block they already reserved, which causes no problem because all of them are below the old limit.',
    },
  ],
  conclusion: {
    title: 'The ID runs out where nobody is looking',
    description:
      'A sequence runs out by the number of nextval calls, not by the number of rows, and upsert, rollback and CACHE can make a small table spend billions of values. When it runs out, the 32 bit limit is not only in the column: it is in the serial sequence, in foreign keys, in triggers and in application types. Monitoring last_value with daily consumption, checking sequence and FK types after every migration and creating new tables with bigint identity turn this middle of the night incident into a planned task.',
    cta: 'Want to review sequences, keys and types before the limit hits production?',
  },
  related: [
    {
      label: 'An int primary key about to overflow: migrating to bigint with the table in use',
      to: '/blog/chave-primaria-int-que-vai-estourar-migrar-para-bigint-com-a-tabela-em-uso',
    },
    {
      label: 'The sequence that jumps and collides: nextval, rollback and non contiguous IDs',
      to: '/blog/sequencia-que-da-saltos-e-colide-nextval-rollback-e-ids-que-nao-sao-continuos',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Un minorista con 380 tiendas guardaba los precios de cada tienda en una tabla precos con 4,2 millones de filas, creada en 2019 con id serial. Nadie imaginaba que pudiera quedarse sin IDs: el count(*) estaba a menos del 0,2% del límite de 2.147.483.647 de un integer. Aun así, en la madrugada de un viernes, la sincronización con el ERP empezó a fallar con "reached maximum value of sequence" y ningún precio nuevo llegó a las tiendas. La causa era un deploy de 17 días antes, que cambió la sincronización incremental diaria por una carga completa cada hora con INSERT ... ON CONFLICT DO UPDATE. Cada fila propuesta consume un valor de la secuencia, incluso cuando termina en UPDATE. La corrección de emergencia también tropezó: la guardia migró la columna a bigint y el error siguió, porque la secuencia de un serial no cambia con ella. Después vinieron la clave foránea en integer, el servicio Java que leía el id con getInt y la API en Node que empezó a recibir el id como string. Este artículo explica qué consume una secuencia además de las filas insertadas, dónde se esconde el límite de 32 bits fuera de la columna de la clave primaria, cómo medir el consumo real antes del error y cómo corregirlo sin cambiar un incidente por otro.',
  sections: [
    {
      title: 'La tabla de 4,2 millones de filas que se quedó sin ID',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La sincronización antigua recibía del ERP solo los precios modificados en el día, unas 200 mil filas, y hacía un upsert con ellas. En cinco años la secuencia había llegado a 430 millones, un número alto para una tabla de 4,2 millones de filas, pero todavía lejos del límite. La refactorización de septiembre simplificó el proceso: el ERP pasó a exportar el catálogo completo de precios cada hora y el job hacía upsert de todo, porque era idempotente y no necesitaba controlar qué había cambiado. El consumo saltó de 200 mil a 100,8 millones de valores por día, y los 1.700 millones restantes duraron 17 días.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'Ningún monitoreo avisó antes, porque todos miraban la tabla: tamaño en disco, cantidad de filas, crecimiento diario. Todo estable. El único número que importaba, el last_value de la secuencia, no estaba en ningún panel. Y cada etapa de la corrección reveló un lugar distinto donde el mismo límite de 32 bits estaba grabado.',
        },
      ],
    },
    {
      title: 'Qué consume la secuencia además de las filas insertadas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una secuencia no sabe si el valor que entregó se convirtió en fila. El nextval se llama cuando se evalúa el valor default de la columna, y desde ese momento el valor está gastado, pase lo que pase con la transacción. En INSERT ... ON CONFLICT, el default se evalúa para cada fila propuesta antes de que Postgres verifique el conflicto, así que un upsert que solo actualiza filas existentes consume la secuencia exactamente igual que si estuviera insertando.',
        },
        {
          type: 'code',
          value: upsertCode(comments.es),
        },
        {
          type: 'table',
          columns: ['Origen del consumo', 'Valores gastados', 'Cuándo se vuelve un problema'],
          rows: [
            ['INSERT que se convierte en fila', '1 por fila', 'Solo en tablas realmente grandes o de eventos'],
            ['INSERT ... ON CONFLICT DO UPDATE o DO NOTHING', '1 por fila propuesta, incluso las que ya existían', 'Upsert periódico del conjunto completo, como una sincronización de catálogo'],
            ['INSERT que falla o transacción con ROLLBACK', '1 por fila intentada', 'Reintentos en bucle, validación hecha después del INSERT'],
            ['CACHE n en la secuencia', 'Hasta n por sesión cerrada', 'CACHE alto con conexiones de vida corta, como funciones serverless'],
            ['Crash o failover', 'Hasta 32 por secuencia', 'Rara vez relevante para el límite, solo para los huecos'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La razón entre last_value y count(*) es el indicador más útil aquí. En la tabla precos era 102 antes del deploy y pasó de 500 el día del incidente. Una tabla en la que esa razón supera 10 tiene algún patrón de escritura que gasta la secuencia sin generar filas, y ese patrón define cuándo se acaba el ID, no el tamaño de la tabla.',
        },
      ],
    },
    {
      title: 'Migrar la columna no alcanza: la secuencia del serial sigue siendo integer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Desde PostgreSQL 10, serial crea la secuencia con AS integer, y su máximo es 2.147.483.647 sin importar el tipo de la columna. ALTER TABLE ... ALTER COLUMN id TYPE bigint reescribe la tabla y los índices, pero no toca la secuencia de un serial, que es un objeto separado ligado a la columna solo por una dependencia. Las columnas GENERATED AS IDENTITY se comportan distinto: al cambiar el tipo de la columna, Postgres ajusta también el tipo de la secuencia interna. Como la misma base suele tener tablas creadas en épocas distintas, con serial y con identity, lo seguro es revisar siempre pg_sequences después de la migración.',
        },
        {
          type: 'code',
          value: sequenceTypeCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'En el incidente, los 41 segundos de tabla bloqueada de la reescritura no eran necesarios para destrabar la escritura. Para una secuencia que se desborda con la columna ya en bigint, ALTER SEQUENCE ... AS bigint lo resuelve solo y es instantáneo. Si la columna todavía es integer y la tabla es demasiado grande para una reescritura de emergencia, existe un recurso de último caso: ALTER SEQUENCE ... MINVALUE -2147483648 RESTART WITH -2147483648 da otros 2.100 millones de valores negativos mientras la migración a bigint se hace con calma. Úselo solo si la aplicación acepta ids negativos, algo que conviene probar antes, no durante el incidente.',
        },
      ],
    },
    {
      title: 'Dónde más se esconde el límite de 32 bits',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El id no vive solo en la clave primaria. Se copia a claves foráneas, triggers de historial, tablas de auditoría, mensajes de cola, cachés y tipos de la aplicación. Cada copia creada cuando el id era integer conserva el límite antiguo, y cada una falla con el primer valor por encima de 2.147.483.647, en horarios distintos, con mensajes distintos.',
        },
        {
          type: 'table',
          columns: ['Lugar', 'Cómo falla', 'Corrección'],
          rows: [
            ['Secuencia AS integer de un serial', 'nextval: reached maximum value of sequence', 'ALTER SEQUENCE ... AS bigint'],
            ['Clave foránea integer apuntando a bigint', 'integer out of range en el INSERT de la tabla hija', 'Migrar la columna hija a bigint'],
            ['Columna que guarda el id sin FK (auditoría, jsonb, colas)', 'integer out of range o valor truncado en el consumidor', 'Migrar la columna y el schema del mensaje'],
            ['Java o Kotlin con int, ResultSet.getInt', 'Bad value for type int', 'long y getLong'],
            ['C# con int, Go con int32, Protobuf int32', 'Overflow o excepción en la conversión', 'long, int64, int64'],
            ['Node con node-postgres', 'int8 llega como string; las comparaciones estrictas y las claves de Map dejan de coincidir', 'Parser explícito para int8 o tratar los ids como string'],
            ['JavaScript en el navegador o JSON', 'Pierde precisión por encima de 2^53 - 1', 'Serializar los ids como string a partir de bigint'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El caso de Node es el más traicionero, porque no da error. node-postgres convierte int4 a Number, pero devuelve int8 como string, para no perder precisión por encima de 2^53 - 1. Después de la migración, la misma consulta empezó a devolver "2147483651" en lugar de un número, y la caché de precios, un Map indexado por el id numérico tomado de la URL, dejó de encontrar cualquier entrada. Un parser explícito hace visible la decisión en el código, en lugar de depender del tipo de la columna en la base.',
        },
        {
          type: 'code',
          value: nodeParserCode(comments.es),
        },
      ],
    },
    {
      title: 'Medir antes del error: porcentaje, consumo por día y tipos desalineados',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El monitoreo que faltó no es complicado. pg_sequences muestra el último valor y el máximo de cada secuencia, pero el porcentaje solo no alcanza: 40% puede significar diez años o diez días. El script de abajo guarda una foto diaria de todas las secuencias, calcula el consumo por día y los días restantes y, en la misma ejecución, lista secuencias con un tipo distinto de la columna que alimentan y claves foráneas con un tipo distinto de la clave referenciada.',
        },
        {
          type: 'code',
          value: monitorCode(comments.es),
        },
        {
          type: 'list',
          items: [
            'Córralo una vez al día, en el planificador que ya exista, y trate el código de salida 1 como alerta. Un límite de 90 días deja tiempo para planear la migración sin prisa.',
            'pg_sequences solo muestra last_value de las secuencias que el usuario puede leer. Córralo con un rol que tenga USAGE o SELECT sobre todas, o el reporte queda incompleto sin avisar.',
            'Un cambio brusco de consumo es una señal tan importante como el porcentaje. Comparar el por_dia con el promedio de la semana anterior habría señalado el deploy de septiembre al día siguiente.',
            'Las dos verificaciones de tipo sirven como test de migración: correr el script en el CI contra una base migrada impide que un serial o una FK en integer pasen desapercibidos.',
          ],
        },
      ],
    },
    {
      title: 'Corregir sin cambiar un incidente por otro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El orden de los pasos define cuánto tiempo queda detenida la escritura y cuántos incidentes nuevos crea la corrección. Lo que funcionó, rehecho de la forma correcta, fue esto:',
        },
        {
          type: 'ordered',
          items: [
            'Destrabar la escritura con el comando más pequeño posible: ALTER SEQUENCE ... AS bigint si la columna ya es bigint; reescritura de la columna solo si la tabla es pequeña; ids negativos como último recurso.',
            'Antes de liberar el tráfico, listar todas las columnas que reciben ese id: claves foráneas con la consulta del script, triggers y funciones en el código fuente, columnas sin FK por el nombre y el conocimiento del dominio.',
            'Migrar en el momento las columnas hijas pequeñas y planear las grandes con columna nueva, trigger y backfill, mientras el id todavía tiene margen.',
            'Auditar los consumidores del id en la aplicación: getInt, int32, schemas de mensajes y parsers de base. Un test de integración que inserta una fila con id 2.147.483.648 los encuentra todos de una vez.',
            'Corregir la fuente del consumo, para que la próxima secuencia no llegue al límite por el mismo motivo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El último paso es el que realmente lo resuelve. La sincronización se reescribió para separar lo que cambia de lo que es nuevo: UPDATE solo en las filas cuyo precio cambió e INSERT solo de las claves que no existen. El ON CONFLICT sigue, pero solo se dispara en la carrera rara entre dos ejecuciones. El consumo cayó de 100,8 millones a unos 180 mil valores por día y, como bonus, el UPDATE con IS DISTINCT FROM dejó de generar 4,2 millones de tuplas muertas por hora, lo que también alivió al autovacuum.',
        },
        {
          type: 'code',
          value: syncFixCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'Para tablas nuevas, la regla que evita todo lo demás es simple: clave primaria bigint GENERATED ALWAYS AS IDENTITY, claves foráneas bigint y long o int64 en la aplicación. Los 4 bytes por fila que se ahorran con integer no pagan ni una madrugada como esta.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Puedo usar CYCLE para que la secuencia vuelva al inicio cuando llegue al límite?',
      answer:
        'No en una clave primaria. Con CYCLE, después del máximo el nextval vuelve al MINVALUE y entrega ids que ya existen, así que el INSERT empieza a fallar con duplicate key en lugar de reached maximum value. CYCLE solo tiene sentido cuando el valor no necesita ser único, como un contador circular de lotes. Para un identificador, la salida es siempre un tipo más grande.',
    },
    {
      question: '¿Conviene cambiar a UUID en lugar de bigint?',
      answer:
        'Solo si hay otro motivo, como generar el id fuera de la base o no exponer la cantidad de registros. bigint llega hasta 9,2 trillones: incluso con los 100,8 millones de valores por día del incidente, tardaría más de 250 millones de años en acabarse. Un UUID ocupa 16 bytes y, en la versión 4, es aleatorio, lo que reparte las inserciones por todo el índice. Si elige UUID, prefiera la versión 7, ordenada por tiempo, que PostgreSQL 18 genera con uuidv7().',
    },
    {
      question: '¿ALTER SEQUENCE ... AS bigint es seguro en producción con tráfico?',
      answer:
        'Sí. Cambia solo el catálogo y el propio objeto de la secuencia, que es diminuto, sin tocar la tabla. Si MINVALUE y MAXVALUE eran los valores por defecto del tipo antiguo, pasan automáticamente a los de bigint; si alguien definió un MAXVALUE explícito, se mantiene y hay que cambiarlo en el mismo comando. Las sesiones con valores en CACHE terminan de usar el bloque ya reservado, lo que no causa problemas porque todos están por debajo del límite antiguo.',
    },
  ],
  conclusion: {
    title: 'El ID se acaba donde nadie está mirando',
    description:
      'Una secuencia se acaba por la cantidad de llamadas a nextval, no por la cantidad de filas, y el upsert, el rollback y el CACHE pueden hacer que una tabla pequeña gaste miles de millones de valores. Cuando se acaba, el límite de 32 bits no está solo en la columna: está en la secuencia del serial, en las claves foráneas, en los triggers y en los tipos de la aplicación. Monitorear el last_value con el consumo diario, revisar los tipos de secuencias y FKs después de cada migración y crear las tablas nuevas con bigint identity convierten este incidente de madrugada en una tarea planificada.',
    cta: '¿Quiere revisar secuencias, claves y tipos antes de que el límite llegue a producción?',
  },
  related: [
    {
      label: 'Clave primaria int a punto de desbordarse: migrar a bigint con la tabla en uso',
      to: '/blog/chave-primaria-int-que-vai-estourar-migrar-para-bigint-com-a-tabela-em-uso',
    },
    {
      label: 'La secuencia que da saltos y colisiona: nextval, rollback e IDs que no son continuos',
      to: '/blog/sequencia-que-da-saltos-e-colide-nextval-rollback-e-ids-que-nao-sao-continuos',
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
