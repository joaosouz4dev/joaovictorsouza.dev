// Conteudo do artigo: coluna JSON que virou esquema escondido. Como inventariar as chaves
// e os tipos que ja existem dentro de um jsonb, qual indice responde a qual consulta e o que
// nenhum indice resolve, como validar com CHECK NOT VALID sem travar escrita, como promover
// uma chave a coluna com expandir, migrar e contrair, o criterio para decidir o que sai do
// JSON e como provar em teste que a migracao nao perdeu nada.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const inventarioSql = `-- inventario.sql
-- Inventario das chaves de primeiro nivel do jsonb: presenca e tipos por chave.
-- TABLESAMPLE SYSTEM (1) le cerca de 1% das paginas da tabela: em 40 milhoes de
-- linhas e o bastante para enxergar toda chave que aparece em mais de 0,1% delas,
-- sem varrer a tabela inteira nem segurar lock.
WITH amostra AS (
  SELECT atributos
    FROM clientes TABLESAMPLE SYSTEM (1)
   WHERE jsonb_typeof(atributos) = 'object'   -- array ou escalar no lugar do objeto tambem e achado
),
chaves AS (
  SELECT chave, jsonb_typeof(atributos -> chave) AS tipo
    FROM amostra, LATERAL jsonb_object_keys(atributos) AS chave
)
SELECT chave,
       count(*)                                                       AS ocorrencias,
       round(100.0 * count(*) / (SELECT count(*) FROM amostra), 1)    AS presenca_pct,
       string_agg(DISTINCT tipo, ', ' ORDER BY tipo)                  AS tipos
  FROM chaves
 GROUP BY chave
 ORDER BY ocorrencias DESC;

-- Para cada chave com mais de um tipo, um exemplo de cada forma: e isso que vira
-- a lista de correcoes antes de qualquer indice ou constraint.
SELECT chave, tipo, min(atributos ->> chave) AS exemplo, count(*) AS linhas
  FROM clientes TABLESAMPLE SYSTEM (1), LATERAL jsonb_object_keys(atributos) AS chave,
       LATERAL (SELECT jsonb_typeof(atributos -> chave) AS tipo) t
 WHERE chave IN ('cpf', 'limite_credito', 'endereco')
 GROUP BY chave, tipo
 ORDER BY chave, linhas DESC;`;

const indicesSql = `-- indices.sql
-- Igualdade por uma chave: indice de expressao B-tree. O ANALYZE passa a coletar
-- estatisticas da expressao, e o planejador deixa de chutar a seletividade.
CREATE INDEX CONCURRENTLY clientes_plano_idx
    ON clientes ((atributos ->> 'plano'));

-- Contencao em varias chaves ao mesmo tempo: GIN com jsonb_path_ops. Menor e mais
-- rapido que o operador padrao, mas responde so a @> e a jsonpath (@?, @@);
-- nao responde "a chave existe?" (?), que exige o jsonb_ops padrao.
CREATE INDEX CONCURRENTLY clientes_atributos_gin
    ON clientes USING gin (atributos jsonb_path_ops);

-- Comparacao numerica: o indice precisa da mesma expressao e do mesmo cast da consulta.
-- Se uma unica linha tiver texto nao numerico nessa chave, o CREATE INDEX falha:
-- por isso a validacao vem antes do indice, nunca depois.
CREATE INDEX CONCURRENTLY clientes_limite_credito_idx
    ON clientes (((atributos ->> 'limite_credito')::numeric));

-- A consulta so usa o indice se tiver exatamente a forma da expressao indexada.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM clientes WHERE atributos ->> 'plano' = 'pro';
-- Index Scan using clientes_plano_idx ...

-- Usa o GIN (contencao), nao o B-tree:
--   WHERE atributos @> '{"plano": "pro", "origem": "indicacao"}'
-- Nao usa nenhum dos dois, por mais indices que existam:
--   WHERE atributos ->> 'plano' ILIKE 'pr%'
--   WHERE (atributos -> 'tags') ? 'vip'          -- jsonb_path_ops nao responde ?
--   WHERE atributos ->> 'limite_credito' > '5000' -- comparacao de texto, nao de numero`;

const validacaoSql = `-- validacao.sql
-- 1. A regra passa a valer para toda linha nova ou atualizada imediatamente.
--    NOT VALID pula a varredura das linhas antigas: o ALTER segura um lock curto
--    e devolve em milissegundos, mesmo com 40 milhoes de linhas.
ALTER TABLE clientes
  ADD CONSTRAINT clientes_atributos_plano_chk
  CHECK (
    jsonb_typeof(atributos -> 'plano') IS NULL      -- chave ausente continua permitida
    OR (
      jsonb_typeof(atributos -> 'plano') = 'string'
      AND atributos ->> 'plano' IN ('free', 'pro', 'enterprise')
    )
  ) NOT VALID;

-- 2. O legado que violaria a regra. Repare que {"plano": null} tem tipo 'null',
--    nao e chave ausente: entra aqui e precisa ser normalizado removendo a chave.
SELECT id, atributos -> 'plano' AS valor
  FROM clientes
 WHERE NOT (
   jsonb_typeof(atributos -> 'plano') IS NULL
   OR (jsonb_typeof(atributos -> 'plano') = 'string'
       AND atributos ->> 'plano' IN ('free', 'pro', 'enterprise'))
 )
 LIMIT 100;

-- 3. Correcao em lotes pequenos: cada UPDATE em jsonb grava a linha inteira de novo,
--    entao lote grande e lock longo e inchaco para o autovacuum limpar depois.
UPDATE clientes
   SET atributos = atributos - 'plano'
 WHERE id IN (
   SELECT id FROM clientes
    WHERE jsonb_typeof(atributos -> 'plano') = 'null'
    LIMIT 5000
 );

UPDATE clientes
   SET atributos = jsonb_set(atributos, '{plano}', to_jsonb(lower(atributos ->> 'plano')))
 WHERE id IN (
   SELECT id FROM clientes
    WHERE atributos ->> 'plano' IN ('Pro', 'PRO', 'Free', 'Enterprise')
    LIMIT 5000
 );

-- 4. Validar o que ja existe sem bloquear escrita: VALIDATE CONSTRAINT varre a tabela
--    com SHARE UPDATE EXCLUSIVE, que convive com INSERT, UPDATE e DELETE.
ALTER TABLE clientes VALIDATE CONSTRAINT clientes_atributos_plano_chk;`;

const expandirSql = `-- expandir.sql
-- Fase 1: a coluna nasce anulavel e sem default, o que nao reescreve a tabela.
-- (ADD COLUMN ... GENERATED ALWAYS AS (...) STORED reescreveria as 40 milhoes de linhas
--  sob lock exclusivo; por isso a coluna e comum e o preenchimento e feito em lotes.)
ALTER TABLE clientes ADD COLUMN plano text;

-- O gatilho mantem os dois lados iguais enquanto convivem escritores antigos (que so
-- conhecem o JSON) e escritores novos (que so conhecem a coluna).
CREATE OR REPLACE FUNCTION clientes_sincronizar_plano() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.plano IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.plano IS DISTINCT FROM OLD.plano) THEN
    -- escrita nova: a coluna manda e a chave JSON acompanha, para leitores antigos
    NEW.atributos := coalesce(NEW.atributos, '{}'::jsonb)
                     || jsonb_build_object('plano', NEW.plano);
  ELSE
    -- escrita antiga: a chave JSON manda e a coluna acompanha
    NEW.plano := NEW.atributos ->> 'plano';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER clientes_sincronizar_plano_trg
  BEFORE INSERT OR UPDATE OF plano, atributos ON clientes
  FOR EACH ROW EXECUTE FUNCTION clientes_sincronizar_plano();

-- Fase 2 (depois do backfill): o indice na coluna, sem lock de escrita.
CREATE INDEX CONCURRENTLY clientes_plano_col_idx ON clientes (plano);

-- Fase 5 (depois que nenhum leitor usa a chave): obrigatoriedade sem varredura sob lock.
ALTER TABLE clientes ADD CONSTRAINT clientes_plano_nn CHECK (plano IS NOT NULL) NOT VALID;
ALTER TABLE clientes VALIDATE CONSTRAINT clientes_plano_nn;
ALTER TABLE clientes ALTER COLUMN plano SET NOT NULL;   -- usa a CHECK validada, nao varre
ALTER TABLE clientes DROP CONSTRAINT clientes_plano_nn;
DROP TRIGGER clientes_sincronizar_plano_trg ON clientes;
DROP INDEX CONCURRENTLY clientes_plano_idx;             -- o indice de expressao antigo`;

const backfillCode = `// backfill-plano.js
// Copia atributos->>'plano' para a coluna plano em lotes por faixa de id.
// Cada lote e uma transacao curta com statement_timeout e lock_timeout; a pausa
// entre lotes deixa o autovacuum e as escritas da aplicacao respirarem.
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const TAMANHO_LOTE = 5_000;
const PAUSA_MS = 200;
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function backfill({ aPartirDe = 0 } = {}) {
  const { rows } = await pool.query('SELECT max(id) AS max FROM clientes');
  const ultimoId = Number(rows[0].max ?? 0);
  let inicio = aPartirDe;
  let atualizadas = 0;

  while (inicio < ultimoId) {
    const fim = inicio + TAMANHO_LOTE;
    const conexao = await pool.connect();
    try {
      await conexao.query('BEGIN');
      await conexao.query("SET LOCAL statement_timeout = '5s'");
      await conexao.query("SET LOCAL lock_timeout = '1s'");
      // IS DISTINCT FROM torna o lote idempotente: rodar duas vezes nao grava nada
      // na segunda, e linhas que a aplicacao ja atualizou pelo gatilho sao puladas.
      const { rowCount } = await conexao.query(
        \`UPDATE clientes
            SET plano = atributos ->> 'plano'
          WHERE id > $1 AND id <= $2
            AND plano IS DISTINCT FROM (atributos ->> 'plano')\`,
        [inicio, fim],
      );
      await conexao.query('COMMIT');
      atualizadas += rowCount;
    } catch (erro) {
      await conexao.query('ROLLBACK').catch(() => {});
      conexao.release();
      // 55P03 lock_not_available, 57014 query_canceled: alguem segurava a linha ou
      // o lote demorou demais. Espera mais e repete o mesmo lote, sem avancar.
      if (erro.code === '55P03' || erro.code === '57014') {
        await dormir(PAUSA_MS * 10);
        continue;
      }
      throw erro;
    }
    conexao.release();
    console.log(JSON.stringify({ ate: fim, atualizadas }));
    inicio = fim;
    await dormir(PAUSA_MS);
  }
  return atualizadas;
}`;

const testeCode = `// migracao-plano.test.js
// Roda contra um Postgres descartavel (docker run --rm -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:16)
// com expandir.sql ja aplicado. Semeia linhas suficientes para o planejador preferir o indice.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { backfill } from './backfill-plano.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

before(async () => {
  await pool.query('ALTER TABLE clientes DISABLE TRIGGER clientes_sincronizar_plano_trg');
  // 200 mil linhas so com a chave JSON, como o legado: a coluna fica vazia de proposito.
  await pool.query(\`
    INSERT INTO clientes (atributos)
    SELECT jsonb_build_object('plano', (array['free', 'pro', 'enterprise'])[1 + (g % 3)],
                              'origem', 'importacao')
      FROM generate_series(1, 200000) AS g\`);
  await pool.query('ALTER TABLE clientes ENABLE TRIGGER clientes_sincronizar_plano_trg');
});
after(() => pool.end());

test('depois do backfill nenhuma linha diverge entre a coluna e a chave JSON', async () => {
  await backfill();
  await pool.query('ANALYZE clientes');
  const { rows } = await pool.query(\`
    SELECT count(*)::int AS divergentes
      FROM clientes
     WHERE plano IS DISTINCT FROM (atributos ->> 'plano')\`);
  assert.equal(rows[0].divergentes, 0);
});

test('o segundo backfill nao atualiza nenhuma linha', async () => {
  assert.equal(await backfill(), 0);
});

test('uma escrita antiga, so no JSON, aparece na coluna', async () => {
  const { rows } = await pool.query(
    \`INSERT INTO clientes (atributos) VALUES ('{"plano": "pro"}') RETURNING id, plano\`,
  );
  assert.equal(rows[0].plano, 'pro');
});

test('uma escrita nova, so na coluna, aparece no JSON para leitores antigos', async () => {
  const { rows } = await pool.query(
    \`UPDATE clientes SET plano = 'enterprise'
      WHERE id = (SELECT min(id) FROM clientes)
      RETURNING atributos ->> 'plano' AS plano_json\`,
  );
  assert.equal(rows[0].plano_json, 'enterprise');
});

test('o filtro por plano usa o indice da coluna, nao varredura sequencial', async () => {
  const { rows } = await pool.query(
    \`EXPLAIN (FORMAT JSON) SELECT id FROM clientes WHERE plano = 'enterprise'\`,
  );
  const plano = JSON.stringify(rows[0]['QUERY PLAN'][0].Plan);
  assert.ok(!plano.includes('"Seq Scan"'), plano);
  assert.ok(plano.includes('clientes_plano_col_idx'), plano);
});`;

const diagramaPt = `Promover a chave "plano" do jsonb a coluna, com escrita ligada o tempo todo.

Fase   Leitura                  Escrita                       Banco
----   -----------------------  ----------------------------  ----------------------------------------
 0     atributos->>'plano'      so JSON                       seq scan ou indice de expressao
 1     atributos->>'plano'      so JSON                       ADD COLUMN plano (anulavel, sem rewrite)
                                                              + gatilho JSON <-> coluna
 2     atributos->>'plano'      so JSON                       backfill em lotes de 5.000 (horas)
                                                              + CREATE INDEX CONCURRENTLY (plano)
 3     coluna plano             so JSON (gatilho preenche)    teste: zero linhas divergentes
 4     coluna plano             coluna (gatilho reescreve     leitores antigos ainda leem a chave
                                a chave no JSON)
 5     coluna plano             so coluna                     SET NOT NULL via CHECK validada,
                                                              DROP TRIGGER, chave removida em lotes

Cada fase e um deploy separado e reversivel: voltar uma fase nunca perde dado,
porque ate a fase 5 os dois lados existem e o gatilho mantem os dois iguais.`;

const diagramaEn = `Promoting the "plano" key from jsonb to a column, with writes on the whole time.

Phase  Reads                    Writes                        Database
-----  -----------------------  ----------------------------  ----------------------------------------
 0     atributos->>'plano'      JSON only                     seq scan or expression index
 1     atributos->>'plano'      JSON only                     ADD COLUMN plano (nullable, no rewrite)
                                                              + trigger JSON <-> column
 2     atributos->>'plano'      JSON only                     backfill in batches of 5,000 (hours)
                                                              + CREATE INDEX CONCURRENTLY (plano)
 3     plano column             JSON only (trigger fills)     test: zero divergent rows
 4     plano column             column (trigger writes the    old readers still read the key
                                key back into the JSON)
 5     plano column             column only                   SET NOT NULL via validated CHECK,
                                                              DROP TRIGGER, key removed in batches

Each phase is a separate, reversible deploy: stepping back a phase never loses data,
because until phase 5 both sides exist and the trigger keeps them equal.`;

const diagramaEs = `Promover la clave "plano" del jsonb a columna, con la escritura activa todo el tiempo.

Fase   Lectura                  Escritura                     Base de datos
----   -----------------------  ----------------------------  ----------------------------------------
 0     atributos->>'plano'      solo JSON                     seq scan o índice de expresión
 1     atributos->>'plano'      solo JSON                     ADD COLUMN plano (anulable, sin rewrite)
                                                              + trigger JSON <-> columna
 2     atributos->>'plano'      solo JSON                     backfill en lotes de 5.000 (horas)
                                                              + CREATE INDEX CONCURRENTLY (plano)
 3     columna plano            solo JSON (el trigger llena)  prueba: cero filas divergentes
 4     columna plano            columna (el trigger reescribe lectores antiguos aún leen la clave
                                la clave en el JSON)
 5     columna plano            solo columna                  SET NOT NULL vía CHECK validada,
                                                              DROP TRIGGER, clave eliminada en lotes

Cada fase es un despliegue separado y reversible: retroceder una fase nunca pierde datos,
porque hasta la fase 5 existen los dos lados y el trigger los mantiene iguales.`;

const pt = {
  intro:
    'A tabela de clientes nasceu com oito colunas e um campo atributos jsonb "para o que aparecer depois". Dois anos e 40 milhões de linhas mais tarde, o relatório de faturamento filtra por atributos->>\'plano\' e leva 38 segundos em varredura sequencial, a tela de cadastro quebra porque 3% das linhas guardam o CPF como número e não como texto, e o endereço aparece ora como objeto aninhado, ora como quatro chaves soltas na raiz. Ninguém escreveu esse esquema, mas ele existe: está espalhado por doze validações em código, três jobs de importação e um conjunto de consultas que só funcionam para as linhas que têm a forma certa. Este artigo mostra como inventariar as chaves e os tipos que já vivem dentro do JSON, qual índice responde a qual consulta e o que nenhum índice resolve, como impor validação com CHECK NOT VALID sem travar a escrita, como promover uma chave a coluna com expandir, migrar e contrair enquanto o tráfego continua, qual critério decide o que sai do JSON e o que fica, e como provar em teste que a migração não perdeu nem divergiu uma linha.',
  sections: [
    {
      title: 'O esquema existe, só não foi escrito: inventariar chaves e tipos antes de decidir qualquer coisa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira reação ao campo flexível que virou problema é discutir se ele deveria existir. É a discussão errada, porque o campo já tem 40 milhões de linhas e a resposta não muda nada. A pergunta útil é outra: que esquema esses 40 milhões de documentos obedecem de fato? Toda chave que aparece em 90% das linhas é uma coluna que nunca foi declarada. Toda chave que aparece com dois tipos diferentes é uma validação que nunca existiu. Toda chave que aparece em 0,3% das linhas e nunca entra em um WHERE é a única parte do campo que está sendo usada como "flexível" de verdade. Antes de criar índice, constraint ou coluna, é preciso enxergar essa distribuição, e o próprio Postgres a entrega com jsonb_object_keys e jsonb_typeof sobre uma amostra.',
        },
        {
          type: 'code',
          value: inventarioSql,
        },
        {
          type: 'paragraph',
          value:
            'O TABLESAMPLE importa mais do que parece. Rodar jsonb_object_keys em 40 milhões de linhas é uma varredura completa com detoast de cada documento, e um jsonb acima de cerca de 2 KB fica comprimido em uma tabela TOAST separada: ler uma chave é descomprimir o documento inteiro. Em 1% das páginas, a consulta termina em segundos, e a distribuição de chaves que importam, as que aparecem em mais de 1% das linhas, sai com precisão suficiente para decidir. O que a amostra não captura são as chaves raras, e isso é aceitável: chave rara não vai ganhar índice nem coluna. O resultado típico em uma tabela como essa tem a cara da tabela abaixo.',
        },
        {
          type: 'table',
          columns: ['Chave', 'Presença', 'Tipos encontrados', 'O que isso revela'],
          rows: [
            [
              'plano',
              '99,8%',
              'string',
              'Coluna obrigatória que nunca foi declarada; entra em WHERE e GROUP BY de todo relatório',
            ],
            [
              'cpf',
              '97,1%',
              'string, number',
              'Validação que nunca existiu: 3% das linhas vieram de uma importação que não converteu para texto',
            ],
            [
              'endereco',
              '61,4%',
              'object, string',
              'Duas gerações de cadastro: objeto com cep, rua e cidade, e um texto livre do formulário antigo',
            ],
            [
              'cep, rua, cidade (na raiz)',
              '12,9%',
              'string',
              'Terceira geração: o endereço achatado na raiz pelo job de importação do CRM anterior',
            ],
            [
              'limite_credito',
              '34,0%',
              'number, string',
              'Comparado com > em consultas; como texto, "900" é maior que "5000"',
            ],
            [
              'tags',
              '8,2%',
              'array',
              'Lista aberta por cliente; filtrada por contenção, nunca ordenada ou agregada',
            ],
            [
              'outras 41 chaves',
              '< 1% cada',
              'variados',
              'A parte realmente flexível do campo: fica no JSON e não ganha nada',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Esse inventário vira a lista de trabalho e a sua ordem. A chave presente em quase todas as linhas e usada em filtro é candidata a coluna. A chave com dois tipos precisa de correção e constraint antes de qualquer índice, porque um índice de expressão com cast falha na primeira linha com tipo errado. A chave com duas formas estruturais, como o endereço, precisa de uma decisão de modelagem, não de um índice. E a cauda longa de chaves raras é a parte do campo que estava certa o tempo todo.',
        },
      ],
    },
    {
      title: 'Qual índice responde a qual consulta, e o que nenhum índice resolve',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um jsonb aceita dois tipos de índice com comportamentos muito diferentes, e a escolha errada é comum porque os dois "funcionam" em desenvolvimento. O índice GIN sobre a coluna inteira responde a consultas de contenção, do tipo atributos @> \'{"plano": "pro"}\', e com a classe de operador jsonb_path_ops fica menor e mais rápido, ao custo de não responder ao operador de existência de chave. O índice B-tree de expressão, criado sobre (atributos->>\'plano\'), responde a igualdade e a faixas sobre aquela chave específica e, mais importante, faz o ANALYZE coletar estatísticas da expressão, o que dá ao planejador a seletividade real em vez de um chute. Com 40 milhões de linhas e um valor que aparece em 70% delas, essa diferença é a diferença entre o planejador escolher o índice e escolher a varredura.',
        },
        {
          type: 'code',
          value: indicesSql,
        },
        {
          type: 'table',
          columns: ['Consulta', 'Índice que responde', 'Observação'],
          rows: [
            [
              "atributos->>'plano' = 'pro'",
              'B-tree de expressão em (atributos->>\'plano\')',
              'A expressão da consulta precisa ser idêntica à do índice, inclusive o operador ->> e não ->',
            ],
            [
              "atributos @> '{\"plano\": \"pro\", \"origem\": \"indicacao\"}'",
              'GIN com jsonb_path_ops',
              'Uma consulta cobre várias chaves; o GIN não ajuda em ordenação nem em faixa',
            ],
            [
              "(atributos->>'limite_credito')::numeric > 5000",
              'B-tree de expressão com o mesmo cast',
              'Só constrói depois que toda linha tem valor numérico; antes disso, o CREATE INDEX falha',
            ],
            [
              "atributos->'tags' ? 'vip'",
              'GIN com jsonb_ops (o padrão)',
              'jsonb_path_ops não responde ?; com jsonb_path_ops, reescreva como @> \'{"tags": ["vip"]}\'',
            ],
            [
              "atributos->>'nome' ILIKE 'mar%'",
              'Nenhum dos dois',
              'Busca por prefixo sem acento exige índice trigram ou coluna própria com text_pattern_ops',
            ],
            [
              "ORDER BY atributos->>'criado_em'",
              'B-tree de expressão, se a consulta tiver WHERE seletivo',
              'Sem filtro, o banco ordena 40 milhões de textos; como coluna timestamptz, o índice entrega em ordem',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Há um limite do que o índice conserta. Quando a mesma chave é filtrada, ordenada, agregada e comparada numericamente, cada uma dessas consultas precisa de um índice de expressão diferente, cada um com seu custo de escrita, e o planejador continua sem estatísticas cruzadas entre elas. Nesse ponto o índice está compensando a ausência de uma coluna, e o custo de manter três índices de expressão em uma chave que aparece em 99,8% das linhas supera o custo de promovê-la. O índice é a resposta certa para a chave que entra em um ou dois tipos de filtro e para a contenção em chaves variadas; a coluna é a resposta para a chave que a aplicação trata como campo.',
        },
      ],
    },
    {
      title: 'Validação sem travar a escrita: CHECK NOT VALID, correção em lotes e VALIDATE depois',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A validação que existe hoje mora em código, e é por isso que 3% das linhas têm CPF numérico: o job de importação não passou pelo mesmo caminho do formulário. Mover a regra para o banco fecha essa porta para todo escritor, mas a forma ingênua, um ALTER TABLE ADD CONSTRAINT CHECK, varre a tabela inteira sob lock exclusivo e falha na primeira linha que viola a regra. Em 40 milhões de linhas isso é minutos de escrita bloqueada e, no fim, um erro. O caminho que funciona em produção tem três passos: adicionar a constraint com NOT VALID, o que a impõe só para linhas novas e atualizadas e devolve em milissegundos; corrigir o legado em lotes; e só então VALIDATE CONSTRAINT, que varre a tabela com um lock compatível com INSERT, UPDATE e DELETE.',
        },
        {
          type: 'code',
          value: validacaoSql,
        },
        {
          type: 'paragraph',
          value:
            'Dois detalhes do jsonb mordem nesse passo. O primeiro é que {"plano": null} não é chave ausente: jsonb_typeof devolve \'null\', a CHECK recusa, e a normalização correta é remover a chave com o operador de subtração, não gravar null de novo. O segundo é que todo UPDATE em uma chave reescreve o documento inteiro, porque o Postgres grava uma nova versão da linha a cada atualização. Corrigir 1,2 milhão de linhas em uma transação é 1,2 milhão de linhas mortas de uma vez, que o autovacuum vai precisar limpar enquanto a tabela cresce; em lotes de 5 mil, com pausa entre eles, o mesmo trabalho vira ruído de fundo. A regra em código continua existindo, mas passa a ser a mesma regra, expressa uma vez no banco e espelhada no validador da aplicação, em vez de doze variações que divergem a cada importação.',
        },
      ],
    },
    {
      title: 'Promover a chave a coluna: expandir, migrar e contrair sem parar a escrita',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A chave plano está em 99,8% das linhas, entra em todo relatório e tem três valores válidos. É uma coluna, e deveria ter nascido como uma. Promovê-la é a mesma migração em três fases usada para qualquer mudança de esquema sem janela: expandir, criando a coluna ao lado da chave; migrar, preenchendo a coluna e trocando leitores e escritores em deploys separados; e contrair, removendo a chave e o que a sustentava. A tentação é usar uma coluna gerada, GENERATED ALWAYS AS (atributos->>\'plano\') STORED, que resolve tudo em um comando. Em uma tabela grande esse comando reescreve todas as linhas sob lock exclusivo, e é exatamente a janela que não existe. A coluna precisa nascer anulável e vazia, e um gatilho precisa manter os dois lados iguais enquanto escritores antigos e novos convivem.',
        },
        {
          type: 'code',
          value: expandirSql,
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'O gatilho é o que torna cada fase reversível. Enquanto ele existe, um escritor antigo que só conhece o JSON preenche a coluna sem saber, e um escritor novo que só conhece a coluna reescreve a chave no JSON para os leitores que ainda não migraram. A decisão de qual lado manda é feita por linha, pelo que mudou naquela escrita, e não por uma bandeira global. O preenchimento do que já existe é um job à parte, em lotes por faixa de id, com timeout por lote e cláusula de idempotência, para poder ser interrompido e retomado quantas vezes for preciso.',
        },
        {
          type: 'code',
          value: backfillCode,
        },
        {
          type: 'paragraph',
          value:
            'A ordem das fases não é negociável. O índice na coluna só é criado depois do backfill, porque criar antes significa manter o índice a cada uma das 40 milhões de atualizações. A leitura só troca para a coluna depois que um teste mostra zero linhas divergentes. A escrita só troca depois da leitura, porque enquanto houver um leitor na chave JSON o gatilho precisa continuar reescrevendo-a. E o NOT NULL só entra no fim, por uma CHECK NOT VALID validada antes, porque ALTER COLUMN SET NOT NULL direto varre a tabela sob lock exclusivo, enquanto com uma CHECK equivalente já validada o Postgres aceita sem varrer.',
        },
      ],
    },
    {
      title: 'O que sai do JSON e o que fica: um critério que não depende de gosto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nem toda chave do inventário merece virar coluna, e a discussão "JSON versus relacional" não ajuda a decidir chave por chave. O critério que funciona olha para como a chave é usada, não para o que ela representa. Uma chave que entra em WHERE, ORDER BY, GROUP BY ou JOIN é uma coluna, porque o banco só otimiza bem o que conhece como coluna, com estatísticas, índice simples e tipo declarado. Uma chave que uma regra de negócio exige é uma coluna com NOT NULL, porque a obrigatoriedade precisa ser verificável pelo banco. Uma chave que só é lida junto com a linha inteira e varia por cliente fica no JSON, porque é para isso que o campo existe. E uma chave que é um objeto com ciclo de vida próprio, como o endereço, que muda em datas diferentes do cliente e pode ter histórico, é uma tabela.',
        },
        {
          type: 'table',
          columns: ['Sinal de uso', 'Decisão', 'Por quê'],
          rows: [
            [
              'Entra em WHERE, ORDER BY, GROUP BY ou JOIN',
              'Coluna com tipo declarado e índice',
              'Estatísticas, ordenação pelo índice e cast garantido pelo tipo, sem índice de expressão por consulta',
            ],
            [
              'Uma regra de negócio exige que exista',
              'Coluna NOT NULL, obrigatoriedade imposta pelo banco',
              'Um jsonb não tem como exigir uma chave sem CHECK, e a CHECK não protege contra o próximo job de importação',
            ],
            [
              'Comparada como número ou data',
              'Coluna numeric ou timestamptz',
              'Em jsonb, "900" > "5000" e a comparação de datas depende do formato que cada escritor usou',
            ],
            [
              'Lida só junto com a linha e diferente para cada cliente',
              'Fica no JSON',
              'É o caso de uso legítimo do campo flexível; promover custa coluna vazia em 99% das linhas',
            ],
            [
              'Objeto com ciclo de vida próprio, histórico ou cardinalidade um-para-muitos',
              'Tabela própria com chave estrangeira',
              'Endereços, contatos e documentos mudam em datas diferentes e precisam de auditoria por item',
            ],
            [
              'Lista aberta filtrada por contenção',
              'Fica no JSON com GIN, ou tabela de junção se precisar de contagem',
              'tags @> \'["vip"]\' é a consulta que o GIN responde melhor; contar clientes por tag já é agregação',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O que sobra no JSON depois dessa triagem precisa de duas coisas para não virar o mesmo problema daqui a dois anos. A primeira é uma chave de versão dentro do próprio documento, como "v": 2, gravada por todo escritor e usada pelo leitor para saber qual forma esperar, em vez de testar a presença de chaves. A segunda é o mesmo inventário da primeira seção rodando como consulta agendada, com alerta quando uma chave passa de 20% de presença ou aparece com um segundo tipo. O campo continua flexível; o que muda é que a flexibilidade passa a ser observada em vez de descoberta no incidente.',
        },
      ],
    },
    {
      title: 'Provar que a migração não perdeu nada: divergência zero, idempotência e o plano certo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A migração tem quatro afirmações que precisam ser verdadeiras antes de cada troca de fase, e todas cabem em um teste contra um Postgres descartável com o esquema de expandir.sql aplicado. Depois do backfill, nenhuma linha pode divergir entre a coluna e a chave. Rodar o backfill de novo não pode atualizar nada. Uma escrita antiga, que só conhece o JSON, precisa aparecer na coluna, e uma escrita nova, que só conhece a coluna, precisa aparecer no JSON. E a consulta que motivou tudo precisa usar o índice da coluna, o que só se prova com EXPLAIN sobre uma tabela grande o bastante para o planejador preferir o índice, por isso o teste semeia 200 mil linhas e roda ANALYZE antes de perguntar o plano.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'paragraph',
          value:
            'A consulta de divergência do primeiro teste é a mesma que deve rodar em produção, como passo de verificação, antes de trocar a leitura para a coluna e de novo antes de remover a chave. Ela é barata se tiver o índice da coluna e cara sem ele, e é esperado que devolva zero; qualquer número diferente de zero é uma escrita que passou por fora do gatilho, geralmente um job com o gatilho desabilitado ou um COPY direto, e precisa ser entendida antes de avançar. O teste do plano merece ficar na pipeline mesmo depois da migração, porque é o que detecta, antes da produção, o dia em que alguém reescreve a consulta com uma função sobre a coluna e o índice volta a ser ignorado.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Não é mais simples criar os índices de expressão e deixar tudo no JSON?',
      answer:
        'Para uma chave que entra em um ou dois tipos de filtro, é, e o índice de expressão é a resposta certa. O problema aparece quando a mesma chave é filtrada, ordenada, agregada e comparada como número: cada forma de consulta precisa de um índice de expressão diferente, com cast diferente, e cada um deles é mantido a cada escrita no documento inteiro. Nesse ponto, três índices de expressão em uma chave presente em 99% das linhas custam mais do que uma coluna com um índice simples, e o planejador continua sem estatísticas cruzadas. O inventário mostra quais chaves estão nesse caso; costumam ser duas ou três, não quarenta.',
    },
    {
      question: 'A coluna gerada STORED não resolve a promoção em um único comando?',
      answer:
        'Resolve o esquema, não a migração. Adicionar uma coluna gerada STORED a uma tabela existente reescreve todas as linhas sob lock exclusivo, porque o valor precisa ser calculado e gravado em cada uma. Em uma tabela pequena é um comando; em 40 milhões de linhas é uma janela de escrita bloqueada que o artigo inteiro existe para evitar. Além disso, a coluna gerada continua dependendo da chave no JSON, então não permite a fase de contração: a chave nunca pode ser removida. A coluna comum com gatilho e backfill em lotes custa mais passos e entrega o que a gerada não entrega: escrita ligada o tempo todo e a chave removida no fim.',
    },
    {
      question: 'E se o banco for MySQL ou outro, e não Postgres?',
      answer:
        'As fases são as mesmas, e os instrumentos mudam de nome. O MySQL tem índices sobre colunas geradas virtuais a partir de JSON_EXTRACT, o que cobre o papel do índice de expressão, e CHECK constraints desde a versão 8.0.16, mas não tem NOT VALID: a constraint é verificada na criação, então o legado precisa ser corrigido antes, não depois. Adicionar coluna anulável é uma operação online no InnoDB, e o gatilho de sincronização e o backfill em lotes funcionam igual. O inventário usa JSON_KEYS e JSON_TYPE em vez de jsonb_object_keys e jsonb_typeof. O que não muda em nenhum banco é a ordem: inventário, correção, constraint, coluna, backfill, índice, troca de leitura, troca de escrita, contração.',
    },
  ],
  conclusion: {
    title: 'O campo flexível não era o erro; não enxergar o esquema que cresceu dentro dele era',
    description:
      'Uma coluna JSON que vive dois anos em produção acumula um esquema real, com chaves obrigatórias, tipos esperados e consultas que dependem dele, e o único problema é que ninguém o declarou. O caminho de volta é inventariar as chaves e os tipos que existem de fato, dar índice de expressão ou GIN ao que é consultado de um jeito só, impor validação com CHECK NOT VALID e correção em lotes sem bloquear escrita, promover a coluna o que a aplicação trata como campo usando expandir, migrar e contrair com gatilho de sincronização, deixar no JSON só o que é flexível de verdade, agora com versão e inventário contínuo, e provar com testes de divergência zero e de plano de consulta que cada fase pode avançar.',
    cta: 'Revisar as colunas JSON dos meus sistemas',
  },
  related: [
    {
      label: 'Migração de banco sem janela: expandir, migrar e contrair sem derrubar escrita',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Índice que o banco decidiu ignorar: quando o plano de consulta muda sozinho',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Serviço de arquitetura e modernização backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The customers table was born with eight columns and an atributos jsonb field "for whatever comes later". Two years and 40 million rows later, the billing report filters on atributos->>\'plano\' and takes 38 seconds in a sequential scan, the signup screen breaks because 3% of rows store the tax ID as a number instead of a string, and the address shows up sometimes as a nested object and sometimes as four loose keys at the root. Nobody wrote that schema, but it exists: it is spread across twelve validations in code, three import jobs and a set of queries that only work for the rows that happen to have the right shape. This article shows how to inventory the keys and types that already live inside the JSON, which index answers which query and what no index can fix, how to enforce validation with CHECK NOT VALID without blocking writes, how to promote a key to a column with expand, migrate and contract while traffic keeps flowing, which criterion decides what leaves the JSON and what stays, and how to prove in a test that the migration neither lost nor diverged a single row.',
  sections: [
    {
      title: 'The schema exists, it just was never written down: inventory keys and types before deciding anything',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first reaction to a flexible field that became a problem is to argue whether it should exist at all. That is the wrong argument, because the field already holds 40 million rows and the answer changes nothing. The useful question is different: what schema do those 40 million documents actually follow? Every key present in 90% of rows is a column that was never declared. Every key that shows up with two different types is a validation that never existed. Every key present in 0.3% of rows that never appears in a WHERE is the only part of the field being used as genuinely "flexible". Before creating an index, a constraint or a column, you need to see that distribution, and Postgres itself provides it with jsonb_object_keys and jsonb_typeof over a sample.',
        },
        {
          type: 'code',
          value: inventarioSql,
        },
        {
          type: 'paragraph',
          value:
            'TABLESAMPLE matters more than it looks. Running jsonb_object_keys over 40 million rows is a full scan that detoasts every document, and a jsonb above roughly 2 KB is stored compressed in a separate TOAST table: reading one key means decompressing the whole document. Over 1% of the pages the query finishes in seconds, and the distribution of the keys that matter, the ones present in more than 1% of rows, comes out precise enough to decide. What the sample misses are the rare keys, and that is acceptable: a rare key will get neither an index nor a column. The typical result on a table like this looks like the table below.',
        },
        {
          type: 'table',
          columns: ['Key', 'Presence', 'Types found', 'What it reveals'],
          rows: [
            [
              'plano',
              '99.8%',
              'string',
              'A mandatory column that was never declared; it appears in the WHERE and GROUP BY of every report',
            ],
            [
              'cpf',
              '97.1%',
              'string, number',
              'A validation that never existed: 3% of rows came from an import that did not convert to text',
            ],
            [
              'endereco',
              '61.4%',
              'object, string',
              'Two generations of signup: an object with postal code, street and city, and free text from the old form',
            ],
            [
              'cep, rua, cidade (at the root)',
              '12.9%',
              'string',
              'Third generation: the address flattened at the root by the previous CRM import job',
            ],
            [
              'limite_credito',
              '34.0%',
              'number, string',
              'Compared with > in queries; as text, "900" is greater than "5000"',
            ],
            [
              'tags',
              '8.2%',
              'array',
              'An open list per customer; filtered by containment, never sorted or aggregated',
            ],
            [
              '41 other keys',
              '< 1% each',
              'mixed',
              'The genuinely flexible part of the field: it stays in the JSON and gets nothing',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'That inventory becomes the work list and its order. The key present in almost every row and used in filters is a column candidate. The key with two types needs correction and a constraint before any index, because an expression index with a cast fails on the first row with the wrong type. The key with two structural shapes, like the address, needs a modeling decision, not an index. And the long tail of rare keys is the part of the field that was right all along.',
        },
      ],
    },
    {
      title: 'Which index answers which query, and what no index can fix',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A jsonb accepts two kinds of index with very different behavior, and the wrong choice is common because both "work" in development. A GIN index over the whole column answers containment queries, of the form atributos @> \'{"plano": "pro"}\', and with the jsonb_path_ops operator class it is smaller and faster, at the cost of not answering the key-existence operator. A B-tree expression index, created over (atributos->>\'plano\'), answers equality and ranges on that specific key and, more importantly, makes ANALYZE collect statistics for the expression, which gives the planner real selectivity instead of a guess. With 40 million rows and a value present in 70% of them, that difference is the difference between the planner choosing the index and choosing the scan.',
        },
        {
          type: 'code',
          value: indicesSql,
        },
        {
          type: 'table',
          columns: ['Query', 'Index that answers it', 'Note'],
          rows: [
            [
              "atributos->>'plano' = 'pro'",
              'B-tree expression index on (atributos->>\'plano\')',
              'The query expression must be identical to the index expression, including ->> rather than ->',
            ],
            [
              "atributos @> '{\"plano\": \"pro\", \"origem\": \"indicacao\"}'",
              'GIN with jsonb_path_ops',
              'One query covers several keys; GIN does not help with sorting or ranges',
            ],
            [
              "(atributos->>'limite_credito')::numeric > 5000",
              'B-tree expression index with the same cast',
              'Only builds once every row holds a numeric value; before that, CREATE INDEX fails',
            ],
            [
              "atributos->'tags' ? 'vip'",
              'GIN with jsonb_ops (the default)',
              'jsonb_path_ops does not answer ?; with jsonb_path_ops, rewrite it as @> \'{"tags": ["vip"]}\'',
            ],
            [
              "atributos->>'nome' ILIKE 'mar%'",
              'Neither',
              'Case-insensitive prefix search needs a trigram index or a dedicated column with text_pattern_ops',
            ],
            [
              "ORDER BY atributos->>'criado_em'",
              'B-tree expression index, if the query has a selective WHERE',
              'Without a filter the database sorts 40 million strings; as a timestamptz column, the index returns rows in order',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'There is a limit to what an index fixes. When the same key is filtered, sorted, aggregated and compared numerically, each of those queries needs a different expression index, each with its own write cost, and the planner still has no cross statistics between them. At that point the index is compensating for the absence of a column, and the cost of maintaining three expression indexes on a key present in 99.8% of rows exceeds the cost of promoting it. The index is the right answer for a key that appears in one or two kinds of filter and for containment over varied keys; the column is the answer for a key the application treats as a field.',
        },
      ],
    },
    {
      title: 'Validation without blocking writes: CHECK NOT VALID, batched correction and VALIDATE afterwards',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The validation that exists today lives in code, and that is why 3% of rows hold a numeric tax ID: the import job did not go through the same path as the form. Moving the rule into the database closes that door for every writer, but the naive form, an ALTER TABLE ADD CONSTRAINT CHECK, scans the whole table under an exclusive lock and fails on the first row that violates the rule. On 40 million rows that is minutes of blocked writes and, at the end, an error. The path that works in production has three steps: add the constraint with NOT VALID, which enforces it only for new and updated rows and returns in milliseconds; fix the legacy data in batches; and only then VALIDATE CONSTRAINT, which scans the table under a lock compatible with INSERT, UPDATE and DELETE.',
        },
        {
          type: 'code',
          value: validacaoSql,
        },
        {
          type: 'paragraph',
          value:
            'Two jsonb details bite at this step. The first is that {"plano": null} is not a missing key: jsonb_typeof returns \'null\', the CHECK rejects it, and the correct normalization is to remove the key with the subtraction operator, not to write null again. The second is that every UPDATE to a key rewrites the whole document, because Postgres writes a new version of the row on every update. Fixing 1.2 million rows in one transaction creates 1.2 million dead rows at once, which autovacuum will need to clean while the table keeps growing; in batches of 5,000 with a pause between them, the same work becomes background noise. The rule in code keeps existing, but it becomes the same rule, expressed once in the database and mirrored in the application validator, instead of twelve variations that drift with every import.',
        },
      ],
    },
    {
      title: 'Promoting the key to a column: expand, migrate and contract without stopping writes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The plano key is present in 99.8% of rows, appears in every report and has three valid values. It is a column, and it should have been born as one. Promoting it is the same three-phase migration used for any zero-downtime schema change: expand, creating the column next to the key; migrate, filling the column and switching readers and writers in separate deploys; and contract, removing the key and whatever supported it. The temptation is to use a generated column, GENERATED ALWAYS AS (atributos->>\'plano\') STORED, which solves everything in one command. On a large table that command rewrites every row under an exclusive lock, and that is exactly the window that does not exist. The column has to be born nullable and empty, and a trigger has to keep both sides equal while old and new writers coexist.',
        },
        {
          type: 'code',
          value: expandirSql,
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'The trigger is what makes each phase reversible. While it exists, an old writer that only knows the JSON fills the column without knowing it, and a new writer that only knows the column writes the key back into the JSON for readers that have not migrated yet. The decision of which side wins is made per row, by what changed in that write, not by a global flag. Filling what already exists is a separate job, in batches by id range, with a timeout per batch and an idempotency clause, so it can be interrupted and resumed as many times as needed.',
        },
        {
          type: 'code',
          value: backfillCode,
        },
        {
          type: 'paragraph',
          value:
            'The order of the phases is not negotiable. The index on the column is created only after the backfill, because creating it before means maintaining the index on each of the 40 million updates. Reads switch to the column only after a test shows zero divergent rows. Writes switch only after reads, because as long as there is a reader on the JSON key the trigger must keep writing it. And NOT NULL comes last, through a CHECK NOT VALID validated beforehand, because a direct ALTER COLUMN SET NOT NULL scans the table under an exclusive lock, while with an equivalent CHECK already validated Postgres accepts it without scanning.',
        },
      ],
    },
    {
      title: 'What leaves the JSON and what stays: a criterion that does not depend on taste',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Not every key in the inventory deserves to become a column, and the "JSON versus relational" debate does not help decide key by key. The criterion that works looks at how the key is used, not at what it represents. A key that appears in WHERE, ORDER BY, GROUP BY or JOIN is a column, because the database only optimizes well what it knows as a column, with statistics, a plain index and a declared type. A key that a business rule requires is a NOT NULL column, because the requirement must be verifiable by the database. A key that is only read together with the whole row and varies per customer stays in the JSON, because that is what the field is for. And a key that is an object with its own lifecycle, like the address, which changes on different dates from the customer and may have history, is a table.',
        },
        {
          type: 'table',
          columns: ['Usage signal', 'Decision', 'Why'],
          rows: [
            [
              'Appears in WHERE, ORDER BY, GROUP BY or JOIN',
              'Column with a declared type and an index',
              'Statistics, index-ordered output and a cast guaranteed by the type, without one expression index per query',
            ],
            [
              'A business rule requires it to exist',
              'NOT NULL column, requirement enforced by the database',
              'A jsonb cannot require a key without a CHECK, and the CHECK does not protect against the next import job',
            ],
            [
              'Compared as a number or a date',
              'numeric or timestamptz column',
              'In jsonb, "900" > "5000" and date comparison depends on the format each writer used',
            ],
            [
              'Read only with the row and different for every customer',
              'Stays in the JSON',
              'This is the legitimate use case of the flexible field; promoting it costs an empty column in 99% of rows',
            ],
            [
              'Object with its own lifecycle, history or one-to-many cardinality',
              'Its own table with a foreign key',
              'Addresses, contacts and documents change on different dates and need per-item auditing',
            ],
            [
              'Open list filtered by containment',
              'Stays in the JSON with GIN, or a join table if it needs counting',
              'tags @> \'["vip"]\' is the query GIN answers best; counting customers per tag is already aggregation',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'What remains in the JSON after that triage needs two things to avoid becoming the same problem two years from now. The first is a version key inside the document itself, such as "v": 2, written by every writer and used by readers to know which shape to expect, instead of probing for the presence of keys. The second is the same inventory from the first section running as a scheduled query, with an alert when a key crosses 20% presence or shows up with a second type. The field stays flexible; what changes is that the flexibility is observed instead of discovered during an incident.',
        },
      ],
    },
    {
      title: 'Proving the migration lost nothing: zero divergence, idempotency and the right plan',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The migration has four claims that must be true before each phase switch, and all of them fit in a test against a disposable Postgres with the expand.sql schema applied. After the backfill, no row may diverge between the column and the key. Running the backfill again must update nothing. An old write, which only knows the JSON, must show up in the column, and a new write, which only knows the column, must show up in the JSON. And the query that motivated all of this must use the column index, which can only be proven with EXPLAIN over a table large enough for the planner to prefer the index, which is why the test seeds 200,000 rows and runs ANALYZE before asking for the plan.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'paragraph',
          value:
            'The divergence query in the first test is the same one that should run in production, as a verification step, before switching reads to the column and again before removing the key. It is cheap with the column index and expensive without it, and it is expected to return zero; any number other than zero is a write that bypassed the trigger, usually a job with the trigger disabled or a direct COPY, and must be understood before moving on. The plan test deserves to stay in the pipeline even after the migration, because it is what detects, before production, the day someone rewrites the query with a function over the column and the index gets ignored again.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is it not simpler to create the expression indexes and leave everything in the JSON?',
      answer:
        'For a key that appears in one or two kinds of filter, it is, and the expression index is the right answer. The problem appears when the same key is filtered, sorted, aggregated and compared as a number: each query shape needs a different expression index, with a different cast, and each of them is maintained on every write to the whole document. At that point, three expression indexes on a key present in 99% of rows cost more than one column with a plain index, and the planner still has no cross statistics. The inventory shows which keys are in that situation; it is usually two or three, not forty.',
    },
    {
      question: 'Does a STORED generated column not solve the promotion in a single command?',
      answer:
        'It solves the schema, not the migration. Adding a STORED generated column to an existing table rewrites every row under an exclusive lock, because the value must be computed and written for each one. On a small table it is one command; on 40 million rows it is a window of blocked writes that this whole article exists to avoid. Besides, the generated column keeps depending on the key in the JSON, so it does not allow the contract phase: the key can never be removed. The plain column with a trigger and batched backfill costs more steps and delivers what the generated one does not: writes on the whole time and the key removed at the end.',
    },
    {
      question: 'What if the database is MySQL or another one, not Postgres?',
      answer:
        'The phases are the same, and the instruments change names. MySQL has indexes over virtual generated columns built from JSON_EXTRACT, which covers the role of the expression index, and CHECK constraints since version 8.0.16, but it has no NOT VALID: the constraint is checked at creation, so the legacy data must be fixed before, not after. Adding a nullable column is an online operation in InnoDB, and the synchronization trigger and the batched backfill work the same way. The inventory uses JSON_KEYS and JSON_TYPE instead of jsonb_object_keys and jsonb_typeof. What does not change in any database is the order: inventory, correction, constraint, column, backfill, index, read switch, write switch, contraction.',
    },
  ],
  conclusion: {
    title: 'The flexible field was not the mistake; failing to see the schema that grew inside it was',
    description:
      'A JSON column that lives two years in production accumulates a real schema, with mandatory keys, expected types and queries that depend on it, and the only problem is that nobody declared it. The way back is to inventory the keys and types that actually exist, give an expression index or GIN to what is queried in a single way, enforce validation with CHECK NOT VALID and batched correction without blocking writes, promote to a column whatever the application treats as a field using expand, migrate and contract with a synchronization trigger, leave in the JSON only what is genuinely flexible, now with a version and a continuous inventory, and prove with zero-divergence and query-plan tests that each phase can move forward.',
    cta: 'Review the JSON columns in my systems',
  },
  related: [
    {
      label: 'Zero downtime database migration: expand, migrate and contract without stopping writes',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'The index the database decided to ignore: when the query plan changes on its own',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Backend architecture and modernization service',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'La tabla de clientes nació con ocho columnas y un campo atributos jsonb "para lo que aparezca después". Dos años y 40 millones de filas más tarde, el informe de facturación filtra por atributos->>\'plano\' y tarda 38 segundos en un recorrido secuencial, la pantalla de alta se rompe porque el 3% de las filas guarda el documento de identidad como número y no como texto, y la dirección aparece a veces como objeto anidado y a veces como cuatro claves sueltas en la raíz. Nadie escribió ese esquema, pero existe: está repartido entre doce validaciones en código, tres jobs de importación y un conjunto de consultas que solo funcionan para las filas que casualmente tienen la forma correcta. Este artículo muestra cómo inventariar las claves y los tipos que ya viven dentro del JSON, qué índice responde a qué consulta y qué no resuelve ningún índice, cómo imponer validación con CHECK NOT VALID sin bloquear la escritura, cómo promover una clave a columna con expandir, migrar y contraer mientras el tráfico sigue, qué criterio decide qué sale del JSON y qué se queda, y cómo demostrar en una prueba que la migración no perdió ni desvió una sola fila.',
  sections: [
    {
      title: 'El esquema existe, solo que nunca se escribió: inventariar claves y tipos antes de decidir nada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La primera reacción ante el campo flexible que se volvió un problema es discutir si debería existir. Es la discusión equivocada, porque el campo ya tiene 40 millones de filas y la respuesta no cambia nada. La pregunta útil es otra: ¿qué esquema siguen de hecho esos 40 millones de documentos? Toda clave presente en el 90% de las filas es una columna que nunca se declaró. Toda clave que aparece con dos tipos distintos es una validación que nunca existió. Toda clave presente en el 0,3% de las filas que nunca entra en un WHERE es la única parte del campo que se usa como "flexible" de verdad. Antes de crear un índice, una constraint o una columna, hay que ver esa distribución, y el propio Postgres la entrega con jsonb_object_keys y jsonb_typeof sobre una muestra.',
        },
        {
          type: 'code',
          value: inventarioSql,
        },
        {
          type: 'paragraph',
          value:
            'El TABLESAMPLE importa más de lo que parece. Ejecutar jsonb_object_keys sobre 40 millones de filas es un recorrido completo con detoast de cada documento, y un jsonb por encima de unos 2 KB se guarda comprimido en una tabla TOAST aparte: leer una clave es descomprimir el documento entero. Sobre el 1% de las páginas la consulta termina en segundos, y la distribución de las claves que importan, las presentes en más del 1% de las filas, sale con precisión suficiente para decidir. Lo que la muestra no captura son las claves raras, y eso es aceptable: una clave rara no va a recibir ni índice ni columna. El resultado típico en una tabla así se parece a la tabla siguiente.',
        },
        {
          type: 'table',
          columns: ['Clave', 'Presencia', 'Tipos encontrados', 'Qué revela'],
          rows: [
            [
              'plano',
              '99,8%',
              'string',
              'Columna obligatoria que nunca se declaró; entra en el WHERE y el GROUP BY de todos los informes',
            ],
            [
              'cpf',
              '97,1%',
              'string, number',
              'Validación que nunca existió: el 3% de las filas vino de una importación que no convirtió a texto',
            ],
            [
              'endereco',
              '61,4%',
              'object, string',
              'Dos generaciones de alta: un objeto con código postal, calle y ciudad, y un texto libre del formulario antiguo',
            ],
            [
              'cep, rua, cidade (en la raíz)',
              '12,9%',
              'string',
              'Tercera generación: la dirección aplanada en la raíz por el job de importación del CRM anterior',
            ],
            [
              'limite_credito',
              '34,0%',
              'number, string',
              'Comparada con > en consultas; como texto, "900" es mayor que "5000"',
            ],
            [
              'tags',
              '8,2%',
              'array',
              'Lista abierta por cliente; filtrada por contención, nunca ordenada ni agregada',
            ],
            [
              'otras 41 claves',
              '< 1% cada una',
              'variados',
              'La parte realmente flexible del campo: se queda en el JSON y no recibe nada',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Ese inventario se convierte en la lista de trabajo y en su orden. La clave presente en casi todas las filas y usada en filtros es candidata a columna. La clave con dos tipos necesita corrección y constraint antes de cualquier índice, porque un índice de expresión con cast falla en la primera fila con el tipo equivocado. La clave con dos formas estructurales, como la dirección, necesita una decisión de modelado, no un índice. Y la larga cola de claves raras es la parte del campo que estuvo bien todo el tiempo.',
        },
      ],
    },
    {
      title: 'Qué índice responde a qué consulta, y qué no resuelve ningún índice',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un jsonb acepta dos tipos de índice con comportamientos muy distintos, y la elección equivocada es común porque los dos "funcionan" en desarrollo. El índice GIN sobre la columna entera responde a consultas de contención, de la forma atributos @> \'{"plano": "pro"}\', y con la clase de operador jsonb_path_ops es más pequeño y más rápido, a costa de no responder al operador de existencia de clave. El índice B-tree de expresión, creado sobre (atributos->>\'plano\'), responde a igualdad y rangos sobre esa clave concreta y, más importante, hace que ANALYZE recoja estadísticas de la expresión, lo que da al planificador la selectividad real en lugar de una suposición. Con 40 millones de filas y un valor presente en el 70% de ellas, esa diferencia es la diferencia entre que el planificador elija el índice o elija el recorrido.',
        },
        {
          type: 'code',
          value: indicesSql,
        },
        {
          type: 'table',
          columns: ['Consulta', 'Índice que responde', 'Observación'],
          rows: [
            [
              "atributos->>'plano' = 'pro'",
              'B-tree de expresión sobre (atributos->>\'plano\')',
              'La expresión de la consulta debe ser idéntica a la del índice, incluido el operador ->> y no ->',
            ],
            [
              "atributos @> '{\"plano\": \"pro\", \"origem\": \"indicacao\"}'",
              'GIN con jsonb_path_ops',
              'Una consulta cubre varias claves; el GIN no ayuda en ordenación ni en rangos',
            ],
            [
              "(atributos->>'limite_credito')::numeric > 5000",
              'B-tree de expresión con el mismo cast',
              'Solo se construye cuando toda fila tiene valor numérico; antes de eso, el CREATE INDEX falla',
            ],
            [
              "atributos->'tags' ? 'vip'",
              'GIN con jsonb_ops (el predeterminado)',
              'jsonb_path_ops no responde ?; con jsonb_path_ops, reescríbela como @> \'{"tags": ["vip"]}\'',
            ],
            [
              "atributos->>'nome' ILIKE 'mar%'",
              'Ninguno de los dos',
              'La búsqueda por prefijo sin distinguir mayúsculas exige índice trigram o columna propia con text_pattern_ops',
            ],
            [
              "ORDER BY atributos->>'criado_em'",
              'B-tree de expresión, si la consulta tiene un WHERE selectivo',
              'Sin filtro la base ordena 40 millones de textos; como columna timestamptz, el índice entrega en orden',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Hay un límite a lo que el índice arregla. Cuando la misma clave se filtra, se ordena, se agrega y se compara numéricamente, cada una de esas consultas necesita un índice de expresión distinto, cada uno con su coste de escritura, y el planificador sigue sin estadísticas cruzadas entre ellos. En ese punto el índice está compensando la ausencia de una columna, y el coste de mantener tres índices de expresión sobre una clave presente en el 99,8% de las filas supera el coste de promoverla. El índice es la respuesta correcta para la clave que entra en uno o dos tipos de filtro y para la contención sobre claves variadas; la columna es la respuesta para la clave que la aplicación trata como campo.',
        },
      ],
    },
    {
      title: 'Validación sin bloquear la escritura: CHECK NOT VALID, corrección por lotes y VALIDATE después',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La validación que existe hoy vive en el código, y por eso el 3% de las filas tiene el documento como número: el job de importación no pasó por el mismo camino que el formulario. Mover la regla a la base de datos cierra esa puerta para todo escritor, pero la forma ingenua, un ALTER TABLE ADD CONSTRAINT CHECK, recorre la tabla entera bajo un lock exclusivo y falla en la primera fila que viola la regla. En 40 millones de filas eso son minutos de escritura bloqueada y, al final, un error. El camino que funciona en producción tiene tres pasos: añadir la constraint con NOT VALID, que la impone solo para filas nuevas y actualizadas y devuelve en milisegundos; corregir el legado por lotes; y solo entonces VALIDATE CONSTRAINT, que recorre la tabla con un lock compatible con INSERT, UPDATE y DELETE.',
        },
        {
          type: 'code',
          value: validacaoSql,
        },
        {
          type: 'paragraph',
          value:
            'Dos detalles del jsonb muerden en este paso. El primero es que {"plano": null} no es una clave ausente: jsonb_typeof devuelve \'null\', la CHECK lo rechaza, y la normalización correcta es eliminar la clave con el operador de sustracción, no volver a grabar null. El segundo es que todo UPDATE sobre una clave reescribe el documento entero, porque Postgres graba una nueva versión de la fila en cada actualización. Corregir 1,2 millones de filas en una transacción crea 1,2 millones de filas muertas de golpe, que el autovacuum tendrá que limpiar mientras la tabla sigue creciendo; en lotes de 5.000, con pausa entre ellos, el mismo trabajo se vuelve ruido de fondo. La regla en código sigue existiendo, pero pasa a ser la misma regla, expresada una vez en la base de datos y reflejada en el validador de la aplicación, en lugar de doce variaciones que divergen con cada importación.',
        },
      ],
    },
    {
      title: 'Promover la clave a columna: expandir, migrar y contraer sin detener la escritura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La clave plano está en el 99,8% de las filas, entra en todos los informes y tiene tres valores válidos. Es una columna, y debería haber nacido como tal. Promoverla es la misma migración en tres fases que se usa para cualquier cambio de esquema sin ventana: expandir, creando la columna junto a la clave; migrar, llenando la columna y cambiando lectores y escritores en despliegues separados; y contraer, eliminando la clave y lo que la sostenía. La tentación es usar una columna generada, GENERATED ALWAYS AS (atributos->>\'plano\') STORED, que lo resuelve todo en un comando. En una tabla grande ese comando reescribe todas las filas bajo un lock exclusivo, y es exactamente la ventana que no existe. La columna tiene que nacer anulable y vacía, y un trigger tiene que mantener los dos lados iguales mientras conviven escritores antiguos y nuevos.',
        },
        {
          type: 'code',
          value: expandirSql,
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'El trigger es lo que hace reversible cada fase. Mientras existe, un escritor antiguo que solo conoce el JSON llena la columna sin saberlo, y un escritor nuevo que solo conoce la columna reescribe la clave en el JSON para los lectores que todavía no migraron. La decisión de qué lado manda se toma por fila, según lo que cambió en esa escritura, y no por una bandera global. Rellenar lo que ya existe es un job aparte, en lotes por rango de id, con timeout por lote y cláusula de idempotencia, para poder interrumpirlo y reanudarlo tantas veces como haga falta.',
        },
        {
          type: 'code',
          value: backfillCode,
        },
        {
          type: 'paragraph',
          value:
            'El orden de las fases no es negociable. El índice sobre la columna se crea solo después del backfill, porque crearlo antes significa mantener el índice en cada una de las 40 millones de actualizaciones. La lectura cambia a la columna solo después de que una prueba muestre cero filas divergentes. La escritura cambia solo después de la lectura, porque mientras haya un lector en la clave JSON el trigger tiene que seguir reescribiéndola. Y el NOT NULL entra al final, mediante una CHECK NOT VALID validada antes, porque un ALTER COLUMN SET NOT NULL directo recorre la tabla bajo un lock exclusivo, mientras que con una CHECK equivalente ya validada Postgres lo acepta sin recorrerla.',
        },
      ],
    },
    {
      title: 'Qué sale del JSON y qué se queda: un criterio que no depende del gusto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No toda clave del inventario merece convertirse en columna, y la discusión "JSON contra relacional" no ayuda a decidir clave por clave. El criterio que funciona mira cómo se usa la clave, no lo que representa. Una clave que entra en WHERE, ORDER BY, GROUP BY o JOIN es una columna, porque la base de datos solo optimiza bien lo que conoce como columna, con estadísticas, índice simple y tipo declarado. Una clave que una regla de negocio exige es una columna NOT NULL, porque la obligatoriedad debe ser verificable por la base. Una clave que solo se lee junto con la fila entera y varía por cliente se queda en el JSON, porque para eso existe el campo. Y una clave que es un objeto con ciclo de vida propio, como la dirección, que cambia en fechas distintas de las del cliente y puede tener historial, es una tabla.',
        },
        {
          type: 'table',
          columns: ['Señal de uso', 'Decisión', 'Por qué'],
          rows: [
            [
              'Entra en WHERE, ORDER BY, GROUP BY o JOIN',
              'Columna con tipo declarado e índice',
              'Estadísticas, ordenación por el índice y cast garantizado por el tipo, sin un índice de expresión por consulta',
            ],
            [
              'Una regla de negocio exige que exista',
              'Columna NOT NULL, obligatoriedad impuesta por la base',
              'Un jsonb no puede exigir una clave sin CHECK, y la CHECK no protege del siguiente job de importación',
            ],
            [
              'Comparada como número o fecha',
              'Columna numeric o timestamptz',
              'En jsonb, "900" > "5000" y la comparación de fechas depende del formato que usó cada escritor',
            ],
            [
              'Leída solo junto con la fila y distinta para cada cliente',
              'Se queda en el JSON',
              'Es el caso de uso legítimo del campo flexible; promoverla cuesta una columna vacía en el 99% de las filas',
            ],
            [
              'Objeto con ciclo de vida propio, historial o cardinalidad uno a muchos',
              'Tabla propia con clave foránea',
              'Direcciones, contactos y documentos cambian en fechas distintas y necesitan auditoría por elemento',
            ],
            [
              'Lista abierta filtrada por contención',
              'Se queda en el JSON con GIN, o tabla de unión si hace falta contar',
              'tags @> \'["vip"]\' es la consulta que el GIN responde mejor; contar clientes por tag ya es agregación',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Lo que queda en el JSON después de esa clasificación necesita dos cosas para no convertirse en el mismo problema dentro de dos años. La primera es una clave de versión dentro del propio documento, como "v": 2, grabada por todo escritor y usada por el lector para saber qué forma esperar, en lugar de comprobar la presencia de claves. La segunda es el mismo inventario de la primera sección ejecutándose como consulta programada, con alerta cuando una clave supera el 20% de presencia o aparece con un segundo tipo. El campo sigue siendo flexible; lo que cambia es que la flexibilidad se observa en lugar de descubrirse en el incidente.',
        },
      ],
    },
    {
      title: 'Demostrar que la migración no perdió nada: divergencia cero, idempotencia y el plan correcto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La migración tiene cuatro afirmaciones que deben ser ciertas antes de cada cambio de fase, y todas caben en una prueba contra un Postgres desechable con el esquema de expandir.sql aplicado. Después del backfill, ninguna fila puede divergir entre la columna y la clave. Ejecutar el backfill de nuevo no puede actualizar nada. Una escritura antigua, que solo conoce el JSON, tiene que aparecer en la columna, y una escritura nueva, que solo conoce la columna, tiene que aparecer en el JSON. Y la consulta que motivó todo tiene que usar el índice de la columna, lo que solo se demuestra con EXPLAIN sobre una tabla lo bastante grande como para que el planificador prefiera el índice, por eso la prueba siembra 200.000 filas y ejecuta ANALYZE antes de pedir el plan.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'paragraph',
          value:
            'La consulta de divergencia de la primera prueba es la misma que debe ejecutarse en producción, como paso de verificación, antes de cambiar la lectura a la columna y de nuevo antes de eliminar la clave. Es barata con el índice de la columna y cara sin él, y se espera que devuelva cero; cualquier número distinto de cero es una escritura que pasó por fuera del trigger, normalmente un job con el trigger deshabilitado o un COPY directo, y hay que entenderla antes de avanzar. La prueba del plan merece quedarse en la pipeline incluso después de la migración, porque es la que detecta, antes de producción, el día en que alguien reescribe la consulta con una función sobre la columna y el índice vuelve a ser ignorado.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿No es más simple crear los índices de expresión y dejarlo todo en el JSON?',
      answer:
        'Para una clave que entra en uno o dos tipos de filtro, sí, y el índice de expresión es la respuesta correcta. El problema aparece cuando la misma clave se filtra, se ordena, se agrega y se compara como número: cada forma de consulta necesita un índice de expresión distinto, con un cast distinto, y cada uno de ellos se mantiene en cada escritura sobre el documento entero. En ese punto, tres índices de expresión sobre una clave presente en el 99% de las filas cuestan más que una columna con un índice simple, y el planificador sigue sin estadísticas cruzadas. El inventario muestra qué claves están en ese caso; suelen ser dos o tres, no cuarenta.',
    },
    {
      question: '¿La columna generada STORED no resuelve la promoción en un solo comando?',
      answer:
        'Resuelve el esquema, no la migración. Añadir una columna generada STORED a una tabla existente reescribe todas las filas bajo un lock exclusivo, porque el valor debe calcularse y grabarse en cada una. En una tabla pequeña es un comando; en 40 millones de filas es una ventana de escritura bloqueada que todo este artículo existe para evitar. Además, la columna generada sigue dependiendo de la clave en el JSON, así que no permite la fase de contracción: la clave nunca puede eliminarse. La columna común con trigger y backfill por lotes cuesta más pasos y entrega lo que la generada no entrega: escritura activa todo el tiempo y la clave eliminada al final.',
    },
    {
      question: '¿Y si la base de datos es MySQL u otra, y no Postgres?',
      answer:
        'Las fases son las mismas, y los instrumentos cambian de nombre. MySQL tiene índices sobre columnas generadas virtuales a partir de JSON_EXTRACT, lo que cubre el papel del índice de expresión, y CHECK constraints desde la versión 8.0.16, pero no tiene NOT VALID: la constraint se verifica al crearla, así que el legado debe corregirse antes, no después. Añadir una columna anulable es una operación online en InnoDB, y el trigger de sincronización y el backfill por lotes funcionan igual. El inventario usa JSON_KEYS y JSON_TYPE en lugar de jsonb_object_keys y jsonb_typeof. Lo que no cambia en ninguna base de datos es el orden: inventario, corrección, constraint, columna, backfill, índice, cambio de lectura, cambio de escritura, contracción.',
    },
  ],
  conclusion: {
    title: 'El campo flexible no era el error; no ver el esquema que creció dentro de él sí lo era',
    description:
      'Una columna JSON que vive dos años en producción acumula un esquema real, con claves obligatorias, tipos esperados y consultas que dependen de él, y el único problema es que nadie lo declaró. El camino de vuelta es inventariar las claves y los tipos que existen de hecho, dar índice de expresión o GIN a lo que se consulta de una sola manera, imponer validación con CHECK NOT VALID y corrección por lotes sin bloquear la escritura, promover a columna lo que la aplicación trata como campo usando expandir, migrar y contraer con un trigger de sincronización, dejar en el JSON solo lo que es flexible de verdad, ahora con versión e inventario continuo, y demostrar con pruebas de divergencia cero y de plan de consulta que cada fase puede avanzar.',
    cta: 'Revisar las columnas JSON de mis sistemas',
  },
  related: [
    {
      label: 'Migración de base de datos sin ventana: expandir, migrar y contraer sin detener la escritura',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'El índice que la base decidió ignorar: cuándo el plan de consulta cambia solo',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
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
