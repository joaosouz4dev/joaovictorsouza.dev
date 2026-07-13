// Conteudo do artigo: cache semantico para reduzir custo de LLM.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Cache semântico mínimo para LLM: em vez de casar a pergunta por texto exato, casa por significado usando embedding e busca por similaridade, com um limiar calibrado, TTL, invalidação e métrica de acerto, para servir de cache respostas de perguntas equivalentes e cortar custo e latência sem entregar resposta errada.',
  en: 'Minimal semantic cache for LLMs: instead of matching the question by exact text, it matches by meaning using an embedding and a similarity search, with a calibrated threshold, TTL, invalidation and a hit metric, to serve equivalent questions from cache and cut cost and latency without returning a wrong answer.',
  es: 'Cache semántico mínimo para LLM: en vez de casar la pregunta por texto exacto, la casa por significado usando embedding y búsqueda por similitud, con un umbral calibrado, TTL, invalidación y métrica de acierto, para servir desde cache respuestas de preguntas equivalentes y cortar costo y latencia sin entregar respuesta equivocada.',
};

const repoUrl = 'https://github.com/joaosouz4dev/semantic-cache-llm-mini';

const pt = {
  intro:
    'Duas pessoas perguntam a mesma coisa de dois jeitos diferentes: "como cancelo meu pedido?" e "quero desistir da compra, o que faço?". Para um cache tradicional, são duas chaves distintas, dois cache miss, duas chamadas ao modelo, duas faturas. Mas a intenção é idêntica, e a resposta poderia ser a mesma. O cache semântico existe para explorar exatamente isso: em vez de casar a pergunta por texto exato, casa por significado. Ele transforma a pergunta em embedding, procura no histórico a pergunta mais parecida e, se a similaridade passar de um limiar, devolve a resposta já gerada sem chamar o modelo. Bem calibrado, um cache semântico corta uma fatia grande do custo de LLM e derruba a latência de perguntas repetidas de segundos para milissegundos. Mal calibrado, ele entrega a resposta de uma pergunta para outra parecida mas diferente, o que é pior do que não ter cache nenhum. Este artigo mostra como construir essa camada com a régua no lugar certo: o limiar de similaridade, o TTL e a invalidação, o que nunca deve ir para o cache e a métrica que diz se ele está ajudando ou atrapalhando.',
  sections: [
    {
      title: 'Cache exato não serve para linguagem natural',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um cache tradicional casa a chave por igualdade byte a byte: mesma string, mesmo hash, cache hit. Isso funciona para consultas estruturadas (id de produto, url, parâmetro numérico), onde duas requisições iguais são de fato a mesma requisição. Mas linguagem natural quebra essa premissa. A mesma intenção aparece em infinitas formas: sinônimos, ordem das palavras, gírias, erros de digitação, pontuação. "Qual o prazo de entrega?" e "em quantos dias chega?" têm hash completamente diferente e resposta idêntica. Num cache exato, cada variação é um miss, e o modelo é chamado de novo para responder algo que ele já respondeu com outras palavras.',
        },
        {
          type: 'paragraph',
          value:
            'O cache semântico troca o critério de comparação. Em vez de perguntar "essa string é idêntica?", ele pergunta "essa pergunta significa a mesma coisa que alguma que já respondi?". A tabela abaixo separa os dois para deixar claro em que cada um serve.',
        },
        {
          type: 'table',
          columns: ['Dimensão', 'Cache exato', 'Cache semântico'],
          rows: [
            [
              'Critério de acerto',
              'String idêntica (hash)',
              'Similaridade de significado (embedding)',
            ],
            [
              'Serve bem para',
              'Chave estruturada, id, url',
              'Pergunta em linguagem natural',
            ],
            [
              'Variação de forma',
              'Cada variação é um miss',
              'Formas equivalentes casam',
            ],
            [
              'Risco principal',
              'Baixa taxa de acerto',
              'Casar perguntas parecidas mas diferentes',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O ganho é claro: onde o cache exato acerta quase nada em linguagem natural, o semântico captura a família inteira de variações de uma mesma pergunta. O preço é uma nova classe de erro que o cache exato nunca teve: o falso positivo, quando duas perguntas parecidas mas com respostas diferentes acabam casando. Todo o resto do artigo gira em torno de manter esse ganho sem pagar esse preço.',
        },
      ],
    },
    {
      title: 'Como funciona: embedding, similaridade e limiar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O mecanismo tem três peças. Primeiro, o embedding: a pergunta vira um vetor de números que representa seu significado, e perguntas com sentido parecido geram vetores próximos no espaço. Segundo, a busca por similaridade: a nova pergunta é comparada com as perguntas já em cache, e a mais próxima (maior similaridade de cosseno) é a candidata. Terceiro, o limiar: só é cache hit se a similaridade da candidata passar de um corte que você define. Abaixo do limiar, trata como miss, chama o modelo e guarda a nova resposta. O fluxo abaixo mostra o caminho completo de uma pergunta.',
        },
        {
          type: 'diagram',
          value: `Caminho de uma pergunta pelo cache semântico

  pergunta do usuário
        |
        v
  gera embedding da pergunta
        |
        v
  busca a pergunta mais parecida no cache
        |
        v
  [ similaridade >= limiar? ]
     |  sim                    |  não
     v                         v
  CACHE HIT               CACHE MISS
  devolve resposta        chama o modelo
  guardada (sem LLM)      guarda pergunta+resposta+embedding
     |                         |
     v                         v
  responde em ms          responde e popula o cache

  hit = economia de token + latência baixa
  miss = custo normal, mas alimenta o próximo hit`,
        },
        {
          type: 'code',
          value: `// cache/semantic.js
// Cache semantico minimo: casa a pergunta por significado, nao por texto.
// So devolve do cache se a similaridade passar do limiar calibrado.

export function createSemanticCache({ embed, callModel, store, threshold = 0.92 }) {
  return async function ask(question) {
    const vector = await embed(question);

    // Procura a pergunta mais parecida ja respondida.
    const best = await store.nearest(vector); // { score, answer } | null

    // So e hit se a similaridade passar do limiar. Abaixo dele, e miss:
    // perguntas "parecidas" nao sao garantia de mesma resposta.
    if (best && best.score >= threshold) {
      return { answer: best.answer, cached: true, score: best.score };
    }

    // Miss: chama o modelo e alimenta o cache para o proximo acerto.
    const answer = await callModel(question);
    await store.put({ question, vector, answer });
    return { answer, cached: false };
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Repare que o miss não é desperdício: ele paga o custo normal da chamada, mas grava a pergunta, o embedding e a resposta, de modo que a próxima variação equivalente vira hit. O cache aquece com o uso. O ponto sensível é um só, o valor de threshold, e é ele que decide se a camada ajuda ou entrega resposta trocada. É o que a próxima seção detalha.',
        },
      ],
    },
    {
      title: 'Calibrar o limiar: o único parâmetro que importa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O limiar de similaridade é o único botão de verdade do cache semântico, e ele governa um trade-off direto. Limiar alto demais e quase nada casa: o cache vira um cache exato caro, com pouca economia. Limiar baixo demais e coisas parecidas mas diferentes casam: "como cancelo o pedido?" recebe a resposta de "como cancelo a assinatura?", e o usuário leva informação errada com a confiança de uma resposta pronta. O erro perigoso é o segundo, porque é silencioso: não estoura exceção, não aparece em log de erro, só entrega a resposta errada com cara de certa.',
        },
        {
          type: 'list',
          items: [
            'Não chute o limiar: colete pares de perguntas reais rotuladas como "mesma resposta" e "resposta diferente" e meça a similaridade de cada par. O limiar certo é o que separa as duas nuvens.',
            'Prefira errar para o lado seguro: em domínio sensível (cobrança, saúde, jurídico), um limiar mais alto perde alguns hits, mas evita o falso positivo, que ali é caro. Miss custa token; falso positivo custa confiança.',
            'Calibre por domínio, não global: perguntas de FAQ toleram limiar mais baixo; perguntas com dado específico (valor, prazo, id) exigem limiar alto porque uma palavra muda a resposta inteira.',
            'Revise o limiar com dado, não com sensação: o baseline de hoje só se compara ao de amanhã se você tiver a métrica; sem medir, você ajusta no escuro.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A regra que resume: o limiar não é uma constante universal, é uma decisão de risco por domínio. Um assistente de FAQ genérico e um bot de suporte financeiro não podem ter o mesmo corte, porque o custo de uma resposta trocada é radicalmente diferente entre eles. Comece conservador (limiar alto), meça a taxa de acerto e de falso positivo, e só então afrouxe onde o risco permite.',
        },
      ],
    },
    {
      title: 'O que nunca deve ir para o cache',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cache semântico assume uma coisa: a mesma pergunta tem a mesma resposta. Quando essa premissa não vale, o cache não só deixa de ajudar, ele mente. O caso mais óbvio é a pergunta cuja resposta depende de dado vivo ou de contexto do usuário. "Qual o status do meu pedido?" é a mesma frase para dois usuários, casaria no cache com similaridade quase perfeita, e serviria o status de um para o outro. A resposta não pode ser cacheada porque não é função só da pergunta, é função da pergunta mais o estado do usuário mais o instante.',
        },
        {
          type: 'code',
          value: `// cache/policy.js
// Nem toda pergunta pode ser cacheada. Antes de consultar ou gravar,
// decide se aquela resposta e estavel o suficiente para virar cache.

export function isCacheable(question, ctx) {
  // Resposta depende do usuario: status do pedido, saldo, dado pessoal.
  if (ctx.usesUserData) return false;

  // Resposta depende do agora: preco, estoque, disponibilidade, cotacao.
  if (ctx.usesLiveData) return false;

  // Pergunta que dispara acao (cancelar, reembolsar) nunca e "resposta cacheavel".
  if (ctx.triggersAction) return false;

  // FAQ estavel, explicacao de politica, definicao: pode cachear.
  return true;
}

// No fluxo: so passa pelo cache semantico se isCacheable() for true.
// Caso contrario, vai direto ao modelo (ou a uma tool de dado vivo).`,
        },
        {
          type: 'paragraph',
          value:
            'A separação prática é entre pergunta de conhecimento estável e pergunta de dado dinâmico. FAQ, definição, explicação de política, passo a passo de um processo: são estáveis, a resposta hoje é a resposta amanhã, e cachear é seguro e rentável. Status, saldo, preço, disponibilidade, qualquer coisa por usuário ou por instante: são dinâmicas, e ali o cache semântico é um vetor de vazamento e de resposta obsoleta. A porta de entrada do cache tem que ter esse filtro, senão a economia vem às custas de servir dado de um usuário para outro, um erro muito mais caro do que a chamada que você economizou.',
        },
      ],
    },
    {
      title: 'TTL, invalidação e quando a resposta certa vira errada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo uma pergunta cacheável tem validade. A política de reembolso muda, o prazo de entrega é revisado, o texto da FAQ é reescrito: a resposta que estava correta ontem passa a estar errada hoje, e um cache que a serve indefinidamente propaga informação desatualizada com a autoridade de uma resposta pronta. Por isso o cache semântico precisa de dois mecanismos de expiração. O TTL (time to live) dá um prazo de validade a cada entrada: passou do prazo, a entrada expira e a próxima pergunta força um miss que regenera a resposta. A invalidação explícita permite derrubar entradas quando você sabe que a fonte mudou, sem esperar o TTL.',
        },
        {
          type: 'ordered',
          items: [
            'Defina TTL por natureza do conteúdo: uma definição estável pode viver dias; uma política que muda com frequência merece TTL curto, de horas, para não servir versão vencida por muito tempo.',
            'Invalide na fonte, não no cache: quando o texto da FAQ ou a política de reembolso é editada, dispare a invalidação das entradas relacionadas nesse momento, em vez de confiar só no relógio do TTL.',
            'Trate expiração como miss normal: entrada vencida não é erro, é um miss que chama o modelo, regenera a resposta e reaquece o cache com a versão nova.',
            'Não deixe cache crescer sem limite: além do TTL, imponha um teto de tamanho com despejo do menos usado, senão o custo de memória e de busca corrói a economia que o cache trouxe.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O erro clássico é montar o cache semântico e nunca pensar em expiração, tratando toda resposta como eterna. O resultado é sutil e corrosivo: o sistema fica cada vez mais rápido e mais barato, mas também cada vez mais desatualizado, respondendo com políticas e prazos que não valem mais. TTL e invalidação são o que mantém o cache alinhado com a verdade da fonte. Sem eles, você troca custo de token por dívida de correção, que cobra juros em forma de reclamação de cliente.',
        },
      ],
    },
    {
      title: 'Medir se o cache está ajudando ou atrapalhando',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um cache semântico sem métrica é um palpite caro. Você precisa de números para saber se ele está entregando economia real e, mais importante, se não está servindo resposta trocada. Quatro sinais bastam para operar com confiança. A taxa de acerto (hit rate) diz quanto do tráfego o cache está poupando de chamar o modelo, e é a medida direta da economia. A economia estimada traduz o hit rate em token e custo evitados. A latência compara o tempo de um hit (milissegundos) com o de um miss (a chamada inteira ao modelo). E a taxa de falso positivo, a mais importante e a mais ignorada, mede quantos hits entregaram a resposta errada.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'O que revela', 'Quando agir'],
          rows: [
            [
              'Hit rate',
              'Fração de perguntas servidas do cache',
              'Muito baixo: limiar alto demais ou pouco tráfego repetido',
            ],
            [
              'Custo evitado',
              'Token e dinheiro poupados pelos hits',
              'Justifica (ou não) manter a camada',
            ],
            [
              'Latência hit vs miss',
              'Ganho de tempo por resposta cacheada',
              'Confirma o benefício de experiência',
            ],
            [
              'Falso positivo',
              'Hits que serviram resposta errada',
              'Qualquer valor relevante: suba o limiar já',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A taxa de falso positivo é a que separa um cache que você confia de um que assusta, e é a mais difícil de medir porque não estoura sozinha. Uma amostragem periódica de hits revisada por humano ou por um modelo juiz revela se a resposta servida do cache batia com a que o modelo teria dado. Falso positivo subindo é ordem direta para elevar o limiar, mesmo que isso derrube um pouco o hit rate. A hierarquia é clara: economia é bom, mas resposta certa vem primeiro. Um cache que economiza 40% mas serve 3% de respostas trocadas não vale a pena; um que economiza 25% com falso positivo perto de zero é ouro.',
        },
      ],
    },
    {
      title: 'Montar a camada sem virar risco novo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O cache semântico é uma das poucas otimizações de LLM com retorno imediato: reduz custo e latência ao mesmo tempo, e o esforço de implementação é modesto. Mas é uma otimização que introduz uma classe de erro nova, então a ordem de implantação importa tanto quanto o código. O caminho é começar seguro e afrouxar com dado na mão.',
        },
        {
          type: 'ordered',
          items: [
            'Comece pelo filtro de cacheabilidade: antes de tocar em embedding, garanta que pergunta com dado vivo ou por usuário nunca entra no cache. Esse filtro previne o erro mais caro (dado de um usuário servido a outro).',
            'Ligue o cache só na leitura primeiro, com limiar alto: observe o hit rate e amostre os hits para medir falso positivo antes de confiar na camada para valer.',
            'Instrumente as quatro métricas desde o dia um: hit rate, custo evitado, latência e falso positivo. Sem elas você não sabe se está economizando ou entregando resposta trocada.',
            'Adicione TTL e invalidação antes de escalar: sem expiração, o cache fica desatualizado silenciosamente, e o problema só aparece em reclamação de cliente.',
            'Afrouxe o limiar por domínio, com base na métrica: onde o falso positivo é baixo e o hit rate baixo, dá para descer o corte; onde o risco é alto, mantenha conservador.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A diferença entre um cache semântico que corta a fatura sem ninguém perceber e um que serve resposta trocada está inteira na régua e no filtro, não no algoritmo de embedding. O embedding é commodity; o limiar calibrado por domínio, o filtro de cacheabilidade, o TTL e a métrica de falso positivo são o que transforma uma ideia atraente numa camada de produção confiável. Bem feito, é uma das melhores relações custo-benefício de um sistema com LLM: poucas centenas de linhas que pagam token, latência e experiência, sem trocar economia por resposta errada.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Cache semântico não é a mesma coisa que um cache normal com a pergunta como chave?',
      answer:
        'Não. Um cache normal casa a chave por igualdade exata: mesma string, mesmo hash. Em linguagem natural isso quase nunca acerta, porque a mesma intenção aparece em infinitas formas ("qual o prazo?" e "em quantos dias chega?" têm hash diferente e resposta idêntica). O cache semântico troca o critério: transforma a pergunta em embedding e casa por significado, usando similaridade de cosseno com um limiar. Assim ele captura a família inteira de variações de uma mesma pergunta, algo impossível para o cache exato. O preço é uma classe de erro nova, o falso positivo, que o cache exato não tem.',
    },
    {
      question: 'Qual o maior risco do cache semântico e como controlar?',
      answer:
        'O maior risco é o falso positivo: casar duas perguntas parecidas mas com respostas diferentes e servir a resposta de uma para a outra. É um erro silencioso, não estoura exceção, só entrega informação errada com cara de resposta pronta. Controla-se com o limiar de similaridade calibrado por domínio (mais alto em domínio sensível como cobrança ou saúde), com o filtro de cacheabilidade (dado vivo e por usuário nunca entram no cache) e com a métrica de falso positivo medida por amostragem. A regra é simples: economia é bom, mas resposta certa vem primeiro; falso positivo subindo é ordem direta para elevar o limiar.',
    },
    {
      question: 'Toda pergunta pode ser cacheada?',
      answer:
        'Não. O cache semântico assume que a mesma pergunta tem a mesma resposta, e isso só vale para conhecimento estável (FAQ, definição, política, passo a passo). Perguntas cuja resposta depende de dado vivo (preço, estoque, cotação) ou de contexto do usuário (status do pedido, saldo, dado pessoal) não podem ser cacheadas, porque a resposta não é função só da pergunta, é função da pergunta mais o estado mais o instante. Cachear "qual o status do meu pedido?" serviria o status de um usuário para outro. Por isso a porta de entrada do cache precisa de um filtro que barra pergunta dinâmica antes de qualquer busca por similaridade.',
    },
  ],
  conclusion: {
    title: 'Cache semântico corta custo de LLM quando a régua está no lugar certo',
    description:
      'Casar pergunta por significado economiza token e latência de perguntas repetidas, mas só é seguro com limiar calibrado por domínio, filtro do que não pode ser cacheado, TTL com invalidação e métrica de falso positivo. Posso desenhar essa camada no seu sistema de IA, do embedding à observabilidade, cortando fatura sem trocar economia por resposta errada.',
    cta: 'Falar sobre cache semântico no meu sistema de IA',
  },
  related: [
    { label: 'CAG vs RAG: cache de contexto contra retrieval', to: '/blog/cag-vs-rag-cache-contexto' },
    { label: 'Observabilidade de LLM: tracing, custo e qualidade', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'semantic-cache-llm-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'Two people ask the same thing in two different ways: "how do I cancel my order?" and "I want to give up on the purchase, what do I do?". To a traditional cache, those are two distinct keys, two cache misses, two model calls, two invoices. But the intent is identical, and the answer could be the same. Semantic cache exists to exploit exactly this: instead of matching the question by exact text, it matches by meaning. It turns the question into an embedding, searches the history for the most similar question and, if the similarity passes a threshold, returns the already generated answer without calling the model. Well calibrated, a semantic cache cuts a large slice of LLM cost and drops the latency of repeated questions from seconds to milliseconds. Poorly calibrated, it delivers the answer of one question to another that is similar but different, which is worse than having no cache at all. This article shows how to build that layer with the ruler in the right place: the similarity threshold, the TTL and invalidation, what should never go into the cache and the metric that tells you whether it is helping or hurting.',
  sections: [
    {
      title: 'Exact cache does not work for natural language',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A traditional cache matches the key by byte-for-byte equality: same string, same hash, cache hit. That works for structured queries (product id, url, numeric parameter), where two identical requests are in fact the same request. But natural language breaks that premise. The same intent shows up in infinite forms: synonyms, word order, slang, typos, punctuation. "What is the delivery time?" and "how many days until it arrives?" have completely different hashes and identical answers. In an exact cache, every variation is a miss, and the model is called again to answer something it already answered in other words.',
        },
        {
          type: 'paragraph',
          value:
            'The semantic cache swaps the comparison criterion. Instead of asking "is this string identical?", it asks "does this question mean the same as one I already answered?". The table below separates the two to make clear where each one fits.',
        },
        {
          type: 'table',
          columns: ['Dimension', 'Exact cache', 'Semantic cache'],
          rows: [
            [
              'Hit criterion',
              'Identical string (hash)',
              'Meaning similarity (embedding)',
            ],
            [
              'Works well for',
              'Structured key, id, url',
              'Natural-language question',
            ],
            [
              'Form variation',
              'Every variation is a miss',
              'Equivalent forms match',
            ],
            [
              'Main risk',
              'Low hit rate',
              'Matching similar but different questions',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The gain is clear: where the exact cache hits almost nothing in natural language, the semantic one captures the whole family of variations of the same question. The price is a new class of error the exact cache never had: the false positive, when two questions that are similar but have different answers end up matching. The rest of the article revolves around keeping that gain without paying that price.',
        },
      ],
    },
    {
      title: 'How it works: embedding, similarity and threshold',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The mechanism has three pieces. First, the embedding: the question becomes a vector of numbers that represents its meaning, and questions with similar meaning generate close vectors in the space. Second, the similarity search: the new question is compared against the questions already in cache, and the closest one (highest cosine similarity) is the candidate. Third, the threshold: it is only a cache hit if the candidate similarity passes a cutoff you define. Below the threshold, it treats it as a miss, calls the model and stores the new answer. The flow below shows the full path of a question.',
        },
        {
          type: 'diagram',
          value: `Path of a question through the semantic cache

  user question
        |
        v
  generate question embedding
        |
        v
  search the most similar question in cache
        |
        v
  [ similarity >= threshold? ]
     |  yes                    |  no
     v                         v
  CACHE HIT               CACHE MISS
  return stored           call the model
  answer (no LLM)         store question+answer+embedding
     |                         |
     v                         v
  answer in ms            answer and populate the cache

  hit = token savings + low latency
  miss = normal cost, but feeds the next hit`,
        },
        {
          type: 'code',
          value: `// cache/semantic.js
// Minimal semantic cache: matches the question by meaning, not by text.
// Only returns from cache if the similarity passes the calibrated threshold.

export function createSemanticCache({ embed, callModel, store, threshold = 0.92 }) {
  return async function ask(question) {
    const vector = await embed(question);

    // Find the most similar question already answered.
    const best = await store.nearest(vector); // { score, answer } | null

    // Only a hit if the similarity passes the threshold. Below it, a miss:
    // "similar" questions are no guarantee of the same answer.
    if (best && best.score >= threshold) {
      return { answer: best.answer, cached: true, score: best.score };
    }

    // Miss: call the model and feed the cache for the next hit.
    const answer = await callModel(question);
    await store.put({ question, vector, answer });
    return { answer, cached: false };
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Note that the miss is not wasted: it pays the normal cost of the call, but records the question, the embedding and the answer, so the next equivalent variation becomes a hit. The cache warms up with use. There is a single sensitive point, the threshold value, and it is what decides whether the layer helps or delivers the wrong answer. That is what the next section details.',
        },
      ],
    },
    {
      title: 'Calibrating the threshold: the only parameter that matters',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The similarity threshold is the only real knob of the semantic cache, and it governs a direct trade-off. Too high and almost nothing matches: the cache becomes an expensive exact cache, with little savings. Too low and things that are similar but different match: "how do I cancel the order?" gets the answer to "how do I cancel the subscription?", and the user takes wrong information with the confidence of a ready answer. The dangerous error is the second one, because it is silent: it does not throw an exception, it does not show up in the error log, it just delivers the wrong answer looking right.',
        },
        {
          type: 'list',
          items: [
            'Do not guess the threshold: collect pairs of real questions labeled as "same answer" and "different answer" and measure the similarity of each pair. The right threshold is the one that separates the two clouds.',
            'Prefer to err on the safe side: in a sensitive domain (billing, health, legal), a higher threshold loses some hits, but avoids the false positive, which is expensive there. A miss costs tokens; a false positive costs trust.',
            'Calibrate per domain, not globally: FAQ questions tolerate a lower threshold; questions with specific data (amount, deadline, id) require a high threshold because one word changes the whole answer.',
            'Review the threshold with data, not feeling: today baseline only compares to tomorrow if you have the metric; without measuring, you tune in the dark.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The rule that sums it up: the threshold is not a universal constant, it is a risk decision per domain. A generic FAQ assistant and a financial support bot cannot have the same cutoff, because the cost of a wrong answer is radically different between them. Start conservative (high threshold), measure the hit rate and the false positive rate, and only then loosen where the risk allows.',
        },
      ],
    },
    {
      title: 'What should never go into the cache',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The semantic cache assumes one thing: the same question has the same answer. When that premise does not hold, the cache not only stops helping, it lies. The most obvious case is the question whose answer depends on live data or user context. "What is the status of my order?" is the same phrase for two users, would match in the cache with near perfect similarity, and would serve one user status to another. The answer cannot be cached because it is not a function of the question alone, it is a function of the question plus the user state plus the moment.',
        },
        {
          type: 'code',
          value: `// cache/policy.js
// Not every question can be cached. Before looking up or storing,
// decide whether that answer is stable enough to become cache.

export function isCacheable(question, ctx) {
  // Answer depends on the user: order status, balance, personal data.
  if (ctx.usesUserData) return false;

  // Answer depends on now: price, stock, availability, quote.
  if (ctx.usesLiveData) return false;

  // A question that triggers an action (cancel, refund) is never "cacheable".
  if (ctx.triggersAction) return false;

  // Stable FAQ, policy explanation, definition: can cache.
  return true;
}

// In the flow: only pass through the semantic cache if isCacheable() is true.
// Otherwise, go straight to the model (or to a live-data tool).`,
        },
        {
          type: 'paragraph',
          value:
            'The practical split is between a stable-knowledge question and a dynamic-data question. FAQ, definition, policy explanation, the steps of a process: they are stable, the answer today is the answer tomorrow, and caching is safe and profitable. Status, balance, price, availability, anything per user or per moment: they are dynamic, and there the semantic cache is a leakage and stale-answer vector. The entrance of the cache must have that filter, otherwise the savings come at the cost of serving one user data to another, an error far more expensive than the call you saved.',
        },
      ],
    },
    {
      title: 'TTL, invalidation and when a right answer turns wrong',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Even a cacheable question has an expiry. The refund policy changes, the delivery time is revised, the FAQ text is rewritten: the answer that was correct yesterday becomes wrong today, and a cache that serves it indefinitely propagates outdated information with the authority of a ready answer. That is why the semantic cache needs two expiration mechanisms. The TTL (time to live) gives each entry a validity window: past the deadline, the entry expires and the next question forces a miss that regenerates the answer. Explicit invalidation lets you drop entries when you know the source changed, without waiting for the TTL.',
        },
        {
          type: 'ordered',
          items: [
            'Set the TTL by nature of the content: a stable definition can live for days; a policy that changes often deserves a short TTL, of hours, so it does not serve a stale version for too long.',
            'Invalidate at the source, not at the cache: when the FAQ text or the refund policy is edited, trigger invalidation of the related entries at that moment, instead of relying only on the TTL clock.',
            'Treat expiration as a normal miss: an expired entry is not an error, it is a miss that calls the model, regenerates the answer and rewarms the cache with the new version.',
            'Do not let the cache grow without limit: beyond the TTL, impose a size cap with least-used eviction, otherwise the memory and search cost erodes the savings the cache brought.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The classic mistake is to build the semantic cache and never think about expiration, treating every answer as eternal. The result is subtle and corrosive: the system gets faster and cheaper, but also more and more outdated, answering with policies and deadlines that no longer hold. TTL and invalidation are what keep the cache aligned with the source of truth. Without them, you trade token cost for correctness debt, which charges interest in the form of customer complaints.',
        },
      ],
    },
    {
      title: 'Measuring whether the cache is helping or hurting',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A semantic cache without metrics is an expensive guess. You need numbers to know whether it is delivering real savings and, more importantly, whether it is not serving the wrong answer. Four signals are enough to operate with confidence. The hit rate says how much of the traffic the cache is saving from calling the model, and it is the direct measure of savings. The estimated savings translates the hit rate into avoided tokens and cost. The latency compares the time of a hit (milliseconds) with that of a miss (the whole call to the model). And the false positive rate, the most important and the most ignored, measures how many hits delivered the wrong answer.',
        },
        {
          type: 'table',
          columns: ['Metric', 'What it reveals', 'When to act'],
          rows: [
            [
              'Hit rate',
              'Fraction of questions served from cache',
              'Too low: threshold too high or little repeated traffic',
            ],
            [
              'Avoided cost',
              'Tokens and money saved by hits',
              'Justifies (or not) keeping the layer',
            ],
            [
              'Latency hit vs miss',
              'Time gain per cached answer',
              'Confirms the experience benefit',
            ],
            [
              'False positive',
              'Hits that served the wrong answer',
              'Any relevant value: raise the threshold now',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The false positive rate is what separates a cache you trust from one that scares, and it is the hardest to measure because it does not fire on its own. A periodic sampling of hits reviewed by a human or a judge model reveals whether the answer served from cache matched what the model would have given. A rising false positive is a direct order to raise the threshold, even if that drops the hit rate a little. The hierarchy is clear: savings are good, but the right answer comes first. A cache that saves 40% but serves 3% wrong answers is not worth it; one that saves 25% with a false positive near zero is gold.',
        },
      ],
    },
    {
      title: 'Building the layer without becoming a new risk',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The semantic cache is one of the few LLM optimizations with an immediate return: it reduces cost and latency at the same time, and the implementation effort is modest. But it is an optimization that introduces a new class of error, so the rollout order matters as much as the code. The path is to start safe and loosen with data in hand.',
        },
        {
          type: 'ordered',
          items: [
            'Start with the cacheability filter: before touching embeddings, ensure a question with live or per-user data never enters the cache. That filter prevents the most expensive error (one user data served to another).',
            'Turn the cache on read-only first, with a high threshold: watch the hit rate and sample the hits to measure false positives before trusting the layer for real.',
            'Instrument the four metrics from day one: hit rate, avoided cost, latency and false positive. Without them you do not know whether you are saving or serving the wrong answer.',
            'Add TTL and invalidation before scaling: without expiration, the cache goes stale silently, and the problem only shows up as a customer complaint.',
            'Loosen the threshold per domain, based on the metric: where the false positive is low and the hit rate is low, you can lower the cutoff; where the risk is high, stay conservative.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The difference between a semantic cache that cuts the invoice without anyone noticing and one that serves the wrong answer lives entirely in the ruler and the filter, not in the embedding algorithm. The embedding is a commodity; the threshold calibrated per domain, the cacheability filter, the TTL and the false positive metric are what turn an attractive idea into a reliable production layer. Done right, it is one of the best cost-benefit ratios of an LLM system: a few hundred lines that pay off in tokens, latency and experience, without trading savings for a wrong answer.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is a semantic cache not the same as a normal cache with the question as the key?',
      answer:
        'No. A normal cache matches the key by exact equality: same string, same hash. In natural language that almost never hits, because the same intent appears in infinite forms ("what is the deadline?" and "how many days until it arrives?" have different hashes and identical answers). The semantic cache swaps the criterion: it turns the question into an embedding and matches by meaning, using cosine similarity with a threshold. That way it captures the whole family of variations of the same question, something impossible for the exact cache. The price is a new class of error, the false positive, which the exact cache does not have.',
    },
    {
      question: 'What is the biggest risk of the semantic cache and how do you control it?',
      answer:
        'The biggest risk is the false positive: matching two similar but differently answered questions and serving one answer for the other. It is a silent error, it does not throw an exception, it just delivers wrong information looking like a ready answer. You control it with a similarity threshold calibrated per domain (higher in a sensitive domain like billing or health), with the cacheability filter (live and per-user data never enter the cache) and with the false positive metric measured by sampling. The rule is simple: savings are good, but the right answer comes first; a rising false positive is a direct order to raise the threshold.',
    },
    {
      question: 'Can every question be cached?',
      answer:
        'No. The semantic cache assumes the same question has the same answer, and that only holds for stable knowledge (FAQ, definition, policy, step by step). Questions whose answer depends on live data (price, stock, quote) or user context (order status, balance, personal data) cannot be cached, because the answer is not a function of the question alone, it is a function of the question plus the state plus the moment. Caching "what is the status of my order?" would serve one user status to another. That is why the cache entrance needs a filter that blocks a dynamic question before any similarity search.',
    },
  ],
  conclusion: {
    title: 'Semantic cache cuts LLM cost when the ruler is in the right place',
    description:
      'Matching a question by meaning saves tokens and latency on repeated questions, but it is only safe with a threshold calibrated per domain, a filter for what cannot be cached, TTL with invalidation and a false positive metric. I can design that layer in your AI system, from the embedding to observability, cutting the invoice without trading savings for a wrong answer.',
    cta: 'Talk about semantic cache in my AI system',
  },
  related: [
    { label: 'CAG vs RAG: context cache against retrieval', to: '/blog/cag-vs-rag-cache-contexto' },
    { label: 'LLM observability: tracing, cost and quality', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'semantic-cache-llm-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Dos personas preguntan lo mismo de dos formas distintas: "¿cómo cancelo mi pedido?" y "quiero desistir de la compra, ¿qué hago?". Para un cache tradicional, son dos claves distintas, dos cache miss, dos llamadas al modelo, dos facturas. Pero la intención es idéntica, y la respuesta podría ser la misma. El cache semántico existe para explotar exactamente esto: en vez de casar la pregunta por texto exacto, la casa por significado. Transforma la pregunta en embedding, busca en el historial la pregunta más parecida y, si la similitud supera un umbral, devuelve la respuesta ya generada sin llamar al modelo. Bien calibrado, un cache semántico corta una porción grande del costo de LLM y baja la latencia de preguntas repetidas de segundos a milisegundos. Mal calibrado, entrega la respuesta de una pregunta a otra parecida pero distinta, lo que es peor que no tener cache. Este artículo muestra cómo construir esa capa con la regla en el lugar correcto: el umbral de similitud, el TTL y la invalidación, lo que nunca debe ir al cache y la métrica que dice si está ayudando o estorbando.',
  sections: [
    {
      title: 'El cache exacto no sirve para lenguaje natural',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un cache tradicional casa la clave por igualdad byte a byte: misma string, mismo hash, cache hit. Eso funciona para consultas estructuradas (id de producto, url, parámetro numérico), donde dos requests iguales son de hecho el mismo request. Pero el lenguaje natural rompe esa premisa. La misma intención aparece en infinitas formas: sinónimos, orden de las palabras, jerga, errores de tipeo, puntuación. "¿Cuál es el plazo de entrega?" y "¿en cuántos días llega?" tienen hash completamente distinto y respuesta idéntica. En un cache exacto, cada variación es un miss, y el modelo es llamado de nuevo para responder algo que ya respondió con otras palabras.',
        },
        {
          type: 'paragraph',
          value:
            'El cache semántico cambia el criterio de comparación. En vez de preguntar "¿esta string es idéntica?", pregunta "¿esta pregunta significa lo mismo que alguna que ya respondí?". La tabla de abajo separa los dos para dejar claro en qué sirve cada uno.',
        },
        {
          type: 'table',
          columns: ['Dimensión', 'Cache exacto', 'Cache semántico'],
          rows: [
            [
              'Criterio de acierto',
              'String idéntica (hash)',
              'Similitud de significado (embedding)',
            ],
            [
              'Sirve bien para',
              'Clave estructurada, id, url',
              'Pregunta en lenguaje natural',
            ],
            [
              'Variación de forma',
              'Cada variación es un miss',
              'Formas equivalentes casan',
            ],
            [
              'Riesgo principal',
              'Baja tasa de acierto',
              'Casar preguntas parecidas pero distintas',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La ganancia es clara: donde el cache exacto acierta casi nada en lenguaje natural, el semántico captura la familia entera de variaciones de una misma pregunta. El precio es una nueva clase de error que el cache exacto nunca tuvo: el falso positivo, cuando dos preguntas parecidas pero con respuestas distintas terminan casando. Todo el resto del artículo gira en torno a mantener esa ganancia sin pagar ese precio.',
        },
      ],
    },
    {
      title: 'Cómo funciona: embedding, similitud y umbral',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El mecanismo tiene tres piezas. Primero, el embedding: la pregunta se vuelve un vector de números que representa su significado, y preguntas con sentido parecido generan vectores próximos en el espacio. Segundo, la búsqueda por similitud: la nueva pregunta se compara con las preguntas ya en cache, y la más próxima (mayor similitud de coseno) es la candidata. Tercero, el umbral: solo es cache hit si la similitud de la candidata supera un corte que definís. Debajo del umbral, lo trata como miss, llama al modelo y guarda la nueva respuesta. El flujo de abajo muestra el camino completo de una pregunta.',
        },
        {
          type: 'diagram',
          value: `Camino de una pregunta por el cache semántico

  pregunta del usuario
        |
        v
  genera embedding de la pregunta
        |
        v
  busca la pregunta más parecida en el cache
        |
        v
  [ ¿similitud >= umbral? ]
     |  sí                     |  no
     v                         v
  CACHE HIT               CACHE MISS
  devuelve respuesta      llama al modelo
  guardada (sin LLM)      guarda pregunta+respuesta+embedding
     |                         |
     v                         v
  responde en ms          responde y puebla el cache

  hit = ahorro de token + latencia baja
  miss = costo normal, pero alimenta el próximo hit`,
        },
        {
          type: 'code',
          value: `// cache/semantic.js
// Cache semantico minimo: casa la pregunta por significado, no por texto.
// Solo devuelve del cache si la similitud supera el umbral calibrado.

export function createSemanticCache({ embed, callModel, store, threshold = 0.92 }) {
  return async function ask(question) {
    const vector = await embed(question);

    // Busca la pregunta mas parecida ya respondida.
    const best = await store.nearest(vector); // { score, answer } | null

    // Solo es hit si la similitud supera el umbral. Debajo de el, es miss:
    // preguntas "parecidas" no son garantia de misma respuesta.
    if (best && best.score >= threshold) {
      return { answer: best.answer, cached: true, score: best.score };
    }

    // Miss: llama al modelo y alimenta el cache para el proximo acierto.
    const answer = await callModel(question);
    await store.put({ question, vector, answer });
    return { answer, cached: false };
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Fijate que el miss no es desperdicio: paga el costo normal de la llamada, pero graba la pregunta, el embedding y la respuesta, de modo que la próxima variación equivalente se vuelve hit. El cache se calienta con el uso. El punto sensible es uno solo, el valor de threshold, y es el que decide si la capa ayuda o entrega respuesta equivocada. Es lo que detalla la próxima sección.',
        },
      ],
    },
    {
      title: 'Calibrar el umbral: el único parámetro que importa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El umbral de similitud es la única perilla de verdad del cache semántico, y gobierna un trade-off directo. Umbral demasiado alto y casi nada casa: el cache se vuelve un cache exacto caro, con poco ahorro. Umbral demasiado bajo y cosas parecidas pero distintas casan: "¿cómo cancelo el pedido?" recibe la respuesta de "¿cómo cancelo la suscripción?", y el usuario se lleva información equivocada con la confianza de una respuesta lista. El error peligroso es el segundo, porque es silencioso: no revienta excepción, no aparece en el log de error, solo entrega la respuesta equivocada con cara de correcta.',
        },
        {
          type: 'list',
          items: [
            'No adivines el umbral: junta pares de preguntas reales etiquetadas como "misma respuesta" y "respuesta distinta" y mide la similitud de cada par. El umbral correcto es el que separa las dos nubes.',
            'Prefiere errar hacia el lado seguro: en dominio sensible (cobranza, salud, jurídico), un umbral más alto pierde algunos hits, pero evita el falso positivo, que ahí es caro. Un miss cuesta token; un falso positivo cuesta confianza.',
            'Calibra por dominio, no global: preguntas de FAQ toleran umbral más bajo; preguntas con dato específico (valor, plazo, id) exigen umbral alto porque una palabra cambia la respuesta entera.',
            'Revisa el umbral con dato, no con sensación: el baseline de hoy solo se compara al de mañana si tenés la métrica; sin medir, ajustás a ciegas.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La regla que lo resume: el umbral no es una constante universal, es una decisión de riesgo por dominio. Un asistente de FAQ genérico y un bot de soporte financiero no pueden tener el mismo corte, porque el costo de una respuesta equivocada es radicalmente distinto entre ellos. Empieza conservador (umbral alto), mide la tasa de acierto y de falso positivo, y solo entonces afloja donde el riesgo lo permita.',
        },
      ],
    },
    {
      title: 'Lo que nunca debe ir al cache',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El cache semántico asume una cosa: la misma pregunta tiene la misma respuesta. Cuando esa premisa no vale, el cache no solo deja de ayudar, miente. El caso más obvio es la pregunta cuya respuesta depende de dato vivo o de contexto del usuario. "¿Cuál es el estado de mi pedido?" es la misma frase para dos usuarios, casaría en el cache con similitud casi perfecta, y serviría el estado de uno para el otro. La respuesta no puede cachearse porque no es función solo de la pregunta, es función de la pregunta más el estado del usuario más el instante.',
        },
        {
          type: 'code',
          value: `// cache/policy.js
// No toda pregunta puede cachearse. Antes de consultar o grabar,
// decide si esa respuesta es estable suficiente para volverse cache.

export function isCacheable(question, ctx) {
  // La respuesta depende del usuario: estado del pedido, saldo, dato personal.
  if (ctx.usesUserData) return false;

  // La respuesta depende del ahora: precio, stock, disponibilidad, cotizacion.
  if (ctx.usesLiveData) return false;

  // Pregunta que dispara accion (cancelar, reembolsar) nunca es "cacheable".
  if (ctx.triggersAction) return false;

  // FAQ estable, explicacion de politica, definicion: puede cachear.
  return true;
}

// En el flujo: solo pasa por el cache semantico si isCacheable() es true.
// Si no, va directo al modelo (o a una tool de dato vivo).`,
        },
        {
          type: 'paragraph',
          value:
            'La separación práctica es entre pregunta de conocimiento estable y pregunta de dato dinámico. FAQ, definición, explicación de política, paso a paso de un proceso: son estables, la respuesta hoy es la respuesta mañana, y cachear es seguro y rentable. Estado, saldo, precio, disponibilidad, cualquier cosa por usuario o por instante: son dinámicas, y ahí el cache semántico es un vector de filtración y de respuesta obsoleta. La puerta de entrada del cache tiene que tener ese filtro, si no el ahorro viene a costa de servir dato de un usuario para otro, un error mucho más caro que la llamada que ahorraste.',
        },
      ],
    },
    {
      title: 'TTL, invalidación y cuándo una respuesta correcta se vuelve equivocada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Hasta una pregunta cacheable tiene validez. La política de reembolso cambia, el plazo de entrega se revisa, el texto de la FAQ se reescribe: la respuesta que estaba correcta ayer pasa a estar equivocada hoy, y un cache que la sirve indefinidamente propaga información desactualizada con la autoridad de una respuesta lista. Por eso el cache semántico necesita dos mecanismos de expiración. El TTL (time to live) le da un plazo de validez a cada entrada: pasado el plazo, la entrada expira y la próxima pregunta fuerza un miss que regenera la respuesta. La invalidación explícita permite tumbar entradas cuando sabés que la fuente cambió, sin esperar el TTL.',
        },
        {
          type: 'ordered',
          items: [
            'Define el TTL por naturaleza del contenido: una definición estable puede vivir días; una política que cambia con frecuencia merece TTL corto, de horas, para no servir versión vencida por mucho tiempo.',
            'Invalida en la fuente, no en el cache: cuando el texto de la FAQ o la política de reembolso se edita, dispara la invalidación de las entradas relacionadas en ese momento, en vez de confiar solo en el reloj del TTL.',
            'Trata la expiración como miss normal: entrada vencida no es error, es un miss que llama al modelo, regenera la respuesta y recalienta el cache con la versión nueva.',
            'No dejes crecer el cache sin límite: además del TTL, impone un tope de tamaño con desalojo del menos usado, si no el costo de memoria y de búsqueda corroe el ahorro que el cache trajo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El error clásico es montar el cache semántico y nunca pensar en expiración, tratando toda respuesta como eterna. El resultado es sutil y corrosivo: el sistema queda cada vez más rápido y más barato, pero también cada vez más desactualizado, respondiendo con políticas y plazos que ya no valen. TTL e invalidación son lo que mantiene el cache alineado con la verdad de la fuente. Sin ellos, cambiás costo de token por deuda de corrección, que cobra intereses en forma de reclamo de cliente.',
        },
      ],
    },
    {
      title: 'Medir si el cache está ayudando o estorbando',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un cache semántico sin métrica es un palpito caro. Necesitás números para saber si está entregando ahorro real y, más importante, si no está sirviendo respuesta equivocada. Cuatro señales bastan para operar con confianza. La tasa de acierto (hit rate) dice cuánto del tráfico el cache está ahorrando de llamar al modelo, y es la medida directa del ahorro. El ahorro estimado traduce el hit rate en token y costo evitados. La latencia compara el tiempo de un hit (milisegundos) con el de un miss (la llamada entera al modelo). Y la tasa de falso positivo, la más importante y la más ignorada, mide cuántos hits entregaron la respuesta equivocada.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Qué revela', 'Cuándo actuar'],
          rows: [
            [
              'Hit rate',
              'Fracción de preguntas servidas del cache',
              'Muy bajo: umbral demasiado alto o poco tráfico repetido',
            ],
            [
              'Costo evitado',
              'Token y dinero ahorrados por los hits',
              'Justifica (o no) mantener la capa',
            ],
            [
              'Latencia hit vs miss',
              'Ganancia de tiempo por respuesta cacheada',
              'Confirma el beneficio de experiencia',
            ],
            [
              'Falso positivo',
              'Hits que sirvieron respuesta equivocada',
              'Cualquier valor relevante: sube el umbral ya',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tasa de falso positivo es la que separa un cache en el que confías de uno que asusta, y es la más difícil de medir porque no revienta sola. Un muestreo periódico de hits revisado por un humano o por un modelo juez revela si la respuesta servida del cache coincidía con la que el modelo habría dado. Un falso positivo subiendo es orden directa para elevar el umbral, aunque eso baje un poco el hit rate. La jerarquía es clara: el ahorro es bueno, pero la respuesta correcta viene primero. Un cache que ahorra 40% pero sirve 3% de respuestas equivocadas no vale la pena; uno que ahorra 25% con falso positivo cerca de cero es oro.',
        },
      ],
    },
    {
      title: 'Montar la capa sin volverla riesgo nuevo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El cache semántico es una de las pocas optimizaciones de LLM con retorno inmediato: reduce costo y latencia al mismo tiempo, y el esfuerzo de implementación es modesto. Pero es una optimización que introduce una clase de error nueva, así que el orden de despliegue importa tanto como el código. El camino es empezar seguro y aflojar con dato en la mano.',
        },
        {
          type: 'ordered',
          items: [
            'Empieza por el filtro de cacheabilidad: antes de tocar embedding, garantiza que pregunta con dato vivo o por usuario nunca entra al cache. Ese filtro previene el error más caro (dato de un usuario servido a otro).',
            'Enciende el cache solo en la lectura primero, con umbral alto: observa el hit rate y muestrea los hits para medir falso positivo antes de confiar en la capa de verdad.',
            'Instrumenta las cuatro métricas desde el día uno: hit rate, costo evitado, latencia y falso positivo. Sin ellas no sabés si estás ahorrando o entregando respuesta equivocada.',
            'Agrega TTL e invalidación antes de escalar: sin expiración, el cache queda desactualizado en silencio, y el problema solo aparece en reclamo de cliente.',
            'Afloja el umbral por dominio, con base en la métrica: donde el falso positivo es bajo y el hit rate bajo, se puede bajar el corte; donde el riesgo es alto, mantené conservador.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La diferencia entre un cache semántico que corta la factura sin que nadie lo note y uno que sirve respuesta equivocada está entera en la regla y en el filtro, no en el algoritmo de embedding. El embedding es commodity; el umbral calibrado por dominio, el filtro de cacheabilidad, el TTL y la métrica de falso positivo son lo que transforma una idea atractiva en una capa de producción confiable. Bien hecho, es una de las mejores relaciones costo-beneficio de un sistema con LLM: pocas centenas de líneas que pagan token, latencia y experiencia, sin cambiar ahorro por respuesta equivocada.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿El cache semántico no es lo mismo que un cache normal con la pregunta como clave?',
      answer:
        'No. Un cache normal casa la clave por igualdad exacta: misma string, mismo hash. En lenguaje natural eso casi nunca acierta, porque la misma intención aparece en infinitas formas ("¿cuál es el plazo?" y "¿en cuántos días llega?" tienen hash distinto y respuesta idéntica). El cache semántico cambia el criterio: transforma la pregunta en embedding y casa por significado, usando similitud de coseno con un umbral. Así captura la familia entera de variaciones de una misma pregunta, algo imposible para el cache exacto. El precio es una clase de error nueva, el falso positivo, que el cache exacto no tiene.',
    },
    {
      question: '¿Cuál es el mayor riesgo del cache semántico y cómo se controla?',
      answer:
        'El mayor riesgo es el falso positivo: casar dos preguntas parecidas pero con respuestas distintas y servir la respuesta de una para la otra. Es un error silencioso, no revienta excepción, solo entrega información equivocada con cara de respuesta lista. Se controla con el umbral de similitud calibrado por dominio (más alto en dominio sensible como cobranza o salud), con el filtro de cacheabilidad (dato vivo y por usuario nunca entran al cache) y con la métrica de falso positivo medida por muestreo. La regla es simple: el ahorro es bueno, pero la respuesta correcta viene primero; un falso positivo subiendo es orden directa para elevar el umbral.',
    },
    {
      question: '¿Toda pregunta puede cachearse?',
      answer:
        'No. El cache semántico asume que la misma pregunta tiene la misma respuesta, y eso solo vale para conocimiento estable (FAQ, definición, política, paso a paso). Preguntas cuya respuesta depende de dato vivo (precio, stock, cotización) o de contexto del usuario (estado del pedido, saldo, dato personal) no pueden cachearse, porque la respuesta no es función solo de la pregunta, es función de la pregunta más el estado más el instante. Cachear "¿cuál es el estado de mi pedido?" serviría el estado de un usuario para otro. Por eso la puerta de entrada del cache necesita un filtro que bloquea pregunta dinámica antes de cualquier búsqueda por similitud.',
    },
  ],
  conclusion: {
    title: 'El cache semántico corta costo de LLM cuando la regla está en el lugar correcto',
    description:
      'Casar pregunta por significado ahorra token y latencia de preguntas repetidas, pero solo es seguro con umbral calibrado por dominio, filtro de lo que no puede cachearse, TTL con invalidación y métrica de falso positivo. Puedo diseñar esa capa en tu sistema de IA, del embedding a la observabilidad, cortando factura sin cambiar ahorro por respuesta equivocada.',
    cta: 'Hablar sobre cache semántico en mi sistema de IA',
  },
  related: [
    { label: 'CAG vs RAG: cache de contexto contra retrieval', to: '/blog/cag-vs-rag-cache-contexto' },
    { label: 'Observabilidad de LLM: tracing, costo y calidad', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'semantic-cache-llm-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
