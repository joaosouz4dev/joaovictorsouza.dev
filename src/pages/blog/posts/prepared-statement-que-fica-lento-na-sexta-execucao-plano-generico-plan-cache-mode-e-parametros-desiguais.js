// Conteudo do artigo: prepared statement que fica lento na sexta execucao. Como o Postgres
// decide entre plano custom e plano generico depois de cinco execucoes, por que o plano generico
// erra quando os parametros sao desiguais (tenant grande, intervalo de datas), como reproduzir e
// confirmar no psql e como corrigir na aplicacao Node com plan_cache_mode no lugar certo.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const comments = {
  pt: {
    r1: 'A consulta do relatório, preparada exatamente como a API faz.',
    r2: 'Cinco execuções: cada uma recebe um plano custom, montado com os valores reais.',
    r3: 'o tenant 7 tem 30% dos pedidos e entra na média de custo',
    r4: 'Sexta execução: o plano genérico é montado, comparado com a média e passa a valer.',
    r5: 'Repare no $1: o plano não sabe qual tenant nem qual intervalo está consultando.',
    r6: 'A mesma execução com plano custom: o Postgres enxerga tenant_id = 7.',
    r7: 'Quantas vezes cada statement desta sessão usou cada tipo de plano (PostgreSQL 14+).',
    r8: 'PostgreSQL 16+: mostra o plano genérico sem precisar preparar nem executar.',
    a1: 'Antes: statement nomeado, preparado uma vez por conexão e reaproveitado.',
    a2: 'Depois de cinco execuções na mesma conexão, o plano genérico pode assumir.',
    a3: 'Correção: mantém o prepare, mas força plano custom só nesta transação.',
    a4: 'SET LOCAL morre no COMMIT: não vaza para a próxima requisição que pegar esta conexão.',
    a5: 'Diagnóstico: precisa rodar na mesma conexão, porque prepared statements são por sessão.',
  },
  en: {
    r1: 'The report query, prepared exactly the way the API does it.',
    r2: 'Five executions: each one gets a custom plan, built with the real values.',
    r3: 'tenant 7 owns 30% of the orders and enters the cost average',
    r4: 'Sixth execution: the generic plan is built, compared with the average and takes over.',
    r5: 'Notice the $1: the plan does not know which tenant or which range it is reading.',
    r6: 'The same execution with a custom plan: Postgres sees tenant_id = 7.',
    r7: 'How many times each statement in this session used each plan type (PostgreSQL 14+).',
    r8: 'PostgreSQL 16+: shows the generic plan without preparing or executing anything.',
    a1: 'Before: named statement, prepared once per connection and reused.',
    a2: 'After five executions on the same connection, the generic plan may take over.',
    a3: 'Fix: keep the prepare, but force a custom plan only inside this transaction.',
    a4: 'SET LOCAL ends at COMMIT: it does not leak into the next request that gets this connection.',
    a5: 'Diagnosis: must run on the same connection, because prepared statements are per session.',
  },
  es: {
    r1: 'La consulta del reporte, preparada exactamente como lo hace la API.',
    r2: 'Cinco ejecuciones: cada una recibe un plan custom, armado con los valores reales.',
    r3: 'el tenant 7 tiene el 30% de los pedidos y entra en el promedio de costo',
    r4: 'Sexta ejecución: se arma el plan genérico, se compara con el promedio y pasa a valer.',
    r5: 'Fíjese en el $1: el plan no sabe qué tenant ni qué intervalo está consultando.',
    r6: 'La misma ejecución con plan custom: Postgres ve tenant_id = 7.',
    r7: 'Cuántas veces cada statement de esta sesión usó cada tipo de plan (PostgreSQL 14+).',
    r8: 'PostgreSQL 16+: muestra el plan genérico sin preparar ni ejecutar nada.',
    a1: 'Antes: statement con nombre, preparado una vez por conexión y reutilizado.',
    a2: 'Después de cinco ejecuciones en la misma conexión, el plan genérico puede asumir.',
    a3: 'Corrección: mantiene el prepare, pero fuerza plan custom solo en esta transacción.',
    a4: 'SET LOCAL termina en el COMMIT: no se filtra a la próxima request que use esta conexión.',
    a5: 'Diagnóstico: debe ejecutarse en la misma conexión, porque los prepared statements son por sesión.',
  },
};

const psqlCode = (c) => `-- ${c.r1}
PREPARE relatorio_diario(bigint, timestamptz, timestamptz) AS
SELECT date_trunc('day', p.criado_em)        AS dia,
       count(DISTINCT p.id)                  AS pedidos,
       sum(i.quantidade * i.preco_centavos)  AS receita_centavos
  FROM pedidos p
  JOIN itens_pedido i ON i.pedido_id = p.id
 WHERE p.tenant_id = $1
   AND p.criado_em >= $2
   AND p.criado_em <  $3
 GROUP BY 1
 ORDER BY 1;

-- ${c.r2}
EXECUTE relatorio_diario(12,  '2026-10-01', '2026-11-01');
EXECUTE relatorio_diario(88,  '2026-10-01', '2026-11-01');
EXECUTE relatorio_diario(7,   '2026-10-01', '2026-11-01');  -- ${c.r3}
EXECUTE relatorio_diario(301, '2026-10-01', '2026-11-01');
EXECUTE relatorio_diario(45,  '2026-10-01', '2026-11-01');

-- ${c.r4}
-- ${c.r5}
EXPLAIN (ANALYZE, BUFFERS)
EXECUTE relatorio_diario(7, '2026-10-01', '2026-11-01');

GroupAggregate  (cost=1262.40..1270.15 rows=200) (actual time=51874.120..52031.556 rows=31 loops=1)
  ->  Sort  (cost=1262.40..1263.34 rows=375) (actual time=51870.004..51998.231 rows=2741893 loops=1)
        Sort Key: (date_trunc('day'::text, p.criado_em))
        Sort Method: external merge  Disk: 96432kB
        ->  Nested Loop  (cost=1.13..1246.37 rows=375) (actual time=0.061..49702.818 rows=2741893 loops=1)
              Buffers: shared hit=2944120 read=1206345
              ->  Index Scan using pedidos_tenant_criado_idx on pedidos p
                    (cost=0.56..142.10 rows=125) (actual time=0.031..2210.405 rows=905117 loops=1)
                    Index Cond: ((tenant_id = $1) AND (criado_em >= $2) AND (criado_em < $3))
              ->  Index Scan using itens_pedido_pedido_idx on itens_pedido i
                    (cost=0.57..8.80 rows=3) (actual time=0.018..0.051 rows=3 loops=905117)
                    Index Cond: (pedido_id = p.id)
Execution Time: 52088.307 ms

-- ${c.r6}
SET plan_cache_mode = force_custom_plan;
EXPLAIN (ANALYZE, BUFFERS)
EXECUTE relatorio_diario(7, '2026-10-01', '2026-11-01');

Sort  (actual time=3412.880..3412.884 rows=31 loops=1)
  ->  HashAggregate  (actual time=3412.102..3412.611 rows=31 loops=1)
        ->  Hash Join  (rows=2703900) (actual time=688.214..2902.731 rows=2741893 loops=1)
              Hash Cond: (i.pedido_id = p.id)
              ...
              ->  Hash  (rows=901300) (actual time=681.540..681.541 rows=905117 loops=1)
                    ->  Bitmap Heap Scan on pedidos p  (rows=901300) ...
                          Recheck Cond: ((tenant_id = 7) AND (criado_em >= '2026-10-01 ...
Execution Time: 3415.204 ms
RESET plan_cache_mode;

-- ${c.r7}
SELECT name, generic_plans, custom_plans
  FROM pg_prepared_statements;
-- relatorio_diario | 1 | 6

-- ${c.r8}
EXPLAIN (GENERIC_PLAN)
SELECT count(*) FROM pedidos WHERE tenant_id = $1 AND criado_em >= $2 AND criado_em < $3;`;

const appCode = (c) => `// relatorio-repositorio.js
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  statement_timeout: 30_000,
});

const SQL_RELATORIO = \`
  SELECT date_trunc('day', p.criado_em)        AS dia,
         count(DISTINCT p.id)                  AS pedidos,
         sum(i.quantidade * i.preco_centavos)  AS receita_centavos
    FROM pedidos p
    JOIN itens_pedido i ON i.pedido_id = p.id
   WHERE p.tenant_id = $1
     AND p.criado_em >= $2
     AND p.criado_em <  $3
   GROUP BY 1
   ORDER BY 1\`;

// ${c.a1}
// ${c.a2}
export async function relatorioAntes(tenantId, inicio, fim) {
  const { rows } = await pool.query({
    name: 'relatorio-diario',
    text: SQL_RELATORIO,
    values: [tenantId, inicio, fim],
  });
  return rows;
}

// ${c.a3}
export async function relatorioDiario(tenantId, inicio, fim) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    // ${c.a4}
    await client.query("SET LOCAL plan_cache_mode = 'force_custom_plan'");
    const { rows } = await client.query({
      name: 'relatorio-diario',
      text: SQL_RELATORIO,
      values: [tenantId, inicio, fim],
    });
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ${c.a5}
export async function planosPreparados(client) {
  const { rows } = await client.query(
    'SELECT name, generic_plans, custom_plans FROM pg_prepared_statements ORDER BY name',
  );
  return rows;
}`;

const diagramaPt = `D0 10:00  deploy: as consultas do relatório passam a usar statement nomeado (name no node-postgres)
          objetivo: economizar parse e planejamento nas rotas mais chamadas
D0 10:00  pool com 20 conexões; tempos iguais aos de antes por 40 minutos
D0 10:41  primeiro timeout de 30 s no relatório do tenant 7 (marketplace, 30% dos pedidos)
D0 11:30  timeouts intermitentes: a mesma requisição passa ou falha dependendo da conexão
D0 14:00  restart do serviço "resolve"; às 14:50 os timeouts voltam
D1 09:00  EXPLAIN da consulta no psql: 3,4 s com o tenant 7, sem nada estranho
D1 10:20  pg_prepared_statements na conexão da aplicação: generic_plans 412, custom_plans 5
D1 11:00  SET LOCAL plan_cache_mode = force_custom_plan no relatório: p95 de volta a 3,6 s`;

const diagramaEn = `D0 10:00  deploy: report queries start using a named statement (name in node-postgres)
          goal: save parsing and planning on the most called routes
D0 10:00  pool with 20 connections; same timings as before for 40 minutes
D0 10:41  first 30 s timeout on the tenant 7 report (marketplace, 30% of the orders)
D0 11:30  intermittent timeouts: the same request passes or fails depending on the connection
D0 14:00  service restart "fixes it"; at 14:50 the timeouts are back
D1 09:00  EXPLAIN of the query in psql: 3.4 s with tenant 7, nothing unusual
D1 10:20  pg_prepared_statements on the application connection: generic_plans 412, custom_plans 5
D1 11:00  SET LOCAL plan_cache_mode = force_custom_plan on the report: p95 back to 3.6 s`;

const diagramaEs = `D0 10:00  deploy: las consultas del reporte pasan a usar statement con nombre (name en node-postgres)
          objetivo: ahorrar parse y planificación en las rutas más llamadas
D0 10:00  pool con 20 conexiones; tiempos iguales a los de antes durante 40 minutos
D0 10:41  primer timeout de 30 s en el reporte del tenant 7 (marketplace, 30% de los pedidos)
D0 11:30  timeouts intermitentes: la misma request pasa o falla según la conexión
D0 14:00  el restart del servicio "lo resuelve"; a las 14:50 los timeouts vuelven
D1 09:00  EXPLAIN de la consulta en psql: 3,4 s con el tenant 7, nada raro
D1 10:20  pg_prepared_statements en la conexión de la aplicación: generic_plans 412, custom_plans 5
D1 11:00  SET LOCAL plan_cache_mode = force_custom_plan en el reporte: p95 de vuelta a 3,6 s`;

const pt = {
  intro:
    'Uma plataforma de pedidos multi-tenant colocou name nas consultas mais chamadas da API para reaproveitar o planejamento, uma otimização comum e quase sempre inofensiva. Quarenta minutos depois do deploy, o relatório diário do maior cliente, um marketplace com 30% dos pedidos da base, começou a estourar o statement_timeout de 30 segundos. O erro era intermitente: a mesma requisição passava ou falhava dependendo da conexão do pool que a atendia, um restart resolvia por uma hora e, no psql, a mesma consulta levava 3,4 s. O que mudou não foi a consulta nem as estatísticas: depois de cinco execuções na mesma conexão, o Postgres passou a usar um plano genérico, montado sem conhecer o tenant nem o intervalo de datas, e esse plano escolhe um nested loop pensado para 125 pedidos quando o marketplace tem 905 mil no mês. Este artigo mostra como o Postgres decide entre plano custom e plano genérico, por que essa decisão erra com parâmetros desiguais, como confirmar o problema e como corrigi-lo sem abrir mão de prepared statements onde eles ajudam.',
  sections: [
    {
      title: 'O relatório que falhava só para um cliente e só em algumas conexões',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O incidente parecia falta de recurso: timeouts esparsos, CPU do banco alta em alguns momentos, nenhuma consulta nova no pg_stat_statements. Mas três detalhes não fechavam com essa hipótese. Só o tenant 7 era afetado, os primeiros 40 minutos depois do deploy foram normais e o restart da aplicação, que não muda nada no banco, resolvia temporariamente.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'Os três detalhes apontam para estado guardado na conexão. Prepared statements vivem na sessão do Postgres: cada conexão do pool prepara o seu, conta as próprias execuções e decide sozinha quando trocar de plano. O restart fecha as conexões, zera essa contagem e devolve o comportamento antigo até que cada conexão acumule execuções de novo. No psql, uma sessão nova executando a consulta uma vez sempre recebe um plano custom, por isso o problema não aparecia ali.',
        },
      ],
    },
    {
      title: 'Como o Postgres escolhe entre plano custom e plano genérico',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando um statement preparado tem parâmetros, o Postgres pode planejar de dois jeitos. O plano custom é montado a cada execução com os valores reais de $1, $2 e $3, como se fossem literais: o planejador consulta as estatísticas do tenant 7 e do intervalo pedido. O plano genérico é montado uma vez, sem valores, e reaproveitado em todas as execuções seguintes. Ele economiza o planejamento, mas precisa estimar a seletividade sem saber o que vai receber.',
        },
        {
          type: 'ordered',
          items: [
            'As cinco primeiras execuções de cada statement na sessão sempre usam plano custom, e o Postgres guarda o custo estimado de cada uma, somado a um pequeno custo estimado de planejamento.',
            'Na sexta execução, ele monta o plano genérico e calcula o custo estimado dele.',
            'Se o custo do genérico for menor que a média de custo dos planos custom, o genérico passa a ser usado. Se não for, continua custom e a comparação se repete a cada execução, com a média atualizada.',
            'Uma vez que o genérico vence, nenhum plano custom novo é montado, a média para de mudar e a decisão fica estável até a sessão acabar ou o plano ser invalidado.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A comparação é entre custos estimados, não entre tempos medidos. É aqui que o problema nasce: o custo do plano genérico é estimado com a seletividade média, e a média esconde o tenant que não se parece com os outros. Com o tenant 7 entre as cinco primeiras execuções, a média dos planos custom ficou em torno de 253 mil unidades de custo, puxada pelo plano dele, e o genérico, estimado em 1.270, pareceu 200 vezes mais barato.',
        },
        {
          type: 'table',
          columns: ['Execução na conexão', 'Tenant', 'Plano usado', 'Custo estimado'],
          rows: [
            ['1', '12', 'Custom', '1.180'],
            ['2', '88', 'Custom', '940'],
            ['3', '7', 'Custom', '1.264.000'],
            ['4', '301', 'Custom', '1.020'],
            ['5', '45', 'Custom', '870'],
            ['6 em diante', 'Qualquer um', 'Genérico (1.270 contra média de 253.602)', '1.270'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Isso também explica a intermitência. Numa conexão que só atendeu tenants pequenos nas primeiras execuções, os planos custom custavam perto de 1.000 e o genérico, a 1.270, perdia: a conexão continuava custom. Bastava o tenant 7 passar por ela uma vez para a média subir, e na execução seguinte o genérico vencia. Cada conexão do pool virava genérica num momento diferente, conforme a ordem das requisições que recebeu.',
        },
      ],
    },
    {
      title: 'Por que o plano genérico erra com parâmetros desiguais',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Sem o valor de $1, a estimativa para tenant_id = $1 é o número de linhas dividido pelo n_distinct da coluna: 30 milhões de pedidos em 1.200 tenants dão 25 mil linhas, como se todos os clientes fossem do mesmo tamanho. Para o intervalo criado_em >= $2 AND criado_em < $3, sem os limites, o planejador usa uma seletividade fixa de 0,5% para o par de desigualdades. O resultado é 125 pedidos estimados, e para 125 pedidos um nested loop com busca por índice em itens_pedido é de fato o melhor plano.',
        },
        {
          type: 'table',
          columns: ['Tenant e intervalo', 'Linhas estimadas no genérico', 'Linhas reais', 'Melhor plano'],
          rows: [
            ['Tenant 45, outubro', '125', '310', 'Nested loop por índice, 9 ms'],
            ['Tenant 12, outubro', '125', '2.140', 'Nested loop por índice, 21 ms'],
            ['Tenant 7, outubro', '125', '905.117', 'Hash join, 3,4 s'],
            ['Tenant 7, ano inteiro', '125', '10,8 milhões', 'Hash join paralelo, 31 s'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Para o tenant 7, o mesmo plano faz 905 mil buscas por índice em itens_pedido, 1,2 milhão de páginas lidas do disco e uma ordenação de 2,7 milhões de linhas que estoura o work_mem porque foi dimensionada para 375. São 52 segundos contra 3,4 s do plano custom. O erro não é de estatística desatualizada: um ANALYZE não muda nada, porque o plano genérico não usa o valor do parâmetro para consultar as estatísticas que já estão certas.',
        },
        {
          type: 'list',
          items: [
            'Coluna com distribuição muito desigual (tenant, status, tipo de evento) é a causa mais comum: a média por valor não representa nenhum valor real.',
            'Intervalos de datas são a segunda: um dia e um ano recebem a mesma estimativa de 0,5% no plano genérico.',
            'LIKE com parâmetro, IN com lista de tamanho variável e parâmetros opcionais do tipo ($1 IS NULL OR coluna = $1) têm o mesmo problema.',
            'Funções PL/pgSQL também guardam planos das consultas internas e seguem a mesma regra das cinco execuções, por sessão.',
          ],
        },
      ],
    },
    {
      title: 'Reproduzir e confirmar no psql',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Rodar a consulta uma vez com literais nunca reproduz o problema. Para ver o que a aplicação vê, é preciso preparar o statement, executá-lo cinco vezes na mesma sessão e só então pedir o plano. O sinal mais claro está nas condições do plano: o plano genérico mostra $1, $2 e $3 no Index Cond, enquanto o plano custom mostra os valores.',
        },
        {
          type: 'code',
          value: psqlCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'Em produção, o auto_explain com log_min_duration ajustado para alguns segundos registra os planos lentos com os $1 visíveis, o que já basta para apontar o plano genérico. A view pg_prepared_statements, a partir do PostgreSQL 14, mostra as colunas generic_plans e custom_plans, mas só enxerga os statements da própria sessão: precisa ser consultada pela mesma conexão da aplicação, não por um psql aberto ao lado. No PostgreSQL 16, EXPLAIN (GENERIC_PLAN) mostra o plano genérico de uma consulta com $1 sem precisar prepará-la.',
        },
      ],
    },
    {
      title: 'Onde a aplicação prepara statements sem você perceber',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Neste caso o prepare foi explícito, mas muitas vezes ele vem do driver ou do ORM. O comportamento depende da biblioteca, e vale conferir antes de concluir que a aplicação não usa prepared statements.',
        },
        {
          type: 'table',
          columns: ['Biblioteca', 'Comportamento padrão', 'Risco de plano genérico'],
          rows: [
            ['node-postgres (pg) sem name', 'Statement sem nome, refeito a cada consulta', 'Nenhum: todo plano é custom'],
            ['node-postgres (pg) com name', 'Prepara uma vez por conexão e reaproveita', 'Sim, a partir da sexta execução na conexão'],
            ['postgres.js', 'prepare: true por padrão em consultas estáticas', 'Sim; prepare: false desliga'],
            ['Prisma (engine padrão)', 'Cache de prepared statements por conexão (statement_cache_size)', 'Sim; statement_cache_size=0 desliga'],
            ['PgBouncer 1.21+ em modo transação', 'max_prepared_statements compartilha statements entre clientes', 'Sim, e a contagem soma requisições de clientes diferentes'],
            ['PgJDBC', 'prepareThreshold=5: prepara no servidor depois de 5 usos', 'Sim, mais cinco execuções custom depois disso'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O caso do PgBouncer merece atenção: com max_prepared_statements, o statement preparado fica na conexão do servidor e é compartilhado por todos os clientes que passam por ela. A sexta execução chega bem mais rápido, e uma única requisição do tenant grande no começo do dia decide o plano de muitas outras.',
        },
      ],
    },
    {
      title: 'Corrigir com plan_cache_mode no lugar certo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O parâmetro plan_cache_mode, disponível desde o PostgreSQL 12, controla essa decisão: auto é o padrão descrito acima, force_custom_plan monta plano custom em toda execução e force_generic_plan usa o genérico desde a primeira. Ele é avaliado a cada execução, não no prepare, então um SET LOCAL dentro da transação vale até para um statement que já estava preso no plano genérico.',
        },
        {
          type: 'code',
          value: appCode(comments.pt),
        },
        {
          type: 'table',
          columns: ['Opção', 'Alcance', 'Custo', 'Quando usar'],
          rows: [
            ['Tirar o name da consulta', 'Uma consulta', 'Parse e planejamento a cada execução', 'Consulta com parâmetros desiguais e sem ganho real do prepare'],
            ['SET LOCAL plan_cache_mode = force_custom_plan', 'Uma transação', 'Planejamento a cada execução, só ali', 'Manter o prepare no serviço e proteger a consulta sensível'],
            ['ALTER ROLE relatorios SET plan_cache_mode = force_custom_plan', 'Todas as sessões do papel', 'Planejamento em todas as consultas do papel', 'Serviço de relatórios com usuário próprio no banco'],
            ['ALTER FUNCTION ... SET plan_cache_mode = force_custom_plan', 'Uma função', 'Planejamento a cada chamada', 'Consulta sensível dentro de PL/pgSQL'],
            ['Prepare só para tenants pequenos', 'Por rota', 'Lógica na aplicação', 'Consulta OLTP muito quente em que o planejamento pesa'],
          ],
        },
        {
          type: 'list',
          items: [
            'Use SET LOCAL, nunca SET de sessão, quando a conexão volta para um pool: o SET de sessão vaza para a próxima requisição e, atrás de um PgBouncer em modo transação, para outro cliente.',
            'Não force plano genérico para economizar planejamento sem medir. Com pg_stat_statements.track_planning ligado, compare total_plan_time com total_exec_time: num relatório de segundos, 0,4 ms de planejamento é irrelevante.',
            'Separar statements por nome não ajuda sozinho: o plano genérico de qualquer nome é estimado com a mesma média. O que resolve é a rota do tenant grande não usar plano genérico.',
            'Para detectar a volta do problema, acompanhe no pg_stat_statements a distância entre mean_exec_time e max_exec_time da consulta e mantenha o auto_explain registrando planos acima de alguns segundos.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'No incidente, a correção foi o SET LOCAL na transação do relatório. As consultas curtas da API, em que o prepare economiza planejamento de verdade e os parâmetros são uniformes, continuaram com name e plano genérico. O relatório do tenant 7 voltou a 3,6 s de p95, e o dos tenants pequenos ganhou menos de 1 ms de planejamento por chamada.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que exatamente na sexta execução?',
      answer:
        'Porque o Postgres usa as cinco primeiras execuções de cada statement preparado para formar uma média de custo dos planos custom. O número é fixo no código do planejador e não é configurável. Na sexta, ele monta o plano genérico, compara o custo estimado com essa média e decide. Se o genérico perder, a comparação continua nas execuções seguintes, então a troca pode acontecer muito depois da sexta, assim que um parâmetro caro elevar a média.',
    },
    {
      question: 'Devo colocar force_custom_plan no banco inteiro?',
      answer:
        'Normalmente não. Consultas curtas e uniformes, como busca por chave primária, ganham com o plano genérico porque deixam de pagar planejamento a cada chamada, e em tabelas com muitas partições ou joins grandes o planejamento pode custar mais que a execução. O mais seguro é aplicar force_custom_plan onde a distribuição dos parâmetros é desigual: numa transação, numa função ou no papel de um serviço específico.',
    },
    {
      question: 'Um ANALYZE ou mais estatísticas resolvem o plano genérico ruim?',
      answer:
        'Não diretamente. O plano genérico ignora o valor do parâmetro, então histogramas mais detalhados, SET STATISTICS maior e estatísticas estendidas não mudam a estimativa de tenant_id = $1, que continua sendo a média por valor distinto. O ANALYZE invalida os planos em cache e pode dar a sensação de que resolveu, mas depois de cinco execuções a mesma decisão volta a acontecer.',
    },
  ],
  conclusion: {
    title: 'O plano que serve para a média não serve para o maior cliente',
    description:
      'Prepared statements economizam planejamento, mas o plano genérico que eles acabam usando é estimado para um parâmetro médio que não existe. Em bases multi-tenant, com clientes de tamanhos muito diferentes, ou em consultas por intervalo de datas, essa média erra por ordens de grandeza, e o erro aparece de forma intermitente, por conexão, depois de algumas execuções. Saber que a decisão acontece na sexta execução, conferir pg_prepared_statements na conexão certa e aplicar plan_cache_mode só onde os parâmetros são desiguais resolve sem abrir mão do ganho do prepare no resto da aplicação. Se o seu sistema tem consultas que ficam lentas só para alguns clientes ou só depois de um tempo no ar, eu posso revisar os planos, o uso de prepared statements e a configuração do pool.',
    cta: 'Revisar as consultas lentas',
  },
  related: [
    {
      label: 'Índice que o banco decidiu ignorar: quando o plano de consulta muda sozinho',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Estatísticas desatualizadas depois da carga em massa: ANALYZE, default_statistics_target e a estimativa que erra por mil vezes',
      to: '/blog/estatisticas-desatualizadas-depois-da-carga-em-massa-analyze-default-statistics-target-e-a-estimativa-que-erra-por-mil-vezes',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A multi-tenant ordering platform added name to the most called API queries to reuse planning, a common and almost always harmless optimization. Forty minutes after the deploy, the daily report of the largest customer, a marketplace holding 30% of the orders in the database, started hitting the 30 second statement_timeout. The error was intermittent: the same request passed or failed depending on which pool connection served it, a restart fixed it for an hour and, in psql, the same query took 3.4 s. Neither the query nor the statistics had changed: after five executions on the same connection, Postgres switched to a generic plan, built without knowing the tenant or the date range, and that plan picks a nested loop sized for 125 orders when the marketplace has 905 thousand in the month. This article shows how Postgres decides between a custom and a generic plan, why that decision fails with skewed parameters, how to confirm the problem and how to fix it without giving up prepared statements where they help.',
  sections: [
    {
      title: 'The report that failed for only one customer and only on some connections',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The incident looked like a resource shortage: sparse timeouts, high database CPU at times, no new query in pg_stat_statements. But three details did not fit that hypothesis. Only tenant 7 was affected, the first 40 minutes after the deploy were normal and restarting the application, which changes nothing in the database, fixed it for a while.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'All three details point to state kept on the connection. Prepared statements live in the Postgres session: each pool connection prepares its own, counts its own executions and decides on its own when to switch plans. The restart closes the connections, resets that count and brings back the old behavior until each connection accumulates executions again. In psql, a new session running the query once always gets a custom plan, which is why the problem never showed up there.',
        },
      ],
    },
    {
      title: 'How Postgres chooses between a custom plan and a generic plan',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When a prepared statement has parameters, Postgres can plan it in two ways. The custom plan is built on every execution with the real values of $1, $2 and $3, as if they were literals: the planner looks up the statistics for tenant 7 and for the requested range. The generic plan is built once, without values, and reused on every following execution. It saves planning, but it has to estimate selectivity without knowing what it will receive.',
        },
        {
          type: 'ordered',
          items: [
            'The first five executions of each statement in the session always use a custom plan, and Postgres stores the estimated cost of each one, plus a small estimated planning cost.',
            'On the sixth execution, it builds the generic plan and computes its estimated cost.',
            'If the generic cost is lower than the average cost of the custom plans, the generic plan is used from then on. If not, it stays custom and the comparison repeats on every execution, with the updated average.',
            'Once the generic plan wins, no new custom plan is built, the average stops changing and the decision is stable until the session ends or the plan is invalidated.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The comparison is between estimated costs, not measured times. This is where the problem starts: the generic plan cost is estimated with average selectivity, and the average hides the tenant that does not look like the others. With tenant 7 among the first five executions, the average custom cost landed around 253 thousand cost units, pulled up by its plan, and the generic plan, estimated at 1,270, looked 200 times cheaper.',
        },
        {
          type: 'table',
          columns: ['Execution on the connection', 'Tenant', 'Plan used', 'Estimated cost'],
          rows: [
            ['1', '12', 'Custom', '1,180'],
            ['2', '88', 'Custom', '940'],
            ['3', '7', 'Custom', '1,264,000'],
            ['4', '301', 'Custom', '1,020'],
            ['5', '45', 'Custom', '870'],
            ['6 onward', 'Any', 'Generic (1,270 against an average of 253,602)', '1,270'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'This also explains the intermittency. On a connection that only served small tenants in its first executions, custom plans cost around 1,000 and the generic plan, at 1,270, lost: the connection stayed custom. A single pass of tenant 7 was enough to raise the average, and on the next execution the generic plan won. Each pool connection turned generic at a different moment, depending on the order of the requests it received.',
        },
      ],
    },
    {
      title: 'Why the generic plan fails with skewed parameters',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Without the value of $1, the estimate for tenant_id = $1 is the row count divided by the n_distinct of the column: 30 million orders across 1,200 tenants give 25 thousand rows, as if every customer had the same size. For the range criado_em >= $2 AND criado_em < $3, without the bounds, the planner uses a fixed 0.5% selectivity for the pair of inequalities. The result is 125 estimated orders, and for 125 orders a nested loop with index lookups on itens_pedido really is the best plan.',
        },
        {
          type: 'table',
          columns: ['Tenant and range', 'Rows estimated by the generic plan', 'Actual rows', 'Best plan'],
          rows: [
            ['Tenant 45, October', '125', '310', 'Index nested loop, 9 ms'],
            ['Tenant 12, October', '125', '2,140', 'Index nested loop, 21 ms'],
            ['Tenant 7, October', '125', '905,117', 'Hash join, 3.4 s'],
            ['Tenant 7, whole year', '125', '10.8 million', 'Parallel hash join, 31 s'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'For tenant 7, the same plan performs 905 thousand index lookups on itens_pedido, 1.2 million pages read from disk and a sort of 2.7 million rows that spills past work_mem because it was sized for 375. That is 52 seconds against 3.4 s for the custom plan. This is not a stale statistics problem: an ANALYZE changes nothing, because the generic plan does not use the parameter value to look up statistics that are already correct.',
        },
        {
          type: 'list',
          items: [
            'A column with a very skewed distribution (tenant, status, event type) is the most common cause: the per value average does not represent any real value.',
            'Date ranges are the second one: one day and one year get the same 0.5% estimate in the generic plan.',
            'LIKE with a parameter, IN with a variable length list and optional parameters such as ($1 IS NULL OR column = $1) have the same problem.',
            'PL/pgSQL functions also cache the plans of their inner queries and follow the same five execution rule, per session.',
          ],
        },
      ],
    },
    {
      title: 'Reproducing and confirming it in psql',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Running the query once with literals never reproduces the problem. To see what the application sees, you need to prepare the statement, execute it five times in the same session and only then ask for the plan. The clearest signal is in the plan conditions: the generic plan shows $1, $2 and $3 in the Index Cond, while the custom plan shows the values.',
        },
        {
          type: 'code',
          value: psqlCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'In production, auto_explain with log_min_duration set to a few seconds logs slow plans with the $1 visible, which is already enough to point at the generic plan. The pg_prepared_statements view, starting with PostgreSQL 14, exposes the generic_plans and custom_plans columns, but it only sees the statements of its own session: it has to be queried through the same application connection, not from a psql opened next to it. On PostgreSQL 16, EXPLAIN (GENERIC_PLAN) shows the generic plan of a query with $1 without preparing it.',
        },
      ],
    },
    {
      title: 'Where the application prepares statements without you noticing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In this case the prepare was explicit, but it often comes from the driver or the ORM. The behavior depends on the library, and it is worth checking before concluding that the application does not use prepared statements.',
        },
        {
          type: 'table',
          columns: ['Library', 'Default behavior', 'Generic plan risk'],
          rows: [
            ['node-postgres (pg) without name', 'Unnamed statement, rebuilt on every query', 'None: every plan is custom'],
            ['node-postgres (pg) with name', 'Prepares once per connection and reuses it', 'Yes, from the sixth execution on the connection'],
            ['postgres.js', 'prepare: true by default for static queries', 'Yes; prepare: false turns it off'],
            ['Prisma (default engine)', 'Prepared statement cache per connection (statement_cache_size)', 'Yes; statement_cache_size=0 turns it off'],
            ['PgBouncer 1.21+ in transaction mode', 'max_prepared_statements shares statements across clients', 'Yes, and the count adds up requests from different clients'],
            ['PgJDBC', 'prepareThreshold=5: prepares on the server after 5 uses', 'Yes, plus five more custom executions after that'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The PgBouncer case deserves attention: with max_prepared_statements, the prepared statement lives on the server connection and is shared by every client that goes through it. The sixth execution arrives much sooner, and a single request from the large tenant early in the day decides the plan for many others.',
        },
      ],
    },
    {
      title: 'Fixing it with plan_cache_mode in the right place',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The plan_cache_mode parameter, available since PostgreSQL 12, controls this decision: auto is the default described above, force_custom_plan builds a custom plan on every execution and force_generic_plan uses the generic one from the first execution. It is evaluated on every execution, not at prepare time, so a SET LOCAL inside the transaction works even for a statement that was already stuck on the generic plan.',
        },
        {
          type: 'code',
          value: appCode(comments.en),
        },
        {
          type: 'table',
          columns: ['Option', 'Scope', 'Cost', 'When to use'],
          rows: [
            ['Remove name from the query', 'One query', 'Parsing and planning on every execution', 'Query with skewed parameters and no real gain from the prepare'],
            ['SET LOCAL plan_cache_mode = force_custom_plan', 'One transaction', 'Planning on every execution, only there', 'Keep the prepare in the service and protect the sensitive query'],
            ['ALTER ROLE relatorios SET plan_cache_mode = force_custom_plan', 'Every session of the role', 'Planning on every query of the role', 'Reporting service with its own database user'],
            ['ALTER FUNCTION ... SET plan_cache_mode = force_custom_plan', 'One function', 'Planning on every call', 'Sensitive query inside PL/pgSQL'],
            ['Prepare only for small tenants', 'Per route', 'Logic in the application', 'Very hot OLTP query where planning matters'],
          ],
        },
        {
          type: 'list',
          items: [
            'Use SET LOCAL, never session level SET, when the connection goes back to a pool: a session SET leaks into the next request and, behind a PgBouncer in transaction mode, into another client.',
            'Do not force the generic plan to save planning without measuring. With pg_stat_statements.track_planning on, compare total_plan_time with total_exec_time: in a report that takes seconds, 0.4 ms of planning is irrelevant.',
            'Splitting statements by name does not help on its own: the generic plan of any name is estimated with the same average. What fixes it is keeping the large tenant route off the generic plan.',
            'To detect a regression, track the gap between mean_exec_time and max_exec_time of the query in pg_stat_statements and keep auto_explain logging plans above a few seconds.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'In the incident, the fix was the SET LOCAL in the report transaction. The short API queries, where the prepare really saves planning and the parameters are uniform, kept their name and the generic plan. The tenant 7 report went back to a 3.6 s p95, and the small tenant reports gained less than 1 ms of planning per call.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why exactly on the sixth execution?',
      answer:
        'Because Postgres uses the first five executions of each prepared statement to build an average cost of the custom plans. The number is fixed in the planner code and is not configurable. On the sixth, it builds the generic plan, compares its estimated cost with that average and decides. If the generic plan loses, the comparison continues on the following executions, so the switch can happen long after the sixth, as soon as an expensive parameter raises the average.',
    },
    {
      question: 'Should I set force_custom_plan for the whole database?',
      answer:
        'Usually not. Short and uniform queries, such as primary key lookups, benefit from the generic plan because they stop paying for planning on every call, and on tables with many partitions or large joins planning can cost more than execution. The safest approach is to apply force_custom_plan where the parameter distribution is skewed: in a transaction, in a function or on the role of a specific service.',
    },
    {
      question: 'Does an ANALYZE or more statistics fix a bad generic plan?',
      answer:
        'Not directly. The generic plan ignores the parameter value, so more detailed histograms, a higher SET STATISTICS and extended statistics do not change the estimate for tenant_id = $1, which remains the average per distinct value. ANALYZE invalidates cached plans and may look like a fix, but after five executions the same decision happens again.',
    },
  ],
  conclusion: {
    title: 'The plan that fits the average does not fit the largest customer',
    description:
      'Prepared statements save planning, but the generic plan they end up using is estimated for an average parameter that does not exist. In multi-tenant databases with customers of very different sizes, or in date range queries, that average is off by orders of magnitude, and the error shows up intermittently, per connection, after a few executions. Knowing that the decision happens on the sixth execution, checking pg_prepared_statements on the right connection and applying plan_cache_mode only where parameters are skewed fixes it without giving up the prepare gains in the rest of the application. If your system has queries that get slow only for some customers or only after some time in production, I can review the plans, the use of prepared statements and the pool configuration.',
    cta: 'Review the slow queries',
  },
  related: [
    {
      label: 'The index the database decided to ignore: when the query plan changes on its own',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Stale statistics after a bulk load: ANALYZE, default_statistics_target and the estimate that is off by a thousand times',
      to: '/blog/estatisticas-desatualizadas-depois-da-carga-em-massa-analyze-default-statistics-target-e-a-estimativa-que-erra-por-mil-vezes',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Una plataforma de pedidos multi-tenant agregó name a las consultas más llamadas de la API para reutilizar la planificación, una optimización común y casi siempre inofensiva. Cuarenta minutos después del deploy, el reporte diario del cliente más grande, un marketplace con el 30% de los pedidos de la base, empezó a superar el statement_timeout de 30 segundos. El error era intermitente: la misma request pasaba o fallaba según la conexión del pool que la atendía, un restart lo resolvía por una hora y, en psql, la misma consulta tardaba 3,4 s. No habían cambiado ni la consulta ni las estadísticas: después de cinco ejecuciones en la misma conexión, Postgres pasó a usar un plan genérico, armado sin conocer el tenant ni el intervalo de fechas, y ese plan elige un nested loop pensado para 125 pedidos cuando el marketplace tiene 905 mil en el mes. Este artículo muestra cómo Postgres decide entre plan custom y plan genérico, por qué esa decisión falla con parámetros desiguales, cómo confirmar el problema y cómo corregirlo sin renunciar a los prepared statements donde ayudan.',
  sections: [
    {
      title: 'El reporte que fallaba solo para un cliente y solo en algunas conexiones',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El incidente parecía falta de recursos: timeouts esporádicos, CPU de la base alta en algunos momentos, ninguna consulta nueva en pg_stat_statements. Pero tres detalles no encajaban con esa hipótesis. Solo el tenant 7 estaba afectado, los primeros 40 minutos después del deploy fueron normales y el restart de la aplicación, que no cambia nada en la base, lo resolvía por un tiempo.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'Los tres detalles apuntan a estado guardado en la conexión. Los prepared statements viven en la sesión de Postgres: cada conexión del pool prepara el suyo, cuenta sus propias ejecuciones y decide sola cuándo cambiar de plan. El restart cierra las conexiones, reinicia ese conteo y devuelve el comportamiento anterior hasta que cada conexión acumula ejecuciones de nuevo. En psql, una sesión nueva que ejecuta la consulta una vez siempre recibe un plan custom, por eso el problema no aparecía allí.',
        },
      ],
    },
    {
      title: 'Cómo Postgres elige entre plan custom y plan genérico',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando un statement preparado tiene parámetros, Postgres puede planificarlo de dos formas. El plan custom se arma en cada ejecución con los valores reales de $1, $2 y $3, como si fueran literales: el planificador consulta las estadísticas del tenant 7 y del intervalo pedido. El plan genérico se arma una vez, sin valores, y se reutiliza en todas las ejecuciones siguientes. Ahorra la planificación, pero tiene que estimar la selectividad sin saber qué va a recibir.',
        },
        {
          type: 'ordered',
          items: [
            'Las cinco primeras ejecuciones de cada statement en la sesión siempre usan plan custom, y Postgres guarda el costo estimado de cada una, más un pequeño costo estimado de planificación.',
            'En la sexta ejecución, arma el plan genérico y calcula su costo estimado.',
            'Si el costo del genérico es menor que el promedio de costo de los planes custom, el genérico pasa a usarse. Si no, sigue custom y la comparación se repite en cada ejecución, con el promedio actualizado.',
            'Una vez que el genérico gana, no se arma ningún plan custom nuevo, el promedio deja de cambiar y la decisión queda estable hasta que la sesión termina o el plan se invalida.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La comparación es entre costos estimados, no entre tiempos medidos. Aquí nace el problema: el costo del plan genérico se estima con la selectividad promedio, y el promedio esconde al tenant que no se parece a los demás. Con el tenant 7 entre las cinco primeras ejecuciones, el promedio de los planes custom quedó en torno a 253 mil unidades de costo, empujado por su plan, y el genérico, estimado en 1.270, pareció 200 veces más barato.',
        },
        {
          type: 'table',
          columns: ['Ejecución en la conexión', 'Tenant', 'Plan usado', 'Costo estimado'],
          rows: [
            ['1', '12', 'Custom', '1.180'],
            ['2', '88', 'Custom', '940'],
            ['3', '7', 'Custom', '1.264.000'],
            ['4', '301', 'Custom', '1.020'],
            ['5', '45', 'Custom', '870'],
            ['6 en adelante', 'Cualquiera', 'Genérico (1.270 contra un promedio de 253.602)', '1.270'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Esto también explica la intermitencia. En una conexión que solo atendió tenants pequeños en sus primeras ejecuciones, los planes custom costaban cerca de 1.000 y el genérico, a 1.270, perdía: la conexión seguía custom. Bastaba que el tenant 7 pasara una vez por ella para que el promedio subiera, y en la ejecución siguiente el genérico ganaba. Cada conexión del pool se volvía genérica en un momento distinto, según el orden de las requests que recibió.',
        },
      ],
    },
    {
      title: 'Por qué el plan genérico falla con parámetros desiguales',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Sin el valor de $1, la estimación para tenant_id = $1 es el número de filas dividido por el n_distinct de la columna: 30 millones de pedidos en 1.200 tenants dan 25 mil filas, como si todos los clientes tuvieran el mismo tamaño. Para el intervalo criado_em >= $2 AND criado_em < $3, sin los límites, el planificador usa una selectividad fija del 0,5% para el par de desigualdades. El resultado son 125 pedidos estimados, y para 125 pedidos un nested loop con búsqueda por índice en itens_pedido es de verdad el mejor plan.',
        },
        {
          type: 'table',
          columns: ['Tenant e intervalo', 'Filas estimadas en el genérico', 'Filas reales', 'Mejor plan'],
          rows: [
            ['Tenant 45, octubre', '125', '310', 'Nested loop por índice, 9 ms'],
            ['Tenant 12, octubre', '125', '2.140', 'Nested loop por índice, 21 ms'],
            ['Tenant 7, octubre', '125', '905.117', 'Hash join, 3,4 s'],
            ['Tenant 7, año completo', '125', '10,8 millones', 'Hash join paralelo, 31 s'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Para el tenant 7, el mismo plan hace 905 mil búsquedas por índice en itens_pedido, 1,2 millones de páginas leídas del disco y un ordenamiento de 2,7 millones de filas que supera el work_mem porque se dimensionó para 375. Son 52 segundos contra 3,4 s del plan custom. No es un problema de estadísticas desactualizadas: un ANALYZE no cambia nada, porque el plan genérico no usa el valor del parámetro para consultar estadísticas que ya están correctas.',
        },
        {
          type: 'list',
          items: [
            'Una columna con distribución muy desigual (tenant, estado, tipo de evento) es la causa más común: el promedio por valor no representa ningún valor real.',
            'Los intervalos de fechas son la segunda: un día y un año reciben la misma estimación del 0,5% en el plan genérico.',
            'LIKE con parámetro, IN con lista de tamaño variable y parámetros opcionales del tipo ($1 IS NULL OR columna = $1) tienen el mismo problema.',
            'Las funciones PL/pgSQL también guardan los planes de sus consultas internas y siguen la misma regla de las cinco ejecuciones, por sesión.',
          ],
        },
      ],
    },
    {
      title: 'Reproducir y confirmar en psql',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Ejecutar la consulta una vez con literales nunca reproduce el problema. Para ver lo que ve la aplicación, hay que preparar el statement, ejecutarlo cinco veces en la misma sesión y solo entonces pedir el plan. La señal más clara está en las condiciones del plan: el plan genérico muestra $1, $2 y $3 en el Index Cond, mientras que el plan custom muestra los valores.',
        },
        {
          type: 'code',
          value: psqlCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'En producción, auto_explain con log_min_duration ajustado a algunos segundos registra los planes lentos con los $1 visibles, lo que ya alcanza para señalar el plan genérico. La vista pg_prepared_statements, desde PostgreSQL 14, expone las columnas generic_plans y custom_plans, pero solo ve los statements de su propia sesión: hay que consultarla por la misma conexión de la aplicación, no desde un psql abierto al lado. En PostgreSQL 16, EXPLAIN (GENERIC_PLAN) muestra el plan genérico de una consulta con $1 sin necesidad de prepararla.',
        },
      ],
    },
    {
      title: 'Dónde la aplicación prepara statements sin que usted lo note',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En este caso el prepare era explícito, pero muchas veces viene del driver o del ORM. El comportamiento depende de la biblioteca, y vale la pena revisarlo antes de concluir que la aplicación no usa prepared statements.',
        },
        {
          type: 'table',
          columns: ['Biblioteca', 'Comportamiento por defecto', 'Riesgo de plan genérico'],
          rows: [
            ['node-postgres (pg) sin name', 'Statement sin nombre, rehecho en cada consulta', 'Ninguno: todo plan es custom'],
            ['node-postgres (pg) con name', 'Prepara una vez por conexión y lo reutiliza', 'Sí, a partir de la sexta ejecución en la conexión'],
            ['postgres.js', 'prepare: true por defecto en consultas estáticas', 'Sí; prepare: false lo desactiva'],
            ['Prisma (engine por defecto)', 'Caché de prepared statements por conexión (statement_cache_size)', 'Sí; statement_cache_size=0 lo desactiva'],
            ['PgBouncer 1.21+ en modo transacción', 'max_prepared_statements comparte statements entre clientes', 'Sí, y el conteo suma requests de clientes distintos'],
            ['PgJDBC', 'prepareThreshold=5: prepara en el servidor después de 5 usos', 'Sí, más cinco ejecuciones custom después de eso'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El caso de PgBouncer merece atención: con max_prepared_statements, el statement preparado queda en la conexión del servidor y lo comparten todos los clientes que pasan por ella. La sexta ejecución llega mucho antes, y una sola request del tenant grande al inicio del día decide el plan de muchas otras.',
        },
      ],
    },
    {
      title: 'Corregir con plan_cache_mode en el lugar correcto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El parámetro plan_cache_mode, disponible desde PostgreSQL 12, controla esta decisión: auto es el comportamiento por defecto descrito arriba, force_custom_plan arma un plan custom en cada ejecución y force_generic_plan usa el genérico desde la primera. Se evalúa en cada ejecución, no en el prepare, así que un SET LOCAL dentro de la transacción vale incluso para un statement que ya estaba atrapado en el plan genérico.',
        },
        {
          type: 'code',
          value: appCode(comments.es),
        },
        {
          type: 'table',
          columns: ['Opción', 'Alcance', 'Costo', 'Cuándo usar'],
          rows: [
            ['Quitar el name de la consulta', 'Una consulta', 'Parse y planificación en cada ejecución', 'Consulta con parámetros desiguales y sin ganancia real del prepare'],
            ['SET LOCAL plan_cache_mode = force_custom_plan', 'Una transacción', 'Planificación en cada ejecución, solo allí', 'Mantener el prepare en el servicio y proteger la consulta sensible'],
            ['ALTER ROLE relatorios SET plan_cache_mode = force_custom_plan', 'Todas las sesiones del rol', 'Planificación en todas las consultas del rol', 'Servicio de reportes con usuario propio en la base'],
            ['ALTER FUNCTION ... SET plan_cache_mode = force_custom_plan', 'Una función', 'Planificación en cada llamada', 'Consulta sensible dentro de PL/pgSQL'],
            ['Prepare solo para tenants pequeños', 'Por ruta', 'Lógica en la aplicación', 'Consulta OLTP muy caliente donde la planificación pesa'],
          ],
        },
        {
          type: 'list',
          items: [
            'Use SET LOCAL, nunca SET de sesión, cuando la conexión vuelve a un pool: el SET de sesión se filtra a la próxima request y, detrás de un PgBouncer en modo transacción, a otro cliente.',
            'No fuerce el plan genérico para ahorrar planificación sin medir. Con pg_stat_statements.track_planning activado, compare total_plan_time con total_exec_time: en un reporte de segundos, 0,4 ms de planificación es irrelevante.',
            'Separar statements por nombre no ayuda por sí solo: el plan genérico de cualquier nombre se estima con el mismo promedio. Lo que resuelve es que la ruta del tenant grande no use plan genérico.',
            'Para detectar que el problema vuelve, siga en pg_stat_statements la distancia entre mean_exec_time y max_exec_time de la consulta y mantenga auto_explain registrando planes por encima de algunos segundos.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'En el incidente, la corrección fue el SET LOCAL en la transacción del reporte. Las consultas cortas de la API, donde el prepare ahorra planificación de verdad y los parámetros son uniformes, siguieron con name y plan genérico. El reporte del tenant 7 volvió a 3,6 s de p95, y el de los tenants pequeños ganó menos de 1 ms de planificación por llamada.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué justo en la sexta ejecución?',
      answer:
        'Porque Postgres usa las cinco primeras ejecuciones de cada statement preparado para formar un promedio de costo de los planes custom. El número está fijo en el código del planificador y no es configurable. En la sexta, arma el plan genérico, compara su costo estimado con ese promedio y decide. Si el genérico pierde, la comparación sigue en las ejecuciones siguientes, así que el cambio puede ocurrir mucho después de la sexta, en cuanto un parámetro caro eleve el promedio.',
    },
    {
      question: '¿Debo configurar force_custom_plan en toda la base?',
      answer:
        'Normalmente no. Las consultas cortas y uniformes, como búsquedas por clave primaria, ganan con el plan genérico porque dejan de pagar planificación en cada llamada, y en tablas con muchas particiones o joins grandes la planificación puede costar más que la ejecución. Lo más seguro es aplicar force_custom_plan donde la distribución de los parámetros es desigual: en una transacción, en una función o en el rol de un servicio específico.',
    },
    {
      question: '¿Un ANALYZE o más estadísticas resuelven el plan genérico malo?',
      answer:
        'No directamente. El plan genérico ignora el valor del parámetro, así que histogramas más detallados, un SET STATISTICS mayor y estadísticas extendidas no cambian la estimación de tenant_id = $1, que sigue siendo el promedio por valor distinto. El ANALYZE invalida los planes en caché y puede dar la sensación de que lo resolvió, pero después de cinco ejecuciones la misma decisión vuelve a ocurrir.',
    },
  ],
  conclusion: {
    title: 'El plan que sirve para el promedio no sirve para el cliente más grande',
    description:
      'Los prepared statements ahorran planificación, pero el plan genérico que terminan usando se estima para un parámetro promedio que no existe. En bases multi-tenant con clientes de tamaños muy distintos, o en consultas por intervalo de fechas, ese promedio falla por órdenes de magnitud, y el error aparece de forma intermitente, por conexión, después de algunas ejecuciones. Saber que la decisión ocurre en la sexta ejecución, revisar pg_prepared_statements en la conexión correcta y aplicar plan_cache_mode solo donde los parámetros son desiguales lo resuelve sin renunciar a la ganancia del prepare en el resto de la aplicación. Si su sistema tiene consultas que se vuelven lentas solo para algunos clientes o solo después de un tiempo en producción, puedo revisar los planes, el uso de prepared statements y la configuración del pool.',
    cta: 'Revisar las consultas lentas',
  },
  related: [
    {
      label: 'El índice que la base decidió ignorar: cuándo el plan de consulta cambia solo',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Estadísticas desactualizadas después de una carga masiva: ANALYZE, default_statistics_target y la estimación que falla por mil veces',
      to: '/blog/estatisticas-desatualizadas-depois-da-carga-em-massa-analyze-default-statistics-target-e-a-estimativa-que-erra-por-mil-vezes',
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
