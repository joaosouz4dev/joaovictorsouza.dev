// Conteudo do artigo: COUNT(*) que trava a listagem. Por que contar linhas no Postgres exige visitar
// cada linha visivel, como medir o peso das contagens, decidir com o produto qual total a tela precisa,
// usar contagem com teto e navegacao sem total, estimar pelo planejador com estatisticas estendidas,
// manter contadores por delta sem criar linha quente e juntar tudo em uma API que escolhe a estrategia.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const diagnosticoCode = `-- Quanto do tempo total do banco vai para contagens.
WITH geral AS (SELECT sum(total_exec_time) AS tempo FROM pg_stat_statements)
SELECT left(regexp_replace(s.query, '\\s+', ' ', 'g'), 80) AS consulta,
       s.calls AS chamadas,
       round(s.mean_exec_time::numeric, 1) AS media_ms,
       round((100 * s.total_exec_time / geral.tempo)::numeric, 1) AS pct_do_tempo
  FROM pg_stat_statements s, geral
 WHERE s.query ILIKE '%count(%'
 ORDER BY s.total_exec_time DESC
 LIMIT 10;

-- O plano da contagem que a tela dispara a cada troca de filtro.
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
  FROM pedidos
 WHERE loja_id = 42
   AND status = 'pago'
   AND criado_em >= now() - interval '90 days';

-- Quanto da tabela esta marcado como all-visible no visibility map.
-- Abaixo de 90%, o index-only scan volta a ler o heap para conferir visibilidade.
SELECT s.relname,
       s.n_live_tup,
       s.n_dead_tup,
       s.last_autovacuum,
       round(100.0 * c.relallvisible / nullif(c.relpages, 0), 1) AS pct_all_visible
  FROM pg_stat_user_tables s
  JOIN pg_class c ON c.oid = s.relid
 WHERE s.relname = 'pedidos';`;

const tetoCode = `-- Indice que atende a listagem e a contagem com teto pelos mesmos filtros.
CREATE INDEX CONCURRENTLY pedidos_loja_status_criado
    ON pedidos (loja_id, status, criado_em DESC, id DESC);

-- Contagem com teto: o executor para de ler na linha 10.001.
SELECT count(*) AS total
  FROM (
    SELECT 1
      FROM pedidos
     WHERE loja_id = $1
       AND status = $2
       AND criado_em >= $3
     LIMIT 10001
  ) AS amostra;
-- total <= 10000: numero exato. total = 10001: a tela mostra "mais de 10.000".

-- Navegacao sem total: pede uma linha a mais para saber se existe proxima pagina.
SELECT id, cliente_nome, valor_total, criado_em
  FROM pedidos
 WHERE loja_id = $1
   AND status = $2
   AND (criado_em, id) < ($3, $4)
 ORDER BY criado_em DESC, id DESC
 LIMIT 51;
-- 51 linhas voltaram: mostra 50 e habilita "proxima". Menos que isso: e a ultima pagina.`;

const estimativaCode = `-- Total da tabela inteira, sem filtro: o numero que o ANALYZE ja calculou.
-- reltuples = -1 significa que a tabela nunca foi analisada (Postgres 14+).
SELECT reltuples::bigint AS total_estimado
  FROM pg_class
 WHERE oid = 'pedidos'::regclass;

-- Total estimado para os filtros da tela, lido do plano sem executar a consulta.
CREATE OR REPLACE FUNCTION pedidos_contagem_estimada(
  p_loja   bigint,
  p_status text,
  p_desde  timestamptz
) RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  filtros text[] := ARRAY['true'];
  plano   json;
BEGIN
  IF p_loja IS NOT NULL THEN
    filtros := filtros || format('loja_id = %s', p_loja);
  END IF;
  IF p_status IS NOT NULL THEN
    filtros := filtros || format('status = %L', p_status);
  END IF;
  IF p_desde IS NOT NULL THEN
    filtros := filtros || format('criado_em >= %L', p_desde);
  END IF;

  EXECUTE format(
    'EXPLAIN (FORMAT JSON) SELECT 1 FROM pedidos WHERE %s',
    array_to_string(filtros, ' AND ')
  ) INTO plano;

  RETURN (plano -> 0 -> 'Plan' ->> 'Plan Rows')::bigint;
END;
$$;

-- Loja e status sao correlacionados: sem isso o planejador multiplica as seletividades
-- como se fossem independentes e erra a estimativa por uma ordem de grandeza.
CREATE STATISTICS pedidos_loja_status (dependencies, mcv) ON loja_id, status FROM pedidos;
ALTER TABLE pedidos ALTER COLUMN loja_id SET STATISTICS 1000;
ANALYZE pedidos;`;

const contadorCode = `-- Total consolidado por loja e status.
CREATE TABLE pedidos_contagem (
  loja_id bigint NOT NULL,
  status  text   NOT NULL,
  total   bigint NOT NULL,
  PRIMARY KEY (loja_id, status)
);

-- Cada escrita em pedidos so insere uma linha aqui; ninguem disputa a mesma linha.
CREATE TABLE pedidos_contagem_delta (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loja_id bigint NOT NULL,
  status  text   NOT NULL,
  delta   int    NOT NULL
);
CREATE INDEX pedidos_contagem_delta_filtro ON pedidos_contagem_delta (loja_id, status);

CREATE OR REPLACE FUNCTION pedidos_registrar_delta() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    INSERT INTO pedidos_contagem_delta (loja_id, status, delta)
    VALUES (OLD.loja_id, OLD.status, -1);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO pedidos_contagem_delta (loja_id, status, delta)
    VALUES (NEW.loja_id, NEW.status, 1);
  END IF;
  RETURN NULL;
END;
$$;

-- Carga inicial e trigger na mesma transacao: o lock bloqueia escritas em pedidos
-- enquanto o GROUP BY roda, entao nenhum pedido entra duas vezes nem fica de fora.
BEGIN;
LOCK TABLE pedidos IN SHARE ROW EXCLUSIVE MODE;
CREATE TRIGGER pedidos_contagem_trg
  AFTER INSERT OR DELETE OR UPDATE OF loja_id, status ON pedidos
  FOR EACH ROW EXECUTE FUNCTION pedidos_registrar_delta();
INSERT INTO pedidos_contagem (loja_id, status, total)
SELECT loja_id, status, count(*) FROM pedidos GROUP BY loja_id, status;
COMMIT;

-- Consolidacao, rodada a cada poucos segundos por um job: soma os deltas e apaga o que somou.
WITH consumidos AS (
  DELETE FROM pedidos_contagem_delta
   WHERE id IN (
     SELECT id FROM pedidos_contagem_delta
      ORDER BY id
      LIMIT 50000
        FOR UPDATE SKIP LOCKED
   )
  RETURNING loja_id, status, delta
), somados AS (
  SELECT loja_id, status, sum(delta) AS delta
    FROM consumidos
   GROUP BY loja_id, status
)
INSERT INTO pedidos_contagem AS c (loja_id, status, total)
SELECT loja_id, status, delta FROM somados
ON CONFLICT (loja_id, status) DO UPDATE SET total = c.total + EXCLUDED.total;

-- Leitura exata: consolidado mais o que ainda nao foi consolidado, no mesmo snapshot.
SELECT coalesce(sum(total), 0)::bigint AS total
  FROM (
    SELECT total FROM pedidos_contagem
     WHERE loja_id = $1 AND ($2::text IS NULL OR status = $2)
    UNION ALL
    SELECT delta FROM pedidos_contagem_delta
     WHERE loja_id = $1 AND ($2::text IS NULL OR status = $2)
  ) AS partes;`;

const apiCode = `// pedidos/total.js - decide como calcular o total de uma listagem de pedidos.
import { pool } from '../db.js';

const TETO = 10_000;
const CACHE_MS = 60_000;
const CACHE_MAX = 5_000;
const cache = new Map();

function montarFiltro({ lojaId, status, desde }) {
  const condicoes = [];
  const params = [];
  if (lojaId != null) {
    params.push(lojaId);
    condicoes.push(\`loja_id = $\${params.length}\`);
  }
  if (status != null) {
    params.push(status);
    condicoes.push(\`status = $\${params.length}\`);
  }
  if (desde != null) {
    params.push(desde);
    condicoes.push(\`criado_em >= $\${params.length}\`);
  }
  return { where: condicoes.length ? condicoes.join(' AND ') : 'true', params };
}

// 12.384.917 vira 12.000.000: a tela nao promete precisao que a estimativa nao tem.
function arredondar(valor) {
  if (valor < 1_000) return valor;
  const passo = 10 ** (String(valor).length - 2);
  return Math.round(valor / passo) * passo;
}

async function contarPeloContador({ lojaId, status }) {
  const { rows } = await pool.query(
    \`SELECT coalesce(sum(total), 0)::bigint AS total
       FROM (
         SELECT total FROM pedidos_contagem
          WHERE loja_id = $1 AND ($2::text IS NULL OR status = $2)
         UNION ALL
         SELECT delta FROM pedidos_contagem_delta
          WHERE loja_id = $1 AND ($2::text IS NULL OR status = $2)
       ) AS partes\`,
    [lojaId, status ?? null],
  );
  return Number(rows[0].total);
}

async function estimar({ lojaId, status, desde }) {
  const { rows } = await pool.query(
    'SELECT pedidos_contagem_estimada($1::bigint, $2::text, $3::timestamptz) AS total',
    [lojaId ?? null, status ?? null, desde ?? null],
  );
  return Number(rows[0].total);
}

// Contagem com teto e tempo maximo; devolve null se estourar o tempo.
async function contarComTeto(filtros) {
  const { where, params } = montarFiltro(filtros);
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '300ms'");
    const { rows } = await client.query(
      \`SELECT count(*)::int AS total
         FROM (SELECT 1 FROM pedidos WHERE \${where} LIMIT \${TETO + 1}) AS amostra\`,
      params,
    );
    await client.query('COMMIT');
    return rows[0].total;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    if (erro.code === '57014') return null; // query_canceled: cai para a estimativa
    throw erro;
  } finally {
    client.release();
  }
}

async function calcular(filtros) {
  const estimado = await estimar(filtros);
  if (estimado > TETO * 2) return { tipo: 'estimado', valor: arredondar(estimado) };

  const contado = await contarComTeto(filtros);
  if (contado === null) return { tipo: 'estimado', valor: arredondar(estimado) };
  if (contado > TETO) return { tipo: 'minimo', valor: TETO };
  return { tipo: 'exato', valor: contado };
}

export async function totalDePedidos(filtros) {
  // Filtros cobertos pelo contador: resposta exata, barata e sem cache.
  if (filtros.lojaId != null && filtros.desde == null) {
    return { tipo: 'exato', valor: await contarPeloContador(filtros) };
  }

  const chave = JSON.stringify([filtros.lojaId ?? null, filtros.status ?? null, filtros.desde ?? null]);
  const guardado = cache.get(chave);
  if (guardado && guardado.expiraEm > Date.now()) return guardado.total;

  const total = await calcular(filtros);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(chave, { total, expiraEm: Date.now() + CACHE_MS });
  return total;
}`;

const diagramaPt = `Pedido de total para a listagem
        |
        v
Filtro = loja (+ status), sem período? --sim--> contador por delta -> exato
        | não
        v
Estimativa do planejador (EXPLAIN, ~1 ms)
        |
        +-- acima de 20.000 ------------------> "cerca de 12 milhões"
        |
        v
Contagem com teto (LIMIT 10.001, timeout 300 ms)
        |
        +-- até 10.000 -----------------------> exato
        +-- 10.001 ---------------------------> "mais de 10.000"
        +-- estourou o tempo -----------------> volta para a estimativa`;

const diagramaEn = `Total requested for the listing
        |
        v
Filter = store (+ status), no date range? --yes--> delta counter -> exact
        | no
        v
Planner estimate (EXPLAIN, ~1 ms)
        |
        +-- above 20,000 ---------------------> "about 12 million"
        |
        v
Capped count (LIMIT 10,001, 300 ms timeout)
        |
        +-- up to 10,000 ---------------------> exact
        +-- 10,001 ---------------------------> "more than 10,000"
        +-- timed out ------------------------> fall back to the estimate`;

const diagramaEs = `Pedido de total para el listado
        |
        v
Filtro = tienda (+ estado), sin período? --sí--> contador por delta -> exacto
        | no
        v
Estimación del planificador (EXPLAIN, ~1 ms)
        |
        +-- más de 20.000 --------------------> "cerca de 12 millones"
        |
        v
Conteo con tope (LIMIT 10.001, timeout 300 ms)
        |
        +-- hasta 10.000 ---------------------> exacto
        +-- 10.001 ---------------------------> "más de 10.000"
        +-- superó el tiempo -----------------> vuelve a la estimación`;

const pt = {
  intro:
    'O back-office de um marketplace com 2.300 lojistas tem uma tela de pedidos que abre com "Mostrando 1 a 50 de 12.384.917". A consulta que traz os 50 pedidos leva 9 ms. A que calcula o total leva 4,2 segundos no p95, roda de novo a cada troca de filtro e de página, e responde por 41% do tempo de CPU do banco no horário comercial. Ninguém lê o número inteiro; os lojistas querem saber se há muitos ou poucos pedidos e se existe uma próxima página. Este artigo mostra por que o COUNT(*) do PostgreSQL precisa visitar cada linha visível, como medir o peso das contagens, como decidir com o produto qual total a tela precisa de verdade e as quatro técnicas que substituem a varredura: contagem com teto, navegação sem total, estimativa pelo planejador e contador mantido por deltas, combinadas em uma API que escolhe a estratégia sozinha.',
  sections: [
    {
      title: 'Por que o COUNT(*) do Postgres varre o que você filtrou',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O PostgreSQL não guarda o número de linhas de uma tabela em lugar nenhum que possa ser lido com garantia de exatidão. Isso não é descuido, é consequência do MVCC: cada transação enxerga um snapshot próprio, e uma linha inserida por uma transação ainda aberta existe para ela e não existe para as outras. Não há um único total correto; há um total para cada snapshot. Para responder COUNT(*), o banco precisa percorrer as linhas que atendem ao filtro e conferir, uma a uma, se cada versão é visível para a transação atual.',
        },
        {
          type: 'paragraph',
          value:
            'Um índice ajuda menos do que parece. Com um índice em (loja_id, status), o planejador pode usar index-only scan, mas ainda visita cada entrada que casa com o filtro: 12 milhões de pedidos pagos são 12 milhões de entradas lidas. E o index-only scan só evita o heap nas páginas marcadas como all-visible no visibility map. Em uma tabela de pedidos, onde status muda o dia inteiro, uma parte das páginas está sempre suja, e o banco volta ao heap para conferir visibilidade. Sem índice útil, vira parallel seq scan, que termina mais rápido em relógio e consome CPU de vários workers ao mesmo tempo.',
        },
        {
          type: 'paragraph',
          value:
            'Antes de mudar a tela, meça. A primeira consulta abaixo mostra quanto do tempo total do banco vai para contagens, a segunda mostra o plano da contagem mais comum com o volume de buffers lidos e a terceira mostra quanto da tabela está all-visible, o que define se o index-only scan está trabalhando de verdade.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'table',
          columns: ['Métrica na tela de pedidos', 'Valor medido'],
          rows: [
            ['Linhas na tabela pedidos', '48 milhões'],
            ['Listagem de 50 pedidos (p95)', '9 ms'],
            ['COUNT(*) com filtro de loja e status (p95)', '4,2 s'],
            ['Contagens por minuto no horário comercial', '1.900'],
            ['Participação das contagens no tempo do banco', '41%'],
            ['Páginas all-visible em pedidos', '63%'],
          ],
        },
      ],
    },
    {
      title: 'Decidir com o produto qual total a tela realmente precisa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O passo que mais economiza não é técnico. É perguntar para que serve o número. Em entrevistas com lojistas do exemplo, ninguém usava o total exato acima de alguns milhares: o número servia para saber se o filtro estava amplo demais, se a fila de pedidos a separar estava crescendo e se valia a pena paginar ou refinar a busca. O total exato só importava em dois lugares: a contagem de pedidos por status no painel da loja, que alimenta metas, e a exportação, que já roda de forma assíncrona.',
        },
        {
          type: 'paragraph',
          value:
            'Com essa resposta, cada lugar da interface ganha o tipo de total adequado, e o contrato da API passa a dizer qual tipo está sendo devolvido. A tabela resume as opções e o custo de cada uma.',
        },
        {
          type: 'table',
          columns: ['Tipo de total', 'O que a tela mostra', 'Custo por chamada', 'Quando usar'],
          rows: [
            ['Exato por varredura', '12.384.917', 'Proporcional às linhas filtradas', 'Resultados pequenos, já limitados por filtro seletivo'],
            ['Exato por contador', '12.384.917', 'Leitura de poucas linhas', 'Filtros fixos e conhecidos, como loja e status'],
            ['Com teto', 'Mais de 10.000', 'No máximo 10.001 linhas', 'Filtros livres em que só importa saber se é muito'],
            ['Estimado', 'Cerca de 12 milhões', 'Um EXPLAIN, cerca de 1 ms', 'Resultados grandes, com estatísticas confiáveis'],
            ['Sem total', 'Botão de próxima página', 'Uma linha a mais na listagem', 'Feeds, logs e históricos navegados em sequência'],
          ],
        },
      ],
    },
    {
      title: 'Contagem com teto e navegação sem total',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A contagem com teto é a técnica mais simples e cobre a maioria dos filtros livres. Em vez de contar todas as linhas, a subconsulta pede no máximo 10.001 e o COUNT conta só o que veio. O executor para de ler assim que atinge o LIMIT, então o custo fica limitado pelo teto, não pelo tamanho do resultado. Se voltarem 10.001, a tela mostra "mais de 10.000", que é exatamente a informação que o lojista usa para decidir refinar o filtro.',
        },
        {
          type: 'paragraph',
          value:
            'Para a navegação, a pergunta "existe próxima página?" não precisa de total nenhum. Peça 51 linhas quando a página mostra 50: se vierem 51, há mais. Combinada com paginação por cursor em (criado_em, id), a listagem fica com custo constante em qualquer página, e o índice que atende à listagem é o mesmo que atende à contagem com teto.',
        },
        {
          type: 'code',
          value: tetoCode,
        },
        {
          type: 'list',
          items: [
            'O teto precisa ser um número que faça sentido para o usuário. 10.000 funcionou no exemplo porque nenhuma operação real olhava mais do que isso.',
            'A contagem com teto só é barata se o filtro tiver índice. Sem índice, o banco pode varrer milhões de linhas até encontrar as 10.001 que casam, quando o filtro é muito seletivo.',
            'Proteja a consulta com statement_timeout. Um filtro raro sobre uma coluna sem índice transforma o LIMIT em busca longa, e a tela deve cair para a estimativa em vez de esperar.',
          ],
        },
      ],
    },
    {
      title: 'Estimativa pelo planejador, com estatísticas que acompanham os dados',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Para resultados grandes, o próprio planejador já sabe a resposta aproximada. Sem filtro, pg_class.reltuples guarda o número de linhas calculado pelo último ANALYZE ou VACUUM. Com filtro, um EXPLAIN devolve em "Plan Rows" quantas linhas o planejador espera, sem executar nada. A função abaixo monta a consulta com os filtros da tela, roda o EXPLAIN em JSON e devolve a estimativa em cerca de 1 ms. Os valores entram por format com %L e %s sobre parâmetros tipados, então não há concatenação de texto vindo do usuário.',
        },
        {
          type: 'code',
          value: estimativaCode,
        },
        {
          type: 'paragraph',
          value:
            'A qualidade da estimativa depende das estatísticas, e esse é o ponto que costuma ser ignorado. Por padrão, o planejador trata loja_id e status como independentes e multiplica as seletividades. Mas lojas grandes concentram pedidos pagos de um jeito que a multiplicação não captura, e no exemplo o erro chegava a 9 vezes para as maiores lojas. CREATE STATISTICS com dependencies e mcv ensina ao planejador a correlação entre as colunas, e aumentar o alvo de estatísticas de loja_id garante que as lojas mais frequentes tenham valor próprio na lista de mais comuns.',
        },
        {
          type: 'paragraph',
          value:
            'Depois do ajuste, compare estimado e real para uma amostra de filtros antes de confiar no número. No exemplo, o erro mediano ficou em 4% e o pior caso em 30%, o que é aceitável para mostrar "cerca de 12 milhões" e inaceitável para qualquer cálculo financeiro. Se o autovacuum não acompanha a tabela, o ANALYZE atrasa e a estimativa envelhece junto; vale baixar autovacuum_analyze_scale_factor para tabelas grandes como esta.',
        },
      ],
    },
    {
      title: 'Contador mantido por deltas, sem criar uma linha quente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando a tela precisa de total exato e os filtros são conhecidos, como pedidos por loja e status no painel, a solução é manter o contador em vez de calcular. A versão ingênua, um UPDATE contador SET total = total + 1 em um trigger, cria um problema pior do que o original: todas as transações que inserem pedido da mesma loja passam a disputar a mesma linha, e as escritas ficam serializadas atrás do lock dessa linha.',
        },
        {
          type: 'paragraph',
          value:
            'A alternativa é registrar deltas. Cada escrita em pedidos só insere uma linha em pedidos_contagem_delta, e inserts não disputam lock entre si. Um job consolida os deltas a cada poucos segundos, somando por loja e status e apagando o que somou na mesma instrução. A leitura soma o consolidado com os deltas pendentes em uma única consulta, que roda sobre o mesmo snapshot e por isso devolve o número exato, mesmo no meio de uma consolidação.',
        },
        {
          type: 'code',
          value: contadorCode,
        },
        {
          type: 'list',
          items: [
            'A carga inicial e a criação do trigger rodam na mesma transação, com lock que bloqueia escritas em pedidos. No exemplo, o GROUP BY levou 22 segundos e foi feito às 4h; sem o lock, pedidos criados durante a carga entrariam duas vezes ou nenhuma.',
            'O trigger com UPDATE OF loja_id, status dispara mesmo quando o valor não muda, mas grava -1 e +1 na mesma chave, e a soma continua correta.',
            'O FOR UPDATE SKIP LOCKED permite rodar a consolidação em mais de uma instância do job sem que duas somem o mesmo delta.',
            'O contador só cobre os filtros que ele agrega. Filtro por período ou por texto continua indo para teto ou estimativa, e é melhor deixar isso explícito no código do que tentar criar contadores para toda combinação.',
          ],
        },
      ],
    },
    {
      title: 'Uma API que escolhe a estratégia e diz o que está devolvendo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'As técnicas só funcionam juntas se a escolha ficar em um lugar só. O módulo abaixo recebe os filtros da listagem e decide: filtros cobertos pelo contador vão para ele e voltam exatos; os demais passam primeiro pela estimativa, que custa 1 ms; resultados grandes param ali; resultados menores vão para a contagem com teto, protegida por statement_timeout de 300 ms dentro de uma transação somente leitura. O retorno sempre traz o tipo, e a interface formata de acordo: número inteiro, "mais de 10.000" ou "cerca de 12 milhões".',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'code',
          value: apiCode,
        },
        {
          type: 'paragraph',
          value:
            'Duas decisões de interface completam a mudança. O total passou a vir de um endpoint separado, carregado depois da listagem, então os 50 pedidos aparecem em 9 ms mesmo quando o total demora. E o cache de 60 segundos por combinação de filtros evita recontar quando o lojista volta para a mesma busca, sem afetar os totais exatos, que vêm do contador e não passam pelo cache.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Antes', 'Depois'],
          rows: [
            ['Tempo do total na tela de pedidos (p95)', '4,2 s', '6 ms'],
            ['Tempo para a lista aparecer (p95)', '4,3 s', '40 ms'],
            ['Participação das contagens no tempo do banco', '41%', '2%'],
            ['CPU do banco no pico', '78%', '31%'],
            ['Totais exibidos como exatos', '100%', '64%'],
            ['Reclamações de lojistas sobre o total aproximado', '-', '0 em 30 dias'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'No MySQL com InnoDB o problema é o mesmo?',
      answer:
        'Sim. O InnoDB também usa MVCC e não guarda um total exato por tabela; COUNT(*) percorre o menor índice disponível e confere visibilidade. O número em information_schema.TABLES e em SHOW TABLE STATUS é uma estimativa que pode errar bastante. As mesmas técnicas se aplicam: contagem com teto, linha a mais para a próxima página, estimativa pelo EXPLAIN e contadores mantidos fora da tabela principal.',
    },
    {
      question: 'O usuário não vai desconfiar de um número aproximado?',
      answer:
        'Desconfia quando o número aproximado aparece como se fosse exato e muda a cada recarga. Por isso o contrato devolve o tipo e a interface escreve "cerca de" ou "mais de". Nos lugares em que o número alimenta uma decisão concreta, como metas ou fechamento, o total precisa ser exato e vem do contador. No resto, mostrar a ordem de grandeza com honestidade é melhor do que fazer o usuário esperar quatro segundos por um dígito que ele não lê.',
    },
    {
      question: 'Uma view materializada com as contagens não resolve mais rápido?',
      answer:
        'Resolve para um painel com poucos agrupamentos fixos que pode ficar alguns minutos desatualizado. Para a listagem, não: REFRESH MATERIALIZED VIEW recalcula tudo a cada execução, o custo cresce com a tabela, a versão CONCURRENTLY exige índice único e ainda refaz a varredura inteira, e os filtros livres da tela não cabem em uma view pré-agregada. O contador por deltas entrega o mesmo resultado para os filtros fixos com atualização em segundos e custo proporcional às escritas, não ao tamanho da tabela.',
    },
  ],
  conclusion: {
    title: 'Contar tudo a cada clique é uma escolha, não uma necessidade',
    description:
      'A tela de pedidos não ficou mais rápida porque o banco aprendeu a contar 12 milhões de linhas em milissegundos. Ficou porque cada lugar da interface passou a pedir o total de que realmente precisa: exato e mantido por deltas onde o número alimenta decisões, com teto onde só importa saber se é muito, estimado pelo planejador onde o resultado é grande e nenhum onde basta saber se existe próxima página. A API escolhe a estratégia, diz qual usou, e o banco voltou a gastar CPU com o que gera valor.',
    cta: 'Revisar as listagens que pesam no meu banco',
  },
  related: [
    {
      label: 'Paginação por offset em tabela grande: quando a página 500 derruba o banco',
      to: '/blog/paginacao-offset-tabela-grande-pagina-500-derruba-banco',
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
    'The back office of a marketplace with 2,300 sellers has an orders screen that opens with "Showing 1 to 50 of 12,384,917". The query that fetches the 50 orders takes 9 ms. The one that computes the total takes 4.2 seconds at p95, runs again on every filter and page change, and accounts for 41% of the database CPU time during business hours. Nobody reads the full number; sellers want to know whether there are many or few orders and whether there is a next page. This article explains why PostgreSQL COUNT(*) has to visit every visible row, how to measure the weight of counts, how to decide with the product team which total the screen actually needs, and the four techniques that replace the full scan: capped counts, navigation without a total, planner estimates and a counter maintained through deltas, combined in an API that picks the strategy on its own.',
  sections: [
    {
      title: 'Why Postgres COUNT(*) scans everything you filtered',
      blocks: [
        {
          type: 'paragraph',
          value:
            'PostgreSQL does not store the row count of a table anywhere it can be read with a guarantee of accuracy. This is not an oversight, it is a consequence of MVCC: each transaction sees its own snapshot, and a row inserted by a transaction that is still open exists for that transaction and does not exist for the others. There is no single correct total; there is one total per snapshot. To answer COUNT(*), the database has to walk the rows that match the filter and check, one by one, whether each version is visible to the current transaction.',
        },
        {
          type: 'paragraph',
          value:
            'An index helps less than it seems. With an index on (loja_id, status), the planner can use an index-only scan, but it still visits every entry that matches the filter: 12 million paid orders means 12 million entries read. And the index-only scan only skips the heap on pages marked as all-visible in the visibility map. In an orders table, where status changes all day long, part of the pages is always dirty, and the database goes back to the heap to check visibility. Without a useful index, it becomes a parallel seq scan, which finishes faster in wall-clock time and burns CPU from several workers at once.',
        },
        {
          type: 'paragraph',
          value:
            'Measure before changing the screen. The first query below shows how much of the total database time goes to counts, the second shows the plan of the most common count with the number of buffers read, and the third shows how much of the table is all-visible, which determines whether the index-only scan is really doing its job.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'table',
          columns: ['Metric on the orders screen', 'Measured value'],
          rows: [
            ['Rows in the orders table', '48 million'],
            ['Listing of 50 orders (p95)', '9 ms'],
            ['COUNT(*) filtered by store and status (p95)', '4.2 s'],
            ['Counts per minute during business hours', '1,900'],
            ['Share of database time spent on counts', '41%'],
            ['All-visible pages in the orders table', '63%'],
          ],
        },
      ],
    },
    {
      title: 'Deciding with the product team which total the screen really needs',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The step that saves the most is not technical. It is asking what the number is for. In interviews with the sellers in this example, nobody used the exact total above a few thousand: the number told them whether the filter was too broad, whether the queue of orders to pick was growing and whether it was worth paging or refining the search. The exact total only mattered in two places: the order count per status on the store dashboard, which feeds targets, and the export, which already runs asynchronously.',
        },
        {
          type: 'paragraph',
          value:
            'With that answer, each part of the interface gets the right kind of total, and the API contract starts stating which kind it returns. The table summarizes the options and the cost of each one.',
        },
        {
          type: 'table',
          columns: ['Kind of total', 'What the screen shows', 'Cost per call', 'When to use'],
          rows: [
            ['Exact by scan', '12,384,917', 'Proportional to the filtered rows', 'Small results, already narrowed by a selective filter'],
            ['Exact by counter', '12,384,917', 'Reading a few rows', 'Fixed, known filters such as store and status'],
            ['Capped', 'More than 10,000', 'At most 10,001 rows', 'Free filters where only "is it a lot?" matters'],
            ['Estimated', 'About 12 million', 'One EXPLAIN, around 1 ms', 'Large results with reliable statistics'],
            ['No total', 'Next page button', 'One extra row in the listing', 'Feeds, logs and histories browsed in sequence'],
          ],
        },
      ],
    },
    {
      title: 'Capped counts and navigation without a total',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The capped count is the simplest technique and covers most free filters. Instead of counting every row, the subquery asks for at most 10,001 and COUNT only counts what came back. The executor stops reading as soon as it hits the LIMIT, so the cost is bounded by the cap, not by the size of the result. If 10,001 come back, the screen shows "more than 10,000", which is exactly the information the seller uses to decide whether to refine the filter.',
        },
        {
          type: 'paragraph',
          value:
            'For navigation, the question "is there a next page?" needs no total at all. Ask for 51 rows when the page shows 50: if 51 come back, there is more. Combined with cursor pagination on (criado_em, id), the listing keeps a constant cost on any page, and the index that serves the listing is the same one that serves the capped count.',
        },
        {
          type: 'code',
          value: tetoCode,
        },
        {
          type: 'list',
          items: [
            'The cap has to be a number that makes sense to the user. 10,000 worked in this example because no real workflow looked at more than that.',
            'A capped count is only cheap if the filter is indexed. Without an index, the database may scan millions of rows before finding the 10,001 that match when the filter is very selective.',
            'Protect the query with statement_timeout. A rare filter on an unindexed column turns the LIMIT into a long search, and the screen should fall back to the estimate instead of waiting.',
          ],
        },
      ],
    },
    {
      title: 'Planner estimates, with statistics that keep up with the data',
      blocks: [
        {
          type: 'paragraph',
          value:
            'For large results, the planner already knows the approximate answer. Without a filter, pg_class.reltuples holds the row count computed by the last ANALYZE or VACUUM. With a filter, an EXPLAIN returns in "Plan Rows" how many rows the planner expects, without executing anything. The function below builds the query with the screen filters, runs EXPLAIN in JSON and returns the estimate in about 1 ms. Values go through format with %L and %s over typed parameters, so no user text is concatenated into the SQL.',
        },
        {
          type: 'code',
          value: estimativaCode,
        },
        {
          type: 'paragraph',
          value:
            'The quality of the estimate depends on the statistics, and this is the part that usually gets ignored. By default, the planner treats loja_id and status as independent and multiplies their selectivities. But large stores concentrate paid orders in a way that multiplication does not capture, and in this example the error reached 9x for the biggest stores. CREATE STATISTICS with dependencies and mcv teaches the planner the correlation between the columns, and raising the statistics target for loja_id ensures the most frequent stores get their own value in the most common values list.',
        },
        {
          type: 'paragraph',
          value:
            'After tuning, compare estimated and actual counts for a sample of filters before trusting the number. In this example, the median error was 4% and the worst case 30%, which is acceptable for showing "about 12 million" and unacceptable for any financial calculation. If autovacuum cannot keep up with the table, ANALYZE falls behind and the estimate ages with it; it is worth lowering autovacuum_analyze_scale_factor for large tables like this one.',
        },
      ],
    },
    {
      title: 'A counter maintained through deltas, without creating a hot row',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When the screen needs an exact total and the filters are known, such as orders per store and status on the dashboard, the answer is to maintain the counter instead of computing it. The naive version, an UPDATE counter SET total = total + 1 inside a trigger, creates a worse problem than the original one: every transaction that inserts an order for the same store starts contending for the same row, and writes get serialized behind that row lock.',
        },
        {
          type: 'paragraph',
          value:
            'The alternative is to record deltas. Each write to the orders table only inserts a row into pedidos_contagem_delta, and inserts do not contend for locks with each other. A job consolidates the deltas every few seconds, summing by store and status and deleting what it summed in the same statement. The read adds the consolidated value to the pending deltas in a single query, which runs on one snapshot and therefore returns the exact number, even in the middle of a consolidation.',
        },
        {
          type: 'code',
          value: contadorCode,
        },
        {
          type: 'list',
          items: [
            'The initial load and the trigger creation run in the same transaction, with a lock that blocks writes to the orders table. In this example, the GROUP BY took 22 seconds and ran at 4 a.m.; without the lock, orders created during the load would be counted twice or not at all.',
            'The trigger with UPDATE OF loja_id, status fires even when the value does not change, but it writes -1 and +1 on the same key, so the sum stays correct.',
            'FOR UPDATE SKIP LOCKED lets more than one instance of the job run the consolidation without two of them summing the same delta.',
            'The counter only covers the filters it aggregates. Filtering by date range or by text still goes to the cap or the estimate, and it is better to make that explicit in the code than to try to build counters for every combination.',
          ],
        },
      ],
    },
    {
      title: 'An API that picks the strategy and says what it returns',
      blocks: [
        {
          type: 'paragraph',
          value:
            'These techniques only work together if the choice lives in one place. The module below receives the listing filters and decides: filters covered by the counter go to it and come back exact; the others first go through the estimate, which costs 1 ms; large results stop there; smaller ones go to the capped count, protected by a 300 ms statement_timeout inside a read-only transaction. The response always carries the kind, and the interface formats accordingly: full number, "more than 10,000" or "about 12 million".',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'code',
          value: apiCode,
        },
        {
          type: 'paragraph',
          value:
            'Two interface decisions complete the change. The total now comes from a separate endpoint, loaded after the listing, so the 50 orders appear in 9 ms even when the total is slow. And the 60 second cache per filter combination avoids recounting when the seller returns to the same search, without affecting exact totals, which come from the counter and skip the cache.',
        },
        {
          type: 'table',
          columns: ['Metric', 'Before', 'After'],
          rows: [
            ['Total on the orders screen (p95)', '4.2 s', '6 ms'],
            ['Time until the list appears (p95)', '4.3 s', '40 ms'],
            ['Share of database time spent on counts', '41%', '2%'],
            ['Database CPU at peak', '78%', '31%'],
            ['Totals displayed as exact', '100%', '64%'],
            ['Seller complaints about the approximate total', '-', '0 in 30 days'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is the problem the same in MySQL with InnoDB?',
      answer:
        'Yes. InnoDB also uses MVCC and does not keep an exact total per table; COUNT(*) walks the smallest available index and checks visibility. The number in information_schema.TABLES and in SHOW TABLE STATUS is an estimate that can be far off. The same techniques apply: capped counts, one extra row for the next page, estimates from EXPLAIN and counters maintained outside the main table.',
    },
    {
      question: 'Will users not distrust an approximate number?',
      answer:
        'They do when the approximate number is presented as if it were exact and changes on every reload. That is why the contract returns the kind and the interface writes "about" or "more than". Where the number feeds a concrete decision, such as targets or month-end closing, the total has to be exact and comes from the counter. Everywhere else, showing the order of magnitude honestly is better than making the user wait four seconds for a digit they do not read.',
    },
    {
      question: 'Would a materialized view with the counts not be faster?',
      answer:
        'It works for a dashboard with a few fixed groupings that can be a few minutes stale. For the listing, it does not: REFRESH MATERIALIZED VIEW recomputes everything on each run, the cost grows with the table, the CONCURRENTLY variant requires a unique index and still redoes the full scan, and the free filters on the screen do not fit a pre-aggregated view. The delta counter delivers the same result for fixed filters with updates in seconds and a cost proportional to writes, not to table size.',
    },
  ],
  conclusion: {
    title: 'Counting everything on every click is a choice, not a requirement',
    description:
      'The orders screen did not get faster because the database learned to count 12 million rows in milliseconds. It got faster because each part of the interface started asking for the total it actually needs: exact and maintained through deltas where the number drives decisions, capped where only "is it a lot?" matters, estimated by the planner where the result is large, and none at all where knowing whether there is a next page is enough. The API picks the strategy and says which one it used, and the database went back to spending CPU on work that creates value.',
    cta: 'Review the listings weighing on my database',
  },
  related: [
    {
      label: 'Offset pagination on a large table: when page 500 takes down the database',
      to: '/blog/paginacao-offset-tabela-grande-pagina-500-derruba-banco',
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
    'El back office de un marketplace con 2.300 vendedores tiene una pantalla de pedidos que se abre con "Mostrando 1 a 50 de 12.384.917". La consulta que trae los 50 pedidos tarda 9 ms. La que calcula el total tarda 4,2 segundos en el p95, vuelve a ejecutarse en cada cambio de filtro y de página, y representa el 41% del tiempo de CPU de la base en horario comercial. Nadie lee el número completo; los vendedores quieren saber si hay muchos o pocos pedidos y si existe una página siguiente. Este artículo muestra por qué el COUNT(*) de PostgreSQL tiene que visitar cada fila visible, cómo medir el peso de los conteos, cómo decidir con el equipo de producto qué total necesita realmente la pantalla y las cuatro técnicas que reemplazan el recorrido completo: conteo con tope, navegación sin total, estimación del planificador y contador mantenido por deltas, combinadas en una API que elige la estrategia por sí sola.',
  sections: [
    {
      title: 'Por qué el COUNT(*) de Postgres recorre todo lo que filtraste',
      blocks: [
        {
          type: 'paragraph',
          value:
            'PostgreSQL no guarda el número de filas de una tabla en ningún lugar que pueda leerse con garantía de exactitud. No es un descuido, es consecuencia del MVCC: cada transacción ve su propio snapshot, y una fila insertada por una transacción todavía abierta existe para ella y no existe para las demás. No hay un único total correcto; hay un total por cada snapshot. Para responder COUNT(*), la base tiene que recorrer las filas que cumplen el filtro y comprobar, una por una, si cada versión es visible para la transacción actual.',
        },
        {
          type: 'paragraph',
          value:
            'Un índice ayuda menos de lo que parece. Con un índice en (loja_id, status), el planificador puede usar index-only scan, pero sigue visitando cada entrada que coincide con el filtro: 12 millones de pedidos pagados son 12 millones de entradas leídas. Y el index-only scan solo evita el heap en las páginas marcadas como all-visible en el visibility map. En una tabla de pedidos, donde el estado cambia todo el día, una parte de las páginas siempre está sucia, y la base vuelve al heap para comprobar la visibilidad. Sin un índice útil, se convierte en parallel seq scan, que termina antes en tiempo de reloj y consume CPU de varios workers a la vez.',
        },
        {
          type: 'paragraph',
          value:
            'Antes de cambiar la pantalla, mide. La primera consulta muestra cuánto del tiempo total de la base se va en conteos, la segunda muestra el plan del conteo más común con la cantidad de buffers leídos y la tercera muestra cuánto de la tabla está all-visible, lo que define si el index-only scan realmente está haciendo su trabajo.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'table',
          columns: ['Métrica en la pantalla de pedidos', 'Valor medido'],
          rows: [
            ['Filas en la tabla de pedidos', '48 millones'],
            ['Listado de 50 pedidos (p95)', '9 ms'],
            ['COUNT(*) filtrado por tienda y estado (p95)', '4,2 s'],
            ['Conteos por minuto en horario comercial', '1.900'],
            ['Participación de los conteos en el tiempo de la base', '41%'],
            ['Páginas all-visible en la tabla de pedidos', '63%'],
          ],
        },
      ],
    },
    {
      title: 'Decidir con producto qué total necesita realmente la pantalla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El paso que más ahorra no es técnico. Es preguntar para qué sirve el número. En entrevistas con los vendedores del ejemplo, nadie usaba el total exacto por encima de unos pocos miles: el número servía para saber si el filtro era demasiado amplio, si la cola de pedidos por preparar estaba creciendo y si valía la pena paginar o refinar la búsqueda. El total exacto solo importaba en dos lugares: el conteo de pedidos por estado en el panel de la tienda, que alimenta metas, y la exportación, que ya corre de forma asíncrona.',
        },
        {
          type: 'paragraph',
          value:
            'Con esa respuesta, cada parte de la interfaz recibe el tipo de total adecuado, y el contrato de la API pasa a indicar qué tipo devuelve. La tabla resume las opciones y el costo de cada una.',
        },
        {
          type: 'table',
          columns: ['Tipo de total', 'Qué muestra la pantalla', 'Costo por llamada', 'Cuándo usarlo'],
          rows: [
            ['Exacto por recorrido', '12.384.917', 'Proporcional a las filas filtradas', 'Resultados pequeños, ya acotados por un filtro selectivo'],
            ['Exacto por contador', '12.384.917', 'Lectura de pocas filas', 'Filtros fijos y conocidos, como tienda y estado'],
            ['Con tope', 'Más de 10.000', 'Como máximo 10.001 filas', 'Filtros libres donde solo importa saber si son muchos'],
            ['Estimado', 'Cerca de 12 millones', 'Un EXPLAIN, cerca de 1 ms', 'Resultados grandes, con estadísticas confiables'],
            ['Sin total', 'Botón de página siguiente', 'Una fila más en el listado', 'Feeds, logs e historiales recorridos en secuencia'],
          ],
        },
      ],
    },
    {
      title: 'Conteo con tope y navegación sin total',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El conteo con tope es la técnica más simple y cubre la mayoría de los filtros libres. En lugar de contar todas las filas, la subconsulta pide como máximo 10.001 y el COUNT cuenta solo lo que llegó. El ejecutor deja de leer en cuanto alcanza el LIMIT, así que el costo queda acotado por el tope, no por el tamaño del resultado. Si vuelven 10.001, la pantalla muestra "más de 10.000", que es exactamente la información que el vendedor usa para decidir si refina el filtro.',
        },
        {
          type: 'paragraph',
          value:
            'Para la navegación, la pregunta "¿hay página siguiente?" no necesita ningún total. Pide 51 filas cuando la página muestra 50: si vuelven 51, hay más. Combinado con paginación por cursor en (criado_em, id), el listado mantiene un costo constante en cualquier página, y el índice que sirve al listado es el mismo que sirve al conteo con tope.',
        },
        {
          type: 'code',
          value: tetoCode,
        },
        {
          type: 'list',
          items: [
            'El tope tiene que ser un número que tenga sentido para el usuario. 10.000 funcionó en el ejemplo porque ninguna operación real miraba más que eso.',
            'El conteo con tope solo es barato si el filtro tiene índice. Sin índice, la base puede recorrer millones de filas hasta encontrar las 10.001 que coinciden cuando el filtro es muy selectivo.',
            'Protege la consulta con statement_timeout. Un filtro poco común sobre una columna sin índice convierte el LIMIT en una búsqueda larga, y la pantalla debe recurrir a la estimación en lugar de esperar.',
          ],
        },
      ],
    },
    {
      title: 'Estimación del planificador, con estadísticas que acompañan a los datos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Para resultados grandes, el propio planificador ya conoce la respuesta aproximada. Sin filtro, pg_class.reltuples guarda el número de filas calculado por el último ANALYZE o VACUUM. Con filtro, un EXPLAIN devuelve en "Plan Rows" cuántas filas espera el planificador, sin ejecutar nada. La función de abajo arma la consulta con los filtros de la pantalla, ejecuta el EXPLAIN en JSON y devuelve la estimación en cerca de 1 ms. Los valores pasan por format con %L y %s sobre parámetros tipados, así que no hay texto del usuario concatenado en el SQL.',
        },
        {
          type: 'code',
          value: estimativaCode,
        },
        {
          type: 'paragraph',
          value:
            'La calidad de la estimación depende de las estadísticas, y ese es el punto que suele ignorarse. Por defecto, el planificador trata loja_id y status como independientes y multiplica sus selectividades. Pero las tiendas grandes concentran pedidos pagados de una forma que la multiplicación no captura, y en el ejemplo el error llegaba a 9 veces en las tiendas más grandes. CREATE STATISTICS con dependencies y mcv le enseña al planificador la correlación entre las columnas, y aumentar el objetivo de estadísticas de loja_id garantiza que las tiendas más frecuentes tengan su propio valor en la lista de valores más comunes.',
        },
        {
          type: 'paragraph',
          value:
            'Después del ajuste, compara lo estimado con lo real en una muestra de filtros antes de confiar en el número. En el ejemplo, el error mediano quedó en 4% y el peor caso en 30%, lo que es aceptable para mostrar "cerca de 12 millones" e inaceptable para cualquier cálculo financiero. Si el autovacuum no da abasto con la tabla, el ANALYZE se atrasa y la estimación envejece con él; conviene bajar autovacuum_analyze_scale_factor en tablas grandes como esta.',
        },
      ],
    },
    {
      title: 'Contador mantenido por deltas, sin crear una fila caliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando la pantalla necesita un total exacto y los filtros son conocidos, como pedidos por tienda y estado en el panel, la solución es mantener el contador en lugar de calcularlo. La versión ingenua, un UPDATE contador SET total = total + 1 dentro de un trigger, crea un problema peor que el original: todas las transacciones que insertan pedidos de la misma tienda empiezan a disputar la misma fila, y las escrituras quedan serializadas detrás del lock de esa fila.',
        },
        {
          type: 'paragraph',
          value:
            'La alternativa es registrar deltas. Cada escritura en la tabla de pedidos solo inserta una fila en pedidos_contagem_delta, y los inserts no compiten por locks entre sí. Un job consolida los deltas cada pocos segundos, sumando por tienda y estado y borrando lo que sumó en la misma instrucción. La lectura suma el valor consolidado con los deltas pendientes en una sola consulta, que corre sobre el mismo snapshot y por eso devuelve el número exacto, incluso en medio de una consolidación.',
        },
        {
          type: 'code',
          value: contadorCode,
        },
        {
          type: 'list',
          items: [
            'La carga inicial y la creación del trigger corren en la misma transacción, con un lock que bloquea las escrituras en la tabla de pedidos. En el ejemplo, el GROUP BY tardó 22 segundos y se ejecutó a las 4 de la mañana; sin el lock, los pedidos creados durante la carga se contarían dos veces o ninguna.',
            'El trigger con UPDATE OF loja_id, status se dispara aunque el valor no cambie, pero escribe -1 y +1 en la misma clave, y la suma sigue siendo correcta.',
            'FOR UPDATE SKIP LOCKED permite ejecutar la consolidación en más de una instancia del job sin que dos sumen el mismo delta.',
            'El contador solo cubre los filtros que agrega. Filtrar por período o por texto sigue yendo al tope o a la estimación, y es mejor dejarlo explícito en el código que intentar crear contadores para cada combinación.',
          ],
        },
      ],
    },
    {
      title: 'Una API que elige la estrategia y dice qué está devolviendo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Las técnicas solo funcionan juntas si la elección vive en un único lugar. El módulo de abajo recibe los filtros del listado y decide: los filtros cubiertos por el contador van a él y vuelven exactos; los demás pasan primero por la estimación, que cuesta 1 ms; los resultados grandes se quedan ahí; los más pequeños van al conteo con tope, protegido por un statement_timeout de 300 ms dentro de una transacción de solo lectura. La respuesta siempre incluye el tipo, y la interfaz da formato según corresponda: número completo, "más de 10.000" o "cerca de 12 millones".',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'code',
          value: apiCode,
        },
        {
          type: 'paragraph',
          value:
            'Dos decisiones de interfaz completan el cambio. El total pasó a venir de un endpoint separado, cargado después del listado, así que los 50 pedidos aparecen en 9 ms aunque el total tarde. Y la caché de 60 segundos por combinación de filtros evita volver a contar cuando el vendedor regresa a la misma búsqueda, sin afectar los totales exactos, que vienen del contador y no pasan por la caché.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Antes', 'Después'],
          rows: [
            ['Total en la pantalla de pedidos (p95)', '4,2 s', '6 ms'],
            ['Tiempo hasta que aparece el listado (p95)', '4,3 s', '40 ms'],
            ['Participación de los conteos en el tiempo de la base', '41%', '2%'],
            ['CPU de la base en el pico', '78%', '31%'],
            ['Totales mostrados como exactos', '100%', '64%'],
            ['Quejas de vendedores sobre el total aproximado', '-', '0 en 30 días'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿En MySQL con InnoDB el problema es el mismo?',
      answer:
        'Sí. InnoDB también usa MVCC y no guarda un total exacto por tabla; COUNT(*) recorre el índice más pequeño disponible y comprueba la visibilidad. El número de information_schema.TABLES y de SHOW TABLE STATUS es una estimación que puede equivocarse bastante. Se aplican las mismas técnicas: conteo con tope, una fila más para la página siguiente, estimación por EXPLAIN y contadores mantenidos fuera de la tabla principal.',
    },
    {
      question: '¿El usuario no va a desconfiar de un número aproximado?',
      answer:
        'Desconfía cuando el número aproximado aparece como si fuera exacto y cambia en cada recarga. Por eso el contrato devuelve el tipo y la interfaz escribe "cerca de" o "más de". Donde el número alimenta una decisión concreta, como metas o cierre de mes, el total tiene que ser exacto y viene del contador. En el resto, mostrar el orden de magnitud con honestidad es mejor que hacer esperar al usuario cuatro segundos por un dígito que no lee.',
    },
    {
      question: '¿Una vista materializada con los conteos no lo resuelve más rápido?',
      answer:
        'Lo resuelve para un panel con pocas agrupaciones fijas que puede quedar algunos minutos desactualizado. Para el listado, no: REFRESH MATERIALIZED VIEW recalcula todo en cada ejecución, el costo crece con la tabla, la variante CONCURRENTLY exige un índice único y aun así rehace el recorrido completo, y los filtros libres de la pantalla no caben en una vista preagregada. El contador por deltas entrega el mismo resultado para los filtros fijos con actualización en segundos y un costo proporcional a las escrituras, no al tamaño de la tabla.',
    },
  ],
  conclusion: {
    title: 'Contar todo en cada clic es una elección, no una necesidad',
    description:
      'La pantalla de pedidos no se volvió más rápida porque la base aprendiera a contar 12 millones de filas en milisegundos. Se volvió más rápida porque cada parte de la interfaz empezó a pedir el total que realmente necesita: exacto y mantenido por deltas donde el número alimenta decisiones, con tope donde solo importa saber si son muchos, estimado por el planificador donde el resultado es grande y ninguno donde basta con saber si hay página siguiente. La API elige la estrategia, dice cuál usó, y la base volvió a gastar CPU en lo que genera valor.',
    cta: 'Revisar los listados que pesan en mi base de datos',
  },
  related: [
    {
      label: 'Paginación por offset en una tabla grande: cuándo la página 500 tumba la base de datos',
      to: '/blog/paginacao-offset-tabela-grande-pagina-500-derruba-banco',
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
