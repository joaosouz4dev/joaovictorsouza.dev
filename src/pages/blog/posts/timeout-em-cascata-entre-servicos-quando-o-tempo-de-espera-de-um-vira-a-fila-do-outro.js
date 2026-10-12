// Conteudo do artigo: timeout em cascata entre servicos. Por que a espera do chamador
// vira a fila do chamado, por que o timeout por salto nao cancela trabalho, como o prazo
// desce pela cadeia como orcamento restante, como uma fila com prazo descarta trabalho
// morto e como provar a propriedade com carga acima da capacidade.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const ingenuoCode = `// servico-a: o timeout encerra a espera de A, nada chega a B
const resposta = await fetch('http://servico-b/pedidos', {
  method: 'POST',
  body: JSON.stringify(pedido),
  signal: AbortSignal.timeout(2000),
});`;

const servidorBCode = `import http from 'node:http';

const LIMITE_CONCORRENCIA = 4; // quantas requisicoes executam ao mesmo tempo
const TAMANHO_MAXIMO_FILA = 20; // acima disso, rejeitar cedo com 503
const CABECALHO_PRAZO = 'x-prazo-restante-ms';

const fila = []; // itens aguardando execucao, cada um com prazo absoluto local
let emExecucao = 0;

function admitir(prazo, trabalho) {
  return new Promise((resolver, rejeitar) => {
    if (fila.length >= TAMANHO_MAXIMO_FILA) {
      rejeitar(Object.assign(new Error('fila cheia'), { status: 503 }));
      return;
    }
    fila.push({ prazo, trabalho, resolver, rejeitar });
    despachar();
  });
}

function despachar() {
  while (emExecucao < LIMITE_CONCORRENCIA && fila.length > 0) {
    const item = fila.shift();
    if (Date.now() >= item.prazo) {
      // o chamador ja desistiu: executar agora seria trabalho descartado
      item.rejeitar(Object.assign(new Error('prazo expirado na fila'), { status: 504 }));
      continue;
    }
    emExecucao++;
    item
      .trabalho()
      .then(item.resolver, item.rejeitar)
      .finally(() => {
        emExecucao--;
        despachar();
      });
  }
}

const processar = (pedido) =>
  new Promise((resolver) => setTimeout(() => resolver({ id: pedido.id, ok: true }), 300));

http
  .createServer(async (req, res) => {
    const prazo = Date.now() + Number(req.headers[CABECALHO_PRAZO] ?? 1000);
    let corpo = '';
    for await (const trecho of req) corpo += trecho;
    try {
      const resultado = await admitir(prazo, () => processar(JSON.parse(corpo || '{}')));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(resultado));
    } catch (erro) {
      res.writeHead(erro.status ?? 500).end(erro.message);
    }
  })
  .listen(3001);`;

const servicoACode = `import http from 'node:http';

const URL_B = 'http://servico-b/pedidos';
const MARGEM_MS = 20; // folga para A devolver a propria resposta antes do prazo

async function chamarB(pedido, restanteMs) {
  const resposta = await fetch(URL_B, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-prazo-restante-ms': String(restanteMs),
    },
    body: JSON.stringify(pedido),
    signal: AbortSignal.timeout(restanteMs),
  });
  if (!resposta.ok) throw new Error('B respondeu ' + resposta.status);
  return resposta.json();
}

http
  .createServer(async (req, res) => {
    const prazo = Date.now() + Number(req.headers['x-prazo-restante-ms'] ?? 2000);
    const restanteParaB = prazo - Date.now() - MARGEM_MS;
    if (restanteParaB <= 0) {
      res.writeHead(504).end('sem prazo para chamar B');
      return;
    }
    try {
      const dadosB = await chamarB({ id: req.url }, restanteParaB);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(dadosB));
    } catch (erro) {
      res.writeHead(504).end(erro.name);
    }
  })
  .listen(3000);`;

const diagramaPt = `Cadeia A -> B. A espera no máximo 2 s. B executa 4 pedidos ao mesmo tempo, 300 ms cada, com fila de 20.

t=0       40 pedidos chegam a B: 4 executam, 20 esperam na fila, 16 recebem 503
t=300 ms  cada slot livre puxa o próximo item da fila
t=2000 ms A desiste dos pedidos pendentes e responde 504 ao cliente
          os itens que ficaram na fila continuam lá, com o prazo já vencido
          sem checagem na saída, B executaria todos eles e gastaria capacidade à toa`;

const diagramaEn = `Chain A -> B. A waits at most 2 s. B runs 4 requests at the same time, 300 ms each, with a queue of 20.

t=0       40 requests reach B: 4 run, 20 wait in the queue, 16 get 503
t=300 ms  each free slot pulls the next item from the queue
t=2000 ms A gives up on the pending requests and answers 504 to the client
          the items left in the queue stay there, with the deadline already expired
          without a check at dequeue, B would run all of them and waste capacity`;

const diagramaEs = `Cadena A -> B. A espera como maximo 2 s. B ejecuta 4 peticiones al mismo tiempo, 300 ms cada una, con cola de 20.

t=0       40 peticiones llegan a B: 4 se ejecutan, 20 esperan en la cola, 16 reciben 503
t=300 ms  cada slot libre toma el siguiente elemento de la cola
t=2000 ms A se rinde con las peticiones pendientes y responde 504 al cliente
          los elementos que quedaron en la cola siguen ahi, con el plazo ya vencido
          sin verificar al salir, B ejecutaria todos y gastaria capacidad en vano`;

const pt = {
  intro:
    'Um serviço A chama o serviço B com timeout de dois segundos. Em horário de pico, B satura, as requisições passam a esperar na fila interna dele e A começa a devolver 504. O incidente parece simples: B está lento. O problema real é que a espera de A virou a fila de B. Quando A desiste, B não sabe disso e continua executando pedidos cujo resultado ninguém vai ler, consumindo CPU, conexões e cotas de terceiros. Este artigo mostra por que o timeout por salto não basta, como o prazo precisa descer pela cadeia como orçamento restante, como uma fila com prazo descarta trabalho morto em vez de executá-lo e como testar essa propriedade com carga acima da capacidade antes de a produção fazer isso por você.',
  sections: [
    {
      title: 'A espera de quem chama vira a fila de quem atende',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando A define um timeout de dois segundos para a chamada a B, ele declara até quando quer esperar, mas não declara o que B deve fazer. Essa diferença decide o custo do incidente. Se B tem capacidade, a espera de A é só latência. Se B está saturado, a espera de A acontece dentro da fila de B: o pedido entra, aguarda um slot livre e só então executa. Para A, o tempo parado é o mesmo tempo que o pedido passa na fila de B. Cada timeout que dispara em A deixa, portanto, um item ocupando a fila de B sem que ninguém o esteja esperando.',
        },
        {
          type: 'table',
          columns: ['Quem', 'O que mede', 'O que acontece no timeout', 'Risco sem propagação'],
          rows: [
            [
              'Cliente',
              'Tempo até a resposta',
              'Recebe erro e pode tentar de novo',
              'A retentativa soma um item novo à fila',
            ],
            [
              'Serviço A',
              'Espera pela resposta de B',
              'Cancela a própria espera e devolve 504',
              'Libera o slot de A, mas não o de B',
            ],
            [
              'Serviço B',
              'Tempo de execução do pedido',
              'Não sabe que houve timeout',
              'Executa trabalho cujo resultado será descartado',
            ],
          ],
        },
      ],
    },
    {
      title: 'Por que a fila cresce mesmo com clientes desistindo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A lei de Little relaciona a quantidade média de itens no sistema com a taxa de chegada e o tempo de permanência: L = λ × W. Em B, W inclui a espera na fila, e essa espera é exatamente o que o timeout de A deveria limitar. Sem propagação, A corta a espera do lado dele, mas B continua tratando o item como trabalho legítimo. Quando o cliente tenta de novo, λ sobe justamente quando a fila já está cheia de trabalho morto. Por fora, o sistema parece responder com erros rápidos; por dentro, ele gasta capacidade com pedidos que já foram abandonados.',
        },
        { type: 'diagram', value: diagramaPt },
      ],
    },
    {
      title: 'O timeout por salto que não cancela nada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O código abaixo é o padrão mais comum. Ele parece correto: A nunca espera mais de dois segundos, e os testes de A passam. Só que o timeout existe apenas do lado de A. Nenhum cabeçalho, nenhum prazo e nenhum sinal chega a B.',
        },
        { type: 'code', value: ingenuoCode },
        {
          type: 'paragraph',
          value:
            'Com esse código, B trata cada pedido como se o cliente fosse esperar para sempre. Um pedido que ficou 1,8 s na fila e depois gasta 300 ms executando termina em 2,1 s, depois de A já ter desistido aos 2 s. B, mesmo assim, gasta os 300 ms.',
        },
      ],
    },
    {
      title: 'O prazo como orçamento restante, não como horário absoluto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A solução é fazer o prazo atravessar a cadeia como orçamento: cada salto recebe quantos milissegundos ainda restam e desconta o que já gastou. Mandar um horário absoluto parece mais simples, mas exige relógios sincronizados entre máquinas. Se o relógio de B estiver atrasado em três segundos, ele aceita como válido um pedido que já venceu. Com o orçamento restante, cada medição é local ao processo, e o erro de latência de rede é pequeno o bastante para a margem absorver.',
        },
        { type: 'code', value: servidorBCode },
        {
          type: 'list',
          items: [
            'Concorrência máxima por instância, dimensionada pela capacidade real das dependências, como o pool do banco',
            'Tamanho máximo da fila, com rejeição imediata quando ela está cheia',
            'Checagem do prazo na saída da fila, antes de qualquer trabalho começar',
            'Status 503 para fila cheia e 504 para prazo vencido, para que o chamador saiba o motivo',
          ],
        },
        {
          type: 'paragraph',
          value:
            'B aceita o pedido, mas só o põe em execução se o prazo ainda valer no momento de sair da fila. Um item que chega à frente depois de vencido recebe erro sem consumir nenhum recurso de execução.',
        },
      ],
    },
    {
      title: 'A cadeia: cada salto gasta uma parte do orçamento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O serviço A lê o orçamento recebido, desconta o próprio trabalho local e reserva uma margem para responder antes de o cliente desistir. Se o que sobra não for positivo, A nem chama B. Esse é o ganho que mais preserva capacidade durante um incidente: um pedido que não tem mais como terminar a tempo não deve ocupar slot em nenhum ponto da cadeia.',
        },
        { type: 'code', value: servicoACode },
        {
          type: 'paragraph',
          value:
            'A chamada usa AbortSignal.timeout com o restante, e não com o valor fixo de antes. O timeout local continua útil contra travamentos de rede, mas o prazo de negócio agora é um só, medido a partir do momento em que o pedido entrou na cadeia. Há um limite: a checagem na saída da fila não interrompe um trabalho que já começou. Para isso, o prazo precisa virar um AbortSignal repassado às chamadas de banco e HTTP feitas dentro do processamento.',
        },
      ],
    },
    {
      title: 'Quanto custa o trabalho descartado e como provar que ele acabou',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Em uma execução local do par acima, com B limitado a quatro execuções simultâneas, 300 ms por pedido e fila de 20, 40 pedidos chegaram de uma vez com orçamento de dois segundos. Parte das respostas voltou 200, dentro do prazo, e o restante voltou 504, seja porque B rejeitou com 503, seja porque o item venceu na fila. Nenhum item foi iniciado depois de vencer, porque a checagem acontece na saída da fila. Os 503 de B chegam a A, que os converte em 504; manter o status original é uma melhoria simples e preserva o sinal de rejeição rápida.',
        },
        {
          type: 'table',
          columns: ['Teste', 'Como montar', 'Critério de aprovação'],
          rows: [
            [
              'Carga acima da capacidade',
              'Enviar pelo menos o triplo da capacidade de B durante dois minutos',
              'Latência limitada pelo prazo, sem crescimento contínuo da fila',
            ],
            [
              'Trabalho após o prazo',
              'Registrar em B o instante de início de cada item e compará-lo com o prazo recebido',
              'Zero itens iniciados depois do prazo',
            ],
            [
              'Rejeição precoce',
              'Lotar a fila de B e observar o status devolvido',
              '503 imediato, em vez de espera até o prazo',
            ],
            [
              'Orçamento repassado',
              'Injetar 800 ms de atraso em A antes da chamada a B',
              'B recebe o restante já descontado e o cliente recebe a resposta dentro do prazo total',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O último teste é o mais esquecido e costuma ser o que quebra a cadeia. O orçamento só funciona se cada salto lê o cabeçalho e o repassa. Um serviço intermediário que recria um timeout fixo apaga o prazo de ponta a ponta, e nenhum teste unitário percebe. Por isso o critério precisa ser medido do cliente até o último serviço.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que não resolver reduzindo o timeout de cada salto?',
      answer:
        'Porque timeouts menores só mudam o momento em que a espera vira erro, não o momento em que o trabalho para. Em cadeias de três ou quatro saltos, cada um com timeout próprio, a soma ultrapassa o que o cliente aceita, e o trabalho abandonado continua ocupando a fila de quem atende. Reduzir os números ajuda, mas sem propagação o problema permanece. Com um orçamento único, o último salto sabe exatamente quanto tempo ainda existe e pode desistir antes de começar.',
    },
    {
      question: 'A fila limitada não rejeita pedidos que terminariam a tempo?',
      answer:
        'Pode rejeitar, e é isso que se quer quando a capacidade acabou. Uma fila sem limite não elimina a rejeição; ela só a transfere para o cliente, que recebe um timeout depois de esperar o prazo inteiro, e ainda deixa trabalho morto para trás. Rejeitar com 503 no momento da chegada permite que o cliente tente outra réplica ou degrade a funcionalidade com antecedência. O tamanho da fila deve sair da medição de quanto tempo um item pode esperar antes do prazo, não de um número redondo.',
    },
    {
      question: 'O prazo deve viajar como horário absoluto ou como tempo restante?',
      answer:
        'Tempo restante, em milissegundos, sempre que a cadeia cruza máquinas sem relógio sincronizado. O horário absoluto só é seguro com NTP bem configurado e monitorado, e mesmo assim cada salto precisa considerar a própria latência de chegada. O tempo restante é mais simples de raciocinar nos testes e não depende de nenhuma infraestrutura de tempo. O artigo sobre relógio dessincronizado entre serviços cobre os casos em que o horário absoluto parece inevitável.',
    },
  ],
  conclusion: {
    title: 'O timeout encerra a espera; só o prazo propagado encerra o trabalho',
    description:
      'Quando a espera de quem chama vira a fila de quem atende, reduzir timeouts não resolve. O que resolve é tratar o prazo como orçamento que desce pela cadeia, usar uma fila que descarta o que já venceu e rejeita cedo quando está cheia, e manter um teste de carga que prove que nenhum item começa depois do prazo. Sem isso, o incidente de hoje vira a carga da próxima onda de retentativas.',
    cta: 'Revisar os timeouts da minha cadeia de serviços',
  },
  related: [
    {
      label: 'Timeout em cascata: por que o retry do cliente derruba o serviço que ia se recuperar',
      to: '/blog/timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar',
    },
    {
      label: 'Timeout mal calibrado: quando tentar de novo piora o incidente',
      to: '/blog/timeout-mal-calibrado-quando-tentar-de-novo-piora-o-incidente',
    },
    {
      label: 'Relógio dessincronizado entre serviços: quando a ordem dos eventos deixa de existir',
      to: '/blog/relogio-dessincronizado-entre-servicos-ordem-dos-eventos',
    },
  ],
};

const en = {
  intro:
    'Service A calls service B with a two-second timeout. At peak hours B saturates, requests start waiting in its internal queue, and A begins returning 504s. The incident looks simple: B is slow. The real problem is that the wait in A has become the queue in B. When A gives up, B does not know it and keeps running requests whose result nobody will read, burning CPU, connections and third-party quotas. This article shows why a per-hop timeout is not enough, how the deadline has to travel down the chain as a remaining budget, how a queue with deadlines discards dead work instead of running it, and how to test that property with load above capacity before production does it for you.',
  sections: [
    {
      title: 'The wait in the caller becomes the queue of the callee',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When A sets a two-second timeout for the call to B, it declares how long it is willing to wait, but it does not declare what B should do. That difference decides the cost of the incident. If B has capacity, the wait in A is only latency. If B is saturated, the wait in A happens inside the queue of B: the request enters, waits for a free slot and only then runs. For A, the time spent idle is the same time the request spends in the queue of B. Every timeout that fires in A therefore leaves an item occupying the queue of B while nobody is waiting for it.',
        },
        {
          type: 'table',
          columns: ['Who', 'What it measures', 'What happens on timeout', 'Risk without propagation'],
          rows: [
            [
              'Client',
              'Time until the response',
              'Gets an error and may retry',
              'The retry adds a new item to the queue',
            ],
            [
              'Service A',
              'Wait for the response from B',
              'Cancels its own wait and returns 504',
              'Frees the slot of A, but not the slot of B',
            ],
            [
              'Service B',
              'Execution time of the request',
              'Does not know a timeout happened',
              'Runs work whose result will be discarded',
            ],
          ],
        },
      ],
    },
    {
      title: 'Why the queue grows even when clients give up',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Little law relates the average number of items in the system to the arrival rate and the time each item spends there: L = λ × W. In B, W includes the wait in the queue, and that wait is exactly what the timeout of A was supposed to limit. Without propagation, A cuts the wait on its side, but B keeps treating the item as legitimate work. When the client retries, λ goes up precisely when the queue is already full of dead work. From the outside the system seems to answer with fast errors; inside, it spends capacity on requests that were already abandoned.',
        },
        { type: 'diagram', value: diagramaEn },
      ],
    },
    {
      title: 'The per-hop timeout that cancels nothing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The code below is the most common pattern. It looks correct: A never waits more than two seconds, and the tests of A pass. But the timeout exists only on the side of A. No header, no deadline and no signal reaches B.',
        },
        { type: 'code', value: ingenuoCode },
        {
          type: 'paragraph',
          value:
            'With this code, B treats every request as if the client were going to wait forever. A request that sat 1.8 s in the queue and then spends 300 ms running finishes at 2.1 s, after A has already given up at 2 s. B still spends the 300 ms.',
        },
      ],
    },
    {
      title: 'The deadline as remaining budget, not as an absolute time',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The fix is to let the deadline travel down the chain as a budget: each hop receives how many milliseconds remain and subtracts what it has already spent. Sending an absolute time looks simpler, but it requires clocks synchronized across machines. If the clock of B is three seconds behind, it accepts as valid a request that has already expired. With the remaining budget, every measurement is local to the process, and the network latency error is small enough for the margin to absorb.',
        },
        { type: 'code', value: servidorBCode },
        {
          type: 'list',
          items: [
            'A maximum concurrency per instance, sized by the real capacity of its dependencies, such as the database pool',
            'A maximum queue size, with immediate rejection when the queue is full',
            'A deadline check when leaving the queue, before any work starts',
            'Status 503 for a full queue and 504 for an expired deadline, so the caller knows the reason',
          ],
        },
        {
          type: 'paragraph',
          value:
            'B accepts the request, but only puts it into execution if the deadline still holds at the moment it leaves the queue. An item that reaches the front after expiring gets an error without consuming any execution resource.',
        },
      ],
    },
    {
      title: 'The chain: each hop spends part of the budget',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Service A reads the budget it received, subtracts its own local work and keeps a margin to answer before the client gives up. If what remains is not positive, A does not call B at all. This is the gain that preserves the most capacity during an incident: a request that can no longer finish in time should not occupy a slot anywhere in the chain.',
        },
        { type: 'code', value: servicoACode },
        {
          type: 'paragraph',
          value:
            'The call uses AbortSignal.timeout with the remaining budget, not with the fixed value from before. The local timeout remains useful against network hangs, but the business deadline is now a single one, measured from the moment the request entered the chain. There is a limit: the check when leaving the queue does not interrupt work that has already started. For that, the deadline must become an AbortSignal passed down to the database and HTTP calls made inside the processing.',
        },
      ],
    },
    {
      title: 'What discarded work costs and how to prove it is gone',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In a local run of the pair above, with B limited to four simultaneous executions, 300 ms per request and a queue of 20, 40 requests arrived at once with a two-second budget. Part of the responses came back as 200, within the deadline, and the rest came back as 504, either because B rejected with 503 or because the item expired in the queue. No item started after its deadline, because the check happens when leaving the queue. The 503s from B reach A, which converts them into 504; keeping the original status is a simple improvement and preserves the fast rejection signal.',
        },
        {
          type: 'table',
          columns: ['Test', 'How to set it up', 'Pass criterion'],
          rows: [
            [
              'Load above capacity',
              'Send at least three times the capacity of B for two minutes',
              'Latency bounded by the deadline, with no continuous growth of the queue',
            ],
            [
              'Work after the deadline',
              'Record in B the start instant of each item and compare it with the received deadline',
              'Zero items started after the deadline',
            ],
            [
              'Early rejection',
              'Fill the queue of B and observe the returned status',
              'Immediate 503, instead of waiting until the deadline',
            ],
            [
              'Budget propagation',
              'Inject an 800 ms delay in A before the call to B',
              'B receives the remaining budget already deducted, and the client gets the response within the total deadline',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last test is the most forgotten and is usually the one that breaks the chain. The budget only works if every hop reads the header and passes it on. An intermediate service that recreates a fixed timeout erases the deadline end to end, and no unit test notices. That is why the criterion must be measured from the client to the last service.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why not solve it by lowering the timeout of each hop?',
      answer:
        'Because smaller timeouts only change the moment when the wait becomes an error, not the moment when the work stops. In chains of three or four hops, each with its own timeout, the sum exceeds what the client accepts, and abandoned work keeps occupying the queue of whoever serves it. Lowering the numbers helps, but without propagation the problem remains. With a single budget, the last hop knows exactly how much time is left and can give up before it starts.',
    },
    {
      question: 'Does a bounded queue reject requests that would have finished in time?',
      answer:
        'It can, and that is the point when capacity is gone. An unbounded queue does not eliminate the rejection; it only moves it to the client, who gets a timeout after waiting the whole deadline, and it leaves dead work behind. Rejecting with 503 at arrival lets the client try another replica or degrade the feature early. The queue size should come from measuring how long an item can wait before its deadline, not from a round number.',
    },
    {
      question: 'Should the deadline travel as an absolute time or as remaining time?',
      answer:
        'Remaining time, in milliseconds, whenever the chain crosses machines without a synchronized clock. An absolute time is only safe with properly configured and monitored NTP, and even then each hop has to account for its own arrival latency. Remaining time is simpler to reason about in tests and does not depend on any time infrastructure. The article on clock skew between services covers the cases where an absolute time seems unavoidable.',
    },
  ],
  conclusion: {
    title: 'A timeout ends the wait; only a propagated deadline ends the work',
    description:
      'When the wait in the caller becomes the queue of the callee, lowering timeouts fixes nothing. What fixes it is treating the deadline as a budget that travels down the chain, using a queue that discards what has already expired and rejects early when full, and keeping a load test that proves no item starts after its deadline. Without that, the incident of today becomes the load of the next wave of retries.',
    cta: 'Review the timeouts of my service chain',
  },
  related: [
    {
      label: 'Cascading timeouts: why the client retry takes down the service that was recovering',
      to: '/blog/timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar',
    },
    {
      label: 'Badly calibrated timeouts: when retrying makes the incident worse',
      to: '/blog/timeout-mal-calibrado-quando-tentar-de-novo-piora-o-incidente',
    },
    {
      label: 'Clock skew between services: when event ordering stops existing',
      to: '/blog/relogio-dessincronizado-entre-servicos-ordem-dos-eventos',
    },
  ],
};

const es = {
  intro:
    'Un servicio A llama al servicio B con un timeout de dos segundos. En hora pico B se satura, las peticiones empiezan a esperar en su cola interna y A comienza a devolver 504. El incidente parece simple: B está lento. El problema real es que la espera de A se convirtió en la cola de B. Cuando A se rinde, B no lo sabe y sigue ejecutando peticiones cuyo resultado nadie va a leer, gastando CPU, conexiones y cuotas de terceros. Este artículo muestra por qué un timeout por salto no alcanza, cómo el plazo tiene que recorrer la cadena como presupuesto restante, cómo una cola con plazo descarta el trabajo muerto en lugar de ejecutarlo y cómo probar esa propiedad con carga por encima de la capacidad antes de que lo haga producción por ti.',
  sections: [
    {
      title: 'La espera de quien llama se convierte en la cola de quien atiende',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando A define un timeout de dos segundos para la llamada a B, declara hasta cuándo quiere esperar, pero no declara lo que B debe hacer. Esa diferencia decide el costo del incidente. Si B tiene capacidad, la espera de A es solo latencia. Si B está saturado, la espera de A ocurre dentro de la cola de B: la petición entra, aguarda un slot libre y solo entonces se ejecuta. Para A, el tiempo parado es el mismo tiempo que la petición pasa en la cola de B. Cada timeout que dispara en A deja, por lo tanto, un elemento ocupando la cola de B sin que nadie lo esté esperando.',
        },
        {
          type: 'table',
          columns: ['Quién', 'Qué mide', 'Qué pasa en el timeout', 'Riesgo sin propagación'],
          rows: [
            [
              'Cliente',
              'Tiempo hasta la respuesta',
              'Recibe un error y puede reintentar',
              'El reintento suma un elemento nuevo a la cola',
            ],
            [
              'Servicio A',
              'Espera la respuesta de B',
              'Cancela su propia espera y devuelve 504',
              'Libera el slot de A, pero no el de B',
            ],
            [
              'Servicio B',
              'Tiempo de ejecución de la petición',
              'No sabe que hubo timeout',
              'Ejecuta trabajo cuyo resultado se descartará',
            ],
          ],
        },
      ],
    },
    {
      title: 'Por qué la cola crece aunque los clientes se rindan',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La ley de Little relaciona la cantidad promedio de elementos en el sistema con la tasa de llegada y el tiempo de permanencia: L = λ × W. En B, W incluye la espera en la cola, y esa espera es exactamente lo que el timeout de A debería limitar. Sin propagación, A corta la espera de su lado, pero B sigue tratando el elemento como trabajo legítimo. Cuando el cliente reintenta, λ sube justo cuando la cola ya está llena de trabajo muerto. Desde afuera el sistema parece responder con errores rápidos; por dentro, gasta capacidad en peticiones que ya fueron abandonadas.',
        },
        { type: 'diagram', value: diagramaEs },
      ],
    },
    {
      title: 'El timeout por salto que no cancela nada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El código siguiente es el patrón más común. Parece correcto: A nunca espera más de dos segundos, y las pruebas de A pasan. Pero el timeout existe solo del lado de A. Ningún encabezado, ningún plazo y ninguna señal llega a B.',
        },
        { type: 'code', value: ingenuoCode },
        {
          type: 'paragraph',
          value:
            'Con este código, B trata cada petición como si el cliente fuera a esperar para siempre. Una petición que pasó 1,8 s en la cola y luego gasta 300 ms ejecutándose termina a los 2,1 s, después de que A ya se hubiera rendido a los 2 s. Aun así, B gasta los 300 ms.',
        },
      ],
    },
    {
      title: 'El plazo como presupuesto restante, no como hora absoluta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La solución es que el plazo recorra la cadena como presupuesto: cada salto recibe cuántos milisegundos quedan y descuenta lo que ya gastó. Enviar una hora absoluta parece más simple, pero exige relojes sincronizados entre máquinas. Si el reloj de B está atrasado tres segundos, acepta como válida una petición que ya venció. Con el presupuesto restante, cada medición es local al proceso, y el error de latencia de red es lo bastante pequeño para que el margen lo absorba.',
        },
        { type: 'code', value: servidorBCode },
        {
          type: 'list',
          items: [
            'Concurrencia máxima por instancia, dimensionada según la capacidad real de sus dependencias, como el pool de la base de datos',
            'Tamaño máximo de la cola, con rechazo inmediato cuando está llena',
            'Verificación del plazo al salir de la cola, antes de que empiece cualquier trabajo',
            'Estado 503 para cola llena y 504 para plazo vencido, para que quien llama conozca el motivo',
          ],
        },
        {
          type: 'paragraph',
          value:
            'B acepta la petición, pero solo la pone en ejecución si el plazo sigue vigente en el momento de salir de la cola. Un elemento que llega al frente después de vencer recibe un error sin consumir ningún recurso de ejecución.',
        },
      ],
    },
    {
      title: 'La cadena: cada salto gasta una parte del presupuesto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El servicio A lee el presupuesto recibido, descuenta su propio trabajo local y reserva un margen para responder antes de que el cliente se rinda. Si lo que queda no es positivo, A ni siquiera llama a B. Esta es la ganancia que más preserva capacidad durante un incidente: una petición que ya no puede terminar a tiempo no debe ocupar un slot en ningún punto de la cadena.',
        },
        { type: 'code', value: servicoACode },
        {
          type: 'paragraph',
          value:
            'La llamada usa AbortSignal.timeout con el restante, y no con el valor fijo de antes. El timeout local sigue siendo útil contra bloqueos de red, pero el plazo de negocio ahora es uno solo, medido desde el momento en que la petición entró en la cadena. Hay un límite: la verificación al salir de la cola no interrumpe un trabajo que ya empezó. Para eso, el plazo debe convertirse en un AbortSignal que se pase a las llamadas de base de datos y HTTP hechas dentro del procesamiento.',
        },
      ],
    },
    {
      title: 'Cuánto cuesta el trabajo descartado y cómo probar que ya no existe',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En una ejecución local del par anterior, con B limitado a cuatro ejecuciones simultáneas, 300 ms por petición y una cola de 20, llegaron 40 peticiones de una vez con un presupuesto de dos segundos. Parte de las respuestas volvió con 200, dentro del plazo, y el resto volvió con 504, ya sea porque B rechazó con 503, ya sea porque el elemento venció en la cola. Ningún elemento empezó después de vencer, porque la verificación ocurre al salir de la cola. Los 503 de B llegan a A, que los convierte en 504; conservar el estado original es una mejora simple y preserva la señal de rechazo rápido.',
        },
        {
          type: 'table',
          columns: ['Prueba', 'Cómo montarla', 'Criterio de aprobación'],
          rows: [
            [
              'Carga por encima de la capacidad',
              'Enviar al menos el triple de la capacidad de B durante dos minutos',
              'Latencia acotada por el plazo, sin crecimiento continuo de la cola',
            ],
            [
              'Trabajo después del plazo',
              'Registrar en B el instante de inicio de cada elemento y compararlo con el plazo recibido',
              'Cero elementos iniciados después del plazo',
            ],
            [
              'Rechazo temprano',
              'Llenar la cola de B y observar el estado devuelto',
              '503 inmediato, en lugar de esperar hasta el plazo',
            ],
            [
              'Presupuesto propagado',
              'Inyectar un retraso de 800 ms en A antes de la llamada a B',
              'B recibe el restante ya descontado y el cliente recibe la respuesta dentro del plazo total',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última prueba es la más olvidada y suele ser la que rompe la cadena. El presupuesto solo funciona si cada salto lee el encabezado y lo reenvía. Un servicio intermedio que recrea un timeout fijo borra el plazo de extremo a extremo, y ninguna prueba unitaria lo nota. Por eso el criterio debe medirse desde el cliente hasta el último servicio.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué no resolverlo bajando el timeout de cada salto?',
      answer:
        'Porque los timeouts más cortos solo cambian el momento en que la espera se convierte en error, no el momento en que el trabajo se detiene. En cadenas de tres o cuatro saltos, cada uno con su propio timeout, la suma supera lo que el cliente acepta, y el trabajo abandonado sigue ocupando la cola de quien lo atiende. Bajar los números ayuda, pero sin propagación el problema permanece. Con un único presupuesto, el último salto sabe cuánto tiempo queda y puede rendirse antes de empezar.',
    },
    {
      question: '¿La cola limitada no rechaza peticiones que habrían terminado a tiempo?',
      answer:
        'Puede rechazarlas, y eso es lo que se quiere cuando la capacidad se agotó. Una cola sin límite no elimina el rechazo; solo lo traslada al cliente, que recibe un timeout tras esperar el plazo completo, y deja trabajo muerto detrás. Rechazar con 503 en el momento de la llegada permite que el cliente pruebe otra réplica o degrade la funcionalidad a tiempo. El tamaño de la cola debe salir de medir cuánto puede esperar un elemento antes de su plazo, no de un número redondo.',
    },
    {
      question: '¿El plazo debe viajar como hora absoluta o como tiempo restante?',
      answer:
        'Tiempo restante, en milisegundos, siempre que la cadena cruce máquinas sin reloj sincronizado. La hora absoluta solo es segura con NTP bien configurado y monitoreado, y aun así cada salto debe considerar su propia latencia de llegada. El tiempo restante es más fácil de razonar en las pruebas y no depende de ninguna infraestructura de tiempo. El artículo sobre relojes desincronizados entre servicios cubre los casos en que la hora absoluta parece inevitable.',
    },
  ],
  conclusion: {
    title: 'Un timeout termina la espera; solo un plazo propagado termina el trabajo',
    description:
      'Cuando la espera de quien llama se convierte en la cola de quien atiende, bajar los timeouts no resuelve nada. Lo que lo resuelve es tratar el plazo como un presupuesto que recorre la cadena, usar una cola que descarta lo que ya venció y rechaza pronto cuando está llena, y mantener una prueba de carga que demuestre que ningún elemento empieza después de su plazo. Sin eso, el incidente de hoy se convierte en la carga de la próxima oleada de reintentos.',
    cta: 'Revisar los timeouts de mi cadena de servicios',
  },
  related: [
    {
      label: 'Timeout en cascada: por qué el retry del cliente tumba el servicio que iba a recuperarse',
      to: '/blog/timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar',
    },
    {
      label: 'Timeout mal calibrado: cuándo reintentar empeora el incidente',
      to: '/blog/timeout-mal-calibrado-quando-tentar-de-novo-piora-o-incidente',
    },
    {
      label: 'Relojes desincronizados entre servicios: cuándo el orden de los eventos deja de existir',
      to: '/blog/relogio-dessincronizado-entre-servicos-ordem-dos-eventos',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
