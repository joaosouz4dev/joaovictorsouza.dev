// Conteudo do artigo: observabilidade de LLM (tracing, custo e qualidade).
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Middleware minimo de observabilidade para chamadas de LLM: envelopa cada chamada com trace e span, calcula custo por tokens de entrada e saida, mede latencia por fase (fila, modelo, tools), registra prompt e resposta com redacao de dados sensiveis e exporta metricas agregadas por rota e por modelo.',
  en: 'Minimal observability middleware for LLM calls: wraps every call with a trace and span, computes cost from input and output tokens, measures latency per phase (queue, model, tools), records prompt and response with sensitive-data redaction and exports aggregated metrics per route and per model.',
  es: 'Middleware minimo de observabilidad para llamadas de LLM: envuelve cada llamada con trace y span, calcula el costo por tokens de entrada y salida, mide la latencia por fase (cola, modelo, tools), registra prompt y respuesta con redaccion de datos sensibles y exporta metricas agregadas por ruta y por modelo.',
};

const repoUrl = 'https://github.com/joaosouz4dev/llm-observability-mini';

const pt = {
  intro:
    'Sistema com LLM em producao sem observabilidade e uma caixa preta que voce paga sem entender. A resposta piorou? Nao sabe dizer. A fatura triplicou? Nao sabe qual rota. O bot ficou lento? Nao sabe se e a fila, o modelo ou a tool. Diferente de um servico tradicional, onde bastam latencia e taxa de erro, um LLM tem tres eixos que precisam ser observados juntos: latencia (quanto demora), custo (quanto gasta em tokens) e qualidade (se a resposta presta). Observar so um deles engana: um modelo mais barato pode alucinar mais, um mais rapido pode custar o dobro. Este artigo mostra como instrumentar as tres dimensoes sem virar um projeto de plataforma: o modelo de tracing certo para LLM, como calcular custo por chamada de verdade, como medir qualidade em producao sem gabarito, o que logar sem vazar dado sensivel e quais alertas evitam a surpresa no fim do mes. O foco e o minimo que torna o sistema operavel.',
  sections: [
    {
      title: 'Por que os tres pilares tradicionais nao bastam',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A observabilidade classica se apoia em logs, metricas e traces, e mira latencia, throughput e taxa de erro. Isso responde "o servico esta de pe?", mas nao responde nenhuma das perguntas que importam num sistema com LLM. Uma chamada pode retornar 200 OK, dentro do SLA de latencia, e ainda assim ter alucinado a resposta, recusado indevidamente ou gasto tres vezes mais tokens do que o esperado. O sucesso HTTP nao diz nada sobre o sucesso semantico.',
        },
        {
          type: 'paragraph',
          value:
            'Um LLM precisa de tres eixos observados em conjunto, porque eles se movem em direcoes opostas. Trocar de modelo para reduzir custo pode derrubar a qualidade. Encurtar o prompt para reduzir latencia pode remover contexto e aumentar o retrabalho. Cada decisao mexe nos tres ao mesmo tempo, e sem medir os tres voce otimiza um numero e degrada outro sem perceber. A tabela abaixo mostra o que cada eixo exige que a observabilidade tradicional nao entrega.',
        },
        {
          type: 'table',
          columns: ['Eixo', 'O que mede', 'Sinal que importa', 'Por que APM classico nao pega'],
          rows: [
            [
              'Latencia',
              'Tempo por fase: fila, prompt, modelo, tools, streaming',
              'Percentil p95 por rota, nao a media',
              'Nao separa tempo de modelo de tempo de tool',
            ],
            [
              'Custo',
              'Tokens de entrada e saida por chamada, convertidos em moeda',
              'Custo por rota e por usuario, tendencia diaria',
              'Nao existe o conceito de token no APM padrao',
            ],
            [
              'Qualidade',
              'A resposta esta correta, util e no formato esperado',
              'Taxa de alucinacao, recusa, formato invalido',
              'HTTP 200 nao significa resposta boa',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A regra pratica: nunca olhe um eixo isolado. Um dashboard de LLM util mostra latencia, custo e qualidade lado a lado por rota, para que qualquer mudanca revele o trade-off imediatamente. Melhorar a media sem olhar o p95, ou baixar custo sem olhar qualidade, e trocar um problema visivel por um invisivel.',
        },
      ],
    },
    {
      title: 'O modelo de tracing certo para LLM',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O tracing distribuido resolve a pergunta "onde o tempo foi gasto?", e num sistema com LLM a resposta quase nunca e obvia. Uma unica requisicao do usuario pode disparar um retrieval, uma ou mais chamadas ao modelo, varias tools e um passo de pos-processamento. Sem span por fase, tudo vira um bloco unico de latencia e voce nao sabe se o gargalo e o modelo, a busca vetorial ou a API externa que a tool chamou. O modelo mental e o mesmo do tracing de microservico, mas os atributos do span sao especificos de LLM.',
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
            'O detalhe que a maioria esquece: registrar o finish_reason. Um pico de respostas terminando em max_tokens indica prompt ou saida mal dimensionados, custo desnecessario e resposta cortada, tudo invisivel se voce so olha latencia. E propagar um traceId unico do inicio da requisicao ate a resposta final amarra retrieval, modelo e tools no mesmo trace, permitindo abrir uma reclamacao de usuario e ver a arvore inteira daquela conversa.',
        },
      ],
    },
    {
      title: 'Custo: o eixo que ninguem mede ate a fatura chegar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Custo de LLM e a metrica mais facil de ignorar e a mais cara de ignorar. Ele nao aparece no APM, nao dispara erro, e cresce silenciosamente ate a fatura do fim do mes. A base e simples: cada chamada tem tokens de entrada e de saida, cada um com um preco por milhao de tokens que difere por modelo. O erro comum e medir custo agregado da conta inteira, quando o que importa e custo por rota e por usuario, porque e ali que voce descobre qual funcionalidade esta cara e qual usuario esta abusando.',
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
            'Com o custo por chamada calculado e anexado ao span, o resto e agregacao: some por rota para achar a funcionalidade cara, por usuario para achar abuso, por dia para ver a tendencia. O prompt cache e o maior alavanca de custo em prompts longos e repetidos (system prompt fixo, contexto reaproveitado), e so aparece se voce medir os tokens de cache separado. Sem observar custo por dimensao, a unica alavanca que sobra e cortar features depois do susto.',
        },
      ],
    },
    {
      title: 'Qualidade em producao: medir sem gabarito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Qualidade e o eixo mais dificil, porque em producao voce raramente tem a resposta certa para comparar. Diferente do eval offline, onde existe um dataset com gabarito, em producao a resposta acabou de ser gerada e ninguem sabe se esta correta. A saida e medir sinais indiretos de qualidade que nao precisam de gabarito, combinados: nenhum e definitivo sozinho, mas juntos desenham um retrato confiavel de degradacao.',
        },
        {
          type: 'list',
          items: [
            'Validacao de formato: se a resposta deveria ser JSON com um schema, valide e conte quantas falham. Taxa de formato invalido subindo e degradacao mensuravel sem gabarito.',
            'Taxa de recusa: quantas respostas foram "nao posso ajudar" ou similar. Recusa subindo pode ser prompt quebrado, guardrail agressivo ou mudanca de modelo.',
            'finish_reason por max_tokens: respostas cortadas por limite de saida sao qualidade degradada e custo desperdicado ao mesmo tempo.',
            'Sinais do usuario: retentativa na mesma sessao, reformulacao da pergunta, thumbs down, escalada para humano. Sao o eval humano de graca, se voce os captura.',
            'LLM como juiz amostrado: rode um modelo avaliador sobre uma amostra do trafego real (1 a 5 por cento), pontuando fidelidade e utilidade, para ter um numero continuo de qualidade sem avaliar tudo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A tecnica que mais rende e o LLM como juiz amostrado: voce nao avalia cem por cento do trafego (caro e lento), avalia uma fatia representativa e trata o resultado como uma metrica de qualidade que sobe e desce ao longo do tempo. Combinado com validacao de formato e sinais do usuario, isso transforma qualidade de "acho que piorou" em uma linha no dashboard que dispara alerta quando cai. Nenhum sinal e perfeito, mas o conjunto e o suficiente para saber que algo mudou antes do cliente reclamar.',
        },
      ],
    },
    {
      title: 'O que logar sem vazar dado sensivel',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Logar prompt e resposta e o que torna a depuracao possivel: sem ver o que entrou e o que saiu, todo bug de qualidade vira adivinhacao. Mas prompt de producao carrega dado do usuario (nome, telefone, documento, historico), e jogar isso cru no log e um incidente de privacidade esperando para acontecer. O equilibrio e logar o suficiente para depurar, com redacao de dados sensiveis antes de persistir, e retencao curta para o conteudo bruto.',
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
            'A separacao que importa: metadados (tokens, custo, latencia, rota, finish_reason) sao baratos e seguros, entao guarde por muito tempo para analise de tendencia. Conteudo bruto (prompt e resposta) e caro e sensivel, entao redija sempre e retenha por pouco (dias, nao meses), o suficiente para depurar o incidente recente. Nunca logue chave de API, token de sessao ou credencial, e trate o log de LLM com o mesmo cuidado de qualquer store de dado pessoal, porque e exatamente isso que ele e.',
        },
      ],
    },
    {
      title: 'Alertas que evitam a surpresa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Dashboard voce olha quando lembra; alerta te avisa quando voce nao esta olhando. O objetivo dos alertas de LLM e o mesmo dos guardrails: transformar um problema silencioso (custo subindo, qualidade caindo) em um evento acionavel antes de virar prejuizo ou reclamacao. O erro e alertar so em erro tecnico (5xx, timeout) e ignorar os sinais que sao unicos de LLM.',
        },
        {
          type: 'ordered',
          items: [
            'Custo por dia acima do orcamento esperado, ou custo por rota subindo mais de X por cento semana a semana: pega abuso, loop e regressao de prompt antes da fatura.',
            'Taxa de formato invalido ou de recusa acima da linha de base: sinal direto de que o prompt ou o modelo mudou de comportamento.',
            'p95 de latencia por rota estourando o SLA, separando tempo de modelo de tempo de tool, para saber onde agir.',
            'Proporcao de respostas terminando em max_tokens subindo: prompt ou limite de saida mal dimensionados, gerando custo e resposta cortada.',
            'Score do juiz amostrado caindo abaixo do limiar: a metrica de qualidade continua que dispara antes do cliente perceber.',
          ],
        },
        {
          type: 'diagram',
          value: `Fluxo de observabilidade de uma chamada de LLM

  requisicao do usuario
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
        +--> metricas agregadas:  custo/rota   p95/rota   qualidade/rota
        +--> log redigido:        prompt/output (retencao curta)
        +--> alertas:             custo, formato, recusa, latencia, juiz`,
        },
        {
          type: 'paragraph',
          value:
            'Cada alerta deve apontar para a rota e o trace, nao para um numero global. "Custo subiu" nao ajuda; "custo da rota /suporte subiu 40 por cento, veja o trace abc123" leva direto a causa. Observabilidade so vale quando encurta o caminho do sintoma ate a origem, e um alerta sem contexto e so mais um numero que a equipe aprende a ignorar.',
        },
      ],
    },
    {
      title: 'Comecar pequeno sem virar projeto de plataforma',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A armadilha e achar que observabilidade de LLM exige uma plataforma inteira antes de dar valor. Nao exige. Um middleware que envelopa a chamada, calcula custo, mede latencia por fase e loga redigido ja entrega noventa por cento do valor em poucas centenas de linhas. O caminho e adicionar por camadas, na ordem de retorno.',
        },
        {
          type: 'list',
          items: [
            'Comece pelo custo por chamada: e o mais barato de instrumentar e o que mais surpreende, porque ninguem sabia o numero real por rota.',
            'Adicione o span por fase logo depois: separa tempo de modelo de tempo de tool e retrieval, o que torna a latencia acionavel.',
            'Ligue o log redigido cedo, com retencao curta: e o que permite depurar o primeiro bug de qualidade sem virar risco de privacidade.',
            'Instrumente os sinais de qualidade baratos (formato invalido, recusa, max_tokens) antes do juiz amostrado, que e mais caro de montar.',
            'Ponha os alertas por ultimo, quando ja tem linha de base: alertar sem baseline gera ruido, alertar com baseline gera acao.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A diferenca entre operar um sistema com LLM e reza-lo esta em enxergar os tres eixos juntos: quanto demora, quanto custa e se presta. Quem instrumenta isso cedo descobre a regressao de qualidade em um dashboard e o pico de custo em um alerta; quem deixa para depois descobre os dois no lugar errado, o primeiro na reclamacao do cliente e o segundo na fatura.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Preciso de uma plataforma dedicada de observabilidade de LLM?',
      answer:
        'Nao para comecar. Um middleware que envelopa a chamada do modelo, calcula custo por tokens, emite span por fase e loga com redacao cabe em poucas centenas de linhas e entrega a maior parte do valor. Plataformas dedicadas ajudam quando o volume cresce e voce quer visualizacao de trace pronta e eval integrado, mas adotar uma cedo demais adiciona custo e dependencia antes de voce entender o que precisa medir. Instrumente os tres eixos primeiro; escolha a ferramenta depois, sabendo o que ela resolve.',
    },
    {
      question: 'Como meco qualidade se nao tenho a resposta certa em producao?',
      answer:
        'Com sinais indiretos combinados, nenhum definitivo sozinho: taxa de formato invalido, taxa de recusa, respostas cortadas por max_tokens, sinais do usuario (retentativa, reformulacao, thumbs down, escalada) e um LLM como juiz rodando sobre uma amostra do trafego (1 a 5 por cento). Cada um e um proxy imperfeito, mas o conjunto vira uma metrica de qualidade continua que sobe e desce ao longo do tempo e dispara alerta quando cai, permitindo detectar degradacao antes do cliente reclamar.',
    },
    {
      question: 'Como calculo o custo real de cada chamada?',
      answer:
        'Cada resposta do provedor traz o numero de tokens de entrada e de saida; multiplique cada um pelo preco por milhao de tokens do modelo (entrada e saida tem precos diferentes) e some. Tokens lidos do prompt cache custam uma fracao do preco de entrada, entao conte-os a parte. Anexe esse custo ao span da chamada e agregue por rota, por usuario e por dia. O erro comum e olhar so o total da conta; o valor esta em saber qual rota e qual usuario geram o gasto.',
    },
  ],
  conclusion: {
    title: 'Observabilidade e o que transforma um sistema de LLM de caixa preta em operacao',
    description:
      'Tracing por fase, custo por chamada, sinais de qualidade e alertas com contexto sao o minimo para operar LLM sem surpresa de fatura nem regressao invisivel. Posso instrumentar essas tres dimensoes no seu produto, do middleware ao dashboard, integradas ao seu stack e prontas para escalar.',
    cta: 'Falar sobre observabilidade do meu sistema de IA',
  },
  related: [
    { label: 'Orquestracao de agentes de IA em producao', to: '/blog/orquestracao-agentes-ia-producao' },
    { label: 'Avaliacao continua de bots: do eval manual ao automatico', to: '/blog/avaliacao-continua-bots-eval-automatico' },
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
    'Un sistema con LLM en produccion sin observabilidad es una caja negra que pagas sin entender. La respuesta empeoro? No sabes decir. La factura se triplico? No sabes que ruta. El bot se puso lento? No sabes si es la cola, el modelo o la tool. A diferencia de un servicio tradicional, donde bastan latencia y tasa de error, un LLM tiene tres ejes que hay que observar juntos: latencia (cuanto tarda), costo (cuanto gasta en tokens) y calidad (si la respuesta sirve). Observar solo uno engana: un modelo mas barato puede alucinar mas, uno mas rapido puede costar el doble. Este articulo muestra como instrumentar las tres dimensiones sin volverlo un proyecto de plataforma: el modelo de tracing correcto para LLM, como calcular el costo por llamada de verdad, como medir calidad en produccion sin gabarito, que loguear sin filtrar dato sensible y que alertas evitan la sorpresa de fin de mes. El foco es el minimo que hace operable el sistema.',
  sections: [
    {
      title: 'Por que los tres pilares clasicos no bastan',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La observabilidad clasica se apoya en logs, metricas y traces, y apunta a latencia, throughput y tasa de error. Eso responde "el servicio esta arriba?", pero no responde ninguna de las preguntas que importan en un sistema con LLM. Una llamada puede retornar 200 OK, dentro del SLA de latencia, y aun asi haber alucinado la respuesta, rechazado indebidamente o gastado tres veces mas tokens de lo esperado. El exito HTTP no dice nada sobre el exito semantico.',
        },
        {
          type: 'paragraph',
          value:
            'Un LLM necesita tres ejes observados en conjunto, porque se mueven en direcciones opuestas. Cambiar de modelo para reducir costo puede tumbar la calidad. Acortar el prompt para reducir latencia puede quitar contexto y aumentar el retrabajo. Cada decision mueve los tres a la vez, y sin medir los tres optimizas un numero y degradas otro sin darte cuenta. La tabla de abajo muestra lo que cada eje exige que la observabilidad tradicional no entrega.',
        },
        {
          type: 'table',
          columns: ['Eje', 'Que mide', 'Senal que importa', 'Por que el APM clasico no lo capta'],
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
              'No existe el concepto de token en el APM estandar',
            ],
            [
              'Calidad',
              'Si la respuesta es correcta, util y en el formato esperado',
              'Tasa de alucinacion, rechazo, formato invalido',
              'HTTP 200 no significa buena respuesta',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La regla practica: nunca mires un eje aislado. Un dashboard de LLM util muestra latencia, costo y calidad lado a lado por ruta, para que cualquier cambio revele el trade-off de inmediato. Mejorar el promedio sin mirar el p95, o bajar costo sin mirar calidad, es cambiar un problema visible por uno invisible.',
        },
      ],
    },
    {
      title: 'El modelo de tracing correcto para LLM',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El tracing distribuido responde "donde se gasto el tiempo?", y en un sistema con LLM la respuesta casi nunca es obvia. Una unica peticion del usuario puede disparar un retrieval, una o mas llamadas al modelo, varias tools y un paso de posprocesamiento. Sin span por fase, todo se vuelve un bloque unico de latencia y no sabes si el cuello de botella es el modelo, la busqueda vectorial o la API externa que llamo la tool. El modelo mental es el mismo del tracing de microservicio, pero los atributos del span son especificos de LLM.',
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
            'El detalle que la mayoria olvida: registrar el finish_reason. Un pico de respuestas terminando en max_tokens indica prompt o salida mal dimensionados, costo innecesario y respuesta cortada, todo invisible si solo miras latencia. Y propagar un traceId unico desde el inicio de la peticion hasta la respuesta final amarra retrieval, modelo y tools en el mismo trace, permitiendo abrir una queja de usuario y ver el arbol entero de esa conversacion.',
        },
      ],
    },
    {
      title: 'Costo: el eje que nadie mide hasta que llega la factura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El costo de LLM es la metrica mas facil de ignorar y la mas cara de ignorar. No aparece en el APM, no dispara error, y crece en silencio hasta la factura de fin de mes. La base es simple: cada llamada tiene tokens de entrada y de salida, cada uno con un precio por millon de tokens que difiere por modelo. El error comun es medir el costo agregado de la cuenta entera, cuando lo que importa es el costo por ruta y por usuario, porque ahi descubres que funcionalidad esta cara y que usuario esta abusando.',
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
            'Con el costo por llamada calculado y anexado al span, el resto es agregacion: suma por ruta para hallar la funcionalidad cara, por usuario para hallar abuso, por dia para ver la tendencia. El prompt cache es la mayor palanca de costo en prompts largos y repetidos (system prompt fijo, contexto reaprovechado), y solo aparece si mides los tokens de cache aparte. Sin observar el costo por dimension, la unica palanca que queda es cortar features despues del susto.',
        },
      ],
    },
    {
      title: 'Calidad en produccion: medir sin gabarito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La calidad es el eje mas dificil, porque en produccion rara vez tienes la respuesta correcta para comparar. A diferencia del eval offline, donde existe un dataset con gabarito, en produccion la respuesta acaba de generarse y nadie sabe si es correcta. La salida es medir senales indirectas de calidad que no necesitan gabarito, combinadas: ninguna es definitiva sola, pero juntas dibujan un retrato confiable de degradacion.',
        },
        {
          type: 'list',
          items: [
            'Validacion de formato: si la respuesta deberia ser JSON con un schema, validala y cuenta cuantas fallan. Una tasa de formato invalido en alza es degradacion medible sin gabarito.',
            'Tasa de rechazo: cuantas respuestas fueron "no puedo ayudar" o similar. Un rechazo en alza puede ser prompt roto, guardrail agresivo o cambio de modelo.',
            'finish_reason por max_tokens: respuestas cortadas por el limite de salida son calidad degradada y costo desperdiciado a la vez.',
            'Senales del usuario: reintento en la misma sesion, reformulacion de la pregunta, thumbs down, escalada a un humano. Son el eval humano gratis, si los capturas.',
            'LLM como juez muestreado: corre un modelo evaluador sobre una muestra del trafico real (1 a 5 por ciento), puntuando fidelidad y utilidad, para tener un numero continuo de calidad sin evaluar todo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tecnica que mas rinde es el LLM como juez muestreado: no evaluas el cien por ciento del trafico (caro y lento), evaluas una porcion representativa y tratas el resultado como una metrica de calidad que sube y baja a lo largo del tiempo. Combinado con validacion de formato y senales del usuario, esto convierte la calidad de "creo que empeoro" en una linea del dashboard que dispara alerta cuando cae. Ninguna senal es perfecta, pero el conjunto basta para saber que algo cambio antes de que el cliente se queje.',
        },
      ],
    },
    {
      title: 'Que loguear sin filtrar dato sensible',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Loguear prompt y respuesta es lo que hace posible la depuracion: sin ver que entro y que salio, todo bug de calidad se vuelve adivinanza. Pero un prompt de produccion carga dato del usuario (nombre, telefono, documento, historial), y volcar eso crudo en el log es un incidente de privacidad esperando pasar. El equilibrio es loguear lo suficiente para depurar, con redaccion de datos sensibles antes de persistir, y retencion corta para el contenido crudo.',
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
            'La separacion que importa: los metadatos (tokens, costo, latencia, ruta, finish_reason) son baratos y seguros, asi que guardalos por mucho tiempo para analisis de tendencia. El contenido crudo (prompt y respuesta) es caro y sensible, asi que redactalo siempre y retenlo poco (dias, no meses), lo suficiente para depurar el incidente reciente. Nunca loguees clave de API, token de sesion o credencial, y trata el log de LLM con el mismo cuidado que cualquier store de dato personal, porque es exactamente eso lo que es.',
        },
      ],
    },
    {
      title: 'Alertas que evitan la sorpresa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El dashboard lo miras cuando te acuerdas; la alerta te avisa cuando no estas mirando. El objetivo de las alertas de LLM es el mismo de los guardrails: convertir un problema silencioso (costo subiendo, calidad cayendo) en un evento accionable antes de que se vuelva perdida o queja. El error es alertar solo en error tecnico (5xx, timeout) e ignorar las senales que son unicas de LLM.',
        },
        {
          type: 'ordered',
          items: [
            'Costo por dia por encima del presupuesto esperado, o costo por ruta subiendo mas de X por ciento semana a semana: capta abuso, loops y regresion de prompt antes de la factura.',
            'Tasa de formato invalido o de rechazo por encima de la linea base: senal directa de que el prompt o el modelo cambio de comportamiento.',
            'p95 de latencia por ruta reventando el SLA, separando tiempo de modelo de tiempo de tool, para saber donde actuar.',
            'Proporcion de respuestas terminando en max_tokens subiendo: prompt o limite de salida mal dimensionados, generando costo y respuesta cortada.',
            'Score del juez muestreado cayendo por debajo del umbral: la metrica de calidad continua que dispara antes de que el cliente lo note.',
          ],
        },
        {
          type: 'diagram',
          value: `Flujo de observabilidad de una llamada de LLM

  peticion del usuario
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
        +--> metricas agregadas:  costo/ruta   p95/ruta   calidad/ruta
        +--> log redactado:       prompt/output (retencion corta)
        +--> alertas:             costo, formato, rechazo, latencia, juez`,
        },
        {
          type: 'paragraph',
          value:
            'Cada alerta debe apuntar a la ruta y al trace, no a un numero global. "El costo subio" no ayuda; "el costo de la ruta /soporte subio 40 por ciento, mira el trace abc123" lleva directo a la causa. La observabilidad solo rinde cuando acorta el camino del sintoma al origen, y una alerta sin contexto es solo un numero mas que el equipo aprende a ignorar.',
        },
      ],
    },
    {
      title: 'Empezar pequeno sin volverlo un proyecto de plataforma',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La trampa es creer que la observabilidad de LLM exige una plataforma entera antes de dar valor. No la exige. Un middleware que envuelve la llamada, calcula costo, mide latencia por fase y loguea redactado ya entrega el noventa por ciento del valor en pocas centenas de lineas. El camino es agregar por capas, en orden de retorno.',
        },
        {
          type: 'list',
          items: [
            'Empieza por el costo por llamada: es lo mas barato de instrumentar y lo que mas sorprende, porque nadie sabia el numero real por ruta.',
            'Agrega el span por fase justo despues: separa tiempo de modelo de tiempo de tool y retrieval, lo que vuelve accionable la latencia.',
            'Enciende el log redactado temprano, con retencion corta: es lo que permite depurar el primer bug de calidad sin volverse riesgo de privacidad.',
            'Instrumenta las senales de calidad baratas (formato invalido, rechazo, max_tokens) antes del juez muestreado, que es mas caro de montar.',
            'Pon las alertas al final, cuando ya tienes linea base: alertar sin baseline genera ruido, alertar con baseline genera accion.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La diferencia entre operar un sistema con LLM y rezarle esta en ver los tres ejes juntos: cuanto tarda, cuanto cuesta y si sirve. Quien instrumenta esto temprano descubre la regresion de calidad en un dashboard y el pico de costo en una alerta; quien lo deja para despues descubre ambos en el lugar equivocado, el primero en la queja del cliente y el segundo en la factura.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Necesito una plataforma dedicada de observabilidad de LLM?',
      answer:
        'No para empezar. Un middleware que envuelve la llamada del modelo, calcula costo por tokens, emite un span por fase y loguea con redaccion cabe en pocas centenas de lineas y entrega la mayor parte del valor. Las plataformas dedicadas ayudan cuando el volumen crece y quieres visualizacion de trace lista y eval integrado, pero adoptar una demasiado pronto agrega costo y dependencia antes de que entiendas que necesitas medir. Instrumenta los tres ejes primero; elige la herramienta despues, sabiendo que resuelve.',
    },
    {
      question: 'Como mido calidad si no tengo la respuesta correcta en produccion?',
      answer:
        'Con senales indirectas combinadas, ninguna definitiva sola: tasa de formato invalido, tasa de rechazo, respuestas cortadas por max_tokens, senales del usuario (reintento, reformulacion, thumbs down, escalada) y un LLM como juez corriendo sobre una muestra del trafico (1 a 5 por ciento). Cada uno es un proxy imperfecto, pero el conjunto se vuelve una metrica de calidad continua que sube y baja a lo largo del tiempo y dispara alerta cuando cae, permitiendo detectar degradacion antes de que el cliente se queje.',
    },
    {
      question: 'Como calculo el costo real de cada llamada?',
      answer:
        'Cada respuesta del proveedor trae el numero de tokens de entrada y de salida; multiplica cada uno por el precio por millon de tokens del modelo (entrada y salida tienen precios distintos) y suma. Los tokens leidos del prompt cache cuestan una fraccion del precio de entrada, asi que cuentalos aparte. Anexa ese costo al span de la llamada y agrega por ruta, por usuario y por dia. El error comun es mirar solo el total de la cuenta; el valor esta en saber que ruta y que usuario generan el gasto.',
    },
  ],
  conclusion: {
    title: 'La observabilidad es lo que convierte un sistema de LLM de caja negra en operacion',
    description:
      'Tracing por fase, costo por llamada, senales de calidad y alertas con contexto son el minimo para operar LLM sin sorpresa de factura ni regresion invisible. Puedo instrumentar estas tres dimensiones en tu producto, del middleware al dashboard, integradas a tu stack y listas para escalar.',
    cta: 'Hablar sobre observabilidad de mi sistema de IA',
  },
  related: [
    { label: 'Orquestacion de agentes de IA en produccion', to: '/blog/orquestracao-agentes-ia-producao' },
    { label: 'Evaluacion continua de bots: del eval manual al automatico', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Observabilidad y confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
    // slug de servico e o mesmo nos 3 idiomas
  ],
  repo: { name: 'llm-observability-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
