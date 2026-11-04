// Conteudo do artigo: webhook recebido fora de ordem. Por que a ordem de entrega nao e garantida,
// por que o handler que trata cada evento como comando perde o cancelamento, como gravar o evento
// antes de aplicar, decidir com uma funcao que nao depende da ordem de chegada, disparar efeitos a
// partir da transicao de estado e fechar as lacunas com uma reconciliacao periodica na fonte.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const handlerIngenuoCode = `// O handler que assume ordem: cada evento vira um comando sobre o estado atual.
router.post('/webhooks/loja', express.json(), async (req, res) => {
  const { type, data } = req.body;

  if (type === 'order.created') {
    await pool.query(
      "INSERT INTO pedidos (id, status, total_centavos) VALUES ($1, 'criado', $2) ON CONFLICT (id) DO NOTHING",
      [data.id, data.total_cents],
    );
  } else if (type === 'order.paid') {
    // Se o pedido ainda nao existe, atualiza 0 linhas e o pagamento some sem erro.
    await pool.query("UPDATE pedidos SET status = 'pago' WHERE id = $1", [data.id]);
    await filaSeparacao.add({ pedidoId: data.id });
  } else if (type === 'order.canceled') {
    // Mesmo problema: cancelamento antes da criacao nao encontra linha e e descartado.
    await pool.query("UPDATE pedidos SET status = 'cancelado' WHERE id = $1", [data.id]);
  }

  res.sendStatus(200);
});`;

const diagnosticoCode = `-- Quantos eventos chegaram depois de um evento mais novo do mesmo pedido.
-- Roda sobre o log bruto de entregas que o handler antigo ja gravava.
WITH entregas AS (
  SELECT recurso_id,
         tipo,
         ocorrido_em,
         recebido_em,
         max(ocorrido_em) OVER (
           PARTITION BY recurso_id
           ORDER BY recebido_em
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ) AS mais_novo_ja_recebido
    FROM webhook_log
   WHERE recebido_em >= now() - interval '30 days'
)
SELECT tipo,
       count(*) AS total,
       count(*) FILTER (WHERE ocorrido_em < mais_novo_ja_recebido) AS fora_de_ordem,
       round(100.0 * count(*) FILTER (WHERE ocorrido_em < mais_novo_ja_recebido) / count(*), 2) AS pct
  FROM entregas
 GROUP BY tipo
 ORDER BY fora_de_ordem DESC;`;

const esquemaCode = `-- Caixa de entrada: todo evento e gravado antes de qualquer decisao.
CREATE TABLE webhook_eventos (
  evento_id    text        PRIMARY KEY,          -- id do evento no provedor: deduplica reentregas
  recurso_id   text        NOT NULL,             -- id do pedido a que o evento se refere
  tipo         text        NOT NULL,
  payload      jsonb       NOT NULL,
  recebido_em  timestamptz NOT NULL DEFAULT now(),
  aplicado_em  timestamptz,
  resultado    text                              -- aplicado, evento_antigo, regressao_de_terminal...
);

-- A varredura so procura o que ainda nao foi aplicado.
CREATE INDEX webhook_eventos_pendentes
    ON webhook_eventos (recebido_em) WHERE aplicado_em IS NULL;

CREATE TABLE pedidos (
  id              text        PRIMARY KEY,       -- id do pedido no provedor
  status          text        NOT NULL
                  CHECK (status IN ('criado', 'pago', 'enviado', 'cancelado', 'reembolsado')),
  total_centavos  bigint,                        -- pode chegar depois: o primeiro fato nem sempre traz tudo
  cliente_email   text,
  versao_origem   bigint      NOT NULL,          -- chave de ordenacao do ultimo fato aplicado
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

-- Efeitos colaterais nascem da transicao de estado, na mesma transacao.
CREATE TABLE outbox (
  pedido_id   text        NOT NULL,
  efeito      text        NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  enviado_em  timestamptz,
  PRIMARY KEY (pedido_id, efeito)
);

-- Ponto de partida da reconciliacao periodica.
CREATE TABLE cursores (
  nome   text        PRIMARY KEY,
  valor  timestamptz NOT NULL
);
INSERT INTO cursores (nome, valor) VALUES ('pedidos_loja', now() - interval '1 day');`;

const aplicarCode = `// webhooks/aplicar.js - aplica fatos sobre pedidos sem depender da ordem de chegada.
import { pool } from '../db.js';

// Desempate quando dois fatos tem o mesmo instante: o estado mais avancado vence.
export const RANK = { criado: 1, pago: 2, enviado: 3, cancelado: 4, reembolsado: 5 };

// Estados de onde so se sai para os destinos listados. Fato mais novo fora disso e anomalia.
const TERMINAIS = { cancelado: ['reembolsado'], reembolsado: [] };

const STATUS_DO_TIPO = {
  'order.created': 'criado',
  'order.paid': 'pago',
  'order.shipped': 'enviado',
  'order.canceled': 'cancelado',
  'order.refunded': 'reembolsado',
};

const STATUS_DA_API = {
  open: 'criado',
  paid: 'pago',
  shipped: 'enviado',
  canceled: 'cancelado',
  refunded: 'reembolsado',
};

// Um provedor, um criterio: sequencia por recurso quando existe; senao, instante do fato em ms
// vezes 10 mais o rank, o que cabe com folga em Number.MAX_SAFE_INTEGER.
export function versaoDoFato({ sequence, occurredAt }, status) {
  if (Number.isSafeInteger(sequence)) return sequence;
  const ms = Date.parse(occurredAt);
  if (Number.isNaN(ms)) throw new Error(\`instante invalido: \${occurredAt}\`);
  return ms * 10 + RANK[status];
}

// Funcao pura: o resultado depende do estado e do fato, nunca de quem chegou primeiro.
export function decidir(atual, status, versao) {
  if (!atual) return { aplicar: true, de: null };
  if (versao <= Number(atual.versao_origem)) return { aplicar: false, motivo: 'evento_antigo' };
  const saidas = TERMINAIS[atual.status];
  if (saidas && !saidas.includes(status)) {
    return { aplicar: false, motivo: 'regressao_de_terminal' };
  }
  return { aplicar: true, de: atual.status };
}

// Efeitos saem da transicao real, nao do tipo do evento recebido.
function efeitosDaTransicao(de, para) {
  if (para === 'pago') return ['liberar_separacao'];
  if (para === 'cancelado' && de === 'pago') return ['interromper_separacao'];
  if (para === 'reembolsado') return ['notificar_reembolso'];
  return [];
}

// Precisa rodar dentro de uma transacao aberta pelo chamador.
export async function aplicarFato(client, { recursoId, status, versao, dados }) {
  if (!status) throw new Error(\`status desconhecido para o pedido \${recursoId}\`);

  // Serializa os fatos do mesmo pedido, inclusive quando a linha ainda nao existe.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [recursoId]);

  const { rows } = await client.query('SELECT status, versao_origem FROM pedidos WHERE id = $1', [
    recursoId,
  ]);
  const decisao = decidir(rows[0], status, versao);
  const total = dados.total_cents ?? null;
  const email = dados.customer_email ?? null;

  if (!decisao.aplicar) {
    // Fato antigo nao muda o status, mas ainda completa campos que o fato novo nao trouxe.
    await client.query(
      \`UPDATE pedidos
          SET total_centavos = COALESCE(total_centavos, $2),
              cliente_email  = COALESCE(cliente_email, $3)
        WHERE id = $1\`,
      [recursoId, total, email],
    );
    return decisao.motivo;
  }

  await client.query(
    \`INSERT INTO pedidos (id, status, total_centavos, cliente_email, versao_origem)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE
        SET status         = EXCLUDED.status,
            total_centavos = COALESCE(EXCLUDED.total_centavos, pedidos.total_centavos),
            cliente_email  = COALESCE(EXCLUDED.cliente_email, pedidos.cliente_email),
            versao_origem  = EXCLUDED.versao_origem,
            atualizado_em  = now()\`,
    [recursoId, status, total, email, versao],
  );

  for (const efeito of efeitosDaTransicao(decisao.de, status)) {
    await client.query(
      'INSERT INTO outbox (pedido_id, efeito) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [recursoId, efeito],
    );
  }
  return 'aplicado';
}

export async function aplicarEvento(eventoId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      \`SELECT evento_id, recurso_id, tipo, payload
         FROM webhook_eventos
        WHERE evento_id = $1 AND aplicado_em IS NULL
          FOR UPDATE SKIP LOCKED\`,
      [eventoId],
    );
    const evento = rows[0];
    if (!evento) {
      await client.query('ROLLBACK');
      return null; // ja aplicado ou sendo aplicado por outro processo
    }

    const status = STATUS_DO_TIPO[evento.tipo];
    const resultado = status
      ? await aplicarFato(client, {
          recursoId: evento.recurso_id,
          status,
          versao: versaoDoFato(
            { sequence: evento.payload.sequence, occurredAt: evento.payload.occurred_at },
            status,
          ),
          dados: evento.payload.data,
        })
      : 'tipo_ignorado';

    await client.query(
      'UPDATE webhook_eventos SET aplicado_em = now(), resultado = $2 WHERE evento_id = $1',
      [evento.evento_id, resultado],
    );
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Mesmo formato de fato a partir do pedido lido na API do provedor.
export function fatoDaApi(pedido) {
  const status = STATUS_DA_API[pedido.status];
  return {
    recursoId: pedido.id,
    status,
    versao: status
      ? versaoDoFato({ sequence: pedido.sequence, occurredAt: pedido.updated_at }, status)
      : null,
    dados: pedido,
  };
}`;

const receptorCode = `// webhooks/receptor.js - valida, grava, responde e so depois aplica.
// Express 5: erros lancados em handlers async chegam ao middleware de erro sem wrapper.
import crypto from 'node:crypto';
import express from 'express';
import { pool } from '../db.js';
import { aplicarEvento } from './aplicar.js';

export const router = express.Router();

function assinaturaValida(corpo, assinatura) {
  if (typeof assinatura !== 'string') return false;
  const esperada = crypto
    .createHmac('sha256', process.env.LOJA_WEBHOOK_SECRET)
    .update(corpo)
    .digest('hex');
  const a = Buffer.from(assinatura, 'utf8');
  const b = Buffer.from(esperada, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/webhooks/loja', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!assinaturaValida(req.body, req.get('x-loja-signature'))) return res.status(401).end();

  const evento = JSON.parse(req.body.toString('utf8'));
  await pool.query(
    \`INSERT INTO webhook_eventos (evento_id, recurso_id, tipo, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (evento_id) DO NOTHING\`,
    [evento.id, evento.data.id, evento.type, evento],
  );
  res.status(200).end();

  // Fora da resposta: se falhar aqui, o evento continua gravado e a varredura tenta de novo.
  aplicarEvento(evento.id).catch((err) =>
    console.error('falha ao aplicar evento', evento.id, err.message),
  );
});

// Varredura: reaplica o que ficou pendente por erro, deploy no meio ou queda do processo.
setInterval(async () => {
  try {
    const { rows } = await pool.query(
      \`SELECT evento_id
         FROM webhook_eventos
        WHERE aplicado_em IS NULL
          AND recebido_em < now() - interval '30 seconds'
        ORDER BY recebido_em
        LIMIT 200\`,
    );
    for (const { evento_id: eventoId } of rows) {
      await aplicarEvento(eventoId).catch((err) =>
        console.error('varredura: falha no evento', eventoId, err.message),
      );
    }
  } catch (err) {
    console.error('varredura falhou', err.message);
  }
}, 15_000).unref();`;

const reconciliacaoCode = `// webhooks/reconciliacao.js - roda a cada 15 minutos e pega o que o webhook nao entregou.
import { pool } from '../db.js';
import { aplicarFato, fatoDaApi } from './aplicar.js';

// Volta 10 minutos no cursor: pedidos atualizados perto da borda da janela anterior
// podem ter aparecido na listagem depois que ela foi lida.
const SOBREPOSICAO_MS = 10 * 60 * 1000;

export async function reconciliar() {
  const { rows } = await pool.query("SELECT valor FROM cursores WHERE nome = 'pedidos_loja'");
  let maior = rows[0].valor;
  const desde = new Date(maior.getTime() - SOBREPOSICAO_MS).toISOString();
  const contagem = {};
  let pagina = null;

  do {
    const url = new URL('/orders', process.env.LOJA_API);
    url.searchParams.set('updated_since', desde);
    url.searchParams.set('limit', '100');
    if (pagina) url.searchParams.set('page_token', pagina);

    const resp = await fetch(url, {
      headers: { authorization: \`Bearer \${process.env.LOJA_TOKEN}\` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(\`listagem de pedidos respondeu \${resp.status}\`);
    const corpo = await resp.json();

    for (const pedido of corpo.orders) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const resultado = await aplicarFato(client, fatoDaApi(pedido));
        await client.query('COMMIT');
        contagem[resultado] = (contagem[resultado] ?? 0) + 1;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      const atualizado = new Date(pedido.updated_at);
      if (atualizado > maior) maior = atualizado;
    }
    pagina = corpo.next_page_token ?? null;
  } while (pagina);

  // So avanca o cursor depois de percorrer tudo: uma falha no meio repete a janela inteira.
  await pool.query("UPDATE cursores SET valor = $1 WHERE nome = 'pedidos_loja'", [maior]);

  // contagem.aplicado > 0 significa que o webhook perdeu algo: vira metrica e alerta.
  return contagem;
}`;

const diagramaPt = `Provedor (ocorrido_em)            Handler que assume ordem
10:02:11  order.created  --x      timeout, reentrega agendada para 10:03:11
10:02:14  order.paid     --x      timeout, reentrega agendada para 10:03:14
10:02:40  order.canceled ----->   UPDATE status = 'cancelado' -> 0 linhas, responde 200
10:03:11  order.created  ----->   INSERT status = 'criado'
10:03:14  order.paid     ----->   UPDATE status = 'pago' + libera separacao

Estado final no nosso banco: pago, em separacao
Estado real no provedor:     cancelado

Com fatos versionados:
10:02:40  cancelado (10:02:40 + rank 4)  ->  pedido nao existe: cria como cancelado
10:03:11  criado    (10:02:11 + rank 1)  ->  versao menor: so completa total e e-mail
10:03:14  pago      (10:02:14 + rank 2)  ->  versao menor: ignorado, nenhum efeito
Estado final: cancelado, sem separacao`;

const diagramaEn = `Provider (occurred_at)            Handler that assumes order
10:02:11  order.created  --x      timeout, redelivery scheduled for 10:03:11
10:02:14  order.paid     --x      timeout, redelivery scheduled for 10:03:14
10:02:40  order.canceled ----->   UPDATE status = 'cancelado' -> 0 rows, returns 200
10:03:11  order.created  ----->   INSERT status = 'criado'
10:03:14  order.paid     ----->   UPDATE status = 'pago' + releases picking

Final state in our database: paid, being picked
Real state at the provider:  canceled

With versioned facts:
10:02:40  canceled (10:02:40 + rank 4)  ->  order does not exist: created as canceled
10:03:11  created  (10:02:11 + rank 1)  ->  lower version: only fills total and email
10:03:14  paid     (10:02:14 + rank 2)  ->  lower version: ignored, no side effect
Final state: canceled, no picking`;

const diagramaEs = `Proveedor (occurred_at)           Handler que asume orden
10:02:11  order.created  --x      timeout, reentrega programada para 10:03:11
10:02:14  order.paid     --x      timeout, reentrega programada para 10:03:14
10:02:40  order.canceled ----->   UPDATE status = 'cancelado' -> 0 filas, responde 200
10:03:11  order.created  ----->   INSERT status = 'criado'
10:03:14  order.paid     ----->   UPDATE status = 'pago' + libera la preparación

Estado final en nuestra base: pagado, en preparación
Estado real en el proveedor:  cancelado

Con hechos versionados:
10:02:40  cancelado (10:02:40 + rank 4)  ->  el pedido no existe: se crea como cancelado
10:03:11  creado    (10:02:11 + rank 1)  ->  versión menor: solo completa total y e-mail
10:03:14  pagado    (10:02:14 + rank 2)  ->  versión menor: ignorado, ningún efecto
Estado final: cancelado, sin preparación`;

const pt = {
  intro:
    'Uma integração de pedidos recebe 1,4 milhão de webhooks por mês de uma plataforma de e-commerce e alimenta o sistema de separação do centro de distribuição. Em outubro, 37 pedidos cancelados pelo cliente foram separados e despachados, com R$ 21 mil entre frete de ida e volta, produto avariado e estorno. Nenhum erro no log: todos os eventos foram respondidos com 200. O cancelamento chegou antes da criação e do pagamento, e o handler tratava cada evento como uma ordem a executar sobre o estado atual. Este artigo mostra por que a ordem de entrega não é garantida, como medir quanto isso acontece no seu tráfego, como trocar comandos por fatos versionados, gravar antes de aplicar, decidir com uma função que não depende de quem chegou primeiro, disparar efeitos a partir da transição de estado e fechar as lacunas com uma reconciliação periódica na fonte.',
  sections: [
    {
      title: 'Por que o provedor não entrega na ordem em que os fatos aconteceram',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quase toda documentação de webhook tem uma frase dizendo que a ordem de entrega não é garantida, e quase todo handler é escrito como se fosse. A ordem se perde porque cada evento é uma entrega independente: tem a própria fila de tentativas, o próprio backoff e, em muitos provedores, é despachado por um conjunto de workers em paralelo. Basta uma entrega falhar por timeout para que eventos posteriores do mesmo recurso passem na frente dela.',
        },
        {
          type: 'paragraph',
          value:
            'No caso da integração, o gatilho era previsível. Às 10h, a campanha de outubro dobrava o volume, o endpoint de webhook passava a responder em 4 a 6 segundos por causa de uma consulta ao ERP dentro do handler, e o provedor desistia em 5 segundos. A criação e o pagamento iam para a fila de reentrega com espera de 60 segundos; o cancelamento, feito pelo cliente 26 segundos depois, chegava num momento de folga e era entregue na primeira tentativa.',
        },
        {
          type: 'table',
          columns: ['Causa', 'Como embaralha a ordem', 'Janela típica'],
          rows: [
            ['Reentrega com backoff', 'Evento que falhou volta depois dos que vieram em seguida', 'De segundos a horas'],
            ['Despacho paralelo no provedor', 'Eventos do mesmo recurso saem por workers diferentes', 'Milissegundos a segundos'],
            ['Consumidores paralelos do nosso lado', 'Dois pods processam eventos do mesmo pedido ao mesmo tempo', 'Milissegundos'],
            ['Replays manuais pelo painel do provedor', 'Evento antigo é reenviado dias depois', 'Horas a dias'],
            ['Mais de uma origem para o mesmo recurso', 'Checkout e backoffice emitem eventos por caminhos distintos', 'Segundos'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Antes de mudar qualquer coisa, vale medir. Se o handler já grava as entregas, a consulta abaixo conta quantos eventos chegaram depois de outro mais novo do mesmo recurso. Na integração do exemplo, o resultado foi 0,31% dos eventos, concentrados em order.paid e order.created nos horários de pico. Parece pouco, mas 0,31% de 1,4 milhão são mais de 4 mil eventos por mês aplicados sobre o estado errado.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
      ],
    },
    {
      title: 'O erro de origem: tratar cada evento como um comando',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O handler original é o que quase todo mundo escreve na primeira versão: um if por tipo de evento, cada ramo executando uma operação sobre a linha que já existe. Ele funciona enquanto os eventos chegam em ordem e falha em silêncio quando não chegam, porque um UPDATE que não encontra linha não é um erro para o banco nem para o driver.',
        },
        {
          type: 'code',
          value: handlerIngenuoCode,
        },
        {
          type: 'paragraph',
          value:
            'O diagrama mostra a sequência real de um dos 37 pedidos. Repare que nenhum passo, isolado, está errado: cada evento recebeu uma resposta válida e cada comando fez exatamente o que o código mandava. O defeito está na premissa de que o evento descreve o próximo passo, quando na verdade descreve um fato que aconteceu em algum momento no passado do provedor.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'list',
          items: [
            'Cancelamento antes da criação: o UPDATE não encontra linha, o 200 confirma a entrega e o provedor nunca mais reenvia.',
            'Pagamento antes da criação: o pedido fica eternamente como criado e não entra na separação; o cliente pagou e não recebe.',
            'Efeito disparado pelo tipo do evento: a separação é liberada porque chegou order.paid, sem olhar se o pedido já estava cancelado.',
            'Retry depois do 200: ignorar o problema e confiar no reenvio não funciona, porque do ponto de vista do provedor a entrega deu certo.',
          ],
        },
      ],
    },
    {
      title: 'Fatos com versão no lugar de comandos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A virada é tratar cada evento como um fato datado sobre o recurso: "o pedido 8812 estava cancelado às 10:02:40". Fatos podem chegar em qualquer ordem, desde que exista uma regra determinística para decidir qual deles descreve o estado mais recente. Essa regra é a chave de ordenação, e a decisão passa a ser uma função pura do estado atual e do fato recebido.',
        },
        {
          type: 'paragraph',
          value:
            'A melhor chave é uma sequência por recurso fornecida pelo provedor, como um campo de versão que aumenta a cada alteração do pedido. Na falta dela, use o instante em que o fato ocorreu na origem, nunca o instante em que chegou até você. Como muitos provedores mandam esse instante com resolução de segundo, dois fatos do mesmo pedido podem empatar; o desempate pelo estado mais avançado resolve o caso clássico de pagamento e cancelamento no mesmo segundo, em que o cancelamento deve vencer.',
        },
        {
          type: 'table',
          columns: ['Estado atual', 'Fato recebido', 'Versão do fato', 'Decisão'],
          rows: [
            ['Não existe', 'cancelado', 'Qualquer', 'Cria como cancelado, sem efeito colateral'],
            ['cancelado', 'criado ou pago', 'Menor', 'Ignora o status; completa total e e-mail se faltarem'],
            ['pago', 'cancelado', 'Maior', 'Aplica e registra interromper_separacao'],
            ['cancelado', 'pago', 'Maior', 'Não aplica; registra regressao_de_terminal para investigar'],
            ['cancelado', 'reembolsado', 'Maior', 'Aplica e registra notificar_reembolso'],
            ['Qualquer', 'O mesmo fato de novo', 'Igual', 'Ignora: reentrega e reconciliação são idempotentes'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Dois detalhes fazem a regra funcionar. Primeiro, campos que não mudam ao longo da vida do pedido, como total e e-mail, são completados por qualquer fato que os traga, mesmo um fato antigo; isso resolve o caso em que o cancelamento chega com um payload enxuto e a criação, atrasada, traz os dados. Segundo, estados terminais têm saídas explícitas: um pagamento com versão maior depois de um cancelamento não deve reabrir o pedido, e sim acender um alerta, porque indica um bug no provedor ou uma premissa errada sobre o domínio.',
        },
      ],
    },
    {
      title: 'Gravar antes de aplicar: caixa de entrada, transição e outbox',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O receptor passa a ter uma única responsabilidade síncrona: validar a assinatura, gravar o evento pela chave do provedor e responder. A gravação com ON CONFLICT DO NOTHING já resolve as reentregas duplicadas, e responder sem esperar o ERP elimina o timeout que disparava a maioria das reentregas fora de ordem. O resto do trabalho acontece depois, em uma transação por evento.',
        },
        {
          type: 'code',
          value: esquemaCode,
        },
        {
          type: 'paragraph',
          value:
            'A aplicação usa um advisory lock por pedido, obtido com pg_advisory_xact_lock sobre o hash do id. Isso serializa os fatos de um mesmo pedido mesmo quando a linha ainda não existe, situação em que um SELECT FOR UPDATE não teria o que travar e dois eventos simultâneos poderiam ambos concluir que o pedido é novo. O lock dura só até o fim da transação e não bloqueia pedidos diferentes.',
        },
        {
          type: 'code',
          value: aplicarCode,
        },
        {
          type: 'paragraph',
          value:
            'Os efeitos colaterais deixaram de depender do tipo do evento. A separação é liberada quando o pedido transiciona para pago, e essa transição só acontece se o fato for mais novo que o estado atual. Por isso o pagamento atrasado, que chega depois do cancelamento, não gera nada. A intenção é gravada na tabela outbox na mesma transação, com chave por pedido e efeito, e um publicador separado envia para o sistema de separação; se a transação falhar, nem o estado nem o efeito existem.',
        },
        {
          type: 'code',
          value: receptorCode,
        },
      ],
    },
    {
      title: 'Quando o payload não traz versão confiável',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nem todo provedor manda sequência, e alguns mandam um occurred_at que é, na prática, o horário de enfileiramento da entrega. Nesses casos, há três estratégias com custos diferentes, e a escolha depende do que o provedor garante e de quanto a API dele aguenta.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'Quando usar', 'Custo', 'Risco'],
          rows: [
            ['Sequência por recurso no payload', 'Provedor documenta um campo de versão monotônico', 'Nenhum', 'Baixo'],
            ['Instante do fato com desempate por estado', 'Há timestamp de ocorrência, mesmo com resolução de segundo', 'Nenhum', 'Relógio do provedor com regressão; raro, mas existe'],
            ['Buscar o recurso na API ao receber o aviso', 'Payload sem versão ou sem dados confiáveis', 'Uma chamada por evento', 'Limite de taxa e latência da API do provedor'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A terceira estratégia trata o webhook apenas como um aviso de que algo mudou. Ao receber o evento, o worker consulta GET /orders/{id} e aplica o snapshot com a mesma função aplicarFato, usando o updated_at do recurso como versão. Como o snapshot é sempre o estado atual na origem, a ordem dos avisos deixa de importar. O preço é uma chamada por evento, então vale agrupar: se três avisos do mesmo pedido chegam em 2 segundos, uma única leitura depois do último resolve os três.',
        },
        {
          type: 'list',
          items: [
            'Agrupe avisos por recurso com uma espera curta, de 1 a 3 segundos, antes de consultar a fonte.',
            'Respeite o limite de taxa do provedor com um semáforo global, e não por processo, para não estourar em escala horizontal.',
            'Se a consulta retornar 404, não apague o pedido: registre a anomalia, porque alguns provedores demoram para tornar o recurso visível na API depois de emitir o evento.',
            'Use a mesma chave de ordenação para fatos vindos do webhook e da API, ou a reconciliação vai brigar com os eventos.',
          ],
        },
      ],
    },
    {
      title: 'Reconciliação periódica: a rede que pega o que o webhook perdeu',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo com tudo acima, webhooks se perdem: o provedor desiste depois de esgotar as tentativas, um segredo rotacionado faz o 401 durar uma hora, um replay manual é esquecido. A reconciliação percorre os pedidos alterados na origem desde o último cursor e aplica cada um como fato, pela mesma função. Se o estado local já está correto, o resultado é evento_antigo e nada acontece; se não está, o pedido é corrigido e o efeito correspondente entra no outbox.',
        },
        {
          type: 'code',
          value: reconciliacaoCode,
        },
        {
          type: 'paragraph',
          value:
            'O contador que a função devolve é a métrica mais útil da integração. Em regime normal, aplicado fica em zero ou perto disso, porque o webhook chegou antes. Um salto indica que o webhook está falhando de algum jeito que ainda não apareceu em outro lugar, e esse alerta costuma disparar antes de qualquer reclamação de cliente. Vale acompanhar também a idade do evento pendente mais antigo e a contagem de regressao_de_terminal por dia.',
        },
        {
          type: 'paragraph',
          value:
            'Na integração do exemplo, a mudança foi feita em três deploys: primeiro a caixa de entrada gravando em paralelo ao handler antigo, para medir; depois a aplicação por fatos com a separação ainda disparada pelo caminho antigo, comparando as decisões; por fim, a troca dos efeitos para o outbox e a reconciliação a cada 15 minutos. Novembro fechou sem nenhum pedido cancelado despachado.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Antes', 'Depois'],
          rows: [
            ['Pedidos cancelados despachados por mês', '37', '0'],
            ['Pedidos pagos presos como criado', '214', '0'],
            ['Tempo de resposta do endpoint de webhook (p95)', '4,8 s', '12 ms'],
            ['Eventos reentregues pelo provedor por timeout', '2,9%', '0,02%'],
            ['Pedidos corrigidos pela reconciliação por semana', 'Não existia', '3 a 6'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Não seria mais simples rejeitar com erro o evento que chega antes da criação, para o provedor reenviar depois?',
      answer:
        'Funciona em parte e cobra caro. Você passa a depender da política de reentrega do provedor, que pode desistir depois de algumas tentativas ou desativar o endpoint por excesso de falhas, e o evento fica atrasado por minutos sem necessidade. Além disso, não resolve o caso inverso, em que o pagamento atrasado chega depois do cancelamento e o pedido existe. Gravar tudo e decidir pela versão cobre os dois casos sem depender do comportamento do outro lado.',
    },
    {
      question: 'Uma fila com garantia de ordem, como um tópico particionado pelo id do pedido, não resolve?',
      answer:
        'Ela preserva a ordem em que os eventos entraram na sua fila, que já é a ordem de chegada dos webhooks, ou seja, já embaralhada. Particionar pelo id evita que dois consumidores seus processem o mesmo pedido em paralelo, o que é útil, mas não recupera a ordem em que os fatos aconteceram no provedor. Para isso você precisa de uma chave de ordenação vinda da origem.',
    },
    {
      question: 'E se o provedor não tiver API de listagem para a reconciliação?',
      answer:
        'Reconcilie pelo que você tem: consulte individualmente os pedidos em estados intermediários há mais tempo do que o esperado, como pagos sem envio há 48 horas ou criados sem pagamento há 2 horas, e aplique o snapshot de cada um. É menos completo que percorrer tudo por data de alteração, mas pega justamente os casos que custam dinheiro. Se nem consulta individual existir, a integração não tem como se autocorrigir e isso precisa ser tratado como risco do contrato com o provedor.',
    },
  ],
  conclusion: {
    title: 'O webhook conta o que aconteceu, não o que fazer em seguida',
    description:
      'Os 37 pedidos cancelados que saíram do centro de distribuição não foram causados por um bug exótico, e sim pela premissa de que eventos chegam na ordem em que aconteceram. Trocar comandos por fatos versionados, gravar antes de aplicar, decidir com uma função que não depende da ordem de chegada, disparar efeitos pela transição de estado e reconciliar periodicamente na fonte transforma a ordem de entrega em detalhe irrelevante. O resultado é uma integração que dá o mesmo estado final qualquer que seja a sequência em que os eventos chegam, e que avisa quando o webhook começa a falhar antes que o cliente perceba.',
    cta: 'Revisar as integrações por webhook do meu sistema',
  },
  related: [
    {
      label: 'Chave de idempotência em webhook de pagamento: cobrar uma vez só',
      to: '/blog/chave-idempotencia-webhook-pagamento-cobrar-uma-vez-so',
    },
    {
      label: 'Fila morta que ninguém lê: mensagem descartada vira correção',
      to: '/blog/fila-morta-que-ninguem-le-mensagem-descartada-vira-correcao',
    },
    {
      label: 'Serviço de automação e integrações',
      to: '/servicos/automacao-e-integracoes',
    },
  ],
};

const en = {
  intro:
    'An order integration receives 1.4 million webhooks a month from an e-commerce platform and feeds the picking system of a distribution center. In October, 37 orders canceled by the customer were picked and shipped, costing R$ 21 thousand in round trip freight, damaged goods and refunds. No errors in the log: every event was answered with a 200. The cancellation arrived before the creation and the payment, and the handler treated each event as an order to execute against the current state. This article shows why delivery order is not guaranteed, how to measure how often it happens in your traffic, how to replace commands with versioned facts, store before applying, decide with a function that does not depend on who arrived first, trigger side effects from state transitions and close the gaps with periodic reconciliation against the source.',
  sections: [
    {
      title: 'Why the provider does not deliver in the order the facts happened',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Almost every webhook documentation has a sentence saying delivery order is not guaranteed, and almost every handler is written as if it were. Order is lost because each event is an independent delivery: it has its own retry queue, its own backoff and, at many providers, it is dispatched by a pool of workers running in parallel. A single delivery failing on timeout is enough for later events of the same resource to overtake it.',
        },
        {
          type: 'paragraph',
          value:
            'In this integration, the trigger was predictable. At 10 a.m., the October campaign doubled the volume, the webhook endpoint started answering in 4 to 6 seconds because of an ERP lookup inside the handler, and the provider gave up after 5 seconds. Creation and payment went to the redelivery queue with a 60 second wait; the cancellation, made by the customer 26 seconds later, arrived during a quiet moment and was delivered on the first attempt.',
        },
        {
          type: 'table',
          columns: ['Cause', 'How it shuffles the order', 'Typical window'],
          rows: [
            ['Redelivery with backoff', 'A failed event comes back after the ones that followed it', 'Seconds to hours'],
            ['Parallel dispatch at the provider', 'Events of the same resource leave through different workers', 'Milliseconds to seconds'],
            ['Parallel consumers on our side', 'Two pods process events of the same order at the same time', 'Milliseconds'],
            ['Manual replays from the provider dashboard', 'An old event is resent days later', 'Hours to days'],
            ['More than one source for the same resource', 'Checkout and back office emit events through different paths', 'Seconds'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Measure before changing anything. If the handler already logs deliveries, the query below counts how many events arrived after a newer event of the same resource. In this integration the result was 0.31% of events, concentrated in order.paid and order.created during peak hours. It sounds small, but 0.31% of 1.4 million is more than 4 thousand events a month applied on top of the wrong state.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
      ],
    },
    {
      title: 'The root mistake: treating each event as a command',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The original handler is what almost everyone writes in the first version: one if per event type, each branch running an operation on the row that already exists. It works while events arrive in order and fails silently when they do not, because an UPDATE that matches no row is not an error for the database or for the driver.',
        },
        {
          type: 'code',
          value: handlerIngenuoCode,
        },
        {
          type: 'paragraph',
          value:
            'The diagram shows the real sequence of one of the 37 orders. Notice that no step, on its own, is wrong: every event got a valid response and every command did exactly what the code said. The defect is in the assumption that the event describes the next step, when it actually describes a fact that happened at some point in the provider\'s past.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'list',
          items: [
            'Cancellation before creation: the UPDATE matches no row, the 200 confirms delivery and the provider never resends it.',
            'Payment before creation: the order stays as created forever and never reaches picking; the customer paid and gets nothing.',
            'Side effect triggered by event type: picking is released because order.paid arrived, without checking whether the order was already canceled.',
            'Retry after the 200: ignoring the problem and trusting redelivery does not work, because from the provider\'s point of view the delivery succeeded.',
          ],
        },
      ],
    },
    {
      title: 'Versioned facts instead of commands',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The turning point is treating each event as a dated fact about the resource: "order 8812 was canceled at 10:02:40". Facts can arrive in any order, as long as there is a deterministic rule to decide which of them describes the most recent state. That rule is the ordering key, and the decision becomes a pure function of the current state and the incoming fact.',
        },
        {
          type: 'paragraph',
          value:
            'The best key is a per resource sequence supplied by the provider, such as a version field that increases with every change to the order. Without one, use the instant the fact occurred at the source, never the instant it reached you. Since many providers send that instant with one second resolution, two facts of the same order may tie; breaking the tie by the most advanced state solves the classic case of payment and cancellation in the same second, where the cancellation must win.',
        },
        {
          type: 'table',
          columns: ['Current state', 'Incoming fact', 'Fact version', 'Decision'],
          rows: [
            ['Does not exist', 'canceled', 'Any', 'Create as canceled, no side effect'],
            ['canceled', 'created or paid', 'Lower', 'Ignore the status; fill total and email if missing'],
            ['paid', 'canceled', 'Higher', 'Apply and record interromper_separacao'],
            ['canceled', 'paid', 'Higher', 'Do not apply; record regressao_de_terminal for investigation'],
            ['canceled', 'refunded', 'Higher', 'Apply and record notificar_reembolso'],
            ['Any', 'The same fact again', 'Equal', 'Ignore: redelivery and reconciliation are idempotent'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Two details make the rule work. First, fields that do not change during the order\'s life, such as total and email, are filled by any fact that carries them, even an old one; this covers the case where the cancellation arrives with a thin payload and the delayed creation brings the data. Second, terminal states have explicit exits: a payment with a higher version after a cancellation should not reopen the order but raise an alert, because it points to a provider bug or a wrong assumption about the domain.',
        },
      ],
    },
    {
      title: 'Store before applying: inbox, transition and outbox',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The receiver now has a single synchronous responsibility: validate the signature, store the event under the provider\'s key and respond. Storing with ON CONFLICT DO NOTHING already handles duplicate redeliveries, and responding without waiting for the ERP removes the timeout that caused most of the out of order redeliveries. The rest of the work happens afterwards, in one transaction per event.',
        },
        {
          type: 'code',
          value: esquemaCode,
        },
        {
          type: 'paragraph',
          value:
            'Applying uses a per order advisory lock, taken with pg_advisory_xact_lock over the hash of the id. This serializes facts of the same order even when the row does not exist yet, a situation where SELECT FOR UPDATE would have nothing to lock and two simultaneous events could both conclude the order is new. The lock lasts only until the end of the transaction and does not block other orders.',
        },
        {
          type: 'code',
          value: aplicarCode,
        },
        {
          type: 'paragraph',
          value:
            'Side effects no longer depend on the event type. Picking is released when the order transitions to paid, and that transition only happens if the fact is newer than the current state. That is why the delayed payment, arriving after the cancellation, produces nothing. The intent is written to the outbox table in the same transaction, keyed by order and effect, and a separate publisher sends it to the picking system; if the transaction fails, neither the state nor the effect exists.',
        },
        {
          type: 'code',
          value: receptorCode,
        },
      ],
    },
    {
      title: 'When the payload has no reliable version',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Not every provider sends a sequence, and some send an occurred_at that is, in practice, the time the delivery was enqueued. In those cases there are three strategies with different costs, and the choice depends on what the provider guarantees and how much load its API can take.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'When to use', 'Cost', 'Risk'],
          rows: [
            ['Per resource sequence in the payload', 'The provider documents a monotonic version field', 'None', 'Low'],
            ['Fact instant with tie break by state', 'There is an occurrence timestamp, even at one second resolution', 'None', 'Provider clock going backwards; rare, but it happens'],
            ['Fetch the resource from the API on notice', 'Payload without version or without reliable data', 'One call per event', 'Rate limits and latency of the provider API'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third strategy treats the webhook only as a notice that something changed. When the event arrives, the worker calls GET /orders/{id} and applies the snapshot with the same aplicarFato function, using the resource\'s updated_at as the version. Since the snapshot is always the current state at the source, the order of notices stops mattering. The price is one call per event, so it pays to batch: if three notices for the same order arrive within 2 seconds, a single read after the last one settles all three.',
        },
        {
          type: 'list',
          items: [
            'Group notices by resource with a short wait, 1 to 3 seconds, before querying the source.',
            'Respect the provider\'s rate limit with a global semaphore, not a per process one, so horizontal scaling does not blow past it.',
            'If the lookup returns 404, do not delete the order: record the anomaly, because some providers take a while to make the resource visible in the API after emitting the event.',
            'Use the same ordering key for facts coming from the webhook and from the API, or reconciliation will fight the events.',
          ],
        },
      ],
    },
    {
      title: 'Periodic reconciliation: the net that catches what the webhook missed',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Even with everything above, webhooks get lost: the provider gives up after exhausting retries, a rotated secret makes the 401 last an hour, a manual replay is forgotten. Reconciliation walks through the orders changed at the source since the last cursor and applies each one as a fact, through the same function. If the local state is already correct, the result is evento_antigo and nothing happens; if not, the order is fixed and the matching side effect goes into the outbox.',
        },
        {
          type: 'code',
          value: reconciliacaoCode,
        },
        {
          type: 'paragraph',
          value:
            'The counter the function returns is the most useful metric of the integration. Under normal conditions, aplicado stays at or near zero, because the webhook got there first. A jump means the webhook is failing in some way that has not shown up anywhere else yet, and this alert usually fires before any customer complaint. It is also worth tracking the age of the oldest pending event and the daily count of regressao_de_terminal.',
        },
        {
          type: 'paragraph',
          value:
            'In this integration, the change shipped in three deploys: first the inbox writing alongside the old handler, to measure; then fact based application with picking still triggered by the old path, comparing decisions; finally, moving side effects to the outbox and running reconciliation every 15 minutes. November closed with no canceled order shipped.',
        },
        {
          type: 'table',
          columns: ['Metric', 'Before', 'After'],
          rows: [
            ['Canceled orders shipped per month', '37', '0'],
            ['Paid orders stuck as created', '214', '0'],
            ['Webhook endpoint response time (p95)', '4.8 s', '12 ms'],
            ['Events redelivered by the provider on timeout', '2.9%', '0.02%'],
            ['Orders fixed by reconciliation per week', 'Did not exist', '3 to 6'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Would it not be simpler to reject with an error the event that arrives before creation, so the provider resends it later?',
      answer:
        'It partly works and costs a lot. You start depending on the provider\'s redelivery policy, which may give up after a few attempts or disable the endpoint for too many failures, and the event gets delayed by minutes for no reason. It also does not solve the opposite case, where the delayed payment arrives after the cancellation and the order exists. Storing everything and deciding by version covers both cases without depending on the other side\'s behavior.',
    },
    {
      question: 'Does an ordered queue, such as a topic partitioned by order id, not solve it?',
      answer:
        'It preserves the order in which events entered your queue, which is already the arrival order of the webhooks, meaning it is already shuffled. Partitioning by id prevents two of your consumers from processing the same order in parallel, which is useful, but it does not recover the order in which facts happened at the provider. For that you need an ordering key coming from the source.',
    },
    {
      question: 'What if the provider has no listing API for reconciliation?',
      answer:
        'Reconcile with what you have: query individually the orders that have been in intermediate states longer than expected, such as paid with no shipment for 48 hours or created with no payment for 2 hours, and apply each snapshot. It is less complete than walking everything by change date, but it catches exactly the cases that cost money. If not even single lookups exist, the integration cannot correct itself, and that has to be treated as a risk in the contract with the provider.',
    },
  ],
  conclusion: {
    title: 'The webhook tells you what happened, not what to do next',
    description:
      'The 37 canceled orders that left the distribution center were not caused by an exotic bug, but by the assumption that events arrive in the order they happened. Replacing commands with versioned facts, storing before applying, deciding with a function that does not depend on arrival order, triggering side effects from state transitions and reconciling periodically against the source turns delivery order into an irrelevant detail. The result is an integration that reaches the same final state whatever sequence the events arrive in, and that warns you when the webhook starts failing before the customer notices.',
    cta: 'Review the webhook integrations in my system',
  },
  related: [
    {
      label: 'Idempotency keys in payment webhooks: charging only once',
      to: '/blog/chave-idempotencia-webhook-pagamento-cobrar-uma-vez-so',
    },
    {
      label: 'The dead letter queue nobody reads: turning discarded messages into fixes',
      to: '/blog/fila-morta-que-ninguem-le-mensagem-descartada-vira-correcao',
    },
    {
      label: 'Automation and integrations service',
      to: '/servicos/automacao-e-integracoes',
    },
  ],
};

const es = {
  intro:
    'Una integración de pedidos recibe 1,4 millones de webhooks al mes de una plataforma de e-commerce y alimenta el sistema de preparación de un centro de distribución. En octubre, 37 pedidos cancelados por el cliente fueron preparados y despachados, con R$ 21 mil entre flete de ida y vuelta, producto dañado y reembolsos. Ningún error en el log: todos los eventos se respondieron con 200. La cancelación llegó antes que la creación y el pago, y el handler trataba cada evento como una orden a ejecutar sobre el estado actual. Este artículo muestra por qué el orden de entrega no está garantizado, cómo medir cuánto ocurre en su tráfico, cómo reemplazar comandos por hechos versionados, guardar antes de aplicar, decidir con una función que no depende de quién llegó primero, disparar efectos a partir de la transición de estado y cerrar las brechas con una reconciliación periódica contra la fuente.',
  sections: [
    {
      title: 'Por qué el proveedor no entrega en el orden en que ocurrieron los hechos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Casi toda documentación de webhooks tiene una frase que dice que el orden de entrega no está garantizado, y casi todo handler se escribe como si lo estuviera. El orden se pierde porque cada evento es una entrega independiente: tiene su propia cola de reintentos, su propio backoff y, en muchos proveedores, lo despacha un conjunto de workers en paralelo. Basta con que una entrega falle por timeout para que eventos posteriores del mismo recurso la adelanten.',
        },
        {
          type: 'paragraph',
          value:
            'En esta integración, el disparador era previsible. A las 10 h, la campaña de octubre duplicaba el volumen, el endpoint de webhook empezaba a responder en 4 a 6 segundos por una consulta al ERP dentro del handler, y el proveedor desistía a los 5 segundos. La creación y el pago iban a la cola de reentrega con 60 segundos de espera; la cancelación, hecha por el cliente 26 segundos después, llegaba en un momento tranquilo y se entregaba en el primer intento.',
        },
        {
          type: 'table',
          columns: ['Causa', 'Cómo desordena', 'Ventana típica'],
          rows: [
            ['Reentrega con backoff', 'El evento que falló vuelve después de los que vinieron a continuación', 'De segundos a horas'],
            ['Despacho paralelo en el proveedor', 'Eventos del mismo recurso salen por workers distintos', 'Milisegundos a segundos'],
            ['Consumidores paralelos de nuestro lado', 'Dos pods procesan eventos del mismo pedido al mismo tiempo', 'Milisegundos'],
            ['Replays manuales desde el panel del proveedor', 'Un evento antiguo se reenvía días después', 'Horas a días'],
            ['Más de un origen para el mismo recurso', 'Checkout y backoffice emiten eventos por caminos distintos', 'Segundos'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Antes de cambiar algo, conviene medir. Si el handler ya registra las entregas, la consulta de abajo cuenta cuántos eventos llegaron después de otro más nuevo del mismo recurso. En la integración del ejemplo, el resultado fue el 0,31% de los eventos, concentrados en order.paid y order.created en horas pico. Parece poco, pero el 0,31% de 1,4 millones son más de 4 mil eventos al mes aplicados sobre el estado equivocado.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
      ],
    },
    {
      title: 'El error de origen: tratar cada evento como un comando',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El handler original es lo que casi todos escriben en la primera versión: un if por tipo de evento, cada rama ejecutando una operación sobre la fila que ya existe. Funciona mientras los eventos llegan en orden y falla en silencio cuando no, porque un UPDATE que no encuentra fila no es un error para la base ni para el driver.',
        },
        {
          type: 'code',
          value: handlerIngenuoCode,
        },
        {
          type: 'paragraph',
          value:
            'El diagrama muestra la secuencia real de uno de los 37 pedidos. Observe que ningún paso, por sí solo, está mal: cada evento recibió una respuesta válida y cada comando hizo exactamente lo que el código ordenaba. El defecto está en la premisa de que el evento describe el siguiente paso, cuando en realidad describe un hecho que ocurrió en algún momento del pasado del proveedor.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'list',
          items: [
            'Cancelación antes de la creación: el UPDATE no encuentra fila, el 200 confirma la entrega y el proveedor nunca la reenvía.',
            'Pago antes de la creación: el pedido queda para siempre como creado y no entra en preparación; el cliente pagó y no recibe nada.',
            'Efecto disparado por el tipo de evento: la preparación se libera porque llegó order.paid, sin mirar si el pedido ya estaba cancelado.',
            'Reintento después del 200: ignorar el problema y confiar en la reentrega no funciona, porque para el proveedor la entrega salió bien.',
          ],
        },
      ],
    },
    {
      title: 'Hechos con versión en lugar de comandos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El cambio de enfoque es tratar cada evento como un hecho fechado sobre el recurso: "el pedido 8812 estaba cancelado a las 10:02:40". Los hechos pueden llegar en cualquier orden, siempre que exista una regla determinística para decidir cuál describe el estado más reciente. Esa regla es la clave de ordenación, y la decisión pasa a ser una función pura del estado actual y del hecho recibido.',
        },
        {
          type: 'paragraph',
          value:
            'La mejor clave es una secuencia por recurso que entregue el proveedor, como un campo de versión que aumenta con cada cambio del pedido. Si no existe, use el instante en que el hecho ocurrió en el origen, nunca el instante en que llegó a usted. Como muchos proveedores envían ese instante con resolución de segundo, dos hechos del mismo pedido pueden empatar; desempatar por el estado más avanzado resuelve el caso clásico de pago y cancelación en el mismo segundo, en el que la cancelación debe ganar.',
        },
        {
          type: 'table',
          columns: ['Estado actual', 'Hecho recibido', 'Versión del hecho', 'Decisión'],
          rows: [
            ['No existe', 'cancelado', 'Cualquiera', 'Crea como cancelado, sin efecto colateral'],
            ['cancelado', 'creado o pagado', 'Menor', 'Ignora el estado; completa total y e-mail si faltan'],
            ['pagado', 'cancelado', 'Mayor', 'Aplica y registra interromper_separacao'],
            ['cancelado', 'pagado', 'Mayor', 'No aplica; registra regressao_de_terminal para investigar'],
            ['cancelado', 'reembolsado', 'Mayor', 'Aplica y registra notificar_reembolso'],
            ['Cualquiera', 'El mismo hecho otra vez', 'Igual', 'Ignora: reentrega y reconciliación son idempotentes'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Dos detalles hacen que la regla funcione. Primero, los campos que no cambian durante la vida del pedido, como total y e-mail, se completan con cualquier hecho que los traiga, incluso uno antiguo; eso resuelve el caso en que la cancelación llega con un payload mínimo y la creación, atrasada, trae los datos. Segundo, los estados terminales tienen salidas explícitas: un pago con versión mayor después de una cancelación no debe reabrir el pedido, sino encender una alerta, porque indica un bug del proveedor o una premisa equivocada sobre el dominio.',
        },
      ],
    },
    {
      title: 'Guardar antes de aplicar: bandeja de entrada, transición y outbox',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El receptor pasa a tener una única responsabilidad síncrona: validar la firma, guardar el evento con la clave del proveedor y responder. Guardar con ON CONFLICT DO NOTHING ya resuelve las reentregas duplicadas, y responder sin esperar al ERP elimina el timeout que provocaba la mayoría de las reentregas fuera de orden. El resto del trabajo ocurre después, en una transacción por evento.',
        },
        {
          type: 'code',
          value: esquemaCode,
        },
        {
          type: 'paragraph',
          value:
            'La aplicación usa un advisory lock por pedido, obtenido con pg_advisory_xact_lock sobre el hash del id. Eso serializa los hechos de un mismo pedido incluso cuando la fila todavía no existe, situación en la que un SELECT FOR UPDATE no tendría nada que bloquear y dos eventos simultáneos podrían concluir ambos que el pedido es nuevo. El lock dura solo hasta el final de la transacción y no bloquea pedidos distintos.',
        },
        {
          type: 'code',
          value: aplicarCode,
        },
        {
          type: 'paragraph',
          value:
            'Los efectos colaterales dejaron de depender del tipo de evento. La preparación se libera cuando el pedido transiciona a pagado, y esa transición solo ocurre si el hecho es más nuevo que el estado actual. Por eso el pago atrasado, que llega después de la cancelación, no genera nada. La intención se guarda en la tabla outbox en la misma transacción, con clave por pedido y efecto, y un publicador separado la envía al sistema de preparación; si la transacción falla, no existe ni el estado ni el efecto.',
        },
        {
          type: 'code',
          value: receptorCode,
        },
      ],
    },
    {
      title: 'Cuando el payload no trae una versión confiable',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No todo proveedor envía una secuencia, y algunos envían un occurred_at que, en la práctica, es la hora en que se encoló la entrega. En esos casos hay tres estrategias con costos distintos, y la elección depende de lo que garantiza el proveedor y de cuánta carga aguanta su API.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Cuándo usarla', 'Costo', 'Riesgo'],
          rows: [
            ['Secuencia por recurso en el payload', 'El proveedor documenta un campo de versión monótono', 'Ninguno', 'Bajo'],
            ['Instante del hecho con desempate por estado', 'Hay timestamp de ocurrencia, aunque sea con resolución de segundo', 'Ninguno', 'Reloj del proveedor que retrocede; raro, pero ocurre'],
            ['Consultar el recurso en la API al recibir el aviso', 'Payload sin versión o sin datos confiables', 'Una llamada por evento', 'Límite de tasa y latencia de la API del proveedor'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tercera estrategia trata el webhook solo como un aviso de que algo cambió. Al recibir el evento, el worker consulta GET /orders/{id} y aplica el snapshot con la misma función aplicarFato, usando el updated_at del recurso como versión. Como el snapshot siempre es el estado actual en el origen, el orden de los avisos deja de importar. El precio es una llamada por evento, así que conviene agrupar: si llegan tres avisos del mismo pedido en 2 segundos, una sola lectura después del último resuelve los tres.',
        },
        {
          type: 'list',
          items: [
            'Agrupe los avisos por recurso con una espera corta, de 1 a 3 segundos, antes de consultar la fuente.',
            'Respete el límite de tasa del proveedor con un semáforo global, no por proceso, para no superarlo al escalar horizontalmente.',
            'Si la consulta devuelve 404, no borre el pedido: registre la anomalía, porque algunos proveedores tardan en hacer visible el recurso en la API después de emitir el evento.',
            'Use la misma clave de ordenación para los hechos que vienen del webhook y de la API, o la reconciliación va a pelear con los eventos.',
          ],
        },
      ],
    },
    {
      title: 'Reconciliación periódica: la red que atrapa lo que el webhook perdió',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Aun con todo lo anterior, los webhooks se pierden: el proveedor desiste tras agotar los reintentos, un secreto rotado hace que el 401 dure una hora, un replay manual queda olvidado. La reconciliación recorre los pedidos modificados en el origen desde el último cursor y aplica cada uno como hecho, con la misma función. Si el estado local ya es correcto, el resultado es evento_antigo y no pasa nada; si no lo es, el pedido se corrige y el efecto correspondiente entra en el outbox.',
        },
        {
          type: 'code',
          value: reconciliacaoCode,
        },
        {
          type: 'paragraph',
          value:
            'El contador que devuelve la función es la métrica más útil de la integración. En condiciones normales, aplicado se queda en cero o cerca, porque el webhook llegó antes. Un salto indica que el webhook está fallando de alguna forma que todavía no apareció en otro lugar, y esa alerta suele dispararse antes de cualquier reclamo de cliente. También conviene seguir la antigüedad del evento pendiente más viejo y el conteo diario de regressao_de_terminal.',
        },
        {
          type: 'paragraph',
          value:
            'En la integración del ejemplo, el cambio salió en tres deploys: primero la bandeja de entrada guardando en paralelo al handler antiguo, para medir; después la aplicación por hechos con la preparación todavía disparada por el camino antiguo, comparando las decisiones; por último, el paso de los efectos al outbox y la reconciliación cada 15 minutos. Noviembre cerró sin ningún pedido cancelado despachado.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Antes', 'Después'],
          rows: [
            ['Pedidos cancelados despachados por mes', '37', '0'],
            ['Pedidos pagados atascados como creados', '214', '0'],
            ['Tiempo de respuesta del endpoint de webhook (p95)', '4,8 s', '12 ms'],
            ['Eventos reentregados por el proveedor por timeout', '2,9%', '0,02%'],
            ['Pedidos corregidos por la reconciliación por semana', 'No existía', '3 a 6'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿No sería más simple rechazar con error el evento que llega antes de la creación, para que el proveedor lo reenvíe después?',
      answer:
        'Funciona en parte y sale caro. Pasa a depender de la política de reentrega del proveedor, que puede desistir tras algunos intentos o desactivar el endpoint por exceso de fallas, y el evento se atrasa minutos sin necesidad. Además, no resuelve el caso inverso, en el que el pago atrasado llega después de la cancelación y el pedido ya existe. Guardar todo y decidir por versión cubre los dos casos sin depender del comportamiento del otro lado.',
    },
    {
      question: '¿Una cola con garantía de orden, como un tópico particionado por id de pedido, no lo resuelve?',
      answer:
        'Preserva el orden en que los eventos entraron en su cola, que ya es el orden de llegada de los webhooks, es decir, ya desordenado. Particionar por id evita que dos de sus consumidores procesen el mismo pedido en paralelo, lo cual es útil, pero no recupera el orden en que los hechos ocurrieron en el proveedor. Para eso se necesita una clave de ordenación que venga del origen.',
    },
    {
      question: '¿Y si el proveedor no tiene una API de listado para la reconciliación?',
      answer:
        'Reconcilie con lo que tiene: consulte individualmente los pedidos que llevan en estados intermedios más tiempo del esperado, como pagados sin envío hace 48 horas o creados sin pago hace 2 horas, y aplique el snapshot de cada uno. Es menos completo que recorrer todo por fecha de cambio, pero atrapa justamente los casos que cuestan dinero. Si ni siquiera existe la consulta individual, la integración no puede corregirse sola, y eso debe tratarse como un riesgo del contrato con el proveedor.',
    },
  ],
  conclusion: {
    title: 'El webhook cuenta lo que pasó, no lo que hay que hacer después',
    description:
      'Los 37 pedidos cancelados que salieron del centro de distribución no fueron causados por un bug exótico, sino por la premisa de que los eventos llegan en el orden en que ocurrieron. Reemplazar comandos por hechos versionados, guardar antes de aplicar, decidir con una función que no depende del orden de llegada, disparar efectos por la transición de estado y reconciliar periódicamente contra la fuente convierte el orden de entrega en un detalle irrelevante. El resultado es una integración que llega al mismo estado final sin importar la secuencia en que lleguen los eventos, y que avisa cuando el webhook empieza a fallar antes de que el cliente lo note.',
    cta: 'Revisar las integraciones por webhook de mi sistema',
  },
  related: [
    {
      label: 'Clave de idempotencia en webhooks de pago: cobrar una sola vez',
      to: '/blog/chave-idempotencia-webhook-pagamento-cobrar-uma-vez-so',
    },
    {
      label: 'La cola muerta que nadie lee: el mensaje descartado se convierte en corrección',
      to: '/blog/fila-morta-que-ninguem-le-mensagem-descartada-vira-correcao',
    },
    {
      label: 'Servicio de automatización e integraciones',
      to: '/servicos/automacao-e-integracoes',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
