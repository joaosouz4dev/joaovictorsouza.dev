// Conteudo do artigo: feature flag em fluxo de agente, ligando comportamento
// novo para poucos sem quebrar conversa em andamento.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A flag existe justamente porque ninguém tem certeza de que o comportamento novo funciona, e num serviço tradicional isso é barato: a requisição entra, o if decide, a resposta sai, e se a variante nova for ruim você desliga a chave e a próxima requisição já nasce curada. Num fluxo de agente nada disso vale. A unidade de trabalho não é a requisição, é a conversa, que dura minutos ou dias, guarda estado entre os turnos e às vezes já executou uma ferramenta com efeito no mundo real. Avaliar a flag a cada turno faz o agente trocar de personalidade no meio do atendimento, perder ferramentas que já anunciou ao modelo e produzir um histórico onde metade das mensagens seguiu uma regra e a outra metade seguiu outra. Este artigo mostra por que a flag no agente precisa ser decidida uma vez e congelada na conversa, como escolher o ponto de avaliação, como separar as flags que podem virar no meio das que não podem, como matar a variante ruim sem interromper quem está no meio dela e o que registrar para que a comparação entre variantes signifique alguma coisa.',
  sections: [
    {
      title: 'Por que a flag do agente não se parece com a flag de um endpoint',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma feature flag comum protege um trecho de código sem estado: o efeito da decisão começa e termina dentro da mesma requisição. Se a variante nova responde errado, o dano se limita àquela resposta, e virar a chave conserta tudo que vier depois. Um fluxo de agente rompe as duas premissas ao mesmo tempo. A decisão do turno três depende do que o agente disse no turno um, das ferramentas que o modelo viu declaradas, do resumo que foi gravado na memória da conversa e, se houve tool use, de um efeito que já aconteceu do lado de fora. Ligar um comportamento novo aqui não é trocar um ramo do if, é mudar as regras de um jogo que já está em andamento.',
        },
        {
          type: 'paragraph',
          value:
            'O sintoma mais comum é o agente esquizofrênico: a flag é avaliada a cada turno, o rollout está em vinte por cento, e o mesmo cliente cai na variante nova numa mensagem e na antiga na seguinte porque o sorteio foi aleatório em vez de ancorado. O agente muda de tom, contradiz o que ele mesmo prometeu duas mensagens atrás e às vezes oferece uma ação que na variante antiga não existe. Mesmo com âncora determinística por conversa, resta o segundo sintoma, mais silencioso: o rollout muda de porcentagem enquanto conversas estão vivas, e uma conversa que começou na variante nova de repente passa a ser resolvida pela antiga, com um histórico que já assumia o comportamento novo. A flag correta no agente não responde "qual variante agora", responde "qual variante esta conversa está usando desde que começou".',
        },
        {
          type: 'table',
          columns: ['Dimensão', 'Flag em endpoint', 'Flag em fluxo de agente'],
          rows: [
            [
              'Unidade de decisão',
              'A requisição, sem estado entre elas',
              'A conversa inteira, com estado acumulado entre turnos',
            ],
            [
              'Quando avaliar',
              'A cada chamada, o custo de reavaliar é zero',
              'Uma vez, na criação da conversa, e congelar o resultado',
            ],
            [
              'Efeito de virar a chave',
              'A próxima requisição já usa o valor novo',
              'Conversas em andamento continuam na variante que escolheram',
            ],
            [
              'Dano de uma variante ruim',
              'Limitado à resposta errada daquela chamada',
              'Estado corrompido, ferramenta já executada, histórico inconsistente',
            ],
            [
              'Rollback',
              'Desligar a flag resolve tudo',
              'Desligar impede novas conversas; as vivas precisam de política própria',
            ],
          ],
        },
      ],
    },
    {
      title: 'Decidir uma vez: a flag é resolvida na criação da conversa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A inversão que resolve a maior parte dos problemas é mover a avaliação da flag do turno para o início da conversa. No primeiro contato, o sistema resolve todas as flags relevantes de uma vez, grava o resultado junto do estado da conversa e nunca mais pergunta ao serviço de flags durante aquele atendimento. O turno três lê a decisão gravada, não recalcula. Isso dá consistência de graça: o agente não pode mudar de comportamento no meio porque a variante já está escrita no estado, e nem uma mudança de rollout nem uma indisponibilidade do serviço de flags conseguem alterá-la.',
        },
        {
          type: 'paragraph',
          value:
            'A âncora do sorteio precisa ser o identificador da conversa, não o do usuário e nem um número aleatório. O identificador do usuário parece atraente porque dá consistência entre conversas, mas amarra o cliente à mesma variante para sempre e enviesa a comparação: se um cliente heavy user caiu na variante nova, todas as conversas difíceis dele contam para o mesmo lado. Ancorar na conversa distribui melhor e ainda permite que o mesmo cliente participe das duas variantes ao longo do tempo. O aleatório puro é o pior dos três porque perde a reprodutibilidade: com um hash do identificador da conversa você recalcula a decisão em qualquer lugar do sistema e sempre chega no mesmo resultado, o que salva a análise quando o campo gravado se perde.',
        },
        {
          type: 'code',
          value: `// agent/flags.js
// A flag do agente e resolvida UMA VEZ, na criacao da conversa, e o
// resultado vira parte do estado. Turnos seguintes leem, nunca reavaliam.

import { createHash } from 'node:crypto';

// Ancora deterministica na conversa: mesma conversa, mesmo bucket,
// em qualquer instancia e em qualquer momento futuro.
function bucketOf(conversationId, flagKey) {
  const h = createHash('sha256').update(flagKey + ':' + conversationId).digest();
  return h.readUInt16BE(0) % 100; // 0..99
}

// Chamada apenas no primeiro turno, quando a conversa e criada.
export function resolveFlagsForConversation(config, conversationId, context) {
  const decided = {};
  for (const [key, flag] of Object.entries(config)) {
    if (!flag.enabled) {
      decided[key] = flag.fallback;
      continue;
    }
    // Alvos explicitos (cliente interno, conta de teste) ignoram a fatia.
    if (flag.allowlist?.includes(context.accountId)) {
      decided[key] = flag.variant;
      continue;
    }
    decided[key] = bucketOf(conversationId, key) < flag.rolloutPct
      ? flag.variant
      : flag.fallback;
  }
  // Guardado junto do estado da conversa: e isto que os turnos leem.
  return { decidedAt: context.now, configVersion: config.version, values: decided };
}

// Turnos 2..N: le a decisao congelada. Se faltar, a conversa e antiga
// e nasceu antes da flag existir: cai no fallback, nunca sorteia de novo.
export function flagValue(conversationState, key, fallback) {
  return conversationState.flags?.values?.[key] ?? fallback;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Vale registrar junto da decisão a versão da configuração que a produziu. Sem isso, uma conversa iniciada segunda-feira e outra iniciada quarta podem ter caído na mesma variante por motivos diferentes, e a análise não consegue separar as duas populações quando alguém mexeu na porcentagem no meio. Com a versão gravada, cada conversa carrega a prova de qual configuração a decidiu, e o corte por versão vira uma consulta trivial.',
        },
      ],
    },
    {
      title: 'Nem toda flag pode congelar: separe as três famílias',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Congelar tudo na criação da conversa seria simples, mas está errado para uma parte das flags. Um kill switch de segurança que só pode ser congelado é inútil: se o comportamento novo está gerando resposta perigosa, você precisa que ele pare agora, inclusive nas conversas em andamento. A regra prática é classificar cada flag por uma pergunta: uma virada no meio da conversa quebra a coerência do que já foi dito ou executado? Se sim, congela. Se não, pode ser dinâmica. E existe uma terceira família, a que precisa ser dinâmica mesmo quebrando coerência, porque a alternativa é pior.',
        },
        {
          type: 'table',
          columns: ['Família', 'Quando avaliar', 'Exemplos', 'Risco de virar no meio'],
          rows: [
            [
              'Congelada na conversa',
              'Uma vez, na criação, gravada no estado',
              'Prompt de sistema, conjunto de ferramentas, política de escalonamento, formato de resposta',
              'Alto: contradiz o histórico, invalida ferramenta já anunciada',
            ],
            [
              'Dinâmica por turno',
              'A cada turno, lendo o valor atual',
              'Roteamento de modelo, limite de tokens, timeout, tamanho do retrieval',
              'Baixo: muda o custo e a latência, não a semântica do que foi dito',
            ],
            [
              'Kill switch',
              'A cada turno, com precedência sobre a congelada',
              'Desligar uma ferramenta perigosa, cortar um comportamento que gerou incidente',
              'Aceito de propósito: parar agora vale mais que a coerência',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que costuma passar batido é a ferramenta declarada. Quando o agente anuncia ao modelo um conjunto de ferramentas no turno um e a flag remove uma delas no turno três, o modelo pode ter planejado uma sequência que agora não existe mais, e o resultado é uma chamada a uma ferramenta desconhecida ou um plano abandonado no meio. Se a remoção veio de um kill switch, o certo não é sumir com a ferramenta em silêncio: é devolver ao modelo um erro explícito e tratável, do tipo "esta ferramenta está indisponível agora", para que ele replaneje em vez de quebrar. A diferença entre um kill switch usável e um que gera incidente próprio está quase toda nessa resposta.',
        },
        {
          type: 'code',
          value: `// agent/tools.js
// Kill switch tem precedencia sobre a decisao congelada, mas nao pode
// sumir com a ferramenta em silencio: o modelo ja pode ter planejado
// com ela. Devolver erro tratavel e o que permite o replanejamento.

export function toolsForTurn(conversationState, liveConfig) {
  // Conjunto congelado no inicio da conversa.
  const frozen = conversationState.flags.values.toolset ?? [];
  // Kill switches sao lidos agora, no turno atual.
  const killed = new Set(liveConfig.killedTools ?? []);
  return frozen.filter((tool) => !killed.has(tool.name));
}

export function executeTool(conversationState, liveConfig, call) {
  const killed = new Set(liveConfig.killedTools ?? []);
  if (killed.has(call.name)) {
    // Erro de dominio, nao excecao: volta como resultado da ferramenta
    // para o modelo replanejar dentro do mesmo turno.
    return {
      ok: false,
      error: 'tool_unavailable',
      message: 'Ferramenta indisponivel no momento. Prossiga sem ela.',
    };
  }
  return runTool(call);
}`,
        },
      ],
    },
    {
      title: 'Ligar para poucos: escolher quem entra sem enviesar a leitura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A porcentagem é o mecanismo mais visível do rollout, mas raramente é por onde se deve começar. Antes de dar cinco por cento do tráfego para a variante nova, vale rodar em uma lista explícita: contas internas, o time de suporte, um cliente que topou testar. Essa fase pega o erro grosseiro, o que aparece na primeira conversa, sem gastar nenhum cliente real. A lista explícita também precisa ser tratada à parte na análise, porque quem sabe que está testando se comporta diferente e contamina qualquer métrica de qualidade.',
        },
        {
          type: 'paragraph',
          value:
            'Quando a porcentagem entra, o cuidado é com o que a fatia representa. Um rollout de cinco por cento sobre todo o tráfego pega em maior proporção os assuntos frequentes e quase nunca os raros, que são justamente onde o comportamento novo costuma falhar. Segmentar antes de sortear ajuda: aplicar a fatia dentro de um tipo de atendimento, de um horário ou de um segmento de cliente dá uma amostra que representa aquele recorte, em vez de uma amostra dominada pelo caso mais comum. E existe o recorte inverso, o mais importante de todos: nem toda conversa deve ser elegível. Um cliente em processo de cancelamento, um atendimento que já passou por escalonamento, uma conversa marcada como sensível, todos esses ficam fora por decisão explícita, não por sorte do hash.',
        },
        {
          type: 'diagram',
          value: `Elegibilidade antes do sorteio, decidida uma vez

  nova conversa
       |
       v
  [ e elegivel? ]  conta sensivel / ja escalada / cancelamento
       |  nao -> fallback (nunca entra no experimento)
       v sim
  [ esta na allowlist? ]  interno / cliente piloto
       |  sim -> variante nova (marcado como nao-amostra)
       v nao
  [ hash(conversationId + flagKey) % 100 < rolloutPct ]
       |  sim -> variante nova     -> grava no estado
       |  nao -> variante estavel  -> grava no estado
       v
  turnos 2..N leem o estado, nao reavaliam

  mudar rolloutPct daqui pra frente:
    afeta apenas conversas NOVAS; as vivas ficam onde estao`,
        },
        {
          type: 'paragraph',
          value:
            'O corolário do congelamento é que subir a porcentagem não converte ninguém. Ao passar de cinco para vinte por cento, as conversas que já estavam rodando continuam onde estavam, e só as novas sentem a mudança. Isso é desejável, mas tem uma consequência operacional: o efeito de um aumento demora a aparecer nas métricas, porque leva o tempo de vida médio de uma conversa até que a nova fatia esteja de fato representada. Subir a porcentagem e olhar o painel dez minutos depois mede quase nada, sobretudo em canais assíncronos onde uma conversa pode ficar aberta por dias.',
        },
      ],
    },
    {
      title: 'Desligar a variante ruim sem interromper quem está no meio dela',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando a variante nova se mostra ruim, existem três políticas possíveis para as conversas que já estão nela, e escolher errado transforma um problema em dois. Deixar todas terminarem é a opção mais coerente e a mais lenta: o dano continua acontecendo, limitado à fatia, até a última conversa fechar. Converter todo mundo para a variante estável agora é o mais rápido e o mais violento: um agente que anunciou uma ferramenta ou prometeu um formato pode não conseguir cumprir, e o cliente vê a mudança. A terceira, que costuma ser a resposta certa, é a conversão em ponto seguro: a conversa continua na variante nova até chegar a um estado onde a troca não contradiz nada, tipicamente logo depois de uma resposta completa e antes do próximo turno, e ali migra.',
        },
        {
          type: 'ordered',
          items: [
            'Bloqueie a entrada primeiro: zere a fatia para que nenhuma conversa nova caia na variante ruim. Isso é instantâneo e não quebra ninguém.',
            'Classifique o dano: se a variante gera resposta perigosa ou executa ação errada, é kill switch e as conversas vivas precisam parar agora, aceitando a incoerência.',
            'Se o dano for de qualidade e não de segurança, marque as conversas vivas para conversão em ponto seguro em vez de trocar no meio de um turno.',
            'Defina o ponto seguro pelo estado, não pelo tempo: depois de uma resposta final entregue, sem tool call pendente e sem plano em aberto.',
            'Registre a conversão no estado da conversa, com o motivo e o instante, para que a análise não misture o trecho antigo com o novo na mesma amostra.',
            'Ao converter, injete no contexto uma nota curta de que a capacidade mudou, para o modelo não reafirmar algo que ele prometeu sob a variante anterior.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A conversão em ponto seguro exige que a conversa saiba dizer se está num ponto seguro, o que é outra forma de dizer que o estado do agente precisa ser explícito. Se o sistema não consegue responder "existe tool call pendente" ou "existe plano em aberto", a única política honesta é deixar terminar, porque qualquer conversão será às cegas. Isso costuma ser o argumento decisivo para modelar o estado do agente como uma máquina pequena e legível em vez de deixá-lo implícito no histórico de mensagens: sem isso, o rollback fica sem opção intermediária entre esperar e quebrar.',
        },
      ],
    },
    {
      title: 'Medir a variante: sem atribuição por conversa, o rollout é fé',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A flag só vale se a comparação entre variantes for confiável, e no agente a maioria das métricas úteis só existe no nível da conversa. Custo por resposta engana porque a variante nova pode gastar mais por turno e resolver em menos turnos, saindo mais barata no total. Qualidade por mensagem engana pelo mesmo motivo. As métricas que decidem são de desfecho: a conversa foi resolvida sem humano, quantos turnos levou, quanto custou do início ao fim, se o cliente voltou nas próximas horas com o mesmo assunto. Todas elas precisam da variante gravada no registro da conversa para poderem ser quebradas por lado.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Unidade correta', 'Por que a unidade errada mente'],
          rows: [
            [
              'Custo',
              'Soma de toda a conversa',
              'Por turno, a variante que resolve em menos turnos parece cara',
            ],
            [
              'Resolução sem humano',
              'Desfecho da conversa',
              'Por mensagem, não existe: escalonamento é evento único no fim',
            ],
            [
              'Latência',
              'Percentil por turno, comparado só entre turnos equivalentes',
              'Média entre variantes com número de turnos diferente compara coisas distintas',
            ],
            [
              'Retorno do cliente',
              'Janela após o fechamento da conversa',
              'Dentro da conversa não aparece: o problema volta depois, em outro atendimento',
            ],
            [
              'Erro de ferramenta',
              'Por conversa, contando se houve pelo menos um',
              'Por chamada, um retry ruidoso vira dez erros e domina o total',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Uma armadilha específica do agente é a conversa que atravessa uma mudança de configuração. Se ela começou sob a versão dois da flag e foi convertida sob a versão três, ela não pertence limpo a nenhum dos dois lados, e incluí-la em qualquer um dos grupos suja a comparação. O caminho honesto é marcar essas conversas como contaminadas e analisá-las à parte: se forem poucas, saem da amostra principal; se forem muitas, isso em si é o sinal de que as mudanças estão acontecendo rápido demais para o tempo de vida das conversas, e o rollout precisa desacelerar em vez de continuar produzindo dados que ninguém consegue ler.',
        },
        {
          type: 'code',
          value: `// analytics/variant.js
// Atribuicao por conversa: a variante e um campo do desfecho, nao um
// campo de cada mensagem. Conversa que atravessou mudanca de config
// nao pertence a nenhum lado e sai da amostra principal.

export function conversationOutcome(state) {
  const flags = state.flags ?? {};
  const converted = Boolean(state.flagConversion);

  return {
    conversationId: state.id,
    variant: flags.values?.agentFlow ?? 'stable',
    configVersion: flags.configVersion ?? null,
    // Marca a contaminacao em vez de descartar em silencio: o volume
    // de contaminadas e por si so um sinal sobre o ritmo do rollout.
    contaminated: converted,
    resolvedWithoutHuman: state.escalatedAt == null,
    turns: state.turns.length,
    totalCostUsd: state.turns.reduce((sum, t) => sum + (t.costUsd ?? 0), 0),
    toolErrored: state.turns.some((t) => t.toolError === true),
    closedAt: state.closedAt,
  };
}

// A comparacao usa somente as nao contaminadas; as demais viram um
// relatorio proprio, que serve para decidir se o rollout esta rapido demais.
export function compareVariants(outcomes) {
  const clean = outcomes.filter((o) => !o.contaminated && o.closedAt != null);
  const byVariant = new Map();
  for (const o of clean) {
    const g = byVariant.get(o.variant) ?? { n: 0, resolved: 0, cost: 0, turns: 0 };
    g.n += 1;
    g.resolved += o.resolvedWithoutHuman ? 1 : 0;
    g.cost += o.totalCostUsd;
    g.turns += o.turns;
    byVariant.set(o.variant, g);
  }
  return [...byVariant].map(([variant, g]) => ({
    variant,
    conversations: g.n,
    resolutionRate: g.resolved / g.n,
    avgCostUsd: g.cost / g.n,
    avgTurns: g.turns / g.n,
  }));
}`,
        },
      ],
    },
    {
      title: 'Higiene: a flag temporária que virou arquitetura permanente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Flag de agente apodrece mais rápido que flag comum porque cada uma bifurca o comportamento inteiro, não um trecho. Duas flags de fluxo já dão quatro combinações de prompt, ferramentas e política de escalonamento, e ninguém testou as quatro. Três dão oito. Como o efeito de cada uma só aparece em conversa real, a combinação que ninguém testou é também a que ninguém consegue reproduzir quando um cliente reclama. Por isso a flag de fluxo precisa de prazo desde o nascimento: uma data de expiração declarada na própria configuração e um alerta quando ela passar, tratando a flag vencida como dívida visível em vez de um if esquecido.',
        },
        {
          type: 'list',
          items: [
            'Declare a data de expiração junto da flag e faça o CI reclamar quando ela vencer, do mesmo jeito que reclamaria de um teste quebrado.',
            'Limite quantas flags de fluxo podem estar abertas ao mesmo tempo: cada uma multiplica as combinações que ninguém testou.',
            'Ao chegar em cem por cento, remova o ramo antigo no mesmo ciclo. Uma flag em cem por cento que permanece é código morto que ainda pode ser ligado por engano.',
            'Guarde o valor da flag no estado das conversas encerradas mesmo depois de remover a flag do código, senão a análise histórica perde o corte.',
            'Nunca aninhe uma flag de fluxo dentro de outra: se o comportamento novo depende do outro comportamento novo, é uma flag só, com duas etapas.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A remoção também é uma operação com estado. Apagar a flag do código enquanto existem conversas vivas que a gravaram no estado faz o leitor cair no fallback no meio do atendimento, exatamente a troca não anunciada que o congelamento existia para evitar. A ordem segura é a inversa da introdução: primeiro leve a fatia a cem por cento e espere o tempo de vida das conversas passar, depois torne o ramo novo o comportamento padrão sem consultar a flag, e só então apague a configuração. O campo gravado nas conversas antigas continua lá, inofensivo, e é ele que mantém a análise histórica possível.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que não avaliar a feature flag a cada turno do agente, como faço num endpoint?',
      answer:
        'Porque a unidade de trabalho do agente é a conversa, não a requisição, e o estado atravessa os turnos. Avaliando a cada turno, uma mudança de porcentagem ou um sorteio não ancorado fazem o mesmo cliente cair na variante nova numa mensagem e na antiga na seguinte: o agente muda de tom, contradiz o que prometeu antes e pode oferecer uma ação que na outra variante não existe. Pior, se o conjunto de ferramentas mudar no meio, o modelo pode ter planejado uma sequência que deixou de ser possível. A saída é resolver todas as flags de fluxo uma única vez, na criação da conversa, gravar o resultado junto do estado e fazer os turnos seguintes lerem esse valor congelado em vez de perguntar de novo ao serviço de flags. Assim nem uma virada de rollout nem uma indisponibilidade do serviço conseguem mudar o comportamento no meio do atendimento.',
    },
    {
      question: 'Como desligar uma variante ruim sem quebrar as conversas que já estão nela?',
      answer:
        'Em duas etapas separadas. A primeira é sempre a mesma e é instantânea: zerar a fatia para que nenhuma conversa nova entre na variante ruim, o que não afeta ninguém que já está dentro. A segunda depende do tipo de dano. Se a variante gera resposta perigosa ou executa ação errada, é caso de kill switch e as conversas vivas precisam parar agora, aceitando a incoerência como preço; nesse caso, uma ferramenta removida deve devolver ao modelo um erro tratável do tipo indisponível, e não sumir em silêncio, para que ele replaneje. Se o dano for de qualidade e não de segurança, o melhor é a conversão em ponto seguro: a conversa continua na variante nova até chegar a um estado onde a troca não contradiz nada, tipicamente após uma resposta final entregue, sem tool call pendente e sem plano em aberto, e migra ali, com a conversão registrada no estado.',
    },
    {
      question: 'Qual é a métrica certa para comparar duas variantes de fluxo de agente?',
      answer:
        'As de desfecho, medidas por conversa inteira, não por mensagem. Custo por turno engana porque a variante nova pode gastar mais em cada turno e resolver em menos turnos, saindo mais barata no total; o número que decide é o custo somado do início ao fim da conversa. Da mesma forma, resolução sem humano é um evento único no desfecho e não existe por mensagem, e o retorno do cliente com o mesmo assunto só aparece numa janela depois do fechamento. Erro de ferramenta deve ser contado como "houve pelo menos um" por conversa, senão um retry ruidoso vira dez erros e domina o total. Para tudo isso funcionar, a variante precisa estar gravada no registro da conversa, e as conversas que atravessaram uma mudança de configuração precisam ser marcadas como contaminadas e analisadas à parte.',
    },
  ],
  conclusion: {
    title: 'A flag do agente pertence à conversa, não ao turno',
    description:
      'Um fluxo de agente quebra as duas premissas que tornam a feature flag comum barata: a decisão não termina na requisição e o estado atravessa os turnos. Resolver a flag uma vez na criação da conversa, ancorada no identificador dela e gravada junto do estado, dá consistência de graça e faz uma mudança de rollout afetar apenas as conversas novas. Separar as flags congeladas das dinâmicas e do kill switch define o que pode virar no meio, e a conversão em ponto seguro dá a opção intermediária entre esperar e quebrar quando a variante se mostra ruim. Com a variante gravada no desfecho e as conversas contaminadas fora da amostra, a comparação entre lados passa a significar alguma coisa. Posso montar esse controle de rollout no seu fluxo de agente, do congelamento na criação da conversa à atribuição por desfecho, para você ligar comportamento novo para poucos sem descobrir o problema pelo cliente.',
    cta: 'Falar sobre rollout controlado no meu fluxo de agente',
  },
  related: [
    {
      label: 'Versionar o prompt como código: rollout, rollback e teste',
      to: '/blog/versionar-prompt-como-codigo-rollout-rollback-teste',
    },
    {
      label: 'Orquestração de agentes de IA em produção',
      to: '/blog/orquestracao-agentes-ia-producao',
    },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

const en = {
  intro:
    'The flag exists precisely because nobody is sure the new behavior works, and in a traditional service that is cheap: the request comes in, the if decides, the response goes out, and if the new variant is bad you flip the switch and the next request is already cured. In an agent flow none of that holds. The unit of work is not the request, it is the conversation, which lasts minutes or days, keeps state across turns and sometimes has already executed a tool with an effect in the real world. Evaluating the flag on every turn makes the agent change personality mid-conversation, lose tools it already announced to the model and produce a history where half the messages followed one rule and the other half followed another. This article shows why an agent flag has to be decided once and frozen into the conversation, how to choose the evaluation point, how to separate the flags that may flip midway from the ones that may not, how to kill a bad variant without interrupting whoever is in the middle of it and what to record so that comparing variants means something.',
  sections: [
    {
      title: 'Why an agent flag does not look like an endpoint flag',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An ordinary feature flag guards a stateless piece of code: the effect of the decision starts and ends inside the same request. If the new variant answers wrong, the damage is limited to that response, and flipping the switch fixes everything that comes after. An agent flow breaks both premises at once. The decision on turn three depends on what the agent said on turn one, on the tools the model saw declared, on the summary written into the conversation memory and, if there was tool use, on an effect that already happened on the outside. Turning on a new behavior here is not switching a branch of an if, it is changing the rules of a game already in progress.',
        },
        {
          type: 'paragraph',
          value:
            'The most common symptom is the schizophrenic agent: the flag is evaluated on every turn, the rollout sits at twenty percent, and the same customer lands on the new variant in one message and the old one in the next because the draw was random instead of anchored. The agent changes tone, contradicts what it promised two messages earlier and sometimes offers an action that does not exist in the old variant. Even with a deterministic per-conversation anchor, a second and quieter symptom remains: the rollout percentage changes while conversations are alive, and a conversation that started on the new variant is suddenly resolved by the old one, on a history that already assumed the new behavior. The right flag in an agent does not answer "which variant now", it answers "which variant this conversation has been using since it started".',
        },
        {
          type: 'table',
          columns: ['Dimension', 'Endpoint flag', 'Agent flow flag'],
          rows: [
            [
              'Unit of decision',
              'The request, with no state between them',
              'The whole conversation, with state accumulated across turns',
            ],
            [
              'When to evaluate',
              'On every call, re-evaluating costs nothing',
              'Once, at conversation creation, and freeze the result',
            ],
            [
              'Effect of flipping the switch',
              'The next request already uses the new value',
              'Ongoing conversations stay on the variant they chose',
            ],
            [
              'Damage from a bad variant',
              'Limited to the wrong answer on that call',
              'Corrupted state, tool already executed, inconsistent history',
            ],
            [
              'Rollback',
              'Turning the flag off solves everything',
              'Turning it off blocks new conversations; live ones need their own policy',
            ],
          ],
        },
      ],
    },
    {
      title: 'Decide once: the flag is resolved at conversation creation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The inversion that solves most of the problems is moving the flag evaluation from the turn to the start of the conversation. On first contact, the system resolves every relevant flag at once, writes the result alongside the conversation state and never asks the flag service again during that conversation. Turn three reads the stored decision, it does not recompute. That gives consistency for free: the agent cannot change behavior midway because the variant is already written into the state, and neither a rollout change nor an outage of the flag service can alter it.',
        },
        {
          type: 'paragraph',
          value:
            'The anchor of the draw must be the conversation identifier, not the user identifier and not a random number. The user identifier looks attractive because it gives consistency across conversations, but it binds the customer to the same variant forever and biases the comparison: if a heavy user landed on the new variant, all of their hard conversations count for the same side. Anchoring on the conversation distributes better and still lets the same customer take part in both variants over time. Pure randomness is the worst of the three because it loses reproducibility: with a hash of the conversation identifier you can recompute the decision anywhere in the system and always reach the same result, which saves the analysis when the stored field is lost.',
        },
        {
          type: 'code',
          value: `// agent/flags.js
// The agent flag is resolved ONCE, at conversation creation, and the
// result becomes part of the state. Later turns read, never re-evaluate.

import { createHash } from 'node:crypto';

// Deterministic anchor on the conversation: same conversation, same
// bucket, on any instance and at any point in the future.
function bucketOf(conversationId, flagKey) {
  const h = createHash('sha256').update(flagKey + ':' + conversationId).digest();
  return h.readUInt16BE(0) % 100; // 0..99
}

// Called only on the first turn, when the conversation is created.
export function resolveFlagsForConversation(config, conversationId, context) {
  const decided = {};
  for (const [key, flag] of Object.entries(config)) {
    if (!flag.enabled) {
      decided[key] = flag.fallback;
      continue;
    }
    // Explicit targets (internal customer, test account) skip the slice.
    if (flag.allowlist?.includes(context.accountId)) {
      decided[key] = flag.variant;
      continue;
    }
    decided[key] = bucketOf(conversationId, key) < flag.rolloutPct
      ? flag.variant
      : flag.fallback;
  }
  // Stored with the conversation state: this is what turns read.
  return { decidedAt: context.now, configVersion: config.version, values: decided };
}

// Turns 2..N: read the frozen decision. If missing, the conversation is
// old and started before the flag existed: fall back, never draw again.
export function flagValue(conversationState, key, fallback) {
  return conversationState.flags?.values?.[key] ?? fallback;
}`,
        },
        {
          type: 'paragraph',
          value:
            'It is worth recording, alongside the decision, the configuration version that produced it. Without it, a conversation started on Monday and another started on Wednesday may have landed on the same variant for different reasons, and the analysis cannot separate the two populations when someone changed the percentage in between. With the version stored, each conversation carries proof of which configuration decided it, and slicing by version becomes a trivial query.',
        },
      ],
    },
    {
      title: 'Not every flag can freeze: separate the three families',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Freezing everything at conversation creation would be simple, but it is wrong for a subset of flags. A safety kill switch that can only be frozen is useless: if the new behavior is producing a dangerous answer, you need it to stop now, including in ongoing conversations. The practical rule is to classify each flag by one question: does flipping it mid-conversation break the coherence of what has already been said or executed? If yes, freeze it. If not, it can be dynamic. And there is a third family, the one that must be dynamic even though it breaks coherence, because the alternative is worse.',
        },
        {
          type: 'table',
          columns: ['Family', 'When to evaluate', 'Examples', 'Risk of flipping midway'],
          rows: [
            [
              'Frozen per conversation',
              'Once, at creation, stored in the state',
              'System prompt, tool set, escalation policy, response format',
              'High: contradicts the history, invalidates an already announced tool',
            ],
            [
              'Dynamic per turn',
              'On every turn, reading the current value',
              'Model routing, token limit, timeout, retrieval size',
              'Low: changes cost and latency, not the semantics of what was said',
            ],
            [
              'Kill switch',
              'On every turn, taking precedence over the frozen value',
              'Disabling a dangerous tool, cutting a behavior that caused an incident',
              'Accepted on purpose: stopping now is worth more than coherence',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The detail that usually slips by is the declared tool. When the agent announces a tool set to the model on turn one and the flag removes one of them on turn three, the model may have planned a sequence that no longer exists, and the result is a call to an unknown tool or a plan abandoned midway. If the removal came from a kill switch, the right move is not to make the tool vanish silently: it is to return an explicit, handleable error to the model, along the lines of "this tool is unavailable right now", so it can replan instead of breaking. The difference between a usable kill switch and one that causes its own incident is almost entirely in that response.',
        },
        {
          type: 'code',
          value: `// agent/tools.js
// A kill switch takes precedence over the frozen decision, but it cannot
// make the tool vanish silently: the model may already have planned with
// it. Returning a handleable error is what allows the replanning.

export function toolsForTurn(conversationState, liveConfig) {
  // Set frozen at the start of the conversation.
  const frozen = conversationState.flags.values.toolset ?? [];
  // Kill switches are read now, on the current turn.
  const killed = new Set(liveConfig.killedTools ?? []);
  return frozen.filter((tool) => !killed.has(tool.name));
}

export function executeTool(conversationState, liveConfig, call) {
  const killed = new Set(liveConfig.killedTools ?? []);
  if (killed.has(call.name)) {
    // Domain error, not exception: comes back as the tool result so the
    // model can replan within the same turn.
    return {
      ok: false,
      error: 'tool_unavailable',
      message: 'Tool unavailable right now. Proceed without it.',
    };
  }
  return runTool(call);
}`,
        },
      ],
    },
    {
      title: 'Turning it on for a few: choosing who enters without biasing the read',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The percentage is the most visible mechanism of a rollout, but it is rarely where you should start. Before giving five percent of traffic to the new variant, it is worth running on an explicit list: internal accounts, the support team, a customer who agreed to test. That phase catches the gross error, the one that shows up on the first conversation, without spending a single real customer. The explicit list also has to be handled separately in the analysis, because whoever knows they are testing behaves differently and contaminates any quality metric.',
        },
        {
          type: 'paragraph',
          value:
            'When the percentage kicks in, the concern is what the slice represents. A five percent rollout over all traffic picks up frequent topics in greater proportion and almost never the rare ones, which are exactly where the new behavior tends to fail. Segmenting before drawing helps: applying the slice within a support type, a time of day or a customer segment gives a sample that represents that cut, instead of a sample dominated by the most common case. And there is the inverse cut, the most important of all: not every conversation should be eligible. A customer in the middle of a cancellation, a conversation that already went through escalation, a conversation marked as sensitive, all of those stay out by explicit decision, not by luck of the hash.',
        },
        {
          type: 'diagram',
          value: `Eligibility before the draw, decided once

  new conversation
       |
       v
  [ eligible? ]  sensitive account / already escalated / cancellation
       |  no -> fallback (never enters the experiment)
       v yes
  [ on the allowlist? ]  internal / pilot customer
       |  yes -> new variant (marked as not-a-sample)
       v no
  [ hash(conversationId + flagKey) % 100 < rolloutPct ]
       |  yes -> new variant     -> written to the state
       |  no  -> stable variant  -> written to the state
       v
  turns 2..N read the state, they do not re-evaluate

  changing rolloutPct from here on:
    affects only NEW conversations; live ones stay where they are`,
        },
        {
          type: 'paragraph',
          value:
            'The corollary of freezing is that raising the percentage converts nobody. Going from five to twenty percent, the conversations already running stay where they were, and only the new ones feel the change. That is desirable, but it has an operational consequence: the effect of an increase takes time to show up in the metrics, because it takes the average lifetime of a conversation until the new slice is actually represented. Raising the percentage and looking at the dashboard ten minutes later measures almost nothing, especially in asynchronous channels where a conversation may stay open for days.',
        },
      ],
    },
    {
      title: 'Turning off the bad variant without interrupting whoever is inside it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When the new variant turns out to be bad, there are three possible policies for the conversations already on it, and choosing wrong turns one problem into two. Letting them all finish is the most coherent and the slowest: the damage keeps happening, limited to the slice, until the last conversation closes. Converting everyone to the stable variant now is the fastest and the most violent: an agent that announced a tool or promised a format may not be able to deliver, and the customer sees the change. The third one, which is usually the right answer, is conversion at a safe point: the conversation stays on the new variant until it reaches a state where the swap contradicts nothing, typically right after a complete answer and before the next turn, and migrates there.',
        },
        {
          type: 'ordered',
          items: [
            'Block the entrance first: zero the slice so no new conversation lands on the bad variant. That is instant and breaks nobody.',
            'Classify the damage: if the variant produces dangerous answers or executes the wrong action, it is a kill switch and live conversations must stop now, accepting the incoherence.',
            'If the damage is about quality and not safety, mark the live conversations for conversion at a safe point instead of swapping mid-turn.',
            'Define the safe point by state, not by time: after a final answer has been delivered, with no pending tool call and no open plan.',
            'Record the conversion in the conversation state, with the reason and the moment, so the analysis does not mix the old stretch with the new one in the same sample.',
            'On conversion, inject a short note into the context saying the capability changed, so the model does not reaffirm something it promised under the previous variant.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Conversion at a safe point requires the conversation to be able to say whether it is at a safe point, which is another way of saying the agent state has to be explicit. If the system cannot answer "is there a pending tool call" or "is there an open plan", the only honest policy is to let it finish, because any conversion would be blind. That is usually the decisive argument for modeling the agent state as a small readable machine instead of leaving it implicit in the message history: without it, the rollback has no middle option between waiting and breaking.',
        },
      ],
    },
    {
      title: 'Measuring the variant: without per-conversation attribution, the rollout is faith',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A flag is only worth it if the comparison between variants is trustworthy, and in an agent most of the useful metrics only exist at the conversation level. Cost per answer misleads because the new variant may spend more per turn and resolve in fewer turns, coming out cheaper overall. Quality per message misleads for the same reason. The metrics that decide are outcome metrics: was the conversation resolved without a human, how many turns did it take, how much did it cost from start to finish, did the customer come back within hours with the same topic. All of them need the variant stored in the conversation record so they can be broken down by side.',
        },
        {
          type: 'table',
          columns: ['Metric', 'Correct unit', 'Why the wrong unit lies'],
          rows: [
            [
              'Cost',
              'Sum over the whole conversation',
              'Per turn, the variant that resolves in fewer turns looks expensive',
            ],
            [
              'Resolution without a human',
              'Conversation outcome',
              'Per message it does not exist: escalation is a single event at the end',
            ],
            [
              'Latency',
              'Percentile per turn, compared only between equivalent turns',
              'An average across variants with different turn counts compares different things',
            ],
            [
              'Customer return',
              'Window after the conversation closes',
              'Inside the conversation it does not show: the problem returns later, in another contact',
            ],
            [
              'Tool error',
              'Per conversation, counting whether there was at least one',
              'Per call, a noisy retry becomes ten errors and dominates the total',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A trap specific to agents is the conversation that crosses a configuration change. If it started under version two of the flag and was converted under version three, it belongs cleanly to neither side, and including it in either group dirties the comparison. The honest path is to mark those conversations as contaminated and analyze them separately: if there are few, they leave the main sample; if there are many, that is itself the signal that changes are happening too fast for the lifetime of the conversations, and the rollout needs to slow down instead of continuing to produce data nobody can read.',
        },
        {
          type: 'code',
          value: `// analytics/variant.js
// Per-conversation attribution: the variant is a field of the outcome,
// not a field of each message. A conversation that crossed a config
// change belongs to no side and leaves the main sample.

export function conversationOutcome(state) {
  const flags = state.flags ?? {};
  const converted = Boolean(state.flagConversion);

  return {
    conversationId: state.id,
    variant: flags.values?.agentFlow ?? 'stable',
    configVersion: flags.configVersion ?? null,
    // Mark the contamination instead of dropping it silently: the volume
    // of contaminated ones is itself a signal about the rollout pace.
    contaminated: converted,
    resolvedWithoutHuman: state.escalatedAt == null,
    turns: state.turns.length,
    totalCostUsd: state.turns.reduce((sum, t) => sum + (t.costUsd ?? 0), 0),
    toolErrored: state.turns.some((t) => t.toolError === true),
    closedAt: state.closedAt,
  };
}

// The comparison uses only the uncontaminated ones; the rest become a
// report of their own, useful to decide whether the rollout is too fast.
export function compareVariants(outcomes) {
  const clean = outcomes.filter((o) => !o.contaminated && o.closedAt != null);
  const byVariant = new Map();
  for (const o of clean) {
    const g = byVariant.get(o.variant) ?? { n: 0, resolved: 0, cost: 0, turns: 0 };
    g.n += 1;
    g.resolved += o.resolvedWithoutHuman ? 1 : 0;
    g.cost += o.totalCostUsd;
    g.turns += o.turns;
    byVariant.set(o.variant, g);
  }
  return [...byVariant].map(([variant, g]) => ({
    variant,
    conversations: g.n,
    resolutionRate: g.resolved / g.n,
    avgCostUsd: g.cost / g.n,
    avgTurns: g.turns / g.n,
  }));
}`,
        },
      ],
    },
    {
      title: 'Hygiene: the temporary flag that became permanent architecture',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Agent flags rot faster than ordinary flags because each one forks the entire behavior, not a snippet. Two flow flags already produce four combinations of prompt, tools and escalation policy, and nobody tested all four. Three produce eight. Since the effect of each one only shows up in a real conversation, the combination nobody tested is also the one nobody can reproduce when a customer complains. That is why a flow flag needs a deadline from birth: an expiration date declared in the configuration itself and an alert when it passes, treating an expired flag as visible debt instead of a forgotten if.',
        },
        {
          type: 'list',
          items: [
            'Declare the expiration date next to the flag and have CI complain when it passes, the same way it would complain about a broken test.',
            'Cap how many flow flags can be open at the same time: each one multiplies the combinations nobody tested.',
            'When you reach a hundred percent, remove the old branch in the same cycle. A flag at a hundred percent that stays around is dead code that can still be switched on by mistake.',
            'Keep the flag value in the state of closed conversations even after removing the flag from the code, or the historical analysis loses the slice.',
            'Never nest one flow flag inside another: if the new behavior depends on the other new behavior, it is one flag with two steps.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Removal is also a stateful operation. Deleting the flag from the code while there are live conversations that wrote it into their state makes the reader fall back mid-conversation, exactly the unannounced swap that freezing existed to prevent. The safe order is the inverse of the introduction: first take the slice to a hundred percent and wait out the lifetime of the conversations, then make the new branch the default behavior without consulting the flag, and only then delete the configuration. The field stored in the old conversations stays there, harmless, and it is what keeps the historical analysis possible.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why not evaluate the feature flag on every agent turn, the way I do on an endpoint?',
      answer:
        'Because the agent unit of work is the conversation, not the request, and state crosses the turns. Evaluating on every turn, a percentage change or an unanchored draw make the same customer land on the new variant in one message and the old one in the next: the agent changes tone, contradicts what it promised earlier and may offer an action that does not exist in the other variant. Worse, if the tool set changes midway, the model may have planned a sequence that is no longer possible. The way out is to resolve every flow flag exactly once, at conversation creation, store the result alongside the state and have later turns read that frozen value instead of asking the flag service again. That way neither a rollout change nor an outage of the service can alter the behavior mid-conversation.',
    },
    {
      question: 'How do you turn off a bad variant without breaking the conversations already on it?',
      answer:
        'In two separate steps. The first is always the same and is instant: zero the slice so no new conversation enters the bad variant, which affects nobody already inside. The second depends on the type of damage. If the variant produces dangerous answers or executes the wrong action, it is a kill switch case and live conversations must stop now, accepting the incoherence as the price; in that case a removed tool should return a handleable unavailable error to the model rather than vanishing silently, so it can replan. If the damage is about quality and not safety, the better path is conversion at a safe point: the conversation stays on the new variant until it reaches a state where the swap contradicts nothing, typically after a final answer has been delivered, with no pending tool call and no open plan, and migrates there, with the conversion recorded in the state.',
    },
    {
      question: 'What is the right metric to compare two agent flow variants?',
      answer:
        'The outcome ones, measured per whole conversation, not per message. Cost per turn misleads because the new variant may spend more on each turn and resolve in fewer turns, coming out cheaper overall; the number that decides is the cost summed from the start to the end of the conversation. Likewise, resolution without a human is a single event at the outcome and does not exist per message, and the customer returning with the same topic only shows up in a window after the close. Tool error should be counted as "there was at least one" per conversation, otherwise a noisy retry becomes ten errors and dominates the total. For all of this to work, the variant has to be stored in the conversation record, and conversations that crossed a configuration change have to be marked as contaminated and analyzed separately.',
    },
  ],
  conclusion: {
    title: 'The agent flag belongs to the conversation, not to the turn',
    description:
      'An agent flow breaks the two premises that make an ordinary feature flag cheap: the decision does not end with the request and state crosses the turns. Resolving the flag once at conversation creation, anchored on the conversation identifier and stored alongside the state, gives consistency for free and makes a rollout change affect only new conversations. Separating frozen flags from dynamic ones and from the kill switch defines what may flip midway, and conversion at a safe point gives the middle option between waiting and breaking when a variant turns out bad. With the variant stored in the outcome and contaminated conversations kept out of the sample, comparing sides starts to mean something. I can set up this rollout control in your agent flow, from freezing at conversation creation to per-outcome attribution, so you can turn new behavior on for a few without learning about the problem from the customer.',
    cta: 'Talk about controlled rollout in my agent flow',
  },
  related: [
    {
      label: 'Versioning the prompt as code: rollout, rollback and testing',
      to: '/blog/versionar-prompt-como-codigo-rollout-rollback-teste',
    },
    {
      label: 'Orchestrating AI agents in production',
      to: '/blog/orquestracao-agentes-ia-producao',
    },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
};

const es = {
  intro:
    'La flag existe justamente porque nadie tiene la certeza de que el comportamiento nuevo funcione, y en un servicio tradicional eso es barato: la petición entra, el if decide, la respuesta sale, y si la variante nueva es mala apagas la llave y la siguiente petición ya nace curada. En un flujo de agente nada de eso vale. La unidad de trabajo no es la petición, es la conversación, que dura minutos o días, guarda estado entre los turnos y a veces ya ejecutó una herramienta con efecto en el mundo real. Evaluar la flag en cada turno hace que el agente cambie de personalidad a mitad de la atención, pierda herramientas que ya anunció al modelo y produzca un historial donde la mitad de los mensajes siguió una regla y la otra mitad siguió otra. Este artículo muestra por qué la flag en el agente debe decidirse una vez y congelarse en la conversación, cómo elegir el punto de evaluación, cómo separar las flags que pueden cambiar a mitad de las que no, cómo matar la variante mala sin interrumpir a quien está en medio de ella y qué registrar para que la comparación entre variantes signifique algo.',
  sections: [
    {
      title: 'Por qué la flag del agente no se parece a la flag de un endpoint',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una feature flag común protege un trozo de código sin estado: el efecto de la decisión empieza y termina dentro de la misma petición. Si la variante nueva responde mal, el daño se limita a esa respuesta, y girar la llave arregla todo lo que venga después. Un flujo de agente rompe las dos premisas al mismo tiempo. La decisión del turno tres depende de lo que el agente dijo en el turno uno, de las herramientas que el modelo vio declaradas, del resumen que quedó grabado en la memoria de la conversación y, si hubo tool use, de un efecto que ya ocurrió afuera. Activar un comportamiento nuevo aquí no es cambiar una rama del if, es cambiar las reglas de un juego que ya está en marcha.',
        },
        {
          type: 'paragraph',
          value:
            'El síntoma más común es el agente esquizofrénico: la flag se evalúa en cada turno, el rollout está en veinte por ciento, y el mismo cliente cae en la variante nueva en un mensaje y en la vieja en el siguiente porque el sorteo fue aleatorio en vez de anclado. El agente cambia de tono, contradice lo que él mismo prometió dos mensajes atrás y a veces ofrece una acción que en la variante vieja no existe. Incluso con ancla determinista por conversación queda el segundo síntoma, más silencioso: el rollout cambia de porcentaje mientras hay conversaciones vivas, y una conversación que empezó en la variante nueva de pronto pasa a ser resuelta por la vieja, sobre un historial que ya asumía el comportamiento nuevo. La flag correcta en el agente no responde "qué variante ahora", responde "qué variante usa esta conversación desde que empezó".',
        },
        {
          type: 'table',
          columns: ['Dimensión', 'Flag en endpoint', 'Flag en flujo de agente'],
          rows: [
            [
              'Unidad de decisión',
              'La petición, sin estado entre ellas',
              'La conversación entera, con estado acumulado entre turnos',
            ],
            [
              'Cuándo evaluar',
              'En cada llamada, reevaluar no cuesta nada',
              'Una vez, al crear la conversación, y congelar el resultado',
            ],
            [
              'Efecto de girar la llave',
              'La siguiente petición ya usa el valor nuevo',
              'Las conversaciones en curso siguen en la variante que eligieron',
            ],
            [
              'Daño de una variante mala',
              'Limitado a la respuesta equivocada de esa llamada',
              'Estado corrompido, herramienta ya ejecutada, historial inconsistente',
            ],
            [
              'Rollback',
              'Apagar la flag resuelve todo',
              'Apagarla impide conversaciones nuevas; las vivas necesitan política propia',
            ],
          ],
        },
      ],
    },
    {
      title: 'Decidir una vez: la flag se resuelve al crear la conversación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La inversión que resuelve la mayor parte de los problemas es mover la evaluación de la flag del turno al inicio de la conversación. En el primer contacto, el sistema resuelve todas las flags relevantes de una vez, graba el resultado junto al estado de la conversación y nunca más pregunta al servicio de flags durante esa atención. El turno tres lee la decisión grabada, no la recalcula. Eso da consistencia gratis: el agente no puede cambiar de comportamiento a mitad porque la variante ya está escrita en el estado, y ni un cambio de rollout ni una indisponibilidad del servicio de flags logran alterarla.',
        },
        {
          type: 'paragraph',
          value:
            'El ancla del sorteo debe ser el identificador de la conversación, no el del usuario ni un número aleatorio. El identificador del usuario parece atractivo porque da consistencia entre conversaciones, pero ata al cliente a la misma variante para siempre y sesga la comparación: si un cliente heavy user cayó en la variante nueva, todas sus conversaciones difíciles cuentan para el mismo lado. Anclar en la conversación distribuye mejor y además permite que el mismo cliente participe de las dos variantes a lo largo del tiempo. El aleatorio puro es el peor de los tres porque pierde la reproducibilidad: con un hash del identificador de la conversación recalculas la decisión en cualquier lugar del sistema y siempre llegas al mismo resultado, lo que salva el análisis cuando el campo grabado se pierde.',
        },
        {
          type: 'code',
          value: `// agent/flags.js
// La flag del agente se resuelve UNA VEZ, al crear la conversacion, y el
// resultado pasa a ser parte del estado. Los turnos siguientes leen,
// nunca reevaluan.

import { createHash } from 'node:crypto';

// Ancla determinista en la conversacion: misma conversacion, mismo
// bucket, en cualquier instancia y en cualquier momento futuro.
function bucketOf(conversationId, flagKey) {
  const h = createHash('sha256').update(flagKey + ':' + conversationId).digest();
  return h.readUInt16BE(0) % 100; // 0..99
}

// Llamada solo en el primer turno, cuando se crea la conversacion.
export function resolveFlagsForConversation(config, conversationId, context) {
  const decided = {};
  for (const [key, flag] of Object.entries(config)) {
    if (!flag.enabled) {
      decided[key] = flag.fallback;
      continue;
    }
    // Objetivos explicitos (cliente interno, cuenta de prueba) saltan la porcion.
    if (flag.allowlist?.includes(context.accountId)) {
      decided[key] = flag.variant;
      continue;
    }
    decided[key] = bucketOf(conversationId, key) < flag.rolloutPct
      ? flag.variant
      : flag.fallback;
  }
  // Guardado junto al estado de la conversacion: esto es lo que leen los turnos.
  return { decidedAt: context.now, configVersion: config.version, values: decided };
}

// Turnos 2..N: leen la decision congelada. Si falta, la conversacion es
// antigua y nacio antes de la flag: cae al fallback, nunca sortea de nuevo.
export function flagValue(conversationState, key, fallback) {
  return conversationState.flags?.values?.[key] ?? fallback;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Conviene registrar junto a la decisión la versión de la configuración que la produjo. Sin eso, una conversación iniciada el lunes y otra iniciada el miércoles pueden haber caído en la misma variante por motivos distintos, y el análisis no logra separar las dos poblaciones cuando alguien tocó el porcentaje en el medio. Con la versión grabada, cada conversación lleva la prueba de qué configuración la decidió, y el corte por versión se vuelve una consulta trivial.',
        },
      ],
    },
    {
      title: 'No toda flag puede congelarse: separa las tres familias',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Congelar todo al crear la conversación sería simple, pero está mal para una parte de las flags. Un kill switch de seguridad que solo puede congelarse es inútil: si el comportamiento nuevo está generando una respuesta peligrosa, necesitas que pare ahora, incluso en las conversaciones en curso. La regla práctica es clasificar cada flag por una pregunta: ¿un cambio a mitad de la conversación rompe la coherencia de lo que ya se dijo o se ejecutó? Si sí, se congela. Si no, puede ser dinámica. Y existe una tercera familia, la que debe ser dinámica aun rompiendo la coherencia, porque la alternativa es peor.',
        },
        {
          type: 'table',
          columns: ['Familia', 'Cuándo evaluar', 'Ejemplos', 'Riesgo de cambiar a mitad'],
          rows: [
            [
              'Congelada en la conversación',
              'Una vez, al crearla, grabada en el estado',
              'Prompt de sistema, conjunto de herramientas, política de escalonamiento, formato de respuesta',
              'Alto: contradice el historial, invalida herramienta ya anunciada',
            ],
            [
              'Dinámica por turno',
              'En cada turno, leyendo el valor actual',
              'Enrutamiento de modelo, límite de tokens, timeout, tamaño del retrieval',
              'Bajo: cambia el costo y la latencia, no la semántica de lo dicho',
            ],
            [
              'Kill switch',
              'En cada turno, con precedencia sobre la congelada',
              'Apagar una herramienta peligrosa, cortar un comportamiento que generó incidente',
              'Aceptado a propósito: parar ahora vale más que la coherencia',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El detalle que suele pasar desapercibido es la herramienta declarada. Cuando el agente anuncia al modelo un conjunto de herramientas en el turno uno y la flag quita una de ellas en el turno tres, el modelo puede haber planeado una secuencia que ya no existe, y el resultado es una llamada a una herramienta desconocida o un plan abandonado a mitad. Si la remoción vino de un kill switch, lo correcto no es hacer desaparecer la herramienta en silencio: es devolver al modelo un error explícito y manejable, del tipo "esta herramienta no está disponible ahora", para que replanifique en vez de romperse. La diferencia entre un kill switch usable y uno que genera su propio incidente está casi toda en esa respuesta.',
        },
        {
          type: 'code',
          value: `// agent/tools.js
// El kill switch tiene precedencia sobre la decision congelada, pero no
// puede hacer desaparecer la herramienta en silencio: el modelo ya pudo
// haber planeado con ella. Devolver un error manejable es lo que permite
// la replanificacion.

export function toolsForTurn(conversationState, liveConfig) {
  // Conjunto congelado al inicio de la conversacion.
  const frozen = conversationState.flags.values.toolset ?? [];
  // Los kill switches se leen ahora, en el turno actual.
  const killed = new Set(liveConfig.killedTools ?? []);
  return frozen.filter((tool) => !killed.has(tool.name));
}

export function executeTool(conversationState, liveConfig, call) {
  const killed = new Set(liveConfig.killedTools ?? []);
  if (killed.has(call.name)) {
    // Error de dominio, no excepcion: vuelve como resultado de la
    // herramienta para que el modelo replanifique dentro del mismo turno.
    return {
      ok: false,
      error: 'tool_unavailable',
      message: 'Herramienta no disponible ahora. Continua sin ella.',
    };
  }
  return runTool(call);
}`,
        },
      ],
    },
    {
      title: 'Activar para pocos: elegir quién entra sin sesgar la lectura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El porcentaje es el mecanismo más visible del rollout, pero rara vez es por donde se debe empezar. Antes de dar cinco por ciento del tráfico a la variante nueva, conviene correrla en una lista explícita: cuentas internas, el equipo de soporte, un cliente que aceptó probar. Esa fase atrapa el error grueso, el que aparece en la primera conversación, sin gastar ningún cliente real. La lista explícita también debe tratarse aparte en el análisis, porque quien sabe que está probando se comporta distinto y contamina cualquier métrica de calidad.',
        },
        {
          type: 'paragraph',
          value:
            'Cuando entra el porcentaje, el cuidado está en qué representa la porción. Un rollout de cinco por ciento sobre todo el tráfico agarra en mayor proporción los asuntos frecuentes y casi nunca los raros, que son justamente donde el comportamiento nuevo suele fallar. Segmentar antes de sortear ayuda: aplicar la porción dentro de un tipo de atención, de un horario o de un segmento de cliente da una muestra que representa ese recorte, en vez de una muestra dominada por el caso más común. Y existe el recorte inverso, el más importante de todos: no toda conversación debe ser elegible. Un cliente en proceso de cancelación, una atención que ya pasó por escalonamiento, una conversación marcada como sensible, todos esos quedan fuera por decisión explícita, no por suerte del hash.',
        },
        {
          type: 'diagram',
          value: `Elegibilidad antes del sorteo, decidida una vez

  nueva conversacion
       |
       v
  [ es elegible? ]  cuenta sensible / ya escalada / cancelacion
       |  no -> fallback (nunca entra al experimento)
       v si
  [ esta en la allowlist? ]  interno / cliente piloto
       |  si -> variante nueva (marcado como no-muestra)
       v no
  [ hash(conversationId + flagKey) % 100 < rolloutPct ]
       |  si -> variante nueva    -> se graba en el estado
       |  no -> variante estable  -> se graba en el estado
       v
  turnos 2..N leen el estado, no reevaluan

  cambiar rolloutPct de aqui en adelante:
    afecta solo a conversaciones NUEVAS; las vivas quedan donde estan`,
        },
        {
          type: 'paragraph',
          value:
            'El corolario del congelamiento es que subir el porcentaje no convierte a nadie. Al pasar de cinco a veinte por ciento, las conversaciones que ya estaban corriendo siguen donde estaban, y solo las nuevas sienten el cambio. Eso es deseable, pero tiene una consecuencia operativa: el efecto de un aumento tarda en aparecer en las métricas, porque lleva el tiempo de vida medio de una conversación hasta que la porción nueva esté de hecho representada. Subir el porcentaje y mirar el panel diez minutos después mide casi nada, sobre todo en canales asíncronos donde una conversación puede quedar abierta días.',
        },
      ],
    },
    {
      title: 'Apagar la variante mala sin interrumpir a quien está en medio de ella',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando la variante nueva se muestra mala, hay tres políticas posibles para las conversaciones que ya están en ella, y elegir mal transforma un problema en dos. Dejar que todas terminen es la opción más coherente y la más lenta: el daño sigue ocurriendo, limitado a la porción, hasta que cierre la última conversación. Convertir a todos a la variante estable ahora es lo más rápido y lo más violento: un agente que anunció una herramienta o prometió un formato puede no lograr cumplirlo, y el cliente ve el cambio. La tercera, que suele ser la respuesta correcta, es la conversión en punto seguro: la conversación sigue en la variante nueva hasta llegar a un estado donde el cambio no contradice nada, típicamente justo después de una respuesta completa y antes del siguiente turno, y ahí migra.',
        },
        {
          type: 'ordered',
          items: [
            'Bloquea la entrada primero: pon la porción en cero para que ninguna conversación nueva caiga en la variante mala. Eso es instantáneo y no rompe a nadie.',
            'Clasifica el daño: si la variante genera respuesta peligrosa o ejecuta acción equivocada, es kill switch y las conversaciones vivas deben parar ahora, aceptando la incoherencia.',
            'Si el daño es de calidad y no de seguridad, marca las conversaciones vivas para conversión en punto seguro en vez de cambiar a mitad de un turno.',
            'Define el punto seguro por el estado, no por el tiempo: después de una respuesta final entregada, sin tool call pendiente y sin plan abierto.',
            'Registra la conversión en el estado de la conversación, con el motivo y el instante, para que el análisis no mezcle el tramo viejo con el nuevo en la misma muestra.',
            'Al convertir, inyecta en el contexto una nota corta de que la capacidad cambió, para que el modelo no reafirme algo que prometió bajo la variante anterior.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La conversión en punto seguro exige que la conversación sepa decir si está en un punto seguro, que es otra forma de decir que el estado del agente debe ser explícito. Si el sistema no logra responder "hay tool call pendiente" o "hay plan abierto", la única política honesta es dejar terminar, porque cualquier conversión será a ciegas. Ese suele ser el argumento decisivo para modelar el estado del agente como una máquina pequeña y legible en vez de dejarlo implícito en el historial de mensajes: sin eso, el rollback queda sin opción intermedia entre esperar y romper.',
        },
      ],
    },
    {
      title: 'Medir la variante: sin atribución por conversación, el rollout es fe',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La flag solo vale si la comparación entre variantes es confiable, y en el agente la mayoría de las métricas útiles solo existe a nivel de conversación. Costo por respuesta engaña porque la variante nueva puede gastar más por turno y resolver en menos turnos, saliendo más barata en total. Calidad por mensaje engaña por el mismo motivo. Las métricas que deciden son de desenlace: la conversación se resolvió sin humano, cuántos turnos llevó, cuánto costó de principio a fin, si el cliente volvió en las horas siguientes con el mismo asunto. Todas necesitan la variante grabada en el registro de la conversación para poder desglosarse por lado.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Unidad correcta', 'Por qué la unidad equivocada miente'],
          rows: [
            [
              'Costo',
              'Suma de toda la conversación',
              'Por turno, la variante que resuelve en menos turnos parece cara',
            ],
            [
              'Resolución sin humano',
              'Desenlace de la conversación',
              'Por mensaje no existe: el escalonamiento es un evento único al final',
            ],
            [
              'Latencia',
              'Percentil por turno, comparado solo entre turnos equivalentes',
              'Un promedio entre variantes con distinta cantidad de turnos compara cosas distintas',
            ],
            [
              'Retorno del cliente',
              'Ventana después del cierre de la conversación',
              'Dentro de la conversación no aparece: el problema vuelve después, en otra atención',
            ],
            [
              'Error de herramienta',
              'Por conversación, contando si hubo al menos uno',
              'Por llamada, un retry ruidoso se vuelve diez errores y domina el total',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Una trampa específica del agente es la conversación que atraviesa un cambio de configuración. Si empezó bajo la versión dos de la flag y fue convertida bajo la versión tres, no pertenece limpiamente a ninguno de los dos lados, e incluirla en cualquiera de los grupos ensucia la comparación. El camino honesto es marcar esas conversaciones como contaminadas y analizarlas aparte: si son pocas, salen de la muestra principal; si son muchas, eso en sí es la señal de que los cambios están ocurriendo demasiado rápido para el tiempo de vida de las conversaciones, y el rollout necesita desacelerar en vez de seguir produciendo datos que nadie logra leer.',
        },
        {
          type: 'code',
          value: `// analytics/variant.js
// Atribucion por conversacion: la variante es un campo del desenlace, no
// un campo de cada mensaje. Una conversacion que atraveso un cambio de
// config no pertenece a ningun lado y sale de la muestra principal.

export function conversationOutcome(state) {
  const flags = state.flags ?? {};
  const converted = Boolean(state.flagConversion);

  return {
    conversationId: state.id,
    variant: flags.values?.agentFlow ?? 'stable',
    configVersion: flags.configVersion ?? null,
    // Marca la contaminacion en vez de descartar en silencio: el volumen
    // de contaminadas es por si solo una senal sobre el ritmo del rollout.
    contaminated: converted,
    resolvedWithoutHuman: state.escalatedAt == null,
    turns: state.turns.length,
    totalCostUsd: state.turns.reduce((sum, t) => sum + (t.costUsd ?? 0), 0),
    toolErrored: state.turns.some((t) => t.toolError === true),
    closedAt: state.closedAt,
  };
}

// La comparacion usa solo las no contaminadas; las demas se vuelven un
// reporte propio, util para decidir si el rollout va demasiado rapido.
export function compareVariants(outcomes) {
  const clean = outcomes.filter((o) => !o.contaminated && o.closedAt != null);
  const byVariant = new Map();
  for (const o of clean) {
    const g = byVariant.get(o.variant) ?? { n: 0, resolved: 0, cost: 0, turns: 0 };
    g.n += 1;
    g.resolved += o.resolvedWithoutHuman ? 1 : 0;
    g.cost += o.totalCostUsd;
    g.turns += o.turns;
    byVariant.set(o.variant, g);
  }
  return [...byVariant].map(([variant, g]) => ({
    variant,
    conversations: g.n,
    resolutionRate: g.resolved / g.n,
    avgCostUsd: g.cost / g.n,
    avgTurns: g.turns / g.n,
  }));
}`,
        },
      ],
    },
    {
      title: 'Higiene: la flag temporal que se volvió arquitectura permanente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La flag de agente se pudre más rápido que la flag común porque cada una bifurca el comportamiento entero, no un trozo. Dos flags de flujo ya dan cuatro combinaciones de prompt, herramientas y política de escalonamiento, y nadie probó las cuatro. Tres dan ocho. Como el efecto de cada una solo aparece en conversación real, la combinación que nadie probó es también la que nadie logra reproducir cuando un cliente reclama. Por eso la flag de flujo necesita plazo desde el nacimiento: una fecha de expiración declarada en la propia configuración y una alerta cuando pase, tratando la flag vencida como deuda visible en vez de un if olvidado.',
        },
        {
          type: 'list',
          items: [
            'Declara la fecha de expiración junto a la flag y haz que el CI reclame cuando venza, del mismo modo que reclamaría por una prueba rota.',
            'Limita cuántas flags de flujo pueden estar abiertas al mismo tiempo: cada una multiplica las combinaciones que nadie probó.',
            'Al llegar a cien por ciento, elimina la rama vieja en el mismo ciclo. Una flag en cien por ciento que permanece es código muerto que todavía puede activarse por error.',
            'Guarda el valor de la flag en el estado de las conversaciones cerradas incluso después de quitar la flag del código, si no el análisis histórico pierde el corte.',
            'Nunca anides una flag de flujo dentro de otra: si el comportamiento nuevo depende del otro comportamiento nuevo, es una sola flag con dos etapas.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La remoción también es una operación con estado. Borrar la flag del código mientras hay conversaciones vivas que la grabaron en el estado hace que el lector caiga al fallback a mitad de la atención, exactamente el cambio no anunciado que el congelamiento existía para evitar. El orden seguro es el inverso de la introducción: primero lleva la porción a cien por ciento y espera a que pase el tiempo de vida de las conversaciones, después vuelve la rama nueva el comportamiento por defecto sin consultar la flag, y solo entonces borra la configuración. El campo grabado en las conversaciones viejas sigue ahí, inofensivo, y es lo que mantiene posible el análisis histórico.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué no evaluar la feature flag en cada turno del agente, como hago en un endpoint?',
      answer:
        'Porque la unidad de trabajo del agente es la conversación, no la petición, y el estado atraviesa los turnos. Evaluando en cada turno, un cambio de porcentaje o un sorteo no anclado hacen que el mismo cliente caiga en la variante nueva en un mensaje y en la vieja en el siguiente: el agente cambia de tono, contradice lo que prometió antes y puede ofrecer una acción que en la otra variante no existe. Peor, si el conjunto de herramientas cambia a mitad, el modelo puede haber planeado una secuencia que dejó de ser posible. La salida es resolver todas las flags de flujo una única vez, al crear la conversación, grabar el resultado junto al estado y hacer que los turnos siguientes lean ese valor congelado en vez de preguntar de nuevo al servicio de flags. Así ni un cambio de rollout ni una indisponibilidad del servicio logran cambiar el comportamiento a mitad de la atención.',
    },
    {
      question: '¿Cómo apagar una variante mala sin romper las conversaciones que ya están en ella?',
      answer:
        'En dos etapas separadas. La primera es siempre la misma y es instantánea: poner la porción en cero para que ninguna conversación nueva entre en la variante mala, lo que no afecta a nadie que ya esté dentro. La segunda depende del tipo de daño. Si la variante genera respuesta peligrosa o ejecuta acción equivocada, es caso de kill switch y las conversaciones vivas deben parar ahora, aceptando la incoherencia como precio; en ese caso, una herramienta removida debe devolver al modelo un error manejable del tipo no disponible, y no desaparecer en silencio, para que replanifique. Si el daño es de calidad y no de seguridad, lo mejor es la conversión en punto seguro: la conversación sigue en la variante nueva hasta llegar a un estado donde el cambio no contradice nada, típicamente tras una respuesta final entregada, sin tool call pendiente y sin plan abierto, y migra ahí, con la conversión registrada en el estado.',
    },
    {
      question: '¿Cuál es la métrica correcta para comparar dos variantes de flujo de agente?',
      answer:
        'Las de desenlace, medidas por conversación entera, no por mensaje. Costo por turno engaña porque la variante nueva puede gastar más en cada turno y resolver en menos turnos, saliendo más barata en total; el número que decide es el costo sumado del principio al fin de la conversación. Del mismo modo, la resolución sin humano es un evento único en el desenlace y no existe por mensaje, y el retorno del cliente con el mismo asunto solo aparece en una ventana después del cierre. El error de herramienta debe contarse como "hubo al menos uno" por conversación, si no un retry ruidoso se vuelve diez errores y domina el total. Para que todo eso funcione, la variante debe estar grabada en el registro de la conversación, y las conversaciones que atravesaron un cambio de configuración deben marcarse como contaminadas y analizarse aparte.',
    },
  ],
  conclusion: {
    title: 'La flag del agente pertenece a la conversación, no al turno',
    description:
      'Un flujo de agente rompe las dos premisas que vuelven barata a la feature flag común: la decisión no termina en la petición y el estado atraviesa los turnos. Resolver la flag una vez al crear la conversación, anclada en el identificador de esta y grabada junto al estado, da consistencia gratis y hace que un cambio de rollout afecte solo a las conversaciones nuevas. Separar las flags congeladas de las dinámicas y del kill switch define qué puede cambiar a mitad, y la conversión en punto seguro da la opción intermedia entre esperar y romper cuando la variante se muestra mala. Con la variante grabada en el desenlace y las conversaciones contaminadas fuera de la muestra, la comparación entre lados pasa a significar algo. Puedo montar ese control de rollout en tu flujo de agente, del congelamiento al crear la conversación a la atribución por desenlace, para que actives comportamiento nuevo para pocos sin enterarte del problema por el cliente.',
    cta: 'Hablar sobre rollout controlado en mi flujo de agente',
  },
  related: [
    {
      label: 'Versionar el prompt como código: rollout, rollback y prueba',
      to: '/blog/versionar-prompt-como-codigo-rollout-rollback-teste',
    },
    {
      label: 'Orquestación de agentes de IA en producción',
      to: '/blog/orquestracao-agentes-ia-producao',
    },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

export default { pt, en, es };
