// Conteudo do artigo: orcamento de latencia por etapa, onde cortar quando a resposta demora demais.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A reclamação chega sempre no mesmo formato: "o bot está lento". O time olha o painel, vê o percentil noventa e cinco em nove segundos, e começa a otimizar o que for mais fácil de otimizar, que quase nunca é o que está consumindo o tempo. Duas semanas depois a latência caiu de nove para oito segundos e meio, e ninguém sabe explicar por que o esforço rendeu tão pouco. O problema não é falta de otimização, é falta de um orçamento: uma decomposição do tempo total em etapas com um teto declarado para cada uma, medida na mesma linha do tempo, de forma que a pergunta deixe de ser "como deixar tudo mais rápido" e passe a ser "qual etapa estourou o teto dela". Este artigo mostra como montar esse orçamento, por que a soma das etapas quase nunca fecha com o tempo total e o que esse buraco significa, como decidir entre cortar, paralelizar e adiar cada etapa, e por que a resposta certa muitas vezes é mudar a percepção do tempo em vez de reduzir o tempo.',
  sections: [
    {
      title: 'Um número agregado não é diagnosticável',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A latência de ponta a ponta de uma resposta de agente é uma soma de coisas muito diferentes: espera em fila, resolução de intenção, geração de embedding, busca vetorial, reranking, montagem de prompt, tempo até o primeiro token do modelo, geração completa, validação de saída, execução de ferramentas e envio pelo canal. Cada uma dessas etapas tem uma causa de lentidão distinta, uma técnica de correção distinta e um custo de correção distinto. Ver só a soma é como receber a fatura do cartão sem a lista de compras: você sabe que gastou demais e não sabe onde cortar.',
        },
        {
          type: 'paragraph',
          value:
            'O primeiro passo é declarar um orçamento antes de medir. Isso parece invertido, mas é deliberado: se você mede primeiro e só depois define os tetos, os tetos vão nascer ancorados no que o sistema já faz, e o orçamento vira uma descrição do presente em vez de um contrato. Declarar antes força a conversa certa, que é sobre quanto tempo cada etapa merece dado o valor que ela entrega, não sobre quanto tempo ela leva hoje.',
        },
        {
          type: 'table',
          columns: ['Etapa', 'Teto sugerido (p95)', 'Causa típica de estouro', 'Ação quando estoura'],
          rows: [
            [
              'Espera em fila',
              '50 ms',
              'Concorrência limitada por conexões ou trabalhadores',
              'Aumentar paralelismo ou aplicar prioridade por tipo de tráfego',
            ],
            [
              'Classificação de intenção',
              '150 ms',
              'Chamada a um segundo LLM para uma decisão binária',
              'Trocar por classificador leve ou por regra explícita',
            ],
            [
              'Embedding da consulta',
              '120 ms',
              'Modelo remoto sem pool de conexões',
              'Pool com keep-alive e cache de consultas repetidas',
            ],
            [
              'Busca vetorial',
              '200 ms',
              'topK alto demais ou índice frio',
              'Reduzir topK e aquecer o índice antes de receber tráfego',
            ],
            [
              'Reranking',
              '300 ms',
              'Reranquear vinte candidatos quando cinco bastam',
              'Cortar a lista de entrada antes do reranker',
            ],
            [
              'Tempo até o primeiro token',
              '900 ms',
              'Prompt gigante sem cache de prefixo',
              'Estabilizar o prefixo e ativar cache de prompt',
            ],
            [
              'Geração completa',
              '2500 ms',
              'Resposta longa demais para o canal',
              'Limitar tokens de saída e instruir concisão',
            ],
            [
              'Validação e guardrails',
              '150 ms',
              'Validação que chama outro modelo em série',
              'Validar por esquema e reservar o modelo para o caso duvidoso',
            ],
            [
              'Ferramentas externas',
              '800 ms',
              'Chamada a ERP ou CRM sem timeout próprio',
              'Timeout por ferramenta e resposta parcial quando estoura',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Os números da segunda coluna não são universais e não devem ser copiados: eles são um ponto de partida para um agente de atendimento em texto, com resposta esperada em torno de cinco segundos. Um agente de voz precisa de tetos radicalmente menores porque o silêncio é insuportável ao telefone; um agente que gera relatório assíncrono pode ter tetos dez vezes maiores. O que importa é que os tetos existam, sejam escritos em algum lugar versionado e sejam revisados quando o produto muda de expectativa.',
        },
      ],
    },
    {
      title: 'Medir por etapa na mesma linha do tempo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Medição por etapa costuma nascer errada de duas formas. A primeira é medir cada etapa com um cronômetro independente e somar depois, o que perde tudo que acontece entre as etapas: espera de agendamento, serialização, coleta de lixo, contenção de pool. A segunda é medir só as etapas que alguém lembrou de instrumentar, o que faz o tempo restante virar um resíduo invisível. As duas produzem o mesmo sintoma: a soma das etapas dá seis segundos e o cliente esperou nove.',
        },
        {
          type: 'paragraph',
          value:
            'A correção é tratar o buraco como um dado de primeira classe. Meça o total de ponta a ponta com um único relógio, meça cada etapa dentro desse mesmo intervalo, e reporte explicitamente a diferença como uma etapa chamada "não contabilizado". Quando essa etapa passa de dez por cento do total, ela deixa de ser ruído de medição e vira o maior item do orçamento, o que muda completamente onde o time deve olhar.',
        },
        {
          type: 'code',
          value: `// telemetry/latency-budget.js
// Orcamento de latencia por etapa medido em uma unica linha do tempo.
// A diferenca entre o total e a soma das etapas e reportada como
// "unaccounted": e o item que mais revela problema de infraestrutura.

const BUDGET_MS = {
  queue_wait: 50,
  intent: 150,
  embed: 120,
  vector_search: 200,
  rerank: 300,
  llm_first_token: 900,
  llm_generation: 2500,
  validation: 150,
  tools: 800,
};

const TOTAL_BUDGET_MS = Object.values(BUDGET_MS).reduce((a, b) => a + b, 0);

export function createBudgetTracker({ metrics, logger, now = () => Date.now() }) {
  function start({ requestId, channel }) {
    const startedAt = now();
    const stages = [];

    async function stage(name, fn) {
      const from = now();
      try {
        return await fn();
      } finally {
        const durationMs = now() - from;
        stages.push({ name, durationMs });
        // Rotular com o teto permite alertar por etapa, nao pelo agregado:
        // uma etapa em 3x o teto some dentro de um p95 de servico saudavel.
        metrics.histogram('agent.stage.duration_ms', durationMs, {
          stage: name,
          channel,
          over_budget: durationMs > (BUDGET_MS[name] ?? Infinity) ? 'yes' : 'no',
        });
      }
    }

    function finish() {
      const totalMs = now() - startedAt;
      const measuredMs = stages.reduce((acc, s) => acc + s.durationMs, 0);
      // Positivo por construcao: espera de agendamento, serializacao,
      // coleta de lixo e contencao de pool vivem exatamente aqui.
      const unaccountedMs = Math.max(0, totalMs - measuredMs);

      metrics.histogram('agent.total.duration_ms', totalMs, { channel });
      metrics.histogram('agent.stage.duration_ms', unaccountedMs, {
        stage: 'unaccounted',
        channel,
        over_budget: unaccountedMs > totalMs * 0.1 ? 'yes' : 'no',
      });

      // So loga o detalhe quando estourou: log de caso feliz em volume
      // alto custa mais que a etapa que se quer observar.
      if (totalMs > TOTAL_BUDGET_MS) {
        const worst = [...stages].sort((a, b) => {
          const overA = a.durationMs - (BUDGET_MS[a.name] ?? 0);
          const overB = b.durationMs - (BUDGET_MS[b.name] ?? 0);
          return overB - overA;
        })[0];
        logger.warn('agent.budget.exceeded', {
          requestId,
          totalMs,
          budgetMs: TOTAL_BUDGET_MS,
          unaccountedMs,
          worstStage: worst?.name,
          worstOverMs: worst ? worst.durationMs - (BUDGET_MS[worst.name] ?? 0) : 0,
        });
      }

      return { totalMs, measuredMs, unaccountedMs, stages };
    }

    return { stage, finish };
  }

  return { start, BUDGET_MS, TOTAL_BUDGET_MS };
}`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que faz esse código valer é o rótulo de estouro por etapa. Sem ele, você tem nove histogramas e precisa olhar os nove para saber se algo saiu do lugar. Com ele, um único alerta sobre a proporção de requisições com alguma etapa fora do teto já responde a pergunta operacional, e o painel por etapa serve para o diagnóstico depois que o alerta disparou. É a diferença entre um painel que você consulta quando lembra e um que te chama.',
        },
        {
          type: 'paragraph',
          value:
            'Uma armadilha frequente aqui é medir o tempo da etapa incluindo o tempo em que ela esteve esperando um recurso compartilhado. Se a busca vetorial demora quatrocentos milissegundos, sendo trezentos esperando uma conexão livre no pool, atribuir isso à busca leva o time a otimizar o índice quando o problema é dimensionamento do pool. Vale separar o tempo de aquisição do recurso do tempo de trabalho efetivo sempre que a etapa depende de um pool, e essa separação costuma explicar sozinha metade dos estouros.',
        },
      ],
    },
    {
      title: 'Cortar, paralelizar ou adiar: três respostas diferentes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com o orçamento medido, cada etapa fora do teto admite três tratamentos, e escolher o errado é como o time desperdiça semanas. Cortar significa fazer menos trabalho: reduzir topK, encurtar a saída, remover uma chamada. Paralelizar significa fazer o mesmo trabalho ao mesmo tempo que outro. Adiar significa tirar a etapa do caminho crítico e executá-la depois que a resposta já saiu. Cortar reduz custo, paralelizar aumenta pressão sobre recursos e adiar muda a semântica do sistema.',
        },
        {
          type: 'paragraph',
          value:
            'A regra prática é procurar oportunidade de paralelismo antes de cortar qualidade, porque cortar sempre tem preço de resposta pior e paralelizar muitas vezes é de graça. Num agente típico há dois paralelismos evidentes que quase ninguém explora: gerar o embedding da consulta ao mesmo tempo que se busca o histórico da conversa, e disparar as ferramentas independentes juntas em vez de em cadeia. Nenhum dos dois muda uma vírgula da resposta.',
        },
        {
          type: 'diagram',
          value: `Caminho critico de uma resposta de agente

  SEQUENCIAL (soma: 4.62 s)
  |-- fila 0.05
      |-- intencao 0.15
          |-- historico 0.18
              |-- embedding 0.12
                  |-- busca 0.20
                      |-- rerank 0.30
                          |-- ferramenta A 0.80
                              |-- ferramenta B 0.62
                                  |-- primeiro token 0.90
                                      |-- geracao 1.30

  PARALELIZADO (caminho critico: 3.20 s)
  |-- fila 0.05
      |-- intencao 0.15
          |-- [ historico 0.18 | embedding 0.12 ]      -> 0.18
              |-- busca 0.20
                  |-- rerank 0.30
                      |-- [ ferramenta A 0.80 | ferramenta B 0.62 ] -> 0.80
                          |-- primeiro token 0.90
                              |-- geracao 1.30

  Ganho: 1.42 s sem cortar nenhuma etapa e sem piorar a resposta.
  O que sobrou no caminho critico: geracao (1.30) e primeiro token (0.90),
  que juntos sao 69% do total. E ali que mora a proxima decisao dificil.`,
        },
        {
          type: 'paragraph',
          value:
            'O diagrama mostra algo que se repete em quase todo sistema: depois de paralelizar o óbvio, o caminho crítico fica dominado pelo modelo. Isso é importante porque muda a natureza do trabalho restante. As etapas de recuperação respondem a engenharia clássica, com cache, índice e pool. O tempo do modelo responde a três coisas apenas: tamanho do prompt, tamanho da saída e escolha do modelo. Se o time continua otimizando busca vetorial depois de chegar nesse ponto, está otimizando doze por cento do problema.',
        },
        {
          type: 'table',
          columns: ['Tratamento', 'O que muda', 'Ganho típico', 'O que você paga'],
          rows: [
            [
              'Paralelizar etapas independentes',
              'Ordem de execução, não o trabalho feito',
              '20% a 35% do total',
              'Mais conexões simultâneas e código mais difícil de depurar',
            ],
            [
              'Reduzir topK e candidatos do reranker',
              'Volume de dados processado',
              '150 a 400 ms',
              'Risco de perder o documento certo em consultas raras',
            ],
            [
              'Cache de prefixo do prompt',
              'Quanto o modelo reprocessa a cada chamada',
              '30% a 60% do tempo até o primeiro token',
              'Disciplina de ordenação do prompt para sempre',
            ],
            [
              'Limitar tokens de saída',
              'Tamanho da resposta gerada',
              'Proporcional e imediato',
              'Respostas truncadas se o limite for mal calibrado',
            ],
            [
              'Modelo menor para tarefas simples',
              'Qual modelo atende cada rota',
              '40% a 70% nas rotas roteadas',
              'Um classificador a mais para manter e avaliar',
            ],
            [
              'Adiar etapa para depois da resposta',
              'Semântica: deixa de ser síncrona',
              'Remove a etapa inteira do caminho',
              'Precisa de compensação quando a etapa adiada falha',
            ],
            [
              'Streaming da resposta',
              'Percepção, não o tempo total',
              'Tempo percebido cai para o primeiro token',
              'Não pode streamar o que ainda vai ser validado',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha merece atenção porque é a que mais confunde. Streaming não corta um milissegundo do tempo total: a resposta completa chega no mesmo instante que chegaria antes. O que muda é que o usuário para de olhar para um indicador de digitação em novecentos milissegundos em vez de em quatro segundos, e a percepção de lentidão desaparece mesmo com o número no painel intacto. Para um canal de texto isso frequentemente resolve o problema real, que era a reclamação, não o número.',
        },
      ],
    },
    {
      title: 'O que adiar e como não quebrar nada ao adiar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Adiar é o tratamento mais poderoso e o mais perigoso, porque muda o contrato do sistema em vez de otimizá-lo. Uma etapa adiada é uma etapa que pode falhar depois que o cliente já recebeu a resposta, e o sistema precisa saber o que fazer nesse caso. A pergunta que separa o adiável do não adiável é direta: se essa etapa falhar depois da resposta já entregue, dá para compensar sem contradizer o que foi dito ao cliente?',
        },
        {
          type: 'ordered',
          items: [
            'Registro em trilha de auditoria: adiável sem ressalva, porque nada na resposta depende de o registro já existir.',
            'Atualização de memória de longo prazo do cliente: adiável, já que ela só afeta a conversa seguinte e não a atual.',
            'Sincronização com o CRM: adiável com fila durável, porque o dado precisa chegar mas não precisa chegar antes da resposta.',
            'Cálculo de custo e métricas de qualidade: adiável e frequentemente melhor adiado, dado que roda em lote com mais contexto.',
            'Validação de política de conteúdo: não adiável, pois adiar significa entregar primeiro e descobrir o problema depois.',
            'Consulta de saldo ou estoque citada na resposta: não adiável, uma vez que a resposta afirma um fato que precisa ser verdadeiro no momento em que é dito.',
            'Confirmação de ação com efeito externo: não adiável, porque dizer que foi feito antes de fazer é a única falha que o cliente nunca perdoa.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Os três últimos itens definem a fronteira. Tudo que a resposta afirma como fato precisa ter sido verificado antes de a resposta sair. Tudo que é consequência da resposta pode acontecer depois, desde que aconteça de verdade, o que na prática significa fila durável com repetição e alerta quando a fila cresce. Adiar para uma chamada disparada e esquecida no mesmo processo não é adiar, é perder silenciosamente sob carga, e o momento em que isso acontece é justamente o pico em que a perda dói mais.',
        },
        {
          type: 'code',
          value: `// pipeline/deferred.js
// Adia o que nao pertence ao caminho critico, com fila duravel.
// Regra: se a resposta afirma o fato, ele e verificado antes;
// se o fato e consequencia da resposta, ele pode ser adiado.

const CRITICAL = new Set(['policy_check', 'balance_lookup', 'action_confirm']);

export function createPipeline({ queue, metrics, logger }) {
  async function respond({ requestId, steps, deferred }) {
    // Etapas criticas: erro aqui interrompe e vira resposta de falha,
    // porque entregar uma afirmacao nao verificada e pior que nao responder.
    for (const step of steps) {
      if (!CRITICAL.has(step.name)) continue;
      await step.run();
    }

    const answer = await steps.find((s) => s.name === 'generate').run();

    // Etapas adiadas nunca usam disparo e esquecimento: vao para fila
    // duravel, porque perder isso sob carga e um bug silencioso.
    for (const task of deferred) {
      await queue.enqueue(task.name, {
        requestId,
        payload: task.payload,
        // Compensacao declarada junto com a tarefa: quem adia assume
        // a responsabilidade de dizer o que fazer quando ela falhar.
        onExhausted: task.onExhausted ?? 'alert_only',
        maxAttempts: task.maxAttempts ?? 5,
      });
      metrics.counter('agent.deferred.enqueued_total', 1, { task: task.name });
    }

    return answer;
  }

  // A fila adiada precisa de um observador proprio: crescimento sustentado
  // significa que o trabalho foi tirado do caminho critico e nunca feito.
  function watchBacklog({ thresholdAge, intervalMs = 60000 }) {
    const timer = setInterval(async () => {
      const oldestAgeMs = await queue.oldestPendingAgeMs();
      metrics.gauge('agent.deferred.oldest_age_ms', oldestAgeMs);
      if (oldestAgeMs > thresholdAge) {
        logger.error('agent.deferred.stale', { oldestAgeMs, thresholdAge });
      }
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { respond, watchBacklog };
}`,
        },
        {
          type: 'paragraph',
          value:
            'A função de observação da fila é a parte que costuma ficar de fora e é a que dá sentido à decisão de adiar. Quando você tira uma etapa do caminho crítico, ela some do painel de latência e passa a viver num lugar onde ninguém olha. A métrica de idade do item pendente mais antigo é o que impede que "adiado" vire "nunca feito", e ela precisa de alerta próprio, porque nenhum painel de latência vai avisar que a sincronização com o CRM está trinta e seis horas atrasada.',
        },
      ],
    },
    {
      title: 'Orçamento por rota, não um número para o sistema inteiro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um orçamento único para todo o sistema falha pelo mesmo motivo que um percentil único falha: ele mistura populações com expectativas diferentes. "Qual o horário de funcionamento" e "quanto eu devo, com detalhamento por nota fiscal" não deveriam ter o mesmo teto, e forçar o mesmo teto leva a duas decisões ruins ao mesmo tempo: a rota simples fica mais lenta que precisaria porque o teto é generoso, e a rota complexa vive estourando um teto que nunca foi realista para ela.',
        },
        {
          type: 'table',
          columns: ['Classe de rota', 'Teto total (p95)', 'Etapas no caminho', 'Estratégia dominante'],
          rows: [
            [
              'Resposta de catálogo fixo',
              '600 ms',
              'Fila, intenção, template',
              'Cache de resposta com chave por intenção',
            ],
            [
              'Pergunta respondida por RAG',
              '3500 ms',
              'Recuperação completa e geração',
              'Streaming e cache de prefixo',
            ],
            [
              'Consulta a sistema externo',
              '4500 ms',
              'RAG mais uma ou duas ferramentas',
              'Paralelizar ferramentas e definir timeout por ferramenta',
            ],
            [
              'Ação transacional',
              '6000 ms',
              'Tudo acima mais confirmação e escrita',
              'Confirmação parcial em duas mensagens',
            ],
            [
              'Escalada para humano',
              '900 ms',
              'Intenção e roteamento',
              'Nunca passar pelo modelo de geração',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha é a mais valiosa e a mais esquecida. Quando o cliente escreve "quero falar com um atendente", a única coisa certa a fazer é rotear, e o pior resultado possível é gastar três segundos gerando um texto elaborado explicando que vai transferir. Um caminho curto para essa intenção, sem passar pelo modelo de geração, transforma o pior momento da conversa em uma resposta quase instantânea, e é um dos poucos ajustes que melhoram latência e satisfação ao mesmo tempo sem nenhum contrapeso.',
        },
        {
          type: 'paragraph',
          value:
            'Com orçamento por rota, o alerta operacional muda de forma. Em vez de "o p95 do serviço passou de cinco segundos", ele vira "a rota de consulta externa está com trinta por cento das requisições fora do teto dela", o que já vem com o diagnóstico embutido e aponta o time direto para as duas ou três etapas daquela rota específica. É a diferença entre um alerta que inicia uma investigação e um alerta que inicia uma correção.',
        },
      ],
    },
    {
      title: 'A sequência que costuma render mais',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nem toda técnica acima vale o mesmo esforço no mesmo momento. A ordem abaixo é a que costuma dar mais resultado por semana de trabalho em agentes de atendimento de porte médio, e cada passo depende do anterior porque sem medição por etapa você não sabe se o passo seguinte melhorou alguma coisa ou se você trocou um gargalo por outro.',
        },
        {
          type: 'ordered',
          items: [
            'Declare os tetos por etapa e por classe de rota antes de medir, para que o orçamento seja um contrato e não uma descrição do presente.',
            'Instrumente na mesma linha do tempo, com a etapa "não contabilizado" explícita, e trate um resíduo acima de dez por cento como o item mais urgente do orçamento.',
            'Paralelize o que é independente antes de cortar qualquer coisa, já que esse é o único ganho que não tem contrapartida na resposta.',
            'Ligue streaming nos canais que suportam, porque ele resolve a reclamação mesmo sem mexer no número total.',
            'Estabilize o prefixo do prompt e ative cache, que é o maior ganho isolado no tempo até o primeiro token.',
            'Adie o que é consequência da resposta, sempre com fila durável e alerta sobre a idade do item pendente mais antigo.',
            'Só então corte qualidade, com topK menor e saída mais curta, medindo o efeito no eval antes de considerar o corte concluído.',
            'Crie um caminho curto para escalada humana que nunca toque o modelo de geração.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O item que mais gera resistência é o sétimo, e com razão. Cortar topK ou limitar a saída é a otimização mais fácil de implementar e a única da lista que pode piorar a resposta sem que ninguém perceba na semana seguinte. Por isso ela vem por último e por isso precisa passar pelo conjunto de avaliação antes de ser considerada pronta: um ganho de duzentos milissegundos que custa três pontos de acerto não é uma otimização, é uma troca que alguém precisa aprovar conscientemente.',
        },
        {
          type: 'paragraph',
          value:
            'Vale terminar com o desconforto que esse trabalho quase sempre revela. Depois de paralelizar, ligar streaming e cachear o prefixo, o orçamento fica dominado pela geração do modelo, e ali as opções são poucas e todas envolvem escolha de produto: resposta mais curta, modelo menor ou aceitar o tempo. Chegar nesse ponto não é fracasso do trabalho de latência, é o resultado dele. O orçamento serviu justamente para transformar uma reclamação vaga sobre lentidão numa decisão específica sobre quanto texto o cliente precisa receber e com qual modelo, que é uma decisão que o time consegue tomar.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que a soma das minhas etapas não fecha com o tempo total medido?',
      answer:
        'Porque o tempo que não está em nenhuma etapa é real e normalmente é o mais informativo. Entre o fim de uma etapa e o começo da próxima cabem espera de agendamento do laço de eventos, serialização e desserialização de payload, pausas de coleta de lixo, contenção de pool de conexões e o tempo de rede que fica fora dos seus cronômetros. Se você mede cada etapa com um cronômetro separado e soma no fim, todo esse tempo desaparece e o painel mostra seis segundos enquanto o cliente esperou nove. A correção é medir o total de ponta a ponta com um único relógio, medir as etapas dentro desse mesmo intervalo e reportar a diferença como uma etapa explícita chamada não contabilizado. Quando esse resíduo passa de dez por cento do total, ele deixa de ser imprecisão de medição e vira o maior item do orçamento, apontando para dimensionamento de pool, saturação de CPU ou pressão de memória em vez de para qualquer componente de IA.',
    },
    {
      question: 'Streaming resolve latência ou é só maquiagem?',
      answer:
        'Ele não muda o tempo total em nada e resolve o problema real na maioria dos canais de texto, e as duas coisas são verdadeiras ao mesmo tempo. A resposta completa chega no mesmo instante em que chegaria sem streaming, então nenhum número do painel melhora. O que muda é que o cliente para de encarar um indicador de digitação em novecentos milissegundos em vez de em quatro segundos, e a reclamação que originou o trabalho era sobre isso, não sobre o número. Vale ser honesto sobre os limites: você não pode streamar conteúdo que ainda vai passar por validação de política, porque isso significaria mostrar e depois retirar, e em canais que não suportam entrega incremental o ganho é zero. Ainda assim, quando o canal permite, é a intervenção com melhor relação entre esforço e percepção de qualidade da lista inteira, e faz sentido tentá-la antes de cortar qualquer coisa que afete a resposta.',
    },
    {
      question: 'Quais etapas posso tirar do caminho crítico sem risco?',
      answer:
        'O critério é se a resposta afirma o fato ou se o fato é consequência da resposta. Tudo que a resposta afirma como verdadeiro precisa estar verificado antes de sair: saldo citado, estoque prometido, política aplicada, ação confirmada. Tudo que decorre da resposta pode acontecer depois: registro em trilha de auditoria, atualização da memória de longo prazo, sincronização com o CRM, cálculo de custo e métricas de qualidade. A ressalva importante é que adiar significa fila durável com repetição e compensação declarada, não uma promessa disparada e esquecida no mesmo processo, que sob carga vira perda silenciosa exatamente no pico em que ela mais dói. E como etapa adiada some do painel de latência, ela precisa de um observador próprio: a métrica de idade do item pendente mais antigo é o que impede que adiado vire nunca feito.',
    },
  ],
  conclusion: {
    title: 'Latência se resolve por orçamento, não por esforço difuso',
    description:
      'Um número agregado de latência não é diagnosticável: ele mistura nove etapas com causas, correções e custos diferentes, e leva o time a otimizar o que é fácil em vez do que pesa. Declarar tetos por etapa e por classe de rota antes de medir, instrumentar tudo na mesma linha do tempo com o resíduo não contabilizado explícito, paralelizar o que é independente antes de cortar qualquer coisa, ligar streaming onde o canal permite e adiar apenas o que é consequência da resposta, sempre com fila durável, é a sequência que transforma uma reclamação vaga em uma lista curta de decisões concretas. Ao final desse caminho o orçamento fica dominado pela geração do modelo, e é exatamente aí que a conversa deixa de ser técnica e vira produto: quanto texto o cliente precisa receber e com qual modelo. Posso instrumentar o orçamento de latência do seu agente, separar caminho crítico de trabalho adiável e apontar onde o corte compensa com dado medido em vez de palpite.',
    cta: 'Falar sobre a latência do meu agente',
  },
  related: [
    { label: 'Streaming de resposta de LLM sem quebrar a UX', to: '/blog/streaming-resposta-llm-sem-quebrar-ux' },
    { label: 'Aquecimento de índice vetorial e a primeira consulta lenta', to: '/blog/aquecimento-indice-vetorial-primeira-consulta-do-dia-lenta' },
    { label: 'Observabilidade e confiabilidade', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const en = {
  intro:
    'The complaint always arrives in the same shape: "the bot is slow". The team looks at the dashboard, sees the ninety-fifth percentile at nine seconds, and starts optimizing whatever is easiest to optimize, which is almost never what is consuming the time. Two weeks later latency dropped from nine seconds to eight and a half, and nobody can explain why the effort paid so little. The problem is not a lack of optimization, it is the lack of a budget: a decomposition of total time into stages with a declared ceiling for each one, measured on the same clock, so the question stops being "how do we make everything faster" and becomes "which stage blew its ceiling". This article shows how to build that budget, why the sum of the stages almost never matches the total and what that gap means, how to decide between cutting, parallelizing and deferring each stage, and why the right answer is often to change the perception of time rather than reduce the time.',
  sections: [
    {
      title: 'An aggregate number is not diagnosable',
      blocks: [
        {
          type: 'paragraph',
          value:
            'End-to-end latency of an agent answer is a sum of very different things: queue wait, intent resolution, embedding generation, vector search, reranking, prompt assembly, time to first token, full generation, output validation, tool execution and channel delivery. Each of those stages has a distinct cause of slowness, a distinct fix and a distinct cost to fix. Seeing only the sum is like getting a credit card bill with no line items: you know you overspent and you have no idea where to cut.',
        },
        {
          type: 'paragraph',
          value:
            'The first step is to declare a budget before measuring. That sounds backwards, but it is deliberate: if you measure first and set the ceilings afterwards, the ceilings will be anchored to what the system already does, and the budget becomes a description of the present instead of a contract. Declaring first forces the right conversation, which is about how much time each stage deserves given the value it delivers, not about how long it takes today.',
        },
        {
          type: 'table',
          columns: ['Stage', 'Suggested ceiling (p95)', 'Typical cause of overrun', 'Action when it overruns'],
          rows: [
            [
              'Queue wait',
              '50 ms',
              'Concurrency limited by connections or workers',
              'Raise parallelism or apply priority by traffic type',
            ],
            [
              'Intent classification',
              '150 ms',
              'Calling a second LLM for a binary decision',
              'Swap for a lightweight classifier or an explicit rule',
            ],
            [
              'Query embedding',
              '120 ms',
              'Remote model with no connection pool',
              'Pool with keep-alive and cache for repeated queries',
            ],
            [
              'Vector search',
              '200 ms',
              'topK too high or a cold index',
              'Lower topK and warm the index before taking traffic',
            ],
            [
              'Reranking',
              '300 ms',
              'Reranking twenty candidates when five would do',
              'Trim the input list before the reranker',
            ],
            [
              'Time to first token',
              '900 ms',
              'Huge prompt with no prefix cache',
              'Stabilize the prefix and enable prompt caching',
            ],
            [
              'Full generation',
              '2500 ms',
              'Answer far too long for the channel',
              'Cap output tokens and instruct for concision',
            ],
            [
              'Validation and guardrails',
              '150 ms',
              'Validation that calls another model in series',
              'Validate by schema and reserve the model for doubtful cases',
            ],
            [
              'External tools',
              '800 ms',
              'ERP or CRM call with no timeout of its own',
              'Per-tool timeout and partial answer when it expires',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The numbers in the second column are not universal and should not be copied: they are a starting point for a text support agent with an expected answer around five seconds. A voice agent needs radically smaller ceilings because silence is unbearable on a phone call; an agent producing an asynchronous report can have ceilings ten times larger. What matters is that ceilings exist, are written somewhere versioned and get revisited when the product changes expectations.',
        },
      ],
    },
    {
      title: 'Measuring per stage on the same clock',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Per-stage measurement usually gets built wrong in two ways. The first is timing each stage with an independent stopwatch and summing afterwards, which loses everything that happens between stages: scheduling wait, serialization, garbage collection, pool contention. The second is instrumenting only the stages someone remembered, which turns the remaining time into an invisible residue. Both produce the same symptom: the stages add up to six seconds and the customer waited nine.',
        },
        {
          type: 'paragraph',
          value:
            'The fix is to treat the gap as a first-class datum. Measure the end-to-end total with a single clock, measure each stage inside that same interval, and report the difference explicitly as a stage named "unaccounted". When that stage exceeds ten percent of the total, it stops being measurement noise and becomes the largest item in the budget, which completely changes where the team should look.',
        },
        {
          type: 'code',
          value: `// telemetry/latency-budget.js
// Per-stage latency budget measured on a single timeline.
// The difference between total and the sum of stages is reported as
// "unaccounted": it is the item that most often reveals infra problems.

const BUDGET_MS = {
  queue_wait: 50,
  intent: 150,
  embed: 120,
  vector_search: 200,
  rerank: 300,
  llm_first_token: 900,
  llm_generation: 2500,
  validation: 150,
  tools: 800,
};

const TOTAL_BUDGET_MS = Object.values(BUDGET_MS).reduce((a, b) => a + b, 0);

export function createBudgetTracker({ metrics, logger, now = () => Date.now() }) {
  function start({ requestId, channel }) {
    const startedAt = now();
    const stages = [];

    async function stage(name, fn) {
      const from = now();
      try {
        return await fn();
      } finally {
        const durationMs = now() - from;
        stages.push({ name, durationMs });
        // Labeling with the ceiling allows alerting per stage, not on the
        // aggregate: a stage at 3x its ceiling hides inside a healthy p95.
        metrics.histogram('agent.stage.duration_ms', durationMs, {
          stage: name,
          channel,
          over_budget: durationMs > (BUDGET_MS[name] ?? Infinity) ? 'yes' : 'no',
        });
      }
    }

    function finish() {
      const totalMs = now() - startedAt;
      const measuredMs = stages.reduce((acc, s) => acc + s.durationMs, 0);
      // Positive by construction: scheduling wait, serialization,
      // garbage collection and pool contention all live exactly here.
      const unaccountedMs = Math.max(0, totalMs - measuredMs);

      metrics.histogram('agent.total.duration_ms', totalMs, { channel });
      metrics.histogram('agent.stage.duration_ms', unaccountedMs, {
        stage: 'unaccounted',
        channel,
        over_budget: unaccountedMs > totalMs * 0.1 ? 'yes' : 'no',
      });

      // Only log the detail when it overran: happy-path logs at high
      // volume cost more than the stage you are trying to observe.
      if (totalMs > TOTAL_BUDGET_MS) {
        const worst = [...stages].sort((a, b) => {
          const overA = a.durationMs - (BUDGET_MS[a.name] ?? 0);
          const overB = b.durationMs - (BUDGET_MS[b.name] ?? 0);
          return overB - overA;
        })[0];
        logger.warn('agent.budget.exceeded', {
          requestId,
          totalMs,
          budgetMs: TOTAL_BUDGET_MS,
          unaccountedMs,
          worstStage: worst?.name,
          worstOverMs: worst ? worst.durationMs - (BUDGET_MS[worst.name] ?? 0) : 0,
        });
      }

      return { totalMs, measuredMs, unaccountedMs, stages };
    }

    return { stage, finish };
  }

  return { start, BUDGET_MS, TOTAL_BUDGET_MS };
}`,
        },
        {
          type: 'paragraph',
          value:
            'The detail that makes this code worth writing is the per-stage overrun label. Without it you have nine histograms and must check all nine to know whether something moved. With it, a single alert on the share of requests with any stage outside its ceiling answers the operational question, and the per-stage dashboard serves diagnosis after the alert fires. That is the difference between a dashboard you check when you remember and one that calls you.',
        },
        {
          type: 'paragraph',
          value:
            'A frequent trap here is timing a stage including the time it spent waiting for a shared resource. If vector search takes four hundred milliseconds, three hundred of which waiting for a free connection in the pool, attributing that to search sends the team optimizing the index when the problem is pool sizing. It pays to separate resource acquisition time from actual work time whenever a stage depends on a pool, and that separation alone usually explains half the overruns.',
        },
      ],
    },
    {
      title: 'Cut, parallelize or defer: three different answers',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the budget measured, each stage over its ceiling admits three treatments, and picking the wrong one is how teams waste weeks. Cutting means doing less work: lower topK, shorter output, remove a call. Parallelizing means doing the same work at the same time as something else. Deferring means taking the stage off the critical path and running it after the answer has already gone out. Cutting reduces cost, parallelizing increases pressure on resources and deferring changes the semantics of the system.',
        },
        {
          type: 'paragraph',
          value:
            'The practical rule is to look for parallelism opportunities before cutting quality, because cutting always has the price of a worse answer and parallelizing is often free. In a typical agent there are two obvious parallelisms almost nobody exploits: generating the query embedding at the same time as fetching conversation history, and firing independent tools together instead of in a chain. Neither changes a single word of the answer.',
        },
        {
          type: 'diagram',
          value: `Critical path of an agent answer

  SEQUENTIAL (sum: 4.62 s)
  |-- queue 0.05
      |-- intent 0.15
          |-- history 0.18
              |-- embedding 0.12
                  |-- search 0.20
                      |-- rerank 0.30
                          |-- tool A 0.80
                              |-- tool B 0.62
                                  |-- first token 0.90
                                      |-- generation 1.30

  PARALLELIZED (critical path: 3.20 s)
  |-- queue 0.05
      |-- intent 0.15
          |-- [ history 0.18 | embedding 0.12 ]        -> 0.18
              |-- search 0.20
                  |-- rerank 0.30
                      |-- [ tool A 0.80 | tool B 0.62 ]  -> 0.80
                          |-- first token 0.90
                              |-- generation 1.30

  Gain: 1.42 s with no stage cut and no worse answer.
  What remains on the critical path: generation (1.30) and first token (0.90),
  together 69% of the total. That is where the next hard decision lives.`,
        },
        {
          type: 'paragraph',
          value:
            'The diagram shows something that repeats in almost every system: after parallelizing the obvious, the critical path becomes dominated by the model. That matters because it changes the nature of the remaining work. Retrieval stages respond to classic engineering, with caches, indexes and pools. Model time responds to three things only: prompt size, output size and model choice. If the team keeps optimizing vector search after reaching this point, it is optimizing twelve percent of the problem.',
        },
        {
          type: 'table',
          columns: ['Treatment', 'What changes', 'Typical gain', 'What you pay'],
          rows: [
            [
              'Parallelize independent stages',
              'Execution order, not the work done',
              '20% to 35% of the total',
              'More concurrent connections and harder debugging',
            ],
            [
              'Lower topK and reranker candidates',
              'Volume of data processed',
              '150 to 400 ms',
              'Risk of missing the right document on rare queries',
            ],
            [
              'Prompt prefix caching',
              'How much the model reprocesses per call',
              '30% to 60% of time to first token',
              'Prompt ordering discipline forever',
            ],
            [
              'Cap output tokens',
              'Size of the generated answer',
              'Proportional and immediate',
              'Truncated answers if the cap is badly calibrated',
            ],
            [
              'Smaller model for simple tasks',
              'Which model serves each route',
              '40% to 70% on routed paths',
              'One more classifier to maintain and evaluate',
            ],
            [
              'Defer a stage past the answer',
              'Semantics: it stops being synchronous',
              'Removes the whole stage from the path',
              'Needs compensation when the deferred stage fails',
            ],
            [
              'Streaming the answer',
              'Perception, not total time',
              'Perceived time drops to the first token',
              'You cannot stream what still has to be validated',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row deserves attention because it confuses people the most. Streaming does not cut a single millisecond off total time: the complete answer arrives at exactly the same instant it would have before. What changes is that the user stops staring at a typing indicator after nine hundred milliseconds instead of four seconds, and the perception of slowness disappears even with the dashboard number untouched. For a text channel that frequently solves the real problem, which was the complaint, not the number.',
        },
      ],
    },
    {
      title: 'What to defer and how not to break anything by deferring',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Deferring is the most powerful treatment and the most dangerous, because it changes the contract of the system rather than optimizing it. A deferred stage is a stage that can fail after the customer already got the answer, and the system needs to know what to do in that case. The question that separates deferrable from non-deferrable is direct: if this stage fails after the answer is already delivered, can it be compensated without contradicting what was told to the customer?',
        },
        {
          type: 'ordered',
          items: [
            'Writing to the audit trail: deferrable without reservation, since nothing in the answer depends on the record already existing.',
            'Updating the customer long-term memory: deferrable, given it only affects the next conversation and not the current one.',
            'Syncing with the CRM: deferrable with a durable queue, because the data must arrive but does not have to arrive before the answer.',
            'Cost accounting and quality metrics: deferrable and often better deferred, since they run in batch with more context.',
            'Content policy validation: not deferrable, because deferring means delivering first and discovering the problem afterwards.',
            'Balance or stock lookup quoted in the answer: not deferrable, since the answer asserts a fact that must be true at the moment it is said.',
            'Confirming an action with external effect: not deferrable, because saying it was done before doing it is the one failure a customer never forgives.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last three items define the boundary. Everything the answer asserts as fact must be verified before the answer goes out. Everything that is a consequence of the answer can happen afterwards, as long as it actually happens, which in practice means a durable queue with retries and an alert when the queue grows. Deferring to a fire-and-forget call in the same process is not deferring, it is silently dropping work under load, and the moment that happens is precisely the peak where the loss hurts most.',
        },
        {
          type: 'code',
          value: `// pipeline/deferred.js
// Defers what does not belong on the critical path, with a durable queue.
// Rule: if the answer asserts the fact, verify it first;
// if the fact is a consequence of the answer, it can be deferred.

const CRITICAL = new Set(['policy_check', 'balance_lookup', 'action_confirm']);

export function createPipeline({ queue, metrics, logger }) {
  async function respond({ requestId, steps, deferred }) {
    // Critical stages: an error here aborts and becomes a failure answer,
    // because delivering an unverified assertion is worse than not answering.
    for (const step of steps) {
      if (!CRITICAL.has(step.name)) continue;
      await step.run();
    }

    const answer = await steps.find((s) => s.name === 'generate').run();

    // Deferred stages never use fire-and-forget: they go to a durable
    // queue, because losing this under load is a silent bug.
    for (const task of deferred) {
      await queue.enqueue(task.name, {
        requestId,
        payload: task.payload,
        // Compensation declared alongside the task: whoever defers takes
        // responsibility for saying what happens when it fails.
        onExhausted: task.onExhausted ?? 'alert_only',
        maxAttempts: task.maxAttempts ?? 5,
      });
      metrics.counter('agent.deferred.enqueued_total', 1, { task: task.name });
    }

    return answer;
  }

  // The deferred queue needs its own watcher: sustained growth means the
  // work was taken off the critical path and then never done.
  function watchBacklog({ thresholdAge, intervalMs = 60000 }) {
    const timer = setInterval(async () => {
      const oldestAgeMs = await queue.oldestPendingAgeMs();
      metrics.gauge('agent.deferred.oldest_age_ms', oldestAgeMs);
      if (oldestAgeMs > thresholdAge) {
        logger.error('agent.deferred.stale', { oldestAgeMs, thresholdAge });
      }
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { respond, watchBacklog };
}`,
        },
        {
          type: 'paragraph',
          value:
            'The backlog watcher is the part usually left out and the one that gives the decision to defer its meaning. When you take a stage off the critical path, it disappears from the latency dashboard and moves to a place nobody looks at. The age of the oldest pending item is the metric that keeps "deferred" from becoming "never done", and it needs its own alert, because no latency dashboard will tell you the CRM sync is thirty-six hours behind.',
        },
      ],
    },
    {
      title: 'Budget per route, not one number for the whole system',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A single budget for the whole system fails for the same reason a single percentile fails: it mixes populations with different expectations. "What are your opening hours" and "how much do I owe, itemized by invoice" should not share a ceiling, and forcing the same ceiling produces two bad decisions at once: the simple route is slower than it needs to be because the ceiling is generous, and the complex route lives in breach of a ceiling that was never realistic for it.',
        },
        {
          type: 'table',
          columns: ['Route class', 'Total ceiling (p95)', 'Stages on the path', 'Dominant strategy'],
          rows: [
            [
              'Fixed catalog answer',
              '600 ms',
              'Queue, intent, template',
              'Answer cache keyed by intent',
            ],
            [
              'Question answered by RAG',
              '3500 ms',
              'Full retrieval and generation',
              'Streaming and prefix caching',
            ],
            [
              'External system lookup',
              '4500 ms',
              'RAG plus one or two tools',
              'Parallelize tools and set a per-tool timeout',
            ],
            [
              'Transactional action',
              '6000 ms',
              'All of the above plus confirmation and write',
              'Partial confirmation across two messages',
            ],
            [
              'Escalation to a human',
              '900 ms',
              'Intent and routing',
              'Never go through the generation model',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row is the most valuable and the most forgotten. When a customer writes "I want to talk to a person", the only right thing to do is route, and the worst possible outcome is spending three seconds generating elaborate text explaining that a transfer is coming. A short path for that intent, bypassing the generation model, turns the worst moment of a conversation into a nearly instant response, and it is one of the few adjustments that improve latency and satisfaction at the same time with no counterweight.',
        },
        {
          type: 'paragraph',
          value:
            'With a per-route budget, the operational alert changes shape. Instead of "service p95 went past five seconds", it becomes "the external lookup route has thirty percent of requests outside its ceiling", which arrives with the diagnosis built in and points the team straight at the two or three stages of that specific route. That is the difference between an alert that starts an investigation and an alert that starts a fix.',
        },
      ],
    },
    {
      title: 'The sequence that usually pays best',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Not every technique above is worth the same effort at the same moment. The order below usually returns the most per week of work in mid-sized support agents, and each step depends on the previous one because without per-stage measurement you cannot tell whether the next step improved anything or just traded one bottleneck for another.',
        },
        {
          type: 'ordered',
          items: [
            'Declare ceilings per stage and per route class before measuring, so the budget is a contract and not a description of the present.',
            'Instrument on a single timeline, with an explicit unaccounted stage, and treat a residue above ten percent as the most urgent item in the budget.',
            'Parallelize what is independent before cutting anything, since that is the only gain with no downside for the answer.',
            'Turn on streaming in channels that support it, because it resolves the complaint even without touching the total number.',
            'Stabilize the prompt prefix and enable caching, which is the largest single gain in time to first token.',
            'Defer what is a consequence of the answer, always with a durable queue and an alert on the age of the oldest pending item.',
            'Only then cut quality, with lower topK and shorter output, measuring the effect on the eval before calling the cut done.',
            'Build a short path for human escalation that never touches the generation model.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The item that draws the most resistance is the seventh, and rightly so. Cutting topK or capping output is the easiest optimization to implement and the only one on the list that can make the answer worse without anyone noticing the following week. That is why it comes last and why it must go through the evaluation set before being considered done: a two hundred millisecond gain that costs three points of accuracy is not an optimization, it is a trade someone has to approve consciously.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth ending with the discomfort this work almost always reveals. After parallelizing, enabling streaming and caching the prefix, the budget ends up dominated by model generation, and there the options are few and all of them are product choices: shorter answer, smaller model or accept the time. Reaching that point is not a failure of the latency work, it is its result. The budget existed precisely to turn a vague complaint about slowness into a specific decision about how much text the customer needs to receive and with which model, which is a decision the team can actually make.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why does the sum of my stages not match the measured total?',
      answer:
        'Because the time that belongs to no stage is real and usually the most informative. Between the end of one stage and the start of the next you fit event loop scheduling wait, payload serialization and deserialization, garbage collection pauses, connection pool contention and network time that falls outside your stopwatches. If you time each stage with a separate stopwatch and sum at the end, all of that time vanishes and the dashboard shows six seconds while the customer waited nine. The fix is to measure the end-to-end total with a single clock, measure the stages inside that same interval and report the difference as an explicit stage called unaccounted. When that residue exceeds ten percent of the total, it stops being measurement imprecision and becomes the largest item in the budget, pointing at pool sizing, CPU saturation or memory pressure rather than at any AI component.',
    },
    {
      question: 'Does streaming solve latency or is it just makeup?',
      answer:
        'It does not change total time at all and it solves the real problem in most text channels, and both are true at once. The complete answer arrives at exactly the same instant it would without streaming, so no dashboard number improves. What changes is that the customer stops staring at a typing indicator after nine hundred milliseconds instead of four seconds, and the complaint that started the work was about that, not about the number. It pays to be honest about the limits: you cannot stream content that still has to pass policy validation, since that would mean showing and then retracting, and on channels without incremental delivery the gain is zero. Even so, when the channel allows it, this is the intervention with the best ratio of effort to perceived quality on the whole list, and it makes sense to try before cutting anything that affects the answer.',
    },
    {
      question: 'Which stages can I take off the critical path without risk?',
      answer:
        'The criterion is whether the answer asserts the fact or the fact is a consequence of the answer. Everything the answer asserts as true must be verified before it goes out: quoted balance, promised stock, applied policy, confirmed action. Everything that follows from the answer can happen afterwards: audit trail writes, long-term memory updates, CRM syncing, cost accounting and quality metrics. The important caveat is that deferring means a durable queue with retries and declared compensation, not a fire-and-forget promise in the same process, which under load becomes silent loss at exactly the peak where it hurts most. And since a deferred stage disappears from the latency dashboard, it needs its own watcher: the age of the oldest pending item is the metric that keeps deferred from becoming never done.',
    },
  ],
  conclusion: {
    title: 'Latency is solved by budget, not by diffuse effort',
    description:
      'An aggregate latency number is not diagnosable: it mixes nine stages with different causes, fixes and costs, and pushes the team to optimize what is easy rather than what weighs. Declaring ceilings per stage and per route class before measuring, instrumenting everything on a single timeline with an explicit unaccounted residue, parallelizing what is independent before cutting anything, turning on streaming where the channel allows and deferring only what is a consequence of the answer, always with a durable queue, is the sequence that turns a vague complaint into a short list of concrete decisions. At the end of that path the budget ends up dominated by model generation, and that is exactly where the conversation stops being technical and becomes product: how much text the customer needs to receive and with which model. I can instrument your agent latency budget, separate the critical path from deferrable work and point out where cutting pays off using measured data instead of guesswork.',
    cta: 'Talk about my agent latency',
  },
  related: [
    { label: 'Streaming LLM answers without breaking UX', to: '/blog/streaming-resposta-llm-sem-quebrar-ux' },
    { label: 'Vector index warm-up and the slow first query', to: '/blog/aquecimento-indice-vetorial-primeira-consulta-do-dia-lenta' },
    { label: 'Observability and reliability', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const es = {
  intro:
    'El reclamo llega siempre con la misma forma: "el bot está lento". El equipo mira el panel, ve el percentil noventa y cinco en nueve segundos, y empieza a optimizar lo que sea más fácil de optimizar, que casi nunca es lo que está consumiendo el tiempo. Dos semanas después la latencia bajó de nueve segundos a ocho y medio, y nadie sabe explicar por qué el esfuerzo rindió tan poco. El problema no es falta de optimización, es falta de un presupuesto: una descomposición del tiempo total en etapas con un techo declarado para cada una, medida sobre el mismo reloj, de modo que la pregunta deje de ser "cómo hacemos todo más rápido" y pase a ser "qué etapa se pasó de su techo". Este artículo muestra cómo armar ese presupuesto, por qué la suma de las etapas casi nunca cierra con el total y qué significa ese hueco, cómo decidir entre cortar, paralelizar y diferir cada etapa, y por qué la respuesta correcta muchas veces es cambiar la percepción del tiempo en vez de reducir el tiempo.',
  sections: [
    {
      title: 'Un número agregado no es diagnosticable',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La latencia de punta a punta de una respuesta de agente es una suma de cosas muy distintas: espera en cola, resolución de intención, generación de embedding, búsqueda vectorial, reranking, armado del prompt, tiempo hasta el primer token, generación completa, validación de salida, ejecución de herramientas y envío por el canal. Cada una de esas etapas tiene una causa de lentitud distinta, una técnica de corrección distinta y un costo de corrección distinto. Ver solo la suma es como recibir el resumen de la tarjeta sin el detalle de las compras: sabés que gastaste de más y no sabés dónde recortar.',
        },
        {
          type: 'paragraph',
          value:
            'El primer paso es declarar un presupuesto antes de medir. Parece invertido, pero es deliberado: si medís primero y recién después definís los techos, los techos van a nacer anclados en lo que el sistema ya hace, y el presupuesto se vuelve una descripción del presente en vez de un contrato. Declarar antes fuerza la conversación correcta, que es sobre cuánto tiempo merece cada etapa dado el valor que entrega, no sobre cuánto tarda hoy.',
        },
        {
          type: 'table',
          columns: ['Etapa', 'Techo sugerido (p95)', 'Causa típica de exceso', 'Acción cuando se pasa'],
          rows: [
            [
              'Espera en cola',
              '50 ms',
              'Concurrencia limitada por conexiones o trabajadores',
              'Aumentar paralelismo o aplicar prioridad por tipo de tráfico',
            ],
            [
              'Clasificación de intención',
              '150 ms',
              'Llamar a un segundo LLM para una decisión binaria',
              'Cambiar por un clasificador liviano o una regla explícita',
            ],
            [
              'Embedding de la consulta',
              '120 ms',
              'Modelo remoto sin pool de conexiones',
              'Pool con keep-alive y caché de consultas repetidas',
            ],
            [
              'Búsqueda vectorial',
              '200 ms',
              'topK demasiado alto o índice frío',
              'Bajar topK y calentar el índice antes de recibir tráfico',
            ],
            [
              'Reranking',
              '300 ms',
              'Reranquear veinte candidatos cuando cinco alcanzan',
              'Recortar la lista de entrada antes del reranker',
            ],
            [
              'Tiempo hasta el primer token',
              '900 ms',
              'Prompt gigante sin caché de prefijo',
              'Estabilizar el prefijo y activar caché de prompt',
            ],
            [
              'Generación completa',
              '2500 ms',
              'Respuesta demasiado larga para el canal',
              'Limitar tokens de salida e instruir concisión',
            ],
            [
              'Validación y guardrails',
              '150 ms',
              'Validación que llama a otro modelo en serie',
              'Validar por esquema y reservar el modelo para el caso dudoso',
            ],
            [
              'Herramientas externas',
              '800 ms',
              'Llamada a ERP o CRM sin timeout propio',
              'Timeout por herramienta y respuesta parcial cuando se agota',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Los números de la segunda columna no son universales y no deben copiarse: son un punto de partida para un agente de atención en texto, con respuesta esperada alrededor de cinco segundos. Un agente de voz necesita techos radicalmente menores porque el silencio es insoportable al teléfono; un agente que genera un informe asincrónico puede tener techos diez veces mayores. Lo que importa es que los techos existan, estén escritos en algún lugar versionado y se revisen cuando el producto cambia de expectativa.',
        },
      ],
    },
    {
      title: 'Medir por etapa sobre el mismo reloj',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La medición por etapa suele nacer mal de dos formas. La primera es medir cada etapa con un cronómetro independiente y sumar después, lo que pierde todo lo que ocurre entre las etapas: espera de planificación, serialización, recolección de basura, contención de pool. La segunda es instrumentar solo las etapas que alguien recordó, lo que convierte el tiempo restante en un residuo invisible. Las dos producen el mismo síntoma: la suma de las etapas da seis segundos y el cliente esperó nueve.',
        },
        {
          type: 'paragraph',
          value:
            'La corrección es tratar el hueco como un dato de primera clase. Medí el total de punta a punta con un único reloj, medí cada etapa dentro de ese mismo intervalo, y reportá la diferencia explícitamente como una etapa llamada "no contabilizado". Cuando esa etapa pasa el diez por ciento del total, deja de ser ruido de medición y se vuelve el ítem más grande del presupuesto, lo que cambia por completo dónde debe mirar el equipo.',
        },
        {
          type: 'code',
          value: `// telemetry/latency-budget.js
// Presupuesto de latencia por etapa medido en una unica linea de tiempo.
// La diferencia entre el total y la suma de etapas se reporta como
// "unaccounted": es el item que mas revela problemas de infraestructura.

const BUDGET_MS = {
  queue_wait: 50,
  intent: 150,
  embed: 120,
  vector_search: 200,
  rerank: 300,
  llm_first_token: 900,
  llm_generation: 2500,
  validation: 150,
  tools: 800,
};

const TOTAL_BUDGET_MS = Object.values(BUDGET_MS).reduce((a, b) => a + b, 0);

export function createBudgetTracker({ metrics, logger, now = () => Date.now() }) {
  function start({ requestId, channel }) {
    const startedAt = now();
    const stages = [];

    async function stage(name, fn) {
      const from = now();
      try {
        return await fn();
      } finally {
        const durationMs = now() - from;
        stages.push({ name, durationMs });
        // Etiquetar con el techo permite alertar por etapa y no por el
        // agregado: una etapa en 3x su techo se esconde en un p95 sano.
        metrics.histogram('agent.stage.duration_ms', durationMs, {
          stage: name,
          channel,
          over_budget: durationMs > (BUDGET_MS[name] ?? Infinity) ? 'yes' : 'no',
        });
      }
    }

    function finish() {
      const totalMs = now() - startedAt;
      const measuredMs = stages.reduce((acc, s) => acc + s.durationMs, 0);
      // Positivo por construccion: espera de planificacion, serializacion,
      // recoleccion de basura y contencion de pool viven exactamente aca.
      const unaccountedMs = Math.max(0, totalMs - measuredMs);

      metrics.histogram('agent.total.duration_ms', totalMs, { channel });
      metrics.histogram('agent.stage.duration_ms', unaccountedMs, {
        stage: 'unaccounted',
        channel,
        over_budget: unaccountedMs > totalMs * 0.1 ? 'yes' : 'no',
      });

      // Solo registra el detalle cuando se paso: log de caso feliz en
      // volumen alto cuesta mas que la etapa que se quiere observar.
      if (totalMs > TOTAL_BUDGET_MS) {
        const worst = [...stages].sort((a, b) => {
          const overA = a.durationMs - (BUDGET_MS[a.name] ?? 0);
          const overB = b.durationMs - (BUDGET_MS[b.name] ?? 0);
          return overB - overA;
        })[0];
        logger.warn('agent.budget.exceeded', {
          requestId,
          totalMs,
          budgetMs: TOTAL_BUDGET_MS,
          unaccountedMs,
          worstStage: worst?.name,
          worstOverMs: worst ? worst.durationMs - (BUDGET_MS[worst.name] ?? 0) : 0,
        });
      }

      return { totalMs, measuredMs, unaccountedMs, stages };
    }

    return { stage, finish };
  }

  return { start, BUDGET_MS, TOTAL_BUDGET_MS };
}`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle que hace valer este código es la etiqueta de exceso por etapa. Sin ella tenés nueve histogramas y necesitás mirar los nueve para saber si algo se movió. Con ella, una sola alerta sobre la proporción de solicitudes con alguna etapa fuera de su techo ya responde la pregunta operativa, y el panel por etapa sirve para el diagnóstico después de que la alerta disparó. Es la diferencia entre un panel que consultás cuando te acordás y uno que te llama.',
        },
        {
          type: 'paragraph',
          value:
            'Una trampa frecuente acá es medir el tiempo de la etapa incluyendo el tiempo que estuvo esperando un recurso compartido. Si la búsqueda vectorial tarda cuatrocientos milisegundos, de los cuales trescientos esperando una conexión libre en el pool, atribuir eso a la búsqueda lleva al equipo a optimizar el índice cuando el problema es el dimensionamiento del pool. Conviene separar el tiempo de adquisición del recurso del tiempo de trabajo efectivo siempre que la etapa dependa de un pool, y esa separación sola suele explicar la mitad de los excesos.',
        },
      ],
    },
    {
      title: 'Cortar, paralelizar o diferir: tres respuestas distintas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con el presupuesto medido, cada etapa fuera de su techo admite tres tratamientos, y elegir el equivocado es como el equipo desperdicia semanas. Cortar significa hacer menos trabajo: bajar topK, acortar la salida, eliminar una llamada. Paralelizar significa hacer el mismo trabajo al mismo tiempo que otro. Diferir significa sacar la etapa del camino crítico y ejecutarla después de que la respuesta ya salió. Cortar reduce costo, paralelizar aumenta la presión sobre los recursos y diferir cambia la semántica del sistema.',
        },
        {
          type: 'paragraph',
          value:
            'La regla práctica es buscar oportunidades de paralelismo antes de cortar calidad, porque cortar siempre tiene el precio de una respuesta peor y paralelizar muchas veces es gratis. En un agente típico hay dos paralelismos evidentes que casi nadie aprovecha: generar el embedding de la consulta al mismo tiempo que se busca el historial de la conversación, y disparar las herramientas independientes juntas en vez de en cadena. Ninguno de los dos cambia una coma de la respuesta.',
        },
        {
          type: 'diagram',
          value: `Camino critico de una respuesta de agente

  SECUENCIAL (suma: 4.62 s)
  |-- cola 0.05
      |-- intencion 0.15
          |-- historial 0.18
              |-- embedding 0.12
                  |-- busqueda 0.20
                      |-- rerank 0.30
                          |-- herramienta A 0.80
                              |-- herramienta B 0.62
                                  |-- primer token 0.90
                                      |-- generacion 1.30

  PARALELIZADO (camino critico: 3.20 s)
  |-- cola 0.05
      |-- intencion 0.15
          |-- [ historial 0.18 | embedding 0.12 ]      -> 0.18
              |-- busqueda 0.20
                  |-- rerank 0.30
                      |-- [ herramienta A 0.80 | herramienta B 0.62 ] -> 0.80
                          |-- primer token 0.90
                              |-- generacion 1.30

  Ganancia: 1.42 s sin cortar ninguna etapa y sin empeorar la respuesta.
  Lo que queda en el camino critico: generacion (1.30) y primer token (0.90),
  que juntos son 69% del total. Ahi vive la proxima decision dificil.`,
        },
        {
          type: 'paragraph',
          value:
            'El diagrama muestra algo que se repite en casi todo sistema: después de paralelizar lo obvio, el camino crítico queda dominado por el modelo. Eso importa porque cambia la naturaleza del trabajo restante. Las etapas de recuperación responden a ingeniería clásica, con caché, índice y pool. El tiempo del modelo responde solo a tres cosas: tamaño del prompt, tamaño de la salida y elección del modelo. Si el equipo sigue optimizando búsqueda vectorial después de llegar a ese punto, está optimizando el doce por ciento del problema.',
        },
        {
          type: 'table',
          columns: ['Tratamiento', 'Qué cambia', 'Ganancia típica', 'Qué pagás'],
          rows: [
            [
              'Paralelizar etapas independientes',
              'Orden de ejecución, no el trabajo hecho',
              '20% a 35% del total',
              'Más conexiones simultáneas y código más difícil de depurar',
            ],
            [
              'Bajar topK y candidatos del reranker',
              'Volumen de datos procesado',
              '150 a 400 ms',
              'Riesgo de perder el documento correcto en consultas raras',
            ],
            [
              'Caché de prefijo del prompt',
              'Cuánto reprocesa el modelo en cada llamada',
              '30% a 60% del tiempo hasta el primer token',
              'Disciplina de ordenación del prompt para siempre',
            ],
            [
              'Limitar tokens de salida',
              'Tamaño de la respuesta generada',
              'Proporcional e inmediata',
              'Respuestas truncadas si el límite está mal calibrado',
            ],
            [
              'Modelo menor para tareas simples',
              'Qué modelo atiende cada ruta',
              '40% a 70% en las rutas ruteadas',
              'Un clasificador más para mantener y evaluar',
            ],
            [
              'Diferir una etapa para después de la respuesta',
              'Semántica: deja de ser sincrónica',
              'Saca la etapa entera del camino',
              'Necesita compensación cuando la etapa diferida falla',
            ],
            [
              'Streaming de la respuesta',
              'Percepción, no el tiempo total',
              'El tiempo percibido cae al primer token',
              'No podés streamear lo que todavía falta validar',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila merece atención porque es la que más confunde. El streaming no recorta un solo milisegundo del tiempo total: la respuesta completa llega en el mismo instante en que llegaría antes. Lo que cambia es que el usuario deja de mirar un indicador de escritura a los novecientos milisegundos en vez de a los cuatro segundos, y la percepción de lentitud desaparece aun con el número del panel intacto. Para un canal de texto eso frecuentemente resuelve el problema real, que era el reclamo, no el número.',
        },
      ],
    },
    {
      title: 'Qué diferir y cómo no romper nada al diferir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Diferir es el tratamiento más poderoso y el más peligroso, porque cambia el contrato del sistema en vez de optimizarlo. Una etapa diferida es una etapa que puede fallar después de que el cliente ya recibió la respuesta, y el sistema necesita saber qué hacer en ese caso. La pregunta que separa lo diferible de lo no diferible es directa: si esta etapa falla después de la respuesta ya entregada, se puede compensar sin contradecir lo que se le dijo al cliente?',
        },
        {
          type: 'ordered',
          items: [
            'Registro en la traza de auditoría: diferible sin reservas, porque nada en la respuesta depende de que el registro ya exista.',
            'Actualización de la memoria de largo plazo del cliente: diferible, dado que solo afecta la conversación siguiente y no la actual.',
            'Sincronización con el CRM: diferible con cola durable, porque el dato tiene que llegar pero no tiene que llegar antes de la respuesta.',
            'Cálculo de costo y métricas de calidad: diferible y muchas veces mejor diferido, ya que corre en lote con más contexto.',
            'Validación de política de contenido: no diferible, porque diferir significa entregar primero y descubrir el problema después.',
            'Consulta de saldo o stock citada en la respuesta: no diferible, puesto que la respuesta afirma un hecho que debe ser verdadero en el momento en que se dice.',
            'Confirmación de una acción con efecto externo: no diferible, porque decir que se hizo antes de hacerlo es la única falla que el cliente nunca perdona.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Los últimos tres ítems definen la frontera. Todo lo que la respuesta afirma como hecho tiene que estar verificado antes de que la respuesta salga. Todo lo que es consecuencia de la respuesta puede pasar después, siempre que pase de verdad, lo que en la práctica significa cola durable con reintentos y alerta cuando la cola crece. Diferir a una llamada disparada y olvidada en el mismo proceso no es diferir, es perder trabajo en silencio bajo carga, y el momento en que eso ocurre es justamente el pico en que la pérdida más duele.',
        },
        {
          type: 'code',
          value: `// pipeline/deferred.js
// Difiere lo que no pertenece al camino critico, con cola durable.
// Regla: si la respuesta afirma el hecho, se verifica antes;
// si el hecho es consecuencia de la respuesta, puede diferirse.

const CRITICAL = new Set(['policy_check', 'balance_lookup', 'action_confirm']);

export function createPipeline({ queue, metrics, logger }) {
  async function respond({ requestId, steps, deferred }) {
    // Etapas criticas: un error aca interrumpe y se vuelve respuesta de
    // fallo, porque entregar una afirmacion no verificada es peor que nada.
    for (const step of steps) {
      if (!CRITICAL.has(step.name)) continue;
      await step.run();
    }

    const answer = await steps.find((s) => s.name === 'generate').run();

    // Las etapas diferidas nunca usan disparar y olvidar: van a cola
    // durable, porque perder esto bajo carga es un bug silencioso.
    for (const task of deferred) {
      await queue.enqueue(task.name, {
        requestId,
        payload: task.payload,
        // Compensacion declarada junto con la tarea: quien difiere asume
        // la responsabilidad de decir que pasa cuando falla.
        onExhausted: task.onExhausted ?? 'alert_only',
        maxAttempts: task.maxAttempts ?? 5,
      });
      metrics.counter('agent.deferred.enqueued_total', 1, { task: task.name });
    }

    return answer;
  }

  // La cola diferida necesita su propio observador: crecimiento sostenido
  // significa que el trabajo salio del camino critico y nunca se hizo.
  function watchBacklog({ thresholdAge, intervalMs = 60000 }) {
    const timer = setInterval(async () => {
      const oldestAgeMs = await queue.oldestPendingAgeMs();
      metrics.gauge('agent.deferred.oldest_age_ms', oldestAgeMs);
      if (oldestAgeMs > thresholdAge) {
        logger.error('agent.deferred.stale', { oldestAgeMs, thresholdAge });
      }
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { respond, watchBacklog };
}`,
        },
        {
          type: 'paragraph',
          value:
            'La función de observación de la cola es la parte que suele quedar afuera y la que le da sentido a la decisión de diferir. Cuando sacás una etapa del camino crítico, desaparece del panel de latencia y pasa a vivir en un lugar donde nadie mira. La métrica de edad del ítem pendiente más viejo es lo que impide que "diferido" se vuelva "nunca hecho", y necesita su propia alerta, porque ningún panel de latencia te va a avisar que la sincronización con el CRM está treinta y seis horas atrasada.',
        },
      ],
    },
    {
      title: 'Presupuesto por ruta, no un número para todo el sistema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un presupuesto único para todo el sistema falla por el mismo motivo que falla un percentil único: mezcla poblaciones con expectativas distintas. "Cuál es el horario de atención" y "cuánto debo, detallado por factura" no deberían compartir techo, y forzar el mismo techo produce dos decisiones malas a la vez: la ruta simple queda más lenta de lo necesario porque el techo es generoso, y la ruta compleja vive incumpliendo un techo que nunca fue realista para ella.',
        },
        {
          type: 'table',
          columns: ['Clase de ruta', 'Techo total (p95)', 'Etapas en el camino', 'Estrategia dominante'],
          rows: [
            [
              'Respuesta de catálogo fijo',
              '600 ms',
              'Cola, intención, plantilla',
              'Caché de respuesta con clave por intención',
            ],
            [
              'Pregunta respondida por RAG',
              '3500 ms',
              'Recuperación completa y generación',
              'Streaming y caché de prefijo',
            ],
            [
              'Consulta a sistema externo',
              '4500 ms',
              'RAG más una o dos herramientas',
              'Paralelizar herramientas y definir timeout por herramienta',
            ],
            [
              'Acción transaccional',
              '6000 ms',
              'Todo lo anterior más confirmación y escritura',
              'Confirmación parcial en dos mensajes',
            ],
            [
              'Escalada a un humano',
              '900 ms',
              'Intención y ruteo',
              'Nunca pasar por el modelo de generación',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila es la más valiosa y la más olvidada. Cuando el cliente escribe "quiero hablar con una persona", lo único correcto es rutear, y el peor resultado posible es gastar tres segundos generando un texto elaborado que explica que va a transferir. Un camino corto para esa intención, sin pasar por el modelo de generación, convierte el peor momento de la conversación en una respuesta casi instantánea, y es uno de los pocos ajustes que mejoran latencia y satisfacción al mismo tiempo sin ninguna contrapartida.',
        },
        {
          type: 'paragraph',
          value:
            'Con presupuesto por ruta, la alerta operativa cambia de forma. En vez de "el p95 del servicio pasó los cinco segundos", se vuelve "la ruta de consulta externa tiene treinta por ciento de las solicitudes fuera de su techo", que ya viene con el diagnóstico incorporado y apunta al equipo directo a las dos o tres etapas de esa ruta específica. Es la diferencia entre una alerta que inicia una investigación y una alerta que inicia una corrección.',
        },
      ],
    },
    {
      title: 'La secuencia que suele rendir más',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No toda técnica de arriba vale el mismo esfuerzo en el mismo momento. El orden de abajo es el que suele dar más resultado por semana de trabajo en agentes de atención de porte medio, y cada paso depende del anterior porque sin medición por etapa no sabés si el paso siguiente mejoró algo o si cambiaste un cuello de botella por otro.',
        },
        {
          type: 'ordered',
          items: [
            'Declará los techos por etapa y por clase de ruta antes de medir, para que el presupuesto sea un contrato y no una descripción del presente.',
            'Instrumentá sobre la misma línea de tiempo, con la etapa no contabilizado explícita, y tratá un residuo por encima del diez por ciento como el ítem más urgente del presupuesto.',
            'Paralelizá lo que es independiente antes de cortar nada, ya que esa es la única ganancia sin contrapartida en la respuesta.',
            'Activá streaming en los canales que lo soportan, porque resuelve el reclamo aun sin tocar el número total.',
            'Estabilizá el prefijo del prompt y activá caché, que es la mayor ganancia aislada en el tiempo hasta el primer token.',
            'Diferí lo que es consecuencia de la respuesta, siempre con cola durable y alerta sobre la edad del ítem pendiente más viejo.',
            'Recién entonces cortá calidad, con topK menor y salida más corta, midiendo el efecto en el eval antes de dar el corte por terminado.',
            'Armá un camino corto para escalada humana que nunca toque el modelo de generación.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El ítem que más resistencia genera es el séptimo, y con razón. Cortar topK o limitar la salida es la optimización más fácil de implementar y la única de la lista que puede empeorar la respuesta sin que nadie lo note a la semana siguiente. Por eso viene último y por eso tiene que pasar por el conjunto de evaluación antes de darse por terminado: una ganancia de doscientos milisegundos que cuesta tres puntos de acierto no es una optimización, es un intercambio que alguien tiene que aprobar conscientemente.',
        },
        {
          type: 'paragraph',
          value:
            'Vale terminar con la incomodidad que este trabajo casi siempre revela. Después de paralelizar, activar streaming y cachear el prefijo, el presupuesto queda dominado por la generación del modelo, y ahí las opciones son pocas y todas involucran una decisión de producto: respuesta más corta, modelo menor o aceptar el tiempo. Llegar a ese punto no es un fracaso del trabajo de latencia, es su resultado. El presupuesto sirvió justamente para transformar un reclamo vago sobre lentitud en una decisión específica sobre cuánto texto necesita recibir el cliente y con qué modelo, que es una decisión que el equipo sí puede tomar.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por qué la suma de mis etapas no cierra con el tiempo total medido?',
      answer:
        'Porque el tiempo que no está en ninguna etapa es real y normalmente es el más informativo. Entre el fin de una etapa y el comienzo de la siguiente caben espera de planificación del bucle de eventos, serialización y deserialización de payload, pausas de recolección de basura, contención del pool de conexiones y tiempo de red que queda fuera de tus cronómetros. Si medís cada etapa con un cronómetro separado y sumás al final, todo ese tiempo desaparece y el panel muestra seis segundos mientras el cliente esperó nueve. La corrección es medir el total de punta a punta con un único reloj, medir las etapas dentro de ese mismo intervalo y reportar la diferencia como una etapa explícita llamada no contabilizado. Cuando ese residuo pasa el diez por ciento del total, deja de ser imprecisión de medición y se vuelve el ítem más grande del presupuesto, apuntando a dimensionamiento de pool, saturación de CPU o presión de memoria en vez de a cualquier componente de IA.',
    },
    {
      question: 'El streaming resuelve latencia o es solo maquillaje?',
      answer:
        'No cambia el tiempo total en nada y resuelve el problema real en la mayoría de los canales de texto, y las dos cosas son ciertas al mismo tiempo. La respuesta completa llega en el mismo instante en que llegaría sin streaming, así que ningún número del panel mejora. Lo que cambia es que el cliente deja de mirar un indicador de escritura a los novecientos milisegundos en vez de a los cuatro segundos, y el reclamo que originó el trabajo era sobre eso, no sobre el número. Conviene ser honesto sobre los límites: no podés streamear contenido que todavía tiene que pasar por validación de política, porque eso significaría mostrar y después retirar, y en canales sin entrega incremental la ganancia es cero. Aun así, cuando el canal lo permite, es la intervención con mejor relación entre esfuerzo y percepción de calidad de toda la lista, y tiene sentido probarla antes de cortar cualquier cosa que afecte la respuesta.',
    },
    {
      question: 'Qué etapas puedo sacar del camino crítico sin riesgo?',
      answer:
        'El criterio es si la respuesta afirma el hecho o si el hecho es consecuencia de la respuesta. Todo lo que la respuesta afirma como verdadero tiene que estar verificado antes de salir: saldo citado, stock prometido, política aplicada, acción confirmada. Todo lo que se deriva de la respuesta puede pasar después: registro en la traza de auditoría, actualización de la memoria de largo plazo, sincronización con el CRM, cálculo de costo y métricas de calidad. La salvedad importante es que diferir significa cola durable con reintentos y compensación declarada, no una promesa disparada y olvidada en el mismo proceso, que bajo carga se vuelve pérdida silenciosa justo en el pico donde más duele. Y como una etapa diferida desaparece del panel de latencia, necesita su propio observador: la métrica de edad del ítem pendiente más viejo es lo que impide que diferido se vuelva nunca hecho.',
    },
  ],
  conclusion: {
    title: 'La latencia se resuelve por presupuesto, no por esfuerzo difuso',
    description:
      'Un número agregado de latencia no es diagnosticable: mezcla nueve etapas con causas, correcciones y costos distintos, y lleva al equipo a optimizar lo fácil en vez de lo que pesa. Declarar techos por etapa y por clase de ruta antes de medir, instrumentar todo sobre la misma línea de tiempo con el residuo no contabilizado explícito, paralelizar lo independiente antes de cortar nada, activar streaming donde el canal lo permite y diferir solo lo que es consecuencia de la respuesta, siempre con cola durable, es la secuencia que transforma un reclamo vago en una lista corta de decisiones concretas. Al final de ese camino el presupuesto queda dominado por la generación del modelo, y es exactamente ahí donde la conversación deja de ser técnica y se vuelve producto: cuánto texto necesita recibir el cliente y con qué modelo. Puedo instrumentar el presupuesto de latencia de tu agente, separar camino crítico de trabajo diferible y señalar dónde compensa cortar con dato medido en vez de intuición.',
    cta: 'Hablar sobre la latencia de mi agente',
  },
  related: [
    { label: 'Streaming de respuesta de LLM sin romper la UX', to: '/blog/streaming-resposta-llm-sem-quebrar-ux' },
    { label: 'Calentamiento de índice vectorial y la primera consulta lenta', to: '/blog/aquecimento-indice-vetorial-primeira-consulta-do-dia-lenta' },
    { label: 'Observabilidad y confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

export default {
  pt,
  en,
  es,
};
