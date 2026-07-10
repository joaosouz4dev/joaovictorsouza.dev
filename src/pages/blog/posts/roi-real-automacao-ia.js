// Conteudo do artigo: roi-real-automacao-ia
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections, faq, conclusion, related }

const pt = {
  intro:
    'Quase todo cálculo de ROI de automação com IA que circula por aí está errado, e errado para mais. A conta ingênua pega o número de mensagens que o bot respondeu, multiplica pelo custo de um atendente humano e declara uma economia gigante. O problema é que mensagem respondida não é jornada resolvida, e custo de licença não é custo total. Este artigo aplica lógica de FinOps e estratégia ao tema: por que o ROI ingênuo engana, qual é o custo total de operar IA, como montar a fórmula de ROI por jornada com contenção real, como medir contenção de verdade, qual o horizonte de payback e as armadilhas que destroem qualquer estimativa. Nenhum valor de mercado é inventado aqui; tudo entra como variável para você preencher com os seus números.',
  sections: [
    {
      title: 'Por que o ROI ingênuo engana',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O cálculo ingênuo costuma ser este: "o bot respondeu 10 mil mensagens este mês, um atendente custaria X por mensagem, logo economizamos 10 mil vezes X". Três erros se escondem nessa frase. O primeiro é confundir mensagem respondida com problema resolvido: o bot pode ter respondido 10 mil vezes e mesmo assim metade dos clientes acabou caindo no humano ou voltou no dia seguinte, o que significa que a jornada não foi contida e o custo humano não foi evitado. O segundo erro é tratar o custo da automação como zero ou quase zero, ignorando tokens, infra, build, manutenção e curadoria de base. O terceiro é não ter baseline: sem saber quanto custava resolver aquela jornada antes da IA, qualquer economia declarada é um chute. ROI honesto exige contenção real, qualidade preservada e custo total na conta; sem esses três, o número só serve para enganar quem aprova o orçamento.',
        },
      ],
    },
    {
      title: 'O custo TOTAL da automação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de falar em retorno, é preciso somar tudo o que a automação consome. O custo de IA não é só o preço do modelo: ele tem componentes recorrentes (tokens, infra) e componentes de capital e manutenção que muita gente esquece. A tabela abaixo lista as categorias que precisam entrar no denominador do ROI. Os valores variam por fornecedor, região e maturidade do projeto, então trate-os como variáveis a preencher, não como números fixos.',
        },
        {
          type: 'table',
          columns: ['Categoria de custo', 'O que inclui', 'Recorrente ou pontual', 'Por que costuma ser subestimado'],
          rows: [
            [
              'LLM / tokens',
              'Tokens de entrada e saída, embeddings, reranking, retries',
              'Recorrente (escala com volume)',
              'Só conta o caso feliz e ignora retries, prompts longos e contexto de RAG',
            ],
            [
              'Infra',
              'Hospedagem, banco vetorial, filas, observabilidade, gateway',
              'Recorrente',
              'Tratada como custo fixo invisível até a conta da nuvem chegar',
            ],
            [
              'Build',
              'Engenharia inicial, integração, prompts, fluxos, testes',
              'Pontual (amortizado)',
              'Considerado custo único, mas precisa ser diluído no horizonte do ROI',
            ],
            [
              'Manutenção',
              'Ajustes de prompt, correção de regressão, atualização de integrações',
              'Recorrente',
              'Some do orçamento porque "já foi entregue", quando na verdade nunca para',
            ],
            [
              'Curadoria de base',
              'Atualizar e revisar a base de conhecimento que alimenta o RAG',
              'Recorrente',
              'Sem curadoria a contenção cai e o custo de erro sobe silenciosamente',
            ],
            [
              'Custo de erro / escalonamento',
              'Handoff para humano, retrabalho, reabertura, dano de uma resposta errada',
              'Recorrente (variável)',
              'Tratado como zero, quando é o que mais corrói o ganho líquido',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A leitura de FinOps aqui é direta: o custo recorrente (tokens, infra, manutenção, curadoria, escalonamento) é o que determina se a automação continua valendo a pena ao longo do tempo, enquanto o build é um investimento inicial que se dilui. Quem só olha o preço do modelo enxerga uma fração do custo real e superestima o ROI.',
        },
      ],
    },
    {
      title: 'A fórmula de ROI por jornada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O ROI não deve ser calculado por mensagem, e sim por jornada. Uma jornada é um problema do cliente do início ao fim. O ganho de uma automação é o custo humano que ela realmente evitou: o volume de jornadas multiplicado pela taxa de contenção (quantas o bot resolveu de fato) multiplicado pelo custo que cada atendimento humano teria. Desse ganho bruto você subtrai o custo total da automação (recorrente mais build amortizado) para chegar ao ganho líquido. O ROI é o ganho líquido sobre o custo total. A função abaixo formaliza isso e já calcula também o payback. Os inputs são ilustrativos: troque pelos seus.',
        },
        {
          type: 'code',
          value: `// ROI por jornada e payback (estrutura, nao valores de mercado).
// Todos os numeros abaixo sao EXEMPLOS ilustrativos.
// Preencha com os dados reais da sua operacao.

const exemplo = {
  jornadasMes: 10000,          // jornadas (problemas) que chegam por mes
  taxaContencao: 0.45,         // fracao RESOLVIDA pelo bot (sem handoff, sem reabertura)
  custoHumanoPorJornada: 4.0,  // custo evitado por jornada contida (sua moeda)

  // Custo TOTAL da automacao
  custoRecorrenteMes: 6000,    // tokens + infra + manutencao + curadoria + escalonamento
  custoBuild: 48000,           // engenharia inicial (sera amortizada)
  mesesAmortizacao: 12,        // horizonte para diluir o build
};

function roiAutomacao(i) {
  // Ganho bruto = volume x contencao real x custo humano evitado
  const jornadasContidas = i.jornadasMes * i.taxaContencao;
  const ganhoBrutoMes = jornadasContidas * i.custoHumanoPorJornada;

  // Custo total mensal = recorrente + parcela do build amortizado
  const buildMensal = i.custoBuild / i.mesesAmortizacao;
  const custoTotalMes = i.custoRecorrenteMes + buildMensal;

  // Ganho liquido e ROI
  const ganhoLiquidoMes = ganhoBrutoMes - custoTotalMes;
  const roiMensal = ganhoLiquidoMes / custoTotalMes; // ex.: 0.2 = 20%

  // Payback: meses para o ganho acumulado cobrir o build.
  // Usa o ganho liquido ANTES de amortizar (recorrente puro contra o caixa).
  const ganhoLiquidoSemBuild = ganhoBrutoMes - i.custoRecorrenteMes;
  const paybackMeses =
    ganhoLiquidoSemBuild > 0 ? i.custoBuild / ganhoLiquidoSemBuild : Infinity;

  return { ganhoBrutoMes, custoTotalMes, ganhoLiquidoMes, roiMensal, paybackMeses };
}

// Leitura: se taxaContencao cai pela metade, o ganho bruto cai pela metade,
// mas o custo total quase nao muda => o ROI desaba. A contencao real e a
// alavanca dominante, nao o preco do token.
console.log(roiAutomacao(exemplo));`,
        },
        {
          type: 'diagram',
          value: `Volume de jornadas/mes
        |
        x  taxa de CONTENCAO real
        v
   Jornadas contidas
        |
        x  custo humano evitado por jornada
        v
   GANHO BRUTO  --(- custo total: recorrente + build amortizado)-->  GANHO LIQUIDO
                                                                          |
                                                          ganho liquido / custo total
                                                                          v
                                                                        ROI`,
        },
        {
          type: 'paragraph',
          value:
            'Repare na sensibilidade: o ganho bruto é linear na taxa de contenção, enquanto o custo total é quase inelástico no curto prazo. Isso significa que o ROI depende muito mais de quanto o bot realmente resolve do que de qualquer otimização de preço por token. Por isso a próxima seção trata de medir contenção de verdade.',
        },
      ],
    },
    {
      title: 'Taxa de contenção: como medir de verdade',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Contenção não é "o bot respondeu". Contenção é "o bot resolveu". Uma jornada só conta como contida quando satisfaz duas condições simultâneas: foi resolvida sem handoff para humano E sem reabertura dentro de uma janela razoável. Se qualquer uma falha, a jornada não foi contida e o custo humano não foi evitado de fato.',
        },
        {
          type: 'list',
          items: [
            'Resolvida sem handoff: a jornada terminou no próprio bot, sem ser transferida para um atendente humano. Transferiu, não conteve.',
            'Sem reabertura: o cliente não voltou com o mesmo problema dentro da janela de acompanhamento (por exemplo 24 a 72 horas). Voltou, a primeira resolução foi falsa.',
            'Medida por jornada, não por mensagem: a unidade é o problema do cliente, não a quantidade de mensagens trocadas no caminho.',
            'Com baseline: compare a taxa de contenção com o período pré-automação ou com um grupo de controle, senão você não sabe quanto a IA realmente mudou.',
            'Segmentada por intenção: a contenção de "segunda via de boleto" é muito diferente da de "cancelamento com retenção"; uma média única esconde onde o bot ganha e onde perde.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A diferença entre deflexão (o bot respondeu e o cliente não insistiu naquele instante) e resolução (o problema acabou) costuma ser de vários pontos percentuais. Usar deflexão no lugar de resolução infla a taxa de contenção e, por consequência, o ROI. Meça resolução com as duas condições acima e use isso na fórmula.',
        },
      ],
    },
    {
      title: 'Payback e horizonte: quando o investimento se paga',
      blocks: [
        {
          type: 'paragraph',
          value:
            'ROI mensal positivo não significa que o projeto já se pagou. O build é um investimento de capital que precisa ser recuperado pelo ganho líquido acumulado ao longo do tempo. Payback é o número de meses até o ganho acumulado cobrir esse investimento inicial. Pensar em horizonte evita dois erros opostos: declarar vitória cedo demais e desistir cedo demais.',
        },
        {
          type: 'ordered',
          items: [
            'Defina o baseline: quanto custava resolver essas jornadas antes da IA. Sem esse ponto de partida não há como medir ganho real.',
            'Estime o ganho líquido recorrente: ganho bruto (volume x contenção real x custo humano evitado) menos o custo recorrente mensal, ainda sem contar o build.',
            'Calcule o payback: divida o custo de build pelo ganho líquido recorrente mensal. O resultado é em quantos meses o investimento inicial se paga.',
            'Compare com o horizonte de validade da solução: se o payback é de 8 meses mas a base de conhecimento muda a cada 3, o investimento pode nunca quitar de forma estável.',
            'Reavalie periodicamente: contenção, volume e custos mudam. Recalcule ROI e payback a cada ciclo para confirmar que a automação continua no verde, e não apenas no mês do lançamento.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Um payback curto com contenção estável é o cenário ideal; um payback longo só se justifica se o volume e a qualidade tendem a crescer. A decisão de seguir, ajustar ou desligar a automação deve sair desse cálculo, não da empolgação do lançamento.',
        },
      ],
    },
    {
      title: 'Armadilhas que destroem a estimativa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo com a fórmula certa, alguns erros recorrentes corrompem o cálculo. Eles têm em comum o efeito de inflar o ganho ou esconder o custo, sempre empurrando o ROI para cima de forma artificial.',
        },
        {
          type: 'list',
          items: [
            'Medir deflexão e não resolução: contar como contido tudo que o bot respondeu, mesmo quando o cliente voltou ou foi para o humano. É a armadilha número um e a que mais infla o ROI.',
            'Ignorar o custo de manutenção: assumir que depois do build a automação roda sozinha. Prompt, integração e base exigem cuidado contínuo, e esse custo recorrente é parte do denominador.',
            'Não ter baseline: declarar economia sem saber o custo anterior por jornada. Sem ponto de comparação, o ROI é narrativa, não número.',
            'Esquecer o custo de erro: uma resposta errada pode gerar retrabalho, reabertura ou dano que custa mais do que o atendimento humano que se quis evitar.',
            'Amortizar mal o build: jogar todo o custo inicial em um mês (e declarar prejuízo) ou nunca diluí-lo (e declarar lucro irreal). O horizonte de amortização precisa ser explícito.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A defesa contra todas elas é a mesma disciplina de FinOps: medir resolução real, somar o custo total e comparar contra um baseline honesto. Com esses três pilares, o ROI deixa de ser uma peça de marketing interno e vira um instrumento de decisão.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Qual a diferença entre deflexão e contenção real?',
      answer:
        'Deflexão é o bot ter respondido e o cliente não ter insistido naquele momento; contenção real é a jornada ter sido resolvida sem handoff para humano e sem reabertura na janela de acompanhamento. Deflexão quase sempre é maior que contenção, e usar uma no lugar da outra infla o ROI. No cálculo de retorno, use apenas resolução verificada.',
    },
    {
      question: 'O custo da automação é só o preço dos tokens?',
      answer:
        'Não. Tokens são apenas uma parte do custo recorrente. O custo total inclui infra, manutenção contínua, curadoria da base de conhecimento, custo de erro e escalonamento, além do build inicial amortizado no horizonte. Quem soma apenas tokens enxerga uma fração do denominador e superestima o ROI de forma sistemática.',
    },
    {
      question: 'Por que você não dá números de mercado prontos?',
      answer:
        'Porque custo de modelo, infra e atendimento variam por fornecedor, região, volume e maturidade do projeto, e mudam com frequência. Trabalhar com valores fixos leva a decisões erradas assim que a realidade muda. Por isso a fórmula trata tudo como variável: você preenche com os seus números, com baseline próprio, e obtém um ROI que reflete a sua operação.',
    },
  ],
  conclusion: {
    title: 'ROI honesto é contenção real menos custo total',
    description:
      'Calcular retorno de automação com IA de forma honesta exige medir contenção de verdade, somar o custo total e comparar contra um baseline próprio. A conta ingênua de mensagens vezes custo humano quase sempre superestima o ganho. Se você quer montar esse modelo com os números da sua operação e descobrir o ROI e o payback reais, posso ajudar nessa análise.',
    cta: 'Calcular o ROI da minha automação',
  },
  related: [
    { label: 'Roadmap de automação de suporte com IA em 90 dias', to: '/blog/roadmap-automacao-suporte-ia-90-dias' },
    { label: 'Custos da WhatsApp Cloud API e otimização', to: '/blog/custos-whatsapp-cloud-api-otimizacao' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

const en = {
  intro:
    'Almost every AI automation ROI calculation floating around is wrong, and wrong on the high side. The naive math takes the number of messages the bot answered, multiplies by a human agent cost and declares a giant saving. The problem is that an answered message is not a resolved journey, and a license cost is not a total cost. This article applies FinOps and strategy thinking to the topic: why naive ROI deceives, what the total cost of running AI is, how to build the per-journey ROI formula with real containment, how to measure containment honestly, what the payback horizon looks like and the pitfalls that wreck any estimate. No market figure is invented here; everything goes in as a variable for you to fill with your own numbers.',
  sections: [
    {
      title: 'Why naive ROI deceives',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The naive calculation usually goes: "the bot answered 10k messages this month, an agent would cost X per message, so we saved 10k times X". Three errors hide in that sentence. The first is confusing answered message with solved problem: the bot may have answered 10k times and still half the customers ended up on a human or came back the next day, which means the journey was not contained and the human cost was not avoided. The second error is treating automation cost as zero or near zero, ignoring tokens, infra, build, maintenance and knowledge-base curation. The third is having no baseline: without knowing what it cost to resolve that journey before AI, any declared saving is a guess. Honest ROI requires real containment, preserved quality and total cost in the math; without those three, the number only serves to fool whoever approves the budget.',
        },
      ],
    },
    {
      title: 'The TOTAL cost of automation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before talking about return, you must add up everything the automation consumes. The cost of AI is not just the model price: it has recurring components (tokens, infra) and capital and maintenance components that many people forget. The table below lists the categories that must enter the ROI denominator. Values vary by vendor, region and project maturity, so treat them as variables to fill in, not as fixed numbers.',
        },
        {
          type: 'table',
          columns: ['Cost category', 'What it includes', 'Recurring or one-off', 'Why it is usually underestimated'],
          rows: [
            [
              'LLM / tokens',
              'Input and output tokens, embeddings, reranking, retries',
              'Recurring (scales with volume)',
              'Only counts the happy path and ignores retries, long prompts and RAG context',
            ],
            [
              'Infra',
              'Hosting, vector store, queues, observability, gateway',
              'Recurring',
              'Treated as an invisible fixed cost until the cloud bill arrives',
            ],
            [
              'Build',
              'Initial engineering, integration, prompts, flows, tests',
              'One-off (amortized)',
              'Seen as a single cost, but must be spread across the ROI horizon',
            ],
            [
              'Maintenance',
              'Prompt tweaks, regression fixes, integration updates',
              'Recurring',
              'Drops out of the budget because "it shipped", when it actually never stops',
            ],
            [
              'Knowledge-base curation',
              'Updating and reviewing the knowledge base that feeds RAG',
              'Recurring',
              'Without curation, containment falls and error cost rises silently',
            ],
            [
              'Error / escalation cost',
              'Human handoff, rework, reopening, damage from a wrong answer',
              'Recurring (variable)',
              'Treated as zero, when it is what erodes net gain the most',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The FinOps reading here is direct: the recurring cost (tokens, infra, maintenance, curation, escalation) is what determines whether the automation keeps paying off over time, while the build is an upfront investment that gets diluted. Anyone looking only at the model price sees a fraction of the real cost and overestimates ROI.',
        },
      ],
    },
    {
      title: 'The per-journey ROI formula',
      blocks: [
        {
          type: 'paragraph',
          value:
            'ROI should not be calculated per message, but per journey. A journey is a customer problem from start to finish. The gain of an automation is the human cost it actually avoided: the volume of journeys times the containment rate (how many the bot truly resolved) times the cost each human handling would have had. From that gross gain you subtract the total automation cost (recurring plus amortized build) to reach the net gain. ROI is net gain over total cost. The function below formalizes this and also computes payback. The inputs are illustrative: swap in your own.',
        },
        {
          type: 'code',
          value: `// Per-journey ROI and payback (structure, not market values).
// All numbers below are ILLUSTRATIVE examples.
// Fill in with your operation's real data.

const example = {
  journeysMonth: 10000,        // journeys (problems) arriving per month
  containmentRate: 0.45,       // fraction RESOLVED by the bot (no handoff, no reopening)
  humanCostPerJourney: 4.0,    // cost avoided per contained journey (your currency)

  // TOTAL automation cost
  recurringCostMonth: 6000,    // tokens + infra + maintenance + curation + escalation
  buildCost: 48000,            // initial engineering (will be amortized)
  amortizationMonths: 12,      // horizon over which to spread the build
};

function automationRoi(i) {
  // Gross gain = volume x real containment x avoided human cost
  const containedJourneys = i.journeysMonth * i.containmentRate;
  const grossGainMonth = containedJourneys * i.humanCostPerJourney;

  // Total monthly cost = recurring + share of amortized build
  const buildMonthly = i.buildCost / i.amortizationMonths;
  const totalCostMonth = i.recurringCostMonth + buildMonthly;

  // Net gain and ROI
  const netGainMonth = grossGainMonth - totalCostMonth;
  const monthlyRoi = netGainMonth / totalCostMonth; // e.g. 0.2 = 20%

  // Payback: months for cumulative gain to cover the build.
  // Uses net gain BEFORE amortizing (pure recurring against cash).
  const netGainNoBuild = grossGainMonth - i.recurringCostMonth;
  const paybackMonths =
    netGainNoBuild > 0 ? i.buildCost / netGainNoBuild : Infinity;

  return { grossGainMonth, totalCostMonth, netGainMonth, monthlyRoi, paybackMonths };
}

// Reading: if containmentRate halves, gross gain halves, but total cost
// barely moves => ROI collapses. Real containment is the dominant lever,
// not the token price.
console.log(automationRoi(example));`,
        },
        {
          type: 'diagram',
          value: `Journeys volume/month
        |
        x  real CONTAINMENT rate
        v
   Contained journeys
        |
        x  avoided human cost per journey
        v
   GROSS GAIN  --(- total cost: recurring + amortized build)-->  NET GAIN
                                                                     |
                                                       net gain / total cost
                                                                     v
                                                                   ROI`,
        },
        {
          type: 'paragraph',
          value:
            'Note the sensitivity: gross gain is linear in the containment rate, while total cost is almost inelastic in the short term. This means ROI depends far more on how much the bot actually resolves than on any per-token price optimization. That is why the next section is about measuring containment honestly.',
        },
      ],
    },
    {
      title: 'Containment rate: how to measure it honestly',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Containment is not "the bot answered". Containment is "the bot resolved". A journey only counts as contained when it satisfies two conditions at once: it was resolved without a human handoff AND without reopening within a reasonable window. If either fails, the journey was not contained and the human cost was not truly avoided.',
        },
        {
          type: 'list',
          items: [
            'Resolved without handoff: the journey ended in the bot itself, without being transferred to a human agent. Transferred means not contained.',
            'No reopening: the customer did not return with the same problem within the follow-up window (say 24 to 72 hours). Returned means the first resolution was false.',
            'Measured per journey, not per message: the unit is the customer problem, not the number of messages exchanged along the way.',
            'With a baseline: compare the containment rate to the pre-automation period or a control group, otherwise you do not know how much the AI actually changed.',
            'Segmented by intent: containment for "duplicate invoice" is very different from "cancellation with retention"; a single average hides where the bot wins and where it loses.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The gap between deflection (the bot answered and the customer did not insist at that moment) and resolution (the problem ended) is often several percentage points. Using deflection in place of resolution inflates the containment rate and, as a result, the ROI. Measure resolution with the two conditions above and use that in the formula.',
        },
      ],
    },
    {
      title: 'Payback and horizon: when the investment pays off',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A positive monthly ROI does not mean the project has paid off yet. The build is a capital investment that must be recovered by the cumulative net gain over time. Payback is the number of months until the cumulative gain covers that upfront investment. Thinking in horizon avoids two opposite errors: declaring victory too early and giving up too early.',
        },
        {
          type: 'ordered',
          items: [
            'Define the baseline: what it cost to resolve these journeys before AI. Without that starting point there is no way to measure real gain.',
            'Estimate the recurring net gain: gross gain (volume x real containment x avoided human cost) minus the monthly recurring cost, still excluding the build.',
            'Compute the payback: divide the build cost by the monthly recurring net gain. The result is how many months the upfront investment takes to pay off.',
            'Compare with the solution validity horizon: if payback is 8 months but the knowledge base changes every 3, the investment may never settle stably.',
            'Reassess periodically: containment, volume and costs change. Recompute ROI and payback each cycle to confirm the automation stays in the green, not just in launch month.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A short payback with stable containment is the ideal scenario; a long payback is only justified if volume and quality are trending up. The decision to continue, adjust or shut the automation down should come from this calculation, not from launch excitement.',
        },
      ],
    },
    {
      title: 'Pitfalls that wreck the estimate',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Even with the right formula, a few recurring errors corrupt the calculation. They share the effect of inflating the gain or hiding the cost, always pushing ROI up artificially.',
        },
        {
          type: 'list',
          items: [
            'Measuring deflection, not resolution: counting as contained everything the bot answered, even when the customer returned or went to a human. This is pitfall number one and the one that inflates ROI the most.',
            'Ignoring maintenance cost: assuming that after the build the automation runs on its own. Prompts, integrations and the base need continuous care, and that recurring cost is part of the denominator.',
            'Having no baseline: declaring savings without knowing the prior cost per journey. Without a comparison point, ROI is narrative, not a number.',
            'Forgetting error cost: a wrong answer can cause rework, reopening or damage that costs more than the human handling it was meant to avoid.',
            'Amortizing the build badly: dumping the whole upfront cost in one month (and declaring a loss) or never spreading it (and declaring unreal profit). The amortization horizon must be explicit.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The defense against all of them is the same FinOps discipline: measure real resolution, add the total cost and compare against an honest baseline. With those three pillars, ROI stops being internal marketing and becomes a decision instrument.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'What is the difference between deflection and real containment?',
      answer:
        'Deflection is the bot having answered and the customer not insisting at that moment; real containment is the journey being resolved without a human handoff and without reopening in the follow-up window. Deflection is almost always higher than containment, and using one for the other inflates ROI. In the return calculation, use only verified resolution.',
    },
    {
      question: 'Is the automation cost just the token price?',
      answer:
        'No. Tokens are only part of the recurring cost. The total cost includes infra, ongoing maintenance, knowledge-base curation, error and escalation cost, plus the initial build amortized over the horizon. Anyone summing only tokens sees a fraction of the denominator and systematically overestimates ROI.',
    },
    {
      question: 'Why do you not give ready-made market numbers?',
      answer:
        'Because model, infra and support costs vary by vendor, region, volume and project maturity, and they change often. Working with fixed values leads to wrong decisions as soon as reality shifts. That is why the formula treats everything as a variable: you fill in your own numbers, with your own baseline, and get an ROI that reflects your operation.',
    },
  ],
  conclusion: {
    title: 'Honest ROI is real containment minus total cost',
    description:
      'Calculating AI automation return honestly requires measuring real containment, adding the total cost and comparing against your own baseline. The naive messages-times-human-cost math almost always overestimates the gain. If you want to build this model with your operation numbers and find the real ROI and payback, I can help with that analysis.',
    cta: 'Calculate my automation ROI',
  },
  related: [
    { label: 'AI support automation roadmap in 90 days', to: '/blog/roadmap-automacao-suporte-ia-90-dias' },
    { label: 'WhatsApp Cloud API costs and optimization', to: '/blog/custos-whatsapp-cloud-api-otimizacao' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
};

const es = {
  intro:
    'Casi todo cálculo de ROI de automatización con IA que circula por ahí está mal, y mal por exceso. La cuenta ingenua toma el número de mensajes que el bot respondió, lo multiplica por el costo de un agente humano y declara un ahorro gigante. El problema es que un mensaje respondido no es una jornada resuelta, y un costo de licencia no es un costo total. Este artículo aplica lógica de FinOps y estrategia al tema: por qué el ROI ingenuo engaña, cuál es el costo total de operar IA, cómo armar la fórmula de ROI por jornada con contención real, cómo medir contención de verdad, cuál es el horizonte de payback y las trampas que destruyen cualquier estimación. Aquí no se inventa ningún valor de mercado; todo entra como variable para que lo completes con tus propios números.',
  sections: [
    {
      title: 'Por qué el ROI ingenuo engaña',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El cálculo ingenuo suele ser este: "el bot respondió 10 mil mensajes este mes, un agente costaría X por mensaje, así que ahorramos 10 mil por X". Tres errores se esconden en esa frase. El primero es confundir mensaje respondido con problema resuelto: el bot pudo responder 10 mil veces y aún así la mitad de los clientes terminó en el humano o volvió al día siguiente, lo que significa que la jornada no fue contenida y el costo humano no se evitó. El segundo error es tratar el costo de la automatización como cero o casi cero, ignorando tokens, infra, build, mantenimiento y curaduría de base. El tercero es no tener baseline: sin saber cuánto costaba resolver esa jornada antes de la IA, cualquier ahorro declarado es una conjetura. Un ROI honesto exige contención real, calidad preservada y costo total en la cuenta; sin esos tres, el número solo sirve para engañar a quien aprueba el presupuesto.',
        },
      ],
    },
    {
      title: 'El costo TOTAL de la automatización',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de hablar de retorno, hay que sumar todo lo que consume la automatización. El costo de IA no es solo el precio del modelo: tiene componentes recurrentes (tokens, infra) y componentes de capital y mantenimiento que mucha gente olvida. La tabla siguiente lista las categorías que deben entrar en el denominador del ROI. Los valores varían por proveedor, región y madurez del proyecto, así que trátalos como variables a completar, no como números fijos.',
        },
        {
          type: 'table',
          columns: ['Categoría de costo', 'Qué incluye', 'Recurrente o puntual', 'Por qué suele subestimarse'],
          rows: [
            [
              'LLM / tokens',
              'Tokens de entrada y salida, embeddings, reranking, reintentos',
              'Recurrente (escala con el volumen)',
              'Solo cuenta el caso feliz e ignora reintentos, prompts largos y contexto de RAG',
            ],
            [
              'Infra',
              'Hosting, base vectorial, colas, observabilidad, gateway',
              'Recurrente',
              'Tratada como costo fijo invisible hasta que llega la factura de la nube',
            ],
            [
              'Build',
              'Ingeniería inicial, integración, prompts, flujos, pruebas',
              'Puntual (amortizado)',
              'Visto como costo único, pero hay que diluirlo en el horizonte del ROI',
            ],
            [
              'Mantenimiento',
              'Ajustes de prompt, corrección de regresión, actualización de integraciones',
              'Recurrente',
              'Desaparece del presupuesto porque "ya se entregó", cuando en realidad nunca para',
            ],
            [
              'Curaduría de base',
              'Actualizar y revisar la base de conocimiento que alimenta el RAG',
              'Recurrente',
              'Sin curaduría la contención baja y el costo de error sube en silencio',
            ],
            [
              'Costo de error / escalamiento',
              'Handoff al humano, retrabajo, reapertura, daño de una respuesta equivocada',
              'Recurrente (variable)',
              'Tratado como cero, cuando es lo que más corroe la ganancia neta',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La lectura de FinOps aquí es directa: el costo recurrente (tokens, infra, mantenimiento, curaduría, escalamiento) es lo que determina si la automatización sigue valiendo la pena con el tiempo, mientras que el build es una inversión inicial que se diluye. Quien solo mira el precio del modelo ve una fracción del costo real y sobreestima el ROI.',
        },
      ],
    },
    {
      title: 'La fórmula de ROI por jornada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El ROI no debe calcularse por mensaje, sino por jornada. Una jornada es un problema del cliente de principio a fin. La ganancia de una automatización es el costo humano que realmente evitó: el volumen de jornadas multiplicado por la tasa de contención (cuántas resolvió el bot de verdad) multiplicado por el costo que habría tenido cada atención humana. A esa ganancia bruta le restas el costo total de la automatización (recurrente más build amortizado) para llegar a la ganancia neta. El ROI es la ganancia neta sobre el costo total. La función siguiente formaliza esto y también calcula el payback. Los inputs son ilustrativos: cámbialos por los tuyos.',
        },
        {
          type: 'code',
          value: `// ROI por jornada y payback (estructura, no valores de mercado).
// Todos los numeros de abajo son EJEMPLOS ilustrativos.
// Completa con los datos reales de tu operacion.

const ejemplo = {
  jornadasMes: 10000,           // jornadas (problemas) que llegan por mes
  tasaContencion: 0.45,         // fraccion RESUELTA por el bot (sin handoff, sin reapertura)
  costoHumanoPorJornada: 4.0,   // costo evitado por jornada contenida (tu moneda)

  // Costo TOTAL de la automatizacion
  costoRecurrenteMes: 6000,     // tokens + infra + mantenimiento + curaduria + escalamiento
  costoBuild: 48000,            // ingenieria inicial (sera amortizada)
  mesesAmortizacion: 12,        // horizonte para diluir el build
};

function roiAutomatizacion(i) {
  // Ganancia bruta = volumen x contencion real x costo humano evitado
  const jornadasContenidas = i.jornadasMes * i.tasaContencion;
  const gananciaBrutaMes = jornadasContenidas * i.costoHumanoPorJornada;

  // Costo total mensual = recurrente + porcion del build amortizado
  const buildMensual = i.costoBuild / i.mesesAmortizacion;
  const costoTotalMes = i.costoRecurrenteMes + buildMensual;

  // Ganancia neta y ROI
  const gananciaNetaMes = gananciaBrutaMes - costoTotalMes;
  const roiMensual = gananciaNetaMes / costoTotalMes; // ej.: 0.2 = 20%

  // Payback: meses para que la ganancia acumulada cubra el build.
  // Usa la ganancia neta ANTES de amortizar (recurrente puro contra la caja).
  const gananciaNetaSinBuild = gananciaBrutaMes - i.costoRecurrenteMes;
  const paybackMeses =
    gananciaNetaSinBuild > 0 ? i.costoBuild / gananciaNetaSinBuild : Infinity;

  return { gananciaBrutaMes, costoTotalMes, gananciaNetaMes, roiMensual, paybackMeses };
}

// Lectura: si tasaContencion cae a la mitad, la ganancia bruta cae a la mitad,
// pero el costo total casi no cambia => el ROI se desploma. La contencion real
// es la palanca dominante, no el precio del token.
console.log(roiAutomatizacion(ejemplo));`,
        },
        {
          type: 'diagram',
          value: `Volumen de jornadas/mes
        |
        x  tasa de CONTENCION real
        v
   Jornadas contenidas
        |
        x  costo humano evitado por jornada
        v
   GANANCIA BRUTA  --(- costo total: recurrente + build amortizado)-->  GANANCIA NETA
                                                                            |
                                                          ganancia neta / costo total
                                                                            v
                                                                          ROI`,
        },
        {
          type: 'paragraph',
          value:
            'Fíjate en la sensibilidad: la ganancia bruta es lineal en la tasa de contención, mientras que el costo total es casi inelástico en el corto plazo. Esto significa que el ROI depende mucho más de cuánto resuelve el bot de verdad que de cualquier optimización de precio por token. Por eso la próxima sección trata de medir contención de verdad.',
        },
      ],
    },
    {
      title: 'Tasa de contención: cómo medir de verdad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Contención no es "el bot respondió". Contención es "el bot resolvió". Una jornada solo cuenta como contenida cuando cumple dos condiciones a la vez: fue resuelta sin handoff al humano Y sin reapertura dentro de una ventana razonable. Si alguna falla, la jornada no fue contenida y el costo humano no se evitó de verdad.',
        },
        {
          type: 'list',
          items: [
            'Resuelta sin handoff: la jornada terminó en el propio bot, sin ser transferida a un agente humano. Si se transfirió, no hubo contención.',
            'Sin reapertura: el cliente no volvió con el mismo problema dentro de la ventana de seguimiento (por ejemplo 24 a 72 horas). Si volvió, la primera resolución fue falsa.',
            'Medida por jornada, no por mensaje: la unidad es el problema del cliente, no la cantidad de mensajes intercambiados en el camino.',
            'Con baseline: compara la tasa de contención con el período previo a la automatización o con un grupo de control, si no, no sabes cuánto cambió la IA en realidad.',
            'Segmentada por intención: la contención de "duplicado de factura" es muy distinta de la de "cancelación con retención"; un promedio único esconde dónde el bot gana y dónde pierde.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La diferencia entre deflexión (el bot respondió y el cliente no insistió en ese momento) y resolución (el problema terminó) suele ser de varios puntos porcentuales. Usar deflexión en lugar de resolución infla la tasa de contención y, por consecuencia, el ROI. Mide resolución con las dos condiciones de arriba y usa eso en la fórmula.',
        },
      ],
    },
    {
      title: 'Payback y horizonte: cuándo la inversión se paga',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un ROI mensual positivo no significa que el proyecto ya se pagó. El build es una inversión de capital que debe recuperarse con la ganancia neta acumulada a lo largo del tiempo. El payback es el número de meses hasta que la ganancia acumulada cubra esa inversión inicial. Pensar en horizonte evita dos errores opuestos: declarar victoria demasiado pronto y rendirse demasiado pronto.',
        },
        {
          type: 'ordered',
          items: [
            'Define el baseline: cuánto costaba resolver esas jornadas antes de la IA. Sin ese punto de partida no hay forma de medir la ganancia real.',
            'Estima la ganancia neta recurrente: ganancia bruta (volumen x contención real x costo humano evitado) menos el costo recurrente mensual, todavía sin contar el build.',
            'Calcula el payback: divide el costo de build entre la ganancia neta recurrente mensual. El resultado es en cuántos meses se paga la inversión inicial.',
            'Compara con el horizonte de validez de la solución: si el payback es de 8 meses pero la base de conocimiento cambia cada 3, la inversión puede no saldarse nunca de forma estable.',
            'Reevalúa periódicamente: la contención, el volumen y los costos cambian. Recalcula ROI y payback en cada ciclo para confirmar que la automatización sigue en verde, y no solo en el mes del lanzamiento.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Un payback corto con contención estable es el escenario ideal; un payback largo solo se justifica si el volumen y la calidad tienden a crecer. La decisión de seguir, ajustar o apagar la automatización debe salir de este cálculo, no de la euforia del lanzamiento.',
        },
      ],
    },
    {
      title: 'Trampas que destruyen la estimación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Aun con la fórmula correcta, algunos errores recurrentes corrompen el cálculo. Tienen en común el efecto de inflar la ganancia o esconder el costo, siempre empujando el ROI hacia arriba de forma artificial.',
        },
        {
          type: 'list',
          items: [
            'Medir deflexión y no resolución: contar como contenido todo lo que el bot respondió, incluso cuando el cliente volvió o pasó al humano. Es la trampa número uno y la que más infla el ROI.',
            'Ignorar el costo de mantenimiento: asumir que después del build la automatización funciona sola. Prompt, integración y base exigen cuidado continuo, y ese costo recurrente es parte del denominador.',
            'No tener baseline: declarar ahorro sin conocer el costo anterior por jornada. Sin punto de comparación, el ROI es relato, no número.',
            'Olvidar el costo de error: una respuesta equivocada puede generar retrabajo, reapertura o daño que cuesta más que la atención humana que se quería evitar.',
            'Amortizar mal el build: cargar todo el costo inicial en un mes (y declarar pérdida) o nunca diluirlo (y declarar una ganancia irreal). El horizonte de amortización debe ser explícito.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La defensa contra todas ellas es la misma disciplina de FinOps: medir resolución real, sumar el costo total y comparar contra un baseline honesto. Con esos tres pilares, el ROI deja de ser una pieza de marketing interno y se vuelve un instrumento de decisión.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cuál es la diferencia entre deflexión y contención real?',
      answer:
        'La deflexión es que el bot haya respondido y el cliente no haya insistido en ese momento; la contención real es que la jornada se haya resuelto sin handoff al humano y sin reapertura en la ventana de seguimiento. La deflexión casi siempre es mayor que la contención, y usar una en lugar de la otra infla el ROI. En el cálculo de retorno, usa solo resolución verificada.',
    },
    {
      question: '¿El costo de la automatización es solo el precio de los tokens?',
      answer:
        'No. Los tokens son solo una parte del costo recurrente. El costo total incluye infra, mantenimiento continuo, curaduría de la base de conocimiento, costo de error y escalamiento, además del build inicial amortizado en el horizonte. Quien suma solo tokens ve una fracción del denominador y sobreestima el ROI de forma sistemática.',
    },
    {
      question: '¿Por qué no das números de mercado listos?',
      answer:
        'Porque el costo de modelo, infra y atención varía por proveedor, región, volumen y madurez del proyecto, y cambia con frecuencia. Trabajar con valores fijos lleva a decisiones equivocadas en cuanto la realidad cambia. Por eso la fórmula trata todo como variable: completas con tus propios números, con tu propio baseline, y obtienes un ROI que refleja tu operación.',
    },
  ],
  conclusion: {
    title: 'El ROI honesto es contención real menos costo total',
    description:
      'Calcular el retorno de automatización con IA de forma honesta exige medir contención de verdad, sumar el costo total y comparar contra tu propio baseline. La cuenta ingenua de mensajes por costo humano casi siempre sobreestima la ganancia. Si quieres armar este modelo con los números de tu operación y descubrir el ROI y el payback reales, puedo ayudarte en ese análisis.',
    cta: 'Calcular el ROI de mi automatización',
  },
  related: [
    { label: 'Roadmap de automatización de soporte con IA en 90 días', to: '/blog/roadmap-automacao-suporte-ia-90-dias' },
    { label: 'Costos de la WhatsApp Cloud API y optimización', to: '/blog/custos-whatsapp-cloud-api-otimizacao' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

export default { pt, en, es };
