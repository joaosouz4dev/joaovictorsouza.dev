// Conteudo do artigo: relatorio pesado que derruba a API. Por que a consulta sincrona ocupa o pool
// e sobrevive ao timeout do cliente, como trocar o endpoint por um contrato assincrono com id de job,
// deduplicar pedidos iguais pela chave dos parametros, executar em um worker com fila no Postgres,
// pool separado e limite por tenant, guardar o resultado com expiracao pelo periodo consultado e
// migrar os clientes atuais sem quebrar ninguem.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const diagnosticoCode = `-- O que esta rodando agora, ha quanto tempo e esperando o que.
SELECT pid,
       now() - query_start AS duracao,
       state,
       wait_event_type,
       application_name,
       left(regexp_replace(query, '\\s+', ' ', 'g'), 90) AS consulta
  FROM pg_stat_activity
 WHERE datname = current_database()
   AND state <> 'idle'
 ORDER BY duracao DESC
 LIMIT 20;

-- Mesma consulta pesada repetida varias vezes ao mesmo tempo e o sinal de retry do usuario.
SELECT left(regexp_replace(query, '\\s+', ' ', 'g'), 90) AS consulta,
       count(*) AS em_execucao
  FROM pg_stat_activity
 WHERE state = 'active'
 GROUP BY 1
HAVING count(*) > 1
 ORDER BY em_execucao DESC;`;

const esquemaCode = `CREATE TABLE relatorio_jobs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chave         text        NOT NULL UNIQUE,
  tenant_id     bigint      NOT NULL,
  tipo          text        NOT NULL,
  params        jsonb       NOT NULL,
  status        text        NOT NULL
                CHECK (status IN ('pendente', 'executando', 'pronto', 'falhou')),
  tentativas    int         NOT NULL DEFAULT 0,
  erro          text,
  resultado     jsonb,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  iniciado_em   timestamptz,
  heartbeat_em  timestamptz,
  concluido_em  timestamptz,
  expira_em     timestamptz
);

-- A fila so olha para os pendentes; o indice parcial fica pequeno mesmo com milhoes de jobs antigos.
CREATE INDEX relatorio_jobs_fila ON relatorio_jobs (criado_em) WHERE status = 'pendente';

-- Usado no limite de concorrencia por tenant e na varredura de jobs orfaos.
CREATE INDEX relatorio_jobs_executando ON relatorio_jobs (tenant_id) WHERE status = 'executando';`;

const apiCode = `// relatorios/api.js - aceita o pedido, deduplica e responde sem tocar na consulta pesada.
// Express 5: erros lancados em handlers async chegam ao middleware de erro sem wrapper.
import crypto from 'node:crypto';
import express from 'express';
import { pool } from '../db.js';

export const router = express.Router();

const TIPOS = new Set(['vendas', 'comissoes', 'estoque']);

function normalizar(params) {
  const inicio = new Date(params.inicio);
  const fim = new Date(params.fim);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || inicio > fim) {
    throw Object.assign(new Error('periodo invalido'), { status: 400 });
  }
  return {
    inicio: inicio.toISOString().slice(0, 10),
    fim: fim.toISOString().slice(0, 10),
    agrupar: params.agrupar === 'mes' ? 'mes' : 'dia',
    lojas: [...new Set((params.lojas ?? []).map(String))].sort(),
  };
}

// O tenant faz parte da chave: sem ele, dois clientes com o mesmo filtro dividiriam o resultado.
function chaveDoPedido(tenantId, tipo, normalizado) {
  const texto = JSON.stringify([tenantId, tipo, normalizado]);
  return crypto.createHash('sha256').update(texto).digest('hex');
}

router.post('/relatorios/:tipo', async (req, res) => {
  const { tipo } = req.params;
  if (!TIPOS.has(tipo)) return res.status(404).end();

  const tenantId = req.auth.tenantId;
  const params = normalizar(req.body);
  const chave = chaveDoPedido(tenantId, tipo, params);

  // Cria o job ou reaproveita o existente. So reinicia quando falhou ou quando o resultado expirou.
  const { rows } = await pool.query(
    \`INSERT INTO relatorio_jobs (chave, tenant_id, tipo, params, status)
     VALUES ($1, $2, $3, $4, 'pendente')
     ON CONFLICT (chave) DO UPDATE
        SET status = 'pendente', tentativas = 0, erro = NULL, resultado = NULL,
            criado_em = now(), concluido_em = NULL, expira_em = NULL
      WHERE relatorio_jobs.status = 'falhou'
         OR (relatorio_jobs.status = 'pronto' AND relatorio_jobs.expira_em < now())
     RETURNING id, status\`,
    [chave, tenantId, tipo, params],
  );

  // Sem linha no RETURNING: o job ja existe e esta pendente, executando ou pronto e valido.
  const job =
    rows[0] ??
    (
      await pool.query('SELECT id, status, erro, resultado FROM relatorio_jobs WHERE chave = $1', [
        chave,
      ])
    ).rows[0];

  const local = \`/relatorios/jobs/\${job.id}\`;
  if (job.status === 'pronto') return res.status(200).location(local).json(job);
  res.status(202).location(local).set('Retry-After', '2').json(job);
});

router.get('/relatorios/jobs/:id', async (req, res) => {
  const { rows } = await pool.query(
    \`SELECT id, status, erro, resultado, concluido_em, expira_em
       FROM relatorio_jobs
      WHERE id = $1 AND tenant_id = $2\`,
    [req.params.id, req.auth.tenantId],
  );
  const job = rows[0];
  if (!job) return res.status(404).end();
  if (job.status === 'pendente' || job.status === 'executando') {
    return res.set('Retry-After', '2').json({ id: job.id, status: job.status });
  }
  res.json(job);
});`;

const workerCode = `// relatorios/worker.js - processo separado da API, com pools proprios e concorrencia limitada.
import pg from 'pg';
import { executarRelatorio } from './consultas.js';

const CONCORRENCIA = 3;
const MAX_POR_TENANT = 2;
const MAX_TENTATIVAS = 3;

// Fila e estado do job no primario; a consulta pesada na replica, com teto de tempo no servidor.
const filaPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const consultaPool = new pg.Pool({
  connectionString: process.env.REPLICA_URL ?? process.env.DATABASE_URL,
  max: CONCORRENCIA,
  application_name: 'relatorios-worker',
  options: '-c statement_timeout=120000',
});

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let parar = false;
process.on('SIGTERM', () => {
  parar = true;
});

// SKIP LOCKED: dois workers nunca pegam o mesmo job e nenhum espera o outro.
// O limite por tenant e aproximado: dois workers simultaneos podem passar do teto por um job.
const PEGAR_SQL = \`
  UPDATE relatorio_jobs j
     SET status = 'executando', iniciado_em = now(), heartbeat_em = now(),
         tentativas = j.tentativas + 1
   WHERE j.id = (
     SELECT p.id
       FROM relatorio_jobs p
      WHERE p.status = 'pendente'
        AND (SELECT count(*) FROM relatorio_jobs e
              WHERE e.tenant_id = p.tenant_id AND e.status = 'executando') < $1
      ORDER BY p.criado_em
      FOR UPDATE SKIP LOCKED
      LIMIT 1)
  RETURNING j.id, j.tenant_id, j.tipo, j.params, j.tentativas\`;

async function processar(job) {
  const batida = setInterval(() => {
    filaPool
      .query('UPDATE relatorio_jobs SET heartbeat_em = now() WHERE id = $1', [job.id])
      .catch(() => {});
  }, 10_000);

  try {
    const resultado = await executarRelatorio(consultaPool, job.tenant_id, job.tipo, job.params);
    // Periodo fechado nao muda mais: o resultado vale 24 horas. Periodo com hoje: 5 minutos.
    await filaPool.query(
      \`UPDATE relatorio_jobs
          SET status = 'pronto', resultado = $2, erro = NULL, concluido_em = now(),
              expira_em = now() + CASE WHEN $3::date < current_date
                                       THEN interval '24 hours'
                                       ELSE interval '5 minutes' END
        WHERE id = $1\`,
      [job.id, JSON.stringify(resultado), job.params.fim],
    );
  } catch (erro) {
    // 57014 = cancelada pelo statement_timeout. Tentar de novo so repete os mesmos 120 segundos.
    const definitivo = erro.code === '57014' || job.tentativas >= MAX_TENTATIVAS;
    await filaPool.query('UPDATE relatorio_jobs SET status = $2, erro = $3 WHERE id = $1', [
      job.id,
      definitivo ? 'falhou' : 'pendente',
      String(erro.message).slice(0, 500),
    ]);
  } finally {
    clearInterval(batida);
  }
}

async function laco() {
  while (!parar) {
    const { rows } = await filaPool.query(PEGAR_SQL, [MAX_POR_TENANT]);
    if (rows.length === 0) {
      await esperar(1000);
      continue;
    }
    await processar(rows[0]);
  }
}

// Job cujo worker morreu sem avisar: sem heartbeat ha 1 minuto, volta para a fila ou falha.
const varredura = setInterval(() => {
  filaPool
    .query(
      \`UPDATE relatorio_jobs
          SET status = CASE WHEN tentativas >= $1 THEN 'falhou' ELSE 'pendente' END,
              erro = 'worker parou sem concluir'
        WHERE status = 'executando' AND heartbeat_em < now() - interval '1 minute'\`,
      [MAX_TENTATIVAS],
    )
    .catch((erro) => console.error('varredura falhou', erro));
}, 30_000);

await Promise.all(Array.from({ length: CONCORRENCIA }, laco));
clearInterval(varredura);
await Promise.all([filaPool.end(), consultaPool.end()]);`;

const clienteCode = `// Front-end: pede o relatorio e acompanha o job com intervalo crescente.
export async function gerarRelatorio(tipo, params, { signal } = {}) {
  const resposta = await fetch(\`/relatorios/\${tipo}\`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });
  if (!resposta.ok && resposta.status !== 202) {
    throw new Error(\`pedido recusado: \${resposta.status}\`);
  }

  let job = await resposta.json();
  let espera = 1000;
  while (job.status === 'pendente' || job.status === 'executando') {
    await new Promise((resolve) => setTimeout(resolve, espera));
    espera = Math.min(Math.round(espera * 1.5), 10_000);
    const consulta = await fetch(\`/relatorios/jobs/\${job.id}\`, { signal });
    job = await consulta.json();
  }

  if (job.status === 'falhou') throw new Error(job.erro ?? 'relatorio falhou');
  return job.resultado;
}`;

const diagramaPt = `Antes: a consulta pesada roda dentro da requisicao
  navegador --GET /relatorios/vendas--> API --(1 conexao do pool por 38 s)--> primario
      timeout de 30 s no balanceador: o navegador desiste, a consulta continua no banco
      usuario clica de novo: mais uma conexao presa com a mesma consulta

Depois: a requisicao so registra o pedido
  navegador --POST /relatorios/vendas--> API --INSERT ... ON CONFLICT (chave)--> relatorio_jobs
      <-- 202 + Location: /relatorios/jobs/42 (em ~15 ms)
  worker (processo separado, 3 slots, 2 por tenant)
      --SKIP LOCKED--> pega o job --consulta--> replica (statement_timeout 120 s)
      --UPDATE status = 'pronto', resultado, expira_em--> relatorio_jobs
  navegador --GET /relatorios/jobs/42 (1 s, 1,5 s, 2,25 s ...)--> API --> resultado`;

const diagramaEn = `Before: the heavy query runs inside the request
  browser --GET /relatorios/vendas--> API --(1 pool connection for 38 s)--> primary
      30 s timeout at the load balancer: the browser gives up, the query keeps running
      user clicks again: one more connection stuck with the same query

After: the request only records the job
  browser --POST /relatorios/vendas--> API --INSERT ... ON CONFLICT (chave)--> relatorio_jobs
      <-- 202 + Location: /relatorios/jobs/42 (in ~15 ms)
  worker (separate process, 3 slots, 2 per tenant)
      --SKIP LOCKED--> claims the job --query--> replica (statement_timeout 120 s)
      --UPDATE status = 'pronto', resultado, expira_em--> relatorio_jobs
  browser --GET /relatorios/jobs/42 (1 s, 1.5 s, 2.25 s ...)--> API --> result`;

const diagramaEs = `Antes: la consulta pesada corre dentro de la solicitud
  navegador --GET /relatorios/vendas--> API --(1 conexion del pool por 38 s)--> primario
      timeout de 30 s en el balanceador: el navegador desiste, la consulta sigue en la base
      el usuario vuelve a hacer clic: otra conexion ocupada con la misma consulta

Despues: la solicitud solo registra el pedido
  navegador --POST /relatorios/vendas--> API --INSERT ... ON CONFLICT (chave)--> relatorio_jobs
      <-- 202 + Location: /relatorios/jobs/42 (en ~15 ms)
  worker (proceso separado, 3 slots, 2 por tenant)
      --SKIP LOCKED--> toma el job --consulta--> replica (statement_timeout 120 s)
      --UPDATE status = 'pronto', resultado, expira_em--> relatorio_jobs
  navegador --GET /relatorios/jobs/42 (1 s, 1,5 s, 2,25 s ...)--> API --> resultado`;

const pt = {
  intro:
    'Um ERP de varejo multi-tenant atende 1.900 lojas com uma API Node.js e um pool de 20 conexões com o PostgreSQL. Toda segunda-feira, entre 8h50 e 9h20, a API passa a responder 504 em rotas que não têm nada a ver com relatórios: login, consulta de estoque, emissão de pedido. A causa é um único endpoint, GET /relatorios/vendas, que agrega doze meses de vendas em 38 segundos no p95. Catorze gerentes abrindo o painel ao mesmo tempo ocupam catorze das vinte conexões, o balanceador corta a requisição em 30 segundos, o gerente clica de novo e a consulta antiga continua rodando no banco. Este artigo mostra como transformar esse endpoint em execução assíncrona: contrato com id de job, deduplicação de pedidos iguais, worker com fila no próprio Postgres e limite por tenant, resultado em cache com expiração pelo período consultado e a migração dos clientes atuais sem quebrar ninguém.',
  sections: [
    {
      title: 'Por que um relatório síncrono derruba a API inteira',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O problema não é a consulta ser lenta. Uma consulta de 38 segundos é aceitável para um relatório anual. O problema é ela rodar dentro do ciclo de vida de uma requisição HTTP e segurar um recurso compartilhado durante todo esse tempo. O pool de conexões é dimensionado para requisições que duram dezenas de milissegundos: com 20 conexões e tempo médio de 25 ms, ele sustenta cerca de 800 requisições por segundo. Uma única conexão presa por 38 segundos tira dessa conta o equivalente a 1.500 requisições curtas.',
        },
        {
          type: 'paragraph',
          value:
            'Três efeitos se somam. Primeiro, as requisições comuns passam a esperar na fila do pool, e o tempo de espera aparece como latência em rotas que não mudaram. Segundo, o timeout do balanceador ou do cliente encerra a conexão HTTP, mas não cancela a consulta: o driver só interrompe o Postgres se alguém chamar o cancelamento explicitamente, e a maioria das aplicações não faz isso. Terceiro, o usuário que vê erro clica de novo, e a mesma consulta passa a rodar duas, três vezes em paralelo, cada uma disputando CPU e I/O com as outras.',
        },
        {
          type: 'paragraph',
          value:
            'Antes de mudar qualquer código, confirme o diagnóstico no próprio banco durante o pico. As duas consultas abaixo mostram o que está rodando há mais tempo e quais consultas idênticas estão em execução simultânea, que é a assinatura do retry do usuário.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'table',
          columns: ['Métrica no pico de segunda-feira', 'Valor medido'],
          rows: [
            ['Duração do relatório de 12 meses (p95)', '38 s'],
            ['Conexões ocupadas por relatórios', '14 de 20'],
            ['Cópias simultâneas da mesma consulta', 'até 4'],
            ['Espera por conexão nas outras rotas (p99)', '11,2 s'],
            ['Respostas 504 em rotas sem relação com relatórios', '6,8%'],
          ],
        },
      ],
    },
    {
      title: 'O contrato assíncrono: aceitar, devolver um id e deixar o cliente acompanhar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A mudança central é separar o pedido da execução. A requisição deixa de calcular o relatório e passa a apenas registrar que ele foi pedido, responde 202 Accepted com o id do job e um cabeçalho Location apontando para o recurso de acompanhamento. O cliente consulta esse recurso até o status virar pronto ou falhou. A requisição que antes durava 38 segundos passa a durar cerca de 15 ms, e o tempo de execução sai do caminho de qualquer timeout HTTP.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'table',
          columns: ['Status', 'Significado', 'Resposta do GET de acompanhamento'],
          rows: [
            ['pendente', 'Registrado, aguardando um slot do worker', '200 com status e Retry-After: 2'],
            ['executando', 'Um worker pegou o job e envia heartbeat', '200 com status e Retry-After: 2'],
            ['pronto', 'Resultado gravado e dentro da validade', '200 com o resultado'],
            ['falhou', 'Esgotou tentativas ou estourou o teto de tempo', '200 com a mensagem de erro'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Polling é a opção mais simples e funciona atrás de qualquer proxy. Para relatórios que levam segundos ou poucos minutos, consultar com intervalo crescente, de 1 segundo até um teto de 10, gera poucas requisições e todas baratas, porque leem uma linha por chave primária. Server-sent events ou WebSocket só compensam se a aplicação já tiver esse canal aberto por outro motivo. Para relatórios de dezenas de minutos, o melhor é avisar por e-mail ou notificação com o link do resultado.',
        },
        {
          type: 'code',
          value: clienteCode,
        },
      ],
    },
    {
      title: 'Deduplicar pedidos iguais antes de executar qualquer consulta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mover a consulta para um worker sem deduplicar só troca o lugar do congestionamento: cada clique vira um job, e a fila enche com cópias do mesmo trabalho. A chave do job deve ser derivada dos parâmetros normalizados, de modo que o mesmo pedido, feito pelo mesmo tenant, sempre caia na mesma linha. Normalizar significa reduzir as variações que não mudam o resultado: datas em formato canônico, listas ordenadas e sem repetição, valores padrão explícitos.',
        },
        {
          type: 'paragraph',
          value:
            'O tenant precisa fazer parte da chave. Uma chave baseada apenas nos filtros faria dois clientes com o mesmo período dividirem o mesmo resultado, o que é um vazamento de dados, não uma otimização. Pelo mesmo motivo, o GET de acompanhamento filtra por id e por tenant: o id sequencial é fácil de adivinhar.',
        },
        {
          type: 'code',
          value: esquemaCode,
        },
        {
          type: 'paragraph',
          value:
            'O INSERT com ON CONFLICT resolve a corrida sem trava na aplicação. Se dois pedidos idênticos chegam no mesmo milissegundo, a restrição UNIQUE garante que só um cria a linha, e o outro recebe o mesmo job. A cláusula WHERE do DO UPDATE define quando um job existente pode ser reiniciado: apenas se falhou ou se o resultado expirou. Em qualquer outro caso o RETURNING volta vazio, e a API lê o job atual, que pode já estar pronto.',
        },
        {
          type: 'code',
          value: apiCode,
        },
        {
          type: 'paragraph',
          value:
            'No ERP do exemplo, 61% dos pedidos da segunda-feira passaram a ser atendidos por um job já existente, pendente, em execução ou pronto. Gerentes da mesma rede abrem o mesmo painel com o mesmo filtro, e esse padrão é comum em qualquer produto com relatórios padronizados.',
        },
      ],
    },
    {
      title: 'O worker: fila no próprio Postgres, pool separado e limite por tenant',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Para algumas centenas de jobs por hora, uma tabela no Postgres com SELECT FOR UPDATE SKIP LOCKED é uma fila suficiente e evita introduzir um broker só para isso. O registro do job e o estado ficam na mesma base, consultáveis com SQL, e a deduplicação pela chave continua valendo. SKIP LOCKED faz cada worker pular as linhas já reservadas por outro, então vários processos consomem a fila sem disputa e sem pegar o mesmo job duas vezes.',
        },
        {
          type: 'paragraph',
          value:
            'O worker roda em processo separado da API, com seus próprios pools. O pool da fila fala com o primário, porque grava o estado. O pool da consulta aponta para uma réplica de leitura quando existe, e define statement_timeout no servidor: um teto de 120 segundos que o Postgres aplica mesmo que o worker morra. A concorrência total fica em três consultas pesadas simultâneas, e nenhum tenant ocupa mais de duas, para que uma rede com 300 lojas não bloqueie a fila de todas as outras.',
        },
        {
          type: 'code',
          value: workerCode,
        },
        {
          type: 'list',
          items: [
            'Heartbeat a cada 10 segundos e varredura a cada 30: um job cujo worker foi encerrado por deploy ou falta de memória volta para a fila em até 90 segundos, sem intervenção manual.',
            'Erro 57014, consulta cancelada pelo statement_timeout, é tratado como falha definitiva. Repetir a mesma consulta com os mesmos parâmetros só consome mais 120 segundos de banco para chegar ao mesmo resultado.',
            'O resultado é gravado com JSON.stringify porque o driver pg converte arrays JavaScript em arrays do Postgres, não em JSON, e a gravação em uma coluna jsonb falharia para relatórios que retornam uma lista.',
            'SIGTERM interrompe a busca de novos jobs, mas deixa o atual terminar. Se o orquestrador matar o processo antes, o heartbeat para e a varredura devolve o job para a fila.',
          ],
        },
      ],
    },
    {
      title: 'Resultado em cache: onde guardar e quando expirar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O job pronto já é o cache. Enquanto expira_em estiver no futuro, qualquer pedido com a mesma chave recebe o resultado gravado sem executar nada. A pergunta que importa é quanto tempo esse resultado continua correto, e a resposta depende do período consultado, não de um TTL fixo. Vendas de um mês fechado não mudam mais, salvo estorno retroativo. Vendas que incluem o dia de hoje mudam a cada pedido.',
        },
        {
          type: 'paragraph',
          value:
            'Por isso o worker calcula a validade ao concluir: 24 horas quando a data final é anterior a hoje, 5 minutos quando o período inclui o dia corrente. Quando existe processo que altera o passado, como importação de vendas atrasadas ou estorno, ele deve expirar explicitamente os jobs afetados com um UPDATE que zera expira_em para o tenant e o intervalo de datas. Isso é mais confiável do que encurtar a validade de todos os relatórios para cobrir um caso raro.',
        },
        {
          type: 'table',
          columns: ['Onde guardar o resultado', 'Quando faz sentido', 'Cuidado'],
          rows: [
            [
              'Coluna jsonb no próprio job',
              'Resultados agregados de até alguns megabytes, como totais por dia ou por loja',
              'Limpar jobs expirados com rotina periódica para não inchar a tabela',
            ],
            [
              'Storage de objetos com URL assinada',
              'Resultados grandes ou exportações para CSV e planilha',
              'A URL assinada também expira; gerar no GET, não gravar no job',
            ],
            [
              'Redis com TTL',
              'Leitura muito frequente do mesmo resultado, acima de centenas por segundo',
              'Perde o resultado em reinício; o job no Postgres continua sendo a fonte da verdade',
            ],
            [
              'Tabela de agregados pré-calculados',
              'O mesmo relatório pedido por quase todos os tenants, todos os dias',
              'Vira um pipeline com atualização incremental, não um cache de consulta',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha da tabela é o sinal para mudar de estratégia. Se 90% dos pedidos são o mesmo relatório mensal, vale mais manter uma tabela de vendas por dia e por loja, atualizada a cada hora, do que executar a agregação sob demanda. O fluxo assíncrono continua útil para os filtros raros, e o pré-cálculo atende o caso comum em milissegundos.',
        },
      ],
    },
    {
      title: 'Migrar sem quebrar quem já consome o endpoint síncrono',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O GET síncrono costuma ter mais consumidores do que o front-end: integrações de clientes, planilhas conectadas, scripts de BI. Trocar o contrato de uma vez quebra todos eles. A migração segura mantém o endpoint antigo funcionando enquanto o tráfego muda de caminho.',
        },
        {
          type: 'ordered',
          items: [
            'Publicar o POST de job e o GET de acompanhamento sem alterar o endpoint antigo, e mudar o front-end primeiro, atrás de uma feature flag por tenant.',
            'Fazer o GET síncrono passar pelo mesmo fluxo: ele cria ou reaproveita o job e espera até 25 segundos pelo resultado. Se ficar pronto, responde como antes. Se não, responde 202 com o Location do job, o que é melhor do que o 504 atual.',
            'Aplicar statement_timeout de 5 segundos ao pool da API. A partir daqui, nenhuma consulta da requisição consegue segurar uma conexão por mais tempo do que isso, e qualquer relatório esquecido aparece como erro em log, não como lentidão geral.',
            'Avisar os consumidores de integração com prazo e documentação do contrato novo, acompanhando o uso do GET antigo por application_name ou por chave de API.',
            'Remover o caminho síncrono quando o uso chegar a zero por quatro semanas.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'No ERP do exemplo, a segunda-feira seguinte à mudança terminou com p99 de 180 ms nas rotas comuns, nenhuma resposta 504 e no máximo três consultas de relatório simultâneas no banco, todas na réplica. O tempo para o gerente ver o relatório anual ficou praticamente igual na primeira abertura e caiu para menos de um segundo nas seguintes, servidas pelo resultado gravado.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Antes', 'Depois'],
          rows: [
            ['Duração da requisição de relatório', '38 s (p95)', '15 ms para registrar o job'],
            ['Espera por conexão nas outras rotas (p99)', '11,2 s', '4 ms'],
            ['Respostas 504 no pico', '6,8%', '0%'],
            ['Consultas pesadas simultâneas no banco', 'até 14, no primário', 'até 3, na réplica'],
            ['Pedidos atendidos sem executar consulta', '0%', '61%'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Não seria mais simples só otimizar a consulta com índices?',
      answer:
        'Vale tentar primeiro, e às vezes resolve. Mas uma agregação de doze meses sobre dezenas de milhões de linhas continua levando segundos mesmo bem indexada, e qualquer consulta que dure mais do que a requisição deveria durar tem o mesmo problema estrutural: ocupa uma conexão compartilhada e sobrevive ao timeout do cliente. Otimizar reduz o custo de cada execução; o fluxo assíncrono controla quantas rodam ao mesmo tempo e onde.',
    },
    {
      question: 'Preciso de RabbitMQ, SQS ou Kafka para isso?',
      answer:
        'Não para esse volume. Uma tabela com SKIP LOCKED atende com folga algumas centenas de jobs por hora, mantém deduplicação e estado na mesma transação e não adiciona um componente novo para operar. Um broker passa a fazer sentido quando o volume chega a milhares de jobs por minuto, quando outros serviços precisam reagir à conclusão ou quando a empresa já opera um e tem padrão estabelecido para ele.',
    },
    {
      question: 'Como cancelar um relatório que o usuário não quer mais?',
      answer:
        'Grave o pid do backend no job quando a execução começar, obtido com SELECT pg_backend_pid() na mesma conexão da consulta, e exponha um DELETE no recurso do job que marca o status como cancelado e chama pg_cancel_backend com esse pid. Só cancele se nenhum outro pedido estiver esperando o mesmo job: com deduplicação, o relatório de um gerente pode ser o de outros cinco.',
    },
  ],
  conclusion: {
    title: 'O relatório pode ser lento; a API não pode esperar por ele',
    description:
      'O endpoint que derrubava a API toda segunda-feira não precisou ficar mais rápido. Precisou sair do caminho da requisição: o pedido virou um job com chave derivada dos parâmetros e do tenant, a execução passou para um worker com concorrência limitada e teto de tempo no servidor, e o resultado ficou gravado com validade que respeita o período consultado. As rotas comuns voltaram a responder em milissegundos, e o relatório passou a custar uma execução para cada pedido distinto, não uma para cada clique.',
    cta: 'Revisar os relatórios que pesam na minha API',
  },
  related: [
    {
      label: 'Limite de conexões do banco esgotado: quando o pool vira o gargalo do serviço',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Exportação de relatório que derruba o servidor: arquivo grande em streaming sem estourar memória',
      to: '/blog/exportacao-relatorio-que-derruba-servidor-arquivo-grande-em-streaming-sem-estourar-memoria',
    },
    {
      label: 'Serviço de arquitetura e modernização backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A multi-tenant retail ERP serves 1,900 stores with a Node.js API and a pool of 20 PostgreSQL connections. Every Monday, between 8:50 and 9:20, the API starts returning 504 on routes that have nothing to do with reports: login, stock lookup, order creation. The cause is a single endpoint, GET /relatorios/vendas, which aggregates twelve months of sales in 38 seconds at p95. Fourteen managers opening the dashboard at the same time hold fourteen of the twenty connections, the load balancer cuts the request at 30 seconds, the manager clicks again and the old query keeps running in the database. This article shows how to turn that endpoint into asynchronous execution: a contract with a job id, deduplication of identical requests, a worker with a queue in Postgres itself and a per tenant limit, a cached result whose expiration follows the queried period, and the migration of existing clients without breaking anyone.',
  sections: [
    {
      title: 'Why a synchronous report takes down the whole API',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The problem is not that the query is slow. A 38 second query is acceptable for a yearly report. The problem is that it runs inside the lifecycle of an HTTP request and holds a shared resource the whole time. The connection pool is sized for requests that last tens of milliseconds: with 20 connections and an average of 25 ms, it sustains about 800 requests per second. A single connection held for 38 seconds removes the equivalent of 1,500 short requests from that budget.',
        },
        {
          type: 'paragraph',
          value:
            'Three effects add up. First, ordinary requests start waiting in the pool queue, and that wait shows up as latency on routes that did not change. Second, the load balancer or client timeout closes the HTTP connection but does not cancel the query: the driver only interrupts Postgres if someone explicitly calls cancellation, and most applications do not. Third, the user who sees an error clicks again, and the same query starts running two or three times in parallel, each copy competing for CPU and I/O with the others.',
        },
        {
          type: 'paragraph',
          value:
            'Before changing any code, confirm the diagnosis in the database itself during the peak. The two queries below show what has been running the longest and which identical queries are executing simultaneously, which is the signature of user retries.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'table',
          columns: ['Metric at the Monday peak', 'Measured value'],
          rows: [
            ['12 month report duration (p95)', '38 s'],
            ['Connections held by reports', '14 of 20'],
            ['Simultaneous copies of the same query', 'up to 4'],
            ['Connection wait on other routes (p99)', '11.2 s'],
            ['504 responses on routes unrelated to reports', '6.8%'],
          ],
        },
      ],
    },
    {
      title: 'The asynchronous contract: accept, return an id and let the client follow along',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The core change is separating the request from the execution. The request stops computing the report and only records that it was requested, responds 202 Accepted with the job id and a Location header pointing to the status resource. The client polls that resource until the status becomes ready or failed. The request that used to take 38 seconds now takes about 15 ms, and execution time leaves the path of every HTTP timeout.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'table',
          columns: ['Status', 'Meaning', 'Status GET response'],
          rows: [
            ['pendente (pending)', 'Recorded, waiting for a worker slot', '200 with status and Retry-After: 2'],
            ['executando (running)', 'A worker claimed the job and sends heartbeats', '200 with status and Retry-After: 2'],
            ['pronto (ready)', 'Result stored and still valid', '200 with the result'],
            ['falhou (failed)', 'Ran out of attempts or hit the time ceiling', '200 with the error message'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Polling is the simplest option and works behind any proxy. For reports that take seconds or a few minutes, polling with a growing interval, from 1 second up to a 10 second ceiling, produces few requests and all of them are cheap, since they read one row by primary key. Server-sent events or WebSocket only pay off if the application already has that channel open for another reason. For reports that take tens of minutes, it is better to notify by email or in-app notification with a link to the result.',
        },
        {
          type: 'code',
          value: clienteCode,
        },
      ],
    },
    {
      title: 'Deduplicating identical requests before running any query',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Moving the query to a worker without deduplication only moves the congestion: every click becomes a job, and the queue fills up with copies of the same work. The job key must be derived from the normalized parameters, so that the same request, made by the same tenant, always lands on the same row. Normalizing means removing variations that do not change the result: dates in canonical format, sorted lists without repetition, explicit default values.',
        },
        {
          type: 'paragraph',
          value:
            'The tenant must be part of the key. A key based only on the filters would make two customers with the same period share the same result, which is a data leak, not an optimization. For the same reason, the status GET filters by id and by tenant: a sequential id is easy to guess.',
        },
        {
          type: 'code',
          value: esquemaCode,
        },
        {
          type: 'paragraph',
          value:
            'The INSERT with ON CONFLICT resolves the race without an application lock. If two identical requests arrive in the same millisecond, the UNIQUE constraint guarantees that only one creates the row, and the other gets the same job. The WHERE clause of DO UPDATE defines when an existing job may be restarted: only if it failed or if its result expired. In any other case RETURNING comes back empty, and the API reads the current job, which may already be ready.',
        },
        {
          type: 'code',
          value: apiCode,
        },
        {
          type: 'paragraph',
          value:
            'In the example ERP, 61% of Monday requests started being served by an existing job, whether pending, running or ready. Managers from the same chain open the same dashboard with the same filter, and that pattern is common in any product with standardized reports.',
        },
      ],
    },
    {
      title: 'The worker: a queue in Postgres itself, a separate pool and a per tenant limit',
      blocks: [
        {
          type: 'paragraph',
          value:
            'For a few hundred jobs per hour, a Postgres table with SELECT FOR UPDATE SKIP LOCKED is a sufficient queue and avoids introducing a broker just for this. The job record and its state live in the same database, queryable with SQL, and key based deduplication keeps working. SKIP LOCKED makes each worker skip rows already reserved by another, so several processes consume the queue without contention and without claiming the same job twice.',
        },
        {
          type: 'paragraph',
          value:
            'The worker runs in a process separate from the API, with its own pools. The queue pool talks to the primary, because it writes state. The query pool points to a read replica when one exists and sets statement_timeout on the server: a 120 second ceiling that Postgres enforces even if the worker dies. Total concurrency stays at three heavy queries at a time, and no tenant takes more than two, so that a chain with 300 stores cannot block the queue for everyone else.',
        },
        {
          type: 'code',
          value: workerCode,
        },
        {
          type: 'list',
          items: [
            'Heartbeat every 10 seconds and a sweep every 30: a job whose worker was killed by a deploy or by running out of memory goes back to the queue within 90 seconds, with no manual intervention.',
            'Error 57014, a query canceled by statement_timeout, is treated as a permanent failure. Repeating the same query with the same parameters only burns another 120 seconds of database time to reach the same outcome.',
            'The result is stored with JSON.stringify because the pg driver converts JavaScript arrays into Postgres arrays, not JSON, and writing to a jsonb column would fail for reports that return a list.',
            'SIGTERM stops the search for new jobs but lets the current one finish. If the orchestrator kills the process earlier, the heartbeat stops and the sweep returns the job to the queue.',
          ],
        },
      ],
    },
    {
      title: 'Cached results: where to store them and when they expire',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The ready job already is the cache. While expira_em is in the future, any request with the same key receives the stored result without executing anything. The question that matters is how long that result stays correct, and the answer depends on the queried period, not on a fixed TTL. Sales for a closed month no longer change, except for retroactive refunds. Sales that include today change with every order.',
        },
        {
          type: 'paragraph',
          value:
            'That is why the worker computes validity when it finishes: 24 hours when the end date is before today, 5 minutes when the period includes the current day. When a process changes the past, such as importing late sales or processing refunds, it should explicitly expire the affected jobs with an UPDATE that clears expira_em for the tenant and date range. That is more reliable than shortening the validity of every report to cover a rare case.',
        },
        {
          type: 'table',
          columns: ['Where to store the result', 'When it makes sense', 'Watch out for'],
          rows: [
            [
              'jsonb column on the job itself',
              'Aggregated results up to a few megabytes, such as totals per day or per store',
              'Clean up expired jobs with a periodic routine so the table does not bloat',
            ],
            [
              'Object storage with a signed URL',
              'Large results or exports to CSV and spreadsheets',
              'The signed URL also expires; generate it on GET, do not store it in the job',
            ],
            [
              'Redis with TTL',
              'Very frequent reads of the same result, above hundreds per second',
              'Loses the result on restart; the job in Postgres remains the source of truth',
            ],
            [
              'Precomputed aggregate table',
              'The same report requested by almost every tenant, every day',
              'It becomes a pipeline with incremental updates, not a query cache',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row of the table is the signal to change strategy. If 90% of requests are the same monthly report, it is better to maintain a sales per day and per store table, refreshed every hour, than to run the aggregation on demand. The asynchronous flow stays useful for rare filters, and precomputation serves the common case in milliseconds.',
        },
      ],
    },
    {
      title: 'Migrating without breaking whoever already consumes the synchronous endpoint',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The synchronous GET usually has more consumers than the front end: customer integrations, connected spreadsheets, BI scripts. Switching the contract all at once breaks all of them. A safe migration keeps the old endpoint working while traffic changes paths.',
        },
        {
          type: 'ordered',
          items: [
            'Ship the job POST and the status GET without touching the old endpoint, and switch the front end first, behind a per tenant feature flag.',
            'Make the synchronous GET go through the same flow: it creates or reuses the job and waits up to 25 seconds for the result. If it becomes ready, it responds as before. If not, it responds 202 with the job Location, which is better than the current 504.',
            'Apply a 5 second statement_timeout to the API pool. From then on, no request query can hold a connection longer than that, and any forgotten report shows up as an error in the logs, not as general slowness.',
            'Notify integration consumers with a deadline and documentation for the new contract, tracking usage of the old GET by application_name or API key.',
            'Remove the synchronous path once usage reaches zero for four weeks.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'In the example ERP, the Monday after the change ended with a 180 ms p99 on ordinary routes, no 504 responses and at most three report queries running at the same time, all on the replica. The time for a manager to see the yearly report stayed practically the same on first open and dropped below one second on subsequent ones, served from the stored result.',
        },
        {
          type: 'table',
          columns: ['Metric', 'Before', 'After'],
          rows: [
            ['Report request duration', '38 s (p95)', '15 ms to record the job'],
            ['Connection wait on other routes (p99)', '11.2 s', '4 ms'],
            ['504 responses at peak', '6.8%', '0%'],
            ['Simultaneous heavy queries in the database', 'up to 14, on the primary', 'up to 3, on the replica'],
            ['Requests served without running a query', '0%', '61%'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Would it not be simpler to just optimize the query with indexes?',
      answer:
        'It is worth trying first, and sometimes it solves the problem. But a twelve month aggregation over tens of millions of rows still takes seconds even when well indexed, and any query that lasts longer than a request should has the same structural problem: it holds a shared connection and outlives the client timeout. Optimizing reduces the cost of each execution; the asynchronous flow controls how many run at once and where.',
    },
    {
      question: 'Do I need RabbitMQ, SQS or Kafka for this?',
      answer:
        'Not at this volume. A table with SKIP LOCKED comfortably handles a few hundred jobs per hour, keeps deduplication and state in the same transaction and does not add a new component to operate. A broker starts to make sense when volume reaches thousands of jobs per minute, when other services need to react to completion, or when the company already runs one and has an established pattern for it.',
    },
    {
      question: 'How do I cancel a report the user no longer wants?',
      answer:
        'Store the backend pid on the job when execution starts, obtained with SELECT pg_backend_pid() on the same connection as the query, and expose a DELETE on the job resource that marks the status as canceled and calls pg_cancel_backend with that pid. Only cancel if no other request is waiting on the same job: with deduplication, one manager\'s report may be five other people\'s report too.',
    },
  ],
  conclusion: {
    title: 'The report may be slow; the API cannot wait for it',
    description:
      'The endpoint that took down the API every Monday did not need to get faster. It needed to leave the request path: the request became a job keyed by its parameters and tenant, execution moved to a worker with limited concurrency and a server side time ceiling, and the result was stored with a validity that respects the queried period. Ordinary routes went back to answering in milliseconds, and the report now costs one execution per distinct request, not one per click.',
    cta: 'Review the reports weighing on my API',
  },
  related: [
    {
      label: 'Database connection limit exhausted: when the pool becomes the service bottleneck',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'The report export that takes down the server: streaming large files without running out of memory',
      to: '/blog/exportacao-relatorio-que-derruba-servidor-arquivo-grande-em-streaming-sem-estourar-memoria',
    },
    {
      label: 'Backend architecture and modernization service',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Un ERP minorista multi-tenant atiende 1.900 tiendas con una API Node.js y un pool de 20 conexiones a PostgreSQL. Todos los lunes, entre las 8:50 y las 9:20, la API empieza a responder 504 en rutas que no tienen nada que ver con reportes: login, consulta de stock, emisión de pedidos. La causa es un único endpoint, GET /relatorios/vendas, que agrega doce meses de ventas en 38 segundos en el p95. Catorce gerentes abriendo el panel al mismo tiempo ocupan catorce de las veinte conexiones, el balanceador corta la solicitud a los 30 segundos, el gerente vuelve a hacer clic y la consulta anterior sigue corriendo en la base. Este artículo muestra cómo convertir ese endpoint en ejecución asíncrona: un contrato con id de job, deduplicación de pedidos iguales, un worker con cola en el propio Postgres y límite por tenant, un resultado en caché cuya expiración sigue el período consultado y la migración de los clientes actuales sin romper a nadie.',
  sections: [
    {
      title: 'Por qué un reporte síncrono tumba toda la API',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El problema no es que la consulta sea lenta. Una consulta de 38 segundos es aceptable para un reporte anual. El problema es que corre dentro del ciclo de vida de una solicitud HTTP y retiene un recurso compartido durante todo ese tiempo. El pool de conexiones está dimensionado para solicitudes que duran decenas de milisegundos: con 20 conexiones y un promedio de 25 ms, soporta unas 800 solicitudes por segundo. Una sola conexión retenida durante 38 segundos le quita a esa cuenta el equivalente a 1.500 solicitudes cortas.',
        },
        {
          type: 'paragraph',
          value:
            'Se suman tres efectos. Primero, las solicitudes comunes empiezan a esperar en la cola del pool, y esa espera aparece como latencia en rutas que no cambiaron. Segundo, el timeout del balanceador o del cliente cierra la conexión HTTP, pero no cancela la consulta: el driver solo interrumpe a Postgres si alguien llama explícitamente a la cancelación, y la mayoría de las aplicaciones no lo hace. Tercero, el usuario que ve el error vuelve a hacer clic, y la misma consulta pasa a correr dos o tres veces en paralelo, cada copia compitiendo por CPU e I/O con las demás.',
        },
        {
          type: 'paragraph',
          value:
            'Antes de cambiar cualquier código, confirme el diagnóstico en la propia base durante el pico. Las dos consultas siguientes muestran qué lleva más tiempo ejecutándose y qué consultas idénticas están corriendo en simultáneo, que es la firma del reintento del usuario.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'table',
          columns: ['Métrica en el pico del lunes', 'Valor medido'],
          rows: [
            ['Duración del reporte de 12 meses (p95)', '38 s'],
            ['Conexiones ocupadas por reportes', '14 de 20'],
            ['Copias simultáneas de la misma consulta', 'hasta 4'],
            ['Espera por conexión en las demás rutas (p99)', '11,2 s'],
            ['Respuestas 504 en rutas sin relación con reportes', '6,8%'],
          ],
        },
      ],
    },
    {
      title: 'El contrato asíncrono: aceptar, devolver un id y dejar que el cliente haga el seguimiento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El cambio central es separar el pedido de la ejecución. La solicitud deja de calcular el reporte y solo registra que fue pedido, responde 202 Accepted con el id del job y un encabezado Location que apunta al recurso de seguimiento. El cliente consulta ese recurso hasta que el estado pase a listo o fallido. La solicitud que antes duraba 38 segundos pasa a durar unos 15 ms, y el tiempo de ejecución sale del camino de cualquier timeout HTTP.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'table',
          columns: ['Estado', 'Significado', 'Respuesta del GET de seguimiento'],
          rows: [
            ['pendente (pendiente)', 'Registrado, esperando un slot del worker', '200 con el estado y Retry-After: 2'],
            ['executando (en ejecución)', 'Un worker tomó el job y envía heartbeat', '200 con el estado y Retry-After: 2'],
            ['pronto (listo)', 'Resultado guardado y dentro de su validez', '200 con el resultado'],
            ['falhou (fallido)', 'Agotó los intentos o superó el techo de tiempo', '200 con el mensaje de error'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El polling es la opción más simple y funciona detrás de cualquier proxy. Para reportes que tardan segundos o pocos minutos, consultar con un intervalo creciente, de 1 segundo hasta un techo de 10, genera pocas solicitudes y todas baratas, porque leen una fila por clave primaria. Server-sent events o WebSocket solo compensan si la aplicación ya tiene ese canal abierto por otro motivo. Para reportes de decenas de minutos, lo mejor es avisar por correo o notificación con el enlace al resultado.',
        },
        {
          type: 'code',
          value: clienteCode,
        },
      ],
    },
    {
      title: 'Deduplicar pedidos iguales antes de ejecutar cualquier consulta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mover la consulta a un worker sin deduplicar solo cambia de lugar la congestión: cada clic se convierte en un job, y la cola se llena de copias del mismo trabajo. La clave del job debe derivarse de los parámetros normalizados, de modo que el mismo pedido, hecho por el mismo tenant, siempre caiga en la misma fila. Normalizar significa eliminar las variaciones que no cambian el resultado: fechas en formato canónico, listas ordenadas y sin repetición, valores por defecto explícitos.',
        },
        {
          type: 'paragraph',
          value:
            'El tenant tiene que formar parte de la clave. Una clave basada solo en los filtros haría que dos clientes con el mismo período compartieran el mismo resultado, lo que es una fuga de datos, no una optimización. Por la misma razón, el GET de seguimiento filtra por id y por tenant: un id secuencial es fácil de adivinar.',
        },
        {
          type: 'code',
          value: esquemaCode,
        },
        {
          type: 'paragraph',
          value:
            'El INSERT con ON CONFLICT resuelve la carrera sin bloqueo en la aplicación. Si dos pedidos idénticos llegan en el mismo milisegundo, la restricción UNIQUE garantiza que solo uno cree la fila, y el otro recibe el mismo job. La cláusula WHERE del DO UPDATE define cuándo un job existente puede reiniciarse: solo si falló o si su resultado expiró. En cualquier otro caso el RETURNING vuelve vacío, y la API lee el job actual, que puede estar ya listo.',
        },
        {
          type: 'code',
          value: apiCode,
        },
        {
          type: 'paragraph',
          value:
            'En el ERP del ejemplo, el 61% de los pedidos del lunes pasó a ser atendido por un job ya existente, pendiente, en ejecución o listo. Los gerentes de una misma cadena abren el mismo panel con el mismo filtro, y ese patrón es común en cualquier producto con reportes estandarizados.',
        },
      ],
    },
    {
      title: 'El worker: cola en el propio Postgres, pool separado y límite por tenant',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Para algunos cientos de jobs por hora, una tabla en Postgres con SELECT FOR UPDATE SKIP LOCKED es una cola suficiente y evita introducir un broker solo para esto. El registro del job y su estado viven en la misma base, consultables con SQL, y la deduplicación por clave sigue funcionando. SKIP LOCKED hace que cada worker salte las filas ya reservadas por otro, así que varios procesos consumen la cola sin disputa y sin tomar el mismo job dos veces.',
        },
        {
          type: 'paragraph',
          value:
            'El worker corre en un proceso separado de la API, con sus propios pools. El pool de la cola habla con el primario, porque escribe el estado. El pool de la consulta apunta a una réplica de lectura cuando existe y define statement_timeout en el servidor: un techo de 120 segundos que Postgres aplica aunque el worker muera. La concurrencia total queda en tres consultas pesadas simultáneas, y ningún tenant ocupa más de dos, para que una cadena con 300 tiendas no bloquee la cola de todas las demás.',
        },
        {
          type: 'code',
          value: workerCode,
        },
        {
          type: 'list',
          items: [
            'Heartbeat cada 10 segundos y barrido cada 30: un job cuyo worker fue terminado por un despliegue o por falta de memoria vuelve a la cola en hasta 90 segundos, sin intervención manual.',
            'El error 57014, consulta cancelada por statement_timeout, se trata como falla definitiva. Repetir la misma consulta con los mismos parámetros solo consume otros 120 segundos de base para llegar al mismo resultado.',
            'El resultado se guarda con JSON.stringify porque el driver pg convierte los arrays de JavaScript en arrays de Postgres, no en JSON, y la escritura en una columna jsonb fallaría para reportes que devuelven una lista.',
            'SIGTERM detiene la búsqueda de nuevos jobs, pero deja terminar el actual. Si el orquestador mata el proceso antes, el heartbeat se detiene y el barrido devuelve el job a la cola.',
          ],
        },
      ],
    },
    {
      title: 'Resultado en caché: dónde guardarlo y cuándo expira',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El job listo ya es la caché. Mientras expira_em esté en el futuro, cualquier pedido con la misma clave recibe el resultado guardado sin ejecutar nada. La pregunta que importa es cuánto tiempo ese resultado sigue siendo correcto, y la respuesta depende del período consultado, no de un TTL fijo. Las ventas de un mes cerrado ya no cambian, salvo devoluciones retroactivas. Las ventas que incluyen el día de hoy cambian con cada pedido.',
        },
        {
          type: 'paragraph',
          value:
            'Por eso el worker calcula la validez al terminar: 24 horas cuando la fecha final es anterior a hoy, 5 minutos cuando el período incluye el día en curso. Cuando existe un proceso que altera el pasado, como la importación de ventas atrasadas o una devolución, debe expirar explícitamente los jobs afectados con un UPDATE que limpie expira_em para el tenant y el rango de fechas. Eso es más confiable que acortar la validez de todos los reportes para cubrir un caso raro.',
        },
        {
          type: 'table',
          columns: ['Dónde guardar el resultado', 'Cuándo tiene sentido', 'Cuidado'],
          rows: [
            [
              'Columna jsonb en el propio job',
              'Resultados agregados de hasta algunos megabytes, como totales por día o por tienda',
              'Limpiar los jobs expirados con una rutina periódica para no inflar la tabla',
            ],
            [
              'Almacenamiento de objetos con URL firmada',
              'Resultados grandes o exportaciones a CSV y planilla',
              'La URL firmada también expira; generarla en el GET, no guardarla en el job',
            ],
            [
              'Redis con TTL',
              'Lectura muy frecuente del mismo resultado, por encima de cientos por segundo',
              'Pierde el resultado al reiniciar; el job en Postgres sigue siendo la fuente de verdad',
            ],
            [
              'Tabla de agregados precalculados',
              'El mismo reporte pedido por casi todos los tenants, todos los días',
              'Se convierte en un pipeline con actualización incremental, no en una caché de consulta',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila de la tabla es la señal para cambiar de estrategia. Si el 90% de los pedidos es el mismo reporte mensual, conviene más mantener una tabla de ventas por día y por tienda, actualizada cada hora, que ejecutar la agregación bajo demanda. El flujo asíncrono sigue siendo útil para los filtros poco frecuentes, y el precálculo atiende el caso común en milisegundos.',
        },
      ],
    },
    {
      title: 'Migrar sin romper a quien ya consume el endpoint síncrono',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El GET síncrono suele tener más consumidores que el front-end: integraciones de clientes, planillas conectadas, scripts de BI. Cambiar el contrato de una sola vez los rompe a todos. La migración segura mantiene el endpoint antiguo funcionando mientras el tráfico cambia de camino.',
        },
        {
          type: 'ordered',
          items: [
            'Publicar el POST de job y el GET de seguimiento sin alterar el endpoint antiguo, y cambiar primero el front-end, detrás de una feature flag por tenant.',
            'Hacer que el GET síncrono pase por el mismo flujo: crea o reutiliza el job y espera hasta 25 segundos el resultado. Si queda listo, responde como antes. Si no, responde 202 con el Location del job, lo que es mejor que el 504 actual.',
            'Aplicar un statement_timeout de 5 segundos al pool de la API. A partir de aquí, ninguna consulta de la solicitud puede retener una conexión por más tiempo que eso, y cualquier reporte olvidado aparece como error en los logs, no como lentitud general.',
            'Avisar a los consumidores de integración con un plazo y documentación del contrato nuevo, siguiendo el uso del GET antiguo por application_name o por clave de API.',
            'Eliminar el camino síncrono cuando el uso llegue a cero durante cuatro semanas.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'En el ERP del ejemplo, el lunes siguiente al cambio terminó con un p99 de 180 ms en las rutas comunes, ninguna respuesta 504 y como máximo tres consultas de reporte simultáneas en la base, todas en la réplica. El tiempo para que el gerente vea el reporte anual quedó prácticamente igual en la primera apertura y bajó a menos de un segundo en las siguientes, servidas desde el resultado guardado.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Antes', 'Después'],
          rows: [
            ['Duración de la solicitud de reporte', '38 s (p95)', '15 ms para registrar el job'],
            ['Espera por conexión en las demás rutas (p99)', '11,2 s', '4 ms'],
            ['Respuestas 504 en el pico', '6,8%', '0%'],
            ['Consultas pesadas simultáneas en la base', 'hasta 14, en el primario', 'hasta 3, en la réplica'],
            ['Pedidos atendidos sin ejecutar consulta', '0%', '61%'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿No sería más simple optimizar la consulta con índices?',
      answer:
        'Vale la pena intentarlo primero, y a veces lo resuelve. Pero una agregación de doce meses sobre decenas de millones de filas sigue tardando segundos aun bien indexada, y cualquier consulta que dure más de lo que debería durar una solicitud tiene el mismo problema estructural: ocupa una conexión compartida y sobrevive al timeout del cliente. Optimizar reduce el costo de cada ejecución; el flujo asíncrono controla cuántas corren al mismo tiempo y dónde.',
    },
    {
      question: '¿Necesito RabbitMQ, SQS o Kafka para esto?',
      answer:
        'No para este volumen. Una tabla con SKIP LOCKED atiende con holgura algunos cientos de jobs por hora, mantiene la deduplicación y el estado en la misma transacción y no agrega un componente nuevo que operar. Un broker empieza a tener sentido cuando el volumen llega a miles de jobs por minuto, cuando otros servicios necesitan reaccionar a la finalización o cuando la empresa ya opera uno y tiene un patrón establecido.',
    },
    {
      question: '¿Cómo cancelar un reporte que el usuario ya no quiere?',
      answer:
        'Guarde el pid del backend en el job cuando empiece la ejecución, obtenido con SELECT pg_backend_pid() en la misma conexión de la consulta, y exponga un DELETE en el recurso del job que marque el estado como cancelado y llame a pg_cancel_backend con ese pid. Cancele solo si ningún otro pedido está esperando el mismo job: con deduplicación, el reporte de un gerente puede ser también el de otros cinco.',
    },
  ],
  conclusion: {
    title: 'El reporte puede ser lento; la API no puede esperarlo',
    description:
      'El endpoint que tumbaba la API todos los lunes no necesitó volverse más rápido. Necesitó salir del camino de la solicitud: el pedido se convirtió en un job con una clave derivada de sus parámetros y del tenant, la ejecución pasó a un worker con concurrencia limitada y techo de tiempo en el servidor, y el resultado quedó guardado con una validez que respeta el período consultado. Las rutas comunes volvieron a responder en milisegundos, y el reporte pasó a costar una ejecución por cada pedido distinto, no una por cada clic.',
    cta: 'Revisar los reportes que pesan en mi API',
  },
  related: [
    {
      label: 'Límite de conexiones de la base agotado: cuando el pool se vuelve el cuello de botella del servicio',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'La exportación de reportes que tumba el servidor: archivos grandes en streaming sin agotar la memoria',
      to: '/blog/exportacao-relatorio-que-derruba-servidor-arquivo-grande-em-streaming-sem-estourar-memoria',
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
