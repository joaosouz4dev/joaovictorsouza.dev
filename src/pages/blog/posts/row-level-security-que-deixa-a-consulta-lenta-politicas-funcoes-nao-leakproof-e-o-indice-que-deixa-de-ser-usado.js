// Conteudo do artigo: Row Level Security que deixa a consulta lenta. Por que uma politica de RLS
// com funcao VOLATILE vira Seq Scan com filtro linha a linha, por que o EXPLAIN do dono da tabela
// nao reproduz o problema, como STABLE e (SELECT ...) transformam a chamada em InitPlan, por que
// operadores nao leakproof (ILIKE, LIKE, lower, @>, @@) deixam de ser condicao de indice sob RLS
// e como verificar os planos como o papel da aplicacao no CI.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const comments = {
  pt: {
    a1: 'Função escrita na migração: plpgsql sem volatilidade declarada é VOLATILE.',
    a2: 'Como dono da tabela (o usuário das migrações), a política nem é aplicada:',
    a3: 'Como a aplicação enxerga a mesma tabela (a sessão precisa ser membro de app_api):',
    a4: 'A função VOLATILE não pode virar condição de índice: é chamada para cada uma das 18 milhões de linhas.',
    b1: 'STABLE: o valor não muda dentro da consulta, então pode ser usado como condição de índice.',
    b2: 'Sem a configuração, devolve NULL e a política não deixa passar nenhuma linha.',
    b3: 'Envolver a chamada em um SELECT a transforma em InitPlan: executada uma vez por consulta.',
    b4: 'Política de associação que roda um SubPlan para cada linha da tabela:',
    b5: 'Mesma regra avaliada uma vez: a lista de tenants do usuário vira um array.',
    c1: 'Quais operadores de texto podem ser avaliados antes da política?',
    c2: 'Como a aplicação: a política usa o índice de tenant, mas o ILIKE fica de fora dele.',
    c3: 'O índice trigram não aparece: texticlike não é leakproof e não pode ser condição de índice.',
    d1: 'Busca executada com os privilégios do dono da tabela, que não passa pela política.',
    d2: 'O isolamento continua, mas agora escrito de forma explícita e leakproof.',
    d3: 'Escapa % e _ digitados pelo usuário para que virem texto literal no padrão.',
    d4: 'Só a aplicação pode chamar a função.',
    e1: 'Roda no CI contra um banco com o esquema de produção: node verificar-planos-rls.js',
    e2: 'Consultas críticas com valores literais, do jeito que a aplicação as envia.',
    e3: 'Tabelas em que varrer tudo é sempre um defeito, independente do volume do banco de teste.',
    e4: 'Seq Scan, ou Index Scan sem Index Cond (varredura do índice inteiro), numa tabela grande.',
    e5: 'Sem Seq Scan barato como opção, só sobra varredura completa quando nenhum índice serve.',
  },
  en: {
    a1: 'Function written in the migration: plpgsql without a declared volatility is VOLATILE.',
    a2: 'As the table owner (the migrations user), the policy is not even applied:',
    a3: 'How the application sees the same table (the session must be a member of app_api):',
    a4: 'The VOLATILE function cannot become an index condition: it is called for each of the 18 million rows.',
    b1: 'STABLE: the value does not change within the query, so it can be used as an index condition.',
    b2: 'Without the setting it returns NULL and the policy lets no row through.',
    b3: 'Wrapping the call in a SELECT turns it into an InitPlan: executed once per query.',
    b4: 'Membership policy that runs a SubPlan for every row of the table:',
    b5: 'Same rule evaluated once: the list of tenants of the user becomes an array.',
    c1: 'Which text operators can be evaluated before the policy?',
    c2: 'As the application: the policy uses the tenant index, but ILIKE stays out of it.',
    c3: 'The trigram index does not show up: texticlike is not leakproof and cannot be an index condition.',
    d1: 'Search executed with the privileges of the table owner, which does not go through the policy.',
    d2: 'Isolation is still there, but now written explicitly and leakproof.',
    d3: 'Escapes % and _ typed by the user so they become literal text in the pattern.',
    d4: 'Only the application can call the function.',
    e1: 'Runs in CI against a database with the production schema: node verificar-planos-rls.js',
    e2: 'Critical queries with literal values, the way the application sends them.',
    e3: 'Tables where scanning everything is always a defect, regardless of the test database volume.',
    e4: 'Seq Scan, or Index Scan without Index Cond (a full index scan), on a large table.',
    e5: 'With no cheap Seq Scan available, a full scan only remains when no index can serve the query.',
  },
  es: {
    a1: 'Función escrita en la migración: plpgsql sin volatilidad declarada es VOLATILE.',
    a2: 'Como dueño de la tabla (el usuario de las migraciones), la política ni siquiera se aplica:',
    a3: 'Cómo ve la aplicación la misma tabla (la sesión debe ser miembro de app_api):',
    a4: 'La función VOLATILE no puede ser condición de índice: se llama para cada una de las 18 millones de filas.',
    b1: 'STABLE: el valor no cambia dentro de la consulta, así que puede usarse como condición de índice.',
    b2: 'Sin la configuración devuelve NULL y la política no deja pasar ninguna fila.',
    b3: 'Envolver la llamada en un SELECT la convierte en InitPlan: se ejecuta una vez por consulta.',
    b4: 'Política de membresía que ejecuta un SubPlan por cada fila de la tabla:',
    b5: 'La misma regla evaluada una vez: la lista de tenants del usuario se convierte en un array.',
    c1: '¿Qué operadores de texto pueden evaluarse antes de la política?',
    c2: 'Como la aplicación: la política usa el índice de tenant, pero el ILIKE queda fuera de él.',
    c3: 'El índice trigram no aparece: texticlike no es leakproof y no puede ser condición de índice.',
    d1: 'Búsqueda ejecutada con los privilegios del dueño de la tabla, que no pasa por la política.',
    d2: 'El aislamiento sigue, pero ahora escrito de forma explícita y leakproof.',
    d3: 'Escapa % y _ escritos por el usuario para que sean texto literal en el patrón.',
    d4: 'Solo la aplicación puede llamar a la función.',
    e1: 'Corre en el CI contra una base con el esquema de producción: node verificar-planos-rls.js',
    e2: 'Consultas críticas con valores literales, tal como las envía la aplicación.',
    e3: 'Tablas en las que recorrer todo siempre es un defecto, sin importar el volumen de la base de prueba.',
    e4: 'Seq Scan, o Index Scan sin Index Cond (recorrido del índice completo), en una tabla grande.',
    e5: 'Sin un Seq Scan barato como opción, solo queda el recorrido completo cuando ningún índice sirve.',
  },
};

const setupCode = (c) => `CREATE TABLE pedidos (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  integer     NOT NULL,
  cliente    text        NOT NULL,
  status     text        NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pedidos_tenant_criado_idx ON pedidos (tenant_id, criado_em DESC);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX pedidos_cliente_trgm_idx ON pedidos USING gin (cliente gin_trgm_ops);

-- ${c.a1}
CREATE FUNCTION app_tenant_atual() RETURNS integer
LANGUAGE plpgsql AS $$
BEGIN
  RETURN current_setting('app.tenant_id')::integer;
END;
$$;

CREATE ROLE app_api NOLOGIN;
GRANT SELECT ON pedidos TO app_api;
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON pedidos
  USING (tenant_id = app_tenant_atual());

-- ${c.a2}
EXPLAIN SELECT * FROM pedidos WHERE tenant_id = 42
 ORDER BY criado_em DESC LIMIT 50;
 Limit
   ->  Index Scan using pedidos_tenant_criado_idx on pedidos
         Index Cond: (tenant_id = 42)

-- ${c.a3}
BEGIN;
SET LOCAL ROLE app_api;
SELECT set_config('app.tenant_id', '42', true);
EXPLAIN SELECT * FROM pedidos ORDER BY criado_em DESC LIMIT 50;
 Limit
   ->  Sort
         Sort Key: criado_em DESC
         ->  Seq Scan on pedidos
               Filter: (tenant_id = app_tenant_atual())
-- ${c.a4}
ROLLBACK;`;

const functionFixCode = (c) => `-- ${c.b1}
-- ${c.b2}
CREATE OR REPLACE FUNCTION app_tenant_atual() RETURNS integer
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::integer
$$;

-- ${c.b3}
ALTER POLICY isolamento_tenant ON pedidos
  USING (tenant_id = (SELECT app_tenant_atual()));

EXPLAIN SELECT * FROM pedidos ORDER BY criado_em DESC LIMIT 50;
 Limit
   InitPlan 1
     ->  Result
   ->  Index Scan using pedidos_tenant_criado_idx on pedidos
         Index Cond: (tenant_id = (InitPlan 1).col1)

-- ${c.b4}
CREATE POLICY membros_veem ON notas_fiscais USING (
  EXISTS (SELECT 1 FROM membros m
           WHERE m.tenant_id = notas_fiscais.tenant_id
             AND m.usuario_id = (SELECT app_usuario_atual()))
);

-- ${c.b5}
ALTER POLICY membros_veem ON notas_fiscais USING (
  tenant_id = ANY (ARRAY(
    SELECT m.tenant_id FROM membros m
     WHERE m.usuario_id = (SELECT app_usuario_atual())
  ))
);
--   Index Cond: (tenant_id = ANY ((InitPlan 2).col1))`;

const leakproofCode = (c) => `-- ${c.c1}
SELECT o.oprname, o.oprcode, p.proleakproof
  FROM pg_operator o
  JOIN pg_proc p ON p.oid = o.oprcode
 WHERE o.oprleft = 'text'::regtype
   AND o.oprright = 'text'::regtype
   AND o.oprname IN ('=', '~', '~~', '~~*')
 ORDER BY o.oprname;
 oprname |   oprcode   | proleakproof
---------+-------------+--------------
 =       | texteq      | t
 ~       | textregexeq | f
 ~~      | textlike    | f
 ~~*     | texticlike  | f

-- ${c.c2}
EXPLAIN SELECT id, cliente, criado_em FROM pedidos
 WHERE cliente ILIKE '%souza%'
 ORDER BY criado_em DESC LIMIT 50;
 Limit
   InitPlan 1
     ->  Result
   ->  Index Scan using pedidos_tenant_criado_idx on pedidos
         Index Cond: (tenant_id = (InitPlan 1).col1)
         Filter: (cliente ~~* '%souza%'::text)
-- ${c.c3}`;

const searchFunctionCode = (c) => `-- ${c.d1}
CREATE FUNCTION buscar_pedidos_por_cliente(termo text, limite integer DEFAULT 50)
RETURNS SETOF pedidos
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.*
    FROM public.pedidos p
   -- ${c.d2}
   WHERE p.tenant_id = (SELECT public.app_tenant_atual())
     -- ${c.d3}
     AND p.cliente ILIKE '%' || replace(replace(replace(termo, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'
   ORDER BY p.criado_em DESC
   LIMIT limite
$$;

-- ${c.d4}
REVOKE ALL ON FUNCTION buscar_pedidos_por_cliente(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION buscar_pedidos_por_cliente(text, integer) TO app_api;

-- SELECT * FROM buscar_pedidos_por_cliente('souza');
--   Bitmap Heap Scan on pedidos p
--     Recheck Cond: (cliente ~~* ...)
--     Filter: (tenant_id = (InitPlan 1).col1)
--     ->  Bitmap Index Scan on pedidos_cliente_trgm_idx`;

const checkPlansCode = (c) => `// verificar-planos-rls.js
// ${c.e1}
import pg from 'pg';

const PAPEL_APLICACAO = 'app_api';
const TENANT_DE_TESTE = '42';

// ${c.e2}
const CONSULTAS = [
  {
    nome: 'listagem de pedidos',
    sql: 'SELECT id, cliente, status, criado_em FROM pedidos ORDER BY criado_em DESC LIMIT 50',
  },
  {
    nome: 'pedidos abertos',
    sql: "SELECT id FROM pedidos WHERE status = 'aberto' ORDER BY criado_em DESC LIMIT 50",
  },
  {
    nome: 'detalhe do pedido',
    sql: 'SELECT * FROM pedidos WHERE id = 123',
  },
];

// ${c.e3}
const TABELAS_GRANDES = new Set(['pedidos', 'itens_pedido', 'notas_fiscais']);

// ${c.e4}
const varreTudo = (no) =>
  TABELAS_GRANDES.has(no['Relation Name']) &&
  (no['Node Type'] === 'Seq Scan' ||
    (['Index Scan', 'Index Only Scan'].includes(no['Node Type']) && !no['Index Cond']));

const coletarVarreduras = (no, achados = []) => {
  if (varreTudo(no)) {
    achados.push(\`\${no['Node Type']} em \${no['Relation Name']} (filtro: \${no.Filter ?? 'nenhum'})\`);
  }
  for (const filho of no.Plans ?? []) coletarVarreduras(filho, achados);
  return achados;
};

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let falhas = 0;
try {
  for (const consulta of CONSULTAS) {
    await client.query('BEGIN');
    try {
      await client.query(\`SET LOCAL ROLE \${PAPEL_APLICACAO}\`);
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [TENANT_DE_TESTE]);
      // ${c.e5}
      await client.query('SET LOCAL enable_seqscan = off');

      const { rows } = await client.query(\`EXPLAIN (FORMAT JSON) \${consulta.sql}\`);
      const achados = coletarVarreduras(rows[0]['QUERY PLAN'][0].Plan);

      if (achados.length > 0) {
        falhas += 1;
        console.error(\`FALHA \${consulta.nome}: \${achados.join('; ')}\`);
      } else {
        console.log(\`ok    \${consulta.nome}\`);
      }
    } finally {
      await client.query('ROLLBACK');
    }
  }
} finally {
  await client.end();
}

process.exit(falhas > 0 ? 1 : 0);`;

const diagramaPt = `Seg 09:00  deploy: o filtro tenant_id sai das consultas e passa para uma política de RLS
Seg 09:20  listagem de pedidos: p95 de 40 ms para 14 s; o pool de conexões esgota em 12 minutos
Seg 09:45  EXPLAIN no psql com o usuário das migrações: Index Scan, 3 ms ("não reproduz")
Seg 10:30  rollback do deploy; o filtro manual volta para as consultas
Ter 15:00  EXPLAIN refeito com SET ROLE app_api: Seq Scan com Filter: tenant_id = app_tenant_atual()
Ter 16:10  função passa para STABLE e a política usa (SELECT app_tenant_atual()): listagem em 38 ms
Qua 11:00  novo deploy; busca por nome de cliente no maior tenant: de 60 ms para 1,8 s
Qua 14:30  causa: ILIKE (texticlike) não é leakproof e o índice trigram deixa de ser candidato
Qui 10:00  busca vai para uma função SECURITY DEFINER e o CI passa a conferir planos como app_api`;

const diagramaEn = `Mon 09:00  deploy: the tenant_id filter leaves the queries and moves into an RLS policy
Mon 09:20  order listing: p95 from 40 ms to 14 s; the connection pool is exhausted in 12 minutes
Mon 09:45  EXPLAIN in psql with the migrations user: Index Scan, 3 ms ("cannot reproduce")
Mon 10:30  deploy rolled back; the manual filter goes back into the queries
Tue 15:00  EXPLAIN redone with SET ROLE app_api: Seq Scan with Filter: tenant_id = app_tenant_atual()
Tue 16:10  function becomes STABLE and the policy uses (SELECT app_tenant_atual()): listing in 38 ms
Wed 11:00  new deploy; customer name search on the largest tenant: from 60 ms to 1.8 s
Wed 14:30  cause: ILIKE (texticlike) is not leakproof and the trigram index is no longer a candidate
Thu 10:00  search moves into a SECURITY DEFINER function and CI starts checking plans as app_api`;

const diagramaEs = `Lun 09:00  deploy: el filtro tenant_id sale de las consultas y pasa a una política de RLS
Lun 09:20  listado de pedidos: p95 de 40 ms a 14 s; el pool de conexiones se agota en 12 minutos
Lun 09:45  EXPLAIN en psql con el usuario de las migraciones: Index Scan, 3 ms ("no se reproduce")
Lun 10:30  rollback del deploy; el filtro manual vuelve a las consultas
Mar 15:00  EXPLAIN repetido con SET ROLE app_api: Seq Scan con Filter: tenant_id = app_tenant_atual()
Mar 16:10  la función pasa a STABLE y la política usa (SELECT app_tenant_atual()): listado en 38 ms
Mié 11:00  nuevo deploy; búsqueda por nombre de cliente en el tenant más grande: de 60 ms a 1,8 s
Mié 14:30  causa: ILIKE (texticlike) no es leakproof y el índice trigram deja de ser candidato
Jue 10:00  la búsqueda pasa a una función SECURITY DEFINER y el CI empieza a revisar planes como app_api`;

const pt = {
  intro:
    'Um SaaS de gestão de pedidos com 1.200 clientes guardava tudo numa tabela pedidos de 18 milhões de linhas, e o isolamento entre clientes dependia de cada consulta lembrar do WHERE tenant_id = $1. Depois de um quase vazamento numa rota nova, o time decidiu tirar essa responsabilidade da aplicação e ativar Row Level Security: uma política por tabela, uma função que lê o tenant da transação e pronto. Vinte minutos depois do deploy, a listagem de pedidos saiu de 40 ms para 14 segundos e o pool de conexões esgotou. O EXPLAIN rodado no psql mostrava um Index Scan de 3 ms, porque quem rodou era o dono da tabela, e o dono não passa pela política. Corrigida a função, um segundo problema apareceu dois dias depois: a busca por nome de cliente parou de usar o índice trigram no maior tenant, mesmo com tudo certo na política. Este artigo explica como o PostgreSQL aplica uma política de RLS ao plano, por que a volatilidade da função e o atributo LEAKPROOF dos operadores decidem se um índice ainda pode ser usado, como medir o plano do jeito que a aplicação o recebe e como corrigir sem abrir mão do isolamento.',
  sections: [
    {
      title: 'A migração para RLS que multiplicou a listagem por 350',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O desenho era o recomendado em quase todo guia: a aplicação abre a transação, grava o tenant do usuário com set_config(\'app.tenant_id\', $1, true) e todas as tabelas com tenant_id ganham a política tenant_id = app_tenant_atual(). As consultas foram simplificadas, sem o filtro manual, já que o banco passava a garanti-lo. Em homologação, com 40 mil pedidos, nada mudou de forma perceptível. Em produção, cada listagem passou a ler a tabela inteira.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'Os dois defeitos têm a mesma raiz: a política não é um WHERE colado na consulta. Ela entra no plano com regras próprias de segurança, e essas regras limitam o que o planejador pode fazer com funções e operadores. Enquanto o filtro estava escrito na consulta, nenhuma dessas regras se aplicava.',
        },
      ],
    },
    {
      title: 'Como a política entra no plano e por que o EXPLAIN do psql mente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando o usuário atual está sujeito a RLS, o PostgreSQL acrescenta a expressão USING de cada política permissiva aplicável (combinadas com OR) como uma qualificação de segurança da tabela. Ela é avaliada antes das condições escritas na consulta, a não ser que a condição da consulta seja segura para rodar antes, ou seja, só use funções marcadas como LEAKPROOF. A ordem existe para impedir que uma função da consulta veja, numa mensagem de erro ou num efeito colateral, o valor de uma linha que a política esconderia.',
        },
        {
          type: 'paragraph',
          value:
            'Três tipos de papel nunca passam por isso: superusuários, papéis com BYPASSRLS e o dono da tabela, a menos que a tabela tenha FORCE ROW LEVEL SECURITY. O usuário das migrações costuma ser o dono, e é com ele que quase todo mundo abre o psql para investigar. Por isso o plano que o plantão via não tinha política nenhuma.',
        },
        {
          type: 'code',
          value: setupCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'A regra prática: todo EXPLAIN que investiga uma tabela com RLS precisa rodar dentro de uma transação com SET LOCAL ROLE para o papel da aplicação e com o tenant configurado do mesmo jeito que a aplicação configura. Sem isso, você está analisando outra consulta.',
        },
      ],
    },
    {
      title: 'A função da política: VOLATILE por padrão e chamada para cada linha',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Funções em plpgsql e em SQL que não declaram volatilidade são VOLATILE. Para o planejador, isso significa que o resultado pode mudar a cada chamada, então tenant_id = app_tenant_atual() não pode virar condição de índice: ele não tem um valor fixo para procurar na árvore. Sobra o Seq Scan, com a função executada como filtro em cada uma das 18 milhões de linhas. Funções VOLATILE também são PARALLEL UNSAFE por padrão, e a varredura nem pode ser dividida entre workers.',
        },
        {
          type: 'paragraph',
          value:
            'A correção tem duas partes. A primeira é declarar a função como STABLE, o que é verdade para quem só lê current_setting dentro da transação. A segunda é chamar a função dentro de um SELECT na política. A subconsulta não correlacionada vira um InitPlan: é executada uma vez, antes da varredura, e o resultado entra como parâmetro na condição de índice. Isso também protege contra funções mais caras, como as que consultam uma tabela de sessões, que de outro modo seriam chamadas por linha.',
        },
        {
          type: 'code',
          value: functionFixCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'O mesmo raciocínio vale para políticas de associação, em que o usuário enxerga os tenants dos quais é membro. Um EXISTS correlacionado com a tabela membros é avaliado como SubPlan para cada linha candidata, porque a subconsulta de uma política não é transformada em junção como seria num WHERE comum. Reescrita como tenant_id = ANY (ARRAY(SELECT ...)), a lista de tenants é calculada uma vez e o índice de tenant_id volta a ser usado.',
        },
      ],
    },
    {
      title: 'Leakproof: por que o ILIKE deixa de usar o índice trigram',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com a função corrigida, a listagem voltou para 38 ms, mas a busca por nome de cliente do maior tenant, com 2,1 milhões de pedidos, foi de 60 ms para 1,8 s. A consulta era a mesma de antes, só sem o filtro de tenant: WHERE cliente ILIKE \'%souza%\'. O índice GIN com gin_trgm_ops continuava lá. O que mudou é que o operador ILIKE é implementado pela função texticlike, que não é LEAKPROOF. Sob RLS, uma condição da consulta que usa função não leakproof não pode ser avaliada antes da política, e o PostgreSQL também não a usa como condição de índice, porque ler o índice já seria avaliá-la antes. O planejador usa o índice da política, lê os 2,1 milhões de pedidos do tenant e aplica o ILIKE como filtro.',
        },
        {
          type: 'code',
          value: leakproofCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'O problema não é exclusivo do ILIKE. Toda função na expressão conta, então lower(email) = $1 perde o índice de expressão em lower(email) mesmo com o = sendo leakproof. A tabela abaixo resume os casos mais comuns; confira na sua versão com a consulta em pg_proc acima, porque a lista de funções leakproof pode mudar entre versões.',
        },
        {
          type: 'table',
          columns: ['Condição na consulta', 'Função', 'Leakproof', 'Vira condição de índice sob RLS'],
          rows: [
            ['tenant_id = 42 (integer)', 'int4eq', 'sim', 'sim'],
            ['id = \'...\' (uuid)', 'uuid_eq', 'sim', 'sim'],
            ['cliente = \'Souza\'', 'texteq', 'sim', 'sim'],
            ['cliente LIKE \'Sou%\'', 'textlike', 'não', 'não'],
            ['cliente ILIKE \'%souza%\'', 'texticlike', 'não', 'não'],
            ['lower(email) = \'a@b.com\'', 'lower', 'não', 'não'],
            ['dados @> \'{"canal":"loja"}\'', 'jsonb_contains', 'não', 'não'],
            ['documento @@ to_tsquery(...)', 'ts_match_vq', 'não', 'não'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Isso explica por que os testes passaram: em tenants pequenos, ler todos os pedidos do tenant e filtrar é rápido. O custo cresce com o tamanho do tenant, e só os maiores clientes, justamente os que mais reclamam, sentem a diferença.',
        },
      ],
    },
    {
      title: 'Como corrigir sem desligar o isolamento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Para busca textual, a saída mais segura é uma função SECURITY DEFINER pertencente ao dono da tabela. Ela roda com os privilégios do dono, que não passa pela política, e escreve o filtro de tenant explicitamente com a mesma função da política. Sem qualificação de segurança, o planejador volta a combinar o índice trigram com o filtro de tenant. O isolamento continua no banco, só que num lugar revisado e com search_path fixo, que impede outro esquema de sequestrar as funções chamadas. A tabela não pode ter FORCE ROW LEVEL SECURITY, senão o dono também passaria pela política e o ganho desaparece.',
        },
        {
          type: 'code',
          value: searchFunctionCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'Para o resto, manter o WHERE tenant_id = $1 nas consultas, além da política, é barato e ajuda. A igualdade em integer é leakproof, então pode ser condição de índice, e o planejador conhece o valor do parâmetro no plano customizado. Com o InitPlan da política, ele não sabe qual tenant será lido e estima a seletividade pela média, o que costuma subestimar os tenants grandes. A política continua lá como rede de segurança para a consulta que esquecer o filtro.',
        },
        {
          type: 'table',
          columns: ['O que aparece no EXPLAIN', 'Causa', 'Correção'],
          rows: [
            ['Seq Scan com Filter: (tenant_id = minha_funcao())', 'Função da política VOLATILE, o padrão sem declaração', 'Declarar STABLE e chamar como (SELECT minha_funcao())'],
            ['SubPlan executado para cada linha', 'EXISTS correlacionado na política de associação', 'tenant_id = ANY (ARRAY(SELECT ...)) avaliado como InitPlan'],
            ['Índice de tenant usado e Filter com ILIKE, LIKE, lower ou @>', 'Função não leakproof na condição da consulta', 'Função SECURITY DEFINER com filtro explícito de tenant'],
            ['Rápido no psql e lento na aplicação', 'Dono, superusuário ou BYPASSRLS ignoram a política', 'EXPLAIN com SET LOCAL ROLE do papel da aplicação'],
            ['Consulta sem nenhuma linha depois de trocar o pool', 'app.tenant_id vazio na conexão reaproveitada', 'set_config(..., true) em cada transação e current_setting(..., true)'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Marcar texticlike ou lower como LEAKPROOF com ALTER FUNCTION resolveria o plano, mas exige superusuário, vale para todas as tabelas com RLS do banco e transfere para você a garantia de que a função nunca revela nada sobre os argumentos, nem em mensagens de erro. Na maioria dos serviços gerenciados, nem é possível.',
        },
      ],
    },
    {
      title: 'Verificar o plano como a aplicação, no CI',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O incidente só aconteceu porque ninguém olhava o plano com o papel da aplicação. O script abaixo roda as consultas críticas dentro de transações com SET LOCAL ROLE app_api, o tenant configurado e enable_seqscan desligado. Com seq scan desligado, ele só continua no plano quando não há índice utilizável, então o teste detecta o defeito estrutural mesmo num banco de CI com poucas linhas. Também falha com Index Scan sem Index Cond, que é o que o planejador escolhe para fugir do Seq Scan quando a condição não pode entrar no índice.',
        },
        {
          type: 'code',
          value: checkPlansCode(comments.pt),
        },
        {
          type: 'ordered',
          items: [
            'Liste as funções usadas em políticas e confira provolatile em pg_proc: toda função de política deve ser STABLE ou IMMUTABLE.',
            'Envolva chamadas de função em (SELECT ...) nas expressões USING e WITH CHECK.',
            'Procure nas consultas das tabelas com RLS por LIKE, ILIKE, ~, lower, @> e @@ e decida, caso a caso, entre filtro explícito, função SECURITY DEFINER ou aceitar o filtro.',
            'Rode o script de planos no CI a cada migração que altere políticas, funções ou índices.',
            'Em homologação, ative FORCE ROW LEVEL SECURITY ou use um usuário que não seja dono para que os testes manuais também passem pela política.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Com RLS, ainda preciso escrever WHERE tenant_id = $1 nas consultas?',
      answer:
        'Não é obrigatório para o isolamento, mas vale a pena. O filtro explícito é leakproof, pode ser condição de índice e dá ao planejador o valor real do tenant, o que melhora a estimativa nos tenants grandes. A política continua sendo a garantia: se uma consulta nova esquecer o filtro, ela ainda não vê dados de outro cliente.',
    },
    {
      question: 'Como usar RLS com PgBouncer em modo transação?',
      answer:
        'Grave o tenant com set_config(\'app.tenant_id\', $1, true) logo depois do BEGIN, em toda transação. O terceiro argumento true limita o valor à transação, então ele some no COMMIT e não vaza para o próximo cliente que receber a mesma conexão. Nunca use SET de sessão nesse modo. Na função da política, use current_setting(\'app.tenant_id\', true), que devolve NULL ou vazio quando o valor não foi definido, para que a falta de configuração resulte em nenhuma linha em vez de erro ou de dados de outro tenant.',
    },
    {
      question: 'Uma política WITH CHECK também deixa as escritas lentas?',
      answer:
        'Ela é avaliada sobre cada linha inserida ou atualizada, não sobre a tabela, então não muda o plano de busca das linhas. O custo aparece quando a expressão chama função cara ou consulta outra tabela por linha, como numa carga em lote de 500 mil registros. As mesmas regras valem: função STABLE e chamada dentro de (SELECT ...), para que o valor seja calculado uma vez por comando.',
    },
  ],
  conclusion: {
    title: 'A política entra no plano com regras próprias',
    description:
      'Row Level Security não é um WHERE automático. A política é uma qualificação de segurança, avaliada antes das condições da consulta que não são leakproof, e uma função VOLATILE nela transforma cada consulta numa varredura completa. Declarar as funções como STABLE, chamá-las como InitPlan, tratar à parte as buscas com ILIKE, lower ou jsonb e conferir os planos com o papel da aplicação no CI mantém o isolamento no banco sem trocar segurança por um pool esgotado.',
    cta: 'Quer revisar políticas de RLS, índices e planos do seu SaaS multi-tenant antes de ativá-las em produção?',
  },
  related: [
    {
      label: 'Vizinho barulhento no SaaS multi-tenant: isolar o cliente que consome o banco de todos sem criar um banco por cliente',
      to: '/blog/vizinho-barulhento-no-saas-multi-tenant-isolar-o-cliente-que-consome-o-banco-de-todos-sem-criar-um-banco-por-cliente',
    },
    {
      label: 'Índice que o banco decidiu ignorar: quando o plano de consulta muda sozinho',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'An order management SaaS with 1,200 customers kept everything in an orders table with 18 million rows, and isolation between customers depended on every query remembering WHERE tenant_id = $1. After a near leak in a new route, the team decided to take that responsibility away from the application and turn on Row Level Security: one policy per table, one function that reads the tenant from the transaction, done. Twenty minutes after the deploy, the order listing went from 40 ms to 14 seconds and the connection pool ran dry. The EXPLAIN run in psql showed a 3 ms Index Scan, because whoever ran it was the table owner, and the owner does not go through the policy. Once the function was fixed, a second problem showed up two days later: customer name search stopped using the trigram index on the largest tenant, even with the policy correct. This article explains how PostgreSQL applies an RLS policy to the plan, why function volatility and the LEAKPROOF attribute of operators decide whether an index can still be used, how to measure the plan the way the application gets it, and how to fix it without giving up isolation.',
  sections: [
    {
      title: 'The RLS migration that made the listing 350 times slower',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The design was the one recommended in almost every guide: the application opens the transaction, stores the user tenant with set_config(\'app.tenant_id\', $1, true), and every table with tenant_id gets the policy tenant_id = app_tenant_atual(). The queries were simplified and lost the manual filter, since the database now guaranteed it. In staging, with 40 thousand orders, nothing changed noticeably. In production, every listing started reading the whole table.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'Both defects share the same root: the policy is not a WHERE glued onto the query. It enters the plan with its own security rules, and those rules limit what the planner can do with functions and operators. While the filter was written in the query, none of those rules applied.',
        },
      ],
    },
    {
      title: 'How the policy enters the plan and why the psql EXPLAIN lies',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When the current user is subject to RLS, PostgreSQL adds the USING expression of every applicable permissive policy (combined with OR) as a security qualification of the table. It is evaluated before the conditions written in the query, unless the query condition is safe to run first, meaning it only uses functions marked LEAKPROOF. The ordering exists to stop a function in the query from seeing, through an error message or a side effect, the value of a row the policy would hide.',
        },
        {
          type: 'paragraph',
          value:
            'Three kinds of roles never go through this: superusers, roles with BYPASSRLS, and the table owner, unless the table has FORCE ROW LEVEL SECURITY. The migrations user is usually the owner, and it is the user almost everyone opens psql with to investigate. That is why the plan the on call engineer saw had no policy at all.',
        },
        {
          type: 'code',
          value: setupCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'The practical rule: every EXPLAIN that investigates a table with RLS must run inside a transaction with SET LOCAL ROLE to the application role and with the tenant set the same way the application sets it. Without that, you are analyzing a different query.',
        },
      ],
    },
    {
      title: 'The policy function: VOLATILE by default and called for every row',
      blocks: [
        {
          type: 'paragraph',
          value:
            'plpgsql and SQL functions that do not declare a volatility are VOLATILE. For the planner, this means the result may change on every call, so tenant_id = app_tenant_atual() cannot become an index condition: there is no fixed value to look up in the tree. What remains is a Seq Scan, with the function executed as a filter on each of the 18 million rows. VOLATILE functions are also PARALLEL UNSAFE by default, so the scan cannot even be split across workers.',
        },
        {
          type: 'paragraph',
          value:
            'The fix has two parts. The first is declaring the function STABLE, which is true for anything that only reads current_setting within the transaction. The second is calling the function inside a SELECT in the policy. An uncorrelated subquery becomes an InitPlan: it is executed once, before the scan, and the result enters the index condition as a parameter. This also protects against more expensive functions, such as those that query a sessions table, which would otherwise be called per row.',
        },
        {
          type: 'code',
          value: functionFixCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'The same reasoning applies to membership policies, where the user sees the tenants they belong to. An EXISTS correlated with the membros table is evaluated as a SubPlan for every candidate row, because the subquery of a policy is not turned into a join the way it would be in a regular WHERE. Rewritten as tenant_id = ANY (ARRAY(SELECT ...)), the list of tenants is computed once and the tenant_id index is used again.',
        },
      ],
    },
    {
      title: 'Leakproof: why ILIKE stops using the trigram index',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the function fixed, the listing went back to 38 ms, but customer name search on the largest tenant, with 2.1 million orders, went from 60 ms to 1.8 s. The query was the same as before, just without the tenant filter: WHERE cliente ILIKE \'%souza%\'. The GIN index with gin_trgm_ops was still there. What changed is that the ILIKE operator is implemented by the texticlike function, which is not LEAKPROOF. Under RLS, a query condition that uses a non leakproof function cannot be evaluated before the policy, and PostgreSQL does not use it as an index condition either, because reading the index would already mean evaluating it first. The planner uses the policy index, reads the 2.1 million orders of the tenant and applies ILIKE as a filter.',
        },
        {
          type: 'code',
          value: leakproofCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'The problem is not exclusive to ILIKE. Every function in the expression counts, so lower(email) = $1 loses the expression index on lower(email) even though = is leakproof. The table below summarizes the most common cases; check your version with the pg_proc query above, because the list of leakproof functions can change between versions.',
        },
        {
          type: 'table',
          columns: ['Condition in the query', 'Function', 'Leakproof', 'Becomes an index condition under RLS'],
          rows: [
            ['tenant_id = 42 (integer)', 'int4eq', 'yes', 'yes'],
            ['id = \'...\' (uuid)', 'uuid_eq', 'yes', 'yes'],
            ['cliente = \'Souza\'', 'texteq', 'yes', 'yes'],
            ['cliente LIKE \'Sou%\'', 'textlike', 'no', 'no'],
            ['cliente ILIKE \'%souza%\'', 'texticlike', 'no', 'no'],
            ['lower(email) = \'a@b.com\'', 'lower', 'no', 'no'],
            ['dados @> \'{"canal":"loja"}\'', 'jsonb_contains', 'no', 'no'],
            ['documento @@ to_tsquery(...)', 'ts_match_vq', 'no', 'no'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'This explains why the tests passed: on small tenants, reading every order of the tenant and filtering is fast. The cost grows with the size of the tenant, and only the largest customers, precisely the ones who complain the most, feel the difference.',
        },
      ],
    },
    {
      title: 'How to fix it without turning isolation off',
      blocks: [
        {
          type: 'paragraph',
          value:
            'For text search, the safest way out is a SECURITY DEFINER function owned by the table owner. It runs with the privileges of the owner, who does not go through the policy, and writes the tenant filter explicitly with the same function the policy uses. Without a security qualification, the planner can again combine the trigram index with the tenant filter. Isolation stays in the database, just in a reviewed place with a fixed search_path, which prevents another schema from hijacking the functions it calls. The table must not have FORCE ROW LEVEL SECURITY, otherwise the owner would also go through the policy and the gain disappears.',
        },
        {
          type: 'code',
          value: searchFunctionCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'For everything else, keeping WHERE tenant_id = $1 in the queries, on top of the policy, is cheap and helps. Integer equality is leakproof, so it can be an index condition, and the planner knows the parameter value in the custom plan. With the policy InitPlan, it does not know which tenant will be read and estimates selectivity from the average, which usually underestimates the large tenants. The policy stays as a safety net for the query that forgets the filter.',
        },
        {
          type: 'table',
          columns: ['What shows up in EXPLAIN', 'Cause', 'Fix'],
          rows: [
            ['Seq Scan with Filter: (tenant_id = my_function())', 'VOLATILE policy function, the default when nothing is declared', 'Declare it STABLE and call it as (SELECT my_function())'],
            ['SubPlan executed for every row', 'Correlated EXISTS in the membership policy', 'tenant_id = ANY (ARRAY(SELECT ...)) evaluated as an InitPlan'],
            ['Tenant index used and a Filter with ILIKE, LIKE, lower or @>', 'Non leakproof function in the query condition', 'SECURITY DEFINER function with an explicit tenant filter'],
            ['Fast in psql and slow in the application', 'Owner, superuser or BYPASSRLS skip the policy', 'EXPLAIN with SET LOCAL ROLE to the application role'],
            ['Query returns no rows after switching the pool', 'Empty app.tenant_id on the reused connection', 'set_config(..., true) in every transaction and current_setting(..., true)'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Marking texticlike or lower as LEAKPROOF with ALTER FUNCTION would fix the plan, but it requires a superuser, applies to every table with RLS in the database and makes you responsible for guaranteeing the function never reveals anything about its arguments, not even in error messages. On most managed services it is not even possible.',
        },
      ],
    },
    {
      title: 'Checking the plan as the application, in CI',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The incident only happened because nobody looked at the plan with the application role. The script below runs the critical queries inside transactions with SET LOCAL ROLE app_api, the tenant set and enable_seqscan turned off. With seq scans turned off, one only stays in the plan when no index can be used, so the test catches the structural defect even on a CI database with few rows. It also fails on an Index Scan without Index Cond, which is what the planner picks to avoid the Seq Scan when the condition cannot enter the index.',
        },
        {
          type: 'code',
          value: checkPlansCode(comments.en),
        },
        {
          type: 'ordered',
          items: [
            'List the functions used in policies and check provolatile in pg_proc: every policy function should be STABLE or IMMUTABLE.',
            'Wrap function calls in (SELECT ...) in USING and WITH CHECK expressions.',
            'Search the queries on tables with RLS for LIKE, ILIKE, ~, lower, @> and @@ and decide, case by case, between an explicit filter, a SECURITY DEFINER function or accepting the filter.',
            'Run the plans script in CI on every migration that changes policies, functions or indexes.',
            'In staging, turn on FORCE ROW LEVEL SECURITY or use a user that is not the owner, so manual tests also go through the policy.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'With RLS, do I still need to write WHERE tenant_id = $1 in the queries?',
      answer:
        'It is not required for isolation, but it is worth it. The explicit filter is leakproof, can be an index condition and gives the planner the real tenant value, which improves estimates on large tenants. The policy remains the guarantee: if a new query forgets the filter, it still cannot see data from another customer.',
    },
    {
      question: 'How do I use RLS with PgBouncer in transaction mode?',
      answer:
        'Store the tenant with set_config(\'app.tenant_id\', $1, true) right after BEGIN, in every transaction. The third argument, true, scopes the value to the transaction, so it disappears at COMMIT and does not leak to the next client that gets the same connection. Never use a session level SET in this mode. In the policy function, use current_setting(\'app.tenant_id\', true), which returns NULL or empty when the value was not set, so a missing setting results in no rows instead of an error or data from another tenant.',
    },
    {
      question: 'Does a WITH CHECK policy also make writes slow?',
      answer:
        'It is evaluated on each inserted or updated row, not on the table, so it does not change how rows are looked up. The cost shows up when the expression calls an expensive function or queries another table per row, as in a batch load of 500 thousand records. The same rules apply: a STABLE function called inside (SELECT ...), so the value is computed once per command.',
    },
  ],
  conclusion: {
    title: 'The policy enters the plan with its own rules',
    description:
      'Row Level Security is not an automatic WHERE. The policy is a security qualification, evaluated before query conditions that are not leakproof, and a VOLATILE function in it turns every query into a full scan. Declaring functions as STABLE, calling them as an InitPlan, handling ILIKE, lower and jsonb searches separately and checking plans with the application role in CI keeps isolation in the database without trading security for an exhausted pool.',
    cta: 'Want to review the RLS policies, indexes and plans of your multi-tenant SaaS before turning them on in production?',
  },
  related: [
    {
      label: 'The noisy neighbor in a multi-tenant SaaS: isolating the customer who eats everyone\'s database without one database per customer',
      to: '/blog/vizinho-barulhento-no-saas-multi-tenant-isolar-o-cliente-que-consome-o-banco-de-todos-sem-criar-um-banco-por-cliente',
    },
    {
      label: 'The index the database decided to ignore: when the query plan changes on its own',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Un SaaS de gestión de pedidos con 1.200 clientes guardaba todo en una tabla pedidos de 18 millones de filas, y el aislamiento entre clientes dependía de que cada consulta recordara el WHERE tenant_id = $1. Después de una casi fuga en una ruta nueva, el equipo decidió quitarle esa responsabilidad a la aplicación y activar Row Level Security: una política por tabla, una función que lee el tenant de la transacción y listo. Veinte minutos después del deploy, el listado de pedidos pasó de 40 ms a 14 segundos y el pool de conexiones se agotó. El EXPLAIN ejecutado en psql mostraba un Index Scan de 3 ms, porque quien lo ejecutó era el dueño de la tabla, y el dueño no pasa por la política. Corregida la función, un segundo problema apareció dos días después: la búsqueda por nombre de cliente dejó de usar el índice trigram en el tenant más grande, aun con la política correcta. Este artículo explica cómo PostgreSQL aplica una política de RLS al plan, por qué la volatilidad de la función y el atributo LEAKPROOF de los operadores deciden si todavía se puede usar un índice, cómo medir el plan tal como lo recibe la aplicación y cómo corregirlo sin renunciar al aislamiento.',
  sections: [
    {
      title: 'La migración a RLS que hizo el listado 350 veces más lento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El diseño era el recomendado en casi todas las guías: la aplicación abre la transacción, guarda el tenant del usuario con set_config(\'app.tenant_id\', $1, true) y todas las tablas con tenant_id reciben la política tenant_id = app_tenant_atual(). Las consultas se simplificaron y perdieron el filtro manual, ya que la base pasaba a garantizarlo. En staging, con 40 mil pedidos, nada cambió de forma perceptible. En producción, cada listado empezó a leer la tabla completa.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'Los dos defectos tienen la misma raíz: la política no es un WHERE pegado a la consulta. Entra en el plan con reglas de seguridad propias, y esas reglas limitan lo que el planificador puede hacer con funciones y operadores. Mientras el filtro estaba escrito en la consulta, ninguna de esas reglas se aplicaba.',
        },
      ],
    },
    {
      title: 'Cómo entra la política en el plan y por qué miente el EXPLAIN de psql',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando el usuario actual está sujeto a RLS, PostgreSQL agrega la expresión USING de cada política permisiva aplicable (combinadas con OR) como una calificación de seguridad de la tabla. Se evalúa antes que las condiciones escritas en la consulta, salvo que la condición de la consulta sea segura para ejecutarse antes, es decir, que solo use funciones marcadas como LEAKPROOF. El orden existe para impedir que una función de la consulta vea, en un mensaje de error o en un efecto secundario, el valor de una fila que la política ocultaría.',
        },
        {
          type: 'paragraph',
          value:
            'Tres tipos de rol nunca pasan por esto: superusuarios, roles con BYPASSRLS y el dueño de la tabla, a menos que la tabla tenga FORCE ROW LEVEL SECURITY. El usuario de las migraciones suele ser el dueño, y es con él que casi todos abren psql para investigar. Por eso el plan que veía la guardia no tenía ninguna política.',
        },
        {
          type: 'code',
          value: setupCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'La regla práctica: todo EXPLAIN que investigue una tabla con RLS debe ejecutarse dentro de una transacción con SET LOCAL ROLE al rol de la aplicación y con el tenant configurado igual que lo configura la aplicación. Sin eso, estás analizando otra consulta.',
        },
      ],
    },
    {
      title: 'La función de la política: VOLATILE por defecto y llamada en cada fila',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Las funciones en plpgsql y en SQL que no declaran volatilidad son VOLATILE. Para el planificador, eso significa que el resultado puede cambiar en cada llamada, así que tenant_id = app_tenant_atual() no puede ser condición de índice: no hay un valor fijo que buscar en el árbol. Queda el Seq Scan, con la función ejecutada como filtro en cada una de las 18 millones de filas. Las funciones VOLATILE también son PARALLEL UNSAFE por defecto, así que el recorrido ni siquiera puede dividirse entre workers.',
        },
        {
          type: 'paragraph',
          value:
            'La corrección tiene dos partes. La primera es declarar la función como STABLE, lo que es cierto para cualquier función que solo lee current_setting dentro de la transacción. La segunda es llamar a la función dentro de un SELECT en la política. Una subconsulta no correlacionada se convierte en InitPlan: se ejecuta una vez, antes del recorrido, y el resultado entra como parámetro en la condición de índice. Esto también protege contra funciones más caras, como las que consultan una tabla de sesiones, que de otro modo se llamarían por fila.',
        },
        {
          type: 'code',
          value: functionFixCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'El mismo razonamiento vale para las políticas de membresía, en las que el usuario ve los tenants de los que es miembro. Un EXISTS correlacionado con la tabla membros se evalúa como SubPlan para cada fila candidata, porque la subconsulta de una política no se transforma en join como ocurriría en un WHERE común. Reescrita como tenant_id = ANY (ARRAY(SELECT ...)), la lista de tenants se calcula una vez y el índice de tenant_id vuelve a usarse.',
        },
      ],
    },
    {
      title: 'Leakproof: por qué el ILIKE deja de usar el índice trigram',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con la función corregida, el listado volvió a 38 ms, pero la búsqueda por nombre de cliente en el tenant más grande, con 2,1 millones de pedidos, pasó de 60 ms a 1,8 s. La consulta era la misma de antes, solo sin el filtro de tenant: WHERE cliente ILIKE \'%souza%\'. El índice GIN con gin_trgm_ops seguía ahí. Lo que cambió es que el operador ILIKE está implementado por la función texticlike, que no es LEAKPROOF. Bajo RLS, una condición de la consulta que usa una función no leakproof no puede evaluarse antes de la política, y PostgreSQL tampoco la usa como condición de índice, porque leer el índice ya sería evaluarla antes. El planificador usa el índice de la política, lee los 2,1 millones de pedidos del tenant y aplica el ILIKE como filtro.',
        },
        {
          type: 'code',
          value: leakproofCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'El problema no es exclusivo del ILIKE. Cuenta cada función de la expresión, así que lower(email) = $1 pierde el índice de expresión sobre lower(email) aunque el = sea leakproof. La tabla de abajo resume los casos más comunes; verifícalo en tu versión con la consulta sobre pg_proc de arriba, porque la lista de funciones leakproof puede cambiar entre versiones.',
        },
        {
          type: 'table',
          columns: ['Condición en la consulta', 'Función', 'Leakproof', 'Es condición de índice bajo RLS'],
          rows: [
            ['tenant_id = 42 (integer)', 'int4eq', 'sí', 'sí'],
            ['id = \'...\' (uuid)', 'uuid_eq', 'sí', 'sí'],
            ['cliente = \'Souza\'', 'texteq', 'sí', 'sí'],
            ['cliente LIKE \'Sou%\'', 'textlike', 'no', 'no'],
            ['cliente ILIKE \'%souza%\'', 'texticlike', 'no', 'no'],
            ['lower(email) = \'a@b.com\'', 'lower', 'no', 'no'],
            ['dados @> \'{"canal":"loja"}\'', 'jsonb_contains', 'no', 'no'],
            ['documento @@ to_tsquery(...)', 'ts_match_vq', 'no', 'no'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Esto explica por qué pasaron las pruebas: en tenants pequeños, leer todos los pedidos del tenant y filtrar es rápido. El costo crece con el tamaño del tenant, y solo los clientes más grandes, justamente los que más se quejan, notan la diferencia.',
        },
      ],
    },
    {
      title: 'Cómo corregirlo sin apagar el aislamiento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Para la búsqueda textual, la salida más segura es una función SECURITY DEFINER que pertenezca al dueño de la tabla. Se ejecuta con los privilegios del dueño, que no pasa por la política, y escribe el filtro de tenant de forma explícita con la misma función de la política. Sin calificación de seguridad, el planificador vuelve a combinar el índice trigram con el filtro de tenant. El aislamiento sigue en la base, solo que en un lugar revisado y con search_path fijo, que impide que otro esquema secuestre las funciones que llama. La tabla no puede tener FORCE ROW LEVEL SECURITY, porque entonces el dueño también pasaría por la política y la ganancia desaparece.',
        },
        {
          type: 'code',
          value: searchFunctionCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'Para el resto, mantener el WHERE tenant_id = $1 en las consultas, además de la política, es barato y ayuda. La igualdad en integer es leakproof, así que puede ser condición de índice, y el planificador conoce el valor del parámetro en el plan personalizado. Con el InitPlan de la política, no sabe qué tenant se leerá y estima la selectividad por el promedio, lo que suele subestimar a los tenants grandes. La política sigue ahí como red de seguridad para la consulta que olvide el filtro.',
        },
        {
          type: 'table',
          columns: ['Lo que aparece en el EXPLAIN', 'Causa', 'Corrección'],
          rows: [
            ['Seq Scan con Filter: (tenant_id = mi_funcion())', 'Función de la política VOLATILE, el valor por defecto sin declaración', 'Declararla STABLE y llamarla como (SELECT mi_funcion())'],
            ['SubPlan ejecutado para cada fila', 'EXISTS correlacionado en la política de membresía', 'tenant_id = ANY (ARRAY(SELECT ...)) evaluado como InitPlan'],
            ['Índice de tenant usado y Filter con ILIKE, LIKE, lower o @>', 'Función no leakproof en la condición de la consulta', 'Función SECURITY DEFINER con filtro explícito de tenant'],
            ['Rápido en psql y lento en la aplicación', 'Dueño, superusuario o BYPASSRLS ignoran la política', 'EXPLAIN con SET LOCAL ROLE del rol de la aplicación'],
            ['Consulta sin ninguna fila después de cambiar el pool', 'app.tenant_id vacío en la conexión reutilizada', 'set_config(..., true) en cada transacción y current_setting(..., true)'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Marcar texticlike o lower como LEAKPROOF con ALTER FUNCTION resolvería el plan, pero exige superusuario, vale para todas las tablas con RLS de la base y te traslada la garantía de que la función nunca revela nada sobre sus argumentos, ni siquiera en mensajes de error. En la mayoría de los servicios gestionados ni siquiera es posible.',
        },
      ],
    },
    {
      title: 'Verificar el plan como la aplicación, en el CI',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El incidente solo ocurrió porque nadie miraba el plan con el rol de la aplicación. El script de abajo ejecuta las consultas críticas dentro de transacciones con SET LOCAL ROLE app_api, el tenant configurado y enable_seqscan desactivado. Con el seq scan desactivado, solo sigue en el plan cuando no hay índice utilizable, así que la prueba detecta el defecto estructural incluso en una base de CI con pocas filas. También falla con un Index Scan sin Index Cond, que es lo que elige el planificador para escapar del Seq Scan cuando la condición no puede entrar en el índice.',
        },
        {
          type: 'code',
          value: checkPlansCode(comments.es),
        },
        {
          type: 'ordered',
          items: [
            'Lista las funciones usadas en políticas y revisa provolatile en pg_proc: toda función de política debe ser STABLE o IMMUTABLE.',
            'Envuelve las llamadas a funciones en (SELECT ...) en las expresiones USING y WITH CHECK.',
            'Busca en las consultas de las tablas con RLS LIKE, ILIKE, ~, lower, @> y @@ y decide, caso por caso, entre filtro explícito, función SECURITY DEFINER o aceptar el filtro.',
            'Ejecuta el script de planes en el CI en cada migración que cambie políticas, funciones o índices.',
            'En staging, activa FORCE ROW LEVEL SECURITY o usa un usuario que no sea el dueño, para que las pruebas manuales también pasen por la política.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Con RLS, ¿todavía necesito escribir WHERE tenant_id = $1 en las consultas?',
      answer:
        'No es obligatorio para el aislamiento, pero vale la pena. El filtro explícito es leakproof, puede ser condición de índice y le da al planificador el valor real del tenant, lo que mejora la estimación en los tenants grandes. La política sigue siendo la garantía: si una consulta nueva olvida el filtro, igual no ve datos de otro cliente.',
    },
    {
      question: '¿Cómo usar RLS con PgBouncer en modo transacción?',
      answer:
        'Guarda el tenant con set_config(\'app.tenant_id\', $1, true) justo después del BEGIN, en cada transacción. El tercer argumento, true, limita el valor a la transacción, así que desaparece en el COMMIT y no se filtra al próximo cliente que reciba la misma conexión. Nunca uses un SET de sesión en este modo. En la función de la política, usa current_setting(\'app.tenant_id\', true), que devuelve NULL o vacío cuando el valor no fue definido, para que la falta de configuración resulte en ninguna fila en lugar de un error o de datos de otro tenant.',
    },
    {
      question: '¿Una política WITH CHECK también vuelve lentas las escrituras?',
      answer:
        'Se evalúa sobre cada fila insertada o actualizada, no sobre la tabla, así que no cambia cómo se buscan las filas. El costo aparece cuando la expresión llama a una función cara o consulta otra tabla por fila, como en una carga por lotes de 500 mil registros. Valen las mismas reglas: función STABLE y llamada dentro de (SELECT ...), para que el valor se calcule una vez por comando.',
    },
  ],
  conclusion: {
    title: 'La política entra en el plan con reglas propias',
    description:
      'Row Level Security no es un WHERE automático. La política es una calificación de seguridad, evaluada antes que las condiciones de la consulta que no son leakproof, y una función VOLATILE en ella convierte cada consulta en un recorrido completo. Declarar las funciones como STABLE, llamarlas como InitPlan, tratar aparte las búsquedas con ILIKE, lower o jsonb y revisar los planes con el rol de la aplicación en el CI mantiene el aislamiento en la base sin cambiar seguridad por un pool agotado.',
    cta: '¿Quieres revisar las políticas de RLS, los índices y los planes de tu SaaS multi-tenant antes de activarlas en producción?',
  },
  related: [
    {
      label: 'El vecino ruidoso en un SaaS multi-tenant: aislar al cliente que consume la base de datos de todos sin una base por cliente',
      to: '/blog/vizinho-barulhento-no-saas-multi-tenant-isolar-o-cliente-que-consome-o-banco-de-todos-sem-criar-um-banco-por-cliente',
    },
    {
      label: 'El índice que la base decidió ignorar: cuándo el plan de consulta cambia solo',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
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
