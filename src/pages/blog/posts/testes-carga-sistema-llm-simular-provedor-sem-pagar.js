// Conteudo do artigo: testes de carga em sistema com LLM, simulando o provedor sem pagar por ele.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'Você quer saber se o sistema aguenta a campanha de sexta-feira, e o teste de carga esbarra numa parede de custo: cada requisição do teste chama o provedor de verdade, e simular dez mil conversas custa o preço de dez mil conversas. Pior, o teste bate no rate limit da sua conta muito antes de bater no limite da sua aplicação, então você mede o teto do provedor em vez de medir o seu sistema. A saída não é testar com carga menor e extrapolar, porque os problemas que o teste de carga existe para encontrar aparecem justamente na região que a extrapolação não alcança: a fila que cresce, o pool de conexões que esgota, o timeout que só dispara quando o provedor fica lento. A saída é substituir o provedor por um dublê que se comporta como ele, incluindo nos momentos ruins. Este artigo trata disso: o que exatamente precisa ser simulado, por que a latência constante é o erro que invalida o teste inteiro, como reproduzir streaming, erro e rate limit com fidelidade, o que medir na sua fronteira em vez de na do provedor e quando o dublê deixa de servir e você precisa gastar dinheiro de verdade.',
  sections: [
    {
      title: 'O que você está medindo quando chama o provedor de verdade',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O primeiro problema de rodar teste de carga contra a API real não é o custo, é a atribuição. Quando você dispara mil requisições por minuto e observa a latência subir, existem pelo menos três explicações possíveis e o teste não separa nenhuma delas: o seu sistema está saturado, a sua cota no provedor está estourando, ou o provedor está com um dia ruim para todo mundo. As três produzem o mesmo gráfico. Como você não controla duas dessas variáveis e nem consegue observá-las direito, o resultado é um teste que não é reproduzível: rodar de novo na terça dá um número diferente de rodar na quinta, e nenhuma das duas execuções diz se a mudança que você fez no código melhorou ou piorou alguma coisa.',
        },
        {
          type: 'paragraph',
          value:
            'O segundo problema é que o rate limit do provedor funciona como um teto artificial que esconde o comportamento que você queria observar. Se a sua cota é de trezentas requisições por minuto e você quer testar o sistema a mil, o provedor devolve erro de limite nas setecentas excedentes, e o teste passa a exercitar o seu caminho de tratamento de erro em vez do seu caminho de sucesso sob carga. É um teste válido, mas é outro teste. A pergunta original, se a aplicação aguenta mil requisições por minuto de trabalho real, continua sem resposta, e o único jeito honesto de respondê-la é remover o teto: substituir o provedor por algo que aceita a carga toda e devolve respostas com o mesmo formato e o mesmo perfil de tempo.',
        },
        {
          type: 'table',
          columns: ['Abordagem', 'O que ela mede de verdade', 'Custo', 'Reprodutível'],
          rows: [
            [
              'Chamar a API real com carga total',
              'O rate limit da sua conta, misturado com o seu sistema',
              'Alto e proporcional à carga',
              'Não: depende do dia do provedor',
            ],
            [
              'Carga reduzida e extrapolar',
              'O regime linear, justamente onde não há problema',
              'Baixo',
              'Sim, mas responde a pergunta errada',
            ],
            [
              'Dublê com latência constante',
              'O sistema num cenário que nunca acontece',
              'Zero',
              'Sim, e enganosamente otimista',
            ],
            [
              'Dublê com perfil de latência e falha realista',
              'O seu sistema, isolado, na carga que você escolheu',
              'Zero',
              'Sim, e comparável entre execuções',
            ],
          ],
        },
      ],
    },
    {
      title: 'A latência constante é o erro que invalida tudo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O dublê ingênuo devolve uma resposta fixa depois de esperar um tempo fixo, e é isso que transforma o teste de carga num teatro. A latência de um LLM não é uma constante, é uma distribuição de cauda longa: a maioria das respostas chega perto da mediana e uma fração pequena demora várias vezes mais. Essa cauda é o que faz o sistema quebrar. Com latência constante, a sua fila nunca acumula, porque cada worker libera no mesmo ritmo previsível; com latência de cauda longa, alguns workers ficam presos em respostas lentas enquanto a fila cresce atrás deles, e é exatamente aí que o pool esgota, o timeout dispara e o backpressure precisa entrar em ação. Um teste com latência constante passa com folga num sistema que vai cair na primeira sexta-feira movimentada.',
        },
        {
          type: 'paragraph',
          value:
            'A latência de um LLM também não é independente do pedido, e isso importa mais do que parece. O tempo até o primeiro token depende do tamanho do prompt, e o tempo total depende principalmente de quantos tokens a resposta tem, porque a geração é sequencial. Um dublê que ignora isso e sorteia um tempo aleatório qualquer perde a correlação que produz os piores casos reais: as requisições com mais contexto tendem a ser as que geram respostas mais longas, então o pico de carga tende a coincidir com o pico de duração, e não a se cancelar. Modelar tempo até o primeiro token em função do tamanho do prompt e depois um tempo por token na geração reproduz essa correlação sem nenhuma sofisticação estatística.',
        },
        {
          type: 'code',
          value: `// test/fake-llm/latency.js
// A latencia de um LLM tem duas fases com causas diferentes:
// TTFT cresce com o prompt (prefill), e a geracao e sequencial
// por token. Modelar isso reproduz a correlacao que quebra o sistema.

export function sampleLatency(request, profile, rng) {
  const promptTokens = estimateTokens(request.messages);
  const outputTokens = sampleOutputTokens(profile.outputTokens, rng);

  // Prefill: cresce com o tamanho do prompt, com um piso de rede.
  const ttft =
    profile.networkFloorMs +
    profile.prefillMsPerKToken * (promptTokens / 1000) +
    lognormalJitter(profile.ttftJitter, rng);

  // Geracao: sequencial, entao o total cresce com os tokens de saida.
  const perToken = profile.msPerOutputToken * lognormal(profile.tokenJitter, rng);

  // A cauda longa e o que quebra o sistema. Sem ela o teste passa
  // com folga e a producao cai na primeira sexta movimentada.
  const isSlowTail = rng() < profile.slowTailRate;
  const tailFactor = isSlowTail ? profile.slowTailFactor : 1;

  return {
    ttftMs: ttft * tailFactor,
    totalMs: (ttft + perToken * outputTokens) * tailFactor,
    outputTokens,
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'De onde tirar os números do perfil é a parte que costuma travar o time, e a resposta é mais simples do que parece: da produção, se você já tem tráfego, ou de uma amostra pequena e barata contra a API real, se ainda não tem. Bastam algumas centenas de chamadas com prompts representativos para estimar o piso de rede, o custo por mil tokens de prompt, o tempo por token de saída e a fração de respostas na cauda. Isso custa alguns centavos e vale para milhões de requisições simuladas. O perfil deve ser um arquivo versionado no repositório, com data de coleta, porque ele envelhece: o provedor muda de infraestrutura, você troca de modelo, e um perfil de seis meses atrás descreve um sistema que não existe mais.',
        },
      ],
    },
    {
      title: 'Simular o comportamento ruim, não só o bom',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um dublê que só responde com sucesso testa metade do sistema. Sob carga, o provedor real erra de maneiras específicas, e cada uma delas exercita um caminho diferente do seu código: o erro de limite de taxa, que vem com uma indicação de quanto esperar e deveria alimentar o seu backoff; o erro transitório de servidor, que justifica retentativa; o erro de contexto excedido, que nunca deve ser retentado porque vai falhar igual; e o pior de todos, a resposta que começa a transmitir e morre no meio, deixando o seu cliente com um texto truncado e uma conexão pendurada. Se o dublê não produz esses casos, o teste de carga mede o desempenho de um sistema que só existe em condições ideais.',
        },
        {
          type: 'paragraph',
          value:
            'A injeção de falha precisa ser determinística para o teste servir de comparação entre execuções. Falha aleatória com semente fixa dá as duas coisas ao mesmo tempo: a distribuição parece realista e a sequência é idêntica em toda execução, então quando você muda o código e o resultado muda, a diferença é sua e não do acaso. Vale expor a semente e a taxa de cada tipo de falha como configuração do cenário, porque assim o mesmo dublê serve para o teste de carga em regime normal, para o teste de resiliência com quinze por cento de erro e para o exercício de modo degradado com o provedor totalmente fora.',
        },
        {
          type: 'table',
          columns: ['Modo de falha', 'O que deve exercitar no seu sistema', 'Sinal de que passou'],
          rows: [
            [
              'Erro de limite de taxa com tempo de espera',
              'Backoff que respeita o valor indicado, sem retentar na hora',
              'A vazão cai e se recupera, sem tempestade de retentativa',
            ],
            [
              'Erro transitório de servidor',
              'Retentativa com teto de tentativas e jitter',
              'Latência sobe no percentil alto, taxa de sucesso se mantém',
            ],
            [
              'Contexto excedido',
              'Falha imediata sem retentativa, com resposta útil ao usuário',
              'Zero retentativas nesse caminho, erro tratado na borda',
            ],
            [
              'Stream que morre no meio',
              'Detecção de resposta truncada e limpeza da conexão',
              'Nenhuma conexão pendurada, resposta parcial não vira final',
            ],
            [
              'Provedor totalmente fora',
              'Disjuntor abre e o modo degradado assume',
              'Fila não cresce sem limite, cliente recebe resposta útil',
            ],
            [
              'Provedor lento, sem erro',
              'Timeout com deadline e cancelamento propagado',
              'Trabalho vencido é cancelado, não continua rodando para ninguém',
            ],
          ],
        },
      ],
    },
    {
      title: 'Streaming muda a forma do teste',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Se a sua aplicação usa streaming, o dublê que devolve a resposta inteira de uma vez apaga a característica mais importante do sistema sob carga: a conexão fica aberta durante toda a geração. Numa API tradicional, a requisição ocupa um slot por alguns milissegundos; com streaming, ela ocupa por vários segundos, e o número de conexões simultâneas passa a ser o recurso escasso em vez da taxa de requisições. Um sistema que aguenta mil requisições por minuto sem streaming pode esgotar file descriptors muito antes disso com streaming, e o dublê precisa emitir os eventos ao longo do tempo, no ritmo de tokens do perfil, para que esse custo apareça no teste.',
        },
        {
          type: 'code',
          value: `// test/fake-llm/stream.js
// O dublê emite eventos ao longo do tempo, no ritmo de tokens do
// perfil. Sem isso, a conexao nao fica aberta e o teste nao mede
// o recurso que realmente escasseia com streaming: conexao simultanea.

export async function streamResponse(res, request, profile, rng) {
  const { ttftMs, totalMs, outputTokens } = sampleLatency(request, profile, rng);
  const perTokenMs = (totalMs - ttftMs) / Math.max(outputTokens, 1);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  await sleep(ttftMs);

  // Falha no meio do stream: o caso que o dublê ingenuo nunca produz
  // e que deixa conexao pendurada e resposta truncada em producao.
  const dropAt = rng() < profile.midStreamDropRate
    ? Math.floor(rng() * outputTokens)
    : -1;

  for (let i = 0; i < outputTokens; i += 1) {
    if (i === dropAt) {
      res.destroy(); // encerra sem evento de fim, de proposito
      return { outcome: 'mid_stream_drop', tokensSent: i };
    }

    res.write(\`data: \${JSON.stringify({ delta: nextToken(rng) })}\\n\\n\`);
    await sleep(perTokenMs);
  }

  res.write('data: [DONE]\\n\\n');
  res.end();
  return { outcome: 'complete', tokensSent: outputTokens };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Onde inserir o dublê também é uma decisão de fidelidade. Substituir o cliente do provedor por um objeto falso dentro do processo é o mais fácil e o menos fiel, porque remove serialização, rede, pool de conexões e o próprio custo de manter a conexão aberta, que é justamente o que você quer medir. Subir o dublê como um servidor de verdade e apontar a variável de ambiente da URL base para ele mantém todo o caminho intacto e troca apenas quem responde do outro lado. O segundo custa alguns minutos a mais de infraestrutura de teste e é o único que responde a pergunta que motivou o teste.',
        },
      ],
    },
    {
      title: 'O que medir, e do lado certo da fronteira',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com o provedor substituído, as métricas que importam deixam de ser as dele e passam a ser as suas. A latência da chamada ao dublê é conhecida por construção, você mesmo a definiu, então medi-la não informa nada. O que informa é o que acontece entre a borda da sua aplicação e essa chamada: quanto tempo a requisição passou na fila antes de virar chamada, quantos workers estavam ocupados, quantas conexões simultâneas o processo sustentou, quanta memória a fila consumiu no pico e quantas requisições foram recusadas na entrada porque o sistema aplicou o freio. É essa a diferença entre um teste de carga que produz um número e um que produz uma decisão.',
        },
        {
          type: 'ordered',
          items: [
            'Tempo de espera na fila separado do tempo de chamada, porque a soma esconde qual dos dois está estourando o orçamento de tempo do cliente.',
            'Profundidade máxima da fila e memória no pico, que dizem quanto tempo o sistema aguenta um pico antes de estourar em vez de degradar.',
            'Conexões simultâneas sustentadas, que com streaming costumam esgotar antes da CPU e antes da taxa de requisições.',
            'Taxa de recusa na borda e o código devolvido, para confirmar que o freio está atuando na entrada e não deixando a fila crescer sem limite.',
            'Latência no percentil alto ponta a ponta, não a média, porque a média some com a cauda que é exatamente o que quebra a experiência.',
            'Trabalho cancelado corretamente quando o cliente desiste, medido como chamadas abortadas sobre desistências, que deveria ser praticamente um.',
          ],
        },
        {
          type: 'diagram',
          value: `Teste de carga com dublê de provedor: onde medir

  gerador de carga (perfil de trafego real, nao rajada uniforme)
     |
     v
  [ borda da aplicacao ] <-- MEDIR: taxa de recusa, codigo devolvido
     |
     v
  [ fila ] <----------------- MEDIR: tempo de espera, profundidade, memoria
     |
     v
  [ pool de workers ] <------ MEDIR: ocupacao, conexoes simultaneas
     |
     v
  ================= FRONTEIRA =================
     |
     v
  [ dublê do provedor ]   <-- NAO medir: a latencia daqui voce definiu
     |
     +-- TTFT em funcao do tamanho do prompt
     +-- tempo por token na geracao (streaming real, evento a evento)
     +-- cauda longa com fracao configurada
     +-- falhas deterministicas por semente:
           limite de taxa / transitorio / contexto excedido
           stream que morre no meio / provedor fora / provedor lento

  Resultado util: "a fila estoura em X req/min com Y de memoria"
  Resultado inutil: "a latencia media foi Z" (voce mesmo escolheu Z)`,
        },
        {
          type: 'paragraph',
          value:
            'O gerador de carga também merece cuidado, porque a rajada uniforme é irreal e otimista. Tráfego de atendimento chega em ondas, com correlação entre chegadas, e o mesmo volume total distribuído em ondas produz picos de fila que a distribuição uniforme nunca alcança. Vale ainda modelar o comportamento do cliente que desiste: uma fração das conversas é abandonada antes da resposta chegar, e se o seu sistema não cancela o trabalho correspondente, ele continua queimando worker e token para ninguém, o que sob carga é uma forma silenciosa de amplificar a sobrecarga.',
        },
      ],
    },
    {
      title: 'Onde o dublê deixa de servir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O dublê responde perguntas sobre o seu sistema e não responde nenhuma pergunta sobre o provedor. Se o que você precisa saber é qual a cota real da sua conta, como o provedor se comporta quando você passa dela, se a latência dele piora nos horários de pico globais ou se o modelo novo é mais lento que o antigo, nenhuma simulação substitui uma medição contra a API real. A diferença é que essas perguntas se respondem com um teste pequeno e barato, de algumas centenas de chamadas, e não com um teste de carga de dez mil. A divisão saudável é usar a API real para calibrar o perfil e validar suposições, e usar o dublê para tudo que envolve volume.',
        },
        {
          type: 'paragraph',
          value:
            'Também vale ter uma execução periódica de fumaça contra a API real, pequena e barata, com dois objetivos. O primeiro é detectar deriva do perfil: se a latência medida na amostra afastou do que o dublê simula, o seu teste de carga está descrevendo um provedor que não existe mais e precisa ser recalibrado. O segundo é pegar mudança de contrato, porque o dublê responde no formato que você programou nele, e se o provedor mudar um campo ou a semântica de um erro, o seu teste continuará passando alegremente enquanto a produção quebra. Um dublê bem calibrado é uma ferramenta poderosa, e é também uma foto do provedor num instante do passado.',
        },
        {
          type: 'list',
          items: [
            'Calibração do perfil: precisa de API real, com amostra pequena, e deve ser refeita quando o modelo ou o provedor mudar.',
            'Descoberta de cota e comportamento no limite: API real, porque é uma propriedade da sua conta e não do seu código.',
            'Qualidade de resposta e regressão de prompt: fora do escopo do teste de carga, é avaliação, e o dublê não tem opinião sobre conteúdo.',
            'Capacidade, fila, memória, conexões e freio na borda: dublê, porque é o seu sistema que está sendo medido e o volume é caro.',
            'Contrato da API e formato de erro: teste de contrato contra a API real, periódico, para o dublê não virar ficção.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que não rodar o teste de carga direto contra a API do provedor?',
      answer:
        'Por dois motivos, e o custo é o menos importante deles. O primeiro é atribuição: quando a latência sobe, o teste não separa se o seu sistema saturou, se a sua cota estourou ou se o provedor está com um dia ruim, e você só controla uma dessas variáveis. O segundo é que o rate limit da sua conta vira um teto artificial: se a cota é de trezentas requisições por minuto e você quer testar mil, o provedor recusa as excedentes e o teste passa a exercitar o caminho de erro em vez do caminho de sucesso sob carga, deixando a pergunta original sem resposta. Substituir o provedor por um dublê remove o teto e torna o teste reproduzível entre execuções, que é o que permite comparar antes e depois de uma mudança.',
    },
    {
      question: 'Um dublê com latência fixa não é suficiente?',
      answer:
        'Não, e esse é o erro que invalida o teste inteiro. A latência de um LLM é uma distribuição de cauda longa, e é a cauda que quebra o sistema: com tempo constante cada worker libera no mesmo ritmo e a fila nunca acumula, enquanto com cauda longa alguns workers ficam presos em respostas lentas e a fila cresce atrás deles, que é exatamente quando o pool esgota e o timeout dispara. Além disso a latência não é independente do pedido: o tempo até o primeiro token cresce com o tamanho do prompt e o tempo total cresce com os tokens gerados, então prompts maiores tendem a gerar respostas mais longas e os picos se somam em vez de se cancelar. Modelar essas duas fases mais uma fração de cauda já reproduz o comportamento que importa.',
    },
    {
      question: 'Como calibrar o perfil de latência sem gastar muito?',
      answer:
        'Com uma amostra pequena contra a API real, de algumas centenas de chamadas com prompts representativos do seu tráfego, ou direto da sua produção se você já tem volume. Isso basta para estimar o piso de rede, o custo por mil tokens de prompt, o tempo por token de saída e a fração de respostas na cauda, custa alguns centavos e vale para milhões de requisições simuladas depois. O perfil deve ficar versionado no repositório com a data de coleta, porque envelhece: o provedor muda de infraestrutura e você troca de modelo. Vale manter uma execução periódica de fumaça contra a API real para detectar quando o perfil derivou e para pegar mudança de contrato, já que o dublê responde no formato que você programou nele.',
    },
  ],
  conclusion: {
    title: 'Teste de carga bom mede o seu sistema, não a conta do provedor',
    description:
      'Chamar a API real sob carga mistura três variáveis que você não consegue separar e cobra caro para produzir um número que não se repete na semana seguinte. Substituir o provedor por um dublê que modela as duas fases da latência, reproduz a cauda longa, emite streaming evento a evento e injeta falha determinística por semente devolve ao teste a propriedade que ele precisa ter: isolar o seu sistema e ser comparável entre execuções. Com isso, as métricas que interessam passam a ser tempo de fila, profundidade, memória no pico, conexões simultâneas e taxa de recusa na borda, que são as que dizem em qual volume o sistema degrada e em qual ele quebra. Posso montar esse harness no seu projeto, calibrando o perfil com uma amostra barata da sua própria produção, modelando os modos de falha que importam e desenhando o cenário de carga que reproduz a sua sexta-feira movimentada, para você saber o limite antes de encontrá-lo ao vivo.',
    cta: 'Falar sobre teste de carga no meu sistema com LLM',
  },
  related: [
    { label: 'Backpressure em pipeline de IA: quando o consumidor não acompanha', to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha' },
    { label: 'Timeout e cancelamento em cadeia de chamadas de LLM', to: '/blog/timeout-cancelamento-cadeia-chamadas-llm' },
    { label: 'Modo degradado: manter o atendimento quando a IA está indisponível', to: '/blog/modo-degradado-manter-atendimento-quando-ia-indisponivel' },
  ],
};

const en = {
  intro:
    'You want to know whether the system survives Friday campaign, and the load test hits a wall of cost: every test request calls the real provider, and simulating ten thousand conversations costs the price of ten thousand conversations. Worse, the test hits your account rate limit long before it hits your application limit, so you end up measuring the provider ceiling instead of your system. The way out is not testing with less load and extrapolating, because the problems load testing exists to find appear exactly in the region extrapolation cannot reach: the queue that grows, the connection pool that runs out, the timeout that only fires when the provider gets slow. The way out is replacing the provider with a stand-in that behaves like it, including on its bad moments. This article is about that: what exactly needs to be simulated, why constant latency is the mistake that invalidates the whole test, how to reproduce streaming, errors and rate limiting faithfully, what to measure on your side of the boundary instead of the provider side and when the stand-in stops serving and you have to spend real money.',
  sections: [
    {
      title: 'What you are measuring when you call the real provider',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first problem with running a load test against the real API is not cost, it is attribution. When you fire a thousand requests per minute and watch latency rise, there are at least three possible explanations and the test separates none of them: your system is saturated, your provider quota is being exceeded, or the provider is having a bad day for everyone. All three produce the same chart. Since you control two of those variables not at all and cannot properly observe them either, the result is a test that is not reproducible: running it again on Tuesday gives a different number than running it on Thursday, and neither run tells you whether the change you made to the code improved or worsened anything.',
        },
        {
          type: 'paragraph',
          value:
            'The second problem is that the provider rate limit acts as an artificial ceiling that hides the very behavior you wanted to observe. If your quota is three hundred requests per minute and you want to test the system at a thousand, the provider returns a limit error on the seven hundred excess ones, and the test starts exercising your error handling path instead of your success path under load. It is a valid test, but it is a different test. The original question, whether the application survives a thousand requests per minute of real work, remains unanswered, and the only honest way to answer it is to remove the ceiling: replace the provider with something that accepts the whole load and returns responses with the same shape and the same timing profile.',
        },
        {
          type: 'table',
          columns: ['Approach', 'What it actually measures', 'Cost', 'Reproducible'],
          rows: [
            [
              'Calling the real API at full load',
              'Your account rate limit, mixed in with your system',
              'High and proportional to the load',
              'No: depends on the provider day',
            ],
            [
              'Reduced load and extrapolate',
              'The linear regime, exactly where there is no problem',
              'Low',
              'Yes, but it answers the wrong question',
            ],
            [
              'Stand-in with constant latency',
              'The system in a scenario that never happens',
              'Zero',
              'Yes, and misleadingly optimistic',
            ],
            [
              'Stand-in with a realistic latency and failure profile',
              'Your system, isolated, at the load you chose',
              'Zero',
              'Yes, and comparable across runs',
            ],
          ],
        },
      ],
    },
    {
      title: 'Constant latency is the mistake that invalidates everything',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The naive stand-in returns a fixed response after waiting a fixed time, and that is what turns the load test into theater. LLM latency is not a constant, it is a long-tail distribution: most responses arrive near the median and a small fraction takes several times longer. That tail is what breaks the system. With constant latency your queue never accumulates, because every worker frees up at the same predictable pace; with long-tail latency some workers get stuck on slow responses while the queue grows behind them, and that is exactly when the pool runs out, the timeout fires and backpressure has to kick in. A test with constant latency passes comfortably on a system that will fall over on the first busy Friday.',
        },
        {
          type: 'paragraph',
          value:
            'LLM latency is also not independent of the request, and that matters more than it seems. Time to first token depends on prompt size, and total time depends mostly on how many tokens the answer has, because generation is sequential. A stand-in that ignores this and draws some arbitrary random time loses the correlation that produces the real worst cases: requests with more context tend to be the ones generating longer answers, so the load peak tends to coincide with the duration peak rather than cancel it out. Modeling time to first token as a function of prompt size and then a per-token time during generation reproduces that correlation with no statistical sophistication at all.',
        },
        {
          type: 'code',
          value: `// test/fake-llm/latency.js
// LLM latency has two phases with different causes: TTFT grows
// with the prompt (prefill), and generation is sequential per
// token. Modeling this reproduces the correlation that breaks things.

export function sampleLatency(request, profile, rng) {
  const promptTokens = estimateTokens(request.messages);
  const outputTokens = sampleOutputTokens(profile.outputTokens, rng);

  // Prefill: grows with prompt size, with a network floor.
  const ttft =
    profile.networkFloorMs +
    profile.prefillMsPerKToken * (promptTokens / 1000) +
    lognormalJitter(profile.ttftJitter, rng);

  // Generation: sequential, so the total grows with output tokens.
  const perToken = profile.msPerOutputToken * lognormal(profile.tokenJitter, rng);

  // The long tail is what breaks the system. Without it the test
  // passes comfortably and production falls on the first busy Friday.
  const isSlowTail = rng() < profile.slowTailRate;
  const tailFactor = isSlowTail ? profile.slowTailFactor : 1;

  return {
    ttftMs: ttft * tailFactor,
    totalMs: (ttft + perToken * outputTokens) * tailFactor,
    outputTokens,
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Where to get the profile numbers is the part that usually stalls the team, and the answer is simpler than it looks: from production, if you already have traffic, or from a small and cheap sample against the real API, if you do not yet. A few hundred calls with representative prompts are enough to estimate the network floor, the cost per thousand prompt tokens, the time per output token and the fraction of responses in the tail. That costs a few cents and holds for millions of simulated requests. The profile should be a file versioned in the repository, with a collection date, because it ages: the provider changes infrastructure, you switch models, and a profile from six months ago describes a system that no longer exists.',
        },
      ],
    },
    {
      title: 'Simulate the bad behavior, not only the good',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A stand-in that only answers successfully tests half the system. Under load, the real provider fails in specific ways, and each one exercises a different path in your code: the rate limit error, which comes with an indication of how long to wait and should feed your backoff; the transient server error, which justifies a retry; the context exceeded error, which must never be retried because it will fail the same way; and the worst of all, the response that starts streaming and dies in the middle, leaving your client with truncated text and a hanging connection. If the stand-in does not produce these cases, the load test measures the performance of a system that only exists under ideal conditions.',
        },
        {
          type: 'paragraph',
          value:
            'Failure injection has to be deterministic for the test to work as a comparison across runs. Random failure with a fixed seed gives both things at once: the distribution looks realistic and the sequence is identical on every run, so when you change the code and the result changes, the difference is yours and not chance. It is worth exposing the seed and the rate of each failure type as scenario configuration, because then the same stand-in serves the load test in normal regime, the resilience test with fifteen percent errors and the degraded mode exercise with the provider entirely down.',
        },
        {
          type: 'table',
          columns: ['Failure mode', 'What it should exercise in your system', 'Sign that it passed'],
          rows: [
            [
              'Rate limit error with a wait hint',
              'Backoff that honors the given value, no immediate retry',
              'Throughput drops and recovers, with no retry storm',
            ],
            [
              'Transient server error',
              'Retry with an attempt ceiling and jitter',
              'High percentile latency rises, success rate holds',
            ],
            [
              'Context exceeded',
              'Immediate failure with no retry and a useful user response',
              'Zero retries on that path, error handled at the edge',
            ],
            [
              'Stream that dies mid-response',
              'Detection of a truncated answer and connection cleanup',
              'No hanging connections, a partial answer never becomes final',
            ],
            [
              'Provider entirely down',
              'Circuit breaker opens and degraded mode takes over',
              'Queue does not grow unbounded, customer gets a useful answer',
            ],
            [
              'Provider slow, no errors',
              'Timeout with a deadline and propagated cancellation',
              'Expired work is cancelled, it does not keep running for nobody',
            ],
          ],
        },
      ],
    },
    {
      title: 'Streaming changes the shape of the test',
      blocks: [
        {
          type: 'paragraph',
          value:
            'If your application uses streaming, a stand-in that returns the whole answer at once erases the most important characteristic of the system under load: the connection stays open for the entire generation. In a traditional API the request occupies a slot for a few milliseconds; with streaming it occupies one for several seconds, and the number of concurrent connections becomes the scarce resource instead of the request rate. A system that survives a thousand requests per minute without streaming may run out of file descriptors well before that with streaming, and the stand-in has to emit events over time, at the token pace from the profile, so that cost shows up in the test.',
        },
        {
          type: 'code',
          value: `// test/fake-llm/stream.js
// The stand-in emits events over time, at the token pace from the
// profile. Without that the connection does not stay open and the
// test misses the resource that truly gets scarce: concurrent conns.

export async function streamResponse(res, request, profile, rng) {
  const { ttftMs, totalMs, outputTokens } = sampleLatency(request, profile, rng);
  const perTokenMs = (totalMs - ttftMs) / Math.max(outputTokens, 1);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  await sleep(ttftMs);

  // Mid-stream failure: the case the naive stand-in never produces
  // and that leaves hanging connections and truncated answers in prod.
  const dropAt = rng() < profile.midStreamDropRate
    ? Math.floor(rng() * outputTokens)
    : -1;

  for (let i = 0; i < outputTokens; i += 1) {
    if (i === dropAt) {
      res.destroy(); // ends with no terminating event, on purpose
      return { outcome: 'mid_stream_drop', tokensSent: i };
    }

    res.write(\`data: \${JSON.stringify({ delta: nextToken(rng) })}\\n\\n\`);
    await sleep(perTokenMs);
  }

  res.write('data: [DONE]\\n\\n');
  res.end();
  return { outcome: 'complete', tokensSent: outputTokens };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Where to insert the stand-in is also a fidelity decision. Replacing the provider client with a fake object inside the process is the easiest and the least faithful, because it removes serialization, the network, the connection pool and the very cost of keeping the connection open, which is exactly what you want to measure. Standing the stand-in up as a real server and pointing the base URL environment variable at it keeps the whole path intact and swaps only who answers on the other side. The second costs a few extra minutes of test infrastructure and is the only one that answers the question that motivated the test.',
        },
      ],
    },
    {
      title: 'What to measure, and on the right side of the boundary',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the provider replaced, the metrics that matter stop being its and become yours. The latency of the call to the stand-in is known by construction, you defined it yourself, so measuring it tells you nothing. What tells you something is what happens between the edge of your application and that call: how long the request spent in the queue before becoming a call, how many workers were busy, how many concurrent connections the process sustained, how much memory the queue consumed at peak and how many requests were refused at the entrance because the system applied the brake. That is the difference between a load test that produces a number and one that produces a decision.',
        },
        {
          type: 'ordered',
          items: [
            'Queue wait time separated from call time, because the sum hides which of the two is blowing the customer time budget.',
            'Maximum queue depth and peak memory, which tell how long the system survives a spike before bursting instead of degrading.',
            'Sustained concurrent connections, which with streaming tend to run out before CPU and before request rate.',
            'Edge refusal rate and the returned status, to confirm the brake acts at the entrance instead of letting the queue grow unbounded.',
            'High percentile end-to-end latency, not the average, because the average hides the tail that is exactly what breaks the experience.',
            'Work properly cancelled when the customer gives up, measured as aborted calls over abandonments, which should be practically one.',
          ],
        },
        {
          type: 'diagram',
          value: `Load testing with a provider stand-in: where to measure

  load generator (real traffic shape, not a uniform burst)
     |
     v
  [ application edge ] <----- MEASURE: refusal rate, returned status
     |
     v
  [ queue ] <---------------- MEASURE: wait time, depth, memory
     |
     v
  [ worker pool ] <---------- MEASURE: occupancy, concurrent connections
     |
     v
  ================= BOUNDARY =================
     |
     v
  [ provider stand-in ]   <-- DO NOT measure: you defined this latency
     |
     +-- TTFT as a function of prompt size
     +-- per-token time during generation (real streaming, event by event)
     +-- long tail with a configured fraction
     +-- deterministic failures by seed:
           rate limit / transient / context exceeded
           mid-stream drop / provider down / provider slow

  Useful result: "the queue bursts at X req/min with Y of memory"
  Useless result: "average latency was Z" (you picked Z yourself)`,
        },
        {
          type: 'paragraph',
          value:
            'The load generator also deserves care, because the uniform burst is unrealistic and optimistic. Support traffic arrives in waves, with correlation between arrivals, and the same total volume spread in waves produces queue peaks the uniform distribution never reaches. It is also worth modeling the customer who gives up: a fraction of conversations is abandoned before the answer arrives, and if your system does not cancel the corresponding work, it keeps burning workers and tokens for nobody, which under load is a silent way of amplifying the overload.',
        },
      ],
    },
    {
      title: 'Where the stand-in stops serving',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The stand-in answers questions about your system and answers no question about the provider. If what you need to know is your account real quota, how the provider behaves when you exceed it, whether its latency worsens during global peak hours or whether the new model is slower than the old one, no simulation replaces a measurement against the real API. The difference is that those questions are answered with a small cheap test of a few hundred calls, not with a ten thousand request load test. The healthy split is to use the real API to calibrate the profile and validate assumptions, and use the stand-in for everything involving volume.',
        },
        {
          type: 'paragraph',
          value:
            'It is also worth having a periodic smoke run against the real API, small and cheap, with two goals. The first is detecting profile drift: if the latency measured in the sample has moved away from what the stand-in simulates, your load test is describing a provider that no longer exists and needs recalibration. The second is catching contract changes, because the stand-in answers in the format you programmed into it, and if the provider changes a field or the semantics of an error, your test will keep passing happily while production breaks. A well-calibrated stand-in is a powerful tool, and it is also a snapshot of the provider at one instant in the past.',
        },
        {
          type: 'list',
          items: [
            'Profile calibration: needs the real API, with a small sample, and must be redone when the model or the provider changes.',
            'Quota discovery and behavior at the limit: real API, because it is a property of your account and not of your code.',
            'Answer quality and prompt regression: outside the scope of load testing, that is evaluation, and the stand-in has no opinion about content.',
            'Capacity, queue, memory, connections and edge braking: stand-in, because it is your system being measured and volume is expensive.',
            'API contract and error format: contract testing against the real API, periodically, so the stand-in does not become fiction.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why not run the load test straight against the provider API?',
      answer:
        'For two reasons, and cost is the least important of them. The first is attribution: when latency rises, the test does not separate whether your system saturated, your quota was exceeded or the provider is having a bad day, and you only control one of those variables. The second is that your account rate limit becomes an artificial ceiling: if the quota is three hundred requests per minute and you want to test a thousand, the provider refuses the excess and the test starts exercising the error path instead of the success path under load, leaving the original question unanswered. Replacing the provider with a stand-in removes the ceiling and makes the test reproducible across runs, which is what lets you compare before and after a change.',
    },
    {
      question: 'Is a stand-in with fixed latency not enough?',
      answer:
        'No, and that is the mistake that invalidates the whole test. LLM latency is a long-tail distribution, and it is the tail that breaks the system: with constant time every worker frees up at the same pace and the queue never accumulates, while with a long tail some workers get stuck on slow responses and the queue grows behind them, which is exactly when the pool runs out and the timeout fires. Latency is also not independent of the request: time to first token grows with prompt size and total time grows with generated tokens, so larger prompts tend to produce longer answers and the peaks add up instead of cancelling out. Modeling those two phases plus a tail fraction already reproduces the behavior that matters.',
    },
    {
      question: 'How do I calibrate the latency profile without spending much?',
      answer:
        'With a small sample against the real API, a few hundred calls using prompts representative of your traffic, or straight from your production if you already have volume. That is enough to estimate the network floor, the cost per thousand prompt tokens, the time per output token and the fraction of responses in the tail, costs a few cents and holds for millions of simulated requests afterwards. The profile should be versioned in the repository with its collection date, because it ages: the provider changes infrastructure and you switch models. It is worth keeping a periodic smoke run against the real API to detect when the profile has drifted and to catch contract changes, since the stand-in answers in the format you programmed into it.',
    },
  ],
  conclusion: {
    title: 'A good load test measures your system, not the provider invoice',
    description:
      'Calling the real API under load mixes three variables you cannot separate and charges heavily to produce a number that does not repeat the following week. Replacing the provider with a stand-in that models both latency phases, reproduces the long tail, emits streaming event by event and injects deterministic failures by seed gives the test back the property it needs to have: isolating your system and being comparable across runs. With that, the metrics that matter become queue time, depth, peak memory, concurrent connections and edge refusal rate, which are the ones that tell at what volume the system degrades and at what volume it breaks. I can build this harness in your project, calibrating the profile with a cheap sample from your own production, modeling the failure modes that matter and designing the load scenario that reproduces your busy Friday, so you know the limit before finding it live.',
    cta: 'Talk about load testing my LLM system',
  },
  related: [
    { label: 'Backpressure in an AI pipeline: when the consumer cannot keep up', to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha' },
    { label: 'Timeout and cancellation across a chain of LLM calls', to: '/blog/timeout-cancelamento-cadeia-chamadas-llm' },
    { label: 'Degraded mode: keeping support standing when the AI is unavailable', to: '/blog/modo-degradado-manter-atendimento-quando-ia-indisponivel' },
  ],
};

const es = {
  intro:
    'Quieres saber si el sistema aguanta la campaña del viernes, y la prueba de carga choca contra una pared de costo: cada petición de la prueba llama al proveedor de verdad, y simular diez mil conversaciones cuesta el precio de diez mil conversaciones. Peor, la prueba golpea el rate limit de tu cuenta mucho antes de golpear el límite de tu aplicación, así que terminas midiendo el techo del proveedor en vez de medir tu sistema. La salida no es probar con carga menor y extrapolar, porque los problemas que la prueba de carga existe para encontrar aparecen justamente en la región que la extrapolación no alcanza: la cola que crece, el pool de conexiones que se agota, el timeout que solo dispara cuando el proveedor se pone lento. La salida es sustituir al proveedor por un doble que se comporta como él, incluso en sus momentos malos. Este artículo trata de eso: qué exactamente hay que simular, por qué la latencia constante es el error que invalida la prueba entera, cómo reproducir streaming, error y rate limit con fidelidad, qué medir en tu lado de la frontera en vez del lado del proveedor y cuándo el doble deja de servir y tienes que gastar dinero de verdad.',
  sections: [
    {
      title: 'Qué estás midiendo cuando llamas al proveedor de verdad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El primer problema de correr la prueba de carga contra la API real no es el costo, es la atribución. Cuando disparas mil peticiones por minuto y ves subir la latencia, existen al menos tres explicaciones posibles y la prueba no separa ninguna: tu sistema está saturado, tu cuota en el proveedor se está excediendo, o el proveedor tiene un mal día para todo el mundo. Las tres producen el mismo gráfico. Como no controlas dos de esas variables y tampoco logras observarlas bien, el resultado es una prueba que no es reproducible: correrla de nuevo el martes da un número distinto que correrla el jueves, y ninguna de las dos ejecuciones dice si el cambio que hiciste en el código mejoró o empeoró algo.',
        },
        {
          type: 'paragraph',
          value:
            'El segundo problema es que el rate limit del proveedor funciona como un techo artificial que esconde el comportamiento que querías observar. Si tu cuota es de trescientas peticiones por minuto y quieres probar el sistema a mil, el proveedor devuelve error de límite en las setecientas excedentes, y la prueba pasa a ejercitar tu camino de manejo de error en vez de tu camino de éxito bajo carga. Es una prueba válida, pero es otra prueba. La pregunta original, si la aplicación aguanta mil peticiones por minuto de trabajo real, sigue sin respuesta, y la única forma honesta de responderla es quitar el techo: sustituir al proveedor por algo que acepta toda la carga y devuelve respuestas con el mismo formato y el mismo perfil de tiempo.',
        },
        {
          type: 'table',
          columns: ['Enfoque', 'Qué mide de verdad', 'Costo', 'Reproducible'],
          rows: [
            [
              'Llamar a la API real con carga total',
              'El rate limit de tu cuenta, mezclado con tu sistema',
              'Alto y proporcional a la carga',
              'No: depende del día del proveedor',
            ],
            [
              'Carga reducida y extrapolar',
              'El régimen lineal, justo donde no hay problema',
              'Bajo',
              'Sí, pero responde la pregunta equivocada',
            ],
            [
              'Doble con latencia constante',
              'El sistema en un escenario que nunca ocurre',
              'Cero',
              'Sí, y engañosamente optimista',
            ],
            [
              'Doble con perfil de latencia y fallo realista',
              'Tu sistema, aislado, en la carga que elegiste',
              'Cero',
              'Sí, y comparable entre ejecuciones',
            ],
          ],
        },
      ],
    },
    {
      title: 'La latencia constante es el error que invalida todo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El doble ingenuo devuelve una respuesta fija después de esperar un tiempo fijo, y eso es lo que convierte la prueba de carga en teatro. La latencia de un LLM no es una constante, es una distribución de cola larga: la mayoría de las respuestas llega cerca de la mediana y una fracción pequeña tarda varias veces más. Esa cola es lo que rompe el sistema. Con latencia constante tu cola nunca se acumula, porque cada worker se libera al mismo ritmo previsible; con latencia de cola larga algunos workers quedan atrapados en respuestas lentas mientras la cola crece detrás de ellos, y ahí es exactamente cuando el pool se agota, el timeout dispara y el backpressure tiene que entrar en acción. Una prueba con latencia constante pasa con holgura en un sistema que se va a caer el primer viernes movido.',
        },
        {
          type: 'paragraph',
          value:
            'La latencia de un LLM tampoco es independiente del pedido, y eso importa más de lo que parece. El tiempo hasta el primer token depende del tamaño del prompt, y el tiempo total depende principalmente de cuántos tokens tiene la respuesta, porque la generación es secuencial. Un doble que ignora esto y sortea un tiempo aleatorio cualquiera pierde la correlación que produce los peores casos reales: las peticiones con más contexto tienden a ser las que generan respuestas más largas, así que el pico de carga tiende a coincidir con el pico de duración, y no a cancelarse. Modelar el tiempo hasta el primer token en función del tamaño del prompt y después un tiempo por token en la generación reproduce esa correlación sin ninguna sofisticación estadística.',
        },
        {
          type: 'code',
          value: `// test/fake-llm/latency.js
// La latencia de un LLM tiene dos fases con causas distintas:
// el TTFT crece con el prompt (prefill), y la generacion es
// secuencial por token. Modelarlo reproduce la correlacion real.

export function sampleLatency(request, profile, rng) {
  const promptTokens = estimateTokens(request.messages);
  const outputTokens = sampleOutputTokens(profile.outputTokens, rng);

  // Prefill: crece con el tamano del prompt, con un piso de red.
  const ttft =
    profile.networkFloorMs +
    profile.prefillMsPerKToken * (promptTokens / 1000) +
    lognormalJitter(profile.ttftJitter, rng);

  // Generacion: secuencial, el total crece con los tokens de salida.
  const perToken = profile.msPerOutputToken * lognormal(profile.tokenJitter, rng);

  // La cola larga es lo que rompe el sistema. Sin ella la prueba
  // pasa con holgura y produccion se cae el primer viernes movido.
  const isSlowTail = rng() < profile.slowTailRate;
  const tailFactor = isSlowTail ? profile.slowTailFactor : 1;

  return {
    ttftMs: ttft * tailFactor,
    totalMs: (ttft + perToken * outputTokens) * tailFactor,
    outputTokens,
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'De dónde sacar los números del perfil es la parte que suele trabar al equipo, y la respuesta es más simple de lo que parece: de producción, si ya tienes tráfico, o de una muestra pequeña y barata contra la API real, si todavía no. Bastan algunos cientos de llamadas con prompts representativos para estimar el piso de red, el costo por mil tokens de prompt, el tiempo por token de salida y la fracción de respuestas en la cola. Eso cuesta unos centavos y vale para millones de peticiones simuladas. El perfil debe ser un archivo versionado en el repositorio, con fecha de recolección, porque envejece: el proveedor cambia de infraestructura, tú cambias de modelo, y un perfil de hace seis meses describe un sistema que ya no existe.',
        },
      ],
    },
    {
      title: 'Simular el comportamiento malo, no solo el bueno',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un doble que solo responde con éxito prueba la mitad del sistema. Bajo carga, el proveedor real falla de maneras específicas, y cada una ejercita un camino distinto de tu código: el error de límite de tasa, que viene con una indicación de cuánto esperar y debería alimentar tu backoff; el error transitorio de servidor, que justifica reintento; el error de contexto excedido, que nunca debe reintentarse porque va a fallar igual; y el peor de todos, la respuesta que empieza a transmitir y muere a la mitad, dejando a tu cliente con un texto truncado y una conexión colgada. Si el doble no produce esos casos, la prueba de carga mide el desempeño de un sistema que solo existe en condiciones ideales.',
        },
        {
          type: 'paragraph',
          value:
            'La inyección de fallo tiene que ser determinista para que la prueba sirva de comparación entre ejecuciones. El fallo aleatorio con semilla fija da las dos cosas a la vez: la distribución parece realista y la secuencia es idéntica en cada ejecución, así que cuando cambias el código y el resultado cambia, la diferencia es tuya y no del azar. Vale exponer la semilla y la tasa de cada tipo de fallo como configuración del escenario, porque así el mismo doble sirve para la prueba de carga en régimen normal, para la prueba de resiliencia con quince por ciento de error y para el ejercicio de modo degradado con el proveedor totalmente fuera.',
        },
        {
          type: 'table',
          columns: ['Modo de fallo', 'Qué debe ejercitar en tu sistema', 'Señal de que pasó'],
          rows: [
            [
              'Error de límite de tasa con tiempo de espera',
              'Backoff que respeta el valor indicado, sin reintentar al instante',
              'El caudal baja y se recupera, sin tormenta de reintentos',
            ],
            [
              'Error transitorio de servidor',
              'Reintento con techo de intentos y jitter',
              'La latencia sube en el percentil alto, la tasa de éxito se mantiene',
            ],
            [
              'Contexto excedido',
              'Fallo inmediato sin reintento, con respuesta útil al usuario',
              'Cero reintentos en ese camino, error tratado en el borde',
            ],
            [
              'Stream que muere a la mitad',
              'Detección de respuesta truncada y limpieza de la conexión',
              'Ninguna conexión colgada, la respuesta parcial no se vuelve final',
            ],
            [
              'Proveedor totalmente fuera',
              'El disyuntor abre y el modo degradado asume',
              'La cola no crece sin límite, el cliente recibe respuesta útil',
            ],
            [
              'Proveedor lento, sin error',
              'Timeout con deadline y cancelación propagada',
              'El trabajo vencido se cancela, no sigue corriendo para nadie',
            ],
          ],
        },
      ],
    },
    {
      title: 'El streaming cambia la forma de la prueba',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Si tu aplicación usa streaming, el doble que devuelve la respuesta entera de una vez borra la característica más importante del sistema bajo carga: la conexión queda abierta durante toda la generación. En una API tradicional, la petición ocupa un slot por algunos milisegundos; con streaming, lo ocupa por varios segundos, y el número de conexiones simultáneas pasa a ser el recurso escaso en vez de la tasa de peticiones. Un sistema que aguanta mil peticiones por minuto sin streaming puede agotar file descriptors mucho antes con streaming, y el doble necesita emitir los eventos a lo largo del tiempo, al ritmo de tokens del perfil, para que ese costo aparezca en la prueba.',
        },
        {
          type: 'code',
          value: `// test/fake-llm/stream.js
// El doble emite eventos a lo largo del tiempo, al ritmo de tokens
// del perfil. Sin eso la conexion no queda abierta y la prueba no
// mide el recurso que de verdad escasea: la conexion simultanea.

export async function streamResponse(res, request, profile, rng) {
  const { ttftMs, totalMs, outputTokens } = sampleLatency(request, profile, rng);
  const perTokenMs = (totalMs - ttftMs) / Math.max(outputTokens, 1);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  await sleep(ttftMs);

  // Fallo a mitad del stream: el caso que el doble ingenuo nunca
  // produce y que deja conexion colgada y respuesta truncada.
  const dropAt = rng() < profile.midStreamDropRate
    ? Math.floor(rng() * outputTokens)
    : -1;

  for (let i = 0; i < outputTokens; i += 1) {
    if (i === dropAt) {
      res.destroy(); // termina sin evento de fin, a proposito
      return { outcome: 'mid_stream_drop', tokensSent: i };
    }

    res.write(\`data: \${JSON.stringify({ delta: nextToken(rng) })}\\n\\n\`);
    await sleep(perTokenMs);
  }

  res.write('data: [DONE]\\n\\n');
  res.end();
  return { outcome: 'complete', tokensSent: outputTokens };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dónde insertar el doble también es una decisión de fidelidad. Sustituir el cliente del proveedor por un objeto falso dentro del proceso es lo más fácil y lo menos fiel, porque quita serialización, red, pool de conexiones y el propio costo de mantener la conexión abierta, que es justamente lo que quieres medir. Levantar el doble como un servidor de verdad y apuntar la variable de entorno de la URL base hacia él mantiene todo el camino intacto y cambia solo quién responde del otro lado. El segundo cuesta algunos minutos más de infraestructura de prueba y es el único que responde la pregunta que motivó la prueba.',
        },
      ],
    },
    {
      title: 'Qué medir, y del lado correcto de la frontera',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con el proveedor sustituido, las métricas que importan dejan de ser las suyas y pasan a ser las tuyas. La latencia de la llamada al doble es conocida por construcción, tú mismo la definiste, así que medirla no informa nada. Lo que informa es lo que pasa entre el borde de tu aplicación y esa llamada: cuánto tiempo pasó la petición en la cola antes de volverse llamada, cuántos workers estaban ocupados, cuántas conexiones simultáneas sostuvo el proceso, cuánta memoria consumió la cola en el pico y cuántas peticiones fueron rechazadas en la entrada porque el sistema aplicó el freno. Esa es la diferencia entre una prueba de carga que produce un número y una que produce una decisión.',
        },
        {
          type: 'ordered',
          items: [
            'Tiempo de espera en la cola separado del tiempo de llamada, porque la suma esconde cuál de los dos está reventando el presupuesto de tiempo del cliente.',
            'Profundidad máxima de la cola y memoria en el pico, que dicen cuánto aguanta el sistema un pico antes de reventar en vez de degradar.',
            'Conexiones simultáneas sostenidas, que con streaming suelen agotarse antes que la CPU y antes que la tasa de peticiones.',
            'Tasa de rechazo en el borde y el código devuelto, para confirmar que el freno actúa en la entrada y no deja la cola crecer sin límite.',
            'Latencia en el percentil alto de punta a punta, no el promedio, porque el promedio esconde la cola que es justamente lo que rompe la experiencia.',
            'Trabajo cancelado correctamente cuando el cliente desiste, medido como llamadas abortadas sobre abandonos, que debería ser prácticamente uno.',
          ],
        },
        {
          type: 'diagram',
          value: `Prueba de carga con doble de proveedor: donde medir

  generador de carga (forma de trafico real, no rafaga uniforme)
     |
     v
  [ borde de la aplicacion ] <-- MEDIR: tasa de rechazo, codigo devuelto
     |
     v
  [ cola ] <-------------------- MEDIR: tiempo de espera, profundidad, memoria
     |
     v
  [ pool de workers ] <--------- MEDIR: ocupacion, conexiones simultaneas
     |
     v
  ================= FRONTERA =================
     |
     v
  [ doble del proveedor ]   <-- NO medir: esta latencia la definiste tu
     |
     +-- TTFT en funcion del tamano del prompt
     +-- tiempo por token en la generacion (streaming real, evento a evento)
     +-- cola larga con fraccion configurada
     +-- fallos deterministas por semilla:
           limite de tasa / transitorio / contexto excedido
           stream que muere a la mitad / proveedor fuera / proveedor lento

  Resultado util: "la cola revienta en X pet/min con Y de memoria"
  Resultado inutil: "la latencia promedio fue Z" (tu mismo elegiste Z)`,
        },
        {
          type: 'paragraph',
          value:
            'El generador de carga también merece cuidado, porque la ráfaga uniforme es irreal y optimista. El tráfico de atención llega en olas, con correlación entre llegadas, y el mismo volumen total distribuido en olas produce picos de cola que la distribución uniforme nunca alcanza. Vale además modelar al cliente que desiste: una fracción de las conversaciones se abandona antes de que llegue la respuesta, y si tu sistema no cancela el trabajo correspondiente, sigue quemando worker y token para nadie, lo que bajo carga es una forma silenciosa de amplificar la sobrecarga.',
        },
      ],
    },
    {
      title: 'Dónde el doble deja de servir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El doble responde preguntas sobre tu sistema y no responde ninguna pregunta sobre el proveedor. Si lo que necesitas saber es cuál es la cuota real de tu cuenta, cómo se comporta el proveedor cuando la excedes, si su latencia empeora en los horarios de pico globales o si el modelo nuevo es más lento que el antiguo, ninguna simulación sustituye una medición contra la API real. La diferencia es que esas preguntas se responden con una prueba pequeña y barata, de algunos cientos de llamadas, y no con una prueba de carga de diez mil. La división sana es usar la API real para calibrar el perfil y validar suposiciones, y usar el doble para todo lo que involucra volumen.',
        },
        {
          type: 'paragraph',
          value:
            'También vale tener una ejecución periódica de humo contra la API real, pequeña y barata, con dos objetivos. El primero es detectar deriva del perfil: si la latencia medida en la muestra se alejó de lo que el doble simula, tu prueba de carga está describiendo un proveedor que ya no existe y necesita recalibración. El segundo es atrapar cambios de contrato, porque el doble responde en el formato que tú programaste en él, y si el proveedor cambia un campo o la semántica de un error, tu prueba seguirá pasando alegremente mientras producción se rompe. Un doble bien calibrado es una herramienta poderosa, y es también una foto del proveedor en un instante del pasado.',
        },
        {
          type: 'list',
          items: [
            'Calibración del perfil: necesita API real, con muestra pequeña, y debe rehacerse cuando el modelo o el proveedor cambien.',
            'Descubrimiento de cuota y comportamiento en el límite: API real, porque es una propiedad de tu cuenta y no de tu código.',
            'Calidad de respuesta y regresión de prompt: fuera del alcance de la prueba de carga, eso es evaluación, y el doble no tiene opinión sobre contenido.',
            'Capacidad, cola, memoria, conexiones y freno en el borde: doble, porque es tu sistema el que se está midiendo y el volumen es caro.',
            'Contrato de la API y formato de error: prueba de contrato contra la API real, periódica, para que el doble no se vuelva ficción.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué no correr la prueba de carga directo contra la API del proveedor?',
      answer:
        'Por dos motivos, y el costo es el menos importante. El primero es la atribución: cuando la latencia sube, la prueba no separa si tu sistema se saturó, si tu cuota se excedió o si el proveedor tiene un mal día, y tú solo controlas una de esas variables. El segundo es que el rate limit de tu cuenta se vuelve un techo artificial: si la cuota es de trescientas peticiones por minuto y quieres probar mil, el proveedor rechaza las excedentes y la prueba pasa a ejercitar el camino de error en vez del camino de éxito bajo carga, dejando la pregunta original sin respuesta. Sustituir al proveedor por un doble quita el techo y vuelve la prueba reproducible entre ejecuciones, que es lo que permite comparar antes y después de un cambio.',
    },
    {
      question: '¿Un doble con latencia fija no alcanza?',
      answer:
        'No, y ese es el error que invalida la prueba entera. La latencia de un LLM es una distribución de cola larga, y es la cola la que rompe el sistema: con tiempo constante cada worker se libera al mismo ritmo y la cola nunca se acumula, mientras que con cola larga algunos workers quedan atrapados en respuestas lentas y la cola crece detrás de ellos, que es exactamente cuando el pool se agota y el timeout dispara. Además la latencia no es independiente del pedido: el tiempo hasta el primer token crece con el tamaño del prompt y el tiempo total crece con los tokens generados, así que los prompts mayores tienden a generar respuestas más largas y los picos se suman en vez de cancelarse. Modelar esas dos fases más una fracción de cola ya reproduce el comportamiento que importa.',
    },
    {
      question: '¿Cómo calibrar el perfil de latencia sin gastar mucho?',
      answer:
        'Con una muestra pequeña contra la API real, de algunos cientos de llamadas con prompts representativos de tu tráfico, o directo de tu producción si ya tienes volumen. Eso basta para estimar el piso de red, el costo por mil tokens de prompt, el tiempo por token de salida y la fracción de respuestas en la cola, cuesta unos centavos y vale para millones de peticiones simuladas después. El perfil debe quedar versionado en el repositorio con su fecha de recolección, porque envejece: el proveedor cambia de infraestructura y tú cambias de modelo. Vale mantener una ejecución periódica de humo contra la API real para detectar cuándo el perfil derivó y para atrapar cambios de contrato, ya que el doble responde en el formato que tú programaste en él.',
    },
  ],
  conclusion: {
    title: 'Una buena prueba de carga mide tu sistema, no la factura del proveedor',
    description:
      'Llamar a la API real bajo carga mezcla tres variables que no puedes separar y cobra caro para producir un número que no se repite la semana siguiente. Sustituir al proveedor por un doble que modela las dos fases de la latencia, reproduce la cola larga, emite streaming evento a evento e inyecta fallo determinista por semilla le devuelve a la prueba la propiedad que necesita tener: aislar tu sistema y ser comparable entre ejecuciones. Con eso, las métricas que interesan pasan a ser tiempo de cola, profundidad, memoria en el pico, conexiones simultáneas y tasa de rechazo en el borde, que son las que dicen en qué volumen el sistema degrada y en cuál se rompe. Puedo montar ese harness en tu proyecto, calibrando el perfil con una muestra barata de tu propia producción, modelando los modos de fallo que importan y diseñando el escenario de carga que reproduce tu viernes movido, para que conozcas el límite antes de encontrarlo en vivo.',
    cta: 'Hablar sobre prueba de carga en mi sistema con LLM',
  },
  related: [
    { label: 'Backpressure en un pipeline de IA: cuando el consumidor no da abasto', to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha' },
    { label: 'Timeout y cancelación en una cadena de llamadas de LLM', to: '/blog/timeout-cancelamento-cadeia-chamadas-llm' },
    { label: 'Modo degradado: mantener la atención cuando la IA no está disponible', to: '/blog/modo-degradado-manter-atendimento-quando-ia-indisponivel' },
  ],
};

export default { pt, en, es };
