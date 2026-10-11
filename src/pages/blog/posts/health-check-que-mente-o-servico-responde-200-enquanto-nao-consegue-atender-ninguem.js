// Conteudo do artigo: health check que mente. Por que um 200 no endpoint de saude
// nao prova que o servico atende, como separar liveness, readiness e alerta, o que
// medir sem derrubar a frota quando uma dependencia compartilhada tropeca, um avaliador
// com prazo e cache em Node.js e os testes que simulam a falha real.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const ingenuoCode = `app.get('/health', (req, res) => res.status(200).send('ok'));`;

const diagramaPt = `Banco lento (p99 de 4 s), 3 instancias, checagem do banco marcada como critica:

t=0    instancia A: checagem do banco falha -> 503 -> removida
       instancia B: checagem do banco falha -> 503 -> removida
       instancia C: checagem do banco falha -> 503 -> removida
t=10s  balanceador sem backend saudavel: 503 para 100% do trafego

Sem a checagem critica, as tres continuam atendendo: requisicoes lentas e algumas
falhas, mas o trafego que ainda passa segue entregando valor.`;

const diagramaEn = `Slow database (p99 of 4 s), 3 instances, database check marked as critical:

t=0    instance A: database check fails -> 503 -> removed
       instance B: database check fails -> 503 -> removed
       instance C: database check fails -> 503 -> removed
t=10s  load balancer has no healthy backend: 503 for 100% of the traffic

Without the critical check, all three keep serving: slow requests and some
failures, but the traffic that still gets through keeps delivering value.`;

const diagramaEs = `Base de datos lenta (p99 de 4 s), 3 instancias, verificacion de la base de datos marcada como critica:

t=0    instancia A: la verificacion de la base falla -> 503 -> sacada
       instancia B: la verificacion de la base falla -> 503 -> sacada
       instancia C: la verificacion de la base falla -> 503 -> sacada
t=10s  balanceador sin backend sano: 503 para el 100% del trafico

Sin la verificacion critica, las tres siguen atendiendo: peticiones lentas y algunas
fallas, pero el trafico que aun pasa sigue entregando valor.`;

const saudeCode = `import http from 'node:http';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const CACHE_MS = 2000; // o resultado vale por 2 s: sondagens concorrentes reaproveitam a mesma checagem
const PRAZO_PADRAO_MS = 1000; // abaixo do timeoutSeconds da sondagem, com folga

function comPrazo(promessa, ms, nome) {
  let timer;
  const prazo = new Promise((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new Error(nome + ': sem resposta em ' + ms + ' ms')), ms);
  });
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(timer));
}

export function criarAvaliador({ checagens, criticas = [], prazoMs = PRAZO_PADRAO_MS }) {
  let cache = null;
  let emCurso = null;

  async function executar() {
    const resultados = {};
    await Promise.all(
      Object.entries(checagens).map(async ([nome, checar]) => {
        const inicio = performance.now();
        try {
          await comPrazo(checar(), prazoMs, nome);
          resultados[nome] = { ok: true, ms: Math.round(performance.now() - inicio) };
        } catch (erro) {
          resultados[nome] = { ok: false, erro: erro.message };
        }
      }),
    );

    const bloqueada = criticas.some((nome) => !resultados[nome].ok);
    const degradada = Object.values(resultados).some((r) => !r.ok);
    const resposta = {
      status: bloqueada ? 503 : 200,
      corpo: {
        estado: bloqueada ? 'indisponivel' : degradada ? 'degradado' : 'ok',
        checagens: resultados,
      },
    };
    cache = { em: Date.now(), resposta };
    return resposta;
  }

  return function avaliar() {
    if (cache && Date.now() - cache.em < CACHE_MS) return Promise.resolve(cache.resposta);
    emCurso ??= executar().finally(() => {
      emCurso = null;
    });
    return emCurso;
  };
}

export function criarServidorSaude(avaliar) {
  return http.createServer(async (req, res) => {
    if (req.url === '/health/live') {
      res.writeHead(200).end('ok'); // o processo responde; nenhuma dependencia entra aqui
      return;
    }
    if (req.url === '/health/ready') {
      const { status, corpo } = await avaliar();
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(corpo));
      return;
    }
    res.writeHead(404).end();
  });
}`;

const usoCode = `import { Pool } from 'pg';
import { criarAvaliador, criarServidorSaude } from './saude.js';

const pool = new Pool({ max: 10 });
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();

const avaliar = criarAvaliador({
  checagens: {
    banco: () => pool.query('SELECT 1'), // se nao ha conexao livre, a espera e limitada pelo prazo
    event_loop: async () => {
      const p99Ms = loop.percentile(99) / 1e6; // o histograma guarda nanossegundos
      loop.reset();
      if (p99Ms > 200) throw new Error('p99 de ' + Math.round(p99Ms) + ' ms');
    },
  },
  criticas: ['banco'], // so o banco local bloqueia a instancia; o event loop apenas degrada
});

criarServidorSaude(avaliar).listen(3000);`;

const probesCode = `livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  initialDelaySeconds: 15
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 2`;

const testeCode = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAvaliador } from './saude.js';

test('pool sem conexao livre vira 503, nao 200', async () => {
  const avaliar = criarAvaliador({
    checagens: { banco: () => new Promise(() => {}) }, // nunca resolve: a conexao nunca chega
    criticas: ['banco'],
    prazoMs: 50,
  });

  const { status, corpo } = await avaliar();

  assert.equal(status, 503);
  assert.equal(corpo.checagens.banco.ok, false);
});

test('falha em dependencia nao critica degrada sem remover a instancia', async () => {
  const avaliar = criarAvaliador({
    checagens: {
      banco: async () => {},
      cache: async () => {
        throw new Error('ECONNREFUSED');
      },
    },
    criticas: ['banco'],
    prazoMs: 50,
  });

  const { status, corpo } = await avaliar();

  assert.equal(status, 200);
  assert.equal(corpo.estado, 'degradado');
});`;

const pt = {
  intro:
    'Um cenário que se repete em muitos times: um serviço expõe um endpoint /health que devolve 200 há meses. Numa sexta à tarde o banco fica lento, o pool de conexões perde todas as conexões livres e as requisições passam a esperar quarenta segundos antes de falhar. O balanceador continua mandando tráfego para todas as instâncias, porque o health check segue respondendo 200. E ele não mente sobre estar vivo: o processo está de pé, o event loop gira e a porta aceita conexões. Só que o endpoint nunca toca o banco, então não tem como saber que ninguém está sendo atendido. Este artigo trata da diferença entre estar vivo e conseguir atender, de como liveness, readiness e alerta fazem perguntas distintas, do que um health check honesto precisa medir sem tirar a frota inteira de circulação quando uma dependência compartilhada tropeça, e de como testar o endpoint para que ele falhe quando deve.',
  sections: [
    {
      title: 'Estar vivo não é o mesmo que conseguir atender',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um health check mistura três perguntas diferentes, e a maioria dos endpoints responde só à primeira. A liveness pergunta se o processo está preso e precisa ser reiniciado: um deadlock, um event loop parado, um estado do qual ele não se recupera. A readiness pergunta se esta instância deve receber tráfego agora. O alerta pergunta se o serviço, como conjunto, entrega o que promete a quem o usa. Cada uma tem consumidor, ação e custo de falso positivo diferentes, e confundi-las é a origem da maioria dos problemas.',
        },
        {
          type: 'table',
          columns: ['Verificação', 'Pergunta', 'Quem consome', 'Ação quando falha'],
          rows: [
            [
              'Liveness',
              'O processo está preso e precisa ser reiniciado?',
              'Kubelet ou supervisor',
              'Reinicia o container',
            ],
            [
              'Readiness',
              'Esta instância consegue atender uma requisição agora?',
              'Balanceador e endpoints do Service',
              'Tira a instância da rotação, sem reiniciá-la',
            ],
            [
              'Alerta de SLI',
              'Os usuários recebem respostas corretas no tempo prometido?',
              'Time de plantão e painéis',
              'Avisa uma pessoa ou abre incidente',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O erro mais caro é colocar a verificação de dependências na liveness. Se o banco fica lento por dois minutos, todas as instâncias falham na liveness ao mesmo tempo, o kubelet reinicia todas, e cada reinício derruba as conexões quentes, esvazia caches locais e obriga o pool a reabrir sessões justamente quando o banco mais precisa de folga. A liveness só deve responder se o processo pode continuar; ela não deve depender de nada fora dele.',
        },
      ],
    },
    {
      title: 'Por que o endpoint responde 200 com o serviço parado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O endpoint típico cabe numa linha, e essa linha prova muito pouco. Ela mostra que o servidor HTTP aceitou a conexão e que o event loop executou o callback. Não mostra que o pool tem conexão livre, que o Redis responde, que a fila está sendo consumida nem que a resposta sai num tempo que o usuário tolera.',
        },
        { type: 'code', value: ingenuoCode },
        {
          type: 'paragraph',
          value:
            'Num processo Node.js com o pool do banco esgotado, esse handler continua respondendo em milissegundos, porque a espera pela conexão acontece dentro das rotas de negócio, e não no handler de saúde. O balanceador vê 200, mantém a instância na rotação e manda mais requisições para uma fila que não anda.',
        },
        {
          type: 'paragraph',
          value:
            'A causa aparece de dois jeitos. O primeiro é o health check medir só o processo, por escolha ou por pressa. O segundo é a checagem existir, mas sem prazo. Um SELECT 1 esperando uma conexão do pool fica pendurado, e no node-postgres, sem connectionTimeoutMillis, essa espera não tem fim. O orquestrador acaba marcando a instância como falha pelo timeout da sondagem, o que está certo pelo motivo errado: a instância não está morta, está saturada, e o motivo se perde no caminho.',
        },
      ],
    },
    {
      title: 'O que medir: a armadilha da dependência compartilhada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Verificar o banco no readiness parece a correção óbvia, e é exatamente o caminho que muitos times seguem depois do incidente. O risco é a correlação. Se todas as instâncias dependem do mesmo banco, uma lentidão nele tira todas da rotação ao mesmo tempo. Sem nenhuma instância saudável, o balanceador responde 503 para todo o tráfego, quando reduzir a concorrência para o banco teria preservado parte do atendimento. A verificação que deveria proteger o sistema vira a causa da indisponibilidade total.',
        },
        { type: 'diagram', value: diagramaPt },
        {
          type: 'paragraph',
          value:
            'A regra prática é separar o que a instância controla do que ela apenas consome. Pool local sem slot livre, worker de fila sem registro, drenagem em curso e event loop com atraso acima do limite operacional são estados da própria instância e podem entrar como critério de rotação. Banco compartilhado, Redis e APIs de terceiros costumam entrar como degradação: o endpoint informa o estado, o alerta dispara e a instância segue atendendo o que consegue.',
        },
        {
          type: 'paragraph',
          value:
            'Existe a exceção. Se a instância não tem como fazer nada sem uma dependência, porque a razão de existir dela é aquele recurso, a verificação pode ser crítica. Mesmo assim, avalie o efeito em massa: se a queda da dependência vai tirar todas as instâncias de uma vez, a decisão precisa de um limite de quantas podem sair simultaneamente, ou deve ficar com quem enxerga a frota inteira.',
        },
      ],
    },
    {
      title: 'Um avaliador que não mente em Node.js',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O avaliador abaixo tem quatro propriedades. Cada checagem tem prazo, então uma conexão que nunca chega vira falha em vez de espera infinita. As checagens rodam em paralelo, então o tempo total é o da mais lenta, e não a soma. O resultado vale por dois segundos e é compartilhado entre requisições concorrentes, para que uma rajada de sondagens não vire uma rajada de SELECT 1 contra o banco. E a resposta separa o que bloqueia a instância, com 503, do que só degrada, com 200 e o detalhe no corpo.',
        },
        { type: 'code', value: saudeCode },
        {
          type: 'list',
          items: [
            'O prazo interno precisa ficar abaixo do timeoutSeconds da sondagem, com folga. Se o avaliador leva 1,5 s e o kubelet desiste em 1 s, a instância é marcada como falha mesmo saudável, e o corpo da resposta nunca chega a quem precisava dele.',
            'O corpo expõe o nome das checagens e as mensagens de erro. Num endpoint público isso revela topologia e detalhes internos. Restrinja o endpoint à rede interna ou remova o campo erro da resposta e mantenha a mensagem no log.',
            'O event loop entra como degradação, não como bloqueio. Uma instância lenta por carga ainda produz; tirá-la da rotação concentra o tráfego nas outras, que ficam mais lentas, e o efeito se espalha.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Na inicialização, o avaliador é ligado ao pool e ao monitor de event loop:',
        },
        { type: 'code', value: usoCode },
      ],
    },
    {
      title: 'Quem lê o health check e o que cada um faz com ele',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um mesmo health check é lido por consumidores com regras diferentes, e configurar cada um sem pensar nos outros gera o próximo incidente. O kubelet olha a liveness e reinicia o container. O Service do Kubernetes usa a readiness para tirar o pod dos endpoints. Um balanceador externo, como um ALB apontando para IPs ou um nginx com upstream estático, faz a própria checagem e não obedece ao Kubernetes.',
        },
        {
          type: 'table',
          columns: ['Consumidor', 'Endpoint', 'Efeito da falha', 'Ajuste que evita o problema'],
          rows: [
            [
              'Kubelet (liveness)',
              '/health/live',
              'Reinicia o container',
              'Só o processo; initialDelaySeconds cobrindo a inicialização e failureThreshold alto',
            ],
            [
              'Service do Kubernetes (readiness)',
              '/health/ready',
              'Tira o pod dos endpoints',
              'timeoutSeconds acima do prazo interno do avaliador',
            ],
            [
              'Balanceador externo',
              '/health/ready',
              'Tira a instância do pool de destino',
              'Intervalo e limiar iguais aos da readiness, para não divergir',
            ],
            [
              'Alerta e painéis',
              '/health/ready e métricas',
              'Dispara notificação',
              'Alerta por janela de tempo, não por uma única amostra ruim',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O limiar importa mais do que parece. Com periodSeconds de 5 e failureThreshold de 2, uma instância ruim recebe tráfego por cerca de dez segundos antes de sair. A readiness precisa ser rápida para remover e tolerante para não remover por um soluço de meio segundo.',
        },
        { type: 'code', value: probesCode },
      ],
    },
    {
      title: 'Testar o caminho que deveria falhar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O endpoint de saúde costuma ser o código menos testado do serviço, e é justamente ele que decide se o serviço recebe tráfego. Testar que ele responde 200 quando tudo está bem não custa nada e não prova nada. O que importa é simular a dependência que não responde, o pool sem conexão livre e a checagem que lança erro, e verificar que o status muda e que a resposta sai dentro do prazo.',
        },
        { type: 'code', value: testeCode },
        {
          type: 'paragraph',
          value:
            'Teste de unidade prova a lógica, mas não o comportamento com o pool real. Dois exercícios completam a cobertura. O primeiro é um teste de carga com o pool no tamanho de produção e uma rota que segura a conexão por três segundos: a readiness deve passar a 503 enquanto a carga dura e voltar a 200 quando ela cai, sem nenhum reinício. O segundo é um experimento de falha em homologação, cortando a rede até o banco: o alerta precisa disparar e a instância precisa sair da rotação em poucos ciclos de sondagem. Se qualquer um desses resultados não acontecer, o health check é decoração.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Posso usar só o endpoint de liveness para o balanceador?',
      answer:
        'Pode, mas você perde a única informação que tira a instância da rotação sem reiniciá-la. Liveness reinicia; readiness remove. Quando a instância tem o pool esgotado mas o processo está íntegro, reiniciar só joga fora o cache e as conexões que ainda eram úteis. Use readiness para a rotação e reserve liveness para estado irrecuperável, como um deadlock comprovado ou um event loop parado por tempo demais.',
    },
    {
      question: 'Quantas checagens um health check deve ter?',
      answer:
        'As que mudam uma decisão. Cada checagem é um ponto de falha novo, um consumo extra de conexões e uma linha de ruído no alerta. Se uma checagem falha e ninguém faz nada diferente por causa dela, ela não pertence ao endpoint de readiness; é uma métrica. Três ou quatro checagens cobrindo pool, event loop e uma dependência crítica costumam bastar para a maioria dos serviços.',
    },
    {
      question: 'Como evitar que o próprio health check sobrecarregue o banco?',
      answer:
        'Com cache curto, como os dois segundos do avaliador, e com um SELECT 1 em vez de uma consulta de negócio. Se a sondagem roda a cada cinco segundos em dezenas de instâncias, o custo é pequeno; o risco aparece quando alguém troca o SELECT 1 por uma consulta com joins e cada sondagem vira carga real. Revise o health check com o mesmo rigor de uma rota de produção.',
    },
  ],
  conclusion: {
    title: 'O health check responde pelo que o serviço consegue fazer, não pelo que o processo é',
    description:
      'Um endpoint que responde 200 enquanto ninguém é atendido não é um sinal de saúde, é um sinal de que o processo está vivo. A liveness deve olhar só para o processo, a readiness deve refletir o estado local que a instância controla, as dependências compartilhadas devem degradar e não derrubar a frota, e cada checagem precisa de prazo, cache e um teste que simule a falha real. Com isso, o balanceador deixa de mandar tráfego para quem não consegue atender, e o time deixa de descobrir o incidente pelo suporte.',
    cta: 'Revisar os health checks do meu serviço',
  },
  related: [
    {
      label: 'Limite de conexões do banco esgotado: quando o pool vira o gargalo do serviço',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Graceful shutdown que ninguém testou: deploy que corta requisição no meio e derruba job em andamento',
      to: '/blog/graceful-shutdown-que-ninguem-testou-deploy-que-corta-requisicao-no-meio-e-derruba-job-em-andamento',
    },
    {
      label: 'Observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'A scenario that repeats across many teams: a service exposes a /health endpoint that has returned 200 for months. One Friday afternoon the database slows down, the connection pool runs out of free connections, and requests start waiting forty seconds before failing. The load balancer keeps sending traffic to every instance, because the health check keeps answering 200. It is not lying about being alive: the process is up, the event loop is spinning and the port accepts connections. But the endpoint never touches the database, so it has no way to know that nobody is being served. This article covers the difference between being alive and being able to serve, how liveness, readiness and alerting ask different questions, what an honest health check measures without pulling the whole fleet out of rotation when a shared dependency stumbles, and how to test the endpoint so that it fails when it should.',
  sections: [
    {
      title: 'Being alive is not the same as being able to serve',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A health check mixes three different questions, and most endpoints only answer the first one. Liveness asks whether the process is stuck and must be restarted: a deadlock, a stopped event loop, a state it cannot recover from. Readiness asks whether this instance should receive traffic right now. Alerting asks whether the service, as a whole, delivers what it promises to the people using it. Each one has a different consumer, a different action and a different cost of false positives, and mixing them up is the root of most of the problems.',
        },
        {
          type: 'table',
          columns: ['Check', 'Question', 'Who consumes it', 'Action when it fails'],
          rows: [
            [
              'Liveness',
              'Is the process stuck and in need of a restart?',
              'Kubelet or supervisor',
              'Restarts the container',
            ],
            [
              'Readiness',
              'Can this instance serve a request right now?',
              'Load balancer and Service endpoints',
              'Takes the instance out of rotation, without restarting it',
            ],
            [
              'SLI alerting',
              'Do users get correct responses within the promised time?',
              'On-call team and dashboards',
              'Pages a person or opens an incident',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The most expensive mistake is putting dependency checks in liveness. If the database slows down for two minutes, every instance fails liveness at the same time, the kubelet restarts all of them, and each restart drops warm connections, empties local caches and forces the pool to reopen sessions exactly when the database needs breathing room. Liveness should only answer whether the process can keep going; it must not depend on anything outside the process.',
        },
      ],
    },
    {
      title: 'Why the endpoint returns 200 while the service is stuck',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The typical endpoint fits on one line, and that line proves very little. It shows that the HTTP server accepted the connection and that the event loop ran the callback. It does not show that the pool has a free connection, that Redis answers, that the queue is being consumed, or that the response leaves within a time the user tolerates.',
        },
        { type: 'code', value: ingenuoCode },
        {
          type: 'paragraph',
          value:
            'In a Node.js process with an exhausted database pool, this handler keeps answering in milliseconds, because the wait for a connection happens inside the business routes and not in the health handler. The load balancer sees 200, keeps the instance in rotation and sends more requests to a queue that is not moving.',
        },
        {
          type: 'paragraph',
          value:
            'The cause shows up in two ways. The first is a health check that measures only the process, by choice or by haste. The second is a check that exists but has no deadline. A SELECT 1 waiting for a pool connection hangs, and in node-postgres, without connectionTimeoutMillis, that wait has no end. The orchestrator ends up marking the instance as failed through the probe timeout, which is right for the wrong reason: the instance is not dead, it is saturated, and the reason gets lost along the way.',
        },
      ],
    },
    {
      title: 'What to measure: the shared dependency trap',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Checking the database in readiness looks like the obvious fix, and it is exactly the path many teams take after an incident. The risk is correlation. If every instance depends on the same database, a slowdown there takes all of them out of rotation at the same time. With no healthy instance left, the load balancer answers 503 to all traffic, when reducing concurrency toward the database would have kept part of the service running. The check that was supposed to protect the system becomes the cause of a total outage.',
        },
        { type: 'diagram', value: diagramaEn },
        {
          type: 'paragraph',
          value:
            'The practical rule is to separate what the instance controls from what it merely consumes. A local pool with no free slot, a queue worker that is not registered, a drain in progress and an event loop delay above the operational limit are states of the instance itself, and they can be rotation criteria. A shared database, Redis and third-party APIs usually belong as degradation: the endpoint reports the state, the alert fires and the instance keeps serving what it can.',
        },
        {
          type: 'paragraph',
          value:
            'There is an exception. If the instance cannot do anything without a dependency, because that resource is the reason it exists, the check can be critical. Even then, evaluate the mass effect: if losing the dependency takes every instance out at once, the decision needs a limit on how many instances may leave simultaneously, or it should be made by whoever sees the whole fleet.',
        },
      ],
    },
    {
      title: 'An evaluator that does not lie, in Node.js',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The evaluator below has four properties. Every check has a deadline, so a connection that never arrives becomes a failure instead of an infinite wait. The checks run in parallel, so the total time is the slowest one, not the sum. The result is valid for two seconds and is shared among concurrent requests, so a burst of probes does not turn into a burst of SELECT 1 against the database. And the response separates what blocks the instance, with 503, from what only degrades it, with 200 and the detail in the body.',
        },
        { type: 'code', value: saudeCode },
        {
          type: 'list',
          items: [
            'The internal deadline must stay below the probe timeoutSeconds, with some margin. If the evaluator takes 1.5 s and the kubelet gives up after 1 s, the instance is marked as failed even when healthy, and the response body never reaches the one who needed it.',
            'The body exposes check names and error messages. On a public endpoint that reveals topology and internal details. Restrict the endpoint to the internal network, or remove the error field from the response and keep the message in the logs.',
            'The event loop enters as degradation, not as a block. A slow instance under load still produces results; taking it out of rotation concentrates traffic on the others, which become slower, and the effect spreads.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'At startup, the evaluator is wired to the pool and to the event loop monitor:',
        },
        { type: 'code', value: usoCode },
      ],
    },
    {
      title: 'Who reads the health check and what each one does with it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The same health check is read by consumers with different rules, and configuring each one without thinking about the others creates the next incident. The kubelet looks at liveness and restarts the container. The Kubernetes Service uses readiness to remove the pod from the endpoints. An external load balancer, such as an ALB pointing at IPs or an nginx with a static upstream, runs its own checks and does not obey Kubernetes.',
        },
        {
          type: 'table',
          columns: ['Consumer', 'Endpoint', 'Effect of a failure', 'Adjustment that avoids the problem'],
          rows: [
            [
              'Kubelet (liveness)',
              '/health/live',
              'Restarts the container',
              'Process only; initialDelaySeconds covering startup and a high failureThreshold',
            ],
            [
              'Kubernetes Service (readiness)',
              '/health/ready',
              'Removes the pod from the endpoints',
              'timeoutSeconds above the evaluator internal deadline',
            ],
            [
              'External load balancer',
              '/health/ready',
              'Removes the instance from the target pool',
              'Interval and threshold equal to the readiness ones, so they do not diverge',
            ],
            [
              'Alerting and dashboards',
              '/health/ready and metrics',
              'Triggers a notification',
              'Alert over a time window, not on a single bad sample',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The threshold matters more than it seems. With periodSeconds of 5 and failureThreshold of 2, a bad instance keeps receiving traffic for about ten seconds before it leaves. Readiness must be quick to remove and tolerant enough not to remove an instance over a half-second hiccup.',
        },
        { type: 'code', value: probesCode },
      ],
    },
    {
      title: 'Testing the path that should fail',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The health endpoint is usually the least tested code in the service, and it is exactly the code that decides whether the service receives traffic. Testing that it answers 200 when everything is fine costs nothing and proves nothing. What matters is simulating the dependency that does not answer, the pool with no free connection and the check that throws, and verifying that the status changes and that the response leaves within the deadline.',
        },
        { type: 'code', value: testeCode },
        {
          type: 'paragraph',
          value:
            'Unit tests prove the logic, but not the behavior with a real pool. Two exercises complete the coverage. The first is a load test with the pool at production size and a route that holds a connection for three seconds: readiness must switch to 503 while the load lasts and return to 200 when it drops, without any restart. The second is a failure experiment in staging, cutting the network to the database: the alert must fire and the instance must leave rotation within a few probe cycles. If any of these results does not happen, the health check is decoration.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can I use only the liveness endpoint for the load balancer?',
      answer:
        'You can, but you lose the only signal that takes an instance out of rotation without restarting it. Liveness restarts; readiness removes. When an instance has an exhausted pool but an intact process, restarting it only throws away the cache and the connections that were still useful. Use readiness for rotation and reserve liveness for unrecoverable states, such as a proven deadlock or an event loop stalled for too long.',
    },
    {
      question: 'How many checks should a health check have?',
      answer:
        'The ones that change a decision. Every check is a new point of failure, extra connection usage and a line of noise in alerting. If a check fails and nobody does anything different because of it, it does not belong in the readiness endpoint; it is a metric. Three or four checks covering the pool, the event loop and one critical dependency are usually enough for most services.',
    },
    {
      question: 'How do I keep the health check itself from overloading the database?',
      answer:
        'With a short cache, like the two seconds in the evaluator, and with SELECT 1 instead of a business query. If the probe runs every five seconds from dozens of instances, the cost is small; the risk appears when someone swaps SELECT 1 for a query with joins and every probe becomes real load. Review the health check with the same rigor as a production route.',
    },
  ],
  conclusion: {
    title: 'A health check should answer for what the service can do, not for what the process is',
    description:
      'An endpoint that returns 200 while nobody is being served is not a health signal, it is a sign that the process is alive. Liveness should look only at the process, readiness should reflect the local state the instance controls, shared dependencies should degrade instead of taking the fleet down, and every check needs a deadline, a cache and a test that simulates the real failure. With that in place, the load balancer stops sending traffic to instances that cannot serve, and the team stops learning about incidents from support.',
    cta: 'Review the health checks of my service',
  },
  related: [
    {
      label: 'Exhausted database connection limits: when the pool becomes the service bottleneck',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'The graceful shutdown nobody tested: deploys that cut requests mid-flight and kill running jobs',
      to: '/blog/graceful-shutdown-que-ninguem-testou-deploy-que-corta-requisicao-no-meio-e-derruba-job-em-andamento',
    },
    {
      label: 'Observability and reliability',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'Un escenario que se repite en muchos equipos: un servicio expone un endpoint /health que devuelve 200 desde hace meses. Un viernes por la tarde la base de datos se vuelve lenta, el pool de conexiones se queda sin conexiones libres y las peticiones empiezan a esperar cuarenta segundos antes de fallar. El balanceador sigue enviando tráfico a todas las instancias, porque el health check sigue respondiendo 200. No miente sobre estar vivo: el proceso está en pie, el event loop gira y el puerto acepta conexiones. Pero el endpoint nunca toca la base de datos, así que no tiene forma de saber que nadie está siendo atendido. Este artículo trata la diferencia entre estar vivo y poder atender, cómo liveness, readiness y alerta hacen preguntas distintas, qué debe medir un health check honesto sin sacar toda la flota de la rotación cuando una dependencia compartida tropieza, y cómo probar el endpoint para que falle cuando debe.',
  sections: [
    {
      title: 'Estar vivo no es lo mismo que poder atender',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un health check mezcla tres preguntas distintas, y la mayoría de los endpoints solo responde a la primera. La liveness pregunta si el proceso está atascado y necesita reiniciarse: un deadlock, un event loop detenido, un estado del que no puede recuperarse. La readiness pregunta si esta instancia debe recibir tráfico ahora. La alerta pregunta si el servicio, como conjunto, entrega lo que promete a quien lo usa. Cada una tiene consumidor, acción y costo de falso positivo distintos, y confundirlas es el origen de la mayoría de los problemas.',
        },
        {
          type: 'table',
          columns: ['Verificación', 'Pregunta', 'Quién la consume', 'Acción cuando falla'],
          rows: [
            [
              'Liveness',
              '¿El proceso está atascado y necesita reiniciarse?',
              'Kubelet o supervisor',
              'Reinicia el contenedor',
            ],
            [
              'Readiness',
              '¿Esta instancia puede atender una petición ahora?',
              'Balanceador y endpoints del Service',
              'Saca la instancia de la rotación, sin reiniciarla',
            ],
            [
              'Alerta de SLI',
              '¿Los usuarios reciben respuestas correctas en el tiempo prometido?',
              'Equipo de guardia y paneles',
              'Avisa a una persona o abre un incidente',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El error más caro es poner la verificación de dependencias en la liveness. Si la base de datos se vuelve lenta durante dos minutos, todas las instancias fallan la liveness a la vez, el kubelet reinicia todas, y cada reinicio tira las conexiones calientes, vacía las cachés locales y obliga al pool a reabrir sesiones justo cuando la base de datos más necesita holgura. La liveness solo debe responder si el proceso puede seguir; no debe depender de nada fuera de él.',
        },
      ],
    },
    {
      title: 'Por qué el endpoint responde 200 con el servicio parado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El endpoint típico cabe en una línea, y esa línea prueba muy poco. Muestra que el servidor HTTP aceptó la conexión y que el event loop ejecutó el callback. No muestra que el pool tiene una conexión libre, que Redis responde, que la cola se está consumiendo ni que la respuesta sale en un tiempo que el usuario tolera.',
        },
        { type: 'code', value: ingenuoCode },
        {
          type: 'paragraph',
          value:
            'En un proceso Node.js con el pool de la base de datos agotado, este handler sigue respondiendo en milisegundos, porque la espera por la conexión ocurre dentro de las rutas de negocio y no en el handler de salud. El balanceador ve 200, mantiene la instancia en rotación y envía más peticiones a una cola que no avanza.',
        },
        {
          type: 'paragraph',
          value:
            'La causa aparece de dos maneras. La primera es que el health check mida solo el proceso, por decisión o por prisa. La segunda es que la verificación exista pero sin plazo. Un SELECT 1 que espera una conexión del pool queda colgado, y en node-postgres, sin connectionTimeoutMillis, esa espera no tiene fin. El orquestador acaba marcando la instancia como fallida por el timeout de la sonda, lo que es correcto por el motivo equivocado: la instancia no está muerta, está saturada, y el motivo se pierde en el camino.',
        },
      ],
    },
    {
      title: 'Qué medir: la trampa de la dependencia compartida',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Verificar la base de datos en la readiness parece la corrección obvia, y es justo el camino que muchos equipos siguen después de un incidente. El riesgo es la correlación. Si todas las instancias dependen de la misma base de datos, una lentitud ahí saca a todas de la rotación al mismo tiempo. Sin ninguna instancia sana, el balanceador responde 503 a todo el tráfico, cuando reducir la concurrencia hacia la base de datos habría conservado parte de la atención. La verificación que debía proteger el sistema se convierte en la causa de la indisponibilidad total.',
        },
        { type: 'diagram', value: diagramaEs },
        {
          type: 'paragraph',
          value:
            'La regla práctica es separar lo que la instancia controla de lo que solo consume. Un pool local sin slots libres, un worker de cola sin registrar, un drenado en curso y un event loop con retraso por encima del límite operativo son estados de la propia instancia, y pueden ser criterio de rotación. La base de datos compartida, Redis y las APIs de terceros suelen entrar como degradación: el endpoint informa el estado, la alerta se dispara y la instancia sigue atendiendo lo que puede.',
        },
        {
          type: 'paragraph',
          value:
            'Existe la excepción. Si la instancia no puede hacer nada sin una dependencia, porque la razón de existir de ella es ese recurso, la verificación puede ser crítica. Aun así, evalúa el efecto en masa: si la caída de la dependencia va a sacar todas las instancias a la vez, la decisión necesita un límite de cuántas pueden salir simultáneamente, o debe quedar en manos de quien ve toda la flota.',
        },
      ],
    },
    {
      title: 'Un evaluador que no miente en Node.js',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El evaluador de abajo tiene cuatro propiedades. Cada verificación tiene plazo, así que una conexión que nunca llega se convierte en falla en vez de espera infinita. Las verificaciones corren en paralelo, así que el tiempo total es el de la más lenta, y no la suma. El resultado vale dos segundos y se comparte entre peticiones concurrentes, para que una ráfaga de sondeos no se convierta en una ráfaga de SELECT 1 contra la base de datos. Y la respuesta separa lo que bloquea la instancia, con 503, de lo que solo la degrada, con 200 y el detalle en el cuerpo.',
        },
        { type: 'code', value: saudeCode },
        {
          type: 'list',
          items: [
            'El plazo interno debe quedar por debajo del timeoutSeconds de la sonda, con margen. Si el evaluador tarda 1,5 s y el kubelet se rinde en 1 s, la instancia se marca como fallida aunque esté sana, y el cuerpo de la respuesta nunca llega a quien lo necesitaba.',
            'El cuerpo expone los nombres de las verificaciones y los mensajes de error. En un endpoint público eso revela topología y detalles internos. Restringe el endpoint a la red interna o quita el campo de error de la respuesta y deja el mensaje en el log.',
            'El event loop entra como degradación, no como bloqueo. Una instancia lenta por carga sigue produciendo; sacarla de la rotación concentra el tráfico en las demás, que se vuelven más lentas, y el efecto se propaga.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Al arrancar, el evaluador se conecta al pool y al monitor del event loop:',
        },
        { type: 'code', value: usoCode },
      ],
    },
    {
      title: 'Quién lee el health check y qué hace con él',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un mismo health check lo leen consumidores con reglas distintas, y configurar cada uno sin pensar en los demás genera el siguiente incidente. El kubelet mira la liveness y reinicia el contenedor. El Service de Kubernetes usa la readiness para quitar el pod de los endpoints. Un balanceador externo, como un ALB apuntando a IPs o un nginx con upstream estático, hace su propia verificación y no obedece a Kubernetes.',
        },
        {
          type: 'table',
          columns: ['Consumidor', 'Endpoint', 'Efecto de la falla', 'Ajuste que evita el problema'],
          rows: [
            [
              'Kubelet (liveness)',
              '/health/live',
              'Reinicia el contenedor',
              'Solo el proceso; initialDelaySeconds cubriendo el arranque y failureThreshold alto',
            ],
            [
              'Service de Kubernetes (readiness)',
              '/health/ready',
              'Quita el pod de los endpoints',
              'timeoutSeconds por encima del plazo interno del evaluador',
            ],
            [
              'Balanceador externo',
              '/health/ready',
              'Saca la instancia del pool de destino',
              'Intervalo y umbral iguales a los de la readiness, para no divergir',
            ],
            [
              'Alerta y paneles',
              '/health/ready y métricas',
              'Dispara una notificación',
              'Alerta por ventana de tiempo, no por una sola muestra mala',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El umbral importa más de lo que parece. Con periodSeconds de 5 y failureThreshold de 2, una instancia mala recibe tráfico unos diez segundos antes de salir. La readiness debe ser rápida para quitar y tolerante para no quitar por un tropiezo de medio segundo.',
        },
        { type: 'code', value: probesCode },
      ],
    },
    {
      title: 'Probar el camino que debería fallar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El endpoint de salud suele ser el código menos probado del servicio, y es justamente el que decide si el servicio recibe tráfico. Probar que responde 200 cuando todo está bien no cuesta nada y no demuestra nada. Lo que importa es simular la dependencia que no responde, el pool sin conexiones libres y la verificación que lanza un error, y comprobar que el estado cambia y que la respuesta sale dentro del plazo.',
        },
        { type: 'code', value: testeCode },
        {
          type: 'paragraph',
          value:
            'Las pruebas unitarias demuestran la lógica, pero no el comportamiento con el pool real. Dos ejercicios completan la cobertura. El primero es una prueba de carga con el pool al tamaño de producción y una ruta que retiene la conexión tres segundos: la readiness debe pasar a 503 mientras dura la carga y volver a 200 cuando baja, sin ningún reinicio. El segundo es un experimento de falla en homologación, cortando la red hacia la base de datos: la alerta debe dispararse y la instancia debe salir de la rotación en pocos ciclos de sonda. Si cualquiera de esos resultados no ocurre, el health check es decoración.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Puedo usar solo el endpoint de liveness para el balanceador?',
      answer:
        'Puedes, pero pierdes la única señal que saca la instancia de la rotación sin reiniciarla. La liveness reinicia; la readiness quita. Cuando la instancia tiene el pool agotado pero el proceso está íntegro, reiniciarla solo tira la caché y las conexiones que todavía eran útiles. Usa la readiness para la rotación y reserva la liveness para un estado irrecuperable, como un deadlock comprobado o un event loop detenido durante demasiado tiempo.',
    },
    {
      question: '¿Cuántas verificaciones debe tener un health check?',
      answer:
        'Las que cambian una decisión. Cada verificación es un nuevo punto de falla, un consumo extra de conexiones y una línea de ruido en la alerta. Si una verificación falla y nadie hace algo distinto por eso, no pertenece al endpoint de readiness; es una métrica. Tres o cuatro verificaciones que cubran el pool, el event loop y una dependencia crítica suelen bastar para la mayoría de los servicios.',
    },
    {
      question: '¿Cómo evito que el propio health check sature la base de datos?',
      answer:
        'Con una caché corta, como los dos segundos del evaluador, y con un SELECT 1 en lugar de una consulta de negocio. Si la sonda corre cada cinco segundos desde decenas de instancias, el costo es pequeño; el riesgo aparece cuando alguien cambia el SELECT 1 por una consulta con joins y cada sonda se convierte en carga real. Revisa el health check con el mismo rigor que una ruta de producción.',
    },
  ],
  conclusion: {
    title: 'El health check responde por lo que el servicio puede hacer, no por lo que el proceso es',
    description:
      'Un endpoint que responde 200 mientras nadie está siendo atendido no es una señal de salud, es una señal de que el proceso está vivo. La liveness debe mirar solo el proceso, la readiness debe reflejar el estado local que la instancia controla, las dependencias compartidas deben degradar y no tumbar la flota, y cada verificación necesita plazo, caché y una prueba que simule la falla real. Con eso, el balanceador deja de enviar tráfico a quien no puede atender, y el equipo deja de descubrir el incidente por soporte.',
    cta: 'Revisar los health checks de mi servicio',
  },
  related: [
    {
      label: 'Límite de conexiones de la base agotado: cuándo el pool se vuelve el cuello de botella del servicio',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'El graceful shutdown que nadie probó: despliegues que cortan peticiones a medias y matan jobs en curso',
      to: '/blog/graceful-shutdown-que-ninguem-testou-deploy-que-corta-requisicao-no-meio-e-derruba-job-em-andamento',
    },
    {
      label: 'Observabilidad y confiabilidad',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
