// Conteudo do artigo: roadmap de 90 dias para automacao de atendimento com IA.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A maioria dos projetos de automação de atendimento com IA morre no piloto: a demo impressiona, mas ninguém sabe dizer se o bot resolve mais do que atrapalha, qual a taxa de contenção real ou quem responde quando ele erra. Sair do piloto e chegar em operação não é questão de prompt melhor, é questão de plano: instrumentar antes de automatizar, automatizar um subconjunto antes de escalar, e governar a mudança antes de abrir para tudo. Este roadmap de 90 dias divide o trajeto em três fases com objetivo, entregável e métrica claros para cada uma, no nível de detalhe que um líder técnico ou PM precisa para defender o plano e medir progresso.',
  sections: [
    {
      title: 'A linha do tempo em três fases',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro clássico é tratar automação como um lançamento único: liga o bot, torce e mede depois. As três fases existem para reduzir risco em etapas. Nos primeiros 30 dias você não automatiza nada, apenas descobre e instrumenta. Dos 30 aos 60 você roda um piloto guiado num subconjunto pequeno de intents, com handoff humano sempre disponível. Dos 60 aos 90 você escala com governança: expande intents, adiciona RAG e guardrails, e estabelece um processo de mudança. Cada fronteira é um portão de decisão, não uma data no calendário.',
        },
        {
          type: 'diagram',
          value: `DIA 0 ------------- 30 ------------- 60 ------------- 90

[ FASE 1 ]          [ FASE 2 ]          [ FASE 3 ]
Descobrir e         Piloto guiado       Escalar com
instrumentar        com handoff         governança

- top intents       - bot em poucas     - expandir intents
- baseline          intents             - RAG + guardrails
  (volume/CSAT/     - handoff sempre    - governança de
   tempo)             disponível          mudança
- instrumentação    - medir contenção   - SLAs e alertas

PORTÃO 1            PORTÃO 2            PORTÃO 3
baseline confiável  contenção com       operação estável
+ eventos no log    CSAT mantido        + processo de mudança`,
        },
        {
          type: 'paragraph',
          value:
            'Os portões importam mais que as datas. Se ao fim da fase 1 você não tem baseline confiável, não avance: automatizar sem linha de base é automatizar no escuro. Se ao fim da fase 2 a contenção subiu mas o CSAT caiu, você está empurrando problema para o cliente, não resolvendo. Tratar cada fronteira como critério de saída, e não como prazo, é o que separa um rollout responsável de um piloto que virou produção por inércia.',
        },
      ],
    },
    {
      title: 'O plano em uma tabela',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de detalhar cada fase, vale fixar o contrato de cada uma: o que ela busca, o que ela entrega e como você sabe que terminou. Use esta tabela como o resumo executivo do roadmap, aquele slide único que alinha time técnico, suporte e liderança sobre o que esperar em cada marco.',
        },
        {
          type: 'table',
          columns: ['Fase', 'Objetivo', 'Entregável', 'Métrica de saída'],
          rows: [
            [
              'Fase 1 (0-30): descobrir e instrumentar',
              'Entender a demanda e medir o estado atual',
              'Mapa de top intents + baseline + eventos no log',
              'Baseline confiável de volume, CSAT e tempo de resposta',
            ],
            [
              'Fase 2 (30-60): piloto guiado',
              'Automatizar um subconjunto com segurança',
              'Bot em 3 a 5 intents + handoff humano sempre disponível',
              'Taxa de contenção medida com CSAT mantido ou melhor',
            ],
            [
              'Fase 3 (60-90): escalar com governança',
              'Ampliar cobertura sem perder controle',
              'Mais intents + RAG/guardrails + processo de mudança',
              'Operação estável com SLAs, alertas e revisão contínua',
            ],
          ],
        },
      ],
    },
    {
      title: 'Fase 1 (0-30): descobrir e instrumentar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A fase 1 não entrega bot nenhum, e é a mais importante. O objetivo é duplo: entender o que os clientes realmente perguntam e medir o estado atual com números, para que toda melhoria futura seja comparável. Pular esta fase é o erro mais caro do roadmap, porque sem baseline você nunca prova ROI nem detecta regressão. Siga esta ordem.',
        },
        {
          type: 'ordered',
          items: [
            'Mapeie os top intents: extraia 60 a 90 dias de tickets e conversas e agrupe por intenção real (segunda via, status de pedido, troca, horário, falar com humano). Ordene por volume. Tipicamente 10 a 15 intents cobrem 80 por cento do volume, e é nesse topo que a automação paga.',
            'Estabeleça o baseline de volume: meça quantos contatos por dia e por intent, distribuição por hora e por canal, e o pico. Sem isso você não dimensiona contenção nem capacidade.',
            'Estabeleça o baseline de CSAT e qualidade: registre a satisfação atual por intent (CSAT ou proxy como reabertura de ticket), para garantir que a automação não degrade a experiência. Esta é a métrica de guarda que protege o cliente nas fases seguintes.',
            'Estabeleça o baseline de tempo: tempo de primeira resposta, tempo de resolução e tempo em fila, por intent. Eles viram a promessa de valor (responder em segundos o que hoje leva minutos ou horas).',
            'Instrumente os eventos antes de automatizar: defina e implemente o log de eventos (mensagem recebida, intent detectada, resposta enviada, handoff acionado, ticket resolvido) com ids correlacionáveis. A instrumentação precede o bot, nunca o contrário.',
            'Defina o golden set inicial: separe 30 a 50 perguntas reais com a resposta correta revisada por humano. Ele vira a base de avaliação do bot na fase 2 e o critério objetivo de qualidade.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Ao fim da fase 1 você não tem automação, mas tem algo mais valioso: um número confiável para cada coisa que pretende melhorar e um log que vai contar a verdade quando o bot entrar. Esse é o portão 1. Se algum baseline ainda for chute, fique mais uma semana aqui antes de avançar.',
        },
      ],
    },
    {
      title: 'Fase 2 (30-60): piloto guiado com handoff',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Agora o bot entra, mas com escopo deliberadamente estreito. A regra da fase 2 é automatizar pouco e medir muito. Escolha de 3 a 5 intents do topo que sejam de alto volume e baixo risco (perguntas informativas antes de ações transacionais), e mantenha o handoff humano sempre a um toque de distância. O sucesso desta fase não é "o bot funciona", é "o bot contém parte do volume sem piorar o CSAT do baseline".',
        },
        {
          type: 'list',
          items: [
            'Comece por intents de alto volume e baixo risco: FAQ, horários, políticas. Deixe ações com efeito colateral (cancelar, reembolsar) para a fase 3, quando já houver guardrails.',
            'Handoff sempre disponível: o cliente pode pedir um humano a qualquer momento, e o bot escala sozinho quando a confiança cai ou detecta frustração. Handoff não é falha do bot, é a rede de segurança que torna o piloto seguro.',
            'Meça a taxa de contenção: percentual de conversas resolvidas sem handoff, por intent. É a métrica central da fase, mas só vale lida junto do CSAT.',
            'Vigie o CSAT como métrica de guarda: contenção subindo com CSAT caindo é sinal de alarme, não de sucesso. A meta é contenção maior com satisfação igual ou melhor que o baseline.',
            'Avalie contra o golden set a cada mudança: rode fidelidade e relevância das respostas em CI antes de qualquer ajuste de prompt ir para produção.',
            'Faça shadow ou rollout percentual: rode em uma fatia do tráfego (por exemplo 10 a 20 por cento) ou em modo sombra antes de abrir para todos, para limitar o raio de impacto de um erro.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O portão 2 é atingido quando a contenção no subconjunto é consistente e o CSAT se mantém ou melhora em relação ao baseline. Só então faz sentido pensar em expandir. Se a contenção veio às custas da satisfação, o problema está no escopo ou nas respostas, não na ambição: corrija aqui, com poucos intents, e não depois com cinquenta.',
        },
      ],
    },
    {
      title: 'Fase 3 (60-90): escalar com governança',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com um piloto que comprovadamente contém volume sem degradar a experiência, a fase 3 expande cobertura, mas o foco muda de "automatizar mais" para "automatizar sem perder controle". Escalar sem governança é como remover os freios depois de aprender a acelerar. Aqui você amplia intents, adiciona RAG e guardrails para sustentar qualidade na escala, e formaliza o processo de mudança.',
        },
        {
          type: 'list',
          items: [
            'Expanda intents em ondas: adicione novos intents em lotes pequenos, cada um passando pelo mesmo rito de baseline, golden set e medição da fase 2. Nunca abra dezenas de intents de uma vez.',
            'Adote RAG para conhecimento que cresce: quando a base de respostas fica grande e muda, recuperação ancorada na sua base de conhecimento sustenta precisão melhor que prompts gigantes e estáticos.',
            'Reforce guardrails para ações de risco: ao automatizar intents transacionais, exija confirmação, limite de escopo, threshold de confiança e fallback explícito para humano. Guardrail é o que permite automatizar ação sem medo.',
            'Estabeleça governança de mudança: toda alteração de prompt, intent ou base passa por revisão, avaliação no golden set e versionamento. Mudança em produção é evento auditável, não ajuste informal no painel.',
            'Defina SLAs e alertas: formalize o SLA de handoff e de resposta humana, e instrumente alertas para queda de contenção, salto de handoff ou erro de integração, para detectar regressão antes do cliente reclamar.',
            'Institua revisão contínua: amostre conversas reais toda semana, alimente as falhas de volta no golden set e reavalie. A operação estável é um ciclo, não um estado final.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O portão 3 não é um lançamento, é a transição de projeto para operação: cobertura ampliada, qualidade sustentada por RAG e guardrails, e um processo que permite mudar com segurança toda semana. A partir daqui o roadmap vira rotina, e o trabalho deixa de ser "colocar o bot no ar" e passa a ser "mantê-lo confiável enquanto o negócio muda".',
        },
      ],
    },
    {
      title: 'Armadilhas que afundam o rollout',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A maioria dos roadmaps falha pelos mesmos três motivos, e todos são evitáveis se você respeitar a ordem das fases. Eles aparecem cedo e custam caro, porque corrompem a base sobre a qual todo o resto se apoia.',
        },
        {
          type: 'list',
          items: [
            'Automatizar tudo de uma vez: abrir dezenas de intents no primeiro mês maximiza a superfície de erro e impossibilita atribuir causa quando algo dá errado. A fase 2 existe justamente para conter o raio de impacto. Comece estreito.',
            'Avançar sem baseline: sem volume, CSAT e tempo medidos antes do bot, você nunca prova ROI nem detecta regressão, e qualquer discussão vira opinião. A fase 1 não é opcional, é o que torna todo o resto comparável.',
            'Operar sem handoff: bot sem saída humana transforma cada limitação em cliente preso e irritado. O handoff sempre disponível é o que torna seguro errar e aprender em produção. Sem ele, o primeiro erro vira incidente.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que esperar 30 dias antes de ligar o bot?',
      answer:
        'Porque sem baseline de volume, CSAT e tempo, e sem eventos instrumentados, você não consegue provar que o bot melhorou nada nem detectar quando ele piora. A fase 1 transforma "acho que está melhor" em número comparável. Pular essa fase é o erro mais caro do roadmap: você automatiza no escuro e descobre os problemas pela reclamação do cliente, não pelo painel.',
    },
    {
      question: 'Qual é a métrica mais importante para acompanhar?',
      answer:
        'A taxa de contenção (conversas resolvidas sem handoff), mas nunca isolada. Ela só vale lida junto do CSAT, que é a métrica de guarda. Contenção subindo com CSAT caindo significa empurrar o problema para o cliente, não resolver. A meta saudável é contenção maior mantendo satisfação igual ou melhor que o baseline da fase 1.',
    },
    {
      question: 'O que faço se ao fim de 60 dias a contenção estiver baixa?',
      answer:
        'Não avance para escalar. Contenção baixa com poucos intents indica problema de escopo ou de qualidade das respostas, e expandir só multiplica o problema. Volte ao golden set, verifique se os intents escolhidos eram mesmo de alto volume e baixo risco, e ajuste antes de abrir mais. É mais barato corrigir com cinco intents do que com cinquenta.',
    },
  ],
  conclusion: {
    title: 'Do piloto à operação em fases, com métrica e governança',
    description:
      'Automação de atendimento que dura não nasce de um lançamento único, e sim de um roadmap em fases: instrumentar antes de automatizar, pilotar um subconjunto com handoff antes de escalar, e governar a mudança antes de abrir para tudo. Posso desenhar e conduzir esse plano de 90 dias para a sua operação, com baseline, métricas e governança.',
    cta: 'Falar sobre meu roadmap de automação',
  },
  related: [
    { label: 'Chatbots e IA para atendimento', to: '/servicos/chatbots-e-ia' },
    { label: 'ROI real da automação com IA', to: '/blog/roi-real-automacao-ia' },
    { label: 'SLAs de atendimento entre bot e humano', to: '/blog/slas-atendimento-bot-humano' },
  ],
};

const en = {
  intro:
    'Most AI support automation projects die in the pilot: the demo impresses, but no one can say whether the bot resolves more than it disrupts, what the real containment rate is, or who answers when it gets things wrong. Going from pilot to operation is not about a better prompt, it is about a plan: instrument before you automate, automate a subset before you scale, and govern change before you open everything up. This 90-day roadmap splits the journey into three phases with a clear objective, deliverable, and metric for each, at the level of detail a tech lead or PM needs to defend the plan and measure progress.',
  sections: [
    {
      title: 'The timeline in three phases',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The classic mistake is treating automation as a single launch: flip the bot on, hope, and measure later. The three phases exist to reduce risk in stages. In the first 30 days you automate nothing, you only discover and instrument. From 30 to 60 you run a guided pilot on a small subset of intents, with human handoff always available. From 60 to 90 you scale with governance: expand intents, add RAG and guardrails, and establish a change process. Each boundary is a decision gate, not a date on the calendar.',
        },
        {
          type: 'diagram',
          value: `DAY 0 ------------- 30 ------------- 60 ------------- 90

[ PHASE 1 ]         [ PHASE 2 ]         [ PHASE 3 ]
Discover and        Guided pilot        Scale with
instrument          with handoff        governance

- top intents       - bot on a few      - expand intents
- baseline          intents             - RAG + guardrails
  (volume/CSAT/     - handoff always    - change
   time)              available           governance
- instrumentation   - measure           - SLAs and alerts
                      containment

GATE 1              GATE 2              GATE 3
reliable baseline   containment with    stable operation
+ events in log     CSAT held           + change process`,
        },
        {
          type: 'paragraph',
          value:
            'The gates matter more than the dates. If by the end of phase 1 you do not have a reliable baseline, do not advance: automating without a baseline is automating in the dark. If by the end of phase 2 containment went up but CSAT went down, you are pushing the problem onto the customer, not solving it. Treating each boundary as an exit criterion rather than a deadline is what separates a responsible rollout from a pilot that became production by inertia.',
        },
      ],
    },
    {
      title: 'The plan in one table',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before detailing each phase, it helps to fix the contract of each one: what it seeks, what it delivers, and how you know it is done. Use this table as the executive summary of the roadmap, the single slide that aligns the engineering team, support, and leadership on what to expect at each milestone.',
        },
        {
          type: 'table',
          columns: ['Phase', 'Objective', 'Deliverable', 'Exit metric'],
          rows: [
            [
              'Phase 1 (0-30): discover and instrument',
              'Understand demand and measure the current state',
              'Top intents map + baseline + events in the log',
              'Reliable baseline of volume, CSAT and response time',
            ],
            [
              'Phase 2 (30-60): guided pilot',
              'Automate a subset safely',
              'Bot on 3 to 5 intents + human handoff always available',
              'Measured containment rate with CSAT held or improved',
            ],
            [
              'Phase 3 (60-90): scale with governance',
              'Widen coverage without losing control',
              'More intents + RAG/guardrails + change process',
              'Stable operation with SLAs, alerts and continuous review',
            ],
          ],
        },
      ],
    },
    {
      title: 'Phase 1 (0-30): discover and instrument',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Phase 1 ships no bot at all, and it is the most important. The objective is twofold: understand what customers actually ask and measure the current state in numbers, so every future improvement is comparable. Skipping this phase is the most expensive mistake in the roadmap, because without a baseline you can never prove ROI or detect regression. Follow this order.',
        },
        {
          type: 'ordered',
          items: [
            'Map the top intents: pull 60 to 90 days of tickets and conversations and group them by real intent (account recovery, order status, returns, hours, talk to a human). Sort by volume. Typically 10 to 15 intents cover 80 percent of volume, and that is where automation pays off.',
            'Establish the volume baseline: measure contacts per day and per intent, distribution by hour and channel, and the peak. Without this you cannot size containment or capacity.',
            'Establish the CSAT and quality baseline: record current satisfaction per intent (CSAT or a proxy like ticket reopens), to ensure automation does not degrade the experience. This is the guard metric that protects the customer in the next phases.',
            'Establish the time baseline: first response time, resolution time, and queue time, per intent. These become the value promise (answering in seconds what today takes minutes or hours).',
            'Instrument events before automating: define and implement the event log (message received, intent detected, response sent, handoff triggered, ticket resolved) with correlatable ids. Instrumentation precedes the bot, never the other way around.',
            'Define the initial golden set: set aside 30 to 50 real questions with the correct, human-reviewed answer. It becomes the bot evaluation base in phase 2 and the objective quality criterion.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'By the end of phase 1 you have no automation, but you have something more valuable: a reliable number for each thing you intend to improve and a log that will tell the truth when the bot goes live. That is gate 1. If any baseline is still a guess, spend another week here before advancing.',
        },
      ],
    },
    {
      title: 'Phase 2 (30-60): guided pilot with handoff',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Now the bot enters, but with a deliberately narrow scope. The rule of phase 2 is automate little and measure a lot. Pick 3 to 5 top intents that are high volume and low risk (informational questions before transactional actions), and keep human handoff always one tap away. Success in this phase is not "the bot works", it is "the bot contains part of the volume without hurting the baseline CSAT".',
        },
        {
          type: 'list',
          items: [
            'Start with high-volume, low-risk intents: FAQ, hours, policies. Leave actions with side effects (cancel, refund) for phase 3, when guardrails are already in place.',
            'Handoff always available: the customer can ask for a human at any time, and the bot escalates on its own when confidence drops or it detects frustration. Handoff is not a bot failure, it is the safety net that makes the pilot safe.',
            'Measure the containment rate: the percentage of conversations resolved without handoff, per intent. It is the central metric of the phase, but only meaningful read alongside CSAT.',
            'Watch CSAT as a guard metric: containment rising while CSAT falls is an alarm signal, not success. The goal is higher containment with satisfaction equal to or better than the baseline.',
            'Evaluate against the golden set on every change: run answer faithfulness and relevancy in CI before any prompt tweak reaches production.',
            'Run a shadow or percentage rollout: run on a slice of traffic (for example 10 to 20 percent) or in shadow mode before opening to everyone, to limit the blast radius of a mistake.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Gate 2 is reached when containment in the subset is consistent and CSAT holds or improves versus the baseline. Only then does expanding make sense. If containment came at the cost of satisfaction, the problem is in the scope or the answers, not the ambition: fix it here, with a few intents, not later with fifty.',
        },
      ],
    },
    {
      title: 'Phase 3 (60-90): scale with governance',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With a pilot that demonstrably contains volume without degrading the experience, phase 3 expands coverage, but the focus shifts from "automate more" to "automate without losing control". Scaling without governance is like removing the brakes after you learn to accelerate. Here you widen intents, add RAG and guardrails to sustain quality at scale, and formalize the change process.',
        },
        {
          type: 'list',
          items: [
            'Expand intents in waves: add new intents in small batches, each going through the same baseline, golden set, and measurement ritual from phase 2. Never open dozens of intents at once.',
            'Adopt RAG for knowledge that grows: when the answer base gets large and changes, retrieval grounded in your knowledge base sustains accuracy better than giant, static prompts.',
            'Reinforce guardrails for risky actions: when automating transactional intents, require confirmation, scope limits, a confidence threshold, and an explicit fallback to a human. Guardrails are what let you automate actions without fear.',
            'Establish change governance: every change to a prompt, intent, or knowledge base goes through review, golden-set evaluation, and versioning. A production change is an auditable event, not an informal tweak in the dashboard.',
            'Define SLAs and alerts: formalize the handoff and human-response SLA, and instrument alerts for containment drops, handoff spikes, or integration errors, to detect regression before the customer complains.',
            'Institute continuous review: sample real conversations every week, feed failures back into the golden set, and re-evaluate. Stable operation is a cycle, not a final state.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Gate 3 is not a launch, it is the transition from project to operation: widened coverage, quality sustained by RAG and guardrails, and a process that lets you change safely every week. From here the roadmap becomes routine, and the work shifts from "getting the bot live" to "keeping it reliable as the business changes".',
        },
      ],
    },
    {
      title: 'Pitfalls that sink the rollout',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Most roadmaps fail for the same three reasons, and all are avoidable if you respect the order of the phases. They show up early and cost a lot, because they corrupt the foundation everything else rests on.',
        },
        {
          type: 'list',
          items: [
            'Automating everything at once: opening dozens of intents in the first month maximizes the error surface and makes it impossible to attribute cause when something breaks. Phase 2 exists precisely to contain the blast radius. Start narrow.',
            'Advancing without a baseline: without volume, CSAT, and time measured before the bot, you can never prove ROI or detect regression, and every discussion becomes opinion. Phase 1 is not optional, it is what makes everything else comparable.',
            'Operating without handoff: a bot with no human exit turns every limitation into a trapped, frustrated customer. Always-available handoff is what makes it safe to fail and learn in production. Without it, the first error becomes an incident.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why wait 30 days before turning the bot on?',
      answer:
        'Because without a baseline of volume, CSAT, and time, and without instrumented events, you cannot prove the bot improved anything or detect when it makes things worse. Phase 1 turns "I think it is better" into a comparable number. Skipping it is the most expensive mistake in the roadmap: you automate in the dark and discover the problems through customer complaints, not the dashboard.',
    },
    {
      question: 'What is the most important metric to track?',
      answer:
        'The containment rate (conversations resolved without handoff), but never in isolation. It is only meaningful read alongside CSAT, the guard metric. Containment rising while CSAT falls means pushing the problem onto the customer, not solving it. The healthy goal is higher containment while keeping satisfaction equal to or better than the phase 1 baseline.',
    },
    {
      question: 'What do I do if containment is low at the 60-day mark?',
      answer:
        'Do not advance to scaling. Low containment with few intents indicates a scope or answer-quality problem, and expanding only multiplies it. Go back to the golden set, verify the chosen intents were truly high volume and low risk, and adjust before opening more. It is cheaper to fix with five intents than with fifty.',
    },
  ],
  conclusion: {
    title: 'From pilot to operation in phases, with metrics and governance',
    description:
      'Support automation that lasts is not born from a single launch, it comes from a phased roadmap: instrument before you automate, pilot a subset with handoff before you scale, and govern change before you open everything up. I can design and run this 90-day plan for your operation, with baseline, metrics, and governance.',
    cta: 'Talk about my automation roadmap',
  },
  related: [
    { label: 'Chatbots and AI for support', to: '/servicos/chatbots-e-ia' },
    { label: 'Real ROI of AI automation', to: '/blog/roi-real-automacao-ia' },
    { label: 'Support SLAs between bot and human', to: '/blog/slas-atendimento-bot-humano' },
  ],
};

const es = {
  intro:
    'La mayoría de los proyectos de automatización de atención con IA muere en el piloto: la demo impresiona, pero nadie sabe decir si el bot resuelve más de lo que estorba, cuál es la tasa de contención real ni quién responde cuando se equivoca. Pasar del piloto a la operación no es cuestión de un mejor prompt, es cuestión de plan: instrumentar antes de automatizar, automatizar un subconjunto antes de escalar y gobernar el cambio antes de abrir todo. Este roadmap de 90 días divide el trayecto en tres fases con objetivo, entregable y métrica claros para cada una, al nivel de detalle que un líder técnico o PM necesita para defender el plan y medir el progreso.',
  sections: [
    {
      title: 'La línea de tiempo en tres fases',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error clásico es tratar la automatización como un lanzamiento único: enciendes el bot, cruzas los dedos y mides después. Las tres fases existen para reducir el riesgo por etapas. En los primeros 30 días no automatizas nada, solo descubres e instrumentas. De 30 a 60 corres un piloto guiado en un subconjunto pequeño de intents, con handoff humano siempre disponible. De 60 a 90 escalas con gobernanza: amplías intents, agregas RAG y guardrails y estableces un proceso de cambio. Cada frontera es una puerta de decisión, no una fecha en el calendario.',
        },
        {
          type: 'diagram',
          value: `DIA 0 ------------- 30 ------------- 60 ------------- 90

[ FASE 1 ]          [ FASE 2 ]          [ FASE 3 ]
Descubrir e         Piloto guiado       Escalar con
instrumentar        con handoff         gobernanza

- top intents       - bot en pocos      - ampliar intents
- baseline          intents             - RAG + guardrails
  (volumen/CSAT/    - handoff siempre   - gobernanza de
   tiempo)            disponible          cambio
- instrumentación   - medir contención  - SLAs y alertas

PUERTA 1            PUERTA 2            PUERTA 3
baseline confiable  contención con      operación estable
+ eventos en log    CSAT mantenido      + proceso de cambio`,
        },
        {
          type: 'paragraph',
          value:
            'Las puertas importan más que las fechas. Si al final de la fase 1 no tienes un baseline confiable, no avances: automatizar sin línea de base es automatizar a ciegas. Si al final de la fase 2 la contención subió pero el CSAT bajó, estás empujando el problema al cliente, no resolviéndolo. Tratar cada frontera como criterio de salida y no como plazo es lo que separa un rollout responsable de un piloto que se volvió producción por inercia.',
        },
      ],
    },
    {
      title: 'El plan en una tabla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de detallar cada fase, conviene fijar el contrato de cada una: qué busca, qué entrega y cómo sabes que terminó. Usa esta tabla como el resumen ejecutivo del roadmap, ese único slide que alinea al equipo técnico, soporte y liderazgo sobre qué esperar en cada hito.',
        },
        {
          type: 'table',
          columns: ['Fase', 'Objetivo', 'Entregable', 'Métrica de salida'],
          rows: [
            [
              'Fase 1 (0-30): descubrir e instrumentar',
              'Entender la demanda y medir el estado actual',
              'Mapa de top intents + baseline + eventos en el log',
              'Baseline confiable de volumen, CSAT y tiempo de respuesta',
            ],
            [
              'Fase 2 (30-60): piloto guiado',
              'Automatizar un subconjunto con seguridad',
              'Bot en 3 a 5 intents + handoff humano siempre disponible',
              'Tasa de contención medida con CSAT mantenido o mejor',
            ],
            [
              'Fase 3 (60-90): escalar con gobernanza',
              'Ampliar cobertura sin perder control',
              'Más intents + RAG/guardrails + proceso de cambio',
              'Operación estable con SLAs, alertas y revisión continua',
            ],
          ],
        },
      ],
    },
    {
      title: 'Fase 1 (0-30): descubrir e instrumentar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La fase 1 no entrega ningún bot, y es la más importante. El objetivo es doble: entender qué preguntan realmente los clientes y medir el estado actual en números, para que toda mejora futura sea comparable. Saltar esta fase es el error más caro del roadmap, porque sin baseline nunca pruebas ROI ni detectas regresión. Sigue este orden.',
        },
        {
          type: 'ordered',
          items: [
            'Mapea los top intents: extrae 60 a 90 días de tickets y conversaciones y agrúpalos por intención real (recuperar cuenta, estado de pedido, devoluciones, horarios, hablar con un humano). Ordena por volumen. Típicamente 10 a 15 intents cubren el 80 por ciento del volumen, y es ahí donde la automatización paga.',
            'Establece el baseline de volumen: mide contactos por día y por intent, distribución por hora y canal, y el pico. Sin esto no dimensionas contención ni capacidad.',
            'Establece el baseline de CSAT y calidad: registra la satisfacción actual por intent (CSAT o un proxy como reapertura de tickets), para garantizar que la automatización no degrade la experiencia. Esta es la métrica de guarda que protege al cliente en las fases siguientes.',
            'Establece el baseline de tiempo: tiempo de primera respuesta, tiempo de resolución y tiempo en cola, por intent. Se convierten en la promesa de valor (responder en segundos lo que hoy toma minutos u horas).',
            'Instrumenta los eventos antes de automatizar: define e implementa el log de eventos (mensaje recibido, intent detectado, respuesta enviada, handoff activado, ticket resuelto) con ids correlacionables. La instrumentación precede al bot, nunca al revés.',
            'Define el golden set inicial: aparta 30 a 50 preguntas reales con la respuesta correcta revisada por un humano. Se vuelve la base de evaluación del bot en la fase 2 y el criterio objetivo de calidad.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Al final de la fase 1 no tienes automatización, pero tienes algo más valioso: un número confiable para cada cosa que pretendes mejorar y un log que dirá la verdad cuando el bot entre. Esa es la puerta 1. Si algún baseline sigue siendo una suposición, quédate una semana más aquí antes de avanzar.',
        },
      ],
    },
    {
      title: 'Fase 2 (30-60): piloto guiado con handoff',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Ahora entra el bot, pero con un alcance deliberadamente estrecho. La regla de la fase 2 es automatizar poco y medir mucho. Elige de 3 a 5 intents del tope que sean de alto volumen y bajo riesgo (preguntas informativas antes de acciones transaccionales), y mantén el handoff humano siempre a un toque de distancia. El éxito de esta fase no es "el bot funciona", es "el bot contiene parte del volumen sin empeorar el CSAT del baseline".',
        },
        {
          type: 'list',
          items: [
            'Empieza por intents de alto volumen y bajo riesgo: FAQ, horarios, políticas. Deja las acciones con efecto colateral (cancelar, reembolsar) para la fase 3, cuando ya haya guardrails.',
            'Handoff siempre disponible: el cliente puede pedir un humano en cualquier momento, y el bot escala solo cuando la confianza cae o detecta frustración. El handoff no es una falla del bot, es la red de seguridad que hace seguro el piloto.',
            'Mide la tasa de contención: porcentaje de conversaciones resueltas sin handoff, por intent. Es la métrica central de la fase, pero solo vale leída junto al CSAT.',
            'Vigila el CSAT como métrica de guarda: contención subiendo con CSAT cayendo es señal de alarma, no de éxito. La meta es mayor contención con satisfacción igual o mejor que el baseline.',
            'Evalúa contra el golden set en cada cambio: corre fidelidad y relevancia de las respuestas en CI antes de que cualquier ajuste de prompt llegue a producción.',
            'Haz un rollout sombra o por porcentaje: corre en una fracción del tráfico (por ejemplo 10 a 20 por ciento) o en modo sombra antes de abrir a todos, para limitar el radio de impacto de un error.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La puerta 2 se alcanza cuando la contención en el subconjunto es consistente y el CSAT se mantiene o mejora frente al baseline. Solo entonces tiene sentido pensar en expandir. Si la contención vino a costa de la satisfacción, el problema está en el alcance o en las respuestas, no en la ambición: corrígelo aquí, con pocos intents, y no después con cincuenta.',
        },
      ],
    },
    {
      title: 'Fase 3 (60-90): escalar con gobernanza',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con un piloto que comprobadamente contiene volumen sin degradar la experiencia, la fase 3 amplía cobertura, pero el foco cambia de "automatizar más" a "automatizar sin perder control". Escalar sin gobernanza es como quitar los frenos después de aprender a acelerar. Aquí amplías intents, agregas RAG y guardrails para sostener calidad en la escala, y formalizas el proceso de cambio.',
        },
        {
          type: 'list',
          items: [
            'Amplía intents en olas: agrega nuevos intents en lotes pequeños, cada uno pasando por el mismo rito de baseline, golden set y medición de la fase 2. Nunca abras decenas de intents de una vez.',
            'Adopta RAG para conocimiento que crece: cuando la base de respuestas se vuelve grande y cambia, la recuperación anclada en tu base de conocimiento sostiene la precisión mejor que prompts gigantes y estáticos.',
            'Refuerza guardrails para acciones de riesgo: al automatizar intents transaccionales, exige confirmación, límite de alcance, umbral de confianza y fallback explícito a un humano. El guardrail es lo que permite automatizar acciones sin miedo.',
            'Establece gobernanza de cambio: todo cambio de prompt, intent o base pasa por revisión, evaluación en el golden set y versionado. Un cambio en producción es un evento auditable, no un ajuste informal en el panel.',
            'Define SLAs y alertas: formaliza el SLA de handoff y de respuesta humana, e instrumenta alertas para caídas de contención, saltos de handoff o errores de integración, para detectar regresión antes de que el cliente reclame.',
            'Instituye revisión continua: muestrea conversaciones reales cada semana, alimenta las fallas de vuelta al golden set y reevalúa. La operación estable es un ciclo, no un estado final.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La puerta 3 no es un lanzamiento, es la transición de proyecto a operación: cobertura ampliada, calidad sostenida por RAG y guardrails, y un proceso que permite cambiar con seguridad cada semana. A partir de aquí el roadmap se vuelve rutina, y el trabajo deja de ser "poner el bot en línea" y pasa a ser "mantenerlo confiable mientras el negocio cambia".',
        },
      ],
    },
    {
      title: 'Trampas que hunden el rollout',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La mayoría de los roadmaps falla por las mismas tres razones, y todas son evitables si respetas el orden de las fases. Aparecen temprano y cuestan caro, porque corrompen la base sobre la que se apoya todo lo demás.',
        },
        {
          type: 'list',
          items: [
            'Automatizar todo de una vez: abrir decenas de intents en el primer mes maximiza la superficie de error e imposibilita atribuir la causa cuando algo falla. La fase 2 existe justamente para contener el radio de impacto. Empieza estrecho.',
            'Avanzar sin baseline: sin volumen, CSAT y tiempo medidos antes del bot, nunca pruebas ROI ni detectas regresión, y cualquier discusión se vuelve opinión. La fase 1 no es opcional, es lo que hace comparable todo lo demás.',
            'Operar sin handoff: un bot sin salida humana convierte cada limitación en un cliente atrapado e irritado. El handoff siempre disponible es lo que hace seguro equivocarse y aprender en producción. Sin él, el primer error se vuelve incidente.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué esperar 30 días antes de encender el bot?',
      answer:
        'Porque sin baseline de volumen, CSAT y tiempo, y sin eventos instrumentados, no puedes probar que el bot mejoró nada ni detectar cuando empeora. La fase 1 convierte "creo que está mejor" en un número comparable. Saltarla es el error más caro del roadmap: automatizas a ciegas y descubres los problemas por el reclamo del cliente, no por el panel.',
    },
    {
      question: '¿Cuál es la métrica más importante a seguir?',
      answer:
        'La tasa de contención (conversaciones resueltas sin handoff), pero nunca aislada. Solo vale leída junto al CSAT, la métrica de guarda. Contención subiendo con CSAT cayendo significa empujar el problema al cliente, no resolverlo. La meta sana es mayor contención manteniendo la satisfacción igual o mejor que el baseline de la fase 1.',
    },
    {
      question: '¿Qué hago si a los 60 días la contención está baja?',
      answer:
        'No avances a escalar. Contención baja con pocos intents indica un problema de alcance o de calidad de las respuestas, y expandir solo lo multiplica. Vuelve al golden set, verifica que los intents elegidos fueran de verdad de alto volumen y bajo riesgo, y ajusta antes de abrir más. Es más barato corregir con cinco intents que con cincuenta.',
    },
  ],
  conclusion: {
    title: 'Del piloto a la operación en fases, con métrica y gobernanza',
    description:
      'La automatización de atención que perdura no nace de un lanzamiento único, sino de un roadmap en fases: instrumentar antes de automatizar, pilotar un subconjunto con handoff antes de escalar y gobernar el cambio antes de abrir todo. Puedo diseñar y conducir este plan de 90 días para tu operación, con baseline, métricas y gobernanza.',
    cta: 'Hablar sobre mi roadmap de automatización',
  },
  related: [
    { label: 'Chatbots e IA para atención', to: '/servicos/chatbots-e-ia' },
    { label: 'ROI real de la automatización con IA', to: '/blog/roi-real-automacao-ia' },
    { label: 'SLAs de atención entre bot y humano', to: '/blog/slas-atendimento-bot-humano' },
  ],
};

export default { pt, en, es };
