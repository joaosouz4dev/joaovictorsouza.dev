// Conteudo do artigo: observabilidade de LLM (tracing, custo e qualidade).
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Middleware mínimo de observabilidade para chamadas de LLM: envelopa cada chamada com trace e span, calcula custo por tokens de entrada e saída, mede latência por fase (fila, modelo, tools), registra prompt e resposta com redação de dados sensíveis e exporta métricas agregadas por rota e por modelo.',
  en: 'Minimal observability middleware for LLM calls: wraps every call with a trace and span, computes cost from input and output tokens, measures latency per phase (queue, model, tools), records prompt and response with sensitive-data redaction and exports aggregated metrics per route and per model.',
  es: 'Middleware mínimo de observabilidad para llamadas de LLM: envuelve cada llamada con trace y span, calcula el costo por tokens de entrada y salida, mide la latencia por fase (cola, modelo, tools), registra prompt y respuesta con redacción de datos sensibles y exporta métricas agregadas por ruta y por modelo.',
};

const repoUrl = 'https://github.com/joaosouz4dev/llm-observability-mini';

const pt = {
  intro:
    'Sistema com LLM em produção sem observabilidade é uma caixa preta que você paga sem entender. A resposta piorou? Não sabe dizer. A fatura triplicou? Não sabe qual rota. O bot ficou lento? Não sabe se é a fila, o modelo ou a tool. Diferente de um serviço tradicional, onde bastam latência e taxa de erro, um LLM tem três eixos que precisam ser observados juntos: latência (quanto demora), custo (quanto gasta em tokens) e qualidade (se a resposta presta). Observar só um deles engana: um modelo mais barato pode alucinar mais, um mais rápido pode custar o dobro. Este artigo mostra como instrumentar as três dimensões sem virar um projeto de plataforma: o modelo de tracing certo para LLM, como calcular custo por chamada de verdade, como medir qualidade em produção sem gabarito, o que logar sem vazar dado sensível e quais alertas evitam a surpresa no fim do mês. O foco é o mínimo que torna o sistema operável.',
  sections: [
    {
      title: 'Por que os três pilares tradicionais não bastam',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A observabilidade clássica se apoia em logs, métricas e traces, e mira latência, throughput e taxa de erro. Isso responde "o serviço está de pé?", mas não responde nenhuma das perguntas que importam num sistema com LLM. Uma chamada pode retornar 200 OK, dentro do SLA de latência, e ainda assim ter alucinado a resposta, recusado indevidamente ou gasto três vezes mais tokens do que o esperado. O sucesso HTTP não diz nada sobre o sucesso semântico.',
        },
        {
          type: 'paragraph',
          value:
            'Um LLM precisa de três eixos observados em conjunto, porque eles se movem em direções opostas. Trocar de modelo para reduzir custo pode derrubar a qualidade. Encurtar o prompt para reduzir latência pode remover contexto e aumentar o retrabalho. Cada decisão mexe nos três ao mesmo tempo, e sem medir os três você otimiza um número e degrada outro sem perceber. A tabela abaixo mostra o que cada eixo exige que a observabilidade tradicional não entrega.',
        },
        {
          type: 'table',
          columns: ['Eixo', 'O que mede', 'Sinal que importa', 'Por que APM clássico não pega'],
          rows: [
            [
              'Latência',
              'Tempo por fase: fila, prompt, modelo, tools, streaming',
              'Percentil p95 por rota, não a média',
              'Não separa tempo de modelo de tempo de tool',
            ],
            [
              'Custo',
              'Tokens de entrada e saída por chamada, convertidos em moeda',
              'Custo por rota e por usuário, tendência diária',
              'Não existe o conceito de token no APM padrão',
            ],
            [
              'Qualidade',
              'A resposta está correta, útil e no formato esperado',
              'Taxa de alucinação, recusa, formato inválido',
              'HTTP 200 não significa resposta boa',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A regra prática: nunca olhe um eixo isolado. Um dashboard de LLM útil mostra latência, custo e qualidade lado a lado por rota, para que qualquer mudança revele o trade-off imediatamente. Melhorar a média sem olhar o p95, ou baixar custo sem olhar qualidade, é trocar um problema visível por um invisível.',
        },
      ],
    },
    {
      title: 'O modelo de tracing certo para LLM',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O tracing distribuído resolve a pergunta "onde o tempo foi gasto?", e num sistema com LLM a resposta quase nunca é óbvia. Uma única requisição do usuário pode disparar um retrieval, uma ou mais chamadas ao modelo, várias tools e um passo de pós-processamento. Sem span por fase, tudo vira um bloco único de latência e você não sabe se o gargalo é o modelo, a busca vetorial ou a API externa que a tool chamou. O modelo mental é o mesmo do tracing de microserviço, mas os atributos do span são específicos de LLM.',
        },
        {
          type: 'code',
          value: `// observability/trace.js
// Envelopa uma chamada de LLM em um span com atributos especificos:
// tokens, custo, modelo e fase. O span vira a unidade que voce agrega depois.

export async function tracedCompletion(tracer, { route, model }, call) {
  const span = tracer.startSpan('llm.completion', {
    attributes: { route, model },
  });

  try {
    const res = await call(); // chama o provedor (ex.: Anthropic)

    // Atributos que tornam o span util para custo e qualidade,
    // nao so para latencia.
    span.setAttributes({
      'llm.tokens.input': res.usage.input_tokens,
      'llm.tokens.output': res.usage.output_tokens,
      'llm.cost.usd': estimateCost(model, res.usage),
      'llm.finish_reason': res.stop_reason, // end_turn, max_tokens, tool_use...
      'llm.cache.read': res.usage.cache_read_input_tokens ?? 0,
    });
    span.setStatus({ code: 'OK' });
    return res;
  } catch (err) {
    // Erro do provedor tambem e um sinal de qualidade e custo.
    span.recordException(err);
    span.setStatus({ code: 'ERROR', message: err.message });
    throw err;
  } finally {
    span.end(); // fecha o span mesmo em erro, senao o trace fica quebrado
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que a maioria esquece: registrar o finish_reason. Um pico de respostas terminando em max_tokens indica prompt ou saída mal dimensionados, custo desnecessário e resposta cortada, tudo invisível se você só olha latência. E propagar um traceId único do início da requisição até a resposta final amarra retrieval, modelo e tools no mesmo trace, permitindo abrir uma reclamação de usuário e ver a árvore inteira daquela conversa.',
        },
      ],
    },
    {
      title: 'Custo: o eixo que ninguém mede até a fatura chegar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Custo de LLM é a métrica mais fácil de ignorar e a mais cara de ignorar. Ele não aparece no APM, não dispara erro, e cresce silenciosamente até a fatura do fim do mês. A base é simples: cada chamada tem tokens de entrada e de saída, cada um com um preço por milhão de tokens que difere por modelo. O erro comum é medir custo agregado da conta inteira, quando o que importa é custo por rota e por usuário, porque é ali que você descobre qual funcionalidade está cara e qual usuário está abusando.',
        },
        {
          type: 'code',
          value: `// observability/cost.js
// Calcula o custo de uma chamada a partir dos tokens e da tabela de precos.
// Precos sao por milhao de tokens; entrada e saida tem valores distintos.
// Tokens lidos do cache custam uma fracao do preco de entrada.

const PRICING = {
  // valores ilustrativos, por milhao de tokens (input, output, cacheRead)
  'fast':     { input: 0.8,  output: 4.0,  cacheRead: 0.08 },
  'balanced': { input: 3.0,  output: 15.0, cacheRead: 0.30 },
};

export function estimateCost(model, usage) {
  const p = PRICING[model];
  if (!p) return 0; // modelo desconhecido: nao chuta, sinaliza depois

  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cached = usage.cache_read_input_tokens ?? 0;

  // Tokens cacheados nao pagam preco de entrada cheio: contam a parte.
  const billableInput = Math.max(input - cached, 0);

  const usd =
    (billableInput / 1_000_000) * p.input +
    (cached / 1_000_000) * p.cacheRead +
    (output / 1_000_000) * p.output;

  return Number(usd.toFixed(6)); // precisao suficiente para somar milhares
}`,
        },
        {
          type: 'paragraph',
          value:
            'Com o custo por chamada calculado e anexado ao span, o resto é agregação: some por rota para achar a funcionalidade cara, por usuário para achar abuso, por dia para ver a tendência. O prompt cache é o maior alavanca de custo em prompts longos e repetidos (system prompt fixo, contexto reaproveitado), e só aparece se você medir os tokens de cache separado. Sem observar custo por dimensão, a única alavanca que sobra é cortar features depois do susto.',
        },
      ],
    },
    {
      title: 'Qualidade em produção: medir sem gabarito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Qualidade é o eixo mais difícil, porque em produção você raramente tem a resposta certa para comparar. Diferente do eval offline, onde existe um dataset com gabarito, em produção a resposta acabou de ser gerada e ninguém sabe se está correta. A saída é medir sinais indiretos de qualidade que não precisam de gabarito, combinados: nenhum é definitivo sozinho, mas juntos desenham um retrato confiável de degradação.',
        },
        {
          type: 'list',
          items: [
            'Validação de formato: se a resposta deveria ser JSON com um schema, valide e conte quantas falham. Taxa de formato inválido subindo é degradação mensurável sem gabarito.',
            'Taxa de recusa: quantas respostas foram "não posso ajudar" ou similar. Recusa subindo pode ser prompt quebrado, guardrail agressivo ou mudança de modelo.',
            'finish_reason por max_tokens: respostas cortadas por limite de saída são qualidade degradada e custo desperdiçado ao mesmo tempo.',
            'Sinais do usuário: retentativa na mesma sessão, reformulação da pergunta, thumbs down, escalada para humano. São o eval humano de graça, se você os captura.',
            'LLM como juiz amostrado: rode um modelo avaliador sobre uma amostra do tráfego real (1 a 5 por cento), pontuando fidelidade e utilidade, para ter um número contínuo de qualidade sem avaliar tudo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A técnica que mais rende é o LLM como juiz amostrado: você não avalia cem por cento do tráfego (caro e lento), avalia uma fatia representativa e trata o resultado como uma métrica de qualidade que sobe e desce ao longo do tempo. Combinado com validação de formato e sinais do usuário, isso transforma qualidade de "acho que piorou" em uma linha no dashboard que dispara alerta quando cai. Nenhum sinal é perfeito, mas o conjunto é o suficiente para saber que algo mudou antes do cliente reclamar.',
        },
      ],
    },
    {
      title: 'O que logar sem vazar dado sensível',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Logar prompt e resposta é o que torna a depuração possível: sem ver o que entrou e o que saiu, todo bug de qualidade vira adivinhação. Mas prompt de produção carrega dado do usuário (nome, telefone, documento, histórico), e jogar isso cru no log é um incidente de privacidade esperando para acontecer. O equilíbrio é logar o suficiente para depurar, com redação de dados sensíveis antes de persistir, e retenção curta para o conteúdo bruto.',
        },
        {
          type: 'code',
          value: `// observability/redact.js
// Redige dados sensiveis do prompt/resposta ANTES de logar.
// Mantem o texto legivel para depurar, sem persistir PII crua.

const PATTERNS = [
  { name: 'email', re: /[\\w.+-]+@[\\w-]+\\.[\\w.-]+/g, tag: '[EMAIL]' },
  { name: 'phone', re: /\\b\\d{2}[\\s-]?\\d{4,5}[\\s-]?\\d{4}\\b/g, tag: '[PHONE]' },
  { name: 'cpf',   re: /\\b\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}\\b/g, tag: '[CPF]' },
  { name: 'card',  re: /\\b(?:\\d[ -]?){13,16}\\b/g, tag: '[CARD]' },
];

export function redact(text) {
  if (typeof text !== 'string') return text;
  return PATTERNS.reduce((acc, p) => acc.replace(p.re, p.tag), text);
}

// O log guarda metadados sempre, e o conteudo redigido com retencao curta.
export function buildLogRecord({ traceId, route, model, usage, prompt, output }) {
  return {
    traceId,
    route,
    model,
    tokens: { input: usage.input_tokens, output: usage.output_tokens },
    // Conteudo redigido: util para depurar, seguro para reter por pouco tempo.
    prompt: redact(prompt),
    output: redact(output),
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'A separação que importa: metadados (tokens, custo, latência, rota, finish_reason) são baratos e seguros, então guarde por muito tempo para análise de tendência. Conteúdo bruto (prompt e resposta) é caro e sensível, então redija sempre e retenha por pouco (dias, não meses), o suficiente para depurar o incidente recente. Nunca logue chave de API, token de sessão ou credencial, e trate o log de LLM com o mesmo cuidado de qualquer store de dado pessoal, porque é exatamente isso que ele é.',
        },
      ],
    },
    {
      title: 'Alertas que evitam a surpresa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Dashboard você olha quando lembra; alerta te avisa quando você não está olhando. O objetivo dos alertas de LLM é o mesmo dos guardrails: transformar um problema silencioso (custo subindo, qualidade caindo) em um evento acionável antes de virar prejuízo ou reclamação. O erro é alertar só em erro técnico (5xx, timeout) e ignorar os sinais que são únicos de LLM.',
        },
        {
          type: 'ordered',
          items: [
            'Custo por dia acima do orçamento esperado, ou custo por rota subindo mais de X por cento semana a semana: pega abuso, loop e regressão de prompt antes da fatura.',
            'Taxa de formato inválido ou de recusa acima da linha de base: sinal direto de que o prompt ou o modelo mudou de comportamento.',
            'p95 de latência por rota estourando o SLA, separando tempo de modelo de tempo de tool, para saber onde agir.',
            'Proporção de respostas terminando em max_tokens subindo: prompt ou limite de saída mal dimensionados, gerando custo e resposta cortada.',
            'Score do juiz amostrado caindo abaixo do limiar: a métrica de qualidade contínua que dispara antes do cliente perceber.',
          ],
        },
        {
          type: 'diagram',
          value: `Fluxo de observabilidade de uma chamada de LLM

  requisição do usuário
        |
        v
  [ trace inicia: traceId ]
        |
        +--> span: retrieval        120ms
        +--> span: llm.completion    infos: tokens, custo, finish_reason
        |         840ms
        +--> span: tool getStatus    retry=0   210ms
        |
        v
  [ trace fecha ]
        |
        +--> métricas agregadas:  custo/rota   p95/rota   qualidade/rota
        +--> log redigido:        prompt/output (retenção curta)
        +--> alertas:             custo, formato, recusa, latência, juiz`,
        },
        {
          type: 'paragraph',
          value:
            'Cada alerta deve apontar para a rota e o trace, não para um número global. "Custo subiu" não ajuda; "custo da rota /suporte subiu 40 por cento, veja o trace abc123" leva direto à causa. Observabilidade só vale quando encurta o caminho do sintoma até a origem, e um alerta sem contexto é só mais um número que a equipe aprende a ignorar.',
        },
      ],
    },
    {
      title: 'Começar pequeno sem virar projeto de plataforma',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A armadilha é achar que observabilidade de LLM exige uma plataforma inteira antes de dar valor. Não exige. Um middleware que envelopa a chamada, calcula custo, mede latência por fase e loga redigido já entrega noventa por cento do valor em poucas centenas de linhas. O caminho é adicionar por camadas, na ordem de retorno.',
        },
        {
          type: 'list',
          items: [
            'Comece pelo custo por chamada: é o mais barato de instrumentar e o que mais surpreende, porque ninguém sabia o número real por rota.',
            'Adicione o span por fase logo depois: separa tempo de modelo de tempo de tool e retrieval, o que torna a latência acionável.',
            'Ligue o log redigido cedo, com retenção curta: é o que permite depurar o primeiro bug de qualidade sem virar risco de privacidade.',
            'Instrumente os sinais de qualidade baratos (formato inválido, recusa, max_tokens) antes do juiz amostrado, que é mais caro de montar.',
            'Ponha os alertas por último, quando já tem linha de base: alertar sem baseline gera ruído, alertar com baseline gera ação.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A diferença entre operar um sistema com LLM e rezá-lo está em enxergar os três eixos juntos: quanto demora, quanto custa e se presta. Quem instrumenta isso cedo descobre a regressão de qualidade em um dashboard e o pico de custo em um alerta; quem deixa para depois descobre os dois no lugar errado, o primeiro na reclamação do cliente e o segundo na fatura.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Preciso de uma plataforma dedicada de observabilidade de LLM?',
      answer:
        'Não para começar. Um middleware que envelopa a chamada do modelo, calcula custo por tokens, emite span por fase e loga com redação cabe em poucas centenas de linhas e entrega a maior parte do valor. Plataformas dedicadas ajudam quando o volume cresce e você quer visualização de trace pronta e eval integrado, mas adotar uma cedo demais adiciona custo e dependência antes de você entender o que precisa medir. Instrumente os três eixos primeiro; escolha a ferramenta depois, sabendo o que ela resolve.',
    },
    {
      question: 'Como meço qualidade se não tenho a resposta certa em produção?',
      answer:
        'Com sinais indiretos combinados, nenhum definitivo sozinho: taxa de formato inválido, taxa de recusa, respostas cortadas por max_tokens, sinais do usuário (retentativa, reformulação, thumbs down, escalada) e um LLM como juiz rodando sobre uma amostra do tráfego (1 a 5 por cento). Cada um é um proxy imperfeito, mas o conjunto vira uma métrica de qualidade contínua que sobe e desce ao longo do tempo e dispara alerta quando cai, permitindo detectar degradação antes do cliente reclamar.',
    },
    {
      question: 'Como calculo o custo real de cada chamada?',
      answer:
        'Cada resposta do provedor traz o número de tokens de entrada e de saída; multiplique cada um pelo preço por milhão de tokens do modelo (entrada e saída têm preços diferentes) e some. Tokens lidos do prompt cache custam uma fração do preço de entrada, então conte-os à parte. Anexe esse custo ao span da chamada e agregue por rota, por usuário e por dia. O erro comum é olhar só o total da conta; o valor está em saber qual rota e qual usuário geram o gasto.',
    },
  ],
  conclusion: {
    title: 'Observabilidade é o que transforma um sistema de LLM de caixa preta em operação',
    description:
      'Tracing por fase, custo por chamada, sinais de qualidade e alertas com contexto são o mínimo para operar LLM sem surpresa de fatura nem regressão invisível. Posso instrumentar essas três dimensões no seu produto, do middleware ao dashboard, integradas ao seu stack e prontas para escalar.',
    cta: 'Falar sobre observabilidade do meu sistema de IA',
  },
  related: [
    { label: 'Orquestração de agentes de IA em produção', to: '/blog/orquestracao-agentes-ia-producao' },
    { label: 'Avaliação contínua de bots: do eval manual ao automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Observabilidade e confiabilidade', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'llm-observability-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'An LLM system in production without observability is a black box you pay for without understanding. The answer got worse? You cannot tell. The bill tripled? You do not know which route. The bot got slow? You do not know if it is the queue, the model or the tool. Unlike a traditional service, where latency and error rate are enough, an LLM has three axes that must be observed together: latency (how long it takes), cost (how much it spends in tokens) and quality (whether the answer is any good). Observing just one deceives you: a cheaper model can hallucinate more, a faster one can cost twice as much. This article shows how to instrument the three dimensions without turning it into a platform project: the right tracing model for LLMs, how to compute per-call cost for real, how to measure quality in production without a ground truth, what to log without leaking sensitive data and which alerts avoid the end-of-month surprise. The focus is the minimum that makes the system operable.',
  sections: [
    {
      title: 'Why the three classic pillars are not enough',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Classic observability rests on logs, metrics and traces, and aims at latency, throughput and error rate. That answers "is the service up?", but it answers none of the questions that matter in an LLM system. A call can return 200 OK, within the latency SLA, and still have hallucinated the answer, refused improperly or spent three times more tokens than expected. HTTP success says nothing about semantic success.',
        },
        {
          type: 'paragraph',
          value:
            'An LLM needs three axes observed together, because they move in opposite directions. Switching models to cut cost can drop quality. Shortening the prompt to cut latency can remove context and increase rework. Every decision moves all three at once, and without measuring all three you optimize one number and degrade another without noticing. The table below shows what each axis requires that traditional observability does not deliver.',
        },
        {
          type: 'table',
          columns: ['Axis', 'What it measures', 'Signal that matters', 'Why classic APM misses it'],
          rows: [
            [
              'Latency',
              'Time per phase: queue, prompt, model, tools, streaming',
              'p95 percentile per route, not the average',
              'Does not separate model time from tool time',
            ],
            [
              'Cost',
              'Input and output tokens per call, converted to currency',
              'Cost per route and per user, daily trend',
              'There is no token concept in standard APM',
            ],
            [
              'Quality',
              'Whether the answer is correct, useful and in the expected format',
              'Hallucination, refusal, invalid-format rate',
              'HTTP 200 does not mean a good answer',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The practical rule: never look at one axis in isolation. A useful LLM dashboard shows latency, cost and quality side by side per route, so any change reveals the trade-off immediately. Improving the average without watching p95, or cutting cost without watching quality, is trading a visible problem for an invisible one.',
        },
      ],
    },
    {
      title: 'The right tracing model for LLMs',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Distributed tracing answers "where was the time spent?", and in an LLM system the answer is almost never obvious. A single user request can trigger a retrieval, one or more model calls, several tools and a post-processing step. Without a span per phase, everything becomes a single block of latency and you do not know whether the bottleneck is the model, the vector search or the external API the tool called. The mental model is the same as microservice tracing, but the span attributes are LLM-specific.',
        },
        {
          type: 'code',
          value: `// observability/trace.js
// Wraps an LLM call in a span with specific attributes:
// tokens, cost, model and phase. The span becomes the unit you aggregate later.

export async function tracedCompletion(tracer, { route, model }, call) {
  const span = tracer.startSpan('llm.completion', {
    attributes: { route, model },
  });

  try {
    const res = await call(); // calls the provider (e.g. Anthropic)

    // Attributes that make the span useful for cost and quality,
    // not just latency.
    span.setAttributes({
      'llm.tokens.input': res.usage.input_tokens,
      'llm.tokens.output': res.usage.output_tokens,
      'llm.cost.usd': estimateCost(model, res.usage),
      'llm.finish_reason': res.stop_reason, // end_turn, max_tokens, tool_use...
      'llm.cache.read': res.usage.cache_read_input_tokens ?? 0,
    });
    span.setStatus({ code: 'OK' });
    return res;
  } catch (err) {
    // A provider error is also a quality and cost signal.
    span.recordException(err);
    span.setStatus({ code: 'ERROR', message: err.message });
    throw err;
  } finally {
    span.end(); // close the span even on error, otherwise the trace breaks
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'The detail most people forget: recording the finish_reason. A spike of responses ending in max_tokens indicates a poorly sized prompt or output, unnecessary cost and a truncated answer, all invisible if you only look at latency. And propagating a single traceId from the start of the request to the final answer ties retrieval, model and tools into the same trace, letting you open a user complaint and see the whole tree of that conversation.',
        },
      ],
    },
    {
      title: 'Cost: the axis no one measures until the bill arrives',
      blocks: [
        {
          type: 'paragraph',
          value:
            'LLM cost is the easiest metric to ignore and the most expensive to ignore. It does not show up in the APM, does not raise an error, and grows silently until the end-of-month bill. The basis is simple: every call has input and output tokens, each with a price per million tokens that differs by model. The common mistake is measuring aggregate cost of the whole account, when what matters is cost per route and per user, because that is where you discover which feature is expensive and which user is abusing it.',
        },
        {
          type: 'code',
          value: `// observability/cost.js
// Computes the cost of a call from tokens and the pricing table.
// Prices are per million tokens; input and output have distinct values.
// Tokens read from cache cost a fraction of the input price.

const PRICING = {
  // illustrative values, per million tokens (input, output, cacheRead)
  'fast':     { input: 0.8,  output: 4.0,  cacheRead: 0.08 },
  'balanced': { input: 3.0,  output: 15.0, cacheRead: 0.30 },
};

export function estimateCost(model, usage) {
  const p = PRICING[model];
  if (!p) return 0; // unknown model: do not guess, flag later

  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cached = usage.cache_read_input_tokens ?? 0;

  // Cached tokens do not pay full input price: count them apart.
  const billableInput = Math.max(input - cached, 0);

  const usd =
    (billableInput / 1_000_000) * p.input +
    (cached / 1_000_000) * p.cacheRead +
    (output / 1_000_000) * p.output;

  return Number(usd.toFixed(6)); // enough precision to sum thousands
}`,
        },
        {
          type: 'paragraph',
          value:
            'With the per-call cost computed and attached to the span, the rest is aggregation: sum by route to find the expensive feature, by user to find abuse, by day to see the trend. The prompt cache is the biggest cost lever on long, repeated prompts (a fixed system prompt, reused context), and it only shows up if you measure cache tokens separately. Without observing cost per dimension, the only lever left is cutting features after the scare.',
        },
      ],
    },
    {
      title: 'Quality in production: measuring without ground truth',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quality is the hardest axis, because in production you rarely have the right answer to compare against. Unlike offline eval, where a dataset with ground truth exists, in production the answer was just generated and no one knows if it is correct. The way out is to measure indirect quality signals that need no ground truth, combined: none is definitive alone, but together they draw a reliable picture of degradation.',
        },
        {
          type: 'list',
          items: [
            'Format validation: if the answer should be JSON matching a schema, validate it and count how many fail. A rising invalid-format rate is measurable degradation without ground truth.',
            'Refusal rate: how many answers were "I cannot help" or similar. A rising refusal rate may be a broken prompt, an aggressive guardrail or a model change.',
            'finish_reason of max_tokens: answers cut off by the output limit are degraded quality and wasted cost at the same time.',
            'User signals: retry in the same session, rephrasing the question, thumbs down, escalation to a human. They are free human eval, if you capture them.',
            'Sampled LLM as a judge: run an evaluator model over a sample of real traffic (1 to 5 percent), scoring faithfulness and usefulness, to get a continuous quality number without evaluating everything.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The technique that pays off most is sampled LLM as a judge: you do not evaluate a hundred percent of traffic (expensive and slow), you evaluate a representative slice and treat the result as a quality metric that rises and falls over time. Combined with format validation and user signals, this turns quality from "I think it got worse" into a line on the dashboard that fires an alert when it drops. No signal is perfect, but the set is enough to know something changed before the customer complains.',
        },
      ],
    },
    {
      title: 'What to log without leaking sensitive data',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Logging the prompt and response is what makes debugging possible: without seeing what went in and what came out, every quality bug becomes guesswork. But a production prompt carries user data (name, phone, document, history), and dumping that raw into the log is a privacy incident waiting to happen. The balance is to log enough to debug, with sensitive-data redaction before persisting, and short retention for the raw content.',
        },
        {
          type: 'code',
          value: `// observability/redact.js
// Redacts sensitive data from the prompt/response BEFORE logging.
// Keeps the text readable to debug, without persisting raw PII.

const PATTERNS = [
  { name: 'email', re: /[\\w.+-]+@[\\w-]+\\.[\\w.-]+/g, tag: '[EMAIL]' },
  { name: 'phone', re: /\\b\\d{2}[\\s-]?\\d{4,5}[\\s-]?\\d{4}\\b/g, tag: '[PHONE]' },
  { name: 'cpf',   re: /\\b\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}\\b/g, tag: '[CPF]' },
  { name: 'card',  re: /\\b(?:\\d[ -]?){13,16}\\b/g, tag: '[CARD]' },
];

export function redact(text) {
  if (typeof text !== 'string') return text;
  return PATTERNS.reduce((acc, p) => acc.replace(p.re, p.tag), text);
}

// The log always keeps metadata, and the content redacted with short retention.
export function buildLogRecord({ traceId, route, model, usage, prompt, output }) {
  return {
    traceId,
    route,
    model,
    tokens: { input: usage.input_tokens, output: usage.output_tokens },
    // Redacted content: useful to debug, safe to retain briefly.
    prompt: redact(prompt),
    output: redact(output),
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'The separation that matters: metadata (tokens, cost, latency, route, finish_reason) is cheap and safe, so keep it for a long time for trend analysis. Raw content (prompt and response) is expensive and sensitive, so always redact it and retain it for a short time (days, not months), enough to debug the recent incident. Never log an API key, session token or credential, and treat the LLM log with the same care as any personal-data store, because that is exactly what it is.',
        },
      ],
    },
    {
      title: 'Alerts that avoid the surprise',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A dashboard you look at when you remember; an alert warns you when you are not looking. The goal of LLM alerts is the same as guardrails: turn a silent problem (cost rising, quality dropping) into an actionable event before it becomes a loss or a complaint. The mistake is alerting only on technical error (5xx, timeout) and ignoring the signals that are unique to LLMs.',
        },
        {
          type: 'ordered',
          items: [
            'Daily cost above the expected budget, or cost per route rising more than X percent week over week: catches abuse, loops and prompt regression before the bill.',
            'Invalid-format or refusal rate above the baseline: a direct signal that the prompt or the model changed behavior.',
            'p95 latency per route breaching the SLA, separating model time from tool time, to know where to act.',
            'Share of responses ending in max_tokens rising: poorly sized prompt or output limit, generating cost and truncated answers.',
            'Sampled judge score dropping below the threshold: the continuous quality metric that fires before the customer notices.',
          ],
        },
        {
          type: 'diagram',
          value: `Observability flow of an LLM call

  user request
        |
        v
  [ trace starts: traceId ]
        |
        +--> span: retrieval        120ms
        +--> span: llm.completion    info: tokens, cost, finish_reason
        |         840ms
        +--> span: tool getStatus    retry=0   210ms
        |
        v
  [ trace closes ]
        |
        +--> aggregated metrics:  cost/route   p95/route   quality/route
        +--> redacted log:        prompt/output (short retention)
        +--> alerts:              cost, format, refusal, latency, judge`,
        },
        {
          type: 'paragraph',
          value:
            'Every alert should point to the route and the trace, not to a global number. "Cost went up" does not help; "cost of route /support went up 40 percent, see trace abc123" leads straight to the cause. Observability only pays off when it shortens the path from symptom to origin, and an alert without context is just one more number the team learns to ignore.',
        },
      ],
    },
    {
      title: 'Start small without turning it into a platform project',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The trap is thinking LLM observability requires a whole platform before it delivers value. It does not. A middleware that wraps the call, computes cost, measures latency per phase and logs redacted already delivers ninety percent of the value in a few hundred lines. The path is to add in layers, in order of return.',
        },
        {
          type: 'list',
          items: [
            'Start with per-call cost: it is the cheapest to instrument and the most surprising, because no one knew the real number per route.',
            'Add the per-phase span right after: it separates model time from tool and retrieval time, which makes latency actionable.',
            'Turn on redacted logging early, with short retention: it is what lets you debug the first quality bug without becoming a privacy risk.',
            'Instrument the cheap quality signals (invalid format, refusal, max_tokens) before the sampled judge, which is more expensive to set up.',
            'Put the alerts last, once you have a baseline: alerting without a baseline generates noise, alerting with a baseline generates action.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The difference between operating an LLM system and praying to it is in seeing the three axes together: how long it takes, how much it costs and whether it is any good. Whoever instruments this early catches the quality regression on a dashboard and the cost spike on an alert; whoever leaves it for later discovers both in the wrong place, the first in the customer complaint and the second on the bill.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Do I need a dedicated LLM observability platform?',
      answer:
        'Not to start. A middleware that wraps the model call, computes cost from tokens, emits a span per phase and logs with redaction fits in a few hundred lines and delivers most of the value. Dedicated platforms help when volume grows and you want ready trace visualization and integrated eval, but adopting one too early adds cost and dependency before you understand what you need to measure. Instrument the three axes first; pick the tool later, knowing what it solves.',
    },
    {
      question: 'How do I measure quality if I do not have the right answer in production?',
      answer:
        'With combined indirect signals, none definitive alone: invalid-format rate, refusal rate, answers cut off by max_tokens, user signals (retry, rephrasing, thumbs down, escalation) and an LLM as a judge running over a sample of traffic (1 to 5 percent). Each is an imperfect proxy, but the set becomes a continuous quality metric that rises and falls over time and fires an alert when it drops, letting you detect degradation before the customer complains.',
    },
    {
      question: 'How do I compute the real cost of each call?',
      answer:
        'Every provider response carries the number of input and output tokens; multiply each by the model price per million tokens (input and output have different prices) and sum. Tokens read from the prompt cache cost a fraction of the input price, so count them apart. Attach that cost to the call span and aggregate per route, per user and per day. The common mistake is looking only at the account total; the value is in knowing which route and which user generate the spend.',
    },
  ],
  conclusion: {
    title: 'Observability is what turns an LLM system from a black box into an operation',
    description:
      'Per-phase tracing, per-call cost, quality signals and alerts with context are the minimum to operate an LLM without a bill surprise or an invisible regression. I can instrument these three dimensions in your product, from the middleware to the dashboard, integrated into your stack and ready to scale.',
    cta: 'Talk about observability of my AI system',
  },
  related: [
    { label: 'Orchestrating AI agents in production', to: '/blog/orquestracao-agentes-ia-producao' },
    { label: 'Continuous bot evaluation: from manual to automated eval', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Observability and reliability', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'llm-observability-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Un sistema con LLM en producción sin observabilidad es una caja negra que pagas sin entender. ¿La respuesta empeoró? No sabes decir. ¿La factura se triplicó? No sabes qué ruta. ¿El bot se puso lento? No sabes si es la cola, el modelo o la tool. A diferencia de un servicio tradicional, donde bastan latencia y tasa de error, un LLM tiene tres ejes que hay que observar juntos: latencia (cuánto tarda), costo (cuánto gasta en tokens) y calidad (si la respuesta sirve). Observar solo uno engaña: un modelo más barato puede alucinar más, uno más rápido puede costar el doble. Este artículo muestra cómo instrumentar las tres dimensiones sin volverlo un proyecto de plataforma: el modelo de tracing correcto para LLM, cómo calcular el costo por llamada de verdad, cómo medir calidad en producción sin gabarito, qué loguear sin filtrar dato sensible y qué alertas evitan la sorpresa de fin de mes. El foco es el mínimo que hace operable el sistema.',
  sections: [
    {
      title: '¿Por qué los tres pilares clásicos no bastan?',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La observabilidad clásica se apoya en logs, métricas y traces, y apunta a latencia, throughput y tasa de error. Eso responde "¿el servicio está arriba?", pero no responde ninguna de las preguntas que importan en un sistema con LLM. Una llamada puede retornar 200 OK, dentro del SLA de latencia, y aun así haber alucinado la respuesta, rechazado indebidamente o gastado tres veces más tokens de lo esperado. El éxito HTTP no dice nada sobre el éxito semántico.',
        },
        {
          type: 'paragraph',
          value:
            'Un LLM necesita tres ejes observados en conjunto, porque se mueven en direcciones opuestas. Cambiar de modelo para reducir costo puede tumbar la calidad. Acortar el prompt para reducir latencia puede quitar contexto y aumentar el retrabajo. Cada decisión mueve los tres a la vez, y sin medir los tres optimizas un número y degradas otro sin darte cuenta. La tabla de abajo muestra lo que cada eje exige que la observabilidad tradicional no entrega.',
        },
        {
          type: 'table',
          columns: ['Eje', 'Qué mide', 'Señal que importa', 'Por qué el APM clásico no lo capta'],
          rows: [
            [
              'Latencia',
              'Tiempo por fase: cola, prompt, modelo, tools, streaming',
              'Percentil p95 por ruta, no el promedio',
              'No separa tiempo de modelo de tiempo de tool',
            ],
            [
              'Costo',
              'Tokens de entrada y salida por llamada, convertidos a moneda',
              'Costo por ruta y por usuario, tendencia diaria',
              'No existe el concepto de token en el APM estándar',
            ],
            [
              'Calidad',
              'Si la respuesta es correcta, útil y en el formato esperado',
              'Tasa de alucinación, rechazo, formato inválido',
              'HTTP 200 no significa buena respuesta',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La regla práctica: nunca mires un eje aislado. Un dashboard de LLM útil muestra latencia, costo y calidad lado a lado por ruta, para que cualquier cambio revele el trade-off de inmediato. Mejorar el promedio sin mirar el p95, o bajar costo sin mirar calidad, es cambiar un problema visible por uno invisible.',
        },
      ],
    },
    {
      title: 'El modelo de tracing correcto para LLM',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El tracing distribuido responde "¿dónde se gastó el tiempo?", y en un sistema con LLM la respuesta casi nunca es obvia. Una única petición del usuario puede disparar un retrieval, una o más llamadas al modelo, varias tools y un paso de posprocesamiento. Sin span por fase, todo se vuelve un bloque único de latencia y no sabes si el cuello de botella es el modelo, la búsqueda vectorial o la API externa que llamó la tool. El modelo mental es el mismo del tracing de microservicio, pero los atributos del span son específicos de LLM.',
        },
        {
          type: 'code',
          value: `// observability/trace.js
// Envuelve una llamada de LLM en un span con atributos especificos:
// tokens, costo, modelo y fase. El span es la unidad que agregas despues.

export async function tracedCompletion(tracer, { route, model }, call) {
  const span = tracer.startSpan('llm.completion', {
    attributes: { route, model },
  });

  try {
    const res = await call(); // llama al proveedor (ej.: Anthropic)

    // Atributos que hacen util el span para costo y calidad,
    // no solo para latencia.
    span.setAttributes({
      'llm.tokens.input': res.usage.input_tokens,
      'llm.tokens.output': res.usage.output_tokens,
      'llm.cost.usd': estimateCost(model, res.usage),
      'llm.finish_reason': res.stop_reason, // end_turn, max_tokens, tool_use...
      'llm.cache.read': res.usage.cache_read_input_tokens ?? 0,
    });
    span.setStatus({ code: 'OK' });
    return res;
  } catch (err) {
    // Un error del proveedor tambien es senal de calidad y costo.
    span.recordException(err);
    span.setStatus({ code: 'ERROR', message: err.message });
    throw err;
  } finally {
    span.end(); // cierra el span aun en error, si no el trace queda roto
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle que la mayoría olvida: registrar el finish_reason. Un pico de respuestas terminando en max_tokens indica prompt o salida mal dimensionados, costo innecesario y respuesta cortada, todo invisible si solo miras latencia. Y propagar un traceId único desde el inicio de la petición hasta la respuesta final amarra retrieval, modelo y tools en el mismo trace, permitiendo abrir una queja de usuario y ver el árbol entero de esa conversación.',
        },
      ],
    },
    {
      title: 'Costo: el eje que nadie mide hasta que llega la factura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El costo de LLM es la métrica más fácil de ignorar y la más cara de ignorar. No aparece en el APM, no dispara error, y crece en silencio hasta la factura de fin de mes. La base es simple: cada llamada tiene tokens de entrada y de salida, cada uno con un precio por millón de tokens que difiere por modelo. El error común es medir el costo agregado de la cuenta entera, cuando lo que importa es el costo por ruta y por usuario, porque ahí descubres qué funcionalidad está cara y qué usuario está abusando.',
        },
        {
          type: 'code',
          value: `// observability/cost.js
// Calcula el costo de una llamada a partir de los tokens y la tabla de precios.
// Los precios son por millon de tokens; entrada y salida tienen valores distintos.
// Los tokens leidos del cache cuestan una fraccion del precio de entrada.

const PRICING = {
  // valores ilustrativos, por millon de tokens (input, output, cacheRead)
  'fast':     { input: 0.8,  output: 4.0,  cacheRead: 0.08 },
  'balanced': { input: 3.0,  output: 15.0, cacheRead: 0.30 },
};

export function estimateCost(model, usage) {
  const p = PRICING[model];
  if (!p) return 0; // modelo desconocido: no adivina, senala despues

  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cached = usage.cache_read_input_tokens ?? 0;

  // Los tokens cacheados no pagan precio de entrada completo: cuenta aparte.
  const billableInput = Math.max(input - cached, 0);

  const usd =
    (billableInput / 1_000_000) * p.input +
    (cached / 1_000_000) * p.cacheRead +
    (output / 1_000_000) * p.output;

  return Number(usd.toFixed(6)); // precision suficiente para sumar miles
}`,
        },
        {
          type: 'paragraph',
          value:
            'Con el costo por llamada calculado y anexado al span, el resto es agregación: suma por ruta para hallar la funcionalidad cara, por usuario para hallar abuso, por día para ver la tendencia. El prompt cache es la mayor palanca de costo en prompts largos y repetidos (system prompt fijo, contexto reaprovechado), y solo aparece si mides los tokens de cache aparte. Sin observar el costo por dimensión, la única palanca que queda es cortar features después del susto.',
        },
      ],
    },
    {
      title: 'Calidad en producción: medir sin gabarito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La calidad es el eje más difícil, porque en producción rara vez tienes la respuesta correcta para comparar. A diferencia del eval offline, donde existe un dataset con gabarito, en producción la respuesta acaba de generarse y nadie sabe si es correcta. La salida es medir señales indirectas de calidad que no necesitan gabarito, combinadas: ninguna es definitiva sola, pero juntas dibujan un retrato confiable de degradación.',
        },
        {
          type: 'list',
          items: [
            'Validación de formato: si la respuesta debería ser JSON con un schema, valídala y cuenta cuántas fallan. Una tasa de formato inválido en alza es degradación medible sin gabarito.',
            'Tasa de rechazo: cuántas respuestas fueron "no puedo ayudar" o similar. Un rechazo en alza puede ser prompt roto, guardrail agresivo o cambio de modelo.',
            'finish_reason por max_tokens: respuestas cortadas por el límite de salida son calidad degradada y costo desperdiciado a la vez.',
            'Señales del usuario: reintento en la misma sesión, reformulación de la pregunta, thumbs down, escalada a un humano. Son el eval humano gratis, si los capturas.',
            'LLM como juez muestreado: corre un modelo evaluador sobre una muestra del tráfico real (1 a 5 por ciento), puntuando fidelidad y utilidad, para tener un número continuo de calidad sin evaluar todo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La técnica que más rinde es el LLM como juez muestreado: no evalúas el cien por ciento del tráfico (caro y lento), evalúas una porción representativa y tratas el resultado como una métrica de calidad que sube y baja a lo largo del tiempo. Combinado con validación de formato y señales del usuario, esto convierte la calidad de "creo que empeoró" en una línea del dashboard que dispara alerta cuando cae. Ninguna señal es perfecta, pero el conjunto basta para saber que algo cambió antes de que el cliente se queje.',
        },
      ],
    },
    {
      title: 'Qué loguear sin filtrar dato sensible',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Loguear prompt y respuesta es lo que hace posible la depuración: sin ver qué entró y qué salió, todo bug de calidad se vuelve adivinanza. Pero un prompt de producción carga dato del usuario (nombre, teléfono, documento, historial), y volcar eso crudo en el log es un incidente de privacidad esperando pasar. El equilibrio es loguear lo suficiente para depurar, con redacción de datos sensibles antes de persistir, y retención corta para el contenido crudo.',
        },
        {
          type: 'code',
          value: `// observability/redact.js
// Redacta datos sensibles del prompt/respuesta ANTES de loguear.
// Mantiene el texto legible para depurar, sin persistir PII cruda.

const PATTERNS = [
  { name: 'email', re: /[\\w.+-]+@[\\w-]+\\.[\\w.-]+/g, tag: '[EMAIL]' },
  { name: 'phone', re: /\\b\\d{2}[\\s-]?\\d{4,5}[\\s-]?\\d{4}\\b/g, tag: '[PHONE]' },
  { name: 'cpf',   re: /\\b\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}\\b/g, tag: '[CPF]' },
  { name: 'card',  re: /\\b(?:\\d[ -]?){13,16}\\b/g, tag: '[CARD]' },
];

export function redact(text) {
  if (typeof text !== 'string') return text;
  return PATTERNS.reduce((acc, p) => acc.replace(p.re, p.tag), text);
}

// El log guarda metadatos siempre, y el contenido redactado con retencion corta.
export function buildLogRecord({ traceId, route, model, usage, prompt, output }) {
  return {
    traceId,
    route,
    model,
    tokens: { input: usage.input_tokens, output: usage.output_tokens },
    // Contenido redactado: util para depurar, seguro para retener poco tiempo.
    prompt: redact(prompt),
    output: redact(output),
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'La separación que importa: los metadatos (tokens, costo, latencia, ruta, finish_reason) son baratos y seguros, así que guárdalos por mucho tiempo para análisis de tendencia. El contenido crudo (prompt y respuesta) es caro y sensible, así que redáctalo siempre y retenlo poco (días, no meses), lo suficiente para depurar el incidente reciente. Nunca loguees clave de API, token de sesión o credencial, y trata el log de LLM con el mismo cuidado que cualquier store de dato personal, porque es exactamente eso lo que es.',
        },
      ],
    },
    {
      title: 'Alertas que evitan la sorpresa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El dashboard lo miras cuando te acuerdas; la alerta te avisa cuando no estás mirando. El objetivo de las alertas de LLM es el mismo de los guardrails: convertir un problema silencioso (costo subiendo, calidad cayendo) en un evento accionable antes de que se vuelva pérdida o queja. El error es alertar solo en error técnico (5xx, timeout) e ignorar las señales que son únicas de LLM.',
        },
        {
          type: 'ordered',
          items: [
            'Costo por día por encima del presupuesto esperado, o costo por ruta subiendo más de X por ciento semana a semana: capta abuso, loops y regresión de prompt antes de la factura.',
            'Tasa de formato inválido o de rechazo por encima de la línea base: señal directa de que el prompt o el modelo cambió de comportamiento.',
            'p95 de latencia por ruta reventando el SLA, separando tiempo de modelo de tiempo de tool, para saber dónde actuar.',
            'Proporción de respuestas terminando en max_tokens subiendo: prompt o límite de salida mal dimensionados, generando costo y respuesta cortada.',
            'Score del juez muestreado cayendo por debajo del umbral: la métrica de calidad continua que dispara antes de que el cliente lo note.',
          ],
        },
        {
          type: 'diagram',
          value: `Flujo de observabilidad de una llamada de LLM

  petición del usuario
        |
        v
  [ trace inicia: traceId ]
        |
        +--> span: retrieval        120ms
        +--> span: llm.completion    info: tokens, costo, finish_reason
        |         840ms
        +--> span: tool getStatus    retry=0   210ms
        |
        v
  [ trace cierra ]
        |
        +--> métricas agregadas:  costo/ruta   p95/ruta   calidad/ruta
        +--> log redactado:       prompt/output (retención corta)
        +--> alertas:             costo, formato, rechazo, latencia, juez`,
        },
        {
          type: 'paragraph',
          value:
            'Cada alerta debe apuntar a la ruta y al trace, no a un número global. "El costo subió" no ayuda; "el costo de la ruta /soporte subió 40 por ciento, mira el trace abc123" lleva directo a la causa. La observabilidad solo rinde cuando acorta el camino del síntoma al origen, y una alerta sin contexto es solo un número más que el equipo aprende a ignorar.',
        },
      ],
    },
    {
      title: 'Empezar pequeño sin volverlo un proyecto de plataforma',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La trampa es creer que la observabilidad de LLM exige una plataforma entera antes de dar valor. No la exige. Un middleware que envuelve la llamada, calcula costo, mide latencia por fase y loguea redactado ya entrega el noventa por ciento del valor en pocas centenas de líneas. El camino es agregar por capas, en orden de retorno.',
        },
        {
          type: 'list',
          items: [
            'Empieza por el costo por llamada: es lo más barato de instrumentar y lo que más sorprende, porque nadie sabía el número real por ruta.',
            'Agrega el span por fase justo después: separa tiempo de modelo de tiempo de tool y retrieval, lo que vuelve accionable la latencia.',
            'Enciende el log redactado temprano, con retención corta: es lo que permite depurar el primer bug de calidad sin volverse riesgo de privacidad.',
            'Instrumenta las señales de calidad baratas (formato inválido, rechazo, max_tokens) antes del juez muestreado, que es más caro de montar.',
            'Pon las alertas al final, cuando ya tienes línea base: alertar sin baseline genera ruido, alertar con baseline genera acción.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La diferencia entre operar un sistema con LLM y rezarle está en ver los tres ejes juntos: cuánto tarda, cuánto cuesta y si sirve. Quien instrumenta esto temprano descubre la regresión de calidad en un dashboard y el pico de costo en una alerta; quien lo deja para después descubre ambos en el lugar equivocado, el primero en la queja del cliente y el segundo en la factura.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Necesito una plataforma dedicada de observabilidad de LLM?',
      answer:
        'No para empezar. Un middleware que envuelve la llamada del modelo, calcula costo por tokens, emite un span por fase y loguea con redacción cabe en pocas centenas de líneas y entrega la mayor parte del valor. Las plataformas dedicadas ayudan cuando el volumen crece y quieres visualización de trace lista y eval integrado, pero adoptar una demasiado pronto agrega costo y dependencia antes de que entiendas qué necesitas medir. Instrumenta los tres ejes primero; elige la herramienta después, sabiendo qué resuelve.',
    },
    {
      question: '¿Cómo mido calidad si no tengo la respuesta correcta en producción?',
      answer:
        'Con señales indirectas combinadas, ninguna definitiva sola: tasa de formato inválido, tasa de rechazo, respuestas cortadas por max_tokens, señales del usuario (reintento, reformulación, thumbs down, escalada) y un LLM como juez corriendo sobre una muestra del tráfico (1 a 5 por ciento). Cada uno es un proxy imperfecto, pero el conjunto se vuelve una métrica de calidad continua que sube y baja a lo largo del tiempo y dispara alerta cuando cae, permitiendo detectar degradación antes de que el cliente se queje.',
    },
    {
      question: '¿Cómo calculo el costo real de cada llamada?',
      answer:
        'Cada respuesta del proveedor trae el número de tokens de entrada y de salida; multiplica cada uno por el precio por millón de tokens del modelo (entrada y salida tienen precios distintos) y suma. Los tokens leídos del prompt cache cuestan una fracción del precio de entrada, así que cuéntalos aparte. Anexa ese costo al span de la llamada y agrega por ruta, por usuario y por día. El error común es mirar solo el total de la cuenta; el valor está en saber qué ruta y qué usuario generan el gasto.',
    },
  ],
  conclusion: {
    title: 'La observabilidad es lo que convierte un sistema de LLM de caja negra en operación',
    description:
      'Tracing por fase, costo por llamada, señales de calidad y alertas con contexto son el mínimo para operar LLM sin sorpresa de factura ni regresión invisible. Puedo instrumentar estas tres dimensiones en tu producto, del middleware al dashboard, integradas a tu stack y listas para escalar.',
    cta: 'Hablar sobre observabilidad de mi sistema de IA',
  },
  related: [
    { label: 'Orquestación de agentes de IA en producción', to: '/blog/orquestracao-agentes-ia-producao' },
    { label: 'Evaluación continua de bots: del eval manual al automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Observabilidad y confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
    // slug de servico e o mesmo nos 3 idiomas
  ],
  repo: { name: 'llm-observability-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
