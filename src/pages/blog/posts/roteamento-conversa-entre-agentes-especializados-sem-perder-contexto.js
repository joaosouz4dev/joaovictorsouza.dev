// Conteudo do artigo: roteamento de conversa entre agentes especializados sem perder o contexto.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O cliente descreve o problema em quatro mensagens para o agente de suporte, o agente decide que aquilo é cobrança e transfere, e o agente de cobrança abre com "olá, em que posso ajudar?". Do ponto de vista do código nada falhou: a classificação estava certa, a transferência aconteceu, o segundo agente respondeu. Do ponto de vista do cliente, ele acabou de repetir tudo para a mesma empresa pela segunda vez. O erro não está no roteador, está na suposição de que trocar de agente é trocar de prompt. Quando um sistema tem agentes especializados, cada transferência é uma fronteira onde três coisas podem se perder de forma independente: o histórico literal, o estado já apurado e a autoridade sobre o que pode ser feito. Este artigo trata roteamento entre agentes como problema de transferência de estado: por que enviar a conversa inteira falha por um motivo diferente de enviar só um resumo, qual é a estrutura mínima de um pacote de transferência, como impedir que dois agentes fiquem empurrando o cliente um para o outro, e por que o roteador precisa de teste de regressão próprio, separado dos agentes que ele orquestra.',
  sections: [
    {
      title: 'Trocar de agente não é trocar de prompt',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A arquitetura mais comum de multiagente em atendimento nasce de uma simplificação razoável: como o modelo é o mesmo e a diferença entre os agentes é a instrução, roteia-se trocando o prompt do sistema e mantendo o mesmo histórico de mensagens. Funciona por algumas semanas e depois começa a produzir dois sintomas opostos. Ou o segundo agente ignora o que já foi apurado e recomeça, ou herda tanto contexto do primeiro que continua se comportando como ele, respondendo sobre cobrança com o tom e as regras do suporte técnico.',
        },
        {
          type: 'paragraph',
          value:
            'Os dois sintomas têm a mesma origem. O histórico de mensagens carrega três informações misturadas que precisariam ser tratadas separadamente na transferência. A primeira é o que o cliente disse, que é fato e quase sempre deve seguir adiante. A segunda é o que o agente anterior concluiu, que é interpretação e precisa seguir marcada como tal, com quem concluiu e com que confiança. A terceira é o que o agente anterior prometeu ou executou, que é compromisso e não pode ser silenciosamente descartado, porque o cliente já ouviu. Passar o histórico bruto entrega as três com o mesmo peso. Passar só um resumo geralmente preserva a primeira, degrada a segunda e perde a terceira, que é justamente a que gera reclamação.',
        },
        {
          type: 'table',
          columns: [
            'O que atravessa a fronteira',
            'Natureza',
            'O que acontece se some',
            'Como deve viajar',
          ],
          rows: [
            [
              'Falas do cliente',
              'Fato',
              'O cliente repete tudo e percebe a transferência',
              'Últimos turnos literais mais resumo do anterior',
            ],
            [
              'Dados já coletados',
              'Fato verificado',
              'O agente novo pede o CPF outra vez',
              'Campos tipados com origem e momento da coleta',
            ],
            [
              'Conclusões do agente anterior',
              'Interpretação',
              'Perde-se o diagnóstico e o trabalho recomeça',
              'Campo marcado como hipótese, com autor e confiança',
            ],
            [
              'Promessas feitas ao cliente',
              'Compromisso',
              'O novo agente contradiz o anterior na frente do cliente',
              'Lista explícita, sempre injetada, nunca resumida',
            ],
            [
              'Ações já executadas',
              'Efeito colateral',
              'A ação é repetida, com estorno ou pedido duplicado',
              'Registro idempotente consultável pelo agente novo',
            ],
            [
              'Autoridade e limites',
              'Permissão',
              'O agente novo herda poder que não deveria ter',
              'Derivada do agente de destino, nunca herdada',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha é a que mais surpreende quem implementa. Se a transferência copia o contexto inteiro, ela tende a copiar junto as ferramentas disponíveis e as permissões concedidas. Um agente de suporte que ganhou autorização para emitir segunda via não deveria transferir essa autorização junto com a conversa para o agente de retenção, que talvez possa conceder desconto. Autoridade é atributo do agente de destino, calculada no momento da entrada, e não algo que viaja no pacote.',
        },
      ],
    },
    {
      title: 'O pacote de transferência: estrutura mínima que funciona',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A solução prática é parar de transferir conversa e passar a transferir um objeto explícito. O pacote tem uma parte literal, uma parte estruturada e uma parte de compromissos, e cada uma tem uma regra diferente de sobrevivência. A parte literal é curta e recente. A parte estruturada é o estado que já custou perguntas ao cliente. A parte de compromissos é pequena, mas nunca pode ser comprimida.',
        },
        {
          type: 'paragraph',
          value:
            'A distinção entre fato e hipótese no pacote não é preciosismo. Sem ela, o agente de destino trata "cliente relatou cobrança em duplicidade" e "provavelmente é uma assinatura antiga não cancelada" com o mesmo grau de certeza, e passa a afirmar ao cliente algo que o agente anterior apenas suspeitou. Esse é o caminho mais curto entre uma arquitetura elegante e uma reclamação formal.',
        },
        {
          type: 'code',
          value: `// routing/handoff.js
// Pacote de transferencia entre agentes especializados.
// Regra central: fato, hipotese e compromisso viajam em campos distintos,
// e autoridade nunca viaja, e sempre derivada do agente de destino.

export function buildHandoff({ conversation, fromAgent, toAgent, reason }) {
  return {
    conversationId: conversation.id,
    from: fromAgent.id,
    to: toAgent.id,
    reason,
    hopCount: (conversation.handoff?.hopCount ?? 0) + 1,
    visited: [...(conversation.handoff?.visited ?? []), fromAgent.id],

    // Parte literal: turnos recentes preservados palavra por palavra.
    // O resto vira resumo, porque o custo cresce com a conversa inteira.
    recentTurns: conversation.turns.slice(-6).map((turn) => ({
      role: turn.role,
      text: turn.text,
      at: turn.at,
    })),
    earlierSummary: conversation.summary ?? null,

    // Parte estruturada: o que ja foi apurado e nao deve ser perguntado
    // de novo. Cada campo carrega origem, para o agente de destino saber
    // se pode afirmar ou se precisa confirmar.
    facts: conversation.facts
      .filter((fact) => fact.verified)
      .map(({ key, value, source, at }) => ({ key, value, source, at })),

    hypotheses: conversation.facts
      .filter((fact) => !fact.verified)
      .map(({ key, value, confidence, author }) => ({
        key,
        value,
        confidence,
        author,
      })),

    // Parte de compromisso: nunca resumida, nunca truncada.
    // O cliente ja ouviu isso e vai cobrar.
    commitments: conversation.commitments,
    executedActions: conversation.actions.map(({ name, idempotencyKey, at }) => ({
      name,
      idempotencyKey,
      at,
    })),
  };
}

// Autoridade e recalculada na entrada, nunca copiada do pacote.
export function grantsFor(toAgent, handoff, policy) {
  return policy.resolve({
    agent: toAgent.id,
    tier: handoff.facts.find((fact) => fact.key === 'customerTier')?.value,
  });
}`,
        },
        {
          type: 'paragraph',
          value:
            'Repare no que o pacote não tem: nenhum campo de ferramentas, nenhuma lista de permissões e nenhuma referência ao prompt do agente anterior. O que atravessa é estado da conversa, não configuração do agente. Essa separação é o que permite adicionar um quarto agente meses depois sem revisar o comportamento dos três primeiros.',
        },
      ],
    },
    {
      title: 'O laço de transferência e a garantia de terminação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo sistema com mais de dois agentes especializados acaba produzindo, mais cedo ou mais tarde, uma conversa que circula. Suporte decide que é cobrança, cobrança decide que é técnico, técnico decide que é suporte. Cada decisão isolada é defensável e nenhuma delas tem informação suficiente para perceber o ciclo, porque cada agente enxerga só o próprio turno. O laço não é bug de um agente, é propriedade emergente do conjunto, e por isso precisa ser resolvido fora deles.',
        },
        {
          type: 'paragraph',
          value:
            'A garantia mais simples e mais eficaz é fazer o pacote carregar o próprio histórico de roteamento e transformar terminação em invariante do sistema. Duas regras cobrem quase todos os casos reais: um agente já visitado não pode ser destino de novo na mesma conversa sem que algum fato novo tenha sido coletado desde a visita anterior, e existe um teto absoluto de saltos que, ao ser atingido, encaminha para humano em vez de tentar mais um agente.',
        },
        {
          type: 'diagram',
          value: `Cliente -> [Roteador] -> Suporte
                          |
          fato novo? nao  |  visitado?  sim
                          v
              Suporte -> [Roteador] -> Cobranca
                                |
                  hops = 3, teto = 3
                                v
                        [Fila humana]

Invariantes verificados no roteador, nao nos agentes:
  1. destino != agente atual
  2. destino in visited  =>  exige fato novo desde a ultima visita
  3. hopCount < maxHops  senao  destino = humano`,
        },
        {
          type: 'paragraph',
          value:
            'A condição do "fato novo" é o detalhe que separa uma trava útil de uma trava que atrapalha. Sem ela, um retorno legítimo fica bloqueado: o cliente foi ao técnico, o técnico descobriu que a assinatura está suspensa e agora precisa voltar para cobrança com uma informação que antes não existia. Com ela, esse retorno passa e o ciclo improdutivo, no qual ninguém apurou nada entre uma transferência e outra, para na segunda tentativa.',
        },
        {
          type: 'code',
          value: `// routing/router.js
// O roteador decide o destino e garante terminacao. Os agentes nao
// conhecem a topologia: eles apenas declaram que nao e com eles.

const MAX_HOPS = 3;

export function resolveTarget({ proposed, handoff, factsAtLastVisit }) {
  if (handoff.hopCount >= MAX_HOPS) {
    return { target: 'human', reason: 'hop_limit' };
  }

  if (proposed === handoff.from) {
    return { target: 'human', reason: 'self_handoff' };
  }

  const alreadyVisited = handoff.visited.includes(proposed);
  if (alreadyVisited) {
    const known = factsAtLastVisit[proposed] ?? [];
    const current = handoff.facts.map((fact) => fact.key);
    const hasNewFact = current.some((key) => !known.includes(key));

    if (!hasNewFact) {
      return { target: 'human', reason: 'loop_without_progress' };
    }
  }

  return { target: proposed, reason: 'routed' };
}`,
        },
      ],
    },
    {
      title: 'Quem decide o destino: o agente, um classificador ou o supervisor',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Há três desenhos possíveis para a decisão de roteamento, e a escolha determina o que dá para depurar quando algo dá errado. No primeiro, cada agente decide para quem transferir. No segundo, um classificador dedicado lê a conversa e escolhe. No terceiro, um agente supervisor mantém o controle e delega tarefas aos especialistas sem nunca sair da conversa.',
        },
        {
          type: 'table',
          columns: ['Desenho', 'Custo por transferência', 'Onde falha', 'Quando compensa'],
          rows: [
            [
              'Agente decide o destino',
              'Zero, cabe na mesma chamada',
              'Cada agente precisa conhecer todos os outros e a topologia envelhece',
              'Até três ou quatro especialidades estáveis',
            ],
            [
              'Classificador dedicado',
              'Uma chamada curta e barata, modelo pequeno',
              'Decide sem enxergar o que o agente apurou no turno',
              'Muitas especialidades e roteamento na entrada',
            ],
            [
              'Supervisor com delegação',
              'Alta, o contexto do supervisor cresce a cada delegação',
              'A janela do supervisor vira o gargalo de custo e latência',
              'Tarefas compostas que precisam de síntese final',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Na prática, o desenho que mais se sustenta em atendimento é híbrido e explora uma assimetria: a primeira decisão e as seguintes são problemas diferentes. A entrada da conversa é classificação pura, com pouco contexto e alto volume, e um classificador barato resolve bem. As transferências seguintes acontecem depois que um especialista já trabalhou e formou uma opinião, e nesse ponto ele é a fonte mais informada sobre o destino, desde que declare o motivo em vez de apontar o nome do próximo agente.',
        },
        {
          type: 'paragraph',
          value:
            'A distinção entre declarar motivo e apontar destino é o que mantém a topologia editável. Quando o agente devolve "assunto é cobrança de fatura recorrente", o roteador traduz isso para o agente correto usando uma tabela que uma pessoa consegue alterar sem tocar em nenhum prompt. Quando o agente devolve "transferir para agente-cobranca-v2", o nome do destino passa a viver dentro do texto de vários prompts, e renomear ou dividir um agente vira uma migração de conteúdo.',
        },
      ],
    },
    {
      title: 'O custo escondido: cada transferência reprocessa a conversa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma consequência raramente orçada é que transferir agente invalida o prefixo em cache. O agente de destino tem outro prompt de sistema, outro conjunto de ferramentas e recebe um pacote de contexto diferente, o que significa que nada do prefixo anterior é reaproveitado. Uma conversa que sofre três transferências paga o custo de entrada quatro vezes, e a quarta é a mais cara porque carrega o acumulado das anteriores.',
        },
        {
          type: 'paragraph',
          value:
            'Esse é o argumento econômico mais forte a favor do pacote estruturado sobre o histórico bruto. Passar o histórico inteiro faz o custo por transferência crescer com o tamanho da conversa, que é exatamente a variável que cresce quando o atendimento está difícil. Passar campos estruturados mais os últimos turnos faz o custo por transferência ficar aproximadamente constante, independente de a conversa ter dez ou sessenta turnos.',
        },
        {
          type: 'table',
          columns: [
            'Estratégia',
            'Tokens de entrada na terceira transferência',
            'Risco de perda',
            'Cache de prefixo',
          ],
          rows: [
            [
              'Histórico bruto completo',
              'Cresce linearmente com a conversa',
              'Baixo para fato, alto para foco do agente',
              'Invalidado a cada troca',
            ],
            [
              'Resumo livre gerado por modelo',
              'Baixo e estável',
              'Alto: compromisso e dado coletado somem no resumo',
              'Invalidado a cada troca',
            ],
            [
              'Pacote estruturado mais turnos recentes',
              'Estável, cresce só com campos apurados',
              'Baixo, se compromisso nunca for resumido',
              'Invalidado, mas com prefixo menor',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Vale registrar a métrica que expõe o problema antes da fatura: custo por conversa resolvida segmentado por número de transferências. Se a conversa de três saltos custa cinco vezes a de zero saltos e resolve na mesma proporção, o roteamento está funcionando. Se custa cinco vezes e resolve menos, cada transferência está degradando o contexto, e o número de saltos virou proxy de fracasso em vez de especialização.',
        },
      ],
    },
    {
      title: 'Testar o roteador separado dos agentes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro de avaliação mais comum nesse tipo de sistema é medir só a resposta final. Quando ela sai errada, não dá para saber se o roteador escolheu o agente errado ou se o agente certo respondeu mal, e o time acaba ajustando o prompt do especialista para compensar um problema de roteamento. Roteador e agente precisam de conjuntos de avaliação separados, porque falham por motivos diferentes e são corrigidos em lugares diferentes.',
        },
        {
          type: 'paragraph',
          value:
            'O conjunto do roteador é barato de montar e de rodar: entrada de conversa e destino esperado, sem executar nenhum agente. O ponto delicado é como rotular. Rotular pelo destino que o sistema escolheu na produção só congela o comportamento atual, inclusive os erros. O rótulo útil vem do desfecho: conversas que foram resolvidas sem nova transferência confirmam o destino, e conversas que sofreram transferência logo em seguida são candidatas a rótulo corrigido, com o segundo destino como resposta certa.',
        },
        {
          type: 'code',
          value: `// routing/eval-router.js
// Avalia so a decisao de roteamento, sem executar os agentes.
// Metrica principal: acerto no primeiro destino. Metrica de guarda:
// taxa de transferencia imediata, que revela roteamento ruim mesmo
// quando a resposta final acabou saindo aceitavel.

export async function evaluateRouter(cases, route) {
  const result = { total: cases.length, correct: 0, byIntent: {} };

  for (const testCase of cases) {
    const decision = await route(testCase.conversation);
    const hit = decision.target === testCase.expectedTarget;

    const bucket = (result.byIntent[testCase.intent] ??= { total: 0, correct: 0 });
    bucket.total += 1;
    if (hit) {
      bucket.correct += 1;
      result.correct += 1;
    }
  }

  result.accuracy = result.correct / result.total;

  // Acerto agregado esconde especialidade rara com desempenho ruim,
  // e especialidade rara costuma ser a de maior impacto por conversa.
  result.worstIntent = Object.entries(result.byIntent)
    .map(([intent, bucket]) => ({ intent, accuracy: bucket.correct / bucket.total }))
    .sort((a, b) => a.accuracy - b.accuracy)[0];

  return result;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Há ainda um teste que não é de acerto e sim de integridade do pacote, e que costuma pegar mais defeito que o eval de destino. Ele pega conversas reais, monta o pacote de transferência e verifica se todo dado que o cliente forneceu antes da fronteira continua recuperável depois dela. É um teste determinístico, roda sem chamar o modelo e falha exatamente no caso que gera a pior experiência: o cliente que informa o número do pedido no terceiro turno e ouve o pedido de novo no sétimo.',
        },
        {
          type: 'ordered',
          items: [
            'Rode o eval de roteamento em todo merge que toque a tabela de motivos, o classificador ou a descrição das especialidades.',
            'Rode o teste de integridade do pacote em todo merge que toque a construção do handoff ou o esquema de fatos.',
            'Rode o eval dos agentes especialistas com o pacote de entrada fixado, para separar regressão do agente de regressão do roteador.',
            'Monitore em produção a taxa de transferência imediata e o número médio de saltos por conversa resolvida.',
            'Reveja o teto de saltos quando a fila humana receber muito encaminhamento por limite, porque isso indica topologia mal desenhada e não cliente difícil.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Vale a pena ter agentes especializados ou é melhor um agente único com todas as ferramentas?',
      answer:
        'Depende de quantas ferramentas e de quanta regra conflitante existe. Até algo em torno de dez ou quinze ferramentas com políticas compatíveis, um agente único costuma vencer, porque elimina a fronteira de transferência e todo o custo associado. A especialização compensa quando as políticas conflitam de fato, por exemplo quando um domínio exige confirmação explícita antes de qualquer ação e outro exige agilidade sem confirmação, ou quando a autoridade precisa ser diferente por domínio. Nesse caso, o agente único tende a produzir um prompt cheio de exceções que degrada em todos os cenários ao mesmo tempo.',
    },
    {
      question: 'Como saber se uma transferência foi boa ou ruim depois que aconteceu?',
      answer:
        'Um sinal simples e forte é a transferência imediata: se o agente de destino transfere de novo nos dois primeiros turnos, o roteamento anterior provavelmente errou. Um segundo sinal é a repetição de pergunta, detectável comparando os campos coletados antes e depois da fronteira, que aponta perda de contexto em vez de erro de destino. O terceiro é a resolução por número de saltos, que precisa cair pouco a cada salto. Se ela despenca do primeiro para o segundo salto, o problema está no pacote e não na escolha do agente.',
    },
    {
      question: 'O pacote de transferência deve incluir o resumo gerado por modelo ou só campos estruturados?',
      answer:
        'Os dois, com papéis diferentes. Os campos estruturados carregam o que não pode se perder: dados coletados, compromissos assumidos e ações já executadas, e eles nunca devem passar por sumarização. O resumo cobre a parte narrativa antiga da conversa, que dá contexto de tom e histórico sem precisar de fidelidade literal. A regra prática é que nenhum dado que o cliente forneceu deve existir apenas dentro do resumo, porque sumarização é lossy por definição e a perda cai justamente sobre detalhe específico, que é o formato de quase todo dado útil.',
    },
  ],
  conclusion: {
    title: 'A fronteira entre agentes é infraestrutura, não detalhe de prompt',
    description:
      'Roteamento entre agentes especializados falha em um lugar bem definido: na fronteira em que o estado da conversa precisa atravessar de um agente para outro. Separar fato de hipótese e de compromisso dentro de um pacote explícito, recalcular autoridade no destino em vez de herdá-la, garantir terminação no roteador com teto de saltos e exigência de fato novo, deixar o agente declarar motivo em vez de apontar destino, e avaliar roteador e especialistas em conjuntos separados transforma um sistema que empurra o cliente entre filas num sistema que realmente especializa. Posso mapear as fronteiras do seu fluxo atual, definir o pacote de transferência a partir do que os seus agentes já coletam e montar o eval de roteamento com o rótulo derivado do desfecho real das conversas.',
    cta: 'Falar sobre o roteamento dos meus agentes',
  },
  related: [
    {
      label: 'Orquestração de agentes de IA em produção',
      to: '/blog/orquestracao-agentes-ia-producao',
    },
    {
      label: 'Janela de contexto compartilhada entre canais',
      to: '/blog/janela-contexto-compartilhada-entre-canais-whatsapp-web-telefone',
    },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

const en = {
  intro:
    'The customer describes the problem across four messages to the support agent, the agent decides it is a billing matter and transfers, and the billing agent opens with "hello, how can I help you?". From the code\'s point of view nothing failed: the classification was right, the handoff happened, the second agent answered. From the customer\'s point of view, they just repeated everything to the same company for the second time. The mistake is not in the router, it is in the assumption that switching agents means switching prompts. When a system has specialized agents, every handoff is a boundary where three things can be lost independently: the literal history, the state already established and the authority over what may be done. This article treats agent routing as a state transfer problem: why sending the whole conversation fails for a different reason than sending only a summary, what the minimum structure of a handoff package is, how to stop two agents from bouncing the customer back and forth, and why the router needs its own regression tests, separate from the agents it orchestrates.',
  sections: [
    {
      title: 'Switching agents is not switching prompts',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common multi-agent support architecture is born from a reasonable simplification: since the model is the same and the difference between agents is the instruction, you route by swapping the system prompt and keeping the same message history. It works for a few weeks and then starts producing two opposite symptoms. Either the second agent ignores what was already established and starts over, or it inherits so much context from the first that it keeps behaving like it, answering billing questions with the tone and rules of technical support.',
        },
        {
          type: 'paragraph',
          value:
            'Both symptoms share an origin. The message history carries three kinds of information mixed together that would need separate handling at handoff time. The first is what the customer said, which is fact and should almost always travel forward. The second is what the previous agent concluded, which is interpretation and must travel labeled as such, with the author and a confidence level. The third is what the previous agent promised or executed, which is commitment and cannot be silently dropped, because the customer already heard it. Passing the raw history delivers all three with equal weight. Passing only a summary usually preserves the first, degrades the second and loses the third, which is precisely the one that generates complaints.',
        },
        {
          type: 'table',
          columns: [
            'What crosses the boundary',
            'Nature',
            'What happens if it disappears',
            'How it should travel',
          ],
          rows: [
            [
              'Customer utterances',
              'Fact',
              'The customer repeats everything and notices the handoff',
              'Last turns verbatim plus a summary of the rest',
            ],
            [
              'Data already collected',
              'Verified fact',
              'The new agent asks for the account number again',
              'Typed fields with source and collection time',
            ],
            [
              'Previous agent conclusions',
              'Interpretation',
              'The diagnosis is lost and the work restarts',
              'Field marked as hypothesis, with author and confidence',
            ],
            [
              'Promises made to the customer',
              'Commitment',
              'The new agent contradicts the previous one in front of the customer',
              'Explicit list, always injected, never summarized',
            ],
            [
              'Actions already executed',
              'Side effect',
              'The action is repeated, with a refund or duplicate order',
              'Idempotent record the new agent can query',
            ],
            [
              'Authority and limits',
              'Permission',
              'The new agent inherits power it should not have',
              'Derived from the destination agent, never inherited',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row is the one that most surprises implementers. If the handoff copies the whole context, it tends to copy along the available tools and the granted permissions. A support agent that was authorized to reissue an invoice should not transfer that authorization together with the conversation to the retention agent, which may be able to grant discounts. Authority is an attribute of the destination agent, computed at entry time, not something that travels in the package.',
        },
      ],
    },
    {
      title: 'The handoff package: a minimum structure that works',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The practical solution is to stop transferring a conversation and start transferring an explicit object. The package has a literal part, a structured part and a commitments part, and each has a different survival rule. The literal part is short and recent. The structured part is the state that already cost the customer questions. The commitments part is small, but it can never be compressed.',
        },
        {
          type: 'paragraph',
          value:
            'The distinction between fact and hypothesis inside the package is not fussiness. Without it, the destination agent treats "customer reported a duplicate charge" and "probably an old subscription that was never cancelled" with the same degree of certainty, and starts asserting to the customer something the previous agent merely suspected. That is the shortest path from an elegant architecture to a formal complaint.',
        },
        {
          type: 'code',
          value: `// routing/handoff.js
// Handoff package between specialized agents.
// Core rule: fact, hypothesis and commitment travel in distinct fields,
// and authority never travels, it is always derived at the destination.

export function buildHandoff({ conversation, fromAgent, toAgent, reason }) {
  return {
    conversationId: conversation.id,
    from: fromAgent.id,
    to: toAgent.id,
    reason,
    hopCount: (conversation.handoff?.hopCount ?? 0) + 1,
    visited: [...(conversation.handoff?.visited ?? []), fromAgent.id],

    // Literal part: recent turns preserved word for word.
    // The rest becomes a summary, because cost grows with the
    // whole conversation otherwise.
    recentTurns: conversation.turns.slice(-6).map((turn) => ({
      role: turn.role,
      text: turn.text,
      at: turn.at,
    })),
    earlierSummary: conversation.summary ?? null,

    // Structured part: what has been established and must not be asked
    // again. Every field carries its source so the destination agent
    // knows whether it can assert or has to confirm.
    facts: conversation.facts
      .filter((fact) => fact.verified)
      .map(({ key, value, source, at }) => ({ key, value, source, at })),

    hypotheses: conversation.facts
      .filter((fact) => !fact.verified)
      .map(({ key, value, confidence, author }) => ({
        key,
        value,
        confidence,
        author,
      })),

    // Commitment part: never summarized, never truncated.
    // The customer already heard this and will hold you to it.
    commitments: conversation.commitments,
    executedActions: conversation.actions.map(({ name, idempotencyKey, at }) => ({
      name,
      idempotencyKey,
      at,
    })),
  };
}

// Authority is recomputed at entry, never copied from the package.
export function grantsFor(toAgent, handoff, policy) {
  return policy.resolve({
    agent: toAgent.id,
    tier: handoff.facts.find((fact) => fact.key === 'customerTier')?.value,
  });
}`,
        },
        {
          type: 'paragraph',
          value:
            'Notice what the package does not have: no tools field, no permission list and no reference to the previous agent\'s prompt. What crosses the boundary is conversation state, not agent configuration. That separation is what lets you add a fourth agent months later without revisiting the behavior of the first three.',
        },
      ],
    },
    {
      title: 'The handoff loop and the termination guarantee',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Every system with more than two specialized agents eventually produces a conversation that goes in circles. Support decides it is billing, billing decides it is technical, technical decides it is support. Each decision in isolation is defensible and none of them has enough information to notice the cycle, because each agent only sees its own turn. The loop is not a bug in one agent, it is an emergent property of the set, which is why it has to be solved outside them.',
        },
        {
          type: 'paragraph',
          value:
            'The simplest and most effective guarantee is to make the package carry its own routing history and turn termination into a system invariant. Two rules cover almost every real case: an already visited agent cannot be a destination again in the same conversation unless some new fact has been collected since the previous visit, and there is an absolute hop ceiling that, once reached, routes to a human instead of trying one more agent.',
        },
        {
          type: 'diagram',
          value: `Customer -> [Router] -> Support
                         |
        new fact? no     |   visited? yes
                         v
             Support -> [Router] -> Billing
                               |
                 hops = 3, ceiling = 3
                               v
                       [Human queue]

Invariants checked in the router, not in the agents:
  1. target != current agent
  2. target in visited  =>  requires a new fact since last visit
  3. hopCount < maxHops  else  target = human`,
        },
        {
          type: 'paragraph',
          value:
            'The "new fact" condition is the detail that separates a useful guard from one that gets in the way. Without it, a legitimate return is blocked: the customer went to technical, technical found out the subscription is suspended, and now needs to go back to billing with information that did not exist before. With it, that return passes and the unproductive cycle, in which nobody established anything between one handoff and the next, stops on the second attempt.',
        },
        {
          type: 'code',
          value: `// routing/router.js
// The router picks the destination and guarantees termination. Agents do
// not know the topology: they merely declare that it is not their case.

const MAX_HOPS = 3;

export function resolveTarget({ proposed, handoff, factsAtLastVisit }) {
  if (handoff.hopCount >= MAX_HOPS) {
    return { target: 'human', reason: 'hop_limit' };
  }

  if (proposed === handoff.from) {
    return { target: 'human', reason: 'self_handoff' };
  }

  const alreadyVisited = handoff.visited.includes(proposed);
  if (alreadyVisited) {
    const known = factsAtLastVisit[proposed] ?? [];
    const current = handoff.facts.map((fact) => fact.key);
    const hasNewFact = current.some((key) => !known.includes(key));

    if (!hasNewFact) {
      return { target: 'human', reason: 'loop_without_progress' };
    }
  }

  return { target: proposed, reason: 'routed' };
}`,
        },
      ],
    },
    {
      title: 'Who picks the destination: the agent, a classifier or a supervisor',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There are three possible designs for the routing decision, and the choice determines what you can debug when something goes wrong. In the first, each agent decides where to transfer. In the second, a dedicated classifier reads the conversation and chooses. In the third, a supervisor agent keeps control and delegates tasks to specialists without ever leaving the conversation.',
        },
        {
          type: 'table',
          columns: ['Design', 'Cost per handoff', 'Where it fails', 'When it pays off'],
          rows: [
            [
              'Agent picks the destination',
              'Zero, it fits in the same call',
              'Every agent must know all the others and the topology ages',
              'Up to three or four stable specialties',
            ],
            [
              'Dedicated classifier',
              'One short cheap call on a small model',
              'Decides without seeing what the agent established this turn',
              'Many specialties and entry-point routing',
            ],
            [
              'Supervisor with delegation',
              'High, the supervisor context grows per delegation',
              'The supervisor window becomes the cost and latency bottleneck',
              'Composite tasks that need a final synthesis',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'In practice, the design that holds up best in support is hybrid and exploits an asymmetry: the first decision and the following ones are different problems. Conversation entry is pure classification, with little context and high volume, and a cheap classifier handles it well. Later handoffs happen after a specialist has already worked and formed an opinion, and at that point it is the best informed source about the destination, provided it declares the reason instead of naming the next agent.',
        },
        {
          type: 'paragraph',
          value:
            'The distinction between declaring a reason and naming a destination is what keeps the topology editable. When the agent returns "subject is recurring invoice billing", the router translates that into the correct agent using a table a person can change without touching any prompt. When the agent returns "transfer to billing-agent-v2", the destination name starts living inside the text of several prompts, and renaming or splitting an agent becomes a content migration.',
        },
      ],
    },
    {
      title: 'The hidden cost: every handoff reprocesses the conversation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A rarely budgeted consequence is that switching agents invalidates the cached prefix. The destination agent has a different system prompt, a different tool set and receives a different context package, which means none of the previous prefix is reused. A conversation with three handoffs pays the entry cost four times, and the fourth is the most expensive because it carries everything accumulated before it.',
        },
        {
          type: 'paragraph',
          value:
            'This is the strongest economic argument for the structured package over the raw history. Passing the entire history makes the per-handoff cost grow with conversation length, which is exactly the variable that grows when support is going badly. Passing structured fields plus the last few turns keeps the per-handoff cost roughly constant, whether the conversation has ten or sixty turns.',
        },
        {
          type: 'table',
          columns: [
            'Strategy',
            'Input tokens at the third handoff',
            'Loss risk',
            'Prefix cache',
          ],
          rows: [
            [
              'Full raw history',
              'Grows linearly with the conversation',
              'Low for facts, high for agent focus',
              'Invalidated on every switch',
            ],
            [
              'Free-form model-generated summary',
              'Low and stable',
              'High: commitments and collected data vanish in the summary',
              'Invalidated on every switch',
            ],
            [
              'Structured package plus recent turns',
              'Stable, grows only with established fields',
              'Low, as long as commitments are never summarized',
              'Invalidated, but with a smaller prefix',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'It is worth recording the metric that exposes the problem before the invoice does: cost per resolved conversation segmented by number of handoffs. If a three-hop conversation costs five times a zero-hop one and resolves in the same proportion, routing is working. If it costs five times and resolves less, every handoff is degrading context, and hop count has become a proxy for failure instead of specialization.',
        },
      ],
    },
    {
      title: 'Testing the router separately from the agents',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common evaluation mistake in this kind of system is measuring only the final answer. When it comes out wrong, there is no way to tell whether the router picked the wrong agent or the right agent answered badly, and the team ends up tuning the specialist prompt to compensate for a routing problem. Router and agent need separate evaluation sets, because they fail for different reasons and are fixed in different places.',
        },
        {
          type: 'paragraph',
          value:
            'The router set is cheap to build and cheap to run: conversation input and expected destination, without executing any agent. The delicate part is labeling. Labeling by the destination the system chose in production merely freezes current behavior, errors included. The useful label comes from the outcome: conversations resolved without another handoff confirm the destination, and conversations that were handed off right afterwards are candidates for a corrected label, with the second destination as the right answer.',
        },
        {
          type: 'code',
          value: `// routing/eval-router.js
// Evaluates only the routing decision, without executing the agents.
// Primary metric: first destination accuracy. Guard metric: immediate
// handoff rate, which reveals bad routing even when the final answer
// happened to come out acceptable.

export async function evaluateRouter(cases, route) {
  const result = { total: cases.length, correct: 0, byIntent: {} };

  for (const testCase of cases) {
    const decision = await route(testCase.conversation);
    const hit = decision.target === testCase.expectedTarget;

    const bucket = (result.byIntent[testCase.intent] ??= { total: 0, correct: 0 });
    bucket.total += 1;
    if (hit) {
      bucket.correct += 1;
      result.correct += 1;
    }
  }

  result.accuracy = result.correct / result.total;

  // Aggregate accuracy hides a rare specialty performing badly, and a
  // rare specialty is usually the one with the highest impact per case.
  result.worstIntent = Object.entries(result.byIntent)
    .map(([intent, bucket]) => ({ intent, accuracy: bucket.correct / bucket.total }))
    .sort((a, b) => a.accuracy - b.accuracy)[0];

  return result;
}`,
        },
        {
          type: 'paragraph',
          value:
            'There is one more test that is not about accuracy but about package integrity, and it usually catches more defects than the destination eval. It takes real conversations, builds the handoff package and checks whether every piece of data the customer provided before the boundary is still retrievable after it. It is deterministic, runs without calling the model, and fails exactly on the case that produces the worst experience: the customer who gives the order number on turn three and is asked for it again on turn seven.',
        },
        {
          type: 'ordered',
          items: [
            'Run the routing eval on every merge that touches the reason table, the classifier or the specialty descriptions.',
            'Run the package integrity test on every merge that touches handoff construction or the facts schema.',
            'Run the specialist agent evals with the input package pinned, to separate agent regression from router regression.',
            'Monitor immediate handoff rate and average hop count per resolved conversation in production.',
            'Revisit the hop ceiling when the human queue receives many limit-triggered escalations, because that points at bad topology rather than difficult customers.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Are specialized agents worth it, or is a single agent with all the tools better?',
      answer:
        'It depends on how many tools there are and how much conflicting policy exists. Up to somewhere around ten or fifteen tools with compatible policies, a single agent usually wins, because it removes the handoff boundary and all its associated cost. Specialization pays off when the policies genuinely conflict, for example when one domain requires explicit confirmation before any action and another requires speed with no confirmation, or when authority has to differ per domain. In that case a single agent tends to produce a prompt full of exceptions that degrades across every scenario at once.',
    },
    {
      question: 'How do you tell whether a handoff was good or bad after it happened?',
      answer:
        'One simple and strong signal is the immediate handoff: if the destination agent transfers again within the first two turns, the previous routing decision was probably wrong. A second signal is repeated questions, detectable by comparing the fields collected before and after the boundary, which points at context loss rather than a wrong destination. The third is resolution rate by hop count, which should drop only slightly per hop. If it collapses between the first and second hop, the problem is in the package, not in the agent choice.',
    },
    {
      question: 'Should the handoff package include a model-generated summary or only structured fields?',
      answer:
        'Both, with different roles. The structured fields carry what cannot be lost: collected data, commitments made and actions already executed, and they should never go through summarization. The summary covers the older narrative part of the conversation, which provides tone and background without needing literal fidelity. The practical rule is that no data the customer provided should live only inside the summary, because summarization is lossy by definition and the loss falls precisely on specific detail, which is the shape of nearly every useful piece of data.',
    },
  ],
  conclusion: {
    title: 'The boundary between agents is infrastructure, not a prompt detail',
    description:
      'Routing between specialized agents fails in a well defined place: at the boundary where conversation state has to cross from one agent to another. Separating fact from hypothesis and from commitment inside an explicit package, recomputing authority at the destination instead of inheriting it, guaranteeing termination in the router with a hop ceiling and a new-fact requirement, letting the agent declare a reason instead of naming a destination, and evaluating router and specialists on separate sets turns a system that bounces customers between queues into one that genuinely specializes. I can map the boundaries in your current flow, define the handoff package from what your agents already collect and build the routing eval with labels derived from the real outcome of conversations.',
    cta: 'Talk about routing across my agents',
  },
  related: [
    {
      label: 'Orchestrating AI agents in production',
      to: '/blog/orquestracao-agentes-ia-producao',
    },
    {
      label: 'Shared context window across channels',
      to: '/blog/janela-contexto-compartilhada-entre-canais-whatsapp-web-telefone',
    },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
};

const es = {
  intro:
    'El cliente describe el problema en cuatro mensajes al agente de soporte, el agente decide que es un asunto de facturación y transfiere, y el agente de facturación abre con "hola, ¿en qué puedo ayudarte?". Desde el punto de vista del código nada falló: la clasificación era correcta, la transferencia ocurrió, el segundo agente respondió. Desde el punto de vista del cliente, acaba de repetir todo a la misma empresa por segunda vez. El error no está en el enrutador, está en suponer que cambiar de agente es cambiar de prompt. Cuando un sistema tiene agentes especializados, cada transferencia es una frontera donde tres cosas pueden perderse de forma independiente: el historial literal, el estado ya establecido y la autoridad sobre lo que se puede hacer. Este artículo trata el enrutamiento entre agentes como un problema de transferencia de estado: por qué enviar la conversación entera falla por un motivo distinto que enviar solo un resumen, cuál es la estructura mínima de un paquete de transferencia, cómo impedir que dos agentes se pasen el cliente uno al otro, y por qué el enrutador necesita sus propias pruebas de regresión, separadas de los agentes que orquesta.',
  sections: [
    {
      title: 'Cambiar de agente no es cambiar de prompt',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La arquitectura multiagente más común en atención nace de una simplificación razonable: como el modelo es el mismo y la diferencia entre los agentes es la instrucción, se enruta cambiando el prompt de sistema y manteniendo el mismo historial de mensajes. Funciona unas semanas y después empieza a producir dos síntomas opuestos. O el segundo agente ignora lo ya establecido y vuelve a empezar, o hereda tanto contexto del primero que sigue comportándose como él, respondiendo sobre facturación con el tono y las reglas del soporte técnico.',
        },
        {
          type: 'paragraph',
          value:
            'Los dos síntomas tienen el mismo origen. El historial de mensajes lleva mezcladas tres informaciones que necesitarían tratamiento separado en la transferencia. La primera es lo que dijo el cliente, que es hecho y casi siempre debe seguir adelante. La segunda es lo que concluyó el agente anterior, que es interpretación y debe viajar marcada como tal, con autor y nivel de confianza. La tercera es lo que el agente anterior prometió o ejecutó, que es compromiso y no puede descartarse en silencio, porque el cliente ya lo escuchó. Pasar el historial en bruto entrega las tres con el mismo peso. Pasar solo un resumen normalmente preserva la primera, degrada la segunda y pierde la tercera, que es justamente la que genera reclamos.',
        },
        {
          type: 'table',
          columns: [
            'Lo que cruza la frontera',
            'Naturaleza',
            'Qué pasa si desaparece',
            'Cómo debe viajar',
          ],
          rows: [
            [
              'Lo que dijo el cliente',
              'Hecho',
              'El cliente repite todo y percibe la transferencia',
              'Últimos turnos literales más resumen del resto',
            ],
            [
              'Datos ya recolectados',
              'Hecho verificado',
              'El agente nuevo pide el número de cuenta otra vez',
              'Campos tipados con origen y momento de recolección',
            ],
            [
              'Conclusiones del agente anterior',
              'Interpretación',
              'Se pierde el diagnóstico y el trabajo vuelve a empezar',
              'Campo marcado como hipótesis, con autor y confianza',
            ],
            [
              'Promesas hechas al cliente',
              'Compromiso',
              'El agente nuevo contradice al anterior frente al cliente',
              'Lista explícita, siempre inyectada, nunca resumida',
            ],
            [
              'Acciones ya ejecutadas',
              'Efecto colateral',
              'La acción se repite, con reembolso o pedido duplicado',
              'Registro idempotente consultable por el agente nuevo',
            ],
            [
              'Autoridad y límites',
              'Permiso',
              'El agente nuevo hereda poder que no debería tener',
              'Derivada del agente de destino, nunca heredada',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila es la que más sorprende a quien implementa. Si la transferencia copia todo el contexto, tiende a copiar también las herramientas disponibles y los permisos concedidos. Un agente de soporte que recibió autorización para emitir una segunda factura no debería transferir esa autorización junto con la conversación al agente de retención, que quizá pueda conceder descuentos. La autoridad es un atributo del agente de destino, calculada al momento de la entrada, no algo que viaja en el paquete.',
        },
      ],
    },
    {
      title: 'El paquete de transferencia: estructura mínima que funciona',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La solución práctica es dejar de transferir una conversación y pasar a transferir un objeto explícito. El paquete tiene una parte literal, una parte estructurada y una parte de compromisos, y cada una tiene una regla distinta de supervivencia. La parte literal es corta y reciente. La parte estructurada es el estado que ya le costó preguntas al cliente. La parte de compromisos es pequeña, pero nunca puede comprimirse.',
        },
        {
          type: 'paragraph',
          value:
            'La distinción entre hecho e hipótesis dentro del paquete no es preciosismo. Sin ella, el agente de destino trata "el cliente reportó un cobro duplicado" y "probablemente sea una suscripción vieja nunca cancelada" con el mismo grado de certeza, y pasa a afirmarle al cliente algo que el agente anterior solo sospechaba. Ese es el camino más corto entre una arquitectura elegante y un reclamo formal.',
        },
        {
          type: 'code',
          value: `// routing/handoff.js
// Paquete de transferencia entre agentes especializados.
// Regla central: hecho, hipotesis y compromiso viajan en campos distintos,
// y la autoridad nunca viaja, siempre se deriva en el destino.

export function buildHandoff({ conversation, fromAgent, toAgent, reason }) {
  return {
    conversationId: conversation.id,
    from: fromAgent.id,
    to: toAgent.id,
    reason,
    hopCount: (conversation.handoff?.hopCount ?? 0) + 1,
    visited: [...(conversation.handoff?.visited ?? []), fromAgent.id],

    // Parte literal: turnos recientes preservados palabra por palabra.
    // El resto se convierte en resumen, porque si no el costo crece con
    // la conversacion entera.
    recentTurns: conversation.turns.slice(-6).map((turn) => ({
      role: turn.role,
      text: turn.text,
      at: turn.at,
    })),
    earlierSummary: conversation.summary ?? null,

    // Parte estructurada: lo ya establecido y que no debe preguntarse de
    // nuevo. Cada campo lleva su origen, para que el agente de destino
    // sepa si puede afirmar o si tiene que confirmar.
    facts: conversation.facts
      .filter((fact) => fact.verified)
      .map(({ key, value, source, at }) => ({ key, value, source, at })),

    hypotheses: conversation.facts
      .filter((fact) => !fact.verified)
      .map(({ key, value, confidence, author }) => ({
        key,
        value,
        confidence,
        author,
      })),

    // Parte de compromiso: nunca resumida, nunca truncada.
    // El cliente ya lo escucho y lo va a reclamar.
    commitments: conversation.commitments,
    executedActions: conversation.actions.map(({ name, idempotencyKey, at }) => ({
      name,
      idempotencyKey,
      at,
    })),
  };
}

// La autoridad se recalcula en la entrada, nunca se copia del paquete.
export function grantsFor(toAgent, handoff, policy) {
  return policy.resolve({
    agent: toAgent.id,
    tier: handoff.facts.find((fact) => fact.key === 'customerTier')?.value,
  });
}`,
        },
        {
          type: 'paragraph',
          value:
            'Nótese lo que el paquete no tiene: ningún campo de herramientas, ninguna lista de permisos y ninguna referencia al prompt del agente anterior. Lo que cruza es estado de la conversación, no configuración del agente. Esa separación es la que permite agregar un cuarto agente meses después sin revisar el comportamiento de los tres primeros.',
        },
      ],
    },
    {
      title: 'El bucle de transferencias y la garantía de terminación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo sistema con más de dos agentes especializados acaba produciendo, tarde o temprano, una conversación que da vueltas. Soporte decide que es facturación, facturación decide que es técnico, técnico decide que es soporte. Cada decisión aislada es defendible y ninguna tiene información suficiente para percibir el ciclo, porque cada agente ve solo su propio turno. El bucle no es un defecto de un agente, es una propiedad emergente del conjunto, y por eso hay que resolverlo fuera de ellos.',
        },
        {
          type: 'paragraph',
          value:
            'La garantía más simple y más eficaz es hacer que el paquete lleve su propio historial de enrutamiento y convertir la terminación en un invariante del sistema. Dos reglas cubren casi todos los casos reales: un agente ya visitado no puede volver a ser destino en la misma conversación sin que se haya recolectado algún hecho nuevo desde la visita anterior, y existe un techo absoluto de saltos que, al alcanzarse, deriva a un humano en vez de intentar con otro agente.',
        },
        {
          type: 'diagram',
          value: `Cliente -> [Enrutador] -> Soporte
                           |
        hecho nuevo? no    |   visitado? si
                           v
              Soporte -> [Enrutador] -> Facturacion
                                 |
                    saltos = 3, techo = 3
                                 v
                          [Fila humana]

Invariantes verificados en el enrutador, no en los agentes:
  1. destino != agente actual
  2. destino in visited  =>  exige hecho nuevo desde la ultima visita
  3. hopCount < maxHops  si no  destino = humano`,
        },
        {
          type: 'paragraph',
          value:
            'La condición del "hecho nuevo" es el detalle que separa un freno útil de uno que estorba. Sin ella, un retorno legítimo queda bloqueado: el cliente fue al área técnica, técnica descubrió que la suscripción está suspendida y ahora necesita volver a facturación con una información que antes no existía. Con ella, ese retorno pasa y el ciclo improductivo, en el que nadie estableció nada entre una transferencia y otra, se detiene en el segundo intento.',
        },
        {
          type: 'code',
          value: `// routing/router.js
// El enrutador decide el destino y garantiza la terminacion. Los agentes
// no conocen la topologia: solo declaran que no es su caso.

const MAX_HOPS = 3;

export function resolveTarget({ proposed, handoff, factsAtLastVisit }) {
  if (handoff.hopCount >= MAX_HOPS) {
    return { target: 'human', reason: 'hop_limit' };
  }

  if (proposed === handoff.from) {
    return { target: 'human', reason: 'self_handoff' };
  }

  const alreadyVisited = handoff.visited.includes(proposed);
  if (alreadyVisited) {
    const known = factsAtLastVisit[proposed] ?? [];
    const current = handoff.facts.map((fact) => fact.key);
    const hasNewFact = current.some((key) => !known.includes(key));

    if (!hasNewFact) {
      return { target: 'human', reason: 'loop_without_progress' };
    }
  }

  return { target: proposed, reason: 'routed' };
}`,
        },
      ],
    },
    {
      title: 'Quién decide el destino: el agente, un clasificador o el supervisor',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Hay tres diseños posibles para la decisión de enrutamiento, y la elección determina qué se puede depurar cuando algo sale mal. En el primero, cada agente decide a quién transferir. En el segundo, un clasificador dedicado lee la conversación y elige. En el tercero, un agente supervisor mantiene el control y delega tareas a los especialistas sin salir nunca de la conversación.',
        },
        {
          type: 'table',
          columns: ['Diseño', 'Costo por transferencia', 'Dónde falla', 'Cuándo compensa'],
          rows: [
            [
              'El agente decide el destino',
              'Cero, cabe en la misma llamada',
              'Cada agente debe conocer a todos los demás y la topología envejece',
              'Hasta tres o cuatro especialidades estables',
            ],
            [
              'Clasificador dedicado',
              'Una llamada corta y barata, con modelo pequeño',
              'Decide sin ver lo que el agente estableció en el turno',
              'Muchas especialidades y enrutamiento en la entrada',
            ],
            [
              'Supervisor con delegación',
              'Alto, el contexto del supervisor crece con cada delegación',
              'La ventana del supervisor se vuelve el cuello de botella de costo y latencia',
              'Tareas compuestas que necesitan una síntesis final',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'En la práctica, el diseño que mejor se sostiene en atención es híbrido y explota una asimetría: la primera decisión y las siguientes son problemas distintos. La entrada de la conversación es clasificación pura, con poco contexto y alto volumen, y un clasificador barato la resuelve bien. Las transferencias posteriores ocurren después de que un especialista ya trabajó y formó una opinión, y en ese punto él es la fuente mejor informada sobre el destino, siempre que declare el motivo en lugar de nombrar al próximo agente.',
        },
        {
          type: 'paragraph',
          value:
            'La distinción entre declarar motivo y nombrar destino es la que mantiene editable la topología. Cuando el agente devuelve "el asunto es facturación de factura recurrente", el enrutador lo traduce al agente correcto con una tabla que una persona puede cambiar sin tocar ningún prompt. Cuando el agente devuelve "transferir al agente-facturacion-v2", el nombre del destino pasa a vivir dentro del texto de varios prompts, y renombrar o dividir un agente se vuelve una migración de contenido.',
        },
      ],
    },
    {
      title: 'El costo escondido: cada transferencia reprocesa la conversación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una consecuencia rara vez presupuestada es que cambiar de agente invalida el prefijo en caché. El agente de destino tiene otro prompt de sistema, otro conjunto de herramientas y recibe un paquete de contexto distinto, lo que significa que nada del prefijo anterior se reaprovecha. Una conversación con tres transferencias paga el costo de entrada cuatro veces, y la cuarta es la más cara porque carga todo lo acumulado antes.',
        },
        {
          type: 'paragraph',
          value:
            'Este es el argumento económico más fuerte a favor del paquete estructurado frente al historial en bruto. Pasar el historial entero hace que el costo por transferencia crezca con el tamaño de la conversación, que es exactamente la variable que crece cuando la atención va mal. Pasar campos estructurados más los últimos turnos mantiene el costo por transferencia aproximadamente constante, tenga la conversación diez o sesenta turnos.',
        },
        {
          type: 'table',
          columns: [
            'Estrategia',
            'Tokens de entrada en la tercera transferencia',
            'Riesgo de pérdida',
            'Caché de prefijo',
          ],
          rows: [
            [
              'Historial completo en bruto',
              'Crece linealmente con la conversación',
              'Bajo para hechos, alto para el foco del agente',
              'Invalidado en cada cambio',
            ],
            [
              'Resumen libre generado por modelo',
              'Bajo y estable',
              'Alto: compromisos y datos recolectados desaparecen en el resumen',
              'Invalidado en cada cambio',
            ],
            [
              'Paquete estructurado más turnos recientes',
              'Estable, crece solo con los campos establecidos',
              'Bajo, si el compromiso nunca se resume',
              'Invalidado, pero con un prefijo menor',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Conviene registrar la métrica que expone el problema antes que la factura: costo por conversación resuelta segmentado por cantidad de transferencias. Si la conversación de tres saltos cuesta cinco veces la de cero saltos y resuelve en la misma proporción, el enrutamiento funciona. Si cuesta cinco veces y resuelve menos, cada transferencia está degradando el contexto, y la cantidad de saltos se volvió un indicador de fracaso en vez de especialización.',
        },
      ],
    },
    {
      title: 'Probar el enrutador aparte de los agentes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error de evaluación más común en este tipo de sistema es medir solo la respuesta final. Cuando sale mal, no hay forma de saber si el enrutador eligió el agente equivocado o si el agente correcto respondió mal, y el equipo termina ajustando el prompt del especialista para compensar un problema de enrutamiento. El enrutador y el agente necesitan conjuntos de evaluación separados, porque fallan por motivos distintos y se corrigen en lugares distintos.',
        },
        {
          type: 'paragraph',
          value:
            'El conjunto del enrutador es barato de armar y de correr: entrada de conversación y destino esperado, sin ejecutar ningún agente. Lo delicado es cómo etiquetar. Etiquetar por el destino que el sistema eligió en producción solo congela el comportamiento actual, errores incluidos. La etiqueta útil viene del desenlace: las conversaciones resueltas sin otra transferencia confirman el destino, y las que fueron transferidas enseguida son candidatas a etiqueta corregida, con el segundo destino como respuesta correcta.',
        },
        {
          type: 'code',
          value: `// routing/eval-router.js
// Evalua solo la decision de enrutamiento, sin ejecutar los agentes.
// Metrica principal: acierto en el primer destino. Metrica de guardia:
// tasa de transferencia inmediata, que revela mal enrutamiento incluso
// cuando la respuesta final termino siendo aceptable.

export async function evaluateRouter(cases, route) {
  const result = { total: cases.length, correct: 0, byIntent: {} };

  for (const testCase of cases) {
    const decision = await route(testCase.conversation);
    const hit = decision.target === testCase.expectedTarget;

    const bucket = (result.byIntent[testCase.intent] ??= { total: 0, correct: 0 });
    bucket.total += 1;
    if (hit) {
      bucket.correct += 1;
      result.correct += 1;
    }
  }

  result.accuracy = result.correct / result.total;

  // El acierto agregado esconde una especialidad rara con mal desempeno,
  // y la especialidad rara suele ser la de mayor impacto por caso.
  result.worstIntent = Object.entries(result.byIntent)
    .map(([intent, bucket]) => ({ intent, accuracy: bucket.correct / bucket.total }))
    .sort((a, b) => a.accuracy - b.accuracy)[0];

  return result;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Hay además una prueba que no es de acierto sino de integridad del paquete, y que suele atrapar más defectos que el eval de destino. Toma conversaciones reales, arma el paquete de transferencia y verifica si todo dato que el cliente entregó antes de la frontera sigue siendo recuperable después de ella. Es determinista, corre sin llamar al modelo y falla exactamente en el caso que genera la peor experiencia: el cliente que informa el número de pedido en el tercer turno y lo escucha pedir de nuevo en el séptimo.',
        },
        {
          type: 'ordered',
          items: [
            'Corre el eval de enrutamiento en cada merge que toque la tabla de motivos, el clasificador o la descripción de las especialidades.',
            'Corre la prueba de integridad del paquete en cada merge que toque la construcción del handoff o el esquema de hechos.',
            'Corre los evals de los agentes especialistas con el paquete de entrada fijado, para separar regresión del agente de regresión del enrutador.',
            'Monitorea en producción la tasa de transferencia inmediata y la cantidad media de saltos por conversación resuelta.',
            'Revisa el techo de saltos cuando la fila humana reciba muchas derivaciones por límite, porque eso indica topología mal diseñada y no clientes difíciles.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Vale la pena tener agentes especializados o es mejor un agente único con todas las herramientas?',
      answer:
        'Depende de cuántas herramientas hay y de cuánta política en conflicto existe. Hasta alrededor de diez o quince herramientas con políticas compatibles, un agente único suele ganar, porque elimina la frontera de transferencia y todo su costo asociado. La especialización compensa cuando las políticas realmente entran en conflicto, por ejemplo cuando un dominio exige confirmación explícita antes de cualquier acción y otro exige agilidad sin confirmación, o cuando la autoridad debe ser distinta por dominio. En ese caso, el agente único tiende a producir un prompt lleno de excepciones que se degrada en todos los escenarios a la vez.',
    },
    {
      question: '¿Cómo saber si una transferencia fue buena o mala después de que ocurrió?',
      answer:
        'Una señal simple y fuerte es la transferencia inmediata: si el agente de destino vuelve a transferir en los dos primeros turnos, el enrutamiento anterior probablemente se equivocó. Una segunda señal es la repetición de preguntas, detectable comparando los campos recolectados antes y después de la frontera, que apunta a pérdida de contexto en vez de destino equivocado. La tercera es la resolución por cantidad de saltos, que debe caer poco en cada salto. Si se desploma del primero al segundo salto, el problema está en el paquete y no en la elección del agente.',
    },
    {
      question: '¿El paquete de transferencia debe incluir el resumen generado por modelo o solo campos estructurados?',
      answer:
        'Ambos, con papeles distintos. Los campos estructurados llevan lo que no puede perderse: datos recolectados, compromisos asumidos y acciones ya ejecutadas, y nunca deben pasar por sumarización. El resumen cubre la parte narrativa antigua de la conversación, que aporta tono e historial sin necesitar fidelidad literal. La regla práctica es que ningún dato que el cliente entregó debe existir solo dentro del resumen, porque la sumarización es lossy por definición y la pérdida cae justamente sobre el detalle específico, que es la forma de casi todo dato útil.',
    },
  ],
  conclusion: {
    title: 'La frontera entre agentes es infraestructura, no un detalle de prompt',
    description:
      'El enrutamiento entre agentes especializados falla en un lugar bien definido: en la frontera donde el estado de la conversación debe cruzar de un agente a otro. Separar hecho de hipótesis y de compromiso dentro de un paquete explícito, recalcular la autoridad en el destino en vez de heredarla, garantizar la terminación en el enrutador con techo de saltos y exigencia de hecho nuevo, dejar que el agente declare el motivo en lugar de nombrar el destino, y evaluar enrutador y especialistas en conjuntos separados convierte un sistema que empuja al cliente entre filas en uno que realmente especializa. Puedo mapear las fronteras de tu flujo actual, definir el paquete de transferencia a partir de lo que tus agentes ya recolectan y armar el eval de enrutamiento con la etiqueta derivada del desenlace real de las conversaciones.',
    cta: 'Hablar sobre el enrutamiento de mis agentes',
  },
  related: [
    {
      label: 'Orquestación de agentes de IA en producción',
      to: '/blog/orquestracao-agentes-ia-producao',
    },
    {
      label: 'Ventana de contexto compartida entre canales',
      to: '/blog/janela-contexto-compartilhada-entre-canais-whatsapp-web-telefone',
    },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

export default {
  pt,
  en,
  es,
};
