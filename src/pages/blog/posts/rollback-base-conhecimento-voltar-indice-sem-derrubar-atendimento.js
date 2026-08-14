// Conteudo do artigo: rollback de base de conhecimento, voltar o indice sem derrubar o atendimento.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A reindexação rodou na terça à noite, o time trocou o parser de PDF por um melhor, e na quarta de manhã o agente começou a responder que a política de troca é de sete dias quando ela virou trinta há dois meses. Alguém pergunta a pergunta óbvia: "dá para voltar o índice de ontem?". E a resposta, na maioria dos sistemas de RAG que já vi, é "não exatamente". Não porque o backup não exista, mas porque o índice foi tratado como um cache descartável e não como um artefato versionado: ele é sobrescrito no lugar, a coleção tem um nome fixo, os embeddings foram gerados por um modelo que já mudou de versão silenciosamente, e voltar significa reprocessar quarenta mil documentos por três horas enquanto o atendimento continua errando. Este artigo trata rollback de base de conhecimento como um problema de engenharia de release, não de banco de dados: como versionar o índice para que voltar seja trocar um ponteiro, por que o rollback de conteúdo e o rollback de embedding são operações diferentes que exigem estratégias diferentes, como detectar a regressão antes do cliente e qual é o custo real de manter a versão anterior viva.',
  sections: [
    {
      title: 'O índice sobrescrito no lugar não tem rollback',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O padrão que quase todo sistema de RAG adota no primeiro ano é o mais simples possível: existe uma coleção chamada "documentos", um job noturno lê a fonte, gera embeddings e faz upsert sobre os mesmos identificadores. Funciona muito bem enquanto tudo dá certo, e é irrecuperável no dia em que não dá. O upsert destrói o estado anterior por construção, então o rollback deixa de ser uma operação de infraestrutura e vira um reprocessamento completo, que é caro em tempo, caro em chamadas ao modelo de embedding e, o pior de tudo, lento exatamente no momento em que o sistema está errando com o cliente na frente.',
        },
        {
          type: 'paragraph',
          value:
            'Vale enumerar o que exatamente se perde, porque times costumam achar que só o texto do trecho está em jogo. Some o texto do chunk, mas também some a fronteira do chunk, que muda quando o parser muda; some o vetor, que depende do modelo e da versão dele; somem os metadados de filtro, que costumam ser reescritos por regra; e some o mapeamento entre documento de origem e trechos derivados, que é o único jeito de saber depois quais respostas foram fundamentadas em qual versão do material. Cada um desses quatro pode regredir de forma independente, e cada um exige um mecanismo de retorno diferente.',
        },
        {
          type: 'table',
          columns: ['O que regrediu', 'Sintoma típico', 'Mecanismo de retorno', 'Custo de voltar'],
          rows: [
            [
              'Conteúdo da fonte',
              'Resposta cita política antiga ou preço errado',
              'Voltar o snapshot de conteúdo e reindexar só o afetado',
              'Minutos, proporcional aos documentos tocados',
            ],
            [
              'Estratégia de chunking',
              'Resposta trunca no meio de uma tabela ou perde a condição',
              'Trocar o ponteiro para o índice da build anterior',
              'Segundos, se o índice anterior ainda existir',
            ],
            [
              'Modelo de embedding',
              'Recuperação traz documentos irrelevantes de forma difusa',
              'Trocar o ponteiro, nunca reindexar parcialmente',
              'Segundos, mas exige índice completo por modelo',
            ],
            [
              'Metadados de filtro',
              'Consulta de um cliente traz documento de outro segmento',
              'Reescrever metadados sem tocar em vetor',
              'Minutos, sem custo de embedding',
            ],
            [
              'Reranker ou pesos de busca',
              'Ordem dos trechos piora sem mudar o conjunto',
              'Rollback de configuração, não de índice',
              'Imediato, é só configuração',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A distinção da terceira linha é a que mais causa incidente prolongado. Misturar vetores de dois modelos de embedding na mesma coleção não gera erro: gera uma busca que retorna resultados sintaticamente válidos e semanticamente aleatórios, porque distância entre vetores de espaços diferentes não significa nada. É o pior tipo de falha, porque não aparece em log, não dispara alerta de exceção e só é percebida como uma queda difusa de qualidade que o time leva dias para atribuir à causa certa.',
        },
      ],
    },
    {
      title: 'Índice imutável com ponteiro: a base do rollback rápido',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A mudança estrutural que torna rollback trivial é parar de escrever no índice em produção e passar a construir um índice novo a cada build, identificado por uma versão, com o serviço de leitura apontando para uma versão através de um ponteiro. Publicar passa a ser mover o ponteiro; voltar passa a ser mover o ponteiro de volta. Essa é exatamente a ideia de release imutável aplicada a dados de recuperação, e ela transforma uma operação de horas numa operação de segundos.',
        },
        {
          type: 'paragraph',
          value:
            'O identificador da versão precisa carregar tudo que muda o significado do vetor. Na prática, o que funciona é um hash determinístico sobre a tupla que define a build: revisão do conteúdo de origem, identificador exato do modelo de embedding, dimensão, versão da estratégia de chunking e versão do esquema de metadados. Com esse identificador, duas builds com o mesmo conteúdo mas parsers diferentes são versões diferentes, o que é o comportamento correto, e o sistema ganha de graça a capacidade de recusar uma consulta cujo embedding foi gerado por um modelo diferente do índice apontado.',
        },
        {
          type: 'diagram',
          value: `Publicacao com ponteiro (rollback = mover a seta)

  fonte de conteudo  --> build v3 --> indice kb_a1b2c3  (ativo)
                         build v2 --> indice kb_9f8e7d  (retido, quente)
                         build v1 --> indice kb_44c1aa  (retido, frio)

  ponteiro "producao" ---------------> kb_a1b2c3
                          rollback --> kb_9f8e7d   (segundos)

  regra: consulta so e servida se
    embedding_model(consulta) == embedding_model(indice apontado)`,
        },
        {
          type: 'code',
          value: `// rag/index-pointer.js
// Publicacao e rollback de base de conhecimento por ponteiro.
// O indice nunca e sobrescrito: cada build cria uma colecao nova e
// publicar/voltar e uma troca atomica de ponteiro no armazenamento de estado.

import { createHash } from 'node:crypto';

// A versao precisa cobrir tudo que muda o significado do vetor.
// Trocar o parser sem trocar o modelo ainda produz um indice incompativel
// com o anterior para fins de comparacao, entao entra no hash.
export function buildIndexVersion({
  contentRevision,
  embeddingModel,
  embeddingDimensions,
  chunkingVersion,
  metadataSchemaVersion,
}) {
  const payload = [
    contentRevision,
    embeddingModel,
    String(embeddingDimensions),
    chunkingVersion,
    metadataSchemaVersion,
  ].join('|');

  return \`kb_\${createHash('sha256').update(payload).digest('hex').slice(0, 12)}\`;
}

export function createIndexPointer({ store, vectorDb, metrics, logger }) {
  // store: chave-valor com compare-and-set. Sem CAS, duas publicacoes
  // simultaneas podem deixar o ponteiro apontando para um indice incompleto.
  async function publish({ version, expectedCurrent, manifest }) {
    const health = await vectorDb.describe(version);

    if (!health.exists) {
      throw new Error(\`indice \${version} nao existe\`);
    }
    // Guarda contra a falha classica: publicar um indice que a build
    // deixou pela metade porque o job morreu no meio do upsert.
    if (health.vectorCount < manifest.expectedVectorCount) {
      throw new Error(
        \`indice \${version} incompleto: \${health.vectorCount}/\${manifest.expectedVectorCount}\`,
      );
    }
    if (health.dimensions !== manifest.embeddingDimensions) {
      throw new Error(\`dimensao divergente em \${version}\`);
    }

    const swapped = await store.compareAndSet('kb:pointer:production', expectedCurrent, {
      version,
      embeddingModel: manifest.embeddingModel,
      publishedAt: new Date().toISOString(),
      previousVersion: expectedCurrent?.version ?? null,
    });

    if (!swapped) {
      throw new Error('ponteiro mudou durante a publicacao, refaca a leitura');
    }

    metrics.increment('kb.pointer.publish', { version });
    logger.info({ version, from: expectedCurrent?.version }, 'indice publicado');
    return version;
  }

  // Rollback nao reindexa nada: ele volta para a versao anterior registrada
  // no proprio ponteiro. Se essa versao ja foi coletada, falha alto em vez
  // de degradar silenciosamente para um indice qualquer.
  async function rollback({ reason }) {
    const current = await store.get('kb:pointer:production');
    const target = current?.previousVersion;

    if (!target) {
      throw new Error('sem versao anterior registrada para rollback');
    }

    const health = await vectorDb.describe(target);
    if (!health.exists) {
      throw new Error(\`versao anterior \${target} nao esta mais retida\`);
    }

    await store.compareAndSet('kb:pointer:production', current, {
      version: target,
      embeddingModel: health.embeddingModel,
      publishedAt: new Date().toISOString(),
      previousVersion: current.version,
      rolledBackFrom: current.version,
      reason,
    });

    metrics.increment('kb.pointer.rollback', { from: current.version, to: target });
    logger.warn({ from: current.version, to: target, reason }, 'rollback de indice');
    return target;
  }

  // A leitura carrega o modelo junto com a versao: quem gera o embedding da
  // consulta precisa usar exatamente o mesmo modelo do indice apontado.
  async function resolveForQuery() {
    const pointer = await store.get('kb:pointer:production');
    if (!pointer) throw new Error('ponteiro de producao ausente');
    return pointer;
  }

  return { publish, rollback, resolveForQuery };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dois detalhes desse código merecem atenção porque são os que separam um mecanismo que funciona de um que dá a impressão de funcionar. O primeiro é a verificação de contagem de vetores antes de publicar: o modo de falha mais comum de um pipeline de indexação não é gerar vetores errados, é morrer no meio e deixar um índice com setenta por cento do material, o que produz um agente que responde bem para alguns assuntos e alucina para outros. O segundo é o compare-and-set: sem ele, uma publicação manual disparada durante o job noturno pode deixar o ponteiro apontando para um índice que já foi substituído, e o rollback vai levar o sistema para um lugar que ninguém previu.',
        },
      ],
    },
    {
      title: 'Rollback de conteúdo e rollback de embedding são coisas diferentes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando alguém pede para voltar a base de conhecimento, quase sempre está pedindo uma de duas coisas muito diferentes, e tratar as duas com o mesmo procedimento é o que faz o rollback demorar mais do que precisava. O primeiro caso é o conteúdo estar errado: alguém publicou uma versão desatualizada do manual, ou uma migração corrompeu o campo de política. O segundo é a representação estar errada: o conteúdo está correto, mas o parser novo quebrou tabelas, o chunking novo perdeu o cabeçalho da seção ou o modelo de embedding mudou e a recuperação piorou.',
        },
        {
          type: 'paragraph',
          value:
            'A distinção importa porque o rollback de conteúdo é seletivo e o de representação não é. Se apenas doze documentos da área fiscal regrediram, reindexar esses doze com o conteúdo antigo é a operação certa: rápida, barata e sem tocar no resto. Já se o problema é o modelo de embedding ou a estratégia de chunking, reindexar parcialmente é a pior escolha possível, porque cria exatamente o índice misto que produz busca semanticamente aleatória. Nesse caso a única operação correta é trocar o ponteiro inteiro para a versão anterior, mesmo que isso signifique voltar também conteúdo que estava certo.',
        },
        {
          type: 'ordered',
          items: [
            'Identifique se o que regrediu é o conteúdo, a representação ou a configuração de busca, porque cada um tem um procedimento diferente e misturá-los prolonga o incidente.',
            'Se for configuração de busca, como pesos, topK ou reranker, faça rollback de configuração e nem toque no índice.',
            'Se for conteúdo em poucos documentos, reindexe apenas esses documentos com a revisão anterior da fonte, mantendo modelo e chunking idênticos aos do índice ativo.',
            'Se for chunking, parser ou modelo de embedding, troque o ponteiro para a versão anterior inteira, nunca de forma parcial.',
            'Registre no ponteiro o motivo e a versão de origem, para que a próxima publicação não repita a build que causou a regressão.',
            'Só depois de estabilizar, corrija a causa e publique uma versão nova, em vez de tentar consertar a versão quebrada em produção.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O quinto item costuma ser tratado como burocracia e é o que evita o incidente repetido. Sem registro de motivo, o pipeline noturno roda de novo na noite seguinte, reconstrói exatamente a mesma build defeituosa e republica sobre o rollback que alguém fez às três da manhã. Um travamento simples resolve: enquanto existir um rollback ativo sem uma causa marcada como resolvida, a publicação automática fica bloqueada e exige aprovação explícita.',
        },
      ],
    },
    {
      title: 'Detectar a regressão antes do cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Rollback rápido só é útil se a decisão de voltar for rápida, e ela não é quando o sinal de que algo piorou vem de reclamação de cliente. Entre a build ruim e a primeira reclamação costumam passar horas, e nesse intervalo o agente já respondeu errado para centenas de pessoas. O que encurta esse intervalo é um portão de qualidade entre construir o índice e publicá-lo, rodando contra a versão candidata antes de ela receber tráfego, e um conjunto pequeno de sinais em produção que comparam o comportamento depois da troca com o de antes.',
        },
        {
          type: 'paragraph',
          value:
            'O portão de recuperação é mais barato e mais sensível que um eval de resposta completa, e por isso é o que deve rodar em toda build. Ele usa um conjunto congelado de consultas com os documentos que deveriam ser recuperados, mede acerto nas primeiras posições contra o índice candidato e compara com o índice ativo. Como não chama o modelo de geração, custa quase nada e roda em segundos, o que permite executá-lo em toda reindexação e não apenas nas grandes.',
        },
        {
          type: 'code',
          value: `// rag/index-gate.js
// Portao de qualidade entre construir o indice e publicar o ponteiro.
// Compara a versao candidata com a ativa usando um conjunto congelado de
// consultas rotuladas. Nao chama o modelo de geracao: mede so recuperacao.

const MIN_RECALL_AT_5 = 0.85;      // piso absoluto aceitavel
const MAX_RECALL_DROP = 0.03;      // queda maxima tolerada versus o ativo
const MAX_LATENCY_RATIO = 1.5;     // candidato nao pode ser 50% mais lento

export function createIndexGate({ vectorDb, embed, goldenSet, metrics, logger }) {
  async function measure({ version, embeddingModel }) {
    let hits = 0;
    let totalMs = 0;

    for (const item of goldenSet) {
      // O embedding da consulta precisa vir do mesmo modelo do indice medido,
      // senao a comparacao entre candidato e ativo nao significa nada.
      const vector = await embed(item.query, { model: embeddingModel });
      const from = Date.now();
      const results = await vectorDb.search(version, vector, { topK: 5 });
      totalMs += Date.now() - from;

      const returnedIds = new Set(results.map((r) => r.documentId));
      if (item.expectedDocumentIds.some((id) => returnedIds.has(id))) {
        hits += 1;
      }
    }

    return {
      recallAt5: hits / goldenSet.length,
      avgLatencyMs: totalMs / goldenSet.length,
    };
  }

  async function evaluate({ candidate, active }) {
    const candidateScore = await measure(candidate);
    // Sem indice ativo (primeira publicacao) so o piso absoluto se aplica.
    const activeScore = active ? await measure(active) : null;

    const reasons = [];

    if (candidateScore.recallAt5 < MIN_RECALL_AT_5) {
      reasons.push(
        \`recall@5 \${candidateScore.recallAt5.toFixed(3)} abaixo do piso \${MIN_RECALL_AT_5}\`,
      );
    }

    if (activeScore) {
      const drop = activeScore.recallAt5 - candidateScore.recallAt5;
      if (drop > MAX_RECALL_DROP) {
        reasons.push(\`queda de recall de \${drop.toFixed(3)} versus o indice ativo\`);
      }

      const ratio = candidateScore.avgLatencyMs / Math.max(activeScore.avgLatencyMs, 1);
      if (ratio > MAX_LATENCY_RATIO) {
        reasons.push(\`busca \${ratio.toFixed(2)}x mais lenta que o indice ativo\`);
      }
    }

    metrics.gauge('kb.gate.recall_at_5', candidateScore.recallAt5, {
      version: candidate.version,
    });

    const approved = reasons.length === 0;
    logger.info({ candidate: candidate.version, approved, reasons }, 'portao de indice');

    return { approved, reasons, candidateScore, activeScore };
  }

  return { evaluate };
}`,
        },
        {
          type: 'paragraph',
          value:
            'A comparação contra o índice ativo, e não apenas contra um piso fixo, é o que dá ao portão a capacidade de pegar regressão gradual. Um piso de oitenta e cinco por cento deixa passar uma build que caiu de noventa e sete para oitenta e seis, que é exatamente o tipo de degradação que ninguém percebe até acumular três delas. Já o limite de queda relativa pega essa build no mesmo dia, e o custo de rodar as duas medições é baixo o suficiente para não ser motivo de discussão.',
        },
        {
          type: 'paragraph',
          value:
            'Em produção, o sinal mais barato e mais rápido é a taxa de recuperação vazia ou de baixa pontuação por rota, comparada com a janela equivalente antes da publicação. Quando um parser quebra tabelas ou o chunking perde cabeçalhos, a busca continua respondendo, mas a melhor pontuação por consulta cai de forma visível e a taxa de consultas sem nenhum trecho acima do limiar sobe. Esses dois números se mexem em minutos após a troca do ponteiro, muito antes de qualquer métrica de satisfação, e servem bem como gatilho de rollback automático quando cruzam o limiar por alguns minutos seguidos.',
        },
      ],
    },
    {
      title: 'Quanto tempo manter as versões anteriores e a que custo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Rollback por ponteiro só funciona se a versão anterior ainda existir, e manter índices vetoriais vivos custa dinheiro real, principalmente quando o serviço cobra por memória. Por isso a política de retenção precisa ser explícita e escalonada, em vez de uma decisão implícita tomada pelo primeiro job de limpeza que alguém escreveu. A regra que costuma equilibrar bem é manter a versão anterior quente por alguns dias, uma ou duas versões mais antigas em armazenamento frio, e o manifesto de todas elas para sempre, já que o manifesto é barato e é o que permite reconstruir uma versão específica se preciso.',
        },
        {
          type: 'table',
          columns: ['Nível', 'O que fica retido', 'Janela', 'Tempo para voltar', 'Custo relativo'],
          rows: [
            [
              'Quente',
              'Índice anterior carregado e consultável',
              '7 dias',
              'Segundos',
              'Alto, dobra a memória do índice',
            ],
            [
              'Morno',
              'Índice anterior existente mas não carregado',
              '30 dias',
              'Minutos, tempo de carga',
              'Médio, só armazenamento',
            ],
            [
              'Frio',
              'Vetores e chunks exportados em objeto',
              '90 dias',
              'Uma hora, tempo de importação',
              'Baixo',
            ],
            [
              'Manifesto',
              'Revisão da fonte, modelo, chunking, esquema',
              'Permanente',
              'Tempo de reindexação completa',
              'Desprezível',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A escolha da janela quente deve vir de um dado que quase ninguém mede: quanto tempo o time leva, historicamente, entre publicar uma build ruim e perceber. Se a mediana desse intervalo é de dois dias, uma retenção quente de vinte e quatro horas é decorativa, porque a versão boa já terá sido coletada quando alguém finalmente identificar o problema. Medir esse intervalo é mais útil do que discutir a janela em abstrato, e normalmente o próprio ato de medir empurra o time a investir no portão de qualidade em vez de na retenção, que é a decisão mais barata das duas.',
        },
        {
          type: 'paragraph',
          value:
            'Há uma armadilha específica quando o provedor de embeddings é gerenciado e o identificador do modelo é um apelido estável em vez de uma versão fixada. Nesse cenário, o mesmo nome de modelo pode passar a produzir vetores de outra distribuição sem nenhuma mudança do seu lado, o que significa que reconstruir uma versão a partir do manifesto pode não reproduzir o índice original. É o argumento mais forte para fixar a versão exata do modelo no manifesto e para manter retenção real do índice em vez de confiar em reconstrução, especialmente para qualquer material que sustente resposta com peso contratual.',
        },
      ],
    },
    {
      title: 'O que fazer com o que já foi respondido durante a janela ruim',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Voltar o índice conserta as respostas futuras e não faz nada pelas que já saíram, e é justamente nas respostas já entregues que costuma estar o dano real: o cliente que recebeu o prazo errado, o vendedor que citou o preço antigo, o registro que virou base de uma reclamação. Um mecanismo de rollback que para na troca do ponteiro resolve metade do problema e deixa a metade cara sem tratamento.',
        },
        {
          type: 'paragraph',
          value:
            'O que fecha esse buraco é gravar a versão do índice em cada interação, junto com os identificadores dos trechos recuperados. Com esse campo, delimitar o estrago é uma consulta: todas as conversas atendidas entre a publicação e o rollback, filtradas pelas que usaram os documentos afetados. Sem esse campo, a única alternativa é revisar por janela de tempo bruta, o que joga na fila de revisão dez vezes mais conversas do que o necessário e faz o time desistir no meio.',
        },
        {
          type: 'code',
          value: `// rag/impact-query.js
// Delimita o impacto de uma build ruim usando a versao de indice gravada
// em cada interacao. Sem esse campo, so resta filtrar por janela de tempo
// e revisar dez vezes mais conversas do que o necessario.

export async function findAffectedConversations({ db, badVersion, affectedDocumentIds }) {
  const rows = await db.query(
    \`SELECT c.conversation_id,
            c.answered_at,
            c.channel,
            c.retrieved_document_ids
       FROM agent_interactions c
      WHERE c.index_version = $1
        AND c.retrieved_document_ids && $2::text[]
      ORDER BY c.answered_at ASC\`,
    [badVersion, affectedDocumentIds],
  );

  // Priorizar o que teve consequencia fora do chat: uma resposta errada que
  // virou pedido ou promessa formal precisa de contato ativo, nao de nota.
  return rows.map((row) => ({
    conversationId: row.conversation_id,
    answeredAt: row.answered_at,
    channel: row.channel,
    needsOutreach: row.retrieved_document_ids.some((id) => affectedDocumentIds.includes(id)),
  }));
}`,
        },
        {
          type: 'paragraph',
          value:
            'Guardar a versão do índice na interação custa uma coluna e resolve muito mais do que rollback. É o mesmo campo que permite atribuir uma queda de qualidade no eval a uma build específica, que permite comparar duas versões de chunking com tráfego real e que responde à pergunta de auditoria mais desconfortável que existe, que é "com base em qual material o sistema afirmou isso naquele dia". Se houver um único item deste artigo para implementar antes dos outros, é esse, porque ele é barato hoje e impossível de reconstruir depois.',
        },
        {
          type: 'paragraph',
          value:
            'Vale terminar com o desconforto que esse trabalho revela. Tratar o índice como artefato versionado transforma o rollback numa operação de segundos, mas ele continua sendo uma operação que precisa de alguém decidindo, e a decisão é sempre entre voltar um conteúdo que estava certo junto com o que estava errado ou conviver com a regressão até a correção sair. Não existe procedimento que elimine essa escolha. O que a versão por ponteiro faz é tirar as três horas de reindexação do meio dela, e é exatamente essa demora que costuma empurrar times para o pior caminho, que é remendar o índice em produção enquanto o cliente espera.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Posso reindexar só os documentos afetados quando troco o modelo de embedding?',
      answer:
        'Não, e essa é a decisão que mais prolonga incidente de RAG. Vetores de modelos diferentes vivem em espaços diferentes, então a distância entre um vetor gerado pelo modelo novo e outro gerado pelo antigo não representa similaridade nenhuma. O efeito é traiçoeiro porque não gera erro: a busca continua devolvendo resultados no formato esperado, com pontuações plausíveis, e a ordem simplesmente deixa de ter relação com a pergunta. Não aparece em log, não dispara alerta de exceção e se manifesta apenas como uma queda difusa de qualidade que o time leva dias para atribuir à causa certa. Quando o que mudou é o modelo de embedding, a dimensão ou a estratégia de chunking, a única operação segura é tratar o índice como um todo: publique uma versão completa nova ou volte o ponteiro para uma versão completa anterior. Reindexação parcial só é válida quando modelo, dimensão e chunking do índice ativo permanecem idênticos e o que mudou foi o conteúdo de origem.',
    },
    {
      question: 'Quanto tempo devo manter o índice anterior disponível para rollback?',
      answer:
        'A janela certa não vem de uma regra genérica, vem de um número que quase ninguém mede: quanto tempo o time historicamente leva entre publicar uma build ruim e perceber que ela é ruim. Se essa mediana é de dois dias, uma retenção quente de vinte e quatro horas é decorativa, porque a versão boa já terá sido coletada quando alguém identificar o problema. Um escalonamento que costuma equilibrar custo e segurança é manter o índice anterior quente e consultável por cerca de sete dias, uma ou duas versões mais antigas em armazenamento morno ou frio por trinta a noventa dias, e o manifesto de todas as builds para sempre, já que ele é praticamente gratuito. Vale um alerta sobre confiar demais em reconstrução a partir do manifesto: se o identificador do modelo de embedding for um apelido estável em vez de uma versão fixada, o provedor pode mudar o modelo por baixo e a reconstrução não vai reproduzir o índice original.',
    },
    {
      question: 'Como saber que preciso voltar antes que o cliente reclame?',
      answer:
        'Com dois mecanismos que não dependem de reclamação. O primeiro é um portão de qualidade entre construir o índice e publicar o ponteiro, rodando um conjunto congelado de consultas rotuladas contra a versão candidata e comparando com a ativa. Ele mede só recuperação, não chama o modelo de geração, custa quase nada e roda em segundos, então cabe em toda reindexação. O detalhe importante é comparar contra o índice ativo e não apenas contra um piso fixo, porque um piso deixa passar a build que caiu de noventa e sete para oitenta e seis, que é exatamente a degradação que ninguém percebe até acumular três delas. O segundo mecanismo é em produção: a taxa de consultas sem nenhum trecho acima do limiar e a melhor pontuação média por rota, comparadas com a janela equivalente antes da publicação. Quando um parser quebra tabelas ou o chunking perde cabeçalhos, esses dois números se movem em minutos após a troca do ponteiro, muito antes de qualquer métrica de satisfação, e funcionam bem como gatilho de rollback automático.',
    },
  ],
  conclusion: {
    title: 'Índice é artefato de release, não cache descartável',
    description:
      'A maioria dos sistemas de RAG descobre que não tem rollback no pior dia possível, porque o índice foi escrito por upsert sobre uma coleção de nome fixo e voltar significa reprocessar tudo enquanto o agente erra na frente do cliente. Construir cada build como um índice imutável identificado por um hash que cobre conteúdo, modelo, dimensão, chunking e esquema, publicar movendo um ponteiro com compare-and-set e verificação de completude, separar rollback de conteúdo de rollback de representação, colocar um portão de recuperação comparando o candidato com o ativo e gravar a versão do índice em cada interação transforma um incidente de horas numa troca de segundos com o estrago delimitado por consulta. Posso desenhar esse esquema de versionamento na sua base de conhecimento, montar o portão de qualidade com o seu conjunto congelado e deixar o rollback como um procedimento testado em vez de uma improvisação de madrugada.',
    cta: 'Falar sobre a base de conhecimento do meu agente',
  },
  related: [
    {
      label: 'Migrar embeddings sem reindexar tudo de uma vez',
      to: '/blog/migrar-embeddings-sem-reindexar-tudo-de-uma-vez',
    },
    {
      label: 'Versionar prompt como código: rollout, rollback e teste',
      to: '/blog/versionar-prompt-como-codigo-rollout-rollback-teste',
    },
    { label: 'Observabilidade e confiabilidade', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const en = {
  intro:
    'The reindex ran on Tuesday night, the team swapped the PDF parser for a better one, and on Wednesday morning the agent started answering that the return policy is seven days when it became thirty two months ago. Someone asks the obvious question: "can we just roll back to yesterday\'s index?". And the answer, in most RAG systems I have seen, is "not exactly". Not because the backup does not exist, but because the index was treated as a disposable cache rather than a versioned artifact: it is overwritten in place, the collection has a fixed name, the embeddings were generated by a model that has already changed version silently, and going back means reprocessing forty thousand documents for three hours while support keeps getting it wrong. This article treats knowledge base rollback as a release engineering problem, not a database one: how to version the index so that going back is flipping a pointer, why content rollback and embedding rollback are different operations requiring different strategies, how to detect the regression before the customer does, and what it really costs to keep the previous version alive.',
  sections: [
    {
      title: 'An index overwritten in place has no rollback',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The pattern almost every RAG system adopts in its first year is the simplest possible one: there is a collection called "documents", a nightly job reads the source, generates embeddings and upserts over the same identifiers. It works very well while everything goes right, and it is unrecoverable on the day it does not. The upsert destroys the previous state by construction, so rollback stops being an infrastructure operation and becomes a full reprocess, which is expensive in time, expensive in embedding model calls and, worst of all, slow at exactly the moment the system is getting it wrong with the customer watching.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth enumerating exactly what is lost, because teams tend to think only the chunk text is at stake. The chunk text goes, but so does the chunk boundary, which changes when the parser changes; the vector goes, and it depends on the model and its version; the filter metadata goes, and it is usually rewritten by rule; and the mapping between source document and derived chunks goes, which is the only way to know later which answers were grounded in which version of the material. Each of those four can regress independently, and each requires a different way back.',
        },
        {
          type: 'table',
          columns: ['What regressed', 'Typical symptom', 'Way back', 'Cost of going back'],
          rows: [
            [
              'Source content',
              'Answer cites an old policy or a wrong price',
              'Restore the content snapshot and reindex only what is affected',
              'Minutes, proportional to documents touched',
            ],
            [
              'Chunking strategy',
              'Answer truncates mid table or drops the condition',
              'Flip the pointer to the previous build index',
              'Seconds, if the previous index still exists',
            ],
            [
              'Embedding model',
              'Retrieval returns diffusely irrelevant documents',
              'Flip the pointer, never reindex partially',
              'Seconds, but requires a full index per model',
            ],
            [
              'Filter metadata',
              'One customer query returns another segment document',
              'Rewrite metadata without touching vectors',
              'Minutes, no embedding cost',
            ],
            [
              'Reranker or search weights',
              'Chunk ordering worsens without the set changing',
              'Config rollback, not index rollback',
              'Immediate, it is only configuration',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The distinction in the third row is the one that most often causes a prolonged incident. Mixing vectors from two embedding models in the same collection raises no error: it produces a search that returns syntactically valid, semantically random results, because distance between vectors from different spaces means nothing. It is the worst kind of failure, because it shows up in no log, triggers no exception alert and is only perceived as a diffuse quality drop that the team takes days to attribute to the right cause.',
        },
      ],
    },
    {
      title: 'Immutable index with a pointer: the basis of fast rollback',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The structural change that makes rollback trivial is to stop writing to the production index and start building a fresh index on every build, identified by a version, with the read service pointing at one version through a pointer. Publishing becomes moving the pointer; going back becomes moving the pointer back. That is exactly the immutable release idea applied to retrieval data, and it turns an hours-long operation into a seconds-long one.',
        },
        {
          type: 'paragraph',
          value:
            'The version identifier must carry everything that changes the meaning of the vector. In practice what works is a deterministic hash over the tuple that defines the build: source content revision, exact embedding model identifier, dimensionality, chunking strategy version and metadata schema version. With that identifier, two builds with the same content but different parsers are different versions, which is the correct behavior, and the system gets for free the ability to refuse a query whose embedding came from a different model than the pointed index.',
        },
        {
          type: 'diagram',
          value: `Pointer-based publishing (rollback = move the arrow)

  content source  --> build v3 --> index kb_a1b2c3  (active)
                      build v2 --> index kb_9f8e7d  (retained, hot)
                      build v1 --> index kb_44c1aa  (retained, cold)

  pointer "production" ------------> kb_a1b2c3
                        rollback --> kb_9f8e7d   (seconds)

  rule: a query is only served if
    embedding_model(query) == embedding_model(pointed index)`,
        },
        {
          type: 'code',
          value: `// rag/index-pointer.js
// Knowledge base publishing and rollback through a pointer.
// The index is never overwritten: every build creates a new collection and
// publish/rollback is an atomic pointer swap in the state store.

import { createHash } from 'node:crypto';

// The version must cover everything that changes the meaning of the vector.
// Swapping the parser without swapping the model still produces an index that
// is incomparable with the previous one, so it goes into the hash.
export function buildIndexVersion({
  contentRevision,
  embeddingModel,
  embeddingDimensions,
  chunkingVersion,
  metadataSchemaVersion,
}) {
  const payload = [
    contentRevision,
    embeddingModel,
    String(embeddingDimensions),
    chunkingVersion,
    metadataSchemaVersion,
  ].join('|');

  return \`kb_\${createHash('sha256').update(payload).digest('hex').slice(0, 12)}\`;
}

export function createIndexPointer({ store, vectorDb, metrics, logger }) {
  // store: key-value with compare-and-set. Without CAS, two concurrent
  // publishes can leave the pointer aimed at an incomplete index.
  async function publish({ version, expectedCurrent, manifest }) {
    const health = await vectorDb.describe(version);

    if (!health.exists) {
      throw new Error(\`index \${version} does not exist\`);
    }
    // Guard against the classic failure: publishing an index the build left
    // half done because the job died mid upsert.
    if (health.vectorCount < manifest.expectedVectorCount) {
      throw new Error(
        \`index \${version} incomplete: \${health.vectorCount}/\${manifest.expectedVectorCount}\`,
      );
    }
    if (health.dimensions !== manifest.embeddingDimensions) {
      throw new Error(\`dimension mismatch in \${version}\`);
    }

    const swapped = await store.compareAndSet('kb:pointer:production', expectedCurrent, {
      version,
      embeddingModel: manifest.embeddingModel,
      publishedAt: new Date().toISOString(),
      previousVersion: expectedCurrent?.version ?? null,
    });

    if (!swapped) {
      throw new Error('pointer changed during publish, re-read and retry');
    }

    metrics.increment('kb.pointer.publish', { version });
    logger.info({ version, from: expectedCurrent?.version }, 'index published');
    return version;
  }

  // Rollback reindexes nothing: it returns to the previous version recorded in
  // the pointer itself. If that version was already collected, it fails loudly
  // instead of silently degrading to some arbitrary index.
  async function rollback({ reason }) {
    const current = await store.get('kb:pointer:production');
    const target = current?.previousVersion;

    if (!target) {
      throw new Error('no previous version recorded for rollback');
    }

    const health = await vectorDb.describe(target);
    if (!health.exists) {
      throw new Error(\`previous version \${target} is no longer retained\`);
    }

    await store.compareAndSet('kb:pointer:production', current, {
      version: target,
      embeddingModel: health.embeddingModel,
      publishedAt: new Date().toISOString(),
      previousVersion: current.version,
      rolledBackFrom: current.version,
      reason,
    });

    metrics.increment('kb.pointer.rollback', { from: current.version, to: target });
    logger.warn({ from: current.version, to: target, reason }, 'index rollback');
    return target;
  }

  // Reads carry the model alongside the version: whoever embeds the query must
  // use exactly the same model as the pointed index.
  async function resolveForQuery() {
    const pointer = await store.get('kb:pointer:production');
    if (!pointer) throw new Error('production pointer missing');
    return pointer;
  }

  return { publish, rollback, resolveForQuery };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Two details in that code deserve attention because they separate a mechanism that works from one that looks like it works. The first is the vector count check before publishing: the most common failure mode of an indexing pipeline is not producing wrong vectors, it is dying halfway and leaving an index with seventy percent of the material, which produces an agent that answers well on some topics and hallucinates on others. The second is the compare-and-set: without it, a manual publish fired during the nightly job can leave the pointer aimed at an index that was already replaced, and rollback will take the system somewhere nobody planned for.',
        },
      ],
    },
    {
      title: 'Content rollback and embedding rollback are different things',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When someone asks to roll back the knowledge base, they are almost always asking for one of two very different things, and treating both with the same procedure is what makes rollback take longer than it needed to. The first case is the content being wrong: someone published an outdated version of the manual, or a migration corrupted the policy field. The second is the representation being wrong: the content is correct, but the new parser broke tables, the new chunking lost the section header or the embedding model changed and retrieval got worse.',
        },
        {
          type: 'paragraph',
          value:
            'The distinction matters because content rollback is selective and representation rollback is not. If only twelve tax documents regressed, reindexing those twelve with the old content is the right operation: fast, cheap and untouching the rest. But if the problem is the embedding model or the chunking strategy, partial reindexing is the worst possible choice, because it creates exactly the mixed index that produces semantically random search. In that case the only correct operation is flipping the whole pointer to the previous version, even if that means also reverting content that was fine.',
        },
        {
          type: 'ordered',
          items: [
            'Identify whether what regressed is content, representation or search configuration, because each has a different procedure and mixing them prolongs the incident.',
            'If it is search configuration, such as weights, topK or reranker, roll back configuration and do not touch the index at all.',
            'If it is content in a few documents, reindex only those documents with the previous source revision, keeping model and chunking identical to the active index.',
            'If it is chunking, parser or embedding model, flip the pointer to the entire previous version, never partially.',
            'Record the reason and the origin version in the pointer, so the next publish does not repeat the build that caused the regression.',
            'Only after stabilizing, fix the cause and publish a new version, rather than trying to patch the broken version in production.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fifth item is usually treated as bureaucracy and is what prevents the repeated incident. Without a recorded reason, the nightly pipeline runs again the following night, rebuilds exactly the same defective build and republishes over the rollback someone performed at three in the morning. A simple interlock solves it: while an active rollback exists without a cause marked as resolved, automatic publishing stays blocked and requires explicit approval.',
        },
      ],
    },
    {
      title: 'Detecting the regression before the customer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Fast rollback is only useful if the decision to go back is fast, and it is not when the signal that something got worse comes from a customer complaint. Hours usually pass between the bad build and the first complaint, and in that window the agent has already answered wrong for hundreds of people. What shortens that window is a quality gate between building the index and publishing it, running against the candidate version before it takes traffic, plus a small set of production signals comparing behavior after the swap with behavior before it.',
        },
        {
          type: 'paragraph',
          value:
            'The retrieval gate is cheaper and more sensitive than a full answer eval, which is why it should run on every build. It uses a frozen set of queries with the documents that should be retrieved, measures hits in the top positions against the candidate index and compares with the active one. Since it never calls the generation model, it costs almost nothing and runs in seconds, which makes it viable on every reindex and not only on the big ones.',
        },
        {
          type: 'code',
          value: `// rag/index-gate.js
// Quality gate between building the index and publishing the pointer.
// Compares the candidate version with the active one using a frozen set of
// labeled queries. It never calls the generation model: retrieval only.

const MIN_RECALL_AT_5 = 0.85;      // absolute acceptable floor
const MAX_RECALL_DROP = 0.03;      // max tolerated drop versus the active index
const MAX_LATENCY_RATIO = 1.5;     // candidate cannot be 50% slower

export function createIndexGate({ vectorDb, embed, goldenSet, metrics, logger }) {
  async function measure({ version, embeddingModel }) {
    let hits = 0;
    let totalMs = 0;

    for (const item of goldenSet) {
      // The query embedding must come from the same model as the measured
      // index, otherwise comparing candidate and active means nothing.
      const vector = await embed(item.query, { model: embeddingModel });
      const from = Date.now();
      const results = await vectorDb.search(version, vector, { topK: 5 });
      totalMs += Date.now() - from;

      const returnedIds = new Set(results.map((r) => r.documentId));
      if (item.expectedDocumentIds.some((id) => returnedIds.has(id))) {
        hits += 1;
      }
    }

    return {
      recallAt5: hits / goldenSet.length,
      avgLatencyMs: totalMs / goldenSet.length,
    };
  }

  async function evaluate({ candidate, active }) {
    const candidateScore = await measure(candidate);
    // With no active index (first publish) only the absolute floor applies.
    const activeScore = active ? await measure(active) : null;

    const reasons = [];

    if (candidateScore.recallAt5 < MIN_RECALL_AT_5) {
      reasons.push(
        \`recall@5 \${candidateScore.recallAt5.toFixed(3)} below floor \${MIN_RECALL_AT_5}\`,
      );
    }

    if (activeScore) {
      const drop = activeScore.recallAt5 - candidateScore.recallAt5;
      if (drop > MAX_RECALL_DROP) {
        reasons.push(\`recall drop of \${drop.toFixed(3)} versus the active index\`);
      }

      const ratio = candidateScore.avgLatencyMs / Math.max(activeScore.avgLatencyMs, 1);
      if (ratio > MAX_LATENCY_RATIO) {
        reasons.push(\`search \${ratio.toFixed(2)}x slower than the active index\`);
      }
    }

    metrics.gauge('kb.gate.recall_at_5', candidateScore.recallAt5, {
      version: candidate.version,
    });

    const approved = reasons.length === 0;
    logger.info({ candidate: candidate.version, approved, reasons }, 'index gate');

    return { approved, reasons, candidateScore, activeScore };
  }

  return { evaluate };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Comparing against the active index, and not only against a fixed floor, is what gives the gate the ability to catch gradual regression. A floor of eighty-five percent lets through a build that dropped from ninety-seven to eighty-six, which is exactly the kind of degradation nobody notices until three of them stack up. The relative drop threshold catches that build on the same day, and the cost of running both measurements is low enough not to be worth arguing about.',
        },
        {
          type: 'paragraph',
          value:
            'In production, the cheapest and fastest signal is the rate of empty or low-scoring retrievals per route, compared with the equivalent window before publishing. When a parser breaks tables or chunking loses headers, search still answers, but the best score per query drops visibly and the rate of queries with no chunk above threshold rises. Both numbers move within minutes of the pointer swap, long before any satisfaction metric, and work well as an automatic rollback trigger when they cross the threshold for a few consecutive minutes.',
        },
      ],
    },
    {
      title: 'How long to keep previous versions and at what cost',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Pointer rollback only works if the previous version still exists, and keeping vector indexes alive costs real money, especially when the service bills by memory. That is why the retention policy must be explicit and tiered, rather than an implicit decision made by the first cleanup job someone wrote. The rule that usually balances well is keeping the previous version hot for a few days, one or two older versions in cold storage, and the manifest of all of them forever, since the manifest is cheap and is what allows rebuilding a specific version if needed.',
        },
        {
          type: 'table',
          columns: ['Tier', 'What is retained', 'Window', 'Time to go back', 'Relative cost'],
          rows: [
            [
              'Hot',
              'Previous index loaded and queryable',
              '7 days',
              'Seconds',
              'High, doubles index memory',
            ],
            [
              'Warm',
              'Previous index existing but not loaded',
              '30 days',
              'Minutes, load time',
              'Medium, storage only',
            ],
            [
              'Cold',
              'Vectors and chunks exported to object storage',
              '90 days',
              'One hour, import time',
              'Low',
            ],
            [
              'Manifest',
              'Source revision, model, chunking, schema',
              'Permanent',
              'Full reindex time',
              'Negligible',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The hot window should be chosen from a number almost nobody measures: how long the team historically takes between publishing a bad build and noticing. If the median of that interval is two days, a twenty-four hour hot retention is decorative, because the good version will already have been collected by the time someone finally identifies the problem. Measuring that interval is more useful than debating the window in the abstract, and usually the act of measuring pushes the team to invest in the quality gate rather than in retention, which is the cheaper of the two decisions.',
        },
        {
          type: 'paragraph',
          value:
            'There is a specific trap when the embedding provider is managed and the model identifier is a stable alias rather than a pinned version. In that scenario, the same model name can start producing vectors from another distribution with no change on your side, which means rebuilding a version from the manifest may not reproduce the original index. It is the strongest argument for pinning the exact model version in the manifest and for keeping real index retention instead of trusting rebuilds, especially for any material backing answers with contractual weight.',
        },
      ],
    },
    {
      title: 'What to do about what was already answered during the bad window',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Rolling the index back fixes future answers and does nothing for the ones already sent, and it is precisely in the delivered answers that the real damage usually lies: the customer who got the wrong deadline, the salesperson who quoted the old price, the record that became the basis of a complaint. A rollback mechanism that stops at the pointer swap solves half the problem and leaves the expensive half untreated.',
        },
        {
          type: 'paragraph',
          value:
            'What closes that gap is recording the index version on every interaction, along with the identifiers of the retrieved chunks. With that field, scoping the damage is a single query: all conversations served between publish and rollback, filtered to those that used the affected documents. Without that field, the only alternative is reviewing by raw time window, which throws ten times more conversations than necessary into the review queue and makes the team give up halfway.',
        },
        {
          type: 'code',
          value: `// rag/impact-query.js
// Scopes the damage of a bad build using the index version recorded on each
// interaction. Without that field, all that is left is filtering by time
// window and reviewing ten times more conversations than necessary.

export async function findAffectedConversations({ db, badVersion, affectedDocumentIds }) {
  const rows = await db.query(
    \`SELECT c.conversation_id,
            c.answered_at,
            c.channel,
            c.retrieved_document_ids
       FROM agent_interactions c
      WHERE c.index_version = $1
        AND c.retrieved_document_ids && $2::text[]
      ORDER BY c.answered_at ASC\`,
    [badVersion, affectedDocumentIds],
  );

  // Prioritize what had consequences outside the chat: a wrong answer that
  // became an order or a formal promise needs outreach, not a note.
  return rows.map((row) => ({
    conversationId: row.conversation_id,
    answeredAt: row.answered_at,
    channel: row.channel,
    needsOutreach: row.retrieved_document_ids.some((id) => affectedDocumentIds.includes(id)),
  }));
}`,
        },
        {
          type: 'paragraph',
          value:
            'Storing the index version on the interaction costs one column and solves much more than rollback. It is the same field that lets you attribute a quality drop in the eval to a specific build, that lets you compare two chunking versions with real traffic, and that answers the most uncomfortable audit question there is, which is "based on which material did the system assert that on that day". If there is a single item from this article to implement before the others, it is this one, because it is cheap today and impossible to reconstruct later.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth ending with the discomfort this work reveals. Treating the index as a versioned artifact turns rollback into a seconds-long operation, but it remains an operation that needs someone deciding, and the decision is always between reverting content that was right alongside content that was wrong, or living with the regression until the fix ships. No procedure eliminates that choice. What pointer versioning does is take the three hours of reindexing out of the middle of it, and it is exactly that delay that usually pushes teams down the worst path, which is patching the index in production while the customer waits.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can I reindex only the affected documents when I change the embedding model?',
      answer:
        'No, and that is the decision that most prolongs RAG incidents. Vectors from different models live in different spaces, so the distance between a vector generated by the new model and one generated by the old model represents no similarity at all. The effect is treacherous because it raises no error: search keeps returning results in the expected format, with plausible scores, and the ordering simply stops relating to the question. It shows up in no log, triggers no exception alert and manifests only as a diffuse quality drop the team takes days to attribute to the right cause. When what changed is the embedding model, the dimensionality or the chunking strategy, the only safe operation is treating the index as a whole: publish a complete new version or flip the pointer to a complete previous version. Partial reindexing is only valid when the model, dimensionality and chunking of the active index stay identical and what changed was the source content.',
    },
    {
      question: 'How long should I keep the previous index available for rollback?',
      answer:
        'The right window does not come from a generic rule, it comes from a number almost nobody measures: how long the team historically takes between publishing a bad build and realizing it is bad. If that median is two days, a twenty-four hour hot retention is decorative, because the good version will already have been collected by the time someone identifies the problem. A tiering that usually balances cost and safety is keeping the previous index hot and queryable for around seven days, one or two older versions in warm or cold storage for thirty to ninety days, and the manifest of every build forever, since it is practically free. One warning about trusting rebuilds from the manifest too much: if the embedding model identifier is a stable alias rather than a pinned version, the provider can change the model underneath you and the rebuild will not reproduce the original index.',
    },
    {
      question: 'How do I know I need to roll back before the customer complains?',
      answer:
        'With two mechanisms that do not depend on complaints. The first is a quality gate between building the index and publishing the pointer, running a frozen set of labeled queries against the candidate version and comparing with the active one. It measures retrieval only, never calls the generation model, costs almost nothing and runs in seconds, so it fits on every reindex. The important detail is comparing against the active index and not only against a fixed floor, because a floor lets through the build that dropped from ninety-seven to eighty-six, which is exactly the degradation nobody notices until three of them stack up. The second mechanism lives in production: the rate of queries with no chunk above threshold and the average best score per route, compared with the equivalent window before publishing. When a parser breaks tables or chunking loses headers, those two numbers move within minutes of the pointer swap, long before any satisfaction metric, and work well as an automatic rollback trigger.',
    },
  ],
  conclusion: {
    title: 'The index is a release artifact, not a disposable cache',
    description:
      'Most RAG systems discover they have no rollback on the worst possible day, because the index was written by upsert over a fixed-name collection and going back means reprocessing everything while the agent gets it wrong in front of the customer. Building every build as an immutable index identified by a hash covering content, model, dimensionality, chunking and schema, publishing by moving a pointer with compare-and-set and a completeness check, separating content rollback from representation rollback, putting a retrieval gate that compares candidate against active, and recording the index version on every interaction turns an hours-long incident into a seconds-long swap with the damage scoped by a query. I can design that versioning scheme for your knowledge base, build the quality gate with your frozen set and leave rollback as a tested procedure rather than a three-in-the-morning improvisation.',
    cta: 'Talk about my agent knowledge base',
  },
  related: [
    {
      label: 'Migrating embeddings without reindexing everything at once',
      to: '/blog/migrar-embeddings-sem-reindexar-tudo-de-uma-vez',
    },
    {
      label: 'Versioning prompts as code: rollout, rollback and testing',
      to: '/blog/versionar-prompt-como-codigo-rollout-rollback-teste',
    },
    { label: 'Observability and reliability', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const es = {
  intro:
    'La reindexación corrió el martes por la noche, el equipo cambió el parser de PDF por uno mejor, y el miércoles por la mañana el agente empezó a responder que la política de cambio es de siete días cuando pasó a treinta hace dos meses. Alguien hace la pregunta obvia: "¿se puede volver al índice de ayer?". Y la respuesta, en la mayoría de los sistemas de RAG que he visto, es "no exactamente". No porque no exista respaldo, sino porque el índice fue tratado como una caché descartable y no como un artefacto versionado: se sobrescribe en el lugar, la colección tiene un nombre fijo, los embeddings fueron generados por un modelo que ya cambió de versión en silencio, y volver significa reprocesar cuarenta mil documentos durante tres horas mientras la atención sigue equivocándose. Este artículo trata el rollback de base de conocimiento como un problema de ingeniería de release, no de base de datos: cómo versionar el índice para que volver sea mover un puntero, por qué el rollback de contenido y el de embedding son operaciones distintas que exigen estrategias distintas, cómo detectar la regresión antes que el cliente y cuál es el costo real de mantener viva la versión anterior.',
  sections: [
    {
      title: 'El índice sobrescrito en el lugar no tiene rollback',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El patrón que casi todo sistema de RAG adopta en el primer año es el más simple posible: existe una colección llamada "documentos", un job nocturno lee la fuente, genera embeddings y hace upsert sobre los mismos identificadores. Funciona muy bien mientras todo sale bien, y es irrecuperable el día en que no sale. El upsert destruye el estado anterior por construcción, así que el rollback deja de ser una operación de infraestructura y se convierte en un reprocesamiento completo, caro en tiempo, caro en llamadas al modelo de embedding y, lo peor, lento justo en el momento en que el sistema se está equivocando con el cliente delante.',
        },
        {
          type: 'paragraph',
          value:
            'Vale enumerar qué se pierde exactamente, porque los equipos suelen creer que solo está en juego el texto del fragmento. Se pierde el texto del chunk, pero también la frontera del chunk, que cambia cuando cambia el parser; se pierde el vector, que depende del modelo y de su versión; se pierden los metadatos de filtro, que suelen reescribirse por regla; y se pierde el mapeo entre documento de origen y fragmentos derivados, que es la única forma de saber después qué respuestas se fundamentaron en qué versión del material. Cada uno de esos cuatro puede regresar de forma independiente, y cada uno exige un mecanismo de retorno distinto.',
        },
        {
          type: 'table',
          columns: ['Qué regresó', 'Síntoma típico', 'Mecanismo de retorno', 'Costo de volver'],
          rows: [
            [
              'Contenido de la fuente',
              'La respuesta cita una política vieja o un precio incorrecto',
              'Volver el snapshot de contenido y reindexar solo lo afectado',
              'Minutos, proporcional a los documentos tocados',
            ],
            [
              'Estrategia de chunking',
              'La respuesta se corta en medio de una tabla o pierde la condición',
              'Mover el puntero al índice de la build anterior',
              'Segundos, si el índice anterior aún existe',
            ],
            [
              'Modelo de embedding',
              'La recuperación trae documentos irrelevantes de forma difusa',
              'Mover el puntero, nunca reindexar parcialmente',
              'Segundos, pero exige un índice completo por modelo',
            ],
            [
              'Metadatos de filtro',
              'La consulta de un cliente trae un documento de otro segmento',
              'Reescribir metadatos sin tocar el vector',
              'Minutos, sin costo de embedding',
            ],
            [
              'Reranker o pesos de búsqueda',
              'El orden de los fragmentos empeora sin cambiar el conjunto',
              'Rollback de configuración, no de índice',
              'Inmediato, es solo configuración',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La distinción de la tercera fila es la que más provoca incidentes prolongados. Mezclar vectores de dos modelos de embedding en la misma colección no genera error: genera una búsqueda que devuelve resultados sintácticamente válidos y semánticamente aleatorios, porque la distancia entre vectores de espacios distintos no significa nada. Es el peor tipo de falla, porque no aparece en el log, no dispara alerta de excepción y solo se percibe como una caída difusa de calidad que el equipo tarda días en atribuir a la causa correcta.',
        },
      ],
    },
    {
      title: 'Índice inmutable con puntero: la base del rollback rápido',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El cambio estructural que vuelve trivial el rollback es dejar de escribir en el índice de producción y pasar a construir un índice nuevo en cada build, identificado por una versión, con el servicio de lectura apuntando a una versión mediante un puntero. Publicar pasa a ser mover el puntero; volver pasa a ser moverlo de vuelta. Es exactamente la idea de release inmutable aplicada a datos de recuperación, y convierte una operación de horas en una operación de segundos.',
        },
        {
          type: 'paragraph',
          value:
            'El identificador de la versión debe cargar todo lo que cambia el significado del vector. En la práctica, lo que funciona es un hash determinista sobre la tupla que define la build: revisión del contenido de origen, identificador exacto del modelo de embedding, dimensión, versión de la estrategia de chunking y versión del esquema de metadatos. Con ese identificador, dos builds con el mismo contenido pero parsers distintos son versiones distintas, que es el comportamiento correcto, y el sistema gana gratis la capacidad de rechazar una consulta cuyo embedding fue generado por un modelo distinto al del índice apuntado.',
        },
        {
          type: 'diagram',
          value: `Publicacion con puntero (rollback = mover la flecha)

  fuente de contenido --> build v3 --> indice kb_a1b2c3  (activo)
                          build v2 --> indice kb_9f8e7d  (retenido, caliente)
                          build v1 --> indice kb_44c1aa  (retenido, frio)

  puntero "produccion" ---------------> kb_a1b2c3
                           rollback --> kb_9f8e7d   (segundos)

  regla: una consulta solo se sirve si
    embedding_model(consulta) == embedding_model(indice apuntado)`,
        },
        {
          type: 'code',
          value: `// rag/index-pointer.js
// Publicacion y rollback de base de conocimiento por puntero.
// El indice nunca se sobrescribe: cada build crea una coleccion nueva y
// publicar/volver es un intercambio atomico de puntero en el almacen de estado.

import { createHash } from 'node:crypto';

// La version debe cubrir todo lo que cambia el significado del vector.
// Cambiar el parser sin cambiar el modelo igual produce un indice
// incomparable con el anterior, asi que entra en el hash.
export function buildIndexVersion({
  contentRevision,
  embeddingModel,
  embeddingDimensions,
  chunkingVersion,
  metadataSchemaVersion,
}) {
  const payload = [
    contentRevision,
    embeddingModel,
    String(embeddingDimensions),
    chunkingVersion,
    metadataSchemaVersion,
  ].join('|');

  return \`kb_\${createHash('sha256').update(payload).digest('hex').slice(0, 12)}\`;
}

export function createIndexPointer({ store, vectorDb, metrics, logger }) {
  // store: clave-valor con compare-and-set. Sin CAS, dos publicaciones
  // simultaneas pueden dejar el puntero apuntando a un indice incompleto.
  async function publish({ version, expectedCurrent, manifest }) {
    const health = await vectorDb.describe(version);

    if (!health.exists) {
      throw new Error(\`el indice \${version} no existe\`);
    }
    // Proteccion contra la falla clasica: publicar un indice que la build
    // dejo por la mitad porque el job murio en medio del upsert.
    if (health.vectorCount < manifest.expectedVectorCount) {
      throw new Error(
        \`indice \${version} incompleto: \${health.vectorCount}/\${manifest.expectedVectorCount}\`,
      );
    }
    if (health.dimensions !== manifest.embeddingDimensions) {
      throw new Error(\`dimension divergente en \${version}\`);
    }

    const swapped = await store.compareAndSet('kb:pointer:production', expectedCurrent, {
      version,
      embeddingModel: manifest.embeddingModel,
      publishedAt: new Date().toISOString(),
      previousVersion: expectedCurrent?.version ?? null,
    });

    if (!swapped) {
      throw new Error('el puntero cambio durante la publicacion, vuelva a leer');
    }

    metrics.increment('kb.pointer.publish', { version });
    logger.info({ version, from: expectedCurrent?.version }, 'indice publicado');
    return version;
  }

  // El rollback no reindexa nada: vuelve a la version anterior registrada en
  // el propio puntero. Si esa version ya fue recolectada, falla en voz alta
  // en lugar de degradar en silencio hacia un indice cualquiera.
  async function rollback({ reason }) {
    const current = await store.get('kb:pointer:production');
    const target = current?.previousVersion;

    if (!target) {
      throw new Error('sin version anterior registrada para rollback');
    }

    const health = await vectorDb.describe(target);
    if (!health.exists) {
      throw new Error(\`la version anterior \${target} ya no esta retenida\`);
    }

    await store.compareAndSet('kb:pointer:production', current, {
      version: target,
      embeddingModel: health.embeddingModel,
      publishedAt: new Date().toISOString(),
      previousVersion: current.version,
      rolledBackFrom: current.version,
      reason,
    });

    metrics.increment('kb.pointer.rollback', { from: current.version, to: target });
    logger.warn({ from: current.version, to: target, reason }, 'rollback de indice');
    return target;
  }

  // La lectura carga el modelo junto con la version: quien genera el embedding
  // de la consulta debe usar exactamente el mismo modelo del indice apuntado.
  async function resolveForQuery() {
    const pointer = await store.get('kb:pointer:production');
    if (!pointer) throw new Error('falta el puntero de produccion');
    return pointer;
  }

  return { publish, rollback, resolveForQuery };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dos detalles de ese código merecen atención porque separan un mecanismo que funciona de uno que aparenta funcionar. El primero es la verificación de cantidad de vectores antes de publicar: el modo de falla más común de un pipeline de indexación no es generar vectores incorrectos, es morir a la mitad y dejar un índice con el setenta por ciento del material, lo que produce un agente que responde bien para algunos temas y alucina para otros. El segundo es el compare-and-set: sin él, una publicación manual disparada durante el job nocturno puede dejar el puntero apuntando a un índice ya reemplazado, y el rollback llevará el sistema a un lugar que nadie previó.',
        },
      ],
    },
    {
      title: 'Rollback de contenido y rollback de embedding son cosas distintas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando alguien pide volver la base de conocimiento, casi siempre está pidiendo una de dos cosas muy distintas, y tratar ambas con el mismo procedimiento es lo que hace que el rollback tarde más de lo necesario. El primer caso es que el contenido esté equivocado: alguien publicó una versión desactualizada del manual, o una migración corrompió el campo de política. El segundo es que la representación esté equivocada: el contenido es correcto, pero el parser nuevo rompió tablas, el chunking nuevo perdió el encabezado de la sección o el modelo de embedding cambió y la recuperación empeoró.',
        },
        {
          type: 'paragraph',
          value:
            'La distinción importa porque el rollback de contenido es selectivo y el de representación no lo es. Si solo doce documentos del área fiscal regresaron, reindexar esos doce con el contenido anterior es la operación correcta: rápida, barata y sin tocar el resto. En cambio, si el problema es el modelo de embedding o la estrategia de chunking, reindexar parcialmente es la peor elección posible, porque crea exactamente el índice mixto que produce una búsqueda semánticamente aleatoria. En ese caso la única operación correcta es mover el puntero completo a la versión anterior, aunque eso signifique volver también contenido que estaba bien.',
        },
        {
          type: 'ordered',
          items: [
            'Identifique si lo que regresó es el contenido, la representación o la configuración de búsqueda, porque cada uno tiene un procedimiento distinto y mezclarlos prolonga el incidente.',
            'Si es configuración de búsqueda, como pesos, topK o reranker, haga rollback de configuración y ni toque el índice.',
            'Si es contenido en pocos documentos, reindexe solo esos documentos con la revisión anterior de la fuente, manteniendo modelo y chunking idénticos a los del índice activo.',
            'Si es chunking, parser o modelo de embedding, mueva el puntero a la versión anterior entera, nunca de forma parcial.',
            'Registre en el puntero el motivo y la versión de origen, para que la próxima publicación no repita la build que causó la regresión.',
            'Solo después de estabilizar, corrija la causa y publique una versión nueva, en vez de intentar parchear la versión rota en producción.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El quinto punto suele tratarse como burocracia y es lo que evita el incidente repetido. Sin registro del motivo, el pipeline nocturno corre de nuevo la noche siguiente, reconstruye exactamente la misma build defectuosa y republica sobre el rollback que alguien hizo a las tres de la mañana. Un bloqueo simple lo resuelve: mientras exista un rollback activo sin una causa marcada como resuelta, la publicación automática queda bloqueada y exige aprobación explícita.',
        },
      ],
    },
    {
      title: 'Detectar la regresión antes que el cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El rollback rápido solo sirve si la decisión de volver es rápida, y no lo es cuando la señal de que algo empeoró viene de un reclamo del cliente. Entre la build mala y el primer reclamo suelen pasar horas, y en ese intervalo el agente ya respondió mal a cientos de personas. Lo que acorta ese intervalo es una compuerta de calidad entre construir el índice y publicarlo, corriendo contra la versión candidata antes de que reciba tráfico, más un conjunto pequeño de señales en producción que comparan el comportamiento después del cambio con el de antes.',
        },
        {
          type: 'paragraph',
          value:
            'La compuerta de recuperación es más barata y más sensible que un eval de respuesta completa, y por eso es la que debe correr en cada build. Usa un conjunto congelado de consultas con los documentos que deberían recuperarse, mide aciertos en las primeras posiciones contra el índice candidato y compara con el índice activo. Como no llama al modelo de generación, cuesta casi nada y corre en segundos, lo que permite ejecutarla en cada reindexación y no solo en las grandes.',
        },
        {
          type: 'code',
          value: `// rag/index-gate.js
// Compuerta de calidad entre construir el indice y publicar el puntero.
// Compara la version candidata con la activa usando un conjunto congelado de
// consultas etiquetadas. No llama al modelo de generacion: mide recuperacion.

const MIN_RECALL_AT_5 = 0.85;      // piso absoluto aceptable
const MAX_RECALL_DROP = 0.03;      // caida maxima tolerada frente al activo
const MAX_LATENCY_RATIO = 1.5;     // el candidato no puede ser 50% mas lento

export function createIndexGate({ vectorDb, embed, goldenSet, metrics, logger }) {
  async function measure({ version, embeddingModel }) {
    let hits = 0;
    let totalMs = 0;

    for (const item of goldenSet) {
      // El embedding de la consulta debe venir del mismo modelo del indice
      // medido, si no la comparacion entre candidato y activo no significa nada.
      const vector = await embed(item.query, { model: embeddingModel });
      const from = Date.now();
      const results = await vectorDb.search(version, vector, { topK: 5 });
      totalMs += Date.now() - from;

      const returnedIds = new Set(results.map((r) => r.documentId));
      if (item.expectedDocumentIds.some((id) => returnedIds.has(id))) {
        hits += 1;
      }
    }

    return {
      recallAt5: hits / goldenSet.length,
      avgLatencyMs: totalMs / goldenSet.length,
    };
  }

  async function evaluate({ candidate, active }) {
    const candidateScore = await measure(candidate);
    // Sin indice activo (primera publicacion) solo aplica el piso absoluto.
    const activeScore = active ? await measure(active) : null;

    const reasons = [];

    if (candidateScore.recallAt5 < MIN_RECALL_AT_5) {
      reasons.push(
        \`recall@5 \${candidateScore.recallAt5.toFixed(3)} por debajo del piso \${MIN_RECALL_AT_5}\`,
      );
    }

    if (activeScore) {
      const drop = activeScore.recallAt5 - candidateScore.recallAt5;
      if (drop > MAX_RECALL_DROP) {
        reasons.push(\`caida de recall de \${drop.toFixed(3)} frente al indice activo\`);
      }

      const ratio = candidateScore.avgLatencyMs / Math.max(activeScore.avgLatencyMs, 1);
      if (ratio > MAX_LATENCY_RATIO) {
        reasons.push(\`busqueda \${ratio.toFixed(2)}x mas lenta que el indice activo\`);
      }
    }

    metrics.gauge('kb.gate.recall_at_5', candidateScore.recallAt5, {
      version: candidate.version,
    });

    const approved = reasons.length === 0;
    logger.info({ candidate: candidate.version, approved, reasons }, 'compuerta de indice');

    return { approved, reasons, candidateScore, activeScore };
  }

  return { evaluate };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Comparar contra el índice activo, y no solo contra un piso fijo, es lo que le da a la compuerta la capacidad de atrapar regresiones graduales. Un piso del ochenta y cinco por ciento deja pasar una build que cayó de noventa y siete a ochenta y seis, que es exactamente el tipo de degradación que nadie percibe hasta acumular tres. En cambio, el límite de caída relativa atrapa esa build el mismo día, y el costo de correr ambas mediciones es lo bastante bajo como para no ser motivo de discusión.',
        },
        {
          type: 'paragraph',
          value:
            'En producción, la señal más barata y más rápida es la tasa de recuperaciones vacías o de puntuación baja por ruta, comparada con la ventana equivalente antes de la publicación. Cuando un parser rompe tablas o el chunking pierde encabezados, la búsqueda sigue respondiendo, pero la mejor puntuación por consulta cae de forma visible y la tasa de consultas sin ningún fragmento por encima del umbral sube. Ambos números se mueven en minutos tras el cambio de puntero, mucho antes que cualquier métrica de satisfacción, y sirven bien como disparador de rollback automático cuando cruzan el umbral por varios minutos seguidos.',
        },
      ],
    },
    {
      title: 'Cuánto tiempo mantener las versiones anteriores y a qué costo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El rollback por puntero solo funciona si la versión anterior aún existe, y mantener índices vectoriales vivos cuesta dinero real, sobre todo cuando el servicio cobra por memoria. Por eso la política de retención debe ser explícita y escalonada, en vez de una decisión implícita tomada por el primer job de limpieza que alguien escribió. La regla que suele equilibrar bien es mantener la versión anterior caliente por algunos días, una o dos versiones más antiguas en almacenamiento frío, y el manifiesto de todas ellas para siempre, ya que el manifiesto es barato y es lo que permite reconstruir una versión específica si hace falta.',
        },
        {
          type: 'table',
          columns: ['Nivel', 'Qué queda retenido', 'Ventana', 'Tiempo para volver', 'Costo relativo'],
          rows: [
            [
              'Caliente',
              'Índice anterior cargado y consultable',
              '7 días',
              'Segundos',
              'Alto, duplica la memoria del índice',
            ],
            [
              'Tibio',
              'Índice anterior existente pero no cargado',
              '30 días',
              'Minutos, tiempo de carga',
              'Medio, solo almacenamiento',
            ],
            [
              'Frío',
              'Vectores y fragmentos exportados a objetos',
              '90 días',
              'Una hora, tiempo de importación',
              'Bajo',
            ],
            [
              'Manifiesto',
              'Revisión de la fuente, modelo, chunking, esquema',
              'Permanente',
              'Tiempo de reindexación completa',
              'Despreciable',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La ventana caliente debe elegirse a partir de un dato que casi nadie mide: cuánto tiempo tarda el equipo, históricamente, entre publicar una build mala y darse cuenta. Si la mediana de ese intervalo es de dos días, una retención caliente de veinticuatro horas es decorativa, porque la versión buena ya habrá sido recolectada cuando alguien finalmente identifique el problema. Medir ese intervalo es más útil que discutir la ventana en abstracto, y normalmente el propio acto de medir empuja al equipo a invertir en la compuerta de calidad en vez de en la retención, que es la decisión más barata de las dos.',
        },
        {
          type: 'paragraph',
          value:
            'Hay una trampa específica cuando el proveedor de embeddings es gestionado y el identificador del modelo es un alias estable en lugar de una versión fijada. En ese escenario, el mismo nombre de modelo puede pasar a producir vectores de otra distribución sin ningún cambio de tu lado, lo que significa que reconstruir una versión a partir del manifiesto puede no reproducir el índice original. Es el argumento más fuerte para fijar la versión exacta del modelo en el manifiesto y para mantener retención real del índice en vez de confiar en la reconstrucción, especialmente para cualquier material que sustente respuestas con peso contractual.',
        },
      ],
    },
    {
      title: 'Qué hacer con lo que ya se respondió durante la ventana mala',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Volver el índice arregla las respuestas futuras y no hace nada por las que ya salieron, y es justamente en las respuestas ya entregadas donde suele estar el daño real: el cliente que recibió el plazo equivocado, el vendedor que citó el precio viejo, el registro que se volvió base de un reclamo. Un mecanismo de rollback que se detiene en el cambio de puntero resuelve la mitad del problema y deja la mitad cara sin tratamiento.',
        },
        {
          type: 'paragraph',
          value:
            'Lo que cierra ese hueco es grabar la versión del índice en cada interacción, junto con los identificadores de los fragmentos recuperados. Con ese campo, delimitar el daño es una consulta: todas las conversaciones atendidas entre la publicación y el rollback, filtradas por las que usaron los documentos afectados. Sin ese campo, la única alternativa es revisar por ventana de tiempo bruta, lo que arroja a la fila de revisión diez veces más conversaciones de las necesarias y hace que el equipo abandone a mitad de camino.',
        },
        {
          type: 'code',
          value: `// rag/impact-query.js
// Delimita el impacto de una build mala usando la version de indice grabada
// en cada interaccion. Sin ese campo, solo queda filtrar por ventana de
// tiempo y revisar diez veces mas conversaciones de las necesarias.

export async function findAffectedConversations({ db, badVersion, affectedDocumentIds }) {
  const rows = await db.query(
    \`SELECT c.conversation_id,
            c.answered_at,
            c.channel,
            c.retrieved_document_ids
       FROM agent_interactions c
      WHERE c.index_version = $1
        AND c.retrieved_document_ids && $2::text[]
      ORDER BY c.answered_at ASC\`,
    [badVersion, affectedDocumentIds],
  );

  // Priorizar lo que tuvo consecuencia fuera del chat: una respuesta errada
  // que se volvio pedido o promesa formal necesita contacto activo, no nota.
  return rows.map((row) => ({
    conversationId: row.conversation_id,
    answeredAt: row.answered_at,
    channel: row.channel,
    needsOutreach: row.retrieved_document_ids.some((id) => affectedDocumentIds.includes(id)),
  }));
}`,
        },
        {
          type: 'paragraph',
          value:
            'Guardar la versión del índice en la interacción cuesta una columna y resuelve mucho más que el rollback. Es el mismo campo que permite atribuir una caída de calidad en el eval a una build específica, que permite comparar dos versiones de chunking con tráfico real y que responde a la pregunta de auditoría más incómoda que existe, que es "con base en qué material el sistema afirmó eso aquel día". Si hay un único punto de este artículo para implementar antes que los demás, es ese, porque es barato hoy e imposible de reconstruir después.',
        },
        {
          type: 'paragraph',
          value:
            'Vale terminar con la incomodidad que este trabajo revela. Tratar el índice como artefacto versionado convierte el rollback en una operación de segundos, pero sigue siendo una operación que necesita a alguien decidiendo, y la decisión siempre es entre volver contenido que estaba bien junto con el que estaba mal o convivir con la regresión hasta que salga la corrección. No existe procedimiento que elimine esa elección. Lo que la versión por puntero hace es sacar las tres horas de reindexación del medio, y es exactamente esa demora la que suele empujar a los equipos por el peor camino, que es parchear el índice en producción mientras el cliente espera.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Puedo reindexar solo los documentos afectados cuando cambio el modelo de embedding?',
      answer:
        'No, y esa es la decisión que más prolonga los incidentes de RAG. Los vectores de modelos distintos viven en espacios distintos, así que la distancia entre un vector generado por el modelo nuevo y otro generado por el antiguo no representa similitud alguna. El efecto es traicionero porque no genera error: la búsqueda sigue devolviendo resultados en el formato esperado, con puntuaciones plausibles, y el orden simplemente deja de tener relación con la pregunta. No aparece en el log, no dispara alerta de excepción y se manifiesta solo como una caída difusa de calidad que el equipo tarda días en atribuir a la causa correcta. Cuando lo que cambió es el modelo de embedding, la dimensión o la estrategia de chunking, la única operación segura es tratar el índice como un todo: publique una versión completa nueva o mueva el puntero a una versión completa anterior. La reindexación parcial solo es válida cuando el modelo, la dimensión y el chunking del índice activo permanecen idénticos y lo que cambió fue el contenido de origen.',
    },
    {
      question: '¿Cuánto tiempo debo mantener el índice anterior disponible para rollback?',
      answer:
        'La ventana correcta no sale de una regla genérica, sale de un número que casi nadie mide: cuánto tarda históricamente el equipo entre publicar una build mala y darse cuenta de que es mala. Si esa mediana es de dos días, una retención caliente de veinticuatro horas es decorativa, porque la versión buena ya habrá sido recolectada cuando alguien identifique el problema. Un escalonamiento que suele equilibrar costo y seguridad es mantener el índice anterior caliente y consultable por unos siete días, una o dos versiones más antiguas en almacenamiento tibio o frío por treinta a noventa días, y el manifiesto de todas las builds para siempre, ya que es prácticamente gratuito. Vale una advertencia sobre confiar demasiado en la reconstrucción desde el manifiesto: si el identificador del modelo de embedding es un alias estable en lugar de una versión fijada, el proveedor puede cambiar el modelo por debajo y la reconstrucción no reproducirá el índice original.',
    },
    {
      question: '¿Cómo sé que necesito volver antes de que el cliente reclame?',
      answer:
        'Con dos mecanismos que no dependen del reclamo. El primero es una compuerta de calidad entre construir el índice y publicar el puntero, corriendo un conjunto congelado de consultas etiquetadas contra la versión candidata y comparando con la activa. Mide solo recuperación, no llama al modelo de generación, cuesta casi nada y corre en segundos, así que cabe en cada reindexación. El detalle importante es comparar contra el índice activo y no solo contra un piso fijo, porque un piso deja pasar la build que cayó de noventa y siete a ochenta y seis, que es exactamente la degradación que nadie percibe hasta acumular tres. El segundo mecanismo vive en producción: la tasa de consultas sin ningún fragmento por encima del umbral y la mejor puntuación media por ruta, comparadas con la ventana equivalente antes de la publicación. Cuando un parser rompe tablas o el chunking pierde encabezados, esos dos números se mueven en minutos tras el cambio de puntero, mucho antes que cualquier métrica de satisfacción, y funcionan bien como disparador de rollback automático.',
    },
  ],
  conclusion: {
    title: 'El índice es un artefacto de release, no una caché descartable',
    description:
      'La mayoría de los sistemas de RAG descubre que no tiene rollback el peor día posible, porque el índice se escribió por upsert sobre una colección de nombre fijo y volver significa reprocesar todo mientras el agente se equivoca delante del cliente. Construir cada build como un índice inmutable identificado por un hash que cubre contenido, modelo, dimensión, chunking y esquema, publicar moviendo un puntero con compare-and-set y verificación de completitud, separar el rollback de contenido del de representación, poner una compuerta de recuperación que compare el candidato con el activo y grabar la versión del índice en cada interacción convierte un incidente de horas en un cambio de segundos con el daño delimitado por una consulta. Puedo diseñar ese esquema de versionado en tu base de conocimiento, montar la compuerta de calidad con tu conjunto congelado y dejar el rollback como un procedimiento probado en vez de una improvisación de madrugada.',
    cta: 'Hablar sobre la base de conocimiento de mi agente',
  },
  related: [
    {
      label: 'Migrar embeddings sin reindexar todo de una vez',
      to: '/blog/migrar-embeddings-sem-reindexar-tudo-de-uma-vez',
    },
    {
      label: 'Versionar el prompt como código: rollout, rollback y prueba',
      to: '/blog/versionar-prompt-como-codigo-rollout-rollback-teste',
    },
    { label: 'Observabilidad y confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

export default {
  pt,
  en,
  es,
};
