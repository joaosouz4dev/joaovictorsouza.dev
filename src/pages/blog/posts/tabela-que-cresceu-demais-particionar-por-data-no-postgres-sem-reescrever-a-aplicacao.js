// Conteudo do artigo: tabela que cresceu demais e particionamento por data no Postgres. Por que a
// retencao por DELETE e o tamanho do indice sufocam uma tabela unica, o que o particionamento
// resolve e o que nao resolve, como transformar a tabela existente em particao sem copiar nada e
// sem mudar uma linha da aplicacao, a troca em uma transacao curta e a rotina que cria particoes
// a frente, expira as antigas e vigia a particao padrao.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const preparoCode = `-- Estado de partida: eventos_pedido, 1,2 TB, PK (id), coluna criado_em timestamptz NOT NULL.
-- Nada abaixo bloqueia leitura ou escrita da tabela em producao.

-- 1. Tabela nova, particionada por mes, com a mesma forma. A PK inclui a chave de particao:
--    o Postgres so garante unicidade dentro de cada particao, entao criado_em entra na PK.
CREATE TABLE eventos_pedido_novo (
  id         bigint      NOT NULL,
  pedido_id  bigint      NOT NULL,
  tipo       text        NOT NULL,
  payload    jsonb       NOT NULL,
  criado_em  timestamptz NOT NULL,
  PRIMARY KEY (id, criado_em)
) PARTITION BY RANGE (criado_em);

-- 2. Particoes futuras e uma particao padrao como rede de seguranca (deve ficar sempre vazia).
CREATE TABLE eventos_pedido_2026_12 PARTITION OF eventos_pedido_novo
  FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
CREATE TABLE eventos_pedido_2027_01 PARTITION OF eventos_pedido_novo
  FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');
CREATE TABLE eventos_pedido_padrao PARTITION OF eventos_pedido_novo DEFAULT;
CREATE INDEX ON eventos_pedido_novo (pedido_id, criado_em);

-- 3. Na tabela antiga: os indices que a particao precisara ter, criados sem bloquear.
--    No ATTACH, o Postgres reaproveita indice equivalente em vez de construir outro.
SET lock_timeout = '2s';
CREATE UNIQUE INDEX CONCURRENTLY eventos_pedido_id_criado_em_uq
  ON eventos_pedido (id, criado_em);
CREATE INDEX CONCURRENTLY eventos_pedido_pedido_criado_idx
  ON eventos_pedido (pedido_id, criado_em);

-- 4. O CHECK que prova ao ATTACH que todas as linhas cabem no intervalo. Com ele validado,
--    o Postgres nao varre 1,2 TB para conferir. NOT VALID e instantaneo; VALIDATE le a tabela
--    sem impedir leitura nem escrita.
ALTER TABLE eventos_pedido
  ADD CONSTRAINT eventos_pedido_limite
  CHECK (criado_em < '2026-12-01 00:00:00+00') NOT VALID;
ALTER TABLE eventos_pedido VALIDATE CONSTRAINT eventos_pedido_limite;`;

const trocaCode = `-- A troca. Tudo aqui e catalogo: nenhum comando le dados.
-- Se o lock_timeout estourar, a transacao inteira volta e tentamos de novo.
BEGIN;
SET LOCAL lock_timeout = '2s';

LOCK TABLE eventos_pedido IN ACCESS EXCLUSIVE MODE;

-- A PK da tabela antiga passa a ser (id, criado_em), igual a da tabela particionada.
ALTER TABLE eventos_pedido DROP CONSTRAINT eventos_pedido_pkey;
ALTER TABLE eventos_pedido
  ADD CONSTRAINT eventos_pedido_pkey PRIMARY KEY USING INDEX eventos_pedido_id_criado_em_uq;

-- Os nomes trocam de lugar: a aplicacao continua falando com eventos_pedido.
ALTER TABLE eventos_pedido RENAME TO eventos_pedido_legado;
ALTER TABLE eventos_pedido_novo RENAME TO eventos_pedido;

-- A tabela antiga vira a particao de tudo que existe ate o fim do mes corrente.
ALTER TABLE eventos_pedido
  ATTACH PARTITION eventos_pedido_legado
  FOR VALUES FROM (MINVALUE) TO ('2026-12-01 00:00:00+00');

-- A sequencia segue alimentando o id, agora pela tabela pai.
ALTER SEQUENCE eventos_pedido_id_seq OWNED BY eventos_pedido.id;
ALTER TABLE eventos_pedido ALTER COLUMN id SET DEFAULT nextval('eventos_pedido_id_seq');
ALTER TABLE eventos_pedido_legado ALTER COLUMN id DROP DEFAULT;

COMMIT;

-- Conferir: tudo que existia esta na particao legada, o resto vai para as novas.
SELECT tableoid::regclass AS particao, count(*) FROM eventos_pedido
WHERE criado_em >= now() - interval '1 hour' GROUP BY 1;`;

const manutencaoCode = `// manter-particoes.js - roda diariamente (cron). Idempotente: pode rodar duas vezes sem efeito.
import pg from 'pg';

const TABELA = 'eventos_pedido';
const MESES_A_FRENTE = 3;
const RETENCAO_MESES = 12;
// Enquanto a particao legada existir, ela cobre tudo ate esta data. Remover depois que ela cair.
const LEGADO_ATE = new Date('2026-12-01T00:00:00Z');

const inicioDoMes = (data, deslocamento) =>
  new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + deslocamento, 1));
const dia = (data) => data.toISOString().slice(0, 10);
const sufixo = (data) =>
  data.getUTCFullYear() + '_' + String(data.getUTCMonth() + 1).padStart(2, '0');

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 55P03 = lock_not_available: um relatorio longo segurava a tabela. Tenta de novo em vez de
// deixar o ALTER na fila, porque tudo que chega depois dele esperaria atras.
async function comRetentativa(operacao, tentativas = 5) {
  for (let i = 1; ; i += 1) {
    try {
      return await operacao();
    } catch (erro) {
      if (erro.code !== '55P03' || i >= tentativas) throw erro;
      await esperar(1000 * i);
    }
  }
}

async function criarParticoesFuturas(client, hoje) {
  for (let i = 0; i <= MESES_A_FRENTE; i += 1) {
    const de = inicioDoMes(hoje, i);
    if (de < LEGADO_ATE) continue;
    const ate = inicioDoMes(hoje, i + 1);
    await comRetentativa(() =>
      client.query(
        'CREATE TABLE IF NOT EXISTS ' + TABELA + '_' + sufixo(de) +
          ' PARTITION OF ' + TABELA +
          " FOR VALUES FROM ('" + dia(de) + " 00:00:00+00') TO ('" + dia(ate) + " 00:00:00+00')",
      ),
    );
  }
}

async function removerExpiradas(client, hoje) {
  const limite = inicioDoMes(hoje, -RETENCAO_MESES);
  const { rows } = await client.query(
    'SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid ' +
      "WHERE i.inhparent = $1::regclass AND c.relname ~ '^eventos_pedido_[0-9]{4}_[0-9]{2}$'",
    [TABELA],
  );
  for (const { relname } of rows) {
    const [, ano, mes] = relname.match(/_(\\d{4})_(\\d{2})$/);
    if (new Date(Date.UTC(Number(ano), Number(mes) - 1, 1)) >= limite) continue;
    await comRetentativa(() => client.query('DROP TABLE IF EXISTS ' + relname));
  }
}

async function vigiarParticaoPadrao(client) {
  const { rows } = await client.query(
    'SELECT EXISTS (SELECT 1 FROM ' + TABELA + '_padrao) AS tem_linha',
  );
  if (rows[0].tem_linha) {
    throw new Error('Ha linhas na particao padrao: falta criar uma particao a frente');
  }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("SET lock_timeout = '2s'");
  const hoje = new Date();
  await criarParticoesFuturas(client, hoje);
  await removerExpiradas(client, hoje);
  await vigiarParticaoPadrao(client);
} finally {
  client.release();
  await pool.end();
}`;

const planoCode = `-- Com a chave de particao no filtro, o planejador descarta as particoes que nao interessam.
EXPLAIN (ANALYZE, COSTS OFF)
SELECT id, tipo, criado_em
FROM eventos_pedido
WHERE pedido_id = 918273 AND criado_em >= now() - interval '7 days';

--  Append (actual time=0.031..0.044 rows=12 loops=1)
--    Subplans Removed: 13
--    ->  Index Scan using eventos_pedido_2026_12_pedido_id_criado_em_idx
--          on eventos_pedido_2026_12 (actual time=0.029..0.040 rows=12 loops=1)
--          Index Cond: ((pedido_id = 918273) AND (criado_em >= (now() - '7 days'::interval)))
--  Planning Time: 0.9 ms   Execution Time: 0.07 ms

-- O que quebra a poda: aplicar funcao na coluna da chave.
-- Ruim: WHERE date(criado_em) = '2026-12-03'     (le todas as particoes)
-- Bom:  WHERE criado_em >= '2026-12-03' AND criado_em < '2026-12-04'

-- O pai particionado nao e analisado pelo autovacuum. Estatisticas do pai (usadas em
-- joins e em agregacoes) so se atualizam com ANALYZE manual, por exemplo uma vez por dia.
ANALYZE eventos_pedido;`;

const diagramaPt = `Antes e depois da troca (as setas mostram para onde cada INSERT e cada consulta vai).

  ANTES                                   DEPOIS

  aplicacao                               aplicacao  (mesmo SQL, mesmo nome de tabela)
     |                                       |
  eventos_pedido (1,2 TB)                 eventos_pedido (pai, sem dados proprios)
  PK (id)                                 PK (id, criado_em)
  DELETE diario de 12 meses atras             |
                                              +-- eventos_pedido_legado   ate 2026-12-01 (1,2 TB)
                                              +-- eventos_pedido_2026_12  mes corrente de dados novos
                                              +-- eventos_pedido_2027_01  a frente
                                              +-- eventos_pedido_padrao   deve estar sempre vazia

  Daqui a 12 meses: DROP TABLE eventos_pedido_legado (milissegundos, sem DELETE, sem VACUUM).`;

const diagramaEn = `Before and after the swap (the arrows show where each INSERT and each query goes).

  BEFORE                                  AFTER

  application                             application  (same SQL, same table name)
     |                                       |
  eventos_pedido (1.2 TB)                 eventos_pedido (parent, no data of its own)
  PK (id)                                 PK (id, criado_em)
  daily DELETE of 12 months ago               |
                                              +-- eventos_pedido_legado   up to 2026-12-01 (1.2 TB)
                                              +-- eventos_pedido_2026_12  new data for the month
                                              +-- eventos_pedido_2027_01  ahead of time
                                              +-- eventos_pedido_padrao   must always be empty

  12 months from now: DROP TABLE eventos_pedido_legado (milliseconds, no DELETE, no VACUUM).`;

const diagramaEs = `Antes y después del cambio (las flechas muestran adónde va cada INSERT y cada consulta).

  ANTES                                   DESPUÉS

  aplicación                              aplicación  (mismo SQL, mismo nombre de tabla)
     |                                       |
  eventos_pedido (1,2 TB)                 eventos_pedido (padre, sin datos propios)
  PK (id)                                 PK (id, criado_em)
  DELETE diario de hace 12 meses              |
                                              +-- eventos_pedido_legado   hasta 2026-12-01 (1,2 TB)
                                              +-- eventos_pedido_2026_12  datos nuevos del mes
                                              +-- eventos_pedido_2027_01  por adelantado
                                              +-- eventos_pedido_padrao   debe estar siempre vacía

  Dentro de 12 meses: DROP TABLE eventos_pedido_legado (milisegundos, sin DELETE, sin VACUUM).`;

const pt = {
  intro:
    'A tabela eventos_pedido de uma plataforma de pedidos chegou a 1,2 TB e 2,3 bilhões de linhas. A política é guardar 12 meses, e o DELETE diário que apaga o mês vencido foi de 20 minutos para 9 horas, gerando 40 GB de WAL por noite, inchando o índice e deixando o autovacuum correndo atrás o dia inteiro. Particionar por data resolve isso, mas a primeira ideia, criar uma tabela nova e copiar 1,2 TB, parece exigir janela de manutenção e mudança na aplicação. Este artigo mostra como fazer sem nenhum dos dois: usar a própria tabela existente como a primeira partição, trocar os nomes em uma transação de milissegundos, manter as partições por uma rotina idempotente e evitar as armadilhas que fazem a poda de partições não funcionar.',
  sections: [
    {
      title: 'Por que a tabela única parou de funcionar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Tabelas de eventos, logs e histórico crescem em um só sentido, e o Postgres trata todas as linhas como iguais. Os problemas aparecem na manutenção, não na consulta do dia a dia. Apagar o mês vencido com DELETE marca cerca de 190 milhões de linhas como mortas, grava tudo no WAL, gera trabalho para o autovacuum e não devolve espaço em disco ao sistema operacional. O índice de 310 GB só cresce, porque as páginas liberadas por exclusões só são reaproveitadas de forma irregular. E cada tarefa de administração, como backup lógico, reindexação ou troca de tipo de coluna, passa a ser proporcional ao tamanho total, e não ao tamanho do que importa.',
        },
        {
          type: 'table',
          columns: ['Operação', 'Tabela única de 1,2 TB', 'Particionada por mês'],
          rows: [
            ['Expirar o mês vencido', 'DELETE de 190 milhões de linhas em 9 h, 40 GB de WAL', 'DROP TABLE da partição, milissegundos, quase sem WAL'],
            ['Espaço devolvido ao disco', 'Não volta sem VACUUM FULL ou reescrita', 'Volta na hora, o arquivo da partição some'],
            ['Autovacuum', 'Uma tabela gigante, tarefa longa e sujeita a atraso', 'Várias tabelas pequenas, cada uma tratada no seu ritmo'],
            ['Índices', 'Um índice de 310 GB que não cabe na memória', 'Índices por partição, o do mês corrente cabe em cache'],
            ['Consulta com filtro de data', 'Depende do índice escolhido pelo planejador', 'Descarta as partições fora do intervalo antes de ler'],
            ['Consulta sem filtro de data', 'Um índice', 'Uma busca no índice de cada partição'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha da tabela é a que o resto do artigo precisa respeitar: particionar não acelera nada que não use a chave. Ele troca um problema de manutenção por uma regra de acesso, e vale a pena quando a tabela tem uma dimensão de tempo clara, um ciclo de vida de dados com prazo e a maioria das consultas filtrando por essa dimensão.',
        },
      ],
    },
    {
      title: 'O que o particionamento resolve e o que ele não resolve',
      blocks: [
        {
          type: 'list',
          items: [
            'Resolve a retenção: expirar dados vira DROP TABLE de uma partição inteira, sem DELETE, sem VACUUM e sem WAL de exclusão.',
            'Resolve a manutenção: autovacuum, ANALYZE e REINDEX passam a atuar em pedaços de dezenas de gigabytes, e as partições antigas, que não mudam mais, quase não dão trabalho.',
            'Resolve parte da leitura: consultas com filtro na chave leem só as partições do intervalo, e o índice quente fica pequeno.',
            'Não resolve consulta sem filtro na chave: SELECT ... WHERE id = $1 passa a consultar o índice de todas as partições, 14 buscas em vez de uma. Ainda são rápidas, mas é custo novo.',
            'Não resolve unicidade global: a chave primária e qualquer índice único precisam conter a coluna de partição. O id continua único na prática pela sequência, mas o banco só garante (id, criado_em).',
            'Não resolve chave estrangeira apontando para a tabela: uma FK que referencia a coluna id precisaria referenciar (id, criado_em), o que obriga a mudar as tabelas filhas. Em tabelas de eventos e logs, que normalmente só apontam para fora, isso não aparece.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A granularidade segue o ciclo de vida, não a vontade de ter muitas partições. Com 86 GB de dados novos por mês e retenção de 12 meses, uma partição mensal é a escolha natural: 13 partições ativas, cada uma pequena o bastante para ser manipulada e grande o bastante para não gerar milhares de tabelas. Partição diária só compensa em volumes muito maiores; o planejador gasta tempo por partição, e centenas delas já deixam o planejamento visivelmente mais lento.',
        },
      ],
    },
    {
      title: 'Usar a própria tabela como primeira partição',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O caminho óbvio, criar a tabela particionada e copiar tudo com INSERT ... SELECT, exige gravar 1,2 TB de novo, manter as duas tabelas sincronizadas durante a cópia e fazer um corte. Existe um atalho: uma tabela comum pode ser anexada como partição de uma tabela particionada com ATTACH PARTITION, desde que seu conteúdo caiba no intervalo declarado. A tabela antiga vira a partição que cobre todo o passado até o fim do mês corrente, e as linhas novas depois dessa data caem nas partições novas. Nada é copiado, e a aplicação continua usando o mesmo nome de tabela.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'O preparo é feito com a tabela em uso. Há duas armadilhas. A primeira é que o ATTACH precisa de índices equivalentes aos da tabela pai, e se não os encontrar, constrói novos com a tabela bloqueada, o que para 1,2 TB significa horas de indisponibilidade. A solução é criá-los antes, com CREATE INDEX CONCURRENTLY, na tabela antiga. A segunda é que o ATTACH também confere se todas as linhas cabem no intervalo, lendo a tabela inteira, a menos que exista um CHECK validado que já prove isso. O CHECK entra como NOT VALID, que é instantâneo, e o VALIDATE lê a tabela sem bloquear leitura nem escrita.',
        },
        {
          type: 'code',
          value: preparoCode,
        },
        {
          type: 'paragraph',
          value:
            'Dois detalhes do preparo costumam passar despercebidos. O limite do CHECK precisa ser uma data futura, no fim do mês corrente, porque a tabela antiga continuará recebendo escrita até a troca e o CHECK não pode ser violado nesse intervalo. E os literais de data levam o deslocamento explícito (+00): um timestamptz escrito sem deslocamento é interpretado no fuso da sessão, e uma divergência entre o fuso do script e o do servidor desloca todas as fronteiras de partição em algumas horas.',
        },
      ],
    },
    {
      title: 'A troca em uma transação curta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com tudo pronto, a troca é uma transação que só mexe em catálogo. A chave primária da tabela antiga passa a ser (id, criado_em) reaproveitando o índice já construído, os nomes trocam de lugar, a tabela antiga é anexada como partição e a sequência do id passa a ser alimentada pela tabela pai. A transação pede ACCESS EXCLUSIVE na tabela e, por isso, usa lock_timeout: se um relatório longo estiver segurando a tabela, ela falha em 2 segundos em vez de formar uma fila atrás de si, e a tentativa se repete.',
        },
        {
          type: 'code',
          value: trocaCode,
        },
        {
          type: 'paragraph',
          value:
            'No ensaio com tráfego reproduzido, a transação levou 410 ms. Na produção, a primeira tentativa caiu no lock_timeout por causa de uma consulta de relatório aberta havia 50 segundos, a segunda passou, e o p99 da API não mudou. O log do servidor com nível DEBUG1, no ensaio, mostrou a mensagem de que a restrição da partição estava implícita nas restrições existentes, que é a confirmação de que o ATTACH não varreu a tabela. Se ele varrer, a transação demora e você descobre no ensaio, não na produção.',
        },
        {
          type: 'paragraph',
          value:
            'O que não vem junto precisa ser verificado: permissões (GRANT) da tabela, gatilhos, políticas de segurança por linha, comentários, publicações de replicação lógica e qualquer ferramenta de CDC que observe a tabela pelo nome. Publicações com publish_via_partition_root = true entregam as mudanças pelo nome da tabela pai, o que preserva o contrato para os consumidores.',
        },
      ],
    },
    {
      title: 'Manter as partições: criar à frente, expirar e vigiar a padrão',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Particionamento sem rotina de manutenção só adia a falha. Se faltar a partição do mês, a linha vai para a partição padrão, ou, se não houver uma, o INSERT falha com "no partition of relation found for row" e a aplicação deixa de gravar eventos. A rotina precisa criar partições com antecedência, expirar as vencidas e avisar quando algo foge do esperado. Ela é idempotente (CREATE TABLE IF NOT EXISTS, DROP TABLE IF EXISTS) e roda todo dia, para que um dia perdido não vire um problema no mês seguinte.',
        },
        {
          type: 'code',
          value: manutencaoCode,
        },
        {
          type: 'list',
          items: [
            'Criar com 3 meses de antecedência dá 90 dias para alguém perceber que a rotina parou, e a verificação da partição padrão transforma uma falha silenciosa em erro explícito no agendador.',
            'A partição padrão é rede de segurança, não destino: ela precisa estar vazia, e uma linha nela pede ação. Criar uma partição nova exige conferir se a padrão não contém linhas do intervalo, e quanto maior a padrão, mais demorada e bloqueante é essa conferência.',
            'DETACH PARTITION ... CONCURRENTLY não funciona em tabela com partição padrão. Como DROP TABLE de uma partição leva apenas milissegundos de bloqueio na tabela pai, a rotina usa lock_timeout com retentativa em vez disso.',
            'A partição legada sai da rotina de propósito. Em dezembro de 2027, quando seu último dado completar 12 meses, ela é removida com um DROP TABLE, e esse é o ganho mais visível: 1,2 TB devolvidos em milissegundos. Até lá, a retenção continua sendo feita por DELETE em lotes nessa partição, só que agora sem pressão, porque o dado novo não vive mais nela.',
          ],
        },
      ],
    },
    {
      title: 'Poda de partições, planos e armadilhas na aplicação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A poda é o que faz o particionamento acelerar leitura, e ela depende de o filtro na chave ser comparável a uma constante ou a um parâmetro. Desde o Postgres 11, ela acontece também na execução, o que cobre now() e parâmetros de consultas preparadas. Funções aplicadas sobre a coluna da chave, como date(criado_em) ou to_char, desligam a poda e leem tudo.',
        },
        {
          type: 'code',
          value: planoCode,
        },
        {
          type: 'ordered',
          items: [
            'Procure no código as consultas sem criado_em no filtro: buscas por id, joins pela chave e telas que listam "os últimos N". Elas continuam funcionando, mas agora passam por todas as partições. Em muitos casos basta acrescentar um limite de data razoável, como os últimos 90 dias.',
            'Conferir o plano com EXPLAIN depois da troca, procurando por "Subplans Removed" ou por um Append que lista só as partições esperadas. Um Append com 14 filhas em uma consulta que deveria tocar uma é o sinal de que a poda não aconteceu.',
            'Revise ORMs que geram consultas com funções sobre a coluna ou que carregam a linha pela chave primária sozinha: a chave primária agora tem duas colunas, e uma operação de atualização que filtre só por id passa por todas as partições.',
            'Fique de olho em estatísticas e autovacuum: o pai não é analisado automaticamente, e cada partição nova começa sem estatísticas até receber dados. Um ANALYZE diário do pai e um olhar sobre o last_autovacuum das partições recentes evitam planos ruins.',
            'Avise quem consome a tabela diretamente (BI, exportações): se eles leem por intervalo, ganham poda de graça; se leem tudo, nada muda.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Vale a pena particionar uma tabela de 50 GB?',
      answer:
        'Em geral, não pelo tamanho, e sim pelo ciclo de vida. Uma tabela de 50 GB que nunca expira dados e é consultada por id não ganha nada, e perde com a chave composta. Já uma tabela de 50 GB com retenção de 30 dias e DELETE diário que já incha o índice ganha muito, porque expirar vira DROP TABLE. A regra prática é: se a dor é apagar dados antigos ou manter índices e vacuum de dados que nunca mudam, particione; se a dor é uma consulta lenta, olhe primeiro o índice e o plano.',
    },
    {
      question: 'Por que não usar uma extensão como pg_partman?',
      answer:
        'Pode e, em muitos casos, deve. O pg_partman automatiza a criação e a expiração que o script do artigo faz à mão, e em banco gerenciado costuma estar disponível. A troca sem copiar, com ATTACH PARTITION da tabela existente, é independente da extensão e funciona com ela. O script do artigo serve para quem não pode instalar extensões, ou quer uma rotina pequena, testável e visível no repositório da aplicação.',
    },
    {
      question: 'E se a tabela tiver chaves estrangeiras apontando para ela?',
      answer:
        'Esse é o caso em que o plano muda. A tabela particionada precisa de unicidade em (id, criado_em), então uma FK que referencia só o id deixa de ser possível, e as tabelas filhas teriam de guardar criado_em também. Antes de começar, liste as FKs de entrada com pg_constraint. Se existirem, avalie se elas precisam mesmo ser restrições do banco ou se podem virar validação na aplicação, e só prossiga quando a resposta estiver clara. FKs que saem da tabela para outras são aceitas e ficam intactas na partição legada.',
    },
  ],
  conclusion: {
    title: 'Particionar é trocar um problema de manutenção por uma regra de acesso',
    description:
      'A tabela de eventos de 1,2 TB estava presa a um DELETE de 9 horas e a um índice que só crescia, e a saída óbvia, copiar tudo para uma tabela particionada, pedia janela e mudança na aplicação. Anexar a própria tabela como partição, com índices criados antes de forma concorrente e um CHECK validado que dispensa a varredura, reduziu a troca a uma transação de catálogo de cerca de 400 ms, sem alterar uma linha de SQL da aplicação. O que mantém o resultado de pé é a rotina que cria partições à frente, expira as vencidas e vigia a partição padrão, e o cuidado de saber que consulta sem a chave de partição passa a custar uma busca por partição. Daqui a 12 meses, a partição legada de 1,2 TB some com um DROP TABLE.',
    cta: 'Revisar a retenção e o particionamento das tabelas do meu banco',
  },
  related: [
    {
      label: 'Migração de banco sem janela: expandir, migrar e contrair sem derrubar escrita',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
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
    'The eventos_pedido table of an order platform reached 1.2 TB and 2.3 billion rows. The policy is to keep 12 months, and the daily DELETE that removes the expired month went from 20 minutes to 9 hours, writing 40 GB of WAL per night, bloating the index and keeping autovacuum chasing its tail all day. Partitioning by date fixes this, but the first idea, creating a new table and copying 1.2 TB, seems to require a maintenance window and application changes. This article shows how to do it with neither: use the existing table itself as the first partition, swap the names in a transaction that lasts milliseconds, maintain the partitions with an idempotent routine and avoid the pitfalls that keep partition pruning from working.',
  sections: [
    {
      title: 'Why the single table stopped working',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Event, log and history tables grow in one direction, and Postgres treats all rows as equal. The problems show up in maintenance, not in day-to-day queries. Deleting the expired month with DELETE marks about 190 million rows as dead, writes everything to the WAL, creates work for autovacuum and does not return disk space to the operating system. The 310 GB index only grows, because pages freed by deletions are reused only irregularly. And every administrative task, such as a logical backup, a reindex or a column type change, becomes proportional to the total size rather than to the size of what matters.',
        },
        {
          type: 'table',
          columns: ['Operation', 'Single 1.2 TB table', 'Partitioned by month'],
          rows: [
            ['Expire the expired month', 'DELETE of 190 million rows in 9 h, 40 GB of WAL', 'DROP TABLE of the partition, milliseconds, almost no WAL'],
            ['Disk space returned', 'Does not come back without VACUUM FULL or a rewrite', 'Comes back immediately, the partition file disappears'],
            ['Autovacuum', 'One giant table, a long task prone to lag', 'Many small tables, each handled at its own pace'],
            ['Indexes', 'A 310 GB index that does not fit in memory', 'Per-partition indexes, the current month fits in cache'],
            ['Query with a date filter', 'Depends on the index the planner picks', 'Discards partitions outside the range before reading'],
            ['Query without a date filter', 'One index', 'One lookup in the index of each partition'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row of the table is the one the rest of the article has to respect: partitioning does not speed up anything that does not use the key. It trades a maintenance problem for an access rule, and it pays off when the table has a clear time dimension, a data lifecycle with a deadline and most queries filtering on that dimension.',
        },
      ],
    },
    {
      title: 'What partitioning solves and what it does not',
      blocks: [
        {
          type: 'list',
          items: [
            'It solves retention: expiring data becomes a DROP TABLE of a whole partition, with no DELETE, no VACUUM and no deletion WAL.',
            'It solves maintenance: autovacuum, ANALYZE and REINDEX work on pieces of tens of gigabytes, and old partitions, which no longer change, give almost no work.',
            'It solves part of reading: queries filtering on the key read only the partitions in the range, and the hot index stays small.',
            'It does not solve queries without a filter on the key: SELECT ... WHERE id = $1 now probes the index of every partition, 14 lookups instead of one. They are still fast, but it is a new cost.',
            'It does not solve global uniqueness: the primary key and any unique index must contain the partition column. The id stays unique in practice through the sequence, but the database only guarantees (id, criado_em).',
            'It does not solve foreign keys pointing at the table: an FK that references the id column would have to reference (id, criado_em), which forces changes in the child tables. In event and log tables, which normally only point outward, this does not come up.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Granularity follows the lifecycle, not the wish for many partitions. With 86 GB of new data per month and 12 months of retention, a monthly partition is the natural choice: 13 active partitions, each small enough to handle and large enough not to produce thousands of tables. Daily partitions only pay off at much larger volumes; the planner spends time per partition, and hundreds of them already make planning visibly slower.',
        },
      ],
    },
    {
      title: 'Using the table itself as the first partition',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The obvious path, creating the partitioned table and copying everything with INSERT ... SELECT, requires writing 1.2 TB again, keeping both tables in sync during the copy and doing a cutover. There is a shortcut: an ordinary table can be attached as a partition of a partitioned table with ATTACH PARTITION, as long as its contents fit in the declared range. The old table becomes the partition covering the entire past up to the end of the current month, and rows after that date land in the new partitions. Nothing is copied, and the application keeps using the same table name.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'The preparation happens while the table is in use. There are two traps. The first is that ATTACH needs indexes equivalent to those of the parent table, and if it does not find them it builds new ones with the table locked, which for 1.2 TB means hours of unavailability. The fix is to create them beforehand, with CREATE INDEX CONCURRENTLY, on the old table. The second is that ATTACH also checks that every row fits the range by reading the whole table, unless a validated CHECK already proves it. The CHECK goes in as NOT VALID, which is instant, and VALIDATE reads the table without blocking reads or writes.',
        },
        {
          type: 'code',
          value: preparoCode,
        },
        {
          type: 'paragraph',
          value:
            'Two details of the preparation tend to go unnoticed. The CHECK limit must be a future date, at the end of the current month, because the old table will keep receiving writes until the swap and the CHECK cannot be violated in the meantime. And the date literals carry an explicit offset (+00): a timestamptz written without an offset is interpreted in the session time zone, and a mismatch between the script time zone and the server one shifts every partition boundary by a few hours.',
        },
      ],
    },
    {
      title: 'The swap in a short transaction',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With everything ready, the swap is a transaction that only touches the catalog. The primary key of the old table becomes (id, criado_em) reusing the index already built, the names trade places, the old table is attached as a partition and the id sequence is now fed through the parent table. The transaction asks for ACCESS EXCLUSIVE on the table and therefore uses lock_timeout: if a long report is holding the table, it fails within 2 seconds instead of forming a queue behind itself, and the attempt is repeated.',
        },
        {
          type: 'code',
          value: trocaCode,
        },
        {
          type: 'paragraph',
          value:
            'In the rehearsal with replayed traffic, the transaction took 410 ms. In production, the first attempt hit lock_timeout because of a report query that had been open for 50 seconds, the second went through, and the API p99 did not change. The server log at DEBUG1 level, in the rehearsal, showed the message saying the partition constraint was implied by existing constraints, which is the confirmation that ATTACH did not scan the table. If it does scan, the transaction drags on and you find out in the rehearsal, not in production.',
        },
        {
          type: 'paragraph',
          value:
            'What does not come along has to be checked: the table permissions (GRANT), triggers, row-level security policies, comments, logical replication publications and any CDC tool that watches the table by name. Publications with publish_via_partition_root = true deliver changes under the parent table name, which preserves the contract for consumers.',
        },
      ],
    },
    {
      title: 'Maintaining partitions: create ahead, expire and watch the default',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Partitioning without a maintenance routine only postpones the failure. If the partition for the month is missing, the row goes to the default partition, or, if there is none, the INSERT fails with "no partition of relation found for row" and the application stops writing events. The routine has to create partitions ahead of time, expire the old ones and raise an alert when something goes off script. It is idempotent (CREATE TABLE IF NOT EXISTS, DROP TABLE IF EXISTS) and runs every day, so a missed day does not become a problem next month.',
        },
        {
          type: 'code',
          value: manutencaoCode,
        },
        {
          type: 'list',
          items: [
            'Creating 3 months ahead gives 90 days for someone to notice the routine stopped, and the default partition check turns a silent failure into an explicit scheduler error.',
            'The default partition is a safety net, not a destination: it must be empty, and a row in it calls for action. Creating a new partition requires checking that the default holds no rows in the range, and the bigger the default, the slower and more blocking that check is.',
            'DETACH PARTITION ... CONCURRENTLY does not work on a table with a default partition. Since DROP TABLE of a partition takes only milliseconds of lock on the parent table, the routine uses lock_timeout with a retry instead.',
            'The legacy partition is left out of the routine on purpose. In December 2027, when its last data turns 12 months old, it is removed with a single DROP TABLE, and that is the most visible gain: 1.2 TB returned in milliseconds. Until then, retention keeps being done with batched DELETE on that partition, only now without pressure, because new data no longer lives in it.',
          ],
        },
      ],
    },
    {
      title: 'Partition pruning, plans and application pitfalls',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Pruning is what makes partitioning speed up reads, and it depends on the filter on the key being comparable to a constant or a parameter. Since Postgres 11, it also happens at execution time, which covers now() and prepared statement parameters. Functions applied to the key column, such as date(criado_em) or to_char, turn pruning off and read everything.',
        },
        {
          type: 'code',
          value: planoCode,
        },
        {
          type: 'ordered',
          items: [
            'Search the code for queries without criado_em in the filter: lookups by id, joins on the key and screens listing "the latest N". They keep working, but now go through every partition. In many cases it is enough to add a reasonable date limit, such as the last 90 days.',
            'Check the plan with EXPLAIN after the swap, looking for "Subplans Removed" or an Append listing only the expected partitions. An Append with 14 children on a query that should touch one is the sign that pruning did not happen.',
            'Review ORMs that generate queries with functions over the column or that load a row by primary key alone: the primary key now has two columns, and an update that filters only by id goes through every partition.',
            'Keep an eye on statistics and autovacuum: the parent is not analyzed automatically, and each new partition starts without statistics until it receives data. A daily ANALYZE of the parent and a look at last_autovacuum on recent partitions prevent bad plans.',
            'Tell whoever reads the table directly (BI, exports): if they read by range, they get pruning for free; if they read everything, nothing changes.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is it worth partitioning a 50 GB table?',
      answer:
        'In general, not because of size but because of lifecycle. A 50 GB table that never expires data and is queried by id gains nothing and loses with the composite key. A 50 GB table with 30 days of retention and a daily DELETE that already bloats the index gains a lot, because expiring becomes DROP TABLE. The rule of thumb: if the pain is deleting old data or keeping indexes and vacuum on data that never changes, partition; if the pain is a slow query, look at the index and the plan first.',
    },
    {
      question: 'Why not use an extension such as pg_partman?',
      answer:
        'You can, and in many cases you should. pg_partman automates the creation and expiry that the article script does by hand, and on managed databases it is usually available. The copy-free swap, with ATTACH PARTITION of the existing table, is independent of the extension and works with it. The article script is for those who cannot install extensions, or want a small routine that is testable and visible in the application repository.',
    },
    {
      question: 'What if the table has foreign keys pointing at it?',
      answer:
        'That is the case where the plan changes. The partitioned table needs uniqueness on (id, criado_em), so an FK that references only the id is no longer possible, and the child tables would have to store criado_em as well. Before starting, list the incoming FKs with pg_constraint. If any exist, assess whether they really need to be database constraints or can become application validation, and proceed only when the answer is clear. FKs going out of the table to others are accepted and stay intact on the legacy partition.',
    },
  ],
  conclusion: {
    title: 'Partitioning trades a maintenance problem for an access rule',
    description:
      'The 1.2 TB events table was stuck with a 9-hour DELETE and an index that only grew, and the obvious way out, copying everything into a partitioned table, called for a window and application changes. Attaching the table itself as a partition, with indexes built beforehand concurrently and a validated CHECK that avoids the scan, reduced the swap to a catalog transaction of about 400 ms, without changing a line of application SQL. What keeps the result standing is the routine that creates partitions ahead, expires old ones and watches the default partition, and the awareness that a query without the partition key now costs one lookup per partition. In 12 months, the 1.2 TB legacy partition disappears with a DROP TABLE.',
    cta: 'Review retention and partitioning for the tables in my database',
  },
  related: [
    {
      label: 'Zero downtime database migration: expand, migrate and contract without stopping writes',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
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
    'La tabla eventos_pedido de una plataforma de pedidos llegó a 1,2 TB y 2.300 millones de filas. La política es guardar 12 meses, y el DELETE diario que borra el mes vencido pasó de 20 minutos a 9 horas, generando 40 GB de WAL por noche, hinchando el índice y dejando al autovacuum corriendo detrás todo el día. Particionar por fecha lo resuelve, pero la primera idea, crear una tabla nueva y copiar 1,2 TB, parece exigir una ventana de mantenimiento y cambios en la aplicación. Este artículo muestra cómo hacerlo sin ninguna de las dos: usar la propia tabla existente como primera partición, intercambiar los nombres en una transacción de milisegundos, mantener las particiones con una rutina idempotente y evitar las trampas que impiden que funcione la poda de particiones.',
  sections: [
    {
      title: 'Por qué la tabla única dejó de funcionar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Las tablas de eventos, logs e historial crecen en un solo sentido, y Postgres trata todas las filas como iguales. Los problemas aparecen en el mantenimiento, no en la consulta del día a día. Borrar el mes vencido con DELETE marca unos 190 millones de filas como muertas, lo escribe todo en el WAL, genera trabajo para el autovacuum y no devuelve espacio en disco al sistema operativo. El índice de 310 GB solo crece, porque las páginas liberadas por los borrados solo se reutilizan de forma irregular. Y cada tarea de administración, como un backup lógico, una reindexación o un cambio de tipo de columna, pasa a ser proporcional al tamaño total y no al tamaño de lo que importa.',
        },
        {
          type: 'table',
          columns: ['Operación', 'Tabla única de 1,2 TB', 'Particionada por mes'],
          rows: [
            ['Expirar el mes vencido', 'DELETE de 190 millones de filas en 9 h, 40 GB de WAL', 'DROP TABLE de la partición, milisegundos, casi sin WAL'],
            ['Espacio devuelto al disco', 'No vuelve sin VACUUM FULL o reescritura', 'Vuelve al instante, el archivo de la partición desaparece'],
            ['Autovacuum', 'Una tabla gigante, tarea larga y propensa a atrasarse', 'Muchas tablas pequeñas, cada una tratada a su ritmo'],
            ['Índices', 'Un índice de 310 GB que no cabe en memoria', 'Índices por partición, el del mes corriente cabe en caché'],
            ['Consulta con filtro de fecha', 'Depende del índice que elija el planificador', 'Descarta las particiones fuera del rango antes de leer'],
            ['Consulta sin filtro de fecha', 'Un índice', 'Una búsqueda en el índice de cada partición'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila de la tabla es la que el resto del artículo debe respetar: particionar no acelera nada que no use la clave. Cambia un problema de mantenimiento por una regla de acceso, y vale la pena cuando la tabla tiene una dimensión temporal clara, un ciclo de vida de datos con plazo y la mayoría de las consultas filtrando por esa dimensión.',
        },
      ],
    },
    {
      title: 'Qué resuelve el particionamiento y qué no',
      blocks: [
        {
          type: 'list',
          items: [
            'Resuelve la retención: expirar datos pasa a ser un DROP TABLE de una partición entera, sin DELETE, sin VACUUM y sin WAL de borrado.',
            'Resuelve el mantenimiento: autovacuum, ANALYZE y REINDEX actúan sobre trozos de decenas de gigabytes, y las particiones antiguas, que ya no cambian, casi no dan trabajo.',
            'Resuelve parte de la lectura: las consultas con filtro en la clave leen solo las particiones del rango, y el índice caliente queda pequeño.',
            'No resuelve la consulta sin filtro en la clave: SELECT ... WHERE id = $1 pasa a consultar el índice de todas las particiones, 14 búsquedas en vez de una. Siguen siendo rápidas, pero es un costo nuevo.',
            'No resuelve la unicidad global: la clave primaria y cualquier índice único deben contener la columna de partición. El id sigue siendo único en la práctica por la secuencia, pero la base solo garantiza (id, criado_em).',
            'No resuelve las claves foráneas que apuntan a la tabla: una FK que referencia la columna id tendría que referenciar (id, criado_em), lo que obliga a cambiar las tablas hijas. En tablas de eventos y logs, que normalmente solo apuntan hacia afuera, esto no aparece.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La granularidad sigue el ciclo de vida, no las ganas de tener muchas particiones. Con 86 GB de datos nuevos por mes y retención de 12 meses, una partición mensual es la elección natural: 13 particiones activas, cada una lo bastante pequeña para manipularla y lo bastante grande para no generar miles de tablas. La partición diaria solo compensa con volúmenes mucho mayores; el planificador gasta tiempo por partición, y cientos de ellas ya vuelven visiblemente más lenta la planificación.',
        },
      ],
    },
    {
      title: 'Usar la propia tabla como primera partición',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El camino obvio, crear la tabla particionada y copiar todo con INSERT ... SELECT, exige escribir 1,2 TB de nuevo, mantener las dos tablas sincronizadas durante la copia y hacer un corte. Existe un atajo: una tabla común puede anexarse como partición de una tabla particionada con ATTACH PARTITION, siempre que su contenido quepa en el rango declarado. La tabla antigua pasa a ser la partición que cubre todo el pasado hasta el fin del mes corriente, y las filas posteriores a esa fecha caen en las particiones nuevas. No se copia nada, y la aplicación sigue usando el mismo nombre de tabla.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'La preparación se hace con la tabla en uso. Hay dos trampas. La primera es que el ATTACH necesita índices equivalentes a los de la tabla padre, y si no los encuentra, construye nuevos con la tabla bloqueada, lo que para 1,2 TB significa horas de indisponibilidad. La solución es crearlos antes, con CREATE INDEX CONCURRENTLY, en la tabla antigua. La segunda es que el ATTACH también comprueba que todas las filas quepan en el rango leyendo la tabla entera, salvo que exista un CHECK validado que ya lo demuestre. El CHECK entra como NOT VALID, que es instantáneo, y el VALIDATE lee la tabla sin bloquear lecturas ni escrituras.',
        },
        {
          type: 'code',
          value: preparoCode,
        },
        {
          type: 'paragraph',
          value:
            'Dos detalles de la preparación suelen pasar desapercibidos. El límite del CHECK debe ser una fecha futura, al fin del mes corriente, porque la tabla antigua seguirá recibiendo escrituras hasta el cambio y el CHECK no puede violarse en ese intervalo. Y los literales de fecha llevan el desplazamiento explícito (+00): un timestamptz escrito sin desplazamiento se interpreta en la zona horaria de la sesión, y una divergencia entre la zona del script y la del servidor desplaza todas las fronteras de partición unas horas.',
        },
      ],
    },
    {
      title: 'El cambio en una transacción corta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con todo listo, el cambio es una transacción que solo toca el catálogo. La clave primaria de la tabla antigua pasa a ser (id, criado_em) reutilizando el índice ya construido, los nombres se intercambian, la tabla antigua se anexa como partición y la secuencia del id pasa a alimentarse desde la tabla padre. La transacción pide ACCESS EXCLUSIVE sobre la tabla y por eso usa lock_timeout: si un reporte largo está reteniendo la tabla, falla en 2 segundos en vez de formar una cola detrás de sí, y el intento se repite.',
        },
        {
          type: 'code',
          value: trocaCode,
        },
        {
          type: 'paragraph',
          value:
            'En el ensayo con tráfico reproducido, la transacción tardó 410 ms. En producción, el primer intento cayó en el lock_timeout por una consulta de reporte abierta desde hacía 50 segundos, el segundo pasó, y el p99 de la API no cambió. El log del servidor con nivel DEBUG1, en el ensayo, mostró el mensaje de que la restricción de la partición estaba implícita en las restricciones existentes, que es la confirmación de que el ATTACH no recorrió la tabla. Si la recorre, la transacción se alarga y lo descubres en el ensayo, no en producción.',
        },
        {
          type: 'paragraph',
          value:
            'Lo que no viene incluido hay que verificarlo: permisos (GRANT) de la tabla, triggers, políticas de seguridad por fila, comentarios, publicaciones de replicación lógica y cualquier herramienta de CDC que observe la tabla por nombre. Las publicaciones con publish_via_partition_root = true entregan los cambios bajo el nombre de la tabla padre, lo que preserva el contrato para los consumidores.',
        },
      ],
    },
    {
      title: 'Mantener las particiones: crear por adelantado, expirar y vigilar la predeterminada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Particionar sin rutina de mantenimiento solo aplaza el fallo. Si falta la partición del mes, la fila va a la partición predeterminada, o, si no hay una, el INSERT falla con "no partition of relation found for row" y la aplicación deja de grabar eventos. La rutina debe crear particiones con antelación, expirar las vencidas y avisar cuando algo se sale de lo esperado. Es idempotente (CREATE TABLE IF NOT EXISTS, DROP TABLE IF EXISTS) y corre todos los días, para que un día perdido no se convierta en un problema el mes siguiente.',
        },
        {
          type: 'code',
          value: manutencaoCode,
        },
        {
          type: 'list',
          items: [
            'Crear con 3 meses de antelación da 90 días para que alguien note que la rutina se detuvo, y la verificación de la partición predeterminada convierte un fallo silencioso en un error explícito del planificador de tareas.',
            'La partición predeterminada es una red de seguridad, no un destino: debe estar vacía, y una fila en ella pide acción. Crear una partición nueva exige comprobar que la predeterminada no tenga filas del rango, y cuanto mayor sea la predeterminada, más lenta y bloqueante es esa comprobación.',
            'DETACH PARTITION ... CONCURRENTLY no funciona en una tabla con partición predeterminada. Como el DROP TABLE de una partición solo toma milisegundos de bloqueo sobre la tabla padre, la rutina usa lock_timeout con reintento en su lugar.',
            'La partición legada queda fuera de la rutina a propósito. En diciembre de 2027, cuando su último dato cumpla 12 meses, se elimina con un DROP TABLE, y esa es la ganancia más visible: 1,2 TB devueltos en milisegundos. Hasta entonces, la retención sigue haciéndose con DELETE por lotes en esa partición, solo que ahora sin presión, porque los datos nuevos ya no viven en ella.',
          ],
        },
      ],
    },
    {
      title: 'Poda de particiones, planes y trampas en la aplicación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La poda es lo que hace que el particionamiento acelere la lectura, y depende de que el filtro sobre la clave sea comparable con una constante o un parámetro. Desde Postgres 11 también ocurre en la ejecución, lo que cubre now() y los parámetros de consultas preparadas. Las funciones aplicadas sobre la columna de la clave, como date(criado_em) o to_char, desactivan la poda y leen todo.',
        },
        {
          type: 'code',
          value: planoCode,
        },
        {
          type: 'ordered',
          items: [
            'Busca en el código las consultas sin criado_em en el filtro: búsquedas por id, joins por la clave y pantallas que listan "los últimos N". Siguen funcionando, pero ahora pasan por todas las particiones. En muchos casos basta con añadir un límite de fecha razonable, como los últimos 90 días.',
            'Comprueba el plan con EXPLAIN después del cambio, buscando "Subplans Removed" o un Append que liste solo las particiones esperadas. Un Append con 14 hijas en una consulta que debería tocar una es la señal de que la poda no ocurrió.',
            'Revisa los ORM que generan consultas con funciones sobre la columna o que cargan la fila solo por la clave primaria: la clave primaria ahora tiene dos columnas, y una actualización que filtre solo por id pasa por todas las particiones.',
            'Vigila estadísticas y autovacuum: el padre no se analiza automáticamente, y cada partición nueva empieza sin estadísticas hasta recibir datos. Un ANALYZE diario del padre y una mirada al last_autovacuum de las particiones recientes evitan planes malos.',
            'Avisa a quien consume la tabla directamente (BI, exportaciones): si leen por rango, obtienen la poda gratis; si leen todo, nada cambia.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Vale la pena particionar una tabla de 50 GB?',
      answer:
        'En general, no por el tamaño sino por el ciclo de vida. Una tabla de 50 GB que nunca expira datos y se consulta por id no gana nada y pierde con la clave compuesta. Una tabla de 50 GB con retención de 30 días y un DELETE diario que ya hincha el índice gana mucho, porque expirar pasa a ser DROP TABLE. La regla práctica: si el dolor es borrar datos antiguos o mantener índices y vacuum de datos que nunca cambian, particiona; si el dolor es una consulta lenta, mira primero el índice y el plan.',
    },
    {
      question: '¿Por qué no usar una extensión como pg_partman?',
      answer:
        'Se puede y, en muchos casos, se debe. pg_partman automatiza la creación y la expiración que el script del artículo hace a mano, y en bases gestionadas suele estar disponible. El cambio sin copiar, con ATTACH PARTITION de la tabla existente, es independiente de la extensión y funciona con ella. El script del artículo sirve para quien no puede instalar extensiones, o quiere una rutina pequeña, comprobable y visible en el repositorio de la aplicación.',
    },
    {
      question: '¿Y si la tabla tiene claves foráneas que apuntan a ella?',
      answer:
        'Ese es el caso en que cambia el plan. La tabla particionada necesita unicidad en (id, criado_em), así que una FK que referencia solo el id deja de ser posible, y las tablas hijas tendrían que guardar también criado_em. Antes de empezar, lista las FK entrantes con pg_constraint. Si existen, evalúa si realmente necesitan ser restricciones de la base o si pueden pasar a validación en la aplicación, y sigue solo cuando la respuesta esté clara. Las FK que salen de la tabla hacia otras se aceptan y quedan intactas en la partición legada.',
    },
  ],
  conclusion: {
    title: 'Particionar cambia un problema de mantenimiento por una regla de acceso',
    description:
      'La tabla de eventos de 1,2 TB estaba atrapada en un DELETE de 9 horas y en un índice que solo crecía, y la salida obvia, copiar todo a una tabla particionada, pedía ventana y cambios en la aplicación. Anexar la propia tabla como partición, con índices creados antes de forma concurrente y un CHECK validado que evita el recorrido, redujo el cambio a una transacción de catálogo de unos 400 ms, sin modificar una línea de SQL de la aplicación. Lo que sostiene el resultado es la rutina que crea particiones por adelantado, expira las vencidas y vigila la partición predeterminada, y saber que una consulta sin la clave de partición ahora cuesta una búsqueda por partición. Dentro de 12 meses, la partición legada de 1,2 TB desaparece con un DROP TABLE.',
    cta: 'Revisar la retención y el particionamiento de las tablas de mi base',
  },
  related: [
    {
      label: 'Migración de base de datos sin ventana: expandir, migrar y contraer sin detener la escritura',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
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
