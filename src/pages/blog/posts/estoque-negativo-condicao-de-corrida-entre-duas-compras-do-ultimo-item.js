// Conteudo do artigo: estoque negativo, a condicao de corrida entre duas compras
// do ultimo item, baixa atomica com UPDATE condicional, CHECK como ultima linha,
// reserva com expiracao, pedidos com varios itens e teste da corrida.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const racyCode = `// Versao com a corrida: le o saldo, decide na aplicacao e grava depois
async function venderComCorrida(db, produtoId, quantidade) {
  const { rows } = await db.query(
    'SELECT disponivel FROM estoque WHERE produto_id = $1',
    [produtoId],
  );
  if (rows[0].disponivel < quantidade) throw new Error('sem estoque');

  // Entre o SELECT acima e o UPDATE abaixo, outra sessao pode ter vendido
  // a mesma unidade. As duas passaram pela verificacao com o mesmo saldo.
  await db.query(
    'UPDATE estoque SET disponivel = disponivel - $2 WHERE produto_id = $1',
    [produtoId, quantidade],
  );
}`;

const schemaSql = `CREATE TABLE estoque (
  produto_id  bigint  PRIMARY KEY,
  disponivel  integer NOT NULL,
  reservado   integer NOT NULL DEFAULT 0,
  CONSTRAINT disponivel_nao_negativo CHECK (disponivel >= 0),
  CONSTRAINT reservado_nao_negativo  CHECK (reservado >= 0)
);

CREATE TABLE reservas (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id   uuid        NOT NULL,
  produto_id  bigint      NOT NULL REFERENCES estoque (produto_id),
  quantidade  integer     NOT NULL CHECK (quantidade > 0),
  status      text        NOT NULL DEFAULT 'ativa'
              CHECK (status IN ('ativa', 'confirmada', 'liberada')),
  expira_em   timestamptz NOT NULL,
  criada_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pedido_id, produto_id)
);

CREATE INDEX reservas_ativas_por_expiracao
  ON reservas (expira_em)
  WHERE status = 'ativa';

-- A baixa atomica: verificacao e decremento na mesma instrucao.
-- Em READ COMMITTED, a segunda sessao espera a trava da linha e, quando a
-- primeira confirma, reavalia o WHERE sobre a versao nova: 0 >= 1 e falso,
-- nenhuma linha e atualizada e a venda e recusada.
UPDATE estoque
   SET disponivel = disponivel - $2,
       reservado  = reservado + $2
 WHERE produto_id = $1
   AND disponivel >= $2
RETURNING disponivel;`;

const reserveCode = `import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

export class EstoqueInsuficiente extends Error {
  constructor(produtoId) {
    super('estoque insuficiente para o produto ' + produtoId);
    this.name = 'EstoqueInsuficiente';
    this.produtoId = produtoId;
  }
}

const RESERVA_TTL = '15 minutes';

// Soma itens repetidos e ordena por produto_id. Dois pedidos com os mesmos
// produtos travam as linhas de estoque na mesma ordem e nao entram em deadlock.
function normalizar(itens) {
  const soma = new Map();
  for (const { produtoId, quantidade } of itens) {
    if (!Number.isInteger(quantidade) || quantidade <= 0) {
      throw new RangeError('quantidade invalida para o produto ' + produtoId);
    }
    soma.set(produtoId, (soma.get(produtoId) || 0) + quantidade);
  }
  return [...soma.entries()]
    .map(([produtoId, quantidade]) => ({ produtoId, quantidade }))
    .sort((a, b) => a.produtoId - b.produtoId);
}

// Reserva todos os itens do pedido ou nenhum. A transacao nao chama nada
// externo: quanto menos tempo a trava da linha fica presa, mais vendas por
// segundo o produto mais disputado aguenta.
export async function reservarPedido(pedidoId, itens) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { produtoId, quantidade } of normalizar(itens)) {
      const { rowCount } = await client.query(
        'UPDATE estoque SET disponivel = disponivel - $2, reservado = reservado + $2 ' +
          'WHERE produto_id = $1 AND disponivel >= $2',
        [produtoId, quantidade],
      );
      if (rowCount === 0) throw new EstoqueInsuficiente(produtoId);
      await client.query(
        'INSERT INTO reservas (pedido_id, produto_id, quantidade, expira_em) ' +
          'VALUES ($1, $2, $3, now() + $4::interval)',
        [pedidoId, produtoId, quantidade, RESERVA_TTL],
      );
    }
    await client.query('COMMIT');
    return { jaReservado: false };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Retentativa do mesmo pedido: a UNIQUE (pedido_id, produto_id) falha,
    // o ROLLBACK devolve o que esta tentativa baixou e a reserva original fica.
    if (err.code === '23505') return { jaReservado: true };
    throw err;
  } finally {
    client.release();
  }
}

// Pagamento aprovado: a reserva vira venda e a unidade sai do reservado.
// Devolve os itens confirmados; se vier menos do que o pedido tem, parte da
// reserva expirou antes do pagamento e o chamador precisa reservar de novo
// ou estornar.
export async function confirmarPedido(pedidoId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "UPDATE reservas SET status = 'confirmada' " +
        "WHERE pedido_id = $1 AND status = 'ativa' " +
        'RETURNING produto_id, quantidade',
      [pedidoId],
    );
    rows.sort((a, b) => Number(a.produto_id) - Number(b.produto_id));
    for (const r of rows) {
      await client.query(
        'UPDATE estoque SET reservado = reservado - $2 WHERE produto_id = $1',
        [r.produto_id, r.quantidade],
      );
    }
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}`;

const expireSql = `-- Job a cada 30 segundos: devolve ao disponivel o que foi reservado e nao pago.
-- SKIP LOCKED pula reservas que um confirmarPedido esta travando agora; a
-- condicao status = 'ativa' garante que so um dos dois vence.
-- Se o banco abortar a execucao por deadlock (40P01), o job repete no ciclo seguinte.
WITH expiradas AS (
  UPDATE reservas
     SET status = 'liberada'
   WHERE id IN (
     SELECT id
       FROM reservas
      WHERE status = 'ativa'
        AND expira_em < now()
      ORDER BY expira_em
      LIMIT 500
      FOR UPDATE SKIP LOCKED
   )
  RETURNING produto_id, quantidade
),
por_produto AS (
  SELECT produto_id, sum(quantidade)::int AS qtd
    FROM expiradas
   GROUP BY produto_id
)
UPDATE estoque e
   SET disponivel = e.disponivel + p.qtd,
       reservado  = e.reservado - p.qtd
  FROM por_produto p
 WHERE e.produto_id = p.produto_id;`;

const raceTestCode = `import { randomUUID } from 'node:crypto';
import { pool, reservarPedido, EstoqueInsuficiente } from './estoque.js';

const PRODUTO = 42;
const COMPRADORES = 50;

await pool.query('DELETE FROM reservas WHERE produto_id = $1', [PRODUTO]);
await pool.query(
  'INSERT INTO estoque (produto_id, disponivel) VALUES ($1, 1) ' +
    'ON CONFLICT (produto_id) DO UPDATE SET disponivel = 1, reservado = 0',
  [PRODUTO],
);

// Cinquenta compradores disputando a ultima unidade ao mesmo tempo.
const resultados = await Promise.all(
  Array.from({ length: COMPRADORES }, () =>
    reservarPedido(randomUUID(), [{ produtoId: PRODUTO, quantidade: 1 }])
      .then(() => 'ok')
      .catch((err) => {
        if (err instanceof EstoqueInsuficiente) return 'sem_estoque';
        throw err;
      }),
  ),
);

const vendidos = resultados.filter((r) => r === 'ok').length;
const { rows } = await pool.query(
  'SELECT disponivel, reservado FROM estoque WHERE produto_id = $1',
  [PRODUTO],
);
console.log({ vendidos, recusados: COMPRADORES - vendidos, ...rows[0] });

await pool.end();
if (vendidos !== 1 || rows[0].disponivel !== 0 || rows[0].reservado !== 1) {
  console.error('corrida detectada: o estoque vendeu mais do que tinha');
  process.exit(1);
}`;

const auditSql = `-- Divergencia entre o saldo e o historico: roda todo dia, deve voltar vazio.
-- estoque_inicial vem da ultima contagem ou do cadastro do produto.
SELECT e.produto_id,
       e.disponivel + e.reservado                         AS saldo_atual,
       i.estoque_inicial - coalesce(sum(r.quantidade), 0)  AS saldo_esperado
  FROM estoque e
  JOIN estoque_inicial i USING (produto_id)
  LEFT JOIN reservas r
         ON r.produto_id = e.produto_id
        AND r.status = 'confirmada'
        AND r.criada_em >= i.contado_em
 GROUP BY e.produto_id, e.disponivel, e.reservado, i.estoque_inicial
HAVING e.disponivel + e.reservado <> i.estoque_inicial - coalesce(sum(r.quantidade), 0);`;

const pt = {
  intro:
    'A cafeteira em promoção tinha trinta unidades no estoque. Às nove horas da noite, o e-mail da campanha saiu para quatrocentos mil clientes e, em onze minutos, a loja registrou trinta e quatro pedidos pagos. O painel mostrava o saldo em menos quatro. O time conferiu o código e encontrou a verificação no lugar certo: antes de gravar o pedido, o sistema lia o saldo e só seguia se houvesse unidade disponível. Todos os testes passavam, a revisão de código tinha aprovado e, em meses de operação normal, o problema nunca tinha aparecido. Os quatro clientes excedentes receberam um e-mail de desculpas e o estorno, dois abriram reclamação pública e o marketplace parceiro suspendeu o anúncio por venda sem estoque. O defeito não estava na regra, estava no intervalo entre ler o saldo e gravar a baixa, um intervalo de poucos milissegundos que só importa quando duas pessoas compram a mesma coisa ao mesmo tempo. Este artigo mostra como essa corrida acontece, por que nem o nível de isolamento padrão nem o ORM protegem você dela, como fazer a baixa ser atômica no próprio banco, como reservar estoque durante o pagamento sem prender unidades para sempre, como tratar pedidos com vários itens e produtos muito disputados, e como provar com um teste que a corrida sumiu.',
  sections: [
    {
      title: 'Como duas compras corretas vendem a mesma unidade',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O fluxo de compra mais comum tem três passos: ler o saldo, decidir na aplicação se dá para vender e gravar a baixa. Cada passo está certo isoladamente. O problema é que, entre o primeiro e o terceiro, o banco não promete que o saldo continue o mesmo. Em uma requisição por vez, isso nunca aparece. Com duas requisições chegando no mesmo milissegundo, as duas leem o mesmo saldo, as duas passam na verificação e as duas gravam.',
        },
        {
          type: 'code',
          value: racyCode,
        },
        {
          type: 'diagram',
          value: `Sessão 1 (pedido A)                      Sessão 2 (pedido B)
--------------------                      --------------------
SELECT disponivel      -> 1
                                          SELECT disponivel      -> 1
1 >= 1, pode vender
                                          1 >= 1, pode vender
UPDATE disponivel - 1
COMMIT                 (saldo = 0)
                                          UPDATE disponivel - 1
                                          COMMIT                 (saldo = -1)`,
        },
        {
          type: 'paragraph',
          value:
            'A janela entre o SELECT e o UPDATE parece pequena, mas ela inclui tudo que a aplicação faz no meio: calcular frete, aplicar cupom, consultar antifraude, chamar o gateway de pagamento. No incidente da cafeteira, o código lia o saldo no início do checkout e só gravava a baixa depois da resposta do gateway, cerca de um segundo e meio depois. Com quarenta compradores por segundo disputando as últimas unidades, a chance de duas sessões caírem na mesma janela deixou de ser rara e virou certeza.',
        },
        {
          type: 'paragraph',
          value:
            'Existe uma variante ainda pior. Se o UPDATE grava o valor calculado pela aplicação, como SET disponivel = 0, em vez de subtrair no banco, as duas sessões gravam zero. O estoque não fica negativo, o painel mostra um saldo aparentemente correto e duas unidades foram vendidas com uma só na prateleira. É a atualização perdida, e ela é a forma mais comum quando o código usa um ORM que carrega a entidade, altera o campo em memória e chama save. O estoque negativo pelo menos avisa. A atualização perdida só aparece no inventário físico.',
        },
      ],
    },
    {
      title: 'Por que o isolamento padrão e o ORM não protegem você',
      blocks: [
        {
          type: 'paragraph',
          value:
            'É comum imaginar que colocar tudo dentro de uma transação resolve. Não resolve. O PostgreSQL, o MySQL com InnoDB e a maioria dos bancos gerenciados usam por padrão o nível READ COMMITTED ou REPEATABLE READ, e nenhum dos dois transforma um SELECT comum em uma trava. A transação garante que as suas escritas entram juntas ou não entram, e não que o valor que você leu continua valendo quando você escreve.',
        },
        {
          type: 'table',
          columns: ['Abordagem', 'Impede a venda duplicada?', 'Custo e armadilha'],
          rows: [
            [
              'SELECT, verificação na aplicação e UPDATE com valor calculado',
              'Não. Gera atualização perdida: saldo zero e duas vendas',
              'É o padrão de ORM com carregar, alterar e salvar',
            ],
            [
              'SELECT, verificação na aplicação e UPDATE com disponivel - 1',
              'Não. Gera estoque negativo',
              'Parece seguro porque a subtração é no banco, mas a decisão foi tomada sobre um valor velho',
            ],
            [
              'SELECT ... FOR UPDATE e depois UPDATE',
              'Sim',
              'A trava fica presa durante tudo que a aplicação faz entre as duas instruções; se isso inclui o gateway, a fila para no produto disputado',
            ],
            [
              'Coluna de versão com UPDATE ... WHERE versao = $v',
              'Sim',
              'Sob disputa, quase todas as tentativas falham e precisam repetir a leitura; funciona para edição de cadastro, sofre em promoção',
            ],
            [
              'Transação SERIALIZABLE',
              'Sim',
              'O banco aborta uma das sessões com erro 40001 e a aplicação precisa repetir a transação inteira; sem o laço de retentativa, vira erro para o cliente',
            ],
            [
              'UPDATE condicional: WHERE disponivel >= $q',
              'Sim',
              'Uma instrução, trava pelo tempo mínimo, sem retentativa; é a base recomendada',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O ponto comum das abordagens que funcionam é que a verificação e a escrita passam a ser uma coisa só para o banco. Ou a linha fica travada entre as duas, ou o banco detecta o conflito e manda repetir, ou a verificação vai para dentro do próprio UPDATE. A última é a mais barata porque não depende de a aplicação fazer nada certo depois: se a condição não vale mais, a linha simplesmente não é atualizada.',
        },
      ],
    },
    {
      title: 'A baixa atômica: verificar e decrementar na mesma instrução',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Em vez de perguntar ao banco quanto tem e depois mandar subtrair, a aplicação pede diretamente: subtraia se ainda houver o suficiente. O número de linhas afetadas é a resposta. Uma linha significa que a unidade é sua. Zero linhas significa que não havia saldo no momento da escrita, qualquer que tenha sido o saldo lido antes.',
        },
        {
          type: 'code',
          value: schemaSql,
        },
        {
          type: 'paragraph',
          value:
            'O que torna isso correto é o comportamento do UPDATE sob concorrência. Quando a segunda sessão tenta atualizar a mesma linha, ela espera a trava da primeira. Assim que a primeira confirma, o PostgreSQL não usa a versão da linha que a segunda viu no início: ele relê a versão recém-confirmada e reavalia o WHERE sobre ela. O saldo agora é zero, a condição disponivel >= 1 é falsa e o UPDATE termina sem atualizar nada. No MySQL com InnoDB, o UPDATE faz uma leitura atual da linha travada e chega ao mesmo resultado. A trava dura só o tempo da instrução e da transação que a contém, e não o tempo de toda a lógica da aplicação.',
        },
        {
          type: 'paragraph',
          value:
            'As restrições CHECK (disponivel >= 0) e CHECK (reservado >= 0) são a última linha de defesa. Elas não substituem o UPDATE condicional, porque transformariam cada venda recusada em uma exceção de violação de restrição, mas garantem que nenhum caminho do sistema, seja um script de ajuste, um endpoint antigo que ninguém lembrava ou uma integração com o ERP, consiga gravar estoque negativo. Se alguém esquecer a condição no WHERE, o banco recusa a escrita em vez de aceitar em silêncio. Adicionar essas restrições a uma tabela que já tem saldos negativos exige corrigir os dados antes, e a própria falha ao criar a restrição é um bom inventário de quantos produtos já foram vendidos a mais.',
        },
      ],
    },
    {
      title: 'Reserva com expiração: segurar a unidade durante o pagamento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Baixar o estoque só depois do pagamento aprovado reabre a corrida em outro lugar: o cliente preenche o cartão, o gateway aprova e só então o sistema descobre que a unidade acabou, com o dinheiro já capturado. Baixar antes, sem prazo, cria o problema oposto: carrinhos abandonados e pagamentos recusados prendem unidades que nunca serão vendidas, e a promoção termina com produto parado e página mostrando esgotado. A solução é separar o saldo em dois números, disponível e reservado, e dar prazo à reserva.',
        },
        {
          type: 'ordered',
          items: [
            'Ao iniciar o pagamento, o UPDATE condicional move a quantidade de disponível para reservado e grava uma linha em reservas com expira_em. Essa é a única etapa que disputa a unidade.',
            'Com o pagamento aprovado, a reserva vira confirmada e a quantidade sai do reservado. Não há mais disputa, porque a unidade já é do pedido.',
            'Se o prazo vence sem pagamento, um job marca a reserva como liberada e devolve a quantidade ao disponível.',
            'Pagamento recusado ou carrinho cancelado pelo cliente liberam a reserva na hora, pelo mesmo caminho do job, sem esperar o prazo.',
          ],
        },
        {
          type: 'code',
          value: reserveCode,
        },
        {
          type: 'paragraph',
          value:
            'Três detalhes fazem esse código aguentar produção. A restrição UNIQUE (pedido_id, produto_id) torna a reserva idempotente: se o cliente clica duas vezes ou o front repete a requisição por timeout, a segunda tentativa falha na inserção, o ROLLBACK devolve o que ela tinha baixado e a função responde que o pedido já estava reservado. A transação não faz nenhuma chamada externa, porque cada milissegundo com a linha travada é um milissegundo em que ninguém mais compra aquele produto. E confirmarPedido só confirma reservas ainda ativas, então a corrida entre o pagamento que chega e o job que expira tem um vencedor só, decidido pela trava da linha em reservas.',
        },
        {
          type: 'code',
          value: expireSql,
        },
        {
          type: 'paragraph',
          value:
            'O prazo da reserva é uma decisão de produto com consequência técnica. Quinze minutos cobrem o pagamento por cartão e a maior parte dos Pix. Boleto não cabe nesse modelo, porque o pagamento pode levar dias: nesse caso, ou a reserva tem prazo longo e o produto disputado fica preso, ou o boleto não reserva e o pedido é confirmado apenas se houver saldo na compensação, com estorno automático quando não houver. Quando confirmarPedido devolve menos itens do que o pedido tem, é esse o caminho: tentar reservar de novo o que expirou e, se não houver saldo, estornar e avisar o cliente antes que ele descubra pela falta de entrega.',
        },
      ],
    },
    {
      title: 'Pedidos com vários itens e o produto que todo mundo quer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um pedido com três produtos precisa reservar os três ou nenhum, e é por isso que reservarPedido faz tudo em uma transação e desfaz tudo se um único item falhar. Essa transação trava uma linha por produto, e duas transações que travam as mesmas linhas em ordens diferentes entram em deadlock: o pedido A trava a cafeteira e espera o moedor, o pedido B trava o moedor e espera a cafeteira. O banco detecta o ciclo, aborta um dos dois com erro e o cliente vê uma falha que não tem nada a ver com estoque. Ordenar os itens por produto_id antes de travar elimina o ciclo, porque todas as transações passam a pegar as travas na mesma sequência.',
        },
        {
          type: 'paragraph',
          value:
            'O segundo problema é a linha quente. Na promoção, milhares de sessões querem atualizar a mesma linha de estoque, e o banco só deixa uma por vez. A vazão máxima desse produto passa a ser o inverso do tempo que cada transação segura a trava. Com cinco milissegundos por reserva, o teto é de duzentas reservas por segundo naquele item, independentemente de quantos servidores de aplicação existam. Se a transação chama o gateway no meio e segura a trava por um segundo e meio, o teto cai para menos de uma venda por segundo, e o pool de conexões esgota com sessões esperando a mesma linha.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'Quando usar', 'O que custa'],
          rows: [
            [
              'Transação curta com UPDATE condicional',
              'Quase sempre; aguenta centenas de reservas por segundo por produto',
              'Nada além de manter chamadas externas fora da transação',
            ],
            [
              'Saldo fragmentado em N linhas por produto',
              'Lançamentos e promoções com milhares de reservas por segundo no mesmo item',
              'A reserva tenta um fragmento aleatório e, se estiver vazio, os outros; o total passa a ser uma soma, e rebalancear fragmentos exige um job',
            ],
            [
              'Contador em memória como porta de entrada, como DECRBY no Redis com script atômico',
              'Quando o volume de tentativas é muito maior que o estoque, como em uma venda de ingressos',
              'Duas fontes de verdade: o banco continua obrigatório para a reserva, e o contador precisa ser reconciliado quando reservas expiram',
            ],
            [
              'Fila de compra com um consumidor por produto',
              'Quando é aceitável responder aguarde em vez de sim ou não na hora',
              'Latência para o cliente e uma fila para operar, em troca de zero disputa no banco',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Na maioria das lojas, a primeira linha da tabela é suficiente. A cafeteira recebeu quarenta tentativas por segundo no pico, muito abaixo do teto de uma transação curta. O que derrubou o fluxo não foi o volume, foi a transação que segurava a trava enquanto esperava o gateway. As outras estratégias só valem a complexidade quando a medição mostra sessões esperando a mesma linha por tempo relevante, e essa espera aparece no PostgreSQL em pg_stat_activity com wait_event_type = Lock sobre a tabela de estoque.',
        },
      ],
    },
    {
      title: 'Provar que a corrida sumiu e perceber quando ela volta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um teste de unidade com banco em memória e uma chamada por vez nunca vai encontrar esse defeito, e foi exatamente por isso que ele chegou à produção. O teste que importa dispara dezenas de compras simultâneas contra um banco real, com o mesmo motor e o mesmo nível de isolamento de produção, e verifica os invariantes no final: exatamente uma venda para uma unidade, saldo zero e nenhum número negativo.',
        },
        {
          type: 'code',
          value: raceTestCode,
        },
        {
          type: 'paragraph',
          value:
            'Rodando esse script contra a versão com a corrida, o resultado muda a cada execução: às vezes duas vendas, às vezes cinco, às vezes uma, o que já diz muito sobre a confiabilidade de um teste que passa uma vez. Contra a baixa atômica, ele vende uma unidade e recusa quarenta e nove em todas as execuções. Vale mantê-lo no pipeline de integração, porque a corrida volta com facilidade: basta alguém criar um endpoint novo de ajuste de estoque, um fluxo de troca ou uma importação que use o padrão de ler, decidir e salvar.',
        },
        {
          type: 'paragraph',
          value:
            'Em produção, o sinal mais confiável é comparar o saldo com o histórico. O saldo atual mais o reservado precisa ser igual ao estoque inicial menos o que foi vendido desde a última contagem. Quando os dois divergem, algum caminho gravou sem passar pela baixa atômica.',
        },
        {
          type: 'code',
          value: auditSql,
        },
        {
          type: 'list',
          items: [
            'Violações das restrições CHECK de estoque, registradas como erro com o endpoint de origem. Toda violação é um caminho de código que tentou vender sem a condição no WHERE.',
            'Taxa de reservas recusadas por falta de saldo, por produto. Um salto indica esgotamento real, e recusas em produtos com saldo alto indicam bug.',
            'Reservas liberadas por expiração em relação às confirmadas. Se passam de um terço, o prazo está curto demais para o meio de pagamento ou o checkout está perdendo clientes no caminho.',
            'Tempo de espera por trava nas linhas de estoque, em p99. Ele antecipa a linha quente antes de o pool de conexões esgotar.',
            'Pedidos confirmados com itens a menos do que foram reservados, que são pagamentos aprovados depois da expiração e precisam de estorno ou nova reserva.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Depois da mudança, a campanha seguinte da mesma cafeteira vendeu as quarenta unidades em quatro minutos, recusou mil e duzentas tentativas com a mensagem de esgotado antes do pagamento e não gerou nenhum estorno por falta de estoque. A consulta de divergência voltou vazia em todos os dias desde então, e as restrições CHECK barraram duas vezes um script antigo de ajuste manual que ninguém lembrava que existia.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Colocar o estoque no Redis não resolve de vez a corrida?',
      answer:
        'O Redis executa um comando por vez, então um DECRBY ou um script Lua que verifica e decrementa é atômico, e a corrida dentro dele desaparece. O problema muda de lugar: o pedido, o pagamento e a reserva continuam no banco relacional, e agora há duas fontes de verdade que precisam concordar. Se o processo cai entre decrementar no Redis e gravar a reserva no banco, a unidade some. Se a reserva expira no banco e ninguém devolve ao Redis, a loja mostra esgotado com produto na prateleira. Redis faz sentido como porta de entrada para cortar tentativas quando o volume é muito maior que o estoque, com o banco ainda decidindo a reserva e um job reconciliando os dois números.',
    },
    {
      question: 'E quando o estoque vem do ERP e não do banco da loja?',
      answer:
        'Então a loja precisa de uma cópia do saldo que ela controla, e o ERP passa a ser a fonte do estoque físico, não da decisão de vender. A loja faz a baixa atômica e a reserva na própria tabela e envia ao ERP os pedidos confirmados. O ERP manda de volta as entradas de mercadoria e as contagens, que ajustam o saldo local por uma operação de incremento, e não sobrescrevendo o número, porque sobrescrever apaga as reservas feitas entre a leitura e a gravação do ERP. Consultar o ERP a cada compra para decidir se há saldo reintroduz a mesma corrida, agora com a latência de uma chamada externa no meio.',
    },
    {
      question: 'Vale a pena permitir vender um pouco além do estoque de propósito?',
      answer:
        'Às vezes vale, e a decisão é de negócio, não de banco. Marketplaces e lojas com reposição rápida aceitam vender algumas unidades a mais porque o custo de um pedido com atraso é menor do que o de mostrar esgotado para quem ia comprar. Se for essa a escolha, faça isso de forma explícita: uma coluna de limite de venda além do saldo por produto, usada na condição do UPDATE, como disponivel + limite_extra >= $q, e um fluxo de atendimento pronto para os pedidos que caírem nessa faixa. O que não pode acontecer é vender a mais por acidente, sem limite e sem saber quantos pedidos foram afetados.',
    },
  ],
  conclusion: {
    title: 'Estoque negativo não é um bug de regra, é uma decisão tomada sobre um valor velho',
    description:
      'Ler o saldo, verificar na aplicação e gravar depois funciona em todos os testes e falha exatamente quando a loja mais vende. A correção é mover a verificação para dentro da escrita, com um UPDATE condicional que só baixa se ainda houver saldo, restrições CHECK como última linha de defesa, reserva com prazo para segurar a unidade durante o pagamento, itens travados sempre na mesma ordem e transações curtas sem chamadas externas. Um teste com compras simultâneas contra o banco real prova a correção, e a comparação diária entre saldo e histórico avisa quando algum caminho novo volta a vender sem passar por ela. Posso revisar o fluxo de checkout e de estoque da sua operação, implementar a baixa atômica e a reserva com expiração e montar os testes e o monitoramento que impedem a corrida de voltar.',
    cta: 'Falar sobre o checkout e o estoque da minha loja',
  },
  related: [
    {
      label: 'Chave de idempotência no checkout: cobrar uma vez sem travar o fluxo',
      to: '/blog/chave-idempotencia-checkout-cobrar-uma-vez-sem-travar-o-fluxo',
    },
    {
      label: 'Réplica de leitura atrasada: quando o usuário salva e não vê o que acabou de salvar',
      to: '/blog/replica-leitura-atrasada-usuario-salva-e-nao-ve-o-que-salvou',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The coffee maker on sale had thirty units in stock. At nine in the evening, the campaign email went out to four hundred thousand customers and, in eleven minutes, the store recorded thirty-four paid orders. The dashboard showed a balance of minus four. The team reviewed the code and found the check in the right place: before saving the order, the system read the balance and only continued if a unit was available. Every test passed, code review had approved it and, in months of normal operation, the problem had never shown up. The four extra customers received an apology email and a refund, two filed public complaints and the partner marketplace suspended the listing for selling without stock. The defect was not in the rule, it was in the gap between reading the balance and writing the decrement, a gap of a few milliseconds that only matters when two people buy the same thing at the same time. This article shows how that race happens, why neither the default isolation level nor your ORM protects you from it, how to make the decrement atomic inside the database, how to reserve stock during payment without holding units forever, how to handle orders with several items and heavily contended products, and how to prove with a test that the race is gone.',
  sections: [
    {
      title: 'How two correct purchases sell the same unit',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common purchase flow has three steps: read the balance, decide in the application whether the sale can go ahead, and write the decrement. Each step is correct on its own. The problem is that, between the first and the third, the database does not promise that the balance stays the same. With one request at a time, this never shows up. With two requests arriving in the same millisecond, both read the same balance, both pass the check and both write.',
        },
        {
          type: 'code',
          value: racyCode,
        },
        {
          type: 'diagram',
          value: `Session 1 (order A)                      Session 2 (order B)
-------------------                      -------------------
SELECT disponivel      -> 1
                                         SELECT disponivel      -> 1
1 >= 1, can sell
                                         1 >= 1, can sell
UPDATE disponivel - 1
COMMIT                 (balance = 0)
                                         UPDATE disponivel - 1
                                         COMMIT                 (balance = -1)`,
        },
        {
          type: 'paragraph',
          value:
            'The window between the SELECT and the UPDATE looks small, but it includes everything the application does in between: calculating shipping, applying a coupon, calling the fraud check, calling the payment gateway. In the coffee maker incident, the code read the balance at the start of checkout and only wrote the decrement after the gateway responded, about one and a half seconds later. With forty buyers per second competing for the last units, the chance of two sessions landing in the same window stopped being rare and became a certainty.',
        },
        {
          type: 'paragraph',
          value:
            'There is an even worse variant. If the UPDATE writes the value calculated by the application, such as SET disponivel = 0, instead of subtracting in the database, both sessions write zero. Stock does not go negative, the dashboard shows an apparently correct balance and two units were sold with only one on the shelf. That is the lost update, and it is the most common form when code uses an ORM that loads the entity, changes the field in memory and calls save. Negative stock at least warns you. The lost update only shows up in the physical inventory count.',
        },
      ],
    },
    {
      title: 'Why the default isolation level and the ORM do not protect you',
      blocks: [
        {
          type: 'paragraph',
          value:
            'It is common to assume that wrapping everything in a transaction solves it. It does not. PostgreSQL, MySQL with InnoDB and most managed databases default to READ COMMITTED or REPEATABLE READ, and neither turns a plain SELECT into a lock. The transaction guarantees that your writes go in together or not at all, not that the value you read is still valid when you write.',
        },
        {
          type: 'table',
          columns: ['Approach', 'Prevents the double sale?', 'Cost and pitfall'],
          rows: [
            [
              'SELECT, check in the application and UPDATE with a calculated value',
              'No. It produces a lost update: balance zero and two sales',
              'It is the ORM pattern of load, modify and save',
            ],
            [
              'SELECT, check in the application and UPDATE with disponivel - 1',
              'No. It produces negative stock',
              'Looks safe because the subtraction happens in the database, but the decision was made on a stale value',
            ],
            [
              'SELECT ... FOR UPDATE followed by UPDATE',
              'Yes',
              'The lock is held during everything the application does between the two statements; if that includes the gateway, the contended product stalls',
            ],
            [
              'Version column with UPDATE ... WHERE versao = $v',
              'Yes',
              'Under contention, almost every attempt fails and must repeat the read; it works for editing records, it suffers during a sale',
            ],
            [
              'SERIALIZABLE transaction',
              'Yes',
              'The database aborts one of the sessions with error 40001 and the application must retry the whole transaction; without a retry loop, it becomes an error for the customer',
            ],
            [
              'Conditional UPDATE: WHERE disponivel >= $q',
              'Yes',
              'One statement, lock held for the minimum time, no retry; it is the recommended baseline',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'What the working approaches have in common is that the check and the write become a single thing for the database. Either the row stays locked between the two, or the database detects the conflict and asks for a retry, or the check moves inside the UPDATE itself. The last one is the cheapest because it does not depend on the application doing anything right afterwards: if the condition no longer holds, the row is simply not updated.',
        },
      ],
    },
    {
      title: 'The atomic decrement: check and subtract in the same statement',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Instead of asking the database how much is left and then telling it to subtract, the application asks directly: subtract if there is still enough. The number of affected rows is the answer. One row means the unit is yours. Zero rows means there was no balance at the moment of the write, whatever balance was read before.',
        },
        {
          type: 'code',
          value: schemaSql,
        },
        {
          type: 'paragraph',
          value:
            'What makes this correct is how UPDATE behaves under concurrency. When the second session tries to update the same row, it waits for the first session\'s lock. As soon as the first one commits, PostgreSQL does not use the row version the second session saw at the beginning: it rereads the newly committed version and re-evaluates the WHERE clause against it. The balance is now zero, the condition disponivel >= 1 is false and the UPDATE finishes without updating anything. In MySQL with InnoDB, UPDATE performs a current read of the locked row and reaches the same result. The lock lasts only for the statement and the transaction around it, not for the whole application logic.',
        },
        {
          type: 'paragraph',
          value:
            'The CHECK (disponivel >= 0) and CHECK (reservado >= 0) constraints are the last line of defense. They do not replace the conditional UPDATE, because they would turn every rejected sale into a constraint violation exception, but they guarantee that no path in the system, be it an adjustment script, an old endpoint nobody remembered or an ERP integration, can write negative stock. If someone forgets the condition in the WHERE clause, the database rejects the write instead of silently accepting it. Adding these constraints to a table that already has negative balances requires fixing the data first, and the failure when creating the constraint is itself a good inventory of how many products have already been oversold.',
        },
      ],
    },
    {
      title: 'Reservations with expiry: holding the unit during payment',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Decrementing stock only after the payment is approved reopens the race somewhere else: the customer enters the card, the gateway approves it and only then does the system discover that the unit is gone, with the money already captured. Decrementing before, with no deadline, creates the opposite problem: abandoned carts and declined payments hold units that will never be sold, and the sale ends with product sitting in the warehouse and a page showing sold out. The solution is to split the balance into two numbers, available and reserved, and give the reservation a deadline.',
        },
        {
          type: 'ordered',
          items: [
            'When payment starts, the conditional UPDATE moves the quantity from available to reserved and writes a row in reservas with expira_em. This is the only step that competes for the unit.',
            'When the payment is approved, the reservation becomes confirmed and the quantity leaves reserved. There is no contention left, because the unit already belongs to the order.',
            'If the deadline passes without payment, a job marks the reservation as released and returns the quantity to available.',
            'A declined payment or a cart cancelled by the customer releases the reservation immediately, through the same path as the job, without waiting for the deadline.',
          ],
        },
        {
          type: 'code',
          value: reserveCode,
        },
        {
          type: 'paragraph',
          value:
            'Three details make this code hold up in production. The UNIQUE (pedido_id, produto_id) constraint makes the reservation idempotent: if the customer double clicks or the front end retries the request after a timeout, the second attempt fails on insert, the ROLLBACK returns what it had decremented and the function answers that the order was already reserved. The transaction makes no external calls, because every millisecond with the row locked is a millisecond in which nobody else can buy that product. And confirmarPedido only confirms reservations that are still active, so the race between the incoming payment and the expiring job has a single winner, decided by the row lock on reservas.',
        },
        {
          type: 'code',
          value: expireSql,
        },
        {
          type: 'paragraph',
          value:
            'The reservation deadline is a product decision with a technical consequence. Fifteen minutes cover card payments and most instant payments. Methods that settle in days, such as bank slips, do not fit this model: either the reservation gets a long deadline and the contended product stays locked up, or the slip does not reserve and the order is confirmed only if there is balance when the payment clears, with an automatic refund when there is not. When confirmarPedido returns fewer items than the order has, that is the path: try to reserve again what expired and, if there is no balance, refund and notify the customer before they find out because nothing was delivered.',
        },
      ],
    },
    {
      title: 'Orders with several items and the product everyone wants',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An order with three products must reserve all three or none, which is why reservarPedido does everything in one transaction and undoes everything if a single item fails. That transaction locks one row per product, and two transactions that lock the same rows in different orders deadlock: order A locks the coffee maker and waits for the grinder, order B locks the grinder and waits for the coffee maker. The database detects the cycle, aborts one of them with an error and the customer sees a failure that has nothing to do with stock. Sorting the items by produto_id before locking removes the cycle, because every transaction takes the locks in the same sequence.',
        },
        {
          type: 'paragraph',
          value:
            'The second problem is the hot row. During the sale, thousands of sessions want to update the same stock row, and the database only allows one at a time. The maximum throughput for that product becomes the inverse of how long each transaction holds the lock. At five milliseconds per reservation, the ceiling is two hundred reservations per second for that item, regardless of how many application servers you have. If the transaction calls the gateway in the middle and holds the lock for one and a half seconds, the ceiling drops below one sale per second, and the connection pool runs out with sessions waiting on the same row.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'When to use it', 'What it costs'],
          rows: [
            [
              'Short transaction with a conditional UPDATE',
              'Almost always; it handles hundreds of reservations per second per product',
              'Nothing beyond keeping external calls out of the transaction',
            ],
            [
              'Balance split into N rows per product',
              'Launches and sales with thousands of reservations per second on the same item',
              'The reservation tries a random shard and, if it is empty, the others; the total becomes a sum, and rebalancing shards requires a job',
            ],
            [
              'In-memory counter as a front gate, such as DECRBY in Redis with an atomic script',
              'When the volume of attempts is far larger than the stock, as in a ticket sale',
              'Two sources of truth: the database is still required for the reservation, and the counter has to be reconciled when reservations expire',
            ],
            [
              'Purchase queue with one consumer per product',
              'When answering please wait is acceptable instead of an immediate yes or no',
              'Latency for the customer and a queue to operate, in exchange for zero contention in the database',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'For most stores, the first row of the table is enough. The coffee maker received forty attempts per second at peak, far below the ceiling of a short transaction. What broke the flow was not the volume, it was the transaction holding the lock while waiting for the gateway. The other strategies are only worth their complexity when measurements show sessions waiting on the same row for a meaningful amount of time, and in PostgreSQL that wait shows up in pg_stat_activity with wait_event_type = Lock on the stock table.',
        },
      ],
    },
    {
      title: 'Proving the race is gone and noticing when it comes back',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A unit test with an in-memory database and one call at a time will never find this defect, and that is exactly why it reached production. The test that matters fires dozens of simultaneous purchases against a real database, with the same engine and the same isolation level as production, and checks the invariants at the end: exactly one sale for one unit, zero balance and no negative number.',
        },
        {
          type: 'code',
          value: raceTestCode,
        },
        {
          type: 'paragraph',
          value:
            'Running this script against the racy version, the result changes on every run: sometimes two sales, sometimes five, sometimes one, which already says a lot about trusting a test that passed once. Against the atomic decrement, it sells one unit and rejects forty-nine on every run. It is worth keeping in the integration pipeline, because the race comes back easily: all it takes is someone creating a new stock adjustment endpoint, an exchange flow or an import that uses the read, decide and save pattern.',
        },
        {
          type: 'paragraph',
          value:
            'In production, the most reliable signal is comparing the balance with the history. The current available plus reserved balance must equal the initial stock minus what was sold since the last count. When the two diverge, some path wrote without going through the atomic decrement.',
        },
        {
          type: 'code',
          value: auditSql,
        },
        {
          type: 'list',
          items: [
            'Violations of the stock CHECK constraints, logged as errors with the originating endpoint. Every violation is a code path that tried to sell without the condition in the WHERE clause.',
            'Rate of reservations rejected for lack of balance, per product. A jump indicates real stockout, and rejections on products with a high balance indicate a bug.',
            'Reservations released by expiry compared to confirmed ones. If they exceed a third, the deadline is too short for the payment method or checkout is losing customers along the way.',
            'Lock wait time on stock rows, at p99. It anticipates the hot row before the connection pool runs out.',
            'Confirmed orders with fewer items than were reserved, which are payments approved after expiry and need a refund or a new reservation.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'After the change, the next campaign for the same coffee maker sold forty units in four minutes, rejected one thousand two hundred attempts with a sold out message before payment and did not generate a single refund for lack of stock. The divergence query has come back empty every day since, and the CHECK constraints twice blocked an old manual adjustment script nobody remembered existed.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Would moving stock to Redis solve the race once and for all?',
      answer:
        'Redis runs one command at a time, so a DECRBY or a Lua script that checks and decrements is atomic, and the race inside it disappears. The problem moves somewhere else: the order, the payment and the reservation are still in the relational database, and now there are two sources of truth that have to agree. If the process crashes between decrementing in Redis and writing the reservation to the database, the unit vanishes. If the reservation expires in the database and nobody returns it to Redis, the store shows sold out with product on the shelf. Redis makes sense as a front gate to cut attempts when the volume is far larger than the stock, with the database still deciding the reservation and a job reconciling the two numbers.',
    },
    {
      question: 'What if the stock comes from the ERP and not from the store database?',
      answer:
        'Then the store needs its own copy of the balance that it controls, and the ERP becomes the source of physical stock, not of the decision to sell. The store performs the atomic decrement and the reservation in its own table and sends confirmed orders to the ERP. The ERP sends back goods receipts and counts, which adjust the local balance through an increment operation, not by overwriting the number, because overwriting erases the reservations made between the ERP read and write. Querying the ERP on every purchase to decide whether there is balance reintroduces the same race, now with the latency of an external call in the middle.',
    },
    {
      question: 'Is it worth deliberately allowing sales slightly beyond the stock?',
      answer:
        'Sometimes it is, and the decision belongs to the business, not the database. Marketplaces and stores with fast restocking accept selling a few extra units because the cost of a delayed order is lower than showing sold out to someone who was about to buy. If that is the choice, make it explicit: a per-product oversell limit column, used in the UPDATE condition, such as disponivel + limite_extra >= $q, and a customer service flow ready for the orders that fall into that range. What must not happen is overselling by accident, with no limit and no idea how many orders were affected.',
    },
  ],
  conclusion: {
    title: 'Negative stock is not a business rule bug, it is a decision made on a stale value',
    description:
      'Reading the balance, checking in the application and writing later works in every test and fails exactly when the store sells the most. The fix is to move the check inside the write, with a conditional UPDATE that only decrements if there is still balance, CHECK constraints as the last line of defense, reservations with a deadline to hold the unit during payment, items always locked in the same order and short transactions with no external calls. A test with simultaneous purchases against the real database proves the fix, and a daily comparison between balance and history warns you when a new path starts selling without going through it. I can review the checkout and stock flow of your operation, implement the atomic decrement and expiring reservations, and set up the tests and monitoring that keep the race from coming back.',
    cta: 'Talk about my store checkout and stock',
  },
  related: [
    {
      label: 'Idempotency key at checkout: charging once without freezing the flow',
      to: '/blog/chave-idempotencia-checkout-cobrar-uma-vez-sem-travar-o-fluxo',
    },
    {
      label: 'The lagging read replica: when users save and do not see what they just saved',
      to: '/blog/replica-leitura-atrasada-usuario-salva-e-nao-ve-o-que-salvou',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/services/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'La cafetera en promoción tenía treinta unidades en stock. A las nueve de la noche, el correo de la campaña salió a cuatrocientos mil clientes y, en once minutos, la tienda registró treinta y cuatro pedidos pagados. El panel mostraba un saldo de menos cuatro. El equipo revisó el código y encontró la verificación en el lugar correcto: antes de guardar el pedido, el sistema leía el saldo y solo seguía si había una unidad disponible. Todas las pruebas pasaban, la revisión de código lo había aprobado y, en meses de operación normal, el problema nunca había aparecido. Los cuatro clientes sobrantes recibieron un correo de disculpas y el reembolso, dos presentaron quejas públicas y el marketplace asociado suspendió el anuncio por vender sin stock. El defecto no estaba en la regla, estaba en el intervalo entre leer el saldo y grabar el descuento, un intervalo de pocos milisegundos que solo importa cuando dos personas compran lo mismo al mismo tiempo. Este artículo muestra cómo ocurre esa carrera, por qué ni el nivel de aislamiento por defecto ni el ORM te protegen de ella, cómo hacer que el descuento sea atómico dentro de la propia base de datos, cómo reservar stock durante el pago sin retener unidades para siempre, cómo tratar pedidos con varios artículos y productos muy disputados, y cómo demostrar con una prueba que la carrera desapareció.',
  sections: [
    {
      title: 'Cómo dos compras correctas venden la misma unidad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El flujo de compra más común tiene tres pasos: leer el saldo, decidir en la aplicación si se puede vender y grabar el descuento. Cada paso es correcto por separado. El problema es que, entre el primero y el tercero, la base de datos no promete que el saldo siga siendo el mismo. Con una solicitud a la vez, esto nunca aparece. Con dos solicitudes llegando en el mismo milisegundo, las dos leen el mismo saldo, las dos pasan la verificación y las dos graban.',
        },
        {
          type: 'code',
          value: racyCode,
        },
        {
          type: 'diagram',
          value: `Sesión 1 (pedido A)                      Sesión 2 (pedido B)
-------------------                      -------------------
SELECT disponivel      -> 1
                                         SELECT disponivel      -> 1
1 >= 1, se puede vender
                                         1 >= 1, se puede vender
UPDATE disponivel - 1
COMMIT                 (saldo = 0)
                                         UPDATE disponivel - 1
                                         COMMIT                 (saldo = -1)`,
        },
        {
          type: 'paragraph',
          value:
            'La ventana entre el SELECT y el UPDATE parece pequeña, pero incluye todo lo que la aplicación hace en el medio: calcular el envío, aplicar un cupón, consultar el antifraude, llamar a la pasarela de pago. En el incidente de la cafetera, el código leía el saldo al inicio del checkout y solo grababa el descuento después de la respuesta de la pasarela, alrededor de un segundo y medio después. Con cuarenta compradores por segundo disputando las últimas unidades, la probabilidad de que dos sesiones cayeran en la misma ventana dejó de ser rara y se volvió una certeza.',
        },
        {
          type: 'paragraph',
          value:
            'Existe una variante todavía peor. Si el UPDATE graba el valor calculado por la aplicación, como SET disponivel = 0, en lugar de restar en la base de datos, las dos sesiones graban cero. El stock no queda negativo, el panel muestra un saldo aparentemente correcto y se vendieron dos unidades con una sola en el estante. Es la actualización perdida, y es la forma más común cuando el código usa un ORM que carga la entidad, cambia el campo en memoria y llama a save. El stock negativo al menos avisa. La actualización perdida solo aparece en el inventario físico.',
        },
      ],
    },
    {
      title: 'Por qué el aislamiento por defecto y el ORM no te protegen',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Es común suponer que meter todo dentro de una transacción lo resuelve. No lo resuelve. PostgreSQL, MySQL con InnoDB y la mayoría de las bases de datos gestionadas usan por defecto READ COMMITTED o REPEATABLE READ, y ninguno de los dos convierte un SELECT común en un bloqueo. La transacción garantiza que tus escrituras entran juntas o no entran, no que el valor que leíste sigue siendo válido cuando escribes.',
        },
        {
          type: 'table',
          columns: ['Enfoque', '¿Impide la venta duplicada?', 'Costo y trampa'],
          rows: [
            [
              'SELECT, verificación en la aplicación y UPDATE con valor calculado',
              'No. Produce una actualización perdida: saldo cero y dos ventas',
              'Es el patrón del ORM de cargar, modificar y guardar',
            ],
            [
              'SELECT, verificación en la aplicación y UPDATE con disponivel - 1',
              'No. Produce stock negativo',
              'Parece seguro porque la resta ocurre en la base de datos, pero la decisión se tomó sobre un valor viejo',
            ],
            [
              'SELECT ... FOR UPDATE y después UPDATE',
              'Sí',
              'El bloqueo queda retenido durante todo lo que la aplicación hace entre las dos instrucciones; si eso incluye la pasarela, el producto disputado se detiene',
            ],
            [
              'Columna de versión con UPDATE ... WHERE versao = $v',
              'Sí',
              'Bajo disputa, casi todos los intentos fallan y deben repetir la lectura; funciona para editar registros, sufre en una promoción',
            ],
            [
              'Transacción SERIALIZABLE',
              'Sí',
              'La base de datos aborta una de las sesiones con el error 40001 y la aplicación debe repetir la transacción entera; sin el bucle de reintento, se convierte en un error para el cliente',
            ],
            [
              'UPDATE condicional: WHERE disponivel >= $q',
              'Sí',
              'Una instrucción, bloqueo por el tiempo mínimo, sin reintento; es la base recomendada',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Lo que tienen en común los enfoques que funcionan es que la verificación y la escritura pasan a ser una sola cosa para la base de datos. O la fila queda bloqueada entre las dos, o la base de datos detecta el conflicto y pide repetir, o la verificación entra en el propio UPDATE. El último es el más barato porque no depende de que la aplicación haga nada bien después: si la condición ya no se cumple, la fila simplemente no se actualiza.',
        },
      ],
    },
    {
      title: 'El descuento atómico: verificar y restar en la misma instrucción',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En lugar de preguntar a la base de datos cuánto queda y después mandar restar, la aplicación pide directamente: resta si todavía hay suficiente. El número de filas afectadas es la respuesta. Una fila significa que la unidad es tuya. Cero filas significa que no había saldo en el momento de la escritura, sin importar el saldo que se leyó antes.',
        },
        {
          type: 'code',
          value: schemaSql,
        },
        {
          type: 'paragraph',
          value:
            'Lo que hace esto correcto es el comportamiento del UPDATE bajo concurrencia. Cuando la segunda sesión intenta actualizar la misma fila, espera el bloqueo de la primera. En cuanto la primera confirma, PostgreSQL no usa la versión de la fila que la segunda vio al inicio: vuelve a leer la versión recién confirmada y reevalúa el WHERE sobre ella. El saldo ahora es cero, la condición disponivel >= 1 es falsa y el UPDATE termina sin actualizar nada. En MySQL con InnoDB, el UPDATE hace una lectura actual de la fila bloqueada y llega al mismo resultado. El bloqueo dura solo el tiempo de la instrucción y de la transacción que la contiene, no el de toda la lógica de la aplicación.',
        },
        {
          type: 'paragraph',
          value:
            'Las restricciones CHECK (disponivel >= 0) y CHECK (reservado >= 0) son la última línea de defensa. No sustituyen al UPDATE condicional, porque convertirían cada venta rechazada en una excepción de violación de restricción, pero garantizan que ningún camino del sistema, ya sea un script de ajuste, un endpoint antiguo que nadie recordaba o una integración con el ERP, pueda grabar stock negativo. Si alguien olvida la condición en el WHERE, la base de datos rechaza la escritura en lugar de aceptarla en silencio. Agregar estas restricciones a una tabla que ya tiene saldos negativos exige corregir los datos antes, y el propio fallo al crear la restricción es un buen inventario de cuántos productos ya se vendieron de más.',
        },
      ],
    },
    {
      title: 'Reserva con caducidad: retener la unidad durante el pago',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Descontar el stock solo después del pago aprobado reabre la carrera en otro lugar: el cliente ingresa la tarjeta, la pasarela aprueba y recién entonces el sistema descubre que la unidad se acabó, con el dinero ya capturado. Descontar antes, sin plazo, crea el problema opuesto: carritos abandonados y pagos rechazados retienen unidades que nunca se venderán, y la promoción termina con producto parado y la página mostrando agotado. La solución es separar el saldo en dos números, disponible y reservado, y darle plazo a la reserva.',
        },
        {
          type: 'ordered',
          items: [
            'Al iniciar el pago, el UPDATE condicional mueve la cantidad de disponible a reservado y graba una fila en reservas con expira_em. Es la única etapa que disputa la unidad.',
            'Con el pago aprobado, la reserva pasa a confirmada y la cantidad sale de reservado. Ya no hay disputa, porque la unidad ya pertenece al pedido.',
            'Si el plazo vence sin pago, un job marca la reserva como liberada y devuelve la cantidad a disponible.',
            'Un pago rechazado o un carrito cancelado por el cliente liberan la reserva en el momento, por el mismo camino del job, sin esperar el plazo.',
          ],
        },
        {
          type: 'code',
          value: reserveCode,
        },
        {
          type: 'paragraph',
          value:
            'Tres detalles hacen que este código aguante producción. La restricción UNIQUE (pedido_id, produto_id) vuelve idempotente la reserva: si el cliente hace doble clic o el front repite la solicitud por timeout, el segundo intento falla en la inserción, el ROLLBACK devuelve lo que había descontado y la función responde que el pedido ya estaba reservado. La transacción no hace ninguna llamada externa, porque cada milisegundo con la fila bloqueada es un milisegundo en que nadie más puede comprar ese producto. Y confirmarPedido solo confirma reservas todavía activas, así que la carrera entre el pago que llega y el job que caduca tiene un único ganador, decidido por el bloqueo de la fila en reservas.',
        },
        {
          type: 'code',
          value: expireSql,
        },
        {
          type: 'paragraph',
          value:
            'El plazo de la reserva es una decisión de producto con consecuencia técnica. Quince minutos cubren el pago con tarjeta y la mayoría de los pagos instantáneos. Los medios que se acreditan en días, como el pago en efectivo con comprobante, no caben en este modelo: o la reserva tiene un plazo largo y el producto disputado queda retenido, o ese medio no reserva y el pedido se confirma solo si hay saldo al acreditarse, con reembolso automático cuando no lo hay. Cuando confirmarPedido devuelve menos artículos de los que tiene el pedido, ese es el camino: intentar reservar de nuevo lo que caducó y, si no hay saldo, reembolsar y avisar al cliente antes de que lo descubra porque no le llegó nada.',
        },
      ],
    },
    {
      title: 'Pedidos con varios artículos y el producto que todos quieren',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un pedido con tres productos debe reservar los tres o ninguno, y por eso reservarPedido hace todo en una transacción y deshace todo si falla un solo artículo. Esa transacción bloquea una fila por producto, y dos transacciones que bloquean las mismas filas en órdenes distintos entran en deadlock: el pedido A bloquea la cafetera y espera el molinillo, el pedido B bloquea el molinillo y espera la cafetera. La base de datos detecta el ciclo, aborta una de las dos con un error y el cliente ve un fallo que no tiene nada que ver con el stock. Ordenar los artículos por produto_id antes de bloquear elimina el ciclo, porque todas las transacciones toman los bloqueos en la misma secuencia.',
        },
        {
          type: 'paragraph',
          value:
            'El segundo problema es la fila caliente. En la promoción, miles de sesiones quieren actualizar la misma fila de stock, y la base de datos solo permite una a la vez. El throughput máximo de ese producto pasa a ser el inverso del tiempo que cada transacción retiene el bloqueo. Con cinco milisegundos por reserva, el techo es de doscientas reservas por segundo en ese artículo, sin importar cuántos servidores de aplicación haya. Si la transacción llama a la pasarela en el medio y retiene el bloqueo durante un segundo y medio, el techo cae a menos de una venta por segundo, y el pool de conexiones se agota con sesiones esperando la misma fila.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Cuándo usarla', 'Qué cuesta'],
          rows: [
            [
              'Transacción corta con UPDATE condicional',
              'Casi siempre; aguanta cientos de reservas por segundo por producto',
              'Nada más que mantener las llamadas externas fuera de la transacción',
            ],
            [
              'Saldo fragmentado en N filas por producto',
              'Lanzamientos y promociones con miles de reservas por segundo en el mismo artículo',
              'La reserva prueba un fragmento aleatorio y, si está vacío, los demás; el total pasa a ser una suma, y rebalancear fragmentos exige un job',
            ],
            [
              'Contador en memoria como puerta de entrada, como DECRBY en Redis con un script atómico',
              'Cuando el volumen de intentos es mucho mayor que el stock, como en una venta de entradas',
              'Dos fuentes de verdad: la base de datos sigue siendo obligatoria para la reserva, y el contador debe reconciliarse cuando las reservas caducan',
            ],
            [
              'Cola de compra con un consumidor por producto',
              'Cuando es aceptable responder espera en lugar de sí o no en el momento',
              'Latencia para el cliente y una cola que operar, a cambio de cero disputa en la base de datos',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'En la mayoría de las tiendas, la primera fila de la tabla es suficiente. La cafetera recibió cuarenta intentos por segundo en el pico, muy por debajo del techo de una transacción corta. Lo que derribó el flujo no fue el volumen, fue la transacción que retenía el bloqueo mientras esperaba la pasarela. Las otras estrategias solo valen su complejidad cuando la medición muestra sesiones esperando la misma fila durante un tiempo relevante, y en PostgreSQL esa espera aparece en pg_stat_activity con wait_event_type = Lock sobre la tabla de stock.',
        },
      ],
    },
    {
      title: 'Demostrar que la carrera desapareció y notar cuando vuelve',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una prueba unitaria con base de datos en memoria y una llamada a la vez nunca va a encontrar este defecto, y justamente por eso llegó a producción. La prueba que importa dispara decenas de compras simultáneas contra una base de datos real, con el mismo motor y el mismo nivel de aislamiento que producción, y verifica los invariantes al final: exactamente una venta para una unidad, saldo cero y ningún número negativo.',
        },
        {
          type: 'code',
          value: raceTestCode,
        },
        {
          type: 'paragraph',
          value:
            'Al ejecutar este script contra la versión con la carrera, el resultado cambia en cada ejecución: a veces dos ventas, a veces cinco, a veces una, lo que ya dice mucho sobre confiar en una prueba que pasó una vez. Contra el descuento atómico, vende una unidad y rechaza cuarenta y nueve en todas las ejecuciones. Vale la pena mantenerla en el pipeline de integración, porque la carrera vuelve con facilidad: basta con que alguien cree un endpoint nuevo de ajuste de stock, un flujo de cambio o una importación que use el patrón de leer, decidir y guardar.',
        },
        {
          type: 'paragraph',
          value:
            'En producción, la señal más confiable es comparar el saldo con el historial. El saldo disponible más el reservado debe ser igual al stock inicial menos lo vendido desde el último conteo. Cuando los dos divergen, algún camino grabó sin pasar por el descuento atómico.',
        },
        {
          type: 'code',
          value: auditSql,
        },
        {
          type: 'list',
          items: [
            'Violaciones de las restricciones CHECK de stock, registradas como error con el endpoint de origen. Cada violación es un camino de código que intentó vender sin la condición en el WHERE.',
            'Tasa de reservas rechazadas por falta de saldo, por producto. Un salto indica agotamiento real, y los rechazos en productos con saldo alto indican un bug.',
            'Reservas liberadas por caducidad frente a las confirmadas. Si superan un tercio, el plazo es demasiado corto para el medio de pago o el checkout está perdiendo clientes en el camino.',
            'Tiempo de espera por bloqueo en las filas de stock, en p99. Anticipa la fila caliente antes de que se agote el pool de conexiones.',
            'Pedidos confirmados con menos artículos de los que se reservaron, que son pagos aprobados después de la caducidad y necesitan reembolso o una nueva reserva.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Después del cambio, la siguiente campaña de la misma cafetera vendió cuarenta unidades en cuatro minutos, rechazó mil doscientos intentos con el mensaje de agotado antes del pago y no generó ningún reembolso por falta de stock. La consulta de divergencia volvió vacía todos los días desde entonces, y las restricciones CHECK bloquearon dos veces un viejo script de ajuste manual que nadie recordaba que existía.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Mover el stock a Redis no resuelve la carrera de una vez?',
      answer:
        'Redis ejecuta un comando a la vez, así que un DECRBY o un script Lua que verifica y descuenta es atómico, y la carrera dentro de él desaparece. El problema cambia de lugar: el pedido, el pago y la reserva siguen en la base de datos relacional, y ahora hay dos fuentes de verdad que deben coincidir. Si el proceso cae entre descontar en Redis y grabar la reserva en la base de datos, la unidad desaparece. Si la reserva caduca en la base de datos y nadie la devuelve a Redis, la tienda muestra agotado con producto en el estante. Redis tiene sentido como puerta de entrada para cortar intentos cuando el volumen es mucho mayor que el stock, con la base de datos todavía decidiendo la reserva y un job reconciliando los dos números.',
    },
    {
      question: '¿Y cuando el stock viene del ERP y no de la base de datos de la tienda?',
      answer:
        'Entonces la tienda necesita una copia propia del saldo que ella controle, y el ERP pasa a ser la fuente del stock físico, no de la decisión de vender. La tienda hace el descuento atómico y la reserva en su propia tabla y envía al ERP los pedidos confirmados. El ERP devuelve las entradas de mercadería y los conteos, que ajustan el saldo local mediante una operación de incremento, y no sobrescribiendo el número, porque sobrescribir borra las reservas hechas entre la lectura y la escritura del ERP. Consultar el ERP en cada compra para decidir si hay saldo reintroduce la misma carrera, ahora con la latencia de una llamada externa en el medio.',
    },
    {
      question: '¿Vale la pena permitir vender un poco más allá del stock a propósito?',
      answer:
        'A veces sí, y la decisión es de negocio, no de base de datos. Los marketplaces y las tiendas con reposición rápida aceptan vender algunas unidades de más porque el costo de un pedido con retraso es menor que el de mostrar agotado a quien iba a comprar. Si esa es la elección, hazlo de forma explícita: una columna de límite de sobreventa por producto, usada en la condición del UPDATE, como disponivel + limite_extra >= $q, y un flujo de atención preparado para los pedidos que caigan en esa franja. Lo que no puede ocurrir es vender de más por accidente, sin límite y sin saber cuántos pedidos se vieron afectados.',
    },
  ],
  conclusion: {
    title: 'El stock negativo no es un bug de regla, es una decisión tomada sobre un valor viejo',
    description:
      'Leer el saldo, verificar en la aplicación y grabar después funciona en todas las pruebas y falla justo cuando la tienda más vende. La corrección es llevar la verificación dentro de la escritura, con un UPDATE condicional que solo descuenta si todavía hay saldo, restricciones CHECK como última línea de defensa, reservas con plazo para retener la unidad durante el pago, artículos bloqueados siempre en el mismo orden y transacciones cortas sin llamadas externas. Una prueba con compras simultáneas contra la base de datos real demuestra la corrección, y la comparación diaria entre saldo e historial avisa cuando algún camino nuevo vuelve a vender sin pasar por ella. Puedo revisar el flujo de checkout y de stock de tu operación, implementar el descuento atómico y las reservas con caducidad, y montar las pruebas y el monitoreo que impiden que la carrera vuelva.',
    cta: 'Hablar sobre el checkout y el stock de mi tienda',
  },
  related: [
    {
      label: 'Clave de idempotencia en el checkout: cobrar una vez sin trabar el flujo',
      to: '/blog/chave-idempotencia-checkout-cobrar-uma-vez-sem-travar-o-fluxo',
    },
    {
      label: 'Réplica de lectura atrasada: cuándo el usuario guarda y no ve lo que acaba de guardar',
      to: '/blog/replica-leitura-atrasada-usuario-salva-e-nao-ve-o-que-salvou',
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
