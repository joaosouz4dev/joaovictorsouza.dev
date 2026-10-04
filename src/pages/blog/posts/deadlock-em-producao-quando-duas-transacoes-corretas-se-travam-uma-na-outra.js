// Conteudo do artigo: deadlock em producao, como o Postgres detecta, ordem de
// aquisicao de locks, outras causas comuns, retry seguro de transacao inteira,
// observabilidade e teste de concorrencia.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const timelineDiagram = `Tempo  Transacao A (Ana paga Bia)           Transacao B (Bia paga Ana)
t1     UPDATE contas ... WHERE id = 1
       (trava a linha da Ana)
t2                                          UPDATE contas ... WHERE id = 2
                                            (trava a linha da Bia)
t3     UPDATE contas ... WHERE id = 2
       (espera B soltar a linha da Bia)
t4                                          UPDATE contas ... WHERE id = 1
                                            (espera A soltar a linha da Ana)
t5     Ninguem avanca: A espera B e B espera A.
       Apos deadlock_timeout (1s) o Postgres aborta uma delas:
       ERROR: deadlock detected (SQLSTATE 40P01)
       A outra transacao termina normalmente.`;

const naiveCode = `// Versao que trava: cada transacao bloqueia as contas na ordem em que chegam
export async function transferir(pool, de, para, valor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE contas SET saldo = saldo - $1 WHERE id = $2', [valor, de]);
    await client.query('UPDATE contas SET saldo = saldo + $1 WHERE id = $2', [valor, para]);
    await client.query('COMMIT');
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro; // com duas transferencias cruzadas, uma chega aqui com erro.code === '40P01'
  } finally {
    client.release();
  }
}`;

const fixedCode = `const RETENTAVEIS = new Set(['40P01', '40001']); // deadlock_detected, serialization_failure

// Executa a funcao inteira em uma transacao e repete a transacao INTEIRA
// quando o banco a escolhe como vitima. Nada com efeito externo roda aqui dentro.
export async function comTransacao(pool, trabalho, { tentativas = 4 } = {}) {
  for (let n = 1; ; n++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const resultado = await trabalho(client);
      await client.query('COMMIT');
      return resultado;
    } catch (erro) {
      await client.query('ROLLBACK').catch(() => {});
      if (!RETENTAVEIS.has(erro.code) || n >= tentativas) throw erro;
    } finally {
      client.release(); // devolve a conexao antes de esperar
    }
    // backoff exponencial com jitter: as vitimas nao voltam todas no mesmo instante
    await new Promise((resolver) => setTimeout(resolver, Math.random() * 25 * 2 ** n));
  }
}

export function transferir(pool, de, para, valor) {
  if (de === para) throw new Error('contas_iguais');
  return comTransacao(pool, async (client) => {
    // Regra de ouro: toda transacao trava as mesmas linhas na mesma ordem (id crescente),
    // nao importa quem paga quem. Um laco de espera circular deixa de ser possivel.
    const { rows } = await client.query(
      'SELECT id, saldo FROM contas WHERE id = ANY($1) ORDER BY id FOR UPDATE',
      [[de, para]],
    );
    if (rows.length !== 2) throw new Error('conta_inexistente');
    const origem = rows.find((linha) => linha.id === de);
    if (Number(origem.saldo) < valor) throw new Error('saldo_insuficiente');

    // As duas linhas ja estao travadas por esta transacao: a ordem dos UPDATEs nao importa mais.
    await client.query('UPDATE contas SET saldo = saldo - $1 WHERE id = $2', [valor, de]);
    await client.query('UPDATE contas SET saldo = saldo + $1 WHERE id = $2', [valor, para]);
  });
}`;

const diagnosticCode = `-- postgresql.conf (ou ALTER SYSTEM): grava no log quem esperou lock por mais de deadlock_timeout
log_lock_waits = on
deadlock_timeout = 1s

-- Por transacao: falha rapido em vez de esperar indefinidamente por uma linha
SET LOCAL lock_timeout = '5s';

-- Agora: quem esta bloqueado, por quem e ha quanto tempo
SELECT a.pid,
       pg_blocking_pids(a.pid)          AS bloqueado_por,
       a.wait_event_type,
       now() - a.xact_start             AS idade_da_transacao,
       left(a.query, 80)                AS consulta
FROM pg_stat_activity a
WHERE cardinality(pg_blocking_pids(a.pid)) > 0;

-- Acumulado: quantos deadlocks este banco ja detectou (exponha como metrica e alerte na derivada)
SELECT datname, deadlocks FROM pg_stat_database WHERE datname = current_database();`;

const testCode = `import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { transferir } from './transferir.js';

test('transferencias cruzadas em paralelo terminam sem erro e sem perder dinheiro', async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });
  await pool.query('TRUNCATE contas');
  await pool.query('INSERT INTO contas (id, saldo) VALUES (1, 100000), (2, 100000)');

  // 200 transferencias, metade em cada sentido, todas disparadas ao mesmo tempo
  const disparos = Array.from({ length: 200 }, (_, i) =>
    i % 2 === 0 ? transferir(pool, 1, 2, 10) : transferir(pool, 2, 1, 10),
  );
  const resultados = await Promise.allSettled(disparos);

  const falhas = resultados.filter((r) => r.status === 'rejected');
  assert.equal(falhas.length, 0, falhas.map((f) => f.reason.code).join(','));

  const { rows } = await pool.query('SELECT sum(saldo)::int AS total FROM contas');
  assert.equal(rows[0].total, 200000); // o total nunca muda em transferencia entre contas
  await pool.end();
});`;

const pt = {
  intro:
    'Uma carteira digital que faz repasses a vendedores começou a receber um chamado intermitente: a transferência falhou, tente de novo. Os logs da API mostravam ERROR: deadlock detected em cerca de 3% das transferências nos horários de pico, e no fechamento do mês, quando o job de repasses rodava junto com os pagamentos dos clientes, chegava a 11%. O código estava correto: cada transferência abria uma transação, debitava uma conta, creditava outra e confirmava. Testada sozinha, nunca falhava. O problema só existe quando duas transações corretas, cada uma isoladamente, precisam das mesmas linhas em ordens opostas. Este artigo mostra como o banco detecta e resolve esse impasse, como reproduzir o problema, por que ordenar a aquisição dos locks o elimina na raiz, quais outras construções comuns também o provocam, como repetir a transação com segurança quando mesmo assim ela for escolhida como vítima e como enxergar e provar tudo isso.',
  sections: [
    {
      title: 'O que é um deadlock e o que o banco faz quando encontra um',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um deadlock é uma espera circular: a transação A segura um lock que B precisa e B segura um lock que A precisa. Nenhuma das duas pode avançar, e esperar mais não resolve nada. Não é lentidão nem falta de recurso, é um impasse lógico entre transações que fazem exatamente o que deveriam fazer. Por isso ele não aparece em teste unitário, em ambiente de desenvolvimento nem com tráfego baixo: depende de duas transações sobrepostas no tempo, tocando as mesmas linhas em ordens diferentes.',
        },
        {
          type: 'diagram',
          value: timelineDiagram,
        },
        {
          type: 'paragraph',
          value:
            'O PostgreSQL não impede o deadlock, ele o detecta. Quando uma transação espera um lock por mais de deadlock_timeout, que por padrão é 1 segundo, o banco percorre o grafo de quem espera quem. Se encontra um ciclo, aborta uma das transações do ciclo com o erro 40P01 e deixa as outras seguirem. Duas consequências práticas: o usuário da transação escolhida como vítima espera pelo menos um segundo antes de receber o erro, e a transação vítima desfaz todo o trabalho já feito, inclusive o que não tinha relação com o conflito. O MySQL com InnoDB faz o equivalente, detecta o ciclo e devolve o erro 1213, e o SQL Server escolhe uma vítima e devolve o erro 1205.',
        },
        {
          type: 'table',
          columns: ['O que você observa', 'O que está acontecendo', 'Onde olhar'],
          rows: [
            ['ERROR: deadlock detected, SQLSTATE 40P01', 'Ciclo de espera detectado, esta transação foi a vítima', 'Log do banco, que lista os processos, as consultas e os locks envolvidos'],
            ['Requisições que demoram exatamente 1 segundo a mais e depois falham', 'A vítima esperou deadlock_timeout antes de ser abortada', 'Latência p99 com degraus em torno de 1 s'],
            ['Requisições lentas sem erro e sem ciclo', 'Espera longa por lock, não deadlock: alguém segura a linha por tempo demais', 'pg_blocking_pids e idade da transação'],
            ['Falha só em horário de pico ou em job em lote', 'A janela de sobreposição só fica grande com carga ou com lote', 'Correlacionar os erros com a agenda dos jobs'],
          ],
        },
      ],
    },
    {
      title: 'Reproduzindo: duas transferências corretas em sentidos opostos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O código abaixo é o que a maioria das equipes escreve, e ele está certo para qualquer execução isolada. Ana paga Bia e, no mesmo instante, Bia paga Ana. A transação A trava a linha da Ana e depois pede a da Bia. A transação B trava a linha da Bia e depois pede a da Ana. É exatamente a linha do tempo do diagrama.',
        },
        {
          type: 'code',
          value: naiveCode,
        },
        {
          type: 'paragraph',
          value:
            'A ordem em que os locks são adquiridos é decidida pelos parâmetros da chamada, ou seja, pelo usuário. Cada transferência impõe uma ordem diferente, e o banco não tem como saber que as duas deveriam concordar. É a mesma natureza da condição de corrida do estoque negativo: o defeito é de coordenação, não de lógica de negócio, e só se manifesta com concorrência real.',
        },
      ],
    },
    {
      title: 'A correção na raiz: toda transação trava as mesmas linhas na mesma ordem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Se todas as transações que precisam das contas 1 e 2 travarem primeiro a 1 e depois a 2, uma espera circular é impossível: quem chega depois simplesmente espera quem chegou antes. O critério de ordenação pode ser qualquer um, desde que seja total e igual para todos, e o id da linha é o mais simples. O código a seguir faz isso com um único SELECT ... ORDER BY id FOR UPDATE, que adquire os locks na ordem do ORDER BY, e depois aplica as alterações com as duas linhas já protegidas.',
        },
        {
          type: 'code',
          value: fixedCode,
        },
        {
          type: 'list',
          items: [
            'O ORDER BY no SELECT FOR UPDATE é o que define a ordem dos locks. Um UPDATE de várias linhas sem esse cuidado trava na ordem em que o plano de execução varre a tabela, que não é garantida e pode mudar com um novo índice ou com estatísticas atualizadas.',
            'Travar todas as linhas necessárias no início da transação, antes de qualquer decisão, reduz a janela em que outra transação consegue entrar no meio, e o saldo lido já é o saldo travado, o que também elimina a corrida de leitura seguida de escrita.',
            'A ordenação precisa valer para todos os caminhos de código que tocam essas tabelas: a API, o job de repasses, o estorno, o script de correção. Um único caminho que trave em outra ordem reabre o problema.',
            'Quando a transação toca tabelas diferentes, a regra se estende: escolha uma ordem global entre tabelas, por exemplo sempre pedidos antes de itens e itens antes de estoque, e documente.',
          ],
        },
      ],
    },
    {
      title: 'Outras causas comuns além da ordem das contas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O exemplo da transferência é o mais didático, mas em sistemas reais o ciclo costuma estar escondido em construções que parecem inocentes. As quatro abaixo explicam a maior parte dos deadlocks que chegam ao log.',
        },
        {
          type: 'table',
          columns: ['Construção', 'Por que forma um ciclo', 'Correção'],
          rows: [
            [
              'UPDATE ou DELETE em lote sem ordem definida',
              'Dois lotes que cobrem linhas em comum percorrem a tabela em ordens diferentes e travam linhas cruzadas',
              'SELECT id ... ORDER BY id FOR UPDATE antes, ou processar em pedaços pequenos sempre em ordem de id',
            ],
            [
              'INSERT ... ON CONFLICT DO UPDATE em lote',
              'Duas requisições inserem os mesmos conjuntos de chaves em ordens diferentes e cada uma trava as chaves da outra',
              'Ordenar as linhas pela chave única antes de enviar o lote',
            ],
            [
              'Chave estrangeira com atualização no pai',
              'Um INSERT no filho trava a linha do pai com FOR KEY SHARE, e um UPDATE de coluna chave ou SELECT FOR UPDATE no pai conflita com ele',
              'Travar o pai primeiro em toda transação que mexe em pai e filho, e criar índice nas colunas de chave estrangeira para encurtar a janela de lock',
            ],
            [
              'Transação longa com chamada externa dentro',
              'Os locks ficam seguros enquanto a transação espera uma API de terceiros, e a janela de sobreposição cresce de milissegundos para segundos',
              'Fazer a chamada externa antes ou depois da transação, nunca dentro',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha da tabela é a mais traiçoeira porque não é um problema de ordem, é de duração. Todo deadlock precisa que duas transações coexistam segurando locks, e quanto mais tempo cada uma segura, maior a probabilidade. Encurtar a transação, fazendo só o que precisa ser atômico dentro dela, reduz a frequência de todos os tipos de deadlock ao mesmo tempo, inclusive os que você ainda não descobriu.',
        },
      ],
    },
    {
      title: 'Quando mesmo assim acontece: repetir a transação inteira, com limite',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo com a ordem correta, ainda é possível ter um deadlock raro vindo de um caminho que você não controla, como um gatilho, uma extensão ou uma consulta de relatório. Os erros 40P01 e 40001 têm a propriedade de que a transação inteira foi desfeita e não deixou efeito algum, então repeti-la é seguro. O ponto essencial é repetir a transação inteira, desde o BEGIN, e não apenas o comando que falhou: depois do erro, a transação está em estado abortado e as leituras anteriores podem já não ser válidas. A função comTransacao do código acima faz exatamente isso, com no máximo quatro tentativas, backoff exponencial e jitter para que as vítimas não voltem todas no mesmo instante e formem um novo ciclo.',
        },
        {
          type: 'list',
          items: [
            'Nada com efeito externo dentro da função repetida: e-mail, chamada de API, publicação em fila ou escrita em cache rodam depois do COMMIT. Uma transação repetida três vezes que enviou três e-mails não é segura de repetir.',
            'Repita apenas os códigos que significam conflito de concorrência, 40P01 e 40001. Violação de unicidade, saldo insuficiente e erro de sintaxe voltariam a falhar do mesmo jeito e só escondem o defeito.',
            'Limite as tentativas e deixe o erro subir depois delas. Retry sem limite transforma um problema de ordem de locks em uma tempestade de repetições que piora a carga que o causou.',
            'Meça a taxa de retry como métrica. Um retry que funciona em silêncio esconde um deadlock que deveria ter sido corrigido: o número de repetições por minuto precisa ser baixo e estável, e um aumento é um alerta.',
          ],
        },
      ],
    },
    {
      title: 'Enxergar e provar: logs, métricas e um teste de concorrência',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Deadlock sem observabilidade vira um erro 500 sem explicação. Com log_lock_waits ligado, o Postgres registra no log quem esperou lock além do deadlock_timeout, e a mensagem de deadlock lista os processos, as consultas e os locks do ciclo, o que normalmente aponta direto para as duas linhas de código culpadas. O contador deadlocks de pg_stat_database é um acumulado por banco: exporte-o como métrica e alerte sobre a derivada, não sobre o valor absoluto. O lock_timeout por transação complementa a defesa, porque limita a espera por uma linha mesmo quando não há ciclo, o caso de uma transação esquecida aberta.',
        },
        {
          type: 'code',
          value: diagnosticCode,
        },
        {
          type: 'paragraph',
          value:
            'Para provar que a correção funciona, o teste precisa produzir a concorrência que o ambiente de desenvolvimento nunca produz. O teste abaixo dispara 200 transferências cruzadas ao mesmo tempo contra um banco real e exige que nenhuma falhe e que a soma dos saldos continue igual. Com a versão ingênua do início do artigo, ele falha de forma consistente com o código 40P01, o que também serve para provar que o teste realmente reproduz o defeito. Rode-o contra um Postgres de verdade, em contêiner, e não contra um banco em memória: o comportamento de locks é justamente o que muda entre eles.',
        },
        {
          type: 'code',
          value: testCode,
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Aumentar o deadlock_timeout resolve?',
      answer:
        'Não. Esse parâmetro só controla quanto tempo o banco espera antes de procurar um ciclo, então aumentá-lo apenas atrasa a detecção: cada deadlock passa a segurar locks e conexões por mais tempo antes de ser resolvido. Reduzi-lo muito também não ajuda, porque a verificação de ciclo tem custo. O valor padrão de 1 segundo é razoável para quase todos os casos, e a solução está na ordem dos locks e na duração das transações.',
    },
    {
      question: 'Posso tratar tudo com retry e ignorar a causa?',
      answer:
        'Não é recomendável. O retry torna o deadlock invisível para o usuário, mas cada ocorrência custa pelo menos um segundo de espera, desfaz trabalho e consome conexões. Com carga alta, a taxa de deadlocks cresce mais rápido que a de requisições e o retry passa a gerar a própria tempestade. Use o retry como rede de segurança para o deadlock raro, e a ordenação dos locks como correção da causa.',
    },
    {
      question: 'Isso vale para outros bancos e para ORMs?',
      answer:
        'Sim. MySQL com InnoDB, SQL Server e Oracle também têm deadlocks por espera circular e também resolvem escolhendo uma vítima, mudando apenas o código do erro e os detalhes de quais comandos travam o quê. Um ORM não muda o problema: ele apenas esconde a ordem em que as linhas são tocadas. Se o ORM salva vários objetos em uma transação, ordene os objetos pela chave antes de salvar e use a opção de bloqueio pessimista do ORM com a mesma regra de ordem.',
    },
  ],
  conclusion: {
    title: 'Deadlock é um defeito de coordenação, não de lógica',
    description:
      'Duas transações corretas podem se travar uma na outra porque o banco não sabe que elas deveriam concordar sobre a ordem. A correção é concordar por ele: toda transação trava as mesmas linhas na mesma ordem, faz só o necessário enquanto segura os locks e, para o caso raro que sobrar, é repetida inteira com limite e métrica. Com log de esperas, contador de deadlocks e um teste de concorrência no CI, o erro intermitente de pico deixa de ser um mistério e passa a ser algo que se previne e se mede.',
    cta: 'Falar sobre os deadlocks do meu sistema',
  },
  related: [
    {
      label: 'Estoque negativo: a condição de corrida entre duas compras do último item',
      to: '/blog/estoque-negativo-condicao-de-corrida-entre-duas-compras-do-ultimo-item',
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
    'A digital wallet that pays out sellers started getting an intermittent support ticket: the transfer failed, please try again. The API logs showed ERROR: deadlock detected on about 3% of transfers at peak hours, and at month end, when the payout job ran alongside customer payments, it reached 11%. The code was correct: each transfer opened a transaction, debited one account, credited another and committed. Tested alone, it never failed. The problem only exists when two transactions, each correct on its own, need the same rows in opposite orders. This article shows how the database detects and resolves that standoff, how to reproduce it, why ordering lock acquisition removes it at the root, which other common constructs also cause it, how to retry the transaction safely when it is still picked as the victim, and how to see and prove all of it.',
  sections: [
    {
      title: 'What a deadlock is and what the database does when it finds one',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A deadlock is a circular wait: transaction A holds a lock that B needs and B holds a lock that A needs. Neither can move forward, and waiting longer solves nothing. It is not slowness or lack of resources, it is a logical standoff between transactions doing exactly what they should. That is why it does not show up in unit tests, in development environments or under low traffic: it needs two transactions overlapping in time and touching the same rows in different orders.',
        },
        {
          type: 'diagram',
          value: timelineDiagram,
        },
        {
          type: 'paragraph',
          value:
            'PostgreSQL does not prevent deadlocks, it detects them. When a transaction waits for a lock longer than deadlock_timeout, which defaults to 1 second, the database walks the graph of who waits for whom. If it finds a cycle, it aborts one of the transactions in the cycle with error 40P01 and lets the others proceed. Two practical consequences: the user of the victim transaction waits at least one second before seeing the error, and the victim undoes all the work already done, including work unrelated to the conflict. MySQL with InnoDB does the equivalent, detecting the cycle and returning error 1213, and SQL Server picks a victim and returns error 1205.',
        },
        {
          type: 'table',
          columns: ['What you observe', 'What is happening', 'Where to look'],
          rows: [
            ['ERROR: deadlock detected, SQLSTATE 40P01', 'A wait cycle was detected and this transaction was the victim', 'Database log, which lists the processes, queries and locks involved'],
            ['Requests that take exactly 1 second longer and then fail', 'The victim waited deadlock_timeout before being aborted', 'p99 latency with steps around 1 s'],
            ['Slow requests with no error and no cycle', 'A long lock wait, not a deadlock: someone holds the row for too long', 'pg_blocking_pids and transaction age'],
            ['Failures only at peak hours or during a batch job', 'The overlap window only grows large with load or with batches', 'Correlate the errors with the job schedule'],
          ],
        },
      ],
    },
    {
      title: 'Reproducing it: two correct transfers in opposite directions',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The code below is what most teams write, and it is right for any single execution. Ana pays Bia and, at the same instant, Bia pays Ana. Transaction A locks the row of Ana and then asks for the row of Bia. Transaction B locks the row of Bia and then asks for the row of Ana. It is exactly the timeline in the diagram.',
        },
        {
          type: 'code',
          value: naiveCode,
        },
        {
          type: 'paragraph',
          value:
            'The order in which locks are acquired is decided by the call parameters, that is, by the user. Each transfer imposes a different order, and the database has no way to know the two should agree. It is the same nature as the race condition behind negative stock: the defect is one of coordination, not of business logic, and it only shows up under real concurrency.',
        },
      ],
    },
    {
      title: 'The fix at the root: every transaction locks the same rows in the same order',
      blocks: [
        {
          type: 'paragraph',
          value:
            'If every transaction that needs accounts 1 and 2 locks 1 first and then 2, a circular wait is impossible: whoever arrives later simply waits for whoever arrived first. The ordering criterion can be anything, as long as it is total and the same for everyone, and the row id is the simplest. The code below does this with a single SELECT ... ORDER BY id FOR UPDATE, which acquires locks in the ORDER BY order, and then applies the changes with both rows already protected.',
        },
        {
          type: 'code',
          value: fixedCode,
        },
        {
          type: 'list',
          items: [
            'The ORDER BY in the SELECT FOR UPDATE is what defines the lock order. A multi-row UPDATE without it locks in the order the execution plan scans the table, which is not guaranteed and can change with a new index or refreshed statistics.',
            'Locking every needed row at the start of the transaction, before any decision, shrinks the window in which another transaction can step in, and the balance read is already the locked balance, which also removes the read-then-write race.',
            'The ordering must hold for every code path that touches these tables: the API, the payout job, the refund, the fix-up script. A single path that locks in another order reopens the problem.',
            'When the transaction touches different tables the rule extends: pick a global order across tables, for example always orders before items and items before stock, and document it.',
          ],
        },
      ],
    },
    {
      title: 'Other common causes beyond account order',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The transfer example is the most didactic, but in real systems the cycle is usually hidden in constructs that look harmless. The four below explain most of the deadlocks that reach the log.',
        },
        {
          type: 'table',
          columns: ['Construct', 'Why it forms a cycle', 'Fix'],
          rows: [
            [
              'UPDATE or DELETE in bulk with no defined order',
              'Two batches covering rows in common scan the table in different orders and lock crossed rows',
              'SELECT id ... ORDER BY id FOR UPDATE first, or process in small chunks always in id order',
            ],
            [
              'INSERT ... ON CONFLICT DO UPDATE in bulk',
              'Two requests insert the same sets of keys in different orders and each locks the keys of the other',
              'Sort the rows by the unique key before sending the batch',
            ],
            [
              'Foreign key with an update on the parent',
              'An INSERT on the child locks the parent row with FOR KEY SHARE, and an update of a key column or a SELECT FOR UPDATE on the parent conflicts with it',
              'Lock the parent first in every transaction that touches parent and child, and index the foreign key columns to shorten the lock window',
            ],
            [
              'Long transaction with an external call inside',
              'Locks stay held while the transaction waits for a third-party API, and the overlap window grows from milliseconds to seconds',
              'Make the external call before or after the transaction, never inside it',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row of the table is the sneakiest because it is not an ordering problem, it is a duration problem. Every deadlock needs two transactions coexisting while holding locks, and the longer each holds them, the higher the probability. Shortening the transaction, doing only what must be atomic inside it, reduces the frequency of every type of deadlock at once, including those you have not found yet.',
        },
      ],
    },
    {
      title: 'When it still happens: retry the whole transaction, with a limit',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Even with the right order, a rare deadlock can still come from a path you do not control, such as a trigger, an extension or a reporting query. Errors 40P01 and 40001 have the property that the whole transaction was undone and left no effect, so retrying it is safe. The essential point is to retry the entire transaction, from BEGIN, and not only the failed statement: after the error the transaction is in an aborted state and earlier reads may no longer be valid. The comTransacao function in the code above does exactly this, with at most four attempts, exponential backoff and jitter so the victims do not all return at the same instant and form a new cycle.',
        },
        {
          type: 'list',
          items: [
            'Nothing with an external effect inside the retried function: email, API calls, queue publishing or cache writes run after the COMMIT. A transaction retried three times that sent three emails is not safe to retry.',
            'Retry only the codes that mean a concurrency conflict, 40P01 and 40001. Unique violations, insufficient balance and syntax errors would fail the same way again and only hide the defect.',
            'Limit the attempts and let the error surface after them. Unlimited retry turns a lock ordering problem into a retry storm that worsens the load that caused it.',
            'Measure the retry rate as a metric. A retry that works silently hides a deadlock that should have been fixed: the number of retries per minute must be low and steady, and an increase is an alert.',
          ],
        },
      ],
    },
    {
      title: 'Seeing and proving it: logs, metrics and a concurrency test',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A deadlock without observability becomes an unexplained 500 error. With log_lock_waits on, Postgres logs who waited for a lock beyond deadlock_timeout, and the deadlock message lists the processes, queries and locks in the cycle, which usually points straight at the two guilty lines of code. The deadlocks counter in pg_stat_database is a per-database accumulator: export it as a metric and alert on the derivative, not on the absolute value. A per-transaction lock_timeout completes the defense, because it bounds the wait for a row even when there is no cycle, the case of a forgotten open transaction.',
        },
        {
          type: 'code',
          value: diagnosticCode,
        },
        {
          type: 'paragraph',
          value:
            'To prove the fix works, the test must produce the concurrency that the development environment never produces. The test below fires 200 crossed transfers at the same time against a real database and requires that none fail and that the sum of balances stays the same. With the naive version from the start of the article it fails consistently with code 40P01, which also proves the test really reproduces the defect. Run it against a real Postgres in a container, not an in-memory database: lock behavior is exactly what differs between them.',
        },
        {
          type: 'code',
          value: testCode,
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does increasing deadlock_timeout fix it?',
      answer:
        'No. That parameter only controls how long the database waits before looking for a cycle, so raising it just delays detection: each deadlock holds locks and connections for longer before being resolved. Lowering it too far does not help either, because the cycle check has a cost. The default of 1 second is reasonable for almost every case, and the solution lies in lock order and transaction duration.',
    },
    {
      question: 'Can I handle everything with retry and ignore the cause?',
      answer:
        'It is not recommended. Retry makes the deadlock invisible to the user, but each occurrence costs at least a second of waiting, undoes work and consumes connections. Under high load the deadlock rate grows faster than the request rate and retry starts generating its own storm. Use retry as a safety net for the rare deadlock, and lock ordering as the fix for the cause.',
    },
    {
      question: 'Does this apply to other databases and to ORMs?',
      answer:
        'Yes. MySQL with InnoDB, SQL Server and Oracle also have circular-wait deadlocks and also resolve them by picking a victim, changing only the error code and the details of which statements lock what. An ORM does not change the problem: it only hides the order in which rows are touched. If the ORM saves several objects in one transaction, sort the objects by key before saving and use the pessimistic locking option of the ORM with the same ordering rule.',
    },
  ],
  conclusion: {
    title: 'A deadlock is a coordination defect, not a logic defect',
    description:
      'Two correct transactions can lock each other up because the database does not know they should agree on the order. The fix is to agree for it: every transaction locks the same rows in the same order, does only what is necessary while holding locks and, for the rare case that remains, is retried whole with a limit and a metric. With a lock wait log, a deadlock counter and a concurrency test in CI, the intermittent peak error stops being a mystery and becomes something you prevent and measure.',
    cta: 'Talk about the deadlocks in my system',
  },
  related: [
    {
      label: 'Negative stock: the race condition between two purchases of the last item',
      to: '/blog/estoque-negativo-condicao-de-corrida-entre-duas-compras-do-ultimo-item',
    },
    {
      label: 'The scheduled job that runs twice: distributed mutual exclusion without a lock held forever',
      to: '/blog/job-agendado-que-roda-duas-vezes-exclusao-mutua-distribuida-sem-trava-eterna',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Una billetera digital que hace pagos a vendedores empezó a recibir un ticket intermitente: la transferencia falló, inténtalo de nuevo. Los logs de la API mostraban ERROR: deadlock detected en cerca del 3% de las transferencias en horas pico, y en el cierre de mes, cuando el job de pagos corría junto con los pagos de los clientes, llegaba al 11%. El código era correcto: cada transferencia abría una transacción, debitaba una cuenta, acreditaba otra y confirmaba. Probada sola, nunca fallaba. El problema solo existe cuando dos transacciones, correctas cada una por separado, necesitan las mismas filas en órdenes opuestos. Este artículo muestra cómo la base de datos detecta y resuelve ese impasse, cómo reproducirlo, por qué ordenar la adquisición de locks lo elimina de raíz, qué otras construcciones comunes también lo provocan, cómo repetir la transacción con seguridad cuando aun así es elegida como víctima y cómo ver y demostrar todo esto.',
  sections: [
    {
      title: 'Qué es un deadlock y qué hace la base de datos cuando encuentra uno',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un deadlock es una espera circular: la transacción A tiene un lock que B necesita y B tiene un lock que A necesita. Ninguna puede avanzar, y esperar más no resuelve nada. No es lentitud ni falta de recursos, es un impasse lógico entre transacciones que hacen exactamente lo que deberían hacer. Por eso no aparece en una prueba unitaria, en un entorno de desarrollo ni con poco tráfico: depende de dos transacciones superpuestas en el tiempo, tocando las mismas filas en órdenes distintos.',
        },
        {
          type: 'diagram',
          value: timelineDiagram,
        },
        {
          type: 'paragraph',
          value:
            'PostgreSQL no impide el deadlock, lo detecta. Cuando una transacción espera un lock más de deadlock_timeout, que por defecto es 1 segundo, la base recorre el grafo de quién espera a quién. Si encuentra un ciclo, aborta una de las transacciones del ciclo con el error 40P01 y deja seguir a las demás. Dos consecuencias prácticas: el usuario de la transacción elegida como víctima espera al menos un segundo antes de recibir el error, y la víctima deshace todo el trabajo ya hecho, incluido el que no tenía relación con el conflicto. MySQL con InnoDB hace el equivalente, detecta el ciclo y devuelve el error 1213, y SQL Server elige una víctima y devuelve el error 1205.',
        },
        {
          type: 'table',
          columns: ['Lo que observas', 'Lo que está pasando', 'Dónde mirar'],
          rows: [
            ['ERROR: deadlock detected, SQLSTATE 40P01', 'Se detectó un ciclo de espera y esta transacción fue la víctima', 'Log de la base, que lista los procesos, las consultas y los locks involucrados'],
            ['Solicitudes que tardan exactamente 1 segundo más y luego fallan', 'La víctima esperó deadlock_timeout antes de ser abortada', 'Latencia p99 con escalones alrededor de 1 s'],
            ['Solicitudes lentas sin error y sin ciclo', 'Espera larga por un lock, no deadlock: alguien retiene la fila demasiado tiempo', 'pg_blocking_pids y edad de la transacción'],
            ['Fallas solo en hora pico o en un job por lotes', 'La ventana de superposición solo se agranda con carga o con lotes', 'Correlacionar los errores con la agenda de los jobs'],
          ],
        },
      ],
    },
    {
      title: 'Reproduciéndolo: dos transferencias correctas en sentidos opuestos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El código siguiente es lo que escribe la mayoría de los equipos, y es correcto para cualquier ejecución aislada. Ana le paga a Bia y, en el mismo instante, Bia le paga a Ana. La transacción A bloquea la fila de Ana y luego pide la de Bia. La transacción B bloquea la fila de Bia y luego pide la de Ana. Es exactamente la línea de tiempo del diagrama.',
        },
        {
          type: 'code',
          value: naiveCode,
        },
        {
          type: 'paragraph',
          value:
            'El orden en que se adquieren los locks lo deciden los parámetros de la llamada, es decir, el usuario. Cada transferencia impone un orden distinto, y la base de datos no tiene cómo saber que las dos deberían coincidir. Es de la misma naturaleza que la condición de carrera del stock negativo: el defecto es de coordinación, no de lógica de negocio, y solo se manifiesta con concurrencia real.',
        },
      ],
    },
    {
      title: 'La corrección de raíz: toda transacción bloquea las mismas filas en el mismo orden',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Si todas las transacciones que necesitan las cuentas 1 y 2 bloquean primero la 1 y luego la 2, una espera circular es imposible: quien llega después simplemente espera a quien llegó antes. El criterio de orden puede ser cualquiera, siempre que sea total e igual para todos, y el id de la fila es el más simple. El código siguiente lo hace con un único SELECT ... ORDER BY id FOR UPDATE, que adquiere los locks en el orden del ORDER BY, y luego aplica los cambios con las dos filas ya protegidas.',
        },
        {
          type: 'code',
          value: fixedCode,
        },
        {
          type: 'list',
          items: [
            'El ORDER BY en el SELECT FOR UPDATE es lo que define el orden de los locks. Un UPDATE de varias filas sin ese cuidado bloquea en el orden en que el plan de ejecución recorre la tabla, que no está garantizado y puede cambiar con un nuevo índice o con estadísticas actualizadas.',
            'Bloquear todas las filas necesarias al inicio de la transacción, antes de cualquier decisión, reduce la ventana en que otra transacción puede entrar en el medio, y el saldo leído ya es el saldo bloqueado, lo que también elimina la carrera de lectura seguida de escritura.',
            'El orden debe valer para todos los caminos de código que tocan esas tablas: la API, el job de pagos, el reembolso, el script de corrección. Un solo camino que bloquee en otro orden reabre el problema.',
            'Cuando la transacción toca tablas distintas la regla se extiende: elige un orden global entre tablas, por ejemplo siempre pedidos antes de ítems e ítems antes de stock, y documéntalo.',
          ],
        },
      ],
    },
    {
      title: 'Otras causas comunes además del orden de las cuentas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El ejemplo de la transferencia es el más didáctico, pero en sistemas reales el ciclo suele estar escondido en construcciones que parecen inocentes. Las cuatro siguientes explican la mayoría de los deadlocks que llegan al log.',
        },
        {
          type: 'table',
          columns: ['Construcción', 'Por qué forma un ciclo', 'Corrección'],
          rows: [
            [
              'UPDATE o DELETE en lote sin orden definido',
              'Dos lotes que cubren filas en común recorren la tabla en órdenes distintos y bloquean filas cruzadas',
              'SELECT id ... ORDER BY id FOR UPDATE antes, o procesar en trozos pequeños siempre en orden de id',
            ],
            [
              'INSERT ... ON CONFLICT DO UPDATE en lote',
              'Dos solicitudes insertan los mismos conjuntos de claves en órdenes distintos y cada una bloquea las claves de la otra',
              'Ordenar las filas por la clave única antes de enviar el lote',
            ],
            [
              'Clave foránea con actualización en el padre',
              'Un INSERT en el hijo bloquea la fila del padre con FOR KEY SHARE, y un UPDATE de columna clave o un SELECT FOR UPDATE en el padre choca con él',
              'Bloquear primero el padre en toda transacción que toque padre e hijo, e indexar las columnas de clave foránea para acortar la ventana de lock',
            ],
            [
              'Transacción larga con una llamada externa dentro',
              'Los locks quedan retenidos mientras la transacción espera una API de terceros, y la ventana de superposición crece de milisegundos a segundos',
              'Hacer la llamada externa antes o después de la transacción, nunca dentro',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila de la tabla es la más traicionera porque no es un problema de orden, es de duración. Todo deadlock necesita dos transacciones coexistiendo con locks retenidos, y cuanto más tiempo los retiene cada una, mayor la probabilidad. Acortar la transacción, haciendo dentro solo lo que necesita ser atómico, reduce la frecuencia de todos los tipos de deadlock a la vez, incluidos los que aún no descubriste.',
        },
      ],
    },
    {
      title: 'Cuando aun así ocurre: repetir la transacción entera, con un límite',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Aun con el orden correcto, todavía puede ocurrir un deadlock raro proveniente de un camino que no controlas, como un trigger, una extensión o una consulta de informe. Los errores 40P01 y 40001 tienen la propiedad de que la transacción entera fue deshecha y no dejó ningún efecto, así que repetirla es seguro. El punto esencial es repetir la transacción entera, desde el BEGIN, y no solo el comando que falló: tras el error la transacción queda en estado abortado y las lecturas anteriores pueden ya no ser válidas. La función comTransacao del código anterior hace exactamente eso, con un máximo de cuatro intentos, backoff exponencial y jitter para que las víctimas no vuelvan todas en el mismo instante y formen un nuevo ciclo.',
        },
        {
          type: 'list',
          items: [
            'Nada con efecto externo dentro de la función repetida: correo, llamadas a APIs, publicación en cola o escritura en caché corren después del COMMIT. Una transacción repetida tres veces que envió tres correos no es segura de repetir.',
            'Repite solo los códigos que significan conflicto de concurrencia, 40P01 y 40001. Violación de unicidad, saldo insuficiente y error de sintaxis volverían a fallar igual y solo esconden el defecto.',
            'Limita los intentos y deja que el error suba después de ellos. Un retry sin límite convierte un problema de orden de locks en una tormenta de repeticiones que empeora la carga que lo causó.',
            'Mide la tasa de retry como métrica. Un retry que funciona en silencio esconde un deadlock que debió corregirse: el número de repeticiones por minuto debe ser bajo y estable, y un aumento es una alerta.',
          ],
        },
      ],
    },
    {
      title: 'Ver y demostrar: logs, métricas y una prueba de concurrencia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un deadlock sin observabilidad se vuelve un error 500 sin explicación. Con log_lock_waits activado, Postgres registra en el log quién esperó un lock más allá de deadlock_timeout, y el mensaje de deadlock lista los procesos, las consultas y los locks del ciclo, lo que normalmente señala directo las dos líneas de código culpables. El contador deadlocks de pg_stat_database es un acumulado por base: expórtalo como métrica y alerta sobre la derivada, no sobre el valor absoluto. El lock_timeout por transacción completa la defensa, porque limita la espera por una fila incluso cuando no hay ciclo, el caso de una transacción olvidada abierta.',
        },
        {
          type: 'code',
          value: diagnosticCode,
        },
        {
          type: 'paragraph',
          value:
            'Para demostrar que la corrección funciona, la prueba necesita producir la concurrencia que el entorno de desarrollo nunca produce. La prueba siguiente dispara 200 transferencias cruzadas al mismo tiempo contra una base real y exige que ninguna falle y que la suma de los saldos siga igual. Con la versión ingenua del inicio del artículo falla de forma consistente con el código 40P01, lo que además demuestra que la prueba realmente reproduce el defecto. Ejecútala contra un Postgres real, en contenedor, y no contra una base en memoria: el comportamiento de los locks es justamente lo que cambia entre ellas.',
        },
        {
          type: 'code',
          value: testCode,
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Aumentar el deadlock_timeout lo resuelve?',
      answer:
        'No. Ese parámetro solo controla cuánto espera la base antes de buscar un ciclo, así que aumentarlo apenas retrasa la detección: cada deadlock retiene locks y conexiones por más tiempo antes de resolverse. Reducirlo demasiado tampoco ayuda, porque la verificación de ciclos tiene costo. El valor por defecto de 1 segundo es razonable para casi todos los casos, y la solución está en el orden de los locks y en la duración de las transacciones.',
    },
    {
      question: '¿Puedo tratar todo con retry e ignorar la causa?',
      answer:
        'No se recomienda. El retry vuelve invisible el deadlock para el usuario, pero cada ocurrencia cuesta al menos un segundo de espera, deshace trabajo y consume conexiones. Con carga alta, la tasa de deadlocks crece más rápido que la de solicitudes y el retry pasa a generar su propia tormenta. Usa el retry como red de seguridad para el deadlock raro, y el orden de los locks como corrección de la causa.',
    },
    {
      question: '¿Esto vale para otras bases de datos y para los ORM?',
      answer:
        'Sí. MySQL con InnoDB, SQL Server y Oracle también tienen deadlocks por espera circular y también los resuelven eligiendo una víctima, cambiando solo el código del error y los detalles de qué comandos bloquean qué. Un ORM no cambia el problema: solo esconde el orden en que se tocan las filas. Si el ORM guarda varios objetos en una transacción, ordena los objetos por clave antes de guardar y usa la opción de bloqueo pesimista del ORM con la misma regla de orden.',
    },
  ],
  conclusion: {
    title: 'Un deadlock es un defecto de coordinación, no de lógica',
    description:
      'Dos transacciones correctas pueden bloquearse entre sí porque la base de datos no sabe que deberían coincidir en el orden. La corrección es coincidir por ella: toda transacción bloquea las mismas filas en el mismo orden, hace solo lo necesario mientras retiene locks y, para el caso raro que quede, se repite entera con un límite y una métrica. Con log de esperas, contador de deadlocks y una prueba de concurrencia en el CI, el error intermitente de las horas pico deja de ser un misterio y pasa a ser algo que se previene y se mide.',
    cta: 'Hablar sobre los deadlocks de mi sistema',
  },
  related: [
    {
      label: 'Stock negativo: la condición de carrera entre dos compras del último artículo',
      to: '/blog/estoque-negativo-condicao-de-corrida-entre-duas-compras-do-ultimo-item',
    },
    {
      label: 'El job programado que corre dos veces: exclusión mutua distribuida sin un bloqueo eterno',
      to: '/blog/job-agendado-que-roda-duas-vezes-exclusao-mutua-distribuida-sem-trava-eterna',
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
