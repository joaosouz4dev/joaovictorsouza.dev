import { toBaseLanguage } from '../../utils/i18n.js';

const publishedPostDefinitions = [
  {
    slug: 'fila-revisao-humana-quais-respostas-agente-merecem-auditoria',
    date: '2026-08-13',
    readTime: '15 min',
    keywords: {
      pt: 'fila de revisao humana, auditoria de respostas de agente, amostragem por prioridade, elevacao sobre aleatoria, orcamento de atencao, sinais preditivos de erro, conjunto de avaliacao a partir da revisao, concordancia entre revisores, cobertura de revisao, anthropic',
      en: 'human review queue, agent answer auditing, priority sampling, lift over random, attention budget, error predictive signals, evaluation set from review, inter reviewer agreement, review coverage, anthropic',
      es: 'fila de revision humana, auditoria de respuestas del agente, muestreo por prioridad, elevacion sobre aleatoria, presupuesto de atencion, senales predictivas de error, conjunto de evaluacion desde la revision, concordancia entre revisores, cobertura de revision, anthropic',
    },
    content: {
      pt: {
        title: 'Fila de revisão humana: escolher quais respostas do agente merecem auditoria',
        excerpt:
          'Duas pessoas conseguem revisar seiscentas respostas por mês num sistema que responde quarenta mil vezes, e a escolha padrão de sortear ao acaso faz o revisor passar o turno confirmando que respostas certas estão certas. Por que estimar a taxa de erro e encontrar erro são objetivos opostos que exigem fatias separadas do mesmo orçamento, quais três sinais já existem nos seus dados e rendem mais que a confiança do modelo, por que a fila precisa ser dimensionada pela capacidade do turno e o excedente descartado todo dia em vez de acumulado, como fazer cada veredito negativo já nascer como caso candidato do conjunto de avaliação, e por que a elevação sobre a aleatória é a única métrica que justifica a máquina inteira.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Human review queue: choosing which agent answers deserve an audit',
        excerpt:
          'Two people can review six hundred answers a month in a system that answers forty thousand times, and the default choice of drawing at random makes the reviewer spend the shift confirming that correct answers are correct. Why estimating the error rate and finding errors are opposite goals requiring separate slices of the same budget, which three signals already exist in your data and outperform model confidence, why the queue must be sized by shift capacity with the overflow discarded daily rather than accumulated, how to make every negative verdict be born as a candidate evaluation set case, and why lift over random is the only metric that justifies the whole machine.',
        category: 'Applied AI',
      },
      es: {
        title: 'Fila de revisión humana: elegir qué respuestas del agente merecen auditoría',
        excerpt:
          'Dos personas pueden revisar seiscientas respuestas por mes en un sistema que responde cuarenta mil veces, y la elección por defecto de sortear al azar hace que el revisor pase el turno confirmando que respuestas correctas están correctas. Por qué estimar la tasa de error y encontrar errores son objetivos opuestos que exigen porciones separadas del mismo presupuesto, qué tres señales ya existen en tus datos y rinden más que la confianza del modelo, por qué la fila debe dimensionarse por la capacidad del turno y el excedente descartarse todos los días en vez de acumularse, cómo hacer que cada veredicto negativo nazca ya como caso candidato del conjunto de evaluación, y por qué la elevación sobre la aleatoria es la única métrica que justifica toda la maquinaria.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'aquecimento-indice-vetorial-primeira-consulta-do-dia-lenta',
    date: '2026-08-11',
    readTime: '14 min',
    keywords: {
      pt: 'aquecimento de indice vetorial, partida fria em rag, latencia da primeira consulta, cache frio, prontidao e vivacidade, arquivo mapeado em memoria, indice quente parcial, percentil por estado, busca por vizinho aproximado, anthropic',
      en: 'vector index warm-up, rag cold start, first query latency, cold cache, readiness and liveness, memory mapped index file, partial hot index, percentile per state, approximate nearest neighbor search, anthropic',
      es: 'calentamiento de indice vectorial, arranque frio en rag, latencia de la primera consulta, cache fria, preparacion y vitalidad, archivo mapeado en memoria, indice caliente parcial, percentil por estado, busqueda por vecino aproximado, anthropic',
    },
    content: {
      pt: {
        title: 'Aquecimento de índice vetorial: por que a primeira consulta do dia é lenta',
        excerpt:
          'A primeira consulta da manhã leva oito segundos, a segunda leva quatrocentos milissegundos, e a média do dia esconde as duas. Por que o tempo não está só no modelo de embedding, mas em quatro caches frios independentes, por que uma consulta sintética no boot aquece a vizinhança de um único ponto do grafo e deixa o resto gelado, por que o teste de prontidão que responde pronto antes de aquecer joga o custo direto no primeiro cliente, quando pré-carregar tudo na memória perde para um índice quente parcial, e por que a única métrica que enxerga o problema é o percentil rotulado por estado do processo em vez do percentil agregado.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Vector index warm-up: why the first query of the day is slow',
        excerpt:
          'The first query of the morning takes eight seconds, the second takes four hundred milliseconds, and the daily average hides both. Why the time is not only in the embedding model but in four independent cold caches, why a synthetic query at boot warms the neighborhood of a single point in the graph and leaves the rest frozen, why a readiness probe that answers ready before warming throws the cost straight at the first customer, when preloading everything into memory loses to a partial hot index, and why the only metric that sees the problem is a percentile labeled by process state rather than the aggregate percentile.',
        category: 'Applied AI',
      },
      es: {
        title: 'Calentamiento de índice vectorial: por qué la primera consulta del día es lenta',
        excerpt:
          'La primera consulta de la mañana tarda ocho segundos, la segunda tarda cuatrocientos milisegundos, y el promedio del día esconde las dos. Por qué el tiempo no está solo en el modelo de embedding sino en cuatro cachés frías independientes, por qué una consulta sintética en el arranque calienta la vecindad de un único punto del grafo y deja el resto helado, por qué la prueba de preparación que responde listo antes de calentar tira el costo directo al primer cliente, cuándo precargar todo en memoria pierde contra un índice caliente parcial, y por qué la única métrica que ve el problema es el percentil etiquetado por estado del proceso en vez del percentil agregado.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'retencao-dados-sistema-ia-o-que-guardar-quanto-tempo-como-apagar',
    date: '2026-08-10',
    readTime: '15 min',
    keywords: {
      pt: 'retencao de dados, lgpd em sistema de ia, exclusao de dado pessoal, prazo de retencao, expurgo automatico, indice vetorial e privacidade, anonimizacao de eval, trace com conteudo redigido, backup e direito ao esquecimento, anthropic',
      en: 'data retention, privacy in ai systems, personal data deletion, retention period, automated purge, vector index and privacy, eval anonymization, redacted trace content, backup and right to erasure, anthropic',
      es: 'retencion de datos, privacidad en sistemas de ia, eliminacion de dato personal, plazo de retencion, purga automatica, indice vectorial y privacidad, anonimizacion de eval, trace con contenido redactado, backup y derecho al olvido, anthropic',
    },
    content: {
      pt: {
        title: 'Retenção de dados em sistema com IA: o que guardar, por quanto tempo e como apagar',
        excerpt:
          'A mesma frase do cliente está na conversa, no payload do webhook, no trace, no índice vetorial, na memória do agente, no cache, no eval e num log que alguém deixou verboso em março, e o time apaga só a primeira. Como inventariar as oito cópias com dono, propósito e prazo, por que derivar o prazo do propósito em vez do padrão da ferramenta de log, por que separar conteúdo de metadado resolve a tensão entre apagar e continuar operando, por que apagar de índice vetorial e de conjunto de avaliação é tecnicamente diferente de apagar de tabela, como rodar expurgo em lotes sem travar o banco, e por que a métrica certa é a idade do registro mais velho vivo em vez do número de linhas apagadas.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Data retention in an AI system: what to keep, for how long and how to delete it',
        excerpt:
          'The same customer sentence lives in the conversation, the webhook payload, the trace, the vector index, the agent memory, the cache, the eval and a log someone left verbose back in March, and the team deletes only the first one. How to inventory the eight copies with owner, purpose and deadline, why deadlines should come from purpose instead of the log tool default, why separating content from metadata resolves the tension between deleting and staying operational, why deleting from a vector index and an evaluation set is technically different from deleting from a table, how to run batched purges without locking the database, and why the right metric is the age of the oldest surviving record rather than the number of rows deleted.',
        category: 'Applied AI',
      },
      es: {
        title: 'Retención de datos en un sistema con IA: qué guardar, por cuánto tiempo y cómo borrarlo',
        excerpt:
          'La misma frase del cliente está en la conversación, en el payload del webhook, en el trace, en el índice vectorial, en la memoria del agente, en la caché, en el eval y en un log que alguien dejó verboso en marzo, y el equipo borra solo la primera. Cómo inventariar las ocho copias con dueño, propósito y plazo, por qué derivar el plazo del propósito en vez del valor por defecto de la herramienta de logs, por qué separar contenido de metadato resuelve la tensión entre borrar y seguir operando, por qué borrar de un índice vectorial y de un conjunto de evaluación es técnicamente distinto de borrar de una tabla, cómo correr purgas en lotes sin trabar la base, y por qué la métrica correcta es la edad del registro más viejo vivo y no la cantidad de filas borradas.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'congelar-conjunto-avaliacao-eval-envelhece-como-renovar',
    date: '2026-08-09',
    readTime: '15 min',
    keywords: {
      pt: 'conjunto de avaliacao, eval de llm, nucleo congelado, janela rotativa, holdout selado, vazamento de caso de teste, otimizacao contra a regua, versionamento de eval, saturacao de metrica, anthropic',
      en: 'evaluation set, llm eval, frozen core, rotating window, sealed holdout, test case leakage, optimizing against the ruler, eval versioning, metric saturation, anthropic',
      es: 'conjunto de evaluacion, eval de llm, nucleo congelado, ventana rotativa, holdout sellado, filtracion de caso de prueba, optimizacion contra la regla, versionado de eval, saturacion de metrica, anthropic',
    },
    content: {
      pt: {
        title: 'Congelar o conjunto de avaliação: por que o seu eval envelhece e como renovar',
        excerpt:
          'O eval passou de 78% para 94% em seis meses, e a explicação provável não é que o sistema melhorou: é que o conjunto envelheceu. Por que ele fica velho por deriva de tráfego, por vazamento de casos já corrigidos, por otimização contra a régua e por rótulo preso a uma política que mudou, como dividir o conjunto em núcleo congelado, janela rotativa e holdout selado com contratos de mudança diferentes, por que trocar a janela sem rodar o sistema atual nas duas versões destrói a série histórica, quais gatilhos dizem que chegou a hora, e por que reportar um índice único esconde exatamente a regressão que você menos pode deixar passar.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Freezing the evaluation set: why your eval ages and how to renew it',
        excerpt:
          'The eval went from 78% to 94% in six months, and the likely explanation is not that the system improved: it is that the set aged. Why it gets old through traffic drift, leakage of already fixed cases, optimizing against the ruler and labels tied to a policy that changed, how to split the set into a frozen core, a rotating window and a sealed holdout with different change contracts, why swapping the window without running the current system against both versions destroys the historical series, which triggers say it is time, and why reporting a single index hides exactly the regression you can least afford to miss.',
        category: 'Applied AI',
      },
      es: {
        title: 'Congelar el conjunto de evaluación: por qué tu eval envejece y cómo renovarlo',
        excerpt:
          'El eval pasó de 78% a 94% en seis meses, y la explicación probable no es que el sistema mejoró: es que el conjunto envejeció. Por qué se pone viejo por deriva de tráfico, por filtración de casos ya corregidos, por optimización contra la regla y por etiquetas atadas a una política que cambió, cómo dividir el conjunto en núcleo congelado, ventana rotativa y holdout sellado con contratos de cambio distintos, por qué cambiar la ventana sin correr el sistema actual en las dos versiones destruye la serie histórica, qué disparadores dicen que llegó el momento, y por qué reportar un índice único esconde justamente la regresión que menos podés dejar pasar.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'aquecimento-cache-prompt-pagar-prefixo-uma-vez',
    date: '2026-08-08',
    readTime: '14 min',
    keywords: {
      pt: 'cache de prompt, aquecimento de cache, prefixo estavel, ordenacao do prompt, taxa de acerto de cache, custo de llm, tempo de vida do cache, fragmentacao de prefixo, latencia ate o primeiro token, anthropic',
      en: 'prompt cache, cache warming, stable prefix, prompt ordering, cache hit rate, llm cost, cache lifetime, prefix fragmentation, time to first token, anthropic',
      es: 'cache de prompt, calentamiento de cache, prefijo estable, ordenacion del prompt, tasa de acierto de cache, costo de llm, tiempo de vida de la cache, fragmentacion de prefijo, tiempo hasta el primer token, anthropic',
    },
    content: {
      pt: {
        title: 'Aquecimento de cache de prompt: pagar o prefixo uma vez e reaproveitar',
        excerpt:
          'O cache de prompt é a otimização com melhor relação entre esforço e retorno em sistemas com LLM, e também a que mais gente liga errado: ele casa por prefixo exato de tokens desde a posição zero, então uma data com hora no topo do prompt do sistema já invalida tudo que vem depois. Por que ordenar o prompt por frequência de mudança é a única regra que importa, o que invalida o cache sem ninguém perceber e como travar isso com um teste de hash, por que o aquecimento com ping periódico só se paga acima de um volume por prefixo, como fatorar o bloco comum quando o sistema tem vinte e quatro prefixos concorrendo, e por que avaliar cache pela queda da fatura mistura tudo.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Prompt cache warming: paying for the prefix once and reusing it',
        excerpt:
          'Prompt caching is the best effort-to-return optimization in LLM systems, and also the one most people turn on incorrectly: it matches by exact token prefix from position zero, so a date with a time at the top of the system prompt already invalidates everything after it. Why ordering the prompt by frequency of change is the only rule that matters, what invalidates the cache without anyone noticing and how to lock it down with a hash test, why periodic-ping warming only pays off above a certain per-prefix volume, how to factor out the common block when the system has twenty-four prefixes competing, and why evaluating the cache by the drop in the bill mixes everything together.',
        category: 'Applied AI',
      },
      es: {
        title: 'Calentamiento de caché de prompt: pagar el prefijo una vez y reaprovecharlo',
        excerpt:
          'La caché de prompt es la optimización con mejor relación entre esfuerzo y retorno en sistemas con LLM, y también la que más gente activa mal: casa por prefijo exacto de tokens desde la posición cero, así que una fecha con hora arriba del prompt del sistema ya invalida todo lo que viene después. Por qué ordenar el prompt por frecuencia de cambio es la única regla que importa, qué invalida la caché sin que nadie lo note y cómo fijarlo con una prueba de hash, por qué el calentamiento con ping periódico solo se paga por encima de cierto volumen por prefijo, cómo factorizar el bloque común cuando el sistema tiene veinticuatro prefijos compitiendo, y por qué evaluar la caché por la caída de la factura lo mezcla todo.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'multi-idioma-bot-atendimento-detectar-responder-escalar',
    date: '2026-08-07',
    readTime: '14 min',
    keywords: {
      pt: 'bot de atendimento multi-idioma, deteccao de idioma, idioma como estado da conversa, detector com abstencao, rag multilingue, template por idioma, transbordo por idioma, metricas segmentadas por idioma, whatsapp cloud api, anthropic',
      en: 'multilingual support bot, language detection, language as conversation state, detector with abstention, multilingual rag, template per language, handoff per language, metrics segmented by language, whatsapp cloud api, anthropic',
      es: 'bot de atencion multiidioma, deteccion de idioma, idioma como estado de la conversacion, detector con abstencion, rag multilingue, plantilla por idioma, traspaso por idioma, metricas segmentadas por idioma, whatsapp cloud api, anthropic',
    },
    content: {
      pt: {
        title: 'Multi-idioma em bot de atendimento: detectar, responder e escalar sem misturar',
        excerpt:
          'O modelo já responde em qualquer idioma sem que você peça, e é justamente por isso que o projeto parece pronto no primeiro teste e quebra em produção. Por que o idioma é estado da conversa e não atributo da mensagem, por que o detector precisa poder dizer que não sabe em vez de chutar num "ok" de duas letras, por que a base de conhecimento é o gargalo real e quando índice separado por idioma deixa de ser preferência, como instruir a geração sem deixar o modelo espelhar o idioma do contexto, o que fazer quando o template não existe aprovado naquele idioma ou não há atendente na fila, e por que a média das métricas esconde exatamente o mercado que está quebrado.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Multilingual support bots: detecting, answering and escalating without mixing',
        excerpt:
          'The model already answers in any language without being asked, and that is precisely why the project looks finished on the first test and breaks in production. Why language is conversation state and not a message attribute, why the detector must be able to say it does not know instead of guessing on a two-letter "ok", why the knowledge base is the real bottleneck and when a separate index per language stops being a preference, how to instruct generation without letting the model mirror the context language, what to do when the template is not approved in that language or no agent is on the queue, and why the metric average hides exactly the market that is broken.',
        category: 'Applied AI',
      },
      es: {
        title: 'Bot de atención multiidioma: detectar, responder y escalar sin mezclar',
        excerpt:
          'El modelo ya responde en cualquier idioma sin que se lo pidas, y justamente por eso el proyecto parece listo en la primera prueba y se rompe en producción. Por qué el idioma es estado de la conversación y no atributo del mensaje, por qué el detector debe poder decir que no sabe en vez de adivinar en un "ok" de dos letras, por qué la base de conocimiento es el cuello de botella real y cuándo el índice separado por idioma deja de ser preferencia, cómo instruir la generación sin dejar que el modelo refleje el idioma del contexto, qué hacer cuando la plantilla no está aprobada en ese idioma o no hay agente en la fila, y por qué el promedio de las métricas esconde justamente el mercado que está roto.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'sandbox-ferramentas-limitar-o-que-agente-pode-executar',
    date: '2026-08-06',
    readTime: '14 min',
    keywords: {
      pt: 'sandbox de ferramentas, tool use seguro, agente de ia, autorizacao no ponto de execucao, validacao de argumento, isolamento de processo, teto de consumo por conversa, teste adversarial, prompt injection, anthropic',
      en: 'tool sandboxing, safe tool use, ai agent, authorization at execution point, argument validation, process isolation, per-conversation consumption cap, adversarial test, prompt injection, anthropic',
      es: 'sandbox de herramientas, tool use seguro, agente de ia, autorizacion en el punto de ejecucion, validacion de argumento, aislamiento de proceso, techo de consumo por conversacion, prueba adversarial, prompt injection, anthropic',
    },
    content: {
      pt: {
        title: 'Sandbox de ferramentas: limitar o que o agente pode executar de verdade',
        excerpt:
          'A ferramenta que você entregou ao agente executa, e nenhuma linha do prompt muda isso: o texto é uma sugestão estatística, o código que roda depois dela é uma execução real. Por que o prompt não é mecanismo de segurança e a entrada hostil nem precisa vir do cliente, como classificar ferramenta por efeito e não por nome, por que o identificador de quem pede nunca pode vir do argumento e a autorização precisa ser reavaliada no ponto de execução, como validar contra o esquema e depois contra o domínio, como isolar código gerado em processo com ambiente vazio e teto de tempo, memória e saída, e como testar a fuga em vez de torcer para o prompt segurar.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Tool sandboxing: bounding what the agent can actually execute',
        excerpt:
          'The tool you handed the agent executes, and no prompt line changes that: the text is a statistical suggestion, the code that runs after it is a real execution. Why the prompt is not a security mechanism and the hostile input does not even have to come from the customer, how to classify tools by effect and not by name, why the identifier of whoever is asking can never come from the argument and authorization has to be re-evaluated at the execution point, how to validate against the schema and then against the domain, how to isolate generated code in a process with an empty environment and ceilings on time, memory and output, and how to test the escape instead of hoping the prompt holds.',
        category: 'Applied AI',
      },
      es: {
        title: 'Sandbox de herramientas: acotar lo que el agente puede ejecutar de verdad',
        excerpt:
          'La herramienta que le entregaste al agente ejecuta, y ninguna línea del prompt cambia eso: el texto es una sugerencia estadística, el código que corre después es una ejecución real. Por qué el prompt no es mecanismo de seguridad y la entrada hostil ni siquiera necesita venir del cliente, cómo clasificar herramientas por efecto y no por nombre, por qué el identificador de quien pide nunca puede venir del argumento y la autorización debe reevaluarse en el punto de ejecución, cómo validar contra el esquema y después contra el dominio, cómo aislar código generado en un proceso con entorno vacío y techos de tiempo, memoria y salida, y cómo probar la fuga en vez de confiar en que el prompt aguante.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'feature-flag-fluxo-agente-ligar-comportamento-novo-para-poucos',
    date: '2026-08-05',
    readTime: '14 min',
    keywords: {
      pt: 'feature flag em agente de ia, rollout gradual, flag congelada na conversa, kill switch de ferramenta, ancora deterministica, conversao em ponto seguro, atribuicao por conversa, experimento em agente, estado do agente, anthropic',
      en: 'feature flag in ai agent, gradual rollout, flag frozen per conversation, tool kill switch, deterministic anchor, conversion at a safe point, per-conversation attribution, agent experiment, agent state, anthropic',
      es: 'feature flag en agente de ia, rollout gradual, flag congelada en la conversacion, kill switch de herramienta, ancla determinista, conversion en punto seguro, atribucion por conversacion, experimento en agente, estado del agente, anthropic',
    },
    content: {
      pt: {
        title: 'Feature flag em fluxo de agente: ligar comportamento novo para poucos',
        excerpt:
          'Num endpoint a flag é barata porque a decisão nasce e morre dentro da requisição; num fluxo de agente a unidade é a conversa, que dura dias, guarda estado entre os turnos e às vezes já executou uma ferramenta com efeito no mundo real. Por que avaliar a flag a cada turno produz um agente que troca de personalidade no meio, como congelar a decisão na criação da conversa e ancorá-la no identificador certo, quais flags podem virar no meio e quais não, como matar a variante ruim com conversão em ponto seguro em vez de quebrar quem está dentro, e por que a comparação entre variantes só significa algo com atribuição por desfecho.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Feature flags in an agent flow: turning new behavior on for a few',
        excerpt:
          'On an endpoint a flag is cheap because the decision is born and dies inside the request; in an agent flow the unit is the conversation, which lasts days, keeps state across turns and sometimes has already executed a tool with an effect in the real world. Why evaluating the flag on every turn produces an agent that changes personality midway, how to freeze the decision at conversation creation and anchor it on the right identifier, which flags may flip midway and which may not, how to kill the bad variant with conversion at a safe point instead of breaking whoever is inside, and why comparing variants only means something with per-outcome attribution.',
        category: 'Applied AI',
      },
      es: {
        title: 'Feature flag en flujo de agente: activar comportamiento nuevo para pocos',
        excerpt:
          'En un endpoint la flag es barata porque la decisión nace y muere dentro de la petición; en un flujo de agente la unidad es la conversación, que dura días, guarda estado entre los turnos y a veces ya ejecutó una herramienta con efecto en el mundo real. Por qué evaluar la flag en cada turno produce un agente que cambia de personalidad a mitad, cómo congelar la decisión al crear la conversación y anclarla en el identificador correcto, qué flags pueden cambiar a mitad y cuáles no, cómo matar la variante mala con conversión en punto seguro en vez de romper a quien está dentro, y por qué la comparación entre variantes solo significa algo con atribución por desenlace.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'testes-carga-sistema-llm-simular-provedor-sem-pagar',
    date: '2026-08-04',
    readTime: '14 min',
    keywords: {
      pt: 'teste de carga com llm, simular provedor de llm, dublê de api, perfil de latencia, cauda longa, tempo ate o primeiro token, injecao de falha deterministica, streaming em teste de carga, backpressure, capacidade',
      en: 'llm load testing, simulate llm provider, api stand-in, latency profile, long tail, time to first token, deterministic failure injection, streaming in load tests, backpressure, capacity',
      es: 'prueba de carga con llm, simular proveedor de llm, doble de api, perfil de latencia, cola larga, tiempo hasta el primer token, inyeccion de fallo determinista, streaming en prueba de carga, backpressure, capacidad',
    },
    content: {
      pt: {
        title: 'Testes de carga em sistema com LLM: simular o provedor sem pagar por ele',
        excerpt:
          'Testar dez mil conversas contra a API real custa o preço de dez mil conversas, e mesmo assim você mede o rate limit da sua conta em vez do limite do seu sistema. Por que chamar o provedor de verdade destrói a atribuição e a reprodutibilidade do teste, por que o dublê de latência constante invalida tudo que vem depois, como modelar as duas fases do tempo de resposta e a cauda longa que realmente quebra a fila, como reproduzir streaming evento a evento e injetar falha determinística por semente, o que medir do lado certo da fronteira e onde o dublê deixa de servir e você precisa da API real.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Load testing an LLM system: simulating the provider without paying for it',
        excerpt:
          'Testing ten thousand conversations against the real API costs the price of ten thousand conversations, and even then you measure your account rate limit instead of your system limit. Why calling the real provider destroys the attribution and the reproducibility of the test, why the constant-latency stand-in invalidates everything downstream, how to model both phases of response time and the long tail that actually breaks the queue, how to reproduce streaming event by event and inject deterministic failures by seed, what to measure on the right side of the boundary and where the stand-in stops serving and you need the real API.',
        category: 'Applied AI',
      },
      es: {
        title: 'Pruebas de carga en un sistema con LLM: simular el proveedor sin pagarlo',
        excerpt:
          'Probar diez mil conversaciones contra la API real cuesta el precio de diez mil conversaciones, y aun así mides el rate limit de tu cuenta en vez del límite de tu sistema. Por qué llamar al proveedor de verdad destruye la atribución y la reproducibilidad de la prueba, por qué el doble de latencia constante invalida todo lo que viene después, cómo modelar las dos fases del tiempo de respuesta y la cola larga que de verdad rompe la fila, cómo reproducir streaming evento a evento e inyectar fallo determinista por semilla, qué medir del lado correcto de la frontera y dónde el doble deja de servir y necesitas la API real.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'migrar-embeddings-sem-reindexar-tudo-de-uma-vez',
    date: '2026-08-03',
    readTime: '14 min',
    keywords: {
      pt: 'migrar embeddings, reindexacao incremental, versao de embedding, backfill retomavel, escrita dupla, espaco vetorial, paridade de retrieval, rollback de indice, rag, anthropic',
      en: 'migrate embeddings, incremental reindexing, embedding version, resumable backfill, dual write, vector space, retrieval parity, index rollback, rag, anthropic',
      es: 'migrar embeddings, reindexacion incremental, version de embedding, backfill reanudable, escritura doble, espacio vectorial, paridad de retrieval, rollback de indice, rag, anthropic',
    },
    content: {
      pt: {
        title: 'Migrar de embeddings sem reindexar tudo de uma vez',
        excerpt:
          'O modelo novo é mais barato e pontua melhor, e trocar parece uma linha de configuração: só que vetor gerado por um modelo não é comparável com vetor gerado por outro, e no instante da troca o retrieval não degrada aos poucos, ele vira ruído sem levantar um erro sequer. Por que dois espaços vetoriais não se misturam nem com a mesma dimensão, como versionar o vetor para os dois conviverem, como fazer o backfill retomável priorizando o que o tráfego realmente consulta, por que a escrita dupla é o que impede a fronteira de se renovar sozinha, como decidir a virada por paridade medida em sombra e por que o índice antigo é o seu rollback.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Migrating embeddings without reindexing everything at once',
        excerpt:
          'The new model is cheaper and scores better, and switching looks like one configuration line: except a vector produced by one model is not comparable with a vector produced by another, and at the moment of the switch retrieval does not degrade gradually, it turns into noise without raising a single error. Why two vector spaces do not mix even at the same dimension, how to version the vector so both can coexist, how to run a resumable backfill prioritizing what traffic actually queries, why dual write is what stops the frontier from renewing itself, how to decide the cutover by parity measured in shadow and why the old index is your rollback.',
        category: 'Applied AI',
      },
      es: {
        title: 'Migrar de embeddings sin reindexar todo de una vez',
        excerpt:
          'El modelo nuevo es más barato y puntúa mejor, y cambiar parece una línea de configuración: solo que un vector generado por un modelo no es comparable con uno generado por otro, y en el instante del cambio el retrieval no se degrada de a poco, se vuelve ruido sin levantar un solo error. Por qué dos espacios vectoriales no se mezclan ni con la misma dimensión, cómo versionar el vector para que ambos convivan, cómo hacer el backfill reanudable priorizando lo que el tráfico realmente consulta, por qué la escritura doble es lo que impide que la frontera se renueve sola, cómo decidir el cambio por paridad medida en sombra y por qué el índice viejo es tu rollback.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'janela-contexto-compartilhada-entre-canais-whatsapp-web-telefone',
    date: '2026-08-02',
    readTime: '14 min',
    keywords: {
      pt: 'janela de contexto compartilhada, atendimento multicanal, whatsapp web e telefone, continuidade entre canais, vinculo de identidade, numero reciclado, orcamento de contexto, fato duravel, resumo de episodio, anthropic',
      en: 'shared context window, multichannel support, whatsapp web and phone, cross-channel continuity, identity linking, recycled phone number, context budget, durable fact, episode summary, anthropic',
      es: 'ventana de contexto compartida, atencion multicanal, whatsapp web y telefono, continuidad entre canales, vinculo de identidad, numero reciclado, presupuesto de contexto, hecho durable, resumen de episodio, anthropic',
    },
    content: {
      pt: {
        title: 'Janela de contexto compartilhada entre canais: WhatsApp, web e telefone',
        excerpt:
          'O cliente explicou o problema no WhatsApp, mandou o comprovante pelo chat do site e ligou no dia seguinte: para ele é uma conversa só, para o seu sistema são três que nunca se encontraram. Por que continuidade é estado compartilhado e não histórico empilhado, como separar fato durável de resumo de episódio e de transcrição descartável, como vincular identidades sem juntar duas pessoas quando o número foi reciclado pela operadora, como montar a janela por orçamento com fatias reservadas, como escrever concorrente entre canais sem perder mensagem e quando compartilhar contexto é a decisão errada.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'A context window shared across channels: WhatsApp, web and phone',
        excerpt:
          'The customer explained the problem on WhatsApp, sent the receipt through the website chat and called the next day: to them it is one conversation, to your system it is three that never met. Why continuity is shared state and not stacked history, how to separate a durable fact from an episode summary and a disposable transcript, how to link identities without merging two people when the number was recycled by the carrier, how to assemble the window by budget with reserved slices, how to write concurrently across channels without losing anything and when sharing context is the wrong call.',
        category: 'Applied AI',
      },
      es: {
        title: 'Ventana de contexto compartida entre canales: WhatsApp, web y teléfono',
        excerpt:
          'El cliente explicó el problema por WhatsApp, mandó el comprobante por el chat del sitio y llamó al día siguiente: para él es una sola conversación, para tu sistema son tres que nunca se encontraron. Por qué la continuidad es estado compartido y no historial apilado, cómo separar hecho durable de resumen de episodio y de transcripción descartable, cómo vincular identidades sin juntar a dos personas cuando el número fue reciclado por la operadora, cómo armar la ventana por presupuesto con porciones reservadas, cómo escribir de forma concurrente entre canales sin perder nada y cuándo compartir contexto es la decisión equivocada.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'limite-gasto-por-cliente-cortar-abuso-sem-punir-uso-legitimo',
    date: '2026-08-01',
    readTime: '14 min',
    keywords: {
      pt: 'limite de gasto por cliente, teto de custo de ia, rate limit vs orcamento, reserva de custo, deteccao de abuso, degradacao por orcamento, projecao de estouro, multi-tenant, finops de llm, anthropic',
      en: 'spend cap per customer, ai cost ceiling, rate limit vs budget, cost reservation, abuse detection, budget degradation, overrun forecast, multi-tenant, llm finops, anthropic',
      es: 'limite de gasto por cliente, techo de costo de ia, rate limit vs presupuesto, reserva de costo, deteccion de abuso, degradacion por presupuesto, proyeccion de exceso, multi-tenant, finops de llm, anthropic',
    },
    content: {
      pt: {
        title: 'Limite de gasto por cliente: cortar o abuso sem punir o uso legítimo',
        excerpt:
          'Um cliente de plano básico gastou em três dias o equivalente a onze meses da mensalidade dele, e o sistema aceitou tudo porque nunca lhe foi ensinado a dizer não. Por que rate limit protege capacidade e teto de gasto protege margem, por que contar requisições nunca vai aproximar dinheiro, como reservar o custo estimado antes da chamada e acertar pelo real depois, quanto estouro vale a pena trocar por latência quando o contador é distribuído, quais sinais separam abuso automatizado de crescimento legítimo e por que o aviso precisa vir da projeção e não do percentual.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Spend caps per customer: cutting abuse without punishing legitimate use',
        excerpt:
          'A basic-plan customer spent in three days the equivalent of eleven months of their subscription, and the system accepted all of it because it was never taught to say no. Why rate limiting protects capacity and spend caps protect margin, why counting requests will never approximate money, how to reserve the estimated cost before the call and settle by the real one after, how much overshoot is worth trading for latency when the counter is distributed, which signals separate automated abuse from legitimate growth and why the warning has to come from the projection and not the percentage.',
        category: 'Applied AI',
      },
      es: {
        title: 'Límite de gasto por cliente: cortar el abuso sin castigar el uso legítimo',
        excerpt:
          'Un cliente de plan básico gastó en tres días el equivalente a once meses de su mensualidad, y el sistema aceptó todo porque nunca se le enseñó a decir que no. Por qué el rate limit protege capacidad y el techo de gasto protege margen, por qué contar peticiones nunca va a aproximar dinero, cómo reservar el costo estimado antes de la llamada y liquidar por el real después, cuánto exceso vale la pena cambiar por latencia cuando el contador es distribuido, qué señales separan abuso automatizado de crecimiento legítimo y por qué el aviso tiene que venir de la proyección y no del porcentaje.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'trilha-auditoria-agente-ia-provar-o-que-foi-decidido',
    date: '2026-07-31',
    readTime: '14 min',
    keywords: {
      pt: 'trilha de auditoria, agente de ia, log append-only, encadeamento por hash, integridade de registro, decisao auditavel, cripto-exclusao, versao de politica, lgpd, anthropic',
      en: 'audit trail, ai agent, append-only log, hash chaining, record integrity, auditable decision, crypto-erasure, policy version, gdpr, anthropic',
      es: 'traza de auditoria, agente de ia, log append-only, encadenamiento por hash, integridad de registro, decision auditable, cripto-eliminacion, version de politica, rgpd, anthropic',
    },
    content: {
      pt: {
        title: 'Trilha de auditoria em agente de IA: provar o que foi decidido e por quê',
        excerpt:
          'O cliente reclama que o bot negou o reembolso dele, e o log tem a duração da chamada, a contagem de tokens e o status duzentos, mas não tem a regra aplicada nem os documentos que o agente leu. Por que log de aplicação e trilha de auditoria respondem perguntas diferentes, por que a unidade certa de registro é a decisão e não a chamada ao modelo, quais campos tornam a decisão reconstituível sem o banco de produção, como encadear os eventos por hash para que a edição posterior apareça, como registrar sem virar depósito de dado pessoal e como sair da reclamação até o evento concreto em minutos.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Audit trail in an AI agent: proving what was decided and why',
        excerpt:
          'The customer complains that the bot denied their refund, and the log has the call duration, the token count and the two hundred status, but not the rule applied nor the documents the agent read. Why an application log and an audit trail answer different questions, why the right unit of record is the decision and not the model call, which fields make the decision reconstructible without the production database, how to chain events by hash so a later edit shows up, how to record without becoming a personal data warehouse and how to go from the complaint to the concrete event in minutes.',
        category: 'Applied AI',
      },
      es: {
        title: 'Traza de auditoría en un agente de IA: probar qué se decidió y por qué',
        excerpt:
          'El cliente reclama que el bot le negó el reembolso, y el log tiene la duración de la llamada, el conteo de tokens y el estado doscientos, pero no la regla aplicada ni los documentos que el agente leyó. Por qué un log de aplicación y una traza de auditoría responden preguntas distintas, por qué la unidad correcta de registro es la decisión y no la llamada al modelo, qué campos vuelven la decisión reconstruible sin la base de producción, cómo encadenar los eventos por hash para que la edición posterior aparezca, cómo registrar sin volverse depósito de dato personal y cómo ir del reclamo al evento concreto en minutos.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'modo-degradado-manter-atendimento-quando-ia-indisponivel',
    date: '2026-07-30',
    readTime: '14 min',
    keywords: {
      pt: 'modo degradado, atendimento sem ia, falhar aberto ou fechado, disjuntor, nivel de degradacao, histerese, sonda de recuperacao, resposta pronta por intencao, orcamento de tempo, anthropic',
      en: 'degraded mode, support without ai, fail open or closed, circuit breaker, degradation level, hysteresis, recovery probe, canned answer per intent, time budget, anthropic',
      es: 'modo degradado, atencion sin ia, fallar abierto o cerrado, disyuntor, nivel de degradacion, histeresis, sonda de recuperacion, respuesta prearmada por intencion, presupuesto de tiempo, anthropic',
    },
    content: {
      pt: {
        title: 'Modo degradado: manter o atendimento de pé quando a IA está indisponível',
        excerpt:
          'Quando o provedor cai, a pergunta que decide a qualidade do atendimento não é técnica, é de produto: o que o cliente vê. Quase tudo que o bot faz de útil não depende do modelo, e a base, o histórico, a fila de humanos e o formulário continuam lá. Por que falhar aberto é diferente de falhar fechado e por que isso se decide por capacidade, como classificar a falha antes de reagir, quais níveis de degradação valem a pena, como descer rápido e subir devagar sem ficar oscilando, o que dizer ao cliente em cada nível e como exercitar tudo isso antes da queda real.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Degraded mode: keeping support standing when the AI is unavailable',
        excerpt:
          'When the provider goes down, the question that decides support quality is not technical, it is a product question: what does the customer see. Almost everything useful the bot does does not depend on the model, and the knowledge base, the history, the human queue and the intake form are all still there. Why failing open differs from failing closed and why that is decided per capability, how to classify the failure before reacting, which degradation levels are worth it, how to step down fast and up slowly without oscillating, what to tell the customer at each level and how to exercise all of it before the real outage.',
        category: 'Applied AI',
      },
      es: {
        title: 'Modo degradado: mantener la atención en pie cuando la IA no está disponible',
        excerpt:
          'Cuando el proveedor se cae, la pregunta que decide la calidad de la atención no es técnica, es de producto: qué ve el cliente. Casi todo lo útil que hace el bot no depende del modelo, y la base, el historial, la fila de humanos y el formulario siguen ahí. Por qué fallar abierto es distinto de fallar cerrado y por qué eso se decide por capacidad, cómo clasificar el fallo antes de reaccionar, qué niveles de degradación valen la pena, cómo bajar rápido y subir despacio sin quedar oscilando, qué decirle al cliente en cada nivel y cómo ejercitar todo eso antes de la caída real.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'detectar-deriva-qualidade-bot-atendimento-antes-do-cliente-reclamar',
    date: '2026-07-29',
    readTime: '14 min',
    keywords: {
      pt: 'deriva de qualidade, drift em bot de atendimento, degradacao silenciosa de llm, conjunto de referencia congelado, taxa de reformulacao, eval de regressao, deteccao de deriva, falso positivo em alerta, causa raiz de regressao, anthropic',
      en: 'quality drift, support bot drift, silent llm degradation, frozen reference set, reformulation rate, regression eval, drift detection, alert false positive, regression root cause, anthropic',
      es: 'deriva de calidad, drift en bot de atencion, degradacion silenciosa de llm, conjunto de referencia congelado, tasa de reformulacion, eval de regresion, deteccion de deriva, falso positivo en alerta, causa raiz de regresion, anthropic',
    },
    content: {
      pt: {
        title: 'Detectar deriva de qualidade em bot de atendimento antes do cliente reclamar',
        excerpt:
          'O bot não cai, a latência não sobe e a taxa de erro é zero, mas a resposta de hoje é pior que a de três semanas atrás e ninguém percebeu porque nada quebrou. Por que os quatro sinais clássicos de observabilidade não se movem, quais sinais comportamentais sobem antes da reclamação chegar, por que usar a média do próprio tráfego como referência garante nunca detectar a queda lenta, como separar deriva real de flutuação com volume mínimo e persistência, e como fazer o alerta chegar com o caso concreto em vez de só uma nota que caiu.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Detecting quality drift in a support bot before the customer complains',
        excerpt:
          'The bot does not go down, latency does not rise and the error rate is zero, but today answer is worse than the one from three weeks ago and nobody noticed because nothing broke. Why the four classic observability signals do not move, which behavioral signals rise before the complaint arrives, why using your own traffic average as a reference guarantees you never detect the slow decline, how to separate real drift from fluctuation with minimum volume and persistence, and how to make the alert arrive with the concrete case instead of just a score that dropped.',
        category: 'Applied AI',
      },
      es: {
        title: 'Detectar deriva de calidad en un bot de atención antes de que el cliente reclame',
        excerpt:
          'El bot no se cae, la latencia no sube y la tasa de error es cero, pero la respuesta de hoy es peor que la de hace tres semanas y nadie lo notó porque nada se rompió. Por qué las cuatro señales clásicas de observabilidad no se mueven, qué señales conductuales suben antes de que llegue el reclamo, por qué usar el promedio del propio tráfico como referencia garantiza no detectar nunca la caída lenta, cómo separar deriva real de fluctuación con volumen mínimo y persistencia, y cómo lograr que la alerta llegue con el caso concreto en vez de solo una nota que cayó.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'custo-por-conversa-atribuir-fatura-ia-ao-valor',
    date: '2026-07-28',
    readTime: '14 min',
    keywords: {
      pt: 'custo por conversa, atribuicao de custo de ia, finops de llm, custo por resolucao, tokens por conversa, rateio de cache de prompt, custo nao atribuido, reconciliacao de fatura, asynclocalstorage, anthropic',
      en: 'cost per conversation, ai cost attribution, llm finops, cost per resolution, tokens per conversation, prompt cache allocation, unattributed cost, invoice reconciliation, asynclocalstorage, anthropic',
      es: 'costo por conversacion, atribucion de costo de ia, finops de llm, costo por resolucion, tokens por conversacion, prorrateo de cache de prompt, costo no atribuido, reconciliacion de factura, asynclocalstorage, anthropic',
    },
    content: {
      pt: {
        title: 'Custo por conversa: atribuir a fatura de IA ao que gerou valor',
        excerpt:
          'A fatura do provedor chega como um número só: diz quanto você gastou e não diz em quê, qual cliente, qual jornada, qual etapa, qual resposta resolveu e qual só queimou tokens antes do transbordo. Sem atribuição, toda economia vira aposta, e a mais comum delas economiza na etapa que já era barata. Qual unidade de custo faz sentido em atendimento, como propagar o escopo pelo contexto assíncrono sem poluir assinatura nenhuma, onde encaixar o custo de eval e reindexação que não pertence a cliente algum, como tratar cache e retentativa sem inventar precisão e como fechar o mês reconciliando o contabilizado com o cobrado.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Cost per conversation: attributing the AI bill to what created value',
        excerpt:
          'The provider invoice arrives as a single number: it says how much you spent and not what on, which customer, which journey, which step, which answer resolved the case and which merely burned tokens before the handoff. Without attribution, every saving is a bet, and the most common one saves on the step that was already cheap. Which cost unit makes sense in support, how to propagate the scope through async context without polluting a single signature, where to fit the eval and reindexing cost that belongs to no customer, how to handle cache and retries without inventing precision and how to close the month reconciling the accounted against the charged.',
        category: 'Applied AI',
      },
      es: {
        title: 'Costo por conversación: atribuir la factura de IA a lo que generó valor',
        excerpt:
          'La factura del proveedor llega como un número solo: dice cuánto gastaste y no dice en qué, qué cliente, qué recorrido, qué etapa, qué respuesta resolvió y cuál solo quemó tokens antes del traspaso. Sin atribución, todo ahorro es una apuesta, y el más común ahorra en la etapa que ya era barata. Qué unidad de costo tiene sentido en atención, cómo propagar el ámbito por el contexto asíncrono sin ensuciar ninguna firma, dónde encajar el costo de eval y reindexación que no pertenece a ningún cliente, cómo tratar cache y reintentos sin inventar precisión y cómo cerrar el mes reconciliando lo contabilizado con lo cobrado.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'anonimizacao-dados-antes-de-mandar-para-llm',
    date: '2026-07-27',
    readTime: '14 min',
    keywords: {
      pt: 'anonimizacao de dados, pii em llm, redacao de dado pessoal, marcador reversivel, lgpd, minimizacao de contexto, validador de cpf, luhn, vazamento de dado, anthropic',
      en: 'data anonymization, pii in llm, personal data redaction, reversible placeholder, gdpr, context minimization, tax id validator, luhn, data leakage, anthropic',
      es: 'anonimizacion de datos, pii en llm, redaccion de dato personal, marcador reversible, rgpd, minimizacion de contexto, validador de documento, luhn, filtracion de dato, anthropic',
    },
    content: {
      pt: {
        title: 'Anonimização de dados antes de mandar para o LLM',
        excerpt:
          'O prompt que sai do seu servidor carrega mais do que a mensagem atual: histórico inteiro, retorno de tool, trecho de RAG, e tudo isso vai parar em log de erro, cache de prompt e amostra de monitoramento que ninguém projetou como cofre. Por que regex sozinha erra dos dois lados e o validador do tipo corrige, por que o marcador precisa ser tipado e estável dentro da requisição sem virar pseudônimo permanente, como reidratar a resposta sem virar oráculo, por que minimizar vem antes de anonimizar e o teste que falha quando o dado real aparece no payload.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Data anonymization before sending it to the LLM',
        excerpt:
          'The prompt that leaves your server carries more than the current message: the whole history, tool results, RAG passages, and all of it ends up in error logs, prompt caches and monitoring samples nobody designed as a vault. Why regex alone gets it wrong on both sides and the type validator fixes it, why the placeholder must be typed and stable within the request without becoming a permanent pseudonym, how to rehydrate the answer without becoming an oracle, why minimizing comes before anonymizing and the test that fails when the real value appears in the payload.',
        category: 'Applied AI',
      },
      es: {
        title: 'Anonimización de datos antes de mandarlos al LLM',
        excerpt:
          'El prompt que sale de tu servidor lleva más que el mensaje actual: historial completo, retorno de tool, fragmento de RAG, y todo eso termina en log de error, cache de prompt y muestra de monitoreo que nadie diseñó como caja fuerte. Por qué la regex sola se equivoca de los dos lados y el validador del tipo lo corrige, por qué el marcador debe ser tipado y estable dentro de la petición sin volverse seudónimo permanente, cómo rehidratar la respuesta sin volverse oráculo, por qué minimizar viene antes de anonimizar y el test que falla cuando el valor real aparece en el payload.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'migracao-modelo-sem-quebrar-prompt-producao',
    date: '2026-07-26',
    readTime: '14 min',
    keywords: {
      pt: 'migracao de modelo, trocar de llm, prompt em producao, trafego sombra, shadow traffic, gate de paridade, regressao de formato, tool call, rollback de modelo, anthropic',
      en: 'model migration, switching llm, prompt in production, shadow traffic, parity gate, format regression, tool call, model rollback, anthropic',
      es: 'migracion de modelo, cambiar de llm, prompt en produccion, trafico sombra, gate de paridad, regresion de formato, tool call, rollback de modelo, anthropic',
    },
    content: {
      pt: {
        title: 'Migração de modelo sem quebrar o prompt em produção',
        excerpt:
          'Trocar o modelo parece uma linha de configuração, mas o prompt em produção foi lapidado contra um modelo específico e carrega meses de suposições que nunca viraram instrução escrita. A troca testa todas de uma vez nas bordas: o JSON que agora vem embrulhado em markdown, a resposta que dobrou de tamanho, a tool call que virou texto. Como listar as suposições tácitas, rodar o candidato em tráfego sombra sem risco ao cliente, comparar por contrato antes de comparar por qualidade, adaptar o prompt com mudanças cirúrgicas e cortar por trás de um gate de paridade por caso de uso.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Model migration without breaking the prompt in production',
        excerpt:
          'Swapping the model looks like one configuration line, but the prompt in production was polished against one specific model and carries months of assumptions that never became written instructions. The swap tests all of them at once at the edges: the JSON that now comes wrapped in markdown, the answer that doubled in size, the tool call that became text. How to list the tacit assumptions, run the candidate on shadow traffic with no risk to the customer, compare by contract before comparing by quality, adapt the prompt with surgical changes and cut over behind a per-use-case parity gate.',
        category: 'Applied AI',
      },
      es: {
        title: 'Migración de modelo sin romper el prompt en producción',
        excerpt:
          'Cambiar el modelo parece una línea de configuración, pero el prompt en producción fue pulido contra un modelo específico y carga meses de suposiciones que nunca se volvieron instrucción escrita. El cambio las prueba todas de una vez en los bordes: el JSON que ahora viene envuelto en markdown, la respuesta que duplicó su tamaño, la tool call que se volvió texto. Cómo listar las suposiciones tácitas, correr el candidato en tráfico sombra sin riesgo para el cliente, comparar por contrato antes de comparar por calidad, adaptar el prompt con cambios quirúrgicos y cortar detrás de un gate de paridad por caso de uso.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'backpressure-pipeline-ia-consumidor-nao-acompanha',
    date: '2026-07-25',
    readTime: '13 min',
    keywords: {
      pt: 'backpressure, pipeline de ia, fila limitada, consumidor lento, descarte de carga, histerese, retry-after, prioridade de fila, sobrecarga, anthropic',
      en: 'backpressure, ai pipeline, bounded queue, slow consumer, load shedding, hysteresis, retry-after, queue priority, overload, anthropic',
      es: 'backpressure, pipeline de ia, cola limitada, consumidor lento, descarte de carga, histeresis, retry-after, prioridad de cola, sobrecarga, anthropic',
    },
    content: {
      pt: {
        title: 'Backpressure em pipeline de IA: quando o consumidor não acompanha',
        excerpt:
          'O webhook aceita mil mensagens por minuto porque aceitar é barato, e a etapa que chama o modelo processa cem. A fila ilimitada não absorve essa diferença, ela só escolhe um momento pior para falhar: quando a memória acabou e o trabalho já aceito se perde junto. Por que a fila sem teto é adiamento e não solução, como medir pressão com histerese para o sinal não oscilar, quais políticas de descarte existem e quando cada uma está certa, como propagar o sinal até a borda e o que medir para saber se o freio funciona ou só esconde.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Backpressure in an AI pipeline: when the consumer cannot keep up',
        excerpt:
          'The webhook accepts a thousand messages per minute because accepting is cheap, and the stage that calls the model processes a hundred. The unbounded queue does not absorb that gap, it only picks a worse moment to fail: when memory has run out and the already accepted work is lost with it. Why a ceiling-free queue is postponement and not a solution, how to measure pressure with hysteresis so the signal does not oscillate, which shedding policies exist and when each one is right, how to propagate the signal up to the edge and what to measure to know whether the brake works or merely hides.',
        category: 'Applied AI',
      },
      es: {
        title: 'Backpressure en un pipeline de IA: cuando el consumidor no da abasto',
        excerpt:
          'El webhook acepta mil mensajes por minuto porque aceptar es barato, y la etapa que llama al modelo procesa cien. La cola ilimitada no absorbe esa diferencia, solo elige un momento peor para fallar: cuando la memoria se acabó y el trabajo ya aceptado se pierde junto. Por qué la cola sin techo es aplazamiento y no solución, cómo medir presión con histéresis para que la señal no oscile, qué políticas de descarte existen y cuándo cada una es la correcta, cómo propagar la señal hasta el borde y qué medir para saber si el freno funciona o solo esconde.',
        category: 'IA Aplicada',
      },
    },
  },
  {
    slug: 'deduplicacao-contexto-rag-cortar-trecho-repetido',
    date: '2026-07-24',
    readTime: '13 min',
    keywords: {
      pt: 'deduplicacao de contexto, rag, trecho repetido, top-k, jaccard, shingles, minhash, sobreposicao de chunk, diversidade de contexto, densidade de informacao, anthropic',
      en: 'context deduplication, rag, repeated passage, top-k, jaccard, shingles, minhash, chunk overlap, context diversity, information density, anthropic',
      es: 'deduplicacion de contexto, rag, fragmento repetido, top-k, jaccard, shingles, minhash, solapamiento de chunk, diversidad de contexto, densidad de informacion, anthropic',
    },
    content: {
      pt: {
        title: 'Deduplicação de contexto em RAG: cortar o trecho repetido',
        excerpt:
          'Você aumenta o top-k para garantir que a resposta está lá, e a qualidade não sobe: dos oito trechos recuperados, cinco dizem a mesma coisa. Repetição não é só token desperdiçado, é viés, porque um fato copiado cinco vezes parece mais confirmado do que o correto que aparece uma. Os três níveis de duplicata, a cascata que detecta barato antes de caro, por que fundir vence descartar, o freio que protege a exceção que parece cópia e por que medir densidade em vez de economia.',
        category: 'IA Aplicada',
      },
      en: {
        title: 'Context deduplication in RAG: cutting the repeated passage',
        excerpt:
          'You raise the top-k to make sure the answer is in there, and quality does not go up: of the eight retrieved passages, five say the same thing. Repetition is not only wasted tokens, it is bias, because a fact copied five times looks more confirmed than the correct one that appears once. The three levels of duplicate, the cascade that detects cheap before expensive, why merging beats discarding, the brake that protects the exception that looks like a copy and why to measure density instead of savings.',
        category: 'Applied AI',
      },
      es: {
        title: 'Deduplicación de contexto en RAG: cortar el fragmento repetido',
        excerpt:
          'Subes el top-k para asegurar que la respuesta está ahí, y la calidad no sube: de los ocho fragmentos recuperados, cinco dicen lo mismo. La repetición no es solo token desperdiciado, es sesgo, porque un hecho copiado cinco veces parece más confirmado que el correcto que aparece una vez. Los tres niveles de duplicado, la cascada que detecta barato antes que caro, por qué fusionar vence a descartar, el freno que protege la excepción que parece copia y por qué medir densidad en vez de ahorro.',
        category: 'IA Aplicada',
      },
    },
  },
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
    'Orçamento de latência por etapa: onde cortar quando a resposta demora demais',
    'Rollback de base de conhecimento: voltar o índice sem derrubar o atendimento',
    'Testes de regressão para ferramentas do agente: contrato antes do prompt',
  ],
  en: [
    'Latency budget per stage: where to cut when the answer takes too long',
    'Knowledge base rollback: reverting the index without taking support down',
    'Regression tests for agent tools: contract before prompt',
  ],
  es: [
    'Presupuesto de latencia por etapa: dónde cortar cuando la respuesta tarda demasiado',
    'Rollback de base de conocimiento: volver el índice sin tirar la atención',
    'Pruebas de regresión para herramientas del agente: contrato antes del prompt',
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
