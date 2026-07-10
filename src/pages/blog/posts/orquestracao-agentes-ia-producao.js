// Conteudo do artigo: orquestracao de agentes de IA em producao.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Orquestrador mínimo de agentes de IA em produção: um supervisor que roteia a tarefa para agentes especializados, executa tools com timeout e retry, mantém estado durável para retomar de onde parou e emite tracing por passo para custo e latência.',
  en: 'Minimal AI agent orchestrator for production: a supervisor that routes the task to specialized agents, runs tools with timeout and retry, keeps durable state to resume where it stopped and emits per-step tracing for cost and latency.',
  es: 'Orquestador mínimo de agentes de IA en producción: un supervisor que rutea la tarea a agentes especializados, ejecuta tools con timeout y retry, mantiene estado durable para retomar donde se detuvo y emite tracing por paso para costo y latencia.',
};

const repoUrl = 'https://github.com/joaosouz4dev/agent-orchestrator-mini';

const pt = {
  intro:
    'Um agente de IA sozinho é um protótipo. Ele funciona na demo, resolve o caso feliz e trava na primeira tool que dá timeout, no primeiro loop infinito de raciocínio ou no primeiro deploy que perde o estado no meio de uma tarefa longa. Produção exige outra coisa: um orquestrador que coordena vários agentes especializados, decide quem faz o que, executa ferramentas com falha controlada, guarda estado para retomar e mede cada passo. Este artigo mostra como sair do agente único monolítico para uma orquestração confiável: os padrões de coordenação (supervisor, sequencial, paralelo), como modelar estado durável, como blindar a chamada de tool, como cortar loop e custo com limites, e o que observar para não operar no escuro. O foco é engenharia de produção, não a demo de sexta à tarde.',
  sections: [
    {
      title: 'Por que um agente único não aguenta produção',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O agente único com um prompt gigante e todas as tools no mesmo contexto é a arquitetura que mais rápido chega na demo e mais rápido quebra em produção. O contexto incha, o modelo confunde qual tool usar, o custo por chamada explode porque tudo entra no prompt, e uma tarefa que precisa de dez passos vira uma sequência de decisões onde qualquer erro no meio contamina o resto. Não existe onde intervir: é uma caixa preta que ou acerta tudo ou erra tudo.',
        },
        {
          type: 'paragraph',
          value:
            'Orquestrar é quebrar essa caixa preta em partes com responsabilidade única. Um agente que só classifica intenção. Um que só consulta a base. Um que só redige a resposta. Um supervisor que decide a ordem. Cada parte tem contexto menor, prompt focado, tools limitadas e ponto de observação próprio. Quando algo falha, você sabe qual agente falhou e por que, em vez de reprocessar a conversa inteira tentando adivinhar. É a mesma lógica de quebrar um monolito em serviços, aplicada ao raciocínio.',
        },
      ],
    },
    {
      title: 'Os três padrões de coordenação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Não existe um jeito único de orquestrar. Há três padrões base, e a maioria dos sistemas reais combina os três. Escolher o padrão certo por etapa é o que separa uma orquestração enxuta de uma que gasta o dobro de tokens sem ganho.',
        },
        {
          type: 'table',
          columns: ['Padrão', 'Como funciona', 'Quando usar', 'Custo e risco'],
          rows: [
            [
              'Sequencial (pipeline)',
              'Saída de um agente vira entrada do próximo, em ordem fixa',
              'Etapas com dependência clara: classificar -> buscar -> redigir',
              'Baixo custo, latência soma; um passo lento trava a cadeia',
            ],
            [
              'Supervisor (roteador)',
              'Um agente central decide para qual especialista mandar cada tarefa',
              'Muitas intenções distintas, cada uma com um agente próprio',
              'Custo do passo de roteamento; erro do supervisor propaga',
            ],
            [
              'Paralelo (fan-out)',
              'Vários agentes rodam ao mesmo tempo e um passo agrega',
              'Sub-tarefas independentes: consultar 3 fontes de uma vez',
              'Latência = a mais lenta, mas custo soma todas em paralelo',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Na prática você aninha os padrões. O supervisor roteia para um pipeline; dentro do pipeline, um passo faz fan-out para três consultas paralelas e agrega. A regra é usar paralelo só quando as sub-tarefas são de fato independentes (senão você paga o custo sem ganhar latência) e usar supervisor só quando há divergência real de intenção (senão um pipeline fixo é mais barato e mais previsível).',
        },
      ],
    },
    {
      title: 'Estado durável: retomar de onde parou',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro mais caro em agentes de produção é tratar o estado como algo que vive na memória do processo. Uma tarefa de agente pode levar segundos ou minutos, chamar várias tools e sobreviver a um deploy no meio. Se o estado está só na RAM, qualquer restart perde o progresso, e você ou reprocessa tudo (caro, e as tools com efeito colateral rodam duas vezes) ou perde a tarefa. Estado durável significa persistir cada passo concluído, de forma que o orquestrador consiga retomar exatamente de onde parou.',
        },
        {
          type: 'code',
          value: `// orchestrator/state.js
// Estado da execucao persistido por passo. A chave e o runId;
// cada passo concluido e gravado antes de avancar, para retomar apos falha.

export function createRun(store, runId, input) {
  return store.put(runId, {
    runId,
    input,
    status: 'running',
    step: 0,
    // Historico append-only: cada entrada e um passo ja concluido.
    history: [],
    createdAt: null, // preenchido pela store, evita depender de relogio aqui
  });
}

// Grava o resultado de um passo ANTES de chamar o proximo agente.
// Assim, se o processo morrer no passo N+1, o passo N nao se perde.
export async function commitStep(store, runId, stepResult) {
  const run = await store.get(runId);
  run.history.push(stepResult);
  run.step += 1;
  await store.put(runId, run);
  return run;
}

// Ao reiniciar, retoma do ponto salvo em vez de recomecar do zero.
export async function resume(store, runId, agents) {
  const run = await store.get(runId);
  if (run.status !== 'running') return run;
  // O proximo agente e decidido pelo passo atual, nao pela memoria perdida.
  const next = agents[run.step];
  if (!next) return finish(store, run);
  return next.run(run);
}`,
        },
        {
          type: 'paragraph',
          value:
            'A consequência prática: tools com efeito colateral (enviar mensagem, cobrar, criar pedido) precisam ser idempotentes ou registradas como concluídas no estado, para que a retomada não dispare a mesma ação de novo. Persistir o passo antes de avançar, e não depois, é o detalhe que garante que a retomada nunca pule nem repita um passo crítico.',
        },
      ],
    },
    {
      title: 'Blindando a chamada de tool',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A tool é onde o agente toca o mundo real, e por isso é onde mais falha. API externa cai, responde lento, devolve payload fora do contrato ou retorna erro transitório. Um agente de produção nunca chama uma tool crua: ele envolve toda chamada em timeout, retry com backoff, validação de saída e um caminho de degradação para quando a tool falha de vez. Sem isso, uma única API instável derruba a execução inteira.',
        },
        {
          type: 'code',
          value: `// orchestrator/tool-runner.js
// Executa uma tool com timeout, retry com backoff e validacao de saida.
// Isola a falha da tool para que o orquestrador decida o que fazer.

export async function runTool(tool, args, opts = {}) {
  const { retries = 2, timeoutMs = 8000, backoffMs = 500 } = opts;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await withTimeout(tool.execute(args), timeoutMs);
      // Valida o contrato ANTES de devolver ao agente.
      if (!tool.validate(result)) {
        throw new Error('tool_output_invalid');
      }
      return { ok: true, result, attempts: attempt + 1 };
    } catch (err) {
      const transient = isTransient(err);
      // So faz retry em erro transitorio; erro de contrato nao adianta repetir.
      if (!transient || attempt === retries) {
        return { ok: false, error: err.message, attempts: attempt + 1 };
      }
      // Backoff exponencial simples entre tentativas.
      await sleep(backoffMs * 2 ** attempt);
    }
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('tool_timeout')), ms),
    ),
  ]);
}`,
        },
        {
          type: 'paragraph',
          value:
            'O ponto sutil: retry só faz sentido em erro transitório (timeout, 503, conexão caiu). Erro de contrato ou 4xx não melhora repetindo, só queima tempo e tokens. E quando a tool falha de vez, o orquestrador precisa de um plano B explícito: responder com o que tem, escalar para humano, ou marcar a tarefa como parcial. O agente nunca deve inventar o resultado de uma tool que falhou, porque aí a falha vira alucinação silenciosa, que é pior que o erro visível.',
        },
      ],
    },
    {
      title: 'Cortando loop, custo e divagação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Agente sem limite é um gerador de custo. Ele pode entrar em loop chamando a mesma tool, raciocinar em círculos, ou expandir o contexto até estourar o limite do modelo. Produção exige guardrails duros que cortam a execução antes de virar prejuízo. Esses limites não são opcionais nem "para depois": são o que impede uma única tarefa de consumir o orçamento de mil.',
        },
        {
          type: 'list',
          items: [
            'Limite de passos: um teto de iterações por execução (por exemplo, 12). Ao atingir, o orquestrador para e devolve o melhor resultado parcial em vez de rodar para sempre.',
            'Orçamento de tokens por tarefa: some os tokens de todos os passos e aborte se passar do limite. Uma tarefa que já gastou o esperado provavelmente está em loop.',
            'Detecção de repetição: se o agente chama a mesma tool com os mesmos argumentos duas vezes seguidas, é sinal de loop; interrompa e mude de estratégia.',
            'Timeout de ponta a ponta: além do timeout por tool, um teto de tempo total da tarefa, para nada ficar pendurado indefinidamente segurando recurso.',
            'Confiança mínima para agir: em ação com efeito colateral, exija que o agente esteja acima de um limiar de certeza; abaixo dele, escale para humano em vez de arriscar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A filosofia é simples: prefira falhar de forma visível e barata a ter sucesso caro e imprevisível. Um limite atingido é um evento observável que você investiga e ajusta; um loop sem limite é uma fatura no fim do mês que ninguém entende. Cada guardrail que dispara deve virar log e métrica, para você saber quais tarefas batem no teto e por que.',
        },
      ],
    },
    {
      title: 'Observabilidade: não operar no escuro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Orquestração sem tracing é impossível de depurar. Quando uma tarefa dá errado, você precisa ver a árvore inteira: qual agente rodou, qual tool chamou, o que cada passo custou em tokens e latência, onde parou. Sem isso, todo bug vira arqueologia. O modelo mental certo é o de tracing distribuído: cada execução é um trace, cada passo de agente ou tool é um span aninhado, com atributos de custo e resultado.',
        },
        {
          type: 'diagram',
          value: `Trace de uma execução orquestrada

  Run abc123  (tarefa: "trocar meu pedido")
    |
    +-- span: supervisor            12 tok-in / 40 tok-out   90ms
    |     roteou -> agente "pedidos"
    |
    +-- span: agente pedidos        320 tok-in / 85 tok-out  240ms
    |     |
    |     +-- span: tool getOrder   ok    retry=0            310ms
    |     +-- span: tool checkStock ok    retry=1            720ms  <- lenta
    |
    +-- span: agente redator        410 tok-in / 190 tok-out 300ms
    |
    v
  status: ok    total: 632 tok-out   custo: US$ 0,004   1,66s`,
        },
        {
          type: 'ordered',
          items: [
            'Gere um runId por execução e propague em todos os passos, para amarrar o trace inteiro a uma tarefa.',
            'Emita um span por agente e por tool, com tokens de entrada e saída, latência, número de retries e status.',
            'Registre a decisão do supervisor: para qual agente roteou e por que, senão o roteamento vira caixa preta.',
            'Agregue custo e latência por execução e por tipo de tarefa, para achar qual jornada está cara ou lenta.',
            'Alerte em sinais que importam: taxa de tarefas que batem o limite de passos, retries de tool acima do normal, custo por tarefa subindo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Com o trace, um problema que seria horas de adivinhação vira minutos: você abre a tarefa que falhou, vê que a tool checkStock deu retry e estourou o timeout, e sabe exatamente onde agir. Sem o trace, você só tem "o bot respondeu errado" e nenhum caminho até a causa. Observabilidade não é enfeite; é o que torna a orquestração operável.',
        },
      ],
    },
    {
      title: 'Do protótipo à produção sem reescrever tudo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A boa notícia é que você não precisa de um framework pesado para chegar lá. Um orquestrador de produção cabe em poucas peças bem definidas, e a maioria dos frameworks só embrulha esses mesmos conceitos. O caminho prático é evoluir o protótipo por camadas, adicionando confiabilidade sem jogar fora o que já funciona.',
        },
        {
          type: 'list',
          items: [
            'Comece separando o agente único em papéis: extraia o roteamento e um ou dois especialistas antes de otimizar qualquer coisa.',
            'Adicione estado durável cedo: é o que mais dificulta refatorar depois, porque muda a forma como cada passo é chamado.',
            'Envolva toda tool no runner com timeout e retry desde o primeiro dia; é barato de adicionar e caro de esquecer.',
            'Ponha os guardrails de passo, custo e timeout antes de abrir para tráfego real, nunca depois do primeiro susto de fatura.',
            'Instrumente o tracing junto com a primeira versão orquestrada; retro-encaixar observabilidade é sempre mais trabalhoso que nascer com ela.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A diferença entre o agente de demo e o de produção não está na inteligência do modelo, está na engenharia ao redor dele: coordenação clara, estado que sobrevive à falha, tools blindadas, limites que cortam o desperdício e tracing que te deixa enxergar. Quem trata isso como detalhe descobre o custo em produção, no pior momento possível.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Preciso de um framework de agentes para orquestrar?',
      answer:
        'Não para começar. Os conceitos que importam (supervisor, estado durável, runner de tool com retry, guardrails e tracing) cabem em poucas centenas de linhas e são os mesmos que os frameworks embrulham. Um framework ajuda quando o time cresce e você quer padronizar, mas adotar um cedo demais esconde o funcionamento e dificulta depurar. Entenda as peças primeiro; escolha o framework depois, sabendo o que ele resolve.',
    },
    {
      question: 'Quando uso vários agentes em vez de um só?',
      answer:
        'Quando o contexto ou as tools de um único agente começam a competir. Se um prompt precisa cobrir intenções muito distintas, ou se a lista de tools ficou grande a ponto de o modelo confundir qual usar, separar em agentes com contexto menor e escopo focado melhora precisão e reduz custo. Não separe por separar: um pipeline fixo de dois passos costuma ser mais barato e previsível que um enxame de agentes quando a tarefa é linear.',
    },
    {
      question: 'Como controlo o custo de uma orquestração com vários agentes?',
      answer:
        'Com limites duros e tracing por passo. Ponha teto de iterações, orçamento de tokens por tarefa, detecção de repetição e timeout de ponta a ponta, para nenhuma tarefa rodar sem freio. Em paralelo, emita um span por agente e por tool com tokens e latência, agregue custo por tipo de tarefa e alerte quando ele sobe. O custo foge quando ninguém olha; com limite e trace ele vira um número que você gerencia.',
    },
  ],
  conclusion: {
    title: 'Orquestração é a engenharia que transforma agente de demo em agente de produção',
    description:
      'Coordenação clara, estado durável, tools blindadas, guardrails de custo e tracing por passo são o que faz um agente de IA aguentar produção. Posso desenhar e montar essa orquestração no seu produto, do roteamento ao tracing, integrada ao seu stack e pronta para escalar.',
    cta: 'Falar sobre orquestrar meus agentes',
  },
  related: [
    { label: 'Avaliação contínua de bots: do eval manual ao automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'RAG para atendimento no WhatsApp em produção', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Chatbots e IA para atendimento', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'agent-orchestrator-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'A single AI agent is a prototype. It works in the demo, solves the happy path and freezes on the first tool that times out, the first infinite reasoning loop or the first deploy that loses state mid-task. Production demands something else: an orchestrator that coordinates several specialized agents, decides who does what, runs tools with controlled failure, persists state to resume and measures every step. This article shows how to move from a single monolithic agent to a reliable orchestration: the coordination patterns (supervisor, sequential, parallel), how to model durable state, how to armor the tool call, how to cut loops and cost with limits, and what to observe so you are not operating blind. The focus is production engineering, not the Friday-afternoon demo.',
  sections: [
    {
      title: 'Why a single agent does not survive production',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A single agent with a giant prompt and every tool in the same context is the architecture that reaches the demo fastest and breaks in production fastest. The context bloats, the model gets confused about which tool to use, the cost per call explodes because everything goes into the prompt, and a task that needs ten steps becomes a chain of decisions where any error midway contaminates the rest. There is nowhere to intervene: it is a black box that either gets everything right or everything wrong.',
        },
        {
          type: 'paragraph',
          value:
            'Orchestrating means breaking that black box into parts with a single responsibility. An agent that only classifies intent. One that only queries the base. One that only drafts the answer. A supervisor that decides the order. Each part has smaller context, a focused prompt, limited tools and its own observation point. When something fails, you know which agent failed and why, instead of reprocessing the whole conversation trying to guess. It is the same logic as breaking a monolith into services, applied to reasoning.',
        },
      ],
    },
    {
      title: 'The three coordination patterns',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There is no single way to orchestrate. There are three base patterns, and most real systems combine all three. Choosing the right pattern per step is what separates a lean orchestration from one that burns twice the tokens with no gain.',
        },
        {
          type: 'table',
          columns: ['Pattern', 'How it works', 'When to use', 'Cost and risk'],
          rows: [
            [
              'Sequential (pipeline)',
              'One agent output becomes the next input, in fixed order',
              'Steps with clear dependency: classify -> retrieve -> draft',
              'Low cost, latency adds up; one slow step blocks the chain',
            ],
            [
              'Supervisor (router)',
              'A central agent decides which specialist gets each task',
              'Many distinct intents, each with its own agent',
              'Cost of the routing step; a supervisor error propagates',
            ],
            [
              'Parallel (fan-out)',
              'Several agents run at once and one step aggregates',
              'Independent sub-tasks: query 3 sources at once',
              'Latency = the slowest, but cost sums all in parallel',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'In practice you nest the patterns. The supervisor routes to a pipeline; inside the pipeline, one step fans out to three parallel queries and aggregates. The rule is to use parallel only when the sub-tasks are truly independent (otherwise you pay the cost without gaining latency) and to use a supervisor only when there is real intent divergence (otherwise a fixed pipeline is cheaper and more predictable).',
        },
      ],
    },
    {
      title: 'Durable state: resuming where it stopped',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most expensive mistake in production agents is treating state as something that lives in process memory. An agent task can take seconds or minutes, call several tools and survive a deploy in the middle. If state is only in RAM, any restart loses the progress, and you either reprocess everything (costly, and tools with side effects run twice) or lose the task. Durable state means persisting each completed step so the orchestrator can resume exactly where it stopped.',
        },
        {
          type: 'code',
          value: `// orchestrator/state.js
// Execution state persisted per step. The key is the runId;
// each completed step is written before advancing, to resume after failure.

export function createRun(store, runId, input) {
  return store.put(runId, {
    runId,
    input,
    status: 'running',
    step: 0,
    // Append-only history: each entry is an already completed step.
    history: [],
    createdAt: null, // filled by the store, avoids depending on a clock here
  });
}

// Writes the result of a step BEFORE calling the next agent.
// So if the process dies on step N+1, step N is not lost.
export async function commitStep(store, runId, stepResult) {
  const run = await store.get(runId);
  run.history.push(stepResult);
  run.step += 1;
  await store.put(runId, run);
  return run;
}

// On restart, resume from the saved point instead of starting over.
export async function resume(store, runId, agents) {
  const run = await store.get(runId);
  if (run.status !== 'running') return run;
  // The next agent is decided by the current step, not by lost memory.
  const next = agents[run.step];
  if (!next) return finish(store, run);
  return next.run(run);
}`,
        },
        {
          type: 'paragraph',
          value:
            'The practical consequence: tools with side effects (send a message, charge, create an order) must be idempotent or recorded as completed in the state, so the resume does not fire the same action again. Persisting the step before advancing, not after, is the detail that guarantees the resume never skips nor repeats a critical step.',
        },
      ],
    },
    {
      title: 'Armoring the tool call',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The tool is where the agent touches the real world, and that is why it fails the most. An external API goes down, responds slowly, returns a payload off contract or returns a transient error. A production agent never calls a raw tool: it wraps every call in timeout, retry with backoff, output validation and a degradation path for when the tool fails for good. Without that, a single unstable API brings the whole execution down.',
        },
        {
          type: 'code',
          value: `// orchestrator/tool-runner.js
// Runs a tool with timeout, retry with backoff and output validation.
// Isolates the tool failure so the orchestrator decides what to do.

export async function runTool(tool, args, opts = {}) {
  const { retries = 2, timeoutMs = 8000, backoffMs = 500 } = opts;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await withTimeout(tool.execute(args), timeoutMs);
      // Validate the contract BEFORE returning to the agent.
      if (!tool.validate(result)) {
        throw new Error('tool_output_invalid');
      }
      return { ok: true, result, attempts: attempt + 1 };
    } catch (err) {
      const transient = isTransient(err);
      // Only retry on transient error; a contract error will not improve.
      if (!transient || attempt === retries) {
        return { ok: false, error: err.message, attempts: attempt + 1 };
      }
      // Simple exponential backoff between attempts.
      await sleep(backoffMs * 2 ** attempt);
    }
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('tool_timeout')), ms),
    ),
  ]);
}`,
        },
        {
          type: 'paragraph',
          value:
            'The subtle point: retry only makes sense on a transient error (timeout, 503, dropped connection). A contract error or 4xx does not improve by repeating, it only burns time and tokens. And when the tool fails for good, the orchestrator needs an explicit plan B: answer with what it has, escalate to a human, or mark the task as partial. The agent must never invent the result of a tool that failed, because then the failure becomes a silent hallucination, which is worse than the visible error.',
        },
      ],
    },
    {
      title: 'Cutting loops, cost and rambling',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An agent without a limit is a cost generator. It can loop calling the same tool, reason in circles, or expand the context until it blows the model limit. Production demands hard guardrails that cut execution before it turns into a loss. These limits are not optional nor "for later": they are what stops a single task from consuming the budget of a thousand.',
        },
        {
          type: 'list',
          items: [
            'Step limit: a cap on iterations per run (for example, 12). On reaching it, the orchestrator stops and returns the best partial result instead of running forever.',
            'Token budget per task: sum the tokens of all steps and abort if it exceeds the limit. A task that already spent what was expected is probably in a loop.',
            'Repetition detection: if the agent calls the same tool with the same arguments twice in a row, it is a loop signal; interrupt and change strategy.',
            'End-to-end timeout: beyond the per-tool timeout, a cap on total task time, so nothing hangs indefinitely holding a resource.',
            'Minimum confidence to act: on an action with side effects, require the agent to be above a certainty threshold; below it, escalate to a human instead of risking it.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The philosophy is simple: prefer to fail visibly and cheaply over succeeding expensively and unpredictably. A limit reached is an observable event you investigate and tune; a loop without a limit is an invoice at the end of the month no one understands. Every guardrail that fires should become a log and a metric, so you know which tasks hit the cap and why.',
        },
      ],
    },
    {
      title: 'Observability: not operating in the dark',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Orchestration without tracing is impossible to debug. When a task goes wrong, you need to see the whole tree: which agent ran, which tool it called, what each step cost in tokens and latency, where it stopped. Without that, every bug becomes archaeology. The right mental model is distributed tracing: each execution is a trace, each agent or tool step is a nested span, with cost and result attributes.',
        },
        {
          type: 'diagram',
          value: `Trace of an orchestrated execution

  Run abc123  (task: "return my order")
    |
    +-- span: supervisor            12 tok-in / 40 tok-out   90ms
    |     routed -> agent "orders"
    |
    +-- span: orders agent          320 tok-in / 85 tok-out  240ms
    |     |
    |     +-- span: tool getOrder   ok    retry=0            310ms
    |     +-- span: tool checkStock ok    retry=1            720ms  <- slow
    |
    +-- span: writer agent          410 tok-in / 190 tok-out 300ms
    |
    v
  status: ok    total: 632 tok-out   cost: US$ 0.004   1.66s`,
        },
        {
          type: 'ordered',
          items: [
            'Generate a runId per execution and propagate it across all steps, to tie the whole trace to one task.',
            'Emit one span per agent and per tool, with input and output tokens, latency, retry count and status.',
            'Record the supervisor decision: which agent it routed to and why, otherwise routing becomes a black box.',
            'Aggregate cost and latency per execution and per task type, to find which journey is expensive or slow.',
            'Alert on signals that matter: rate of tasks hitting the step limit, tool retries above normal, cost per task rising.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'With the trace, a problem that would be hours of guessing becomes minutes: you open the failed task, see that the checkStock tool retried and blew the timeout, and know exactly where to act. Without the trace, you only have "the bot answered wrong" and no path to the cause. Observability is not decoration; it is what makes orchestration operable.',
        },
      ],
    },
    {
      title: 'From prototype to production without rewriting everything',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The good news is that you do not need a heavy framework to get there. A production orchestrator fits in a few well-defined pieces, and most frameworks just wrap these same concepts. The practical path is to evolve the prototype in layers, adding reliability without throwing away what already works.',
        },
        {
          type: 'list',
          items: [
            'Start by splitting the single agent into roles: extract the routing and one or two specialists before optimizing anything.',
            'Add durable state early: it is what makes refactoring later hardest, because it changes how each step is called.',
            'Wrap every tool in the runner with timeout and retry from day one; it is cheap to add and expensive to forget.',
            'Put the step, cost and timeout guardrails in before opening to real traffic, never after the first invoice scare.',
            'Instrument tracing along with the first orchestrated version; retrofitting observability is always more work than being born with it.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The difference between the demo agent and the production one is not in the model intelligence, it is in the engineering around it: clear coordination, state that survives failure, armored tools, limits that cut waste and tracing that lets you see. Whoever treats this as a detail discovers the cost in production, at the worst possible moment.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Do I need an agent framework to orchestrate?',
      answer:
        'Not to start. The concepts that matter (supervisor, durable state, a tool runner with retry, guardrails and tracing) fit in a few hundred lines and are the same ones frameworks wrap. A framework helps when the team grows and you want to standardize, but adopting one too early hides the mechanics and makes debugging harder. Understand the pieces first; pick the framework later, knowing what it solves.',
    },
    {
      question: 'When do I use several agents instead of just one?',
      answer:
        'When the context or the tools of a single agent start to compete. If one prompt has to cover very distinct intents, or if the tool list grew to the point the model confuses which to use, splitting into agents with smaller context and focused scope improves accuracy and reduces cost. Do not split for the sake of it: a fixed two-step pipeline is usually cheaper and more predictable than a swarm of agents when the task is linear.',
    },
    {
      question: 'How do I control the cost of an orchestration with several agents?',
      answer:
        'With hard limits and per-step tracing. Put a cap on iterations, a token budget per task, repetition detection and an end-to-end timeout, so no task runs unbraked. In parallel, emit one span per agent and per tool with tokens and latency, aggregate cost per task type and alert when it rises. Cost runs away when no one watches; with limits and a trace it becomes a number you manage.',
    },
  ],
  conclusion: {
    title: 'Orchestration is the engineering that turns a demo agent into a production agent',
    description:
      'Clear coordination, durable state, armored tools, cost guardrails and per-step tracing are what make an AI agent survive production. I can design and build this orchestration in your product, from routing to tracing, integrated into your stack and ready to scale.',
    cta: 'Talk about orchestrating my agents',
  },
  related: [
    { label: 'Continuous bot evaluation: from manual to automated eval', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'RAG for WhatsApp support in production', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Chatbots and AI for support', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'agent-orchestrator-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Un agente de IA solo es un prototipo. Funciona en la demo, resuelve el camino feliz y se congela en la primera tool que da timeout, en el primer loop infinito de razonamiento o en el primer deploy que pierde el estado a mitad de una tarea larga. Producción exige otra cosa: un orquestador que coordina varios agentes especializados, decide quién hace qué, ejecuta herramientas con falla controlada, persiste estado para retomar y mide cada paso. Este artículo muestra cómo pasar del agente único monolítico a una orquestación confiable: los patrones de coordinación (supervisor, secuencial, paralelo), cómo modelar estado durable, cómo blindar la llamada de tool, cómo cortar loops y costo con límites, y qué observar para no operar a ciegas. El foco es ingeniería de producción, no la demo del viernes por la tarde.',
  sections: [
    {
      title: '¿Por qué un agente único no aguanta producción?',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El agente único con un prompt gigante y todas las tools en el mismo contexto es la arquitectura que más rápido llega a la demo y más rápido se rompe en producción. El contexto se infla, el modelo se confunde sobre qué tool usar, el costo por llamada explota porque todo entra en el prompt, y una tarea que necesita diez pasos se vuelve una cadena de decisiones donde cualquier error a mitad contamina el resto. No hay dónde intervenir: es una caja negra que o acierta todo o falla todo.',
        },
        {
          type: 'paragraph',
          value:
            'Orquestar es romper esa caja negra en partes con responsabilidad única. Un agente que solo clasifica intención. Uno que solo consulta la base. Uno que solo redacta la respuesta. Un supervisor que decide el orden. Cada parte tiene contexto menor, prompt enfocado, tools limitadas y su propio punto de observación. Cuando algo falla, sabes cuál agente falló y por qué, en vez de reprocesar la conversación entera tratando de adivinar. Es la misma lógica de romper un monolito en servicios, aplicada al razonamiento.',
        },
      ],
    },
    {
      title: 'Los tres patrones de coordinación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No hay una única forma de orquestar. Hay tres patrones base, y la mayoría de los sistemas reales combina los tres. Elegir el patrón correcto por etapa es lo que separa una orquestación enjuta de una que quema el doble de tokens sin ganancia.',
        },
        {
          type: 'table',
          columns: ['Patrón', 'Cómo funciona', 'Cuándo usar', 'Costo y riesgo'],
          rows: [
            [
              'Secuencial (pipeline)',
              'La salida de un agente es la entrada del siguiente, en orden fijo',
              'Etapas con dependencia clara: clasificar -> buscar -> redactar',
              'Bajo costo, la latencia suma; un paso lento traba la cadena',
            ],
            [
              'Supervisor (router)',
              'Un agente central decide a qué especialista mandar cada tarea',
              'Muchas intenciones distintas, cada una con su agente',
              'Costo del paso de ruteo; un error del supervisor se propaga',
            ],
            [
              'Paralelo (fan-out)',
              'Varios agentes corren a la vez y un paso agrega',
              'Sub-tareas independientes: consultar 3 fuentes de una vez',
              'Latencia = la más lenta, pero el costo suma todas en paralelo',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'En la práctica anidas los patrones. El supervisor rutea a un pipeline; dentro del pipeline, un paso hace fan-out a tres consultas paralelas y agrega. La regla es usar paralelo solo cuando las sub-tareas son de hecho independientes (si no, pagas el costo sin ganar latencia) y usar supervisor solo cuando hay divergencia real de intención (si no, un pipeline fijo es más barato y más previsible).',
        },
      ],
    },
    {
      title: 'Estado durable: retomar donde se detuvo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error más caro en agentes de producción es tratar el estado como algo que vive en la memoria del proceso. Una tarea de agente puede tardar segundos o minutos, llamar varias tools y sobrevivir a un deploy en el medio. Si el estado está solo en RAM, cualquier restart pierde el progreso, y o reprocesas todo (caro, y las tools con efecto colateral corren dos veces) o pierdes la tarea. Estado durable significa persistir cada paso concluido, para que el orquestador pueda retomar exactamente donde se detuvo.',
        },
        {
          type: 'code',
          value: `// orchestrator/state.js
// Estado de la ejecucion persistido por paso. La clave es el runId;
// cada paso concluido se graba antes de avanzar, para retomar tras una falla.

export function createRun(store, runId, input) {
  return store.put(runId, {
    runId,
    input,
    status: 'running',
    step: 0,
    // Historial append-only: cada entrada es un paso ya concluido.
    history: [],
    createdAt: null, // lo llena la store, evita depender de un reloj aqui
  });
}

// Graba el resultado de un paso ANTES de llamar al siguiente agente.
// Asi, si el proceso muere en el paso N+1, el paso N no se pierde.
export async function commitStep(store, runId, stepResult) {
  const run = await store.get(runId);
  run.history.push(stepResult);
  run.step += 1;
  await store.put(runId, run);
  return run;
}

// Al reiniciar, retoma desde el punto guardado en vez de empezar de cero.
export async function resume(store, runId, agents) {
  const run = await store.get(runId);
  if (run.status !== 'running') return run;
  // El siguiente agente lo decide el paso actual, no la memoria perdida.
  const next = agents[run.step];
  if (!next) return finish(store, run);
  return next.run(run);
}`,
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia práctica: las tools con efecto colateral (enviar mensaje, cobrar, crear pedido) deben ser idempotentes o registradas como concluidas en el estado, para que el retome no dispare la misma acción de nuevo. Persistir el paso antes de avanzar, y no después, es el detalle que garantiza que el retome nunca salte ni repita un paso crítico.',
        },
      ],
    },
    {
      title: 'Blindando la llamada de tool',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La tool es donde el agente toca el mundo real, y por eso es donde más falla. Una API externa se cae, responde lento, devuelve un payload fuera del contrato o retorna un error transitorio. Un agente de producción nunca llama una tool cruda: envuelve toda llamada en timeout, retry con backoff, validación de salida y un camino de degradación para cuando la tool falla del todo. Sin eso, una sola API inestable tumba la ejecución entera.',
        },
        {
          type: 'code',
          value: `// orchestrator/tool-runner.js
// Ejecuta una tool con timeout, retry con backoff y validacion de salida.
// Aisla la falla de la tool para que el orquestador decida que hacer.

export async function runTool(tool, args, opts = {}) {
  const { retries = 2, timeoutMs = 8000, backoffMs = 500 } = opts;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await withTimeout(tool.execute(args), timeoutMs);
      // Valida el contrato ANTES de devolver al agente.
      if (!tool.validate(result)) {
        throw new Error('tool_output_invalid');
      }
      return { ok: true, result, attempts: attempt + 1 };
    } catch (err) {
      const transient = isTransient(err);
      // Solo hace retry en error transitorio; un error de contrato no mejora.
      if (!transient || attempt === retries) {
        return { ok: false, error: err.message, attempts: attempt + 1 };
      }
      // Backoff exponencial simple entre intentos.
      await sleep(backoffMs * 2 ** attempt);
    }
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('tool_timeout')), ms),
    ),
  ]);
}`,
        },
        {
          type: 'paragraph',
          value:
            'El punto sutil: el retry solo tiene sentido en error transitorio (timeout, 503, conexión caída). Un error de contrato o 4xx no mejora repitiendo, solo quema tiempo y tokens. Y cuando la tool falla del todo, el orquestador necesita un plan B explícito: responder con lo que tiene, escalar a un humano, o marcar la tarea como parcial. El agente nunca debe inventar el resultado de una tool que falló, porque ahí la falla se vuelve una alucinación silenciosa, que es peor que el error visible.',
        },
      ],
    },
    {
      title: 'Cortando loops, costo y divagación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un agente sin límite es un generador de costo. Puede entrar en loop llamando la misma tool, razonar en círculos, o expandir el contexto hasta reventar el límite del modelo. Producción exige guardrails duros que cortan la ejecución antes de volverse pérdida. Estos límites no son opcionales ni "para después": son lo que impide que una sola tarea consuma el presupuesto de mil.',
        },
        {
          type: 'list',
          items: [
            'Límite de pasos: un techo de iteraciones por ejecución (por ejemplo, 12). Al alcanzarlo, el orquestador para y devuelve el mejor resultado parcial en vez de correr para siempre.',
            'Presupuesto de tokens por tarea: suma los tokens de todos los pasos y aborta si pasa del límite. Una tarea que ya gastó lo esperado probablemente está en loop.',
            'Detección de repetición: si el agente llama la misma tool con los mismos argumentos dos veces seguidas, es señal de loop; interrumpe y cambia de estrategia.',
            'Timeout de punta a punta: además del timeout por tool, un techo de tiempo total de la tarea, para que nada quede colgado indefinidamente reteniendo un recurso.',
            'Confianza mínima para actuar: en acción con efecto colateral, exige que el agente esté por encima de un umbral de certeza; por debajo, escala a un humano en vez de arriesgar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La filosofía es simple: prefiere fallar de forma visible y barata a tener éxito caro e impredecible. Un límite alcanzado es un evento observable que investigas y ajustas; un loop sin límite es una factura a fin de mes que nadie entiende. Cada guardrail que dispara debe volverse log y métrica, para que sepas qué tareas tocan el techo y por qué.',
        },
      ],
    },
    {
      title: 'Observabilidad: no operar a ciegas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Orquestación sin tracing es imposible de depurar. Cuando una tarea sale mal, necesitas ver el árbol entero: qué agente corrió, qué tool llamó, cuánto costó cada paso en tokens y latencia, dónde se detuvo. Sin eso, todo bug se vuelve arqueología. El modelo mental correcto es el de tracing distribuido: cada ejecución es un trace, cada paso de agente o tool es un span anidado, con atributos de costo y resultado.',
        },
        {
          type: 'diagram',
          value: `Trace de una ejecución orquestada

  Run abc123  (tarea: "cambiar mi pedido")
    |
    +-- span: supervisor            12 tok-in / 40 tok-out   90ms
    |     ruteo -> agente "pedidos"
    |
    +-- span: agente pedidos        320 tok-in / 85 tok-out  240ms
    |     |
    |     +-- span: tool getOrder   ok    retry=0            310ms
    |     +-- span: tool checkStock ok    retry=1            720ms  <- lenta
    |
    +-- span: agente redactor       410 tok-in / 190 tok-out 300ms
    |
    v
  status: ok    total: 632 tok-out   costo: US$ 0,004   1,66s`,
        },
        {
          type: 'ordered',
          items: [
            'Genera un runId por ejecución y propágalo en todos los pasos, para amarrar el trace entero a una tarea.',
            'Emite un span por agente y por tool, con tokens de entrada y salida, latencia, número de retries y status.',
            'Registra la decisión del supervisor: a qué agente ruteó y por qué, si no el ruteo se vuelve caja negra.',
            'Agrega costo y latencia por ejecución y por tipo de tarea, para hallar qué jornada está cara o lenta.',
            'Alerta en señales que importan: tasa de tareas que tocan el límite de pasos, retries de tool por encima de lo normal, costo por tarea subiendo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Con el trace, un problema que serían horas de adivinanza se vuelve minutos: abres la tarea que falló, ves que la tool checkStock dio retry y reventó el timeout, y sabes exactamente dónde actuar. Sin el trace, solo tienes "el bot respondió mal" y ningún camino hasta la causa. La observabilidad no es adorno; es lo que hace operable la orquestación.',
        },
      ],
    },
    {
      title: 'Del prototipo a producción sin reescribir todo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La buena noticia es que no necesitas un framework pesado para llegar ahí. Un orquestador de producción cabe en pocas piezas bien definidas, y la mayoría de los frameworks solo envuelven esos mismos conceptos. El camino práctico es evolucionar el prototipo por capas, agregando confiabilidad sin tirar lo que ya funciona.',
        },
        {
          type: 'list',
          items: [
            'Empieza separando el agente único en roles: extrae el ruteo y uno o dos especialistas antes de optimizar cualquier cosa.',
            'Agrega estado durable temprano: es lo que más dificulta refactorizar después, porque cambia cómo se llama cada paso.',
            'Envuelve toda tool en el runner con timeout y retry desde el primer día; es barato de agregar y caro de olvidar.',
            'Pon los guardrails de paso, costo y timeout antes de abrir a tráfico real, nunca después del primer susto de factura.',
            'Instrumenta el tracing junto con la primera versión orquestada; retro-encajar observabilidad es siempre más trabajo que nacer con ella.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La diferencia entre el agente de demo y el de producción no está en la inteligencia del modelo, está en la ingeniería a su alrededor: coordinación clara, estado que sobrevive a la falla, tools blindadas, límites que cortan el desperdicio y tracing que te deja ver. Quien trata esto como un detalle descubre el costo en producción, en el peor momento posible.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Necesito un framework de agentes para orquestar?',
      answer:
        'No para empezar. Los conceptos que importan (supervisor, estado durable, runner de tool con retry, guardrails y tracing) caben en unos cientos de líneas y son los mismos que los frameworks envuelven. Un framework ayuda cuando el equipo crece y quieres estandarizar, pero adoptarlo demasiado pronto esconde el funcionamiento y dificulta depurar. Entiende las piezas primero; elige el framework después, sabiendo qué resuelve.',
    },
    {
      question: '¿Cuándo uso varios agentes en vez de uno solo?',
      answer:
        'Cuando el contexto o las tools de un único agente empiezan a competir. Si un prompt tiene que cubrir intenciones muy distintas, o si la lista de tools creció al punto de que el modelo confunde cuál usar, separar en agentes con contexto menor y alcance enfocado mejora precisión y reduce costo. No separes por separar: un pipeline fijo de dos pasos suele ser más barato y previsible que un enjambre de agentes cuando la tarea es lineal.',
    },
    {
      question: '¿Cómo controlo el costo de una orquestación con varios agentes?',
      answer:
        'Con límites duros y tracing por paso. Pon techo de iteraciones, presupuesto de tokens por tarea, detección de repetición y timeout de punta a punta, para que ninguna tarea corra sin freno. En paralelo, emite un span por agente y por tool con tokens y latencia, agrega costo por tipo de tarea y alerta cuando sube. El costo se escapa cuando nadie mira; con límite y trace se vuelve un número que gestionas.',
    },
  ],
  conclusion: {
    title: 'La orquestación es la ingeniería que convierte un agente de demo en un agente de producción',
    description:
      'Coordinación clara, estado durable, tools blindadas, guardrails de costo y tracing por paso son lo que hace que un agente de IA aguante producción. Puedo diseñar y montar esta orquestación en tu producto, del ruteo al tracing, integrada a tu stack y lista para escalar.',
    cta: 'Hablar sobre orquestar mis agentes',
  },
  related: [
    { label: 'Evaluación continua de bots: del eval manual al automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'RAG para atención en WhatsApp en producción', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Chatbots e IA para atención', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'agent-orchestrator-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
