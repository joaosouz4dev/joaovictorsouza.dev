// Conteudo do artigo: amostragem de trace em producao.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O incidente aconteceu às 03h14, durou onze minutos e afetou quarenta clientes. Você abre o painel de traces, filtra pela janela, e encontra oitocentos traces de requisições que funcionaram perfeitamente. Os que falharam foram descartados pelo amostrador, porque ele sorteia um por cento das requisições e não faz ideia do que é interessante. Este artigo mostra por que a amostragem uniforme guarda exatamente o volume errado, por que decidir no início da requisição é a raiz do problema e o que muda quando a decisão vai para o fim, como escrever uma política que garante o raro e limita o comum sem estourar orçamento, por que a decisão precisa viajar no contexto de propagação para o trace não sair pela metade, o que quebra nas métricas quando você agrega em cima de dados amostrados, e como validar a política antes de descobrir na próxima madrugada que ela não guardou nada.',
  sections: [
    {
      title: 'A amostragem uniforme guarda o volume errado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O amostrador padrão da maioria dos SDKs é probabilístico e fixo: cada trace tem a mesma chance de ser guardado, geralmente algo entre um e dez por cento. A escolha faz sentido do ponto de vista de custo, porque o volume de traces cresce junto com o tráfego e a fatura de armazenamento é linear. O problema é que ela otimiza a estatística e destrói a investigação. Amostrar de forma uniforme significa preservar a distribuição do tráfego, e a distribuição do tráfego é dominada por requisições que deram certo. Você acaba com uma amostra fiel do que já sabia e uma amostra vazia do que precisa entender.',
        },
        {
          type: 'paragraph',
          value:
            'Vale fazer a conta, porque ela é mais brutal do que parece. Um endpoint com dez mil requisições por minuto e taxa de erro de zero vírgula um por cento produz dez erros por minuto. Com amostragem de um por cento, a expectativa é de zero vírgula um erro guardado por minuto: um a cada dez minutos. Um incidente de cinco minutos produz, em média, meio trace de erro. Metade das vezes você não terá nenhum. E note que a taxa de erro não precisa ser baixa para o problema aparecer: qualquer classe de falha que seja rara em relação ao tráfego total sofre o mesmo, inclusive a cauda de latência, que é onde quase toda investigação de performance começa.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'Como decide', 'Custo', 'O que perde'],
          rows: [
            [
              'Uniforme fixa',
              'Sorteio no início, taxa única para tudo',
              'Previsível e linear no tráfego',
              'Erros e cauda de latência, que são raros por definição',
            ],
            [
              'Por taxa de cabeça (head-based)',
              'Sorteio no início, taxa diferente por rota ou cliente',
              'Previsível, ajustável por segmento',
              'Ainda não sabe se a requisição falhou quando decide',
            ],
            [
              'Por resultado (tail-based)',
              'Decide no fim, com latência, status e erro em mãos',
              'Exige buffer dos spans até o trace fechar',
              'Traces muito longos, se o buffer expirar antes',
            ],
            [
              'Sempre ligada em erro, cota no sucesso',
              'Regra explícita por classe de trace',
              'Teto por classe, não pelo tráfego total',
              'Nada relevante, desde que a cota seja monitorada',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O objetivo da amostragem não é reduzir volume, é reduzir volume redundante. Cem traces idênticos de um checkout bem-sucedido explicam a mesma coisa que um. Um trace de um checkout que estourou o timeout do gateway explica algo que nenhum outro registro do sistema explica. A política certa parte dessa assimetria em vez de tratar toda requisição como igualmente informativa.',
        },
      ],
    },
    {
      title: 'A decisão no início é o problema, não a taxa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A amostragem de cabeça decide no primeiro span, quando o trace nasce. Naquele instante você sabe a rota, o método, talvez o identificador do cliente, e não sabe nada do que interessa: se vai falhar, quanto vai demorar, se vai cair no caminho lento, se a tool externa vai estourar. Você está apostando em quais requisições serão interessantes antes de qualquer coisa interessante acontecer. Por isso aumentar a taxa não resolve: subir de um para dez por cento multiplica por dez o custo e continua guardando dez vezes mais do que já funcionava.',
        },
        {
          type: 'paragraph',
          value:
            'A amostragem de cauda inverte a ordem. Todos os spans são emitidos, um coletor os agrupa por identificador de trace, e a decisão de guardar ou descartar só é tomada quando o trace termina ou quando um tempo limite expira. Aí você tem os fatos: houve erro, a duração passou de um limiar, uma tool específica foi chamada. O preço é operacional e precisa ser dito com honestidade: o coletor passa a segurar spans em memória durante uma janela, o que exige que traces do mesmo identificador cheguem ao mesmo coletor, o que por sua vez exige roteamento consistente por identificador quando há mais de uma instância.',
        },
        {
          type: 'diagram',
          value: `AMOSTRAGEM DE CABECA (head-based)
  requisicao --> [sorteio 1%] --> descartada
                      |
                      +-- decidiu sem saber o resultado
  (o erro que aconteceu 300ms depois nunca foi gravado)

AMOSTRAGEM DE CAUDA (tail-based)
  requisicao --> spans --> [buffer do coletor por trace_id]
                                    |
                          trace fecha ou expira janela
                                    |
                      +-------------+-------------+
                      |                           |
                 tem erro?                   duracao > p99?
                 SEMPRE guarda               SEMPRE guarda
                      |                           |
                      +-----------+---------------+
                                  |
                          nenhum dos dois
                                  |
                        guarda 1 em N (cota)`,
        },
        {
          type: 'paragraph',
          value:
            'Existe um meio-termo que funciona bem e custa pouco: manter a amostragem de cabeça generosa para o tráfego comum e adicionar uma regra de força bruta para as classes raras. Se a rota é sabidamente crítica, ou se o cliente está numa lista de contas grandes, ou se um cabeçalho de depuração está presente, a decisão é forçada para guardar sem sorteio. Isso não substitui a amostragem de cauda, mas cobre boa parte do valor prático antes de você ter que operar um coletor com estado.',
        },
      ],
    },
    {
      title: 'Escrevendo a política: garantir o raro, limitar o comum',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma política útil tem duas metades. A primeira é uma lista de condições que forçam a retenção, sem sorteio nenhum, porque o volume delas já é naturalmente pequeno: erro, latência acima do limiar, presença de um cabeçalho de depuração, rota em observação após um deploy. A segunda é uma cota para o que sobrou, e a cota importa mais do que a porcentagem. Uma taxa percentual em cima de um pico de tráfego produz um pico proporcional de custo, exatamente no momento em que você menos quer surpresa. Um teto por segundo produz um custo com limite superior conhecido.',
        },
        {
          type: 'code',
          value: `// tracing/sampling-policy.js
// Politica de amostragem por resultado: decide quando o trace fecha,
// com status, duracao e atributos ja disponiveis.
//
// Duas metades:
//   1) condicoes que SEMPRE guardam (o raro que explica incidente)
//   2) cota por segundo para o resto (o comum, com teto de custo)

const KEEP = { decision: 'keep', rate: 1 };
const DROP = { decision: 'drop', rate: 0 };

// Limiares de latencia por rota, derivados do p99 observado em producao.
// Nao invente numero redondo: um limiar acima do p99 real nunca dispara,
// e um limiar abaixo do p95 guarda um terco do trafego sem querer.
const LATENCY_THRESHOLD_MS = {
  'POST /checkout': 2500,
  'POST /chat': 8000,
  default: 1500,
};

// Cota simples de token bucket: N traces por segundo para o trafego normal.
// O teto e absoluto, entao um pico de trafego nao vira pico de fatura.
function createQuota(perSecond) {
  let tokens = perSecond;
  let lastRefill = 0;

  return function take(nowMs) {
    const elapsed = (nowMs - lastRefill) / 1000;
    if (elapsed > 0) {
      tokens = Math.min(perSecond, tokens + elapsed * perSecond);
      lastRefill = nowMs;
    }
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

const normalTrafficQuota = createQuota(5); // 5 traces/s de trafego saudavel

export function decide(trace, nowMs) {
  const { route, status, durationMs, attributes = {} } = trace;

  // 1) Sempre guardar: erro de servidor e a classe mais rara e mais util.
  if (status >= 500) return { ...KEEP, reason: 'server_error' };

  // Erro de cliente tambem interessa, mas so o que indica bug nosso:
  // 429 e 401 em volume sao esperados e poluiriam a amostra.
  if (status === 400 || status === 422) return { ...KEEP, reason: 'client_error' };

  // 2) Sempre guardar: cauda de latencia, que e onde a investigacao comeca.
  const threshold = LATENCY_THRESHOLD_MS[route] ?? LATENCY_THRESHOLD_MS.default;
  if (durationMs > threshold) return { ...KEEP, reason: 'slow' };

  // 3) Sempre guardar: pedido explicito de depuracao vindo do cabecalho.
  if (attributes['debug.force_sample'] === true) {
    return { ...KEEP, reason: 'forced' };
  }

  // 4) O resto disputa a cota. Sem cota, um pico de trafego saudavel
  //    afoga o orcamento e empurra o raro para fora da retencao.
  if (normalTrafficQuota(nowMs)) return { ...KEEP, reason: 'quota' };

  return { ...DROP, reason: 'sampled_out' };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Repare no campo reason. Ele não é decoração: é o que permite responder mais tarde por que um trace específico está ou não no armazenamento, e é o que você agrega para saber se a política está fazendo o que promete. Uma política sem motivo registrado é uma caixa preta dentro do sistema que existe justamente para eliminar caixas pretas.',
        },
        {
          type: 'paragraph',
          value:
            'O limiar de latência merece atenção porque é onde a política costuma degradar sozinha. Se você fixa dois segundos e o sistema fica mais rápido ao longo do tempo, o limiar deixa de disparar e a cauda some da amostra. Se o sistema fica mais lento, o limiar passa a disparar em metade do tráfego e o custo explode. Derivar o limiar do percentil observado, recalculado periodicamente e com um piso e um teto absolutos, mantém a política estável enquanto o sistema muda.',
        },
      ],
    },
    {
      title: 'A decisão precisa viajar junto com o trace',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um trace atravessa serviços, e cada serviço tem o seu próprio amostrador. Se cada um decide por conta própria, o resultado é um trace pela metade: o serviço de borda guardou o span de entrada, o serviço de pagamento sorteou descartar o dele, e o que sobra no painel é uma árvore com buracos que sugere que a requisição terminou onde ela na verdade continuou. Esse é o modo de falha mais insidioso da amostragem, porque não parece dado faltando, parece dado errado.',
        },
        {
          type: 'paragraph',
          value:
            'A solução é padronizada e vale usá-la em vez de inventar cabeçalho próprio. O contexto de propagação do W3C carrega, no cabeçalho traceparent, um byte de flags cujo bit menos significativo indica se o trace foi amostrado. Todo serviço a jusante lê esse bit e o respeita em vez de sortear de novo. Um serviço só decide quando é a raiz do trace, isto é, quando não recebeu contexto de ninguém.',
        },
        {
          type: 'code',
          value: `// tracing/propagation.js
// Le a decisao de amostragem do contexto recebido e so decide localmente
// quando este servico e a raiz do trace.
//
// Formato do traceparent (W3C Trace Context):
//   00-<trace-id 32 hex>-<parent-id 16 hex>-<flags 2 hex>
//   flags bit 0 (0x01) = sampled

const SAMPLED_FLAG = 0x01;

export function parseTraceparent(header) {
  if (typeof header !== 'string') return null;

  const parts = header.split('-');
  if (parts.length !== 4) return null;

  const [version, traceId, parentId, flags] = parts;
  if (version !== '00') return null;
  if (!/^[0-9a-f]{32}$/.test(traceId) || /^0+$/.test(traceId)) return null;
  if (!/^[0-9a-f]{16}$/.test(parentId) || /^0+$/.test(parentId)) return null;
  if (!/^[0-9a-f]{2}$/.test(flags)) return null;

  return {
    traceId,
    parentId,
    sampled: (parseInt(flags, 16) & SAMPLED_FLAG) === SAMPLED_FLAG,
  };
}

export function shouldSample(incomingHeader, decideLocally) {
  const parent = parseTraceparent(incomingHeader);

  // Contexto valido recebido: respeitar a decisao de quem comecou o trace.
  // Sortear de novo aqui e o que produz arvore com buracos no painel.
  if (parent) return { sampled: parent.sampled, traceId: parent.traceId };

  // Somos a raiz: agora sim a decisao e nossa.
  return { sampled: decideLocally(), traceId: null };
}

export function buildTraceparent({ traceId, spanId, sampled }) {
  const flags = sampled ? '01' : '00';
  return \`00-\${traceId}-\${spanId}-\${flags}\`;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Há uma tensão real aqui com a amostragem de cauda, e ela precisa ser reconhecida: se a decisão só acontece no fim, o bit de propagação não pode carregá-la, porque no momento da chamada a jusante ninguém sabe ainda. Nesse desenho, o bit é mantido ligado durante toda a requisição para que todos os spans sejam emitidos, e quem descarta é o coletor, depois, olhando o trace inteiro. O custo se desloca da retenção para o transporte, o que costuma ser um bom negócio, mas não é de graça e precisa ser dimensionado.',
        },
      ],
    },
    {
      title: 'O que quebra nas métricas quando você amostra',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro mais caro depois de acertar a política é continuar calculando métricas em cima dos traces guardados. Se você retém cem por cento dos erros e uma fração do sucesso, a taxa de erro calculada sobre a amostra é absurdamente maior que a real, e o painel passa a mentir de forma sistemática. O mesmo vale para latência: se a política guarda toda a cauda e uma amostra do corpo da distribuição, o percentil calculado sobre os traces retidos é muito pior que o percentil verdadeiro.',
        },
        {
          type: 'paragraph',
          value:
            'A separação correta é conceitual antes de ser técnica. Métricas devem sair de contadores e histogramas emitidos em cem por cento das requisições, porque são baratos e agregados na origem. Traces devem responder a pergunta de investigação, ou seja, dado que a métrica acusou um problema, mostrar exemplos concretos que o expliquem. Métrica diz que existe e quanto; trace diz por quê. Tentar tirar as duas respostas da mesma fonte amostrada arruína as duas.',
        },
        {
          type: 'table',
          columns: ['Pergunta', 'Fonte correta', 'Por que não a outra'],
          rows: [
            [
              'A taxa de erro subiu?',
              'Contador de requisições por status, sem amostragem',
              'Trace amostrado por política superestima erro por construção',
            ],
            [
              'Qual é o p95 da rota?',
              'Histograma de latência agregado na origem',
              'Amostra enviesada para a cauda infla o percentil',
            ],
            [
              'Por que esta requisição demorou?',
              'Trace com spans por etapa',
              'Métrica agregada não guarda o caminho individual',
            ],
            [
              'Qual dependência causou o incidente?',
              'Traces retidos pela regra de erro',
              'Contador mostra o sintoma, não a cadeia de chamadas',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Se por algum motivo a métrica precisa mesmo sair da amostra, então cada trace retido precisa carregar o peso da sua decisão, isto é, o inverso da probabilidade com que foi guardado, e toda contagem tem que somar pesos em vez de somar linhas. É o que instrumentos maduros fazem internamente. É também mais uma razão para registrar o motivo e a taxa efetiva junto do trace, em vez de descobrir depois que não dá para reconstruir o peso.',
        },
      ],
    },
    {
      title: 'Validar a política antes do próximo incidente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma política de amostragem é código que decide o que você vai poder ver no futuro, e a única forma de descobrir que ela está errada por acidente é durante um incidente, no pior momento possível. Por isso ela precisa de teste como qualquer outra regra de negócio, e de um painel que a observe em produção. As duas coisas são simples e quase nunca são feitas.',
        },
        {
          type: 'ordered',
          items: [
            'Teste de retenção do raro: monte traces sintéticos com status 500, com latência acima do limiar e com o cabeçalho de depuração, e afirme que a decisão é guardar em todos, independentemente da cota.',
            'Teste de teto da cota: dispare mil traces saudáveis dentro do mesmo segundo e afirme que o número de retidos respeita o teto configurado, e que os descartados trazem o motivo correto.',
            'Teste de precedência: um trace que é lento e que também estourou a cota tem que ser guardado pela regra de latência, provando que a cota nunca vence uma condição de retenção obrigatória.',
            'Teste de propagação: dado um traceparent recebido com o bit ligado e outro com o bit desligado, afirme que o serviço respeita a decisão recebida e não sorteia de novo.',
            'Painel de decisões: agregue a contagem de traces por motivo de retenção ao longo do tempo, para enxergar o momento em que uma classe deixa de aparecer.',
            'Alerta de silêncio: se a contagem de retidos por erro cair a zero enquanto o contador de erros continua positivo, a política ou a instrumentação quebrou e ninguém vai notar sem esse alerta.',
          ],
        },
        {
          type: 'code',
          value: `// tracing/sampling-policy.test.js
// O que estes testes protegem: a garantia de que o raro sempre passa
// e de que o comum nunca estoura o teto.

import { decide } from './sampling-policy.js';

const trace = (over = {}) => ({
  route: 'POST /checkout',
  status: 200,
  durationMs: 120,
  attributes: {},
  ...over,
});

test('erro de servidor e sempre retido, mesmo com a cota esgotada', () => {
  // Esgota a cota com trafego saudavel antes de testar o erro.
  for (let i = 0; i < 50; i += 1) decide(trace(), 1000);

  const result = decide(trace({ status: 503 }), 1000);
  expect(result.decision).toBe('keep');
  expect(result.reason).toBe('server_error');
});

test('latencia acima do limiar vence a cota esgotada', () => {
  for (let i = 0; i < 50; i += 1) decide(trace(), 2000);

  const result = decide(trace({ durationMs: 9000 }), 2000);
  expect(result.decision).toBe('keep');
  expect(result.reason).toBe('slow');
});

test('trafego saudavel respeita o teto por segundo', () => {
  const kept = Array.from({ length: 200 }, () => decide(trace(), 3000)).filter(
    (r) => r.decision === 'keep',
  );

  // Teto configurado em 5 traces/s: o excedente sai com motivo explicito.
  expect(kept.length).toBeLessThanOrEqual(5);
});`,
        },
        {
          type: 'paragraph',
          value:
            'O alerta de silêncio da lista acima é o item que mais paga por si. A falha típica de amostragem não é ruidosa: ninguém recebe erro, nenhum serviço cai, apenas os traces de uma classe param de chegar. Sem um alerta que compare a contagem de retidos por motivo com o contador correspondente de métrica, essa quebra fica invisível por semanas e só aparece na madrugada em que você precisava dela.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Amostragem de cauda sempre vale mais a pena que a de cabeça?',
      answer:
        'Não, e a diferença de custo operacional é maior do que a discussão costuma admitir. A amostragem de cauda exige que todos os spans sejam transportados até o coletor, mesmo os que serão descartados, então você troca custo de armazenamento por custo de rede e memória. Além disso, o coletor precisa agrupar spans por identificador de trace numa janela de tempo, o que significa manter estado, e com mais de uma instância significa garantir que todos os spans de um mesmo trace cheguem na mesma instância, geralmente por um balanceamento consistente pelo identificador. Se a sua janela expira antes de o trace fechar, requisições longas são decididas com informação incompleta. Em muitos sistemas o melhor primeiro passo é bem mais barato: manter amostragem de cabeça no tráfego comum e adicionar regras que forçam a retenção para classes conhecidamente raras, como rotas críticas, contas grandes e requisições com cabeçalho de depuração. Isso captura boa parte do valor sem operar um coletor com estado, e deixa a amostragem de cauda para quando as regras explícitas não derem mais conta.',
    },
    {
      question: 'Como escolher o limiar de latência sem chutar um número redondo?',
      answer:
        'Derivando do comportamento observado, por rota, e nunca fixando um valor global. O procedimento que funciona é medir a distribuição de latência de cada rota durante uma janela representativa, que inclua pico e vale, e posicionar o limiar num percentil alto o suficiente para ser raro e baixo o suficiente para capturar a degradação antes de ela virar timeout, tipicamente entre o p95 e o p99. Dois cuidados evitam que a política se degrade sozinha. O primeiro é recalcular periodicamente, porque um limiar fixo perde o sentido conforme o sistema fica mais rápido ou mais lento: no primeiro caso ele nunca dispara e a cauda desaparece da amostra, no segundo ele dispara em metade do tráfego e o custo explode. O segundo é prender o valor recalculado entre um piso e um teto absolutos, senão um período degradado ensina o limiar a considerar normal uma latência que não é, e a política deixa de enxergar exatamente o problema que você quer investigar.',
    },
    {
      question: 'Dá para calcular taxa de erro e percentis a partir dos traces amostrados?',
      answer:
        'Não com uma política que retém classes de forma desigual, que é justamente a política que vale a pena ter. Se você guarda cem por cento dos erros e uma fração do sucesso, contar linhas na amostra produz uma taxa de erro várias ordens de grandeza acima da real, e o mesmo viés infla qualquer percentil de latência, porque a cauda está inteira na amostra e o corpo da distribuição não. O caminho correto é separar as fontes: métricas saem de contadores e histogramas emitidos em cem por cento das requisições e agregados na origem, que são baratos justamente por não guardarem o evento individual, e traces respondem a pergunta seguinte, mostrando exemplos concretos que expliquem o que a métrica acusou. Se ainda assim for necessário estimar algo a partir da amostra, cada trace precisa carregar a taxa efetiva com que foi retido e toda contagem tem que somar o inverso dessa taxa em vez de somar registros, o que também exige que o motivo e a taxa sejam gravados junto do trace desde o início.',
    },
  ],
  conclusion: {
    title: 'Amostrar é decidir hoje o que você vai poder investigar amanhã',
    description:
      'A política de amostragem não é uma configuração de custo, é uma decisão sobre quais perguntas o sistema ainda vai conseguir responder daqui a três meses, tomada meses antes de a pergunta existir. Uma taxa uniforme guarda com fidelidade o tráfego que já funcionava e joga fora a minoria que explica o incidente. Posso revisar ou desenhar a política de amostragem da sua stack de observabilidade, definindo as condições que forçam retenção, a cota que limita o custo do tráfego comum, a propagação que impede trace pela metade entre serviços, a separação entre métrica e trace que evita painel enviesado, e os testes e alertas que provam que o raro continua sendo guardado.',
    cta: 'Falar sobre a amostragem de traces do meu sistema',
  },
  related: [
    {
      label: 'Observabilidade de LLM: tracing, custo e qualidade',
      to: '/blog/observabilidade-llm-tracing-custo-qualidade',
    },
    {
      label: 'Orçamento de latência por etapa: onde cortar quando a resposta demora',
      to: '/blog/orcamento-latencia-por-etapa-onde-cortar-quando-resposta-demora',
    },
    {
      label: 'Observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'The incident happened at 03:14, lasted eleven minutes and affected forty customers. You open the trace explorer, filter by the window, and find eight hundred traces of requests that worked perfectly. The failing ones were dropped by the sampler, because it rolls the dice on one percent of requests and has no idea what is interesting. This article shows why uniform sampling keeps exactly the wrong volume, why deciding at the start of the request is the root of the problem and what changes when the decision moves to the end, how to write a policy that guarantees the rare and caps the common without blowing the budget, why the decision has to travel in the propagation context so the trace does not come out half missing, what breaks in your metrics when you aggregate on top of sampled data, and how to validate the policy before finding out at the next 3 a.m. that it kept nothing.',
  sections: [
    {
      title: 'Uniform sampling keeps the wrong volume',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The default sampler in most SDKs is probabilistic and fixed: every trace has the same chance of being kept, usually somewhere between one and ten percent. The choice makes sense from a cost standpoint, because trace volume grows with traffic and the storage bill is linear. The problem is that it optimizes for statistics and destroys investigation. Sampling uniformly means preserving the traffic distribution, and the traffic distribution is dominated by requests that succeeded. You end up with a faithful sample of what you already knew and an empty sample of what you need to understand.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth doing the arithmetic, because it is more brutal than it looks. An endpoint at ten thousand requests per minute with a zero point one percent error rate produces ten errors per minute. At one percent sampling, the expectation is zero point one kept errors per minute: one every ten minutes. A five-minute incident produces, on average, half an error trace. Half the time you will have none at all. And note that the error rate does not have to be low for the problem to appear: any failure class that is rare relative to total traffic suffers the same way, including the latency tail, which is where nearly every performance investigation starts.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'How it decides', 'Cost', 'What it loses'],
          rows: [
            [
              'Fixed uniform',
              'Dice roll at the start, single rate for everything',
              'Predictable and linear in traffic',
              'Errors and the latency tail, which are rare by definition',
            ],
            [
              'Head-based by rate',
              'Dice roll at the start, different rate per route or customer',
              'Predictable, tunable per segment',
              'Still does not know whether the request failed when it decides',
            ],
            [
              'Tail-based by outcome',
              'Decides at the end, with latency, status and error in hand',
              'Requires buffering spans until the trace closes',
              'Very long traces, if the buffer expires first',
            ],
            [
              'Always on for errors, quota for success',
              'Explicit rule per trace class',
              'Ceiling per class, not driven by total traffic',
              'Nothing relevant, as long as the quota is monitored',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The goal of sampling is not to reduce volume, it is to reduce redundant volume. A hundred identical traces of a successful checkout explain the same thing one does. A single trace of a checkout that hit the gateway timeout explains something no other record in the system explains. The right policy starts from that asymmetry instead of treating every request as equally informative.',
        },
      ],
    },
    {
      title: 'Deciding at the start is the problem, not the rate',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Head-based sampling decides on the first span, when the trace is born. At that instant you know the route, the method, maybe the customer identifier, and you know nothing that matters: whether it will fail, how long it will take, whether it will hit the slow path, whether the external tool will time out. You are betting on which requests will be interesting before anything interesting has happened. That is why raising the rate does not fix it: going from one to ten percent multiplies cost by ten and still keeps ten times more of what already worked.',
        },
        {
          type: 'paragraph',
          value:
            'Tail-based sampling inverts the order. Every span is emitted, a collector groups them by trace identifier, and the keep-or-drop decision is only made when the trace ends or when a timeout expires. By then you have the facts: there was an error, the duration crossed a threshold, a specific tool was called. The price is operational and deserves to be stated honestly: the collector now holds spans in memory during a window, which requires spans of the same identifier to reach the same collector, which in turn requires consistent routing by identifier when there is more than one instance.',
        },
        {
          type: 'diagram',
          value: `HEAD-BASED SAMPLING
  request --> [1% dice roll] --> dropped
                     |
                     +-- decided without knowing the outcome
  (the error that happened 300ms later was never recorded)

TAIL-BASED SAMPLING
  request --> spans --> [collector buffer per trace_id]
                                   |
                        trace closes or window expires
                                   |
                     +-------------+-------------+
                     |                           |
                 has error?                 duration > p99?
                 ALWAYS keep                 ALWAYS keep
                     |                           |
                     +-----------+---------------+
                                 |
                          neither of them
                                 |
                          keep 1 in N (quota)`,
        },
        {
          type: 'paragraph',
          value:
            'There is a middle ground that works well and costs little: keep head-based sampling generous for ordinary traffic and add a brute-force rule for the rare classes. If the route is known to be critical, or the customer is on a list of large accounts, or a debug header is present, the decision is forced to keep with no dice roll. This does not replace tail-based sampling, but it covers a good share of the practical value before you have to operate a stateful collector.',
        },
      ],
    },
    {
      title: 'Writing the policy: guarantee the rare, cap the common',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A useful policy has two halves. The first is a list of conditions that force retention with no dice roll at all, because their volume is naturally small: error, latency above the threshold, presence of a debug header, a route under watch after a deploy. The second is a quota for whatever is left, and the quota matters more than the percentage. A percentage rate applied to a traffic spike produces a proportional spike in cost, at exactly the moment you least want surprises. A per-second ceiling produces a cost with a known upper bound.',
        },
        {
          type: 'code',
          value: `// tracing/sampling-policy.js
// Outcome-based sampling policy: decides when the trace closes,
// with status, duration and attributes already available.
//
// Two halves:
//   1) conditions that ALWAYS keep (the rare that explains incidents)
//   2) per-second quota for the rest (the common, with a cost ceiling)

const KEEP = { decision: 'keep', rate: 1 };
const DROP = { decision: 'drop', rate: 0 };

// Latency thresholds per route, derived from the p99 observed in production.
// Do not invent a round number: a threshold above the real p99 never fires,
// and one below the p95 keeps a third of your traffic by accident.
const LATENCY_THRESHOLD_MS = {
  'POST /checkout': 2500,
  'POST /chat': 8000,
  default: 1500,
};

// Simple token bucket quota: N traces per second for normal traffic.
// The ceiling is absolute, so a traffic spike does not become a bill spike.
function createQuota(perSecond) {
  let tokens = perSecond;
  let lastRefill = 0;

  return function take(nowMs) {
    const elapsed = (nowMs - lastRefill) / 1000;
    if (elapsed > 0) {
      tokens = Math.min(perSecond, tokens + elapsed * perSecond);
      lastRefill = nowMs;
    }
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

const normalTrafficQuota = createQuota(5); // 5 traces/s of healthy traffic

export function decide(trace, nowMs) {
  const { route, status, durationMs, attributes = {} } = trace;

  // 1) Always keep: server errors are the rarest and most useful class.
  if (status >= 500) return { ...KEEP, reason: 'server_error' };

  // Client errors matter too, but only those that point at our own bug:
  // 429 and 401 at volume are expected and would pollute the sample.
  if (status === 400 || status === 422) return { ...KEEP, reason: 'client_error' };

  // 2) Always keep: the latency tail, where investigation starts.
  const threshold = LATENCY_THRESHOLD_MS[route] ?? LATENCY_THRESHOLD_MS.default;
  if (durationMs > threshold) return { ...KEEP, reason: 'slow' };

  // 3) Always keep: an explicit debug request coming from the header.
  if (attributes['debug.force_sample'] === true) {
    return { ...KEEP, reason: 'forced' };
  }

  // 4) The rest competes for the quota. Without a quota, a spike of healthy
  //    traffic drowns the budget and pushes the rare out of retention.
  if (normalTrafficQuota(nowMs)) return { ...KEEP, reason: 'quota' };

  return { ...DROP, reason: 'sampled_out' };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Notice the reason field. It is not decoration: it is what lets you answer later why a specific trace is or is not in storage, and it is what you aggregate to know whether the policy is doing what it promises. A policy with no recorded reason is a black box living inside the system that exists precisely to eliminate black boxes.',
        },
        {
          type: 'paragraph',
          value:
            'The latency threshold deserves attention because it is where policies usually degrade on their own. If you hardcode two seconds and the system gets faster over time, the threshold stops firing and the tail disappears from the sample. If the system gets slower, the threshold starts firing on half the traffic and cost explodes. Deriving the threshold from the observed percentile, recomputed periodically and clamped between an absolute floor and ceiling, keeps the policy stable while the system changes.',
        },
      ],
    },
    {
      title: 'The decision has to travel with the trace',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A trace crosses services, and each service has its own sampler. If each one decides on its own, the result is a half-missing trace: the edge service kept the entry span, the payment service rolled a drop for its own, and what is left in the explorer is a tree with holes that suggests the request ended where it actually continued. This is the most insidious failure mode of sampling, because it does not look like missing data, it looks like wrong data.',
        },
        {
          type: 'paragraph',
          value:
            'The solution is standardized and worth using instead of inventing your own header. The W3C propagation context carries, in the traceparent header, a flags byte whose least significant bit indicates whether the trace was sampled. Every downstream service reads that bit and honors it instead of rolling again. A service only decides when it is the root of the trace, that is, when it received no context from anyone.',
        },
        {
          type: 'code',
          value: `// tracing/propagation.js
// Reads the sampling decision from the incoming context and only decides
// locally when this service is the root of the trace.
//
// traceparent format (W3C Trace Context):
//   00-<trace-id 32 hex>-<parent-id 16 hex>-<flags 2 hex>
//   flags bit 0 (0x01) = sampled

const SAMPLED_FLAG = 0x01;

export function parseTraceparent(header) {
  if (typeof header !== 'string') return null;

  const parts = header.split('-');
  if (parts.length !== 4) return null;

  const [version, traceId, parentId, flags] = parts;
  if (version !== '00') return null;
  if (!/^[0-9a-f]{32}$/.test(traceId) || /^0+$/.test(traceId)) return null;
  if (!/^[0-9a-f]{16}$/.test(parentId) || /^0+$/.test(parentId)) return null;
  if (!/^[0-9a-f]{2}$/.test(flags)) return null;

  return {
    traceId,
    parentId,
    sampled: (parseInt(flags, 16) & SAMPLED_FLAG) === SAMPLED_FLAG,
  };
}

export function shouldSample(incomingHeader, decideLocally) {
  const parent = parseTraceparent(incomingHeader);

  // Valid context received: honor the decision made by whoever started
  // the trace. Rolling again here is what produces trees with holes.
  if (parent) return { sampled: parent.sampled, traceId: parent.traceId };

  // We are the root: now the decision is ours.
  return { sampled: decideLocally(), traceId: null };
}

export function buildTraceparent({ traceId, spanId, sampled }) {
  const flags = sampled ? '01' : '00';
  return \`00-\${traceId}-\${spanId}-\${flags}\`;
}`,
        },
        {
          type: 'paragraph',
          value:
            'There is a real tension here with tail-based sampling, and it should be acknowledged: if the decision only happens at the end, the propagation bit cannot carry it, because at the moment of the downstream call nobody knows yet. In that design, the bit is kept on for the whole request so that all spans are emitted, and the collector is what drops them afterwards, looking at the full trace. The cost moves from retention to transport, which is usually a good trade, but it is not free and has to be sized.',
        },
      ],
    },
    {
      title: 'What breaks in your metrics once you sample',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most expensive mistake after getting the policy right is to keep computing metrics on top of the kept traces. If you retain a hundred percent of errors and a fraction of successes, the error rate computed over the sample is absurdly higher than the real one, and the dashboard starts lying systematically. The same holds for latency: if the policy keeps the entire tail and a sample of the body of the distribution, the percentile computed over retained traces is far worse than the true percentile.',
        },
        {
          type: 'paragraph',
          value:
            'The correct separation is conceptual before it is technical. Metrics should come from counters and histograms emitted on a hundred percent of requests, because they are cheap and aggregated at the source. Traces should answer the investigation question, that is, given that the metric flagged a problem, show concrete examples that explain it. The metric says whether it exists and how much; the trace says why. Trying to get both answers from the same sampled source ruins both.',
        },
        {
          type: 'table',
          columns: ['Question', 'Correct source', 'Why not the other one'],
          rows: [
            [
              'Did the error rate go up?',
              'Request counter by status, unsampled',
              'Policy-sampled traces overstate errors by construction',
            ],
            [
              'What is the p95 for this route?',
              'Latency histogram aggregated at the source',
              'A sample biased toward the tail inflates the percentile',
            ],
            [
              'Why did this request take so long?',
              'Trace with spans per stage',
              'An aggregated metric does not keep the individual path',
            ],
            [
              'Which dependency caused the incident?',
              'Traces retained by the error rule',
              'A counter shows the symptom, not the call chain',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'If for some reason the metric really has to come from the sample, then each retained trace has to carry the weight of its own decision, that is, the inverse of the probability with which it was kept, and every count has to sum weights instead of summing rows. That is what mature tooling does internally. It is also one more reason to record the reason and effective rate alongside the trace, rather than discovering later that the weight cannot be reconstructed.',
        },
      ],
    },
    {
      title: 'Validating the policy before the next incident',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A sampling policy is code that decides what you will be able to see in the future, and the only way to discover it is accidentally wrong is during an incident, at the worst possible moment. That is why it needs tests like any other business rule, and a dashboard watching it in production. Both are simple and almost never done.',
        },
        {
          type: 'ordered',
          items: [
            'Rare-retention test: build synthetic traces with status 500, with latency above the threshold and with the debug header, and assert the decision is keep in all of them, regardless of the quota.',
            'Quota ceiling test: fire a thousand healthy traces within the same second and assert the number retained respects the configured ceiling, and that dropped ones carry the correct reason.',
            'Precedence test: a trace that is both slow and past the quota must be kept by the latency rule, proving the quota never overrides a mandatory retention condition.',
            'Propagation test: given an incoming traceparent with the bit on and another with it off, assert the service honors the received decision and does not roll again.',
            'Decision dashboard: aggregate the count of traces by retention reason over time, so you can see the moment a class stops showing up.',
            'Silence alert: if the count of error-retained traces drops to zero while the error counter is still positive, either the policy or the instrumentation broke and nobody will notice without this alert.',
          ],
        },
        {
          type: 'code',
          value: `// tracing/sampling-policy.test.js
// What these tests protect: the guarantee that the rare always gets through
// and that the common never exceeds the ceiling.

import { decide } from './sampling-policy.js';

const trace = (over = {}) => ({
  route: 'POST /checkout',
  status: 200,
  durationMs: 120,
  attributes: {},
  ...over,
});

test('server errors are always retained, even with the quota exhausted', () => {
  // Exhaust the quota with healthy traffic before testing the error.
  for (let i = 0; i < 50; i += 1) decide(trace(), 1000);

  const result = decide(trace({ status: 503 }), 1000);
  expect(result.decision).toBe('keep');
  expect(result.reason).toBe('server_error');
});

test('latency above the threshold beats an exhausted quota', () => {
  for (let i = 0; i < 50; i += 1) decide(trace(), 2000);

  const result = decide(trace({ durationMs: 9000 }), 2000);
  expect(result.decision).toBe('keep');
  expect(result.reason).toBe('slow');
});

test('healthy traffic respects the per-second ceiling', () => {
  const kept = Array.from({ length: 200 }, () => decide(trace(), 3000)).filter(
    (r) => r.decision === 'keep',
  );

  // Ceiling configured at 5 traces/s: the excess leaves with an explicit reason.
  expect(kept.length).toBeLessThanOrEqual(5);
});`,
        },
        {
          type: 'paragraph',
          value:
            'The silence alert from the list above is the item that pays for itself the most. The typical sampling failure is not noisy: nobody gets an error, no service goes down, traces of one class simply stop arriving. Without an alert comparing the count retained per reason against the corresponding metric counter, that break stays invisible for weeks and only surfaces on the night you needed it.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is tail-based sampling always worth more than head-based?',
      answer:
        'No, and the operational cost difference is larger than the discussion usually admits. Tail-based sampling requires every span to be transported to the collector, including the ones that will be dropped, so you trade storage cost for network and memory cost. On top of that, the collector has to group spans by trace identifier within a time window, which means keeping state, and with more than one instance it means guaranteeing that all spans of a given trace land on the same instance, usually through consistent balancing by identifier. If your window expires before the trace closes, long requests are decided with incomplete information. In many systems the best first step is far cheaper: keep head-based sampling for ordinary traffic and add rules that force retention for classes known to be rare, such as critical routes, large accounts and requests carrying a debug header. That captures a good share of the value without operating a stateful collector, and leaves tail-based sampling for when the explicit rules no longer suffice.',
    },
    {
      question: 'How do I pick the latency threshold without guessing a round number?',
      answer:
        'By deriving it from observed behavior, per route, and never fixing a global value. The procedure that works is measuring the latency distribution of each route over a representative window that includes peak and trough, and placing the threshold at a percentile high enough to be rare and low enough to capture degradation before it becomes a timeout, typically between p95 and p99. Two precautions keep the policy from degrading on its own. The first is recomputing periodically, because a fixed threshold loses meaning as the system gets faster or slower: in the first case it never fires and the tail disappears from the sample, in the second it fires on half the traffic and cost explodes. The second is clamping the recomputed value between an absolute floor and ceiling, otherwise a degraded period teaches the threshold to treat as normal a latency that is not, and the policy stops seeing exactly the problem you want to investigate.',
    },
    {
      question: 'Can I compute error rate and percentiles from sampled traces?',
      answer:
        'Not with a policy that retains classes unevenly, which is precisely the policy worth having. If you keep a hundred percent of errors and a fraction of successes, counting rows in the sample produces an error rate several orders of magnitude above the real one, and the same bias inflates any latency percentile, because the whole tail is in the sample and the body of the distribution is not. The correct approach is separating the sources: metrics come from counters and histograms emitted on a hundred percent of requests and aggregated at the source, which are cheap precisely because they do not keep the individual event, and traces answer the next question, showing concrete examples that explain what the metric flagged. If you still need to estimate something from the sample, each trace has to carry the effective rate at which it was retained and every count has to sum the inverse of that rate instead of summing records, which also requires the reason and the rate to be recorded alongside the trace from the start.',
    },
  ],
  conclusion: {
    title: 'Sampling is deciding today what you will be able to investigate tomorrow',
    description:
      'A sampling policy is not a cost setting, it is a decision about which questions the system will still be able to answer three months from now, made months before the question exists. A uniform rate faithfully keeps the traffic that already worked and throws away the minority that explains the incident. I can review or design the sampling policy of your observability stack, defining the conditions that force retention, the quota that caps the cost of ordinary traffic, the propagation that prevents half-missing traces between services, the separation between metric and trace that avoids a biased dashboard, and the tests and alerts that prove the rare is still being kept.',
    cta: 'Talk about trace sampling in my system',
  },
  related: [
    {
      label: 'LLM observability: tracing, cost and quality',
      to: '/blog/observabilidade-llm-tracing-custo-qualidade',
    },
    {
      label: 'Latency budget per stage: where to cut when the answer is slow',
      to: '/blog/orcamento-latencia-por-etapa-onde-cortar-quando-resposta-demora',
    },
    {
      label: 'Observability and reliability',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'El incidente ocurrió a las 03:14, duró once minutos y afectó a cuarenta clientes. Abres el panel de traces, filtras por la ventana y encuentras ochocientos traces de peticiones que funcionaron perfectamente. Las que fallaron fueron descartadas por el muestreador, porque sortea el uno por ciento de las peticiones y no tiene ni idea de qué es interesante. Este artículo muestra por qué el muestreo uniforme guarda exactamente el volumen equivocado, por qué decidir al inicio de la petición es la raíz del problema y qué cambia cuando la decisión pasa al final, cómo escribir una política que garantice lo raro y limite lo común sin reventar el presupuesto, por qué la decisión tiene que viajar en el contexto de propagación para que el trace no salga a medias, qué se rompe en las métricas cuando agregas sobre datos muestreados, y cómo validar la política antes de descubrir en la próxima madrugada que no guardó nada.',
  sections: [
    {
      title: 'El muestreo uniforme guarda el volumen equivocado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El muestreador por defecto de la mayoría de los SDK es probabilístico y fijo: cada trace tiene la misma probabilidad de ser guardado, normalmente entre el uno y el diez por ciento. La elección tiene sentido desde el punto de vista del costo, porque el volumen de traces crece junto con el tráfico y la factura de almacenamiento es lineal. El problema es que optimiza la estadística y destruye la investigación. Muestrear de forma uniforme significa preservar la distribución del tráfico, y la distribución del tráfico está dominada por peticiones que salieron bien. Terminas con una muestra fiel de lo que ya sabías y una muestra vacía de lo que necesitas entender.',
        },
        {
          type: 'paragraph',
          value:
            'Conviene hacer la cuenta, porque es más brutal de lo que parece. Un endpoint con diez mil peticiones por minuto y una tasa de error del cero coma uno por ciento produce diez errores por minuto. Con un muestreo del uno por ciento, la esperanza es de cero coma un error guardado por minuto: uno cada diez minutos. Un incidente de cinco minutos produce, en promedio, medio trace de error. La mitad de las veces no tendrás ninguno. Y ojo: la tasa de error no tiene que ser baja para que el problema aparezca, cualquier clase de falla que sea rara respecto al tráfico total sufre lo mismo, incluida la cola de latencia, que es donde empieza casi toda investigación de rendimiento.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Cómo decide', 'Costo', 'Qué pierde'],
          rows: [
            [
              'Uniforme fija',
              'Sorteo al inicio, tasa única para todo',
              'Predecible y lineal en el tráfico',
              'Errores y cola de latencia, que son raros por definición',
            ],
            [
              'Por tasa de cabeza (head-based)',
              'Sorteo al inicio, tasa distinta por ruta o cliente',
              'Predecible, ajustable por segmento',
              'Todavía no sabe si la petición falló cuando decide',
            ],
            [
              'Por resultado (tail-based)',
              'Decide al final, con latencia, estado y error en la mano',
              'Exige buffer de los spans hasta que el trace cierre',
              'Traces muy largos, si el buffer expira antes',
            ],
            [
              'Siempre activo en error, cuota en el éxito',
              'Regla explícita por clase de trace',
              'Techo por clase, no por el tráfico total',
              'Nada relevante, siempre que la cuota se monitoree',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El objetivo del muestreo no es reducir volumen, es reducir volumen redundante. Cien traces idénticos de un checkout exitoso explican lo mismo que uno. Un trace de un checkout que reventó el timeout de la pasarela explica algo que ningún otro registro del sistema explica. La política correcta parte de esa asimetría en vez de tratar cada petición como igualmente informativa.',
        },
      ],
    },
    {
      title: 'La decisión al inicio es el problema, no la tasa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El muestreo de cabeza decide en el primer span, cuando nace el trace. En ese instante conoces la ruta, el método, quizá el identificador del cliente, y no sabes nada de lo que importa: si va a fallar, cuánto va a tardar, si va a caer en el camino lento, si la tool externa va a reventar. Estás apostando a qué peticiones serán interesantes antes de que ocurra nada interesante. Por eso subir la tasa no lo resuelve: pasar del uno al diez por ciento multiplica el costo por diez y sigue guardando diez veces más de lo que ya funcionaba.',
        },
        {
          type: 'paragraph',
          value:
            'El muestreo de cola invierte el orden. Todos los spans se emiten, un colector los agrupa por identificador de trace, y la decisión de guardar o descartar solo se toma cuando el trace termina o cuando expira un tiempo límite. Ahí sí tienes los hechos: hubo error, la duración pasó un umbral, se llamó a una tool específica. El precio es operativo y hay que decirlo con honestidad: el colector pasa a retener spans en memoria durante una ventana, lo que exige que los spans del mismo identificador lleguen al mismo colector, lo que a su vez exige un enrutamiento consistente por identificador cuando hay más de una instancia.',
        },
        {
          type: 'diagram',
          value: `MUESTREO DE CABEZA (head-based)
  peticion --> [sorteo 1%] --> descartada
                     |
                     +-- decidio sin saber el resultado
  (el error que ocurrio 300ms despues nunca se grabo)

MUESTREO DE COLA (tail-based)
  peticion --> spans --> [buffer del colector por trace_id]
                                   |
                        trace cierra o expira ventana
                                   |
                     +-------------+-------------+
                     |                           |
                 hay error?                 duracion > p99?
                 SIEMPRE guarda              SIEMPRE guarda
                     |                           |
                     +-----------+---------------+
                                 |
                          ninguno de los dos
                                 |
                        guarda 1 de cada N (cuota)`,
        },
        {
          type: 'paragraph',
          value:
            'Existe un punto intermedio que funciona bien y cuesta poco: mantener el muestreo de cabeza generoso para el tráfico común y añadir una regla de fuerza bruta para las clases raras. Si la ruta es sabidamente crítica, o si el cliente está en una lista de cuentas grandes, o si hay una cabecera de depuración presente, la decisión se fuerza a guardar sin sorteo. Esto no reemplaza al muestreo de cola, pero cubre buena parte del valor práctico antes de tener que operar un colector con estado.',
        },
      ],
    },
    {
      title: 'Escribir la política: garantizar lo raro, limitar lo común',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una política útil tiene dos mitades. La primera es una lista de condiciones que fuerzan la retención, sin ningún sorteo, porque su volumen ya es naturalmente pequeño: error, latencia por encima del umbral, presencia de una cabecera de depuración, ruta en observación después de un deploy. La segunda es una cuota para lo que quedó, y la cuota importa más que el porcentaje. Una tasa porcentual sobre un pico de tráfico produce un pico proporcional de costo, justo en el momento en que menos quieres sorpresas. Un techo por segundo produce un costo con límite superior conocido.',
        },
        {
          type: 'code',
          value: `// tracing/sampling-policy.js
// Politica de muestreo por resultado: decide cuando el trace cierra,
// con estado, duracion y atributos ya disponibles.
//
// Dos mitades:
//   1) condiciones que SIEMPRE guardan (lo raro que explica el incidente)
//   2) cuota por segundo para el resto (lo comun, con techo de costo)

const KEEP = { decision: 'keep', rate: 1 };
const DROP = { decision: 'drop', rate: 0 };

// Umbrales de latencia por ruta, derivados del p99 observado en produccion.
// No inventes un numero redondo: un umbral por encima del p99 real nunca
// dispara, y uno por debajo del p95 guarda un tercio del trafico sin querer.
const LATENCY_THRESHOLD_MS = {
  'POST /checkout': 2500,
  'POST /chat': 8000,
  default: 1500,
};

// Cuota simple de token bucket: N traces por segundo para el trafico normal.
// El techo es absoluto, asi un pico de trafico no se vuelve pico de factura.
function createQuota(perSecond) {
  let tokens = perSecond;
  let lastRefill = 0;

  return function take(nowMs) {
    const elapsed = (nowMs - lastRefill) / 1000;
    if (elapsed > 0) {
      tokens = Math.min(perSecond, tokens + elapsed * perSecond);
      lastRefill = nowMs;
    }
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

const normalTrafficQuota = createQuota(5); // 5 traces/s de trafico sano

export function decide(trace, nowMs) {
  const { route, status, durationMs, attributes = {} } = trace;

  // 1) Siempre guardar: el error de servidor es la clase mas rara y mas util.
  if (status >= 500) return { ...KEEP, reason: 'server_error' };

  // El error de cliente tambien interesa, pero solo el que indica bug nuestro:
  // 429 y 401 en volumen son esperados y contaminarian la muestra.
  if (status === 400 || status === 422) return { ...KEEP, reason: 'client_error' };

  // 2) Siempre guardar: la cola de latencia, donde empieza la investigacion.
  const threshold = LATENCY_THRESHOLD_MS[route] ?? LATENCY_THRESHOLD_MS.default;
  if (durationMs > threshold) return { ...KEEP, reason: 'slow' };

  // 3) Siempre guardar: pedido explicito de depuracion desde la cabecera.
  if (attributes['debug.force_sample'] === true) {
    return { ...KEEP, reason: 'forced' };
  }

  // 4) El resto compite por la cuota. Sin cuota, un pico de trafico sano
  //    ahoga el presupuesto y empuja lo raro fuera de la retencion.
  if (normalTrafficQuota(nowMs)) return { ...KEEP, reason: 'quota' };

  return { ...DROP, reason: 'sampled_out' };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Fíjate en el campo reason. No es decoración: es lo que permite responder más tarde por qué un trace concreto está o no en el almacenamiento, y es lo que agregas para saber si la política está haciendo lo que promete. Una política sin motivo registrado es una caja negra dentro del sistema que existe justamente para eliminar cajas negras.',
        },
        {
          type: 'paragraph',
          value:
            'El umbral de latencia merece atención porque es donde la política suele degradarse sola. Si fijas dos segundos y el sistema se vuelve más rápido con el tiempo, el umbral deja de dispararse y la cola desaparece de la muestra. Si el sistema se vuelve más lento, el umbral pasa a dispararse en la mitad del tráfico y el costo explota. Derivar el umbral del percentil observado, recalculado periódicamente y acotado entre un piso y un techo absolutos, mantiene la política estable mientras el sistema cambia.',
        },
      ],
    },
    {
      title: 'La decisión tiene que viajar junto con el trace',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un trace atraviesa servicios, y cada servicio tiene su propio muestreador. Si cada uno decide por su cuenta, el resultado es un trace a medias: el servicio de borde guardó el span de entrada, el servicio de pago sorteó descartar el suyo, y lo que queda en el panel es un árbol con agujeros que sugiere que la petición terminó donde en realidad continuó. Este es el modo de falla más insidioso del muestreo, porque no parece dato faltante, parece dato equivocado.',
        },
        {
          type: 'paragraph',
          value:
            'La solución está estandarizada y conviene usarla en vez de inventar una cabecera propia. El contexto de propagación del W3C lleva, en la cabecera traceparent, un byte de flags cuyo bit menos significativo indica si el trace fue muestreado. Todo servicio aguas abajo lee ese bit y lo respeta en vez de sortear de nuevo. Un servicio solo decide cuando es la raíz del trace, es decir, cuando no recibió contexto de nadie.',
        },
        {
          type: 'code',
          value: `// tracing/propagation.js
// Lee la decision de muestreo del contexto recibido y solo decide
// localmente cuando este servicio es la raiz del trace.
//
// Formato de traceparent (W3C Trace Context):
//   00-<trace-id 32 hex>-<parent-id 16 hex>-<flags 2 hex>
//   flags bit 0 (0x01) = sampled

const SAMPLED_FLAG = 0x01;

export function parseTraceparent(header) {
  if (typeof header !== 'string') return null;

  const parts = header.split('-');
  if (parts.length !== 4) return null;

  const [version, traceId, parentId, flags] = parts;
  if (version !== '00') return null;
  if (!/^[0-9a-f]{32}$/.test(traceId) || /^0+$/.test(traceId)) return null;
  if (!/^[0-9a-f]{16}$/.test(parentId) || /^0+$/.test(parentId)) return null;
  if (!/^[0-9a-f]{2}$/.test(flags)) return null;

  return {
    traceId,
    parentId,
    sampled: (parseInt(flags, 16) & SAMPLED_FLAG) === SAMPLED_FLAG,
  };
}

export function shouldSample(incomingHeader, decideLocally) {
  const parent = parseTraceparent(incomingHeader);

  // Contexto valido recibido: respetar la decision de quien inicio el trace.
  // Sortear de nuevo aqui es lo que produce arboles con agujeros.
  if (parent) return { sampled: parent.sampled, traceId: parent.traceId };

  // Somos la raiz: ahora si la decision es nuestra.
  return { sampled: decideLocally(), traceId: null };
}

export function buildTraceparent({ traceId, spanId, sampled }) {
  const flags = sampled ? '01' : '00';
  return \`00-\${traceId}-\${spanId}-\${flags}\`;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Hay una tensión real aquí con el muestreo de cola, y hay que reconocerla: si la decisión solo ocurre al final, el bit de propagación no puede llevarla, porque en el momento de la llamada aguas abajo nadie lo sabe todavía. En ese diseño, el bit se mantiene encendido durante toda la petición para que todos los spans se emitan, y quien descarta es el colector, después, mirando el trace completo. El costo se desplaza de la retención al transporte, lo que suele ser un buen negocio, pero no es gratis y hay que dimensionarlo.',
        },
      ],
    },
    {
      title: 'Qué se rompe en las métricas cuando muestreas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error más caro después de acertar la política es seguir calculando métricas sobre los traces guardados. Si retienes el cien por ciento de los errores y una fracción del éxito, la tasa de error calculada sobre la muestra es absurdamente mayor que la real, y el panel pasa a mentir de forma sistemática. Lo mismo vale para la latencia: si la política guarda toda la cola y una muestra del cuerpo de la distribución, el percentil calculado sobre los traces retenidos es mucho peor que el percentil verdadero.',
        },
        {
          type: 'paragraph',
          value:
            'La separación correcta es conceptual antes que técnica. Las métricas deben salir de contadores e histogramas emitidos en el cien por ciento de las peticiones, porque son baratos y se agregan en el origen. Los traces deben responder la pregunta de investigación, es decir, dado que la métrica señaló un problema, mostrar ejemplos concretos que lo expliquen. La métrica dice si existe y cuánto; el trace dice por qué. Intentar sacar ambas respuestas de la misma fuente muestreada arruina las dos.',
        },
        {
          type: 'table',
          columns: ['Pregunta', 'Fuente correcta', 'Por qué no la otra'],
          rows: [
            [
              '¿Subió la tasa de error?',
              'Contador de peticiones por estado, sin muestreo',
              'El trace muestreado por política sobreestima el error por construcción',
            ],
            [
              '¿Cuál es el p95 de la ruta?',
              'Histograma de latencia agregado en el origen',
              'Una muestra sesgada hacia la cola infla el percentil',
            ],
            [
              '¿Por qué tardó esta petición?',
              'Trace con spans por etapa',
              'La métrica agregada no guarda el camino individual',
            ],
            [
              '¿Qué dependencia causó el incidente?',
              'Traces retenidos por la regla de error',
              'El contador muestra el síntoma, no la cadena de llamadas',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Si por algún motivo la métrica sí tiene que salir de la muestra, entonces cada trace retenido tiene que llevar el peso de su decisión, es decir, el inverso de la probabilidad con la que fue guardado, y todo conteo tiene que sumar pesos en vez de sumar filas. Es lo que hacen internamente las herramientas maduras. Es también una razón más para registrar el motivo y la tasa efectiva junto al trace, en lugar de descubrir después que no se puede reconstruir el peso.',
        },
      ],
    },
    {
      title: 'Validar la política antes del próximo incidente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una política de muestreo es código que decide qué vas a poder ver en el futuro, y la única forma de descubrir que está mal por accidente es durante un incidente, en el peor momento posible. Por eso necesita pruebas como cualquier otra regla de negocio, y un panel que la observe en producción. Ambas cosas son simples y casi nunca se hacen.',
        },
        {
          type: 'ordered',
          items: [
            'Prueba de retención de lo raro: construye traces sintéticos con estado 500, con latencia por encima del umbral y con la cabecera de depuración, y afirma que la decisión es guardar en todos, sin importar la cuota.',
            'Prueba del techo de la cuota: dispara mil traces sanos dentro del mismo segundo y afirma que la cantidad de retenidos respeta el techo configurado, y que los descartados traen el motivo correcto.',
            'Prueba de precedencia: un trace que es lento y que además superó la cuota tiene que ser guardado por la regla de latencia, probando que la cuota nunca vence a una condición de retención obligatoria.',
            'Prueba de propagación: dado un traceparent recibido con el bit encendido y otro con el bit apagado, afirma que el servicio respeta la decisión recibida y no sortea de nuevo.',
            'Panel de decisiones: agrega el conteo de traces por motivo de retención a lo largo del tiempo, para ver el momento en que una clase deja de aparecer.',
            'Alerta de silencio: si el conteo de retenidos por error cae a cero mientras el contador de errores sigue positivo, la política o la instrumentación se rompió y nadie lo va a notar sin esta alerta.',
          ],
        },
        {
          type: 'code',
          value: `// tracing/sampling-policy.test.js
// Que protegen estas pruebas: la garantia de que lo raro siempre pasa
// y de que lo comun nunca supera el techo.

import { decide } from './sampling-policy.js';

const trace = (over = {}) => ({
  route: 'POST /checkout',
  status: 200,
  durationMs: 120,
  attributes: {},
  ...over,
});

test('el error de servidor siempre se retiene, aun con la cuota agotada', () => {
  // Agota la cuota con trafico sano antes de probar el error.
  for (let i = 0; i < 50; i += 1) decide(trace(), 1000);

  const result = decide(trace({ status: 503 }), 1000);
  expect(result.decision).toBe('keep');
  expect(result.reason).toBe('server_error');
});

test('la latencia por encima del umbral vence a la cuota agotada', () => {
  for (let i = 0; i < 50; i += 1) decide(trace(), 2000);

  const result = decide(trace({ durationMs: 9000 }), 2000);
  expect(result.decision).toBe('keep');
  expect(result.reason).toBe('slow');
});

test('el trafico sano respeta el techo por segundo', () => {
  const kept = Array.from({ length: 200 }, () => decide(trace(), 3000)).filter(
    (r) => r.decision === 'keep',
  );

  // Techo configurado en 5 traces/s: el excedente sale con motivo explicito.
  expect(kept.length).toBeLessThanOrEqual(5);
});`,
        },
        {
          type: 'paragraph',
          value:
            'La alerta de silencio de la lista anterior es el ítem que más se paga a sí mismo. La falla típica del muestreo no es ruidosa: nadie recibe un error, ningún servicio se cae, simplemente los traces de una clase dejan de llegar. Sin una alerta que compare el conteo de retenidos por motivo con el contador correspondiente de la métrica, esa rotura queda invisible durante semanas y solo aparece en la madrugada en que la necesitabas.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿El muestreo de cola siempre vale más la pena que el de cabeza?',
      answer:
        'No, y la diferencia de costo operativo es mayor de lo que suele admitir la discusión. El muestreo de cola exige que todos los spans se transporten hasta el colector, incluso los que serán descartados, así que cambias costo de almacenamiento por costo de red y memoria. Además, el colector tiene que agrupar spans por identificador de trace dentro de una ventana de tiempo, lo que significa mantener estado, y con más de una instancia significa garantizar que todos los spans de un mismo trace lleguen a la misma instancia, normalmente mediante un balanceo consistente por identificador. Si tu ventana expira antes de que el trace cierre, las peticiones largas se deciden con información incompleta. En muchos sistemas el mejor primer paso es bastante más barato: mantener el muestreo de cabeza en el tráfico común y añadir reglas que fuercen la retención para clases conocidamente raras, como rutas críticas, cuentas grandes y peticiones con cabecera de depuración. Eso captura buena parte del valor sin operar un colector con estado, y deja el muestreo de cola para cuando las reglas explícitas ya no alcancen.',
    },
    {
      question: '¿Cómo elegir el umbral de latencia sin adivinar un número redondo?',
      answer:
        'Derivándolo del comportamiento observado, por ruta, y sin fijar nunca un valor global. El procedimiento que funciona es medir la distribución de latencia de cada ruta durante una ventana representativa que incluya pico y valle, y colocar el umbral en un percentil lo bastante alto para ser raro y lo bastante bajo para capturar la degradación antes de que se convierta en timeout, típicamente entre el p95 y el p99. Dos cuidados evitan que la política se degrade sola. El primero es recalcular periódicamente, porque un umbral fijo pierde sentido a medida que el sistema se vuelve más rápido o más lento: en el primer caso nunca dispara y la cola desaparece de la muestra, en el segundo dispara en la mitad del tráfico y el costo explota. El segundo es acotar el valor recalculado entre un piso y un techo absolutos, si no un período degradado le enseña al umbral a considerar normal una latencia que no lo es, y la política deja de ver exactamente el problema que quieres investigar.',
    },
    {
      question: '¿Se puede calcular la tasa de error y los percentiles a partir de los traces muestreados?',
      answer:
        'No con una política que retiene clases de forma desigual, que es justamente la política que vale la pena tener. Si guardas el cien por ciento de los errores y una fracción del éxito, contar filas en la muestra produce una tasa de error varios órdenes de magnitud por encima de la real, y el mismo sesgo infla cualquier percentil de latencia, porque la cola está entera en la muestra y el cuerpo de la distribución no. El camino correcto es separar las fuentes: las métricas salen de contadores e histogramas emitidos en el cien por ciento de las peticiones y agregados en el origen, que son baratos justamente porque no guardan el evento individual, y los traces responden la pregunta siguiente, mostrando ejemplos concretos que expliquen lo que la métrica señaló. Si aun así hace falta estimar algo a partir de la muestra, cada trace tiene que llevar la tasa efectiva con la que fue retenido y todo conteo tiene que sumar el inverso de esa tasa en vez de sumar registros, lo que también exige que el motivo y la tasa se graben junto al trace desde el principio.',
    },
  ],
  conclusion: {
    title: 'Muestrear es decidir hoy qué vas a poder investigar mañana',
    description:
      'La política de muestreo no es una configuración de costo, es una decisión sobre qué preguntas el sistema todavía va a poder responder dentro de tres meses, tomada meses antes de que la pregunta exista. Una tasa uniforme guarda con fidelidad el tráfico que ya funcionaba y tira la minoría que explica el incidente. Puedo revisar o diseñar la política de muestreo de tu stack de observabilidad, definiendo las condiciones que fuerzan la retención, la cuota que limita el costo del tráfico común, la propagación que impide traces a medias entre servicios, la separación entre métrica y trace que evita un panel sesgado, y las pruebas y alertas que demuestran que lo raro se sigue guardando.',
    cta: 'Hablar sobre el muestreo de traces de mi sistema',
  },
  related: [
    {
      label: 'Observabilidad de LLM: tracing, costo y calidad',
      to: '/blog/observabilidade-llm-tracing-custo-qualidade',
    },
    {
      label: 'Presupuesto de latencia por etapa: dónde recortar cuando la respuesta tarda',
      to: '/blog/orcamento-latencia-por-etapa-onde-cortar-quando-resposta-demora',
    },
    {
      label: 'Observabilidad y confiabilidad',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

export default { pt, en, es };
