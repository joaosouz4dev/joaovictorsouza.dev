import { toBaseLanguage } from '../../utils/i18n.js';
import { getPostContentBySlug } from './posts/index.js';

const publishedPostDefinitions = [
  {
    slug: 'versionar-prompt-como-codigo-rollout-rollback-teste',
    date: '2026-07-23',
    readTime: '13 min',
    keywords: {
      pt: 'versionar prompt como codigo, rollout de prompt, rollback de prompt, versao imutavel, registro de prompt, manifesto de trafego, gate de eval, ci, teste de prompt, anthropic',
      en: 'version prompt as code, prompt rollout, prompt rollback, immutable version, prompt registry, traffic manifest, eval gate, ci, prompt testing, anthropic',
      es: 'versionar prompt como codigo, rollout de prompt, rollback de prompt, version inmutable, registro de prompt, manifiesto de trafico, gate de eval, ci, prueba de prompt, anthropic',
    },
    content: {
      pt: {
        title: 'Versionar prompt como código: rollout, rollback e teste',
        excerpt:
          'O prompt é o código mais crítico de um sistema com LLM e costuma ser o menos versionado: editado direto em produção porque parece só texto, sobrescrito sem histórico nem volta. Como tratar o prompt como código de verdade: a versão imutável com id derivado do conteúdo, o manifesto de tráfego que separa qual versão de quem a recebe, o rollout gradual comparado na mesma janela, o rollback que troca um ponteiro sem redeploy e o gate de eval que barra a regressão no CI antes de chegar ao cliente.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Versioning the prompt as code: rollout, rollback and testing',
        excerpt:
          'The prompt is the most critical code in an LLM system and tends to be the least versioned: edited straight in production because it looks like just text, overwritten with no history and no way back. How to treat the prompt as real code: the immutable version with a content-derived id, the traffic manifest that separates which version from who gets it, the gradual rollout compared in the same window, the rollback that flips a pointer without a redeploy and the eval gate that blocks the regression in CI before it reaches the customer.',
        category: 'Applied AI',
      },
      es: {
        title: 'Versionar el prompt como código: rollout, rollback y prueba',
        excerpt:
          'El prompt es el código más crítico de un sistema con LLM y suele ser el menos versionado: editado directo en producción porque parece solo texto, sobrescrito sin historial ni vuelta atrás. Cómo tratar el prompt como código de verdad: la versión inmutable con id derivado del contenido, el manifiesto de tráfico que separa qué versión de quién la recibe, el rollout gradual comparado en la misma ventana, el rollback que cambia un puntero sin redeploy y el gate de eval que bloquea la regresión en el CI antes de llegar al cliente.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'timeout-cancelamento-cadeia-chamadas-llm',
    date: '2026-07-22',
    readTime: '13 min',
    keywords: {
      pt: 'timeout em cadeia de llm, cancelamento propagado, abortsignal, deadline absoluto, orcamento de tempo, degradacao por etapa, tempo ate o primeiro token, chamada zumbi, pipeline de ia, anthropic',
      en: 'timeout in llm chain, propagated cancellation, abortsignal, absolute deadline, time budget, per-step degradation, time to first token, zombie call, ai pipeline, anthropic',
      es: 'timeout en cadena de llm, cancelacion propagada, abortsignal, deadline absoluto, presupuesto de tiempo, degradacion por etapa, tiempo hasta el primer token, llamada zombi, pipeline de ia, anthropic',
    },
    content: {
      pt: {
        title: 'Timeout e cancelamento em cadeia de chamadas de LLM',
        excerpt:
          'Cada etapa do pipeline tem um timeout razoável, mas a soma estoura a paciência do cliente, e quando ele desiste as chamadas continuam rodando para ninguém. Como tratar o tempo como orçamento único: o deadline absoluto que viaja pela cadeia, o AbortSignal que cancela de verdade o trabalho vencido, as fases de timeout de conexão, primeiro token e stream, o retry que só vale quando cabe, a degradação declarada por etapa e como testar que a cadeia responde algo útil dentro do prazo.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Timeout and cancellation across a chain of LLM calls',
        excerpt:
          'Each pipeline step has a reasonable timeout, but the sum blows the customer patience, and when they give up the calls keep running for nobody. How to treat time as a single budget: the absolute deadline that travels through the chain, the AbortSignal that truly cancels the expired work, the timeout phases for connection, first token and stream, the retry that is only worth it when it fits, the declared per-step degradation and how to test that the chain answers something useful within the deadline.',
        category: 'Applied AI',
      },
      es: {
        title: 'Timeout y cancelación en una cadena de llamadas de LLM',
        excerpt:
          'Cada etapa del pipeline tiene un timeout razonable, pero la suma revienta la paciencia del cliente, y cuando desiste las llamadas siguen corriendo para nadie. Cómo tratar el tiempo como presupuesto único: el deadline absoluto que viaja por la cadena, el AbortSignal que cancela de verdad el trabajo vencido, las fases de timeout de conexión, primer token y stream, el retry que solo vale cuando cabe, la degradación declarada por etapa y cómo probar que la cadena responde algo útil dentro del plazo.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'compressao-contexto-caber-mais-janela-sem-perder-sinal',
    date: '2026-07-21',
    readTime: '13 min',
    keywords: {
      pt: 'compressao de contexto, janela de contexto, janela deslizante, resumo de conversa, orcamento de tokens, ancora de fato, alucinacao em resumo, retencao de sinal, memoria de conversa, anthropic',
      en: 'context compression, context window, sliding window, conversation summary, token budget, fact anchor, summary hallucination, signal retention, conversation memory, anthropic',
      es: 'compresion de contexto, ventana de contexto, ventana deslizante, resumen de conversacion, presupuesto de tokens, ancla de hecho, alucinacion en resumen, retencion de senal, memoria de conversacion, anthropic',
    },
    content: {
      pt: {
        title: 'Compressão de contexto: caber mais na janela sem perder sinal',
        excerpt:
          'A conversa cresce a cada turno e cedo ou tarde não cabe mais na janela. Cortar as mensagens mais antigas parece resolver, até o bot esquecer o número do pedido que estava justamente ali. Como caber sem perder sinal: por que idade não mede importância, orçar a janela em tokens, o que nunca se comprime, resumir os turnos antigos em bloco, o freio contra o resumo que inventa fato e como medir se a compressão preservou o que importa.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Context compression: fitting more in the window without losing signal',
        excerpt:
          'The conversation grows every turn and sooner or later no longer fits the window. Cutting the oldest messages seems to solve it, until the bot forgets the order number that was right there. How to fit without losing signal: why age does not measure importance, budgeting the window in tokens, what should never be compressed, summarizing the old turns in a block, the brake against the summary that invents facts and how to measure whether the compression preserved what matters.',
        category: 'Applied AI',
      },
      es: {
        title: 'Compresión de contexto: caber más en la ventana sin perder señal',
        excerpt:
          'La conversación crece en cada turno y tarde o temprano ya no entra en la ventana. Cortar los mensajes más viejos parece resolverlo, hasta que el bot olvida el número de pedido que estaba justo ahí. Cómo entrar sin perder señal: por qué la edad no mide importancia, presupuestar la ventana en tokens, qué nunca se comprime, resumir los turnos viejos en bloque, el freno contra el resumen que inventa un hecho y cómo medir si la compresión preservó lo que importa.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'fallback-provedores-llm-sem-parar-atendimento',
    date: '2026-07-20',
    readTime: '13 min',
    keywords: {
      pt: 'fallback entre provedores de llm, alta disponibilidade de llm, retry vs fallback, circuit breaker, rate limit 429, retry-after, normalizacao de provedor, roteador de llm, resiliencia, anthropic',
      en: 'llm provider fallback, llm high availability, retry vs fallback, circuit breaker, rate limit 429, retry-after, provider normalization, llm router, resilience, anthropic',
      es: 'fallback entre proveedores de llm, alta disponibilidad de llm, retry vs fallback, circuit breaker, rate limit 429, retry-after, normalizacion de proveedor, router de llm, resiliencia, anthropic',
    },
    content: {
      pt: {
        title: 'Fallback entre provedores de LLM sem parar o atendimento',
        excerpt:
          'A API do provedor de LLM cai e o seu atendimento cai junto, mesmo com o resto da infra saudável. Como manter um segundo fornecedor pronto para assumir: por que só retry não basta, quais erros disparam o fallback e quais não, o circuit breaker que protege o secundário, a normalização entre APIs diferentes, o cuidado com o rate limit e como testar que a troca acontece sem o cliente perceber.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'LLM provider fallback without stopping support',
        excerpt:
          'The LLM provider API goes down and your support goes down with it, even with the rest of the infra healthy. How to keep a second vendor ready to take over: why retry alone is not enough, which errors trigger the fallback and which do not, the circuit breaker that protects the secondary, the normalization across different APIs, the care with rate limit and how to test that the switch happens without the customer noticing.',
        category: 'Applied AI',
      },
      es: {
        title: 'Fallback entre proveedores de LLM sin detener la atención',
        excerpt:
          'La API del proveedor de LLM se cae y tu atención se cae junto, aun con el resto de la infra sana. Cómo mantener un segundo proveedor listo para asumir: por qué solo retry no basta, qué errores disparan el fallback y cuáles no, el circuit breaker que protege al secundario, la normalización entre APIs diferentes, el cuidado con el rate limit y cómo probar que el cambio ocurre sin que el cliente lo perciba.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'prompt-injection-rag-defender-contexto-recuperado',
    date: '2026-07-20',
    readTime: '13 min',
    keywords: {
      pt: 'prompt injection em rag, injecao indireta, contexto recuperado, defender rag, delimitador, sanitizacao, menor privilegio, exfiltracao de system prompt, seguranca de llm, retrieval',
      en: 'prompt injection in rag, indirect injection, retrieved context, defend rag, delimiter, sanitization, least privilege, system prompt exfiltration, llm security, retrieval',
      es: 'prompt injection en rag, inyeccion indirecta, contexto recuperado, defender rag, delimitador, sanitizacion, menor privilegio, exfiltracion de system prompt, seguridad de llm, retrieval',
    },
    content: {
      pt: {
        title: 'Prompt injection em RAG: defender o contexto recuperado',
        excerpt:
          'A porta que traz conhecimento para o prompt traz também instruções plantadas por um atacante. Como defender o contexto recuperado: por que ele é território hostil, separar dado de instrução com delimitadores e marcação de confiança, sanitizar o trecho antes do modelo, o limite da injeção indireta e o menor privilégio, e como testar que o payload envenenado não sequestra o agente.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Prompt injection in RAG: defending the retrieved context',
        excerpt:
          'The door that brings knowledge into the prompt also brings instructions planted by an attacker. How to defend the retrieved context: why it is hostile territory, separating data from instruction with delimiters and trust marking, sanitizing the passage before the model, the limit of indirect injection and least privilege, and how to test that the poisoned payload does not hijack the agent.',
        category: 'Applied AI',
      },
      es: {
        title: 'Prompt injection en RAG: defender el contexto recuperado',
        excerpt:
          'La puerta que trae conocimiento al prompt trae también instrucciones plantadas por un atacante. Cómo defender el contexto recuperado: por qué es territorio hostil, separar dato de instrucción con delimitadores y marcado de confianza, sanitizar el fragmento antes del modelo, el límite de la inyección indirecta y el menor privilegio, y cómo probar que el payload envenenado no secuestra el agente.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'idempotencia-tool-use-evitar-acao-duplicada-agente',
    date: '2026-07-18',
    readTime: '13 min',
    keywords: {
      pt: 'idempotencia em tool use, acao duplicada do agente, chave de idempotencia, deduplicacao, retry, timeout, dupla cobranca, tool use, anthropic',
      en: 'idempotency in tool use, duplicated agent action, idempotency key, deduplication, retry, timeout, double charge, tool use, anthropic',
      es: 'idempotencia en tool use, accion duplicada del agente, clave de idempotencia, deduplicacion, retry, timeout, doble cobro, tool use, anthropic',
    },
    content: {
      pt: {
        title: 'Idempotência em tool use: evitar ação duplicada do agente',
        excerpt:
          'Retentar uma ferramenta que só lê é inofensivo; retentar uma que cobra o cartão duplica a cobrança. Como tornar o retry do agente seguro: por que o agente duplica ação com tanta facilidade, a chave de idempotência derivada da intenção, a janela de deduplicação que grava a primeira execução, o caso ambíguo do timeout e como testar que a duplicata não passa.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Idempotency in tool use: avoiding a duplicated agent action',
        excerpt:
          'Retrying a tool that only reads is harmless; retrying one that charges the card duplicates the charge. How to make the agent retry safe: why the agent duplicates actions so easily, the idempotency key derived from the intent, the deduplication window that stores the first execution, the ambiguous timeout case and how to test that the duplicate does not get through.',
        category: 'Applied AI',
      },
      es: {
        title: 'Idempotencia en tool use: evitar acción duplicada del agente',
        excerpt:
          'Reintentar una herramienta que solo lee es inofensivo; reintentar una que cobra la tarjeta duplica el cobro. Cómo volver seguro el retry del agente: por qué el agente duplica acción con tanta facilidad, la clave de idempotencia derivada de la intención, la ventana de deduplicación que guarda la primera ejecución, el caso ambiguo del timeout y cómo probar que el duplicado no pasa.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'reranking-rag-melhorar-retrieval-sem-trocar-modelo',
    date: '2026-07-17',
    readTime: '13 min',
    keywords: {
      pt: 'reranking em rag, cross-encoder, bi-encoder, reordenar retrieval, recuperar amplo, mrr, ndcg, recall, embedding, latencia',
      en: 'reranking in rag, cross-encoder, bi-encoder, reorder retrieval, retrieve wide, mrr, ndcg, recall, embedding, latency',
      es: 'reranking en rag, cross-encoder, bi-encoder, reordenar retrieval, recuperar amplio, mrr, ndcg, recall, embedding, latencia',
    },
    content: {
      pt: {
        title: 'Reranking em RAG: melhorar o retrieval sem trocar o modelo',
        excerpt:
          'A resposta certa muitas vezes é recuperada, só que na nona posição, e você corta o contexto nos três primeiros. Como reordenar por relevância real: por que o embedding erra a ordem, o cross-encoder que lê pergunta e trecho juntos, o padrão recuperar-amplo-reranquear-estreito, o custo em latência e a métrica de posição que diz se o reranking vale a pena.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Reranking in RAG: better retrieval without swapping the model',
        excerpt:
          'The right answer is often retrieved, only at ninth place, and you cut the context at the top three. How to reorder by real relevance: why the embedding gets the order wrong, the cross-encoder that reads question and passage together, the retrieve-wide-rerank-narrow pattern, the latency cost and the position metric that tells whether reranking pays off.',
        category: 'Applied AI',
      },
      es: {
        title: 'Reranking en RAG: mejorar el retrieval sin cambiar el modelo',
        excerpt:
          'La respuesta correcta muchas veces se recupera, solo que en la novena posición, y vos cortás el contexto en los tres primeros. Cómo reordenar por relevancia real: por qué el embedding equivoca el orden, el cross-encoder que lee pregunta y fragmento juntos, el patrón recuperar-amplio-reranquear-estrecho, el costo en latencia y la métrica de posición que dice si el reranking vale la pena.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'chunking-documento-rag-sem-perder-contexto',
    date: '2026-07-16',
    readTime: '13 min',
    keywords: {
      pt: 'chunking de documento, rag, corte por estrutura, sobreposicao, overlap, tamanho de chunk, metadado, recall, retrieval, embedding',
      en: 'document chunking, rag, structural cut, overlap, chunk size, metadata, recall, retrieval, embedding, ingestion',
      es: 'chunking de documento, rag, corte por estructura, solapamiento, overlap, tamano de chunk, metadato, recall, retrieval, embedding',
    },
    content: {
      pt: {
        title: 'Chunking de documento para RAG sem perder contexto',
        excerpt:
          'Cortar o documento a cada N caracteres parte a frase no meio e separa a definição da exceção. Como cortar por estrutura em vez de por tamanho: chunking recursivo pelas fronteiras do texto, overlap para costurar as emendas, o tamanho certo do chunk, o metadado que dá procedência e a métrica de recall que diz se o corte está ajudando o retrieval.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Document chunking for RAG without losing context',
        excerpt:
          'Cutting the document every N characters splits the sentence in half and separates the definition from its exception. How to cut by structure instead of by size: recursive chunking along the text boundaries, overlap to stitch the seams, the right chunk size, the metadata that gives provenance and the recall metric that tells whether the cut is helping retrieval.',
        category: 'Applied AI',
      },
      es: {
        title: 'Chunking de documento para RAG sin perder contexto',
        excerpt:
          'Cortar el documento cada N caracteres parte la frase a la mitad y separa la definición de su excepción. Cómo cortar por estructura en vez de por tamaño: chunking recursivo por las fronteras del texto, overlap para coser las junturas, el tamaño correcto del chunk, el metadato que da procedencia y la métrica de recall que dice si el corte está ayudando al retrieval.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'rate-limit-fila-prioridade-apis-llm',
    date: '2026-07-15',
    readTime: '13 min',
    keywords: {
      pt: 'rate limit de llm, fila de prioridade, token bucket, erro 429, backoff exponencial, jitter, retry-after, tokens por minuto, controle de vazao, anthropic',
      en: 'llm rate limit, priority queue, token bucket, 429 error, exponential backoff, jitter, retry-after, tokens per minute, throughput control, anthropic',
      es: 'rate limit de llm, cola de prioridad, token bucket, error 429, backoff exponencial, jitter, retry-after, tokens por minuto, control de caudal, anthropic',
    },
    content: {
      pt: {
        title: 'Rate limit e fila de prioridade para APIs de LLM',
        excerpt:
          'Retentar na hora um erro 429 é responder ao pedido de desacelerar acelerando. Como transformar o teto do provedor em vazão controlada: token bucket nas duas dimensões, fila com classes de prioridade e envelhecimento, backoff com jitter que respeita o Retry-After e as métricas que dizem se a cota está apertada.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Rate limit and priority queue for LLM APIs',
        excerpt:
          'Retrying a 429 immediately is answering a request to slow down by speeding up. How to turn the provider ceiling into controlled throughput: a token bucket on both dimensions, a queue with priority classes and aging, backoff with jitter that honors Retry-After and the metrics that tell you whether the quota is tight.',
        category: 'Applied AI',
      },
      es: {
        title: 'Rate limit y cola de prioridad para APIs de LLM',
        excerpt:
          'Reintentar al instante un error 429 es responder al pedido de desacelerar acelerando. Cómo transformar el techo del proveedor en caudal controlado: token bucket en las dos dimensiones, cola con clases de prioridad y envejecimiento, backoff con jitter que respeta el Retry-After y las métricas que dicen si la cuota está apretada.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'streaming-resposta-llm-sem-quebrar-ux',
    date: '2026-07-14',
    readTime: '12 min',
    keywords: {
      pt: 'streaming de llm, resposta em tempo real, server-sent events, sse, tempo ate o primeiro token, ttft, cancelamento, heartbeat, ux de chat, anthropic',
      en: 'llm streaming, real-time response, server-sent events, sse, time to first token, ttft, cancellation, heartbeat, chat ux, anthropic',
      es: 'streaming de llm, respuesta en tiempo real, server-sent events, sse, tiempo hasta el primer token, ttft, cancelacion, heartbeat, ux de chat, anthropic',
    },
    content: {
      pt: {
        title: 'Streaming de resposta de LLM sem quebrar a UX',
        excerpt:
          'A mesma resposta de LLM parece rápida quando começa a surgir em milissegundos e travada quando espera o texto todo. Como transmitir token a token sem quebrar a experiência: transporte SSE, servidor com heartbeat e cancelamento, cliente incremental e as regras de UX que fazem o streaming parecer suave.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'LLM response streaming without breaking the UX',
        excerpt:
          'The same LLM answer feels fast when it starts showing up in milliseconds and frozen when it waits for the full text. How to stream token by token without breaking the experience: SSE transport, a server with heartbeat and cancellation, an incremental client and the UX rules that make streaming feel smooth.',
        category: 'Applied AI',
      },
      es: {
        title: 'Streaming de respuesta de LLM sin romper la UX',
        excerpt:
          'La misma respuesta de LLM parece rápida cuando empieza a surgir en milisegundos y trabada cuando espera el texto entero. Cómo transmitir token a token sin romper la experiencia: transporte SSE, servidor con heartbeat y cancelación, cliente incremental y las reglas de UX que hacen que el streaming parezca suave.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'roteamento-modelos-modelo-certo-cada-tarefa',
    date: '2026-07-13',
    readTime: '12 min',
    keywords: {
      pt: 'roteamento de modelos, modelo certo para cada tarefa, custo de llm, classificacao de tarefa, fallback, escalonamento, modelo barato, modelo forte, anthropic',
      en: 'model routing, right model for each task, llm cost, task classification, fallback, escalation, cheap model, strong model, anthropic',
      es: 'ruteo de modelos, modelo correcto para cada tarea, costo de llm, clasificacion de tarea, fallback, escalonamiento, modelo barato, modelo fuerte, anthropic',
    },
    content: {
      pt: {
        title: 'Roteamento de modelos: modelo certo para cada tarefa',
        excerpt:
          'Mandar tudo para o modelo mais forte paga preço de raciocínio por trabalho de rotina. Roteamento casa cada tarefa com o modelo mais barato que ainda resolve: classificação por complexidade e risco, tabela de custo por tarefa, fallback validado e a métrica de escalonamento.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Model routing: the right model for each task',
        excerpt:
          'Sending everything to the strongest model pays reasoning price for routine work. Routing matches each task with the cheapest model that still solves it: classification by complexity and risk, cost-per-task table, validated fallback and the escalation metric.',
        category: 'Applied AI',
      },
      es: {
        title: 'Ruteo de modelos: el modelo correcto para cada tarea',
        excerpt:
          'Mandar todo al modelo más fuerte paga precio de razonamiento por trabajo de rutina. El ruteo casa cada tarea con el modelo más barato que aún la resuelve: clasificación por complejidad y riesgo, tabla de costo por tarea, fallback validado y la métrica de escalonamiento.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'cache-semantico-reduzir-custo-llm',
    date: '2026-07-12',
    readTime: '12 min',
    keywords: {
      pt: 'cache semantico, reduzir custo de llm, embedding, similaridade de cosseno, limiar, ttl, invalidacao, falso positivo, hit rate, anthropic',
      en: 'semantic cache, cut llm cost, embedding, cosine similarity, threshold, ttl, invalidation, false positive, hit rate, anthropic',
      es: 'cache semantico, reducir costo de llm, embedding, similitud de coseno, umbral, ttl, invalidacion, falso positivo, hit rate, anthropic',
    },
    content: {
      pt: {
        title: 'Cache semântico para reduzir custo de LLM',
        excerpt:
          'A mesma pergunta em mil formas vira mil chamadas ao modelo. Cache semântico casa por significado, não por texto: embedding, limiar calibrado por domínio, o que nunca pode ser cacheado, TTL com invalidação e a métrica de falso positivo.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Semantic cache to cut LLM cost',
        excerpt:
          'The same question in a thousand forms becomes a thousand model calls. Semantic cache matches by meaning, not text: embedding, a threshold calibrated per domain, what can never be cached, TTL with invalidation and the false positive metric.',
        category: 'Applied AI',
      },
      es: {
        title: 'Cache semantico para reducir el costo de LLM',
        excerpt:
          'La misma pregunta en mil formas se vuelve mil llamadas al modelo. El cache semantico casa por significado, no por texto: embedding, umbral calibrado por dominio, lo que nunca puede cachearse, TTL con invalidacion y la metrica de falso positivo.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'memoria-longo-prazo-agentes-atendimento',
    date: '2026-07-11',
    readTime: '13 min',
    keywords: {
      pt: 'memoria de longo prazo, agente de atendimento, janela de contexto, memoria persistente, embedding, recuperacao por relevancia, ttl, esquecimento, privacidade, anthropic',
      en: 'long-term memory, support agent, context window, persistent memory, embedding, relevance retrieval, ttl, forgetting, privacy, anthropic',
      es: 'memoria de largo plazo, agente de atencion, ventana de contexto, memoria persistente, embedding, recuperacion por relevancia, ttl, olvido, privacidad, anthropic',
    },
    content: {
      pt: {
        title: 'Memória de longo prazo para agentes de atendimento',
        excerpt:
          'O cliente não deveria repetir tudo a cada sessão. Como dar memória ao agente sem estourar contexto: janela contra memória persistente, gravar fato em vez de transcript, recuperar por relevância escopada ao usuário, atualizar e esquecer.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Long-term memory for support agents',
        excerpt:
          'The customer should not repeat everything every session. How to give the agent memory without blowing the context: window versus persistent memory, storing facts instead of transcript, retrieving by relevance scoped to the user, update and forget.',
        category: 'Applied AI',
      },
      es: {
        title: 'Memoria de largo plazo para agentes de atención',
        excerpt:
          'El cliente no debería repetir todo en cada sesión. Cómo darle memoria al agente sin reventar el contexto: ventana contra memoria persistente, grabar hecho en vez de transcript, recuperar por relevancia escopada al usuario, actualizar y olvidar.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'guardrails-saida-llm-validacao-recusa-segura',
    date: '2026-07-09',
    readTime: '13 min',
    keywords: {
      pt: 'guardrails de saida, validacao de llm, recusa segura, schema json, retry estruturado, fallback seguro, vazamento de dado, tool use, anthropic',
      en: 'output guardrails, llm validation, safe refusal, json schema, structured retry, safe fallback, data leakage, tool use, anthropic',
      es: 'guardrails de salida, validacion de llm, rechazo seguro, schema json, retry estructurado, fallback seguro, filtracion de dato, tool use, anthropic',
    },
    content: {
      pt: {
        title: 'Guardrails de saída em LLM: validação e recusa segura',
        excerpt:
          'A parte perigosa de um sistema com LLM não é o que entra, é o que sai. Validação de schema com retry, detecção de recusa e vazamento, bloqueio de ação perigosa e a regra de ouro: sempre um fallback seguro.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'LLM output guardrails: validation and safe refusal',
        excerpt:
          'The dangerous part of an LLM system is not the input, it is the output. Schema validation with retry, refusal and leakage detection, blocking a dangerous action and the golden rule: always a safe fallback.',
        category: 'Applied AI',
      },
      es: {
        title: 'Guardrails de salida en LLM: validacion y rechazo seguro',
        excerpt:
          'La parte peligrosa de un sistema con LLM no es lo que entra, es lo que sale. Validacion de schema con retry, deteccion de rechazo y filtracion, bloqueo de accion peligrosa y la regla de oro: siempre un fallback seguro.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'observabilidade-llm-tracing-custo-qualidade',
    date: '2026-07-08',
    readTime: '13 min',
    keywords: {
      pt: 'observabilidade de llm, tracing de llm, custo de tokens, qualidade de llm, llm como juiz, span, latencia, redacao de dados, alertas, anthropic',
      en: 'llm observability, llm tracing, token cost, llm quality, llm as judge, span, latency, data redaction, alerts, anthropic',
      es: 'observabilidad de llm, tracing de llm, costo de tokens, calidad de llm, llm como juez, span, latencia, redaccion de datos, alertas, anthropic',
    },
    content: {
      pt: {
        title: 'Observabilidade de LLM: tracing, custo e qualidade',
        excerpt:
          'Por que os tres pilares tradicionais nao bastam para LLM: latencia, custo e qualidade precisam ser observados juntos. Tracing por fase, custo por chamada, sinais de qualidade sem gabarito, log com redacao e alertas com contexto.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'LLM observability: tracing, cost and quality',
        excerpt:
          'Why the three classic pillars are not enough for LLMs: latency, cost and quality must be observed together. Per-phase tracing, per-call cost, quality signals without ground truth, redacted logging and alerts with context.',
        category: 'Applied AI',
      },
      es: {
        title: 'Observabilidad de LLM: tracing, costo y calidad',
        excerpt:
          'Por que los tres pilares clasicos no bastan para LLM: latencia, costo y calidad hay que observarlos juntos. Tracing por fase, costo por llamada, senales de calidad sin gabarito, log con redaccion y alertas con contexto.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'function-calling-vs-rag-dados-tempo-real',
    date: '2026-07-07',
    readTime: '12 min',
    keywords: {
      pt: 'function calling, tool use, rag, dados em tempo real, dado vivo, consulta ao vivo, roteamento por intencao, chatbot ia, anthropic',
      en: 'function calling, tool use, rag, real-time data, live data, live query, intent routing, ai chatbot, anthropic',
      es: 'function calling, tool use, rag, datos en tiempo real, dato vivo, consulta en vivo, ruteo por intencion, chatbot ia, anthropic',
    },
    content: {
      pt: {
        title: 'Function calling vs RAG para dados em tempo real',
        excerpt:
          'Por que RAG alucina status de pedido e saldo: retrieval e para dado estatico, function calling e para dado vivo. Comparacao por natureza do dado, exemplo real de tool use e roteamento por intencao.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Function calling vs RAG for real-time data',
        excerpt:
          'Why RAG hallucinates order status and balance: retrieval is for static data, function calling is for live data. Comparison by nature of the data, a real tool use example and intent routing.',
        category: 'Applied AI',
      },
      es: {
        title: 'Function calling vs RAG para datos en tiempo real',
        excerpt:
          'Por que RAG alucina estado de pedido y saldo: retrieval es para dato estatico, function calling es para dato vivo. Comparacion por naturaleza del dato, ejemplo real de tool use y ruteo por intencion.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'orquestracao-agentes-ia-producao',
    date: '2026-07-06',
    readTime: '13 min',
    keywords: {
      pt: 'orquestracao de agentes de ia, multi-agente, supervisor, estado duravel, tool runner, retry, guardrails, tracing de llm, producao',
      en: 'ai agent orchestration, multi-agent, supervisor, durable state, tool runner, retry, guardrails, llm tracing, production',
      es: 'orquestacion de agentes de ia, multi-agente, supervisor, estado durable, tool runner, retry, guardrails, tracing de llm, produccion',
    },
    content: {
      pt: {
        title: 'Orquestração de agentes de IA em produção',
        excerpt:
          'Como sair do agente único para uma orquestração confiável: padrões de coordenação, estado durável para retomar, tools blindadas com retry, guardrails de custo e tracing por passo.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Orchestrating AI agents in production',
        excerpt:
          'How to move from a single agent to a reliable orchestration: coordination patterns, durable state to resume, armored tools with retry, cost guardrails and per-step tracing.',
        category: 'Applied AI',
      },
      es: {
        title: 'Orquestacion de agentes de IA en produccion',
        excerpt:
          'Como pasar del agente unico a una orquestacion confiable: patrones de coordinacion, estado durable para retomar, tools blindadas con retry, guardrails de costo y tracing por paso.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'feature-store-personalizacao-atendimento',
    date: '2026-07-04',
    readTime: '12 min',
    keywords: {
      pt: 'feature store, personalizacao de atendimento, training-serving skew, point-in-time correctness, feature online, mlops, redis',
      en: 'feature store, support personalization, training-serving skew, point-in-time correctness, online feature, mlops, redis',
      es: 'feature store, personalizacion de atencion, training-serving skew, point-in-time correctness, feature online, mlops, redis',
    },
    content: {
      pt: {
        title: 'Feature store para personalização de atendimento',
        excerpt:
          'Como eliminar o training-serving skew na personalização de atendimento: registro único de features, serving online de baixa latência, point-in-time correctness no treino e a mesma transformação em treino e inferência.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Feature store for support personalization',
        excerpt:
          'How to eliminate training-serving skew in support personalization: a single feature registry, low-latency online serving, point-in-time correctness in training and the same transformation in training and inference.',
        category: 'Applied AI',
      },
      es: {
        title: 'Feature store para personalizacion de atencion',
        excerpt:
          'Como eliminar el training-serving skew en la personalizacion de atencion: registro unico de features, serving online de baja latencia, point-in-time correctness en el entrenamiento y la misma transformacion en entrenamiento e inferencia.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'avaliacao-continua-bots-eval-automatico',
    date: '2026-07-03',
    readTime: '13 min',
    keywords: {
      pt: 'avaliacao continua de bots, eval de llm, llm como juiz, gate de regressao, dataset de eval, ci, testes de bot ia',
      en: 'continuous bot evaluation, llm eval, llm as judge, regression gate, eval dataset, ci, ai bot testing',
      es: 'evaluacion continua de bots, eval de llm, llm como juez, gate de regresion, dataset de eval, ci, pruebas de bot ia',
    },
    content: {
      pt: {
        title: 'Avaliação contínua de bots: do eval manual ao automático',
        excerpt:
          'Como sair do eval manual e subjetivo para um harness automático: dataset versionado, métricas por tipo de caso, LLM como juiz calibrado e gate de regressão no CI.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Continuous bot evaluation: from manual to automated eval',
        excerpt:
          'How to move from manual, subjective eval to an automated harness: versioned dataset, metrics per case type, calibrated LLM judge and a regression gate in CI.',
        category: 'Applied AI',
      },
      es: {
        title: 'Evaluacion continua de bots: del eval manual al automatico',
        excerpt:
          'Como pasar del eval manual y subjetivo a un harness automatico: dataset versionado, metricas por tipo de caso, LLM como juez calibrado y gate de regresion en el CI.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'camera-virtual-blur-auto-framing-mediapipe',
    date: '2026-06-22',
    readTime: '12 min',
    keywords: {
      pt: 'camera virtual, blur de fundo, auto-framing, mediapipe, nvidia broadcast alternativa, pyvirtualcam, opencv, python',
      en: 'virtual camera, background blur, auto-framing, mediapipe, nvidia broadcast alternative, pyvirtualcam, opencv, python',
      es: 'camara virtual, blur de fondo, auto-framing, mediapipe, alternativa nvidia broadcast, pyvirtualcam, opencv, python',
    },
    content: {
      pt: {
        title: 'Minha câmera virtual com blur e auto-framing: um NVIDIA Broadcast só para a câmera',
        excerpt:
          'Como construí em Python um app de webcam com blur de fundo e auto-framing via MediaPipe, exposto como câmera virtual, sem mexer no áudio e iniciando minimizado.',
        category: 'Visão Computacional',
      },
      en: {
        title: 'My virtual camera with blur and auto-framing: an NVIDIA Broadcast just for the camera',
        excerpt:
          'How I built a Python webcam app with background blur and auto-framing via MediaPipe, exposed as a virtual camera, without touching audio and starting minimized.',
        category: 'Computer Vision',
      },
      es: {
        title: 'Mi camara virtual con blur y auto-framing: un NVIDIA Broadcast solo para la camara',
        excerpt:
          'Como construi en Python una app de webcam con blur de fondo y auto-framing via MediaPipe, expuesta como camara virtual, sin tocar el audio e iniciando minimizada.',
        category: 'Vision Computacional',
      },
    },
  },
  {
    slug: 'cag-vs-rag-cache-contexto',
    date: '2026-06-16',
    readTime: '11 min',
    keywords: {
      pt: 'cag, rag, cache de contexto, prompt cache, retrieval, kv cache',
      en: 'cag, rag, context cache, prompt cache, retrieval, kv cache',
      es: 'cag, rag, cache de contexto, prompt cache, retrieval, kv cache',
    },
    content: {
      pt: {
        title: 'CAG x RAG: quando cache de contexto vence retrieval',
        excerpt:
          'Comparação prática entre Cache-Augmented Generation e RAG: latência, custo, frescor do dado e quando usar cada um.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'CAG vs RAG: when context cache beats retrieval',
        excerpt:
          'Practical comparison between Cache-Augmented Generation and RAG: latency, cost, data freshness and when to use each.',
        category: 'Applied AI',
      },
      es: {
        title: 'CAG vs RAG: cuando el cache de contexto le gana al retrieval',
        excerpt:
          'Comparacion practica entre Cache-Augmented Generation y RAG: latencia, costo, frescura del dato y cuando usar cada uno.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'chamadas-voz-whatsapp-baileys-caller',
    date: '2026-06-16',
    readTime: '10 min',
    keywords: {
      pt: 'baileys, baileys-caller, chamada de voz whatsapp, whatsapp web, nao oficial',
      en: 'baileys, baileys-caller, whatsapp voice call, whatsapp web, unofficial',
      es: 'baileys, baileys-caller, llamada de voz whatsapp, whatsapp web, no oficial',
    },
    content: {
      pt: {
        title: 'Chamadas de voz no WhatsApp com baileys-caller',
        excerpt:
          'Como originar chamadas de voz no WhatsApp via Baileys, os trade-offs frente à Cloud API oficial e como mitigar o risco.',
        category: 'WhatsApp Avançado',
      },
      en: {
        title: 'WhatsApp voice calls with baileys-caller',
        excerpt:
          'How to originate WhatsApp voice calls via Baileys, the trade-offs versus the official Cloud API and how to mitigate risk.',
        category: 'Advanced WhatsApp',
      },
      es: {
        title: 'Llamadas de voz en WhatsApp con baileys-caller',
        excerpt:
          'Como originar llamadas de voz en WhatsApp via Baileys, los trade-offs frente a la Cloud API oficial y como mitigar el riesgo.',
        category: 'WhatsApp Avanzado',
      },
    },
  },
  {
    slug: 'fila-picos-campanha-whatsapp',
    date: '2026-06-16',
    readTime: '12 min',
    keywords: {
      pt: 'fila whatsapp, picos de campanha, rate limit, backpressure, redis',
      en: 'whatsapp queue, campaign peaks, rate limit, backpressure, redis',
      es: 'cola whatsapp, picos de campana, rate limit, backpressure, redis',
    },
    content: {
      pt: {
        title: 'Arquitetura de fila para picos de campanha no WhatsApp',
        excerpt:
          'Como dimensionar fila, rate limit e backpressure para suportar disparos em massa sem bloqueio nem perda de mensagem.',
        category: 'Arquitetura Backend',
      },
      en: {
        title: 'Queue architecture for WhatsApp campaign peaks',
        excerpt:
          'How to size queue, rate limit and backpressure to handle mass sends without blocks or lost messages.',
        category: 'Backend Architecture',
      },
      es: {
        title: 'Arquitectura de colas para picos de campana en WhatsApp',
        excerpt:
          'Como dimensionar cola, rate limit y backpressure para soportar envios masivos sin bloqueos ni perdida de mensajes.',
        category: 'Arquitectura Backend',
      },
    },
  },
  {
    slug: 'slas-atendimento-bot-humano',
    date: '2026-06-16',
    readTime: '10 min',
    keywords: {
      pt: 'sla atendimento, bot humano, fila de atendimento, first response time',
      en: 'support sla, bot human, support queue, first response time',
      es: 'sla atencion, bot humano, cola de atencion, first response time',
    },
    content: {
      pt: {
        title: 'Como desenhar SLAs de atendimento com bot + humano',
        excerpt:
          'Modelo de SLA por estágio, priorização de fila e métricas para medir bot e humano sem cobrar o time pelo que não controla.',
        category: 'Operação',
      },
      en: {
        title: 'How to design support SLAs with bot + human team',
        excerpt:
          'SLA model by stage, queue prioritization and metrics to measure bot and human without blaming the team for what they do not control.',
        category: 'Operations',
      },
      es: {
        title: 'Como disenar SLAs de atencion con bot + equipo humano',
        excerpt:
          'Modelo de SLA por etapa, priorizacion de cola y metricas para medir bot y humano sin culpar al equipo por lo que no controla.',
        category: 'Operacion',
      },
    },
  },
  {
    slug: 'governanca-templates-times-grandes',
    date: '2026-06-16',
    readTime: '11 min',
    keywords: {
      pt: 'governanca templates whatsapp, versionamento, aprovacao meta, namespace',
      en: 'whatsapp template governance, versioning, meta approval, namespace',
      es: 'gobernanza plantillas whatsapp, versionado, aprobacion meta, namespace',
    },
    content: {
      pt: {
        title: 'Governança de templates em times grandes',
        excerpt:
          'Como versionar, aprovar e medir templates de WhatsApp quando vários times disputam o mesmo namespace.',
        category: 'Operação',
      },
      en: {
        title: 'Template governance in large teams',
        excerpt:
          'How to version, approve and measure WhatsApp templates when several teams compete for the same namespace.',
        category: 'Operations',
      },
      es: {
        title: 'Gobernanza de plantillas en equipos grandes',
        excerpt:
          'Como versionar, aprobar y medir plantillas de WhatsApp cuando varios equipos compiten por el mismo namespace.',
        category: 'Operacion',
      },
    },
  },
  {
    slug: 'integracao-erp-crm-sem-retrabalho',
    date: '2026-06-16',
    readTime: '12 min',
    keywords: {
      pt: 'integracao erp crm, sincronizacao, idempotencia, fonte da verdade',
      en: 'erp crm integration, synchronization, idempotency, source of truth',
      es: 'integracion erp crm, sincronizacion, idempotencia, fuente de verdad',
    },
    content: {
      pt: {
        title: 'Integração ERP + CRM sem retrabalho operacional',
        excerpt:
          'Padrões de sincronização, fonte da verdade e idempotência para ligar ERP e CRM sem duplicar dado nem cadastro manual.',
        category: 'Integrações',
      },
      en: {
        title: 'ERP + CRM integration without operational rework',
        excerpt:
          'Synchronization patterns, source of truth and idempotency to connect ERP and CRM without duplicate data or manual entry.',
        category: 'Integrations',
      },
      es: {
        title: 'Integracion ERP + CRM sin retrabajo operativo',
        excerpt:
          'Patrones de sincronizacion, fuente de verdad e idempotencia para conectar ERP y CRM sin duplicar datos ni carga manual.',
        category: 'Integraciones',
      },
    },
  },
  {
    slug: 'roi-real-automacao-ia',
    date: '2026-06-16',
    readTime: '9 min',
    keywords: {
      pt: 'roi automacao ia, calculo de retorno, custo operacional, payback',
      en: 'ai automation roi, return calculation, operational cost, payback',
      es: 'roi automatizacion ia, calculo de retorno, costo operativo, payback',
    },
    content: {
      pt: {
        title: 'Como calcular ROI real de automação com IA',
        excerpt:
          'Modelo prático para medir retorno de automação com IA: custo total, ganho por jornada, payback e armadilhas comuns.',
        category: 'Estratégia Técnica',
      },
      en: {
        title: 'How to calculate real ROI from AI automation',
        excerpt:
          'Practical model to measure AI automation return: total cost, gain per journey, payback and common pitfalls.',
        category: 'Technical Strategy',
      },
      es: {
        title: 'Como calcular el ROI real de automatizacion con IA',
        excerpt:
          'Modelo practico para medir retorno de automatizacion con IA: costo total, ganancia por jornada, payback y trampas comunes.',
        category: 'Estrategia Tecnica',
      },
    },
  },

  {
    slug: 'guia-whatsapp-cloud-api',
    date: '2026-03-03',
    readTime: '14 min',
    keywords: {
      pt: 'whatsapp cloud api, webhook whatsapp, templates whatsapp, integracao whatsapp crm',
      en: 'whatsapp cloud api, whatsapp webhook, whatsapp templates, whatsapp crm integration',
      es: 'whatsapp cloud api, webhook whatsapp, plantillas whatsapp, integracion whatsapp crm',
    },
    content: {
      pt: {
        title: 'Guia WhatsApp Cloud API: arquitetura, webhooks, templates e deploy',
        excerpt:
          'Arquitetura de produção para integrar WhatsApp Cloud API com webhook seguro, templates, filas e observabilidade.',
        category: 'WhatsApp Cloud API',
      },
      en: {
        title: 'WhatsApp Cloud API Guide: architecture, webhooks, templates and deployment',
        excerpt:
          'Production architecture to integrate WhatsApp Cloud API with secure webhook, templates, queues and observability.',
        category: 'WhatsApp Cloud API',
      },
      es: {
        title: 'Guia de WhatsApp Cloud API: arquitectura, webhooks, plantillas y despliegue',
        excerpt:
          'Arquitectura de produccion para integrar WhatsApp Cloud API con webhook seguro, plantillas, colas y observabilidad.',
        category: 'WhatsApp Cloud API',
      },
    },
  },
  {
    slug: 'meta-pixel-vs-capi-arquitetura',
    date: '2026-03-01',
    readTime: '11 min',
    keywords: {
      pt: 'meta pixel, capi, deduplicacao, events manager',
      en: 'meta pixel, capi, deduplication, events manager',
      es: 'meta pixel, capi, deduplicacion, events manager',
    },
    content: {
      pt: {
        title: 'Meta Pixel vs CAPI: arquitetura ideal para dados confiáveis',
        excerpt:
          'Como combinar Pixel e Conversions API com deduplicação para reduzir perda de eventos e melhorar atribuição.',
        category: 'Meta Ads',
      },
      en: {
        title: 'Meta Pixel vs CAPI: ideal architecture for reliable data',
        excerpt:
          'How to combine Pixel and Conversions API with deduplication to reduce event loss and improve attribution.',
        category: 'Meta Ads',
      },
      es: {
        title: 'Meta Pixel vs CAPI: arquitectura ideal para datos confiables',
        excerpt:
          'Como combinar Pixel y Conversions API con deduplicacion para reducir perdida de eventos y mejorar atribucion.',
        category: 'Meta Ads',
      },
    },
  },
  {
    slug: 'webhook-whatsapp-idempotencia-filas',
    date: '2026-02-27',
    readTime: '10 min',
    keywords: {
      pt: 'webhook whatsapp, idempotencia, filas, retry',
      en: 'whatsapp webhook, idempotency, queues, retry',
      es: 'webhook whatsapp, idempotencia, colas, retry',
    },
    content: {
      pt: {
        title: 'Webhook WhatsApp em produção: idempotência, filas e retry',
        excerpt:
          'Padrões técnicos para evitar mensagens duplicadas e manter estabilidade em alto volume de atendimento.',
        category: 'Arquitetura Backend',
      },
      en: {
        title: 'Production WhatsApp webhook: idempotency, queues and retry',
        excerpt:
          'Technical patterns to avoid duplicate messages and keep stability under high support volume.',
        category: 'Backend Architecture',
      },
      es: {
        title: 'Webhook de WhatsApp en produccion: idempotencia, colas y retry',
        excerpt:
          'Patrones tecnicos para evitar mensajes duplicados y mantener estabilidad con alto volumen de atencion.',
        category: 'Arquitectura Backend',
      },
    },
  },
  {
    slug: 'handoff-humano-whatsapp-ia',
    date: '2026-02-23',
    readTime: '9 min',
    keywords: {
      pt: 'handoff humano, whatsapp, chatbot ia, atendimento',
      en: 'human handoff, whatsapp, ai chatbot, support',
      es: 'handoff humano, whatsapp, chatbot ia, atencion',
    },
    content: {
      pt: {
        title: 'Handoff humano no WhatsApp: quando e como transferir sem perder contexto',
        excerpt:
          'Modelo operacional para chatbot com IA transferir para atendente humano no momento certo.',
        category: 'Chatbots e IA',
      },
      en: {
        title: 'Human handoff on WhatsApp: when and how to transfer without losing context',
        excerpt:
          'Operational model for AI chatbot flows to transfer to human agents at the right time.',
        category: 'Chatbots and AI',
      },
      es: {
        title: 'Handoff humano en WhatsApp: cuando y como transferir sin perder contexto',
        excerpt:
          'Modelo operativo para que el chatbot con IA transfiera al agente humano en el momento correcto.',
        category: 'Chatbots e IA',
      },
    },
  },
  {
    slug: 'rag-atendimento-whatsapp-producao',
    date: '2026-02-18',
    readTime: '13 min',
    keywords: {
      pt: 'rag, chatbot ia, base de conhecimento, whatsapp',
      en: 'rag, ai chatbot, knowledge base, whatsapp',
      es: 'rag, chatbot ia, base de conocimiento, whatsapp',
    },
    content: {
      pt: {
        title: 'RAG para atendimento no WhatsApp: desenho de produção sem alucinação',
        excerpt:
          'Como estruturar base de conhecimento, guardrails e avaliação contínua para bots mais precisos.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'RAG for WhatsApp support: production design with fewer hallucinations',
        excerpt:
          'How to structure knowledge base, guardrails and continuous evaluation for more accurate bots.',
        category: 'Applied AI',
      },
      es: {
        title: 'RAG para atencion en WhatsApp: diseno de produccion con menos alucinaciones',
        excerpt:
          'Como estructurar base de conocimiento, guardrails y evaluacion continua para bots mas precisos.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'monitoramento-alertas-integracoes',
    date: '2026-02-13',
    readTime: '8 min',
    keywords: {
      pt: 'observabilidade, alertas, integracoes, slas',
      en: 'observability, alerts, integrations, slas',
      es: 'observabilidad, alertas, integraciones, slas',
    },
    content: {
      pt: {
        title: 'Monitoramento e alertas em integrações: o mínimo para não apagar incêndio',
        excerpt:
          'Painel e alertas essenciais para webhook, fila, worker e APIs externas com foco em tempo de resposta.',
        category: 'Observabilidade',
      },
      en: {
        title: 'Monitoring and alerts for integrations: the minimum to avoid firefighting',
        excerpt:
          'Essential dashboard and alerts for webhook, queue, worker and external APIs focused on response time.',
        category: 'Observability',
      },
      es: {
        title: 'Monitoreo y alertas en integraciones: el minimo para no apagar incendios',
        excerpt:
          'Dashboard y alertas esenciales para webhook, cola, worker y APIs externas con foco en tiempo de respuesta.',
        category: 'Observabilidad',
      },
    },
  },
  {
    slug: 'crm-whatsapp-playbook-vendas',
    date: '2026-02-08',
    readTime: '12 min',
    keywords: {
      pt: 'crm whatsapp, funil comercial, automacao vendas',
      en: 'crm whatsapp, sales funnel, sales automation',
      es: 'crm whatsapp, embudo comercial, automatizacion ventas',
    },
    content: {
      pt: {
        title: 'Playbook CRM + WhatsApp para acelerar vendas sem perder qualidade',
        excerpt:
          'Eventos, etapas e automações recomendadas para ligar atendimento, qualificação e fechamento comercial.',
        category: 'Automação Comercial',
      },
      en: {
        title: 'CRM + WhatsApp playbook to accelerate sales without losing quality',
        excerpt:
          'Recommended events, stages and automations to connect support, qualification and sales closing.',
        category: 'Revenue Automation',
      },
      es: {
        title: 'Playbook CRM + WhatsApp para acelerar ventas sin perder calidad',
        excerpt:
          'Eventos, etapas y automatizaciones recomendadas para conectar atencion, calificacion y cierre comercial.',
        category: 'Automatizacion Comercial',
      },
    },
  },
  {
    slug: 'seguranca-integracoes-meta-whatsapp',
    date: '2026-02-04',
    readTime: '10 min',
    keywords: {
      pt: 'seguranca api, whatsapp, meta, webhook signature',
      en: 'api security, whatsapp, meta, webhook signature',
      es: 'seguridad api, whatsapp, meta, firma webhook',
    },
    content: {
      pt: {
        title: 'Checklist de segurança para integrações Meta e WhatsApp',
        excerpt:
          'Boas práticas de assinatura, segregação de credenciais, rate limit e trilha de auditoria.',
        category: 'Segurança',
      },
      en: {
        title: 'Security checklist for Meta and WhatsApp integrations',
        excerpt:
          'Best practices for signatures, credential segregation, rate limiting and audit trail.',
        category: 'Security',
      },
      es: {
        title: 'Checklist de seguridad para integraciones de Meta y WhatsApp',
        excerpt:
          'Buenas practicas de firma, segregacion de credenciales, rate limit y trazabilidad de auditoria.',
        category: 'Seguridad',
      },
    },
  },
  {
    slug: 'custos-whatsapp-cloud-api-otimizacao',
    date: '2026-01-30',
    readTime: '7 min',
    keywords: {
      pt: 'custos whatsapp api, templates, operacao',
      en: 'whatsapp api costs, templates, operations',
      es: 'costos whatsapp api, plantillas, operacion',
    },
    content: {
      pt: {
        title: 'Custos na WhatsApp Cloud API: como otimizar sem degradar experiência',
        excerpt:
          'Regras práticas para reduzir desperdício de conversas e melhorar taxa de resolução por jornada.',
        category: 'Operação',
      },
      en: {
        title: 'WhatsApp Cloud API costs: how to optimize without degrading experience',
        excerpt:
          'Practical rules to reduce conversation waste and improve resolution rate by journey.',
        category: 'Operations',
      },
      es: {
        title: 'Costos en WhatsApp Cloud API: como optimizar sin degradar la experiencia',
        excerpt:
          'Reglas practicas para reducir desperdicio de conversaciones y mejorar tasa de resolucion por jornada.',
        category: 'Operacion',
      },
    },
  },
  {
    slug: 'testes-contrato-webhooks-apis',
    date: '2026-01-24',
    readTime: '9 min',
    keywords: {
      pt: 'teste de contrato, webhook, api integration',
      en: 'contract testing, webhook, api integration',
      es: 'pruebas de contrato, webhook, integracion api',
    },
    content: {
      pt: {
        title: 'Testes de contrato para webhooks e APIs: reduzindo regressão em integrações',
        excerpt:
          'Estratégia de testes para evitar quebra silenciosa quando parceiros mudam payload ou versão.',
        category: 'Qualidade',
      },
      en: {
        title: 'Contract testing for webhooks and APIs: reducing integration regressions',
        excerpt:
          'Testing strategy to avoid silent breakages when partners change payloads or versions.',
        category: 'Quality Engineering',
      },
      es: {
        title: 'Pruebas de contrato para webhooks y APIs: reduciendo regresiones en integraciones',
        excerpt:
          'Estrategia de pruebas para evitar quiebres silenciosos cuando partners cambian payload o version.',
        category: 'Calidad',
      },
    },
  },
  {
    slug: 'arquitetura-multi-tenant-whatsapp-saas',
    date: '2026-01-19',
    readTime: '12 min',
    keywords: {
      pt: 'multi tenant, saas whatsapp, arquitetura backend',
      en: 'multi tenant, whatsapp saas, backend architecture',
      es: 'multi tenant, saas whatsapp, arquitectura backend',
    },
    content: {
      pt: {
        title: 'Arquitetura multi-tenant para SaaS com WhatsApp',
        excerpt:
          'Padrões para isolamento de clientes, limites por tenant e governança de configurações.',
        category: 'SaaS Architecture',
      },
      en: {
        title: 'Multi-tenant architecture for WhatsApp SaaS',
        excerpt:
          'Patterns for tenant isolation, per-tenant limits and configuration governance.',
        category: 'SaaS Architecture',
      },
      es: {
        title: 'Arquitectura multi-tenant para SaaS con WhatsApp',
        excerpt:
          'Patrones para aislamiento de clientes, limites por tenant y gobernanza de configuraciones.',
        category: 'Arquitectura SaaS',
      },
    },
  },
  {
    slug: 'roadmap-automacao-suporte-ia-90-dias',
    date: '2026-01-12',
    readTime: '8 min',
    keywords: {
      pt: 'roadmap automacao, suporte ia, implementacao 90 dias',
      en: 'automation roadmap, ai support, 90-day implementation',
      es: 'roadmap automatizacion, soporte ia, implementacion 90 dias',
    },
    content: {
      pt: {
        title: 'Roadmap de 90 dias para automação de atendimento com IA',
        excerpt:
          'Plano em fases para sair do piloto e chegar em operação com métrica, governança e escala.',
        category: 'Estratégia Técnica',
      },
      en: {
        title: '90-day roadmap for AI support automation',
        excerpt:
          'Phased plan to move from pilot to production with metrics, governance and scale.',
        category: 'Technical Strategy',
      },
      es: {
        title: 'Roadmap de 90 dias para automatizacion de atencion con IA',
        excerpt:
          'Plan por fases para pasar de piloto a produccion con metricas, gobernanza y escala.',
        category: 'Estrategia Tecnica',
      },
    },
  },
];

const upcomingPostsByLanguage = {
  pt: [
    'Deduplicação de contexto em RAG: cortar o trecho repetido',
    'Backpressure em pipeline de IA: quando o consumidor não acompanha',
  ],
  en: [
    'Context deduplication in RAG: cutting the repeated passage',
    'Backpressure in an AI pipeline: when the consumer cannot keep up',
  ],
  es: [
    'Deduplicación de contexto en RAG: cortar el fragmento repetido',
    'Backpressure en un pipeline de IA: cuando el consumidor no da abasto',
  ],
};

const buildPublishedPosts = (language) =>
  publishedPostDefinitions.map((post) => ({
    slug: post.slug,
    date: post.date,
    readTime: post.readTime,
    title: post.content[language]?.title || post.content.pt.title,
    excerpt: post.content[language]?.excerpt || post.content.pt.excerpt,
    category: post.content[language]?.category || post.content.pt.category,
    keywords: post.keywords[language] || post.keywords.pt,
  }));

const blogByLanguage = {
  pt: {
    publishedPosts: buildPublishedPosts('pt'),
    upcomingPosts: upcomingPostsByLanguage.pt,
  },
  en: {
    publishedPosts: buildPublishedPosts('en'),
    upcomingPosts: upcomingPostsByLanguage.en,
  },
  es: {
    publishedPosts: buildPublishedPosts('es'),
    upcomingPosts: upcomingPostsByLanguage.es,
  },
};

const getBlogLanguageContent = (language = 'pt') => {
  const locale = toBaseLanguage(language);
  return blogByLanguage[locale] || blogByLanguage.pt;
};

export const getPublishedPosts = (language = 'pt') =>
  getBlogLanguageContent(language).publishedPosts;

export const getUpcomingPosts = (language = 'pt') =>
  getBlogLanguageContent(language).upcomingPosts;

export const getPostBySlug = (slug, language = 'pt') =>
  getPublishedPosts(language).find((post) => post.slug === slug);

export const getPostContent = (slug, language = 'pt') =>
  getPostContentBySlug(slug, toBaseLanguage(language));
