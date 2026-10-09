// Conteudo do artigo: graceful shutdown. O que acontece entre o SIGTERM e o SIGKILL,
// os jeitos comuns de morrer errado (sair na hora, nunca tratar o sinal, fechar sem
// esperar o keep-alive), a sequencia certa para drenar HTTP, como parar um worker sem
// perder o job, como encaixar tudo no orcamento de tempo do orquestrador e como testar.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Encerramento gracioso em Node.js sem dependências: readiness separado de liveness, atraso de propagação, drenagem HTTP com prazo que derruba keep-alive ocioso e informa o que cortou, worker que para de reservar, interrompe no checkpoint e devolve o job para a fila, trava de segurança abaixo do terminationGracePeriodSeconds e testes com node:test.',
  en: 'Graceful shutdown in Node.js with no dependencies: readiness separated from liveness, propagation delay, deadline-bound HTTP draining that drops idle keep-alive connections and reports what it cut, a worker that stops reserving, interrupts at a checkpoint and returns the job to the queue, a safety deadline below terminationGracePeriodSeconds, and tests with node:test.',
  es: 'Apagado ordenado en Node.js sin dependencias: readiness separado de liveness, retraso de propagación, drenaje HTTP con plazo que cierra el keep-alive ocioso e informa lo que cortó, worker que deja de reservar, se interrumpe en el checkpoint y devuelve el job a la cola, freno de seguridad por debajo de terminationGracePeriodSeconds y pruebas con node:test.',
};

const repoUrl = 'https://github.com/joaosouz4dev/graceful-shutdown-node-mini';

const diagram = `t=0s   kubectl rollout / scale down: o pod entra em Terminating
        |
        |-- (a) kubelet: preStop, depois SIGTERM para o PID 1 do container
        '-- (b) controle: tira o pod dos EndpointSlices
                 '-- kube-proxy, ingress, service mesh e ALB aplicam a remocao
                     em momentos diferentes, segundos depois   <- requisicoes ainda chegam

        (a) e (b) correm em paralelo: nada garante que (b) termina antes de (a)

t=30s  terminationGracePeriodSeconds vence (o preStop conta dentro dele)
        '-- SIGKILL: sem handler, sem finally, sem flush. O que estava no meio morre no meio.`;

const servidorCode = `import http from 'node:http';
import { setTimeout as esperar } from 'node:timers/promises';

export function criarServidorGracioso(handler, opcoes = {}) {
  const { atrasoPropagacaoMs = 5000, prazoDrenagemMs = 15000 } = opcoes;
  let pronto = true;
  let ativas = 0;
  let aoZerar = null;

  const server = http.createServer(async (req, res) => {
    if (req.url === '/healthz/live') {
      res.writeHead(200).end('ok'); // o processo esta vivo, mesmo encerrando
      return;
    }
    if (req.url === '/healthz/ready') {
      res.writeHead(pronto ? 200 : 503).end(pronto ? 'ok' : 'encerrando');
      return;
    }

    ativas++;
    // Durante a drenagem, cada resposta fecha a conexao em vez de devolve-la ao pool
    if (!pronto) res.setHeader('Connection', 'close');
    res.on('close', () => {
      ativas--;
      if (ativas === 0 && aoZerar) aoZerar();
    });

    try {
      await handler(req, res);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });

  async function drenar() {
    pronto = false; // 1. readiness passa a 503
    await esperar(atrasoPropagacaoMs); // 2. tempo para a remocao chegar a todos os balanceadores

    const fechado = new Promise((resolve) => server.close(resolve)); // 3. para de aceitar conexoes
    server.closeIdleConnections(); // 4. derruba o keep-alive que nao tem requisicao

    const semAtivas = ativas === 0 ? Promise.resolve() : new Promise((r) => (aoZerar = r));
    const resultado = await Promise.race([
      semAtivas.then(() => 'drenado'),
      esperar(prazoDrenagemMs, 'prazo', { ref: false }),
    ]);

    const cortadas = ativas;
    if (resultado === 'prazo') server.closeAllConnections(); // 5. prazo estourou: corta o resto
    else server.closeIdleConnections(); // conexoes que ficaram ociosas durante a drenagem
    await fechado;
    return { cortadas };
  }

  return { server, drenar };
}`;

const workerCode = `import { setTimeout as esperar } from 'node:timers/promises';

export function criarWorker({ fila, processar, intervaloMs = 200 }) {
  const controle = new AbortController();
  let parando = false;

  const rodando = (async () => {
    while (!parando) {
      const job = await fila.reservar();
      if (!job) {
        await esperar(intervaloMs, undefined, { ref: false });
        continue;
      }
      try {
        await processar(job, controle.signal);
        await fila.concluir(job);
      } catch (erro) {
        // Abortado no encerramento ou falha real: volta para a fila e outra instancia retoma
        const motivo = controle.signal.aborted ? 'encerramento' : String(erro.message);
        await fila.devolver(job, motivo);
        if (!controle.signal.aborted) await esperar(intervaloMs, undefined, { ref: false });
      }
    }
  })();

  async function parar(prazoMs) {
    parando = true; // 1. nao reserva mais nada
    const terminou = await Promise.race([
      rodando.then(() => true),
      esperar(prazoMs, false, { ref: false }),
    ]);
    if (!terminou) {
      controle.abort(); // 2. prazo estourou: o job para no proximo checkpoint
      await rodando;
    }
    return { jobInterrompido: !terminou };
  }

  return { parar };
}

// O job coopera: verifica o sinal ENTRE etapas, nunca no meio de uma
async function conciliarLote(job, signal) {
  for (const boleto of job.boletos) {
    signal.throwIfAborted();
    await conciliarBoleto(boleto); // idempotente: refazer um boleto ja conciliado nao muda nada
  }
}`;

const mainCode = `const PRAZO_TOTAL_MS = 25_000; // abaixo dos 30 s de terminationGracePeriodSeconds

let encerrando = false;
async function encerrar(sinal) {
  if (encerrando) return; // segundo sinal nao reinicia a drenagem
  encerrando = true;
  log.info({ sinal }, 'encerramento iniciado');

  // Trava de seguranca: se algo travar, sai com erro registrado antes do SIGKILL
  setTimeout(() => {
    log.error('prazo total estourado, saindo com trabalho pendente');
    process.exit(1);
  }, PRAZO_TOTAL_MS).unref();

  // HTTP e worker drenam em paralelo; o worker aproveita o atraso de propagacao
  const [http, jobs] = await Promise.all([app.drenar(), worker.parar(15_000)]);
  await broker.close();
  await pool.end(); // so depois: requisicoes e jobs drenando ainda usam o banco
  log.info({ ...http, ...jobs }, 'encerramento concluido');
  process.exit(0);
}

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));`;

const deployCode = `# Dockerfile: forma exec, node como processo que recebe o sinal
FROM node:22-alpine
WORKDIR /app
COPY . .
# Nao use CMD npm start nem a forma shell (CMD node src/main.js): o sinal para no npm ou no sh
CMD ["node", "src/main.js"]

# deployment.yaml (trecho)
spec:
  terminationGracePeriodSeconds: 30   # o orcamento inteiro, preStop incluido
  containers:
    - name: api
      readinessProbe:
        httpGet: { path: /healthz/ready, port: 3000 }
        periodSeconds: 2
        failureThreshold: 1
      livenessProbe:
        httpGet: { path: /healthz/live, port: 3000 }   # nunca a mesma rota da readiness
        periodSeconds: 10
        failureThreshold: 3`;

const testCode = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as esperar } from 'node:timers/promises';
import { criarServidorGracioso } from '../src/servidor.js';

test('requisicao em andamento termina com 200 durante o encerramento', async () => {
  const app = criarServidorGracioso(
    async (req, res) => {
      await esperar(400);
      res.writeHead(200).end('feito');
    },
    { atrasoPropagacaoMs: 50, prazoDrenagemMs: 2000 },
  );
  app.server.listen(0);
  await once(app.server, 'listening');
  const url = \`http://127.0.0.1:\${app.server.address().port}/pedidos\`;

  const resposta = fetch(url);
  await esperar(50); // a requisicao ja esta no meio quando o encerramento comeca
  const drenagem = app.drenar();

  assert.equal((await resposta).status, 200);
  assert.deepEqual(await drenagem, { cortadas: 0 });
});`;

const pt = {
  intro:
    'Uma plataforma de cobrança fazia seis deploys por dia, e cada um gerava entre 30 e 80 respostas 502 no balanceador. O time tinha um nome para isso: ruído de deploy. O cliente que recebia o 502 no meio de um pagamento tentava de novo e quase sempre dava certo, então ninguém priorizou. Até a tarde em que um deploy pegou o job de conciliação no meio: ele tinha reservado um lote de 1.200 boletos, marcado todos como em processamento e conciliado 400 quando o processo recebeu SIGKILL. Os outros 800 ficaram presos em processando, e nenhum outro worker os pegava porque o estado dizia que alguém já estava cuidando. A descoberta veio dois dias depois, pelo suporte. O código tinha um handler de SIGTERM. Ninguém nunca tinha verificado se ele rodava. Este artigo mostra o que realmente acontece entre o SIGTERM e o SIGKILL, os três jeitos comuns de morrer errado, a sequência que drena HTTP sem cortar requisição, como parar um worker sem perder o job, como encaixar tudo no orçamento de tempo do orquestrador e como testar para que o encerramento deixe de ser o caminho de código que só roda em produção.',
  sections: [
    {
      title: 'O que acontece entre o SIGTERM e o SIGKILL',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando um pod entra em Terminating, o Kubernetes dispara duas coisas ao mesmo tempo. O kubelet executa o preStop, se houver, e envia SIGTERM ao processo principal do container. Em paralelo, o plano de controle tira o pod dos EndpointSlices, e cada componente que encaminha tráfego, kube-proxy, ingress, service mesh, um ALB fora do cluster, aplica essa remoção no seu próprio ritmo. As duas trilhas não se esperam. É comum o SIGTERM chegar antes de o último balanceador parar de mandar requisições, e um processo que fecha o servidor no instante do sinal recusa conexões que ainda estão sendo roteadas para ele.',
        },
        { type: 'diagram', value: diagram },
        {
          type: 'paragraph',
          value:
            'O segundo fato é o prazo. terminationGracePeriodSeconds, 30 segundos por padrão, conta a partir do início do término e inclui o tempo do preStop. Quando vence, o processo recebe SIGKILL, que não pode ser tratado: não roda finally, não roda handler, não faz flush de log. Tudo o que estava no meio fica no meio. ECS, Nomad, systemd e o docker stop seguem o mesmo contrato com nomes diferentes: um sinal educado, um prazo e um sinal que não negocia.',
        },
        {
          type: 'list',
          items: [
            'O SIGTERM é um aviso de que o tráfego vai parar, não uma confirmação de que já parou.',
            'O prazo é do encerramento inteiro: atraso de propagação, drenagem, jobs, fechamento de recursos e flush cabem no mesmo orçamento.',
            'O SIGKILL vai acontecer em algum momento, em algum deploy. O sistema precisa estar correto mesmo assim, e o encerramento gracioso só reduz a frequência.',
          ],
        },
      ],
    },
    {
      title: 'Os três jeitos comuns de morrer errado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quase todo encerramento quebrado cai em um de três padrões, e cada um deixa uma assinatura diferente nas métricas. Reconhecer a assinatura economiza a investigação.',
        },
        {
          type: 'table',
          columns: ['Padrão', 'Assinatura', 'Causa típica', 'Correção'],
          rows: [
            [
              'Sai na hora',
              'Rajada de 502 e connection reset no balanceador a cada deploy, logo no início do rollout',
              'Nenhum handler, ou handler que chama server.close() e process.exit() imediatamente',
              'Atraso de propagação antes de fechar, e drenagem das requisições em andamento',
            ],
            [
              'Nunca trata o sinal',
              'Todo pod leva exatamente 30 s para morrer; jobs e requisições longas terminam cortados por SIGKILL',
              'CMD em forma shell ou npm start: o sinal fica no sh ou no npm e não chega ao node; node como PID 1 sem handler ignora SIGTERM',
              'CMD em forma exec com node direto, handler explícito, --init ou tini para colher zumbis',
            ],
            [
              'Fecha sem esperar o keep-alive',
              '502 esporádicos mesmo com drenagem, concentrados em quem usa conexões persistentes',
              'O balanceador reutiliza uma conexão que o servidor acabou de fechar; keepAliveTimeout do Node menor que o idle timeout do balanceador',
              'Connection: close durante a drenagem, closeIdleConnections() e keepAliveTimeout maior que o idle timeout do balanceador',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O segundo padrão engana porque o código parece certo. Com CMD npm start, quem recebe o SIGTERM é o npm, e com CMD em forma shell é o /bin/sh, que não repassa o sinal ao filho. Pior: se o node for o PID 1 e não registrar handler, o kernel simplesmente ignora o SIGTERM, porque o PID 1 não recebe a ação padrão de sinais. Em todos os casos, o processo continua atendendo até o SIGKILL, 30 segundos depois. Os deploys ficam lentos e, no fim, cortam do mesmo jeito.',
        },
      ],
    },
    {
      title: 'A sequência que drena HTTP sem cortar requisição',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A ordem importa mais que qualquer detalhe. Primeiro, o processo avisa que não quer mais tráfego: a readiness passa a responder 503 enquanto a liveness continua 200, porque o processo está vivo e só está saindo. No Kubernetes o pod em término já sai dos endpoints sem depender da readiness, mas balanceadores com health check próprio, como um ALB apontando para IPs, um upstream de nginx ou um Consul, dependem dela. Segundo, o processo continua atendendo normalmente por alguns segundos, o atraso de propagação, para que a remoção chegue a todos. Só então fecha o servidor, derruba conexões keep-alive ociosas, espera as requisições em andamento com um prazo e, se o prazo estourar, corta o que sobrou e informa quantas foram cortadas.',
        },
        { type: 'code', value: servidorCode },
        {
          type: 'list',
          items: [
            'server.close() só para de aceitar conexões novas. Conexões keep-alive já abertas continuam podendo trazer requisições; por isso closeIdleConnections() logo em seguida e Connection: close em toda resposta durante a drenagem.',
            'O contador usa o evento close da resposta, que dispara tanto quando a resposta termina quanto quando o cliente desiste. Usar finish deixaria o contador preso em requisições abortadas pelo cliente.',
            'O número de requisições cortadas é a métrica que prova que a drenagem funciona. Registre-o no log final; um valor diferente de zero em deploy normal significa prazo curto ou requisição que não deveria ser síncrona.',
            'O atraso pode ficar no processo, como no código, ou num preStop com sleep, que versões recentes do Kubernetes aceitam nativamente. Escolha um dos dois: os dois somados só gastam orçamento.',
          ],
        },
      ],
    },
    {
      title: 'Parar o worker sem perder o job',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Job em background tem um problema que requisição HTTP não tem: ele pode durar mais que o prazo inteiro. A conciliação de 1.200 boletos levava quatro minutos e nunca caberia em 30 segundos. O worker precisa de três comportamentos. Ao receber o pedido de parada, deixa de reservar jobs novos. Se o job atual termina dentro do prazo, ótimo. Se não termina, interrompe num ponto seguro, um checkpoint entre etapas, e devolve o job para a fila, para que outra instância continue.',
        },
        { type: 'code', value: workerCode },
        {
          type: 'paragraph',
          value:
            'O checkpoint só funciona se o job cooperar e se cada etapa for idempotente: interromper depois do boleto 400 e reprocessar o lote em outra instância não pode conciliar o boleto 399 duas vezes. Quebrar o lote em unidades pequenas resolve as duas coisas, porque cada unidade termina rápido e cada uma é refeita sem efeito colateral. O bug do incidente não era só o SIGKILL. Era o estado processando gravado no banco sem dono e sem expiração. Um lease com prazo, em que o job reservado volta a ficar disponível se o worker não renovar a reserva, torna o SIGKILL inofensivo: o job reaparece sozinho alguns minutos depois. BullMQ, SQS e RabbitMQ oferecem isso como stalled job, visibility timeout e mensagem sem ack, respectivamente.',
        },
      ],
    },
    {
      title: 'Encaixar tudo no orçamento de tempo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O processo inteiro tem um prazo, e cada etapa precisa de uma fatia dele. O erro clássico é configurar a drenagem para 30 segundos com terminationGracePeriodSeconds também em 30: o SIGKILL chega antes do flush do log que diria o que deu errado. A regra é que o processo sempre saia sozinho, com código de saída e log, antes do orquestrador precisar matá-lo.',
        },
        {
          type: 'table',
          columns: ['Etapa', 'Fatia', 'Observação'],
          rows: [
            ['Atraso de propagação', '0 a 5 s', 'Readiness em 503, ainda atendendo. Se usar preStop, ele consome esta fatia'],
            ['Drenagem HTTP', 'até 15 s', 'Requisições em andamento terminam; o que passar disso é cortado e contado'],
            ['Worker', 'até 15 s, em paralelo', 'Começa no SIGTERM e aproveita o atraso de propagação'],
            ['Fechar broker e pool', '1 a 2 s', 'Depois da drenagem: requisições e jobs ainda usam o banco'],
            ['Trava de segurança', '25 s', 'process.exit(1) com log se qualquer etapa travar'],
            ['Margem até o SIGKILL', '5 s', 'Flush de log, métricas e atraso de agendamento do kubelet'],
          ],
        },
        { type: 'code', value: mainCode },
        {
          type: 'paragraph',
          value:
            'O pool fecha por último porque requisições e jobs drenando ainda fazem consultas; fechá-lo antes transforma uma requisição que terminaria com 200 em um 500. A guarda contra o segundo sinal evita que um Ctrl+C repetido ou um SIGTERM duplicado reinicie a drenagem. E o lado da imagem precisa entregar o sinal ao processo certo, com probes que distinguem readiness de liveness.',
        },
        { type: 'code', value: deployCode },
      ],
    },
    {
      title: 'Testar o caminho que só roda em produção',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O handler de encerramento é executado algumas vezes por dia, sempre em produção e sempre sem ninguém olhando. Por isso ele quebra em silêncio: um refactor troca a ordem do pool.end(), uma dependência nova segura um timer, uma mudança no Dockerfile volta para npm start. Três camadas de teste fecham esse buraco.',
        },
        {
          type: 'ordered',
          items: [
            'Teste unitário da drenagem: suba o servidor numa porta efêmera, dispare uma requisição lenta, chame drenar() no meio dela e verifique que ela termina com 200 e que cortadas é zero. Repita para o prazo estourado, o keep-alive ocioso e o worker que devolve o job.',
            'Teste de sinal real em container: rode a imagem, dispare requisições, envie SIGTERM ao processo e confira que todas terminam e que o código de saída é 0. É o único teste que pega o npm start e o PID 1, e roda em segundos no CI.',
            'Deploy sob carga em staging: mantenha um gerador de carga constante durante um rollout completo e conte as respostas que não são 2xx. A meta é zero. Rode antes de mudar a imagem base, o balanceador ou a configuração de probes.',
          ],
        },
        { type: 'code', value: testCode },
        {
          type: 'paragraph',
          value:
            'Em produção, duas métricas mantêm o encerramento honesto: a contagem de 502 e 503 no balanceador agrupada por janela de deploy, e a contagem de requisições e jobs cortados registrada no log final de cada processo. Se os 502 de deploy voltarem a aparecer, a pergunta deixa de ser se é ruído e passa a ser qual das três assinaturas eles têm.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Se o Kubernetes já tira o pod dos endpoints, por que a readiness precisa responder 503?',
      answer:
        'Porque nem todo tráfego passa pelos endpoints do Kubernetes. Um ALB apontando direto para IPs de pods, um nginx com upstream estático ou um service discovery como Consul decidem pela própria checagem de saúde. A readiness em 503 avisa esses balanceadores e torna o estado do processo visível. O que garante o fim das requisições, nos dois casos, é o atraso de propagação antes de fechar o servidor.',
    },
    {
      question: 'Qual valor usar no terminationGracePeriodSeconds?',
      answer:
        'O suficiente para a requisição síncrona mais longa aceitável terminar, somado ao atraso de propagação e ao fechamento de recursos, com margem. Para APIs comuns, 30 segundos sobram. Aumentar para minutos para caber um job longo é um erro: deploys e scale down ficam lentos e o job continua vulnerável a SIGKILL por falha de nó. Job longo se resolve com checkpoint, devolução para a fila e lease, não com prazo maior.',
    },
    {
      question: 'Uma requisição longa, como exportação de relatório, deve segurar o encerramento?',
      answer:
        'Não. Se uma requisição pode passar do prazo de drenagem, ela não deveria ser síncrona: o certo é responder 202, processar em background e entregar o resultado por link ou notificação. A métrica de requisições cortadas aponta exatamente essas rotas. Enquanto elas existirem, o encerramento só escolhe entre cortar o cliente ou atrasar todos os deploys.',
    },
  ],
  conclusion: {
    title: 'Encerramento é código de produção e merece teste de produção',
    description:
      'Todo processo morre muitas vezes por dia, a cada deploy, scale down e troca de nó. O SIGTERM avisa que o tráfego vai parar, não que parou, e o prazo até o SIGKILL é do encerramento inteiro. Readiness em 503, atraso de propagação, drenagem com prazo que informa o que cortou, worker que interrompe no checkpoint e devolve o job, recursos fechados por último e uma trava abaixo do prazo do orquestrador transformam o ruído de deploy em zero requisição cortada. Jobs idempotentes com lease garantem que o SIGKILL que ainda vai acontecer não deixe nada preso. E três camadas de teste, unitário, sinal real em container e deploy sob carga, fazem desse caminho algo que se verifica antes da produção, não depois do suporte.',
    cta: 'Revisar os deploys do meu sistema',
  },
  related: [
    {
      label: 'Job agendado que roda duas vezes: exclusão mútua distribuída sem trava eterna',
      to: '/blog/job-agendado-que-roda-duas-vezes-exclusao-mutua-distribuida-sem-trava-eterna',
    },
    {
      label: 'Sessão pegajosa no balanceador: o custo escondido de amarrar o usuário a uma instância',
      to: '/blog/sessao-pegajosa-balanceador-custo-de-amarrar-usuario-a-uma-instancia',
    },
    {
      label: 'Observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
  repo: { name: 'graceful-shutdown-node-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'A billing platform deployed six times a day, and each deploy produced between 30 and 80 502 responses at the load balancer. The team had a name for it: deploy noise. A customer who got a 502 in the middle of a payment retried and it almost always worked, so nobody prioritized it. Until the afternoon a deploy caught the reconciliation job mid-run: it had reserved a batch of 1,200 invoices, marked all of them as processing and reconciled 400 when the process received SIGKILL. The other 800 stayed stuck in processing, and no other worker picked them up because the status said someone was already handling them. Support found out two days later. The code had a SIGTERM handler. Nobody had ever checked whether it ran. This article shows what actually happens between SIGTERM and SIGKILL, the three common ways to die wrong, the sequence that drains HTTP without cutting requests, how to stop a worker without losing the job, how to fit everything into the orchestrator time budget, and how to test it so that shutdown stops being the code path that only runs in production.',
  sections: [
    {
      title: 'What happens between SIGTERM and SIGKILL',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When a pod enters Terminating, Kubernetes triggers two things at the same time. The kubelet runs the preStop hook, if there is one, and sends SIGTERM to the main process of the container. In parallel, the control plane removes the pod from the EndpointSlices, and every component that forwards traffic, kube-proxy, ingress, service mesh, an ALB outside the cluster, applies that removal at its own pace. The two tracks do not wait for each other. SIGTERM often arrives before the last load balancer stops sending requests, and a process that closes its server the moment the signal arrives refuses connections that are still being routed to it.',
        },
        { type: 'diagram', value: diagram },
        {
          type: 'paragraph',
          value:
            'The second fact is the deadline. terminationGracePeriodSeconds, 30 seconds by default, counts from the start of termination and includes the preStop time. When it expires, the process receives SIGKILL, which cannot be handled: no finally runs, no handler runs, no log is flushed. Whatever was in the middle stays in the middle. ECS, Nomad, systemd and docker stop follow the same contract under different names: a polite signal, a deadline and a signal that does not negotiate.',
        },
        {
          type: 'list',
          items: [
            'SIGTERM is a warning that traffic is about to stop, not a confirmation that it already has.',
            'The deadline covers the whole shutdown: propagation delay, draining, jobs, closing resources and flushing all fit in the same budget.',
            'SIGKILL will happen at some point, in some deploy. The system has to be correct anyway, and graceful shutdown only reduces how often it happens.',
          ],
        },
      ],
    },
    {
      title: 'The three common ways to die wrong',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Almost every broken shutdown falls into one of three patterns, and each leaves a different signature in the metrics. Recognizing the signature saves the investigation.',
        },
        {
          type: 'table',
          columns: ['Pattern', 'Signature', 'Typical cause', 'Fix'],
          rows: [
            [
              'Exits immediately',
              'Burst of 502s and connection resets at the load balancer on every deploy, right at the start of the rollout',
              'No handler, or a handler that calls server.close() and process.exit() right away',
              'Propagation delay before closing, and draining of in-flight requests',
            ],
            [
              'Never handles the signal',
              'Every pod takes exactly 30 s to die; jobs and long requests end up cut by SIGKILL',
              'CMD in shell form or npm start: the signal stays in sh or npm and never reaches node; node as PID 1 without a handler ignores SIGTERM',
              'CMD in exec form calling node directly, an explicit handler, --init or tini to reap zombies',
            ],
            [
              'Closes without waiting for keep-alive',
              'Sporadic 502s even with draining, concentrated on clients using persistent connections',
              'The load balancer reuses a connection the server has just closed; Node keepAliveTimeout lower than the load balancer idle timeout',
              'Connection: close during draining, closeIdleConnections() and a keepAliveTimeout higher than the load balancer idle timeout',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The second pattern is deceptive because the code looks right. With CMD npm start, npm is the one receiving SIGTERM, and with CMD in shell form it is /bin/sh, which does not forward the signal to its child. Worse: if node is PID 1 and registers no handler, the kernel simply ignores SIGTERM, because PID 1 does not get the default action for signals. In every case, the process keeps serving until SIGKILL, 30 seconds later. Deploys get slow and, in the end, cut work anyway.',
        },
      ],
    },
    {
      title: 'The sequence that drains HTTP without cutting requests',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Order matters more than any detail. First, the process announces that it no longer wants traffic: readiness starts returning 503 while liveness keeps returning 200, because the process is alive and only leaving. In Kubernetes a terminating pod already leaves the endpoints regardless of readiness, but load balancers with their own health checks, such as an ALB targeting IPs, an nginx upstream or Consul, depend on it. Second, the process keeps serving normally for a few seconds, the propagation delay, so the removal reaches everyone. Only then does it close the server, drop idle keep-alive connections, wait for in-flight requests with a deadline and, if the deadline expires, cut whatever is left and report how many were cut.',
        },
        { type: 'code', value: servidorCode },
        {
          type: 'list',
          items: [
            'server.close() only stops accepting new connections. Keep-alive connections that are already open can still bring requests; hence closeIdleConnections() right after and Connection: close on every response during draining.',
            'The counter uses the response close event, which fires both when the response finishes and when the client gives up. Using finish would leave the counter stuck on requests aborted by the client.',
            'The number of cut requests is the metric that proves draining works. Log it at the end; a non-zero value on a normal deploy means the deadline is too short or a request that should not be synchronous.',
            'The delay can live in the process, as in the code, or in a preStop with sleep, which recent Kubernetes versions support natively. Pick one: adding both only burns budget.',
          ],
        },
      ],
    },
    {
      title: 'Stopping the worker without losing the job',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A background job has a problem an HTTP request does not: it can last longer than the whole deadline. Reconciling 1,200 invoices took four minutes and would never fit in 30 seconds. The worker needs three behaviors. When asked to stop, it stops reserving new jobs. If the current job finishes within the deadline, great. If it does not, it stops at a safe point, a checkpoint between steps, and returns the job to the queue so another instance can continue.',
        },
        { type: 'code', value: workerCode },
        {
          type: 'paragraph',
          value:
            'The checkpoint only works if the job cooperates and if each step is idempotent: interrupting after invoice 400 and reprocessing the batch on another instance must not reconcile invoice 399 twice. Breaking the batch into small units solves both, because each unit finishes quickly and each one can be redone without side effects. The bug in the incident was not just SIGKILL. It was the processing status written to the database with no owner and no expiration. A lease with a deadline, where a reserved job becomes available again if the worker does not renew the reservation, makes SIGKILL harmless: the job reappears on its own a few minutes later. BullMQ, SQS and RabbitMQ offer this as stalled jobs, visibility timeout and unacknowledged messages, respectively.',
        },
      ],
    },
    {
      title: 'Fitting everything into the time budget',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The whole process has one deadline, and each step needs a slice of it. The classic mistake is setting the drain to 30 seconds with terminationGracePeriodSeconds also at 30: SIGKILL arrives before the log flush that would say what went wrong. The rule is that the process always exits on its own, with an exit code and a log line, before the orchestrator has to kill it.',
        },
        {
          type: 'table',
          columns: ['Step', 'Slice', 'Note'],
          rows: [
            ['Propagation delay', '0 to 5 s', 'Readiness at 503, still serving. If you use preStop, it consumes this slice'],
            ['HTTP draining', 'up to 15 s', 'In-flight requests finish; anything beyond that is cut and counted'],
            ['Worker', 'up to 15 s, in parallel', 'Starts at SIGTERM and takes advantage of the propagation delay'],
            ['Close broker and pool', '1 to 2 s', 'After draining: requests and jobs still use the database'],
            ['Safety deadline', '25 s', 'process.exit(1) with a log line if any step hangs'],
            ['Margin until SIGKILL', '5 s', 'Log and metrics flush, kubelet scheduling delay'],
          ],
        },
        { type: 'code', value: mainCode },
        {
          type: 'paragraph',
          value:
            'The pool closes last because draining requests and jobs still run queries; closing it earlier turns a request that would end with 200 into a 500. The guard against a second signal prevents a repeated Ctrl+C or a duplicated SIGTERM from restarting the drain. And the image side has to deliver the signal to the right process, with probes that tell readiness apart from liveness.',
        },
        { type: 'code', value: deployCode },
      ],
    },
    {
      title: 'Testing the path that only runs in production',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The shutdown handler runs a few times a day, always in production and always with nobody watching. That is why it breaks silently: a refactor changes the order of pool.end(), a new dependency holds a timer, a Dockerfile change goes back to npm start. Three layers of tests close that gap.',
        },
        {
          type: 'ordered',
          items: [
            'Unit test for draining: start the server on an ephemeral port, fire a slow request, call drenar() in the middle of it and check that it ends with 200 and that cortadas is zero. Repeat for the expired deadline, the idle keep-alive connection and the worker that returns the job.',
            'Real signal test in a container: run the image, fire requests, send SIGTERM to the process and check that all of them finish and that the exit code is 0. It is the only test that catches npm start and PID 1, and it runs in seconds in CI.',
            'Deploy under load in staging: keep a constant load generator running during a full rollout and count the responses that are not 2xx. The goal is zero. Run it before changing the base image, the load balancer or the probe configuration.',
          ],
        },
        { type: 'code', value: testCode },
        {
          type: 'paragraph',
          value:
            'In production, two metrics keep shutdown honest: the count of 502 and 503 at the load balancer grouped by deploy window, and the count of cut requests and jobs logged at the end of each process. If deploy 502s show up again, the question is no longer whether it is noise but which of the three signatures they carry.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'If Kubernetes already removes the pod from the endpoints, why should readiness return 503?',
      answer:
        'Because not all traffic goes through Kubernetes endpoints. An ALB targeting pod IPs directly, an nginx with a static upstream or service discovery such as Consul decide based on their own health checks. Readiness at 503 warns those load balancers and makes the process state visible. What guarantees that requests stop, in both cases, is the propagation delay before closing the server.',
    },
    {
      question: 'What value should terminationGracePeriodSeconds have?',
      answer:
        'Enough for the longest acceptable synchronous request to finish, plus the propagation delay and resource closing, with margin. For typical APIs, 30 seconds is plenty. Raising it to minutes to fit a long job is a mistake: deploys and scale down become slow and the job is still vulnerable to SIGKILL from a node failure. Long jobs are solved with checkpoints, returning to the queue and leases, not with a longer deadline.',
    },
    {
      question: 'Should a long request, such as a report export, hold back the shutdown?',
      answer:
        'No. If a request can exceed the drain deadline, it should not be synchronous: the right approach is to return 202, process it in the background and deliver the result by link or notification. The cut requests metric points exactly at those routes. As long as they exist, shutdown can only choose between cutting the client and slowing down every deploy.',
    },
  ],
  conclusion: {
    title: 'Shutdown is production code and deserves production testing',
    description:
      'Every process dies many times a day, on every deploy, scale down and node replacement. SIGTERM warns that traffic is about to stop, not that it has stopped, and the deadline until SIGKILL covers the whole shutdown. Readiness at 503, a propagation delay, deadline-bound draining that reports what it cut, a worker that stops at a checkpoint and returns the job, resources closed last and a safety deadline below the orchestrator deadline turn deploy noise into zero cut requests. Idempotent jobs with leases ensure that the SIGKILL that will still happen leaves nothing stuck. And three layers of tests, unit, real signal in a container and deploy under load, make this path something you verify before production, not after a support ticket.',
    cta: 'Review the deploys of my system',
  },
  related: [
    {
      label: 'Scheduled job that runs twice: distributed mutual exclusion without an eternal lock',
      to: '/blog/job-agendado-que-roda-duas-vezes-exclusao-mutua-distribuida-sem-trava-eterna',
    },
    {
      label: 'Sticky sessions at the load balancer: the hidden cost of pinning a user to one instance',
      to: '/blog/sessao-pegajosa-balanceador-custo-de-amarrar-usuario-a-uma-instancia',
    },
    {
      label: 'Observability and reliability',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
  repo: { name: 'graceful-shutdown-node-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Una plataforma de cobros hacía seis despliegues al día, y cada uno generaba entre 30 y 80 respuestas 502 en el balanceador. El equipo tenía un nombre para eso: ruido de despliegue. El cliente que recibía el 502 en medio de un pago lo intentaba de nuevo y casi siempre funcionaba, así que nadie lo priorizó. Hasta la tarde en que un despliegue atrapó el job de conciliación a mitad de camino: había reservado un lote de 1.200 boletas, las había marcado todas como en procesamiento y había conciliado 400 cuando el proceso recibió SIGKILL. Las otras 800 quedaron atascadas en procesando, y ningún otro worker las tomaba porque el estado decía que alguien ya se estaba ocupando. El descubrimiento llegó dos días después, por soporte. El código tenía un handler de SIGTERM. Nadie había comprobado nunca si se ejecutaba. Este artículo muestra lo que realmente ocurre entre el SIGTERM y el SIGKILL, las tres formas comunes de morir mal, la secuencia que drena HTTP sin cortar peticiones, cómo detener un worker sin perder el job, cómo encajar todo en el presupuesto de tiempo del orquestador y cómo probarlo para que el apagado deje de ser el camino de código que solo se ejecuta en producción.',
  sections: [
    {
      title: 'Lo que ocurre entre el SIGTERM y el SIGKILL',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando un pod entra en Terminating, Kubernetes dispara dos cosas al mismo tiempo. El kubelet ejecuta el preStop, si existe, y envía SIGTERM al proceso principal del contenedor. En paralelo, el plano de control saca el pod de los EndpointSlices, y cada componente que reenvía tráfico, kube-proxy, ingress, service mesh, un ALB fuera del clúster, aplica esa eliminación a su propio ritmo. Las dos vías no se esperan entre sí. Es habitual que el SIGTERM llegue antes de que el último balanceador deje de enviar peticiones, y un proceso que cierra el servidor en el instante de la señal rechaza conexiones que todavía se le están enrutando.',
        },
        { type: 'diagram', value: diagram },
        {
          type: 'paragraph',
          value:
            'El segundo hecho es el plazo. terminationGracePeriodSeconds, 30 segundos por defecto, cuenta desde el inicio de la terminación e incluye el tiempo del preStop. Cuando vence, el proceso recibe SIGKILL, que no se puede tratar: no se ejecuta finally, no se ejecuta el handler, no se hace flush del log. Todo lo que estaba a medias se queda a medias. ECS, Nomad, systemd y docker stop siguen el mismo contrato con otros nombres: una señal educada, un plazo y una señal que no negocia.',
        },
        {
          type: 'list',
          items: [
            'El SIGTERM es un aviso de que el tráfico va a parar, no una confirmación de que ya paró.',
            'El plazo es del apagado entero: retraso de propagación, drenaje, jobs, cierre de recursos y flush caben en el mismo presupuesto.',
            'El SIGKILL va a ocurrir en algún momento, en algún despliegue. El sistema tiene que ser correcto aun así, y el apagado ordenado solo reduce la frecuencia.',
          ],
        },
      ],
    },
    {
      title: 'Las tres formas comunes de morir mal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Casi todo apagado roto cae en uno de tres patrones, y cada uno deja una firma distinta en las métricas. Reconocer la firma ahorra la investigación.',
        },
        {
          type: 'table',
          columns: ['Patrón', 'Firma', 'Causa típica', 'Corrección'],
          rows: [
            [
              'Sale de inmediato',
              'Ráfaga de 502 y connection reset en el balanceador en cada despliegue, justo al inicio del rollout',
              'Ningún handler, o un handler que llama a server.close() y process.exit() de inmediato',
              'Retraso de propagación antes de cerrar, y drenaje de las peticiones en curso',
            ],
            [
              'Nunca trata la señal',
              'Todo pod tarda exactamente 30 s en morir; jobs y peticiones largas terminan cortados por SIGKILL',
              'CMD en forma shell o npm start: la señal se queda en sh o en npm y no llega a node; node como PID 1 sin handler ignora SIGTERM',
              'CMD en forma exec con node directo, handler explícito, --init o tini para recoger zombis',
            ],
            [
              'Cierra sin esperar el keep-alive',
              '502 esporádicos incluso con drenaje, concentrados en quien usa conexiones persistentes',
              'El balanceador reutiliza una conexión que el servidor acaba de cerrar; keepAliveTimeout de Node menor que el idle timeout del balanceador',
              'Connection: close durante el drenaje, closeIdleConnections() y keepAliveTimeout mayor que el idle timeout del balanceador',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El segundo patrón engaña porque el código parece correcto. Con CMD npm start, quien recibe el SIGTERM es npm, y con CMD en forma shell es /bin/sh, que no reenvía la señal al hijo. Peor: si node es el PID 1 y no registra handler, el kernel simplemente ignora el SIGTERM, porque el PID 1 no recibe la acción por defecto de las señales. En todos los casos, el proceso sigue atendiendo hasta el SIGKILL, 30 segundos después. Los despliegues se vuelven lentos y, al final, cortan igual.',
        },
      ],
    },
    {
      title: 'La secuencia que drena HTTP sin cortar peticiones',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El orden importa más que cualquier detalle. Primero, el proceso avisa que ya no quiere tráfico: la readiness pasa a responder 503 mientras la liveness sigue en 200, porque el proceso está vivo y solo se está yendo. En Kubernetes el pod en terminación ya sale de los endpoints sin depender de la readiness, pero los balanceadores con health check propio, como un ALB apuntando a IPs, un upstream de nginx o Consul, dependen de ella. Segundo, el proceso sigue atendiendo con normalidad durante algunos segundos, el retraso de propagación, para que la eliminación llegue a todos. Solo entonces cierra el servidor, corta las conexiones keep-alive ociosas, espera las peticiones en curso con un plazo y, si el plazo vence, corta lo que queda e informa cuántas se cortaron.',
        },
        { type: 'code', value: servidorCode },
        {
          type: 'list',
          items: [
            'server.close() solo deja de aceptar conexiones nuevas. Las conexiones keep-alive ya abiertas todavía pueden traer peticiones; por eso closeIdleConnections() justo después y Connection: close en cada respuesta durante el drenaje.',
            'El contador usa el evento close de la respuesta, que se dispara tanto cuando la respuesta termina como cuando el cliente desiste. Usar finish dejaría el contador atascado en peticiones abortadas por el cliente.',
            'El número de peticiones cortadas es la métrica que demuestra que el drenaje funciona. Regístrelo en el log final; un valor distinto de cero en un despliegue normal significa un plazo corto o una petición que no debería ser síncrona.',
            'El retraso puede vivir en el proceso, como en el código, o en un preStop con sleep, que las versiones recientes de Kubernetes admiten de forma nativa. Elija uno de los dos: sumar ambos solo gasta presupuesto.',
          ],
        },
      ],
    },
    {
      title: 'Detener el worker sin perder el job',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un job en segundo plano tiene un problema que una petición HTTP no tiene: puede durar más que el plazo entero. La conciliación de 1.200 boletas tardaba cuatro minutos y nunca cabría en 30 segundos. El worker necesita tres comportamientos. Al recibir la orden de parar, deja de reservar jobs nuevos. Si el job actual termina dentro del plazo, perfecto. Si no termina, se detiene en un punto seguro, un checkpoint entre etapas, y devuelve el job a la cola para que otra instancia continúe.',
        },
        { type: 'code', value: workerCode },
        {
          type: 'paragraph',
          value:
            'El checkpoint solo funciona si el job coopera y si cada etapa es idempotente: interrumpir después de la boleta 400 y reprocesar el lote en otra instancia no puede conciliar la boleta 399 dos veces. Dividir el lote en unidades pequeñas resuelve ambas cosas, porque cada unidad termina rápido y cada una se rehace sin efectos secundarios. El bug del incidente no era solo el SIGKILL. Era el estado procesando guardado en la base de datos sin dueño y sin expiración. Un lease con plazo, en el que el job reservado vuelve a estar disponible si el worker no renueva la reserva, vuelve inofensivo al SIGKILL: el job reaparece solo unos minutos después. BullMQ, SQS y RabbitMQ lo ofrecen como stalled jobs, visibility timeout y mensajes sin ack, respectivamente.',
        },
      ],
    },
    {
      title: 'Encajar todo en el presupuesto de tiempo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El proceso entero tiene un plazo, y cada etapa necesita una porción de él. El error clásico es configurar el drenaje en 30 segundos con terminationGracePeriodSeconds también en 30: el SIGKILL llega antes del flush del log que diría qué salió mal. La regla es que el proceso siempre salga solo, con código de salida y log, antes de que el orquestador tenga que matarlo.',
        },
        {
          type: 'table',
          columns: ['Etapa', 'Porción', 'Observación'],
          rows: [
            ['Retraso de propagación', '0 a 5 s', 'Readiness en 503, todavía atendiendo. Si usa preStop, consume esta porción'],
            ['Drenaje HTTP', 'hasta 15 s', 'Las peticiones en curso terminan; lo que pase de eso se corta y se cuenta'],
            ['Worker', 'hasta 15 s, en paralelo', 'Empieza con el SIGTERM y aprovecha el retraso de propagación'],
            ['Cerrar broker y pool', '1 a 2 s', 'Después del drenaje: peticiones y jobs todavía usan la base de datos'],
            ['Freno de seguridad', '25 s', 'process.exit(1) con log si cualquier etapa se cuelga'],
            ['Margen hasta el SIGKILL', '5 s', 'Flush de log y métricas, retraso de planificación del kubelet'],
          ],
        },
        { type: 'code', value: mainCode },
        {
          type: 'paragraph',
          value:
            'El pool se cierra al final porque las peticiones y los jobs que drenan todavía hacen consultas; cerrarlo antes convierte una petición que terminaría con 200 en un 500. La guarda contra la segunda señal evita que un Ctrl+C repetido o un SIGTERM duplicado reinicie el drenaje. Y la imagen tiene que entregar la señal al proceso correcto, con probes que distingan readiness de liveness.',
        },
        { type: 'code', value: deployCode },
      ],
    },
    {
      title: 'Probar el camino que solo se ejecuta en producción',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El handler de apagado se ejecuta algunas veces al día, siempre en producción y siempre sin que nadie mire. Por eso se rompe en silencio: un refactor cambia el orden del pool.end(), una dependencia nueva retiene un timer, un cambio en el Dockerfile vuelve a npm start. Tres capas de pruebas cierran ese hueco.',
        },
        {
          type: 'ordered',
          items: [
            'Prueba unitaria del drenaje: levante el servidor en un puerto efímero, lance una petición lenta, llame a drenar() a mitad de ella y compruebe que termina con 200 y que cortadas es cero. Repita para el plazo vencido, la conexión keep-alive ociosa y el worker que devuelve el job.',
            'Prueba de señal real en contenedor: ejecute la imagen, lance peticiones, envíe SIGTERM al proceso y compruebe que todas terminan y que el código de salida es 0. Es la única prueba que detecta el npm start y el PID 1, y se ejecuta en segundos en el CI.',
            'Despliegue bajo carga en staging: mantenga un generador de carga constante durante un rollout completo y cuente las respuestas que no son 2xx. La meta es cero. Ejecútelo antes de cambiar la imagen base, el balanceador o la configuración de probes.',
          ],
        },
        { type: 'code', value: testCode },
        {
          type: 'paragraph',
          value:
            'En producción, dos métricas mantienen honesto el apagado: el recuento de 502 y 503 en el balanceador agrupado por ventana de despliegue, y el recuento de peticiones y jobs cortados registrado en el log final de cada proceso. Si los 502 de despliegue vuelven a aparecer, la pregunta deja de ser si es ruido y pasa a ser cuál de las tres firmas tienen.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Si Kubernetes ya saca el pod de los endpoints, ¿por qué la readiness tiene que responder 503?',
      answer:
        'Porque no todo el tráfico pasa por los endpoints de Kubernetes. Un ALB apuntando directamente a IPs de pods, un nginx con upstream estático o un service discovery como Consul deciden por su propio health check. La readiness en 503 avisa a esos balanceadores y hace visible el estado del proceso. Lo que garantiza que las peticiones dejen de llegar, en ambos casos, es el retraso de propagación antes de cerrar el servidor.',
    },
    {
      question: '¿Qué valor usar en terminationGracePeriodSeconds?',
      answer:
        'El suficiente para que termine la petición síncrona más larga aceptable, sumado al retraso de propagación y al cierre de recursos, con margen. Para APIs comunes, 30 segundos sobran. Subirlo a minutos para que quepa un job largo es un error: los despliegues y el scale down se vuelven lentos y el job sigue expuesto al SIGKILL por fallo del nodo. Un job largo se resuelve con checkpoint, devolución a la cola y lease, no con un plazo mayor.',
    },
    {
      question: '¿Una petición larga, como la exportación de un informe, debe retener el apagado?',
      answer:
        'No. Si una petición puede superar el plazo de drenaje, no debería ser síncrona: lo correcto es responder 202, procesarla en segundo plano y entregar el resultado por enlace o notificación. La métrica de peticiones cortadas señala exactamente esas rutas. Mientras existan, el apagado solo puede elegir entre cortar al cliente o retrasar todos los despliegues.',
    },
  ],
  conclusion: {
    title: 'El apagado es código de producción y merece pruebas de producción',
    description:
      'Todo proceso muere muchas veces al día, en cada despliegue, scale down y cambio de nodo. El SIGTERM avisa que el tráfico va a parar, no que paró, y el plazo hasta el SIGKILL es del apagado entero. Readiness en 503, retraso de propagación, drenaje con plazo que informa lo que cortó, un worker que se detiene en el checkpoint y devuelve el job, recursos cerrados al final y un freno por debajo del plazo del orquestador convierten el ruido de despliegue en cero peticiones cortadas. Jobs idempotentes con lease garantizan que el SIGKILL que todavía va a ocurrir no deje nada atascado. Y tres capas de pruebas, unitaria, señal real en contenedor y despliegue bajo carga, hacen de este camino algo que se verifica antes de producción, no después del ticket de soporte.',
    cta: 'Revisar los despliegues de mi sistema',
  },
  related: [
    {
      label: 'Job programado que se ejecuta dos veces: exclusión mutua distribuida sin un bloqueo eterno',
      to: '/blog/job-agendado-que-roda-duas-vezes-exclusao-mutua-distribuida-sem-trava-eterna',
    },
    {
      label: 'Sesión pegajosa en el balanceador: el costo oculto de atar al usuario a una instancia',
      to: '/blog/sessao-pegajosa-balanceador-custo-de-amarrar-usuario-a-uma-instancia',
    },
    {
      label: 'Observabilidad y confiabilidad',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
  repo: { name: 'graceful-shutdown-node-mini', description: repo.es, url: repoUrl },
};

export default {
  pt,
  en,
  es,
};
