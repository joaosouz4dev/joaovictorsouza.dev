// Conteudo do artigo: roadmap de 90 dias para automacao de atendimento com IA.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A maioria dos projetos de automacao de atendimento com IA morre no piloto: a demo impressiona, mas ninguem sabe dizer se o bot resolve mais do que atrapalha, qual a taxa de contencao real ou quem responde quando ele erra. Sair do piloto e chegar em operacao nao e questao de prompt melhor, e questao de plano: instrumentar antes de automatizar, automatizar um subconjunto antes de escalar, e governar a mudanca antes de abrir para tudo. Este roadmap de 90 dias divide o trajeto em tres fases com objetivo, entregavel e metrica claros para cada uma, no nivel de detalhe que um lider tecnico ou PM precisa para defender o plano e medir progresso.',
  sections: [
    {
      title: 'A linha do tempo em tres fases',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro classico e tratar automacao como um lancamento unico: liga o bot, torce e mede depois. As tres fases existem para reduzir risco em etapas. Nos primeiros 30 dias voce nao automatiza nada, apenas descobre e instrumenta. Dos 30 aos 60 voce roda um piloto guiado num subconjunto pequeno de intents, com handoff humano sempre disponivel. Dos 60 aos 90 voce escala com governanca: expande intents, adiciona RAG e guardrails, e estabelece um processo de mudanca. Cada fronteira e um portao de decisao, nao uma data no calendario.',
        },
        {
          type: 'diagram',
          value: `DIA 0 ------------- 30 ------------- 60 ------------- 90

[ FASE 1 ]          [ FASE 2 ]          [ FASE 3 ]
Descobrir e         Piloto guiado       Escalar com
instrumentar        com handoff         governanca

- top intents       - bot em poucas     - expandir intents
- baseline          intents             - RAG + guardrails
  (volume/CSAT/     - handoff sempre    - governanca de
   tempo)             disponivel          mudanca
- instrumentacao    - medir contencao   - SLAs e alertas

PORTAO 1            PORTAO 2            PORTAO 3
baseline confiavel  contencao com       operacao estavel
+ eventos no log    CSAT mantido        + processo de mudanca`,
        },
        {
          type: 'paragraph',
          value:
            'Os portoes importam mais que as datas. Se ao fim da fase 1 voce nao tem baseline confiavel, nao avance: automatizar sem linha de base e automatizar no escuro. Se ao fim da fase 2 a contencao subiu mas o CSAT caiu, voce esta empurrando problema para o cliente, nao resolvendo. Tratar cada fronteira como criterio de saida, e nao como prazo, e o que separa um rollout responsavel de um piloto que virou producao por inercia.',
        },
      ],
    },
    {
      title: 'O plano em uma tabela',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de detalhar cada fase, vale fixar o contrato de cada uma: o que ela busca, o que ela entrega e como voce sabe que terminou. Use esta tabela como o resumo executivo do roadmap, aquele slide unico que alinha time tecnico, suporte e lideranca sobre o que esperar em cada marco.',
        },
        {
          type: 'table',
          columns: ['Fase', 'Objetivo', 'Entregavel', 'Metrica de saida'],
          rows: [
            [
              'Fase 1 (0-30): descobrir e instrumentar',
              'Entender a demanda e medir o estado atual',
              'Mapa de top intents + baseline + eventos no log',
              'Baseline confiavel de volume, CSAT e tempo de resposta',
            ],
            [
              'Fase 2 (30-60): piloto guiado',
              'Automatizar um subconjunto com seguranca',
              'Bot em 3 a 5 intents + handoff humano sempre disponivel',
              'Taxa de contencao medida com CSAT mantido ou melhor',
            ],
            [
              'Fase 3 (60-90): escalar com governanca',
              'Ampliar cobertura sem perder controle',
              'Mais intents + RAG/guardrails + processo de mudanca',
              'Operacao estavel com SLAs, alertas e revisao continua',
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
            'A fase 1 nao entrega bot nenhum, e e a mais importante. O objetivo e duplo: entender o que os clientes realmente perguntam e medir o estado atual com numeros, para que toda melhoria futura seja comparavel. Pular esta fase e o erro mais caro do roadmap, porque sem baseline voce nunca prova ROI nem detecta regressao. Siga esta ordem.',
        },
        {
          type: 'ordered',
          items: [
            'Mapeie os top intents: extraia 60 a 90 dias de tickets e conversas e agrupe por intencao real (segunda via, status de pedido, troca, horario, falar com humano). Ordene por volume. Tipicamente 10 a 15 intents cobrem 80 por cento do volume, e e nesse topo que a automacao paga.',
            'Estabeleca o baseline de volume: meca quantos contatos por dia e por intent, distribuicao por hora e por canal, e o pico. Sem isso voce nao dimensiona contencao nem capacidade.',
            'Estabeleca o baseline de CSAT e qualidade: registre a satisfacao atual por intent (CSAT ou proxy como reabertura de ticket), para garantir que a automacao nao degrade a experiencia. Esta e a metrica de guarda que protege o cliente nas fases seguintes.',
            'Estabeleca o baseline de tempo: tempo de primeira resposta, tempo de resolucao e tempo em fila, por intent. Eles viram a promessa de valor (responder em segundos o que hoje leva minutos ou horas).',
            'Instrumente os eventos antes de automatizar: defina e implemente o log de eventos (mensagem recebida, intent detectada, resposta enviada, handoff acionado, ticket resolvido) com ids correlacionaveis. A instrumentacao precede o bot, nunca o contrario.',
            'Defina o golden set inicial: separe 30 a 50 perguntas reais com a resposta correta revisada por humano. Ele vira a base de avaliacao do bot na fase 2 e o criterio objetivo de qualidade.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Ao fim da fase 1 voce nao tem automacao, mas tem algo mais valioso: um numero confiavel para cada coisa que pretende melhorar e um log que vai contar a verdade quando o bot entrar. Esse e o portao 1. Se algum baseline ainda for chute, fique mais uma semana aqui antes de avancar.',
        },
      ],
    },
    {
      title: 'Fase 2 (30-60): piloto guiado com handoff',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Agora o bot entra, mas com escopo deliberadamente estreito. A regra da fase 2 e automatizar pouco e medir muito. Escolha de 3 a 5 intents do topo que sejam de alto volume e baixo risco (perguntas informativas antes de acoes transacionais), e mantenha o handoff humano sempre a um toque de distancia. O sucesso desta fase nao e "o bot funciona", e "o bot contem parte do volume sem piorar o CSAT do baseline".',
        },
        {
          type: 'list',
          items: [
            'Comece por intents de alto volume e baixo risco: FAQ, horarios, politicas. Deixe acoes com efeito colateral (cancelar, reembolsar) para a fase 3, quando ja houver guardrails.',
            'Handoff sempre disponivel: o cliente pode pedir um humano a qualquer momento, e o bot escala sozinho quando a confianca cai ou detecta frustracao. Handoff nao e falha do bot, e a rede de seguranca que torna o piloto seguro.',
            'Meca a taxa de contencao: percentual de conversas resolvidas sem handoff, por intent. E a metrica central da fase, mas so vale lida junto do CSAT.',
            'Vigie o CSAT como metrica de guarda: contencao subindo com CSAT caindo e sinal de alarme, nao de sucesso. A meta e contencao maior com satisfacao igual ou melhor que o baseline.',
            'Avalie contra o golden set a cada mudanca: rode fidelidade e relevancia das respostas em CI antes de qualquer ajuste de prompt ir para producao.',
            'Faca shadow ou rollout percentual: rode em uma fatia do trafego (por exemplo 10 a 20 por cento) ou em modo sombra antes de abrir para todos, para limitar o raio de impacto de um erro.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O portao 2 e atingido quando a contencao no subconjunto e consistente e o CSAT se mantem ou melhora em relacao ao baseline. So entao faz sentido pensar em expandir. Se a contencao veio as custas da satisfacao, o problema esta no escopo ou nas respostas, nao na ambicao: corrija aqui, com poucos intents, e nao depois com cinquenta.',
        },
      ],
    },
    {
      title: 'Fase 3 (60-90): escalar com governanca',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com um piloto que comprovadamente contem volume sem degradar a experiencia, a fase 3 expande cobertura, mas o foco muda de "automatizar mais" para "automatizar sem perder controle". Escalar sem governanca e como remover os freios depois de aprender a acelerar. Aqui voce amplia intents, adiciona RAG e guardrails para sustentar qualidade na escala, e formaliza o processo de mudanca.',
        },
        {
          type: 'list',
          items: [
            'Expanda intents em ondas: adicione novos intents em lotes pequenos, cada um passando pelo mesmo rito de baseline, golden set e medicao da fase 2. Nunca abra dezenas de intents de uma vez.',
            'Adote RAG para conhecimento que cresce: quando a base de respostas fica grande e muda, recuperacao ancorada na sua base de conhecimento sustenta precisao melhor que prompts gigantes e estaticos.',
            'Reforce guardrails para acoes de risco: ao automatizar intents transacionais, exija confirmacao, limite de escopo, threshold de confianca e fallback explicito para humano. Guardrail e o que permite automatizar acao sem medo.',
            'Estabeleca governanca de mudanca: toda alteracao de prompt, intent ou base passa por revisao, avaliacao no golden set e versionamento. Mudanca em producao e evento auditavel, nao ajuste informal no painel.',
            'Defina SLAs e alertas: formalize o SLA de handoff e de resposta humana, e instrumente alertas para queda de contencao, salto de handoff ou erro de integracao, para detectar regressao antes do cliente reclamar.',
            'Institua revisao continua: amostre conversas reais toda semana, alimente as falhas de volta no golden set e reavalie. A operacao estavel e um ciclo, nao um estado final.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O portao 3 nao e um lancamento, e a transicao de projeto para operacao: cobertura ampliada, qualidade sustentada por RAG e guardrails, e um processo que permite mudar com seguranca toda semana. A partir daqui o roadmap vira rotina, e o trabalho deixa de ser "colocar o bot no ar" e passa a ser "mante-lo confiavel enquanto o negocio muda".',
        },
      ],
    },
    {
      title: 'Armadilhas que afundam o rollout',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A maioria dos roadmaps falha pelos mesmos tres motivos, e todos sao evitaveis se voce respeitar a ordem das fases. Eles aparecem cedo e custam caro, porque corrompem a base sobre a qual todo o resto se apoia.',
        },
        {
          type: 'list',
          items: [
            'Automatizar tudo de uma vez: abrir dezenas de intents no primeiro mes maximiza a superficie de erro e impossibilita atribuir causa quando algo da errado. A fase 2 existe justamente para conter o raio de impacto. Comece estreito.',
            'Avancar sem baseline: sem volume, CSAT e tempo medidos antes do bot, voce nunca prova ROI nem detecta regressao, e qualquer discussao vira opiniao. A fase 1 nao e opcional, e o que torna todo o resto comparavel.',
            'Operar sem handoff: bot sem saida humana transforma cada limitacao em cliente preso e irritado. O handoff sempre disponivel e o que torna seguro errar e aprender em producao. Sem ele, o primeiro erro vira incidente.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que esperar 30 dias antes de ligar o bot?',
      answer:
        'Porque sem baseline de volume, CSAT e tempo, e sem eventos instrumentados, voce nao consegue provar que o bot melhorou nada nem detectar quando ele piora. A fase 1 transforma "acho que esta melhor" em numero comparavel. Pular essa fase e o erro mais caro do roadmap: voce automatiza no escuro e descobre os problemas pela reclamacao do cliente, nao pelo painel.',
    },
    {
      question: 'Qual e a metrica mais importante para acompanhar?',
      answer:
        'A taxa de contencao (conversas resolvidas sem handoff), mas nunca isolada. Ela so vale lida junto do CSAT, que e a metrica de guarda. Contencao subindo com CSAT caindo significa empurrar o problema para o cliente, nao resolver. A meta saudavel e contencao maior mantendo satisfacao igual ou melhor que o baseline da fase 1.',
    },
    {
      question: 'O que faco se ao fim de 60 dias a contencao estiver baixa?',
      answer:
        'Nao avance para escalar. Contencao baixa com poucos intents indica problema de escopo ou de qualidade das respostas, e expandir so multiplica o problema. Volte ao golden set, verifique se os intents escolhidos eram mesmo de alto volume e baixo risco, e ajuste antes de abrir mais. E mais barato corrigir com cinco intents do que com cinquenta.',
    },
  ],
  conclusion: {
    title: 'Do piloto a operacao em fases, com metrica e governanca',
    description:
      'Automacao de atendimento que dura nao nasce de um lancamento unico, e sim de um roadmap em fases: instrumentar antes de automatizar, pilotar um subconjunto com handoff antes de escalar, e governar a mudanca antes de abrir para tudo. Posso desenhar e conduzir esse plano de 90 dias para a sua operacao, com baseline, metricas e governanca.',
    cta: 'Falar sobre meu roadmap de automacao',
  },
  related: [
    { label: 'Chatbots e IA para atendimento', to: '/servicos/chatbots-e-ia' },
    { label: 'ROI real da automacao com IA', to: '/blog/roi-real-automacao-ia' },
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
    'La mayoria de los proyectos de automatizacion de atencion con IA muere en el piloto: la demo impresiona, pero nadie sabe decir si el bot resuelve mas de lo que estorba, cual es la tasa de contencion real ni quien responde cuando se equivoca. Pasar del piloto a la operacion no es cuestion de un mejor prompt, es cuestion de plan: instrumentar antes de automatizar, automatizar un subconjunto antes de escalar y gobernar el cambio antes de abrir todo. Este roadmap de 90 dias divide el trayecto en tres fases con objetivo, entregable y metrica claros para cada una, al nivel de detalle que un lider tecnico o PM necesita para defender el plan y medir el progreso.',
  sections: [
    {
      title: 'La linea de tiempo en tres fases',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error clasico es tratar la automatizacion como un lanzamiento unico: enciendes el bot, cruzas los dedos y mides despues. Las tres fases existen para reducir el riesgo por etapas. En los primeros 30 dias no automatizas nada, solo descubres e instrumentas. De 30 a 60 corres un piloto guiado en un subconjunto pequeno de intents, con handoff humano siempre disponible. De 60 a 90 escalas con gobernanza: amplias intents, agregas RAG y guardrails y estableces un proceso de cambio. Cada frontera es una puerta de decision, no una fecha en el calendario.',
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
- instrumentacion   - medir contencion  - SLAs y alertas

PUERTA 1            PUERTA 2            PUERTA 3
baseline confiable  contencion con      operacion estable
+ eventos en log    CSAT mantenido      + proceso de cambio`,
        },
        {
          type: 'paragraph',
          value:
            'Las puertas importan mas que las fechas. Si al final de la fase 1 no tienes un baseline confiable, no avances: automatizar sin linea de base es automatizar a ciegas. Si al final de la fase 2 la contencion subio pero el CSAT bajo, estas empujando el problema al cliente, no resolviendolo. Tratar cada frontera como criterio de salida y no como plazo es lo que separa un rollout responsable de un piloto que se volvio produccion por inercia.',
        },
      ],
    },
    {
      title: 'El plan en una tabla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de detallar cada fase, conviene fijar el contrato de cada una: que busca, que entrega y como sabes que termino. Usa esta tabla como el resumen ejecutivo del roadmap, ese unico slide que alinea al equipo tecnico, soporte y liderazgo sobre que esperar en cada hito.',
        },
        {
          type: 'table',
          columns: ['Fase', 'Objetivo', 'Entregable', 'Metrica de salida'],
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
              'Tasa de contencion medida con CSAT mantenido o mejor',
            ],
            [
              'Fase 3 (60-90): escalar con gobernanza',
              'Ampliar cobertura sin perder control',
              'Mas intents + RAG/guardrails + proceso de cambio',
              'Operacion estable con SLAs, alertas y revision continua',
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
            'La fase 1 no entrega ningun bot, y es la mas importante. El objetivo es doble: entender que preguntan realmente los clientes y medir el estado actual en numeros, para que toda mejora futura sea comparable. Saltar esta fase es el error mas caro del roadmap, porque sin baseline nunca pruebas ROI ni detectas regresion. Sigue este orden.',
        },
        {
          type: 'ordered',
          items: [
            'Mapea los top intents: extrae 60 a 90 dias de tickets y conversaciones y agrupalos por intencion real (recuperar cuenta, estado de pedido, devoluciones, horarios, hablar con un humano). Ordena por volumen. Tipicamente 10 a 15 intents cubren el 80 por ciento del volumen, y es ahi donde la automatizacion paga.',
            'Establece el baseline de volumen: mide contactos por dia y por intent, distribucion por hora y canal, y el pico. Sin esto no dimensionas contencion ni capacidad.',
            'Establece el baseline de CSAT y calidad: registra la satisfaccion actual por intent (CSAT o un proxy como reapertura de tickets), para garantizar que la automatizacion no degrade la experiencia. Esta es la metrica de guarda que protege al cliente en las fases siguientes.',
            'Establece el baseline de tiempo: tiempo de primera respuesta, tiempo de resolucion y tiempo en cola, por intent. Se convierten en la promesa de valor (responder en segundos lo que hoy toma minutos u horas).',
            'Instrumenta los eventos antes de automatizar: define e implementa el log de eventos (mensaje recibido, intent detectado, respuesta enviada, handoff activado, ticket resuelto) con ids correlacionables. La instrumentacion precede al bot, nunca al reves.',
            'Define el golden set inicial: aparta 30 a 50 preguntas reales con la respuesta correcta revisada por un humano. Se vuelve la base de evaluacion del bot en la fase 2 y el criterio objetivo de calidad.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Al final de la fase 1 no tienes automatizacion, pero tienes algo mas valioso: un numero confiable para cada cosa que pretendes mejorar y un log que dira la verdad cuando el bot entre. Esa es la puerta 1. Si algun baseline sigue siendo una suposicion, quedate una semana mas aqui antes de avanzar.',
        },
      ],
    },
    {
      title: 'Fase 2 (30-60): piloto guiado con handoff',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Ahora entra el bot, pero con un alcance deliberadamente estrecho. La regla de la fase 2 es automatizar poco y medir mucho. Elige de 3 a 5 intents del tope que sean de alto volumen y bajo riesgo (preguntas informativas antes de acciones transaccionales), y manten el handoff humano siempre a un toque de distancia. El exito de esta fase no es "el bot funciona", es "el bot contiene parte del volumen sin empeorar el CSAT del baseline".',
        },
        {
          type: 'list',
          items: [
            'Empieza por intents de alto volumen y bajo riesgo: FAQ, horarios, politicas. Deja las acciones con efecto colateral (cancelar, reembolsar) para la fase 3, cuando ya haya guardrails.',
            'Handoff siempre disponible: el cliente puede pedir un humano en cualquier momento, y el bot escala solo cuando la confianza cae o detecta frustracion. El handoff no es una falla del bot, es la red de seguridad que hace seguro el piloto.',
            'Mide la tasa de contencion: porcentaje de conversaciones resueltas sin handoff, por intent. Es la metrica central de la fase, pero solo vale leida junto al CSAT.',
            'Vigila el CSAT como metrica de guarda: contencion subiendo con CSAT cayendo es senal de alarma, no de exito. La meta es mayor contencion con satisfaccion igual o mejor que el baseline.',
            'Evalua contra el golden set en cada cambio: corre fidelidad y relevancia de las respuestas en CI antes de que cualquier ajuste de prompt llegue a produccion.',
            'Haz un rollout sombra o por porcentaje: corre en una fraccion del trafico (por ejemplo 10 a 20 por ciento) o en modo sombra antes de abrir a todos, para limitar el radio de impacto de un error.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La puerta 2 se alcanza cuando la contencion en el subconjunto es consistente y el CSAT se mantiene o mejora frente al baseline. Solo entonces tiene sentido pensar en expandir. Si la contencion vino a costa de la satisfaccion, el problema esta en el alcance o en las respuestas, no en la ambicion: corrigelo aqui, con pocos intents, y no despues con cincuenta.',
        },
      ],
    },
    {
      title: 'Fase 3 (60-90): escalar con gobernanza',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con un piloto que comprobadamente contiene volumen sin degradar la experiencia, la fase 3 amplia cobertura, pero el foco cambia de "automatizar mas" a "automatizar sin perder control". Escalar sin gobernanza es como quitar los frenos despues de aprender a acelerar. Aqui amplias intents, agregas RAG y guardrails para sostener calidad en la escala, y formalizas el proceso de cambio.',
        },
        {
          type: 'list',
          items: [
            'Amplia intents en olas: agrega nuevos intents en lotes pequenos, cada uno pasando por el mismo rito de baseline, golden set y medicion de la fase 2. Nunca abras decenas de intents de una vez.',
            'Adopta RAG para conocimiento que crece: cuando la base de respuestas se vuelve grande y cambia, la recuperacion anclada en tu base de conocimiento sostiene la precision mejor que prompts gigantes y estaticos.',
            'Refuerza guardrails para acciones de riesgo: al automatizar intents transaccionales, exige confirmacion, limite de alcance, umbral de confianza y fallback explicito a un humano. El guardrail es lo que permite automatizar acciones sin miedo.',
            'Establece gobernanza de cambio: todo cambio de prompt, intent o base pasa por revision, evaluacion en el golden set y versionado. Un cambio en produccion es un evento auditable, no un ajuste informal en el panel.',
            'Define SLAs y alertas: formaliza el SLA de handoff y de respuesta humana, e instrumenta alertas para caidas de contencion, saltos de handoff o errores de integracion, para detectar regresion antes de que el cliente reclame.',
            'Instituye revision continua: muestrea conversaciones reales cada semana, alimenta las fallas de vuelta al golden set y reevalua. La operacion estable es un ciclo, no un estado final.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La puerta 3 no es un lanzamiento, es la transicion de proyecto a operacion: cobertura ampliada, calidad sostenida por RAG y guardrails, y un proceso que permite cambiar con seguridad cada semana. A partir de aqui el roadmap se vuelve rutina, y el trabajo deja de ser "poner el bot en linea" y pasa a ser "mantenerlo confiable mientras el negocio cambia".',
        },
      ],
    },
    {
      title: 'Trampas que hunden el rollout',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La mayoria de los roadmaps falla por las mismas tres razones, y todas son evitables si respetas el orden de las fases. Aparecen temprano y cuestan caro, porque corrompen la base sobre la que se apoya todo lo demas.',
        },
        {
          type: 'list',
          items: [
            'Automatizar todo de una vez: abrir decenas de intents en el primer mes maximiza la superficie de error e imposibilita atribuir la causa cuando algo falla. La fase 2 existe justamente para contener el radio de impacto. Empieza estrecho.',
            'Avanzar sin baseline: sin volumen, CSAT y tiempo medidos antes del bot, nunca pruebas ROI ni detectas regresion, y cualquier discusion se vuelve opinion. La fase 1 no es opcional, es lo que hace comparable todo lo demas.',
            'Operar sin handoff: un bot sin salida humana convierte cada limitacion en un cliente atrapado e irritado. El handoff siempre disponible es lo que hace seguro equivocarse y aprender en produccion. Sin el, el primer error se vuelve incidente.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que esperar 30 dias antes de encender el bot?',
      answer:
        'Porque sin baseline de volumen, CSAT y tiempo, y sin eventos instrumentados, no puedes probar que el bot mejoro nada ni detectar cuando empeora. La fase 1 convierte "creo que esta mejor" en un numero comparable. Saltarla es el error mas caro del roadmap: automatizas a ciegas y descubres los problemas por el reclamo del cliente, no por el panel.',
    },
    {
      question: 'Cual es la metrica mas importante a seguir?',
      answer:
        'La tasa de contencion (conversaciones resueltas sin handoff), pero nunca aislada. Solo vale leida junto al CSAT, la metrica de guarda. Contencion subiendo con CSAT cayendo significa empujar el problema al cliente, no resolverlo. La meta sana es mayor contencion manteniendo la satisfaccion igual o mejor que el baseline de la fase 1.',
    },
    {
      question: 'Que hago si a los 60 dias la contencion esta baja?',
      answer:
        'No avances a escalar. Contencion baja con pocos intents indica un problema de alcance o de calidad de las respuestas, y expandir solo lo multiplica. Vuelve al golden set, verifica que los intents elegidos fueran de verdad de alto volumen y bajo riesgo, y ajusta antes de abrir mas. Es mas barato corregir con cinco intents que con cincuenta.',
    },
  ],
  conclusion: {
    title: 'Del piloto a la operacion en fases, con metrica y gobernanza',
    description:
      'La automatizacion de atencion que perdura no nace de un lanzamiento unico, sino de un roadmap en fases: instrumentar antes de automatizar, pilotar un subconjunto con handoff antes de escalar y gobernar el cambio antes de abrir todo. Puedo disenar y conducir este plan de 90 dias para tu operacion, con baseline, metricas y gobernanza.',
    cta: 'Hablar sobre mi roadmap de automatizacion',
  },
  related: [
    { label: 'Chatbots e IA para atencion', to: '/servicos/chatbots-e-ia' },
    { label: 'ROI real de la automatizacion con IA', to: '/blog/roi-real-automacao-ia' },
    { label: 'SLAs de atencion entre bot y humano', to: '/blog/slas-atendimento-bot-humano' },
  ],
};

export default { pt, en, es };
