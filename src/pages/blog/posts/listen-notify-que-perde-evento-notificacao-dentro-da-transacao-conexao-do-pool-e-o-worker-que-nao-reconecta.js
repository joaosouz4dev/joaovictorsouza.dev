// Conteudo do artigo: LISTEN/NOTIFY que perde evento. Por que o NOTIFY enviado por outra
// conexao chega antes do dado, como o LISTEN some junto com a conexao do pool ou atras do
// PgBouncer, por que o worker sem keepalive e sem heartbeat fica surdo depois de um failover
// e como montar um worker que reconecta e recupera o que foi gravado enquanto ninguem escutava.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const comments = {
  pt: {
    a0: 'api/pedidos.js: grava o pedido e avisa o worker.',
    a1: 'pool.query usa outra conexão, fora da transação: a notificação sai antes do COMMIT.',
    a2: 'worker.js: uma conexão escutando o canal.',
    a3: 'Se o COMMIT da API ainda não aconteceu, o pedido não existe para esta consulta e o evento é descartado.',
    a4: 'Sem handler de error e end, sem keepalive: se a conexão morrer sem aviso, o processo segue vivo e surdo.',
    b1: 'Quem está escutando agora: a sessão que fez LISTEN mostra o comando como última consulta.',
    b2: 'Uso da fila de notificações, de 0 a 1. Valor subindo sem parar indica um ouvinte que não consome.',
    b3: 'O que realmente importa: pedidos sem nota há mais de 5 minutos.',
    c1: 'Índice parcial: o worker só procura o que falta processar.',
    c2: 'NOTIFY dentro da transação de quem grava: entregue só no COMMIT, descartado no ROLLBACK.',
    c3: 'Payload vazio: a mensagem só acorda o worker, o dado está na tabela.',
    c4: 'FOR EACH STATEMENT: uma importação de 50 mil linhas gera uma notificação, não 50 mil.',
    d1: 'A tabela é a fonte da verdade: processa em lotes e marca cada pedido como emitido.',
    d2: 'SKIP LOCKED permite vários workers drenando ao mesmo tempo sem pegar o mesmo pedido.',
    d3: 'emitirNota precisa ser idempotente (usa o id do pedido como chave): um lote pode ser repetido depois de uma falha.',
    d4: 'Uma drenagem por vez; notificações que chegam no meio pedem mais uma volta.',
    d5: 'Conexão direta no Postgres (sem PgBouncer em modo transação), só para escutar.',
    d6: 'Notificação é só um aviso para olhar a tabela.',
    d7: 'Primeiro LISTEN, depois drenar: o que foi gravado enquanto ninguém escutava é recuperado sem lacuna.',
    d8: 'Heartbeat: conexão meio aberta não gera erro, só deixa de responder.',
    d9: 'Varredura periódica: rede de segurança para qualquer aviso perdido.',
  },
  en: {
    a0: 'api/orders.js: stores the order and notifies the worker.',
    a1: 'pool.query uses another connection, outside the transaction: the notification goes out before COMMIT.',
    a2: 'worker.js: a single connection listening on the channel.',
    a3: 'If the API COMMIT has not happened yet, the order does not exist for this query and the event is discarded.',
    a4: 'No error or end handler, no keepalive: if the connection dies silently, the process stays alive and deaf.',
    b1: 'Who is listening right now: the session that ran LISTEN shows the command as its last query.',
    b2: 'Notification queue usage, from 0 to 1. A value that keeps rising means a listener is not consuming.',
    b3: 'What really matters: orders without an invoice for more than 5 minutes.',
    c1: 'Partial index: the worker only looks for what is still pending.',
    c2: 'NOTIFY inside the writer transaction: delivered only on COMMIT, discarded on ROLLBACK.',
    c3: 'Empty payload: the message only wakes the worker up, the data lives in the table.',
    c4: 'FOR EACH STATEMENT: an import of 50 thousand rows produces one notification, not 50 thousand.',
    d1: 'The table is the source of truth: process in batches and mark each order as issued.',
    d2: 'SKIP LOCKED lets several workers drain at the same time without taking the same order.',
    d3: 'emitirNota must be idempotent (it uses the order id as key): a batch may be repeated after a failure.',
    d4: 'One drain at a time; notifications arriving in the middle ask for one more round.',
    d5: 'Direct connection to Postgres (no PgBouncer in transaction mode), used only for listening.',
    d6: 'A notification is just a hint to look at the table.',
    d7: 'LISTEN first, then drain: whatever was written while nobody was listening is recovered with no gap.',
    d8: 'Heartbeat: a half-open connection raises no error, it just stops answering.',
    d9: 'Periodic sweep: a safety net for any lost notification.',
  },
  es: {
    a0: 'api/pedidos.js: guarda el pedido y avisa al worker.',
    a1: 'pool.query usa otra conexión, fuera de la transacción: la notificación sale antes del COMMIT.',
    a2: 'worker.js: una conexión escuchando el canal.',
    a3: 'Si el COMMIT de la API todavía no ocurrió, el pedido no existe para esta consulta y el evento se descarta.',
    a4: 'Sin handler de error y end, sin keepalive: si la conexión muere sin aviso, el proceso sigue vivo y sordo.',
    b1: 'Quién está escuchando ahora: la sesión que ejecutó LISTEN muestra el comando como última consulta.',
    b2: 'Uso de la cola de notificaciones, de 0 a 1. Un valor que no deja de subir indica un oyente que no consume.',
    b3: 'Lo que realmente importa: pedidos sin factura desde hace más de 5 minutos.',
    c1: 'Índice parcial: el worker solo busca lo que falta procesar.',
    c2: 'NOTIFY dentro de la transacción de quien escribe: se entrega solo en el COMMIT y se descarta en el ROLLBACK.',
    c3: 'Payload vacío: el mensaje solo despierta al worker, el dato está en la tabla.',
    c4: 'FOR EACH STATEMENT: una importación de 50 mil filas genera una notificación, no 50 mil.',
    d1: 'La tabla es la fuente de verdad: procesa en lotes y marca cada pedido como emitido.',
    d2: 'SKIP LOCKED permite que varios workers drenen al mismo tiempo sin tomar el mismo pedido.',
    d3: 'emitirNota debe ser idempotente (usa el id del pedido como clave): un lote puede repetirse después de una falla.',
    d4: 'Un drenaje a la vez; las notificaciones que llegan en medio piden una vuelta más.',
    d5: 'Conexión directa a Postgres (sin PgBouncer en modo transacción), solo para escuchar.',
    d6: 'La notificación es solo un aviso para mirar la tabla.',
    d7: 'Primero LISTEN, después drenar: lo que se guardó mientras nadie escuchaba se recupera sin huecos.',
    d8: 'Heartbeat: una conexión medio abierta no genera error, solo deja de responder.',
    d9: 'Barrido periódico: red de seguridad para cualquier aviso perdido.',
  },
};

const buggyCode = (c) => `// ${c.a0}
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

export async function criarPedido(clienteId, total) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO pedidos (cliente_id, total) VALUES ($1, $2) RETURNING id',
      [clienteId, total],
    );
    // ${c.a1}
    await pool.query('SELECT pg_notify($1, $2)', ['pedido_criado', String(rows[0].id)]);
    await client.query('COMMIT');
    return rows[0].id;
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}

// ${c.a2}
import pg from 'pg';
import { emitirNota } from './notas.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const ouvinte = new pg.Client({ connectionString: process.env.DATABASE_URL });

await ouvinte.connect();
await ouvinte.query('LISTEN pedido_criado');

ouvinte.on('notification', async ({ payload }) => {
  const { rows } = await pool.query('SELECT * FROM pedidos WHERE id = $1', [payload]);
  // ${c.a3}
  if (rows.length === 0) return;
  await emitirNota(rows[0].id);
});
// ${c.a4}`;

const diagnosticCode = (c) => `-- ${c.b1}
SELECT pid, application_name, client_addr, backend_start, state, state_change, query
  FROM pg_stat_activity
 WHERE query ILIKE 'listen %';

-- ${c.b2}
SELECT pg_notification_queue_usage();

-- ${c.b3}
SELECT count(*) AS sem_nota, min(criado_em) AS mais_antigo
  FROM pedidos
 WHERE nota_emitida_em IS NULL
   AND criado_em < now() - interval '5 minutes';`;

const publisherCode = (c) => `-- ${c.c1}
CREATE INDEX CONCURRENTLY pedidos_sem_nota_idx
    ON pedidos (id)
 WHERE nota_emitida_em IS NULL;

-- ${c.c2}
CREATE OR REPLACE FUNCTION avisar_pedido_criado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- ${c.c3}
  PERFORM pg_notify('pedido_criado', '');
  RETURN NULL;
END;
$$;

-- ${c.c4}
CREATE TRIGGER pedidos_avisar_worker
  AFTER INSERT ON pedidos
  FOR EACH STATEMENT
  EXECUTE FUNCTION avisar_pedido_criado();`;

const workerCode = (c) => `import pg from 'pg';
import { emitirNota } from './notas.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const HEARTBEAT_MS = 15_000;
const HEARTBEAT_LIMITE_MS = 5_000;
const VARREDURA_MS = 30_000;

// ${c.d1}
async function processarLote() {
  const client = await pool.connect();
  let descartar = false;
  try {
    await client.query('BEGIN');
    // ${c.d2}
    const { rows } = await client.query(
      'SELECT id FROM pedidos WHERE nota_emitida_em IS NULL ' +
        'ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED',
    );
    for (const { id } of rows) {
      // ${c.d3}
      await emitirNota(id);
      await client.query('UPDATE pedidos SET nota_emitida_em = now() WHERE id = $1', [id]);
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {
      descartar = true;
    });
    throw erro;
  } finally {
    client.release(descartar);
  }
}

// ${c.d4}
let drenando = false;
let pendente = false;

async function drenar() {
  if (drenando) {
    pendente = true;
    return;
  }
  drenando = true;
  try {
    do {
      pendente = false;
      while ((await processarLote()) > 0) {}
    } while (pendente);
  } catch (erro) {
    console.error('falha ao drenar pedidos', erro);
  } finally {
    drenando = false;
  }
}

async function escutar(tentativa = 0) {
  // ${c.d5}
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL_DIRETA,
    application_name: 'worker-notas:listen',
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  let encerrado = false;
  let heartbeat;

  const reconectar = (motivo) => {
    if (encerrado) return;
    encerrado = true;
    clearInterval(heartbeat);
    console.warn('conexão de escuta perdida:', motivo?.message ?? motivo);
    client.end().catch(() => {});
    const espera = Math.min(30_000, 1_000 * 2 ** tentativa);
    setTimeout(() => escutar(tentativa + 1), espera);
  };

  client.on('error', reconectar);
  client.on('end', () => reconectar(new Error('conexão encerrada')));
  // ${c.d6}
  client.on('notification', () => {
    drenar();
  });

  try {
    await client.connect();
    await client.query('LISTEN pedido_criado');
    tentativa = 0;
    // ${c.d7}
    drenar();
    // ${c.d8}
    heartbeat = setInterval(() => {
      const limite = setTimeout(
        () => reconectar(new Error('heartbeat sem resposta')),
        HEARTBEAT_LIMITE_MS,
      );
      client.query('SELECT 1').then(
        () => clearTimeout(limite),
        (erro) => {
          clearTimeout(limite);
          reconectar(erro);
        },
      );
    }, HEARTBEAT_MS);
  } catch (erro) {
    reconectar(erro);
  }
}

escutar();
// ${c.d9}
setInterval(drenar, VARREDURA_MS);`;

const pt = {
  intro:
    'Um distribuidor B2B emitia a nota fiscal de cada pedido com um worker que escutava o canal pedido_criado no Postgres. A API gravava o pedido e chamava pg_notify; o worker recebia o id, lia o pedido e chamava o emissor. Era simples, sem broker para operar, e por meses ninguém olhou para ele. Até que o financeiro encontrou dois buracos diferentes. O primeiro era discreto: cerca de 0,4% dos pedidos nunca recebiam nota, sem nenhum erro nos logs. O segundo era grande: num sábado, às 02:10, o provedor fez failover do banco, e o worker passou seis horas vivo, conectado na visão dele, sem receber nada. Quando alguém percebeu, 1.900 pedidos estavam sem nota. Os dois buracos têm a mesma raiz: LISTEN/NOTIFY é um aviso entregue no melhor esforço, só para quem está escutando naquele instante, e o código tratava o aviso como se fosse a fila. Este artigo mostra como o NOTIFY é entregue de verdade, por que a notificação fora da transação chega antes do dado, onde o LISTEN some junto com a conexão do pool ou atrás do PgBouncer, e como montar um worker que reconecta e recupera tudo o que foi gravado enquanto ninguém escutava.',
  sections: [
    {
      title: 'O worker que ficou seis horas surdo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O código era curto e passava em qualquer teste local. A API abria uma transação, inseria o pedido e, para avisar o worker, chamava pg_notify pelo pool. O worker abria uma conexão, executava LISTEN e, para cada notificação, buscava o pedido e emitia a nota.',
        },
        { type: 'code', value: buggyCode(comments.pt) },
        {
          type: 'paragraph',
          value:
            'Há três defeitos aqui, e cada um explica uma parte do incidente. O pg_notify vai por outra conexão, então a notificação é publicada antes do COMMIT do pedido: quando o worker consulta rápido demais, o pedido ainda não existe e o evento é descartado em silêncio. A conexão de escuta não tem keepalive nem tratamento de error e end: no failover, o primário antigo desapareceu sem fechar o TCP, e o socket ficou esperando para sempre. E não existe nenhuma forma de recuperar o que foi notificado enquanto o worker não escutava, porque o código não olha para a tabela, só para o aviso.',
        },
        {
          type: 'list',
          items: [
            'Sintoma 1: uma fração pequena e constante de pedidos sem nota, maior nos horários de pico, sem erro nenhum.',
            'Sintoma 2: depois de um failover, reinício do banco ou troca de rede, o worker segue rodando e não processa mais nada.',
            'Sintoma 3: depois de reiniciar o worker, os pedidos novos voltam a ser processados, mas os do intervalo continuam pendentes para sempre.',
          ],
        },
      ],
    },
    {
      title: 'Como o NOTIFY é entregue de verdade',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O NOTIFY não é uma fila de mensagens. Quando uma transação executa NOTIFY, a notificação fica guardada até o COMMIT; nesse momento ela entra numa fila em memória compartilhada e é entregue a todas as sessões que estão com LISTEN ativo naquele canal. Não existe confirmação, não existe nova tentativa e não existe histórico: uma sessão que fizer LISTEN um segundo depois nunca verá o que foi publicado antes.',
        },
        {
          type: 'table',
          columns: ['Situação', 'O que acontece com a notificação'],
          rows: [
            ['NOTIFY dentro de uma transação que faz COMMIT', 'Entregue depois do COMMIT, quando o dado já está visível'],
            ['NOTIFY dentro de uma transação que faz ROLLBACK', 'Descartada, ninguém recebe'],
            ['NOTIFY por outra conexão, antes do COMMIT de quem grava', 'Entregue na hora, antes de o dado existir para os outros'],
            ['Ouvinte desconectado no momento do COMMIT', 'Perdida para esse ouvinte, sem nenhum registro'],
            ['Ouvinte no meio de uma transação própria', 'Fica retida e só chega quando a transação dele terminar'],
            ['Mesmo canal e mesmo payload repetidos na mesma transação', 'Agrupados em uma única notificação'],
            ['Payload com mais de 8.000 bytes', 'O NOTIFY falha com erro'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Duas linhas dessa tabela pesam mais em produção. A entrega acontece só para quem escuta no instante do COMMIT, então qualquer intervalo sem conexão vira evento perdido. E a fila em memória é compartilhada por todo o cluster: ela só avança quando todos os ouvintes consumiram, então um ouvinte preso numa transação longa segura a fila de todos. A fila tem 8 GB; quando enche, quem falha é a transação que tenta fazer NOTIFY, no COMMIT, com o erro too many notifications in the NOTIFY queue. Ou seja, um worker travado pode derrubar a gravação de pedidos da API.',
        },
      ],
    },
    {
      title: 'Notificação fora da transação: o evento que chega antes do dado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Os 0,4% de pedidos sem nota vinham da corrida entre o aviso e o COMMIT. O pg_notify pelo pool executava numa conexão sem transação aberta, então era confirmado e entregue na hora. O worker recebia em menos de um milissegundo e consultava o pedido. Na maioria das vezes o COMMIT da API já tinha acontecido; nos picos, com fsync mais lento e o pool disputado, não tinha, e a consulta voltava vazia. O mesmo padrão aparece quando a notificação é publicada pela aplicação depois do COMMIT, mas o processo cai entre um e outro: aí o dado existe e o aviso nunca sai.',
        },
        {
          type: 'paragraph',
          value:
            'A correção é colocar o NOTIFY dentro da mesma transação que grava o dado. Pode ser pela própria conexão da transação (client.query em vez de pool.query) ou, de forma que nenhum caminho de escrita esqueça, por um trigger. Como o worker vai ler a tabela de qualquer jeito, o payload não precisa carregar nada.',
        },
        { type: 'code', value: publisherCode(comments.pt) },
        {
          type: 'paragraph',
          value:
            'O trigger por instrução, e não por linha, evita outro problema: uma importação em massa com FOR EACH ROW e o id no payload gera uma notificação por linha, todas diferentes, e nenhuma é agrupada. Com payload vazio e FOR EACH STATEMENT, cada transação gera um único aviso. A coluna nota_emitida_em com o índice parcial transforma a tabela de pedidos na fila de verdade: o que falta processar é o que tem a coluna nula.',
        },
      ],
    },
    {
      title: 'Conexão do pool e PgBouncer: onde o LISTEN some',
      blocks: [
        {
          type: 'paragraph',
          value:
            'LISTEN é estado da sessão, igual a um SET ou a uma trava de sessão. Ele vale enquanto aquela conexão do servidor existir e só para ela. Tudo que troca, fecha ou compartilha a conexão faz o LISTEN desaparecer sem erro.',
        },
        {
          type: 'list',
          items: [
            'pool.query(\'LISTEN canal\'): o comando roda numa conexão qualquer, que volta para o pool; ninguém registra o handler de notification nela, e o idleTimeoutMillis a fecha depois de alguns segundos.',
            'pool.connect seguido de client.release(): o handler continua registrado, mas a conexão agora atende outras rotas e será fechada quando ficar ociosa.',
            'PgBouncer em modo transação: LISTEN não é suportado, porque cada transação pode cair numa conexão diferente do servidor. O ouvinte precisa de conexão direta ou de um pool em modo sessão.',
            'idle_session_timeout configurado para o papel da aplicação: o ouvinte passa a maior parte do tempo ocioso e é encerrado pelo servidor.',
            'Failover, reinício do banco, troca de IP ou timeout de NAT e de load balancer: a conexão morre, às vezes sem que o cliente receba nenhum pacote avisando.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O último caso é o do sábado. Quando o servidor some de forma abrupta, o cliente não recebe FIN nem RST; o socket continua aberto do lado dele, e uma conexão que só espera notificações nunca envia nada, então nunca descobre que está falando sozinha. O keepalive do TCP ajuda, mas os intervalos padrão do sistema operacional chegam a duas horas. Para diagnosticar, três consultas respondem quase tudo: quem está escutando, se a fila está crescendo e, a mais importante, quanto trabalho está parado.',
        },
        { type: 'code', value: diagnosticCode(comments.pt) },
      ],
    },
    {
      title: 'O worker que reconecta e recupera o que perdeu',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A mudança de modelo é tratar o NOTIFY como campainha, não como entrega. A notificação diz que há algo novo; o que fazer está na tabela. Com isso, perder um aviso deixa de ser perder um evento: o próximo aviso, a reconexão ou a varredura periódica encontram o pedido pendente.',
        },
        {
          type: 'ordered',
          items: [
            'Conecte o ouvinte direto no Postgres, com keepalive e um application_name que o identifique no pg_stat_activity.',
            'Trate error e end com a mesma função de reconexão, com espera exponencial limitada.',
            'Depois de cada conexão, execute LISTEN e só então drene a tabela. Nessa ordem, qualquer pedido gravado antes do LISTEN aparece na drenagem, e qualquer um gravado depois gera aviso.',
            'Mande um SELECT 1 periódico com prazo curto para detectar a conexão meio aberta em segundos, não em horas.',
            'Mantenha uma varredura periódica independente do canal, como rede de segurança.',
            'Processe em lotes com FOR UPDATE SKIP LOCKED e torne o efeito externo idempotente.',
          ],
        },
        { type: 'code', value: workerCode(comments.pt) },
        {
          type: 'diagram',
          value: `02:09:58  API     INSERT 81204 + NOTIFY  -> worker recebe e emite a nota
02:10:03  banco   failover: o primário antigo some sem fechar o TCP
02:10:05  API     INSERT 81205 + NOTIFY  -> ninguém escuta no primário novo
02:10:15  worker  heartbeat: SELECT 1 enviado, sem resposta
02:10:20  worker  prazo de 5 s estourado -> reconectar()
02:10:21  worker  connect -> LISTEN pedido_criado -> drenar()
02:10:21  worker  nota_emitida_em IS NULL -> encontra 81205 a 81212
02:10:51  worker  varredura de 30 s: nada pendente`,
        },
        {
          type: 'paragraph',
          value:
            'Com esse desenho, o mesmo failover que deixou 1.900 pedidos parados vira uma pausa de cerca de 20 segundos, sem nenhum pedido perdido. A varredura de 30 segundos garante um atraso máximo previsível mesmo se tudo mais falhar, e o canal mantém a latência baixa no caso comum.',
        },
      ],
    },
    {
      title: 'Fila cheia, vários ouvintes e o que monitorar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo com o worker robusto, alguns limites do mecanismo continuam valendo e merecem alerta antes de virarem incidente.',
        },
        {
          type: 'table',
          columns: ['Falha', 'Sintoma', 'Causa', 'Correção'],
          rows: [
            ['Evento antes do dado', 'Fração pequena de itens nunca processados', 'NOTIFY por outra conexão, fora da transação', 'NOTIFY na mesma transação ou por trigger'],
            ['LISTEN que some', 'Worker para depois de segundos ou minutos', 'LISTEN numa conexão do pool ou atrás do PgBouncer em modo transação', 'Conexão dedicada e direta para escutar'],
            ['Worker surdo', 'Processo vivo, nada processado depois de failover', 'Conexão meio aberta, sem keepalive nem heartbeat', 'Keepalive, SELECT 1 com prazo e reconexão'],
            ['Lacuna na reconexão', 'Itens do intervalo pendentes para sempre', 'Só o aviso dispara o processamento', 'LISTEN, depois drenagem da tabela, mais varredura periódica'],
            ['Fila de notificações cheia', 'COMMIT da API falha com too many notifications', 'Ouvinte preso em transação longa', 'Alerta em pg_notification_queue_usage e ouvinte sem transação aberta'],
            ['Aviso duplicado', 'Mesmo item processado duas vezes', 'Todos os ouvintes recebem todas as notificações', 'SKIP LOCKED na drenagem e efeito idempotente'],
          ],
        },
        {
          type: 'list',
          items: [
            'Alerte pelo resultado, não pelo canal: quantidade e idade dos itens pendentes na tabela.',
            'Alerte quando pg_notification_queue_usage passar de 0,1 e investigue qual sessão segura a fila.',
            'Confira no pg_stat_activity que existe exatamente o número esperado de ouvintes, pelo application_name.',
            'Inclua o failover no ensaio: derrube o primário em homologação e meça quanto tempo o worker leva para voltar.',
            'Mantenha o payload pequeno ou vazio; dado de verdade fica na tabela.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que não colocar o pedido inteiro no payload e dispensar a consulta?',
      answer:
        'Porque o payload só ajuda quando a notificação chega, e o problema está justamente nas que não chegam. Ele também tem limite de 8.000 bytes, pode carregar uma versão do dado que mudou logo depois e ocupa a fila compartilhada do cluster. Use o payload no máximo como dica, por exemplo um id para priorizar, e mantenha a tabela como fonte da verdade.',
    },
    {
      question: 'LISTEN/NOTIFY substitui uma fila como RabbitMQ, SQS ou Redis Streams?',
      answer:
        'Como campainha para uma fila guardada em tabela, sim, e evita operar mais um sistema enquanto o volume é moderado. Como fila em si, não: não há confirmação, nova tentativa nem retenção. Também vale saber que os COMMITs de transações que executaram NOTIFY são serializados por uma trava global, então com milhares de commits notificando por segundo o mecanismo vira gargalo. Nesse ponto, ou quando outros sistemas precisam consumir os eventos, um outbox publicando num broker é o caminho.',
    },
    {
      question: 'Se eu rodar três workers escutando o mesmo canal, eles processam o mesmo pedido?',
      answer:
        'Todos recebem todas as notificações, porque NOTIFY é difusão e não divisão de trabalho entre consumidores. Quem impede o processamento duplicado é a drenagem: com FOR UPDATE SKIP LOCKED, cada worker pega linhas diferentes, e o UPDATE na mesma transação tira o pedido da fila. Como uma falha depois de emitir a nota e antes do COMMIT faz o lote se repetir, o emissor precisa ser idempotente pelo id do pedido.',
    },
  ],
  conclusion: {
    title: 'O aviso acorda, a tabela decide',
    description:
      'LISTEN/NOTIFY entrega no melhor esforço, só para quem escuta no instante do COMMIT, e o LISTEN vive na sessão: some com a conexão do pool, não passa pelo PgBouncer em modo transação e morre calado num failover. Os eventos perdidos vêm de tratar esse aviso como fila. Publique o NOTIFY dentro da transação que grava, escute por uma conexão dedicada com keepalive e heartbeat, faça LISTEN antes de drenar a tabela a cada reconexão e mantenha uma varredura periódica. Com a tabela como fonte da verdade, perder uma notificação passa a custar segundos, não pedidos.',
    cta: 'Quer revisar workers, filas e eventos que dependem do Postgres antes do próximo failover?',
  },
  related: [
    {
      label: 'Outbox transacional: gravar no banco e publicar o evento sem perder nenhum dos dois',
      to: '/blog/outbox-transacional-gravar-no-banco-e-publicar-o-evento-sem-perder-nenhum-dos-dois',
    },
    {
      label: 'Advisory lock que fica preso no pool: pg_advisory_lock de sessão, PgBouncer e o job que nunca mais roda',
      to: '/blog/advisory-lock-que-fica-preso-no-pool-pg-advisory-lock-de-sessao-pgbouncer-e-o-job-que-nunca-mais-roda',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A B2B distributor issued the invoice for each order with a worker that listened on the pedido_criado channel in Postgres. The API stored the order and called pg_notify; the worker received the id, read the order and called the invoicing service. It was simple, with no broker to operate, and for months nobody looked at it. Then finance found two different holes. The first was subtle: about 0.4% of orders never got an invoice, with no error in the logs. The second was big: on a Saturday at 02:10 the provider failed the database over, and the worker spent six hours alive, connected as far as it knew, receiving nothing. When someone noticed, 1,900 orders had no invoice. Both holes share the same root: LISTEN/NOTIFY is a best-effort hint delivered only to whoever is listening at that instant, and the code treated the hint as if it were the queue. This article shows how NOTIFY is really delivered, why a notification sent outside the transaction arrives before the data, where LISTEN disappears along with a pooled connection or behind PgBouncer, and how to build a worker that reconnects and recovers everything written while nobody was listening.',
  sections: [
    {
      title: 'The worker that stayed deaf for six hours',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The code was short and passed every local test. The API opened a transaction, inserted the order and, to notify the worker, called pg_notify through the pool. The worker opened a connection, ran LISTEN and, for each notification, fetched the order and issued the invoice.',
        },
        { type: 'code', value: buggyCode(comments.en) },
        {
          type: 'paragraph',
          value:
            'There are three defects here, and each one explains part of the incident. pg_notify goes through another connection, so the notification is published before the order COMMIT: when the worker queries too quickly, the order does not exist yet and the event is silently dropped. The listening connection has no keepalive and no error or end handling: during the failover the old primary vanished without closing TCP, and the socket kept waiting forever. And there is no way to recover what was notified while the worker was not listening, because the code never looks at the table, only at the hint.',
        },
        {
          type: 'list',
          items: [
            'Symptom 1: a small, steady fraction of orders without an invoice, higher at peak hours, with no error at all.',
            'Symptom 2: after a failover, a database restart or a network change, the worker keeps running and stops processing anything.',
            'Symptom 3: after restarting the worker, new orders are processed again, but the ones from the gap stay pending forever.',
          ],
        },
      ],
    },
    {
      title: 'How NOTIFY is really delivered',
      blocks: [
        {
          type: 'paragraph',
          value:
            'NOTIFY is not a message queue. When a transaction runs NOTIFY, the notification is held until COMMIT; at that moment it enters a shared memory queue and is delivered to every session with an active LISTEN on that channel. There is no acknowledgment, no retry and no history: a session that runs LISTEN one second later will never see what was published before.',
        },
        {
          type: 'table',
          columns: ['Situation', 'What happens to the notification'],
          rows: [
            ['NOTIFY inside a transaction that commits', 'Delivered after COMMIT, when the data is already visible'],
            ['NOTIFY inside a transaction that rolls back', 'Discarded, nobody receives it'],
            ['NOTIFY through another connection, before the writer COMMIT', 'Delivered right away, before the data exists for anyone else'],
            ['Listener disconnected at COMMIT time', 'Lost for that listener, with no record at all'],
            ['Listener in the middle of its own transaction', 'Held back and delivered only when its transaction ends'],
            ['Same channel and same payload repeated in one transaction', 'Folded into a single notification'],
            ['Payload larger than 8,000 bytes', 'NOTIFY fails with an error'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Two rows of that table weigh the most in production. Delivery only reaches whoever listens at COMMIT time, so any interval without a connection turns into lost events. And the in-memory queue is shared by the whole cluster: it only advances once every listener has consumed, so a listener stuck in a long transaction holds the queue for everybody. The queue is 8 GB; when it fills up, the transaction that fails is the one trying to NOTIFY, at COMMIT, with the error too many notifications in the NOTIFY queue. In other words, a stuck worker can break order writes in the API.',
        },
      ],
    },
    {
      title: 'Notification outside the transaction: the event that arrives before the data',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The 0.4% of orders without an invoice came from the race between the hint and the COMMIT. pg_notify through the pool ran on a connection with no open transaction, so it was committed and delivered immediately. The worker received it in under a millisecond and queried the order. Most of the time the API COMMIT had already happened; at peak, with slower fsync and a contended pool, it had not, and the query came back empty. The same pattern shows up when the application publishes the notification after COMMIT but the process dies in between: then the data exists and the hint never goes out.',
        },
        {
          type: 'paragraph',
          value:
            'The fix is to put NOTIFY inside the same transaction that writes the data. It can go through the transaction connection itself (client.query instead of pool.query) or, so that no write path forgets it, through a trigger. Since the worker will read the table anyway, the payload does not need to carry anything.',
        },
        { type: 'code', value: publisherCode(comments.en) },
        {
          type: 'paragraph',
          value:
            'A statement-level trigger, rather than a row-level one, avoids another problem: a bulk import with FOR EACH ROW and the id in the payload produces one notification per row, all different, and none of them is folded. With an empty payload and FOR EACH STATEMENT, each transaction produces a single hint. The nota_emitida_em column with the partial index turns the orders table into the real queue: what is pending is whatever has the column null.',
        },
      ],
    },
    {
      title: 'Pooled connections and PgBouncer: where LISTEN disappears',
      blocks: [
        {
          type: 'paragraph',
          value:
            'LISTEN is session state, just like a SET or a session lock. It lasts while that server connection exists and applies only to it. Anything that swaps, closes or shares the connection makes LISTEN disappear without an error.',
        },
        {
          type: 'list',
          items: [
            'pool.query(\'LISTEN channel\'): the command runs on any connection, which goes back to the pool; nobody registers a notification handler on it, and idleTimeoutMillis closes it after a few seconds.',
            'pool.connect followed by client.release(): the handler stays registered, but the connection now serves other routes and will be closed once it becomes idle.',
            'PgBouncer in transaction mode: LISTEN is not supported, because each transaction may land on a different server connection. The listener needs a direct connection or a pool in session mode.',
            'idle_session_timeout set for the application role: the listener spends most of its time idle and is terminated by the server.',
            'Failover, database restart, IP change or NAT and load balancer timeouts: the connection dies, sometimes without the client receiving a single packet about it.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last case is the Saturday one. When the server vanishes abruptly, the client gets neither FIN nor RST; the socket stays open on its side, and a connection that only waits for notifications never sends anything, so it never finds out it is talking to nobody. TCP keepalive helps, but the operating system defaults can reach two hours. For diagnosis, three queries answer almost everything: who is listening, whether the queue is growing and, most important, how much work is stuck.',
        },
        { type: 'code', value: diagnosticCode(comments.en) },
      ],
    },
    {
      title: 'The worker that reconnects and recovers what it missed',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The model change is to treat NOTIFY as a doorbell, not as delivery. The notification says something is new; what to do lives in the table. With that, losing a hint no longer means losing an event: the next hint, the reconnection or the periodic sweep will find the pending order.',
        },
        {
          type: 'ordered',
          items: [
            'Connect the listener directly to Postgres, with keepalive and an application_name that identifies it in pg_stat_activity.',
            'Handle error and end with the same reconnection function, using a capped exponential backoff.',
            'After every connection, run LISTEN and only then drain the table. In this order, any order written before LISTEN shows up in the drain, and any order written after it produces a hint.',
            'Send a periodic SELECT 1 with a short deadline to detect a half-open connection in seconds, not hours.',
            'Keep a periodic sweep that does not depend on the channel, as a safety net.',
            'Process in batches with FOR UPDATE SKIP LOCKED and make the external effect idempotent.',
          ],
        },
        { type: 'code', value: workerCode(comments.en) },
        {
          type: 'diagram',
          value: `02:09:58  API     INSERT 81204 + NOTIFY  -> worker receives it and issues the invoice
02:10:03  db      failover: the old primary vanishes without closing TCP
02:10:05  API     INSERT 81205 + NOTIFY  -> nobody is listening on the new primary
02:10:15  worker  heartbeat: SELECT 1 sent, no answer
02:10:20  worker  5 s deadline exceeded -> reconectar()
02:10:21  worker  connect -> LISTEN pedido_criado -> drenar()
02:10:21  worker  nota_emitida_em IS NULL -> finds 81205 to 81212
02:10:51  worker  30 s sweep: nothing pending`,
        },
        {
          type: 'paragraph',
          value:
            'With this design, the same failover that left 1,900 orders stuck becomes a pause of about 20 seconds, with no order lost. The 30 second sweep guarantees a predictable maximum delay even if everything else fails, and the channel keeps latency low in the common case.',
        },
      ],
    },
    {
      title: 'Full queue, multiple listeners and what to monitor',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Even with a robust worker, some limits of the mechanism still apply and deserve an alert before they become an incident.',
        },
        {
          type: 'table',
          columns: ['Failure', 'Symptom', 'Cause', 'Fix'],
          rows: [
            ['Event before the data', 'Small fraction of items never processed', 'NOTIFY through another connection, outside the transaction', 'NOTIFY in the same transaction or through a trigger'],
            ['LISTEN that disappears', 'Worker stops after seconds or minutes', 'LISTEN on a pooled connection or behind PgBouncer in transaction mode', 'Dedicated, direct connection for listening'],
            ['Deaf worker', 'Process alive, nothing processed after a failover', 'Half-open connection, no keepalive or heartbeat', 'Keepalive, SELECT 1 with a deadline and reconnection'],
            ['Gap on reconnection', 'Items from the gap pending forever', 'Only the hint triggers processing', 'LISTEN, then drain the table, plus a periodic sweep'],
            ['Full notification queue', 'API COMMIT fails with too many notifications', 'Listener stuck in a long transaction', 'Alert on pg_notification_queue_usage and no open transaction in the listener'],
            ['Duplicate hint', 'Same item processed twice', 'Every listener receives every notification', 'SKIP LOCKED in the drain and an idempotent effect'],
          ],
        },
        {
          type: 'list',
          items: [
            'Alert on the outcome, not on the channel: count and age of pending items in the table.',
            'Alert when pg_notification_queue_usage goes above 0.1 and find out which session is holding the queue.',
            'Check in pg_stat_activity that there is exactly the expected number of listeners, by application_name.',
            'Include failover in your drills: take down the primary in staging and measure how long the worker takes to come back.',
            'Keep the payload small or empty; real data stays in the table.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why not put the whole order in the payload and skip the query?',
      answer:
        'Because the payload only helps when the notification arrives, and the problem is exactly the ones that do not. It is also capped at 8,000 bytes, may carry a version of the data that changed right after, and takes space in the cluster-wide shared queue. Use the payload at most as a hint, such as an id to prioritize, and keep the table as the source of truth.',
    },
    {
      question: 'Does LISTEN/NOTIFY replace a queue such as RabbitMQ, SQS or Redis Streams?',
      answer:
        'As a doorbell for a queue stored in a table, yes, and it saves you from operating one more system while volume is moderate. As a queue in itself, no: there is no acknowledgment, no retry and no retention. It is also worth knowing that the COMMITs of transactions that ran NOTIFY are serialized by a global lock, so with thousands of notifying commits per second the mechanism becomes a bottleneck. At that point, or when other systems need to consume the events, an outbox publishing to a broker is the way to go.',
    },
    {
      question: 'If I run three workers listening on the same channel, will they process the same order?',
      answer:
        'All of them receive every notification, because NOTIFY is a broadcast, not work sharing among consumers. What prevents duplicate processing is the drain: with FOR UPDATE SKIP LOCKED each worker takes different rows, and the UPDATE in the same transaction removes the order from the queue. Since a failure after issuing the invoice and before COMMIT makes the batch run again, the invoicing call must be idempotent on the order id.',
    },
  ],
  conclusion: {
    title: 'The hint wakes you up, the table decides',
    description:
      'LISTEN/NOTIFY delivers on a best-effort basis, only to whoever listens at COMMIT time, and LISTEN lives in the session: it disappears with a pooled connection, does not work through PgBouncer in transaction mode and dies silently during a failover. Lost events come from treating that hint as a queue. Publish NOTIFY inside the transaction that writes, listen on a dedicated connection with keepalive and heartbeat, run LISTEN before draining the table on every reconnection and keep a periodic sweep. With the table as the source of truth, losing a notification costs seconds, not orders.',
    cta: 'Want to review workers, queues and events that depend on Postgres before the next failover?',
  },
  related: [
    {
      label: 'Transactional outbox: writing to the database and publishing the event without losing either one',
      to: '/blog/outbox-transacional-gravar-no-banco-e-publicar-o-evento-sem-perder-nenhum-dos-dois',
    },
    {
      label: 'The advisory lock stuck in the pool: session pg_advisory_lock, PgBouncer and the job that never runs again',
      to: '/blog/advisory-lock-que-fica-preso-no-pool-pg-advisory-lock-de-sessao-pgbouncer-e-o-job-que-nunca-mais-roda',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Un distribuidor B2B emitía la factura de cada pedido con un worker que escuchaba el canal pedido_criado en Postgres. La API guardaba el pedido y llamaba a pg_notify; el worker recibía el id, leía el pedido y llamaba al emisor. Era simple, sin broker que operar, y durante meses nadie lo miró. Hasta que finanzas encontró dos huecos distintos. El primero era discreto: cerca del 0,4% de los pedidos nunca recibía factura, sin ningún error en los logs. El segundo era grande: un sábado a las 02:10 el proveedor hizo failover de la base de datos, y el worker pasó seis horas vivo, conectado según él, sin recibir nada. Cuando alguien lo notó, 1.900 pedidos estaban sin factura. Los dos huecos tienen la misma raíz: LISTEN/NOTIFY es un aviso entregado con el mejor esfuerzo, solo a quien está escuchando en ese instante, y el código trataba el aviso como si fuera la cola. Este artículo muestra cómo se entrega realmente el NOTIFY, por qué la notificación enviada fuera de la transacción llega antes que el dato, dónde desaparece el LISTEN junto con la conexión del pool o detrás de PgBouncer, y cómo construir un worker que se reconecta y recupera todo lo que se guardó mientras nadie escuchaba.',
  sections: [
    {
      title: 'El worker que pasó seis horas sordo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El código era corto y pasaba cualquier prueba local. La API abría una transacción, insertaba el pedido y, para avisar al worker, llamaba a pg_notify por el pool. El worker abría una conexión, ejecutaba LISTEN y, por cada notificación, buscaba el pedido y emitía la factura.',
        },
        { type: 'code', value: buggyCode(comments.es) },
        {
          type: 'paragraph',
          value:
            'Hay tres defectos aquí, y cada uno explica una parte del incidente. El pg_notify va por otra conexión, así que la notificación se publica antes del COMMIT del pedido: cuando el worker consulta demasiado rápido, el pedido todavía no existe y el evento se descarta en silencio. La conexión de escucha no tiene keepalive ni manejo de error y end: en el failover, el primario antiguo desapareció sin cerrar el TCP, y el socket se quedó esperando para siempre. Y no hay ninguna forma de recuperar lo que se notificó mientras el worker no escuchaba, porque el código no mira la tabla, solo el aviso.',
        },
        {
          type: 'list',
          items: [
            'Síntoma 1: una fracción pequeña y constante de pedidos sin factura, mayor en las horas pico, sin ningún error.',
            'Síntoma 2: después de un failover, un reinicio de la base o un cambio de red, el worker sigue corriendo y deja de procesar.',
            'Síntoma 3: después de reiniciar el worker, los pedidos nuevos vuelven a procesarse, pero los del intervalo quedan pendientes para siempre.',
          ],
        },
      ],
    },
    {
      title: 'Cómo se entrega realmente el NOTIFY',
      blocks: [
        {
          type: 'paragraph',
          value:
            'NOTIFY no es una cola de mensajes. Cuando una transacción ejecuta NOTIFY, la notificación queda guardada hasta el COMMIT; en ese momento entra en una cola en memoria compartida y se entrega a todas las sesiones que tienen LISTEN activo en ese canal. No hay confirmación, no hay reintento y no hay historial: una sesión que ejecute LISTEN un segundo después nunca verá lo que se publicó antes.',
        },
        {
          type: 'table',
          columns: ['Situación', 'Qué pasa con la notificación'],
          rows: [
            ['NOTIFY dentro de una transacción que hace COMMIT', 'Se entrega después del COMMIT, cuando el dato ya es visible'],
            ['NOTIFY dentro de una transacción que hace ROLLBACK', 'Se descarta, nadie la recibe'],
            ['NOTIFY por otra conexión, antes del COMMIT de quien escribe', 'Se entrega en el acto, antes de que el dato exista para los demás'],
            ['Oyente desconectado en el momento del COMMIT', 'Perdida para ese oyente, sin ningún registro'],
            ['Oyente en medio de una transacción propia', 'Queda retenida y llega solo cuando su transacción termina'],
            ['Mismo canal y mismo payload repetidos en la misma transacción', 'Se agrupan en una sola notificación'],
            ['Payload de más de 8.000 bytes', 'El NOTIFY falla con error'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Dos filas de esa tabla pesan más en producción. La entrega llega solo a quien escucha en el instante del COMMIT, así que cualquier intervalo sin conexión se convierte en eventos perdidos. Y la cola en memoria es compartida por todo el clúster: solo avanza cuando todos los oyentes consumieron, así que un oyente atrapado en una transacción larga retiene la cola de todos. La cola tiene 8 GB; cuando se llena, la que falla es la transacción que intenta hacer NOTIFY, en el COMMIT, con el error too many notifications in the NOTIFY queue. Es decir, un worker trabado puede romper la escritura de pedidos de la API.',
        },
      ],
    },
    {
      title: 'Notificación fuera de la transacción: el evento que llega antes que el dato',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El 0,4% de pedidos sin factura venía de la carrera entre el aviso y el COMMIT. El pg_notify por el pool corría en una conexión sin transacción abierta, así que se confirmaba y se entregaba en el acto. El worker lo recibía en menos de un milisegundo y consultaba el pedido. La mayoría de las veces el COMMIT de la API ya había ocurrido; en los picos, con fsync más lento y el pool disputado, no, y la consulta volvía vacía. El mismo patrón aparece cuando la aplicación publica la notificación después del COMMIT pero el proceso cae entre una cosa y otra: entonces el dato existe y el aviso nunca sale.',
        },
        {
          type: 'paragraph',
          value:
            'La corrección es poner el NOTIFY dentro de la misma transacción que guarda el dato. Puede ir por la propia conexión de la transacción (client.query en lugar de pool.query) o, para que ningún camino de escritura lo olvide, por un trigger. Como el worker va a leer la tabla de todos modos, el payload no necesita llevar nada.',
        },
        { type: 'code', value: publisherCode(comments.es) },
        {
          type: 'paragraph',
          value:
            'El trigger por sentencia, y no por fila, evita otro problema: una importación masiva con FOR EACH ROW y el id en el payload genera una notificación por fila, todas distintas, y ninguna se agrupa. Con payload vacío y FOR EACH STATEMENT, cada transacción genera un único aviso. La columna nota_emitida_em con el índice parcial convierte la tabla de pedidos en la cola de verdad: lo pendiente es lo que tiene la columna nula.',
        },
      ],
    },
    {
      title: 'Conexión del pool y PgBouncer: dónde desaparece el LISTEN',
      blocks: [
        {
          type: 'paragraph',
          value:
            'LISTEN es estado de la sesión, igual que un SET o un lock de sesión. Vale mientras exista esa conexión del servidor y solo para ella. Todo lo que cambia, cierra o comparte la conexión hace desaparecer el LISTEN sin error.',
        },
        {
          type: 'list',
          items: [
            'pool.query(\'LISTEN canal\'): el comando corre en una conexión cualquiera, que vuelve al pool; nadie registra el handler de notification en ella, y el idleTimeoutMillis la cierra después de unos segundos.',
            'pool.connect seguido de client.release(): el handler sigue registrado, pero la conexión ahora atiende otras rutas y se cerrará cuando quede ociosa.',
            'PgBouncer en modo transacción: LISTEN no está soportado, porque cada transacción puede caer en una conexión distinta del servidor. El oyente necesita una conexión directa o un pool en modo sesión.',
            'idle_session_timeout configurado para el rol de la aplicación: el oyente pasa la mayor parte del tiempo ocioso y el servidor lo termina.',
            'Failover, reinicio de la base, cambio de IP o timeouts de NAT y de balanceador: la conexión muere, a veces sin que el cliente reciba ningún paquete que lo avise.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El último caso es el del sábado. Cuando el servidor desaparece de forma abrupta, el cliente no recibe FIN ni RST; el socket sigue abierto de su lado, y una conexión que solo espera notificaciones nunca envía nada, así que nunca descubre que está hablando sola. El keepalive de TCP ayuda, pero los intervalos por defecto del sistema operativo llegan a dos horas. Para diagnosticar, tres consultas responden casi todo: quién está escuchando, si la cola está creciendo y, la más importante, cuánto trabajo está detenido.',
        },
        { type: 'code', value: diagnosticCode(comments.es) },
      ],
    },
    {
      title: 'El worker que se reconecta y recupera lo que perdió',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El cambio de modelo es tratar el NOTIFY como timbre, no como entrega. La notificación dice que hay algo nuevo; qué hacer está en la tabla. Así, perder un aviso deja de ser perder un evento: el próximo aviso, la reconexión o el barrido periódico encuentran el pedido pendiente.',
        },
        {
          type: 'ordered',
          items: [
            'Conecta el oyente directo a Postgres, con keepalive y un application_name que lo identifique en pg_stat_activity.',
            'Maneja error y end con la misma función de reconexión, con espera exponencial limitada.',
            'Después de cada conexión, ejecuta LISTEN y solo entonces drena la tabla. En ese orden, cualquier pedido guardado antes del LISTEN aparece en el drenaje, y cualquiera guardado después genera aviso.',
            'Envía un SELECT 1 periódico con plazo corto para detectar la conexión medio abierta en segundos, no en horas.',
            'Mantén un barrido periódico independiente del canal, como red de seguridad.',
            'Procesa en lotes con FOR UPDATE SKIP LOCKED y haz idempotente el efecto externo.',
          ],
        },
        { type: 'code', value: workerCode(comments.es) },
        {
          type: 'diagram',
          value: `02:09:58  API     INSERT 81204 + NOTIFY  -> el worker lo recibe y emite la factura
02:10:03  base    failover: el primario antiguo desaparece sin cerrar el TCP
02:10:05  API     INSERT 81205 + NOTIFY  -> nadie escucha en el primario nuevo
02:10:15  worker  heartbeat: SELECT 1 enviado, sin respuesta
02:10:20  worker  plazo de 5 s vencido -> reconectar()
02:10:21  worker  connect -> LISTEN pedido_criado -> drenar()
02:10:21  worker  nota_emitida_em IS NULL -> encuentra 81205 a 81212
02:10:51  worker  barrido de 30 s: nada pendiente`,
        },
        {
          type: 'paragraph',
          value:
            'Con este diseño, el mismo failover que dejó 1.900 pedidos detenidos se convierte en una pausa de unos 20 segundos, sin ningún pedido perdido. El barrido de 30 segundos garantiza un retraso máximo predecible aunque todo lo demás falle, y el canal mantiene la latencia baja en el caso común.',
        },
      ],
    },
    {
      title: 'Cola llena, varios oyentes y qué monitorear',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Incluso con un worker robusto, algunos límites del mecanismo siguen vigentes y merecen una alerta antes de convertirse en incidente.',
        },
        {
          type: 'table',
          columns: ['Falla', 'Síntoma', 'Causa', 'Corrección'],
          rows: [
            ['Evento antes que el dato', 'Fracción pequeña de ítems nunca procesados', 'NOTIFY por otra conexión, fuera de la transacción', 'NOTIFY en la misma transacción o por trigger'],
            ['LISTEN que desaparece', 'El worker se detiene después de segundos o minutos', 'LISTEN en una conexión del pool o detrás de PgBouncer en modo transacción', 'Conexión dedicada y directa para escuchar'],
            ['Worker sordo', 'Proceso vivo, nada procesado después de un failover', 'Conexión medio abierta, sin keepalive ni heartbeat', 'Keepalive, SELECT 1 con plazo y reconexión'],
            ['Hueco en la reconexión', 'Ítems del intervalo pendientes para siempre', 'Solo el aviso dispara el procesamiento', 'LISTEN, después drenaje de la tabla, más barrido periódico'],
            ['Cola de notificaciones llena', 'El COMMIT de la API falla con too many notifications', 'Oyente atrapado en una transacción larga', 'Alerta en pg_notification_queue_usage y oyente sin transacción abierta'],
            ['Aviso duplicado', 'El mismo ítem procesado dos veces', 'Todos los oyentes reciben todas las notificaciones', 'SKIP LOCKED en el drenaje y efecto idempotente'],
          ],
        },
        {
          type: 'list',
          items: [
            'Alerta por el resultado, no por el canal: cantidad y antigüedad de los ítems pendientes en la tabla.',
            'Alerta cuando pg_notification_queue_usage supere 0,1 e investiga qué sesión retiene la cola.',
            'Verifica en pg_stat_activity que exista exactamente la cantidad esperada de oyentes, por application_name.',
            'Incluye el failover en los ensayos: tira el primario en staging y mide cuánto tarda el worker en volver.',
            'Mantén el payload pequeño o vacío; el dato real queda en la tabla.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué no poner el pedido entero en el payload y evitar la consulta?',
      answer:
        'Porque el payload solo ayuda cuando la notificación llega, y el problema está justamente en las que no llegan. Además tiene un límite de 8.000 bytes, puede llevar una versión del dato que cambió justo después y ocupa la cola compartida del clúster. Usa el payload como mucho como pista, por ejemplo un id para priorizar, y mantén la tabla como fuente de verdad.',
    },
    {
      question: '¿LISTEN/NOTIFY reemplaza una cola como RabbitMQ, SQS o Redis Streams?',
      answer:
        'Como timbre para una cola guardada en una tabla, sí, y evita operar un sistema más mientras el volumen es moderado. Como cola en sí, no: no hay confirmación, reintento ni retención. También conviene saber que los COMMIT de transacciones que ejecutaron NOTIFY se serializan con un lock global, así que con miles de commits notificando por segundo el mecanismo se vuelve un cuello de botella. En ese punto, o cuando otros sistemas necesitan consumir los eventos, un outbox publicando en un broker es el camino.',
    },
    {
      question: 'Si corro tres workers escuchando el mismo canal, ¿procesan el mismo pedido?',
      answer:
        'Todos reciben todas las notificaciones, porque NOTIFY es difusión y no reparto de trabajo entre consumidores. Lo que evita el procesamiento duplicado es el drenaje: con FOR UPDATE SKIP LOCKED cada worker toma filas distintas, y el UPDATE en la misma transacción saca el pedido de la cola. Como una falla después de emitir la factura y antes del COMMIT hace que el lote se repita, el emisor debe ser idempotente por el id del pedido.',
    },
  ],
  conclusion: {
    title: 'El aviso despierta, la tabla decide',
    description:
      'LISTEN/NOTIFY entrega con el mejor esfuerzo, solo a quien escucha en el instante del COMMIT, y el LISTEN vive en la sesión: desaparece con la conexión del pool, no funciona a través de PgBouncer en modo transacción y muere en silencio en un failover. Los eventos perdidos vienen de tratar ese aviso como cola. Publica el NOTIFY dentro de la transacción que escribe, escucha por una conexión dedicada con keepalive y heartbeat, ejecuta LISTEN antes de drenar la tabla en cada reconexión y mantén un barrido periódico. Con la tabla como fuente de verdad, perder una notificación cuesta segundos, no pedidos.',
    cta: '¿Quieres revisar workers, colas y eventos que dependen de Postgres antes del próximo failover?',
  },
  related: [
    {
      label: 'Outbox transaccional: guardar en la base de datos y publicar el evento sin perder ninguno de los dos',
      to: '/blog/outbox-transacional-gravar-no-banco-e-publicar-o-evento-sem-perder-nenhum-dos-dois',
    },
    {
      label: 'El advisory lock que queda atrapado en el pool: pg_advisory_lock de sesión, PgBouncer y el job que nunca más se ejecuta',
      to: '/blog/advisory-lock-que-fica-preso-no-pool-pg-advisory-lock-de-sessao-pgbouncer-e-o-job-que-nunca-mais-roda',
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
