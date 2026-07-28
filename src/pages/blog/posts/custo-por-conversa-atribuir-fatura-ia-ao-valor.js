// Conteudo do artigo: custo por conversa, atribuir a fatura de IA ao que gerou valor.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Contabilizador de custo por conversa para sistemas com LLM: propaga um escopo de custo por toda a cadeia de chamadas, registra tokens de entrada, saída e cache de cada requisição, rateia o custo compartilhado de retentativas e de cache entre as conversas que se beneficiaram dele e fecha o ciclo com uma reconciliação que compara o total contabilizado com a fatura do provedor.',
  en: 'Per-conversation cost accountant for LLM systems: it propagates a cost scope through the whole call chain, records input, output and cache tokens of every request, allocates the shared cost of retries and cache across the conversations that benefited from it and closes the loop with a reconciliation that compares the accounted total against the provider invoice.',
  es: 'Contabilizador de costo por conversación para sistemas con LLM: propaga un ámbito de costo por toda la cadena de llamadas, registra tokens de entrada, salida y cache de cada petición, prorratea el costo compartido de reintentos y de cache entre las conversaciones que se beneficiaron de él y cierra el ciclo con una reconciliación que compara el total contabilizado con la factura del proveedor.',
};

const repoUrl = 'https://github.com/joaosouz4dev/llm-cost-attribution-mini';

const pt = {
  intro:
    'A fatura do provedor de LLM chega como um número só. Ela diz quanto você gastou e não diz em quê: qual cliente, qual jornada, qual etapa do agente, qual resposta que resolveu e qual resposta que o cliente ignorou antes de pedir um humano. Enquanto a conta é pequena, ninguém sente falta desse detalhe. Quando ela cresce, o time descobre que não consegue responder a pergunta mais básica de qualquer decisão de custo: onde cortar sem cortar o que funciona. Sem atribuição, toda medida de economia vira aposta no escuro, e a mais comum delas, trocar por um modelo mais barato em tudo, costuma economizar na etapa que já era barata e degradar exatamente a que gerava valor. Este artigo mostra como sair do número único: qual é a unidade de custo que faz sentido em atendimento, como propagar um escopo de custo por toda a cadeia sem poluir cada função, o que fazer com o custo que não pertence a nenhuma conversa, como ratear o compartilhado sem inventar precisão, e como fechar o mês reconciliando o que você contabilizou com o que o provedor cobrou.',
  sections: [
    {
      title: 'A fatura única esconde a decisão que você precisa tomar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O painel do provedor mostra tokens por dia e às vezes por chave de API. Isso é suficiente para saber que gastou mais na terça, e insuficiente para qualquer decisão. A pergunta real nunca é "quanto gastamos", é "quanto custa resolver um caso de segunda via de boleto comparado com um caso de troca de produto, e qual dos dois vale a pena continuar automatizando". Um número agregado não responde isso porque mistura, dentro do mesmo total, conversas que terminaram em resolução com conversas que terminaram em transbordo para humano depois de queimar cinco chamadas de modelo. As duas consomem tokens. Só uma gerou valor.',
        },
        {
          type: 'paragraph',
          value:
            'O efeito prático dessa cegueira é que o esforço de otimização vai para o lugar errado. Sem atribuição, o instinto é olhar o que é grande em volume, e volume não é custo: mil classificações de intenção com um modelo pequeno e prompt curto podem custar menos que trinta conversas longas que carregam histórico inteiro a cada turno. Já vi time gastar um trimestre encurtando o system prompt de uma etapa que representava dois por cento da fatura, enquanto o retrieval mal calibrado enchia a janela de contexto com trechos redundantes e respondia por metade do gasto. Nenhum dos dois fatos era visível no painel do provedor, e os dois ficaram óbvios no primeiro relatório por conversa.',
        },
        {
          type: 'table',
          columns: ['Pergunta de negócio', 'A fatura agregada responde?', 'O que é preciso registrar'],
          rows: [
            [
              'Quanto custa resolver este tipo de caso?',
              'Não, mistura tipos de caso no mesmo total',
              'Custo somado por conversa, com o tipo de jornada como atributo',
            ],
            [
              'Automatizar este fluxo se paga?',
              'Não, não separa conversa resolvida de transbordada',
              'Custo por conversa cruzado com o desfecho da conversa',
            ],
            [
              'Qual etapa do agente é cara?',
              'Não, todas as chamadas caem no mesmo balde',
              'Custo por etapa dentro do escopo da conversa',
            ],
            [
              'Este cliente grande é lucrativo?',
              'Só se cada tenant tiver a própria chave de API',
              'Identificador de tenant carregado em cada registro de uso',
            ],
            [
              'A mudança de ontem encareceu?',
              'Parcialmente, e sem isolar a causa',
              'Versão de prompt e de modelo gravadas junto com o uso',
            ],
          ],
        },
      ],
    },
    {
      title: 'Escolher a unidade: conversa, jornada ou resolução',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de instrumentar qualquer coisa, é preciso decidir a que se atribui o custo, e essa escolha determina tudo o que vem depois. A requisição é a unidade mais fácil de medir e a menos útil de todas, porque ninguém toma decisão de produto sobre uma chamada isolada. A conversa é o primeiro nível com significado de negócio: tem começo, tem fim, tem um cliente do outro lado e tem um desfecho. A jornada é mais precisa quando uma conversa trata de vários assuntos, e a resolução é a unidade mais próxima do valor, mas exige que você saiba dizer se o caso foi realmente resolvido, o que nem todo sistema sabe.',
        },
        {
          type: 'paragraph',
          value:
            'A recomendação prática é começar pela conversa e enriquecer o registro com atributos que permitam agregar de outras formas depois. Se cada evento de uso carregar o identificador da conversa, o do tenant, o tipo de jornada detectado, a etapa do pipeline e o desfecho final, você consegue calcular custo por resolução sem reinstrumentar nada, apenas agrupando de outro jeito na consulta. O erro caro é o oposto: escolher direto a unidade mais sofisticada, descobrir que o dado de desfecho é pouco confiável e ficar sem nenhum número utilizável por três meses. Comece pela unidade que você consegue fechar com confiança e suba de granularidade quando o dado sustentar.',
        },
        {
          type: 'table',
          columns: ['Unidade', 'Facilidade de medir', 'Decisão que ela habilita'],
          rows: [
            [
              'Requisição',
              'Trivial, já vem na resposta da API',
              'Quase nenhuma: serve para depurar uma chamada específica',
            ],
            [
              'Conversa',
              'Fácil se houver um identificador estável de sessão',
              'Comparar tipos de caso e detectar conversa anômala',
            ],
            [
              'Jornada',
              'Média, exige classificar o assunto do trecho',
              'Decidir qual fluxo automatizar ou desligar',
            ],
            [
              'Resolução',
              'Difícil, depende de sinal confiável de desfecho',
              'Calcular custo por caso resolvido e comparar com o humano',
            ],
            [
              'Tenant',
              'Fácil, é um atributo carregado junto',
              'Precificar plano e identificar cliente que dá prejuízo',
            ],
          ],
        },
      ],
    },
    {
      title: 'Propagar o escopo de custo sem poluir a assinatura de cada função',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O problema técnico central é que a chamada ao modelo acontece em algum lugar fundo da pilha, e o identificador da conversa nasce lá em cima, no handler do webhook. Passar esse identificador como parâmetro por todas as camadas funciona e envenena o código: toda função no caminho ganha um argumento que não tem nada a ver com o que ela faz, e basta uma nova função esquecer de repassar para o custo virar não atribuído. A solução limpa em Node é o armazenamento de contexto assíncrono, que amarra um escopo à execução e o mantém disponível através de qualquer profundidade de await sem tocar em nenhuma assinatura intermediária.',
        },
        {
          type: 'paragraph',
          value:
            'Com o escopo disponível, o registro de custo deixa de ser responsabilidade de quem chama e passa a ser do cliente do provedor. Envolver a chamada num pequeno decorador que lê o uso da resposta, converte em dinheiro pela tabela de preços do modelo e credita no escopo ativo garante que nenhuma chamada nova nasça sem contabilidade. Esse é o ponto de estrangulamento certo: uma única função por onde todo o gasto passa. Se alguém adicionar uma etapa nova ao agente amanhã, ela é contabilizada de graça, porque usa o mesmo cliente. O detalhe que costuma escapar é que a conversão para dinheiro precisa da tabela de preços versionada por modelo, incluindo os preços diferentes de entrada, saída, escrita em cache e leitura de cache, que não são o mesmo número.',
        },
        {
          type: 'code',
          value: `// cost-scope.js
// O escopo vive no contexto assincrono: nenhuma funcao intermediaria
// precisa receber conversationId como argumento para o custo ser atribuido.

import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

// Preco por MILHAO de tokens. Entrada, saida, escrita e leitura de cache
// tem precos diferentes: tratar tudo como um numero so distorce o rateio.
const PRICING = {
  'claude-sonnet-5': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
};

export function runInCostScope(attributes, fn) {
  const scope = { attributes, events: [] };
  return storage.run(scope, () => fn(scope));
}

export function currentScope() {
  return storage.getStore() || null;
}

// Preco de UM componente isolado: usado pelo relatorio para separar
// escrita de cache e economia de leitura do custo efetivo da jornada.
export function priceComponent(model, component, tokens) {
  const p = PRICING[model];
  if (!p) throw new Error('modelo sem preco cadastrado: ' + model);
  return (tokens * p[component]) / 1e6;
}

export function priceUsage(model, usage) {
  return (
    priceComponent(model, 'input', usage.inputTokens || 0) +
    priceComponent(model, 'output', usage.outputTokens || 0) +
    priceComponent(model, 'cacheWrite', usage.cacheWriteTokens || 0) +
    priceComponent(model, 'cacheRead', usage.cacheReadTokens || 0)
  );
}

// Credita um evento de uso no escopo ativo. Se nao houver escopo, o custo
// e real e precisa ir para o balde de nao atribuido, nunca ser descartado.
export function recordUsage({ model, usage, step, attempt = 1 }) {
  const scope = currentScope();
  const costUsd = priceUsage(model, usage);
  const event = { model, usage, step, attempt, costUsd };
  if (!scope) {
    unattributed.push(event);
    return event;
  }
  scope.events.push(event);
  return event;
}

export const unattributed = [];`,
        },
        {
          type: 'code',
          value: `// llm-client.js
// Ponto de estrangulamento: TODA chamada ao provedor passa por aqui, entao
// toda etapa nova do agente nasce contabilizada sem ninguem lembrar disso.

import { recordUsage } from './cost-scope.js';

export function createCostAwareClient(provider) {
  return {
    async complete({ model, messages, step, attempt = 1, ...rest }) {
      const response = await provider.messages.create({ model, messages, ...rest });
      const u = response.usage || {};

      recordUsage({
        model,
        step,
        attempt,
        usage: {
          inputTokens: u.input_tokens || 0,
          outputTokens: u.output_tokens || 0,
          cacheWriteTokens: u.cache_creation_input_tokens || 0,
          cacheReadTokens: u.cache_read_input_tokens || 0,
        },
      });

      return response;
    },
  };
}

// No handler do webhook, o escopo abre uma vez e cobre a cadeia inteira:
//
//   await runInCostScope(
//     { conversationId, tenantId, journey: 'segunda-via', channel: 'whatsapp' },
//     async (scope) => {
//       await runAgent(message);          // nenhuma assinatura mudou
//       await emitCostReport(scope);      // fecha e publica o total
//     },
//   );`,
        },
      ],
    },
    {
      title: 'O custo que não pertence a nenhuma conversa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma parte da fatura não nasce de nenhuma conversa e some da contabilidade se você não reservar um lugar para ela. A execução da bateria de eval no CI consome tokens. O reprocessamento de embeddings quando o corpus muda consome tokens. A tarefa noturna que resume conversas para a memória de longo prazo consome tokens. O teste manual de um engenheiro consome tokens. Nada disso pertence a um cliente, e tratar esse gasto como ruído produz um efeito perverso: a soma dos custos por conversa fica sistematicamente abaixo da fatura, e quando alguém percebe a diferença, a confiança no relatório inteiro cai.',
        },
        {
          type: 'paragraph',
          value:
            'A saída é ter categorias explícitas de custo indireto e obrigar toda origem de gasto a declarar a sua. O escopo de custo não precisa ser sempre uma conversa: pode ser um job, com o nome do job como atributo. O que não pode existir é chamada sem escopo nenhum, e por isso vale tratar o balde de não atribuído como um alarme, não como uma categoria aceitável. Ele deve tender a zero, e qualquer crescimento significa um caminho de código novo que escapou da instrumentação, exatamente o tipo de regressão silenciosa que só aparece quando a fatura chega. Uma verificação simples no fim de cada dia, comparando o total atribuído com o total apurado por modelo, transforma esse desvio em um sinal acionável em vez de uma surpresa mensal.',
        },
        {
          type: 'table',
          columns: ['Categoria de gasto', 'A que atribuir', 'Como tratar no relatório'],
          rows: [
            [
              'Conversa com cliente',
              'Conversa, tenant e jornada',
              'Custo direto: base de todo cálculo de custo por resolução',
            ],
            [
              'Eval e teste automatizado',
              'Job de eval, com a versão testada',
              'Indireto de engenharia: rateado por período, não por cliente',
            ],
            [
              'Reindexação e embeddings',
              'Job de ingestão, com o corpus',
              'Indireto de plataforma: amortizado no período de uso do índice',
            ],
            [
              'Resumo noturno de memória',
              'Job em lote, com a lista de conversas tocadas',
              'Pode ser rateado por conversa quando o benefício é rastreável',
            ],
            [
              'Exploração manual',
              'Ambiente de desenvolvimento',
              'Indireto: útil separar por chave para não sujar produção',
            ],
          ],
        },
      ],
    },
    {
      title: 'Ratear o compartilhado sem inventar precisão',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Dois gastos reais desafiam a atribuição direta porque uma conversa paga e outra colhe. O primeiro é o cache de prompt: a primeira conversa que atravessa um prefixo novo paga a escrita do cache, mais cara que a entrada normal, e as conversas seguintes leem esse cache por uma fração do preço. Atribuir a escrita inteira a quem chegou primeiro faz o relatório dizer que aquela conversa foi absurdamente cara e que as seguintes foram baratas, quando na prática o custo é do conjunto. O segundo é a retentativa: a chamada que falhou por instabilidade do provedor consumiu tokens de entrada e não produziu resposta, e esse desperdício pertence à conversa em sentido contábil, mas não deveria contaminar a comparação entre tipos de jornada.',
        },
        {
          type: 'paragraph',
          value:
            'A regra que funciona é separar o que é atribuição do que é análise. Contabilmente, tudo que aconteceu dentro do escopo pertence ao escopo: a escrita de cache e a retentativa entram no custo daquela conversa, e é isso que faz a soma bater com a fatura. Analiticamente, o relatório expõe cada componente em uma coluna própria, para que a comparação entre jornadas use o custo efetivo, sem escrita de cache e sem retentativa, enquanto o total continua íntegro. Quem quiser um rateio mais justo do cache pode amortizar a escrita entre as leituras que ela habilitou dentro de uma janela, mas isso só vale a pena quando o cache é grande e a decisão em jogo depende dele. Na maioria dos casos, expor as colunas separadas já resolve, e evita a tentação de construir um modelo de rateio que ninguém consegue auditar.',
        },
        {
          type: 'code',
          value: `// report.js
// Total contabil = tudo que caiu no escopo (fecha com a fatura).
// Custo efetivo = so o que a jornada realmente consumiu para responder
// (e a coluna certa para comparar tipos de caso entre si).

import { priceComponent } from './cost-scope.js';

// Desperdicio de retentativa e o custo das tentativas que NAO produziram a
// resposta. Marcar "attempt > 1" seria o contrario: a ultima tentativa e
// justamente a que respondeu. Por etapa, o evento vencedor fica no custo
// efetivo e os anteriores saem dele.
function winningAttempts(events) {
  const best = new Map();
  for (const event of events) {
    const current = best.get(event.step);
    if (current === undefined || event.attempt > current) best.set(event.step, event.attempt);
  }
  return best;
}

export function summarize(scope) {
  const byStep = new Map();
  const winners = winningAttempts(scope.events);
  let totalUsd = 0;
  let retryWasteUsd = 0;
  let cacheWriteUsd = 0;
  let cacheSavingsUsd = 0;

  for (const event of scope.events) {
    totalUsd += event.costUsd;

    if (event.attempt < winners.get(event.step)) retryWasteUsd += event.costUsd;

    const cacheWrite = event.usage.cacheWriteTokens || 0;
    const cacheRead = event.usage.cacheReadTokens || 0;
    if (cacheWrite) cacheWriteUsd += priceComponent(event.model, 'cacheWrite', cacheWrite);
    // Economia = o que aquelas leituras teriam custado como entrada normal.
    if (cacheRead) {
      cacheSavingsUsd +=
        priceComponent(event.model, 'input', cacheRead) -
        priceComponent(event.model, 'cacheRead', cacheRead);
    }

    byStep.set(event.step, (byStep.get(event.step) || 0) + event.costUsd);
  }

  return {
    ...scope.attributes,
    totalUsd,                                  // fecha com a fatura
    effectiveUsd: totalUsd - retryWasteUsd - cacheWriteUsd, // compara jornadas
    retryWasteUsd,
    cacheWriteUsd,
    cacheSavingsUsd,
    calls: scope.events.length,
    byStep: Object.fromEntries(byStep),
  };
}`,
        },
        {
          type: 'diagram',
          value: `Onde o custo nasce e onde ele e atribuido

  webhook recebe mensagem
        |
        v
  [runInCostScope] abre escopo { conversationId, tenantId, journey }
        |
        +--> classificar intencao      -> recordUsage(step: 'classify')
        |
        +--> recuperar contexto (RAG)  -> recordUsage(step: 'embed-query')
        |
        +--> gerar resposta            -> recordUsage(step: 'answer', attempt: 1)
        |        |                        429 do provedor: nao respondeu
        |        |                        (entra no total, sai do efetivo)
        |        \\-- nova tentativa    -> recordUsage(step: 'answer', attempt: 2)
        |                                  respondeu: fica no custo efetivo
        v
  [summarize] fecha o escopo
        |
        +--> custo total       -> reconciliacao com a fatura
        +--> custo efetivo     -> comparacao entre jornadas
        +--> custo por etapa   -> onde otimizar primeiro

  fora do escopo de conversa:
    job de eval, reindexacao, resumo noturno -> escopo proprio, custo indireto
    chamada sem escopo nenhum                -> balde NAO ATRIBUIDO (alarme)`,
        },
      ],
    },
    {
      title: 'Fechar o mês: reconciliar o contabilizado com o cobrado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um sistema de atribuição só é confiável se alguém verificar que ele bate com a realidade, e a realidade é a fatura. A reconciliação é simples de descrever e reveladora na prática: some tudo que você contabilizou no período, por modelo, e compare com o que o provedor cobrou pelo mesmo modelo no mesmo período. A diferença nunca é exatamente zero, porque há arredondamento, fuso horário de fechamento e chamadas em voo na virada, mas ela deve ser pequena e estável. Uma divergência que cresce de um por cento para oito por cento em um mês não é ruído: é um caminho de código novo chamando o provedor por fora do cliente instrumentado, ou uma tabela de preços desatualizada depois de um reajuste.',
        },
        {
          type: 'ordered',
          items: [
            'Congele o período: defina a janela pelo mesmo fuso que o provedor usa no fechamento, senão a diferença de horário vira divergência falsa todo mês.',
            'Agregue por modelo, não só o total: um erro de preço em um modelo específico se dilui no total e fica óbvio quando quebrado por modelo.',
            'Compare também o volume de tokens, não apenas o dinheiro: token igual com dinheiro diferente aponta tabela de preços errada, e token diferente aponta instrumentação faltando.',
            'Verifique o balde de não atribuído: ele explica parte da diferença e deve tender a zero, com qualquer crescimento tratado como incidente.',
            'Investigue por etapa antes de por cliente: a etapa nova que ninguém instrumentou aparece como buraco em uma etapa específica, não espalhada.',
            'Versione a tabela de preços com data de vigência: reajuste do provedor no meio do mês exige preço por período, senão a reconciliação nunca fecha de novo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Com a reconciliação estável, o relatório por conversa deixa de ser um gráfico bonito e vira base de decisão. É nesse ponto que perguntas antes impossíveis ficam triviais: a jornada de segunda via custa oito centavos e resolve sozinha em noventa por cento dos casos, enquanto a de troca de produto custa quarenta e dois centavos e transborda em metade, o que dá um custo por resolução quase dez vezes maior. Com esse número na mão, a discussão sai do achismo sobre qual modelo é caro e vai para onde deveria estar desde o começo: reduzir o contexto da jornada cara, mover a classificação para um modelo menor, ou simplesmente aceitar que aquele fluxo específico é melhor atendido por um humano e desligar a automação dele sem culpa.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Qual é a unidade certa para atribuir custo de IA em atendimento?',
      answer:
        'A conversa é o melhor ponto de partida porque tem começo, fim, um cliente identificável e um desfecho, o que já permite comparar tipos de caso e detectar conversas anômalas. A requisição é fácil de medir e quase inútil para decisão, porque ninguém decide produto olhando uma chamada isolada. A resolução é a unidade mais próxima do valor, já que custo por caso resolvido é o número que se compara com o custo do atendimento humano, mas ela depende de um sinal confiável de desfecho que muitos sistemas não têm. O caminho prático é contabilizar por conversa e enriquecer cada evento de uso com tenant, tipo de jornada, etapa do pipeline e desfecho final. Com esses atributos gravados, você calcula custo por resolução, por tenant ou por jornada apenas agrupando de outro jeito na consulta, sem reinstrumentar nada quando a pergunta mudar.',
    },
    {
      question: 'Como atribuir o custo do cache de prompt e das retentativas?',
      answer:
        'Separando atribuição de análise. Contabilmente, tudo que aconteceu dentro do escopo pertence ao escopo: a escrita de cache paga pela primeira conversa que atravessou o prefixo e os tokens gastos na tentativa que falhou entram no custo daquela conversa, e é justamente isso que faz a soma dos custos fechar com a fatura do provedor. Analiticamente, o relatório precisa expor cada componente em coluna própria, porque comparar jornadas usando o total distorce: a conversa que por acaso chegou primeiro no cache novo aparece absurdamente cara e as seguintes aparecem baratas, sem que nenhuma das duas tenha consumido mais recurso de fato. A coluna de custo efetivo, que exclui escrita de cache e desperdício de retentativa, é a que serve para comparar tipos de caso entre si. Rateio elaborado do cache entre as leituras que ele habilitou só compensa quando o cache é grande e alguma decisão concreta depende dele.',
    },
    {
      question: 'Como saber se a atribuição está correta?',
      answer:
        'Reconciliando com a fatura todo período. Some tudo que foi contabilizado, quebrado por modelo, e compare com o que o provedor cobrou por aquele modelo na mesma janela, usando o fuso horário de fechamento dele para não criar divergência falsa. A diferença nunca será zero por causa de arredondamento e chamadas em voo na virada, mas precisa ser pequena e estável ao longo dos meses. Compare também o volume de tokens e não apenas o valor em dinheiro, porque isso separa as duas causas possíveis: mesmo volume com dinheiro diferente aponta tabela de preços desatualizada depois de um reajuste, enquanto volume diferente aponta um caminho de código chamando o provedor por fora do cliente instrumentado. Some a isso um balde explícito de custo não atribuído, tratado como alarme e não como categoria aceitável, e você detecta a etapa nova sem instrumentação no dia seguinte, em vez de descobrir quando a fatura chegar.',
    },
  ],
  conclusion: {
    title: 'Sem atribuição, toda economia é aposta',
    description:
      'A fatura agregada informa quanto você gastou e esconde a única coisa que importa: o que gerou valor e o que apenas consumiu tokens. Escolher a conversa como unidade, propagar o escopo de custo pelo contexto assíncrono para que nenhuma chamada nasça sem contabilidade, dar lugar explícito ao custo indireto de eval e reindexação, separar o total contábil do custo efetivo ao tratar cache e retentativa, e fechar o ciclo reconciliando com a fatura transforma custo de IA de mistério mensal em métrica de produto. Posso implementar essa camada de atribuição no seu sistema com LLM, da instrumentação no cliente ao relatório de custo por resolução, para que a decisão de onde cortar pare de ser aposta e passe a ser leitura de número.',
    cta: 'Falar sobre custo por conversa no meu sistema',
  },
  related: [
    { label: 'Observabilidade de LLM: tracing, custo e qualidade', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'ROI real de automação com IA', to: '/blog/roi-real-automacao-ia' },
    { label: 'Roteamento de modelos: o modelo certo para cada tarefa', to: '/blog/roteamento-modelos-modelo-certo-cada-tarefa' },
  ],
  repo: { name: 'llm-cost-attribution-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'The LLM provider invoice arrives as a single number. It tells you how much you spent and not what on: which customer, which journey, which agent step, which answer resolved the case and which answer the customer ignored before asking for a human. While the bill is small, nobody misses that detail. When it grows, the team discovers it cannot answer the most basic question behind any cost decision: where to cut without cutting what works. Without attribution, every savings measure becomes a bet in the dark, and the most common one, swapping in a cheaper model everywhere, usually saves on the step that was already cheap and degrades exactly the one that created value. This article shows how to move past the single number: which cost unit makes sense in customer support, how to propagate a cost scope through the whole chain without polluting every function, what to do with the cost that belongs to no conversation, how to allocate the shared part without inventing precision, and how to close the month by reconciling what you accounted for against what the provider charged.',
  sections: [
    {
      title: 'The single invoice hides the decision you need to make',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The provider dashboard shows tokens per day and sometimes per API key. That is enough to know you spent more on Tuesday, and not enough for any decision. The real question is never "how much did we spend", it is "how much does it cost to resolve a duplicate-invoice case compared with a product-exchange case, and which of the two is worth continuing to automate". An aggregate number does not answer that because it mixes, inside the same total, conversations that ended in resolution with conversations that ended in a handoff to a human after burning five model calls. Both consume tokens. Only one created value.',
        },
        {
          type: 'paragraph',
          value:
            'The practical effect of that blindness is that optimization effort goes to the wrong place. Without attribution, the instinct is to look at what is large in volume, and volume is not cost: a thousand intent classifications with a small model and a short prompt may cost less than thirty long conversations that carry the entire history on every turn. I have seen a team spend a quarter shortening the system prompt of a step that accounted for two percent of the invoice, while a badly calibrated retrieval filled the context window with redundant passages and accounted for half the spend. Neither fact was visible on the provider dashboard, and both became obvious in the first per-conversation report.',
        },
        {
          type: 'table',
          columns: ['Business question', 'Does the aggregate invoice answer it?', 'What must be recorded'],
          rows: [
            [
              'How much does resolving this case type cost?',
              'No, it mixes case types in the same total',
              'Cost summed per conversation, with journey type as an attribute',
            ],
            [
              'Does automating this flow pay off?',
              'No, it does not separate resolved from handed-off',
              'Cost per conversation crossed with the conversation outcome',
            ],
            [
              'Which agent step is expensive?',
              'No, every call falls into the same bucket',
              'Cost per step inside the conversation scope',
            ],
            [
              'Is this large customer profitable?',
              'Only if each tenant has its own API key',
              'Tenant identifier carried on every usage record',
            ],
            [
              'Did yesterday change make it pricier?',
              'Partially, and without isolating the cause',
              'Prompt and model version recorded alongside the usage',
            ],
          ],
        },
      ],
    },
    {
      title: 'Choosing the unit: conversation, journey or resolution',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before instrumenting anything, you need to decide what the cost is attributed to, and that choice determines everything that follows. The request is the easiest unit to measure and the least useful of all, because nobody makes a product decision about an isolated call. The conversation is the first level with business meaning: it has a start, an end, a customer on the other side and an outcome. The journey is more precise when one conversation covers several subjects, and the resolution is the unit closest to value, but it requires you to be able to say whether the case was actually resolved, which not every system can.',
        },
        {
          type: 'paragraph',
          value:
            'The practical recommendation is to start with the conversation and enrich the record with attributes that let you aggregate other ways later. If every usage event carries the conversation identifier, the tenant, the detected journey type, the pipeline step and the final outcome, you can compute cost per resolution without reinstrumenting anything, merely grouping differently in the query. The expensive mistake is the opposite: picking the most sophisticated unit straight away, discovering the outcome signal is unreliable and being left with no usable number for three months. Start with the unit you can close with confidence and raise granularity when the data supports it.',
        },
        {
          type: 'table',
          columns: ['Unit', 'How easy to measure', 'Decision it enables'],
          rows: [
            [
              'Request',
              'Trivial, it already comes in the API response',
              'Almost none: useful to debug one specific call',
            ],
            [
              'Conversation',
              'Easy if there is a stable session identifier',
              'Comparing case types and detecting anomalous conversations',
            ],
            [
              'Journey',
              'Medium, requires classifying the subject of the segment',
              'Deciding which flow to automate or to turn off',
            ],
            [
              'Resolution',
              'Hard, depends on a reliable outcome signal',
              'Computing cost per resolved case and comparing with a human',
            ],
            [
              'Tenant',
              'Easy, it is an attribute carried along',
              'Pricing a plan and spotting a customer that loses money',
            ],
          ],
        },
      ],
    },
    {
      title: 'Propagating the cost scope without polluting every function signature',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The central technical problem is that the model call happens somewhere deep in the stack, and the conversation identifier is born up top, in the webhook handler. Passing that identifier as a parameter through every layer works and poisons the code: every function on the path gains an argument that has nothing to do with what it does, and one new function forgetting to pass it along is enough to turn the cost into unattributed. The clean solution in Node is async context storage, which binds a scope to the execution and keeps it available through any depth of await without touching a single intermediate signature.',
        },
        {
          type: 'paragraph',
          value:
            'With the scope available, recording cost stops being the caller responsibility and becomes the provider client responsibility. Wrapping the call in a small decorator that reads the usage from the response, converts it into money using the model price table and credits the active scope guarantees that no new call is born without accounting. That is the right choke point: a single function through which all spend passes. If someone adds a new agent step tomorrow, it is accounted for free, because it uses the same client. The detail that usually slips is that the conversion into money needs a price table versioned per model, including the different prices for input, output, cache write and cache read, which are not the same number.',
        },
        {
          type: 'code',
          value: `// cost-scope.js
// The scope lives in async context: no intermediate function needs to
// receive conversationId as an argument for the cost to be attributed.

import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

// Price per MILLION tokens. Input, output, cache write and cache read have
// different prices: treating everything as one number distorts allocation.
const PRICING = {
  'claude-sonnet-5': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
};

export function runInCostScope(attributes, fn) {
  const scope = { attributes, events: [] };
  return storage.run(scope, () => fn(scope));
}

export function currentScope() {
  return storage.getStore() || null;
}

// Price of ONE isolated component: used by the report to separate cache
// write and read savings from the effective cost of the journey.
export function priceComponent(model, component, tokens) {
  const p = PRICING[model];
  if (!p) throw new Error('model without registered price: ' + model);
  return (tokens * p[component]) / 1e6;
}

export function priceUsage(model, usage) {
  return (
    priceComponent(model, 'input', usage.inputTokens || 0) +
    priceComponent(model, 'output', usage.outputTokens || 0) +
    priceComponent(model, 'cacheWrite', usage.cacheWriteTokens || 0) +
    priceComponent(model, 'cacheRead', usage.cacheReadTokens || 0)
  );
}

// Credits a usage event to the active scope. With no scope, the cost is
// real and must go to the unattributed bucket, never be discarded.
export function recordUsage({ model, usage, step, attempt = 1 }) {
  const scope = currentScope();
  const costUsd = priceUsage(model, usage);
  const event = { model, usage, step, attempt, costUsd };
  if (!scope) {
    unattributed.push(event);
    return event;
  }
  scope.events.push(event);
  return event;
}

export const unattributed = [];`,
        },
        {
          type: 'code',
          value: `// llm-client.js
// Choke point: EVERY provider call goes through here, so every new agent
// step is born accounted for without anyone having to remember it.

import { recordUsage } from './cost-scope.js';

export function createCostAwareClient(provider) {
  return {
    async complete({ model, messages, step, attempt = 1, ...rest }) {
      const response = await provider.messages.create({ model, messages, ...rest });
      const u = response.usage || {};

      recordUsage({
        model,
        step,
        attempt,
        usage: {
          inputTokens: u.input_tokens || 0,
          outputTokens: u.output_tokens || 0,
          cacheWriteTokens: u.cache_creation_input_tokens || 0,
          cacheReadTokens: u.cache_read_input_tokens || 0,
        },
      });

      return response;
    },
  };
}

// In the webhook handler the scope opens once and covers the whole chain:
//
//   await runInCostScope(
//     { conversationId, tenantId, journey: 'duplicate-invoice', channel: 'whatsapp' },
//     async (scope) => {
//       await runAgent(message);          // no signature changed
//       await emitCostReport(scope);      // closes and publishes the total
//     },
//   );`,
        },
      ],
    },
    {
      title: 'The cost that belongs to no conversation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Part of the invoice is born from no conversation at all and disappears from the accounting if you do not reserve a place for it. Running the eval suite in CI consumes tokens. Reprocessing embeddings when the corpus changes consumes tokens. The nightly job that summarizes conversations into long-term memory consumes tokens. An engineer manual test consumes tokens. None of that belongs to a customer, and treating that spend as noise produces a perverse effect: the sum of per-conversation costs sits systematically below the invoice, and when someone notices the gap, trust in the whole report collapses.',
        },
        {
          type: 'paragraph',
          value:
            'The way out is to have explicit indirect cost categories and force every spend origin to declare its own. The cost scope does not always have to be a conversation: it can be a job, with the job name as an attribute. What must not exist is a call with no scope at all, which is why it pays to treat the unattributed bucket as an alarm rather than an acceptable category. It should trend to zero, and any growth means a new code path escaped instrumentation, exactly the kind of silent regression that only surfaces when the invoice arrives. A simple end-of-day check comparing the attributed total against the total measured per model turns that drift into an actionable signal instead of a monthly surprise.',
        },
        {
          type: 'table',
          columns: ['Spend category', 'What to attribute it to', 'How to treat it in the report'],
          rows: [
            [
              'Customer conversation',
              'Conversation, tenant and journey',
              'Direct cost: the base of every cost-per-resolution calculation',
            ],
            [
              'Eval and automated test',
              'Eval job, with the tested version',
              'Engineering indirect: allocated by period, not by customer',
            ],
            [
              'Reindexing and embeddings',
              'Ingestion job, with the corpus',
              'Platform indirect: amortized over the index usage period',
            ],
            [
              'Nightly memory summary',
              'Batch job, with the list of touched conversations',
              'Can be allocated per conversation when the benefit is traceable',
            ],
            [
              'Manual exploration',
              'Development environment',
              'Indirect: worth separating by key so production stays clean',
            ],
          ],
        },
      ],
    },
    {
      title: 'Allocating the shared part without inventing precision',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Two real costs defy direct attribution because one conversation pays and another reaps. The first is the prompt cache: the first conversation that crosses a new prefix pays for the cache write, more expensive than normal input, and the following conversations read that cache for a fraction of the price. Attributing the whole write to whoever arrived first makes the report say that conversation was absurdly expensive and the following ones were cheap, when in practice the cost belongs to the set. The second is the retry: the call that failed on provider instability consumed input tokens and produced no answer, and that waste belongs to the conversation in an accounting sense, but should not contaminate the comparison between journey types.',
        },
        {
          type: 'paragraph',
          value:
            'The rule that works is separating attribution from analysis. In accounting terms, everything that happened inside the scope belongs to the scope: the cache write and the retry enter the cost of that conversation, and that is what makes the sum match the invoice. In analytical terms, the report exposes each component in its own column, so the comparison between journeys uses the effective cost, without cache write and without retry, while the total stays intact. Whoever wants a fairer cache allocation can amortize the write across the reads it enabled inside a window, but that is only worth it when the cache is large and the decision at stake depends on it. In most cases, exposing the separate columns already solves it, and avoids the temptation to build an allocation model nobody can audit.',
        },
        {
          type: 'code',
          value: `// report.js
// Accounting total = everything that fell into the scope (matches the invoice).
// Effective cost = only what the journey actually consumed to answer
// (the right column to compare case types against each other).

import { priceComponent } from './cost-scope.js';

// Retry waste is the cost of the attempts that did NOT produce the answer.
// Flagging "attempt > 1" would be the opposite: the last attempt is exactly
// the one that answered. Per step, the winning event stays in the effective
// cost and the earlier ones leave it.
function winningAttempts(events) {
  const best = new Map();
  for (const event of events) {
    const current = best.get(event.step);
    if (current === undefined || event.attempt > current) best.set(event.step, event.attempt);
  }
  return best;
}

export function summarize(scope) {
  const byStep = new Map();
  const winners = winningAttempts(scope.events);
  let totalUsd = 0;
  let retryWasteUsd = 0;
  let cacheWriteUsd = 0;
  let cacheSavingsUsd = 0;

  for (const event of scope.events) {
    totalUsd += event.costUsd;

    if (event.attempt < winners.get(event.step)) retryWasteUsd += event.costUsd;

    const cacheWrite = event.usage.cacheWriteTokens || 0;
    const cacheRead = event.usage.cacheReadTokens || 0;
    if (cacheWrite) cacheWriteUsd += priceComponent(event.model, 'cacheWrite', cacheWrite);
    // Savings = what those reads would have cost as normal input.
    if (cacheRead) {
      cacheSavingsUsd +=
        priceComponent(event.model, 'input', cacheRead) -
        priceComponent(event.model, 'cacheRead', cacheRead);
    }

    byStep.set(event.step, (byStep.get(event.step) || 0) + event.costUsd);
  }

  return {
    ...scope.attributes,
    totalUsd,                                  // matches the invoice
    effectiveUsd: totalUsd - retryWasteUsd - cacheWriteUsd, // compares journeys
    retryWasteUsd,
    cacheWriteUsd,
    cacheSavingsUsd,
    calls: scope.events.length,
    byStep: Object.fromEntries(byStep),
  };
}`,
        },
        {
          type: 'diagram',
          value: `Where cost is born and where it is attributed

  webhook receives message
        |
        v
  [runInCostScope] opens scope { conversationId, tenantId, journey }
        |
        +--> classify intent           -> recordUsage(step: 'classify')
        |
        +--> retrieve context (RAG)    -> recordUsage(step: 'embed-query')
        |
        +--> generate answer           -> recordUsage(step: 'answer', attempt: 1)
        |        |                        provider 429: it did not answer
        |        |                        (enters the total, leaves the effective)
        |        \\-- new attempt       -> recordUsage(step: 'answer', attempt: 2)
        |                                  it answered: stays in the effective cost
        v
  [summarize] closes the scope
        |
        +--> total cost        -> reconciliation with the invoice
        +--> effective cost    -> comparison between journeys
        +--> cost per step     -> where to optimize first

  outside the conversation scope:
    eval job, reindexing, nightly summary -> own scope, indirect cost
    call with no scope at all             -> UNATTRIBUTED bucket (alarm)`,
        },
      ],
    },
    {
      title: 'Closing the month: reconciling the accounted against the charged',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An attribution system is only trustworthy if someone checks that it matches reality, and reality is the invoice. Reconciliation is simple to describe and revealing in practice: sum everything you accounted for in the period, per model, and compare it with what the provider charged for the same model in the same period. The difference is never exactly zero, because there is rounding, closing time zone and calls in flight at the boundary, but it must be small and stable. A divergence that grows from one percent to eight percent in a month is not noise: it is a new code path calling the provider outside the instrumented client, or a price table left stale after a rate change.',
        },
        {
          type: 'ordered',
          items: [
            'Freeze the period: define the window using the same time zone the provider uses at closing, otherwise the hour difference becomes a false divergence every month.',
            'Aggregate per model, not just the total: a price error on one specific model dilutes in the total and becomes obvious when broken down per model.',
            'Compare token volume too, not only money: same tokens with different money points to a wrong price table, and different tokens points to missing instrumentation.',
            'Check the unattributed bucket: it explains part of the difference and must trend to zero, with any growth treated as an incident.',
            'Investigate per step before per customer: the new step nobody instrumented shows up as a hole in one specific step, not spread around.',
            'Version the price table with an effective date: a provider rate change mid-month requires price per period, otherwise reconciliation never matches again.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'With reconciliation stable, the per-conversation report stops being a pretty chart and becomes a decision base. That is the point where previously impossible questions turn trivial: the duplicate-invoice journey costs eight cents and resolves on its own in ninety percent of cases, while the product-exchange one costs forty-two cents and hands off in half of them, which yields a cost per resolution almost ten times higher. With that number in hand, the discussion leaves the guesswork about which model is expensive and goes where it should have been from the start: reduce the context of the expensive journey, move classification to a smaller model, or simply accept that this specific flow is better served by a human and turn its automation off without guilt.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'What is the right unit to attribute AI cost in customer support?',
      answer:
        'The conversation is the best starting point because it has a beginning, an end, an identifiable customer and an outcome, which already lets you compare case types and detect anomalous conversations. The request is easy to measure and nearly useless for decisions, because nobody decides product looking at an isolated call. The resolution is the unit closest to value, since cost per resolved case is the number you compare with the cost of human support, but it depends on a reliable outcome signal many systems do not have. The practical path is to account per conversation and enrich every usage event with tenant, journey type, pipeline step and final outcome. With those attributes recorded, you compute cost per resolution, per tenant or per journey merely by grouping differently in the query, without reinstrumenting anything when the question changes.',
    },
    {
      question: 'How do you attribute the cost of prompt cache and retries?',
      answer:
        'By separating attribution from analysis. In accounting terms, everything that happened inside the scope belongs to the scope: the cache write paid by the first conversation that crossed the prefix and the tokens spent on the failed attempt enter the cost of that conversation, and that is precisely what makes the sum of costs match the provider invoice. In analytical terms, the report must expose each component in its own column, because comparing journeys using the total distorts things: the conversation that happened to arrive first at the new cache shows up absurdly expensive and the following ones show up cheap, without either having actually consumed more resource. The effective cost column, which excludes cache write and retry waste, is the one that serves to compare case types against each other. An elaborate allocation of the cache across the reads it enabled only pays off when the cache is large and some concrete decision depends on it.',
    },
    {
      question: 'How do you know the attribution is correct?',
      answer:
        'By reconciling with the invoice every period. Sum everything accounted for, broken down per model, and compare with what the provider charged for that model in the same window, using their closing time zone so you do not create a false divergence. The difference will never be zero because of rounding and calls in flight at the boundary, but it must be small and stable across months. Compare token volume too and not only the money amount, because that separates the two possible causes: the same volume with different money points to a price table left stale after a rate change, while different volume points to a code path calling the provider outside the instrumented client. Add to that an explicit unattributed cost bucket, treated as an alarm and not as an acceptable category, and you detect the new uninstrumented step the next day instead of finding out when the invoice arrives.',
    },
  ],
  conclusion: {
    title: 'Without attribution, every saving is a bet',
    description:
      'The aggregate invoice reports how much you spent and hides the only thing that matters: what created value and what merely consumed tokens. Choosing the conversation as the unit, propagating the cost scope through async context so no call is born without accounting, giving an explicit place to the indirect cost of eval and reindexing, separating the accounting total from the effective cost when handling cache and retries, and closing the loop by reconciling against the invoice turns AI cost from a monthly mystery into a product metric. I can implement this attribution layer in your LLM system, from client instrumentation to the cost-per-resolution report, so that deciding where to cut stops being a bet and becomes reading a number.',
    cta: 'Talk about per-conversation cost in my system',
  },
  related: [
    { label: 'LLM observability: tracing, cost and quality', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Real ROI of AI automation', to: '/blog/roi-real-automacao-ia' },
    { label: 'Model routing: the right model for each task', to: '/blog/roteamento-modelos-modelo-certo-cada-tarefa' },
  ],
  repo: { name: 'llm-cost-attribution-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'La factura del proveedor de LLM llega como un número solo. Dice cuánto gastaste y no dice en qué: qué cliente, qué recorrido, qué etapa del agente, qué respuesta resolvió el caso y qué respuesta ignoró el cliente antes de pedir un humano. Mientras la cuenta es pequeña, nadie echa de menos ese detalle. Cuando crece, el equipo descubre que no puede responder la pregunta más básica de cualquier decisión de costo: dónde recortar sin recortar lo que funciona. Sin atribución, toda medida de ahorro se vuelve apuesta a ciegas, y la más común de todas, cambiar a un modelo más barato en todo, suele ahorrar en la etapa que ya era barata y degradar justamente la que generaba valor. Este artículo muestra cómo salir del número único: cuál es la unidad de costo que tiene sentido en atención, cómo propagar un ámbito de costo por toda la cadena sin ensuciar cada función, qué hacer con el costo que no pertenece a ninguna conversación, cómo prorratear lo compartido sin inventar precisión, y cómo cerrar el mes reconciliando lo que contabilizaste con lo que el proveedor cobró.',
  sections: [
    {
      title: 'La factura única esconde la decisión que necesitas tomar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El panel del proveedor muestra tokens por día y a veces por clave de API. Eso alcanza para saber que gastaste más el martes, y no alcanza para ninguna decisión. La pregunta real nunca es "cuánto gastamos", es "cuánto cuesta resolver un caso de segundo comprobante comparado con un caso de cambio de producto, y cuál de los dos vale la pena seguir automatizando". Un número agregado no responde eso porque mezcla, dentro del mismo total, conversaciones que terminaron en resolución con conversaciones que terminaron en traspaso a un humano después de quemar cinco llamadas de modelo. Las dos consumen tokens. Solo una generó valor.',
        },
        {
          type: 'paragraph',
          value:
            'El efecto práctico de esa ceguera es que el esfuerzo de optimización va al lugar equivocado. Sin atribución, el instinto es mirar lo que es grande en volumen, y el volumen no es costo: mil clasificaciones de intención con un modelo pequeño y prompt corto pueden costar menos que treinta conversaciones largas que cargan el historial entero en cada turno. He visto a un equipo gastar un trimestre acortando el system prompt de una etapa que representaba dos por ciento de la factura, mientras un retrieval mal calibrado llenaba la ventana de contexto con fragmentos redundantes y respondía por la mitad del gasto. Ninguno de los dos hechos era visible en el panel del proveedor, y los dos quedaron obvios en el primer reporte por conversación.',
        },
        {
          type: 'table',
          columns: ['Pregunta de negocio', '¿La factura agregada responde?', 'Qué hay que registrar'],
          rows: [
            [
              '¿Cuánto cuesta resolver este tipo de caso?',
              'No, mezcla tipos de caso en el mismo total',
              'Costo sumado por conversación, con el tipo de recorrido como atributo',
            ],
            [
              '¿Automatizar este flujo se paga?',
              'No, no separa conversación resuelta de traspasada',
              'Costo por conversación cruzado con el desenlace de la conversación',
            ],
            [
              '¿Qué etapa del agente es cara?',
              'No, todas las llamadas caen en el mismo balde',
              'Costo por etapa dentro del ámbito de la conversación',
            ],
            [
              '¿Este cliente grande es rentable?',
              'Solo si cada tenant tiene su propia clave de API',
              'Identificador de tenant llevado en cada registro de uso',
            ],
            [
              '¿El cambio de ayer encareció?',
              'Parcialmente, y sin aislar la causa',
              'Versión de prompt y de modelo grabadas junto con el uso',
            ],
          ],
        },
      ],
    },
    {
      title: 'Elegir la unidad: conversación, recorrido o resolución',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de instrumentar cualquier cosa hay que decidir a qué se atribuye el costo, y esa elección determina todo lo que viene después. La petición es la unidad más fácil de medir y la menos útil de todas, porque nadie toma una decisión de producto sobre una llamada aislada. La conversación es el primer nivel con significado de negocio: tiene comienzo, tiene fin, tiene un cliente del otro lado y tiene un desenlace. El recorrido es más preciso cuando una conversación trata varios asuntos, y la resolución es la unidad más cercana al valor, pero exige que sepas decir si el caso realmente se resolvió, cosa que no todo sistema sabe.',
        },
        {
          type: 'paragraph',
          value:
            'La recomendación práctica es empezar por la conversación y enriquecer el registro con atributos que permitan agregar de otras formas después. Si cada evento de uso lleva el identificador de la conversación, el del tenant, el tipo de recorrido detectado, la etapa del pipeline y el desenlace final, puedes calcular costo por resolución sin reinstrumentar nada, solo agrupando de otra manera en la consulta. El error caro es el opuesto: elegir directo la unidad más sofisticada, descubrir que el dato de desenlace es poco confiable y quedarte sin ningún número utilizable durante tres meses. Empieza por la unidad que puedes cerrar con confianza y sube de granularidad cuando el dato lo sostenga.',
        },
        {
          type: 'table',
          columns: ['Unidad', 'Facilidad de medir', 'Decisión que habilita'],
          rows: [
            [
              'Petición',
              'Trivial, ya viene en la respuesta de la API',
              'Casi ninguna: sirve para depurar una llamada específica',
            ],
            [
              'Conversación',
              'Fácil si hay un identificador estable de sesión',
              'Comparar tipos de caso y detectar conversación anómala',
            ],
            [
              'Recorrido',
              'Media, exige clasificar el asunto del tramo',
              'Decidir qué flujo automatizar o apagar',
            ],
            [
              'Resolución',
              'Difícil, depende de una señal confiable de desenlace',
              'Calcular costo por caso resuelto y compararlo con el humano',
            ],
            [
              'Tenant',
              'Fácil, es un atributo que se lleva junto',
              'Fijar precio de plan e identificar cliente que da pérdida',
            ],
          ],
        },
      ],
    },
    {
      title: 'Propagar el ámbito de costo sin ensuciar la firma de cada función',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El problema técnico central es que la llamada al modelo ocurre en algún lugar hondo de la pila, y el identificador de la conversación nace allá arriba, en el handler del webhook. Pasar ese identificador como parámetro por todas las capas funciona y envenena el código: toda función en el camino gana un argumento que no tiene nada que ver con lo que hace, y basta con que una función nueva olvide reenviarlo para que el costo se vuelva no atribuido. La solución limpia en Node es el almacenamiento de contexto asíncrono, que ata un ámbito a la ejecución y lo mantiene disponible a través de cualquier profundidad de await sin tocar ninguna firma intermedia.',
        },
        {
          type: 'paragraph',
          value:
            'Con el ámbito disponible, el registro de costo deja de ser responsabilidad de quien llama y pasa a ser del cliente del proveedor. Envolver la llamada en un pequeño decorador que lee el uso de la respuesta, lo convierte en dinero con la tabla de precios del modelo y lo acredita en el ámbito activo garantiza que ninguna llamada nueva nazca sin contabilidad. Ese es el punto de estrangulamiento correcto: una única función por donde pasa todo el gasto. Si alguien agrega una etapa nueva al agente mañana, queda contabilizada gratis, porque usa el mismo cliente. El detalle que suele escaparse es que la conversión a dinero necesita la tabla de precios versionada por modelo, incluyendo los precios distintos de entrada, salida, escritura en cache y lectura de cache, que no son el mismo número.',
        },
        {
          type: 'code',
          value: `// cost-scope.js
// El ambito vive en el contexto asincrono: ninguna funcion intermedia
// necesita recibir conversationId como argumento para atribuir el costo.

import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

// Precio por MILLON de tokens. Entrada, salida, escritura y lectura de cache
// tienen precios distintos: tratar todo como un numero solo distorsiona.
const PRICING = {
  'claude-sonnet-5': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
};

export function runInCostScope(attributes, fn) {
  const scope = { attributes, events: [] };
  return storage.run(scope, () => fn(scope));
}

export function currentScope() {
  return storage.getStore() || null;
}

// Precio de UN componente aislado: lo usa el reporte para separar la
// escritura de cache y el ahorro de lectura del costo efectivo.
export function priceComponent(model, component, tokens) {
  const p = PRICING[model];
  if (!p) throw new Error('modelo sin precio registrado: ' + model);
  return (tokens * p[component]) / 1e6;
}

export function priceUsage(model, usage) {
  return (
    priceComponent(model, 'input', usage.inputTokens || 0) +
    priceComponent(model, 'output', usage.outputTokens || 0) +
    priceComponent(model, 'cacheWrite', usage.cacheWriteTokens || 0) +
    priceComponent(model, 'cacheRead', usage.cacheReadTokens || 0)
  );
}

// Acredita un evento de uso en el ambito activo. Sin ambito, el costo es
// real y debe ir al balde de no atribuido, nunca ser descartado.
export function recordUsage({ model, usage, step, attempt = 1 }) {
  const scope = currentScope();
  const costUsd = priceUsage(model, usage);
  const event = { model, usage, step, attempt, costUsd };
  if (!scope) {
    unattributed.push(event);
    return event;
  }
  scope.events.push(event);
  return event;
}

export const unattributed = [];`,
        },
        {
          type: 'code',
          value: `// llm-client.js
// Punto de estrangulamiento: TODA llamada al proveedor pasa por aqui, asi
// toda etapa nueva del agente nace contabilizada sin que nadie lo recuerde.

import { recordUsage } from './cost-scope.js';

export function createCostAwareClient(provider) {
  return {
    async complete({ model, messages, step, attempt = 1, ...rest }) {
      const response = await provider.messages.create({ model, messages, ...rest });
      const u = response.usage || {};

      recordUsage({
        model,
        step,
        attempt,
        usage: {
          inputTokens: u.input_tokens || 0,
          outputTokens: u.output_tokens || 0,
          cacheWriteTokens: u.cache_creation_input_tokens || 0,
          cacheReadTokens: u.cache_read_input_tokens || 0,
        },
      });

      return response;
    },
  };
}

// En el handler del webhook el ambito abre una vez y cubre la cadena entera:
//
//   await runInCostScope(
//     { conversationId, tenantId, journey: 'segundo-comprobante', channel: 'whatsapp' },
//     async (scope) => {
//       await runAgent(message);          // ninguna firma cambio
//       await emitCostReport(scope);      // cierra y publica el total
//     },
//   );`,
        },
      ],
    },
    {
      title: 'El costo que no pertenece a ninguna conversación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una parte de la factura no nace de ninguna conversación y desaparece de la contabilidad si no le reservas un lugar. La ejecución de la batería de eval en CI consume tokens. El reprocesamiento de embeddings cuando cambia el corpus consume tokens. La tarea nocturna que resume conversaciones para la memoria de largo plazo consume tokens. La prueba manual de un ingeniero consume tokens. Nada de eso pertenece a un cliente, y tratar ese gasto como ruido produce un efecto perverso: la suma de los costos por conversación queda sistemáticamente por debajo de la factura, y cuando alguien nota la diferencia, la confianza en el reporte entero se cae.',
        },
        {
          type: 'paragraph',
          value:
            'La salida es tener categorías explícitas de costo indirecto y obligar a todo origen de gasto a declarar la suya. El ámbito de costo no siempre tiene que ser una conversación: puede ser un job, con el nombre del job como atributo. Lo que no puede existir es una llamada sin ningún ámbito, y por eso conviene tratar el balde de no atribuido como una alarma y no como una categoría aceptable. Debe tender a cero, y cualquier crecimiento significa un camino de código nuevo que escapó de la instrumentación, exactamente el tipo de regresión silenciosa que solo aparece cuando llega la factura. Una verificación simple al final de cada día, comparando el total atribuido con el total medido por modelo, convierte esa desviación en una señal accionable en vez de una sorpresa mensual.',
        },
        {
          type: 'table',
          columns: ['Categoría de gasto', 'A qué atribuirlo', 'Cómo tratarlo en el reporte'],
          rows: [
            [
              'Conversación con cliente',
              'Conversación, tenant y recorrido',
              'Costo directo: base de todo cálculo de costo por resolución',
            ],
            [
              'Eval y prueba automatizada',
              'Job de eval, con la versión probada',
              'Indirecto de ingeniería: prorrateado por período, no por cliente',
            ],
            [
              'Reindexación y embeddings',
              'Job de ingesta, con el corpus',
              'Indirecto de plataforma: amortizado en el período de uso del índice',
            ],
            [
              'Resumen nocturno de memoria',
              'Job en lote, con la lista de conversaciones tocadas',
              'Puede prorratearse por conversación cuando el beneficio es rastreable',
            ],
            [
              'Exploración manual',
              'Ambiente de desarrollo',
              'Indirecto: conviene separarlo por clave para no ensuciar producción',
            ],
          ],
        },
      ],
    },
    {
      title: 'Prorratear lo compartido sin inventar precisión',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Dos gastos reales desafían la atribución directa porque una conversación paga y otra cosecha. El primero es el cache de prompt: la primera conversación que atraviesa un prefijo nuevo paga la escritura del cache, más cara que la entrada normal, y las conversaciones siguientes leen ese cache por una fracción del precio. Atribuir la escritura entera a quien llegó primero hace que el reporte diga que aquella conversación fue absurdamente cara y que las siguientes fueron baratas, cuando en la práctica el costo es del conjunto. El segundo es el reintento: la llamada que falló por inestabilidad del proveedor consumió tokens de entrada y no produjo respuesta, y ese desperdicio pertenece a la conversación en sentido contable, pero no debería contaminar la comparación entre tipos de recorrido.',
        },
        {
          type: 'paragraph',
          value:
            'La regla que funciona es separar lo que es atribución de lo que es análisis. Contablemente, todo lo que ocurrió dentro del ámbito pertenece al ámbito: la escritura de cache y el reintento entran en el costo de aquella conversación, y eso es lo que hace que la suma cuadre con la factura. Analíticamente, el reporte expone cada componente en una columna propia, para que la comparación entre recorridos use el costo efectivo, sin escritura de cache y sin reintento, mientras el total sigue íntegro. Quien quiera un prorrateo más justo del cache puede amortizar la escritura entre las lecturas que habilitó dentro de una ventana, pero eso solo vale la pena cuando el cache es grande y la decisión en juego depende de él. En la mayoría de los casos, exponer las columnas separadas ya resuelve, y evita la tentación de construir un modelo de prorrateo que nadie puede auditar.',
        },
        {
          type: 'code',
          value: `// report.js
// Total contable = todo lo que cayo en el ambito (cuadra con la factura).
// Costo efectivo = solo lo que el recorrido consumio realmente para responder
// (es la columna correcta para comparar tipos de caso entre si).

import { priceComponent } from './cost-scope.js';

// El desperdicio de reintento es el costo de los intentos que NO produjeron
// la respuesta. Marcar "attempt > 1" seria lo contrario: el ultimo intento es
// justamente el que respondio. Por etapa, el evento ganador queda en el costo
// efectivo y los anteriores salen de el.
function winningAttempts(events) {
  const best = new Map();
  for (const event of events) {
    const current = best.get(event.step);
    if (current === undefined || event.attempt > current) best.set(event.step, event.attempt);
  }
  return best;
}

export function summarize(scope) {
  const byStep = new Map();
  const winners = winningAttempts(scope.events);
  let totalUsd = 0;
  let retryWasteUsd = 0;
  let cacheWriteUsd = 0;
  let cacheSavingsUsd = 0;

  for (const event of scope.events) {
    totalUsd += event.costUsd;

    if (event.attempt < winners.get(event.step)) retryWasteUsd += event.costUsd;

    const cacheWrite = event.usage.cacheWriteTokens || 0;
    const cacheRead = event.usage.cacheReadTokens || 0;
    if (cacheWrite) cacheWriteUsd += priceComponent(event.model, 'cacheWrite', cacheWrite);
    // Ahorro = lo que esas lecturas habrian costado como entrada normal.
    if (cacheRead) {
      cacheSavingsUsd +=
        priceComponent(event.model, 'input', cacheRead) -
        priceComponent(event.model, 'cacheRead', cacheRead);
    }

    byStep.set(event.step, (byStep.get(event.step) || 0) + event.costUsd);
  }

  return {
    ...scope.attributes,
    totalUsd,                                  // cuadra con la factura
    effectiveUsd: totalUsd - retryWasteUsd - cacheWriteUsd, // compara recorridos
    retryWasteUsd,
    cacheWriteUsd,
    cacheSavingsUsd,
    calls: scope.events.length,
    byStep: Object.fromEntries(byStep),
  };
}`,
        },
        {
          type: 'diagram',
          value: `Donde nace el costo y donde se atribuye

  webhook recibe mensaje
        |
        v
  [runInCostScope] abre ambito { conversationId, tenantId, journey }
        |
        +--> clasificar intencion      -> recordUsage(step: 'classify')
        |
        +--> recuperar contexto (RAG)  -> recordUsage(step: 'embed-query')
        |
        +--> generar respuesta         -> recordUsage(step: 'answer', attempt: 1)
        |        |                        429 del proveedor: no respondio
        |        |                        (entra en el total, sale del efectivo)
        |        \\-- nuevo intento     -> recordUsage(step: 'answer', attempt: 2)
        |                                  respondio: queda en el costo efectivo
        v
  [summarize] cierra el ambito
        |
        +--> costo total       -> reconciliacion con la factura
        +--> costo efectivo    -> comparacion entre recorridos
        +--> costo por etapa   -> donde optimizar primero

  fuera del ambito de conversacion:
    job de eval, reindexacion, resumen nocturno -> ambito propio, costo indirecto
    llamada sin ningun ambito                   -> balde NO ATRIBUIDO (alarma)`,
        },
      ],
    },
    {
      title: 'Cerrar el mes: reconciliar lo contabilizado con lo cobrado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un sistema de atribución solo es confiable si alguien verifica que cuadra con la realidad, y la realidad es la factura. La reconciliación es simple de describir y reveladora en la práctica: suma todo lo que contabilizaste en el período, por modelo, y compáralo con lo que el proveedor cobró por el mismo modelo en el mismo período. La diferencia nunca es exactamente cero, porque hay redondeo, huso horario de cierre y llamadas en vuelo en el corte, pero debe ser pequeña y estable. Una divergencia que crece de uno por ciento a ocho por ciento en un mes no es ruido: es un camino de código nuevo llamando al proveedor por fuera del cliente instrumentado, o una tabla de precios desactualizada después de un reajuste.',
        },
        {
          type: 'ordered',
          items: [
            'Congela el período: define la ventana con el mismo huso que el proveedor usa en el cierre, si no la diferencia de hora se vuelve divergencia falsa todos los meses.',
            'Agrega por modelo, no solo el total: un error de precio en un modelo específico se diluye en el total y queda obvio al desglosar por modelo.',
            'Compara también el volumen de tokens, no solo el dinero: mismo token con dinero distinto apunta a tabla de precios equivocada, y token distinto apunta a instrumentación faltante.',
            'Revisa el balde de no atribuido: explica parte de la diferencia y debe tender a cero, con cualquier crecimiento tratado como incidente.',
            'Investiga por etapa antes que por cliente: la etapa nueva que nadie instrumentó aparece como agujero en una etapa específica, no repartida.',
            'Versiona la tabla de precios con fecha de vigencia: un reajuste del proveedor a mitad de mes exige precio por período, si no la reconciliación nunca vuelve a cuadrar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Con la reconciliación estable, el reporte por conversación deja de ser un gráfico bonito y se vuelve base de decisión. Es en ese punto donde preguntas antes imposibles se vuelven triviales: el recorrido de segundo comprobante cuesta ocho centavos y se resuelve solo en noventa por ciento de los casos, mientras el de cambio de producto cuesta cuarenta y dos centavos y se traspasa en la mitad, lo que da un costo por resolución casi diez veces mayor. Con ese número en la mano, la discusión sale de la suposición sobre qué modelo es caro y va donde debería haber estado desde el principio: reducir el contexto del recorrido caro, mover la clasificación a un modelo más pequeño, o simplemente aceptar que ese flujo específico se atiende mejor con un humano y apagar su automatización sin culpa.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cuál es la unidad correcta para atribuir costo de IA en atención?',
      answer:
        'La conversación es el mejor punto de partida porque tiene comienzo, fin, un cliente identificable y un desenlace, lo que ya permite comparar tipos de caso y detectar conversaciones anómalas. La petición es fácil de medir y casi inútil para decidir, porque nadie decide producto mirando una llamada aislada. La resolución es la unidad más cercana al valor, ya que el costo por caso resuelto es el número que se compara con el costo de la atención humana, pero depende de una señal confiable de desenlace que muchos sistemas no tienen. El camino práctico es contabilizar por conversación y enriquecer cada evento de uso con tenant, tipo de recorrido, etapa del pipeline y desenlace final. Con esos atributos grabados, calculas costo por resolución, por tenant o por recorrido solo agrupando de otra manera en la consulta, sin reinstrumentar nada cuando la pregunta cambie.',
    },
    {
      question: '¿Cómo atribuir el costo del cache de prompt y de los reintentos?',
      answer:
        'Separando atribución de análisis. Contablemente, todo lo que ocurrió dentro del ámbito pertenece al ámbito: la escritura de cache pagada por la primera conversación que atravesó el prefijo y los tokens gastados en el intento fallido entran en el costo de aquella conversación, y eso es justamente lo que hace que la suma de los costos cuadre con la factura del proveedor. Analíticamente, el reporte debe exponer cada componente en su propia columna, porque comparar recorridos usando el total distorsiona: la conversación que por casualidad llegó primero al cache nuevo aparece absurdamente cara y las siguientes aparecen baratas, sin que ninguna de las dos haya consumido más recurso de hecho. La columna de costo efectivo, que excluye escritura de cache y desperdicio de reintento, es la que sirve para comparar tipos de caso entre sí. Un prorrateo elaborado del cache entre las lecturas que habilitó solo compensa cuando el cache es grande y alguna decisión concreta depende de él.',
    },
    {
      question: '¿Cómo saber si la atribución es correcta?',
      answer:
        'Reconciliando con la factura cada período. Suma todo lo contabilizado, desglosado por modelo, y compáralo con lo que el proveedor cobró por ese modelo en la misma ventana, usando el huso horario de cierre de él para no crear una divergencia falsa. La diferencia nunca será cero por el redondeo y las llamadas en vuelo en el corte, pero debe ser pequeña y estable a lo largo de los meses. Compara también el volumen de tokens y no solo el monto en dinero, porque eso separa las dos causas posibles: el mismo volumen con dinero distinto apunta a una tabla de precios desactualizada después de un reajuste, mientras que un volumen distinto apunta a un camino de código llamando al proveedor por fuera del cliente instrumentado. Súmale a eso un balde explícito de costo no atribuido, tratado como alarma y no como categoría aceptable, y detectas la etapa nueva sin instrumentación al día siguiente, en vez de descubrirlo cuando llegue la factura.',
    },
  ],
  conclusion: {
    title: 'Sin atribución, todo ahorro es una apuesta',
    description:
      'La factura agregada informa cuánto gastaste y esconde lo único que importa: qué generó valor y qué solo consumió tokens. Elegir la conversación como unidad, propagar el ámbito de costo por el contexto asíncrono para que ninguna llamada nazca sin contabilidad, dar lugar explícito al costo indirecto de eval y reindexación, separar el total contable del costo efectivo al tratar cache y reintentos, y cerrar el ciclo reconciliando con la factura convierte el costo de IA de misterio mensual en métrica de producto. Puedo implementar esta capa de atribución en tu sistema con LLM, desde la instrumentación en el cliente hasta el reporte de costo por resolución, para que decidir dónde recortar deje de ser una apuesta y pase a ser leer un número.',
    cta: 'Hablar sobre costo por conversación en mi sistema',
  },
  related: [
    { label: 'Observabilidad de LLM: tracing, costo y calidad', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'ROI real de automatización con IA', to: '/blog/roi-real-automacao-ia' },
    { label: 'Enrutamiento de modelos: el modelo correcto para cada tarea', to: '/blog/roteamento-modelos-modelo-certo-cada-tarefa' },
  ],
  repo: { name: 'llm-cost-attribution-mini', description: repo.es, url: repoUrl },
};

export default {
  pt,
  en,
  es,
};
