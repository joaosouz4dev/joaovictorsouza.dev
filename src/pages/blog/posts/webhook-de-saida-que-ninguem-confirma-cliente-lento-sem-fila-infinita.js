// Conteudo do artigo: webhook de saida para clientes lentos, fila por destino
// com limite de concorrencia, retentativa com recuo e prazo, pausa e
// desativacao de destino, fusao de eventos e metricas por endpoint.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const poolDiagram = `Workers de entrega (16 no total) durante o incidente

  14:00  [A][B][C][D][E][F][G][H][I][J][K][L][M][N][O][P]   varios destinos
  14:15  [X][X][X][X][X][B][C][D][E][F][G][H][I][J][K][L]   X responde em 28 s
  14:30  [X][X][X][X][X][X][X][X][X][X][X][B][C][D][E][F]   fila de X so cresce
  14:40  [X][X][X][X][X][X][X][X][X][X][X][X][X][X][X][X]   todos presos em X

  Taxa de eventos de X ........ 12 por segundo
  Tempo por resposta de X ..... 28 segundos
  Concorrencia necessaria .... 12 x 28 = 336 conexoes simultaneas
  Concorrencia disponivel ..... 16 workers para 1.800 destinos`;

const poolDiagramEn = `Delivery workers (16 in total) during the incident

  14:00  [A][B][C][D][E][F][G][H][I][J][K][L][M][N][O][P]   many destinations
  14:15  [X][X][X][X][X][B][C][D][E][F][G][H][I][J][K][L]   X responds in 28 s
  14:30  [X][X][X][X][X][X][X][X][X][X][X][B][C][D][E][F]   X's queue keeps growing
  14:40  [X][X][X][X][X][X][X][X][X][X][X][X][X][X][X][X]   all stuck on X

  Event rate for X ............ 12 per second
  Response time of X .......... 28 seconds
  Concurrency to keep up ...... 12 x 28 = 336 simultaneous connections
  Available concurrency ....... 16 workers for 1,800 destinations`;

const poolDiagramEs = `Workers de entrega (16 en total) durante el incidente

  14:00  [A][B][C][D][E][F][G][H][I][J][K][L][M][N][O][P]   varios destinos
  14:15  [X][X][X][X][X][B][C][D][E][F][G][H][I][J][K][L]   X responde en 28 s
  14:30  [X][X][X][X][X][X][X][X][X][X][X][B][C][D][E][F]   la cola de X solo crece
  14:40  [X][X][X][X][X][X][X][X][X][X][X][X][X][X][X][X]   todos atrapados en X

  Tasa de eventos de X ........ 12 por segundo
  Tiempo de respuesta de X .... 28 segundos
  Concurrencia necesaria ...... 12 x 28 = 336 conexiones simultaneas
  Concurrencia disponible ..... 16 workers para 1.800 destinos`;

const schemaSql = `CREATE TABLE webhook_endpoints (
  id                bigserial PRIMARY KEY,
  cliente_id        bigint NOT NULL,
  url               text NOT NULL,
  segredo           text NOT NULL,
  status            text NOT NULL DEFAULT 'ativo'
                    CHECK (status IN ('ativo', 'desativado')),
  max_concorrencia  int NOT NULL DEFAULT 4,
  falhas_seguidas   int NOT NULL DEFAULT 0,
  primeira_falha_em timestamptz,
  pausado_ate       timestamptz
);

CREATE TABLE webhook_entregas (
  id           bigserial PRIMARY KEY,
  endpoint_id  bigint NOT NULL REFERENCES webhook_endpoints (id),
  evento_id    uuid NOT NULL,
  tipo         text NOT NULL,
  payload      jsonb NOT NULL,
  chave_fusao  text,
  status       text NOT NULL DEFAULT 'pendente'
               CHECK (status IN ('pendente', 'enviando', 'entregue', 'morta')),
  tentativas   int NOT NULL DEFAULT 0,
  proxima_em   timestamptz NOT NULL DEFAULT now(),
  reservado_em timestamptz,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  entregue_em  timestamptz,
  ultimo_erro  text
);

-- A fila de cada destino, na ordem em que deve ser tentada
CREATE INDEX webhook_entregas_fila
  ON webhook_entregas (endpoint_id, proxima_em, id)
  WHERE status = 'pendente';

-- Entregas em voo, para contar a concorrencia de cada destino
CREATE INDEX webhook_entregas_em_voo
  ON webhook_entregas (endpoint_id)
  WHERE status = 'enviando';

-- No maximo uma entrega pendente por entidade e destino (fusao)
CREATE UNIQUE INDEX webhook_entregas_fusao
  ON webhook_entregas (endpoint_id, chave_fusao)
  WHERE status = 'pendente' AND chave_fusao IS NOT NULL;`;

const reservaSql = `-- reserva-sql.js exporta este texto como RESERVA_SQL; $1 = vagas do processo
WITH em_voo AS (
  SELECT endpoint_id, count(*) AS n
  FROM webhook_entregas
  WHERE status = 'enviando'
  GROUP BY endpoint_id
),
candidatas AS (
  SELECT c.id, c.pos
  FROM webhook_endpoints ep
  LEFT JOIN em_voo v ON v.endpoint_id = ep.id
  CROSS JOIN LATERAL (
    SELECT e.id, row_number() OVER (ORDER BY e.proxima_em, e.id) AS pos
    FROM webhook_entregas e
    WHERE e.endpoint_id = ep.id
      AND e.status = 'pendente'
      AND e.proxima_em <= now()
    ORDER BY e.proxima_em, e.id
    LIMIT greatest(ep.max_concorrencia - coalesce(v.n, 0), 0)
  ) c
  WHERE ep.status = 'ativo'
    AND (ep.pausado_ate IS NULL OR ep.pausado_ate <= now())
),
escolhidas AS (
  -- Ordenar por posicao intercala os destinos: a primeira de cada um,
  -- depois a segunda de cada um, e assim por diante
  SELECT id FROM candidatas ORDER BY pos, id LIMIT $1
)
UPDATE webhook_entregas w
SET status = 'enviando',
    tentativas = w.tentativas + 1,
    reservado_em = now()
FROM escolhidas s, webhook_endpoints ep
WHERE w.id = s.id
  AND ep.id = w.endpoint_id
RETURNING w.id, w.endpoint_id, w.evento_id, w.tipo, w.payload,
          w.tentativas, w.criado_em, ep.url, ep.segredo;`;

const workerCode = `import crypto from 'node:crypto';
import pg from 'pg';
import { RESERVA_SQL } from './reserva-sql.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

const TIMEOUT_MS = 5_000;
const MAX_EM_VOO = 64; // entregas simultaneas deste processo
const MAX_TENTATIVAS = 20;
const IDADE_MAXIMA_MS = 72 * 3_600_000;
const BASE_MS = 30_000;
const TETO_MS = 6 * 3_600_000;
const FALHAS_PARA_PAUSAR = 20;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Recuo exponencial com jitter: metade fixa, metade aleatoria. Nunca antes
// do que o cliente pediu em Retry-After, limitado ao teto.
export function proximoAtrasoMs(tentativas, retryAfterMs = 0) {
  const exp = Math.min(TETO_MS, BASE_MS * 2 ** (tentativas - 1));
  const atraso = exp / 2 + Math.random() * (exp / 2);
  return Math.max(Math.round(atraso), Math.min(retryAfterMs, TETO_MS));
}

export function parseRetryAfter(valor) {
  if (!valor) return 0;
  const segundos = Number(valor);
  if (Number.isFinite(segundos)) return Math.max(0, segundos * 1000);
  const data = Date.parse(valor);
  return Number.isNaN(data) ? 0 : Math.max(0, data - Date.now());
}

async function enviar(e) {
  const corpo = JSON.stringify({ id: e.evento_id, tipo: e.tipo, criado_em: e.criado_em, dados: e.payload });
  const ts = String(Math.floor(Date.now() / 1000));
  const assinatura = crypto.createHmac('sha256', e.segredo).update(ts + '.' + corpo).digest('hex');
  try {
    const res = await fetch(e.url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'webhook-id': e.evento_id,
        'webhook-timestamp': ts,
        'webhook-signature': 'v1=' + assinatura,
      },
      body: corpo,
    });
    await res.body?.cancel(); // o corpo da resposta nao interessa
    return { status: res.status, retryAfterMs: parseRetryAfter(res.headers.get('retry-after')) };
  } catch (err) {
    const erro = err.name === 'TimeoutError' ? 'timeout' : String(err.cause?.code || err.message);
    return { status: 0, erro };
  }
}

async function concluir(e, r) {
  if (r.status >= 200 && r.status < 300) {
    await pool.query(
      "UPDATE webhook_entregas SET status = 'entregue', entregue_em = now(), ultimo_erro = NULL WHERE id = $1",
      [e.id],
    );
    await pool.query(
      'UPDATE webhook_endpoints SET falhas_seguidas = 0, primeira_falha_em = NULL, pausado_ate = NULL WHERE id = $1',
      [e.endpoint_id],
    );
    return;
  }

  const erro = r.erro || 'HTTP ' + r.status;

  if (r.status === 410) {
    // O cliente disse explicitamente que o endpoint nao existe mais
    await pool.query("UPDATE webhook_endpoints SET status = 'desativado' WHERE id = $1", [e.endpoint_id]);
    await pool.query("UPDATE webhook_entregas SET status = 'morta', ultimo_erro = $2 WHERE id = $1", [e.id, erro]);
    return;
  }

  const idadeMs = Date.now() - new Date(e.criado_em).getTime();
  const desistir = r.status === 413 || e.tentativas >= MAX_TENTATIVAS || idadeMs >= IDADE_MAXIMA_MS;

  if (desistir) {
    await pool.query("UPDATE webhook_entregas SET status = 'morta', ultimo_erro = $2 WHERE id = $1", [e.id, erro]);
  } else {
    await pool.query(
      "UPDATE webhook_entregas SET status = 'pendente', proxima_em = now() + $2::float8 * interval '1 millisecond', " +
        'ultimo_erro = $3 WHERE id = $1',
      [e.id, proximoAtrasoMs(e.tentativas, r.retryAfterMs), erro],
    );
  }

  // Falhas seguidas pausam o destino inteiro; cada rodada de sondagem que
  // falha estende a pausa, ate uma hora
  await pool.query(
    'UPDATE webhook_endpoints SET falhas_seguidas = falhas_seguidas + 1, ' +
      'primeira_falha_em = coalesce(primeira_falha_em, now()), ' +
      'pausado_ate = CASE WHEN falhas_seguidas + 1 >= $2 ' +
      "THEN now() + least(interval '1 hour', (falhas_seguidas + 2 - $2) * interval '1 minute') " +
      'ELSE pausado_ate END WHERE id = $1',
    [e.endpoint_id, FALHAS_PARA_PAUSAR],
  );
}

async function reservar(limite) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serializa a reserva entre processos: sem isso, dois workers contam as
    // mesmas vagas e passam do limite de concorrencia do destino
    await client.query('SELECT pg_advisory_xact_lock(4201)');
    // Devolve a fila o que ficou preso por um worker que morreu no meio do envio
    await client.query(
      "UPDATE webhook_entregas SET status = 'pendente', proxima_em = now() " +
        "WHERE status = 'enviando' AND reservado_em < now() - interval '1 minute'",
    );
    const { rows } = await client.query(RESERVA_SQL, [limite]);
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function rodar() {
  const emVoo = new Set();
  for (;;) {
    const vagas = MAX_EM_VOO - emVoo.size;
    let entregas = [];
    if (vagas > 0) {
      try {
        entregas = await reservar(vagas);
      } catch (err) {
        console.error('falha ao reservar entregas', err);
      }
    }
    for (const e of entregas) {
      const p = enviar(e)
        .then((r) => concluir(e, r))
        .catch((err) => console.error('falha ao registrar entrega', e.id, err))
        .finally(() => emVoo.delete(p));
      emVoo.add(p);
    }
    if (entregas.length === 0) await Promise.race([...emVoo, sleep(500)]);
  }
}`;

const fusaoSql = `-- Enfileira um evento de estado para todos os destinos ativos do cliente.
-- Se o destino ja tem entrega pendente da mesma entidade, troca o payload
-- pelo mais novo em vez de criar outra linha.
INSERT INTO webhook_entregas (endpoint_id, evento_id, tipo, payload, chave_fusao)
SELECT ep.id, $1, $2, $3, $4
FROM webhook_endpoints ep
WHERE ep.cliente_id = $5
  AND ep.status = 'ativo'
ON CONFLICT (endpoint_id, chave_fusao)
  WHERE status = 'pendente' AND chave_fusao IS NOT NULL
DO UPDATE SET evento_id = EXCLUDED.evento_id,
              tipo      = EXCLUDED.tipo,
              payload   = EXCLUDED.payload;

-- Job diario: destino que falha ha cinco dias seguidos e desativado,
-- e a aplicacao avisa o responsavel tecnico do cliente
UPDATE webhook_endpoints
SET status = 'desativado'
WHERE status = 'ativo'
  AND primeira_falha_em < now() - interval '5 days'
RETURNING id, cliente_id, url;`;

const metricasSql = `-- Por destino: fila, ocupacao e idade da entrega pendente mais antiga
SELECT ep.id,
       ep.url,
       count(*) FILTER (WHERE e.status = 'pendente') AS pendentes,
       count(*) FILTER (WHERE e.status = 'enviando') AS em_voo,
       ep.max_concorrencia,
       extract(epoch FROM now() - min(e.criado_em) FILTER (WHERE e.status = 'pendente'))
         AS idade_mais_antiga_s,
       ep.falhas_seguidas,
       ep.pausado_ate
FROM webhook_endpoints ep
LEFT JOIN webhook_entregas e
  ON e.endpoint_id = ep.id AND e.status IN ('pendente', 'enviando')
WHERE ep.status = 'ativo'
GROUP BY ep.id
ORDER BY idade_mais_antiga_s DESC NULLS LAST
LIMIT 20;`;

const pt = {
  intro:
    'A plataforma de pedidos enviava webhooks para mil e oitocentas integrações de clientes: ERPs, sistemas de expedição, planilhas conectadas e automações de marketing. Numa terça-feira, o ERP de um único varejista passou a responder em vinte e oito segundos, por causa de uma migração do lado dele. O timeout de envio era de trinta segundos, então nenhuma chamada falhava: todas demoravam. Em quarenta minutos, os dezesseis workers de entrega estavam presos nesse endpoint, a fila passou de dois milhões de entregas e os outros mil setecentos e noventa e nove clientes começaram a receber eventos de pedido com três horas de atraso. Os que deram timeout voltavam imediatamente para a fila e disputavam os mesmos workers. Quando o varejista terminou a migração, recebeu novecentos mil eventos em poucos minutos e caiu de novo. Nenhum cliente fez nada de errado do ponto de vista dele, e ninguém do lado da plataforma tinha como confirmar se um evento tinha chegado. Este artigo explica como um destino lento prende a entrega de todos, qual contrato de confirmação um webhook de saída precisa ter, como montar uma fila por destino com limite de concorrência, como retentar com recuo, jitter e prazo de validade, como pausar, fundir e descartar com critério em vez de acumular para sempre, e o que medir para saber que um cliente está ficando para trás antes que ele abra um chamado.',
  sections: [
    {
      title: 'Como um único cliente lento prende a entrega de todos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A conta que explica o incidente é a lei de Little: a concorrência necessária para acompanhar um fluxo é a taxa de chegada multiplicada pelo tempo de atendimento. O varejista recebia doze eventos por segundo. Com respostas de vinte e oito segundos, acompanhar esse único destino exigiria trezentas e trinta e seis conexões simultâneas. O pool tinha dezesseis workers para todos os destinos. Como a fila era única e em ordem de chegada, e a parte dela que mais crescia era justamente a desse cliente, cada worker que terminava uma entrega pegava a próxima da fila e, cada vez com mais frequência, ela era do destino lento.',
        },
        {
          type: 'diagram',
          value: poolDiagram,
        },
        {
          type: 'paragraph',
          value:
            'Nada no desenho estava errado isoladamente. O defeito estava na soma de decisões razoáveis que, juntas, entregam a capacidade de todos a quem responde pior. A tabela resume as decisões que costumam aparecer juntas e o que cada uma faz quando um destino fica lento.',
        },
        {
          type: 'table',
          columns: ['Decisão', 'Por que parecia razoável', 'O que faz com um destino lento'],
          rows: [
            [
              'Timeout de 30 segundos',
              'Evita falsos negativos em clientes que demoram um pouco',
              'Cada entrega lenta segura um worker por 30 segundos em vez de liberar em 5',
            ],
            [
              'Fila única em ordem de chegada',
              'Simples de implementar e de raciocinar',
              'O destino com mais eventos acumulados passa a ocupar todos os workers',
            ],
            [
              'Retentativa imediata',
              'O erro pode ter sido momentâneo',
              'Dobra a carga sobre quem já não está dando conta',
            ],
            [
              'Sem prazo de validade',
              'Nenhum evento pode ser perdido',
              'A fila cresce sem limite e eventos de três dias atrás disputam com os de agora',
            ],
            [
              'Sem teto por destino',
              'Todos os clientes são tratados igualmente',
              'Um cliente sozinho define a latência de todos os outros',
            ],
            [
              'Reenvio de tudo quando o destino volta',
              'Entregar o que estava pendente o quanto antes',
              'O cliente que acabou de se recuperar recebe uma rajada e cai de novo',
            ],
          ],
        },
      ],
    },
    {
      title: 'O contrato de confirmação: o que conta como entregue e quanto esperar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O título do problema é literal: ninguém confirma porque o contrato nunca disse o que é confirmar. A regra que resolve a maior parte dos casos é publicar que uma entrega só conta quando o destino responde com status 2xx em até cinco segundos, e que o corpo da resposta é ignorado. Isso obriga o cliente a fazer o que ele deveria fazer de qualquer forma: gravar o evento, responder na hora e processar depois, na própria fila dele. Um endpoint que chama três APIs e grava em quatro tabelas antes de responder não é um receptor de webhook, é um processamento síncrono disfarçado, e ele vai estourar o prazo exatamente nos dias de mais movimento.',
        },
        {
          type: 'table',
          columns: ['Resposta do destino', 'Ação da plataforma', 'Conta como falha do destino?'],
          rows: [
            ['2xx em até 5 s', 'Marca como entregue e zera as falhas seguidas do destino', 'Não'],
            ['Timeout, conexão recusada, erro de DNS ou TLS', 'Retenta com recuo', 'Sim'],
            ['429 ou 503 com Retry-After', 'Retenta depois do tempo pedido, respeitando o teto', 'Sim'],
            ['408, 425, 429 e 5xx sem Retry-After', 'Retenta com recuo', 'Sim'],
            ['3xx', 'Não segue o redirecionamento; retenta e avisa que a URL mudou', 'Sim'],
            ['400, 401, 403, 404', 'Retenta com recuo, porque costuma ser configuração que o cliente corrige', 'Sim'],
            ['410 Gone', 'Desativa o destino e para de enviar', 'Encerra o destino'],
            ['413 Payload Too Large', 'Marca a entrega como morta, porque repetir não muda o tamanho', 'Sim'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Três detalhes evitam surpresas. Não seguir redirecionamentos impede que um endpoint mal configurado, ou comprometido, faça a plataforma enviar eventos assinados para outro endereço. Não ler o corpo da resposta impede que um destino que devolve uma página de erro de dez megabytes consuma memória do worker. E o timeout precisa cobrir a chamada inteira, conexão, TLS e resposta, e não apenas o tempo de conexão, que é o padrão de várias bibliotecas HTTP e a razão de muitos workers ficarem pendurados por minutos em servidores que aceitam a conexão e nunca respondem.',
        },
      ],
    },
    {
      title: 'Uma fila por destino, não uma fila para todos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A correção estrutural é tratar cada endpoint como uma fila própria com um limite de concorrência, e fazer os workers passarem pelos destinos de forma intercalada. Com um limite de quatro entregas simultâneas por destino, o varejista lento ocupa no máximo quatro conexões, a fila dele cresce sozinha e os demais clientes continuam recebendo em segundos. Para até algumas centenas de entregas por segundo, o PostgreSQL resolve isso bem com duas tabelas, e a entrega passa a ser gravada na mesma transação que muda o pedido, sem risco de o evento se perder entre o banco e a fila.',
        },
        {
          type: 'code',
          value: schemaSql,
        },
        {
          type: 'paragraph',
          value:
            'A reserva escolhe, para cada destino ativo e fora de pausa, no máximo as vagas que ele ainda tem livres, usando o índice parcial da fila para ler só as primeiras linhas de cada um. Depois ordena pela posição dentro de cada destino, o que dá a primeira entrega de cada cliente antes da segunda de qualquer um. Um cliente com dois milhões de pendentes e outro com três disputam em igualdade: cada um recebe a mesma fatia enquanto tiver entregas prontas.',
        },
        {
          type: 'code',
          value: reservaSql,
        },
        {
          type: 'paragraph',
          value:
            'A contagem de entregas em voo e a reserva precisam acontecer sem que outro processo reserve as mesmas vagas no meio do caminho. FOR UPDATE SKIP LOCKED impede duas reservas da mesma linha, mas não impede que dois workers contem quatro vagas livres ao mesmo tempo e reservem oito entregas do mesmo destino. Por isso a reserva roda dentro de uma transação curta que toma um advisory lock: ela leva poucos milissegundos, então serializar esse trecho custa pouco, e o limite por destino passa a ser exato. Se a plataforma crescer a ponto de a reserva virar gargalo, o passo seguinte é particionar os destinos entre grupos de workers, cada grupo com o próprio lock.',
        },
      ],
    },
    {
      title: 'Retentativa com recuo, jitter e prazo de validade',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cada falha reagenda a entrega com recuo exponencial: trinta segundos na primeira, dobrando a cada tentativa, até um teto de seis horas. O jitter usa metade do intervalo fixa e metade aleatória, para que entregas que falharam juntas não voltem juntas, e o valor de Retry-After é respeitado quando o destino o envia. Há dois limites de desistência, vinte tentativas ou setenta e duas horas de idade, e o que vier primeiro manda a entrega para o estado morta, de onde ela só sai por reenvio explícito.',
        },
        {
          type: 'table',
          columns: ['Tentativa', 'Espera antes da próxima', 'Observação'],
          rows: [
            ['1', '15 a 30 segundos', 'Absorve reinícios e falhas momentâneas'],
            ['3', '1 a 2 minutos', 'Cobre um deploy do lado do cliente'],
            ['6', '8 a 16 minutos', 'O destino provavelmente já está em pausa'],
            ['10', '2 h 08 a 4 h 16', 'Falha que já é um incidente do cliente'],
            ['11 a 20', '3 a 6 horas', 'Teto; a vigésima acontece entre 31 e 63 horas depois do evento'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O worker abaixo junta as peças: reserva entregas até o limite do processo, envia com timeout de cinco segundos para a chamada inteira, assina o corpo com HMAC incluindo o timestamp, classifica a resposta e registra o resultado. Ele usa fetch nativo do Node 18 ou superior e o driver pg. A cada falha, além de reagendar a entrega, ele incrementa as falhas seguidas do destino, o que alimenta a pausa descrita na próxima seção.',
        },
        {
          type: 'code',
          value: workerCode,
        },
        {
          type: 'list',
          items: [
            'O timeout de cinco segundos é aplicado com AbortSignal.timeout, que cobre conexão, TLS, envio e espera da resposta.',
            'Uma entrega presa em enviando por mais de um minuto, porque o processo morreu no meio do envio, volta para a fila na próxima reserva; o cliente pode receber o evento duas vezes, e por isso o identificador do evento vai no cabeçalho.',
            'O teto de seis horas vale também para Retry-After: um destino que pede para esperar trinta dias não bloqueia a entrega além do teto.',
            'A retentativa nunca é imediata, nem na primeira falha, porque a primeira falha de um destino sobrecarregado é exatamente o momento em que repetir mais piora tudo.',
          ],
        },
      ],
    },
    {
      title: 'Teto por destino: pausar, fundir e descartar com critério',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Limitar a concorrência protege os outros clientes, mas não impede que a fila do destino lento cresça sem fim. Três mecanismos resolvem isso. O primeiro é a pausa: depois de vinte falhas seguidas, o destino para de receber tentativas por alguns minutos, e cada rodada de sondagem que falha estende a pausa até uma hora. Quando ela termina, a reserva libera no máximo as quatro vagas do destino, que funcionam como sondagem: se derem certo, as falhas zeram e a entrega volta ao ritmo normal; se falharem, a pausa recomeça. Isso é um disjuntor, com a diferença de que o estado dele mora no banco e vale para todos os workers.',
        },
        {
          type: 'paragraph',
          value:
            'O segundo é a fusão. Boa parte dos eventos descreve o estado atual de uma entidade, como pedido atualizado ou estoque alterado. Se um destino está parado com cinquenta atualizações pendentes do mesmo pedido, entregar as cinquenta não tem valor: só a última importa. Com uma chave de fusão por entidade, uma entrega pendente é substituída pela versão mais nova em vez de criar outra linha, e a fila de um destino parado passa a ter o tamanho do número de entidades que mudaram, e não do número de mudanças. Eventos que representam fatos, como pagamento aprovado ou nota emitida, não podem ser fundidos e ficam sem chave. O terceiro é a desativação: um destino que falha há cinco dias seguidos é desativado, o responsável técnico do cliente é avisado e as entregas pendentes ficam guardadas até ele decidir reenviar ou descartar.',
        },
        {
          type: 'code',
          value: fusaoSql,
        },
        {
          type: 'table',
          columns: ['Mecanismo', 'Quando usar', 'Custo para o cliente'],
          rows: [
            ['Pausa com sondagem', 'Sempre; é o que evita martelar um destino caído', 'Nenhum; os eventos esperam'],
            ['Fusão por entidade', 'Eventos que carregam o estado completo da entidade', 'Perde os estados intermediários, que em geral ninguém usa'],
            ['Eventos finos', 'Payloads grandes ou sensíveis; o evento leva só o id e o cliente busca o estado atual na API', 'Uma chamada extra por evento'],
            ['Prazo de validade e entrega morta', 'Sempre; nenhum evento fica tentando para sempre', 'Precisa reconciliar pelo log ou pedir reenvio'],
            ['Desativação após dias de falha', 'Destinos abandonados, que representam boa parte da fila parada', 'Reativar o endpoint no painel'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A volta de um destino também precisa de cuidado. Sem limite, o varejista que terminou a migração receberia novecentos mil eventos em minutos. Com o limite de concorrência, a vazão para ele fica em torno de quatro entregas divididas pelo tempo de resposta: com respostas de duzentos milissegundos, vinte por segundo. Isso esvazia a fila em horas, sem derrubar o cliente de novo, e o valor de max_concorrencia pode ser ajustado por destino para clientes que aguentam mais.',
        },
      ],
    },
    {
      title: 'O que o cliente precisa saber e o que você precisa medir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Metade da confiabilidade de um webhook de saída está na documentação que o cliente lê. Sem ela, cada integração inventa as próprias suposições, e as suposições erradas viram chamados. O contrato publicado precisa dizer, no mínimo:',
        },
        {
          type: 'list',
          items: [
            'Que a entrega é pelo menos uma vez: o mesmo evento pode chegar duas vezes, e o cabeçalho webhook-id é a chave para descartar repetições.',
            'Que a ordem não é garantida: cada payload leva a versão ou a data de atualização da entidade, e o receptor ignora o que for mais antigo do que já tem.',
            'Como validar a assinatura, incluindo a tolerância de cinco minutos para o timestamp, que impede a repetição de um evento capturado.',
            'O prazo de cinco segundos, a tabela de respostas e o que acontece com o destino depois de dias falhando.',
            'Como reconciliar: uma API que lista eventos por intervalo de tempo, guardados por trinta dias, para que o cliente recupere o que perdeu sem depender de reenvio.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Do lado da plataforma, a métrica que teria antecipado o incidente não é a taxa de erro, que ficou perto de zero enquanto tudo demorava. É a idade da entrega pendente mais antiga, por destino. Ela sobe quando o destino está lento, quando está falhando e quando está pausado, e ela é a medida direta do que o cliente sente. A consulta abaixo mostra os destinos mais atrasados, com fila, ocupação e estado de pausa.',
        },
        {
          type: 'code',
          value: metricasSql,
        },
        {
          type: 'table',
          columns: ['Métrica', 'Por destino ou global', 'Alerta sugerido'],
          rows: [
            ['Idade da entrega pendente mais antiga', 'Por destino', 'Acima de 15 minutos em cliente ativo; avisar o cliente, não só o time'],
            ['Idade da entrega pendente mais antiga entre destinos saudáveis', 'Global', 'Acima de 1 minuto; indica falta de capacidade na plataforma'],
            ['Taxa de sucesso na primeira tentativa', 'Por destino', 'Queda abaixo de 95% em uma hora'],
            ['p95 do tempo de resposta', 'Por destino', 'Acima de 2 segundos, antes de chegar ao timeout'],
            ['Destinos em pausa e desativados', 'Global', 'Crescimento fora do padrão da semana'],
            ['Entregas mortas por dia', 'Por destino e global', 'Qualquer valor acima de zero em cliente com contrato de integração'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Separar a idade global dos destinos saudáveis da idade por destino é o que permite distinguir um cliente com problema de uma plataforma sem capacidade. Se só um destino está atrasado, o problema é dele, e o painel de entregas com o último erro e um botão de reenviar resolve a maior parte das conversas. Se todos estão atrasando juntos, o problema é seu.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que usar o PostgreSQL como fila em vez de SQS, RabbitMQ ou Kafka?',
      answer:
        'Porque o requisito central é limitar a concorrência por destino, e poucos brokers fazem isso de forma nativa com milhares de destinos. Criar uma fila por endpoint vira um problema operacional quando os endpoints são criados e removidos pelos clientes, e uma fila única com consumidores que limitam por destino reencontra o bloqueio no início da fila. Com o banco, a entrega é gravada na mesma transação da mudança de negócio, a fila por destino é um índice parcial e o painel de entregas é uma consulta. Até algumas centenas de entregas por segundo isso funciona bem. Acima disso, o caminho costuma ser um broker particionado pelo identificador do destino, com consumidores que mantêm um limite por chave, e o banco continua como fonte da verdade do estado de cada entrega.',
    },
    {
      question: 'Devo garantir a ordem de entrega dos eventos?',
      answer:
        'Na maior parte dos casos, não. Garantir ordem por destino exige limitar a concorrência a um e parar toda a fila do destino atrás de uma única entrega que falha, o que transforma um evento problemático em atraso para todos os outros daquele cliente. É mais robusto levar em cada payload a versão ou a data de atualização da entidade, para que o receptor descarte o que for mais antigo do que já tem, ou usar eventos finos, em que o cliente busca o estado atual na API e a ordem deixa de importar. Quando a ordem é realmente necessária, como em um razão contábil, ela deve ser por entidade, não por destino, e a documentação precisa dizer isso.',
    },
    {
      question: 'O que fazer com as entregas que morreram?',
      answer:
        'Elas não são lixo, são uma lista de trabalho. O cliente precisa ver no painel quais eventos não chegaram e por quê, com o último erro de cada um, e poder reenviá-los por intervalo de tempo depois de corrigir o endpoint. Em paralelo, a API de listagem de eventos permite que ele reconcilie sem depender da plataforma. Do lado interno, vale acompanhar as entregas mortas por cliente: um volume constante costuma indicar um destino abandonado que deveria ser desativado, enquanto um pico repentino costuma indicar uma mudança do lado do cliente que precisa de contato direto.',
    },
  ],
  conclusion: {
    title: 'Webhook de saída é uma fila por cliente, com prazo e com teto',
    description:
      'Um destino lento não derruba a plataforma por falhar, e sim por demorar: ele segura workers, a fila cresce e todos os outros clientes passam a esperar por ele. O que resolve é um contrato claro de confirmação em cinco segundos, uma fila por destino com limite de concorrência e reserva intercalada, retentativa com recuo, jitter e prazo de validade, pausa com sondagem, fusão de eventos de estado e desativação de destinos abandonados. A métrica que avisa antes do cliente é a idade da entrega pendente mais antiga, por destino. Posso revisar como a sua plataforma envia webhooks, implementar a fila por destino com esses limites e montar o painel de entregas e as métricas que mostram quando um cliente está ficando para trás.',
    cta: 'Falar sobre as integrações da minha plataforma',
  },
  related: [
    {
      label: 'Chave de particionamento errada: a fila que trava porque um cliente sozinho ocupa tudo',
      to: '/blog/chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo',
    },
    {
      label: 'Retentativa sem teto: quando o cliente insistente vira o próprio ataque',
      to: '/blog/retentativa-sem-teto-cliente-insistente-vira-proprio-ataque',
    },
    {
      label: 'Automação e integrações',
      to: '/servicos/automacao-e-integracoes',
    },
  ],
};

const en = {
  intro:
    'The order platform sent webhooks to one thousand eight hundred customer integrations: ERPs, shipping systems, connected spreadsheets and marketing automations. One Tuesday, the ERP of a single retailer started responding in twenty-eight seconds because of a migration on their side. The send timeout was thirty seconds, so no call failed: they were all slow. Within forty minutes, all sixteen delivery workers were stuck on that endpoint, the queue passed two million deliveries and the other one thousand seven hundred and ninety-nine customers started receiving order events three hours late. The ones that timed out went straight back into the queue and competed for the same workers. When the retailer finished the migration, they received nine hundred thousand events in a few minutes and went down again. No customer did anything wrong from their own point of view, and nobody on the platform side could confirm whether an event had arrived. This article explains how one slow destination holds up delivery for everyone, what acknowledgement contract an outbound webhook needs, how to build a per-destination queue with a concurrency limit, how to retry with backoff, jitter and an expiry, how to pause, merge and discard deliberately instead of piling up forever, and what to measure to know a customer is falling behind before they open a ticket.',
  sections: [
    {
      title: 'How one slow customer holds up delivery for everyone',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The math behind the incident is Little\'s law: the concurrency needed to keep up with a flow is the arrival rate multiplied by the service time. The retailer received twelve events per second. With twenty-eight second responses, keeping up with that single destination would take three hundred and thirty-six simultaneous connections. The pool had sixteen workers for every destination. Since the queue was a single first-in, first-out list, and the part of it growing fastest belonged to that customer, every worker that finished a delivery took the next one from the queue and, more and more often, it belonged to the slow destination.',
        },
        {
          type: 'diagram',
          value: poolDiagramEn,
        },
        {
          type: 'paragraph',
          value:
            'Nothing in the design was wrong on its own. The defect was in the sum of reasonable decisions that, together, hand everyone\'s capacity to whoever responds worst. The table summarizes the decisions that usually show up together and what each one does when a destination slows down.',
        },
        {
          type: 'table',
          columns: ['Decision', 'Why it seemed reasonable', 'What it does with a slow destination'],
          rows: [
            [
              '30 second timeout',
              'Avoids false negatives for customers that take a little longer',
              'Each slow delivery holds a worker for 30 seconds instead of releasing it in 5',
            ],
            [
              'Single first-in, first-out queue',
              'Simple to build and to reason about',
              'The destination with the most accumulated events ends up taking every worker',
            ],
            [
              'Immediate retry',
              'The error may have been momentary',
              'Doubles the load on someone who is already not keeping up',
            ],
            [
              'No expiry',
              'No event can ever be lost',
              'The queue grows without limit and three-day-old events compete with current ones',
            ],
            [
              'No per-destination ceiling',
              'Every customer is treated equally',
              'A single customer sets the latency for everyone else',
            ],
            [
              'Resending everything when the destination recovers',
              'Deliver what was pending as soon as possible',
              'The customer who just recovered receives a burst and goes down again',
            ],
          ],
        },
      ],
    },
    {
      title: 'The acknowledgement contract: what counts as delivered and how long to wait',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The problem\'s title is literal: nobody acknowledges because the contract never said what acknowledging means. The rule that solves most cases is to publish that a delivery only counts when the destination responds with a 2xx status within five seconds, and that the response body is ignored. That forces the customer to do what they should be doing anyway: store the event, respond right away and process it later, in their own queue. An endpoint that calls three APIs and writes to four tables before responding is not a webhook receiver, it is synchronous processing in disguise, and it will blow the deadline precisely on the busiest days.',
        },
        {
          type: 'table',
          columns: ['Destination response', 'Platform action', 'Counts as a destination failure?'],
          rows: [
            ['2xx within 5 s', 'Marks it delivered and resets the destination\'s consecutive failures', 'No'],
            ['Timeout, connection refused, DNS or TLS error', 'Retries with backoff', 'Yes'],
            ['429 or 503 with Retry-After', 'Retries after the requested time, within the ceiling', 'Yes'],
            ['408, 425, 429 and 5xx without Retry-After', 'Retries with backoff', 'Yes'],
            ['3xx', 'Does not follow the redirect; retries and warns that the URL changed', 'Yes'],
            ['400, 401, 403, 404', 'Retries with backoff, because it is usually configuration the customer fixes', 'Yes'],
            ['410 Gone', 'Disables the destination and stops sending', 'Ends the destination'],
            ['413 Payload Too Large', 'Marks the delivery as dead, because repeating it does not change its size', 'Yes'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Three details prevent surprises. Not following redirects stops a misconfigured, or compromised, endpoint from making the platform send signed events to another address. Not reading the response body stops a destination that returns a ten megabyte error page from eating the worker\'s memory. And the timeout must cover the entire call, connection, TLS and response, not just the connection time, which is the default in several HTTP libraries and the reason many workers hang for minutes on servers that accept the connection and never answer.',
        },
      ],
    },
    {
      title: 'One queue per destination, not one queue for everyone',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The structural fix is to treat each endpoint as its own queue with a concurrency limit, and to have workers go through destinations in an interleaved way. With a limit of four simultaneous deliveries per destination, the slow retailer takes at most four connections, their queue grows on its own and every other customer keeps receiving within seconds. For up to a few hundred deliveries per second, PostgreSQL handles this well with two tables, and the delivery is written in the same transaction that changes the order, with no risk of the event getting lost between the database and the queue.',
        },
        {
          type: 'code',
          value: schemaSql,
        },
        {
          type: 'paragraph',
          value:
            'The claim picks, for each active destination that is not paused, at most the slots it still has free, using the partial queue index to read only the first rows of each one. Then it sorts by position within each destination, which yields the first delivery of every customer before the second delivery of any of them. A customer with two million pending deliveries and another with three compete on equal terms: each gets the same share as long as they have deliveries ready.',
        },
        {
          type: 'code',
          value: reservaSql,
        },
        {
          type: 'paragraph',
          value:
            'Counting in-flight deliveries and claiming must happen without another process claiming the same slots halfway through. FOR UPDATE SKIP LOCKED prevents two claims of the same row, but it does not prevent two workers from counting four free slots at the same time and claiming eight deliveries for the same destination. That is why the claim runs inside a short transaction that takes an advisory lock: it lasts a few milliseconds, so serializing that stretch costs little, and the per-destination limit becomes exact. If the platform grows to the point where the claim becomes a bottleneck, the next step is to partition destinations among groups of workers, each group with its own lock.',
        },
      ],
    },
    {
      title: 'Retries with backoff, jitter and an expiry',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Each failure reschedules the delivery with exponential backoff: thirty seconds on the first, doubling on every attempt, up to a six hour ceiling. The jitter keeps half of the interval fixed and half random, so deliveries that failed together do not come back together, and the Retry-After value is honored when the destination sends it. There are two give-up limits, twenty attempts or seventy-two hours of age, and whichever comes first moves the delivery to the dead state, which it only leaves through an explicit resend.',
        },
        {
          type: 'table',
          columns: ['Attempt', 'Wait before the next one', 'Note'],
          rows: [
            ['1', '15 to 30 seconds', 'Absorbs restarts and momentary failures'],
            ['3', '1 to 2 minutes', 'Covers a deploy on the customer side'],
            ['6', '8 to 16 minutes', 'The destination is probably already paused'],
            ['10', '2 h 08 to 4 h 16', 'A failure that is already a customer incident'],
            ['11 to 20', '3 to 6 hours', 'Ceiling; the twentieth happens between 31 and 63 hours after the event'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The worker below brings the pieces together: it claims deliveries up to the process limit, sends them with a five second timeout for the entire call, signs the body with HMAC including the timestamp, classifies the response and records the result. It uses the native fetch in Node 18 or later and the pg driver. On every failure, besides rescheduling the delivery, it increments the destination\'s consecutive failures, which feeds the pause described in the next section.',
        },
        {
          type: 'code',
          value: workerCode,
        },
        {
          type: 'list',
          items: [
            'The five second timeout is applied with AbortSignal.timeout, which covers connection, TLS, sending and waiting for the response.',
            'A delivery stuck in the sending state for more than a minute, because the process died mid-send, goes back to the queue on the next claim; the customer may receive the event twice, which is why the event identifier goes in the header.',
            'The six hour ceiling also applies to Retry-After: a destination that asks to wait thirty days does not block delivery beyond the ceiling.',
            'The retry is never immediate, not even on the first failure, because the first failure of an overloaded destination is exactly when repeating more makes everything worse.',
          ],
        },
      ],
    },
    {
      title: 'A per-destination ceiling: pause, merge and discard deliberately',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Limiting concurrency protects the other customers, but it does not stop the slow destination\'s queue from growing forever. Three mechanisms handle that. The first is the pause: after twenty consecutive failures, the destination stops receiving attempts for a few minutes, and each probing round that fails extends the pause up to one hour. When it ends, the claim releases at most the destination\'s four slots, which work as a probe: if they succeed, failures reset and delivery returns to its normal pace; if they fail, the pause starts again. That is a circuit breaker, except its state lives in the database and applies to every worker.',
        },
        {
          type: 'paragraph',
          value:
            'The second is merging. Many events describe the current state of an entity, such as order updated or stock changed. If a destination is down with fifty pending updates for the same order, delivering all fifty has no value: only the last one matters. With a merge key per entity, a pending delivery is replaced by the newest version instead of creating another row, and the queue of a stalled destination grows with the number of entities that changed, not the number of changes. Events that represent facts, such as payment approved or invoice issued, cannot be merged and carry no key. The third is disabling: a destination that has been failing for five days in a row is disabled, the customer\'s technical contact is notified and pending deliveries are kept until they decide to resend or discard them.',
        },
        {
          type: 'code',
          value: fusaoSql,
        },
        {
          type: 'table',
          columns: ['Mechanism', 'When to use it', 'Cost for the customer'],
          rows: [
            ['Pause with probing', 'Always; it is what stops you from hammering a destination that is down', 'None; events wait'],
            ['Merging per entity', 'Events that carry the complete state of the entity', 'Loses intermediate states, which usually nobody uses'],
            ['Thin events', 'Large or sensitive payloads; the event carries only the id and the customer fetches the current state from the API', 'One extra call per event'],
            ['Expiry and dead deliveries', 'Always; no event keeps retrying forever', 'Needs to reconcile through the log or ask for a resend'],
            ['Disabling after days of failure', 'Abandoned destinations, which make up a large part of the stalled queue', 'Re-enable the endpoint in the dashboard'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A destination\'s recovery also needs care. Without a limit, the retailer who finished the migration would receive nine hundred thousand events in minutes. With the concurrency limit, throughput to them stays around four deliveries divided by response time: with two hundred millisecond responses, twenty per second. That drains the queue in hours without taking the customer down again, and max_concorrencia can be tuned per destination for customers who can handle more.',
        },
      ],
    },
    {
      title: 'What the customer needs to know and what you need to measure',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Half of an outbound webhook\'s reliability lives in the documentation the customer reads. Without it, each integration invents its own assumptions, and wrong assumptions turn into tickets. The published contract needs to state, at a minimum:',
        },
        {
          type: 'list',
          items: [
            'That delivery is at least once: the same event may arrive twice, and the webhook-id header is the key to discard repeats.',
            'That order is not guaranteed: each payload carries the entity\'s version or update timestamp, and the receiver ignores anything older than what it already has.',
            'How to validate the signature, including the five minute tolerance for the timestamp, which prevents a captured event from being replayed.',
            'The five second deadline, the response table and what happens to the destination after days of failures.',
            'How to reconcile: an API that lists events by time range, kept for thirty days, so the customer recovers what they missed without depending on a resend.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'On the platform side, the metric that would have anticipated the incident is not the error rate, which stayed near zero while everything was slow. It is the age of the oldest pending delivery, per destination. It rises when the destination is slow, when it is failing and when it is paused, and it is the direct measure of what the customer feels. The query below shows the most delayed destinations, with queue, occupancy and pause state.',
        },
        {
          type: 'code',
          value: metricasSql,
        },
        {
          type: 'table',
          columns: ['Metric', 'Per destination or global', 'Suggested alert'],
          rows: [
            ['Age of the oldest pending delivery', 'Per destination', 'Above 15 minutes for an active customer; notify the customer, not just the team'],
            ['Age of the oldest pending delivery across healthy destinations', 'Global', 'Above 1 minute; it signals a lack of capacity on the platform'],
            ['First-attempt success rate', 'Per destination', 'Drop below 95% within an hour'],
            ['p95 response time', 'Per destination', 'Above 2 seconds, before it reaches the timeout'],
            ['Paused and disabled destinations', 'Global', 'Growth outside the weekly pattern'],
            ['Dead deliveries per day', 'Per destination and global', 'Any value above zero for a customer with an integration contract'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Separating the global age across healthy destinations from the per-destination age is what lets you tell a customer with a problem from a platform without capacity. If only one destination is behind, the problem is theirs, and a deliveries dashboard with the last error and a resend button settles most conversations. If everyone is falling behind together, the problem is yours.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why use PostgreSQL as the queue instead of SQS, RabbitMQ or Kafka?',
      answer:
        'Because the core requirement is limiting concurrency per destination, and few brokers do that natively with thousands of destinations. Creating one queue per endpoint becomes an operational problem when endpoints are created and removed by customers, and a single queue with consumers that limit per destination runs into head-of-line blocking again. With the database, the delivery is written in the same transaction as the business change, the per-destination queue is a partial index and the deliveries dashboard is a query. Up to a few hundred deliveries per second this works well. Beyond that, the usual path is a broker partitioned by destination identifier, with consumers that keep a limit per key, while the database remains the source of truth for the state of each delivery.',
    },
    {
      question: 'Should I guarantee event delivery order?',
      answer:
        'In most cases, no. Guaranteeing order per destination requires limiting concurrency to one and stopping the destination\'s whole queue behind a single failing delivery, which turns one problematic event into delay for everything else of that customer. It is more robust to carry the entity\'s version or update timestamp in each payload, so the receiver discards anything older than what it already has, or to use thin events, where the customer fetches the current state from the API and order stops mattering. When order is truly required, as in an accounting ledger, it should be per entity, not per destination, and the documentation needs to say so.',
    },
    {
      question: 'What should I do with dead deliveries?',
      answer:
        'They are not trash, they are a work list. The customer needs to see in the dashboard which events did not arrive and why, with the last error of each one, and be able to resend them by time range after fixing the endpoint. In parallel, the event listing API lets them reconcile without depending on the platform. Internally, it is worth tracking dead deliveries per customer: a constant volume usually points to an abandoned destination that should be disabled, while a sudden spike usually points to a change on the customer side that needs direct contact.',
    },
  ],
  conclusion: {
    title: 'An outbound webhook is a queue per customer, with an expiry and a ceiling',
    description:
      'A slow destination does not take the platform down by failing, but by being slow: it holds workers, the queue grows and every other customer ends up waiting for it. What solves it is a clear five second acknowledgement contract, a per-destination queue with a concurrency limit and interleaved claiming, retries with backoff, jitter and an expiry, pausing with probes, merging state events and disabling abandoned destinations. The metric that warns you before the customer does is the age of the oldest pending delivery, per destination. I can review how your platform sends webhooks, implement the per-destination queue with these limits and set up the deliveries dashboard and the metrics that show when a customer is falling behind.',
    cta: 'Talk about my platform\'s integrations',
  },
  related: [
    {
      label: 'The wrong partition key: the queue that stalls because one customer takes it all',
      to: '/blog/chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo',
    },
    {
      label: 'Retries with no ceiling: when the insistent client becomes the attack',
      to: '/blog/retentativa-sem-teto-cliente-insistente-vira-proprio-ataque',
    },
    {
      label: 'Automation and integrations',
      to: '/servicos/automacao-e-integracoes',
    },
  ],
};

const es = {
  intro:
    'La plataforma de pedidos enviaba webhooks a mil ochocientas integraciones de clientes: ERPs, sistemas de expedición, hojas de cálculo conectadas y automatizaciones de marketing. Un martes, el ERP de un solo minorista empezó a responder en veintiocho segundos por una migración de su lado. El timeout de envío era de treinta segundos, así que ninguna llamada fallaba: todas tardaban. En cuarenta minutos, los dieciséis workers de entrega estaban atrapados en ese endpoint, la cola superó los dos millones de entregas y los otros mil setecientos noventa y nueve clientes empezaron a recibir eventos de pedido con tres horas de retraso. Los que daban timeout volvían de inmediato a la cola y competían por los mismos workers. Cuando el minorista terminó la migración, recibió novecientos mil eventos en pocos minutos y volvió a caerse. Ningún cliente hizo nada mal desde su punto de vista, y nadie del lado de la plataforma podía confirmar si un evento había llegado. Este artículo explica cómo un destino lento frena la entrega de todos, qué contrato de confirmación necesita un webhook saliente, cómo montar una cola por destino con límite de concurrencia, cómo reintentar con backoff, jitter y fecha de caducidad, cómo pausar, fusionar y descartar con criterio en lugar de acumular para siempre, y qué medir para saber que un cliente se está quedando atrás antes de que abra un ticket.',
  sections: [
    {
      title: 'Cómo un solo cliente lento frena la entrega de todos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La cuenta que explica el incidente es la ley de Little: la concurrencia necesaria para seguir un flujo es la tasa de llegada multiplicada por el tiempo de atención. El minorista recibía doce eventos por segundo. Con respuestas de veintiocho segundos, seguir el ritmo de ese único destino requeriría trescientas treinta y seis conexiones simultáneas. El pool tenía dieciséis workers para todos los destinos. Como la cola era única y por orden de llegada, y la parte que más crecía era justamente la de ese cliente, cada worker que terminaba una entrega tomaba la siguiente de la cola y, cada vez con más frecuencia, era del destino lento.',
        },
        {
          type: 'diagram',
          value: poolDiagramEs,
        },
        {
          type: 'paragraph',
          value:
            'Nada en el diseño estaba mal por separado. El defecto estaba en la suma de decisiones razonables que, juntas, entregan la capacidad de todos a quien peor responde. La tabla resume las decisiones que suelen aparecer juntas y qué hace cada una cuando un destino se vuelve lento.',
        },
        {
          type: 'table',
          columns: ['Decisión', 'Por qué parecía razonable', 'Qué hace con un destino lento'],
          rows: [
            [
              'Timeout de 30 segundos',
              'Evita falsos negativos en clientes que tardan un poco',
              'Cada entrega lenta retiene un worker 30 segundos en lugar de liberarlo en 5',
            ],
            [
              'Cola única por orden de llegada',
              'Simple de implementar y de razonar',
              'El destino con más eventos acumulados termina ocupando todos los workers',
            ],
            [
              'Reintento inmediato',
              'El error pudo ser momentáneo',
              'Duplica la carga sobre quien ya no da abasto',
            ],
            [
              'Sin fecha de caducidad',
              'Ningún evento puede perderse',
              'La cola crece sin límite y eventos de hace tres días compiten con los actuales',
            ],
            [
              'Sin techo por destino',
              'Todos los clientes reciben el mismo trato',
              'Un solo cliente define la latencia de todos los demás',
            ],
            [
              'Reenviar todo cuando el destino vuelve',
              'Entregar lo pendiente cuanto antes',
              'El cliente que acaba de recuperarse recibe una ráfaga y vuelve a caerse',
            ],
          ],
        },
      ],
    },
    {
      title: 'El contrato de confirmación: qué cuenta como entregado y cuánto esperar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El título del problema es literal: nadie confirma porque el contrato nunca dijo qué significa confirmar. La regla que resuelve la mayoría de los casos es publicar que una entrega solo cuenta cuando el destino responde con un estado 2xx en menos de cinco segundos, y que el cuerpo de la respuesta se ignora. Eso obliga al cliente a hacer lo que debería hacer de todos modos: guardar el evento, responder en el acto y procesarlo después, en su propia cola. Un endpoint que llama a tres APIs y escribe en cuatro tablas antes de responder no es un receptor de webhooks, es un procesamiento síncrono disfrazado, y va a superar el plazo justo en los días de más movimiento.',
        },
        {
          type: 'table',
          columns: ['Respuesta del destino', 'Acción de la plataforma', '¿Cuenta como fallo del destino?'],
          rows: [
            ['2xx en menos de 5 s', 'La marca como entregada y reinicia los fallos consecutivos del destino', 'No'],
            ['Timeout, conexión rechazada, error de DNS o TLS', 'Reintenta con backoff', 'Sí'],
            ['429 o 503 con Retry-After', 'Reintenta tras el tiempo pedido, respetando el techo', 'Sí'],
            ['408, 425, 429 y 5xx sin Retry-After', 'Reintenta con backoff', 'Sí'],
            ['3xx', 'No sigue la redirección; reintenta y avisa que la URL cambió', 'Sí'],
            ['400, 401, 403, 404', 'Reintenta con backoff, porque suele ser configuración que el cliente corrige', 'Sí'],
            ['410 Gone', 'Desactiva el destino y deja de enviar', 'Cierra el destino'],
            ['413 Payload Too Large', 'Marca la entrega como muerta, porque repetirla no cambia su tamaño', 'Sí'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Tres detalles evitan sorpresas. No seguir redirecciones impide que un endpoint mal configurado, o comprometido, haga que la plataforma envíe eventos firmados a otra dirección. No leer el cuerpo de la respuesta impide que un destino que devuelve una página de error de diez megabytes consuma la memoria del worker. Y el timeout debe cubrir la llamada entera, conexión, TLS y respuesta, no solo el tiempo de conexión, que es el valor por defecto de varias bibliotecas HTTP y la razón por la que muchos workers se quedan colgados durante minutos en servidores que aceptan la conexión y nunca responden.',
        },
      ],
    },
    {
      title: 'Una cola por destino, no una cola para todos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La corrección estructural es tratar cada endpoint como una cola propia con un límite de concurrencia, y hacer que los workers recorran los destinos de forma intercalada. Con un límite de cuatro entregas simultáneas por destino, el minorista lento ocupa como máximo cuatro conexiones, su cola crece sola y los demás clientes siguen recibiendo en segundos. Hasta algunos cientos de entregas por segundo, PostgreSQL lo resuelve bien con dos tablas, y la entrega se escribe en la misma transacción que modifica el pedido, sin riesgo de que el evento se pierda entre la base de datos y la cola.',
        },
        {
          type: 'code',
          value: schemaSql,
        },
        {
          type: 'paragraph',
          value:
            'La reserva elige, para cada destino activo y fuera de pausa, como máximo los huecos que todavía tiene libres, usando el índice parcial de la cola para leer solo las primeras filas de cada uno. Después ordena por la posición dentro de cada destino, lo que entrega la primera de cada cliente antes de la segunda de cualquiera. Un cliente con dos millones de pendientes y otro con tres compiten en igualdad: cada uno recibe la misma porción mientras tenga entregas listas.',
        },
        {
          type: 'code',
          value: reservaSql,
        },
        {
          type: 'paragraph',
          value:
            'El conteo de entregas en vuelo y la reserva deben ocurrir sin que otro proceso reserve los mismos huecos a mitad de camino. FOR UPDATE SKIP LOCKED impide dos reservas de la misma fila, pero no impide que dos workers cuenten cuatro huecos libres al mismo tiempo y reserven ocho entregas del mismo destino. Por eso la reserva corre dentro de una transacción corta que toma un advisory lock: dura pocos milisegundos, así que serializar ese tramo cuesta poco, y el límite por destino pasa a ser exacto. Si la plataforma crece hasta que la reserva se vuelva un cuello de botella, el siguiente paso es particionar los destinos entre grupos de workers, cada grupo con su propio lock.',
        },
      ],
    },
    {
      title: 'Reintentos con backoff, jitter y fecha de caducidad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cada fallo reprograma la entrega con backoff exponencial: treinta segundos en el primero, duplicando en cada intento, hasta un techo de seis horas. El jitter mantiene fija la mitad del intervalo y aleatoria la otra mitad, para que las entregas que fallaron juntas no vuelvan juntas, y se respeta el valor de Retry-After cuando el destino lo envía. Hay dos límites de abandono, veinte intentos o setenta y dos horas de antigüedad, y el que llegue primero lleva la entrega al estado muerta, del que solo sale con un reenvío explícito.',
        },
        {
          type: 'table',
          columns: ['Intento', 'Espera antes del siguiente', 'Observación'],
          rows: [
            ['1', '15 a 30 segundos', 'Absorbe reinicios y fallos momentáneos'],
            ['3', '1 a 2 minutos', 'Cubre un despliegue del lado del cliente'],
            ['6', '8 a 16 minutos', 'El destino probablemente ya está en pausa'],
            ['10', '2 h 08 a 4 h 16', 'Un fallo que ya es un incidente del cliente'],
            ['11 a 20', '3 a 6 horas', 'Techo; el vigésimo ocurre entre 31 y 63 horas después del evento'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El worker de abajo junta las piezas: reserva entregas hasta el límite del proceso, las envía con un timeout de cinco segundos para la llamada entera, firma el cuerpo con HMAC incluyendo el timestamp, clasifica la respuesta y registra el resultado. Usa el fetch nativo de Node 18 o superior y el driver pg. En cada fallo, además de reprogramar la entrega, incrementa los fallos consecutivos del destino, lo que alimenta la pausa descrita en la siguiente sección.',
        },
        {
          type: 'code',
          value: workerCode,
        },
        {
          type: 'list',
          items: [
            'El timeout de cinco segundos se aplica con AbortSignal.timeout, que cubre conexión, TLS, envío y espera de la respuesta.',
            'Una entrega atascada en enviando durante más de un minuto, porque el proceso murió a mitad del envío, vuelve a la cola en la siguiente reserva; el cliente puede recibir el evento dos veces, y por eso el identificador del evento va en la cabecera.',
            'El techo de seis horas también se aplica a Retry-After: un destino que pide esperar treinta días no bloquea la entrega más allá del techo.',
            'El reintento nunca es inmediato, ni siquiera en el primer fallo, porque el primer fallo de un destino sobrecargado es justo el momento en que repetir más lo empeora todo.',
          ],
        },
      ],
    },
    {
      title: 'Techo por destino: pausar, fusionar y descartar con criterio',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Limitar la concurrencia protege a los demás clientes, pero no impide que la cola del destino lento crezca sin fin. Tres mecanismos lo resuelven. El primero es la pausa: tras veinte fallos consecutivos, el destino deja de recibir intentos durante algunos minutos, y cada ronda de sondeo que falla extiende la pausa hasta una hora. Cuando termina, la reserva libera como máximo los cuatro huecos del destino, que funcionan como sondeo: si salen bien, los fallos se reinician y la entrega vuelve a su ritmo normal; si fallan, la pausa empieza de nuevo. Es un circuit breaker, con la diferencia de que su estado vive en la base de datos y vale para todos los workers.',
        },
        {
          type: 'paragraph',
          value:
            'El segundo es la fusión. Buena parte de los eventos describe el estado actual de una entidad, como pedido actualizado o stock modificado. Si un destino está parado con cincuenta actualizaciones pendientes del mismo pedido, entregar las cincuenta no aporta nada: solo importa la última. Con una clave de fusión por entidad, una entrega pendiente se reemplaza por la versión más nueva en lugar de crear otra fila, y la cola de un destino parado pasa a tener el tamaño del número de entidades que cambiaron, no del número de cambios. Los eventos que representan hechos, como pago aprobado o factura emitida, no pueden fusionarse y quedan sin clave. El tercero es la desactivación: un destino que falla desde hace cinco días seguidos se desactiva, se avisa al responsable técnico del cliente y las entregas pendientes se guardan hasta que decida reenviarlas o descartarlas.',
        },
        {
          type: 'code',
          value: fusaoSql,
        },
        {
          type: 'table',
          columns: ['Mecanismo', 'Cuándo usarlo', 'Costo para el cliente'],
          rows: [
            ['Pausa con sondeo', 'Siempre; es lo que evita martillar un destino caído', 'Ninguno; los eventos esperan'],
            ['Fusión por entidad', 'Eventos que llevan el estado completo de la entidad', 'Pierde los estados intermedios, que en general nadie usa'],
            ['Eventos finos', 'Payloads grandes o sensibles; el evento lleva solo el id y el cliente consulta el estado actual en la API', 'Una llamada extra por evento'],
            ['Caducidad y entrega muerta', 'Siempre; ningún evento queda reintentando para siempre', 'Necesita conciliar por el log o pedir un reenvío'],
            ['Desactivación tras días de fallo', 'Destinos abandonados, que representan buena parte de la cola parada', 'Reactivar el endpoint en el panel'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La vuelta de un destino también requiere cuidado. Sin límite, el minorista que terminó la migración recibiría novecientos mil eventos en minutos. Con el límite de concurrencia, el caudal hacia él queda en torno a cuatro entregas divididas por el tiempo de respuesta: con respuestas de doscientos milisegundos, veinte por segundo. Eso vacía la cola en horas sin volver a tumbar al cliente, y el valor de max_concorrencia puede ajustarse por destino para clientes que aguantan más.',
        },
      ],
    },
    {
      title: 'Qué necesita saber el cliente y qué necesitas medir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La mitad de la fiabilidad de un webhook saliente está en la documentación que lee el cliente. Sin ella, cada integración inventa sus propias suposiciones, y las suposiciones equivocadas se convierten en tickets. El contrato publicado debe decir, como mínimo:',
        },
        {
          type: 'list',
          items: [
            'Que la entrega es al menos una vez: el mismo evento puede llegar dos veces, y la cabecera webhook-id es la clave para descartar repeticiones.',
            'Que el orden no está garantizado: cada payload lleva la versión o la fecha de actualización de la entidad, y el receptor ignora lo que sea más antiguo que lo que ya tiene.',
            'Cómo validar la firma, incluida la tolerancia de cinco minutos para el timestamp, que impide la repetición de un evento capturado.',
            'El plazo de cinco segundos, la tabla de respuestas y qué le ocurre al destino tras días fallando.',
            'Cómo conciliar: una API que lista eventos por intervalo de tiempo, guardados durante treinta días, para que el cliente recupere lo que perdió sin depender de un reenvío.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Del lado de la plataforma, la métrica que habría anticipado el incidente no es la tasa de error, que se quedó cerca de cero mientras todo tardaba. Es la antigüedad de la entrega pendiente más vieja, por destino. Sube cuando el destino está lento, cuando está fallando y cuando está en pausa, y es la medida directa de lo que siente el cliente. La consulta de abajo muestra los destinos más atrasados, con cola, ocupación y estado de pausa.',
        },
        {
          type: 'code',
          value: metricasSql,
        },
        {
          type: 'table',
          columns: ['Métrica', 'Por destino o global', 'Alerta sugerida'],
          rows: [
            ['Antigüedad de la entrega pendiente más vieja', 'Por destino', 'Más de 15 minutos en un cliente activo; avisar al cliente, no solo al equipo'],
            ['Antigüedad de la entrega pendiente más vieja entre destinos sanos', 'Global', 'Más de 1 minuto; indica falta de capacidad en la plataforma'],
            ['Tasa de éxito en el primer intento', 'Por destino', 'Caída por debajo del 95% en una hora'],
            ['p95 del tiempo de respuesta', 'Por destino', 'Más de 2 segundos, antes de llegar al timeout'],
            ['Destinos en pausa y desactivados', 'Global', 'Crecimiento fuera del patrón semanal'],
            ['Entregas muertas por día', 'Por destino y global', 'Cualquier valor mayor que cero en un cliente con contrato de integración'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Separar la antigüedad global de los destinos sanos de la antigüedad por destino es lo que permite distinguir a un cliente con un problema de una plataforma sin capacidad. Si solo un destino va atrasado, el problema es suyo, y un panel de entregas con el último error y un botón de reenviar resuelve la mayoría de las conversaciones. Si todos se atrasan juntos, el problema es tuyo.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué usar PostgreSQL como cola en lugar de SQS, RabbitMQ o Kafka?',
      answer:
        'Porque el requisito central es limitar la concurrencia por destino, y pocos brokers lo hacen de forma nativa con miles de destinos. Crear una cola por endpoint se vuelve un problema operativo cuando los endpoints los crean y eliminan los clientes, y una cola única con consumidores que limitan por destino vuelve a encontrarse con el bloqueo en la cabeza de la cola. Con la base de datos, la entrega se escribe en la misma transacción que el cambio de negocio, la cola por destino es un índice parcial y el panel de entregas es una consulta. Hasta algunos cientos de entregas por segundo esto funciona bien. Por encima, el camino habitual es un broker particionado por el identificador del destino, con consumidores que mantienen un límite por clave, y la base de datos sigue siendo la fuente de verdad del estado de cada entrega.',
    },
    {
      question: '¿Debo garantizar el orden de entrega de los eventos?',
      answer:
        'En la mayoría de los casos, no. Garantizar el orden por destino exige limitar la concurrencia a uno y detener toda la cola del destino detrás de una única entrega que falla, lo que convierte un evento problemático en retraso para todos los demás de ese cliente. Es más robusto incluir en cada payload la versión o la fecha de actualización de la entidad, para que el receptor descarte lo que sea más antiguo que lo que ya tiene, o usar eventos finos, en los que el cliente consulta el estado actual en la API y el orden deja de importar. Cuando el orden es realmente necesario, como en un libro contable, debe ser por entidad, no por destino, y la documentación tiene que decirlo.',
    },
    {
      question: '¿Qué hago con las entregas muertas?',
      answer:
        'No son basura, son una lista de trabajo. El cliente necesita ver en el panel qué eventos no llegaron y por qué, con el último error de cada uno, y poder reenviarlos por intervalo de tiempo después de corregir el endpoint. En paralelo, la API de listado de eventos le permite conciliar sin depender de la plataforma. Internamente, conviene seguir las entregas muertas por cliente: un volumen constante suele indicar un destino abandonado que debería desactivarse, mientras que un pico repentino suele indicar un cambio del lado del cliente que requiere contacto directo.',
    },
  ],
  conclusion: {
    title: 'Un webhook saliente es una cola por cliente, con caducidad y con techo',
    description:
      'Un destino lento no tumba la plataforma por fallar, sino por tardar: retiene workers, la cola crece y todos los demás clientes terminan esperándolo. Lo que lo resuelve es un contrato claro de confirmación en cinco segundos, una cola por destino con límite de concurrencia y reserva intercalada, reintentos con backoff, jitter y caducidad, pausa con sondeo, fusión de eventos de estado y desactivación de destinos abandonados. La métrica que avisa antes que el cliente es la antigüedad de la entrega pendiente más vieja, por destino. Puedo revisar cómo tu plataforma envía webhooks, implementar la cola por destino con estos límites y montar el panel de entregas y las métricas que muestran cuándo un cliente se está quedando atrás.',
    cta: 'Hablar sobre las integraciones de mi plataforma',
  },
  related: [
    {
      label: 'Clave de particionamiento equivocada: la cola que se traba porque un cliente lo ocupa todo',
      to: '/blog/chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo',
    },
    {
      label: 'Reintentos sin techo: cuándo el cliente insistente se convierte en el ataque',
      to: '/blog/retentativa-sem-teto-cliente-insistente-vira-proprio-ataque',
    },
    {
      label: 'Automatización e integraciones',
      to: '/servicos/automacao-e-integracoes',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
