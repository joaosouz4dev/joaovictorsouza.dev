// Conteudo do artigo: roi-real-automacao-ia
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections, faq, conclusion, related }

const pt = {
  intro:
    'Quase todo calculo de ROI de automacao com IA que circula por ai esta errado, e errado para mais. A conta ingenua pega o numero de mensagens que o bot respondeu, multiplica pelo custo de um atendente humano e declara uma economia gigante. O problema e que mensagem respondida nao e jornada resolvida, e custo de licenca nao e custo total. Este artigo aplica logica de FinOps e estrategia ao tema: por que o ROI ingenuo engana, qual e o custo total de operar IA, como montar a formula de ROI por jornada com contencao real, como medir contencao de verdade, qual o horizonte de payback e as armadilhas que destroem qualquer estimativa. Nenhum valor de mercado e inventado aqui; tudo entra como variavel para voce preencher com os seus numeros.',
  sections: [
    {
      title: 'Por que o ROI ingenuo engana',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O calculo ingenuo costuma ser este: "o bot respondeu 10 mil mensagens este mes, um atendente custaria X por mensagem, logo economizamos 10 mil vezes X". Tres erros se escondem nessa frase. O primeiro e confundir mensagem respondida com problema resolvido: o bot pode ter respondido 10 mil vezes e mesmo assim metade dos clientes acabou caindo no humano ou voltou no dia seguinte, o que significa que a jornada nao foi contida e o custo humano nao foi evitado. O segundo erro e tratar o custo da automacao como zero ou quase zero, ignorando tokens, infra, build, manutencao e curadoria de base. O terceiro e nao ter baseline: sem saber quanto custava resolver aquela jornada antes da IA, qualquer economia declarada e um chute. ROI honesto exige contencao real, qualidade preservada e custo total na conta; sem esses tres, o numero so serve para enganar quem aprova o orcamento.',
        },
      ],
    },
    {
      title: 'O custo TOTAL da automacao',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de falar em retorno, e preciso somar tudo o que a automacao consome. O custo de IA nao e so o preco do modelo: ele tem componentes recorrentes (tokens, infra) e componentes de capital e manutencao que muita gente esquece. A tabela abaixo lista as categorias que precisam entrar no denominador do ROI. Os valores variam por fornecedor, regiao e maturidade do projeto, entao trate-os como variaveis a preencher, nao como numeros fixos.',
        },
        {
          type: 'table',
          columns: ['Categoria de custo', 'O que inclui', 'Recorrente ou pontual', 'Por que costuma ser subestimado'],
          rows: [
            [
              'LLM / tokens',
              'Tokens de entrada e saida, embeddings, reranking, retries',
              'Recorrente (escala com volume)',
              'So conta o caso feliz e ignora retries, prompts longos e contexto de RAG',
            ],
            [
              'Infra',
              'Hospedagem, banco vetorial, filas, observabilidade, gateway',
              'Recorrente',
              'Tratada como custo fixo invisivel ate a conta da nuvem chegar',
            ],
            [
              'Build',
              'Engenharia inicial, integracao, prompts, fluxos, testes',
              'Pontual (amortizado)',
              'Considerado custo unico, mas precisa ser diluido no horizonte do ROI',
            ],
            [
              'Manutencao',
              'Ajustes de prompt, correcao de regressao, atualizacao de integracoes',
              'Recorrente',
              'Some do orcamento porque "ja foi entregue", quando na verdade nunca para',
            ],
            [
              'Curadoria de base',
              'Atualizar e revisar a base de conhecimento que alimenta o RAG',
              'Recorrente',
              'Sem curadoria a contencao cai e o custo de erro sobe silenciosamente',
            ],
            [
              'Custo de erro / escalonamento',
              'Handoff para humano, retrabalho, reabertura, dano de uma resposta errada',
              'Recorrente (variavel)',
              'Tratado como zero, quando e o que mais corroi o ganho liquido',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A leitura de FinOps aqui e direta: o custo recorrente (tokens, infra, manutencao, curadoria, escalonamento) e o que determina se a automacao continua valendo a pena ao longo do tempo, enquanto o build e um investimento inicial que se dilui. Quem so olha o preco do modelo enxerga uma fracao do custo real e superestima o ROI.',
        },
      ],
    },
    {
      title: 'A formula de ROI por jornada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O ROI nao deve ser calculado por mensagem, e sim por jornada. Uma jornada e um problema do cliente do inicio ao fim. O ganho de uma automacao e o custo humano que ela realmente evitou: o volume de jornadas multiplicado pela taxa de contencao (quantas o bot resolveu de fato) multiplicado pelo custo que cada atendimento humano teria. Desse ganho bruto voce subtrai o custo total da automacao (recorrente mais build amortizado) para chegar ao ganho liquido. O ROI e o ganho liquido sobre o custo total. A funcao abaixo formaliza isso e ja calcula tambem o payback. Os inputs sao ilustrativos: troque pelos seus.',
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
            'Repare na sensibilidade: o ganho bruto e linear na taxa de contencao, enquanto o custo total e quase inelastico no curto prazo. Isso significa que o ROI depende muito mais de quanto o bot realmente resolve do que de qualquer otimizacao de preco por token. Por isso a proxima secao trata de medir contencao de verdade.',
        },
      ],
    },
    {
      title: 'Taxa de contencao: como medir de verdade',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Contencao nao e "o bot respondeu". Contencao e "o bot resolveu". Uma jornada so conta como contida quando satisfaz duas condicoes simultaneas: foi resolvida sem handoff para humano E sem reabertura dentro de uma janela razoavel. Se qualquer uma falha, a jornada nao foi contida e o custo humano nao foi evitado de fato.',
        },
        {
          type: 'list',
          items: [
            'Resolvida sem handoff: a jornada terminou no proprio bot, sem ser transferida para um atendente humano. Transferiu, nao conteve.',
            'Sem reabertura: o cliente nao voltou com o mesmo problema dentro da janela de acompanhamento (por exemplo 24 a 72 horas). Voltou, a primeira resolucao foi falsa.',
            'Medida por jornada, nao por mensagem: a unidade e o problema do cliente, nao a quantidade de mensagens trocadas no caminho.',
            'Com baseline: compare a taxa de contencao com o periodo pre-automacao ou com um grupo de controle, senao voce nao sabe quanto a IA realmente mudou.',
            'Segmentada por intencao: a contencao de "segunda via de boleto" e muito diferente da de "cancelamento com retencao"; uma media unica esconde onde o bot ganha e onde perde.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A diferenca entre deflexao (o bot respondeu e o cliente nao insistiu naquele instante) e resolucao (o problema acabou) costuma ser de varios pontos percentuais. Usar deflexao no lugar de resolucao infla a taxa de contencao e, por consequencia, o ROI. Meca resolucao com as duas condicoes acima e use isso na formula.',
        },
      ],
    },
    {
      title: 'Payback e horizonte: quando o investimento se paga',
      blocks: [
        {
          type: 'paragraph',
          value:
            'ROI mensal positivo nao significa que o projeto ja se pagou. O build e um investimento de capital que precisa ser recuperado pelo ganho liquido acumulado ao longo do tempo. Payback e o numero de meses ate o ganho acumulado cobrir esse investimento inicial. Pensar em horizonte evita dois erros opostos: declarar vitoria cedo demais e desistir cedo demais.',
        },
        {
          type: 'ordered',
          items: [
            'Defina o baseline: quanto custava resolver essas jornadas antes da IA. Sem esse ponto de partida nao ha como medir ganho real.',
            'Estime o ganho liquido recorrente: ganho bruto (volume x contencao real x custo humano evitado) menos o custo recorrente mensal, ainda sem contar o build.',
            'Calcule o payback: divida o custo de build pelo ganho liquido recorrente mensal. O resultado e em quantos meses o investimento inicial se paga.',
            'Compare com o horizonte de validade da solucao: se o payback e de 8 meses mas a base de conhecimento muda a cada 3, o investimento pode nunca quitar de forma estavel.',
            'Reavalie periodicamente: contencao, volume e custos mudam. Recalcule ROI e payback a cada ciclo para confirmar que a automacao continua no verde, e nao apenas no mes do lancamento.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Um payback curto com contencao estavel e o cenario ideal; um payback longo so se justifica se o volume e a qualidade tendem a crescer. A decisao de seguir, ajustar ou desligar a automacao deve sair desse calculo, nao da empolgacao do lancamento.',
        },
      ],
    },
    {
      title: 'Armadilhas que destroem a estimativa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo com a formula certa, alguns erros recorrentes corrompem o calculo. Eles tem em comum o efeito de inflar o ganho ou esconder o custo, sempre empurrando o ROI para cima de forma artificial.',
        },
        {
          type: 'list',
          items: [
            'Medir deflexao e nao resolucao: contar como contido tudo que o bot respondeu, mesmo quando o cliente voltou ou foi para o humano. E a armadilha numero um e a que mais infla o ROI.',
            'Ignorar o custo de manutencao: assumir que depois do build a automacao roda sozinha. Prompt, integracao e base exigem cuidado continuo, e esse custo recorrente e parte do denominador.',
            'Nao ter baseline: declarar economia sem saber o custo anterior por jornada. Sem ponto de comparacao, o ROI e narrativa, nao numero.',
            'Esquecer o custo de erro: uma resposta errada pode gerar retrabalho, reabertura ou dano que custa mais do que o atendimento humano que se quis evitar.',
            'Amortizar mal o build: jogar todo o custo inicial em um mes (e declarar prejuizo) ou nunca dilui-lo (e declarar lucro irreal). O horizonte de amortizacao precisa ser explicito.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A defesa contra todas elas e a mesma disciplina de FinOps: medir resolucao real, somar o custo total e comparar contra um baseline honesto. Com esses tres pilares, o ROI deixa de ser uma peca de marketing interno e vira um instrumento de decisao.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Qual a diferenca entre deflexao e contencao real?',
      answer:
        'Deflexao e o bot ter respondido e o cliente nao ter insistido naquele momento; contencao real e a jornada ter sido resolvida sem handoff para humano e sem reabertura na janela de acompanhamento. Deflexao quase sempre e maior que contencao, e usar uma no lugar da outra infla o ROI. No calculo de retorno, use apenas resolucao verificada.',
    },
    {
      question: 'O custo da automacao e so o preco dos tokens?',
      answer:
        'Nao. Tokens sao apenas uma parte do custo recorrente. O custo total inclui infra, manutencao continua, curadoria da base de conhecimento, custo de erro e escalonamento, alem do build inicial amortizado no horizonte. Quem soma apenas tokens enxerga uma fracao do denominador e superestima o ROI de forma sistematica.',
    },
    {
      question: 'Por que voce nao da numeros de mercado prontos?',
      answer:
        'Porque custo de modelo, infra e atendimento variam por fornecedor, regiao, volume e maturidade do projeto, e mudam com frequencia. Trabalhar com valores fixos leva a decisoes erradas assim que a realidade muda. Por isso a formula trata tudo como variavel: voce preenche com os seus numeros, com baseline proprio, e obtem um ROI que reflete a sua operacao.',
    },
  ],
  conclusion: {
    title: 'ROI honesto e contencao real menos custo total',
    description:
      'Calcular retorno de automacao com IA de forma honesta exige medir contencao de verdade, somar o custo total e comparar contra um baseline proprio. A conta ingenua de mensagens vezes custo humano quase sempre superestima o ganho. Se voce quer montar esse modelo com os numeros da sua operacao e descobrir o ROI e o payback reais, posso ajudar nessa analise.',
    cta: 'Calcular o ROI da minha automacao',
  },
  related: [
    { label: 'Roadmap de automacao de suporte com IA em 90 dias', to: '/blog/roadmap-automacao-suporte-ia-90-dias' },
    { label: 'Custos da WhatsApp Cloud API e otimizacao', to: '/blog/custos-whatsapp-cloud-api-otimizacao' },
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
    'Casi todo calculo de ROI de automatizacion con IA que circula por ahi esta mal, y mal por exceso. La cuenta ingenua toma el numero de mensajes que el bot respondio, lo multiplica por el costo de un agente humano y declara un ahorro gigante. El problema es que un mensaje respondido no es una jornada resuelta, y un costo de licencia no es un costo total. Este articulo aplica logica de FinOps y estrategia al tema: por que el ROI ingenuo engana, cual es el costo total de operar IA, como armar la formula de ROI por jornada con contencion real, como medir contencion de verdad, cual es el horizonte de payback y las trampas que destruyen cualquier estimacion. Aqui no se inventa ningun valor de mercado; todo entra como variable para que lo completes con tus propios numeros.',
  sections: [
    {
      title: 'Por que el ROI ingenuo engana',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El calculo ingenuo suele ser este: "el bot respondio 10 mil mensajes este mes, un agente costaria X por mensaje, asi que ahorramos 10 mil por X". Tres errores se esconden en esa frase. El primero es confundir mensaje respondido con problema resuelto: el bot pudo responder 10 mil veces y aun asi la mitad de los clientes termino en el humano o volvio al dia siguiente, lo que significa que la jornada no fue contenida y el costo humano no se evito. El segundo error es tratar el costo de la automatizacion como cero o casi cero, ignorando tokens, infra, build, mantenimiento y curaduria de base. El tercero es no tener baseline: sin saber cuanto costaba resolver esa jornada antes de la IA, cualquier ahorro declarado es una conjetura. Un ROI honesto exige contencion real, calidad preservada y costo total en la cuenta; sin esos tres, el numero solo sirve para enganar a quien aprueba el presupuesto.',
        },
      ],
    },
    {
      title: 'El costo TOTAL de la automatizacion',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de hablar de retorno, hay que sumar todo lo que consume la automatizacion. El costo de IA no es solo el precio del modelo: tiene componentes recurrentes (tokens, infra) y componentes de capital y mantenimiento que mucha gente olvida. La tabla siguiente lista las categorias que deben entrar en el denominador del ROI. Los valores varian por proveedor, region y madurez del proyecto, asi que tratalos como variables a completar, no como numeros fijos.',
        },
        {
          type: 'table',
          columns: ['Categoria de costo', 'Que incluye', 'Recurrente o puntual', 'Por que suele subestimarse'],
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
              'Ingenieria inicial, integracion, prompts, flujos, pruebas',
              'Puntual (amortizado)',
              'Visto como costo unico, pero hay que diluirlo en el horizonte del ROI',
            ],
            [
              'Mantenimiento',
              'Ajustes de prompt, correccion de regresion, actualizacion de integraciones',
              'Recurrente',
              'Desaparece del presupuesto porque "ya se entrego", cuando en realidad nunca para',
            ],
            [
              'Curaduria de base',
              'Actualizar y revisar la base de conocimiento que alimenta el RAG',
              'Recurrente',
              'Sin curaduria la contencion baja y el costo de error sube en silencio',
            ],
            [
              'Costo de error / escalamiento',
              'Handoff al humano, retrabajo, reapertura, dano de una respuesta equivocada',
              'Recurrente (variable)',
              'Tratado como cero, cuando es lo que mas corroe la ganancia neta',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La lectura de FinOps aqui es directa: el costo recurrente (tokens, infra, mantenimiento, curaduria, escalamiento) es lo que determina si la automatizacion sigue valiendo la pena con el tiempo, mientras que el build es una inversion inicial que se diluye. Quien solo mira el precio del modelo ve una fraccion del costo real y sobreestima el ROI.',
        },
      ],
    },
    {
      title: 'La formula de ROI por jornada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El ROI no debe calcularse por mensaje, sino por jornada. Una jornada es un problema del cliente de principio a fin. La ganancia de una automatizacion es el costo humano que realmente evito: el volumen de jornadas multiplicado por la tasa de contencion (cuantas resolvio el bot de verdad) multiplicado por el costo que habria tenido cada atencion humana. A esa ganancia bruta le restas el costo total de la automatizacion (recurrente mas build amortizado) para llegar a la ganancia neta. El ROI es la ganancia neta sobre el costo total. La funcion siguiente formaliza esto y tambien calcula el payback. Los inputs son ilustrativos: cambialos por los tuyos.',
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
            'Fijate en la sensibilidad: la ganancia bruta es lineal en la tasa de contencion, mientras que el costo total es casi inelastico en el corto plazo. Esto significa que el ROI depende mucho mas de cuanto resuelve el bot de verdad que de cualquier optimizacion de precio por token. Por eso la proxima seccion trata de medir contencion de verdad.',
        },
      ],
    },
    {
      title: 'Tasa de contencion: como medir de verdad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Contencion no es "el bot respondio". Contencion es "el bot resolvio". Una jornada solo cuenta como contenida cuando cumple dos condiciones a la vez: fue resuelta sin handoff al humano Y sin reapertura dentro de una ventana razonable. Si alguna falla, la jornada no fue contenida y el costo humano no se evito de verdad.',
        },
        {
          type: 'list',
          items: [
            'Resuelta sin handoff: la jornada termino en el propio bot, sin ser transferida a un agente humano. Si se transfirio, no hubo contencion.',
            'Sin reapertura: el cliente no volvio con el mismo problema dentro de la ventana de seguimiento (por ejemplo 24 a 72 horas). Si volvio, la primera resolucion fue falsa.',
            'Medida por jornada, no por mensaje: la unidad es el problema del cliente, no la cantidad de mensajes intercambiados en el camino.',
            'Con baseline: compara la tasa de contencion con el periodo previo a la automatizacion o con un grupo de control, si no, no sabes cuanto cambio la IA en realidad.',
            'Segmentada por intencion: la contencion de "duplicado de factura" es muy distinta de la de "cancelacion con retencion"; un promedio unico esconde donde el bot gana y donde pierde.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La diferencia entre deflexion (el bot respondio y el cliente no insistio en ese momento) y resolucion (el problema termino) suele ser de varios puntos porcentuales. Usar deflexion en lugar de resolucion infla la tasa de contencion y, por consecuencia, el ROI. Mide resolucion con las dos condiciones de arriba y usa eso en la formula.',
        },
      ],
    },
    {
      title: 'Payback y horizonte: cuando la inversion se paga',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un ROI mensual positivo no significa que el proyecto ya se pago. El build es una inversion de capital que debe recuperarse con la ganancia neta acumulada a lo largo del tiempo. El payback es el numero de meses hasta que la ganancia acumulada cubra esa inversion inicial. Pensar en horizonte evita dos errores opuestos: declarar victoria demasiado pronto y rendirse demasiado pronto.',
        },
        {
          type: 'ordered',
          items: [
            'Define el baseline: cuanto costaba resolver esas jornadas antes de la IA. Sin ese punto de partida no hay forma de medir la ganancia real.',
            'Estima la ganancia neta recurrente: ganancia bruta (volumen x contencion real x costo humano evitado) menos el costo recurrente mensual, todavia sin contar el build.',
            'Calcula el payback: divide el costo de build entre la ganancia neta recurrente mensual. El resultado es en cuantos meses se paga la inversion inicial.',
            'Compara con el horizonte de validez de la solucion: si el payback es de 8 meses pero la base de conocimiento cambia cada 3, la inversion puede no saldarse nunca de forma estable.',
            'Reevalua periodicamente: la contencion, el volumen y los costos cambian. Recalcula ROI y payback en cada ciclo para confirmar que la automatizacion sigue en verde, y no solo en el mes del lanzamiento.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Un payback corto con contencion estable es el escenario ideal; un payback largo solo se justifica si el volumen y la calidad tienden a crecer. La decision de seguir, ajustar o apagar la automatizacion debe salir de este calculo, no de la euforia del lanzamiento.',
        },
      ],
    },
    {
      title: 'Trampas que destruyen la estimacion',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Aun con la formula correcta, algunos errores recurrentes corrompen el calculo. Tienen en comun el efecto de inflar la ganancia o esconder el costo, siempre empujando el ROI hacia arriba de forma artificial.',
        },
        {
          type: 'list',
          items: [
            'Medir deflexion y no resolucion: contar como contenido todo lo que el bot respondio, incluso cuando el cliente volvio o paso al humano. Es la trampa numero uno y la que mas infla el ROI.',
            'Ignorar el costo de mantenimiento: asumir que despues del build la automatizacion funciona sola. Prompt, integracion y base exigen cuidado continuo, y ese costo recurrente es parte del denominador.',
            'No tener baseline: declarar ahorro sin conocer el costo anterior por jornada. Sin punto de comparacion, el ROI es relato, no numero.',
            'Olvidar el costo de error: una respuesta equivocada puede generar retrabajo, reapertura o dano que cuesta mas que la atencion humana que se queria evitar.',
            'Amortizar mal el build: cargar todo el costo inicial en un mes (y declarar perdida) o nunca diluirlo (y declarar una ganancia irreal). El horizonte de amortizacion debe ser explicito.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La defensa contra todas ellas es la misma disciplina de FinOps: medir resolucion real, sumar el costo total y comparar contra un baseline honesto. Con esos tres pilares, el ROI deja de ser una pieza de marketing interno y se vuelve un instrumento de decision.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Cual es la diferencia entre deflexion y contencion real?',
      answer:
        'La deflexion es que el bot haya respondido y el cliente no haya insistido en ese momento; la contencion real es que la jornada se haya resuelto sin handoff al humano y sin reapertura en la ventana de seguimiento. La deflexion casi siempre es mayor que la contencion, y usar una en lugar de la otra infla el ROI. En el calculo de retorno, usa solo resolucion verificada.',
    },
    {
      question: 'El costo de la automatizacion es solo el precio de los tokens?',
      answer:
        'No. Los tokens son solo una parte del costo recurrente. El costo total incluye infra, mantenimiento continuo, curaduria de la base de conocimiento, costo de error y escalamiento, ademas del build inicial amortizado en el horizonte. Quien suma solo tokens ve una fraccion del denominador y sobreestima el ROI de forma sistematica.',
    },
    {
      question: 'Por que no das numeros de mercado listos?',
      answer:
        'Porque el costo de modelo, infra y atencion varia por proveedor, region, volumen y madurez del proyecto, y cambia con frecuencia. Trabajar con valores fijos lleva a decisiones equivocadas en cuanto la realidad cambia. Por eso la formula trata todo como variable: completas con tus propios numeros, con tu propio baseline, y obtienes un ROI que refleja tu operacion.',
    },
  ],
  conclusion: {
    title: 'El ROI honesto es contencion real menos costo total',
    description:
      'Calcular el retorno de automatizacion con IA de forma honesta exige medir contencion de verdad, sumar el costo total y comparar contra tu propio baseline. La cuenta ingenua de mensajes por costo humano casi siempre sobreestima la ganancia. Si quieres armar este modelo con los numeros de tu operacion y descubrir el ROI y el payback reales, puedo ayudarte en ese analisis.',
    cta: 'Calcular el ROI de mi automatizacion',
  },
  related: [
    { label: 'Roadmap de automatizacion de soporte con IA en 90 dias', to: '/blog/roadmap-automacao-suporte-ia-90-dias' },
    { label: 'Costos de la WhatsApp Cloud API y optimizacion', to: '/blog/custos-whatsapp-cloud-api-otimizacao' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

export default { pt, en, es };
