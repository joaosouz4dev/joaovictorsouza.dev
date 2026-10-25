// Conteudo do artigo: vizinho barulhento no SaaS multi-tenant. Como um unico cliente satura o
// banco compartilhado e derruba a latencia de todos, como identificar quem consome, como isolar
// com limite de concorrencia por tenant, pools separados por classe de carga e timeouts por papel,
// quando promover um tenant para banco proprio e como provar em teste que o isolamento funciona.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const limitadorCode = `// limitador-tenant.js
// Cada tenant tem um teto de consultas simultaneas e uma fila curta com prazo.
// O que passa do teto espera pouco e depois recebe um erro claro, em vez de ocupar o pool de todos.
export class ErroLimiteTenant extends Error {
  constructor(tenant, motivo) {
    super('limite do tenant ' + tenant + ': ' + motivo);
    this.name = 'ErroLimiteTenant';
    this.tenant = tenant;
    this.motivo = motivo;
  }
}

export function criarLimitadorPorTenant({ maxPorTenant = 4, maxFila = 20, esperaMaximaMs = 2000 } = {}) {
  const ativos = new Map(); // tenant -> consultas em andamento
  const filas = new Map(); // tenant -> [{ resolve, reject, timer }]
  const recusadas = new Map(); // tenant -> total recusado, para virar metrica

  function contarRecusa(tenant) {
    recusadas.set(tenant, (recusadas.get(tenant) ?? 0) + 1);
  }

  function adquirir(tenant) {
    const emAndamento = ativos.get(tenant) ?? 0;
    if (emAndamento < maxPorTenant) {
      ativos.set(tenant, emAndamento + 1);
      return Promise.resolve();
    }
    const fila = filas.get(tenant) ?? [];
    if (fila.length >= maxFila) {
      contarRecusa(tenant);
      return Promise.reject(new ErroLimiteTenant(tenant, 'fila cheia'));
    }
    return new Promise((resolve, reject) => {
      const item = { resolve, reject, timer: null };
      item.timer = setTimeout(() => {
        const posicao = fila.indexOf(item);
        if (posicao >= 0) fila.splice(posicao, 1);
        if (fila.length === 0) filas.delete(tenant);
        contarRecusa(tenant);
        reject(new ErroLimiteTenant(tenant, 'espera excedida'));
      }, esperaMaximaMs);
      fila.push(item);
      filas.set(tenant, fila);
    });
  }

  function liberar(tenant) {
    const fila = filas.get(tenant);
    if (fila && fila.length > 0) {
      // A vaga passa direto para o proximo da fila do mesmo tenant: o contador de ativos nao muda.
      const proximo = fila.shift();
      clearTimeout(proximo.timer);
      if (fila.length === 0) filas.delete(tenant);
      proximo.resolve();
      return;
    }
    const restantes = (ativos.get(tenant) ?? 1) - 1;
    if (restantes <= 0) ativos.delete(tenant);
    else ativos.set(tenant, restantes);
  }

  async function executar(tenant, fn) {
    await adquirir(tenant);
    try {
      return await fn();
    } finally {
      liberar(tenant);
    }
  }

  return {
    executar,
    estado: () => ({
      ativos: Object.fromEntries(ativos),
      filas: Object.fromEntries([...filas].map(([t, f]) => [t, f.length])),
      recusadas: Object.fromEntries(recusadas),
    }),
  };
}`;

const poolsCode = `// bancos.js
// Duas classes de carga, dois pools, dois papeis no banco. O relatorio pesado nunca compete
// com a tela que o usuario esta esperando.
import pg from 'pg';
import { criarLimitadorPorTenant } from './limitador-tenant.js';

const { Pool } = pg;

// Interativo: muitas consultas curtas. Papel app_interativo tem statement_timeout de 3 s.
export const poolInterativo = new Pool({
  connectionString: process.env.DATABASE_URL_INTERATIVO,
  max: 30,
  application_name: 'api-interativo',
  connectionTimeoutMillis: 1500,
});

// Pesado: relatorios, exportacoes e importacoes. Poucas conexoes, timeout longo, papel proprio.
export const poolPesado = new Pool({
  connectionString: process.env.DATABASE_URL_PESADO,
  max: 4,
  application_name: 'api-pesado',
  connectionTimeoutMillis: 5000,
});

const limitadorInterativo = criarLimitadorPorTenant({ maxPorTenant: 4, maxFila: 20, esperaMaximaMs: 1500 });
const limitadorPesado = criarLimitadorPorTenant({ maxPorTenant: 1, maxFila: 5, esperaMaximaMs: 10_000 });

export const estadoLimitadores = () => ({
  interativo: limitadorInterativo.estado(),
  pesado: limitadorPesado.estado(),
});

export function consultar(classe, tenantId, sql, params = []) {
  const pool = classe === 'pesado' ? poolPesado : poolInterativo;
  const limitador = classe === 'pesado' ? limitadorPesado : limitadorInterativo;
  return limitador.executar(tenantId, async () => {
    const client = await pool.connect();
    try {
      // application_name aparece em pg_stat_activity: e assim que se descobre quem esta rodando o que.
      await client.query("SELECT set_config('application_name', $1, false)", ['t:' + tenantId]);
      const inicio = performance.now();
      try {
        return await client.query(sql, params);
      } finally {
        registrarTempoDeBanco(tenantId, classe, performance.now() - inicio);
      }
    } finally {
      await client.query("SELECT set_config('application_name', $1, false)", ['api-' + classe]).catch(() => {});
      client.release();
    }
  });
}

// Soma do tempo de banco por tenant: o ranking que mostra o vizinho barulhento antes do incidente.
const tempoPorTenant = new Map();
function registrarTempoDeBanco(tenantId, classe, ms) {
  const chave = classe + ':' + tenantId;
  tempoPorTenant.set(chave, (tempoPorTenant.get(chave) ?? 0) + ms);
}
export function rankingTempoDeBanco(topo = 5) {
  const total = [...tempoPorTenant.values()].reduce((a, b) => a + b, 0) || 1;
  return [...tempoPorTenant]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topo)
    .map(([chave, ms]) => ({ chave, segundos: Math.round(ms / 1000), participacao: Number((ms / total).toFixed(2)) }));
}`;

const sqlCode = `-- 1. Quem esta ocupando o banco agora (application_name = t:<tenant>, definido pela API).
SELECT application_name AS tenant,
       count(*) FILTER (WHERE state = 'active') AS ativas,
       count(*) FILTER (WHERE state = 'idle in transaction') AS ociosas_em_transacao,
       count(*) FILTER (WHERE wait_event_type = 'Lock') AS esperando_lock,
       max(now() - query_start) FILTER (WHERE state = 'active') AS consulta_mais_longa
FROM pg_stat_activity
WHERE datname = current_database()
  AND application_name LIKE 't:%'
GROUP BY application_name
ORDER BY ativas DESC
LIMIT 10;

-- 2. Papeis separados, cada um com o seu limite.
CREATE ROLE app_interativo LOGIN PASSWORD :'senha_interativo';
CREATE ROLE app_pesado LOGIN PASSWORD :'senha_pesado';

ALTER ROLE app_interativo SET statement_timeout = '3s';
ALTER ROLE app_interativo SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE app_interativo CONNECTION LIMIT 40;

ALTER ROLE app_pesado SET statement_timeout = '120s';
ALTER ROLE app_pesado SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE app_pesado SET work_mem = '64MB';
ALTER ROLE app_pesado CONNECTION LIMIT 6;

-- 3. Relatorio pesado sempre numa replica de leitura, nunca no primario (conecte o pool pesado nela).
-- Na replica, hot_standby_feedback = off evita que a consulta longa segure o vacuum do primario.`;

const testeCode = `// limitador-tenant.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as dormir } from 'node:timers/promises';
import { criarLimitadorPorTenant, ErroLimiteTenant } from './limitador-tenant.js';

test('um tenant que satura nao atrasa os outros', async () => {
  const limitador = criarLimitadorPorTenant({ maxPorTenant: 2, maxFila: 5, esperaMaximaMs: 300 });
  const consultaLenta = () => dormir(200);

  // O tenant barulhento dispara 40 consultas de uma vez.
  const barulhento = Array.from({ length: 40 }, () =>
    limitador.executar('barulhento', consultaLenta).then(
      () => 'ok',
      (erro) => (erro instanceof ErroLimiteTenant ? 'recusada' : 'erro'),
    ),
  );

  // O tenant comum faz uma consulta curta no meio da tempestade.
  await dormir(20);
  const inicio = performance.now();
  await limitador.executar('comum', () => dormir(10));
  const esperaDoComum = performance.now() - inicio;

  const resultados = await Promise.all(barulhento);
  assert.ok(esperaDoComum < 60, 'o tenant comum esperou ' + Math.round(esperaDoComum) + ' ms');
  assert.ok(resultados.includes('recusada'), 'o excesso do barulhento deveria ser recusado');
  assert.equal(resultados.filter((r) => r === 'erro').length, 0);
  assert.ok(limitador.estado().recusadas.barulhento > 0, 'a recusa precisa virar metrica');
});

test('a vaga e devolvida quando a consulta falha', async () => {
  const limitador = criarLimitadorPorTenant({ maxPorTenant: 1, maxFila: 1, esperaMaximaMs: 100 });
  await assert.rejects(limitador.executar('a', async () => { throw new Error('timeout do banco'); }), /timeout do banco/);
  await limitador.executar('a', async () => 'segue'); // se a vaga vazou, isto estoura a espera
  assert.deepEqual(limitador.estado().ativos, {});
});`;

const diagramaPt = `Um banco compartilhado, antes e depois do isolamento.

ANTES
  tenant A (relatorio) --6 consultas pesadas--+
  tenant B (tela)      --consultas curtas-----+--> pool unico (40) --> Postgres (CPU 92%)
  tenant C (tela)      --consultas curtas-----+        ^ cheio: B e C esperam por A

DEPOIS
  tenant A (relatorio) --> limitador (1 por tenant) --> pool pesado (4)  --> replica de leitura
  tenant B (tela)      --> limitador (4 por tenant) --+
  tenant C (tela)      --> limitador (4 por tenant) --+--> pool interativo (30) --> primario
                              |
                              +--> excesso: espera curta, depois erro 429 + contador por tenant`;

const diagramaEn = `One shared database, before and after isolation.

BEFORE
  tenant A (report) --6 heavy queries--------+
  tenant B (screen) --short queries----------+--> single pool (40) --> Postgres (CPU 92%)
  tenant C (screen) --short queries----------+        ^ full: B and C wait for A

AFTER
  tenant A (report) --> limiter (1 per tenant) --> heavy pool (4)  --> read replica
  tenant B (screen) --> limiter (4 per tenant) --+
  tenant C (screen) --> limiter (4 per tenant) --+--> interactive pool (30) --> primary
                              |
                              +--> overflow: short wait, then 429 error + per-tenant counter`;

const diagramaEs = `Una base compartida, antes y después del aislamiento.

ANTES
  tenant A (reporte) --6 consultas pesadas---+
  tenant B (pantalla) --consultas cortas-----+--> pool único (40) --> Postgres (CPU 92%)
  tenant C (pantalla) --consultas cortas-----+        ^ lleno: B y C esperan a A

DESPUÉS
  tenant A (reporte)  --> limitador (1 por tenant) --> pool pesado (4)  --> réplica de lectura
  tenant B (pantalla) --> limitador (4 por tenant) --+
  tenant C (pantalla) --> limitador (4 por tenant) --+--> pool interactivo (30) --> primario
                              |
                              +--> exceso: espera corta, luego error 429 + contador por tenant`;

const pt = {
  intro:
    'Um SaaS com 400 clientes roda em um único Postgres compartilhado e responde em 120 ms de p99 há um ano. Numa segunda-feira de fechamento, o cliente Atacado Norte pede o relatório mensal: seis consultas em paralelo, cada uma varrendo 38 milhões de linhas. A CPU do banco vai a 92%, o pool de 40 conexões fica inteiro nas mãos dele, e os outros 399 clientes veem telas de 4 segundos ou erros de timeout. O suporte abre 60 chamados em 20 minutos; nenhum deles é do Atacado Norte, que só está esperando o relatório. A reação comum é criar um banco por cliente, e essa é uma solução cara para um problema que quase sempre cabe em limites bem colocados. Este artigo mostra como identificar quem está consumindo o banco antes do incidente, como isolar a carga com limite de concorrência por tenant, pools separados por classe de carga e papéis com timeouts diferentes, quando faz sentido promover um cliente para banco próprio e como provar em teste que o isolamento funciona.',
  sections: [
    {
      title: 'O cliente que usa o produto como previsto e derruba os outros',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O vizinho barulhento raramente é abuso. É um cliente legítimo fazendo algo que o produto permite: exportar um ano de pedidos, importar uma planilha de 200 mil linhas, abrir um painel com filtro aberto demais, ou um script de integração que consulta a API em laço. O problema não está na intenção, e sim em um recurso compartilhado sem divisão de uso: CPU do banco, conexões, I/O, cache de buffers e locks. Quem chega primeiro e pede mais fica com a maior parte.',
        },
        {
          type: 'paragraph',
          value:
            'O pior efeito é o pool de conexões. Cada consulta pesada segura uma conexão por segundos, o pool tem tamanho fixo, e as requisições curtas dos outros clientes ficam na fila de conexão. O banco até teria capacidade para atendê-las, mas elas nem chegam a ele. O usuário do Atacado Norte, sem ver o relatório, clica em tentar de novo, e cada clique acrescenta mais seis consultas à tempestade. Sem limite por tenant, a tentativa de recuperação do cliente piora o incidente de todos.',
        },
        {
          type: 'table',
          columns: ['Recurso compartilhado', 'Como o vizinho consome', 'O que os outros veem'],
          rows: [
            ['Conexões do pool', 'Consultas longas seguram conexões por segundos', 'Espera por conexão, timeout antes de chegar ao banco'],
            ['CPU e I/O do banco', 'Varredura grande, ordenação, agregação sem índice', 'Toda consulta fica mais lenta, inclusive as indexadas'],
            ['Cache de buffers', 'Varredura sequencial expulsa as páginas quentes dos outros', 'Consultas antes rápidas passam a ler do disco'],
            ['Locks', 'Transação longa ou DDL no meio do expediente', 'Escritas simples esperando e depois falhando'],
          ],
        },
      ],
    },
    {
      title: 'Achar o vizinho antes do incidente: medir uso por tenant',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O pg_stat_statements agrupa consultas pelo texto normalizado, então não separa um tenant do outro: o mesmo SELECT com tenant_id diferente vira uma linha só. Para atribuir o consumo ao cliente, a aplicação precisa carregar a identidade até o banco. O jeito mais barato é ajustar o application_name da conexão no momento em que ela é emprestada, o que a torna visível em pg_stat_activity, e somar na própria aplicação o tempo de banco por tenant. A primeira consulta responde "quem está ocupando o banco agora"; o segundo número responde "quem ocupa a maior parte do banco ao longo do dia", que é o que aparece no painel antes de virar incidente.',
        },
        {
          type: 'code',
          value: sqlCode,
        },
        {
          type: 'paragraph',
          value:
            'Com isso, a pergunta do plantão muda de "o banco está lento por quê?" para "qual tenant está acima de 30% do tempo de banco e há quanto tempo?". Um alerta nessa participação, e não só na CPU, dá aviso minutos antes de o p99 dos outros subir. Vale também guardar o ranking diário: ele mostra quais clientes crescem rápido e quais deveriam estar em outro plano.',
        },
      ],
    },
    {
      title: 'Isolar com limites, sem um banco por cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A ordem de ataque é do mais barato ao mais caro. Primeiro, separar as classes de carga: tela interativa e relatório pesado não devem dividir pool nem papel. O relatório ganha um pool pequeno, um papel com timeout longo e, quando possível, uma réplica de leitura. A tela interativa fica com um pool grande e timeout curto de 3 segundos, o que mata consultas descontroladas antes que segurem a conexão por minutos.',
        },
        {
          type: 'paragraph',
          value:
            'Segundo, limitar a concorrência por tenant dentro de cada classe. O limitador abaixo dá a cada cliente um teto de consultas simultâneas e uma fila curta com prazo. O excesso espera pouco e depois recebe um erro explícito, que a API traduz em 429 com Retry-After. Quando o Atacado Norte dispara seis consultas, uma roda e as outras esperam na fila dele, sem tocar no pool dos demais.',
        },
        {
          type: 'code',
          value: limitadorCode,
        },
        {
          type: 'code',
          value: poolsCode,
        },
        {
          type: 'paragraph',
          value:
            'O limitador vive no processo, então o teto vale por instância. Com 12 instâncias e maxPorTenant 4, um tenant pode chegar a 48 consultas simultâneas. Para um teto global exato, divida o limite desejado pelo número de instâncias ou use um contador compartilhado no Redis; na prática, a divisão simples já resolve a maior parte dos incidentes, porque o objetivo é impedir que um cliente ocupe tudo, não medir a concorrência exata.',
        },
      ],
    },
    {
      title: 'Isolamento de dados e quando promover um tenant para banco próprio',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Limites protegem a latência dos outros, mas não eliminam a disputa por I/O e por cache em um banco único. A saída seguinte não é "banco por cliente" para todos, e sim camadas de isolamento que o cliente sobe quando precisa. A maioria dos tenants fica no pool compartilhado, que é o mais barato de operar. Os grandes migram para um nível mais isolado, e a aplicação resolve a conexão pelo tenant, então o código de negócio não muda.',
        },
        {
          type: 'table',
          columns: ['Nível', 'Isolamento', 'Custo operacional', 'Quando usar'],
          rows: [
            ['Pool compartilhado, limites por tenant', 'Concorrência e timeouts, sem isolar I/O e cache', 'Baixo: um banco, um esquema', 'Padrão para a grande maioria dos clientes'],
            ['Réplica de leitura para relatórios', 'Tira a carga analítica do primário', 'Médio: lag de réplica precisa ser tolerado', 'Relatórios e exportações de qualquer tenant'],
            ['Esquema por tenant no mesmo banco', 'Organização e backup granular, mas CPU e I/O continuam divididos', 'Médio a alto: migração aplicada em N esquemas', 'Exigência contratual de separação lógica'],
            ['Banco dedicado', 'CPU, I/O, cache e janela de manutenção próprios', 'Alto: migração, backup, monitoramento e custo por instância', 'Cliente que sozinho passa de 20% a 30% do uso, ou exige SLA próprio'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O gatilho de promoção deve ser objetivo e vir do ranking que você já mede: participação acima de 25% do tempo de banco por mais de uma semana, ou necessidade de janela de manutenção própria, ou contrato que paga o suficiente para o custo da instância. Para que a promoção seja uma operação de rotina, e não um projeto, mantenha desde o início um catálogo de tenants com o campo de destino de conexão e o tenant_id em toda tabela. A migração de dados de um tenant então vira copiar as linhas por tenant_id para o banco novo, validar, trocar o destino no catálogo e apagar a origem depois de um período de segurança.',
        },
      ],
    },
    {
      title: 'Provar que o isolamento funciona e não deixar regredir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Isolamento que não é testado se perde no primeiro refactor que usa o pool direto, sem passar pela camada de limite. O teste de propriedade é simples: um tenant satura o limitador enquanto outro faz uma chamada curta, e a espera do segundo precisa ficar próxima do tempo da própria consulta. O teste também confere que o excesso do barulhento foi recusado e contado, e que a vaga volta mesmo quando a consulta falha.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'ordered',
          items: [
            'Marque a conexão com o tenant (application_name) e some o tempo de banco por tenant; alerte pela participação, não só pela CPU.',
            'Separe interativo e pesado em pools e papéis diferentes, com statement_timeout curto para um e longo para o outro.',
            'Limite a concorrência por tenant em cada classe, com fila curta, erro explícito (429 com Retry-After) e contador de recusas.',
            'Mande relatórios e exportações para uma réplica de leitura, e exporte em lotes por chave, não com uma consulta gigante.',
            'Defina o gatilho objetivo de promoção para banco dedicado e mantenha o catálogo de tenants pronto para isso.',
            'Mantenha o teste de isolamento no CI e proíba o uso do pool fora da função de consulta.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Row-level security do Postgres resolve o vizinho barulhento?',
      answer:
        'Não. Row-level security garante que um tenant só veja as próprias linhas, o que é isolamento de dados, não de recursos. Uma consulta de um tenant sob RLS continua usando a mesma CPU, o mesmo I/O e a mesma conexão do pool. O problema do vizinho barulhento é de capacidade compartilhada, e se resolve com limites de concorrência, pools separados, timeouts por papel e, no limite, banco dedicado.',
    },
    {
      question: 'Rate limit na borda por requisição não basta?',
      answer:
        'Ajuda, mas mede a coisa errada. Uma requisição de exportação pode custar mil vezes mais banco do que uma consulta de tela, então 100 requisições por minuto significam coisas muito diferentes. O limite de concorrência por tenant na camada de banco mede o que está realmente escasso, que é o tempo de conexão e de execução. Os dois se complementam: a borda protege contra volume, e o limitador de banco protege contra custo por requisição.',
    },
    {
      question: 'E se o cliente grande reclamar do 429 no relatório?',
      answer:
        'O 429 deve ser raro para uso normal e vir com orientação: Retry-After e, para trabalhos pesados, um fluxo assíncrono em que o relatório é gerado em segundo plano e entregue por link ou e-mail. Isso melhora também a experiência dele, que deixa de olhar um spinner por dois minutos. Se o cliente precisa de mais concorrência e paga por isso, a resposta é um teto maior no plano dele ou a promoção para banco dedicado, e não remover o limite para todos.',
    },
  ],
  conclusion: {
    title: 'Em banco compartilhado, o limite por cliente é o que mantém o contrato com todos os outros',
    description:
      'Um cliente legítimo com um relatório pesado pode ocupar o pool e a CPU do banco e deixar 399 clientes com telas de 4 segundos. O caminho é medir o uso por tenant com application_name e tempo de banco acumulado, separar carga interativa e pesada em pools e papéis com timeouts distintos, limitar a concorrência por tenant com fila curta, erro explícito e contador, mandar a carga analítica para uma réplica, definir um gatilho objetivo para promover o cliente que cresceu demais para um banco dedicado e manter um teste de isolamento no CI. Assim o custo de um banco por cliente só é pago por quem realmente precisa dele.',
    cta: 'Revisar a arquitetura multi-tenant do meu SaaS',
  },
  related: [
    {
      label: 'Limite de conexões do banco esgotado: o pool vira o gargalo do serviço',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Limite de taxa por cliente na borda: proteger o serviço sem punir o parceiro',
      to: '/blog/limite-taxa-por-cliente-na-borda-proteger-servico-sem-punir-parceiro',
    },
    {
      label: 'Serviço de arquitetura e modernização backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A SaaS with 400 customers runs on a single shared Postgres and has answered in 120 ms at p99 for a year. On a month-end Monday, the customer Atacado Norte requests its monthly report: six parallel queries, each scanning 38 million rows. Database CPU goes to 92%, the 40-connection pool ends up entirely in that customer\'s hands, and the other 399 customers see 4-second screens or timeout errors. Support opens 60 tickets in 20 minutes; none of them is from Atacado Norte, which is just waiting for its report. The usual reaction is to create one database per customer, which is an expensive answer to a problem that almost always fits inside well-placed limits. This article shows how to find who is consuming the database before the incident, how to isolate the load with a per-tenant concurrency limit, separate pools per workload class and roles with different timeouts, when it makes sense to promote a customer to its own database, and how to prove in a test that the isolation works.',
  sections: [
    {
      title: 'The customer who uses the product as intended and takes everyone else down',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The noisy neighbor is rarely abuse. It is a legitimate customer doing something the product allows: exporting a year of orders, importing a 200,000-row spreadsheet, opening a dashboard with a filter that is too open, or an integration script polling the API in a loop. The problem is not intent but a shared resource with no usage split: database CPU, connections, I/O, buffer cache and locks. Whoever arrives first and asks for the most keeps most of it.',
        },
        {
          type: 'paragraph',
          value:
            'The worst effect is on the connection pool. Each heavy query holds a connection for seconds, the pool has a fixed size, and the short requests from other customers wait in the connection queue. The database would have capacity to serve them, but they never reach it. The Atacado Norte user, not seeing the report, clicks retry, and each click adds six more queries to the storm. Without a per-tenant limit, the customer\'s attempt to recover makes the incident worse for everyone.',
        },
        {
          type: 'table',
          columns: ['Shared resource', 'How the neighbor consumes it', 'What the others see'],
          rows: [
            ['Pool connections', 'Long queries hold connections for seconds', 'Waiting for a connection, timeouts before reaching the database'],
            ['Database CPU and I/O', 'Large scans, sorts, aggregation without an index', 'Every query slows down, including indexed ones'],
            ['Buffer cache', 'Sequential scans evict the others\' hot pages', 'Previously fast queries start reading from disk'],
            ['Locks', 'Long transaction or DDL in the middle of business hours', 'Simple writes waiting and then failing'],
          ],
        },
      ],
    },
    {
      title: 'Finding the neighbor before the incident: measuring usage per tenant',
      blocks: [
        {
          type: 'paragraph',
          value:
            'pg_stat_statements groups queries by normalized text, so it does not separate one tenant from another: the same SELECT with a different tenant_id becomes a single row. To attribute consumption to the customer, the application has to carry the identity down to the database. The cheapest way is to set the connection application_name at the moment it is borrowed, which makes it visible in pg_stat_activity, and to sum database time per tenant inside the application. The first query answers "who is occupying the database right now"; the second number answers "who occupies most of the database over the day", which is what shows up on the dashboard before it becomes an incident.',
        },
        {
          type: 'code',
          value: sqlCode,
        },
        {
          type: 'paragraph',
          value:
            'With this, the on-call question changes from "why is the database slow?" to "which tenant is above 30% of database time and for how long?". An alert on that share, and not only on CPU, gives a warning minutes before the others\' p99 rises. It is also worth keeping the daily ranking: it shows which customers are growing fast and which should be on a different plan.',
        },
      ],
    },
    {
      title: 'Isolating with limits, without one database per customer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The order of attack goes from cheapest to most expensive. First, separate the workload classes: interactive screens and heavy reports should not share a pool or a role. The report gets a small pool, a role with a long timeout and, when possible, a read replica. The interactive screen keeps a large pool and a short 3-second timeout, which kills runaway queries before they hold a connection for minutes.',
        },
        {
          type: 'paragraph',
          value:
            'Second, limit concurrency per tenant inside each class. The limiter below gives each customer a ceiling of simultaneous queries and a short queue with a deadline. The overflow waits briefly and then receives an explicit error, which the API turns into a 429 with Retry-After. When Atacado Norte fires six queries, one runs and the others wait in its own queue, without touching the pool of the rest.',
        },
        {
          type: 'code',
          value: limitadorCode,
        },
        {
          type: 'code',
          value: poolsCode,
        },
        {
          type: 'paragraph',
          value:
            'The limiter lives in the process, so the ceiling applies per instance. With 12 instances and maxPorTenant 4, one tenant can reach 48 simultaneous queries. For an exact global ceiling, divide the desired limit by the number of instances or use a shared counter in Redis; in practice, the simple division already solves most incidents, because the goal is to stop one customer from occupying everything, not to measure concurrency exactly.',
        },
      ],
    },
    {
      title: 'Data isolation and when to promote a tenant to its own database',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Limits protect the others\' latency but do not remove contention for I/O and cache in a single database. The next step is not "a database per customer" for everyone, but layers of isolation that a customer moves up when needed. Most tenants stay in the shared pool, which is the cheapest to operate. The large ones move to a more isolated level, and the application resolves the connection by tenant, so business code does not change.',
        },
        {
          type: 'table',
          columns: ['Level', 'Isolation', 'Operational cost', 'When to use'],
          rows: [
            ['Shared pool, per-tenant limits', 'Concurrency and timeouts, without isolating I/O and cache', 'Low: one database, one schema', 'Default for the vast majority of customers'],
            ['Read replica for reports', 'Takes analytical load off the primary', 'Medium: replica lag must be tolerated', 'Reports and exports from any tenant'],
            ['Schema per tenant in the same database', 'Organization and granular backup, but CPU and I/O are still shared', 'Medium to high: migration applied to N schemas', 'Contractual requirement for logical separation'],
            ['Dedicated database', 'Own CPU, I/O, cache and maintenance window', 'High: migration, backup, monitoring and per-instance cost', 'Customer that alone exceeds 20% to 30% of usage, or requires its own SLA'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The promotion trigger should be objective and come from the ranking you already measure: a share above 25% of database time for more than a week, or a need for its own maintenance window, or a contract that pays enough for the instance cost. To make promotion a routine operation rather than a project, keep from the start a tenant catalog with a connection target field and a tenant_id on every table. Migrating a tenant then becomes copying rows by tenant_id into the new database, validating, switching the target in the catalog and deleting the source after a safety period.',
        },
      ],
    },
    {
      title: 'Proving the isolation works and keeping it from regressing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Isolation that is not tested is lost in the first refactor that uses the pool directly, bypassing the limit layer. The property test is simple: one tenant saturates the limiter while another makes a short call, and the second one\'s wait must stay close to the time of its own query. The test also checks that the noisy tenant\'s overflow was rejected and counted, and that the slot comes back even when the query fails.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'ordered',
          items: [
            'Tag the connection with the tenant (application_name) and sum database time per tenant; alert on the share, not only on CPU.',
            'Separate interactive and heavy work into different pools and roles, with a short statement_timeout for one and a long one for the other.',
            'Limit concurrency per tenant in each class, with a short queue, an explicit error (429 with Retry-After) and a rejection counter.',
            'Send reports and exports to a read replica, and export in key-based batches, not with one giant query.',
            'Define the objective trigger for promotion to a dedicated database and keep the tenant catalog ready for it.',
            'Keep the isolation test in CI and forbid using the pool outside the query function.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does Postgres row-level security solve the noisy neighbor?',
      answer:
        'No. Row-level security guarantees that a tenant only sees its own rows, which is data isolation, not resource isolation. A tenant query under RLS still uses the same CPU, the same I/O and the same pool connection. The noisy neighbor problem is about shared capacity, and it is solved with concurrency limits, separate pools, per-role timeouts and, in the extreme, a dedicated database.',
    },
    {
      question: 'Is per-request rate limiting at the edge not enough?',
      answer:
        'It helps, but it measures the wrong thing. An export request can cost a thousand times more database time than a screen query, so 100 requests per minute mean very different things. A per-tenant concurrency limit at the database layer measures what is actually scarce, which is connection and execution time. The two complement each other: the edge protects against volume, and the database limiter protects against cost per request.',
    },
    {
      question: 'What if the large customer complains about the 429 on the report?',
      answer:
        'The 429 should be rare in normal use and come with guidance: Retry-After and, for heavy jobs, an asynchronous flow in which the report is generated in the background and delivered by link or email. That also improves their experience, since they stop staring at a spinner for two minutes. If the customer needs more concurrency and pays for it, the answer is a higher ceiling on their plan or promotion to a dedicated database, not removing the limit for everyone.',
    },
  ],
  conclusion: {
    title: 'In a shared database, the per-customer limit is what keeps the contract with everyone else',
    description:
      'A legitimate customer with a heavy report can occupy the pool and the database CPU and leave 399 customers with 4-second screens. The path is to measure usage per tenant with application_name and accumulated database time, separate interactive and heavy load into pools and roles with distinct timeouts, limit concurrency per tenant with a short queue, an explicit error and a counter, send analytical load to a replica, define an objective trigger to promote the customer who outgrew the shared setup to a dedicated database, and keep an isolation test in CI. That way the cost of one database per customer is only paid by whoever really needs it.',
    cta: 'Review the multi-tenant architecture of my SaaS',
  },
  related: [
    {
      label: 'Exhausted database connection limit: the pool becomes the service bottleneck',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Per-customer rate limit at the edge: protecting the service without punishing the partner',
      to: '/blog/limite-taxa-por-cliente-na-borda-proteger-servico-sem-punir-parceiro',
    },
    {
      label: 'Backend architecture and modernization service',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Un SaaS con 400 clientes corre sobre un único Postgres compartido y responde en 120 ms de p99 desde hace un año. Un lunes de cierre de mes, el cliente Atacado Norte pide su reporte mensual: seis consultas en paralelo, cada una recorriendo 38 millones de filas. La CPU de la base llega al 92%, el pool de 40 conexiones queda entero en manos de ese cliente, y los otros 399 clientes ven pantallas de 4 segundos o errores de timeout. Soporte abre 60 tickets en 20 minutos; ninguno es de Atacado Norte, que solo está esperando su reporte. La reacción habitual es crear una base de datos por cliente, una respuesta cara para un problema que casi siempre cabe en límites bien colocados. Este artículo muestra cómo identificar quién consume la base antes del incidente, cómo aislar la carga con un límite de concurrencia por tenant, pools separados por clase de carga y roles con timeouts distintos, cuándo tiene sentido promover un cliente a su propia base y cómo demostrar en una prueba que el aislamiento funciona.',
  sections: [
    {
      title: 'El cliente que usa el producto como estaba previsto y tumba a los demás',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El vecino ruidoso rara vez es abuso. Es un cliente legítimo haciendo algo que el producto permite: exportar un año de pedidos, importar una planilla de 200 mil filas, abrir un panel con un filtro demasiado abierto o un script de integración que consulta la API en bucle. El problema no está en la intención, sino en un recurso compartido sin división de uso: CPU de la base, conexiones, I/O, caché de buffers y locks. Quien llega primero y pide más se queda con la mayor parte.',
        },
        {
          type: 'paragraph',
          value:
            'El peor efecto está en el pool de conexiones. Cada consulta pesada retiene una conexión durante segundos, el pool tiene tamaño fijo y las peticiones cortas de los demás clientes esperan en la cola de conexión. La base tendría capacidad para atenderlas, pero ni siquiera llegan a ella. El usuario de Atacado Norte, al no ver el reporte, hace clic en reintentar, y cada clic añade seis consultas más a la tormenta. Sin un límite por tenant, el intento de recuperación del cliente empeora el incidente de todos.',
        },
        {
          type: 'table',
          columns: ['Recurso compartido', 'Cómo lo consume el vecino', 'Qué ven los demás'],
          rows: [
            ['Conexiones del pool', 'Consultas largas retienen conexiones durante segundos', 'Espera por conexión, timeout antes de llegar a la base'],
            ['CPU e I/O de la base', 'Recorrido grande, ordenación, agregación sin índice', 'Toda consulta se vuelve más lenta, incluso las indexadas'],
            ['Caché de buffers', 'El recorrido secuencial expulsa las páginas calientes de los demás', 'Consultas antes rápidas pasan a leer del disco'],
            ['Locks', 'Transacción larga o DDL en pleno horario laboral', 'Escrituras simples esperando y luego fallando'],
          ],
        },
      ],
    },
    {
      title: 'Encontrar al vecino antes del incidente: medir el uso por tenant',
      blocks: [
        {
          type: 'paragraph',
          value:
            'pg_stat_statements agrupa las consultas por texto normalizado, así que no separa un tenant de otro: el mismo SELECT con otro tenant_id se convierte en una sola fila. Para atribuir el consumo al cliente, la aplicación tiene que llevar la identidad hasta la base. La forma más barata es ajustar el application_name de la conexión en el momento en que se presta, lo que la hace visible en pg_stat_activity, y sumar en la propia aplicación el tiempo de base por tenant. La primera consulta responde "quién está ocupando la base ahora"; el segundo número responde "quién ocupa la mayor parte de la base a lo largo del día", que es lo que aparece en el panel antes de convertirse en incidente.',
        },
        {
          type: 'code',
          value: sqlCode,
        },
        {
          type: 'paragraph',
          value:
            'Con esto, la pregunta de la guardia cambia de "¿por qué está lenta la base?" a "¿qué tenant está por encima del 30% del tiempo de base y desde hace cuánto?". Una alerta sobre esa participación, y no solo sobre la CPU, avisa minutos antes de que suba el p99 de los demás. También conviene guardar el ranking diario: muestra qué clientes crecen rápido y cuáles deberían estar en otro plan.',
        },
      ],
    },
    {
      title: 'Aislar con límites, sin una base por cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El orden de ataque va de lo más barato a lo más caro. Primero, separar las clases de carga: la pantalla interactiva y el reporte pesado no deben compartir pool ni rol. El reporte recibe un pool pequeño, un rol con timeout largo y, cuando es posible, una réplica de lectura. La pantalla interactiva queda con un pool grande y un timeout corto de 3 segundos, que mata las consultas descontroladas antes de que retengan la conexión durante minutos.',
        },
        {
          type: 'paragraph',
          value:
            'Segundo, limitar la concurrencia por tenant dentro de cada clase. El limitador siguiente da a cada cliente un tope de consultas simultáneas y una cola corta con plazo. El exceso espera poco y luego recibe un error explícito, que la API traduce en un 429 con Retry-After. Cuando Atacado Norte dispara seis consultas, una corre y las otras esperan en su propia cola, sin tocar el pool de los demás.',
        },
        {
          type: 'code',
          value: limitadorCode,
        },
        {
          type: 'code',
          value: poolsCode,
        },
        {
          type: 'paragraph',
          value:
            'El limitador vive en el proceso, así que el tope vale por instancia. Con 12 instancias y maxPorTenant 4, un tenant puede llegar a 48 consultas simultáneas. Para un tope global exacto, divida el límite deseado entre el número de instancias o use un contador compartido en Redis; en la práctica, la división simple ya resuelve la mayoría de los incidentes, porque el objetivo es impedir que un cliente ocupe todo, no medir la concurrencia exacta.',
        },
      ],
    },
    {
      title: 'Aislamiento de datos y cuándo promover un tenant a su propia base',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Los límites protegen la latencia de los demás, pero no eliminan la disputa por I/O y caché en una base única. El siguiente paso no es "una base por cliente" para todos, sino capas de aislamiento a las que el cliente sube cuando lo necesita. La mayoría de los tenants se queda en el pool compartido, que es el más barato de operar. Los grandes pasan a un nivel más aislado, y la aplicación resuelve la conexión por tenant, de modo que el código de negocio no cambia.',
        },
        {
          type: 'table',
          columns: ['Nivel', 'Aislamiento', 'Costo operativo', 'Cuándo usarlo'],
          rows: [
            ['Pool compartido, límites por tenant', 'Concurrencia y timeouts, sin aislar I/O ni caché', 'Bajo: una base, un esquema', 'Estándar para la gran mayoría de los clientes'],
            ['Réplica de lectura para reportes', 'Saca la carga analítica del primario', 'Medio: hay que tolerar el lag de la réplica', 'Reportes y exportaciones de cualquier tenant'],
            ['Esquema por tenant en la misma base', 'Organización y respaldo granular, pero CPU e I/O siguen compartidos', 'Medio a alto: migración aplicada en N esquemas', 'Exigencia contractual de separación lógica'],
            ['Base dedicada', 'CPU, I/O, caché y ventana de mantenimiento propios', 'Alto: migración, respaldo, monitoreo y costo por instancia', 'Cliente que por sí solo supera el 20% a 30% del uso, o exige un SLA propio'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El disparador de promoción debe ser objetivo y venir del ranking que ya mide: participación superior al 25% del tiempo de base durante más de una semana, o necesidad de una ventana de mantenimiento propia, o un contrato que paga lo suficiente para el costo de la instancia. Para que la promoción sea una operación de rutina y no un proyecto, mantenga desde el inicio un catálogo de tenants con el campo de destino de conexión y el tenant_id en toda tabla. Migrar un tenant pasa a ser copiar las filas por tenant_id a la base nueva, validar, cambiar el destino en el catálogo y borrar el origen tras un periodo de seguridad.',
        },
      ],
    },
    {
      title: 'Demostrar que el aislamiento funciona y evitar que retroceda',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El aislamiento que no se prueba se pierde en el primer refactor que usa el pool directamente, sin pasar por la capa de límite. La prueba de propiedad es simple: un tenant satura el limitador mientras otro hace una llamada corta, y la espera del segundo debe quedar cerca del tiempo de su propia consulta. La prueba también comprueba que el exceso del ruidoso fue rechazado y contado, y que el cupo vuelve incluso cuando la consulta falla.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'ordered',
          items: [
            'Marque la conexión con el tenant (application_name) y sume el tiempo de base por tenant; alerte por la participación, no solo por la CPU.',
            'Separe lo interactivo y lo pesado en pools y roles distintos, con statement_timeout corto para uno y largo para el otro.',
            'Limite la concurrencia por tenant en cada clase, con cola corta, error explícito (429 con Retry-After) y contador de rechazos.',
            'Envíe reportes y exportaciones a una réplica de lectura, y exporte en lotes por clave, no con una consulta gigante.',
            'Defina el disparador objetivo de promoción a base dedicada y mantenga el catálogo de tenants listo para ello.',
            'Mantenga la prueba de aislamiento en el CI y prohíba usar el pool fuera de la función de consulta.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿El row-level security de Postgres resuelve al vecino ruidoso?',
      answer:
        'No. Row-level security garantiza que un tenant solo vea sus propias filas, lo que es aislamiento de datos, no de recursos. Una consulta de un tenant bajo RLS sigue usando la misma CPU, el mismo I/O y la misma conexión del pool. El problema del vecino ruidoso es de capacidad compartida, y se resuelve con límites de concurrencia, pools separados, timeouts por rol y, en el extremo, base dedicada.',
    },
    {
      question: '¿No basta con un rate limit por petición en el borde?',
      answer:
        'Ayuda, pero mide lo que no es. Una petición de exportación puede costar mil veces más tiempo de base que una consulta de pantalla, así que 100 peticiones por minuto significan cosas muy distintas. El límite de concurrencia por tenant en la capa de base mide lo que realmente escasea, que es el tiempo de conexión y de ejecución. Los dos se complementan: el borde protege contra el volumen, y el limitador de base protege contra el costo por petición.',
    },
    {
      question: '¿Y si el cliente grande se queja del 429 en el reporte?',
      answer:
        'El 429 debe ser raro en el uso normal y venir con orientación: Retry-After y, para trabajos pesados, un flujo asíncrono en el que el reporte se genera en segundo plano y se entrega por enlace o correo. Eso mejora también su experiencia, porque deja de mirar un spinner durante dos minutos. Si el cliente necesita más concurrencia y la paga, la respuesta es un tope mayor en su plan o la promoción a base dedicada, no quitar el límite para todos.',
    },
  ],
  conclusion: {
    title: 'En una base compartida, el límite por cliente es lo que mantiene el contrato con todos los demás',
    description:
      'Un cliente legítimo con un reporte pesado puede ocupar el pool y la CPU de la base y dejar a 399 clientes con pantallas de 4 segundos. El camino es medir el uso por tenant con application_name y tiempo de base acumulado, separar la carga interactiva y la pesada en pools y roles con timeouts distintos, limitar la concurrencia por tenant con cola corta, error explícito y contador, enviar la carga analítica a una réplica, definir un disparador objetivo para promover a base dedicada al cliente que superó lo compartido y mantener una prueba de aislamiento en el CI. Así el costo de una base por cliente solo lo paga quien de verdad lo necesita.',
    cta: 'Revisar la arquitectura multi-tenant de mi SaaS',
  },
  related: [
    {
      label: 'Límite de conexiones de la base agotado: el pool se vuelve el cuello de botella del servicio',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Límite de tasa por cliente en el borde: proteger el servicio sin castigar al socio',
      to: '/blog/limite-taxa-por-cliente-na-borda-proteger-servico-sem-punir-parceiro',
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
