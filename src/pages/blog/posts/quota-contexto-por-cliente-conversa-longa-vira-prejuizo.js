// Conteudo do artigo: quota de contexto por cliente, quando a conversa longa vira prejuizo.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O custo de uma conversa não cresce de forma linear com o número de mensagens: ele cresce mais rápido, porque a cada turno o histórico inteiro volta para dentro do prompt. Uma conversa de quarenta turnos não custa quarenta vezes a de um turno, custa muito mais, e o cliente que mais escreve costuma ser exatamente o que menos paga. O sintoma clássico aparece no fechamento do mês: a fatura subiu trinta por cento, o número de conversas ficou igual, e ninguém sabe explicar a diferença. A explicação quase sempre é uma minoria de conversas que ficaram longas demais e nunca encontraram um limite. Este artigo mostra por que o custo por conversa é quadrático e não linear, como definir uma quota de contexto por cliente que não pune o uso legítimo, como escolher o que sai da janela quando a quota estoura, e por que a decisão final não é técnica: é sobre qual conversa vale a pena continuar carregando.',
  sections: [
    {
      title: 'O custo da conversa longa é quadrático, não linear',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A intuição enganosa é tratar uma conversa como uma lista de mensagens e assumir que o custo total é a soma do custo de cada mensagem. Não é. Num agente com histórico completo, o turno N envia como entrada tudo que foi dito nos turnos anteriores mais a nova mensagem. Se cada turno acrescenta em média K tokens ao histórico, o turno N envia aproximadamente N vezes K tokens de entrada, e o total acumulado depois de N turnos é proporcional a N ao quadrado. É a mesma matemática de uma soma aritmética, e é a razão pela qual dobrar o comprimento da conversa quadruplica o custo dela.',
        },
        {
          type: 'paragraph',
          value:
            'Isso muda completamente onde procurar quando a fatura sobe. Um aumento de dez por cento no número de conversas produz um aumento de dez por cento no custo. Um aumento de dez por cento no comprimento médio das conversas produz um aumento de aproximadamente vinte e um por cento. E como o comprimento médio esconde a distribuição, o cenário mais comum é pior ainda: a média mal se move enquanto uma cauda de conversas muito longas absorve metade do orçamento sozinha.',
        },
        {
          type: 'table',
          columns: ['Turnos na conversa', 'Tokens de entrada no turno', 'Entrada acumulada', 'Custo relativo ao turno 1'],
          rows: [
            ['1', '1.200', '1.200', '1x'],
            ['5', '4.400', '14.000', '11,7x'],
            ['10', '8.400', '48.000', '40x'],
            ['20', '16.400', '176.000', '146x'],
            ['40', '32.400', '672.000', '560x'],
            ['80', '64.400', '2.624.000', '2.186x'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A tabela assume um prompt de sistema de mil tokens, duzentos tokens por mensagem do cliente e da resposta somados, e nenhuma compressão. Os números absolutos mudam com o seu sistema, o formato da curva não muda. O que essa tabela revela é que uma conversa de oitenta turnos custa mais que duzentas conversas de cinco turnos, e que qualquer política de custo que trate as duas como "uma conversa" está medindo a coisa errada. A unidade de cobrança do provedor é o token, então a unidade de controle do seu sistema também precisa ser o token.',
        },
        {
          type: 'paragraph',
          value:
            'Vale registrar a exceção importante: cache de prefixo muda a inclinação, não a forma. Se o histórico é estável e vem no começo do prompt, os tokens já vistos custam uma fração do preço cheio, e o fator de crescimento cai bastante. Mas o cache tem tempo de vida curto, e conversa longa é exatamente o caso em que há pausas de horas entre turnos, que é quando o cache expira. Contar com cache para resolver conversa longa é contar justamente com a condição que a conversa longa quebra.',
        },
      ],
    },
    {
      title: 'Quota é diferente de teto de gasto e de limite de janela',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Três controles se confundem com frequência e resolvem problemas distintos. O limite de janela do modelo é uma restrição técnica: acima dele a chamada falha. O teto de gasto por cliente é uma proteção de margem: acima dele o cliente para de ser atendido ou é degradado. A quota de contexto fica entre os dois e é a que quase ninguém implementa: ela limita quantos tokens de histórico uma conversa específica tem direito de carregar por turno, independentemente de caber na janela e independentemente de o cliente ainda ter orçamento.',
        },
        {
          type: 'table',
          columns: ['Controle', 'Unidade', 'O que protege', 'O que acontece ao estourar'],
          rows: [
            [
              'Limite de janela do modelo',
              'Tokens por chamada',
              'Nada, é restrição física',
              'A chamada falha com erro do provedor',
            ],
            [
              'Rate limit',
              'Requisições por minuto',
              'Capacidade do sistema',
              'A requisição espera na fila ou é rejeitada',
            ],
            [
              'Teto de gasto por cliente',
              'Dinheiro por período',
              'Margem do contrato',
              'O cliente é degradado ou bloqueado',
            ],
            [
              'Quota de contexto por conversa',
              'Tokens de histórico por turno',
              'Custo marginal de continuar',
              'O histórico é comprimido, nunca a conversa',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha carrega a diferença que importa: quando a quota de contexto estoura, a conversa continua. Nenhum cliente é bloqueado, nenhuma mensagem é recusada. O que muda é a quantidade de histórico que o agente carrega para responder, e essa é uma decisão que pode ser tomada sem que o cliente perceba, desde que a escolha do que descartar seja boa. É por isso que a quota de contexto é o controle mais barato politicamente: ela protege margem sem produzir uma conversa difícil com o cliente.',
        },
        {
          type: 'paragraph',
          value:
            'A quota também precisa ser diferenciada por plano, e aqui o erro comum é derivá-la do preço. O critério certo é o valor esperado da conversa, não a mensalidade. Uma conversa de suporte pós-venda de um cliente de plano básico pode valer mais em retenção do que uma consulta de catálogo de um cliente enterprise. Quota por plano é um bom padrão inicial, e quota por tipo de conversa é o refinamento que quase sempre paga.',
        },
      ],
    },
    {
      title: 'Medir antes de limitar: onde o orçamento realmente vai',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de escolher qualquer número, é preciso saber a distribuição real. A métrica que quase todo time tem é o custo médio por conversa, e ela é praticamente inútil aqui porque a média é dominada pela cauda em distribuições assim. As três métricas que decidem a política são outras: a distribuição de comprimento em percentis, a fração do custo total consumida pelo percentil noventa e cinco, e o custo marginal do turno atual em relação ao primeiro turno da mesma conversa.',
        },
        {
          type: 'code',
          value: `// telemetry/context-cost.js
// Instrumenta o custo marginal de cada turno e a concentracao do gasto.
// A pergunta que isso responde: qual fatia do orcamento vive na cauda?

export function createContextMeter({ metrics, priceUsdPerMillion }) {
  // Custo em dolares de uma chamada, separando entrada cacheada de nova.
  // Cache de prefixo custa uma fracao do preco cheio, entao somar tudo
  // como "entrada" superestima a cauda em sistemas com cache ativo.
  function costOf({ freshInputTokens, cachedInputTokens, outputTokens }) {
    const p = priceUsdPerMillion;
    return (
      (freshInputTokens * p.input +
        cachedInputTokens * p.cachedInput +
        outputTokens * p.output) /
      1_000_000
    );
  }

  function recordTurn({ conversationId, tenantId, plan, turnIndex, usage }) {
    const turnCost = costOf(usage);
    const historyTokens = usage.freshInputTokens + usage.cachedInputTokens;

    // Rotular por faixa de turno, nao por turno exato: cardinalidade de
    // rotulo cresce sem limite se o turno virar dimensao da metrica.
    const bucket =
      turnIndex <= 5 ? '1-5' : turnIndex <= 15 ? '6-15' : turnIndex <= 40 ? '16-40' : '41+';

    metrics.histogram('conversation.turn.cost_usd', turnCost, { plan, turn_bucket: bucket });
    metrics.histogram('conversation.turn.history_tokens', historyTokens, { plan, turn_bucket: bucket });

    // Contador por tenant permite responder "quem consumiu" sem varrer
    // o log inteiro no fechamento do mes.
    metrics.counter('conversation.cost_usd_total', turnCost, { tenant: tenantId, plan });

    return { turnCost, historyTokens, bucket };
  }

  // Concentracao: fracao do custo total que vive nas conversas mais longas.
  // Acima de 0.5 significa que metade da fatura esta numa minoria de
  // conversas, e a quota passa a ser a intervencao de maior retorno.
  function concentration(conversations) {
    const sorted = [...conversations].sort((a, b) => b.totalCostUsd - a.totalCostUsd);
    const total = sorted.reduce((acc, c) => acc + c.totalCostUsd, 0);
    if (total === 0) return { p95Share: 0, p99Share: 0 };

    const shareOfTop = (fraction) => {
      const count = Math.max(1, Math.ceil(sorted.length * fraction));
      const slice = sorted.slice(0, count).reduce((acc, c) => acc + c.totalCostUsd, 0);
      return slice / total;
    };

    return { p95Share: shareOfTop(0.05), p99Share: shareOfTop(0.01) };
  }

  return { recordTurn, concentration, costOf };
}`,
        },
        {
          type: 'paragraph',
          value:
            'A função de concentração é a que justifica o trabalho inteiro. Se os cinco por cento de conversas mais caras consomem quinze por cento do custo, a distribuição é saudável e quota de contexto é otimização prematura. Se consomem cinquenta por cento ou mais, você tem uma minoria de conversas absorvendo metade do orçamento, e qualquer política que atue sobre elas rende mais que qualquer otimização de prompt aplicada às outras noventa e cinco por cento.',
        },
        {
          type: 'paragraph',
          value:
            'A separação entre entrada nova e entrada cacheada no cálculo de custo não é detalhe contábil. Num sistema com cache de prefixo bem configurado, uma conversa longa em rajada pode custar bem menos do que a curva quadrática sugere, enquanto a mesma conversa espalhada ao longo do dia paga preço cheio em cada turno. Se você mede tudo como entrada única, a cauda parece maior do que é em rajada e menor do que é quando espaçada, e a política nasce calibrada errado nas duas pontas.',
        },
      ],
    },
    {
      title: 'O que descartar quando a quota estoura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Estourar a quota não deveria significar truncar o histórico pelo começo, que é o comportamento padrão da maioria das implementações e o pior de todos. O começo da conversa costuma conter exatamente o que não pode ser perdido: quem é o cliente, qual é o pedido em questão, qual problema originou o atendimento. Cortar pelo começo produz o efeito mais irritante que um agente pode ter, que é esquecer no turno trinta o que o cliente explicou no turno dois.',
        },
        {
          type: 'paragraph',
          value:
            'A alternativa é tratar o histórico como três camadas com prioridades diferentes: fatos duráveis extraídos da conversa, resumo dos episódios antigos e transcrição literal dos turnos recentes. Quando a quota aperta, a transcrição literal é a primeira a encolher, o resumo é comprimido em seguida, e os fatos duráveis nunca saem. É a mesma ideia de um orçamento com fatias reservadas: cada camada tem um mínimo garantido e um máximo, e a folga é distribuída entre elas.',
        },
        {
          type: 'diagram',
          value: `Alocacao da janela sob quota de 8.000 tokens de historico

  CONVERSA CURTA (turno 4)          CONVERSA LONGA (turno 47)
  +----------------------+          +----------------------+
  | fatos duraveis   400 |          | fatos duraveis   900 |  <- nunca cortado
  +----------------------+          +----------------------+
  | resumo             0 |          | resumo         2.600 |  <- comprimido
  +----------------------+          +----------------------+
  | transcricao    1.100 |          | transcricao    4.500 |  <- janela movel
  +----------------------+          +----------------------+
  | folga          6.500 |          | folga              0 |
  +----------------------+          +----------------------+
    total: 1.500                      total: 8.000 (no teto)

  Turno 48 chega e nao cabe:
    1. transcricao cede os turnos mais antigos ate o piso de 2.000
    2. o que saiu da transcricao entra no resumo (custa 1 chamada barata)
    3. o resumo e recomprimido se passar do seu teto de 3.000
    4. fatos duraveis seguem intactos: sao 900 tokens que valem mais
       que os 4.500 da transcricao inteira

  O que o cliente percebe: nada, desde que o passo 2 rode antes do
  descarte e nao depois. Resumir o que ja foi jogado fora e o bug
  mais comum dessa implementacao.`,
        },
        {
          type: 'code',
          value: `// context/quota.js
// Aloca a janela de historico por camadas com piso e teto por camada.
// Regra central: o que sai da transcricao passa pelo resumo antes de
// ser descartado, nunca depois.

const LAYERS = {
  facts: { floor: 200, ceiling: 1200 },
  summary: { floor: 0, ceiling: 3000 },
  transcript: { floor: 2000, ceiling: Infinity },
};

export function createQuotaAllocator({ countTokens, summarize, metrics }) {
  async function allocate({ conversationId, quotaTokens, facts, summary, transcript }) {
    const factsTokens = Math.min(countTokens(facts), LAYERS.facts.ceiling);
    let summaryText = summary;
    let summaryTokens = countTokens(summaryText);
    let kept = [...transcript];

    const fits = () =>
      factsTokens + summaryTokens + countTokens(kept) <= quotaTokens;

    // Enquanto nao cabe, os turnos mais antigos saem da transcricao e
    // sao absorvidos pelo resumo. O piso da transcricao garante que a
    // conversa nao perca o contexto imediato do turno atual.
    const evicted = [];
    while (!fits() && countTokens(kept) > LAYERS.transcript.floor) {
      evicted.push(kept.shift());
    }

    if (evicted.length > 0) {
      // Uma chamada barata, com modelo pequeno: resumir e a operacao
      // que preserva o valor do que seria simplesmente descartado.
      summaryText = await summarize({ previous: summaryText, turns: evicted });
      summaryTokens = countTokens(summaryText);
      metrics.counter('context.turns_evicted_total', evicted.length, { reason: 'quota' });
    }

    // Se mesmo assim nao cabe, o resumo e quem cede: ele e reconstruivel
    // a partir da conversa persistida, a transcricao recente nao e.
    if (!fits() && summaryTokens > LAYERS.summary.floor) {
      summaryText = await summarize({ previous: summaryText, turns: [], targetTokens: Math.max(
        LAYERS.summary.floor,
        quotaTokens - factsTokens - countTokens(kept),
      ) });
      summaryTokens = countTokens(summaryText);
      metrics.counter('context.summary_recompressed_total', 1, {});
    }

    const usedTokens = factsTokens + summaryTokens + countTokens(kept);
    metrics.histogram('context.window_used_tokens', usedTokens, {
      at_ceiling: usedTokens >= quotaTokens * 0.95 ? 'yes' : 'no',
    });

    return { facts, summary: summaryText, transcript: kept, usedTokens, evictedCount: evicted.length };
  }

  return { allocate, LAYERS };
}`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que faz essa implementação funcionar é a ordem: resumir antes de descartar. A versão ingênua corta os turnos antigos, envia o prompt e resume depois, o que na prática significa resumir a partir de um histórico que já perdeu o que interessava. Também vale notar que o resumo cede antes da transcrição recente, e não o contrário: o resumo pode ser reconstruído a partir da conversa persistida no banco, enquanto perder os turnos imediatamente anteriores quebra a coerência da resposta atual.',
        },
      ],
    },
    {
      title: 'Quando a conversa longa não é abuso e a quota está errada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nem toda conversa longa é desperdício, e tratar comprimento como sinal de abuso é o erro que transforma uma política de custo numa política de piorar o atendimento. Existe uma categoria inteira de conversa que é longa porque o problema é difícil, e ela costuma ser justamente a de maior valor: negociação de contrato, diagnóstico técnico, disputa de cobrança, onboarding de cliente grande. Cortar contexto exatamente aí é economizar centavos e arriscar o contrato.',
        },
        {
          type: 'list',
          items: [
            'Conversa longa com progresso: cada turno resolve uma parte e o cliente confirma. Aqui a quota deve ser generosa, porque o custo está comprando um desfecho.',
            'Conversa longa em laço: o cliente repete a mesma pergunta reformulada e o agente repete a mesma resposta reformulada. Aqui o problema não é custo, é que o agente não sabe responder e deveria escalar.',
            'Conversa longa por exploração: o cliente está navegando o catálogo sem intenção clara. Quota apertada é apropriada, porque cada turno carrega pouco valor.',
            'Conversa longa artificial: automação do outro lado mantendo a sessão aberta. Isso é abuso e o controle certo é teto de gasto, não quota de contexto.',
            'Conversa longa por retomada: o cliente volta depois de dias sobre o mesmo assunto. Aqui o que importa é fato durável, não transcrição, e a quota nem chega perto do teto.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A segunda categoria merece destaque porque é a mais cara e a mais fácil de detectar. Uma conversa em laço tem assinatura clara: a similaridade entre a mensagem atual e alguma mensagem anterior do cliente é alta, e a similaridade entre a resposta atual e alguma resposta anterior também. Quando as duas coisas acontecem por dois ou três turnos seguidos, gastar mais tokens não vai resolver, e o comportamento certo é oferecer transbordo para humano em vez de continuar carregando um histórico que só cresce.',
        },
        {
          type: 'paragraph',
          value:
            'Isso muda a natureza da política. Uma quota de contexto que apenas comprime é incompleta: ela precisa vir acompanhada de um gatilho de saída. Se a conversa ultrapassa o teto de turnos definido para aquele tipo e não houve progresso mensurável, o certo é escalar, não continuar comprimindo. Custo alto sem desfecho é o pior dos dois mundos, e é exatamente o que uma política de compressão isolada produz.',
        },
      ],
    },
    {
      title: 'A política em produção: números, gatilhos e o que observar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A implementação em produção precisa de três decisões numéricas e duas de comportamento. As numéricas são a quota base por classe de conversa, o piso da transcrição e o teto de turnos antes do gatilho de saída. As de comportamento são o que fazer quando a quota estoura e o que fazer quando o teto de turnos estoura, que são situações diferentes e frequentemente tratadas como a mesma.',
        },
        {
          type: 'table',
          columns: ['Classe de conversa', 'Quota de histórico', 'Piso da transcrição', 'Gatilho de saída'],
          rows: [
            [
              'Consulta de catálogo',
              '2.000 tokens',
              '600 tokens',
              '8 turnos sem intenção clara',
            ],
            [
              'Suporte de primeiro nível',
              '6.000 tokens',
              '2.000 tokens',
              '12 turnos sem progresso',
            ],
            [
              'Diagnóstico técnico',
              '12.000 tokens',
              '4.000 tokens',
              '25 turnos sem progresso',
            ],
            [
              'Disputa ou cobrança',
              '10.000 tokens',
              '3.000 tokens',
              '6 turnos, escala por política',
            ],
            [
              'Onboarding assistido',
              '16.000 tokens',
              '5.000 tokens',
              'Sem gatilho, é acompanhamento',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A linha de disputa é a que mais destoa e a mais importante de acertar. A quota é alta porque o histórico completo importa quando há divergência sobre o que foi dito, mas o gatilho de saída é o mais curto da tabela, porque uma disputa que passa de seis turnos com um agente automático raramente termina bem. Quota generosa com escalada rápida não é contradição: é reconhecer que o contexto precisa estar completo justamente para que a transferência ao humano seja útil.',
        },
        {
          type: 'ordered',
          items: [
            'Instrumente o custo marginal por turno e a concentração antes de definir qualquer número, para saber se a cauda justifica a política.',
            'Comece com quota por classe de conversa, não por plano, porque o valor está no tipo de problema e não no contrato.',
            'Implemente a alocação em camadas com piso por camada, garantindo que fatos duráveis nunca sejam descartados.',
            'Resuma o que sai da transcrição antes do descarte, e nunca depois, com um modelo pequeno para que a operação seja barata.',
            'Adicione o gatilho de saída por ausência de progresso, separado da quota, porque comprimir não resolve conversa em laço.',
            'Monitore a proporção de conversas que atingem o teto da quota: se passa de dez por cento numa classe, a quota daquela classe está errada.',
            'Compare a taxa de resolução das conversas com e sem compressão no conjunto de avaliação antes de considerar a política aprovada.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O penúltimo item é o alarme mais útil e o mais esquecido. A quota deveria ser um limite raramente tocado, não um regime operacional permanente. Se uma classe inteira de conversa vive comprimindo histórico, o número não está protegendo margem, está degradando o atendimento de forma sistemática e invisível, e o certo é elevar a quota daquela classe ou repensar o que entra no prompt de sistema, que costuma ser onde estão os tokens desperdiçados de verdade.',
        },
        {
          type: 'paragraph',
          value:
            'Vale terminar reconhecendo o que essa política não resolve. Quota de contexto controla o custo marginal de continuar uma conversa, e faz isso bem. Ela não conserta um prompt de sistema inchado, não substitui roteamento para modelo menor nas rotas simples e não impede que uma automação abusiva mantenha mil sessões abertas. Cada um desses tem o seu controle próprio, e o valor da quota é justamente ser específica: ela responde a uma única pergunta, que é quanto histórico esta conversa merece carregar agora, e responde de um jeito que o cliente não sente.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que a minha fatura subiu se o número de conversas não mudou?',
      answer:
        'Quase sempre porque o comprimento médio das conversas subiu, e o custo cresce com o quadrado do comprimento e não de forma linear. Num agente que reenvia o histórico completo a cada turno, o turno N carrega tudo que veio antes, então o acumulado depois de N turnos é proporcional a N ao quadrado. Na prática isso significa que um aumento de dez por cento no comprimento médio produz cerca de vinte e um por cento a mais de custo, com o mesmo volume de conversas. E como a média esconde a distribuição, o caso mais comum é ainda mais desigual: a média mal se move enquanto uma minoria de conversas muito longas absorve metade do orçamento. A forma de confirmar isso é medir a concentração, ou seja, qual fração do custo total vive nos cinco por cento de conversas mais caras. Acima de cinquenta por cento, o problema está na cauda e nenhuma otimização de prompt aplicada ao caso médio vai resolver.',
    },
    {
      question: 'Truncar o histórico pelo começo não é a solução mais simples?',
      answer:
        'É a mais simples de implementar e a pior em resultado, porque o começo da conversa costuma conter exatamente o que não pode ser perdido: quem é o cliente, qual pedido está em questão, qual problema originou o atendimento. Truncar pelo começo produz o comportamento mais irritante que um agente pode ter, que é esquecer no turno trinta o que o cliente explicou no turno dois, e o cliente reage repetindo a informação, o que gasta mais turnos e mais tokens. A alternativa é tratar o histórico em três camadas com prioridades distintas: fatos duráveis extraídos da conversa, resumo dos episódios antigos e transcrição literal dos turnos recentes. Sob pressão de quota, a transcrição cede primeiro até um piso, o que sai dela é absorvido pelo resumo antes de ser descartado, e os fatos duráveis nunca saem. O detalhe que mais quebra na prática é a ordem: resumir precisa acontecer antes do descarte, nunca depois.',
    },
    {
      question: 'Como diferenciar uma conversa longa legítima de uma que só está queimando dinheiro?',
      answer:
        'Pelo progresso, não pelo comprimento. Uma conversa longa com progresso resolve uma parte do problema a cada turno e o cliente confirma o avanço, e essa costuma ser a conversa de maior valor do sistema: negociação, diagnóstico técnico, disputa de cobrança, onboarding. Cortar contexto exatamente aí economiza centavos e arrisca o contrato. Uma conversa em laço tem assinatura oposta e detectável: a mensagem atual é muito parecida com alguma anterior do próprio cliente e a resposta atual é muito parecida com alguma resposta anterior, por dois ou três turnos seguidos. Nesse caso gastar mais tokens não vai resolver, porque o agente não sabe responder, e o comportamento certo é oferecer transbordo para humano. Por isso a quota precisa vir acompanhada de um gatilho de saída por ausência de progresso, separado do limite de tokens: comprimir uma conversa em laço só produz custo alto sem desfecho, que é o pior dos dois mundos.',
    },
  ],
  conclusion: {
    title: 'A conversa longa é uma decisão de produto disfarçada de detalhe técnico',
    description:
      'O custo de uma conversa cresce com o quadrado do número de turnos, então uma minoria de conversas longas costuma absorver metade do orçamento sem aparecer em nenhuma métrica média. A quota de contexto é o controle que atua exatamente nesse ponto, e é o mais barato politicamente porque não bloqueia ninguém: ela decide quanto histórico o agente carrega por turno, com alocação em camadas onde a transcrição cede primeiro, o resumo absorve o que sai antes do descarte e os fatos duráveis nunca são cortados. O que a quota sozinha não resolve é a conversa em laço, que precisa de um gatilho de saída por ausência de progresso em vez de mais compressão. E o número certo nunca vem do plano do cliente, vem do tipo de problema que a conversa está tentando resolver. Posso medir a concentração de custo do seu agente, dimensionar a quota por classe de conversa e implementar a alocação em camadas sem que o cliente perceba a diferença.',
    cta: 'Falar sobre o custo das conversas do meu agente',
  },
  related: [
    { label: 'Custo por conversa: atribuir a fatura de IA ao valor', to: '/blog/custo-por-conversa-atribuir-fatura-ia-ao-valor' },
    { label: 'Compressão de contexto sem perder sinal', to: '/blog/compressao-contexto-caber-mais-janela-sem-perder-sinal' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

const en = {
  intro:
    'The cost of a conversation does not grow linearly with the number of messages: it grows faster, because on every turn the entire history goes back into the prompt. A forty-turn conversation does not cost forty times a single-turn one, it costs far more, and the customer who writes the most is usually the one who pays the least. The classic symptom shows up at month end: the bill went up thirty percent, the number of conversations stayed flat, and nobody can explain the difference. The explanation is almost always a minority of conversations that grew too long and never met a limit. This article shows why cost per conversation is quadratic and not linear, how to define a per-customer context quota that does not punish legitimate use, how to choose what leaves the window when the quota is hit, and why the final decision is not technical: it is about which conversation is worth carrying forward.',
  sections: [
    {
      title: 'Long conversation cost is quadratic, not linear',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The misleading intuition is to treat a conversation as a list of messages and assume total cost is the sum of each message. It is not. In an agent that carries full history, turn N sends as input everything said in prior turns plus the new message. If each turn adds an average of K tokens to the history, turn N sends roughly N times K input tokens, and the accumulated total after N turns is proportional to N squared. It is the same arithmetic as a sum of a series, and it is why doubling the length of a conversation quadruples its cost.',
        },
        {
          type: 'paragraph',
          value:
            'That completely changes where to look when the bill goes up. A ten percent increase in the number of conversations produces a ten percent increase in cost. A ten percent increase in average conversation length produces roughly twenty-one percent. And since the average hides the distribution, the most common scenario is worse still: the average barely moves while a tail of very long conversations absorbs half the budget on its own.',
        },
        {
          type: 'table',
          columns: ['Turns in the conversation', 'Input tokens on the turn', 'Accumulated input', 'Cost relative to turn 1'],
          rows: [
            ['1', '1,200', '1,200', '1x'],
            ['5', '4,400', '14,000', '11.7x'],
            ['10', '8,400', '48,000', '40x'],
            ['20', '16,400', '176,000', '146x'],
            ['40', '32,400', '672,000', '560x'],
            ['80', '64,400', '2,624,000', '2,186x'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The table assumes a one thousand token system prompt, two hundred tokens per customer message and answer combined, and no compression. The absolute numbers change with your system, the shape of the curve does not. What this table reveals is that an eighty-turn conversation costs more than two hundred five-turn conversations, and that any cost policy treating both as "one conversation" is measuring the wrong thing. The provider bills by token, so your system needs to control by token too.',
        },
        {
          type: 'paragraph',
          value:
            'The important exception is worth recording: prefix caching changes the slope, not the shape. If the history is stable and sits at the start of the prompt, already-seen tokens cost a fraction of full price and the growth factor drops considerably. But caches have a short lifetime, and a long conversation is precisely the case with hours-long pauses between turns, which is when the cache expires. Counting on caching to fix long conversations means counting on the very condition that long conversations break.',
        },
      ],
    },
    {
      title: 'A quota is different from a spend cap and from a window limit',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Three controls are frequently conflated and they solve distinct problems. The model window limit is a technical constraint: above it the call fails. The per-customer spend cap is margin protection: above it the customer stops being served or gets degraded. The context quota sits between the two and is the one almost nobody implements: it bounds how many history tokens a specific conversation is entitled to carry per turn, regardless of whether it fits in the window and regardless of whether the customer still has budget.',
        },
        {
          type: 'table',
          columns: ['Control', 'Unit', 'What it protects', 'What happens when exceeded'],
          rows: [
            [
              'Model window limit',
              'Tokens per call',
              'Nothing, it is a physical constraint',
              'The call fails with a provider error',
            ],
            [
              'Rate limit',
              'Requests per minute',
              'System capacity',
              'The request waits in the queue or is rejected',
            ],
            [
              'Per-customer spend cap',
              'Money per period',
              'Contract margin',
              'The customer is degraded or blocked',
            ],
            [
              'Per-conversation context quota',
              'History tokens per turn',
              'Marginal cost of continuing',
              'The history is compressed, never the conversation',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row carries the difference that matters: when the context quota is hit, the conversation continues. No customer is blocked, no message is refused. What changes is how much history the agent carries to answer, and that is a decision the customer can be spared from noticing, provided the choice of what to discard is good. That is why the context quota is the cheapest control politically: it protects margin without producing a difficult conversation with the customer.',
        },
        {
          type: 'paragraph',
          value:
            'The quota also needs to differ by plan, and the common mistake here is deriving it from price. The right criterion is the expected value of the conversation, not the subscription fee. A post-sale support conversation from a basic-plan customer can be worth more in retention than a catalog lookup from an enterprise customer. Quota per plan is a decent starting default, and quota per conversation type is the refinement that almost always pays.',
        },
      ],
    },
    {
      title: 'Measure before limiting: where the budget actually goes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before picking any number you need the real distribution. The metric almost every team has is average cost per conversation, and it is practically useless here because the average is dominated by the tail in distributions like this. The three metrics that decide the policy are different: the distribution of length in percentiles, the share of total cost consumed by the ninety-fifth percentile, and the marginal cost of the current turn relative to the first turn of the same conversation.',
        },
        {
          type: 'code',
          value: `// telemetry/context-cost.js
// Instruments the marginal cost of each turn and spend concentration.
// The question it answers: which slice of the budget lives in the tail?

export function createContextMeter({ metrics, priceUsdPerMillion }) {
  // Dollar cost of one call, separating cached input from fresh input.
  // Prefix cache costs a fraction of full price, so summing everything
  // as "input" overstates the tail in systems with caching enabled.
  function costOf({ freshInputTokens, cachedInputTokens, outputTokens }) {
    const p = priceUsdPerMillion;
    return (
      (freshInputTokens * p.input +
        cachedInputTokens * p.cachedInput +
        outputTokens * p.output) /
      1_000_000
    );
  }

  function recordTurn({ conversationId, tenantId, plan, turnIndex, usage }) {
    const turnCost = costOf(usage);
    const historyTokens = usage.freshInputTokens + usage.cachedInputTokens;

    // Label by turn bucket, not exact turn: label cardinality grows
    // without bound if the turn becomes a metric dimension.
    const bucket =
      turnIndex <= 5 ? '1-5' : turnIndex <= 15 ? '6-15' : turnIndex <= 40 ? '16-40' : '41+';

    metrics.histogram('conversation.turn.cost_usd', turnCost, { plan, turn_bucket: bucket });
    metrics.histogram('conversation.turn.history_tokens', historyTokens, { plan, turn_bucket: bucket });

    // A per-tenant counter answers "who consumed it" without scanning
    // the whole log at month end.
    metrics.counter('conversation.cost_usd_total', turnCost, { tenant: tenantId, plan });

    return { turnCost, historyTokens, bucket };
  }

  // Concentration: share of total cost living in the longest conversations.
  // Above 0.5 means half the bill sits in a minority of conversations,
  // and the quota becomes the highest-return intervention available.
  function concentration(conversations) {
    const sorted = [...conversations].sort((a, b) => b.totalCostUsd - a.totalCostUsd);
    const total = sorted.reduce((acc, c) => acc + c.totalCostUsd, 0);
    if (total === 0) return { p95Share: 0, p99Share: 0 };

    const shareOfTop = (fraction) => {
      const count = Math.max(1, Math.ceil(sorted.length * fraction));
      const slice = sorted.slice(0, count).reduce((acc, c) => acc + c.totalCostUsd, 0);
      return slice / total;
    };

    return { p95Share: shareOfTop(0.05), p99Share: shareOfTop(0.01) };
  }

  return { recordTurn, concentration, costOf };
}`,
        },
        {
          type: 'paragraph',
          value:
            'The concentration function is what justifies the entire effort. If the five percent most expensive conversations consume fifteen percent of cost, the distribution is healthy and a context quota is premature optimization. If they consume fifty percent or more, you have a minority of conversations absorbing half the budget, and any policy acting on them returns more than any prompt optimization applied to the other ninety-five percent.',
        },
        {
          type: 'paragraph',
          value:
            'Separating fresh input from cached input in the cost calculation is not an accounting detail. In a system with well-configured prefix caching, a long conversation in a burst can cost far less than the quadratic curve suggests, while the same conversation spread across the day pays full price on every turn. If you measure everything as a single input figure, the tail looks bigger than it is in bursts and smaller than it is when spaced out, and the policy is born miscalibrated at both ends.',
        },
      ],
    },
    {
      title: 'What to discard when the quota is hit',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Hitting the quota should not mean truncating history from the beginning, which is the default behavior of most implementations and the worst of them all. The start of a conversation usually contains exactly what cannot be lost: who the customer is, which order is in question, which problem started the interaction. Cutting from the front produces the single most irritating behavior an agent can have, which is forgetting on turn thirty what the customer explained on turn two.',
        },
        {
          type: 'paragraph',
          value:
            'The alternative is to treat history as three layers with different priorities: durable facts extracted from the conversation, a summary of older episodes, and a literal transcript of recent turns. When the quota tightens, the literal transcript is the first to shrink, the summary is compressed next, and durable facts never leave. It is the same idea as a budget with reserved slices: each layer has a guaranteed floor and a ceiling, and the slack is distributed between them.',
        },
        {
          type: 'diagram',
          value: `Window allocation under an 8,000 token history quota

  SHORT CONVERSATION (turn 4)       LONG CONVERSATION (turn 47)
  +----------------------+          +----------------------+
  | durable facts    400 |          | durable facts    900 |  <- never cut
  +----------------------+          +----------------------+
  | summary            0 |          | summary        2,600 |  <- compressed
  +----------------------+          +----------------------+
  | transcript     1,100 |          | transcript     4,500 |  <- sliding window
  +----------------------+          +----------------------+
  | slack          6,500 |          | slack              0 |
  +----------------------+          +----------------------+
    total: 1,500                      total: 8,000 (at ceiling)

  Turn 48 arrives and does not fit:
    1. transcript gives up its oldest turns down to the 2,000 floor
    2. what left the transcript enters the summary (1 cheap call)
    3. the summary is recompressed if it exceeds its 3,000 ceiling
    4. durable facts stay intact: 900 tokens worth more than the
       entire 4,500 token transcript

  What the customer notices: nothing, as long as step 2 runs before
  the discard and not after. Summarizing what was already thrown away
  is the most common bug in this implementation.`,
        },
        {
          type: 'code',
          value: `// context/quota.js
// Allocates the history window by layers with a floor and ceiling each.
// Core rule: what leaves the transcript goes through the summary before
// being discarded, never after.

const LAYERS = {
  facts: { floor: 200, ceiling: 1200 },
  summary: { floor: 0, ceiling: 3000 },
  transcript: { floor: 2000, ceiling: Infinity },
};

export function createQuotaAllocator({ countTokens, summarize, metrics }) {
  async function allocate({ conversationId, quotaTokens, facts, summary, transcript }) {
    const factsTokens = Math.min(countTokens(facts), LAYERS.facts.ceiling);
    let summaryText = summary;
    let summaryTokens = countTokens(summaryText);
    let kept = [...transcript];

    const fits = () =>
      factsTokens + summaryTokens + countTokens(kept) <= quotaTokens;

    // While it does not fit, the oldest turns leave the transcript and
    // are absorbed by the summary. The transcript floor guarantees the
    // conversation does not lose the immediate context of this turn.
    const evicted = [];
    while (!fits() && countTokens(kept) > LAYERS.transcript.floor) {
      evicted.push(kept.shift());
    }

    if (evicted.length > 0) {
      // One cheap call with a small model: summarizing is the operation
      // that preserves the value of what would simply be discarded.
      summaryText = await summarize({ previous: summaryText, turns: evicted });
      summaryTokens = countTokens(summaryText);
      metrics.counter('context.turns_evicted_total', evicted.length, { reason: 'quota' });
    }

    // If it still does not fit, the summary gives way: it is rebuildable
    // from the persisted conversation, the recent transcript is not.
    if (!fits() && summaryTokens > LAYERS.summary.floor) {
      summaryText = await summarize({ previous: summaryText, turns: [], targetTokens: Math.max(
        LAYERS.summary.floor,
        quotaTokens - factsTokens - countTokens(kept),
      ) });
      summaryTokens = countTokens(summaryText);
      metrics.counter('context.summary_recompressed_total', 1, {});
    }

    const usedTokens = factsTokens + summaryTokens + countTokens(kept);
    metrics.histogram('context.window_used_tokens', usedTokens, {
      at_ceiling: usedTokens >= quotaTokens * 0.95 ? 'yes' : 'no',
    });

    return { facts, summary: summaryText, transcript: kept, usedTokens, evictedCount: evicted.length };
  }

  return { allocate, LAYERS };
}`,
        },
        {
          type: 'paragraph',
          value:
            'The detail that makes this implementation work is the ordering: summarize before discarding. The naive version cuts old turns, sends the prompt and summarizes afterwards, which in practice means summarizing from a history that already lost what mattered. It is also worth noting that the summary gives way before the recent transcript and not the other way around: the summary can be rebuilt from the conversation persisted in the database, while losing the immediately preceding turns breaks the coherence of the current answer.',
        },
      ],
    },
    {
      title: 'When a long conversation is not abuse and the quota is wrong',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Not every long conversation is waste, and treating length as a signal of abuse is the mistake that turns a cost policy into a policy of worse service. There is an entire category of conversation that is long because the problem is hard, and it tends to be the highest-value one: contract negotiation, technical diagnosis, billing disputes, large-customer onboarding. Cutting context exactly there saves pennies and risks the contract.',
        },
        {
          type: 'list',
          items: [
            'Long with progress: each turn resolves a part and the customer confirms. The quota should be generous here, because the cost is buying an outcome.',
            'Long in a loop: the customer repeats the same question rephrased and the agent repeats the same answer rephrased. The problem here is not cost, it is that the agent cannot answer and should escalate.',
            'Long by exploration: the customer is browsing the catalog with no clear intent. A tight quota is appropriate, because each turn carries little value.',
            'Long artificially: automation on the other side keeping the session open. That is abuse and the right control is a spend cap, not a context quota.',
            'Long by resumption: the customer comes back days later about the same subject. What matters here is durable facts, not transcript, and the quota never comes close to its ceiling.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The second category deserves emphasis because it is the most expensive and the easiest to detect. A looping conversation has a clear signature: similarity between the current message and some earlier customer message is high, and similarity between the current answer and some earlier answer is high too. When both happen for two or three consecutive turns, spending more tokens will not solve it, and the right behavior is offering handoff to a human instead of continuing to carry a history that only grows.',
        },
        {
          type: 'paragraph',
          value:
            'That changes the nature of the policy. A context quota that only compresses is incomplete: it must come with an exit trigger. If the conversation passes the turn ceiling defined for that type with no measurable progress, the right move is to escalate, not to keep compressing. High cost with no outcome is the worst of both worlds, and it is exactly what an isolated compression policy produces.',
        },
      ],
    },
    {
      title: 'The policy in production: numbers, triggers and what to watch',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A production implementation needs three numeric decisions and two behavioral ones. The numeric ones are the base quota per conversation class, the transcript floor and the turn ceiling before the exit trigger. The behavioral ones are what to do when the quota is hit and what to do when the turn ceiling is hit, which are different situations frequently treated as the same.',
        },
        {
          type: 'table',
          columns: ['Conversation class', 'History quota', 'Transcript floor', 'Exit trigger'],
          rows: [
            [
              'Catalog lookup',
              '2,000 tokens',
              '600 tokens',
              '8 turns with no clear intent',
            ],
            [
              'First-line support',
              '6,000 tokens',
              '2,000 tokens',
              '12 turns with no progress',
            ],
            [
              'Technical diagnosis',
              '12,000 tokens',
              '4,000 tokens',
              '25 turns with no progress',
            ],
            [
              'Dispute or billing',
              '10,000 tokens',
              '3,000 tokens',
              '6 turns, escalation by policy',
            ],
            [
              'Assisted onboarding',
              '16,000 tokens',
              '5,000 tokens',
              'No trigger, it is accompaniment',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The dispute row is the most divergent and the most important to get right. The quota is high because full history matters when there is disagreement about what was said, but the exit trigger is the shortest in the table, because a dispute that goes past six turns with an automated agent rarely ends well. A generous quota with fast escalation is not a contradiction: it recognizes that the context must be complete precisely so the handoff to a human is useful.',
        },
        {
          type: 'ordered',
          items: [
            'Instrument marginal cost per turn and concentration before defining any number, to know whether the tail justifies the policy.',
            'Start with a quota per conversation class, not per plan, because the value lies in the type of problem and not in the contract.',
            'Implement layered allocation with a floor per layer, guaranteeing durable facts are never discarded.',
            'Summarize what leaves the transcript before the discard and never after, with a small model so the operation stays cheap.',
            'Add the exit trigger for absence of progress, separate from the quota, because compressing does not fix a looping conversation.',
            'Monitor the share of conversations that hit the quota ceiling: if it passes ten percent in a class, that class quota is wrong.',
            'Compare resolution rate with and without compression on the evaluation set before considering the policy approved.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The second-to-last item is the most useful alarm and the most forgotten. The quota should be a rarely touched limit, not a permanent operating regime. If an entire class of conversation lives compressing history, the number is not protecting margin, it is degrading service systematically and invisibly, and the right move is raising that class quota or rethinking what goes into the system prompt, which is usually where the truly wasted tokens live.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth closing by acknowledging what this policy does not solve. A context quota controls the marginal cost of continuing a conversation, and it does that well. It does not fix a bloated system prompt, it does not replace routing to a smaller model on simple paths, and it does not stop abusive automation from keeping a thousand sessions open. Each of those has its own control, and the value of the quota is precisely being specific: it answers a single question, which is how much history this conversation deserves to carry right now, and it answers in a way the customer does not feel.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why did my bill go up if the number of conversations did not change?',
      answer:
        'Almost always because average conversation length went up, and cost grows with the square of length rather than linearly. In an agent that resends full history on every turn, turn N carries everything that came before, so the accumulated total after N turns is proportional to N squared. In practice a ten percent increase in average length produces about twenty-one percent more cost at the same conversation volume. And since the average hides the distribution, the most common case is even more uneven: the average barely moves while a minority of very long conversations absorbs half the budget. The way to confirm this is to measure concentration, that is, what share of total cost lives in the five percent most expensive conversations. Above fifty percent, the problem is in the tail and no prompt optimization applied to the average case will fix it.',
    },
    {
      question: 'Is truncating history from the beginning not the simplest solution?',
      answer:
        'It is the simplest to implement and the worst in outcome, because the start of the conversation usually holds exactly what cannot be lost: who the customer is, which order is in question, which problem started the interaction. Truncating from the front produces the most irritating behavior an agent can have, which is forgetting on turn thirty what the customer explained on turn two, and the customer reacts by repeating the information, which burns more turns and more tokens. The alternative is treating history as three layers with distinct priorities: durable facts extracted from the conversation, a summary of older episodes, and a literal transcript of recent turns. Under quota pressure the transcript gives way first down to a floor, what leaves it is absorbed by the summary before being discarded, and durable facts never leave. The detail that most often breaks in practice is the ordering: summarizing must happen before the discard, never after.',
    },
    {
      question: 'How do I tell a legitimately long conversation from one just burning money?',
      answer:
        'By progress, not by length. A long conversation with progress resolves part of the problem each turn and the customer confirms the advance, and that tends to be the highest-value conversation in the system: negotiation, technical diagnosis, billing dispute, onboarding. Cutting context exactly there saves pennies and risks the contract. A looping conversation has the opposite and detectable signature: the current message closely resembles an earlier one from the customer and the current answer closely resembles an earlier answer, for two or three consecutive turns. In that case spending more tokens will not help, because the agent cannot answer, and the right behavior is offering handoff to a human. That is why the quota must come with an exit trigger for absence of progress, separate from the token limit: compressing a looping conversation only produces high cost with no outcome, which is the worst of both worlds.',
    },
  ],
  conclusion: {
    title: 'The long conversation is a product decision disguised as a technical detail',
    description:
      'The cost of a conversation grows with the square of the number of turns, so a minority of long conversations usually absorbs half the budget without showing up in any average metric. The context quota is the control that acts exactly at that point, and it is the cheapest politically because it blocks nobody: it decides how much history the agent carries per turn, with layered allocation where the transcript gives way first, the summary absorbs what leaves before the discard, and durable facts are never cut. What the quota alone does not solve is the looping conversation, which needs an exit trigger for absence of progress rather than more compression. And the right number never comes from the customer plan, it comes from the type of problem the conversation is trying to solve. I can measure the cost concentration of your agent, size the quota per conversation class and implement layered allocation without the customer noticing the difference.',
    cta: 'Talk about the cost of my agent conversations',
  },
  related: [
    { label: 'Cost per conversation: tying the AI bill to value', to: '/blog/custo-por-conversa-atribuir-fatura-ia-ao-valor' },
    { label: 'Context compression without losing signal', to: '/blog/compressao-contexto-caber-mais-janela-sem-perder-sinal' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
};

const es = {
  intro:
    'El costo de una conversación no crece de forma lineal con la cantidad de mensajes: crece más rápido, porque en cada turno el historial completo vuelve a entrar en el prompt. Una conversación de cuarenta turnos no cuesta cuarenta veces la de un turno, cuesta mucho más, y el cliente que más escribe suele ser justamente el que menos paga. El síntoma clásico aparece al cierre del mes: la factura subió treinta por ciento, la cantidad de conversaciones quedó igual, y nadie sabe explicar la diferencia. La explicación casi siempre es una minoría de conversaciones que se volvieron demasiado largas y nunca encontraron un límite. Este artículo muestra por qué el costo por conversación es cuadrático y no lineal, cómo definir una cuota de contexto por cliente que no castigue el uso legítimo, cómo elegir qué sale de la ventana cuando la cuota se agota, y por qué la decisión final no es técnica: es sobre qué conversación vale la pena seguir cargando.',
  sections: [
    {
      title: 'El costo de la conversación larga es cuadrático, no lineal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La intuición engañosa es tratar una conversación como una lista de mensajes y asumir que el costo total es la suma del costo de cada mensaje. No lo es. En un agente con historial completo, el turno N envía como entrada todo lo dicho en los turnos anteriores más el mensaje nuevo. Si cada turno agrega en promedio K tokens al historial, el turno N envía aproximadamente N por K tokens de entrada, y el acumulado después de N turnos es proporcional a N al cuadrado. Es la misma aritmética de una suma de serie, y es la razón por la cual duplicar el largo de la conversación cuadruplica su costo.',
        },
        {
          type: 'paragraph',
          value:
            'Eso cambia por completo dónde buscar cuando la factura sube. Un aumento del diez por ciento en la cantidad de conversaciones produce un aumento del diez por ciento en el costo. Un aumento del diez por ciento en el largo promedio produce aproximadamente veintiuno por ciento. Y como el promedio esconde la distribución, el escenario más común es todavía peor: el promedio apenas se mueve mientras una cola de conversaciones muy largas absorbe la mitad del presupuesto sola.',
        },
        {
          type: 'table',
          columns: ['Turnos en la conversación', 'Tokens de entrada en el turno', 'Entrada acumulada', 'Costo relativo al turno 1'],
          rows: [
            ['1', '1.200', '1.200', '1x'],
            ['5', '4.400', '14.000', '11,7x'],
            ['10', '8.400', '48.000', '40x'],
            ['20', '16.400', '176.000', '146x'],
            ['40', '32.400', '672.000', '560x'],
            ['80', '64.400', '2.624.000', '2.186x'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tabla asume un prompt de sistema de mil tokens, doscientos tokens por mensaje del cliente y respuesta sumados, y ninguna compresión. Los números absolutos cambian con tu sistema, la forma de la curva no cambia. Lo que esta tabla revela es que una conversación de ochenta turnos cuesta más que doscientas conversaciones de cinco turnos, y que cualquier política de costo que trate a ambas como "una conversación" está midiendo lo equivocado. El proveedor factura por token, así que tu sistema también necesita controlar por token.',
        },
        {
          type: 'paragraph',
          value:
            'Vale registrar la excepción importante: la caché de prefijo cambia la pendiente, no la forma. Si el historial es estable y viene al inicio del prompt, los tokens ya vistos cuestan una fracción del precio completo y el factor de crecimiento baja bastante. Pero la caché tiene vida corta, y una conversación larga es exactamente el caso donde hay pausas de horas entre turnos, que es cuando la caché expira. Contar con la caché para resolver la conversación larga es contar justamente con la condición que la conversación larga rompe.',
        },
      ],
    },
    {
      title: 'Cuota es distinto de techo de gasto y de límite de ventana',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Tres controles se confunden con frecuencia y resuelven problemas distintos. El límite de ventana del modelo es una restricción técnica: por encima la llamada falla. El techo de gasto por cliente es protección de margen: por encima el cliente deja de ser atendido o es degradado. La cuota de contexto queda entre los dos y es la que casi nadie implementa: limita cuántos tokens de historial tiene derecho a cargar una conversación específica por turno, sin importar si entra en la ventana y sin importar si el cliente todavía tiene presupuesto.',
        },
        {
          type: 'table',
          columns: ['Control', 'Unidad', 'Qué protege', 'Qué pasa al excederlo'],
          rows: [
            [
              'Límite de ventana del modelo',
              'Tokens por llamada',
              'Nada, es restricción física',
              'La llamada falla con error del proveedor',
            ],
            [
              'Rate limit',
              'Peticiones por minuto',
              'Capacidad del sistema',
              'La petición espera en la fila o es rechazada',
            ],
            [
              'Techo de gasto por cliente',
              'Dinero por período',
              'Margen del contrato',
              'El cliente es degradado o bloqueado',
            ],
            [
              'Cuota de contexto por conversación',
              'Tokens de historial por turno',
              'Costo marginal de continuar',
              'El historial se comprime, nunca la conversación',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila carga la diferencia que importa: cuando la cuota de contexto se agota, la conversación continúa. Ningún cliente es bloqueado, ningún mensaje es rechazado. Lo que cambia es cuánto historial carga el agente para responder, y esa es una decisión que puede tomarse sin que el cliente lo perciba, siempre que la elección de qué descartar sea buena. Por eso la cuota de contexto es el control más barato políticamente: protege margen sin producir una conversación difícil con el cliente.',
        },
        {
          type: 'paragraph',
          value:
            'La cuota también necesita diferenciarse por plan, y aquí el error común es derivarla del precio. El criterio correcto es el valor esperado de la conversación, no la mensualidad. Una conversación de soporte posventa de un cliente de plan básico puede valer más en retención que una consulta de catálogo de un cliente enterprise. Cuota por plan es un buen valor inicial, y cuota por tipo de conversación es el refinamiento que casi siempre paga.',
        },
      ],
    },
    {
      title: 'Medir antes de limitar: adónde va realmente el presupuesto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de elegir cualquier número hay que conocer la distribución real. La métrica que casi todo equipo tiene es el costo promedio por conversación, y es prácticamente inútil aquí porque el promedio está dominado por la cola en distribuciones así. Las tres métricas que deciden la política son otras: la distribución del largo en percentiles, la fracción del costo total consumida por el percentil noventa y cinco, y el costo marginal del turno actual respecto al primer turno de la misma conversación.',
        },
        {
          type: 'code',
          value: `// telemetry/context-cost.js
// Instrumenta el costo marginal de cada turno y la concentracion del gasto.
// La pregunta que responde: que porcion del presupuesto vive en la cola?

export function createContextMeter({ metrics, priceUsdPerMillion }) {
  // Costo en dolares de una llamada, separando entrada cacheada de nueva.
  // La cache de prefijo cuesta una fraccion del precio completo, asi que
  // sumar todo como "entrada" sobreestima la cola con cache activa.
  function costOf({ freshInputTokens, cachedInputTokens, outputTokens }) {
    const p = priceUsdPerMillion;
    return (
      (freshInputTokens * p.input +
        cachedInputTokens * p.cachedInput +
        outputTokens * p.output) /
      1_000_000
    );
  }

  function recordTurn({ conversationId, tenantId, plan, turnIndex, usage }) {
    const turnCost = costOf(usage);
    const historyTokens = usage.freshInputTokens + usage.cachedInputTokens;

    // Etiquetar por rango de turno, no por turno exacto: la cardinalidad
    // de etiqueta crece sin limite si el turno es dimension de la metrica.
    const bucket =
      turnIndex <= 5 ? '1-5' : turnIndex <= 15 ? '6-15' : turnIndex <= 40 ? '16-40' : '41+';

    metrics.histogram('conversation.turn.cost_usd', turnCost, { plan, turn_bucket: bucket });
    metrics.histogram('conversation.turn.history_tokens', historyTokens, { plan, turn_bucket: bucket });

    // Un contador por tenant responde "quien consumio" sin recorrer todo
    // el log en el cierre del mes.
    metrics.counter('conversation.cost_usd_total', turnCost, { tenant: tenantId, plan });

    return { turnCost, historyTokens, bucket };
  }

  // Concentracion: fraccion del costo total que vive en las conversaciones
  // mas largas. Por encima de 0.5 significa que la mitad de la factura esta
  // en una minoria, y la cuota pasa a ser la intervencion de mayor retorno.
  function concentration(conversations) {
    const sorted = [...conversations].sort((a, b) => b.totalCostUsd - a.totalCostUsd);
    const total = sorted.reduce((acc, c) => acc + c.totalCostUsd, 0);
    if (total === 0) return { p95Share: 0, p99Share: 0 };

    const shareOfTop = (fraction) => {
      const count = Math.max(1, Math.ceil(sorted.length * fraction));
      const slice = sorted.slice(0, count).reduce((acc, c) => acc + c.totalCostUsd, 0);
      return slice / total;
    };

    return { p95Share: shareOfTop(0.05), p99Share: shareOfTop(0.01) };
  }

  return { recordTurn, concentration, costOf };
}`,
        },
        {
          type: 'paragraph',
          value:
            'La función de concentración es la que justifica todo el trabajo. Si el cinco por ciento de conversaciones más caras consume quince por ciento del costo, la distribución es sana y la cuota de contexto es optimización prematura. Si consume cincuenta por ciento o más, tenés una minoría de conversaciones absorbiendo la mitad del presupuesto, y cualquier política que actúe sobre ellas rinde más que cualquier optimización de prompt aplicada al otro noventa y cinco por ciento.',
        },
        {
          type: 'paragraph',
          value:
            'Separar entrada nueva de entrada cacheada en el cálculo de costo no es un detalle contable. En un sistema con caché de prefijo bien configurada, una conversación larga en ráfaga puede costar mucho menos de lo que sugiere la curva cuadrática, mientras que la misma conversación repartida a lo largo del día paga precio completo en cada turno. Si medís todo como entrada única, la cola parece mayor de lo que es en ráfaga y menor de lo que es cuando está espaciada, y la política nace mal calibrada en las dos puntas.',
        },
      ],
    },
    {
      title: 'Qué descartar cuando la cuota se agota',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Agotar la cuota no debería significar truncar el historial por el comienzo, que es el comportamiento por defecto de la mayoría de las implementaciones y el peor de todos. El inicio de la conversación suele contener exactamente lo que no puede perderse: quién es el cliente, qué pedido está en cuestión, qué problema originó la atención. Cortar por el comienzo produce el comportamiento más irritante que puede tener un agente, que es olvidar en el turno treinta lo que el cliente explicó en el turno dos.',
        },
        {
          type: 'paragraph',
          value:
            'La alternativa es tratar el historial como tres capas con prioridades distintas: hechos durables extraídos de la conversación, resumen de los episodios antiguos y transcripción literal de los turnos recientes. Cuando la cuota aprieta, la transcripción literal es la primera en encoger, el resumen se comprime después, y los hechos durables nunca salen. Es la misma idea de un presupuesto con porciones reservadas: cada capa tiene un mínimo garantizado y un máximo, y la holgura se reparte entre ellas.',
        },
        {
          type: 'diagram',
          value: `Asignacion de la ventana con cuota de 8.000 tokens de historial

  CONVERSACION CORTA (turno 4)      CONVERSACION LARGA (turno 47)
  +----------------------+          +----------------------+
  | hechos durables  400 |          | hechos durables  900 |  <- nunca se corta
  +----------------------+          +----------------------+
  | resumen            0 |          | resumen        2.600 |  <- comprimido
  +----------------------+          +----------------------+
  | transcripcion  1.100 |          | transcripcion  4.500 |  <- ventana movil
  +----------------------+          +----------------------+
  | holgura        6.500 |          | holgura            0 |
  +----------------------+          +----------------------+
    total: 1.500                      total: 8.000 (en el techo)

  Llega el turno 48 y no entra:
    1. la transcripcion cede sus turnos mas viejos hasta el piso de 2.000
    2. lo que sale de la transcripcion entra al resumen (1 llamada barata)
    3. el resumen se recomprime si pasa su techo de 3.000
    4. los hechos durables quedan intactos: 900 tokens que valen mas
       que los 4.500 de toda la transcripcion

  Lo que el cliente percibe: nada, siempre que el paso 2 corra antes del
  descarte y no despues. Resumir lo que ya se tiro es el bug mas comun
  de esta implementacion.`,
        },
        {
          type: 'code',
          value: `// context/quota.js
// Asigna la ventana de historial por capas con piso y techo por capa.
// Regla central: lo que sale de la transcripcion pasa por el resumen
// antes de ser descartado, nunca despues.

const LAYERS = {
  facts: { floor: 200, ceiling: 1200 },
  summary: { floor: 0, ceiling: 3000 },
  transcript: { floor: 2000, ceiling: Infinity },
};

export function createQuotaAllocator({ countTokens, summarize, metrics }) {
  async function allocate({ conversationId, quotaTokens, facts, summary, transcript }) {
    const factsTokens = Math.min(countTokens(facts), LAYERS.facts.ceiling);
    let summaryText = summary;
    let summaryTokens = countTokens(summaryText);
    let kept = [...transcript];

    const fits = () =>
      factsTokens + summaryTokens + countTokens(kept) <= quotaTokens;

    // Mientras no entra, los turnos mas viejos salen de la transcripcion
    // y los absorbe el resumen. El piso de la transcripcion garantiza que
    // la conversacion no pierda el contexto inmediato del turno actual.
    const evicted = [];
    while (!fits() && countTokens(kept) > LAYERS.transcript.floor) {
      evicted.push(kept.shift());
    }

    if (evicted.length > 0) {
      // Una llamada barata con modelo pequeno: resumir es la operacion
      // que preserva el valor de lo que simplemente se descartaria.
      summaryText = await summarize({ previous: summaryText, turns: evicted });
      summaryTokens = countTokens(summaryText);
      metrics.counter('context.turns_evicted_total', evicted.length, { reason: 'quota' });
    }

    // Si aun asi no entra, el resumen es quien cede: es reconstruible
    // desde la conversacion persistida, la transcripcion reciente no.
    if (!fits() && summaryTokens > LAYERS.summary.floor) {
      summaryText = await summarize({ previous: summaryText, turns: [], targetTokens: Math.max(
        LAYERS.summary.floor,
        quotaTokens - factsTokens - countTokens(kept),
      ) });
      summaryTokens = countTokens(summaryText);
      metrics.counter('context.summary_recompressed_total', 1, {});
    }

    const usedTokens = factsTokens + summaryTokens + countTokens(kept);
    metrics.histogram('context.window_used_tokens', usedTokens, {
      at_ceiling: usedTokens >= quotaTokens * 0.95 ? 'yes' : 'no',
    });

    return { facts, summary: summaryText, transcript: kept, usedTokens, evictedCount: evicted.length };
  }

  return { allocate, LAYERS };
}`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle que hace funcionar esta implementación es el orden: resumir antes de descartar. La versión ingenua corta los turnos viejos, envía el prompt y resume después, lo que en la práctica significa resumir a partir de un historial que ya perdió lo que importaba. También vale notar que el resumen cede antes que la transcripción reciente y no al revés: el resumen puede reconstruirse desde la conversación persistida en la base, mientras que perder los turnos inmediatamente anteriores rompe la coherencia de la respuesta actual.',
        },
      ],
    },
    {
      title: 'Cuándo la conversación larga no es abuso y la cuota está mal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No toda conversación larga es desperdicio, y tratar el largo como señal de abuso es el error que convierte una política de costo en una política de empeorar la atención. Existe toda una categoría de conversación que es larga porque el problema es difícil, y suele ser justamente la de mayor valor: negociación de contrato, diagnóstico técnico, disputa de cobro, onboarding de cliente grande. Cortar contexto exactamente ahí es ahorrar centavos y arriesgar el contrato.',
        },
        {
          type: 'list',
          items: [
            'Larga con progreso: cada turno resuelve una parte y el cliente confirma. Aquí la cuota debe ser generosa, porque el costo está comprando un desenlace.',
            'Larga en bucle: el cliente repite la misma pregunta reformulada y el agente repite la misma respuesta reformulada. Aquí el problema no es costo, es que el agente no sabe responder y debería escalar.',
            'Larga por exploración: el cliente navega el catálogo sin intención clara. Una cuota ajustada es apropiada, porque cada turno carga poco valor.',
            'Larga artificialmente: automatización del otro lado manteniendo la sesión abierta. Eso es abuso y el control correcto es el techo de gasto, no la cuota de contexto.',
            'Larga por retomada: el cliente vuelve días después sobre el mismo asunto. Aquí lo que importa son los hechos durables, no la transcripción, y la cuota ni se acerca a su techo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La segunda categoría merece destaque porque es la más cara y la más fácil de detectar. Una conversación en bucle tiene firma clara: la similitud entre el mensaje actual y algún mensaje anterior del propio cliente es alta, y la similitud entre la respuesta actual y alguna respuesta anterior también. Cuando ambas cosas pasan por dos o tres turnos seguidos, gastar más tokens no va a resolverlo, y el comportamiento correcto es ofrecer traspaso a un humano en vez de seguir cargando un historial que solo crece.',
        },
        {
          type: 'paragraph',
          value:
            'Eso cambia la naturaleza de la política. Una cuota de contexto que solo comprime es incompleta: necesita venir acompañada de un disparador de salida. Si la conversación supera el techo de turnos definido para ese tipo y no hubo progreso medible, lo correcto es escalar, no seguir comprimiendo. Costo alto sin desenlace es lo peor de los dos mundos, y es exactamente lo que produce una política de compresión aislada.',
        },
      ],
    },
    {
      title: 'La política en producción: números, disparadores y qué observar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La implementación en producción necesita tres decisiones numéricas y dos de comportamiento. Las numéricas son la cuota base por clase de conversación, el piso de la transcripción y el techo de turnos antes del disparador de salida. Las de comportamiento son qué hacer cuando la cuota se agota y qué hacer cuando el techo de turnos se supera, que son situaciones distintas y frecuentemente tratadas como la misma.',
        },
        {
          type: 'table',
          columns: ['Clase de conversación', 'Cuota de historial', 'Piso de transcripción', 'Disparador de salida'],
          rows: [
            [
              'Consulta de catálogo',
              '2.000 tokens',
              '600 tokens',
              '8 turnos sin intención clara',
            ],
            [
              'Soporte de primer nivel',
              '6.000 tokens',
              '2.000 tokens',
              '12 turnos sin progreso',
            ],
            [
              'Diagnóstico técnico',
              '12.000 tokens',
              '4.000 tokens',
              '25 turnos sin progreso',
            ],
            [
              'Disputa o cobro',
              '10.000 tokens',
              '3.000 tokens',
              '6 turnos, escala por política',
            ],
            [
              'Onboarding asistido',
              '16.000 tokens',
              '5.000 tokens',
              'Sin disparador, es acompañamiento',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La fila de disputa es la que más se desvía y la más importante de acertar. La cuota es alta porque el historial completo importa cuando hay divergencia sobre lo que se dijo, pero el disparador de salida es el más corto de la tabla, porque una disputa que pasa de seis turnos con un agente automático rara vez termina bien. Cuota generosa con escalada rápida no es contradicción: es reconocer que el contexto debe estar completo justamente para que la transferencia al humano sea útil.',
        },
        {
          type: 'ordered',
          items: [
            'Instrumentá el costo marginal por turno y la concentración antes de definir cualquier número, para saber si la cola justifica la política.',
            'Empezá con cuota por clase de conversación, no por plan, porque el valor está en el tipo de problema y no en el contrato.',
            'Implementá la asignación en capas con piso por capa, garantizando que los hechos durables nunca sean descartados.',
            'Resumí lo que sale de la transcripción antes del descarte y nunca después, con un modelo pequeño para que la operación sea barata.',
            'Agregá el disparador de salida por ausencia de progreso, separado de la cuota, porque comprimir no resuelve una conversación en bucle.',
            'Monitoreá la proporción de conversaciones que alcanzan el techo de la cuota: si pasa de diez por ciento en una clase, la cuota de esa clase está mal.',
            'Compará la tasa de resolución con y sin compresión en el conjunto de evaluación antes de considerar la política aprobada.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El penúltimo ítem es la alarma más útil y la más olvidada. La cuota debería ser un límite raramente tocado, no un régimen operativo permanente. Si una clase entera de conversación vive comprimiendo historial, el número no está protegiendo margen, está degradando la atención de forma sistemática e invisible, y lo correcto es elevar la cuota de esa clase o repensar qué entra en el prompt de sistema, que suele ser donde están los tokens realmente desperdiciados.',
        },
        {
          type: 'paragraph',
          value:
            'Vale terminar reconociendo lo que esta política no resuelve. La cuota de contexto controla el costo marginal de continuar una conversación, y lo hace bien. No arregla un prompt de sistema inflado, no reemplaza el enrutamiento a un modelo menor en las rutas simples y no impide que una automatización abusiva mantenga mil sesiones abiertas. Cada uno de esos tiene su propio control, y el valor de la cuota es justamente ser específica: responde una sola pregunta, que es cuánto historial merece cargar esta conversación ahora, y la responde de un modo que el cliente no siente.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por qué subió mi factura si la cantidad de conversaciones no cambió?',
      answer:
        'Casi siempre porque el largo promedio de las conversaciones subió, y el costo crece con el cuadrado del largo y no de forma lineal. En un agente que reenvía el historial completo en cada turno, el turno N carga todo lo que vino antes, así que el acumulado después de N turnos es proporcional a N al cuadrado. En la práctica, un aumento del diez por ciento en el largo promedio produce cerca de veintiuno por ciento más de costo con el mismo volumen de conversaciones. Y como el promedio esconde la distribución, el caso más común es todavía más desigual: el promedio apenas se mueve mientras una minoría de conversaciones muy largas absorbe la mitad del presupuesto. La forma de confirmarlo es medir la concentración, es decir, qué fracción del costo total vive en el cinco por ciento de conversaciones más caras. Por encima del cincuenta por ciento, el problema está en la cola y ninguna optimización de prompt aplicada al caso promedio lo va a resolver.',
    },
    {
      question: 'Truncar el historial por el comienzo no es la solución más simple?',
      answer:
        'Es la más simple de implementar y la peor en resultado, porque el inicio de la conversación suele contener exactamente lo que no puede perderse: quién es el cliente, qué pedido está en cuestión, qué problema originó la atención. Truncar por el comienzo produce el comportamiento más irritante que puede tener un agente, que es olvidar en el turno treinta lo que el cliente explicó en el turno dos, y el cliente reacciona repitiendo la información, lo que quema más turnos y más tokens. La alternativa es tratar el historial en tres capas con prioridades distintas: hechos durables extraídos de la conversación, resumen de los episodios antiguos y transcripción literal de los turnos recientes. Bajo presión de cuota la transcripción cede primero hasta un piso, lo que sale de ella es absorbido por el resumen antes de ser descartado, y los hechos durables nunca salen. El detalle que más se rompe en la práctica es el orden: resumir tiene que ocurrir antes del descarte, nunca después.',
    },
    {
      question: 'Cómo distinguir una conversación larga legítima de una que solo quema dinero?',
      answer:
        'Por el progreso, no por el largo. Una conversación larga con progreso resuelve parte del problema en cada turno y el cliente confirma el avance, y esa suele ser la conversación de mayor valor del sistema: negociación, diagnóstico técnico, disputa de cobro, onboarding. Cortar contexto exactamente ahí ahorra centavos y arriesga el contrato. Una conversación en bucle tiene la firma opuesta y detectable: el mensaje actual se parece mucho a alguno anterior del propio cliente y la respuesta actual se parece mucho a alguna respuesta anterior, por dos o tres turnos seguidos. En ese caso gastar más tokens no va a ayudar, porque el agente no sabe responder, y el comportamiento correcto es ofrecer traspaso a un humano. Por eso la cuota necesita venir con un disparador de salida por ausencia de progreso, separado del límite de tokens: comprimir una conversación en bucle solo produce costo alto sin desenlace, que es lo peor de los dos mundos.',
    },
  ],
  conclusion: {
    title: 'La conversación larga es una decisión de producto disfrazada de detalle técnico',
    description:
      'El costo de una conversación crece con el cuadrado de la cantidad de turnos, así que una minoría de conversaciones largas suele absorber la mitad del presupuesto sin aparecer en ninguna métrica promedio. La cuota de contexto es el control que actúa exactamente en ese punto, y es el más barato políticamente porque no bloquea a nadie: decide cuánto historial carga el agente por turno, con asignación en capas donde la transcripción cede primero, el resumen absorbe lo que sale antes del descarte y los hechos durables nunca se cortan. Lo que la cuota sola no resuelve es la conversación en bucle, que necesita un disparador de salida por ausencia de progreso en vez de más compresión. Y el número correcto nunca viene del plan del cliente, viene del tipo de problema que la conversación intenta resolver. Puedo medir la concentración de costo de tu agente, dimensionar la cuota por clase de conversación e implementar la asignación en capas sin que el cliente perciba la diferencia.',
    cta: 'Hablar sobre el costo de las conversaciones de mi agente',
  },
  related: [
    { label: 'Costo por conversación: atribuir la factura de IA al valor', to: '/blog/custo-por-conversa-atribuir-fatura-ia-ao-valor' },
    { label: 'Compresión de contexto sin perder señal', to: '/blog/compressao-contexto-caber-mais-janela-sem-perder-sinal' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

export default {
  pt,
  en,
  es,
};
