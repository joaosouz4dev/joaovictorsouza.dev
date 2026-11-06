// Conteudo do artigo: linha quente que serializa a aplicacao. Por que um UPDATE na mesma linha
// limita a vazao de todo o sistema ao inverso do tempo em que o lock fica preso, como provar a
// disputa com pg_stat_activity, pg_stat_statements e log_lock_waits, encurtar a posse do lock,
// dividir contadores em fatias e trocar o saldo disputado por livro-razao com consolidacao.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const diagnosticoCode = `-- 1. Quem espera agora e por quem. Dezenas de sessoes presas atras do mesmo pid,
--    todas executando o mesmo UPDATE, sao o retrato de uma linha quente.
SELECT pg_blocking_pids(a.pid) AS bloqueado_por,
       a.wait_event_type,
       a.wait_event,
       count(*) AS sessoes,
       left(a.query, 70) AS consulta
  FROM pg_stat_activity a
 WHERE a.wait_event_type = 'Lock'
 GROUP BY 1, 2, 3, 5
 ORDER BY sessoes DESC;

-- 2. UPDATE com minimo baixo e media alta: o tempo e espera, nao trabalho.
SELECT left(query, 70) AS consulta,
       calls,
       round(min_exec_time::numeric, 2)  AS min_ms,
       round(mean_exec_time::numeric, 2) AS media_ms,
       round(max_exec_time::numeric, 0)  AS max_ms
  FROM pg_stat_statements
 WHERE query ILIKE 'update%'
 ORDER BY total_exec_time DESC
 LIMIT 5;

-- 3. Atualizacoes por linha viva: milhoes de versoes para meia duzia de linhas.
SELECT relname,
       n_live_tup,
       n_tup_upd,
       n_tup_hot_upd,
       round(n_tup_upd::numeric / nullif(n_live_tup, 0), 0) AS updates_por_linha
  FROM pg_stat_user_tables
 WHERE relname IN ('contas', 'metricas_diarias');

-- 4. O proprio Postgres aponta a tupla disputada no log
--    (esperas acima de deadlock_timeout, 1 s por padrao).
ALTER SYSTEM SET log_lock_waits = on;
SELECT pg_reload_conf();
-- LOG:      process 48211 still waiting for ShareLock on transaction 9182231 after 1000.112 ms
-- CONTEXT:  while updating tuple (0,7) in relation "contas"`;

const encurtarCode = `// Antes: o credito da comissao era o segundo comando da transacao, e o lock da linha
// da conta da plataforma ficava preso durante todos os comandos seguintes e o COMMIT.
// Depois: tudo o que nao disputa linha vem primeiro; as linhas quentes sao tocadas
// imediatamente antes do COMMIT, no menor intervalo possivel.
const CONTA_PLATAFORMA = 1;

export async function fecharPedido(pool, pedido) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'INSERT INTO pedidos (id, loja_id, valor_centavos) VALUES ($1, $2, $3)',
      [pedido.id, pedido.lojaId, pedido.valorCentavos],
    );
    await client.query(
      'INSERT INTO itens_pedido (pedido_id, sku, quantidade) ' +
        'SELECT $1, i.sku, i.quantidade ' +
        'FROM jsonb_to_recordset($2::jsonb) AS i(sku text, quantidade int)',
      [pedido.id, JSON.stringify(pedido.itens)],
    );
    await client.query(
      'INSERT INTO pagamentos (pedido_id, gateway_id, valor_centavos) VALUES ($1, $2, $3)',
      [pedido.id, pedido.gatewayId, pedido.valorCentavos],
    );

    // Linhas quentes por ultimo: o lock vive so ate o COMMIT logo abaixo.
    await client.query(
      'UPDATE contas SET saldo_centavos = saldo_centavos + $2 WHERE id = $1',
      [CONTA_PLATAFORMA, pedido.comissaoCentavos],
    );
    await client.query(
      "UPDATE metricas_diarias SET valor = valor + 1 WHERE metrica = 'pedidos' AND dia = current_date",
    );

    await client.query('COMMIT');
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}`;

const fatiasCode = `-- Um contador vira N linhas; cada escrita toca so uma delas.
CREATE TABLE metrica_fatia (
  metrica text     NOT NULL,
  dia     date     NOT NULL,
  fatia   smallint NOT NULL,
  valor   bigint   NOT NULL DEFAULT 0,
  PRIMARY KEY (metrica, dia, fatia)
);

-- Incremento: a fatia ($3, entre 0 e 15) e sorteada pela aplicacao.
-- O upsert cria a fatia do dia na primeira escrita, sem job de virada.
INSERT INTO metrica_fatia (metrica, dia, fatia, valor)
VALUES ($1, current_date, $3, $2)
ON CONFLICT (metrica, dia, fatia)
DO UPDATE SET valor = metrica_fatia.valor + EXCLUDED.valor;

-- Leitura: a soma das fatias, no maximo 16 linhas pela chave primaria.
SELECT coalesce(sum(valor), 0) AS total
  FROM metrica_fatia
 WHERE metrica = 'pedidos'
   AND dia = current_date;

-- Armadilha: random() no WHERE e avaliado uma vez por linha, nao uma vez por comando.
-- Este UPDATE pode incrementar zero, uma ou varias fatias.
UPDATE metrica_fatia
   SET valor = valor + 1
 WHERE metrica = 'pedidos'
   AND dia = current_date
   AND fatia = floor(random() * 16)::int;`;

const livroRazaoCode = `-- Saldo consolidado: uma linha por conta, tocada so pelo consolidador e por debitos.
CREATE TABLE conta_saldo (
  conta_id       bigint PRIMARY KEY,
  saldo_centavos bigint NOT NULL DEFAULT 0,
  consolidado_em timestamptz NOT NULL DEFAULT now()
);

-- Historico permanente e append-only: auditoria e conciliacao leem daqui.
CREATE TABLE lancamento (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conta_id       bigint NOT NULL,
  valor_centavos bigint NOT NULL,
  referencia     text   NOT NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conta_id, referencia)
);

-- O que ainda nao entrou no saldo consolidado. Cada linha vive poucos segundos.
CREATE TABLE lancamento_pendente (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lancamento_id  bigint NOT NULL,
  conta_id       bigint NOT NULL,
  valor_centavos bigint NOT NULL
);
CREATE INDEX lancamento_pendente_conta ON lancamento_pendente (conta_id, id);

-- Tabela pequena com muita insercao e exclusao: vacuum por volume absoluto.
ALTER TABLE lancamento_pendente SET (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold = 5000
);

-- Saldo atual = consolidado + pendentes, lidos no mesmo snapshot.
SELECT s.saldo_centavos
       + coalesce((SELECT sum(p.valor_centavos)
                     FROM lancamento_pendente p
                    WHERE p.conta_id = s.conta_id), 0) AS saldo_centavos
  FROM conta_saldo s
 WHERE s.conta_id = $1;

-- Consolidacao em lotes: apaga pendentes e soma no saldo na mesma transacao.
WITH lote AS (
  DELETE FROM lancamento_pendente
   WHERE id IN (
     SELECT id
       FROM lancamento_pendente
      WHERE conta_id = $1
      ORDER BY id
      LIMIT 5000
      FOR UPDATE SKIP LOCKED
   )
  RETURNING valor_centavos
), soma AS (
  SELECT count(*) AS linhas, coalesce(sum(valor_centavos), 0) AS total
    FROM lote
)
UPDATE conta_saldo s
   SET saldo_centavos = s.saldo_centavos + soma.total,
       consolidado_em = now()
  FROM soma
 WHERE s.conta_id = $1
   AND soma.linhas > 0
RETURNING soma.linhas;`;

const livroRazaoNodeCode = `const LOTE = 5000;

const LANCAR_SQL = [
  'WITH novo AS (',
  '  INSERT INTO lancamento (conta_id, valor_centavos, referencia)',
  '  VALUES ($1, $2, $3)',
  '  ON CONFLICT (conta_id, referencia) DO NOTHING',
  '  RETURNING id, conta_id, valor_centavos',
  ')',
  'INSERT INTO lancamento_pendente (lancamento_id, conta_id, valor_centavos)',
  'SELECT id, conta_id, valor_centavos FROM novo',
].join('\\n');

const SALDO_SQL = [
  'SELECT s.saldo_centavos + coalesce((',
  '  SELECT sum(p.valor_centavos) FROM lancamento_pendente p',
  '   WHERE p.conta_id = s.conta_id), 0) AS saldo_centavos',
  '  FROM conta_saldo s WHERE s.conta_id = $1',
].join('\\n');

const CONSOLIDAR_SQL = [
  'WITH lote AS (',
  '  DELETE FROM lancamento_pendente WHERE id IN (',
  '    SELECT id FROM lancamento_pendente WHERE conta_id = $1',
  '     ORDER BY id LIMIT ' + LOTE + ' FOR UPDATE SKIP LOCKED)',
  '  RETURNING valor_centavos',
  '), soma AS (',
  '  SELECT count(*) AS linhas, coalesce(sum(valor_centavos), 0) AS total FROM lote',
  ')',
  'UPDATE conta_saldo s SET saldo_centavos = s.saldo_centavos + soma.total,',
  '       consolidado_em = now()',
  '  FROM soma WHERE s.conta_id = $1 AND soma.linhas > 0',
  'RETURNING soma.linhas',
].join('\\n');

export class SaldoInsuficiente extends Error {}

// Credito: so insere. Roda dentro da transacao do pedido e nao disputa nenhuma linha.
// A referencia (ex.: "pedido:8812:comissao") torna a repeticao inofensiva.
export async function creditar(client, contaId, valorCentavos, referencia) {
  await client.query(LANCAR_SQL, [contaId, valorCentavos, referencia]);
}

// Debito: raro (repasse, estorno, saque). Trava so a linha consolidada da conta,
// e o saldo e lido em um comando seguinte, com snapshot novo, depois do lock.
export async function debitar(pool, contaId, valorCentavos, referencia) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM conta_saldo WHERE conta_id = $1 FOR UPDATE', [contaId]);
    const { rows } = await client.query(SALDO_SQL, [contaId]);
    if (Number(rows[0].saldo_centavos) < valorCentavos) {
      throw new SaldoInsuficiente('saldo insuficiente na conta ' + contaId);
    }
    await client.query(LANCAR_SQL, [contaId, -valorCentavos, referencia]);
    await client.query('COMMIT');
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

// Aplica os pendentes em lotes; cada lote e uma transacao curta e independente.
export async function consolidar(pool, contaId) {
  let aplicadas = 0;
  for (;;) {
    const { rows } = await pool.query(CONSOLIDAR_SQL, [contaId]);
    const linhas = rows.length ? Number(rows[0].linhas) : 0;
    aplicadas += linhas;
    if (linhas < LOTE) return aplicadas;
  }
}

export function iniciarConsolidador(pool, contaId, intervaloMs = 500) {
  let parado = false;
  const ciclo = async () => {
    if (parado) return;
    try {
      await consolidar(pool, contaId);
    } catch (erro) {
      console.error('consolidacao da conta ' + contaId + ' falhou', erro);
    }
    setTimeout(ciclo, intervaloMs);
  };
  ciclo();
  return () => {
    parado = true;
  };
}`;

const diagramaPt = `Checkout (1.600 por segundo)                 Repasse / estorno (poucos por hora)
        |                                                  |
        v                                                  v
INSERT pedidos, itens, pagamentos              SELECT ... FROM conta_saldo FOR UPDATE
        |                                                  |
        v                                                  v
INSERT lancamento + lancamento_pendente        saldo = consolidado + soma dos pendentes
  (sem disputa: cada pedido cria a sua linha)              |
        |                                       suficiente? -- não --> recusa
        v                                                  | sim
upsert em metrica_fatia (1 de 16 fatias)                   v
        |                                       INSERT lançamento negativo
        v                                                  |
      COMMIT                                             COMMIT

Consolidador, a cada 500 ms:
  DELETE até 5.000 pendentes + UPDATE conta_saldo, na mesma transação`;

const diagramaEn = `Checkout (1,600 per second)                  Payout / refund (a few per hour)
        |                                                  |
        v                                                  v
INSERT orders, items, payments                 SELECT ... FROM conta_saldo FOR UPDATE
        |                                                  |
        v                                                  v
INSERT lancamento + lancamento_pendente        balance = consolidated + sum of pending
  (no contention: each order creates its row)              |
        |                                       enough? -- no --> reject
        v                                                  | yes
upsert into metrica_fatia (1 of 16 slices)                 v
        |                                       INSERT negative entry
        v                                                  |
      COMMIT                                             COMMIT

Consolidator, every 500 ms:
  DELETE up to 5,000 pending + UPDATE conta_saldo, in the same transaction`;

const diagramaEs = `Checkout (1.600 por segundo)                 Liquidación / reembolso (pocos por hora)
        |                                                  |
        v                                                  v
INSERT pedidos, ítems, pagos                   SELECT ... FROM conta_saldo FOR UPDATE
        |                                                  |
        v                                                  v
INSERT lancamento + lancamento_pendente        saldo = consolidado + suma de pendientes
  (sin disputa: cada pedido crea su fila)                  |
        |                                       ¿alcanza? -- no --> rechaza
        v                                                  | sí
upsert en metrica_fatia (1 de 16 porciones)                v
        |                                       INSERT asiento negativo
        v                                                  |
      COMMIT                                             COMMIT

Consolidador, cada 500 ms:
  DELETE hasta 5.000 pendientes + UPDATE conta_saldo, en la misma transacción`;

const pt = {
  intro:
    'Às 21h da abertura de uma campanha de Black Friday, o checkout de um marketplace com 3.100 lojistas parou de crescer em 380 pedidos por segundo. O p99 do fechamento de pedido saiu de 220 ms para 11 segundos, o pool de conexões esgotou e a fila de requisições cresceu, mas a CPU do banco estava em 34% e as instâncias da aplicação tinham folga. Nenhuma consulta lenta nova, nenhum deploy. Duas linhas explicavam tudo: a conta da plataforma, que recebia a comissão de cada venda, e o contador de pedidos do dia que alimentava o painel comercial. Todas as transações de checkout atualizavam essas mesmas duas linhas, e o banco, corretamente, deixava uma de cada vez. Este artigo mostra por que uma linha quente limita a vazão do sistema inteiro ao inverso do tempo em que o lock fica preso, como provar a disputa com dados do próprio Postgres e as três mudanças que liberaram o checkout: encurtar a posse do lock, dividir contadores em fatias e trocar o saldo disputado por um livro-razão com consolidação.',
  sections: [
    {
      title: 'A fila que não aparece na CPU',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um UPDATE em uma linha do PostgreSQL trava aquela linha até o fim da transação, não até o fim do comando. Quem chega depois para atualizar a mesma linha espera o COMMIT ou o ROLLBACK de quem chegou antes. Isso não é defeito: é o que impede dois créditos simultâneos de lerem o mesmo saldo e um deles sumir. A consequência é aritmética. Se cada transação segura o lock da linha por T milissegundos, aquela linha aceita no máximo 1.000 / T atualizações por segundo, não importa quantos núcleos o banco tenha nem quantas instâncias a aplicação rode.',
        },
        {
          type: 'paragraph',
          value:
            'No checkout do marketplace, o crédito na conta da plataforma era o segundo comando de uma transação com sete. Depois dele vinham a gravação dos itens, do pagamento, da reserva de estoque, do contador do painel, uma consulta de frete já calculado e o COMMIT, que espera o WAL ser gravado em disco. Somando as idas e voltas pela rede e o fsync do commit, o lock da linha ficava preso por cerca de 2,6 ms. 1.000 / 2,6 dá 385 transações por segundo, exatamente o teto observado.',
        },
        {
          type: 'list',
          items: [
            'A CPU do banco fica baixa porque sessões esperando lock não consomem CPU; elas só ocupam conexões.',
            'O pool esgota porque cada conexão fica presa na fila da linha, e as requisições novas passam a esperar conexão antes de esperar o lock.',
            'Aumentar instâncias da aplicação piora: mais transações concorrentes para a mesma linha, fila maior, mesma vazão.',
            'Aumentar a máquina do banco não muda nada: o limite é o tempo de posse do lock, não o hardware.',
            'Cada UPDATE cria uma nova versão da linha. Mil atualizações por segundo na mesma linha enchem a página de versões mortas, e as leituras dessa linha percorrem a cadeia até achar a versão visível.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O padrão se repete em qualquer sistema que concentra escrita em um agregado único: saldo de uma conta da plataforma, estoque de um produto em promoção, contador de ingressos vendidos de um show, sequência de numeração de notas fiscais mantida em tabela, total de mensagens enviadas no dia por cliente. Em volume baixo ninguém percebe. No pico, a linha vira um semáforo global da aplicação.',
        },
      ],
    },
    {
      title: 'Como provar que o gargalo é uma linha, não o banco',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de mudar modelo de dados, é preciso evidência de que o tempo está indo para espera de lock em linhas específicas. Quatro leituras resolvem: quem espera por quem neste instante, quais UPDATEs têm tempo mínimo baixo e média alta, quantas atualizações cada linha viva recebeu e o que o próprio Postgres registra no log quando uma espera passa de um segundo.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'paragraph',
          value:
            'Na noite do incidente, a primeira consulta mostrou 212 sessões com wait_event_type igual a Lock, quase todas presas atrás do mesmo pid e executando o UPDATE da conta da plataforma. A segunda mostrou esse UPDATE com mínimo de 0,04 ms e média de 1.840 ms: o trabalho levava microssegundos, o resto era fila. Na terceira, a tabela contas tinha 41 mil linhas vivas e 96 milhões de atualizações acumuladas, quase todas na mesma linha. E o log, com log_lock_waits ligado, apontou a tupla exata: a mesma posição na mesma relação, milhares de vezes por minuto.',
        },
        {
          type: 'paragraph',
          value:
            'Um detalhe ajuda a ler a fila. A primeira sessão que espera fica com o lock da tupla e aguarda o fim da transação de quem está escrevendo (wait_event transactionid); as demais esperam pela tupla (wait_event tuple). Uma pilha de sessões em tuple, todas com a mesma consulta, é a assinatura de linha quente. Espera espalhada por transactionid em consultas diferentes costuma ser outro problema, como transações longas ou ordem de lock inconsistente.',
        },
      ],
    },
    {
      title: 'Primeiro passo: encurtar o tempo em que o lock fica preso',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Como o teto é 1.000 / T, a mudança mais barata é reduzir T sem mexer no modelo. O lock nasce no UPDATE e morre no COMMIT, então tudo o que acontece entre os dois entra na conta. Mover as atualizações das linhas quentes para o fim da transação, imediatamente antes do COMMIT, tira do intervalo todos os comandos que não disputam nada.',
        },
        {
          type: 'code',
          value: encurtarCode,
        },
        {
          type: 'paragraph',
          value:
            'Com essa reordenação, o lock passou a durar uma ida e volta do UPDATE mais o commit, cerca de 1,4 ms, e o teto subiu para pouco mais de 700 pedidos por segundo. Dobrou a vazão com uma mudança de ordem, mas ainda ficou abaixo dos 1.600 por segundo previstos para o pico. A tabela abaixo resume o que encurta o lock e o que parece encurtar, mas cobra caro.',
        },
        {
          type: 'table',
          columns: ['Ação', 'Efeito no tempo de lock', 'Custo ou risco'],
          rows: [
            ['Atualizar linhas quentes por último', 'Remove do intervalo todos os comandos anteriores', 'Nenhum; exige revisar a ordem em todos os fluxos que tocam a linha'],
            ['Tirar chamadas de rede externas da transação', 'Remove dezenas ou centenas de ms', 'Exige outbox ou etapa posterior para efeitos externos'],
            ['Juntar comandos em um só (CTE ou função)', 'Reduz idas e voltas pela rede', 'Lógica mais difícil de ler e testar'],
            ['Aplicação e banco na mesma zona', 'Reduz a latência de cada ida e volta', 'Depende da infraestrutura'],
            ['synchronous_commit = off na transação', 'Remove a espera do fsync do commit', 'Pode perder as últimas transações confirmadas se o servidor cair; inaceitável para dinheiro'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Atenção à ordem quando duas linhas quentes são atualizadas na mesma transação: todos os fluxos precisam tocá-las na mesma sequência, ou a reordenação troca fila por deadlock. Aqui, conta da plataforma antes do contador em todos os caminhos de código.',
        },
      ],
    },
    {
      title: 'Contadores: dividir a linha em fatias',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O contador de pedidos do dia não precisa de exatidão no instante da escrita, só na leitura, e soma é comutativa. Isso permite trocar uma linha por N linhas: cada escrita sorteia uma fatia e incrementa só ela, e a leitura soma todas. Com 16 fatias, 16 transações podem incrementar o contador ao mesmo tempo, e o teto efetivo multiplica por um fator próximo de 16.',
        },
        {
          type: 'code',
          value: fatiasCode,
        },
        {
          type: 'paragraph',
          value:
            'O último comando do bloco é a armadilha que mais aparece nessa técnica. Como random() é uma função volátil, o Postgres a avalia de novo para cada linha que examina, e não uma vez por comando. O UPDATE compara cada fatia com um sorteio diferente e pode atualizar nenhuma, uma ou várias, e o contador passa a errar de forma silenciosa. A fatia precisa vir pronta da aplicação, como parâmetro.',
        },
        {
          type: 'list',
          items: [
            'Quantidade de fatias: vazão de pico vezes o tempo de lock vezes uma folga de 2 a 4. Com 1.600 por segundo e 1,4 ms, dá cerca de 4,5 escritas simultâneas; 16 fatias deixam folga para crescer.',
            'Mais fatias não é de graça: a leitura soma mais linhas e as colisões caem cada vez menos a partir de certo ponto.',
            'Sorteio aleatório distribui bem com muitos clientes; usar o pid da conexão concentra escrita quando o pool tem poucas conexões ativas.',
            'Fatias funcionam para somas e contagens. Não funcionam para valores que precisam de verificação no momento da escrita, como saldo que não pode ficar negativo.',
          ],
        },
      ],
    },
    {
      title: 'Saldos: livro-razão com consolidação em vez de UPDATE disputado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A conta da plataforma tem uma exigência que o contador não tem: débitos, como repasses e estornos, só podem acontecer se houver saldo. Fatiar o saldo obrigaria cada débito a travar todas as fatias. A alternativa que resolve a escrita e ainda entrega histórico para auditoria é parar de atualizar o saldo a cada venda. Cada crédito vira um lançamento inserido, que nunca disputa linha com outro, e um processo consolidador aplica os lançamentos pendentes no saldo em lotes.',
        },
        {
          type: 'code',
          value: livroRazaoCode,
        },
        {
          type: 'paragraph',
          value:
            'Dois detalhes sustentam a correção. Primeiro, o saldo atual é o consolidado mais a soma dos pendentes, lidos em um único comando: os dois valores vêm do mesmo snapshot, e como o consolidador apaga pendentes e soma no saldo na mesma transação, a leitura nunca conta um lançamento duas vezes nem deixa de contá-lo. Segundo, os pendentes ficam em uma tabela separada e são apagados ao consolidar. A versão que guarda só o último id consolidado parece mais simples e perde dinheiro: ids de identidade são distribuídos na inserção, não no commit, então um lançamento com id menor pode ficar visível depois que o consolidador já passou por ele.',
        },
        {
          type: 'code',
          value: livroRazaoNodeCode,
        },
        {
          type: 'paragraph',
          value:
            'O débito é o único caminho que ainda trava uma linha, e é raro: algumas dezenas por hora contra 1.600 créditos por segundo. Ele trava a linha consolidada, lê o saldo em um comando seguinte, que no READ COMMITTED enxerga tudo o que foi confirmado até ali, e só então insere o lançamento negativo. Dois débitos simultâneos ficam em fila entre si, que é o comportamento desejado. Créditos continuam entrando sem esperar, e como só aumentam o saldo, não invalidam a verificação de quem está debitando.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
      ],
    },
    {
      title: 'Como escolher a técnica e o que mudou no checkout',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Não existe uma solução única para linha quente; existe a combinação certa para o tipo de valor. A pergunta que decide é: o valor precisa ser verificado no momento da escrita ou só precisa estar certo quando alguém lê?',
        },
        {
          type: 'table',
          columns: ['Técnica', 'Disputa na escrita', 'Custo da leitura', 'Recusa débito sem saldo?', 'Quando usar'],
          rows: [
            ['Encurtar o lock', 'Reduz, não elimina', '1 linha', 'Sim', 'Sempre, como primeiro passo'],
            ['Fatias', 'Dividida por N', 'Soma de N linhas', 'Só travando todas as fatias', 'Contadores e somas sem verificação'],
            ['Livro-razão com consolidação', 'Nenhuma nos créditos', 'Consolidado mais pendentes', 'Sim, travando a conta só no débito', 'Saldos com histórico e débitos raros'],
            ['Contador em memória ou Redis com descarga periódica', 'Nenhuma no banco', 'Atrasada e sem garantia', 'Não', 'Métricas que toleram perda'],
            ['Fila com um único escritor', 'Nenhuma no banco, serial na fila', 'Atrasada', 'Sim, no consumidor', 'Quando o resultado pode ser assíncrono'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'No marketplace, o contador do painel foi para 16 fatias, a comissão da plataforma passou a ser lançamento com consolidação a cada 500 ms e as contas dos lojistas, que recebem poucas escritas por segundo cada uma, continuaram como estavam. Mexer só no que a medição apontou como quente manteve a mudança pequena e fácil de revisar. O ensaio de carga com o volume previsto para o pico e a primeira noite de campanha seguinte confirmaram os números abaixo.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Antes', 'Depois'],
          rows: [
            ['Vazão máxima do checkout', '380 pedidos/s', '1.600 pedidos/s sustentados no ensaio'],
            ['p99 do fechamento de pedido no pico', '11 s', '240 ms'],
            ['Sessões esperando lock no pico', '212', '3'],
            ['Tempo médio do UPDATE da conta da plataforma', '1.840 ms', 'Substituído por INSERT de 0,3 ms'],
            ['Atraso máximo do saldo consolidado', '0', '1,2 s (o saldo lido inclui os pendentes)'],
            ['Diferença na conciliação mensal', '-', 'Zero centavos'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Usar isolamento SERIALIZABLE ou SELECT FOR UPDATE resolve a disputa?',
      answer:
        'Não. Os dois servem para manter a correção, não para aumentar a vazão. SELECT FOR UPDATE antes do UPDATE só antecipa o lock e aumenta o tempo em que ele fica preso. SERIALIZABLE ainda serializa as escritas na mesma linha e acrescenta falhas de serialização que obrigam a aplicação a repetir a transação inteira, o que no pico gera mais carga justamente onde já falta capacidade. A saída é reduzir o tempo de lock ou deixar de escrever na mesma linha.',
    },
    {
      question: 'Por que não manter o saldo no Redis com INCRBY e gravar no banco depois?',
      answer:
        'Porque o saldo passa a ter duas fontes da verdade e nenhuma garantia de que concordam. Se o processo que descarrega no banco cair entre o INCRBY e a gravação, ou se o Redis perder dados em uma falha, o saldo diverge do histórico e a diferença só aparece na conciliação. Para métricas de painel, essa troca costuma valer a pena. Para dinheiro, o livro-razão dentro do mesmo banco e da mesma transação do pedido mantém a atomicidade sem a disputa.',
    },
    {
      question: 'O consolidador não vira ele mesmo uma linha quente?',
      answer:
        'Não, porque ele atualiza a linha do saldo uma vez por lote, e não uma vez por venda. Com lotes de até 5.000 lançamentos a cada 500 ms, são poucas atualizações por segundo na linha consolidada, contra 1.600 antes. Se houver mais de um consolidador por segurança, o SKIP LOCKED faz cada um pegar pendentes diferentes, e o UPDATE do saldo fica em fila só entre eles, por poucos milissegundos. O que precisa de atenção é a tabela de pendentes, com muita inserção e exclusão, que exige autovacuum configurado por volume absoluto.',
    },
  ],
  conclusion: {
    title: 'Vazão limitada por uma linha não se resolve com hardware',
    description:
      'O checkout não estava lento porque o banco era pequeno. Estava em fila porque todas as vendas precisavam passar, uma de cada vez, pelas mesmas duas linhas, e o tempo de posse do lock definia o teto do sistema inteiro. Medir a espera, encurtar a transação, fatiar o que é só soma e transformar o saldo disputado em lançamentos consolidados tirou a fila sem abrir mão de nenhuma garantia sobre dinheiro. A pergunta que vale levar para outros sistemas é simples: qual linha toda transação importante atualiza?',
    cta: 'Encontrar os gargalos de concorrência do meu sistema',
  },
  related: [
    {
      label: 'Deadlock em produção: quando duas transações corretas se travam uma na outra',
      to: '/blog/deadlock-em-producao-quando-duas-transacoes-corretas-se-travam-uma-na-outra',
    },
    {
      label: 'Estoque negativo: a condição de corrida entre duas compras do último item',
      to: '/blog/estoque-negativo-condicao-de-corrida-entre-duas-compras-do-ultimo-item',
    },
    {
      label: 'Serviço de arquitetura e modernização backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'At 9 p.m. on the opening night of a Black Friday campaign, the checkout of a marketplace with 3,100 sellers stopped growing at 380 orders per second. The p99 of order completion went from 220 ms to 11 seconds, the connection pool ran dry and the request queue kept growing, yet database CPU sat at 34% and the application instances had headroom. No new slow query, no deploy. Two rows explained everything: the platform account, which received the commission on every sale, and the daily order counter that fed the sales dashboard. Every checkout transaction updated those same two rows, and the database, correctly, let them through one at a time. This article shows why a hot row caps the throughput of the whole system at the inverse of how long the lock is held, how to prove the contention with data from Postgres itself, and the three changes that freed the checkout: shortening how long the lock is held, splitting counters into slices and replacing the contended balance with a ledger and consolidation.',
  sections: [
    {
      title: 'The queue that does not show up in CPU',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An UPDATE on a PostgreSQL row locks that row until the end of the transaction, not the end of the statement. Whoever arrives next to update the same row waits for the COMMIT or ROLLBACK of whoever got there first. That is not a defect: it is what stops two simultaneous credits from reading the same balance and one of them disappearing. The consequence is arithmetic. If each transaction holds the row lock for T milliseconds, that row accepts at most 1,000 / T updates per second, no matter how many cores the database has or how many instances the application runs.',
        },
        {
          type: 'paragraph',
          value:
            'In the marketplace checkout, the credit to the platform account was the second statement of a seven statement transaction. After it came the inserts for items, payment, stock reservation, the dashboard counter, a lookup of the already computed shipping and the COMMIT, which waits for the WAL to be flushed to disk. Adding the network round trips and the commit fsync, the row lock was held for about 2.6 ms. 1,000 / 2.6 is 385 transactions per second, exactly the ceiling observed.',
        },
        {
          type: 'list',
          items: [
            'Database CPU stays low because sessions waiting on locks do not consume CPU; they only occupy connections.',
            'The pool runs dry because every connection is stuck in the row queue, and new requests start waiting for a connection before they even wait for the lock.',
            'Adding application instances makes it worse: more concurrent transactions for the same row, a longer queue, the same throughput.',
            'A bigger database machine changes nothing: the limit is lock hold time, not hardware.',
            'Every UPDATE creates a new row version. A thousand updates per second on the same row fill the page with dead versions, and reads of that row walk the chain until they find the visible one.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The pattern repeats in any system that concentrates writes on a single aggregate: the balance of a platform account, stock of a product on sale, the tickets sold counter of a concert, invoice numbering kept in a table, the number of messages sent per customer per day. At low volume nobody notices. At peak, the row becomes a global semaphore for the application.',
        },
      ],
    },
    {
      title: 'How to prove the bottleneck is a row, not the database',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before changing the data model, you need evidence that time is going to lock waits on specific rows. Four readings settle it: who is waiting on whom right now, which UPDATEs have a low minimum and a high average, how many updates each live row has received, and what Postgres itself logs when a wait exceeds one second.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'paragraph',
          value:
            'On the night of the incident, the first query showed 212 sessions with wait_event_type equal to Lock, almost all stuck behind the same pid and running the platform account UPDATE. The second showed that UPDATE with a 0.04 ms minimum and a 1,840 ms average: the work took microseconds, the rest was queueing. In the third, the contas table had 41 thousand live rows and 96 million accumulated updates, almost all on the same row. And the log, with log_lock_waits on, pointed to the exact tuple: the same position in the same relation, thousands of times per minute.',
        },
        {
          type: 'paragraph',
          value:
            'One detail helps read the queue. The first waiting session takes the tuple lock and waits for the writer transaction to finish (wait_event transactionid); the others wait for the tuple (wait_event tuple). A pile of sessions on tuple, all running the same query, is the signature of a hot row. Waits scattered on transactionid across different queries usually point to another problem, such as long transactions or inconsistent lock ordering.',
        },
      ],
    },
    {
      title: 'First step: shorten how long the lock is held',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Since the ceiling is 1,000 / T, the cheapest change is to reduce T without touching the model. The lock is born at the UPDATE and dies at the COMMIT, so everything in between counts. Moving the hot row updates to the end of the transaction, right before the COMMIT, removes from that window every statement that contends for nothing.',
        },
        {
          type: 'code',
          value: encurtarCode,
        },
        {
          type: 'paragraph',
          value:
            'With that reordering, the lock lasted one UPDATE round trip plus the commit, about 1.4 ms, and the ceiling rose to just over 700 orders per second. Throughput doubled with a change of order, but it was still below the 1,600 per second expected at peak. The table below summarizes what shortens the lock and what only seems to, at a high price.',
        },
        {
          type: 'table',
          columns: ['Action', 'Effect on lock time', 'Cost or risk'],
          rows: [
            ['Update hot rows last', 'Removes every earlier statement from the window', 'None; requires reviewing the order in every flow that touches the row'],
            ['Move external network calls out of the transaction', 'Removes tens or hundreds of ms', 'Requires an outbox or a later step for external side effects'],
            ['Merge statements into one (CTE or function)', 'Fewer network round trips', 'Logic that is harder to read and test'],
            ['Application and database in the same zone', 'Lower latency on every round trip', 'Depends on the infrastructure'],
            ['synchronous_commit = off for the transaction', 'Removes the commit fsync wait', 'May lose the last confirmed transactions if the server crashes; unacceptable for money'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Watch the order when two hot rows are updated in the same transaction: every flow has to touch them in the same sequence, or the reordering trades queueing for deadlocks. Here, platform account before counter in every code path.',
        },
      ],
    },
    {
      title: 'Counters: splitting the row into slices',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The daily order counter does not need to be exact at write time, only at read time, and addition is commutative. That allows replacing one row with N rows: each write picks a slice at random and increments only that one, and the read sums them all. With 16 slices, 16 transactions can increment the counter at the same time, and the effective ceiling grows by a factor close to 16.',
        },
        {
          type: 'code',
          value: fatiasCode,
        },
        {
          type: 'paragraph',
          value:
            'The last statement in the block is the trap that shows up most with this technique. Because random() is a volatile function, Postgres evaluates it again for every row it examines, not once per statement. The UPDATE compares each slice against a different draw and may update none, one or several of them, and the counter starts drifting silently. The slice has to come ready from the application, as a parameter.',
        },
        {
          type: 'list',
          items: [
            'Number of slices: peak throughput times lock time times a margin of 2 to 4. At 1,600 per second and 1.4 ms, that is about 4.5 concurrent writes; 16 slices leave room to grow.',
            'More slices are not free: the read sums more rows, and collisions drop less and less past a certain point.',
            'Random selection spreads well across many clients; using the connection pid concentrates writes when the pool has few active connections.',
            'Slices work for sums and counts. They do not work for values that must be checked at write time, such as a balance that cannot go negative.',
          ],
        },
      ],
    },
    {
      title: 'Balances: a ledger with consolidation instead of a contended UPDATE',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The platform account has a requirement the counter does not: debits, such as payouts and refunds, may only happen if there is enough balance. Slicing the balance would force every debit to lock all slices. The alternative that solves the write path and also delivers history for auditing is to stop updating the balance on every sale. Each credit becomes an inserted entry that never contends with another, and a consolidator process applies pending entries to the balance in batches.',
        },
        {
          type: 'code',
          value: livroRazaoCode,
        },
        {
          type: 'paragraph',
          value:
            'Two details keep this correct. First, the current balance is the consolidated value plus the sum of pending entries, read in a single statement: both values come from the same snapshot, and since the consolidator deletes pending entries and adds them to the balance in the same transaction, a read never counts an entry twice or misses it. Second, pending entries live in a separate table and are deleted on consolidation. The version that only stores the last consolidated id looks simpler and loses money: identity values are assigned at insert time, not at commit time, so an entry with a lower id can become visible after the consolidator has already moved past it.',
        },
        {
          type: 'code',
          value: livroRazaoNodeCode,
        },
        {
          type: 'paragraph',
          value:
            'The debit is the only path that still locks a row, and it is rare: a few dozen per hour against 1,600 credits per second. It locks the consolidated row, reads the balance in a following statement, which under READ COMMITTED sees everything committed up to that point, and only then inserts the negative entry. Two simultaneous debits queue behind each other, which is the desired behavior. Credits keep flowing without waiting, and since they only increase the balance, they cannot invalidate the check of whoever is debiting.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
      ],
    },
    {
      title: 'How to choose the technique and what changed in the checkout',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There is no single fix for a hot row; there is the right combination for each kind of value. The deciding question is: does the value have to be checked at write time, or does it only need to be right when someone reads it?',
        },
        {
          type: 'table',
          columns: ['Technique', 'Write contention', 'Read cost', 'Rejects debit without balance?', 'When to use'],
          rows: [
            ['Shorten the lock', 'Reduced, not eliminated', '1 row', 'Yes', 'Always, as the first step'],
            ['Slices', 'Divided by N', 'Sum of N rows', 'Only by locking every slice', 'Counters and sums without checks'],
            ['Ledger with consolidation', 'None for credits', 'Consolidated plus pending', 'Yes, locking the account only on debit', 'Balances with history and rare debits'],
            ['In memory or Redis counter with periodic flush', 'None in the database', 'Delayed, no guarantees', 'No', 'Metrics that tolerate loss'],
            ['Queue with a single writer', 'None in the database, serial in the queue', 'Delayed', 'Yes, in the consumer', 'When the result can be asynchronous'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'At the marketplace, the dashboard counter moved to 16 slices, the platform commission became a ledger entry consolidated every 500 ms, and seller accounts, which each receive only a few writes per second, stayed as they were. Changing only what the measurements flagged as hot kept the change small and easy to review. The load test at the volume expected for peak and the next campaign night confirmed the numbers below.',
        },
        {
          type: 'table',
          columns: ['Metric', 'Before', 'After'],
          rows: [
            ['Maximum checkout throughput', '380 orders/s', '1,600 orders/s sustained in the load test'],
            ['Order completion p99 at peak', '11 s', '240 ms'],
            ['Sessions waiting on locks at peak', '212', '3'],
            ['Average time of the platform account UPDATE', '1,840 ms', 'Replaced by a 0.3 ms INSERT'],
            ['Maximum lag of the consolidated balance', '0', '1.2 s (the balance read includes pending entries)'],
            ['Difference in monthly reconciliation', '-', 'Zero cents'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does SERIALIZABLE isolation or SELECT FOR UPDATE solve the contention?',
      answer:
        'No. Both exist to preserve correctness, not to increase throughput. SELECT FOR UPDATE before the UPDATE only takes the lock earlier and makes it last longer. SERIALIZABLE still serializes writes to the same row and adds serialization failures that force the application to retry the whole transaction, which at peak creates more load exactly where capacity is already short. The way out is to reduce lock time or stop writing to the same row.',
    },
    {
      question: 'Why not keep the balance in Redis with INCRBY and write it to the database later?',
      answer:
        'Because the balance then has two sources of truth and no guarantee that they agree. If the process that flushes to the database dies between the INCRBY and the write, or if Redis loses data in a failure, the balance diverges from the history and the difference only shows up during reconciliation. For dashboard metrics that trade is often worth it. For money, a ledger in the same database and the same transaction as the order keeps atomicity without the contention.',
    },
    {
      question: 'Does the consolidator not become a hot row itself?',
      answer:
        'No, because it updates the balance row once per batch, not once per sale. With batches of up to 5,000 entries every 500 ms, the consolidated row sees a few updates per second instead of 1,600. If you run more than one consolidator for safety, SKIP LOCKED makes each one take different pending entries, and the balance UPDATE only queues between them for a few milliseconds. What needs attention is the pending table, with heavy insert and delete traffic, which requires autovacuum tuned by absolute volume.',
    },
  ],
  conclusion: {
    title: 'Throughput capped by a single row is not fixed with hardware',
    description:
      'The checkout was not slow because the database was small. It was queueing because every sale had to pass, one at a time, through the same two rows, and lock hold time set the ceiling for the whole system. Measuring the wait, shortening the transaction, slicing what is only a sum and turning the contended balance into consolidated entries removed the queue without giving up any guarantee about money. The question worth taking to other systems is simple: which row does every important transaction update?',
    cta: 'Find the concurrency bottlenecks in my system',
  },
  related: [
    {
      label: 'Deadlocks in production: when two correct transactions lock each other up',
      to: '/blog/deadlock-em-producao-quando-duas-transacoes-corretas-se-travam-uma-na-outra',
    },
    {
      label: 'Negative stock: the race condition between two purchases of the last item',
      to: '/blog/estoque-negativo-condicao-de-corrida-entre-duas-compras-do-ultimo-item',
    },
    {
      label: 'Backend architecture and modernization service',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'A las 21 h de la apertura de una campaña de Black Friday, el checkout de un marketplace con 3.100 vendedores dejó de crecer en 380 pedidos por segundo. El p99 del cierre de pedido pasó de 220 ms a 11 segundos, el pool de conexiones se agotó y la cola de solicitudes creció, pero la CPU de la base estaba en 34% y las instancias de la aplicación tenían margen. Ninguna consulta lenta nueva, ningún deploy. Dos filas lo explicaban todo: la cuenta de la plataforma, que recibía la comisión de cada venta, y el contador de pedidos del día que alimentaba el panel comercial. Todas las transacciones de checkout actualizaban esas mismas dos filas, y la base, correctamente, dejaba pasar una a la vez. Este artículo muestra por qué una fila caliente limita el rendimiento de todo el sistema al inverso del tiempo que el lock permanece tomado, cómo probar la disputa con datos del propio Postgres y los tres cambios que liberaron el checkout: acortar la tenencia del lock, dividir contadores en porciones y reemplazar el saldo disputado por un libro mayor con consolidación.',
  sections: [
    {
      title: 'La cola que no aparece en la CPU',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un UPDATE sobre una fila de PostgreSQL bloquea esa fila hasta el final de la transacción, no hasta el final de la sentencia. Quien llega después para actualizar la misma fila espera el COMMIT o el ROLLBACK de quien llegó antes. Eso no es un defecto: es lo que impide que dos créditos simultáneos lean el mismo saldo y uno de ellos desaparezca. La consecuencia es aritmética. Si cada transacción mantiene el lock de la fila durante T milisegundos, esa fila acepta como máximo 1.000 / T actualizaciones por segundo, sin importar cuántos núcleos tenga la base ni cuántas instancias ejecute la aplicación.',
        },
        {
          type: 'paragraph',
          value:
            'En el checkout del marketplace, el crédito a la cuenta de la plataforma era la segunda sentencia de una transacción con siete. Después venían la grabación de los ítems, del pago, de la reserva de stock, del contador del panel, una consulta del flete ya calculado y el COMMIT, que espera a que el WAL se escriba en disco. Sumando los viajes de ida y vuelta por la red y el fsync del commit, el lock de la fila quedaba tomado unos 2,6 ms. 1.000 / 2,6 da 385 transacciones por segundo, exactamente el techo observado.',
        },
        {
          type: 'list',
          items: [
            'La CPU de la base se mantiene baja porque las sesiones que esperan un lock no consumen CPU; solo ocupan conexiones.',
            'El pool se agota porque cada conexión queda atrapada en la cola de la fila, y las solicitudes nuevas empiezan a esperar una conexión antes incluso de esperar el lock.',
            'Agregar instancias de la aplicación empeora la situación: más transacciones concurrentes sobre la misma fila, cola más larga, el mismo rendimiento.',
            'Una máquina más grande para la base no cambia nada: el límite es el tiempo de tenencia del lock, no el hardware.',
            'Cada UPDATE crea una nueva versión de la fila. Mil actualizaciones por segundo sobre la misma fila llenan la página de versiones muertas, y las lecturas de esa fila recorren la cadena hasta encontrar la versión visible.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El patrón se repite en cualquier sistema que concentra escrituras en un agregado único: el saldo de una cuenta de la plataforma, el stock de un producto en oferta, el contador de entradas vendidas de un concierto, la numeración de facturas mantenida en una tabla, el total de mensajes enviados por cliente en el día. Con poco volumen nadie lo nota. En el pico, la fila se convierte en un semáforo global de la aplicación.',
        },
      ],
    },
    {
      title: 'Cómo probar que el cuello de botella es una fila y no la base',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de cambiar el modelo de datos, hace falta evidencia de que el tiempo se va en esperas de lock sobre filas concretas. Cuatro lecturas lo resuelven: quién espera a quién en este instante, qué UPDATE tienen un mínimo bajo y un promedio alto, cuántas actualizaciones recibió cada fila viva y qué registra el propio Postgres en el log cuando una espera supera un segundo.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'paragraph',
          value:
            'La noche del incidente, la primera consulta mostró 212 sesiones con wait_event_type igual a Lock, casi todas atrapadas detrás del mismo pid y ejecutando el UPDATE de la cuenta de la plataforma. La segunda mostró ese UPDATE con un mínimo de 0,04 ms y un promedio de 1.840 ms: el trabajo tardaba microsegundos, el resto era cola. En la tercera, la tabla contas tenía 41 mil filas vivas y 96 millones de actualizaciones acumuladas, casi todas sobre la misma fila. Y el log, con log_lock_waits activado, señaló la tupla exacta: la misma posición en la misma relación, miles de veces por minuto.',
        },
        {
          type: 'paragraph',
          value:
            'Un detalle ayuda a leer la cola. La primera sesión que espera toma el lock de la tupla y aguarda a que termine la transacción que está escribiendo (wait_event transactionid); las demás esperan por la tupla (wait_event tuple). Una pila de sesiones en tuple, todas con la misma consulta, es la firma de una fila caliente. Las esperas dispersas en transactionid sobre consultas distintas suelen indicar otro problema, como transacciones largas u orden de locks inconsistente.',
        },
      ],
    },
    {
      title: 'Primer paso: acortar el tiempo que el lock permanece tomado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Como el techo es 1.000 / T, el cambio más barato es reducir T sin tocar el modelo. El lock nace en el UPDATE y muere en el COMMIT, así que todo lo que ocurre entre ambos cuenta. Mover las actualizaciones de las filas calientes al final de la transacción, justo antes del COMMIT, saca de esa ventana todas las sentencias que no disputan nada.',
        },
        {
          type: 'code',
          value: encurtarCode,
        },
        {
          type: 'paragraph',
          value:
            'Con ese reordenamiento, el lock pasó a durar un viaje de ida y vuelta del UPDATE más el commit, unos 1,4 ms, y el techo subió a poco más de 700 pedidos por segundo. El rendimiento se duplicó con un cambio de orden, pero seguía por debajo de los 1.600 por segundo previstos para el pico. La tabla resume lo que acorta el lock y lo que solo parece acortarlo, a un precio alto.',
        },
        {
          type: 'table',
          columns: ['Acción', 'Efecto en el tiempo de lock', 'Costo o riesgo'],
          rows: [
            ['Actualizar las filas calientes al final', 'Saca de la ventana todas las sentencias anteriores', 'Ninguno; exige revisar el orden en todos los flujos que tocan la fila'],
            ['Sacar las llamadas de red externas de la transacción', 'Elimina decenas o cientos de ms', 'Requiere outbox o una etapa posterior para efectos externos'],
            ['Unir sentencias en una sola (CTE o función)', 'Menos viajes de ida y vuelta por la red', 'Lógica más difícil de leer y probar'],
            ['Aplicación y base en la misma zona', 'Menor latencia en cada viaje de ida y vuelta', 'Depende de la infraestructura'],
            ['synchronous_commit = off en la transacción', 'Elimina la espera del fsync del commit', 'Puede perder las últimas transacciones confirmadas si el servidor cae; inaceptable para dinero'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Atención al orden cuando dos filas calientes se actualizan en la misma transacción: todos los flujos tienen que tocarlas en la misma secuencia, o el reordenamiento cambia cola por deadlock. Aquí, la cuenta de la plataforma antes que el contador en todos los caminos del código.',
        },
      ],
    },
    {
      title: 'Contadores: dividir la fila en porciones',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El contador de pedidos del día no necesita exactitud en el momento de la escritura, solo en la lectura, y la suma es conmutativa. Eso permite reemplazar una fila por N filas: cada escritura sortea una porción e incrementa solo esa, y la lectura suma todas. Con 16 porciones, 16 transacciones pueden incrementar el contador al mismo tiempo, y el techo efectivo se multiplica por un factor cercano a 16.',
        },
        {
          type: 'code',
          value: fatiasCode,
        },
        {
          type: 'paragraph',
          value:
            'La última sentencia del bloque es la trampa más frecuente de esta técnica. Como random() es una función volátil, Postgres la evalúa de nuevo para cada fila que examina, y no una vez por sentencia. El UPDATE compara cada porción con un sorteo distinto y puede actualizar ninguna, una o varias, y el contador empieza a desviarse en silencio. La porción tiene que llegar lista desde la aplicación, como parámetro.',
        },
        {
          type: 'list',
          items: [
            'Cantidad de porciones: rendimiento pico por tiempo de lock por un margen de 2 a 4. Con 1.600 por segundo y 1,4 ms, da unas 4,5 escrituras simultáneas; 16 porciones dejan espacio para crecer.',
            'Más porciones no son gratis: la lectura suma más filas y las colisiones bajan cada vez menos a partir de cierto punto.',
            'El sorteo aleatorio reparte bien con muchos clientes; usar el pid de la conexión concentra escrituras cuando el pool tiene pocas conexiones activas.',
            'Las porciones sirven para sumas y conteos. No sirven para valores que deben verificarse al escribir, como un saldo que no puede quedar negativo.',
          ],
        },
      ],
    },
    {
      title: 'Saldos: libro mayor con consolidación en lugar de un UPDATE disputado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La cuenta de la plataforma tiene una exigencia que el contador no tiene: los débitos, como liquidaciones y reembolsos, solo pueden ocurrir si hay saldo. Dividir el saldo en porciones obligaría a cada débito a bloquear todas. La alternativa que resuelve la escritura y además entrega historial para auditoría es dejar de actualizar el saldo en cada venta. Cada crédito se convierte en un asiento insertado que nunca disputa una fila con otro, y un proceso consolidador aplica los asientos pendientes al saldo por lotes.',
        },
        {
          type: 'code',
          value: livroRazaoCode,
        },
        {
          type: 'paragraph',
          value:
            'Dos detalles sostienen la corrección. Primero, el saldo actual es el consolidado más la suma de los pendientes, leídos en una única sentencia: ambos valores vienen del mismo snapshot, y como el consolidador borra pendientes y los suma al saldo en la misma transacción, la lectura nunca cuenta un asiento dos veces ni lo omite. Segundo, los pendientes viven en una tabla separada y se borran al consolidar. La versión que guarda solo el último id consolidado parece más simple y pierde dinero: los valores de identidad se asignan en la inserción, no en el commit, así que un asiento con id menor puede volverse visible después de que el consolidador ya pasó por él.',
        },
        {
          type: 'code',
          value: livroRazaoNodeCode,
        },
        {
          type: 'paragraph',
          value:
            'El débito es el único camino que todavía bloquea una fila, y es raro: algunas decenas por hora frente a 1.600 créditos por segundo. Bloquea la fila consolidada, lee el saldo en una sentencia siguiente, que en READ COMMITTED ve todo lo confirmado hasta ese momento, y solo entonces inserta el asiento negativo. Dos débitos simultáneos hacen cola entre sí, que es el comportamiento deseado. Los créditos siguen entrando sin esperar y, como solo aumentan el saldo, no invalidan la verificación de quien está debitando.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
      ],
    },
    {
      title: 'Cómo elegir la técnica y qué cambió en el checkout',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No hay una solución única para una fila caliente; hay la combinación adecuada para cada tipo de valor. La pregunta que decide es: ¿el valor tiene que verificarse en el momento de la escritura o solo necesita ser correcto cuando alguien lo lee?',
        },
        {
          type: 'table',
          columns: ['Técnica', 'Disputa en la escritura', 'Costo de la lectura', '¿Rechaza débito sin saldo?', 'Cuándo usarla'],
          rows: [
            ['Acortar el lock', 'Se reduce, no desaparece', '1 fila', 'Sí', 'Siempre, como primer paso'],
            ['Porciones', 'Dividida por N', 'Suma de N filas', 'Solo bloqueando todas las porciones', 'Contadores y sumas sin verificación'],
            ['Libro mayor con consolidación', 'Ninguna en los créditos', 'Consolidado más pendientes', 'Sí, bloqueando la cuenta solo en el débito', 'Saldos con historial y débitos poco frecuentes'],
            ['Contador en memoria o Redis con volcado periódico', 'Ninguna en la base', 'Atrasada y sin garantías', 'No', 'Métricas que toleran pérdida'],
            ['Cola con un único escritor', 'Ninguna en la base, serial en la cola', 'Atrasada', 'Sí, en el consumidor', 'Cuando el resultado puede ser asíncrono'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'En el marketplace, el contador del panel pasó a 16 porciones, la comisión de la plataforma se convirtió en un asiento consolidado cada 500 ms y las cuentas de los vendedores, que reciben pocas escrituras por segundo cada una, quedaron como estaban. Cambiar solo lo que la medición señaló como caliente mantuvo el cambio pequeño y fácil de revisar. La prueba de carga con el volumen previsto para el pico y la siguiente noche de campaña confirmaron los números de abajo.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Antes', 'Después'],
          rows: [
            ['Rendimiento máximo del checkout', '380 pedidos/s', '1.600 pedidos/s sostenidos en la prueba de carga'],
            ['p99 del cierre de pedido en el pico', '11 s', '240 ms'],
            ['Sesiones esperando lock en el pico', '212', '3'],
            ['Tiempo promedio del UPDATE de la cuenta de la plataforma', '1.840 ms', 'Reemplazado por un INSERT de 0,3 ms'],
            ['Atraso máximo del saldo consolidado', '0', '1,2 s (el saldo leído incluye los pendientes)'],
            ['Diferencia en la conciliación mensual', '-', 'Cero centavos'],
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Usar aislamiento SERIALIZABLE o SELECT FOR UPDATE resuelve la disputa?',
      answer:
        'No. Ambos sirven para mantener la corrección, no para aumentar el rendimiento. SELECT FOR UPDATE antes del UPDATE solo adelanta el lock y alarga el tiempo que permanece tomado. SERIALIZABLE sigue serializando las escrituras sobre la misma fila y agrega fallos de serialización que obligan a la aplicación a repetir toda la transacción, lo que en el pico genera más carga justo donde ya falta capacidad. La salida es reducir el tiempo de lock o dejar de escribir en la misma fila.',
    },
    {
      question: '¿Por qué no mantener el saldo en Redis con INCRBY y grabarlo en la base después?',
      answer:
        'Porque el saldo pasa a tener dos fuentes de verdad y ninguna garantía de que coincidan. Si el proceso que vuelca a la base se cae entre el INCRBY y la escritura, o si Redis pierde datos en una falla, el saldo diverge del historial y la diferencia solo aparece en la conciliación. Para métricas de panel ese intercambio suele valer la pena. Para dinero, el libro mayor dentro de la misma base y de la misma transacción del pedido mantiene la atomicidad sin la disputa.',
    },
    {
      question: '¿El consolidador no se convierte él mismo en una fila caliente?',
      answer:
        'No, porque actualiza la fila del saldo una vez por lote y no una vez por venta. Con lotes de hasta 5.000 asientos cada 500 ms, la fila consolidada recibe pocas actualizaciones por segundo en lugar de 1.600. Si se ejecuta más de un consolidador por seguridad, SKIP LOCKED hace que cada uno tome pendientes distintos, y el UPDATE del saldo solo hace cola entre ellos durante pocos milisegundos. Lo que requiere atención es la tabla de pendientes, con mucha inserción y borrado, que exige un autovacuum configurado por volumen absoluto.',
    },
  ],
  conclusion: {
    title: 'Un rendimiento limitado por una fila no se resuelve con hardware',
    description:
      'El checkout no estaba lento porque la base fuera pequeña. Estaba en cola porque todas las ventas tenían que pasar, una a la vez, por las mismas dos filas, y el tiempo de tenencia del lock definía el techo de todo el sistema. Medir la espera, acortar la transacción, dividir en porciones lo que es solo una suma y convertir el saldo disputado en asientos consolidados eliminó la cola sin renunciar a ninguna garantía sobre el dinero. La pregunta que vale llevar a otros sistemas es simple: ¿qué fila actualiza toda transacción importante?',
    cta: 'Encontrar los cuellos de botella de concurrencia de mi sistema',
  },
  related: [
    {
      label: 'Deadlock en producción: cuando dos transacciones correctas se bloquean entre sí',
      to: '/blog/deadlock-em-producao-quando-duas-transacoes-corretas-se-travam-uma-na-outra',
    },
    {
      label: 'Stock negativo: la condición de carrera entre dos compras del último artículo',
      to: '/blog/estoque-negativo-condicao-de-corrida-entre-duas-compras-do-ultimo-item',
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
