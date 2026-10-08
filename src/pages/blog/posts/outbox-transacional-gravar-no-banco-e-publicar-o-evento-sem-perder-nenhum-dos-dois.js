// Conteudo do artigo: outbox transacional. Por que gravar no banco e publicar no
// broker sao duas escritas que nao sao atomicas, como gravar o evento na mesma
// transacao do dado, como um relay publica com entrega ao-menos-uma-vez e ordem por
// agregado, como o consumidor absorve duplicatas, como operar a tabela e como provar
// com falhas injetadas que nenhum evento se perde.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const diagram = `Escrita dupla (o que quebra)                       Outbox (o que segura)

app -- UPDATE pedidos ----------> banco             app -- BEGIN ---------------------> banco
app -- publish(pedido.confirmado) -> broker           |-- UPDATE pedidos
        ^                                             |-- INSERT outbox (evento)
        |                                             '-- COMMIT  (os dois, ou nenhum)
   queda aqui = pedido gravado, evento perdido
   ordem inversa = evento publicado, pedido nao     relay -- SELECT ... FOR UPDATE SKIP LOCKED
                                                       |-- publish(evento) ----------> broker
                                                       '-- UPDATE outbox SET publicado_em
                                                    consumidor -- INSERT inbox (message_id) ON CONFLICT
                                                       '-- trata o evento so se for a primeira vez`;

const schemaCode = `-- Fila de saida no mesmo banco do negocio. seq define a ordem; id viaja como messageId.
CREATE TABLE outbox (
  seq                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id                   uuid        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  aggregate_id         text        NOT NULL,
  tipo                 text        NOT NULL,
  payload              jsonb       NOT NULL,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  publicado_em         timestamptz,
  tentativas           int         NOT NULL DEFAULT 0,
  ultimo_erro          text,
  proxima_tentativa_em timestamptz NOT NULL DEFAULT now()
);

-- Indice parcial: so as linhas pendentes. A tabela cresce, o indice nao.
CREATE INDEX outbox_pendentes ON outbox (seq) WHERE publicado_em IS NULL;

-- Lado do consumidor: um registro por mensagem ja tratada.
CREATE TABLE inbox (
  message_id   uuid PRIMARY KEY,
  processado_em timestamptz NOT NULL DEFAULT now()
);`;

const writerCode = `// Confirma o pedido e registra o evento na MESMA transacao: os dois ou nenhum.
export async function confirmarPedido(pool, { pedidoId, clienteId, totalCentavos }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      \`UPDATE pedidos SET status = 'confirmado', confirmado_em = now()
        WHERE id = $1 AND status = 'pendente'\`,
      [pedidoId],
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK'); // pedido inexistente ou ja confirmado: nenhum evento
      return false;
    }
    await client.query(
      \`INSERT INTO outbox (aggregate_id, tipo, payload) VALUES ($1, 'pedido.confirmado', $2)\`,
      [pedidoId, JSON.stringify({ pedidoId, clienteId, totalCentavos })],
    );
    await client.query('COMMIT');
    return true;
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}`;

const relayCode = `// Pega o evento mais antigo de cada agregado que esta pendente e vencido.
// NOT EXISTS garante a ordem por agregado; SKIP LOCKED deixa varios relays em paralelo.
const SQL_RESERVAR = \`
  SELECT o.seq, o.id, o.aggregate_id, o.tipo, o.payload, o.tentativas
    FROM outbox o
   WHERE o.publicado_em IS NULL
     AND o.proxima_tentativa_em <= now()
     AND NOT EXISTS (
       SELECT 1 FROM outbox anterior
        WHERE anterior.aggregate_id = o.aggregate_id
          AND anterior.publicado_em IS NULL
          AND anterior.seq < o.seq)
   ORDER BY o.seq
   LIMIT $1
   FOR UPDATE OF o SKIP LOCKED\`;

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function publicarLote(pool, broker, { tamanho = 50 } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(SQL_RESERVAR, [tamanho]);
    for (const evento of rows) {
      try {
        // messageId = outbox.id: o consumidor usa para descartar duplicatas
        await broker.publish({
          topic: evento.tipo,
          key: evento.aggregate_id,
          messageId: evento.id,
          value: evento.payload,
        });
        await client.query('UPDATE outbox SET publicado_em = now() WHERE seq = $1', [evento.seq]);
      } catch (erro) {
        const esperaSegundos = Math.min(2 ** evento.tentativas, 300); // 1s, 2s, 4s ... teto de 5 min
        await client.query(
          \`UPDATE outbox
              SET tentativas = tentativas + 1,
                  ultimo_erro = $2,
                  proxima_tentativa_em = now() + make_interval(secs => $3)
            WHERE seq = $1\`,
          [evento.seq, String(erro.message).slice(0, 500), esperaSegundos],
        );
      }
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}

export function iniciarRelay(pool, broker, { intervaloMs = 500 } = {}) {
  let ativo = true;
  (async () => {
    while (ativo) {
      try {
        const publicados = await publicarLote(pool, broker);
        if (publicados === 0) await dormir(intervaloMs);
      } catch (erro) {
        console.error('relay da outbox falhou', erro);
        await dormir(2000);
      }
    }
  })();
  return () => {
    ativo = false;
  };
}`;

const consumerCode = `// Consumidor idempotente: marcar a mensagem e tratar o efeito na MESMA transacao.
// Se o efeito falhar, a marca some junto no ROLLBACK e a reentrega tenta de novo.
export async function consumir(pool, mensagem, tratar) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      'INSERT INTO inbox (message_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [mensagem.messageId],
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return 'duplicada';
    }
    await tratar(client, mensagem.value); // ex.: INSERT INTO faturas ... usando o mesmo client
    await client.query('COMMIT');
    return 'processada';
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}`;

const opsCode = `-- Painel e alerta: o que importa e a idade do evento mais antigo, nao so a contagem.
SELECT count(*)                                                    AS pendentes,
       coalesce(extract(epoch FROM now() - min(criado_em)), 0)::int AS idade_mais_antiga_s,
       count(*) FILTER (WHERE tentativas >= 5)                     AS com_falha_repetida
  FROM outbox
 WHERE publicado_em IS NULL;

-- Limpeza em lotes pequenos (rodar em loop ate afetar 0 linhas), para nao segurar lock longo.
DELETE FROM outbox
 WHERE seq IN (
   SELECT seq FROM outbox
    WHERE publicado_em < now() - interval '7 days'
    ORDER BY seq
    LIMIT 5000);

-- A inbox guarda mensagens por mais tempo do que o broker pode reentregar (ex.: 30 dias).
DELETE FROM inbox WHERE processado_em < now() - interval '30 days';`;

const testCode = `import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, limparTabelas, criarPedido } from './setup.js'; // banco de teste real, nao mock
import { confirmarPedido } from '../src/confirmar-pedido.js';
import { publicarLote } from '../src/relay.js';
import { consumir } from '../src/consumidor.js';

const brokerQueFalha = () => ({ publicadas: [], falhar: true,
  async publish(msg) {
    if (this.falhar) throw new Error('broker indisponivel');
    this.publicadas.push(msg);
  } });

test('pedido ja confirmado nao deixa evento orfao', async () => {
  await limparTabelas();
  const pedidoId = await criarPedido({ status: 'confirmado' });
  assert.equal(await confirmarPedido(pool, { pedidoId, clienteId: 'c1', totalCentavos: 1000 }), false);
  const { rows } = await pool.query('SELECT 1 FROM outbox');
  assert.equal(rows.length, 0);
});

test('broker fora do ar nao perde o evento e a recuperacao publica uma vez', async () => {
  await limparTabelas();
  const pedidoId = await criarPedido({ status: 'pendente' });
  await confirmarPedido(pool, { pedidoId, clienteId: 'c1', totalCentavos: 1000 });

  const broker = brokerQueFalha();
  await publicarLote(pool, broker);
  const { rows: [pendente] } = await pool.query('SELECT publicado_em, tentativas FROM outbox');
  assert.equal(pendente.publicado_em, null);
  assert.equal(pendente.tentativas, 1);

  broker.falhar = false;
  await pool.query('UPDATE outbox SET proxima_tentativa_em = now()'); // pula o backoff no teste
  await publicarLote(pool, broker);
  await publicarLote(pool, broker); // segunda rodada nao pode republicar
  assert.equal(broker.publicadas.length, 1);
});

test('entrega duplicada e descartada pelo consumidor', async () => {
  await limparTabelas();
  const mensagem = { messageId: '0b1f6a52-6d8c-4a39-9c1e-3f1d2a7c9e10', value: { pedidoId: 'p1' } };
  let efeitos = 0;
  const tratar = async () => { efeitos += 1; };
  assert.equal(await consumir(pool, mensagem, tratar), 'processada');
  assert.equal(await consumir(pool, mensagem, tratar), 'duplicada');
  assert.equal(efeitos, 1);
});`;

const pt = {
  intro:
    'Um marketplace confirmava o pedido no banco e, na linha seguinte, publicava pedido.confirmado no broker para o faturamento, o estoque e o e-mail ao cliente. Numa manutenção do broker de 4 minutos, 37 pedidos foram pagos, gravados como confirmados e nunca faturados. Ninguém viu: nada lançou exceção que importasse, a API devolveu 200 e o painel de erros ficou limpo. O financeiro descobriu três dias depois, ao conciliar. O defeito não estava na publicação nem na gravação, estava em fazer as duas como se fossem uma só. Este artigo mostra por que gravar no banco e publicar um evento são duas escritas que nunca serão atômicas, como o padrão outbox move o evento para dentro da mesma transação do dado, como um relay publica com entrega ao menos uma vez e sem furar a ordem por agregado, como o consumidor absorve a duplicata que essa garantia traz, como operar a tabela e como provar com falhas injetadas que nenhum evento se perde.',
  sections: [
    {
      title: 'Por que gravar e publicar são duas escritas, e uma sempre pode falhar sozinha',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O banco e o broker são sistemas diferentes, com processos, redes e falhas diferentes. Não existe COMMIT que cubra os dois. Qualquer sequência que você escolha deixa uma janela em que um lado foi feito e o outro não: um deploy no meio da requisição, uma queda de rede, um timeout do broker, um erro de serialização, um OOM kill. Essa janela dura milissegundos, e por isso o problema passa em teste e aparece quando o volume e a quantidade de deploys sobem. Com 1.200 pedidos por dia e um incidente de infraestrutura por mês, é questão de tempo.',
        },
        {
          type: 'paragraph',
          value:
            'Inverter a ordem não resolve, só troca o sintoma. Publicar antes de gravar cria um evento sobre algo que não existe: o faturamento emite nota de um pedido que o banco recusou. Gravar antes de publicar cria um dado sem evento: o pedido está confirmado e ninguém foi avisado. Publicar dentro da transação, antes do COMMIT, é o pior dos mundos porque parece seguro: se o COMMIT falhar depois, o evento já saiu.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'Falha entre os dois passos', 'Resultado', 'Detectável?'],
          rows: [
            ['Gravar e depois publicar', 'Processo cai ou broker recusa após o COMMIT', 'Pedido confirmado sem evento', 'Só na conciliação, dias depois'],
            ['Publicar e depois gravar', 'Banco recusa ou processo cai após o publish', 'Evento de um pedido que não existe', 'Quando o consumidor não acha o pedido'],
            ['Publicar dentro da transação', 'COMMIT falha após o publish', 'Evento de uma gravação desfeita', 'Raramente'],
            ['Retry em memória após o COMMIT', 'Processo reinicia com a fila de retry na memória', 'Pedido confirmado sem evento', 'Só na conciliação'],
            ['Outbox transacional', 'Qualquer um', 'Evento publicado no mínimo uma vez, ou transação desfeita por inteiro', 'Sim, a tabela mostra o atraso'],
          ],
        },
        { type: 'diagram', value: diagram },
      ],
    },
    {
      title: 'A tabela outbox: o evento nasce na mesma transação do dado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A ideia central é trocar a escrita no broker por uma escrita no próprio banco do negócio. Em vez de publicar, a aplicação insere uma linha em uma tabela outbox dentro da mesma transação que altera o pedido. Como é a mesma transação, a atomicidade que o banco já oferece passa a cobrir o evento: ou o pedido muda e o evento existe, ou nada aconteceu. A publicação real fica para outro processo, que lê a tabela. O esquema abaixo inclui o índice parcial, que mantém a leitura dos pendentes barata mesmo com milhões de linhas já publicadas, e a tabela inbox do lado do consumidor, usada na seção 4.',
        },
        { type: 'code', value: schemaCode },
        {
          type: 'paragraph',
          value:
            'O lado de escrita fica simples. Note que o INSERT na outbox só acontece se o UPDATE do pedido realmente alterou uma linha: um pedido já confirmado, reenviado por um cliente impaciente, não gera um segundo evento.',
        },
        { type: 'code', value: writerCode },
        {
          type: 'paragraph',
          value:
            'O payload deve carregar o que o consumidor precisa para agir sem voltar ao banco do produtor: identificador, valores e o momento do fato. Se o consumidor precisar consultar o serviço do pedido para entender o evento, você recriou o acoplamento síncrono que o evento deveria evitar.',
        },
      ],
    },
    {
      title: 'O relay: publicar da tabela, sem perder e sem furar a ordem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O relay é um laço que lê eventos pendentes, publica no broker e marca como publicados. A consulta de reserva carrega duas decisões. FOR UPDATE SKIP LOCKED deixa várias instâncias do relay trabalharem ao mesmo tempo sem pegar a mesma linha. E o NOT EXISTS só devolve o evento mais antigo pendente de cada agregado: se o pedido 77 tem um evento de confirmação e outro de cancelamento, o segundo só é liberado depois que o primeiro foi publicado, mesmo com relays concorrentes. Um lote nunca contém dois eventos do mesmo agregado, e a ordem por pedido se preserva sem um relay único.',
        },
        { type: 'code', value: relayCode },
        {
          type: 'paragraph',
          value:
            'A garantia é ao menos uma vez, não exatamente uma. Se o processo cair depois do publish e antes do COMMIT da marcação, a transação do relay é desfeita e o evento será publicado de novo. Isso é o comportamento desejado: perder um evento é irrecuperável, duplicar um evento é tratável. Por isso o messageId vai junto, para o consumidor reconhecer a repetição. Alguns pontos de operação decidem se o relay se comporta bem:',
        },
        {
          type: 'list',
          items: [
            'Publique com confirmação do broker (acks no Kafka, publisher confirms no RabbitMQ). Um publish que retorna sem confirmação pode ter se perdido, e marcar como publicado seria perder o evento.',
            'Use a chave de partição igual ao aggregate_id, para que os eventos do mesmo pedido cheguem na mesma partição, na ordem em que foram publicados.',
            'Aplique backoff por evento, como no código, em vez de repetir em laço apertado. Um evento com payload recusado não deve impedir os outros agregados de seguir.',
            'Mantenha o lote pequeno, de dezenas de linhas. A transação do relay segura locks enquanto fala com o broker, e um lote grande com um broker lento prende linhas por muito tempo.',
          ],
        },
      ],
    },
    {
      title: 'O consumidor tem que aguentar a duplicata',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Como a entrega é ao menos uma vez, o consumidor precisa produzir o mesmo resultado quando recebe a mesma mensagem duas vezes. O faturamento não pode emitir duas notas para o mesmo pedido.confirmado. O mecanismo mais direto é a tabela inbox: registrar o messageId e executar o efeito na mesma transação, com ON CONFLICT DO NOTHING para detectar a repetição. Se o efeito falhar, o ROLLBACK desfaz também a marca, e a reentrega do broker tenta de novo, sem criar a falsa impressão de que a mensagem foi tratada.',
        },
        { type: 'code', value: consumerCode },
        {
          type: 'paragraph',
          value:
            'Quando o efeito não acontece no mesmo banco, como uma chamada a uma API externa, a transação não cobre os dois. Nesse caso, passe a chave de idempotência da própria mensagem para a API de destino, usando o messageId. É o mesmo princípio da cobrança que não pode ser feita duas vezes: a deduplicação mora onde o efeito acontece.',
        },
      ],
    },
    {
      title: 'Operar a outbox: backlog, limpeza e a alternativa de CDC',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A outbox troca um risco de perda silenciosa por um risco visível: o atraso. Isso é uma melhora, desde que alguém olhe. O alerta que importa é a idade do evento mais antigo pendente, não apenas a quantidade: 500 eventos pendentes em um pico que se esvazia em segundos é normal, um único evento de 10 minutos é um relay parado. A tabela também precisa de limpeza, em lotes pequenos, para não segurar lock nem inflar o armazenamento, e a inbox deve guardar as mensagens por mais tempo do que o broker pode reentregar.',
        },
        { type: 'code', value: opsCode },
        {
          type: 'paragraph',
          value:
            'O relay por consulta (polling) é a escolha simples e suficiente para a maioria dos sistemas, com latência de centenas de milissegundos. Quando o volume é alto ou a latência precisa ser menor, a leitura do log de transações do banco (CDC, como o Debezium) elimina o polling, ao custo de operar mais uma peça. A tabela compara as opções.',
        },
        {
          type: 'table',
          columns: ['Abordagem', 'Garantia', 'Custo operacional', 'Quando usar'],
          rows: [
            ['Outbox com relay por consulta', 'Ao menos uma vez, ordem por agregado', 'Baixo: um processo e uma tabela', 'Padrão. Até alguns milhares de eventos por segundo'],
            ['Outbox com CDC (log do banco)', 'Ao menos uma vez, ordem do log', 'Médio: conector, slot de replicação, monitoramento', 'Volume alto ou latência de dezenas de milissegundos'],
            ['Publicar após o COMMIT com retry em memória', 'Pode perder em queda do processo', 'Baixo', 'Só quando perder o evento é aceitável'],
            ['Transação distribuída (2PC/XA)', 'Atômica entre banco e broker', 'Alto: poucos brokers suportam, trava recursos', 'Raramente justificável'],
            ['Event sourcing', 'O log de eventos é a fonte da verdade', 'Alto: muda o modelo inteiro', 'Quando o histórico já é o produto'],
          ],
        },
      ],
    },
    {
      title: 'Provar que não perde: falhas injetadas em vez de confiança',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um teste que só confere o caminho feliz não prova nada sobre a outbox. As garantias aparecem quando algo falha, então o teste precisa provocar a falha. Os três testes abaixo cobrem as propriedades que importam: um pedido que não muda não gera evento, um broker fora do ar não perde o evento e a recuperação publica uma única vez, e uma entrega duplicada é descartada pelo consumidor. Eles usam um banco de teste real, porque o comportamento de transação e de SKIP LOCKED não existe em um mock.',
        },
        { type: 'code', value: testCode },
        {
          type: 'paragraph',
          value:
            'Em produção, a conciliação continua útil como rede de segurança: uma consulta diária que cruza pedidos confirmados nas últimas 24 horas com eventos publicados detecta qualquer caminho de código que alguém ainda tenha deixado de fora da outbox, como um script de correção que atualiza o pedido por fora da função confirmarPedido.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que não usar uma transação distribuída (2PC) entre o banco e o broker?',
      answer:
        'Porque a maioria dos brokers não participa de XA, e onde participa o custo é alto: a transação segura recursos nos dois lados enquanto espera o coordenador, e uma falha do coordenador deixa transações em dúvida bloqueando linhas. A outbox obtém o resultado prático, nenhum evento perdido, usando só a transação local que o banco já oferece, e aceita a duplicata ocasional, que o consumidor idempotente absorve.',
    },
    {
      question: 'A outbox não vira um gargalo por escrever uma linha a mais em toda transação?',
      answer:
        'O custo é um INSERT adicional na mesma transação, normalmente abaixo de um milissegundo, sem round trip extra porque usa a mesma conexão. O que pode virar problema é a tabela crescer sem limpeza e a leitura dos pendentes varrer linhas antigas. O índice parcial sobre publicado_em IS NULL e a remoção em lotes dos eventos já publicados mantêm o custo estável com o tempo.',
    },
    {
      question: 'Dá para garantir entrega exatamente uma vez com a outbox?',
      answer:
        'Entre a outbox e o broker não: a garantia é ao menos uma vez, porque o relay pode publicar e cair antes de marcar. O que se obtém é o efeito exatamente uma vez, combinando a entrega ao menos uma vez com um consumidor idempotente que descarta o messageId repetido. Para o negócio o resultado é o mesmo, uma nota emitida por pedido, e é o único jeito honesto de prometer isso em sistemas distribuídos.',
    },
  ],
  conclusion: {
    title: 'O evento precisa existir se, e somente se, o dado existir',
    description:
      'Gravar no banco e publicar no broker nunca serão atômicos, e qualquer ordem entre os dois passos deixa uma janela de perda ou de evento fantasma que só aparece em produção, na conciliação, dias depois. A outbox resolve movendo o evento para dentro da transação do dado, publicando por um relay com entrega ao menos uma vez e ordem por agregado, e deixando o consumidor idempotente absorver a duplicata. O que sobra é um risco mensurável, o atraso do evento mais antigo, em vez de uma perda silenciosa. Com testes que injetam falha no broker e na entrega, e uma conciliação diária como rede de segurança, a pergunta deixa de ser se algum evento se perdeu e passa a ser quanto tempo ele levou para sair.',
    cta: 'Falar sobre os eventos do meu sistema',
  },
  related: [
    {
      label: 'Webhook de saída que ninguém confirma: entregar evento a cliente lento sem acumular fila infinita',
      to: '/blog/webhook-de-saida-que-ninguem-confirma-cliente-lento-sem-fila-infinita',
    },
    {
      label: 'Job agendado que roda duas vezes: exclusão mútua distribuída sem trava eterna',
      to: '/blog/job-agendado-que-roda-duas-vezes-exclusao-mutua-distribuida-sem-trava-eterna',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A marketplace confirmed the order in the database and, on the next line, published order.confirmed to the broker for invoicing, inventory and the customer email. During a 4-minute broker maintenance, 37 orders were paid, saved as confirmed and never invoiced. Nobody noticed: no exception that mattered was thrown, the API returned 200 and the error dashboard stayed clean. Finance found out three days later, during reconciliation. The defect was neither in the publishing nor in the saving, it was in doing both as if they were one. This article shows why writing to the database and publishing an event are two writes that will never be atomic, how the outbox pattern moves the event into the same transaction as the data, how a relay publishes with at-least-once delivery without breaking per-aggregate order, how the consumer absorbs the duplicate that this guarantee brings, how to operate the table, and how to prove with injected failures that no event is lost.',
  sections: [
    {
      title: 'Why saving and publishing are two writes, and one of them can always fail alone',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The database and the broker are different systems, with different processes, networks and failures. There is no COMMIT that covers both. Whatever sequence you choose leaves a window where one side was done and the other was not: a deploy in the middle of the request, a network drop, a broker timeout, a serialization error, an OOM kill. That window lasts milliseconds, which is why the problem passes in tests and shows up when volume and the number of deploys grow. With 1,200 orders a day and one infrastructure incident a month, it is a matter of time.',
        },
        {
          type: 'paragraph',
          value:
            'Reversing the order does not fix it, it only changes the symptom. Publishing before saving creates an event about something that does not exist: invoicing issues an invoice for an order the database rejected. Saving before publishing creates data without an event: the order is confirmed and nobody was told. Publishing inside the transaction, before the COMMIT, is the worst of all because it looks safe: if the COMMIT fails afterwards, the event has already left.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'Failure between the two steps', 'Result', 'Detectable?'],
          rows: [
            ['Save, then publish', 'Process dies or broker refuses after the COMMIT', 'Confirmed order without an event', 'Only in reconciliation, days later'],
            ['Publish, then save', 'Database refuses or process dies after the publish', 'Event for an order that does not exist', 'When the consumer cannot find the order'],
            ['Publish inside the transaction', 'COMMIT fails after the publish', 'Event for a rolled-back write', 'Rarely'],
            ['In-memory retry after the COMMIT', 'Process restarts with the retry queue in memory', 'Confirmed order without an event', 'Only in reconciliation'],
            ['Transactional outbox', 'Any of them', 'Event published at least once, or the whole transaction undone', 'Yes, the table shows the lag'],
          ],
        },
        { type: 'diagram', value: diagram },
      ],
    },
    {
      title: 'The outbox table: the event is born in the same transaction as the data',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The core idea is to replace the write to the broker with a write to the business database itself. Instead of publishing, the application inserts a row into an outbox table inside the same transaction that changes the order. Since it is the same transaction, the atomicity the database already offers now covers the event: either the order changes and the event exists, or nothing happened. The actual publishing is left to another process that reads the table. The schema below includes the partial index, which keeps reading the pending rows cheap even with millions of already published rows, and the inbox table on the consumer side, used in section 4.',
        },
        { type: 'code', value: schemaCode },
        {
          type: 'paragraph',
          value:
            'The write side stays simple. Note that the INSERT into the outbox only happens if the order UPDATE actually changed a row: an already confirmed order, resubmitted by an impatient customer, does not generate a second event.',
        },
        { type: 'code', value: writerCode },
        {
          type: 'paragraph',
          value:
            'The payload must carry what the consumer needs to act without going back to the producer database: identifier, amounts and the moment of the fact. If the consumer has to query the order service to understand the event, you have recreated the synchronous coupling the event was supposed to avoid.',
        },
      ],
    },
    {
      title: 'The relay: publish from the table without losing events or breaking order',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The relay is a loop that reads pending events, publishes them to the broker and marks them as published. The reservation query carries two decisions. FOR UPDATE SKIP LOCKED lets several relay instances work at the same time without taking the same row. And NOT EXISTS only returns the oldest pending event of each aggregate: if order 77 has a confirmation event and a cancellation event, the second is only released after the first has been published, even with concurrent relays. A batch never contains two events of the same aggregate, and per-order ordering is preserved without a single relay.',
        },
        { type: 'code', value: relayCode },
        {
          type: 'paragraph',
          value:
            'The guarantee is at least once, not exactly once. If the process dies after the publish and before the COMMIT of the marking, the relay transaction is rolled back and the event will be published again. That is the desired behavior: losing an event is unrecoverable, duplicating one is manageable. That is why the messageId travels along, so the consumer can recognize the repetition. A few operational points decide whether the relay behaves well:',
        },
        {
          type: 'list',
          items: [
            'Publish with broker acknowledgement (acks in Kafka, publisher confirms in RabbitMQ). A publish that returns without confirmation may have been lost, and marking it as published would lose the event.',
            'Use a partition key equal to aggregate_id, so the events of the same order land in the same partition, in the order they were published.',
            'Apply backoff per event, as in the code, instead of retrying in a tight loop. An event with a rejected payload must not stop the other aggregates from moving.',
            'Keep the batch small, in the tens of rows. The relay transaction holds locks while talking to the broker, and a large batch with a slow broker holds rows for a long time.',
          ],
        },
      ],
    },
    {
      title: 'The consumer has to survive the duplicate',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Since delivery is at least once, the consumer must produce the same result when it receives the same message twice. Invoicing cannot issue two invoices for the same order.confirmed. The most direct mechanism is the inbox table: record the messageId and run the effect in the same transaction, with ON CONFLICT DO NOTHING to detect the repetition. If the effect fails, the ROLLBACK also undoes the mark, and the broker redelivery tries again, without creating the false impression that the message was handled.',
        },
        { type: 'code', value: consumerCode },
        {
          type: 'paragraph',
          value:
            'When the effect does not happen in the same database, such as a call to an external API, the transaction does not cover both. In that case, pass the idempotency key from the message itself to the destination API, using the messageId. It is the same principle as the charge that cannot be made twice: deduplication lives where the effect happens.',
        },
      ],
    },
    {
      title: 'Operating the outbox: backlog, cleanup and the CDC alternative',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The outbox trades a silent loss risk for a visible one: lag. That is an improvement, as long as someone is watching. The alert that matters is the age of the oldest pending event, not just the count: 500 pending events in a spike that drains in seconds is normal, a single 10-minute-old event is a stopped relay. The table also needs cleanup, in small batches, so it does not hold locks or bloat storage, and the inbox must keep messages for longer than the broker can redeliver.',
        },
        { type: 'code', value: opsCode },
        {
          type: 'paragraph',
          value:
            'The polling relay is the simple choice and enough for most systems, with latency in the hundreds of milliseconds. When volume is high or latency must be lower, reading the database transaction log (CDC, such as Debezium) removes the polling, at the cost of operating one more component. The table compares the options.',
        },
        {
          type: 'table',
          columns: ['Approach', 'Guarantee', 'Operational cost', 'When to use'],
          rows: [
            ['Outbox with a polling relay', 'At least once, per-aggregate order', 'Low: one process and one table', 'Default. Up to a few thousand events per second'],
            ['Outbox with CDC (database log)', 'At least once, log order', 'Medium: connector, replication slot, monitoring', 'High volume or latency of tens of milliseconds'],
            ['Publish after the COMMIT with in-memory retry', 'May lose events when the process dies', 'Low', 'Only when losing the event is acceptable'],
            ['Distributed transaction (2PC/XA)', 'Atomic across database and broker', 'High: few brokers support it, locks resources', 'Rarely justified'],
            ['Event sourcing', 'The event log is the source of truth', 'High: changes the whole model', 'When the history is already the product'],
          ],
        },
      ],
    },
    {
      title: 'Proving it does not lose events: injected failures instead of trust',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A test that only checks the happy path proves nothing about the outbox. The guarantees show up when something fails, so the test has to cause the failure. The three tests below cover the properties that matter: an order that does not change generates no event, a broker outage does not lose the event and recovery publishes it once, and a duplicate delivery is discarded by the consumer. They use a real test database, because transaction and SKIP LOCKED behavior does not exist in a mock.',
        },
        { type: 'code', value: testCode },
        {
          type: 'paragraph',
          value:
            'In production, reconciliation is still useful as a safety net: a daily query that crosses orders confirmed in the last 24 hours with published events detects any code path someone left outside the outbox, such as a fix-up script that updates the order outside the confirmarPedido function.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why not use a distributed transaction (2PC) between the database and the broker?',
      answer:
        'Because most brokers do not take part in XA, and where they do the cost is high: the transaction holds resources on both sides while it waits for the coordinator, and a coordinator failure leaves in-doubt transactions blocking rows. The outbox gets the practical result, no lost events, using only the local transaction the database already offers, and accepts the occasional duplicate, which the idempotent consumer absorbs.',
    },
    {
      question: 'Does the outbox become a bottleneck by writing one extra row in every transaction?',
      answer:
        'The cost is one additional INSERT in the same transaction, usually under a millisecond, with no extra round trip because it uses the same connection. What can become a problem is the table growing without cleanup and the pending-row read scanning old rows. The partial index on publicado_em IS NULL and the batched removal of already published events keep the cost stable over time.',
    },
    {
      question: 'Can the outbox guarantee exactly-once delivery?',
      answer:
        'Between the outbox and the broker, no: the guarantee is at least once, because the relay may publish and die before marking. What you get is an exactly-once effect, by combining at-least-once delivery with an idempotent consumer that discards the repeated messageId. For the business the result is the same, one invoice per order, and it is the only honest way to promise that in distributed systems.',
    },
  ],
  conclusion: {
    title: 'The event must exist if, and only if, the data exists',
    description:
      'Writing to the database and publishing to the broker will never be atomic, and any order between the two steps leaves a window of loss or of a phantom event that only shows up in production, in reconciliation, days later. The outbox solves it by moving the event into the data transaction, publishing through a relay with at-least-once delivery and per-aggregate order, and letting the idempotent consumer absorb the duplicate. What remains is a measurable risk, the age of the oldest event, instead of a silent loss. With tests that inject failure into the broker and into delivery, and a daily reconciliation as a safety net, the question stops being whether an event was lost and becomes how long it took to leave.',
    cta: 'Talk about the events in my system',
  },
  related: [
    {
      label: 'Outbound webhook nobody acknowledges: delivering events to a slow customer without an infinite queue',
      to: '/blog/webhook-de-saida-que-ninguem-confirma-cliente-lento-sem-fila-infinita',
    },
    {
      label: 'Scheduled job that runs twice: distributed mutual exclusion without an eternal lock',
      to: '/blog/job-agendado-que-roda-duas-vezes-exclusao-mutua-distribuida-sem-trava-eterna',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/services/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Un marketplace confirmaba el pedido en la base de datos y, en la línea siguiente, publicaba pedido.confirmado en el broker para la facturación, el inventario y el correo al cliente. Durante un mantenimiento del broker de 4 minutos, 37 pedidos fueron pagados, guardados como confirmados y nunca facturados. Nadie lo vio: no se lanzó ninguna excepción relevante, la API devolvió 200 y el panel de errores quedó limpio. Finanzas lo descubrió tres días después, al conciliar. El defecto no estaba en la publicación ni en el guardado, estaba en hacer las dos cosas como si fueran una sola. Este artículo muestra por qué guardar en la base de datos y publicar un evento son dos escrituras que nunca serán atómicas, cómo el patrón outbox mueve el evento a la misma transacción del dato, cómo un relay publica con entrega al menos una vez y sin romper el orden por agregado, cómo el consumidor absorbe el duplicado que trae esa garantía, cómo operar la tabla y cómo demostrar con fallos inyectados que ningún evento se pierde.',
  sections: [
    {
      title: 'Por qué guardar y publicar son dos escrituras, y una siempre puede fallar sola',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La base de datos y el broker son sistemas distintos, con procesos, redes y fallos distintos. No existe un COMMIT que cubra los dos. Cualquier secuencia que elijas deja una ventana en la que un lado se hizo y el otro no: un despliegue en medio de la petición, una caída de red, un timeout del broker, un error de serialización, un OOM kill. Esa ventana dura milisegundos, y por eso el problema pasa en las pruebas y aparece cuando suben el volumen y la cantidad de despliegues. Con 1.200 pedidos por día y un incidente de infraestructura por mes, es cuestión de tiempo.',
        },
        {
          type: 'paragraph',
          value:
            'Invertir el orden no lo resuelve, solo cambia el síntoma. Publicar antes de guardar crea un evento sobre algo que no existe: la facturación emite una factura de un pedido que la base rechazó. Guardar antes de publicar crea un dato sin evento: el pedido está confirmado y nadie fue avisado. Publicar dentro de la transacción, antes del COMMIT, es lo peor porque parece seguro: si el COMMIT falla después, el evento ya salió.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Fallo entre los dos pasos', 'Resultado', '¿Detectable?'],
          rows: [
            ['Guardar y luego publicar', 'El proceso cae o el broker rechaza tras el COMMIT', 'Pedido confirmado sin evento', 'Solo en la conciliación, días después'],
            ['Publicar y luego guardar', 'La base rechaza o el proceso cae tras el publish', 'Evento de un pedido que no existe', 'Cuando el consumidor no encuentra el pedido'],
            ['Publicar dentro de la transacción', 'El COMMIT falla tras el publish', 'Evento de una escritura deshecha', 'Rara vez'],
            ['Reintento en memoria tras el COMMIT', 'El proceso se reinicia con la cola de reintentos en memoria', 'Pedido confirmado sin evento', 'Solo en la conciliación'],
            ['Outbox transaccional', 'Cualquiera', 'Evento publicado al menos una vez, o transacción deshecha por completo', 'Sí, la tabla muestra el retraso'],
          ],
        },
        { type: 'diagram', value: diagram },
      ],
    },
    {
      title: 'La tabla outbox: el evento nace en la misma transacción del dato',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La idea central es cambiar la escritura en el broker por una escritura en la propia base de datos del negocio. En lugar de publicar, la aplicación inserta una fila en una tabla outbox dentro de la misma transacción que modifica el pedido. Como es la misma transacción, la atomicidad que la base ya ofrece pasa a cubrir el evento: o el pedido cambia y el evento existe, o no pasó nada. La publicación real queda para otro proceso que lee la tabla. El esquema siguiente incluye el índice parcial, que mantiene barata la lectura de los pendientes aunque haya millones de filas ya publicadas, y la tabla inbox del lado del consumidor, usada en la sección 4.',
        },
        { type: 'code', value: schemaCode },
        {
          type: 'paragraph',
          value:
            'El lado de escritura queda simple. Observa que el INSERT en la outbox solo ocurre si el UPDATE del pedido realmente modificó una fila: un pedido ya confirmado, reenviado por un cliente impaciente, no genera un segundo evento.',
        },
        { type: 'code', value: writerCode },
        {
          type: 'paragraph',
          value:
            'El payload debe llevar lo que el consumidor necesita para actuar sin volver a la base del productor: identificador, valores y el momento del hecho. Si el consumidor tiene que consultar el servicio de pedidos para entender el evento, has recreado el acoplamiento síncrono que el evento debía evitar.',
        },
      ],
    },
    {
      title: 'El relay: publicar desde la tabla, sin perder eventos y sin romper el orden',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El relay es un bucle que lee los eventos pendientes, los publica en el broker y los marca como publicados. La consulta de reserva lleva dos decisiones. FOR UPDATE SKIP LOCKED permite que varias instancias del relay trabajen a la vez sin tomar la misma fila. Y el NOT EXISTS solo devuelve el evento pendiente más antiguo de cada agregado: si el pedido 77 tiene un evento de confirmación y otro de cancelación, el segundo solo se libera después de publicar el primero, incluso con relays concurrentes. Un lote nunca contiene dos eventos del mismo agregado, y el orden por pedido se preserva sin un relay único.',
        },
        { type: 'code', value: relayCode },
        {
          type: 'paragraph',
          value:
            'La garantía es al menos una vez, no exactamente una. Si el proceso cae después del publish y antes del COMMIT de la marca, la transacción del relay se deshace y el evento se publicará de nuevo. Es el comportamiento deseado: perder un evento es irrecuperable, duplicarlo es tratable. Por eso el messageId viaja con él, para que el consumidor reconozca la repetición. Algunos puntos de operación deciden si el relay se comporta bien:',
        },
        {
          type: 'list',
          items: [
            'Publica con confirmación del broker (acks en Kafka, publisher confirms en RabbitMQ). Un publish que vuelve sin confirmación puede haberse perdido, y marcarlo como publicado sería perder el evento.',
            'Usa una clave de partición igual a aggregate_id, para que los eventos del mismo pedido lleguen a la misma partición, en el orden en que fueron publicados.',
            'Aplica backoff por evento, como en el código, en lugar de reintentar en un bucle apretado. Un evento con payload rechazado no debe impedir que avancen los demás agregados.',
            'Mantén el lote pequeño, de decenas de filas. La transacción del relay retiene locks mientras habla con el broker, y un lote grande con un broker lento retiene filas por mucho tiempo.',
          ],
        },
      ],
    },
    {
      title: 'El consumidor tiene que aguantar el duplicado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Como la entrega es al menos una vez, el consumidor debe producir el mismo resultado cuando recibe el mismo mensaje dos veces. La facturación no puede emitir dos facturas para el mismo pedido.confirmado. El mecanismo más directo es la tabla inbox: registrar el messageId y ejecutar el efecto en la misma transacción, con ON CONFLICT DO NOTHING para detectar la repetición. Si el efecto falla, el ROLLBACK deshace también la marca, y la reentrega del broker lo intenta de nuevo, sin dar la falsa impresión de que el mensaje fue tratado.',
        },
        { type: 'code', value: consumerCode },
        {
          type: 'paragraph',
          value:
            'Cuando el efecto no ocurre en la misma base, como una llamada a una API externa, la transacción no cubre las dos cosas. En ese caso, pasa la clave de idempotencia del propio mensaje a la API de destino, usando el messageId. Es el mismo principio del cobro que no puede hacerse dos veces: la deduplicación vive donde ocurre el efecto.',
        },
      ],
    },
    {
      title: 'Operar la outbox: backlog, limpieza y la alternativa de CDC',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La outbox cambia un riesgo de pérdida silenciosa por un riesgo visible: el retraso. Es una mejora, siempre que alguien mire. La alerta que importa es la edad del evento pendiente más antiguo, no solo la cantidad: 500 eventos pendientes en un pico que se vacía en segundos es normal, un único evento de 10 minutos es un relay detenido. La tabla también necesita limpieza, en lotes pequeños, para no retener locks ni inflar el almacenamiento, y la inbox debe conservar los mensajes más tiempo del que el broker puede reentregar.',
        },
        { type: 'code', value: opsCode },
        {
          type: 'paragraph',
          value:
            'El relay por consulta (polling) es la opción simple y suficiente para la mayoría de los sistemas, con latencia de cientos de milisegundos. Cuando el volumen es alto o la latencia debe ser menor, leer el log de transacciones de la base (CDC, como Debezium) elimina el polling, a costa de operar una pieza más. La tabla compara las opciones.',
        },
        {
          type: 'table',
          columns: ['Enfoque', 'Garantía', 'Costo operativo', 'Cuándo usarlo'],
          rows: [
            ['Outbox con relay por consulta', 'Al menos una vez, orden por agregado', 'Bajo: un proceso y una tabla', 'Por defecto. Hasta unos miles de eventos por segundo'],
            ['Outbox con CDC (log de la base)', 'Al menos una vez, orden del log', 'Medio: conector, slot de replicación, monitoreo', 'Volumen alto o latencia de decenas de milisegundos'],
            ['Publicar tras el COMMIT con reintento en memoria', 'Puede perder si el proceso cae', 'Bajo', 'Solo cuando perder el evento es aceptable'],
            ['Transacción distribuida (2PC/XA)', 'Atómica entre base y broker', 'Alto: pocos brokers la soportan, bloquea recursos', 'Rara vez se justifica'],
            ['Event sourcing', 'El log de eventos es la fuente de verdad', 'Alto: cambia todo el modelo', 'Cuando el historial ya es el producto'],
          ],
        },
      ],
    },
    {
      title: 'Demostrar que no pierde: fallos inyectados en lugar de confianza',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una prueba que solo revisa el camino feliz no demuestra nada sobre la outbox. Las garantías aparecen cuando algo falla, así que la prueba tiene que provocar el fallo. Las tres pruebas siguientes cubren las propiedades que importan: un pedido que no cambia no genera evento, un broker caído no pierde el evento y la recuperación lo publica una sola vez, y una entrega duplicada es descartada por el consumidor. Usan una base de datos de prueba real, porque el comportamiento de transacciones y de SKIP LOCKED no existe en un mock.',
        },
        { type: 'code', value: testCode },
        {
          type: 'paragraph',
          value:
            'En producción, la conciliación sigue siendo útil como red de seguridad: una consulta diaria que cruza los pedidos confirmados en las últimas 24 horas con los eventos publicados detecta cualquier camino de código que alguien haya dejado fuera de la outbox, como un script de corrección que actualiza el pedido por fuera de la función confirmarPedido.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué no usar una transacción distribuida (2PC) entre la base y el broker?',
      answer:
        'Porque la mayoría de los brokers no participa en XA, y donde participa el costo es alto: la transacción retiene recursos en ambos lados mientras espera al coordinador, y un fallo del coordinador deja transacciones en duda bloqueando filas. La outbox obtiene el resultado práctico, ningún evento perdido, usando solo la transacción local que la base ya ofrece, y acepta el duplicado ocasional, que el consumidor idempotente absorbe.',
    },
    {
      question: '¿La outbox no se vuelve un cuello de botella al escribir una fila más en cada transacción?',
      answer:
        'El costo es un INSERT adicional en la misma transacción, normalmente por debajo de un milisegundo, sin round trip extra porque usa la misma conexión. Lo que puede volverse problema es que la tabla crezca sin limpieza y la lectura de pendientes recorra filas antiguas. El índice parcial sobre publicado_em IS NULL y la eliminación por lotes de los eventos ya publicados mantienen el costo estable con el tiempo.',
    },
    {
      question: '¿Se puede garantizar entrega exactamente una vez con la outbox?',
      answer:
        'Entre la outbox y el broker no: la garantía es al menos una vez, porque el relay puede publicar y caer antes de marcar. Lo que se obtiene es el efecto exactamente una vez, combinando la entrega al menos una vez con un consumidor idempotente que descarta el messageId repetido. Para el negocio el resultado es el mismo, una factura por pedido, y es la única forma honesta de prometerlo en sistemas distribuidos.',
    },
  ],
  conclusion: {
    title: 'El evento debe existir si, y solo si, el dato existe',
    description:
      'Guardar en la base y publicar en el broker nunca serán atómicos, y cualquier orden entre los dos pasos deja una ventana de pérdida o de evento fantasma que solo aparece en producción, en la conciliación, días después. La outbox lo resuelve moviendo el evento a la transacción del dato, publicando mediante un relay con entrega al menos una vez y orden por agregado, y dejando que el consumidor idempotente absorba el duplicado. Lo que queda es un riesgo medible, la edad del evento más antiguo, en lugar de una pérdida silenciosa. Con pruebas que inyectan fallos en el broker y en la entrega, y una conciliación diaria como red de seguridad, la pregunta deja de ser si algún evento se perdió y pasa a ser cuánto tardó en salir.',
    cta: 'Hablar sobre los eventos de mi sistema',
  },
  related: [
    {
      label: 'Webhook de salida que nadie confirma: entregar eventos a un cliente lento sin acumular una cola infinita',
      to: '/blog/webhook-de-saida-que-ninguem-confirma-cliente-lento-sem-fila-infinita',
    },
    {
      label: 'Job programado que se ejecuta dos veces: exclusión mutua distribuida sin un bloqueo eterno',
      to: '/blog/job-agendado-que-roda-duas-vezes-exclusao-mutua-distribuida-sem-trava-eterna',
    },
    {
      label: 'Arquitectura y modernización de backend',
      to: '/servicios/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
