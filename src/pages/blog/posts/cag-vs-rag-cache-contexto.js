// Conteudo do artigo: CAG x RAG, quando cache de contexto vence retrieval.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Exemplo lado a lado de CAG e RAG: base de conhecimento em cache de contexto com prompt caching versus retrieval em vector store, com medicao de latencia e custo.',
  en: 'Side-by-side example of CAG and RAG: knowledge base in a context cache with prompt caching versus vector store retrieval, with latency and cost measurement.',
  es: 'Ejemplo lado a lado de CAG y RAG: base de conocimiento en cache de contexto con prompt caching frente a retrieval en vector store, con medicion de latencia y costo.',
};

const repoUrl = 'https://github.com/joaosouz4dev/cag-vs-rag-example';

const pt = {
  intro:
    'Quase todo mundo que precisa de um assistente sobre uma base propria assume que a resposta e RAG. Mas RAG carrega um custo escondido: a cada pergunta voce embeda, busca, reordena e injeta chunks, e qualquer erro nessa cadeia vira resposta errada com confianca. CAG (Cache Augmented Generation) propoe outro caminho: se a sua base inteira cabe na janela de contexto do modelo, carregue tudo de uma vez, marque como cacheada e reutilize esse cache em cada pergunta, sem retrieval nenhum. Este artigo compara os dois de frente, mostra os fluxos lado a lado, quando cada um vence, um exemplo real de prompt caching e como combinar os dois numa arquitetura hibrida.',
  sections: [
    {
      title: 'O que e RAG e o que e CAG',
      blocks: [
        {
          type: 'paragraph',
          value:
            'RAG (Retrieval Augmented Generation) recupera, a cada query, os trechos mais relevantes de um vector store e os injeta no prompt antes de gerar a resposta. A base nunca entra inteira no contexto: voce indexa documentos em chunks com embeddings e, na hora da pergunta, traz apenas o top-k mais parecido. E a abordagem padrao quando a base e grande demais para caber no contexto.',
        },
        {
          type: 'paragraph',
          value:
            'CAG (Cache Augmented Generation) inverte a logica: carrega TODA a base de conhecimento dentro do contexto do modelo uma unica vez, deixa o modelo processar esse bloco e reaproveita o estado interno (o KV cache, exposto pelos provedores como prompt cache) nas perguntas seguintes. Nao ha embedding por query, nao ha vector store, nao ha reranking. A pergunta do usuario e anexada ao contexto ja cacheado e a geracao acontece direto. O preco a pagar e que a base toda precisa caber na janela de contexto.',
        },
      ],
    },
    {
      title: 'Comparacao direta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A escolha entre RAG e CAG nao e ideologica: cada dimensao puxa para um lado. A tabela abaixo coloca as seis dimensoes que mais pesam na decisao real de engenharia.',
        },
        {
          type: 'table',
          columns: ['Dimensao', 'RAG', 'CAG'],
          rows: [
            [
              'Latencia por query',
              'Maior: embed da pergunta, busca, reranking e so depois geracao',
              'Menor: sem retrieval, a base ja cacheada vai direto para a geracao',
            ],
            [
              'Custo',
              'Paga embeddings e infra de busca, mas processa poucos tokens por query',
              'Processa a base inteira na primeira vez; com prompt cache, as proximas saem baratas',
            ],
            [
              'Frescor do dado',
              'Alto: reindexa um documento e a mudanca vale na proxima query',
              'Menor: ao mudar a base, o cache precisa ser refeito',
            ],
            [
              'Tamanho maximo da base',
              'Praticamente ilimitado (milhoes de chunks no vector store)',
              'Limitado pela janela de contexto do modelo',
            ],
            [
              'Complexidade de infra',
              'Alta: pipeline de ingestao, vector store, embeddings, reranking',
              'Baixa: sem vector store, apenas montar o contexto e cachear',
            ],
            [
              'Risco de recuperar chunk errado',
              'Existe: retrieval pode trazer o trecho errado e o modelo responde em cima dele',
              'Inexistente: o modelo ve a base inteira, nao depende de buscar o trecho certo',
            ],
          ],
        },
      ],
    },
    {
      title: 'Os dois fluxos lado a lado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Visualizar os dois caminhos deixa clara a diferenca de superficie: RAG tem uma cadeia de etapas por query, cada uma com seu ponto de falha; CAG concentra o trabalho pesado uma unica vez e depois so anexa a pergunta.',
        },
        {
          type: 'diagram',
          value: `RAG (por query)
  Query  ->  Embed  ->  Retrieve (top-k)  ->  Rerank  ->  Gerar  ->  Resposta
                          (vector store)     (cross-encoder)

CAG (uma vez + por query)
  Base inteira  ->  Contexto / KV cache (prompt cache)
                          |
                          v
  Query  ----------->  Gerar  ->  Resposta
  (anexada ao contexto ja cacheado, sem retrieval)`,
        },
        {
          type: 'paragraph',
          value:
            'Em RAG, cada seta antes de "Gerar" e uma chance de errar: a pergunta pode embedar mal, o top-k pode nao trazer o trecho certo, o reranking pode reordenar errado. Em CAG, o caminho entre a pergunta e a resposta e curto porque o conhecimento ja esta presente e processado.',
        },
      ],
    },
    {
      title: 'Quando CAG vence',
      blocks: [
        {
          type: 'paragraph',
          value:
            'CAG e a escolha certa quando a base e contida e estavel, e quando latencia ou correcao do retrieval importam mais do que escalar para milhoes de documentos.',
        },
        {
          type: 'list',
          items: [
            'Base pequena ou media que cabe inteira na janela de contexto: FAQ, manual de produto, politicas de troca e entrega, base de regras de um nicho.',
            'Dado relativamente estavel: muda em semanas ou meses, nao a cada minuto, entao refazer o cache de vez em quando e barato.',
            'Latencia critica: ao eliminar embed, busca e reranking, a primeira resposta apos o cache quente sai bem mais rapido.',
            'Evitar erro de retrieval: como o modelo ve a base inteira, some a classe de falha em que o chunk certo simplesmente nao foi recuperado.',
            'Infra enxuta: sem vector store nem pipeline de embeddings para manter, o sistema tem menos partes moveis e menos custo operacional.',
          ],
        },
      ],
    },
    {
      title: 'Quando RAG vence',
      blocks: [
        {
          type: 'paragraph',
          value:
            'RAG continua imbativel quando a base nao cabe no contexto, muda o tempo todo, precisa de rastreabilidade fina por fonte ou serve muitos clientes com bases isoladas.',
        },
        {
          type: 'list',
          items: [
            'Base grande que nao cabe no contexto: dezenas de milhares de documentos, anos de tickets, catalogos extensos. Aqui CAG simplesmente nao entra.',
            'Dado que muda muito: estoque, precos, conteudo atualizado todo dia. Reindexar um documento e barato; refazer o cache da base inteira a cada mudanca nao.',
            'Necessidade de citar fonte especifica: quando cada afirmacao precisa apontar exatamente para o documento e a secao de origem, o retrieval entrega esse rastro naturalmente.',
            'Multi-tenant com bases isoladas: muitos clientes, cada um com sua base privada. O vector store filtra por tenant; manter um cache gigante por cliente seria caro e arriscado.',
          ],
        },
      ],
    },
    {
      title: 'Exemplo pratico com prompt caching',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O coracao do CAG e o prompt cache: o provedor processa o bloco grande da base de conhecimento uma vez e guarda o estado, de forma que as proximas requisicoes que comecam com o mesmo prefixo reaproveitam esse trabalho. No exemplo abaixo, usando a Anthropic Messages API, a base de conhecimento vai como um bloco de sistema marcado com cache_control. A primeira pergunta paga o processamento da base; as seguintes leem do cache e custam uma fracao.',
        },
        {
          type: 'code',
          value: `import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// A base de conhecimento inteira: FAQ + politicas + manual.
// Carregada uma vez e marcada como cacheada.
const KNOWLEDGE_BASE = loadKnowledgeBase(); // string grande, cabe no contexto

async function ask(question) {
  return client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    system: [
      {
        type: 'text',
        text: 'Voce responde EXCLUSIVAMENTE com base na BASE DE CONHECIMENTO abaixo. Se nao houver resposta nela, diga que nao sabe.',
      },
      {
        type: 'text',
        text: KNOWLEDGE_BASE,
        // Marca este bloco como cacheado: processado uma vez,
        // reaproveitado nas proximas requisicoes com o mesmo prefixo.
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: question }],
  });
}

// 1a pergunta: cache_creation_input_tokens (paga o processamento da base).
await ask('Qual o prazo de troca de um produto com defeito?');

// 2a pergunta em diante: cache_read_input_tokens (le do cache, custa fracao).
await ask('Voces entregam no interior?');
await ask('Como funciona a garantia estendida?');`,
        },
        {
          type: 'paragraph',
          value:
            'O ganho fica explicito nos contadores de uso: a primeira chamada registra cache_creation_input_tokens (a base foi processada e cacheada) e as seguintes registram cache_read_input_tokens, cobrados por uma fracao do preco normal de entrada. Ou seja, a base e processada uma vez e o mesmo cache serve todas as perguntas seguintes, enquanto o cache estiver quente. Sem retrieval, sem vector store: o conhecimento ja esta no contexto.',
        },
      ],
    },
    {
      title: 'Abordagem hibrida: o melhor dos dois',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Na pratica, CAG e RAG nao sao rivais: a arquitetura mais robusta usa CAG para o core estavel e RAG para o long tail. O nucleo de conhecimento que quase nao muda e que responde a maioria das perguntas fica cacheado no contexto; o que e raro, volumoso ou volatil fica no vector store e so e recuperado quando o core nao basta.',
        },
        {
          type: 'ordered',
          items: [
            'Identifique o core estavel: as politicas, o FAQ e o manual que respondem a maior parte das perguntas e mudam pouco. Esse bloco vira o contexto cacheado (CAG).',
            'Mantenha o long tail no vector store: documentos extensos, casos raros, conteudo que muda com frequencia. Eles ficam indexados para RAG.',
            'Responda primeiro pelo cache: a pergunta chega ao contexto ja cacheado. Se o core cobre, responde direto, com baixa latencia e sem risco de retrieval.',
            'Acione RAG so no long tail: quando a resposta nao esta no core, dispare o retrieval para buscar o trecho especifico no vector store e injete-o junto.',
            'Reavalie a fronteira periodicamente: promova ao core estavel o que virou pergunta frequente e refaca o cache; rebaixe ao vector store o que ficou raro.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'CAG substitui RAG?',
      answer:
        'Nao. CAG substitui RAG apenas no recorte em que a base inteira cabe no contexto e muda pouco: ali ele vence em latencia, simplicidade e ausencia de erro de retrieval. Para bases grandes, muito dinamicas ou multi-tenant com isolamento, RAG continua necessario. O cenario mais comum em producao e hibrido: CAG para o core estavel e RAG para o long tail.',
    },
    {
      question: 'Qual o limite de tamanho para CAG?',
      answer:
        'O limite e a janela de contexto do modelo: a base de conhecimento, mais o prompt de sistema, mais a pergunta e a resposta precisam caber nela. Na pratica, voce deixa margem confortavel para a conversa e nao enche a janela ate o teto, porque contexto muito cheio degrada qualidade e encarece. Quando a base ultrapassa esse limite, e o sinal de migrar para RAG ou para a abordagem hibrida.',
    },
    {
      question: 'Como o prompt cache reduz custo?',
      answer:
        'O bloco grande da base de conhecimento e processado uma unica vez e guardado como cache. A primeira requisicao paga a criacao do cache (cache_creation_input_tokens); as seguintes, com o mesmo prefixo, apenas leem dele (cache_read_input_tokens), cobrados por uma fracao do preco normal de entrada. Como a base se repete em toda pergunta, esse prefixo cacheado dilui o custo entre muitas requisicoes em vez de reprocessar a base toda vez.',
    },
  ],
  conclusion: {
    title: 'Escolha pelo formato da sua base, nao pela moda',
    description:
      'RAG e CAG resolvem problemas diferentes: retrieval para bases grandes e dinamicas, cache de contexto para bases contidas e estaveis onde latencia e precisao importam. Posso avaliar a sua base e desenhar a arquitetura certa, CAG, RAG ou hibrida, com prompt caching e medicao de custo e latencia.',
    cta: 'Falar sobre minha arquitetura de IA',
  },
  related: [
    { label: 'RAG para atendimento no WhatsApp em producao', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Chatbots e IA para atendimento', to: '/servicos/chatbots-e-ia' },
    { label: 'ROI real de automacao com IA', to: '/blog/roi-real-automacao-ia' },
  ],
  repo: { name: 'cag-vs-rag-example', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'Almost everyone who needs an assistant over their own knowledge base assumes the answer is RAG. But RAG carries a hidden cost: for every question you embed, search, rerank and inject chunks, and any error in that chain becomes a confident wrong answer. CAG (Cache Augmented Generation) proposes another path: if your whole base fits in the model context window, load it all at once, mark it as cached and reuse that cache on every question, with no retrieval at all. This article compares the two head to head, shows the flows side by side, when each one wins, a real prompt caching example and how to combine both in a hybrid architecture.',
  sections: [
    {
      title: 'What RAG is and what CAG is',
      blocks: [
        {
          type: 'paragraph',
          value:
            'RAG (Retrieval Augmented Generation) retrieves, on every query, the most relevant chunks from a vector store and injects them into the prompt before generating the answer. The base never enters the context whole: you index documents as chunks with embeddings and, at question time, bring only the most similar top-k. It is the default approach when the base is too large to fit in the context.',
        },
        {
          type: 'paragraph',
          value:
            'CAG (Cache Augmented Generation) flips the logic: it loads the ENTIRE knowledge base into the model context once, lets the model process that block and reuses the internal state (the KV cache, exposed by providers as prompt cache) on the following questions. There is no per-query embedding, no vector store, no reranking. The user question is appended to the already cached context and generation happens directly. The price you pay is that the whole base must fit in the context window.',
        },
      ],
    },
    {
      title: 'Direct comparison',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The choice between RAG and CAG is not ideological: each dimension pulls one way. The table below lays out the six dimensions that weigh the most in the real engineering decision.',
        },
        {
          type: 'table',
          columns: ['Dimension', 'RAG', 'CAG'],
          rows: [
            [
              'Latency per query',
              'Higher: embed the question, search, rerank and only then generate',
              'Lower: no retrieval, the already cached base goes straight to generation',
            ],
            [
              'Cost',
              'Pays for embeddings and search infra, but processes few tokens per query',
              'Processes the whole base the first time; with prompt cache, the next ones are cheap',
            ],
            [
              'Data freshness',
              'High: reindex a document and the change applies on the next query',
              'Lower: when the base changes, the cache must be rebuilt',
            ],
            [
              'Maximum base size',
              'Practically unlimited (millions of chunks in the vector store)',
              'Limited by the model context window',
            ],
            [
              'Infra complexity',
              'High: ingestion pipeline, vector store, embeddings, reranking',
              'Low: no vector store, just assemble the context and cache it',
            ],
            [
              'Risk of retrieving the wrong chunk',
              'Exists: retrieval may bring the wrong chunk and the model answers on top of it',
              'None: the model sees the whole base, it does not depend on fetching the right chunk',
            ],
          ],
        },
      ],
    },
    {
      title: 'The two flows side by side',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Visualizing both paths makes the surface difference clear: RAG has a chain of steps per query, each with its own failure point; CAG concentrates the heavy work once and then just appends the question.',
        },
        {
          type: 'diagram',
          value: `RAG (per query)
  Query  ->  Embed  ->  Retrieve (top-k)  ->  Rerank  ->  Generate  ->  Answer
                          (vector store)     (cross-encoder)

CAG (once + per query)
  Whole base  ->  Context / KV cache (prompt cache)
                        |
                        v
  Query  --------->  Generate  ->  Answer
  (appended to the already cached context, no retrieval)`,
        },
        {
          type: 'paragraph',
          value:
            'In RAG, each arrow before "Generate" is a chance to fail: the question may embed poorly, the top-k may miss the right chunk, the reranking may reorder wrong. In CAG, the path between question and answer is short because the knowledge is already present and processed.',
        },
      ],
    },
    {
      title: 'When CAG wins',
      blocks: [
        {
          type: 'paragraph',
          value:
            'CAG is the right choice when the base is contained and stable, and when latency or retrieval correctness matter more than scaling to millions of documents.',
        },
        {
          type: 'list',
          items: [
            'Small or medium base that fits whole in the context window: FAQ, product manual, return and delivery policies, the rule base of a niche.',
            'Relatively stable data: it changes over weeks or months, not every minute, so rebuilding the cache now and then is cheap.',
            'Critical latency: by removing embed, search and reranking, the first answer after the cache is warm comes out much faster.',
            'Avoiding retrieval error: since the model sees the whole base, the failure class where the right chunk was simply not retrieved disappears.',
            'Lean infra: with no vector store nor embeddings pipeline to maintain, the system has fewer moving parts and lower operating cost.',
          ],
        },
      ],
    },
    {
      title: 'When RAG wins',
      blocks: [
        {
          type: 'paragraph',
          value:
            'RAG stays unbeatable when the base does not fit in the context, changes all the time, needs fine traceability per source or serves many clients with isolated bases.',
        },
        {
          type: 'list',
          items: [
            'Large base that does not fit in the context: tens of thousands of documents, years of tickets, extensive catalogs. CAG simply does not apply here.',
            'Data that changes a lot: inventory, prices, content updated every day. Reindexing one document is cheap; rebuilding the cache of the whole base on every change is not.',
            'Need to cite a specific source: when each statement must point exactly to the source document and section, retrieval delivers that trail naturally.',
            'Multi-tenant with isolated bases: many clients, each with its private base. The vector store filters by tenant; keeping a giant cache per client would be costly and risky.',
          ],
        },
      ],
    },
    {
      title: 'Practical example with prompt caching',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The heart of CAG is the prompt cache: the provider processes the large knowledge base block once and stores the state, so that the next requests starting with the same prefix reuse that work. In the example below, using the Anthropic Messages API, the knowledge base goes as a system block marked with cache_control. The first question pays for processing the base; the following ones read from the cache and cost a fraction.',
        },
        {
          type: 'code',
          value: `import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// The entire knowledge base: FAQ + policies + manual.
// Loaded once and marked as cached.
const KNOWLEDGE_BASE = loadKnowledgeBase(); // large string, fits in the context

async function ask(question) {
  return client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    system: [
      {
        type: 'text',
        text: 'You answer EXCLUSIVELY from the KNOWLEDGE BASE below. If the answer is not in it, say you do not know.',
      },
      {
        type: 'text',
        text: KNOWLEDGE_BASE,
        // Marks this block as cached: processed once,
        // reused on the next requests with the same prefix.
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: question }],
  });
}

// 1st question: cache_creation_input_tokens (pays for processing the base).
await ask('What is the return window for a defective product?');

// 2nd question onward: cache_read_input_tokens (reads from cache, costs a fraction).
await ask('Do you deliver to remote areas?');
await ask('How does the extended warranty work?');`,
        },
        {
          type: 'paragraph',
          value:
            'The gain shows up in the usage counters: the first call records cache_creation_input_tokens (the base was processed and cached) and the following ones record cache_read_input_tokens, charged at a fraction of the normal input price. In other words, the base is processed once and the same cache serves all the following questions, while the cache stays warm. No retrieval, no vector store: the knowledge is already in the context.',
        },
      ],
    },
    {
      title: 'Hybrid approach: the best of both',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In practice, CAG and RAG are not rivals: the most robust architecture uses CAG for the stable core and RAG for the long tail. The knowledge core that barely changes and answers most questions stays cached in the context; what is rare, bulky or volatile stays in the vector store and is only retrieved when the core is not enough.',
        },
        {
          type: 'ordered',
          items: [
            'Identify the stable core: the policies, FAQ and manual that answer most questions and change little. That block becomes the cached context (CAG).',
            'Keep the long tail in the vector store: extensive documents, rare cases, content that changes frequently. They stay indexed for RAG.',
            'Answer from the cache first: the question reaches the already cached context. If the core covers it, answer directly, with low latency and no retrieval risk.',
            'Trigger RAG only on the long tail: when the answer is not in the core, fire retrieval to fetch the specific chunk in the vector store and inject it alongside.',
            'Reassess the boundary periodically: promote to the stable core what became a frequent question and rebuild the cache; demote to the vector store what became rare.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does CAG replace RAG?',
      answer:
        'No. CAG replaces RAG only in the slice where the whole base fits in the context and changes little: there it wins on latency, simplicity and absence of retrieval error. For large, very dynamic or multi-tenant isolated bases, RAG is still needed. The most common production scenario is hybrid: CAG for the stable core and RAG for the long tail.',
    },
    {
      question: 'What is the size limit for CAG?',
      answer:
        'The limit is the model context window: the knowledge base, plus the system prompt, plus the question and the answer must fit in it. In practice you leave comfortable room for the conversation and do not fill the window to the top, because an overly full context degrades quality and raises cost. When the base exceeds that limit, that is the signal to move to RAG or to the hybrid approach.',
    },
    {
      question: 'How does the prompt cache reduce cost?',
      answer:
        'The large knowledge base block is processed once and stored as cache. The first request pays for cache creation (cache_creation_input_tokens); the following ones, with the same prefix, only read from it (cache_read_input_tokens), charged at a fraction of the normal input price. Since the base repeats on every question, that cached prefix spreads the cost across many requests instead of reprocessing the base every time.',
    },
  ],
  conclusion: {
    title: 'Choose by the shape of your base, not by the trend',
    description:
      'RAG and CAG solve different problems: retrieval for large and dynamic bases, context cache for contained and stable bases where latency and precision matter. I can assess your base and design the right architecture, CAG, RAG or hybrid, with prompt caching and cost and latency measurement.',
    cta: 'Talk about my AI architecture',
  },
  related: [
    { label: 'RAG for WhatsApp support in production', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Chatbots and AI for support', to: '/servicos/chatbots-e-ia' },
    { label: 'Real ROI of AI automation', to: '/blog/roi-real-automacao-ia' },
  ],
  repo: { name: 'cag-vs-rag-example', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Casi todos los que necesitan un asistente sobre una base propia asumen que la respuesta es RAG. Pero RAG carga un costo escondido: en cada pregunta embebes, buscas, reordenas e inyectas chunks, y cualquier error en esa cadena se vuelve una respuesta equivocada con confianza. CAG (Cache Augmented Generation) propone otro camino: si tu base entera cabe en la ventana de contexto del modelo, cargala toda de una vez, marcala como cacheada y reutiliza ese cache en cada pregunta, sin retrieval alguno. Este articulo compara los dos de frente, muestra los flujos lado a lado, cuando gana cada uno, un ejemplo real de prompt caching y como combinar ambos en una arquitectura hibrida.',
  sections: [
    {
      title: 'Que es RAG y que es CAG',
      blocks: [
        {
          type: 'paragraph',
          value:
            'RAG (Retrieval Augmented Generation) recupera, en cada query, los fragmentos mas relevantes de un vector store y los inyecta en el prompt antes de generar la respuesta. La base nunca entra entera en el contexto: indexas documentos en chunks con embeddings y, al momento de la pregunta, traes solo el top-k mas parecido. Es el enfoque estandar cuando la base es demasiado grande para caber en el contexto.',
        },
        {
          type: 'paragraph',
          value:
            'CAG (Cache Augmented Generation) invierte la logica: carga TODA la base de conocimiento dentro del contexto del modelo una sola vez, deja que el modelo procese ese bloque y reaprovecha el estado interno (el KV cache, expuesto por los proveedores como prompt cache) en las preguntas siguientes. No hay embedding por query, no hay vector store, no hay reranking. La pregunta del usuario se anexa al contexto ya cacheado y la generacion ocurre directo. El precio a pagar es que la base completa debe caber en la ventana de contexto.',
        },
      ],
    },
    {
      title: 'Comparacion directa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La eleccion entre RAG y CAG no es ideologica: cada dimension tira para un lado. La tabla siguiente expone las seis dimensiones que mas pesan en la decision real de ingenieria.',
        },
        {
          type: 'table',
          columns: ['Dimension', 'RAG', 'CAG'],
          rows: [
            [
              'Latencia por query',
              'Mayor: embed de la pregunta, busqueda, reranking y solo despues generacion',
              'Menor: sin retrieval, la base ya cacheada va directo a la generacion',
            ],
            [
              'Costo',
              'Paga embeddings e infra de busqueda, pero procesa pocos tokens por query',
              'Procesa la base entera la primera vez; con prompt cache, las siguientes salen baratas',
            ],
            [
              'Frescura del dato',
              'Alta: reindexas un documento y el cambio vale en la proxima query',
              'Menor: al cambiar la base, el cache debe rehacerse',
            ],
            [
              'Tamano maximo de la base',
              'Practicamente ilimitado (millones de chunks en el vector store)',
              'Limitado por la ventana de contexto del modelo',
            ],
            [
              'Complejidad de infra',
              'Alta: pipeline de ingestion, vector store, embeddings, reranking',
              'Baja: sin vector store, solo montar el contexto y cachearlo',
            ],
            [
              'Riesgo de recuperar el chunk equivocado',
              'Existe: el retrieval puede traer el fragmento equivocado y el modelo responde sobre el',
              'Inexistente: el modelo ve la base entera, no depende de buscar el fragmento correcto',
            ],
          ],
        },
      ],
    },
    {
      title: 'Los dos flujos lado a lado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Visualizar ambos caminos deja clara la diferencia de superficie: RAG tiene una cadena de pasos por query, cada uno con su punto de falla; CAG concentra el trabajo pesado una sola vez y luego solo anexa la pregunta.',
        },
        {
          type: 'diagram',
          value: `RAG (por query)
  Query  ->  Embed  ->  Retrieve (top-k)  ->  Rerank  ->  Generar  ->  Respuesta
                          (vector store)     (cross-encoder)

CAG (una vez + por query)
  Base entera  ->  Contexto / KV cache (prompt cache)
                        |
                        v
  Query  --------->  Generar  ->  Respuesta
  (anexada al contexto ya cacheado, sin retrieval)`,
        },
        {
          type: 'paragraph',
          value:
            'En RAG, cada flecha antes de "Generar" es una oportunidad de fallar: la pregunta puede embeber mal, el top-k puede no traer el fragmento correcto, el reranking puede reordenar mal. En CAG, el camino entre la pregunta y la respuesta es corto porque el conocimiento ya esta presente y procesado.',
        },
      ],
    },
    {
      title: 'Cuando gana CAG',
      blocks: [
        {
          type: 'paragraph',
          value:
            'CAG es la eleccion correcta cuando la base es contenida y estable, y cuando la latencia o la correccion del retrieval importan mas que escalar a millones de documentos.',
        },
        {
          type: 'list',
          items: [
            'Base pequena o mediana que cabe entera en la ventana de contexto: FAQ, manual de producto, politicas de cambio y entrega, base de reglas de un nicho.',
            'Dato relativamente estable: cambia en semanas o meses, no a cada minuto, asi que rehacer el cache de vez en cuando es barato.',
            'Latencia critica: al eliminar embed, busqueda y reranking, la primera respuesta tras el cache caliente sale mucho mas rapido.',
            'Evitar error de retrieval: como el modelo ve la base entera, desaparece la clase de falla en que el chunk correcto simplemente no fue recuperado.',
            'Infra liviana: sin vector store ni pipeline de embeddings que mantener, el sistema tiene menos partes moviles y menor costo operativo.',
          ],
        },
      ],
    },
    {
      title: 'Cuando gana RAG',
      blocks: [
        {
          type: 'paragraph',
          value:
            'RAG sigue imbatible cuando la base no cabe en el contexto, cambia todo el tiempo, necesita trazabilidad fina por fuente o sirve a muchos clientes con bases aisladas.',
        },
        {
          type: 'list',
          items: [
            'Base grande que no cabe en el contexto: decenas de miles de documentos, anos de tickets, catalogos extensos. Aqui CAG simplemente no entra.',
            'Dato que cambia mucho: inventario, precios, contenido actualizado cada dia. Reindexar un documento es barato; rehacer el cache de la base entera en cada cambio no.',
            'Necesidad de citar fuente especifica: cuando cada afirmacion debe apuntar exactamente al documento y la seccion de origen, el retrieval entrega ese rastro de forma natural.',
            'Multi-tenant con bases aisladas: muchos clientes, cada uno con su base privada. El vector store filtra por tenant; mantener un cache gigante por cliente seria costoso y arriesgado.',
          ],
        },
      ],
    },
    {
      title: 'Ejemplo practico con prompt caching',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El corazon del CAG es el prompt cache: el proveedor procesa el bloque grande de la base de conocimiento una vez y guarda el estado, de modo que las proximas solicitudes que empiezan con el mismo prefijo reaprovechan ese trabajo. En el ejemplo siguiente, usando la Anthropic Messages API, la base de conocimiento va como un bloque de sistema marcado con cache_control. La primera pregunta paga el procesamiento de la base; las siguientes leen del cache y cuestan una fraccion.',
        },
        {
          type: 'code',
          value: `import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// La base de conocimiento entera: FAQ + politicas + manual.
// Cargada una vez y marcada como cacheada.
const KNOWLEDGE_BASE = loadKnowledgeBase(); // string grande, cabe en el contexto

async function ask(question) {
  return client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    system: [
      {
        type: 'text',
        text: 'Respondes EXCLUSIVAMENTE con base en la BASE DE CONOCIMIENTO abajo. Si la respuesta no esta en ella, di que no lo sabes.',
      },
      {
        type: 'text',
        text: KNOWLEDGE_BASE,
        // Marca este bloque como cacheado: procesado una vez,
        // reutilizado en las proximas solicitudes con el mismo prefijo.
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: question }],
  });
}

// 1a pregunta: cache_creation_input_tokens (paga el procesamiento de la base).
await ask('Cual es el plazo de cambio de un producto con defecto?');

// 2a pregunta en adelante: cache_read_input_tokens (lee del cache, cuesta fraccion).
await ask('Entregan en zonas alejadas?');
await ask('Como funciona la garantia extendida?');`,
        },
        {
          type: 'paragraph',
          value:
            'La ganancia se ve explicita en los contadores de uso: la primera llamada registra cache_creation_input_tokens (la base fue procesada y cacheada) y las siguientes registran cache_read_input_tokens, cobrados por una fraccion del precio normal de entrada. Es decir, la base se procesa una vez y el mismo cache sirve a todas las preguntas siguientes, mientras el cache este caliente. Sin retrieval, sin vector store: el conocimiento ya esta en el contexto.',
        },
      ],
    },
    {
      title: 'Enfoque hibrido: lo mejor de ambos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En la practica, CAG y RAG no son rivales: la arquitectura mas robusta usa CAG para el core estable y RAG para el long tail. El nucleo de conocimiento que casi no cambia y que responde la mayoria de las preguntas queda cacheado en el contexto; lo que es raro, voluminoso o volatil queda en el vector store y solo se recupera cuando el core no alcanza.',
        },
        {
          type: 'ordered',
          items: [
            'Identifica el core estable: las politicas, el FAQ y el manual que responden la mayor parte de las preguntas y cambian poco. Ese bloque se vuelve el contexto cacheado (CAG).',
            'Manten el long tail en el vector store: documentos extensos, casos raros, contenido que cambia con frecuencia. Quedan indexados para RAG.',
            'Responde primero por el cache: la pregunta llega al contexto ya cacheado. Si el core la cubre, responde directo, con baja latencia y sin riesgo de retrieval.',
            'Activa RAG solo en el long tail: cuando la respuesta no esta en el core, dispara el retrieval para buscar el fragmento especifico en el vector store e inyectalo junto.',
            'Reevalua la frontera periodicamente: promueve al core estable lo que se volvio pregunta frecuente y rehaz el cache; degrada al vector store lo que quedo raro.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'CAG sustituye a RAG?',
      answer:
        'No. CAG sustituye a RAG solo en el recorte donde la base entera cabe en el contexto y cambia poco: ahi gana en latencia, simplicidad y ausencia de error de retrieval. Para bases grandes, muy dinamicas o multi-tenant con aislamiento, RAG sigue siendo necesario. El escenario mas comun en produccion es hibrido: CAG para el core estable y RAG para el long tail.',
    },
    {
      question: 'Cual es el limite de tamano para CAG?',
      answer:
        'El limite es la ventana de contexto del modelo: la base de conocimiento, mas el prompt de sistema, mas la pregunta y la respuesta deben caber en ella. En la practica dejas margen comodo para la conversacion y no llenas la ventana hasta el tope, porque un contexto demasiado lleno degrada la calidad y encarece. Cuando la base supera ese limite, es la senal de migrar a RAG o al enfoque hibrido.',
    },
    {
      question: 'Como reduce el costo el prompt cache?',
      answer:
        'El bloque grande de la base de conocimiento se procesa una sola vez y se guarda como cache. La primera solicitud paga la creacion del cache (cache_creation_input_tokens); las siguientes, con el mismo prefijo, solo leen de el (cache_read_input_tokens), cobradas por una fraccion del precio normal de entrada. Como la base se repite en cada pregunta, ese prefijo cacheado reparte el costo entre muchas solicitudes en vez de reprocesar la base cada vez.',
    },
  ],
  conclusion: {
    title: 'Elige por la forma de tu base, no por la moda',
    description:
      'RAG y CAG resuelven problemas distintos: retrieval para bases grandes y dinamicas, cache de contexto para bases contenidas y estables donde la latencia y la precision importan. Puedo evaluar tu base y disenar la arquitectura correcta, CAG, RAG o hibrida, con prompt caching y medicion de costo y latencia.',
    cta: 'Hablar sobre mi arquitectura de IA',
  },
  related: [
    { label: 'RAG para atencion en WhatsApp en produccion', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Chatbots e IA para atencion', to: '/servicos/chatbots-e-ia' },
    { label: 'ROI real de automatizacion con IA', to: '/blog/roi-real-automacao-ia' },
  ],
  repo: { name: 'cag-vs-rag-example', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
